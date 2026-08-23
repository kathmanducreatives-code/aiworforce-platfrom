// WHAT ONE RADAR SCAN IS ALLOWED TO SPEND.
//
// ── THE PATH THIS CLOSES ────────────────────────────────────────────────────
//
// `run-radar-scan` calls Firecrawl (and, when configured, Apify) DIRECTLY —
// not through `runTool` — so `authorizeProviderCall` never saw it. With
// enforcement live for Leads, a workspace at zero credits was blocked from
// Leads and unrestricted on Signals.
//
// ── WHY A BUDGET AND NOT JUST A RESERVE PER CALL ───────────────────────────
//
// A scan is a FAN-OUT. The 2026-08-23 scan issued ninety provider searches from
// one click. Reserving per search is correct and necessary, but on its own it
// means one click can consume ninety credits before anything checks whether that
// was reasonable. So a scan declares its ceiling UP FRONT, reserves within it,
// and stops at the ceiling rather than at the balance.
//
// The ceiling is the smaller of: what the workspace can afford, and what a
// single scan may ever spend. The second number exists so a well-funded
// workspace cannot lose its balance to one runaway fan-out.
//
// ── STOPPING IS NOT FAILING ────────────────────────────────────────────────
//
// A scan that hits its ceiling returns what it collected and says it stopped
// early. It does not error: partial market intelligence is worth having, and
// a scan that threw away its results because it ran out of budget would waste
// the credits it already spent.
//
// PURE. No network, no database — the caller supplies the balance and settles.

export const SIGNAL_SCAN_BUDGET_VERSION = "signal-scan-budget-v1" as const;

/**
 * The most any single scan may spend, whatever the balance.
 *
 * Sized from the observed fan-out: the scan that exposed this path made ninety
 * searches. Thirty keeps a scan useful — four sources at up to two stages —
 * while making a ninety-call runaway impossible from one click.
 */
export const MAX_SEARCHES_PER_SCAN = 30;

export interface ScanBudget {
  /** Hard ceiling for this scan, in searches. */
  ceiling: number;
  /** Which limit produced the ceiling — for the diagnostics, not for logic. */
  limited_by: "scan_cap" | "workspace_balance" | "unlimited";
}

export function resolveScanBudget(i: {
  balance: number | null;
  pricePerSearch: number;
  maxPerScan?: number;
}): ScanBudget {
  const cap = i.maxPerScan ?? MAX_SEARCHES_PER_SCAN;
  // A FREE SEARCH IS STILL CAPPED. If the price ever drops to zero the balance
  // stops constraining anything, and the per-scan ceiling becomes the only
  // thing standing between one click and an unbounded fan-out.
  if (i.pricePerSearch <= 0) return { ceiling: cap, limited_by: "scan_cap" };
  if (i.balance == null) return { ceiling: cap, limited_by: "unlimited" };

  const affordable = Math.floor(Math.max(0, i.balance) / i.pricePerSearch);
  return affordable < cap
    ? { ceiling: affordable, limited_by: "workspace_balance" }
    : { ceiling: cap, limited_by: "scan_cap" };
}

export interface ScanSpend {
  /** Searches authorized so far. */
  used: number;
  ceiling: number;
  limited_by: ScanBudget["limited_by"];
  /** True once the ceiling is reached. */
  exhausted: boolean;
}

/**
 * Tracks a scan against its ceiling.
 *
 * `take()` is asked BEFORE each provider call. It never blocks on the network
 * and never talks to the ledger — the caller still reserves and settles each
 * call individually. This only answers "is this scan allowed one more?".
 */
export class ScanBudgetTracker {
  private used = 0;
  constructor(private readonly budget: ScanBudget) {}

  take(): boolean {
    if (this.used >= this.budget.ceiling) return false;
    this.used++;
    return true;
  }

  get spend(): ScanSpend {
    return {
      used: this.used,
      ceiling: this.budget.ceiling,
      limited_by: this.budget.limited_by,
      exhausted: this.used >= this.budget.ceiling,
    };
  }
}
