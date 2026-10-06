// LEAD V2 QUALITY REGRESSIONS — BUDGET BOUNDARIES (V*) AND CONTINUATION (W*, RC16).
//
// Production ledger (`budgetPolicy.ts`) and continuation (`leadAutoContinuation.ts`)
// functions, called directly. Moved from the quality run's scratchpad probes
// (2026-10-06). W09 (RC16) fails on code with the root cause; the rest passed in
// the run and are kept as guards.
//
// Not encoded (QUESTIONABLE in the run, no agreed expected behaviour): V10 (one
// over-ceiling company refuses a whole batch) and V15 (a dearer settlement leaves
// a company over its ceiling with no overrun flag).
//
// Pure.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  candidateCeilingRefusal, DEFAULT_CEILINGS, markExecuted, newSpendLedger, reserve, settle, spendTotals,
  type Ceilings, type SpendLedger,
} from "../../supabase/functions/_shared/budgetPolicy.ts";
import { decideAutoContinuation, settleV2Outcome } from "../../supabase/functions/_shared/leadAutoContinuation.ts";
import { qcase } from "./lib/cases.ts";

function ledgerWith(spent: Array<[string, number]>, ceil: Partial<Ceilings> = {}): SpendLedger {
  const l = newSpendLedger({ ...structuredClone(DEFAULT_CEILINGS), ...ceil } as Ceilings);
  spent.forEach(([k, usd], i) => {
    const r = reserve(l, { idempotency_key: `k${i}`, provider_call_id: `p${i}`, purpose: "funding_evidence", route_id: null, candidate_keys: [k], estimate_usd: usd } as never);
    if (!r.ok) throw new Error(`setup refused ${usd}`);
    markExecuted(l, `k${i}`, usd);
  });
  return l;
}
const hire = (l: SpendLedger, est: number, keys = ["A"], key = "h") =>
  reserve(l, { idempotency_key: key, provider_call_id: key, purpose: "hiring_evidence", route_id: null, candidate_keys: keys, estimate_usd: est } as never);

// ══ V — PER-COMPANY, MISSION AND CREDIT CEILINGS (guards) ═══════════════════

for (const [id, label, spent, est, ok] of [
  ["V01", "$0.00 + $0.035", [], 0.035, true],
  ["V02", "$0.0098 + $0.049 = $0.0588", [["A", 0.0098]], 0.049, true],
  ["V03", "$0.011 + $0.049 = exactly $0.06", [["A", 0.011]], 0.049, true],
  ["V04", "$0.0111 + $0.049 = $0.0601", [["A", 0.0111]], 0.049, false],
  ["V05", "$0.0235 + $0.035 = $0.0585", [["A", 0.0235]], 0.035, true],
  ["V06", "$0.0235 + $0.049 = $0.0725 (Canary 8 Delta / Actioneer)", [["A", 0.0235]], 0.049, false],
  ["V07", "$0.0236 + $0.035 = $0.0586", [["A", 0.0236]], 0.035, true],
  ["V08", "$0.025 + $0.035 = exactly $0.06", [["A", 0.025]], 0.035, true],
  ["V09", "batch of 5, A at $0.05, share $0.0098 → $0.0598", [["A", 0.03], ["A", 0.02]], 0.049, true],
] as const) {
  Deno.test(qcase({
    id, rc: "V", boundary: "pure", query: `per-company $0.06 ceiling: ${label}`,
    current: `${ok ? "affordable" : "refused (candidate)"} — gate and reserve agree (correct in the run)`,
    expected: `${ok ? "affordable" : "refused by the candidate ceiling"}; the pre-purchase gate and reserve give the same answer`,
  }), () => {
    const l = ledgerWith(spent as unknown as Array<[string, number]>);
    const keys = id === "V09" ? ["A", "B", "C", "D", "E"] : ["A"];
    const gate = candidateCeilingRefusal(l, { purpose: "hiring_evidence", candidate_keys: keys, estimate_usd: est });
    const r = hire(l, est, keys);
    assertEquals(gate === null, ok, `gate: ${JSON.stringify(gate)}`);
    assertEquals(r.ok, ok);
    if (!r.ok) assertEquals(r.ceiling, "candidate");
  });
}

Deno.test(qcase({
  id: "V11", rc: "V", boundary: "pure", query: "mission cap $0.05: $0.001 + $0.049 = exactly the cap",
  current: "affordable (correct in the run)", expected: "affordable — equality fits",
}), () => assert(hire(ledgerWith([["A", 0.001]], { mission_provider_usd: 0.05 }), 0.049).ok));

Deno.test(qcase({
  id: "V12", rc: "V", boundary: "pure", query: "mission cap $0.05: $0.0011 + $0.049",
  current: "refused by the mission ceiling (correct in the run)", expected: "refused by the mission ceiling",
}), () => {
  const r = hire(ledgerWith([["A", 0.0011]], { mission_provider_usd: 0.05 }), 0.049, ["B"]);
  assert(!r.ok && r.ceiling === "mission");
});

