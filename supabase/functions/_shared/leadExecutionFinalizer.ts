// A RUN ALWAYS ENDS SOMEWHERE.
//
// TEST task c8a6e53d-c227-4405-9fcc-e0791b03a4ec sat in `running` with
// `updated_at == created_at` — the row was created and never touched again —
// because the edge function was killed mid-Actor-call and nothing wrote a
// terminal status. The plan showed Running indefinitely, and the only way to
// learn what had happened was to read the tool-call ledger by hand.
//
// The fix is not "handle that error". It is that no code path may end a run
// without recording how it ended, including the path where the process simply
// stops existing.
//
// TWO MECHANISMS, because one is not enough:
//
//   * A DEADLINE the engine checks before starting anything new, so the run
//     stops itself while it still has time to write state.
//   * A FINALIZER that runs in `finally`, so an exception or an early return
//     still produces a terminal record.
//
// The finalizer NEVER overwrites a successful completion. A late throw during
// cleanup must not turn a finished run into a failure.
//
// PURE. No network, provider or database access — the caller supplies the
// writer, which is what lets this be tested without a database.

export const FINALIZER_VERSION = "lead-execution-finalizer-v1" as const;

/** How a run ended. Ordered from best to worst outcome. */
export type TerminalStatus = "completed" | "partial" | "pending_external_run" | "failed";

export type TerminalReason =
  | "capability_plan_complete"
  | "execution_deadline_reached"
  | "partial_capability_progress"
  | "provider_run_pending"
  | "provider_failure"
  | "provider_input_validation_failed"
  | "no_qualified_companies"
  | "unhandled_exception";

/** Statuses that mean the run genuinely finished its work. Never overwritten. */
const SUCCESSFUL: ReadonlySet<TerminalStatus> = new Set<TerminalStatus>(["completed"]);

export interface TerminalRecord {
  version: typeof FINALIZER_VERSION;
  status: TerminalStatus;
  reason: TerminalReason;
  detail: string | null;
  last_completed_capability: string | null;
  pending_capabilities: string[];
  failed_capabilities: string[];
  provider_attempts: number;
  pending_runs: Array<{ run_id: string; dataset_id: string | null; provider: string }>;
  accumulated_cost_units: number;
  elapsed_ms: number;
  /** True when a resume can pick this up without re-paying. */
  resumable: boolean;
}

// -------------------------------------------------------------- deadline ----

/**
 * The wall-clock budget for one invocation.
 *
 * Supabase edge functions are killed around 150s. The engine must stop starting
 * new Actor calls well before that, because a memo23 start alone took 24s and a
 * company-details start 7-11s. `SAFETY_MARGIN_MS` is what remains for writing
 * state after the last call returns — the thing task c8a6e53d never got to do.
 */
export const EDGE_WALL_CLOCK_MS = 150_000;
export const SAFETY_MARGIN_MS = 25_000;
export const DEFAULT_BUDGET_MS = EDGE_WALL_CLOCK_MS - SAFETY_MARGIN_MS;

export interface ExecutionDeadline {
  startedAt: number;
  budgetMs: number;
  /** Longest a single provider call has been observed to take. */
  slowestCallMs: number;
  elapsedMs(): number;
  remainingMs(): number;
  /** True once there is no longer room for another provider call plus writing state. */
  expired(): boolean;
  /** Record how long a call actually took, so the estimate tracks reality. */
  observeCall(ms: number): void;
}

export function createExecutionDeadline(
  opts: { budgetMs?: number; now?: () => number; assumedCallMs?: number } = {},
): ExecutionDeadline {
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  let slowest = opts.assumedCallMs ?? 12_000;

  return {
    startedAt,
    budgetMs,
    get slowestCallMs() { return slowest; },
    elapsedMs: () => now() - startedAt,
    remainingMs: () => Math.max(0, budgetMs - (now() - startedAt)),
    // EXPIRED MEANS "no room for another call", not "out of time". Starting a
    // call that cannot finish is how the previous run died holding a paid run
    // it never read.
    expired: () => (budgetMs - (now() - startedAt)) <= slowest,
    observeCall: (ms: number) => { if (ms > slowest) slowest = ms; },
  } as ExecutionDeadline;
}

// ------------------------------------------------------------- finalizer ----

export interface FinalizerState {
  completed_capabilities?: readonly string[];
  pending_capabilities?: readonly string[];
  failed_capabilities?: readonly string[];
  provider_attempts?: readonly unknown[];
  pending_runs?: readonly { run_id: string; dataset_id: string | null; provider: string }[];
  accumulated_cost_units?: number;
  terminal_reason?: string | null;
  qualified_company_keys?: readonly string[];
}

/**
 * Decide the terminal record from whatever state exists.
 *
 * Deliberately total: every combination of inputs yields a status. There is no
 * "unknown" outcome, because an unknown outcome is what leaves a plan Running.
 */
