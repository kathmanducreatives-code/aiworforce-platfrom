// COMFYUI, REPLAYED OFFLINE: THE PAGES DECIDE THE CANONICAL CLAIM, IN SHADOW TOO.
//
// Production canary, plan 6f6be04b / task 26b76ebf (2026-09-26):
//
//   "Check 1 company: ComfyUI (https://www.linkedin.com/company/comfyui). It
//    must be based in the US, must have a LinkedIn-declared company size of
//    11–50, must be B2B SaaS, must have raised funding within the last 12
//    months, and must currently be hiring a growth role."
//
// US, size, funding (Series B) and hiring passed. The business-model verifier
// bought comfy.org/platform and /pricing and re-grounded:
//
//   [claim-verifier][reground:web_evidence_regrounded]
//     { pages: 2, new_pages: 2, decision: null, status: null }
//   grounded_brain_diagnostics: { mode: "shadow", rejected_claims: [
//     { claim_type: "business_model", reason: "unsupported_evidence_type",
//       detail: "web_page cannot support a business_model claim" }, … ] }
//
// `web_evidence_regrounded` is logged only AFTER the grounder returned a
// verification and `apply` ran, so `decision: null` is `apply` finding no
// validated business-model claim to write — the evidence-type rule (fixed in
// 900e71aa), not an outage and not the mode.
//
// WHAT `mode: "shadow"` IS ON THIS PATH. `GROUNDED_COMPANY_BRAIN_MODE` gates one
// thing: whether the grounder's whole-company verdict is handed to the LEGACY
// Company Brain (`groundingForBrain` in the engine; `shadow_comparison` in the
// diagnostics). The canonical business-model claim is written by
// `applyRegroundedVerification`, which neither run-agent call site nor the
// binding's `groundCompany` gates on the mode. These tests prove that by
// running the SAME model answer through bindings built in each mode.
//
// Replayed through the real modules: the Pilot compile path, the grounded
// binding (model injected), `regroundPendingClaims`, the evidence registry,
// the verifier, `applyRegroundedVerification`, `missionCandidatesFrom` and
// `evaluateEligibility`. The page text is representative (the production
// quotes were not persisted); every other fact is the production outcome.
//
// ZERO network, ZERO providers, ZERO real model calls, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { routeRequest } from "../../../supabase/functions/_shared/objectiveRouter.ts";
import { compileRequestMission } from "../../../supabase/functions/_shared/requestToMission.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { fundingRecordEvidenceItem } from "../../../supabase/functions/_shared/fundingCorroboration.ts";
import {
  buildGroundedBrainBinding, GROUNDED_BRAIN_MODE_ENV,
} from "../../../supabase/functions/_shared/groundedBrainBinding.ts";
import { regroundPendingClaims, type RegroundPage } from "../../../supabase/functions/_shared/webEvidenceRegrounding.ts";
import {
  applyRegroundedVerification, missionCandidatesFrom, type EngineCompany,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  entityHintFromCompany, type EvidenceDimension, type EvidenceItem,
} from "../../../supabase/functions/_shared/candidateObservation.ts";

globalThis.fetch = () => { throw new Error("the replay must not reach the network"); };

const TASK = "26b76ebf-a06c-46cc-b784-80257fd40db3";
const KEY = "https://www.linkedin.com/company/comfyui";
const Q = "Check 1 company: ComfyUI (https://www.linkedin.com/company/comfyui). It must be based in the US, " +
  "must have a LinkedIn-declared company size of 11–50, must be B2B SaaS, must have raised funding within " +
  "the last 12 months, and must currently be hiring a growth role.";
const NOW = new Date();
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

// ── THE MISSION, THROUGH THE PILOT'S OWN COMPILE PATH ─────────────────────────
const REQUEST = {
  version: "request-v1", objective: "research", confidence: 0.9, ambiguity: [],
  parts: [{
    id: "p1", objective: "research",
    subject: {
      entity: "company",
      references: [{ kind: "named", value: "ComfyUI", cardinality: "one" }, { kind: "url", value: KEY, cardinality: "one" }],
      filters: [
        { field: "geography", op: "eq", value: "United States" },
        { field: "employee_count", op: "range", value: { min: 11, max: 50 } },
        { field: "business_model", op: "eq", value: "B2B SaaS" },
      ],
    },
    requirements: [
      { event: "funding", subject: "company", phrase: "raised funding within the last 12 months", recency_days: 365 },
      { event: "hiring", subject: "company", phrase: "currently be hiring a growth role", qualifier: { role_families: ["growth"], role_terms: ["growth"] } },
    ],
    output: { shape: "records", count: 1 },
  }],
} as never;
const route = routeRequest(REQUEST, { spendAllowed: true });
const compiled = compileRequestMission(REQUEST, (route as unknown as { lead: never }).lead, { originalUserQuery: Q });
if (!compiled.ok) throw new Error(JSON.stringify(compiled));
const MISSION = compiled.result.final_mission;
const CRITERIA = deriveMissionCriteria(MISSION);

