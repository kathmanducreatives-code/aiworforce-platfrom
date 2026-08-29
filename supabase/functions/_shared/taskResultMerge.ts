// A TASK RESULT IS ACCUMULATED, NEVER REPLACED.
//
// ── THE SAME BUG, TWICE ────────────────────────────────────────────────────
//
// `tasks.result` is written by a dozen places across one invocation: the paid
// preflight, each stage's progress, the capability execution state, the resume
// checkpoint, the evaluation rows, the terminal record. Every one of them is a
// PART of the record. A writer that assigns a fresh object literal does not add
// its part — it deletes everyone else's.
//
// It has now happened twice in the same file.
//
//   Run 85192217, 2026-08-19. A continuation's first write replaced the
//   parent's row — `task.id` is the PARENT's id on a continuation — destroying
//   `lead_resume_checkpoint` four seconds before the code below tried to read
//   it back. Fixed at that one site by spreading `resumedTaskResult`.
//
//   Task ca3d047d, 2026-08-29. The capability engine ran, discovered 30
//   companies, resolved 5 identities and reached the Company Brain. A second
//   invocation started one second before it finished, took the generic agent
//   path, and its tail wrote `result: { output, tokens_in, tokens_out }`. That
//   erased `capability_execution_state`, `workbench_evaluation_rows`,
//   `mission_funnel`, `lead_resume_checkpoint` and `lead_mission` — including
//   the record of what the continuation had decided, so the loss destroyed its
//   own explanation.
//
// The first fix repaired an instance. Five other sites still assigned a bare
// literal, all of them terminal writes that can fire after a capability run has
// persisted its work. This is the class.
//
// ── AND A FAILED READ NEVER CLOBBERS ───────────────────────────────────────
//
// If the current result cannot be read, the merge cannot be performed, and the
// safe action is to write the status WITHOUT the result rather than to write a
// partial one over a whole one. `ok: false` says so; it is not an error the
// caller has to handle beyond that choice.

export const TASK_RESULT_MERGE_VERSION = "task-result-merge-v1" as const;

export interface TaskResultDb {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
}

export type MergedResult =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * The result this writer should persist: everything already there, plus its own
 * contribution.
 *
 * `prior` short-circuits the read for callers that already hold the row under a
 * claim — the continuation path reads it once and must not race a second read.
 */
export async function mergeTaskResult(
  db: TaskResultDb,
  taskId: string,
  patch: Record<string, unknown>,
  prior?: Record<string, unknown> | null,
): Promise<MergedResult> {
  if (prior !== undefined) {
    return { ok: true, result: { ...(prior ?? {}), ...patch } };
  }
  try {
    const { data, error } = await db.from("tasks")
      .select("result").eq("id", taskId).maybeSingle();
    if (error) return { ok: false, reason: String(error) };
    const current = data?.result;
    return {
      ok: true,
      result: {
        ...(current && typeof current === "object" ? current as Record<string, unknown> : {}),
        ...patch,
      },
    };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/**
 * Write a status and a result contribution without ever losing what is there.
 *
 * One call, so no site has to remember the read-merge-write order, and a read
 * failure degrades to a status-only write instead of a destructive one.
 */
export async function writeTaskResult(
  db: TaskResultDb,
  taskId: string,
  patch: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  opts: { prior?: Record<string, unknown> | null; log?: (m: string, meta?: unknown) => void } = {},
): Promise<void> {
  const merged = await mergeTaskResult(db, taskId, patch, opts.prior);
  if (!merged.ok) {
    opts.log?.("task_result_merge_failed_status_only", { task_id: taskId, reason: merged.reason });
    if (Object.keys(extra).length > 0) {
      await db.from("tasks").update(extra).eq("id", taskId);
    }
    return;
  }
  await db.from("tasks").update({ ...extra, result: merged.result }).eq("id", taskId);
}
