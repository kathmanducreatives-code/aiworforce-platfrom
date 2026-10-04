// A ROUTE THE LEDGER WILL REFUSE IS NOT A ROUTE.
//
// Canary 7 (production 2026-10-04, task 1303e533). LlamaIndex was the one
// pending company; its only open hard claim was hiring. It already carried
// $0.0304 of evidence spend, and one job search is $0.041 — past the $0.06
// per-company ceiling. The ledger refused the purchase on every slice
// (`budget_candidate: 0.0714 > 0.06`) while the gap router still read the
// route as READY and executable, so continuation asked for a verification
// slice, bought nothing, asked again, and ended `no_progress` after two barren
// slices.
//
// Now the verification phase asks the same question the ledger will, before
// the purchase: a company whose evidence budget cannot cover an all-or-nothing
// verifier's per-company estimate is left out of the batch, and the route is
// marked unaffordable for it — so the router, `canonicallyWorkableKeys` and
// continuation all read it as blocked.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_CEILINGS, markExecuted, newSpendLedger, reserve, settle, spendTotals, type SpendLedger,
} from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { canStillQualify, evidenceGapsFor, summarizeGaps } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import {
  unaffordableOpKey, unaffordableRoutes, verificationTargets, type VerifiableCandidate, type VerifierCall,
} from "../../../supabase/functions/_shared/claimVerifier.ts";
import {
  HIRING_ROUTE_ACTOR, hiringClaimVerifier, hiringEstimatePerTargetUsd,
} from "../../../supabase/functions/_shared/hiringClaimVerifier.ts";
import { fundingStageVerifier } from "../../../supabase/functions/_shared/fundingStageVerifier.ts";
import { runClaimVerificationPhase } from "../../../supabase/functions/_shared/claimVerificationPhase.ts";
import { markRouteUnaffordable } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";

globalThis.fetch = () => { throw new Error("hiring budget tests must not reach the network"); };

const LLAMA = "https://www.linkedin.com/company/llamaindex";
const TALENTIFY = "https://www.linkedin.com/company/talentify-io";
const HIRING_CHECK = { criterion_id: "hiring:sales", dimension: "hiring", result: "unknown", reason: "hiring is not established" };
/** The canary's role family, as the mission compiled it. */
const IO = {
  titles: ["sales", "account executive", "sdr", "bdr"], role_families: ["sales"], window_days: 30,
  matchesRole: (t: string) => /sales|account executive|sdr|bdr/i.test(t),
};

