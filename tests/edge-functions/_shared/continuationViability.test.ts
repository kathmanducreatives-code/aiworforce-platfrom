// ONE VIABILITY RULE FOR THE VERIFIERS AND FOR CONTINUATION.
//
// Live canary 1156c062 (plan c92afb1a, commit 6d1c185b, 2026-09-24) bought
// company search, company details and Atomus, $0.0242, and then:
//
//   SuperAGI    funding DISPROVEN (last round 928 days ago)  → ineligible
//   How to AI   funding PENDING — Atomus found the company but no rounds and no
//               complete history, and no other route may answer
//
// The verifier phase bought nothing more, correctly: no job search and no
// Firecrawl for either. But continuation counted How to AI's open business-model
// and hiring gaps as work (`with_executable_route: 1`), re-queued it four times
// with nothing to buy, and the queue ended `failed / retry_budget_exhausted`
// instead of `search_exhausted / PARTIALLY_SATISFIED`.
//
// The replay below rebuilds both candidates from the canary's OWN observations
// (search, details, Atomus rows) and attempted routes, and runs them through the
// real eligibility, gap router, verifier targeting, continuation and outcome.
//
// THE FALLBACK THAT CAME AFTER. The canary ran before the Pvalyou recency
// fallback (2944d7d7). Today the same funding verification asks Pvalyou in the
// same call when Atomus is open, so the replay's default marks Pvalyou as having
// answered — the state How to AI would be in now. `replay({ pvalyouAnswered:
// false })` is the state exactly as recorded, which the router now sends to the
// fallback rather than blocking.
//
// Pure. No provider, model, network or database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import {
  canStillQualify, CLAIM_REGISTRY, evidenceGapsFor, summarizeGaps,
} from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { attemptedRoutes, verificationTargets } from "../../../supabase/functions/_shared/claimVerifier.ts";
import {
  decideAutoContinuation, MAX_BARREN_SLICES, settleV2Outcome,
} from "../../../supabase/functions/_shared/leadAutoContinuation.ts";
import {
  CONTINUATION_ATTEMPTS_EXHAUSTED, RETRY_BUDGET_EXHAUSTED, terminalReasonFor, V2_MAX_ATTEMPTS,
} from "../../../supabase/functions/_shared/leadMissionTerminal.ts";
import { buildRunOutcome, readFactsFromResult } from "../../../supabase/functions/_shared/runOutcome.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";

const FX = JSON.parse(Deno.readTextFileSync(new URL("../../fixtures/lead-v2/canary-1156c062/result.json", import.meta.url)));
/** The moment the verifier phase ran — evidence is judged as of the canary, not today. */
const AT = new Date("2026-09-24T15:10:30.000Z");
const CRITERIA = deriveMissionCriteria(FX.lead_mission, PRODUCTION_READINESS);
const SUPERAGI = "https://www.linkedin.com/company/superagi";
const HOWTOAI = "https://www.linkedin.com/company/how-to-ai-guide";
const PVALYOU = "apify_funding_pvalyou";

/** Each candidate, rebuilt from exactly what the canary bought (plus, by default, today's fallback). */
function replay(o: { pvalyouAnswered?: boolean } = {}) {
  return (FX.lead_resume_checkpoint.companies as Array<{
    company_key: string; company_name: string; completed_operations: string[];
    snapshot: { observations: Array<{ evidence: EvidenceItem[] }> };
  }>).map((c) => {
    const items = c.snapshot.observations.flatMap((o) => o.evidence).map((e) => ({ ...e, company_key: c.company_key }));
    const graph = buildCompanyEvidenceGraph(c.company_key, items, { now: AT });
    const e = evaluateEligibility(CRITERIA, graph);
    const attempted = [...attemptedRoutes(c.completed_operations), ...(o.pvalyouAnswered === false ? [] : [PVALYOU])];
    const hard = e.checks.filter((x) => x.kind === "hard");
    const gaps = evidenceGapsFor(hard, graph, CLAIM_REGISTRY, new Set(attempted), PRODUCTION_READINESS);
    return {
      company_key: c.company_key, name: c.company_name, domain: null, linkedin_url: c.company_key, graph,
      eligibility: e.eligibility, hard_checks: hard, attempted_routes: attempted, gaps,
    };
  });
}
const byKey = (k: string) => replay().find((c) => c.company_key === k)!;
const SLICE = FX.continuation_as_recorded.slice_1;
const decide = (verificationRoutesRemain: number, over: Record<string, unknown> = {}) => decideAutoContinuation({
  cancelled: false, qualified: SLICE.qualified, requestedCount: SLICE.requested, frontierRemaining: SLICE.frontier_remaining,
  continuationsUsed: SLICE.continuations_used, maxContinuations: 5, costUnitsUsed: SLICE.cost_units_used, maxCostUnits: 50,
  barrenSlices: SLICE.barren_slices, providerFailed: false, pendingRuns: 0,
  discoveryRoutesRemain: !FX.discovery_source_state.exhausted, verificationRoutesRemain, ...over,
} as never);