// ── THE PAGES THE ROUTE BOUGHT ───────────────────────────────────────────────
const PAGES: RegroundPage[] = [
  {
    source_url: "https://comfy.org/platform", page_intent: "product", fetched_at: "2026-09-26T15:31:07.000Z",
    source_text: "Comfy Cloud runs your ComfyUI workflows on cloud GPUs, with nothing to install. Built for creative teams and studios.",
  },
  {
    source_url: "https://comfy.org/pricing", page_intent: "pricing", fetched_at: "2026-09-26T15:31:13.000Z",
    source_text: "Teams: a cloud-based workspace for businesses, billed per seat each month. Enterprise plans for companies with SSO and dedicated support.",
  },
];

// ── COMFYUI AS THE ENGINE HELD IT WHEN THE VERIFIER RAN ──────────────────────
let seq = 0;
const proven = (dimension: EvidenceDimension, value: unknown, actor: string): EvidenceItem => ({
  evidence_id: `ev_${dimension}_${++seq}`, company_key: KEY, dimension, value, status: "proven",
  source: { provider: "apify", actor, provider_call_id: `pc_${seq}`, url: KEY, excerpt: null },
  method: "provider_field", observed_at: iso(0), valid_until: null, confidence: "high",
  derived_from: [], mission_id: TASK, origin: "lead_mission",
});
/** Series B (production: 2026-04-24), dated relative to today so the 365-day window holds. */
const seriesB = fundingRecordEvidenceItem({
  company_key: KEY, mission_id: TASK, observed_at: iso(0),
  record: {
    provider: "apify", actor: "apify_funding_pvalyou", reported_round_count: 1, history_complete: true,
    observed_at: iso(0), source_url: "https://news.example/comfy-series-b", provider_call_id: "pc_fund",
    rounds: [{ round_type: "Series B", announced_date: iso(155).slice(0, 10), amount_usd: null,
      source_urls: ["https://news.example/comfy-series-b"] }] as never,
  },
});

function comfyui(): EngineCompany {
  const company = {
    company_name: "ComfyUI", linkedin_company_url: KEY, canonical_domain: "comfy.org", website: "https://comfy.org",
    geography: "San Francisco, California, United States", external_source_id: "li_company:comfyui",
    employee_count: null, field_trust: {}, missing_fields: [],
    raw_ref: { actor_key: "apify_linkedin_company_details", source_id: "comfyui" },
  };
  const evidence = [
    proven("identity", { linkedin_company_url: KEY, domain: "comfy.org", name: "ComfyUI" }, "apify_linkedin_company_details"),
    proven("geography", "San Francisco, California, United States", "apify_linkedin_company_details"),
    proven("company_size_band", { min: 11, max: 50, source: "linkedin_declared" }, "apify_linkedin_company_details"),
    proven("hiring", { open_role: "Growth Marketing Lead", role_families: ["growth"] }, "apify_linkedin_job_search"),
    seriesB,
  ];
  return {
    key: KEY, company, observations: [{
      version: "candidate-observation-v1", observation_id: "obs_replay", capability: "company_enrichment",
      actor_key: "apify_linkedin_company_details", provider: "apify", route_id: null, plan_version: null,
      provider_call_id: null, source_record_id: null, source_url: KEY, observed_at: iso(0),
      entity_hint: entityHintFromCompany(company as never), evidence,
    }],
    hiring_jobs: [], yc_open_jobs: [], hiring_assessment: null, first_in_function: null,
    enriched: null, identity: null, found_by: [], verdict: null, brain: null, shortlisted: true,
    prequalified: null, prequal_key: null, shortlist_exclusion: null, triage: null,
    investigation_state: "investigated", investigation_rank: 1, enrichment_outcome: "success",
    completed_operations: [], mission_evaluation: null, identity_conflicts: [], grounded: null,
    // No pages yet — only LinkedIn's label, which is context, never proof.
    evidence_registry: registryWith([]),
  } as never;
}

