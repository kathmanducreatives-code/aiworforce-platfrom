// A FIRST SLICE KILLED BEFORE ITS FIRST CHECKPOINT IS RUN AGAIN, ON ITS OWN TASK.
//
// The V2 queue binds a mission's task BEFORE any paid boundary
// (`bind_lead_mission_execution`: one task per mission, for life), so every
// later claim of that queue row resumes that task. The resume path requires a
// checkpoint (`decideResume`, `claim_sourcing_continuation`): a first slice
// that died before writing one — SIGKILLed during its first paid run, an
// out-of-memory, a host restart — left a task the queue may only resume and
// run-agent may never resume. Offline repro, 2026-10-22: worker 2 was refused
// `no_checkpoint` on every claim until the queue failed the mission.
//
// Nothing was checkpointed, so the next slice IS a first slice again — on the
// same task and lineage, so every provider and model operation key it computes
// is the one the dead slice computed. The durable ledgers then decide what was
// already bought: smoke admission answers `adopt` (a run id is known) or
// `uncertain` (never sent again), never a second purchase. Nothing is refunded.
//
// FENCED. The slice takes a new generation with a compare-and-swap on
// `checkpoint_version`, exactly the token a continuation claim would bump, so a
// first worker that was only stalled — not dead — is refused at its next result
// write (`fencedTaskUpdate`) and its next admission (`stale_generation`).
//
// NARROW. Only for the V2 queue's own in-process call, only for a task the
// queue owns, only while the row is still `running` with no checkpoint and no
// terminal verdict. Everything else goes through the unchanged resume path and
// its refusals.

import { decideResume, type ResumableTaskRow } from "./sourcingContinuation.ts";
import { terminalStatusOf } from "./leadMissionV2Request.ts";
import { OPEN_RESULT_FILTER } from "./fencedTaskWrite.ts";

export interface ReentryRow extends ResumableTaskRow {
  checkpoint_version?: number | null;
}

/** The generation the dead first slice held, when its task may be run again from the start. */
export function decideFirstSliceReentry(
  row: ReentryRow | null | undefined,
  workspaceId: string,
  taskId: string,
  ownedByQueue: boolean,
): { ok: true; from: number } | { ok: false } {
  if (!ownedByQueue || !row) return { ok: false };
  const d = decideResume(row, workspaceId, taskId);
  if (d.ok || d.reason !== "no_checkpoint") return { ok: false };
  if (row.status !== "running" || terminalStatusOf(row.result) !== null) return { ok: false };
  const v = row.checkpoint_version;
  return typeof v === "number" && Number.isInteger(v) ? { ok: true, from: v } : { ok: false };
}

export interface ReentryQuery extends PromiseLike<{ error: unknown; count: number | null }> {
  eq(column: string, value: unknown): ReentryQuery;
  is(column: string, value: null): ReentryQuery;
  or(filters: string): ReentryQuery;
}
export interface ReentryDb {
  from(table: string): { update(patch: Record<string, unknown>, opts: { count: "exact" }): ReentryQuery };
}

/**
 * Take the next generation of a row that is still exactly as the dead slice
 * left it. Null when anything changed since it was read (another claimant, a
 * checkpoint, a verdict) or the write failed: the caller then refuses as before.
 */
export async function takeReentryGeneration(
  db: ReentryDb, taskId: string, workspaceId: string, from: number,
): Promise<number | null> {
  try {
    const { error, count } = await db.from("tasks")
      .update({ checkpoint_version: from + 1, updated_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", taskId).eq("workspace_id", workspaceId)
      .eq("checkpoint_version", from).eq("status", "running")
      .is("result->company_first_state", null)
      .or(OPEN_RESULT_FILTER);
    return !error && count === 1 ? from + 1 : null;
  } catch {
    return null;
  }
}
