// AN AI COMPANY THAT SELLS TO BUSINESSES CAN PROVE "B2B SAAS" — ON ITS OWN WORDS.
//
// Production Fuse AI canary, task d2d15d7e (2026-09-26):
//
//   "Check 1 company: Fuse AI (https://www.linkedin.com/company/fuseaicom).
//    It must be based in the US and must be B2B SaaS."
//
// The grounder validated four claims (score 1, verdict pass), coded the model
// `ai_saas`, and grounded it on "Try Fuse for free to experience AI-powered
// sales." → facets [ai, business_customer], `quote_does_not_state_saas_delivery`
// → plausible → PENDING. Two defects:
//
//   1. (fixed here) `ai saas` can never pass "B2B SaaS" (`matchBusinessModel` → unknown),
//      even with perfect quotes: the code list makes AI and B2B alternatives.
//      The value now carries the audience its verified quotes state
//      (`valueWithStatedAudience`).
//   2. The model quoted a tagline while fuseai.com/pricing said "Built for teams
//      running outbound as a repeatable system" and "50/seat". The prompt fix
//      (`BUSINESS_MODEL_QUOTE_GUIDANCE`, groundingQuoteGuidance.test.ts) asks
//      for those words; the tests below show what they prove once quoted.
//
// Page lines are fuseai.com's own, read 2026-09-26. The bar does not move:
// fix 1 alone leaves the production answer plausible (it never stated SaaS
// delivery), a mixed audience adds nothing, and a bare `ai saas` stays ambiguous.
//
// ZERO network, providers, models or database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { routeRequest } from "../../../supabase/functions/_shared/objectiveRouter.ts";
import { compileRequestMission } from "../../../supabase/functions/_shared/requestToMission.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { parseGroundedResult, verifyGroundedResult } from "../../../supabase/functions/_shared/groundedClaims.ts";
import { matchBusinessModel, valueWithStatedAudience } from "../../../supabase/functions/_shared/businessModelMatch.ts";
import {
  applyRegroundedVerification, missionCandidatesFrom, type EngineCompany,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { entityHintFromCompany, type EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

const TASK = "d2d15d7e-9f9d-40a4-9a2f-6f157de1800e";
const KEY = "https://www.linkedin.com/company/fuseaicom";
const Q = "Check 1 company: Fuse AI (https://www.linkedin.com/company/fuseaicom). It must be based in the US and must be B2B SaaS.";
const AT = new Date().toISOString();

// ── THE MISSION, THROUGH THE PILOT'S COMPILE PATH ─────────────────────────────
const REQUEST = {
  version: "request-v1", objective: "research", confidence: 0.9, ambiguity: [],
  parts: [{
    id: "p1", objective: "research",
    subject: {
      entity: "company",
      // A NAMED reference, as production's parse read it: the LinkedIn page is
      // taken from the sentence (`linkedInCompanyPageIn`). A url reference with no
      // signal requirement routes to page analysis instead.
      references: [{ kind: "named", value: "Fuse AI", cardinality: "one" }],
      filters: [{ field: "geography", op: "eq", value: "United States" }, { field: "business_model", op: "eq", value: "B2B SaaS" }],
    },
    requirements: [], output: { shape: "records", count: 1 },
  }],
} as never;
const route = routeRequest(REQUEST, { spendAllowed: true });
const compiled = compileRequestMission(REQUEST, (route as unknown as { lead: never }).lead, { originalUserQuery: Q });
if (!compiled.ok) throw new Error(JSON.stringify(compiled));
const CRITERIA = deriveMissionCriteria(compiled.result.final_mission);

Deno.test("replay: the compiled mission has production's hard criteria, supplying Fuse AI's LinkedIn page", () => {
  const hard = CRITERIA.filter((c) => c.kind === "hard");
  assertEquals(hard.map((c) => `${c.dimension}:${String(c.value).toLowerCase()}`).sort(),
    ["geography:united states", "industry:b2b saas", "industry:saas", `known_companies:${KEY}`]);
});

// ── FUSEAI.COM, VERBATIM ──────────────────────────────────────────────────────
const PAGES = [
  {
    source_url: "https://fuseai.com/", page_intent: "homepage", fetched_at: AT,
    source_text: "The #1 AI-Native Sales Platform. Try Fuse for free to experience AI-powered sales. " +
      "Used by sales & marketing professionals from 1,000+ startups and enterprises worldwide.",
  },
  {
    source_url: "https://fuseai.com/pricing", page_intent: "pricing", fetched_at: AT,
    source_text: "Solo per month. Sign Up For Free. Team. Designed for small teams looking to accelerate outbound. " +
      "Shared team workspace with 5 seats. CRM, MCP, API, and Slack Integrations. Enterprise. " +
      "Built for teams running outbound as a repeatable system. Shared team workspace with 5+ seats. 50/seat.",
  },
];

function registry() {
  return buildEvidenceRegistry({
    evidence: buildCompanyEvidence({
      company_key: KEY, source_capability: "known_company_resolution", source_query: Q,
      company: {
        company_name: "Fuse AI", linkedin_company_url: KEY, canonical_domain: "fuseai.com", website: "https://fuseai.com",
        geography: "San Francisco, CA, United States", provider_industry: "Software Development",
        field_trust: {}, missing_fields: [], raw_ref: { actor_key: "apify_linkedin_company_details", source_id: "fuseaicom" },
      } as never,
      enriched: null, identity_state: "resolved", linkedin_company_url: KEY, commercial_jobs: [], strongest_signal: null,
    }),
    web_pages: PAGES,
  } as never);
}

function fuse(): EngineCompany {
  const company = {
    company_name: "Fuse AI", linkedin_company_url: KEY, canonical_domain: "fuseai.com", website: "https://fuseai.com",
    geography: "San Francisco, CA, United States", external_source_id: "li_company:fuseaicom", employee_count: null,
    field_trust: {}, missing_fields: [], raw_ref: { actor_key: "apify_linkedin_company_details", source_id: "fuseaicom" },
  };
  const proven = (dimension: EvidenceItem["dimension"], value: unknown): EvidenceItem => ({
    evidence_id: `ev_${dimension}`, company_key: KEY, dimension, value, status: "proven",
    source: { provider: "apify", actor: "apify_linkedin_company_details", provider_call_id: "pc_1", url: KEY, excerpt: null },
    method: "provider_field", observed_at: AT, valid_until: null, confidence: "high", derived_from: [], mission_id: TASK,
    origin: "lead_mission",
  });
  return {
    key: KEY, company, hiring_jobs: [], yc_open_jobs: [], hiring_assessment: null, first_in_function: null,
    enriched: null, identity: null, found_by: [], verdict: null, brain: null, shortlisted: true,
    prequalified: null, prequal_key: null, shortlist_exclusion: null, triage: null,
    investigation_state: "investigated", investigation_rank: 1, enrichment_outcome: "success",
    completed_operations: [], mission_evaluation: null, identity_conflicts: [], grounded: null,
    evidence_registry: registry(),
    observations: [{
      version: "candidate-observation-v1", observation_id: "obs_fuse", capability: "company_enrichment",
      actor_key: "apify_linkedin_company_details", provider: "apify", route_id: null, plan_version: null,
      provider_call_id: null, source_record_id: null, source_url: KEY, observed_at: AT,
      entity_hint: entityHintFromCompany(company as never),
      evidence: [
        proven("identity", { linkedin_company_url: KEY, domain: "fuseai.com", name: "Fuse AI" }),
        proven("geography", "San Francisco, CA, United States"),
      ],
    }],
  } as never;
}

/** The grounder's answer, verified against the registry, applied as the engine applies it. */
function ground(value: string, quotes: Array<[claim_type: string, intent: string, excerpt: string]>) {
  const reg = registry();
  const id = (intent: string) => reg.items.find((x) => x.metadata?.page_intent === intent)!.evidence_id;
  const claim = ([claim_type, intent, excerpt]: [string, string, string]) => ({
    claim: "What the company's own site says.", claim_type,
    evidence_ids: [id(intent)], evidence_excerpts: [{ evidence_id: id(intent), excerpt }],
  });
  const verification = verifyGroundedResult({
    registry: reg,
    result: parseGroundedResult({
      business_model: { value, confidence: 0.9, claims: quotes.filter((q) => q[0] === "business_model").map(claim) },
      company_fit: "pass", agentory_use_case: "plausible",
      mission_signal_assessment: { strongest_signal: null, signal_strength: "none", evidence_ids: [], reason: "" },
      supporting_claims: quotes.filter((q) => q[0] !== "business_model").map(claim),
      conflicting_evidence_ids: [], missing_evidence: [], unknown_fields: [], confidence: 0.9, reason: "",
    }),
  });
  const c = fuse();
  const applied = applyRegroundedVerification(c, verification, TASK, AT);
  const e = evaluateEligibility(CRITERIA, missionCandidatesFrom({ companies: [c] }, { missionId: TASK })[0].graph);
  return {
    verification, applied, eligibility: e.eligibility,
    industry: e.checks.filter((x) => x.dimension === "industry" && x.kind === "hard").map((x) => x.result),
  };
}

// ── FIX 1: THE AUDIENCE THE QUOTES STATE ─────────────────────────────────────

Deno.test("the gap: `ai saas` alone can never pass B2B SaaS; with its stated audience it can", () => {
  assertEquals(matchBusinessModel("b2b saas", "ai saas"), "unknown");
  assertEquals(matchBusinessModel("b2b saas", "b2b ai saas"), "pass");
  assertEquals(matchBusinessModel("saas", "b2b ai saas"), "pass");
  assertEquals(matchBusinessModel("ai", "b2b ai saas"), "pass");
  assertEquals(matchBusinessModel("b2b saas", "consumer ai saas"), "fail");
});

Deno.test("valueWithStatedAudience: one stated audience only; a code that names one is left alone", () => {
  assertEquals(valueWithStatedAudience("ai saas", ["ai", "business_customer", "saas_delivery"]), "b2b ai saas");
  assertEquals(valueWithStatedAudience("ai saas", ["ai", "consumer_customer"]), "consumer ai saas");
  assertEquals(valueWithStatedAudience("ai saas", ["ai", "saas_delivery"]), "ai saas", "silence is not support");
  assertEquals(valueWithStatedAudience("ai saas", ["business_customer", "consumer_customer"]), "ai saas", "a mixed audience says nothing");
  assertEquals(valueWithStatedAudience("b2b saas", ["consumer_customer"]), "b2b saas", "the code's own audience stands");
  assertEquals(valueWithStatedAudience("consumer", ["business_customer"]), "consumer");
  assertEquals(valueWithStatedAudience("b2b service", ["business_customer"]), "b2b service");
});

// ── THE PRODUCTION ANSWER, AND THE ONE THE GUIDANCE ASKS FOR ─────────────────

Deno.test("PRODUCTION: the tagline answer stays plausible and pending — fix 1 alone does not prove what was never stated", () => {
  const r = ground("ai_saas", [
    ["business_model", "homepage", "Try Fuse for free to experience AI-powered sales."],
    ["customer_type", "pricing", "Designed for small teams looking to accelerate outbound."],
  ]);
  assertEquals(r.verification.rejected_claims, []);
  assertEquals([r.applied.decision, r.applied.item!.status], ["review", "plausible"]);
  assertEquals(r.applied.item!.value, "b2b ai saas", "the audience is recorded — the delivery still is not");
  assert((r.applied.item!.assessment as { business_model_reasons: string[] }).business_model_reasons
    .includes("quote_does_not_state_saas_delivery"));
  assertEquals([r.industry, r.eligibility], [["unknown", "unknown"], "pending"]);
});

Deno.test("GUIDED: 'Built for teams…' + '50/seat' + the AI line is accepted, proven B2B SaaS, and Fuse AI is ELIGIBLE", () => {
  const r = ground("ai_saas", [
    ["business_model", "pricing", "Built for teams running outbound as a repeatable system"],
    ["business_model", "pricing", "50/seat"],
    ["business_model", "homepage", "The #1 AI-Native Sales Platform."],
  ]);
  assertEquals([r.applied.decision, r.applied.item!.status, r.applied.item!.value], ["accepted", "proven", "b2b ai saas"]);
  assertEquals(r.industry, ["pass", "pass"], "b2b saas AND saas");
  assertEquals(r.eligibility, "eligible");
});

Deno.test("GUIDED, coded b2b_saas: the same quotes pass exactly as before — nothing changes for a code with an audience", () => {
  const r = ground("b2b_saas", [
    ["business_model", "pricing", "Built for teams running outbound as a repeatable system"],
    ["business_model", "pricing", "CRM, MCP, API, and Slack Integrations"],
    ["business_model", "pricing", "Sign Up For Free"],
  ]);
  assertEquals([r.applied.decision, r.applied.item!.value, r.eligibility], ["accepted", "b2b saas", "eligible"]);
});

Deno.test("WITHOUT fix 1 the guided answer would still be pending: `ai saas` against B2B SaaS", () => {
  const r = ground("ai_saas", [
    ["business_model", "pricing", "Built for teams running outbound as a repeatable system"],
    ["business_model", "pricing", "50/seat"],
    ["business_model", "homepage", "The #1 AI-Native Sales Platform."],
  ]);
  assertEquals(r.applied.item!.status, "proven");
  // Evaluate the same proven item as it was written before this change.
  const item = { ...r.applied.item!, value: "ai saas" };
  assertEquals(matchBusinessModel("b2b saas", item.value), "unknown");
});

Deno.test("a quote stating SaaS delivery but no buyer adds no audience: still pending", () => {
  const r = ground("ai_saas", [["business_model", "pricing", "50/seat"], ["business_model", "homepage", "Try Fuse for free to experience AI-powered sales."]]);
  assertEquals(r.applied.item!.value, "ai saas");
  assertEquals(r.eligibility, "pending");
});

// ── WHAT THE PROMPT GUIDANCE ASKS THE MODEL TO QUOTE ─────────────────────────

Deno.test("the guidance's own examples are words the facet reader accepts — the prompt and the code agree", () => {
  // Every example the prompt gives must actually carry its facet, or the model
  // is being taught to quote words the verifier then ignores.
  const r = ground("ai_saas", [
    ["business_model", "pricing", "Designed for small teams looking to accelerate outbound."],
    ["business_model", "pricing", "Shared team workspace with 5+ seats. 50/seat"],
    ["business_model", "homepage", "The #1 AI-Native Sales Platform."],
  ]);
  assertEquals(r.applied.decision, "accepted");
});

Deno.test("an `ai_saas` value still needs a quote saying AI — the rule the guidance now spells out", () => {
  const r = ground("ai_saas", [
    ["business_model", "pricing", "Built for teams running outbound as a repeatable system"],
    ["business_model", "pricing", "50/seat"],
  ]);
  assertEquals([r.applied.decision, r.eligibility], ["review", "pending"]);
  assert((r.applied.item!.assessment as { business_model_reasons: string[] }).business_model_reasons.includes("quote_does_not_state_ai"));
});

// ── THE RERUN'S QUOTES ARE NOW RECORDED ──────────────────────────────────────

Deno.test("RERUN (task e8a70920): a seat count + a price period stay pending — and the claim now records every quote", () => {
  // The rerun's likely quotes, from its own claim text ("monthly plans with
  // seat-based workspaces") and facets [ai, business_customer]. Production
  // kept only the first; the claim now carries them all.
  const quotes: Array<[string, string, string]> = [
    ["business_model", "homepage", "Try Fuse for free to experience AI-powered sales."],
    ["business_model", "pricing", "Designed for small teams looking to accelerate outbound."],
    ["business_model", "pricing", "Shared team workspace with 5 seats"],
    ["business_model", "pricing", "Solo per month"],
  ];
  const r = ground("ai_saas", quotes);
  assertEquals([r.applied.decision, r.eligibility], ["review", "pending"]);
  const a = r.applied.item!.assessment as { business_model_reasons: string[]; business_model_quotes: Array<{ excerpt: string }> };
  assertEquals(a.business_model_reasons, ["quote_does_not_state_saas_delivery"]);
  assertEquals(a.business_model_quotes.map((q) => q.excerpt), quotes.map((q) => q[2]));
  // …and the quotes survive the checkpoint the observation is persisted in.
  const persisted = JSON.parse(JSON.stringify(r.applied.item));
  assertEquals(persisted.assessment.business_model_quotes.length, 4);
});
