// HISTORICAL D — CANARY 6 (production 2026-10-04, task 3f945ff4): THE MISSION BUDGET HARD STOP.
//
// Under an operator cap of $0.10 (PR #17), three calls committed $0.0982 and
// the next six — two Pvalyou, four Firecrawl maps — were refused at the
// mission ceiling BEFORE any provider was called; the lineage stopped
// `cost_ceiling` → `budget_exhausted`. Replayed from the production ledger's
// own requests, in order, through the production cap resolution, `reserve`
// and the continuation decision.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadFixture } from "../lib/fixture.ts";
import {
  DEFAULT_CEILINGS, markExecuted, missionBudgetState, newSpendLedger, reserve, settle, spendTotals,
  type ReserveRequest,
} from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { candidateRule } from "../lib/prod.ts";
import { capCeilings, resolveMissionSpendCap } from "../../../supabase/functions/_shared/missionSpendCap.ts";
import { decideAutoContinuation, settleV2Terminal } from "../../../supabase/functions/_shared/leadAutoContinuation.ts";

const fx = loadFixture("canary6.budget-hard-stop") as ReturnType<typeof loadFixture> & {
  env: Record<string, string>;
  requests: Array<ReserveRequest & { key: string; settled_usd?: number; actor: string }>;
};
const anchors = fx.anchors as { statuses: string[]; refusals_would_commit_usd: number[]; committed_usd: number; terminal: string };

function replay() {
  const cap = resolveMissionSpendCap((k) => fx.env[k], "<workspace>");
  const ceilings = capCeilings({ ...DEFAULT_CEILINGS, per_route_usd: { ...DEFAULT_CEILINGS.per_route_usd }, per_call_usd: { ...DEFAULT_CEILINGS.per_call_usd } }, cap);
  const l = newSpendLedger(ceilings);
  const outcomes: Array<{ status: string; would?: number; previewAgrees: boolean }> = [];
  for (const q of fx.requests) {
    const req: ReserveRequest = { ...q, idempotency_key: q.key, provider_call_id: `pc_${q.key}` };
    const c = candidateRule(l, req);
    const d = reserve(l, req);
    // The shared candidate rule agrees with reserve: a candidate refusal is reserve's, and an accepted call passed it.
    const previewAgrees = d.ok ? c === null
      : d.ceiling === "candidate" ? c !== null && Math.abs(c.would_commit_usd - d.would_commit_usd) < 1e-4 : true;
    if (d.ok) {
      markExecuted(l, req.idempotency_key, req.estimate_usd);
      if (q.settled_usd != null) settle(l, req.idempotency_key, q.settled_usd);
      outcomes.push({ status: "settled", previewAgrees });
    } else {
      outcomes.push({ status: "refused_budget", would: d.would_commit_usd, previewAgrees });
    }
  }
  return { l, ceilings, outcomes };
}

Deno.test("[historical] D anchors: the production cap resolution gives exactly the ceilings the canary ran under", () => {
  const { ceilings } = replay();
  assertEquals(ceilings.mission_provider_usd, fx.ceilings.mission_provider_usd);
  assertEquals(ceilings.per_route_usd, fx.ceilings.per_route_usd);
  assertEquals(ceilings.mission_credits, fx.ceilings.mission_credits);
});

Deno.test("[historical] D the reservation that would exceed $0.10 is refused before the call — the canary's six refusals, to the cent", () => {
  const { l, outcomes } = replay();
  assertEquals(outcomes.map((o) => o.status), anchors.statuses);
  assertEquals(outcomes.filter((o) => o.would !== undefined).map((o) => o.would), anchors.refusals_would_commit_usd);
  assertAlmostEquals(spendTotals(l).mission_committed_usd, anchors.committed_usd, 1e-9);
  assert(spendTotals(l).mission_committed_usd <= fx.ceilings.mission_provider_usd + 1e-9, "never over the cap");
});

Deno.test("[budget] the shared candidate rule answers every one of the canary's requests exactly as reserve then decides", () => {
  assert(replay().outcomes.every((o) => o.previewAgrees));
});

Deno.test("[historical] D a spent mission stops cost_ceiling → budget_exhausted instead of dispatching slices that can only be refused", () => {
  const { l } = replay();
  const b = missionBudgetState(l);
  assert(b.exhausted, b.detail);
  const d = decideAutoContinuation({
    qualified: 0, requestedCount: 5, frontierRemaining: 0, continuationsUsed: 1, maxContinuations: 10,
    costUnitsUsed: 2, maxCostUnits: 40, barrenSlices: 0, discoveryRoutesRemain: true, verificationRoutesRemain: 3,
    missionBudgetExhausted: b.detail,
  });
  assertEquals(d.reason, "cost_ceiling");
  assertEquals(settleV2Terminal(String(d.reason), "partial"), anchors.terminal);
});
