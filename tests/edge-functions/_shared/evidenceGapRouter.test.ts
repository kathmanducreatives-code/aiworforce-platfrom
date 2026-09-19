// LEAD V2 — EVIDENCE GAPS CHOOSE THE NEXT ROUTE; "0 QUALIFIED" IS NOT "BUY ANOTHER PAGE".
//
// The plan's own example (§7): LanceDB is US / headcount / hiring / first-hire
// PASS and PENDING only on funding stage. The next action is funding-stage
// verification — never LinkedIn Jobs page 3. These pin:
//
//   - every hard criterion dimension maps to a registered claim;
//   - a route counts only when READY, untried for the company, AND the engine
//     can turn its result into a canonical decision — a READY actor whose pages
//     cannot move the claim is a capability gap, not a verification slice;
//   - continuation verifies before it widens discovery, and only then.
//
// PURE.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CLAIM_REGISTRY, claimFor, evidenceGapsFor, summarizeGaps, type ClaimDefinition,
} from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { decideAutoContinuation } from "../../../supabase/functions/_shared/leadAutoContinuation.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { mergeCompanyBrainIntoMission } from "../../../supabase/functions/_shared/leadMission.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";

const NOW = new Date("2026-09-19T12:00:00.000Z");
const item = (dimension: EvidenceItem["dimension"], value: unknown, actor: string): EvidenceItem => ({
  evidence_id: `${dimension}_${actor}`, company_key: "lancedb", dimension, value, status: "proven",
  source: { provider: "apify", actor, provider_call_id: "pc", url: null, excerpt: null },
  method: "provider_field", observed_at: NOW.toISOString(), valid_until: null, confidence: "high",
  derived_from: [], mission_id: "t", origin: "lead_mission",
});
/** LanceDB after LinkedIn details and the job search: everything but the stage and the business model. */
const LANCEDB = buildCompanyEvidenceGraph("lancedb", [
  item("geography", "San Francisco, CA, United States", "linkedin"),
  item("headcount", 40, "linkedin"),
  item("hiring", true, "apify_linkedin_job_search"),
], { now: NOW });
const unknown = (dimension: string) => ({ criterion_id: `${dimension}:x`, dimension, result: "unknown", reason: `${dimension} is not established` });

Deno.test("every hard criterion the canonical mission derives maps to a registered claim", () => {
  const mission = mergeCompanyBrainIntoMission(compileLeadMission({
    originalUserQuery: "Find 1 seed-stage B2B SaaS startup in the US hiring its first growth marketer.",
    proposal: {
      requested_opportunity_count: 1, requested_contact_ready_count: null, company_types: ["B2B SaaS"],
      geographies: ["United States"], geography_is_hard: true, employee_range: { min: null, max: null },
      decision_maker_roles: [], hard_constraints: [], soft_preferences: [], preferred_signals: ["hiring growth marketer"],
      required_signal_terms: ["growth marketer"], adjacent_signals: [], excluded_signals: [],
      allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
      disallowed_broadening: [], required_evidence: [], required_capabilities: [], preferred_source_strategy: [],
      evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.85, unknowns: [],
    } as never,
  }).final_mission, { industries: [], employee_min: 1, employee_max: 150, employee_policy: true } as never).mission;
  for (const c of deriveMissionCriteria(mission).filter((x) => x.kind === "hard")) {
    assert(claimFor(c.dimension), `hard criterion ${c.dimension} has no registered claim`);
  }
  assertEquals(new Set(CLAIM_REGISTRY.map((c) => c.claim)).size, CLAIM_REGISTRY.length, "one record per claim");
});

Deno.test("a route an actor already answered for this company is not taken again", () => {
  // RemoteHunter, canary 9b1b70a2: LinkedIn details returned a headcount and no HQ.
  const [g] = evidenceGapsFor([unknown("geography")], LANCEDB);
  assertEquals(g.next, "blocked");
  assertEquals(g.considered.map((r) => [r.actor, r.tried]), [["apify_linkedin_company_details", true]]);
});

Deno.test("business model: Firecrawl is the executable route — PHASE C gave it a canonical executor", () => {
  // Was `blocked` with "not re-grounded yet": the pages fed only the legacy
  // evidence debt. `webEvidenceRegrounding` rebuilds the registry with them,
  // re-runs the grounder and re-decides the claim, so the route can now close
  // the gap it is chosen for. LinkedIn details has already answered for this
  // company, which is why Firecrawl is the one left to try.
  const [g] = evidenceGapsFor([unknown("industry")], LANCEDB);
  assertEquals(g.claim, "business_model");
  assertEquals(g.next, "verify");
  assertEquals(g.route?.actor, "firecrawl");
  const web = g.considered.find((r) => r.actor === "firecrawl")!;
  assertEquals([web.readiness, web.tried, web.executable], ["READY", false, true]);
  assert(web.why === "ready", web.why);
});

