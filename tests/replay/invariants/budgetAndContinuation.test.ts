// BUDGET AND CONTINUATION INVARIANTS — properties over seeded random inputs.
//
// Budget:        the shared candidate rule (`candidateCeilingRefusal`) decides
//                exactly as `reserve` then does; a
//                reservation never takes the mission past its ceiling; a key
//                already reserved is never reserved twice.
// Continuation:  no verification slice without an executable route; no slice
//                past the continuation ceiling; a spent budget stops
//                `cost_ceiling` unless a paid run is still to be adopted.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_CEILINGS, markExecuted, newSpendLedger, reserve, spendTotals, type CallPurpose,
} from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { candidateRule } from "../lib/prod.ts";
import { decideAutoContinuation } from "../../../supabase/functions/_shared/leadAutoContinuation.ts";

/** mulberry32 — deterministic, so a failure reproduces from its seed. */
function prng(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const PURPOSES: CallPurpose[] = ["discovery", "enrichment", "funding_evidence", "hiring_evidence", "web_evidence", "identity"];
const COMPANIES = ["a", "b", "c", "d", "e"].map((s) => `https://www.linkedin.com/company/${s}`);

Deno.test("[budget] 2,000 random requests: the shared candidate rule === reserve, never over the mission ceiling, never reserved twice", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = prng(seed);
    const cap = [0.05, 0.1, 0.25, 0.8, 2][Math.floor(r() * 5)];
    const l = newSpendLedger({ ...DEFAULT_CEILINGS, mission_provider_usd: cap, mission_credits: r() < 0.3 ? 5 : null });
    for (let i = 0; i < 50; i++) {
      const purpose = PURPOSES[Math.floor(r() * PURPOSES.length)];
      const keys = purpose === "discovery" ? [] : COMPANIES.filter(() => r() < 0.4);
      const key = `k${Math.floor(r() * 30)}`;
      const q = { idempotency_key: key, provider_call_id: `pc_${key}`, purpose, route_id: null, candidate_keys: keys,
        estimate_usd: Math.round(r() * 0.06 * 1e4) / 1e4 };
      const c = candidateRule(l, q);
      const before = l.reservations.filter((x) => x.idempotency_key === key && x.status !== "refused_budget" && x.status !== "released").length;
      const d = reserve(l, q);
      if (before === 0) {
        if (d.ok) assertEquals(c, null, `seed ${seed} step ${i}: reserve accepted what the candidate rule refuses`);
        else if (d.ceiling === "candidate") assert(c && Math.abs(c.would_commit_usd - d.would_commit_usd) < 1e-4, `seed ${seed} step ${i}`);
      }
      if (d.ok && before === 0) markExecuted(l, key, q.estimate_usd);
      const live = l.reservations.filter((x) => x.idempotency_key === key && x.status !== "refused_budget" && x.status !== "released");
      assert(live.length <= 1, `seed ${seed}: ${key} reserved twice`);
      assert(spendTotals(l).mission_committed_usd <= cap + 1e-9, `seed ${seed}: committed past the ceiling`);
    }
  }
});

Deno.test("[continuation] 5,000 random lineages: the decision never contradicts its inputs", () => {
  const r = prng(7);
  for (let i = 0; i < 5000; i++) {
    const n = (k: number) => Math.floor(r() * k);
    const maxContinuations = 1 + n(10);
    const i_ = {
      qualified: n(3), requestedCount: 1 + n(3), frontierRemaining: n(3), continuationsUsed: n(12), maxContinuations,
      costUnitsUsed: n(50), maxCostUnits: 40, barrenSlices: n(4), discoveryRoutesRemain: r() < 0.5,
      pendingRuns: n(2), verificationRoutesRemain: n(3), missionBudgetExhausted: r() < 0.2 ? "spent" : null,
    };
    const d = decideAutoContinuation(i_);
    const ctx = JSON.stringify(i_);
    if (d.reason === "verification_required") assert(i_.verificationRoutesRemain > 0, ctx);
    if (d.continue && d.reason !== "awaiting_provider_run") assert(i_.continuationsUsed < i_.maxContinuations, `continued past the ceiling: ${ctx}`);
    if (i_.missionBudgetExhausted && i_.pendingRuns === 0 && i_.qualified < i_.requestedCount) {
      assert(!d.continue || d.reason === "awaiting_provider_run", `a spent budget kept buying: ${ctx} → ${d.reason}`);
    }
    if (i_.qualified >= i_.requestedCount && d.continue) assert(d.reason === "awaiting_provider_run", `quota met but continued: ${ctx} → ${d.reason}`);
  }
});
