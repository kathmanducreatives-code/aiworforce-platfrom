// LEAD V2 REPLAY LAB — STATE AT AN INSTANT.
//
// Production persists a lineage's state at the end of each slice, not at every
// instant. A checkpoint replay needs the state AT the decision under test, so
// it is rebuilt from what was persisted:
//
//   ledger      every reservation whose call row was written before the
//               instant — the reservation objects themselves, unmodified
//   companies   the checkpoint's own resume records (trimmed to the instant in
//               the fixture), rehydrated by the PRODUCTION `restoreWorkingSet`
//
// The fixture's anchors (per-company spend production logged at that instant)
// are checked against the rebuilt ledger before anything else is asserted.

import { newSpendLedger, spendTotals, type SpendLedger } from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { restoreWorkingSet, type EngineCompany } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import type { ReplayFixture } from "./fixture.ts";

/**
 * The mission ledger exactly as it stood at `at` (strictly before). A
 * reservation settled AFTER the instant still held its provisional figure then:
 * its settlement is undone (Canary 8: Delta Lake's Atomus batch read $0.0211
 * at the decision and settled at $0.0176 seconds later — production logged the
 * $0.0211 reading).
 */
export function ledgerAt(fx: ReplayFixture, at: string): SpendLedger {
  const l = newSpendLedger(structuredClone(fx.ceilings));
  const t = Date.parse(at);
  for (const { at: when, settled_at, r } of fx.ledger_reservations) {
    if (Date.parse(when) >= t) continue;
    const res = structuredClone(r);
    if (settled_at && Date.parse(settled_at) >= t && res.status === "settled") {
      res.status = "executed"; res.settled_usd = null; res.settlement_source = null; res.variance_usd = null;
    }
    l.reservations.push(res);
  }
  return l;
}

/** The working set at a checkpoint, through the production rehydration. */
export function companiesAt(fx: ReplayFixture, checkpoint: string): EngineCompany[] {
  const cp = fx.checkpoints[checkpoint];
  if (!cp) throw new Error(`fixture ${fx.fixture} has no checkpoint ${checkpoint}`);
  return restoreWorkingSet(structuredClone(cp.companies));
}

/** Per-company evidence spend the ledger holds — the figure `reserve` checks. */
export function spentByCompany(l: SpendLedger): Record<string, number> {
  return spendTotals(l).by_candidate;
}