Deno.test("business model: once the pages are in the registry, the route is tried and the gap is blocked again", () => {
  // No new evidence to buy — the honest state after a re-grounding that could
  // not settle the claim. It must not re-buy the same pages every slice.
  const withPages = buildCompanyEvidenceGraph("lancedb", [
    item("geography", "San Francisco, CA, United States", "linkedin"),
    item("web_claim", "A platform for financial firms.", "company_website"),
  ], { now: NOW });
  const [g] = evidenceGapsFor([unknown("industry")], withPages);
  assertEquals(g.next, "blocked");
  assert(g.considered.find((r) => r.actor === "firecrawl")!.why.includes("already answered"));
});

Deno.test("funding stage: no READY route exists — a capability gap deferred to P6, never guessed", () => {
  const [g] = evidenceGapsFor([unknown("company_stage")], LANCEDB);
  assertEquals([g.claim, g.next], ["funding_stage", "blocked"]);
  assertEquals(g.considered[0].readiness, "CARDED_BUT_NOT_LIVE");
  const s = summarizeGaps([{ gaps: [g] }]);
  assertEquals([s.pending, s.with_executable_route, s.blocked], [1, 0, 1]);
  assertEquals(s.capability_gaps[0].deferred_to, "P6");
});

Deno.test("THE PLAN'S LANCEDB CASE: with an executable funding route, continuation verifies — it does not buy discovery", () => {
  // A registry in which funding stage HAS a ready, executable, untried route (what P6 delivers).
  const P6: ClaimDefinition[] = CLAIM_REGISTRY.map((c) => c.claim !== "funding_stage" ? c : {
    ...c, routes: [{
      actor: "apify_linkedin_job_search", capability: "hiring_verification", purpose: "known-company funding verification",
      evidence_actors: ["funding_verifier"], canonical_executor: true, executor_note: "P6 executor",
    }],
  });
  const gaps = evidenceGapsFor([unknown("company_stage")], LANCEDB, P6);
  assertEquals(gaps[0].next, "verify");
  const summary = summarizeGaps([{ gaps }]);
  assertEquals(summary.with_executable_route, 1);

  const base = {
    qualified: 0, requestedCount: 1, frontierRemaining: 0, discoveryRoutesRemain: true,
    continuationsUsed: 0, maxContinuations: 5, costUnitsUsed: 0, maxCostUnits: 50, barrenSlices: 0,
    providerFailed: false, pendingRuns: 0,
  };
  const verify = decideAutoContinuation({ ...base, verificationRoutesRemain: summary.with_executable_route });
  assertEquals([verify.continue, verify.reason], [true, "verification_required"], "funding verification, not LinkedIn Jobs page 3");

  // Nothing verifiable ⇒ the pool is exhausted for what can be proven, and discovery may widen.
  assertEquals(decideAutoContinuation({ ...base, verificationRoutesRemain: 0 }).reason, "replenishment_required");
  // A met request still stops first, and the ceilings still bound verification.
  assertEquals(decideAutoContinuation({ ...base, qualified: 1, verificationRoutesRemain: 3 }).reason, "quota_met");
  assertEquals(decideAutoContinuation({ ...base, continuationsUsed: 5, verificationRoutesRemain: 3 }).continue, false);
  // Unprocessed candidates come first (the plan, §23): a non-empty frontier is investigated, not verified.
  assertEquals(decideAutoContinuation({ ...base, frontierRemaining: 4, verificationRoutesRemain: 3 }).reason, "quota_unmet_frontier_remains");
});

Deno.test("an executor is not enough: a route whose actor is not READY in Actor Intelligence is never taken", () => {
  // enrich-crm/enrich-crm-funding exists on the store (verified 2026-09-19) and is NOT in Actor Intelligence.
  const unverified: ClaimDefinition[] = CLAIM_REGISTRY.map((c) => c.claim !== "funding_stage" ? c : {
    ...c, routes: [{
      actor: "enrich-crm/enrich-crm-funding", capability: "funding_verification", purpose: "known-company funding",
      evidence_actors: ["enrich_crm"], canonical_executor: true, executor_note: "would verify",
    }],
  });
  const [g] = evidenceGapsFor([unknown("company_stage")], LANCEDB, unverified);
  assertEquals([g.next, g.considered[0].readiness], ["blocked", "NOT_PRESENT"]);
});

Deno.test("PHASE C: the business model is the one canonical claim a production route can settle today", () => {
  // Was 0 — the rule was dormant. Firecrawl is now a canonical executor, so a
  // pending business model routes to verification; funding and first-in-function
  // are still blocked (P6 / the opt-in actor), and say so.
  const every = CLAIM_REGISTRY.flatMap((c) => c.criterion_dimensions).map(unknown);
  const gaps = evidenceGapsFor(every, LANCEDB);
  const s = summarizeGaps([{ gaps }]);
  assertEquals(s.with_executable_route, 1);
  const verifiable = gaps.filter((g) => g.next === "verify");
  assertEquals([...new Set(verifiable.map((g) => g.claim))], ["business_model"]);
  assertEquals([...new Set(verifiable.map((g) => g.route?.actor))], ["firecrawl"]);
  assert(s.capability_gaps.some((c) => c.claim === "funding_stage" && c.deferred_to === "P6"));
});
