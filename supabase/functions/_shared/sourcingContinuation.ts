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
import { isResumableRowStatus, isTerminalOutcome } from "./taskStatusContract.ts";

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
  | "already_terminal"
  | "not_resumable_state";

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

  // ── ONE AUTHORITY ON "HAS THIS RUN FINISHED", NOT TWO ────────────────────
  //
  // This asked the CHECKPOINT first and refused on any terminal status it
  // carried. `claim_sourcing_continuation` — the RPC that takes the claim
  // moments later — asks the ROW first:
  //
  //     coalesce(result->>'terminal_status',
  //              result->'company_first_state'->>'terminal_status',
  //              result->'company_first'->>'status')
  //
  // So the two disagreed about exactly one shape, and it is a shape the system
  // produces routinely. Task 2f3d9c5c, verbatim:
  //
  //     result.terminal_status                     "continuation_required"
  //     company_first_state.terminal_status        "round_limit_reached"
  //     company_first_state.next_action            "stopped"
  //     company_first_state.terminal_reason        "the legacy sourcing loop is
  //                                                 disabled for this run…"
  //
  // The legacy quota controller stamps a terminal status when it believes the
  // run is over — and because `maxRounds` is 0 while the capability engine owns
  // sourcing, `rounds.length >= maxRounds` is `0 >= 0`, so a loop that never ran
  // stamps `round_limit_reached`. Auto-continuation then correctly overrode the
  // ROW to `continuation_required`, because the engine had work left. The
  // checkpoint kept the stale verdict.
  //
  // The RPC would have granted the claim. This refused first, every three
  // minutes, for as long as the sweeper kept trying: 15 rejections, zero
  // dispatches, a run frozen at generation 4 with a live frontier.
  //
  // THE ROW IS THE AUTHORITY, and it is the same authority the RPC uses. The
  // checkpoint is consulted only when the row says nothing — which is what
  // `coalesce` means, and what this now mirrors exactly. A genuinely finished
  // run still refuses: its ROW carries the terminal status too.
  //
  // Same defect as the `round_limit_reached` note in `run-agent` and the
  // `execution_deadline_reached` note in `leadRunTerminalGuard` — a run
  // declaring itself finished and then enforcing it against its own successor —
  // reaching the resume gate by a third route.
  const rowTerminal = typeof (row.result ?? {})["terminal_status"] === "string"
    ? String((row.result ?? {})["terminal_status"])
    : null;
  const effectiveTerminal = rowTerminal ??
    (typeof state.terminal_status === "string" ? state.terminal_status : null);

  // `continuation_required` is the one value that means "not finished". Anything
  // else that is set — and only what is SET — ends the run.
  if (effectiveTerminal !== null && effectiveTerminal !== "continuation_required") {
    return { ok: false, reason: "already_terminal" };
  }
  // Kept as a distinct check: `isTerminalOutcome` knows the vocabulary, and a
  // row carrying a terminal outcome is finished whatever the checkpoint says.
  if (isTerminalOutcome(rowTerminal)) return { ok: false, reason: "already_terminal" };
  if (!isResumableRowStatus(row.status)) return { ok: false, reason: "not_resumable_state" };

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
  not_resumable_state: "That run is not in a resumable state.",
};
