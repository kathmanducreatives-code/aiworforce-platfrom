// The two outcomes of an asynchronous Apify run that are NOT a plain error (V5 Phase C).
// Dependency-free on purpose: every step module (canonical, signals, discovery, website pages)
// imports these, and apifyRuns.ts imports those modules' prices — a cycle otherwise.

/** The charge state a failed run's receipt reached (apifyRuns.ts `ChargeState`). */
type ChargeState = "estimated" | "reserved" | "provider_reported" | "settled" | "unknown";

/** Thrown when a run outlives this request: the next request with the same plan adopts it. */
export class RunPending extends Error {
  override name = "RunPending";
  constructor(readonly actorKey: string, readonly runId: string | null, readonly status: string, readonly reservedUsd: number) {
    super(runId ? `${actorKey} run ${runId} is still ${status}; it will be adopted by the next request` : `${actorKey} is being started by another request`);
  }
}

/** A run that ended FAILED / ABORTED / TIMED-OUT. Its receipt was still read (it may have billed). */
export class RunFailed extends Error {
  override name = "RunFailed";
  constructor(readonly actorKey: string, readonly runId: string, readonly status: string, readonly chargedUsd: number | null, readonly charge: ChargeState) {
    super(`${actorKey} run ${runId} ended ${status}`);
  }
}

/** For a step's catch: a run still going is not a failure — it propagates to the request (202). */
export function rethrowPending(e: unknown): void {
  if (e instanceof RunPending) throw e;
}

/** What a failed step cost: the run's own receipt when it was read, else its worst case. */
export const failedChargeUsd = (e: unknown, worstUsd: number): number =>
  e instanceof RunFailed && e.chargedUsd !== null && e.charge !== "unknown" ? e.chargedUsd : worstUsd;
