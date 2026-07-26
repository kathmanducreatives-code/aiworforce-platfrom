// RESUMING A CHECKPOINTED COMPANY-FIRST TASK.
//
// `continuation_required` is not terminal: the controller wrote a checkpoint into
// tasks.result.company_first_state and expects a LATER INVOCATION OF THE SAME
// TASK to pick it up. run-agent, however, inserts a new task row on every call —
// so a "Continue sourcing" button would have created a fresh task, found no
// checkpoint, and restarted round 1, re-paying for provider calls that had
// already completed.
//
// This module decides whether a resume request may reuse an existing task. It is
// deliberately strict: wrong workspace, wrong shape or no checkpoint means a
// refusal, never a silent new run.
//
// Pure — no network, no client. The caller supplies the already-loaded row.

import { SOURCING_STATE_KEY, SOURCING_STATE_VERSION } from "./companyFirstSourcingState.ts";

export interface ResumableTaskRow {
  id?: string | null;
  workspace_id?: string | null;
  status?: string | null;
  result?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
}

export type ResumeRefusal =
  | "task_not_found"
  | "workspace_mismatch"
  | "no_checkpoint"
  | "checkpoint_version_mismatch"
  | "already_terminal";

export type ResumeDecision =
  | { ok: true; taskId: string; nextRound: number; instruction: string | null }
  | { ok: false; reason: ResumeRefusal };

export function decideResume(
  row: ResumableTaskRow | null | undefined,
  workspaceId: string,
  requestedTaskId: string,
): ResumeDecision {
  if (!row || !row.id || row.id !== requestedTaskId) return { ok: false, reason: "task_not_found" };
  // Tenant isolation: a continuation token from another workspace is refused
  // before anything is read out of its checkpoint.
  if (row.workspace_id !== workspaceId) return { ok: false, reason: "workspace_mismatch" };

  const state = (row.result ?? {})[SOURCING_STATE_KEY] as
    | { version?: string; terminal_status?: string | null; current_round?: number }
    | undefined;
  if (!state) return { ok: false, reason: "no_checkpoint" };
  if (state.version !== SOURCING_STATE_VERSION) return { ok: false, reason: "checkpoint_version_mismatch" };
  // A finished run must not be resumable — that is what the terminal statuses mean.
  if (state.terminal_status) return { ok: false, reason: "already_terminal" };

  const instruction = typeof row.payload?.instruction === "string" ? row.payload.instruction : null;
  return {
    ok: true,
    taskId: row.id,
    // The checkpoint's own round pointer. Never 1 on a resume.
    nextRound: typeof state.current_round === "number" ? state.current_round : 1,
    instruction,
  };
}

export const RESUME_REFUSAL_MESSAGE: Record<ResumeRefusal, string> = {
  task_not_found: "That sourcing run could not be found.",
  workspace_mismatch: "That sourcing run belongs to a different workspace.",
  no_checkpoint: "That run has no saved checkpoint to continue from.",
  checkpoint_version_mismatch: "That run's checkpoint was written by an older version and cannot be resumed.",
  already_terminal: "That run has already finished.",
};
