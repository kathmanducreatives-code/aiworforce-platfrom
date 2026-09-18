// LEAD V2 P4.1 — A CANCELLED MISSION ENDS EVERY RECORD, NOT JUST THE QUEUE.
//
// `cancel_lead_mission` sets ONE row: the queue. When the cancellation lands on
// a mission a worker is running, the heartbeat fails, the run aborts, and the
// worker's release reconciles the task, lineage and plan — that path is sound.
//
// The hole is the other one. Canary 3dbcec17 was cancelled 2.8s after its slice
// released, so the row was `resumable` and UNCLAIMED. `claim_next_lead_mission`
// never claims a cancelled row, so no worker would ever release it, and nothing
// ran the reconciliation:
//
//     queue   cancelled          ← the operator's write
//     task    ready              ← still resumable, still offers Continue
//     lineage active
//
// which is exactly the four-records-disagree state `leadMissionTerminal.ts`
// exists to prevent. This module closes it: the same `planTerminalReconciliation`
// the worker uses, applied to cancelled rows nobody will claim.
//
// WHAT DECIDES, AND WHAT WRITES. The decision stays in `leadMissionTerminal.ts`
// — one module, one answer to "what does a terminal mission look like". This
// module is the seam that reads the rows and writes the patch, extracted from
// worker/main.ts (which `Deno.serve`-style entry files make untestable) so the
// rule can be exercised directly.
//
// IDEMPOTENT BY CONSTRUCTION. `planTerminalReconciliation` returns an empty
// patch when the rows already agree, and an empty patch writes nothing. A
// second cancel, a second sweep and a sweep racing the worker all converge.
//
// NEVER REVIVES. It only ever reads rows for a queue row that is ALREADY
// cancelled, and never widens a terminal status: a completed mission is not a
// cancellation and is never visited.

import {
  applyTerminalPatch, planTerminalReconciliation, terminalViolations,
  type QueueTerminalStatus, type TerminalRows,
} from "./leadMissionTerminal.ts";

/** The reason a cancelled mission carries on its task, lineage and plan. */
export const CANCELLED_REASON = "cancelled" as const;

/** The rows a terminal transition touches, addressed by id. */
export interface TerminalIds {
  taskId: string | null;
  lineageId: string | null;
  planId: string | null;
}

/**
 * The only database calls a reconciliation makes. Narrow on purpose: a test
 * supplies a fake, and nothing here can reach a table this interface does not
 * name.
 */
export interface TerminalRowsDb {
  readTask: (taskId: string) => Promise<{ status: string | null; result: Record<string, unknown> | null } | null>;
  readLineage: (lineageId: string) => Promise<{ status: string | null } | null>;
  readPlan: (planId: string) => Promise<{ status: string | null } | null>;
  writeTask: (taskId: string, patch: { status: string; result: Record<string, unknown> }) => Promise<void>;
  /** The lease is released here: a terminal lineage holds nothing. */
  writeLineage: (lineageId: string, patch: {
    status: "terminal" | "cancelled"; terminal_reason: string;
    lease_holder: null; lease_expires_at: null; updated_at: string;
  }) => Promise<void>;
  writePlan: (planId: string, patch: { status: string; completed_at: string }) => Promise<void>;
}

export interface ReconcileResult {
  /** How the rows disagreed with the terminal queue before the writes. */
  violations: string[];
  written: Array<"task" | "lineage" | "plan">;
  /** Disagreements left afterwards. Empty on success — asserted, not assumed. */
  remaining: string[];
}

/**
 * Make the task, lineage and plan agree with a terminal queue row.
 *
 * Returns what was wrong and what was written. Consistent rows produce no
 * writes at all, which is what makes repeated cancels and sweeps free.
 */
export async function reconcileTerminalRows(
  db: TerminalRowsDb,
  queueStatus: QueueTerminalStatus,
  reason: string,
  ids: TerminalIds,
  nowIso: string,
): Promise<ReconcileResult> {
  const rows: TerminalRows = { task: null, lineage: null, plan: null };
  if (ids.taskId) rows.task = await db.readTask(ids.taskId);
  if (ids.lineageId) rows.lineage = await db.readLineage(ids.lineageId);
  if (ids.planId) rows.plan = await db.readPlan(ids.planId);

  const patch = planTerminalReconciliation(queueStatus, reason, rows, nowIso);
  const written: ReconcileResult["written"] = [];
  if (patch.violations.length === 0) {
    return { violations: [], written, remaining: [] };
  }
  if (patch.task && ids.taskId) {
    await db.writeTask(ids.taskId, patch.task);
    written.push("task");
  }
  if (patch.lineage && ids.lineageId) {
    // THE LEASE GOES WITH IT. A cancelled lineage that still names a holder is
    // a lease the sweeper would keep trying to expire.
    await db.writeLineage(ids.lineageId, {
      ...patch.lineage, lease_holder: null, lease_expires_at: null, updated_at: nowIso,
    });
    written.push("lineage");
  }
  if (patch.plan && ids.planId) {
    await db.writePlan(ids.planId, patch.plan);
    written.push("plan");
  }
  return {
    violations: patch.violations,
    written,
    remaining: terminalViolations(queueStatus, applyTerminalPatch(rows, patch)),
  };
}

/** A cancelled queue row, as the sweep reads it. */
export interface CancelledQueueRow {
  id: string;
  task_id: string | null;
  lineage_id: string | null;
  request: Record<string, unknown> | null;
}

export interface CancelSweepDb extends TerminalRowsDb {
  /**
   * Cancelled queue rows, most recent first. The implementation bounds the
   * window and the count; this module never asks for more than `limit`.
   */
  listCancelled: (limit: number) => Promise<CancelledQueueRow[]>;
}

/** How many cancelled missions one idle tick reconciles. */
export const CANCEL_SWEEP_LIMIT = 5;

export interface CancelSweepResult {
  scanned: number;
  reconciled: number;
  details: Array<{ queue_id: string; violations: string[]; written: string[]; remaining: string[] }>;
}

/**
 * Reconcile cancelled missions whose other rows have not caught up.
 *
 * Runs on an idle worker tick, so it costs one bounded query when there is no
 * mission to run and nothing at all when every cancelled row already agrees.
 * It is the safety net for a cancellation issued straight against the RPC — by
 * the operator, the UI, or psql — which no release will ever follow.
 */
export async function sweepCancelledMissions(
  db: CancelSweepDb,
  nowIso: string,
  limit: number = CANCEL_SWEEP_LIMIT,
): Promise<CancelSweepResult> {
  const rows = await db.listCancelled(limit);
  const out: CancelSweepResult = { scanned: rows.length, reconciled: 0, details: [] };
  for (const row of rows) {
    const planId = typeof row.request?.plan_id === "string" ? row.request.plan_id : null;
    const r = await reconcileTerminalRows(db, "cancelled", CANCELLED_REASON, {
      taskId: row.task_id,
      // The lineage defaults to the task, exactly as the worker's release does.
      lineageId: row.lineage_id ?? row.task_id,
      planId,
    }, nowIso);
    if (r.written.length === 0) continue;
    out.reconciled++;
    out.details.push({ queue_id: row.id, violations: r.violations, written: r.written, remaining: r.remaining });
  }
  return out;
}