const candidate = (key: string, ops: string[] = []): VerifiableCandidate => ({
  company_key: key, name: key.replace(/^.*\/company\//, ""), domain: null, linkedin_url: key,
  graph: buildCompanyEvidenceGraph(key, [], {}), eligibility: "pending", hard_checks: [HIRING_CHECK],
  attempted_routes: [], unaffordable_routes: unaffordableRoutes(ops),
});

/** A ledger holding what the canary had bought for each company before the job search. */
function canaryLedger(spent: Record<string, number>): SpendLedger {
  const l = newSpendLedger({ ...DEFAULT_CEILINGS });
  for (const [key, usd] of Object.entries(spent)) {
    const k = `prior:${key}`;
    assert(reserve(l, { idempotency_key: k, provider_call_id: k, purpose: "funding_evidence", route_id: null,
      candidate_keys: [key], estimate_usd: usd }).ok);
    markExecuted(l, k, usd);
    settle(l, k, usd);
  }
  return l;
}

// ── THE PRODUCTION NUMBERS ───────────────────────────────────────────────────

Deno.test("REPLAY: the ledger refuses LlamaIndex's job search exactly as production did — $0.0714 > $0.06", () => {
  const estimate = hiringEstimatePerTargetUsd(IO)!;
  assertAlmostEquals(estimate, 0.041, 1e-9);
  const l = canaryLedger({ [LLAMA]: 0.0304 });
  const d = reserve(l, { idempotency_key: "job", provider_call_id: "job", purpose: "hiring_evidence", route_id: null,
    candidate_keys: [LLAMA], estimate_usd: estimate });
  assert(!d.ok);
  assertEquals([d.ceiling, d.limit_usd, d.would_commit_usd], ["candidate", 0.06, 0.0714]);
});

Deno.test("a batch's per-company share never exceeds the single-company estimate the phase checks against", async () => {
  const { hiringVerifierInput } = await import("../../../supabase/functions/_shared/hiringClaimVerifier.ts");
  const { estimateCallUsd } = await import("../../../supabase/functions/_shared/budgetPolicy.ts");
  const { hiringActorCard } = await import("../../../supabase/functions/_shared/hiringActorCatalog.ts");
  const card = hiringActorCard(HIRING_ROUTE_ACTOR)!;
  const single = hiringEstimatePerTargetUsd(IO)!;
  for (const n of [1, 2, 3, 5]) {
    const input = hiringVerifierInput(IO, Array.from({ length: n }, (_, i) => `https://www.linkedin.com/company/c${i}`))!;
    assert(estimateCallUsd(HIRING_ROUTE_ACTOR, card.cost_model, input) / n <= single + 1e-9, `batch of ${n}`);
  }
});

// ── THE ROUTER ───────────────────────────────────────────────────────────────

Deno.test("ROUTER: an unaffordable route is blocked, says why, and the candidate can no longer qualify", () => {
  const open = evidenceGapsFor([HIRING_CHECK], buildCompanyEvidenceGraph(LLAMA, [], {}));
  assertEquals([open[0].next, open[0].route?.actor], ["verify", HIRING_ROUTE_ACTOR]);
  const closed = evidenceGapsFor([HIRING_CHECK], buildCompanyEvidenceGraph(LLAMA, [], {}), undefined, new Set(),
    undefined, new Set([HIRING_ROUTE_ACTOR]));
  assertEquals(closed[0].next, "blocked");
  assertEquals(closed[0].considered[0].executable, false);
  assertEquals(closed[0].considered[0].tried, false, "not 'already answered' — nothing was bought");
  assert(closed[0].considered[0].why.includes("evidence budget"), closed[0].considered[0].why);
  assert(!canStillQualify(closed));
  // Continuation's count agrees: a verification slice has nothing it could take.
  assertEquals(summarizeGaps([{ gaps: open }]).with_executable_route, 1);
  assertEquals(summarizeGaps([{ gaps: closed }]).with_executable_route, 0);
});

Deno.test("ROUTER: the mark is per route — a company closed for job search keeps every other route", () => {
  const funding = { criterion_id: "funding:r", dimension: "funding", result: "unknown", reason: "no round" };
  const gaps = evidenceGapsFor([funding], buildCompanyEvidenceGraph(LLAMA, [], {}), undefined, new Set(),
    undefined, new Set([HIRING_ROUTE_ACTOR]));
  assertEquals(gaps[0].next, "verify");
});

// ── THE PHASE ───────────────────────────────────────────────────────────────

async function phase(ledger: SpendLedger, ops: Record<string, string[]>, keys: string[], verifier = hiringClaimVerifier(IO)) {
  const calls: VerifierCall[] = [];
  const marked: string[] = [];
  const report = await runClaimVerificationPhase({
    mission_id: "t", requested_count: 5,
    candidates: () => keys.map((k) => candidate(k, ops[k] ?? [])),
    qualified: () => 0,
    criteriaValue: () => ["sales"],
    verifiers: [verifier],
    pending: [],
    deps: {
      call: (c) => { calls.push(c); return Promise.resolve({ status: "ok", rows: [], provider_call_id: "pc" }); },
      now: () => "2026-10-04T14:36:00.000Z", log: () => {},
    },
    apply: () => false,
    evidenceBudget: (key) => ({
      spent_usd: spendTotals(ledger).by_candidate[key] ?? 0, limit_usd: ledger.ceilings.per_candidate_evidence_usd,
    }),
    markUnaffordable: (key, v) => {
      marked.push(key);
      (ops[key] ??= []).push(unaffordableOpKey(v.route_actor));
    },
  });
  return { report, calls, marked };
}

Deno.test("PHASE: LlamaIndex is left out and marked; nothing is bought for it; the report says why", async () => {
  const ledger = canaryLedger({ [LLAMA]: 0.0304 });
  const ops: Record<string, string[]> = {};
  const { report, calls, marked } = await phase(ledger, ops, [LLAMA]);
  assertEquals(calls.length, 0, "no purchase the ledger would refuse");
  assertEquals(marked, [LLAMA]);
  assertEquals(ops[LLAMA], [`unaffordable:${HIRING_ROUTE_ACTOR}`]);
  assertEquals(report.unaffordable?.length, 1);
  const u = report.unaffordable![0];
  assertEquals([u.company_key, u.limit_usd], [LLAMA, 0.06]);
  assertAlmostEquals(u.spent_usd + u.estimate_usd, 0.0714, 1e-9);
  // And next slice: the router no longer offers it, so continuation stops asking.
  const next = candidate(LLAMA, ops[LLAMA]);
  assertEquals(verificationTargets(hiringClaimVerifier(IO), [next], () => ["sales"]).length, 0);
  assertEquals(summarizeGaps([{ gaps: evidenceGapsFor(next.hard_checks, next.graph, undefined, new Set(),
    undefined, new Set(next.unaffordable_routes)) }]).with_executable_route, 0);
});

Deno.test("PHASE: one over-budget company no longer gets the whole batch refused — the others are asked", async () => {
  const ledger = canaryLedger({ [LLAMA]: 0.0304, [TALENTIFY]: 0.004 });
  const { calls, marked } = await phase(ledger, {}, [LLAMA, TALENTIFY]);
  assertEquals(marked, [LLAMA]);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].candidate_keys, [TALENTIFY]);
  // Under the real ledger that batch fits; with LlamaIndex in it, it would not.
  const est = hiringEstimatePerTargetUsd(IO)!;
  assert(reserve(ledger, { idempotency_key: "ok", provider_call_id: "ok", purpose: "hiring_evidence", route_id: null,
    candidate_keys: [TALENTIFY], estimate_usd: est }).ok);
  const both = canaryLedger({ [LLAMA]: 0.0304, [TALENTIFY]: 0.004 });
  assert(!reserve(both, { idempotency_key: "b", provider_call_id: "b", purpose: "hiring_evidence", route_id: null,
    candidate_keys: [LLAMA, TALENTIFY], estimate_usd: est * 2 }).ok, "the pre-fix batch is refused whole");
});