/** The registry the engine's `rebuild_registry` produces: the company's facts plus the pages. */
function registryWith(pages: readonly RegroundPage[]) {
  return buildEvidenceRegistry({
    evidence: buildCompanyEvidence({
      company_key: KEY, source_capability: "known_company_resolution", source_query: Q,
      company: {
        company_name: "ComfyUI", linkedin_company_url: KEY, canonical_domain: "comfy.org", website: "https://comfy.org",
        geography: "San Francisco, California, United States", provider_industry: "Software Development",
        field_trust: {}, missing_fields: [], raw_ref: { actor_key: "apify_linkedin_company_details", source_id: "comfyui" },
      } as never,
      enriched: null, identity_state: "resolved", linkedin_company_url: KEY,
      commercial_jobs: [], strongest_signal: null,
    }),
    web_pages: pages.map((p) => ({ ...p })),
  } as never);
}

/** What the grounding model answers for these pages. Citations are by the registry's own ids. */
function modelAnswer(registry: ReturnType<typeof registryWith>, over: { value?: string; bmQuote?: string; bmPage?: string } = {}) {
  const id = (intent: string) => registry.items.find((x) => x.metadata?.page_intent === intent)!.evidence_id;
  const claim = (claim_type: string, intent: string, excerpt: string) => ({
    claim: "What the company's own site says.", claim_type,
    evidence_ids: [id(intent)], evidence_excerpts: [{ evidence_id: id(intent), excerpt }],
  });
  return {
    business_model: {
      value: over.value ?? "b2b_saas", confidence: 0.85,
      claims: [claim("business_model", over.bmPage ?? "pricing", over.bmQuote ?? "a cloud-based workspace for businesses, billed per seat")],
    },
    company_fit: "review", agentory_use_case: "plausible",
    mission_signal_assessment: { strongest_signal: null, signal_strength: "none", evidence_ids: [], reason: "" },
    supporting_claims: [claim("product_type", "product", "Comfy Cloud runs your ComfyUI workflows on cloud GPUs")],
    conflicting_evidence_ids: [], missing_evidence: [], unknown_fields: [], confidence: 0.8, reason: "",
  };
}

/** One verifier pass exactly as run-agent's claim-verifier `reground` wires it, in the given mode. */
async function replay(mode: "shadow" | "enforce" | undefined, answer = modelAnswer) {
  const c = comfyui();
  const env: Record<string, string> = mode ? { [GROUNDED_BRAIN_MODE_ENV]: mode } : {};
  let calls = 0;
  const binding = buildGroundedBrainBinding({
    workspaceId: "ws", read: (k) => env[k], originalUserQuery: Q, callsRemaining: 1,
    generate: ((req: { messages: Array<{ content: string }> }) => {
      calls++;
      // The model sees the registry the verifier will check against.
      const payload = JSON.parse(req.messages[0].content) as { evidence: Array<{ evidence_id: string }> };
      assert(payload.evidence.length > 0);
      return Promise.resolve({ ok: true, json: answer(registryWith(PAGES)) });
    }) as never,
  });
  const before = evaluateEligibility(CRITERIA, missionCandidatesFrom({ companies: [c] }, { missionId: TASK })[0].graph);
  const report = await regroundPendingClaims({
    requiresCommercialSignal: true, limit: 1,
    candidates: [{ company_key: KEY, business_model_pending: true, grounded_source_urls: [] }],
    deps: {
      pagesFor: () => Promise.resolve(PAGES),
      rebuildRegistry: (_k, pages) => registryWith(pages),
      ground: ({ registry, requiresCommercialSignal }) => binding.groundCompany!({ registry: registry as never, requiresCommercialSignal }),
      apply: (_k, v) => applyRegroundedVerification(c, v, TASK, iso(0)),
    },
  });
  const after = evaluateEligibility(CRITERIA, missionCandidatesFrom({ companies: [c] }, { missionId: TASK })[0].graph);
  const industry = (e: typeof after) => e.checks.filter((x) => x.dimension === "industry" && x.kind === "hard").map((x) => x.result);
  return { c, binding, calls, report, outcome: report.outcomes[0], before, after, industry };
}

// ── THE FIXTURE IS THE PRODUCTION STATE ───────────────────────────────────────