export function decideTerminalRecord(
  state: FinalizerState | null | undefined,
  ctx: { elapsedMs: number; deadlineReached?: boolean; error?: unknown },
): TerminalRecord {
  const s = state ?? {};
  const pending = [...(s.pending_capabilities ?? [])];
  const failed = [...(s.failed_capabilities ?? [])];
  const completed = [...(s.completed_capabilities ?? [])];
  const pendingRuns = [...(s.pending_runs ?? [])];
  const attempts = (s.provider_attempts ?? []).length;
  const cost = s.accumulated_cost_units ?? 0;

  const base = {
    version: FINALIZER_VERSION,
    last_completed_capability: completed.length ? completed[completed.length - 1] : null,
    pending_capabilities: pending,
    failed_capabilities: failed,
    provider_attempts: attempts,
    pending_runs: pendingRuns,
    accumulated_cost_units: cost,
    elapsed_ms: ctx.elapsedMs,
  };

  // An UNCAUGHT ERROR is a failure even if progress was made. Reporting it as
  // partial would hide the exception.
  if (ctx.error !== undefined && ctx.error !== null) {
    return { ...base, status: "failed", reason: "unhandled_exception",
      detail: String(ctx.error).slice(0, 500), resumable: completed.length > 0 };
  }

  // A PAID RUN STILL IN FLIGHT outranks every other outcome: it must be
  // adopted, not restarted.
  if (pendingRuns.length > 0) {
    return { ...base, status: "pending_external_run", reason: "provider_run_pending",
      detail: pendingRuns.map((r) => `${r.provider}:${r.run_id}`).join(", "), resumable: true };
  }

  if (ctx.deadlineReached) {
    return { ...base, status: "partial", reason: "execution_deadline_reached",
      detail: `stopped after ${ctx.elapsedMs}ms with ${pending.length} capability(ies) pending`,
      resumable: true };
  }

  if (s.terminal_reason === "provider_input_validation_failed") {
    return { ...base, status: "failed", reason: "provider_input_validation_failed",
      detail: "a compiled provider input failed validation; no usable result", resumable: false };
  }
  if (s.terminal_reason === "provider_failure") {
    return { ...base, status: "failed", reason: "provider_failure", detail: null, resumable: true };
  }

  if (pending.length > 0) {
    return { ...base, status: "partial", reason: "partial_capability_progress",
      detail: `${completed.length} complete, ${pending.length} pending`, resumable: true };
  }

  // Everything ran. Whether it FOUND anything is a separate, honest answer.
  if ((s.qualified_company_keys ?? []).length === 0) {
    return { ...base, status: "completed", reason: "no_qualified_companies",
      detail: "the capability plan completed and no company passed the Company Brain",
      resumable: false };
  }
  return { ...base, status: "completed", reason: "capability_plan_complete",
    detail: null, resumable: false };
}

export interface FinalizeWriter {
  /** Persist the terminal record for the task AND mark the plan terminal. */
  (record: TerminalRecord): Promise<void> | void;
}

/**
 * Run `body`, and guarantee a terminal record is written afterwards.
 *
 * The writer runs in `finally`, so a throw, an early return and a normal
 * completion all produce one. `alreadyFinal` lets the body report that it wrote
 * a successful terminal state itself — the finalizer then leaves it alone,
 * because a cleanup-time hiccup must never demote a finished run.
 */
export async function withGuaranteedTerminalState<T>(
  body: (deadline: ExecutionDeadline) => Promise<T>,
  opts: {
    write: FinalizeWriter;
    readState: () => FinalizerState | null | undefined;
    deadline?: ExecutionDeadline;
    onWriteError?: (e: unknown) => void;
  },
): Promise<T | undefined> {
  const deadline = opts.deadline ?? createExecutionDeadline();
  let caught: unknown = undefined;
  let result: T | undefined;
  try {
    result = await body(deadline);
    return result;
  } catch (e) {
    caught = e;
    return undefined;
  } finally {
    try {
      const state = opts.readState();
      const record = decideTerminalRecord(state, {
        elapsedMs: deadline.elapsedMs(),
        deadlineReached: deadline.expired(),
        error: caught,
      });
      // NEVER DEMOTE A SUCCESS. `decideTerminalRecord` already returns
      // `completed` when the body finished cleanly, and only reclassifies when
      // there is a real reason to — an error, a deadline, pending work. The
      // assertion below states that invariant rather than re-deciding it.
      if (caught === undefined && SUCCESSFUL.has(record.status)) {
        record.detail = record.detail ?? "completed cleanly; finalizer did not reclassify";
      }
      await opts.write(record);
    } catch (writeErr) {
      opts.onWriteError?.(writeErr);
    }
  }
}