Deno.test("PHASE: an affordable company is bought for exactly as before, and nothing is marked", async () => {
  const ledger = canaryLedger({ [TALENTIFY]: 0.019 });
  const { report, calls, marked } = await phase(ledger, {}, [TALENTIFY]);
  assertEquals(calls.length, 1);
  assertEquals(marked, []);
  assertEquals(report.unaffordable, []);
});

Deno.test("PHASE: unaffordable companies do not take the verifier's slots", async () => {
  // Five over-budget companies sort first (same open-gap count, keys ordered); a sixth can afford it.
  const poor = ["a1", "a2", "a3", "a4", "a5"].map((s) => `https://www.linkedin.com/company/${s}`);
  const rich = "https://www.linkedin.com/company/z-rich";
  const ledger = canaryLedger({ ...Object.fromEntries(poor.map((k) => [k, 0.05])), [rich]: 0 });
  const { calls, marked } = await phase(ledger, {}, [...poor, rich]);
  assertEquals(marked.sort(), [...poor].sort());
  assertEquals(calls.map((c) => c.candidate_keys), [[rich]]);
});

Deno.test("PHASE: only an all-or-nothing verifier is pre-judged — funding is unchanged", async () => {
  assertEquals(fundingStageVerifier().all_or_nothing_per_target, undefined);
  assertEquals(hiringClaimVerifier(IO).all_or_nothing_per_target, true);
  // Without a budget reader (any caller that does not wire it), nothing is pre-judged either.
  const calls: VerifierCall[] = [];
  const report = await runClaimVerificationPhase({
    mission_id: "t", requested_count: 5, candidates: () => [candidate(LLAMA)], qualified: () => 0,
    criteriaValue: () => ["sales"], verifiers: [hiringClaimVerifier(IO)], pending: [],
    deps: { call: (c) => { calls.push(c); return Promise.resolve({ status: "refused", reason: "x" }); }, now: () => "", log: () => {} },
    apply: () => false,
  });
  assertEquals([calls.length, report.unaffordable?.length], [1, 0]);
});

// ── THE ENGINE'S MARK AND THE PRODUCTION WIRING ─────────────────────────────

Deno.test("ENGINE: the mark is idempotent and never reads as an answered route or a hiring operation", async () => {
  const { hiringEvidenceWasInspected } = await import("../../../supabase/functions/_shared/leadCapabilityEngine.ts");
  const { attemptedRoutes } = await import("../../../supabase/functions/_shared/claimVerifier.ts");
  const c = { completed_operations: [] as string[] };
  markRouteUnaffordable(c as never, { route_actor: HIRING_ROUTE_ACTOR });
  markRouteUnaffordable(c as never, { route_actor: HIRING_ROUTE_ACTOR });
  assertEquals(c.completed_operations, [`unaffordable:${HIRING_ROUTE_ACTOR}`]);
  assertEquals(unaffordableRoutes(c.completed_operations), [HIRING_ROUTE_ACTOR]);
  assertEquals(attemptedRoutes(c.completed_operations), [], "not 'already answered'");
  assertEquals(hiringEvidenceWasInspected({ hiring_assessment: null, completed_operations: c.completed_operations }), false);
});

Deno.test("WIRING: run-agent feeds the phase the ledger's per-company figures and writes the mark", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  const at = src.indexOf("const phase = await runClaimVerificationPhase({");
  assert(at > 0);
  const call = src.slice(at, src.indexOf("vState.verifier_pending_runs = phase.pending;", at));
  assert(call.includes("spendTotals(vState.spend_ledger!).by_candidate[key]"), "spent comes from the ledger");
  assert(call.includes("per_candidate_evidence_usd"), "the limit is the ledger's own ceiling");
  assert(call.includes("markRouteUnaffordable(company, verifier)"));
  assert(src.includes("unaffordable_routes: cand.unaffordable_routes ?? []"), "the candidates carry the mark");
});
