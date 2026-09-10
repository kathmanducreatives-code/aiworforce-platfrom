// THE V2 REQUEST AND ITS OUTCOME — pure rules shared by enqueue, the worker, and
// the stalled-lead sweeper.
//
// WHAT IS QUEUED is orchestrate's own kickoff body for a mission step, verbatim —
// the worker replays it into run-agent's handler, so the handler sees exactly the
// request the edge path would have sent. Two changes only:
//   • the canary's quota is forced to 1 through the QUOTA FIELDS. The mission is
//     deliberately left untouched: run-agent resolves `body.requested_lead_count`
//     before the mission's own count and sizes every engine input from that quota
//     (`remainingLeads`, `maxCandidates`), while rewriting the mission would change
//     its hash and could orphan the approved plan artifact.
//   • a resume adds `resume_task_id`, the same field the sweeper sends.
//
// PURE except `loadV2OwnedTaskIds`, whose database is injected.

import { isLeadMissionV1 } from "./leadMission.ts";
import { V2_CANARY_FORCED_REQUESTED_LEAD_COUNT } from "./leadExecutionEngine.ts";

export type KickoffBody = Record<string, unknown>;

export type KickoffValidation = { ok: true } | { ok: false; code: string };

/** Where run-agent's `readPersistedLeadMission` finds the mission. */
export function missionFromKickoff(b: KickoffBody): unknown {
  const ti = b.tool_input as Record<string, unknown> | null | undefined;
  return b.lead_mission ?? ti?.lead_mission ?? null;
}

/**
 * V2 runs MISSION tasks only — the capability-engine path. A body without an
 * approved LeadMissionV1 would reach the legacy route, which V2 must not own.
 */
export function validateV2KickoffBody(b: unknown): KickoffValidation {
  if (!b || typeof b !== "object" || Array.isArray(b)) return { ok: false, code: "request_not_object" };
  const r = b as KickoffBody;
  if (typeof r.workspace_id !== "string" || !r.workspace_id) return { ok: false, code: "missing_workspace_id" };
  if (typeof r.plan_id !== "string" || !r.plan_id) return { ok: false, code: "missing_plan_id" };
  if (typeof r.step_index !== "number") return { ok: false, code: "missing_step_index" };
  if (r.agent_slug !== "scout") return { ok: false, code: "agent_must_be_scout" };
  if (typeof r.instruction !== "string" || !r.instruction.trim()) return { ok: false, code: "missing_instruction" };
  if (!isLeadMissionV1(missionFromKickoff(r))) return { ok: false, code: "missing_lead_mission" };
  // The worker decides when a run is a resume. A queued body that already names
  // one could make two missions resume the same task.
  if ("resume_task_id" in r || "continuation_token" in r) return { ok: false, code: "resume_fields_not_allowed" };
  return { ok: true };
}

/** Returns a copy; never mutates the input. The mission is intentionally untouched. */
export function forceCanaryLeadCount(
  b: KickoffBody,
  n: number = V2_CANARY_FORCED_REQUESTED_LEAD_COUNT,
): KickoffBody {
  const out: KickoffBody = { ...b, requested_lead_count: n };
  if (b.tool_input && typeof b.tool_input === "object" && !Array.isArray(b.tool_input)) {
    out.tool_input = { ...(b.tool_input as Record<string, unknown>), requested_lead_count: n };
  }
  return out;
}

export function withResume(b: KickoffBody, taskId: string | null): KickoffBody {
  return taskId ? { ...b, resume_task_id: taskId } : b;
}

/** The same precedence `claim_sourcing_continuation` uses for "has this run finished". */
export function terminalStatusOf(result: unknown): string | null {
  const r = (result ?? {}) as Record<string, unknown>;
  const cfs = (r.company_first_state ?? {}) as Record<string, unknown>;
  const cf = (r.company_first ?? {}) as Record<string, unknown>;
  const v = r.terminal_status ?? cfs.terminal_status ?? cf.status ?? null;
  return typeof v === "string" && v ? v : null;
}

export interface TaskOutcomeRow { status: string | null; terminal_status: string | null }
export interface MappedOutcome { status: string; terminal: boolean }

/** How the run the handler executed actually ended, read from its task row. */
export function mapTaskOutcome(row: TaskOutcomeRow | null): MappedOutcome {
  if (!row) return { status: "task_missing", terminal: false };
  const ts = row.terminal_status;
  if (ts === "continuation_required") return { status: ts, terminal: false };
  if (row.status === "failed") return { status: ts ? `failed:${ts}` : "failed", terminal: true };
  if (ts) return { status: ts, terminal: true };
  if (row.status === "complete" || row.status === "skipped") return { status: row.status, terminal: true };
  return { status: row.status ?? "unknown", terminal: false };
}

/**
 * The handler refused before creating a task. 409 (lineage busy, resume claim
 * still held) and 5xx/429 are transient; any other 4xx is a request that will
 * not fix itself by being retried.
 */
export function mapRefusal(httpStatus: number): MappedOutcome {
  const transient = httpStatus === 409 || httpStatus === 429 || httpStatus >= 500;
  return { status: `refused_${httpStatus}`, terminal: !transient };
}

export type QueueReleaseStatus = "complete" | "resumable" | "failed" | "cancelled";

/**
 * A terminal ending is respected even if the worker had stopped starting paid
 * work — revoking the deadline means "start nothing new", not "the run failed".
 * Marking a finished run resumable would only buy a 409 on the next claim.
 */
export function queueStatusFor(o: { status: string; terminal: boolean }): QueueReleaseStatus {
  if (!o.terminal) return "resumable";
  if (/cancel/i.test(o.status)) return "cancelled";
  if (/fail|refused|error/i.test(o.status)) return "failed";
  return "complete";
}

/** Rows the V2 worker owns are resumed only by it — never by the V1 sweeper. */
export function excludeV2OwnedTasks<T extends { id: string }>(rows: T[], owned: ReadonlySet<string>): T[] {
  return owned.size === 0 ? rows : rows.filter((r) => !owned.has(r.id));
}

export interface QueueLookupDb {
  from(table: string): {
    select(cols: string): {
      in(col: string, values: string[]): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
}

/**
 * Task ids with a V2 queue row. TOLERANT BY DESIGN: a missing table (migration
 * not yet applied) or any error reads as "no V2 tasks" — there cannot be any
 * then — so this can never stop the V1 sweeper from doing its job.
 */
export async function loadV2OwnedTaskIds(db: QueueLookupDb, taskIds: string[]): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();
  try {
    const { data, error } = await db.from("lead_mission_queue").select("task_id").in("task_id", taskIds);
    if (error || !Array.isArray(data)) return new Set();
    return new Set(
      (data as Array<{ task_id?: string | null }>).map((r) => r.task_id).filter((x): x is string => !!x),
    );
  } catch {
    return new Set();
  }
}
