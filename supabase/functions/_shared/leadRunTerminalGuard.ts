// THE RUN-AGENT TERMINAL GUARD — where `leadExecutionFinalizer` meets the rows.
//
// `leadExecutionFinalizer` decides HOW a run ended. It deliberately knows
// nothing about tables. This module is the other half: it turns that decision
// into the exact `tasks` and `task_plans` writes that make the UI stop saying
// Running, and it wraps the real run-agent body so those writes happen on every
// exit path — including the ones nobody wrote.
//
// WHY A SEPARATE MODULE RATHER THAN CODE INSIDE run-agent/index.ts.
//
// `run-agent/index.ts` calls `Deno.serve` at import time, so nothing can import
// it to test it. A guard that lives inside it can only ever be tested by
// re-implementing it in the test — which is exactly the mistake that let the
// `user_input`/`input` transport defect pass a green suite. The wrapper lives
// here, run-agent calls it, and the tests exercise this file.
//
// THE STATUS VOCABULARY IS NOT FREE.
//
// `deriveWorkflowUiState` (src/lib/chat/state.ts) decides what the user sees,
// and it reads specific strings:
//
//   tasks.status  'complete' | 'skipped' | 'failed'  → terminal
//                 'running'  | 'pending'             → the spinner keeps turning
//                 'ready'                            → CHECKPOINTED, resumable
//   task_plans    'partial'                          → a checkpointed partial run
//
// A partial run is written as task `ready` + plan `partial` + a result that says
// `task_status: "partial"`, because `isCheckpointedPartial` requires BOTH a
// lifecycle signal and a result that actually describes partial work. Writing
// `complete` instead would claim leads that were never delivered; leaving
// `running` is the bug this module exists to remove.
//
// NEVER DEMOTE. The guard reads the CURRENT row status before writing. Every
// existing run-agent exit path already writes its own terminal status, and the
// guard must not overwrite a finished run just because it also ran. Reading the
// row is what makes that safe without instrumenting forty return sites.

import {
  createExecutionDeadline, decideTerminalRecord,
  type ExecutionDeadline, type FinalizerState, type TerminalRecord,
} from "./leadExecutionFinalizer.ts";

export const TERMINAL_GUARD_VERSION = "run-agent-terminal-guard-v1" as const;

/** Row statuses that mean the task is finished and must not be rewritten. */
export const TERMINAL_TASK_STATUSES: readonly string[] = [
  "complete", "completed", "failed", "skipped", "done", "ready",
];

/** Plan statuses that mean the plan is finished and must not be rewritten. */
export const TERMINAL_PLAN_STATUSES: readonly string[] = [
  "complete", "completed", "failed", "partial", "done",
];

export interface TerminalRowWrite {
  task_status: "complete" | "failed" | "ready";
  plan_status: "complete" | "failed" | "partial";
  /** Merged into `tasks.result`. Never replaces it. */
  result_patch: Record<string, unknown>;
  error_message: string | null;
}

/**
 * Map a finalizer decision onto the row vocabulary the UI actually reads.
 *
 * Total, like `decideTerminalRecord` — every status yields a write. A status
 * this function did not anticipate would otherwise become "write nothing",
 * which is indistinguishable from the hang.
 */
export function mapTerminalRecordToRows(record: TerminalRecord): TerminalRowWrite {
  const base = {
    terminal_record: record,
    terminal_status: record.reason,
    resumable: record.resumable,
    provider_attempts: record.provider_attempts,
    accumulated_cost_units: record.accumulated_cost_units,
    pending_runs: record.pending_runs,
    pending_capabilities: record.pending_capabilities,
    last_completed_capability: record.last_completed_capability,
    elapsed_ms: record.elapsed_ms,
  };

  if (record.status === "failed") {
    return {
      task_status: "failed",
      plan_status: "failed",
      result_patch: { ...base, task_status: "failed" },
      error_message: record.reason,
    };
  }

  // A BILLED RUN STILL IN FLIGHT IS RESUMABLE, NOT FINISHED AND NOT FAILED.
  // `continuation_required` is the exact string `taskResultIsPartial` looks for,
  // so the run shows as Partial and keeps its run id for a resume that adopts
  // the Actor run instead of paying for a second one.
  if (record.status === "pending_external_run") {
    return {
      task_status: "ready",
      plan_status: "partial",
      result_patch: { ...base, task_status: "partial", terminal_status: "continuation_required" },
      error_message: null,
    };
  }

  if (record.status === "partial") {
    return {
      task_status: "ready",
      plan_status: "partial",
      result_patch: { ...base, task_status: "partial" },
      error_message: null,
    };
  }

  return {
    task_status: "complete",
    plan_status: "complete",
    result_patch: { ...base, task_status: "completed" },
    error_message: null,
  };
}

// ------------------------------------------------------------------ guard ----

export interface TerminalGuardDb {
  /** Current row status, or null when the row cannot be read. */
  readTaskStatus: (taskId: string) => Promise<string | null>;
  readPlanStatus: (planId: string) => Promise<string | null>;
  /** Existing `tasks.result`, so the patch MERGES rather than truncates. */
  readTaskResult?: (taskId: string) => Promise<Record<string, unknown> | null>;
  writeTask: (
    taskId: string,
    patch: { status: string; error_message: string | null; result: Record<string, unknown> },
  ) => Promise<void>;
  writePlan: (planId: string, patch: { status: string }) => Promise<void>;
}