// ═════════════════════════════════════════════════════════ the recorded defect ══

Deno.test("RECORDED: continuation counted a blocked candidate as verifiable, and the queue failed", () => {
  const g = FX.workbench_mission_view_as_recorded.evidence_gaps;
  assertEquals([g.pending, g.with_executable_route, g.blocked], [1, 1, 0]);
  assert(g.capability_gaps.some((x: { claim: string }) => x.claim === "recently_funded"), "…beside a blocked funding claim");
  assertEquals([FX.continuation_as_recorded.queue, FX.continuation_as_recorded.terminal_reason], ["failed", "retry_budget_exhausted"]);
  assertEquals(FX.continuation_as_recorded.provider_calls_after_slice_1, 0, "four slices, nothing bought");
});

// ═══════════════════════════════════════════════════════════ the exact replay ══

Deno.test("REPLAY SuperAGI: funding DISPROVEN from the canary's own Atomus row → ineligible, never re-enters", () => {
  const s = byKey(SUPERAGI);
  assertEquals(s.eligibility, "ineligible");
  const funding = s.hard_checks.find((h) => h.dimension === "funding")!;
  assertEquals(funding.result, "fail");
  assert(funding.reason.includes("outside the 365-day window"), funding.reason);
  assertEquals(s.hard_checks.find((h) => h.dimension === "geography")!.result, "pass");
  assertEquals(s.hard_checks.find((h) => h.dimension === "company_size")!.result, "pass");
});

Deno.test("REPLAY How to AI: funding PENDING and BLOCKED — so its open gaps cannot move it to qualification", () => {
  const h = byKey(HOWTOAI);
  assertEquals(h.eligibility, "pending");
  const byDim = Object.fromEntries(h.gaps.map((g) => [g.dimension, g.next]));
  assertEquals(byDim.funding, "blocked", "Atomus and its Pvalyou fallback both answered; nothing else may ask");
  assertEquals([byDim.hiring, byDim.industry], ["verify", "verify"], "these alone WOULD be verifiable");
  assertFalse(canStillQualify(h.gaps), "one blocked hard claim means no purchase can make it eligible");
});

Deno.test("REPLAY: the verifier phase and continuation now read the SAME rule — neither has any work", () => {
  const all = replay();
  for (const route_actor of ["apify_linkedin_job_search", "firecrawl", "apify_funding_atomus"]) {
    assertEquals(verificationTargets({ route_actor, max_targets: 5 }, all as never,
      (id) => CRITERIA.find((c) => c.id === id)?.value, CLAIM_REGISTRY, PRODUCTION_READINESS), [], route_actor);
  }
  const summary = summarizeGaps(all.filter((c) => c.eligibility === "pending").map((c) => ({ gaps: c.gaps })));
  assertEquals([summary.pending, summary.with_executable_route, summary.blocked], [1, 0, 1]);
});

Deno.test("AS RECORDED (Atomus only): the router sends How to AI to the Pvalyou fallback, and the verifier and continuation AGREE", () => {
  const all = replay({ pvalyouAnswered: false });
  const h = all.find((c) => c.company_key === HOWTOAI)!;
  const funding = h.gaps.find((g) => g.dimension === "funding")!;
  assertEquals([funding.next, funding.route?.actor], ["verify", PVALYOU]);
  // The funding verifier is handed How to AI through its fallback route…
  const targets = verificationTargets({ route_actor: "apify_funding_atomus", route_actors: ["apify_funding_atomus", PVALYOU], max_targets: 6 },
    all as never, (id) => CRITERIA.find((c) => c.id === id)?.value, CLAIM_REGISTRY, PRODUCTION_READINESS);
  assertEquals(targets.map((t) => t.company_key), [HOWTOAI]);
  // …and continuation counts exactly that one candidate as work. One rule.
  const summary = summarizeGaps(all.filter((c) => c.eligibility === "pending").map((c) => ({ gaps: c.gaps })));
  assertEquals([summary.pending, summary.with_executable_route, summary.blocked], [1, 1, 0]);
  // In ISOLATION hiring and Firecrawl would target it too — an open gap with a
  // route does not block another verifier. What keeps them from buying before
  // funding is answered is the phase: the funding verifier runs first (cheapest),
  // its fallback's answer blocks the claim, and a fallback still running holds
  // the company (`claimVerificationPhase`). Asserted end to end in
  // fundingRecencyFallback.test.ts.
  for (const route_actor of ["apify_linkedin_job_search", "firecrawl"]) {
    assertEquals(verificationTargets({ route_actor, max_targets: 5 }, all as never,
      (id) => CRITERIA.find((c) => c.id === id)?.value, CLAIM_REGISTRY, PRODUCTION_READINESS).length, 1, route_actor);
  }
});