Deno.test("replay: the compiled mission has production's hard criteria", () => {
  assertEquals(CRITERIA.filter((c) => c.kind === "hard").map((c) => c.dimension).sort(),
    ["company_size", "funding", "geography", "hiring", "industry", "industry", "known_companies"]);
});

Deno.test("replay: before the pages, ComfyUI is PENDING on B2B SaaS alone — production's end state", async () => {
  const { before, industry } = await replay("shadow");
  assertEquals(before.eligibility, "pending");
  assertEquals(before.hard_checks, {
    company_size: "pass", funding: "pass", geography: "pass", hiring: "pass", industry: "unknown", known_companies: "pass",
  });
  assertEquals(industry(before), ["unknown", "unknown"]);
});

// ── THE VERDICT ──────────────────────────────────────────────────────────────

Deno.test("replay (shadow, production's mode): the pages prove B2B SaaS and ComfyUI becomes ELIGIBLE", async () => {
  const r = await replay("shadow");
  assertEquals(r.binding.mode, "shadow");
  assertEquals(r.calls, 1, "one grounding call");
  assertEquals([r.outcome.skipped, r.outcome.new_pages, r.outcome.decision, r.outcome.status], [null, 2, "accepted", "proven"],
    "production logged decision: null, status: null");
  assertEquals(r.c.grounded!.rejected_claims, [], "production: web_page cannot support a business_model claim");
  assertEquals(r.industry(r.after), ["pass", "pass"], "b2b saas AND saas");
  assertEquals(r.after.eligibility, "eligible");
  assertEquals(r.after.disproven, []);
  // The claim is the canonical one, under its stable id, citing the page.
  const bm = r.c.observations!.flatMap((o) => o.evidence).find((e) => e.dimension === "business_model")!;
  assertEquals([bm.evidence_id, bm.status, bm.source.actor], [`grd_${KEY}_business_model`, "proven", "grounded_evidence_evaluation"]);
  assert(bm.derived_from.every((id) => id.startsWith("web_page:")), bm.derived_from.join(","));
});

Deno.test("mode is not an input to the canonical claim: shadow, enforce and unset write the same verdict", async () => {
  const runs = await Promise.all([replay("shadow"), replay("enforce"), replay(undefined)]);
  assertEquals(runs.map((r) => r.binding.mode), ["shadow", "enforce", "shadow"]);
  for (const r of runs) {
    assertEquals([r.outcome.decision, r.outcome.status, r.after.eligibility], ["accepted", "proven", "eligible"]);
  }
});

// ── WHAT STILL HOLDS IT PENDING — AND WHAT FAILS IT ──────────────────────────

Deno.test("a quote that does not state SaaS delivery is written, but only as plausible: still pending", async () => {
  const r = await replay("shadow", (reg) => modelAnswer(reg, { bmPage: "product", bmQuote: "Built for creative teams and studios." }));
  assertEquals([r.outcome.decision, r.outcome.status], ["review", "plausible"]);
  assertEquals(r.after.eligibility, "pending");
});

Deno.test("a model LABEL of consumer, unstated by the page, is no verdict: the claim stays in review, never eligible", async () => {
  const r = await replay("shadow", (reg) => modelAnswer(reg, { value: "consumer", bmPage: "product", bmQuote: "Built for creative teams and studios." }));
  // "creative teams" names no consumer audience, so this stays a review — the
  // bar for a FAIL is the company's own words, not the model's label.
  assertEquals(r.outcome.decision, "review");
  assert(r.after.eligibility !== "eligible");
});

Deno.test("a grounder that returns nothing is not a verdict: the claim stays pending, nothing is written", async () => {
  const c = comfyui();
  const report = await regroundPendingClaims({
    requiresCommercialSignal: true, limit: 1,
    candidates: [{ company_key: KEY, business_model_pending: true, grounded_source_urls: [] }],
    deps: {
      pagesFor: () => Promise.resolve(PAGES), rebuildRegistry: (_k, p) => registryWith(p),
      ground: () => Promise.resolve(null), apply: (_k, v) => applyRegroundedVerification(c, v, TASK, iso(0)),
    },
  });
  assertEquals(report.outcomes[0].skipped, "ground_failed", "distinct from production's regrounded/decision:null");
  assertEquals(evaluateEligibility(CRITERIA, missionCandidatesFrom({ companies: [c] }, { missionId: TASK })[0].graph).eligibility, "pending");
});