export interface RunTerminalGuard {
  /** The budget every provider call must be checked against. */
  deadline: ExecutionDeadline;
  /** Task and plan become known partway through the handler, not at entry. */
  bind: (ids: { taskId?: string | null; planId?: string | null }) => void;
  /** Latest engine state. Read at finalization; the last value wins. */
  observe: (state: FinalizerState | null | undefined) => void;
  /** What the guard would write right now. Exposed for logging and tests. */
  currentRecord: () => TerminalRecord;
  run: <T>(body: (deadline: ExecutionDeadline) => Promise<T>) => Promise<T | undefined>;
}

export function createRunTerminalGuard(
  db: TerminalGuardDb,
  opts: {
    deadline?: ExecutionDeadline;
    log?: (msg: string, meta?: unknown) => void;
    onWriteError?: (e: unknown) => void;
  } = {},
): RunTerminalGuard {
  const log = opts.log ?? (() => {});
  const deadline = opts.deadline ?? createExecutionDeadline();
  let taskId: string | null = null;
  let planId: string | null = null;
  let state: FinalizerState | null = null;
  let caught: unknown = undefined;

  const record = () => decideTerminalRecord(state, {
    elapsedMs: deadline.elapsedMs(),
    deadlineReached: deadline.expired(),
    error: caught,
  });

  return {
    deadline,
    bind: (ids) => {
      if (ids.taskId) taskId = ids.taskId;
      if (ids.planId) planId = ids.planId;
    },
    observe: (s) => { if (s) state = s; },
    currentRecord: record,
    run: async <T>(body: (d: ExecutionDeadline) => Promise<T>): Promise<T | undefined> => {
      let result: T | undefined;
      try {
        result = await body(deadline);
        return result;
      } catch (e) {
        caught = e;
        // RETHROW ONLY AFTER FINALIZING. The `finally` below still runs, so the
        // rows are terminal before the exception leaves this function — the
        // caller may turn it into a 500, and a 500 must not mean "Running
        // forever".
        throw e;
      } finally {
        try {
          const rec = record();
          const rows = mapTerminalRecordToRows(rec);
          log("terminal_guard_decision", {
            task_id: taskId, plan_id: planId,
            status: rec.status, reason: rec.reason,
            task_status: rows.task_status, plan_status: rows.plan_status,
          });

          if (taskId) {
            const current = await db.readTaskStatus(taskId);
            // ALREADY FINISHED — the handler wrote its own outcome. Rewriting it
            // here would let a cleanup-time decision overrule the real one.
            if (current !== null && TERMINAL_TASK_STATUSES.includes(current)) {
              log("terminal_guard_skip_task", { task_id: taskId, current });
            } else {
              const prior = (await db.readTaskResult?.(taskId)) ?? {};
              await db.writeTask(taskId, {
                status: rows.task_status,
                error_message: rows.error_message,
                result: { ...prior, ...rows.result_patch },
              });
            }
          }

          if (planId) {
            const current = await db.readPlanStatus(planId);
            if (current !== null && TERMINAL_PLAN_STATUSES.includes(current)) {
              log("terminal_guard_skip_plan", { plan_id: planId, current });
            } else {
              await db.writePlan(planId, { status: rows.plan_status });
            }
          }
        } catch (writeErr) {
          // A FAILED WRITE MUST NOT MASK THE RUN'S OUTCOME. It is reported and
          // swallowed; the body's result or exception still propagates.
          log("terminal_guard_write_error", { error: String(writeErr) });
          opts.onWriteError?.(writeErr);
        }
      }
    },
  };
}

/**
 * Build a guard over a supabase-js client.
 *
 * Kept here rather than in run-agent so the read-before-write discipline lives
 * in one place, and so a test can substitute the four primitives without
 * pretending to be Postgres.
 */
export function supabaseTerminalGuardDb(
  supabase: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
        };
      };
      update: (v: Record<string, unknown>) => {
        eq: (c: string, v: string) => Promise<{ error: unknown }>;
      };
    };
  },
): TerminalGuardDb {
  const readCol = async (table: string, id: string, col: string) => {
    const { data } = await supabase.from(table).select(col).eq("id", id).maybeSingle();
    const v = data?.[col];
    return typeof v === "string" ? v : null;
  };
  return {
    readTaskStatus: (id) => readCol("tasks", id, "status"),
    readPlanStatus: (id) => readCol("task_plans", id, "status"),
    readTaskResult: async (id) => {
      const { data } = await supabase.from("tasks").select("result").eq("id", id).maybeSingle();
      const r = data?.result;
      return r && typeof r === "object" ? r as Record<string, unknown> : null;
    },
    writeTask: async (id, patch) => {
      await supabase.from("tasks").update({
        status: patch.status,
        error_message: patch.error_message,
        result: patch.result,
      }).eq("id", id);
    },
    writePlan: async (id, patch) => {
      await supabase.from("task_plans").update({ status: patch.status }).eq("id", id);
    },
  };
}