Deno.test(qcase({
  id: "V13", rc: "V", boundary: "pure", query: "mission_credits 3 with 3 paid calls, a 4th requested",
  current: "refused by mission_credits (correct in the run)", expected: "refused by mission_credits",
}), () => {
  const r = hire(ledgerWith([["A", 0.001], ["B", 0.001], ["C", 0.001]], { mission_credits: 3 }), 0.01, ["D"]);
  assert(!r.ok && r.ceiling === "mission_credits");
});

Deno.test(qcase({
  id: "V14", rc: "V", boundary: "pure", query: "a $0.049 job search settles at $0.019; then a $0.0201 funding call for the same company",
  current: "company spend $0.019; the funding call is affordable (correct in the run)",
  expected: "the cheaper settlement frees headroom: spend reads $0.019 and the next call fits",
}), () => {
  const l = ledgerWith([]);
  hire(l, 0.049, ["A"], "h1"); markExecuted(l, "h1", 0.049); settle(l, "h1", 0.019);
  assertEquals(spendTotals(l).by_candidate.A, 0.019);
  assert(reserve(l, { idempotency_key: "f", provider_call_id: "f", purpose: "funding_evidence", route_id: null, candidate_keys: ["A"], estimate_usd: 0.0201 } as never).ok);
});

Deno.test(qcase({
  id: "V16", rc: "V", boundary: "pure", query: "$0.0098 spent + a $0.0502 job search (= $0.06 per company, over the $0.05 hiring per-call ceiling)",
  current: "refused by the per-call ceiling (correct in the run)", expected: "refused by the per-call ceiling",
}), () => {
  const r = hire(ledgerWith([["A", 0.0098]]), 0.0502);
  assert(!r.ok && r.ceiling === "call");
});

// ══ W — CONTINUATION ════════════════════════════════════════════════════════

const BASE = {
  qualified: 0, requestedCount: 5, frontierRemaining: 0, continuationsUsed: 0, maxContinuations: 10, costUnitsUsed: 5,
  maxCostUnits: 40, barrenSlices: 0, discoveryRoutesRemain: true, verificationRoutesRemain: 0, pendingRuns: 0, providerFailed: false,
};
const decide = (over: Partial<typeof BASE>) => {
  const i = { ...BASE, ...over };
  const d = decideAutoContinuation(i);
  const o = settleV2Outcome({
    continuing: d.continue, stopReason: String(d.reason), legacyStatus: "partial",
    legacyQuota: { eligible_leads: i.qualified, requested_leads: i.requestedCount }, canonicalQualified: i.qualified,
    requestedCount: i.requestedCount, companyIsDeliverable: true,
  });
  return { d, terminal: d.continue ? null : o.terminal };
};

Deno.test(qcase({
  id: "W09", rc: "RC16", boundary: "pure",
  query: "a slice ended on a provider failure (providerFailed: true), 0 of 5 qualified, discovery routes remain",
  current: "continue: replenishment_required — the replenishment branch runs before the provider-failure stop, so an outage keeps buying slices until two are barren",
  expected: "stop with provider_failure (frontier preserved); no further slice is dispatched",
}), () => {
  const { d } = decide({ providerFailed: true });
  assertEquals([d.continue, d.reason], [false, "provider_failure"]);
});

for (const [id, label, over, expect] of [
  ["W01", "qualified == requested", { qualified: 5 }, { continue: false, reason: "quota_met", terminal: "completed" }],
  ["W02", "qualified > requested", { qualified: 7 }, { continue: false, reason: "quota_met", terminal: "completed" }],
  ["W03", "cost units at the 40-unit cap", { costUnitsUsed: 40 }, { continue: false, reason: "cost_ceiling", terminal: "budget_exhausted" }],
  ["W05", "max continuations reached", { continuationsUsed: 10 }, { continue: false, reason: "continuation_ceiling", terminal: "budget_exhausted" }],
  ["W06", "two barren slices", { barrenSlices: 2 }, { continue: false, reason: "no_progress", terminal: "search_exhausted" }],
  ["W07", "verification routes remain, frontier empty", { verificationRoutesRemain: 2, discoveryRoutesRemain: false }, { continue: true, reason: "verification_required", terminal: null }],
  ["W08", "a provider run is still executing", { pendingRuns: 1, discoveryRoutesRemain: false }, { continue: true, reason: "awaiting_provider_run", terminal: null }],
  ["W11", "nothing left anywhere", { discoveryRoutesRemain: false }, { continue: false, reason: "frontier_exhausted", terminal: "search_exhausted" }],
  ["W13", "verification routes remain but the cost cap is hit", { verificationRoutesRemain: 2, costUnitsUsed: 40 }, { continue: false, reason: "cost_ceiling", terminal: "budget_exhausted" }],
] as const) {
  Deno.test(qcase({
    id, rc: "W", boundary: "pure", query: `continuation: ${label}`,
    current: `${expect.reason} (correct in the run)`, expected: `${expect.continue ? "continue" : "stop"}: ${expect.reason}${expect.terminal ? ` → ${expect.terminal}` : ""}`,
  }), () => {
    const { d, terminal } = decide(over as Partial<typeof BASE>);
    assertEquals({ continue: d.continue, reason: d.reason, terminal }, expect);
  });
}
