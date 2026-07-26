// MONOTONIC EXECUTION DEADLINE.
//
// The quota controller bounded rounds, provider calls and money — but not TIME.
// One company-first round costs ~120-140s, so the second round always ran past
// Supabase's ~150s edge wall-clock limit and the isolate was killed mid-flight.
//
// This budget sits BELOW the platform limit and reserves a finalization window, so
// the runtime always gets to checkpoint, update the task and answer.

export interface ExecutionBudget {
  /** Stop SCHEDULING new work after this many ms. */
  softStopMs: number;
  /** Never begin anything that cannot finish before this. */
  hardStopMs: number;
  /** Reserved for checkpoint + task update + response. */
  finalizeReserveMs: number;
  /** Conservative per-operation estimates used by `canAfford`. */
  estimates: { jobsCallMs: number; peopleCallMs: number; plannerCallMs: number; persistencePhaseMs: number };
}

export const DEFAULT_EXECUTION_BUDGET: ExecutionBudget = {
  softStopMs: 105_000,          // stop scheduling ~105s in
  hardStopMs: 115_000,          // absolute ceiling for starting work
  finalizeReserveMs: 30_000,    // >= 30s reserved to checkpoint and respond
  estimates: { jobsCallMs: 40_000, peopleCallMs: 20_000, plannerCallMs: 9_000, persistencePhaseMs: 8_000 },
};

export type DeadlineOp = "jobs" | "people" | "planner" | "persistence";

export interface ExecutionDeadline {
  elapsedMs(): number;
  remainingMs(): number;
  /** True once new work must stop being scheduled. */
  softExpired(): boolean;
  /** True when even a short operation cannot safely start. */
  hardExpired(): boolean;
  /** Can this specific operation finish inside the remaining safe window? */
  canAfford(op: DeadlineOp): boolean;
  budget: ExecutionBudget;
}

/**
 * `now` is injectable so tests can simulate a platform kill deterministically
 * without sleeping. Defaults to a monotonic clock.
 */
export function createExecutionDeadline(
  budget: Partial<ExecutionBudget> = {},
  now: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
): ExecutionDeadline {
  const b: ExecutionBudget = {
    ...DEFAULT_EXECUTION_BUDGET, ...budget,
    estimates: { ...DEFAULT_EXECUTION_BUDGET.estimates, ...(budget.estimates ?? {}) },
  };
  const started = now();
  const elapsed = () => now() - started;

  const costOf = (op: DeadlineOp): number =>
    op === "jobs" ? b.estimates.jobsCallMs
      : op === "people" ? b.estimates.peopleCallMs
        : op === "planner" ? b.estimates.plannerCallMs
          : b.estimates.persistencePhaseMs;

  return {
    budget: b,
    elapsedMs: elapsed,
    remainingMs: () => Math.max(0, b.hardStopMs - elapsed()),
    softExpired: () => elapsed() >= b.softStopMs,
    hardExpired: () => elapsed() >= b.hardStopMs,
    canAfford(op) {
      // Persistence is the finalization phase — it may use the reserve.
      if (op === "persistence") return elapsed() + costOf(op) <= b.hardStopMs + b.finalizeReserveMs;
      return !this.softExpired() && elapsed() + costOf(op) <= b.softStopMs;
    },
  };
}
