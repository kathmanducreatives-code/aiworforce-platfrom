// Run-once protection for the LIVE benchmark.
//
// A LIVE run spends real money and pulls real provider data. It must happen at
// most once per run id. This module makes the decision purely from the observed
// lock state (a small JSON record persisted next to the run's artifacts), so it
// is deterministically testable without a filesystem.

export interface RunLockRecord {
  runId: string;
  mode: "live";
  startedAt: string;
  finishedAt: string | null;
  /** Set when the run reached a terminal state (success OR recorded failure). */
  terminal: boolean;
}

export type LiveRunDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Decide whether a LIVE run for `runId` may start given the existing lock (or
 * null when none exists). A second live attempt is refused whether the prior
 * attempt succeeded OR failed — partial failures are preserved and NOT retried
 * automatically (section 14).
 */
export function decideLiveRun(runId: string, existing: RunLockRecord | null): LiveRunDecision {
  if (!existing) return { allowed: true };
  if (existing.runId !== runId) return { allowed: true };
  if (existing.terminal) {
    return {
      allowed: false,
      reason: `A LIVE run for '${runId}' already completed (terminal) — replay the cached data instead of re-running Apify.`,
    };
  }
  return {
    allowed: false,
    reason: `A LIVE run for '${runId}' is already in progress or ended without a terminal record — refusing to start a second paid run.`,
  };
}

export function newLockRecord(runId: string, startedAt: string): RunLockRecord {
  return { runId, mode: "live", startedAt, finishedAt: null, terminal: false };
}

export function markTerminal(rec: RunLockRecord, finishedAt: string): RunLockRecord {
  return { ...rec, finishedAt, terminal: true };
}
