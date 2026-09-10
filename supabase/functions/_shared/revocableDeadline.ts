// A DEADLINE THE WORKER CAN END EARLY.
//
// run-agent has no abort hook, and it does not need one: every paid boundary in
// the capability engine and the multi-round controller already asks the run's
// ExecutionDeadline whether there is room to start work, and stops to checkpoint
// when there is not. Revoking this deadline makes the answer "no room" from that
// moment on — so a worker that loses its lease, or whose mission is cancelled,
// stops starting paid calls and ends resumable through code that already exists
// and is already tested, instead of through a new cancellation path.
//
// Everything else delegates, so observed call latencies still feed the real
// estimates and an unrevoked deadline behaves exactly like the one it wraps.
//
// PURE. No clock of its own, no network.

import type {
  DeadlineOperation, ExecutionDeadline,
} from "./leadExecutionFinalizer.ts";

export interface RevocableDeadline extends ExecutionDeadline {
  /** First reason wins; later calls are no-ops. */
  revoke(reason: string): void;
  readonly revokedReason: string | null;
}

export function revocableDeadline(base: ExecutionDeadline): RevocableDeadline {
  let reason: string | null = null;
  return {
    get startedAt() { return base.startedAt; },
    get budgetMs() { return base.budgetMs; },
    get slowestCallMs() { return base.slowestCallMs; },
    elapsedMs: () => base.elapsedMs(),
    remainingMs: () => (reason ? 0 : base.remainingMs()),
    expired: (op?: DeadlineOperation) => (reason ? true : base.expired(op)),
    expiredForDurableStart: () => (reason ? true : base.expiredForDurableStart()),
    observeCall: (ms: number, op?: DeadlineOperation) => base.observeCall(ms, op),
    estimateFor: (op?: DeadlineOperation) => base.estimateFor(op),
    revoke(r: string) { if (!reason) reason = r; },
    get revokedReason() { return reason; },
  };
}
