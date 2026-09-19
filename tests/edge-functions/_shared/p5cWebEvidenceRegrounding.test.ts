// LEAD V2 P5 PHASE C — THE PAGES RESOLVE THE CLAIM THEY WERE BOUGHT FOR.
//
// Canary c5e281c9 bought Dioptra's /product, /pricing and /customers, stored
// them, and still reported `business_model` PENDING — "the quote does not state
// saas delivery" — because the canonical claim was decided once, before those
// pages existed, and nothing re-read them. `with_executable_route` stayed 0, so
// continuation widened discovery instead of verifying.
//
// These tests drive the real modules: the re-grounding executor, the engine's
// apply seam, the claim registry / gap router, the checkpoint, and the
// continuation rule.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MAX_REGROUNDED_PER_SLICE, regroundPendingClaims, type RegroundDeps, type RegroundPage,
} from "../../../supabase/functions/_shared/webEvidenceRegrounding.ts";
import {
  applyRegroundedVerification, companyEvidenceItems, restoreWorkingSet, toResumeRecord,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { businessModelDecision, type GroundedVerification } from "../../../supabase/functions/_shared/groundedClaims.ts";
import {
  CLAIM_REGISTRY, evidenceGapsFor, summarizeGaps, type ClaimDefinition,
} from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { decideAutoContinuation } from "../../../supabase/functions/_shared/leadAutoContinuation.ts";
import {
  CHECKPOINT_RESULT_KEY, readCheckpointCompanies, RESUME_STATE_VERSION,
} from "../../../supabase/functions/_shared/leadResumeState.ts";

globalThis.fetch = () => { throw new Error("Phase C tests must not reach the network"); };

const NOW = "2026-09-19T12:00:00.000Z";
const CANONICAL = "Find 1 seed-stage B2B SaaS startup in the US hiring its first growth marketer.";
const proposal = {
  requested_opportunity_count: 1, requested_contact_ready_count: null, company_types: ["B2B SaaS"],
  geographies: ["United States"], geography_is_hard: true, employee_range: { min: null, max: null },
  decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
  preferred_signals: ["hiring growth marketer"], required_signal_terms: ["growth marketer"],
  adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
  disallowed_broadening: [], required_evidence: [], required_capabilities: [],
  preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.85, unknowns: [],
};
const CRITERIA = deriveMissionCriteria(compileLeadMission({ originalUserQuery: CANONICAL, proposal }).final_mission);

/** A grounded verification whose quotes state the facets the code asserts. */
function verification(over: {
  value?: string; confidence?: number; quote?: string; decision?: "pass" | "review" | "fail";
  rejected?: Array<{ claim_type: string; reason: string }>;
} = {}): GroundedVerification {
  const claim = {
    claim: "The company sells software to businesses.", claim_type: "business_model" as const,
    evidence_ids: ["web_page:company_website:aa11"],
    evidence_excerpts: [{ evidence_id: "web_page:company_website:aa11", excerpt: over.quote ?? "A cloud-based platform built for finance teams, priced per seat." }],
  };
  return {
    version: "grounded-claims-v1",
    classifier_result: {
      business_model: { value: (over.value ?? "b2b_saas") as never, confidence: over.confidence ?? 0.9, claims: [claim] },
    },
    validated_claims: [claim], rejected_claims: (over.rejected ?? []) as never,
    grounding_score: 1, final_grounded_decision: over.decision ?? "review",
    downgrade_reasons: [], unacknowledged_conflicts: [],
  } as unknown as GroundedVerification;
}

/** An engine company whose business model was read BEFORE the pages existed. */
function company(over: { pages?: string[]; grounded?: GroundedVerification | null } = {}) {
  return {
    key: "https://www.linkedin.com/company/dioptraai",
    company: {
      company_name: "Dioptra", linkedin_company_url: "https://www.linkedin.com/company/dioptraai",
      canonical_domain: "dioptra.ai", website: "https://dioptra.ai", geography: "New York, NY, United States",
      external_source_id: "li_company:1", employee_count: 12, field_trust: {}, missing_fields: [],
      raw_ref: { actor_key: "apify_linkedin_job_search", source_id: "1" },
    },
    observations: [], hiring_jobs: [], yc_open_jobs: [], hiring_assessment: null, first_in_function: null,
    enriched: null, identity: null, found_by: [], verdict: null, brain: null, shortlisted: true,
    prequalified: null, prequal_key: null, shortlist_exclusion: null, triage: null,
    investigation_state: "investigated", investigation_rank: 1, enrichment_outcome: "success",
    completed_operations: [], mission_evaluation: null, identity_conflicts: [],
    grounded: over.grounded ?? null,
    evidence_registry: {
      version: "lead-evidence-registry-v1", company_key: "https://www.linkedin.com/company/dioptraai",
      items: [
        // LinkedIn details already answered for this company — the real state
        // of every candidate by the time a business model is pending.
        {
          evidence_id: "company_industry:linkedin:1", company_key: "k", evidence_type: "company_industry",
          source: "linkedin", source_url: null, structured_value: "Software Development", source_text: null,
          observed_at: NOW, freshness: "current", verification_state: "verified", metadata: {},
        },
      ].concat((over.pages ?? []).map((u, n) => ({
        evidence_id: `web_page:company_website:p${n}`, company_key: "k", evidence_type: "web_page",
        source: "company_website", source_url: u, structured_value: null, source_text: "…",
        observed_at: NOW, freshness: "current", verification_state: "verified", metadata: {},
      })) as never[]),
      hard_facts: {},
    },
  } as never;
}

const pages = (...urls: string[]): RegroundPage[] =>
  urls.map((u) => ({ source_url: u, page_intent: u.split("/").pop() || "homepage", source_text: "A cloud-based platform built for finance teams, priced per seat.", fetched_at: NOW }));

function deps(over: Partial<RegroundDeps> = {}, calls: string[] = []): RegroundDeps {
  return {
    pagesFor: () => { calls.push("pagesFor"); return Promise.resolve(pages("https://dioptra.ai/product", "https://dioptra.ai/pricing")); },
    rebuildRegistry: () => ({ items: [] }),
    ground: () => { calls.push("ground"); return Promise.resolve(verification()); },
    apply: () => { calls.push("apply"); return { item: { status: "proven" }, decision: "accepted" }; },
    ...over,
  };
}

// ── THE EXECUTOR ────────────────────────────────────────────────────────────

Deno.test("Phase C: a pending business model is re-grounded on the pages, and resolves", async () => {
  const calls: string[] = [];
  const r = await regroundPendingClaims({
    candidates: [{ company_key: "c1", business_model_pending: true, grounded_source_urls: [] }],
    requiresCommercialSignal: true, deps: deps({}, calls),
  });
  assertEquals([r.considered, r.regrounded, r.resolved], [1, 1, 0 + 1]);
  assertEquals(calls, ["pagesFor", "ground", "apply"]);
  assertEquals(r.outcomes[0].skipped, null);
  assertEquals(r.outcomes[0].new_pages, 2);
});

Deno.test("Phase C: a claim that is not pending, has no pages, or has no NEW pages is never re-read", async () => {
  const skipped = async (over: Parameters<typeof deps>[0], cand: Parameters<typeof regroundPendingClaims>[0]["candidates"]) => {
    const calls: string[] = [];
    const r = await regroundPendingClaims({ candidates: cand, requiresCommercialSignal: true, deps: deps(over, calls) });
    return { skip: r.outcomes[0]?.skipped ?? null, ground: calls.includes("ground"), considered: r.considered };
  };
  // Answered already: not visited at all.
  assertEquals(await skipped({}, [{ company_key: "c1", business_model_pending: false, grounded_source_urls: [] }]),
    { skip: null, ground: false, considered: 0 });
  // Pending, but nothing was ever fetched.
  assertEquals((await skipped({ pagesFor: () => Promise.resolve([]) },
    [{ company_key: "c1", business_model_pending: true, grounded_source_urls: [] }])).skip, "no_pages");
  // Pending, but the current reading already saw every page: no model call.
  const same = await skipped({}, [{
    company_key: "c1", business_model_pending: true,
    grounded_source_urls: ["https://dioptra.ai/product", "https://dioptra.ai/pricing"],
  }]);
  assertEquals([same.skip, same.ground], ["no_new_pages", false]);
  // No grounder wired ⇒ nothing is claimed.
  assertEquals((await skipped({ ground: null },
    [{ company_key: "c1", business_model_pending: true, grounded_source_urls: [] }])).skip, "no_grounder");
});

Deno.test("Phase C: a failed re-reading is not a verdict — it never throws into the run", async () => {
  const r = await regroundPendingClaims({
    candidates: [{ company_key: "c1", business_model_pending: true, grounded_source_urls: [] }],
    requiresCommercialSignal: true,
    deps: deps({ ground: () => { throw new Error("model down"); } }),
  });
  assertEquals([r.regrounded, r.outcomes[0].skipped], [0, "ground_failed"]);
  assertEquals(r.outcomes[0].status, null);
});

Deno.test("Phase C: the slice is bounded — one model call per company, at most the budget", async () => {
  const calls: string[] = [];
  const many = Array.from({ length: MAX_REGROUNDED_PER_SLICE + 4 }, (_, n) => ({
    company_key: `c${n}`, business_model_pending: true, grounded_source_urls: [],
  }));
  const r = await regroundPendingClaims({ candidates: many, requiresCommercialSignal: true, deps: deps({}, calls) });
  assertEquals(r.regrounded, MAX_REGROUNDED_PER_SLICE);
  assertEquals(calls.filter((c) => c === "ground").length, MAX_REGROUNDED_PER_SLICE);
});

// ── THE DECISION THE RE-READING PRODUCES ────────────────────────────────────

Deno.test("Phase C: accepted ⇒ PASS, review ⇒ PENDING, verified contradiction ⇒ FAIL", () => {
  const graphOf = (c: ReturnType<typeof company>) =>
    buildCompanyEvidenceGraph("k", companyEvidenceItems(c, "task"), { now: new Date(NOW) });
  const check = (c: ReturnType<typeof company>) =>
    evaluateEligibility(CRITERIA, graphOf(c)).checks.find((x) => x.dimension === "industry" && x.kind === "hard")!;

  // ACCEPTED — the quotes state business customers and SaaS delivery.
  const pass = company();
  const applied = applyRegroundedVerification(pass, verification(), "task", NOW);
  assertEquals(businessModelDecision(verification()).decision, "accepted");
  assertEquals(applied.item!.status, "proven");
  assertEquals(check(pass).result, "pass");

  // REVIEW — "a platform for financial firms" never says SaaS. Still pending.
  const pending = company();
  const weak = applyRegroundedVerification(pending, verification({ quote: "An agentic data intake platform for financial firms." }), "task", NOW);
  assertEquals(weak.decision, "review");
  assertEquals(weak.item!.status, "plausible");
  assertEquals(check(pending).result, "unknown");
  assert(/saas delivery/.test(check(pending).reason), check(pending).reason);

  // VERIFIED CONTRADICTION — the company's own words say consumer.
  const fail = company();
  applyRegroundedVerification(fail, verification({ value: "consumer", quote: "Built for individuals and families." }), "task", NOW);
  assertEquals(check(fail).result, "fail");
});

Deno.test("Phase C: the whole-company verdict never drags down the business-model claim (plan §11)", () => {
  // `final_grounded_decision: "review"` is what nearly every company gets while
  // the mission carries unprovable targets. The claim is judged on its own.
  const c = company();
  const applied = applyRegroundedVerification(c, verification({ decision: "review" }), "task", NOW);
  assertEquals([applied.decision, applied.item!.status], ["accepted", "proven"]);
  // The CLAIM's own decision sets the confidence too — not the company verdict.
  assertEquals(applied.item!.confidence, "medium");
  const weak = company();
  const unaccepted = applyRegroundedVerification(
    weak, verification({ decision: "pass", quote: "An agentic data intake platform for financial firms." }), "task", NOW);
  assertEquals([unaccepted.decision, unaccepted.item!.status, unaccepted.item!.confidence],
    ["review", "plausible", "low"], "a passing company verdict cannot lift an unaccepted claim");
});

Deno.test("Phase C: a READY route without a canonical executor is never chosen", () => {
  // The flag is the whole point: an actor that runs but whose result cannot
  // move the claim must not make continuation promise a verification slice.
  // (Today every READY route has an executor, so this is asserted on a
  // synthetic registry — exactly how P6's funding route will arrive.)
  const noExecutor: ClaimDefinition[] = CLAIM_REGISTRY.map((c) => c.claim !== "business_model" ? c : {
    ...c,
    routes: [{
      actor: "firecrawl", capability: "web_evidence", purpose: "first-party pages",
      evidence_actors: ["firecrawl", "company_website"],
      canonical_executor: false, executor_note: "runs, but nothing turns its result into a claim",
    }],
  });
  const graph = buildCompanyEvidenceGraph("k", companyEvidenceItems(company(), "task"), { now: new Date(NOW) });
  const [gap] = evidenceGapsFor(
    [{ criterion_id: "industry:b2b_saas", dimension: "industry", result: "unknown", reason: "x" }],
    graph, noExecutor);
  assertEquals(gap.next, "blocked");
  assertEquals(gap.considered[0].executable, false);
  assertEquals(summarizeGaps([{ gaps: [gap] }]).with_executable_route, 0);
});

// ── IDENTITY, PERSISTENCE, NO DOUBLE COUNTING ───────────────────────────────

Deno.test("Phase C: re-grounding replaces the claim under its stable id — never two business models", () => {
  const c = company();
  applyRegroundedVerification(c, verification({ quote: "An agentic data intake platform for financial firms." }), "task", NOW);
  assertEquals(c.observations!.length, 1);
  const firstId = c.observations![0].observation_id;

  // The pages arrive and the second reading proves it.
  const second = applyRegroundedVerification(c, verification(), "task", "2026-09-19T13:00:00.000Z");
  assertEquals(c.observations!.length, 1, "the observation is replaced, not appended");
  assertEquals(c.observations![0].observation_id, firstId, "the same source keeps the same id");
  assertEquals(second.item!.evidence_id, `grd_${c.key}_business_model`);

  // The live item and the persisted observation are the SAME claim under the
  // same id — the graph holds one, and a restore cannot resurrect the old one.
  const bmIds = new Set(companyEvidenceItems(c, "task").filter((e) => e.dimension === "business_model").map((e) => e.evidence_id));
  assertEquals(bmIds.size, 1, "one claim, not one per reading");
  const graph = buildCompanyEvidenceGraph(c.key, companyEvidenceItems(c, "task"), { now: new Date(NOW) });
  const claim = graph.claims.find((x) => x.dimension === "business_model")!;
  assertEquals(claim.current!.status, "proven", "the NEWEST reading speaks for the claim");
});

Deno.test("Phase C: a re-grounded claim survives checkpoint and restore", () => {
  const c = company();
  applyRegroundedVerification(c, verification(), "task", NOW);
  const persisted = JSON.parse(JSON.stringify({
    [CHECKPOINT_RESULT_KEY]: { version: RESUME_STATE_VERSION, companies: [toResumeRecord(c)] },
  }));
  const restored = restoreWorkingSet(readCheckpointCompanies(persisted));
  assertEquals(restored.length, 1);
  const items = companyEvidenceItems(restored[0], "task").filter((e) => e.dimension === "business_model");
  assertEquals(new Set(items.map((e) => e.evidence_id)).size, 1);
  assertEquals(items[0].status, "proven", "a restored slice does not have to buy or re-read it");
  assertEquals(items[0].source.actor, "grounded_evidence_evaluation");
  assert((items[0].assessment as { business_model_decision?: string }).business_model_decision === "accepted");
});

// ── THE ROUTER AND CONTINUATION ─────────────────────────────────────────────

Deno.test("Phase C: the business-model gap now names an EXECUTABLE route, and continuation verifies before widening", () => {
  const firecrawl = CLAIM_REGISTRY.find((d) => d.claim === "business_model")!
    .routes.find((r) => r.actor === "firecrawl")!;
  assertEquals(firecrawl.canonical_executor, true, "Phase C gave Firecrawl a canonical executor");

  // A company whose LinkedIn details were already bought and whose pages were
  // not: Firecrawl is the untried, executable route.
  const graph = buildCompanyEvidenceGraph("k", companyEvidenceItems(company(), "task"), { now: new Date(NOW) });
  const gaps = evidenceGapsFor(
    [{ criterion_id: "industry:b2b_saas", dimension: "industry", result: "unknown", reason: "business model is not established" }],
    graph);
  assertEquals(gaps[0].next, "verify");
  assertEquals(gaps[0].route?.actor, "firecrawl");
  const summary = summarizeGaps([{ gaps }]);
  assertEquals([summary.pending, summary.with_executable_route, summary.blocked], [1, 1, 0]);

  // …and continuation spends the slice on verification, not another job page.
  const base = {
    qualified: 0, requestedCount: 1, frontierRemaining: 0, discoveryRoutesRemain: true,
    continuationsUsed: 1, maxContinuations: 5, costUnitsUsed: 1, maxCostUnits: 100,
  };
  const verify = decideAutoContinuation({ ...base, verificationRoutesRemain: summary.with_executable_route } as never);
  assertEquals([verify.continue, verify.reason], [true, "verification_required"]);
  const widen = decideAutoContinuation({ ...base, verificationRoutesRemain: 0 } as never);
  assertEquals(widen.reason, "replenishment_required", "with nothing verifiable it may widen — as before");
});

Deno.test("Phase C: pages already bought are not bought again — the gap is blocked, honestly", () => {
  const withPages = company({ pages: ["https://dioptra.ai/product", "https://dioptra.ai/pricing"] });
  applyRegroundedVerification(withPages, verification({ quote: "An agentic data intake platform for financial firms." }), "task", NOW);
  const graph = buildCompanyEvidenceGraph(withPages.key, companyEvidenceItems(withPages, "task"), { now: new Date(NOW) });
  const gaps = evidenceGapsFor(
    [{ criterion_id: "industry:b2b_saas", dimension: "industry", result: "unknown", reason: "the quote does not state saas delivery" }],
    graph);
  assertEquals(gaps[0].next, "blocked");
  const why = gaps[0].considered.find((r) => r.actor === "firecrawl")!.why;
  assert(/already answered/.test(why), why);
});
