// A CELL THAT DOES NOT YET HOLD ITS ANSWER — AND WHAT IT WOULD TAKE TO GET IT.
//
// Restored from `LockedCell`, which I deleted in the card refactor along with
// the whole spreadsheet. It carried one hard-won correction, kept verbatim
// below, and gains the state vocabulary the cell always needed.
//
// ── ON PRICE, WHICH IS THE POINT OF THE AFFORDANCE ──────────────────────────
//
// `LockedCell` once rendered a `~Nc` badge and an "Unlock — ~N credits"
// tooltip. It was not true, and the fix is still true today — verified against
// the repository and the live database rather than taken from the old comment:
//
//   · `unlock-founders` has ZERO callers in src/
//   · `credits_reserve` / `credits_finalize` have ZERO callers in src/
//   · `runAction` dispatches lead kinds and RETURNS before `estimateCredits`
//   · workspace_credit_balances: 0 rows. credit_transactions: 0 rows.
//
// So these actions charge nothing, and a "· 2 credits" label would be a price
// invented for the look of it. `cost` below is therefore OPTIONAL and null on
// every action wired today. When a paid path is wired, the number belongs here
// AND on the path that reserves it — never on one without the other.
// Guarded by tests/frontend/lockedCellCost.test.ts.
//
// ── AND A LOCKED CELL IS NOT AN ERROR ───────────────────────────────────────
//
// "UNAVAILABLE" / "MISSING" describe a fault. Nothing is faulty about a company
// whose research nobody has asked for yet — that is the ordinary state of every
// row when a run finishes, and it is an offer, not a failure. Only
// `unavailable` and `failed` are styled as problems, and they mean different
// things: one is configuration, the other is an attempt that ran and did not
// work.

import { Loader2, Lock, AlertTriangle, RotateCw, Coins } from 'lucide-react';
import type { UnlockState } from '@/lib/workbench/unlockState';

/**
 * What this cell can say about itself.
 *
 * Mirrors `RowDisplayStatus` on `StageAttempt` plus the two states an attempt
 * cannot describe — never asked for, and blocked by configuration.
 */
export type { UnlockState } from '@/lib/workbench/unlockState';

interface Props {
  state: UnlockState;
  /** The verb, e.g. "Find contact". Shown on the button. */
  label: string;
  onUnlock: () => void;
  /**
   * The price from `creditPricing`, which is the table the reserve uses.
   *
   * 0 renders nothing — "0 credits" reads as a price of zero rather than as no
   * charge, and free actions should look free rather than cheap. A number here
   * is a promise: it is what `authorizeProviderCall` will reserve, because the
   * executor tags the call with the same capability this price came from.
   */
  cost?: number | null;
  /** Why it cannot run. Required for `unavailable`. */
  blockedReason?: string | null;
  /** What went wrong. Shown for `failed`. */
  failureReason?: string | null;
}

export default function UnlockCell({
  state, label, onUnlock, cost = null, blockedReason, failureReason,
}: Props) {
  if (state === 'processing') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-sky-300/90">
        <Loader2 className="h-3 w-3 animate-spin" />
        Working
      </span>
    );
  }

  if (state === 'unavailable') {
    // DISTINCT FROM NOT-YET-BOUGHT. This one the user has to go and fix.
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[12px] text-[#6e7681]"
        title={blockedReason ?? undefined}
      >
        <AlertTriangle className="h-3 w-3 text-amber-400/70" />
        Setup needed
      </span>
    );
  }

  if (state === 'insufficient_credits') {
    // NOT `failed`. Nothing ran and nothing was charged, and the fix is a
    // balance rather than a retry — offering "Try again" would be wrong about
    // what happened and useless about what to do.
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[12px] text-amber-200/90"
        title="The reserve was declined, so nothing was run and nothing was charged."
      >
        <Coins className="h-3 w-3" />
        Not enough credits
      </span>
    );
  }

  if (state === 'failed') {
    return (
      <button
        onClick={onUnlock}
        title={failureReason ?? undefined}
        className="inline-flex items-center gap-1.5 text-[12px] text-amber-200/90 hover:text-amber-100 transition-colors"
      >
        <RotateCw className="h-3 w-3" />
        Try again
      </button>
    );
  }

  // NOT RESEARCHED — an offer.
  //
  // The label sits quiet until the row is hovered, so a screen of these reads
  // as blank space to be filled rather than a wall of buttons demanding to be
  // pressed. The two-line form keeps the resting state honest: it says what is
  // not known before it says what to do about it.
  return (
    <button
      onClick={onUnlock}
      className="group/cell text-left w-full min-w-0"
      // NO `title`. It duplicated the label already rendered one line below,
      // and a native tooltip is painted by the browser OUTSIDE the table — the
      // "Research company" box floating over the header in the report is this
      // attribute, not a layout fault. The three states that DO keep a title
      // carry something not otherwise on screen.
    >
      <span className="block truncate text-[12px] text-[#6e7681] group-hover/cell:text-[#8b949e] transition-colors">
        Not researched
      </span>
      <span className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-emerald-300/70 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <Lock className="h-2.5 w-2.5" />
        {label}
        {cost != null && cost > 0 && (
          <span className="text-[#6e7681]">
            · {cost} {cost === 1 ? 'credit' : 'credits'}
          </span>
        )}
      </span>
    </button>
  );
}