Deno.test("REPLAY: continuation STOPS — frontier_exhausted → search_exhausted, PARTIALLY_SATISFIED, 0/1/1", () => {
  const all = replay();
  const summary = summarizeGaps(all.filter((c) => c.eligibility === "pending").map((c) => ({ gaps: c.gaps })));
  const d = decide(summary.with_executable_route);
  assertEquals([d.continue, d.reason], [false, "frontier_exhausted"]);
  const settled = settleV2Outcome({
    continuing: d.continue, stopReason: d.reason, legacyStatus: "round_limit_reached",
    legacyQuota: { eligible_leads: 0, requested_leads: 1 }, canonicalQualified: 0, requestedCount: 1, companyIsDeliverable: true,
  });
  assertEquals(settled.terminal, "search_exhausted");
  const counts = { qualified: 0, pending: 0, ineligible: 0 };
  for (const c of all) c.eligibility === "eligible" ? counts.qualified++ : c.eligibility === "pending" ? counts.pending++ : counts.ineligible++;
  assertEquals(counts, { qualified: 0, pending: 1, ineligible: 1 });
  // The run outcome reads the canonical view, and nothing is owed.
  const outcome = buildRunOutcome({
    ...readFactsFromResult({
      terminal_status: settled.terminal,
      workbench_mission_view: { mission: FX.lead_mission, counts: FX.workbench_mission_view_as_recorded.counts },
    }, 1),
    spend: { credits_charged: 3, provider_calls: 3, usd_reported: 0.0242, unsettled_operations: 0, reused_operations: 0 },
  });
  assertEquals(outcome.state, "PARTIALLY_SATISFIED");
  assertEquals(outcome.continuation.required, false);
  assertEquals([outcome.qualification.canonical?.qualified, outcome.qualification.canonical?.pending, outcome.qualification.canonical?.ineligible], [0, 1, 1]);
});

Deno.test("OLD vs NEW: the old aggregation re-queued this exact pool; the new one cannot", () => {
  const h = byKey(HOWTOAI);
  const oldCount = h.gaps.some((g) => g.next === "verify") ? 1 : 0; // the pre-fix `with_executable_route`
  assertEquals(oldCount, 1);
  assertEquals([decide(oldCount).continue, decide(oldCount).reason], [true, "verification_required"], "what the canary did");
  assertEquals(decide(0).continue, false, "what it does now");
});

// ═════════════════════════════════════════════════ no empty retry loop, ever ══

Deno.test("NO ZERO-PURCHASE LOOP: even a stale 'verifiable' count stops after the barren-slice bound", () => {
  const d = decide(1, { barrenSlices: MAX_BARREN_SLICES });
  assertFalse(d.continue);
  assertEquals(d.reason, "frontier_exhausted");
  assert(decide(1, { barrenSlices: MAX_BARREN_SLICES - 1 }).continue, "a genuinely verifiable pool still gets its slice");
});

Deno.test("CANONICAL PENDING may stay pending: a blocked candidate is reported, never retried", () => {
  const summary = summarizeGaps([{ gaps: byKey(HOWTOAI).gaps }]);
  assertEquals(summary.blocked, 1);
  assertEquals(decide(summary.with_executable_route).continue, false);
});

Deno.test("HARD-FAILED candidates never enter continuation: an ineligible company is not in the pending pool", () => {
  const pending = replay().filter((c) => c.eligibility === "pending").map((c) => c.company_key);
  assertEquals(pending, [HOWTOAI]);
  assertFalse(pending.includes(SUPERAGI));
});

Deno.test("QUOTA_MET still wins immediately, whatever remains verifiable", () => {
  const d = decide(3, { qualified: 1 });
  assertEquals([d.continue, d.reason], [false, "quota_met"]);
});

// ═════════════════════════════════════════════════════ honest terminal reasons ══

Deno.test("TERMINAL: retry_budget_exhausted only for a failed or aborted last attempt", () => {
  const clean = { status: "continuation_required", terminal: false };
  assertEquals(terminalReasonFor(clean, V2_MAX_ATTEMPTS), CONTINUATION_ATTEMPTS_EXHAUSTED);
  assertEquals(terminalReasonFor({ ...clean, error: "provider timeout" }, V2_MAX_ATTEMPTS), RETRY_BUDGET_EXHAUSTED);
  assertEquals(terminalReasonFor({ ...clean, aborted: true }, V2_MAX_ATTEMPTS), RETRY_BUDGET_EXHAUSTED);
  // An evidence-exhausted mission is TERMINAL before attempts run out: its own status stands.
  assertEquals(terminalReasonFor({ status: "search_exhausted", terminal: true }, V2_MAX_ATTEMPTS), "search_exhausted");
  assertEquals(terminalReasonFor({ status: "search_exhausted", terminal: true }, 1), "search_exhausted");
});
