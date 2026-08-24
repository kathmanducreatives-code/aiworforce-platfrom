// WHICH WORKFLOW PRODUCED A SIGNAL EVENT.
//
// `signal_events` is the canonical store for two independent producers: Lead
// missions, which find signals as a by-product of sourcing, and Signals
// monitoring, which goes looking for them. Once both write here, a row with no
// stated origin is unattributable — you cannot tell whether the feed is showing
// intelligence Signals collected or leftovers from a Lead run.
//
// That distinction is the whole point of the convergence. A Signals feed that
// silently consists of Lead by-products looks identical to a working one for
// any workspace that has run leads, and it is the failure this vocabulary
// exists to make visible.
//
// Mirrored by the `signal_events_origin_valid` CHECK constraint. The two lists
// are pinned equal by test — a value legal here and rejected by the database
// would fail every write at run time, and a value legal there and unknown here
// would be unreadable.

export const SIGNAL_ORIGINS = [
  /** A Lead mission produced this while sourcing. Not monitoring output. */
  "lead_mission",
  /** A recurring monitoring run on a schedule. */
  "scheduled_monitor",
  /** A person pressed scan. */
  "manual_scan",
  /** Monitoring of a company the workspace follows. */
  "tracked_company",
  /** Monitoring of a named competitor. */
  "competitor_monitor",
] as const;

export type SignalOrigin = typeof SIGNAL_ORIGINS[number];

export const SIGNAL_ORIGIN_SET: ReadonlySet<string> = new Set(SIGNAL_ORIGINS);

export function isSignalOrigin(value: unknown): value is SignalOrigin {
  return typeof value === "string" && SIGNAL_ORIGIN_SET.has(value);
}
