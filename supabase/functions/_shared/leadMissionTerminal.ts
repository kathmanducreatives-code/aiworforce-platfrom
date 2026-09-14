// ONE TERMINAL TRANSITION FOR A LEAD V2 MISSION.
//
// Run 4250f181 ended as
//
//   queue   failed                     (5 of 5 attempts)
//   task    ready / continuation_required
//   lineage active
//   plan    partial
//
// — four records, three different answers to "is this mission over?", and a UI
// that still offered Continue on a mission nothing would ever run again. The
// queue decided the mission was finished and nobody told the other three.
//
// THE RULE. Once the queue is terminal, every record is:
//
//   queue      complete            failed / cancelled
//   task       not resumable       status `failed`, terminal_status != continuation_required
//   lineage    terminal            terminal (cancelled for a cancellation)
//   plan       complete | partial  failed
//
// PURE. The worker reads the rows, asks this module what to write, and writes
// it. Idempotent: consistent rows produce no writes.

import { queueStatusFor, type QueueReleaseStatus } from "./leadMissionV2Request.ts";

/**
 * Attempts the queue grants a mission. MIRRORS the literal in
 * `claim_next_lead_mission` (`attempts < 5`) and `release_lead_mission`
 * (`attempts >= 5`); a test reads the migration and fails if they drift.
 */
export const V2_MAX_ATTEMPTS = 5;

/** The terminal reason a mission that ran out of attempts carries. */
export const RETRY_BUDGET_EXHAUSTED = "retry_budget_exhausted";

export type QueueTerminalStatus = "complete" | "failed" | "cancelled";

/**
 * The status the worker releases with — stated, never left for the SQL to
 * convert. A non-terminal outcome on the last attempt is a failure the worker
 * knows about now, and must reconcile now.
 */
export function finalQueueStatus(
  outcome: { status: string; terminal: boolean },
  attempts: number,
): QueueReleaseStatus {
  if (outcome.terminal) return queueStatusFor(outcome);
  return attempts >= V2_MAX_ATTEMPTS ? "failed" : "resumable";
}

export function terminalReasonFor(
  outcome: { status: string; terminal: boolean },
  attempts: number,
): string {
  if (!outcome.terminal && attempts >= V2_MAX_ATTEMPTS) return RETRY_BUDGET_EXHAUSTED;
  return outcome.status;
}

export function isTerminalQueueStatus(s: string | null | undefined): s is QueueTerminalStatus {
  return s === "complete" || s === "failed" || s === "cancelled";
}

export interface TerminalRows {
  task: { status: string | null; result: Record<string, unknown> | null } | null;
  lineage: { status: string | null } | null;
  plan: { status: string | null } | null;
}

export interface TerminalPatch {
  task?: { status: string; result: Record<string, unknown> };
  lineage?: { status: "terminal" | "cancelled"; terminal_reason: string };
  plan?: { status: string; completed_at: string };
  /** What was inconsistent before the patch — for the log. */
  violations: string[];
}

const RESUMABLE_TASK_STATUSES = new Set(["ready", "running", "pending", "partial"]);
const RESUMABLE_TERMINAL = "continuation_required";
const LIVE_PLAN_STATUSES = new Set(["planning", "executing", "awaiting_approval", "partial"]);

function terminalStatusOf(result: Record<string, unknown> | null): string | null {
  const t = result?.terminal_status;
  return typeof t === "string" && t ? t : null;
}

/** Every way these rows disagree with a terminal queue. Empty means consistent. */
export function terminalViolations(queue: QueueTerminalStatus, rows: TerminalRows): string[] {
  const v: string[] = [];
  const failed = queue !== "complete";
  const t = rows.task;
  if (t) {
    if (RESUMABLE_TASK_STATUSES.has(String(t.status ?? ""))) v.push(`task.status=${t.status} is resumable`);
    if (terminalStatusOf(t.result) === RESUMABLE_TERMINAL) v.push("task.terminal_status=continuation_required");
    if (failed && t.status !== "failed") v.push(`task.status=${t.status}, queue=${queue}`);
  }
  const l = rows.lineage;
  if (l && l.status !== "terminal" && l.status !== "cancelled") v.push(`lineage.status=${l.status}`);
  const p = rows.plan;
  if (p) {
    if (failed && p.status !== "failed") v.push(`plan.status=${p.status}, queue=${queue}`);
    if (!failed && LIVE_PLAN_STATUSES.has(String(p.status ?? "")) && p.status !== "partial") {
      v.push(`plan.status=${p.status} is live`);
    }
  }
  return v;
}

/**
 * What to write so the rows agree with a terminal queue.
 *
 * Only what is wrong is written. A failed task that already says why keeps its
 * own terminal status; one that still says `continuation_required` (or nothing)
 * is given the queue's reason.
 */
export function planTerminalReconciliation(
  queue: QueueTerminalStatus,
  reason: string,
  rows: TerminalRows,
  nowIso: string,
): TerminalPatch {
  const violations = terminalViolations(queue, rows);
  const patch: TerminalPatch = { violations };
  if (violations.length === 0) return patch;
  const failed = queue !== "complete";

  const t = rows.task;
  if (t) {
    const result = { ...(t.result ?? {}) };
    const current = terminalStatusOf(t.result);
    const stillResumable = current === RESUMABLE_TERMINAL || current === null;
    const needsStatus = failed ? t.status !== "failed" : RESUMABLE_TASK_STATUSES.has(String(t.status ?? ""));
    if (needsStatus || stillResumable) {
      const terminal = stillResumable ? reason : current!;
      const prior = (result.auto_continuation && typeof result.auto_continuation === "object")
        ? result.auto_continuation as Record<string, unknown> : {};
      patch.task = {
        status: failed ? "failed" : (needsStatus ? "completed" : String(t.status)),
        result: {
          ...result,
          terminal_status: terminal,
          task_status: failed ? "failed" : (result.task_status ?? "completed"),
          auto_continuation: {
            ...prior,
            continuing: false,
            decision: terminal,
            detail: `the Lead V2 queue ended this mission (${queue}: ${reason})`,
          },
          v2_terminal: { queue_status: queue, reason, reconciled_at: nowIso },
        },
      };
    }
  }

  const l = rows.lineage;
  if (l && l.status !== "terminal" && l.status !== "cancelled") {
    patch.lineage = { status: queue === "cancelled" ? "cancelled" : "terminal", terminal_reason: reason };
  }

  const p = rows.plan;
  if (p) {
    if (failed && p.status !== "failed") {
      patch.plan = { status: "failed", completed_at: nowIso };
    } else if (!failed && LIVE_PLAN_STATUSES.has(String(p.status ?? "")) && p.status !== "partial") {
      const done = t?.status === "completed" || t?.status === "complete";
      patch.plan = { status: done ? "complete" : "partial", completed_at: nowIso };
    }
  }
  return patch;
}

/** The rows as they will read after the patch — for tests and the post-write check. */
export function applyTerminalPatch(rows: TerminalRows, patch: TerminalPatch): TerminalRows {
  return {
    task: rows.task
      ? (patch.task ? { status: patch.task.status, result: patch.task.result } : rows.task)
      : null,
    lineage: rows.lineage ? (patch.lineage ? { status: patch.lineage.status } : rows.lineage) : null,
    plan: rows.plan ? (patch.plan ? { status: patch.plan.status } : rows.plan) : null,
  };
}
