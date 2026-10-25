// THE LEGACY PRE-EFFECT GUARD — every lead-execution entry asks this FIRST.
//
// Four entries can start lead work: orchestrate (a browser request),
// enqueue-lead-mission (the V2 queue), run-agent (orchestrate, the worker, the
// continuation dispatcher, continue-workflow and the stall sweeper, all with
// the service bearer), and the V2 worker's mission runner. Before this guard,
// two things were decided too late or not at all:
//
//   1. PILOT / CLIENT SCOPE. The Outpost pilot (P1–P8) and client-scoped
//      research are DISABLED. Their tasks carry markers (`execution_mode:
//      "pilot_draft_only"`, a signed `pilot_scope`, `pilot_origin_session_id`)
//      that #171's lifecycle trigger keeps immutable on the stored row, and a
//      client-scoped request names a client. Nothing refused such a task before
//      context reads, model calls, purchases or messages: the database only
//      refused a later write. Now any marker — on the request OR on any stored
//      task the request points at — is refused before the first effect. The
//      STORED row decides: a request with its markers stripped still names the
//      stored task, and that row is read here.
//   2. THE PRINCIPAL. A service bearer proves the caller is our backend, not
//      that the person it acts for may still act. Every service caller forwards
//      the original requester's `user_id`; that person must still be a member
//      of the workspace when the work (re)starts, and a resumed or continued
//      task keeps its original principal — a different user cannot resume it.
//
// Refusals happen before any task row, message, ledger row, credit
// reservation, queue row, model call or provider call. A read failure refuses
// too (fail closed). Non-pilot, non-client work by a current member is
// unchanged, and the shared spending admission still runs after this guard.
//
// When the canonical client contract (#174/#176) is agreed, client scope stops
// being refused here and is authorized instead, through _shared/clientBrain.ts
// with the task's stored grant pins (the only module that calls client RPCs).

export type GuardCode =
  | "pilot_execution_disabled"
  | "client_scope_unsupported"
  | "principal_missing"
  | "principal_not_member"
  | "principal_mismatch"
  | "referenced_task_foreign"
  | "referenced_plan_foreign"
  | "guard_read_failed";

export type GuardResult =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 409 | 503; code: GuardCode; detail: string };

/**
 * Keys whose presence (non-null) makes a request or task client-scoped: the
 * task pins named by the client contract (#174 §8: client_id, the grant id and
 * its generation), the pilot's client binding, and an explicit scope.
 */
const CLIENT_KEYS = ["client_id", "client_grant_id", "client_grant_generation", "client_binding_id", "client_scope"] as const;
/** Keys whose presence (non-null) makes a request or task a pilot task. */
const PILOT_KEYS = ["pilot_scope", "pilot_origin_session_id"] as const;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Obj : null);

/**
 * The places a marker can sit: the object itself, its `tool_input`, its
 * `lead_mission` (top-level or under `tool_input`) and a stored `payload`.
 * Deliberately not a deep search: lead data legitimately contains names like
 * "client" inside prospect records.
 */
function scopes(root: unknown): Obj[] {
  const out: Obj[] = [];
  const add = (v: unknown) => { const o = obj(v); if (o) out.push(o); };
  const r = obj(root);
  if (!r) return out;
  for (const base of [r, obj(r.payload)]) {
    if (!base) continue;
    add(base);
    add(base.tool_input);
    add(base.lead_mission);
    add(obj(base.tool_input)?.lead_mission);
  }
  return out;
}

/** Pilot and client markers on a request body or a stored task row. Pure. */
export function scopeMarkers(root: unknown): { pilot: string[]; client: string[] } {
  const pilot = new Set<string>(), client = new Set<string>();
  for (const o of scopes(root)) {
    if (o.execution_mode === "pilot_draft_only") pilot.add("execution_mode=pilot_draft_only");
    for (const k of PILOT_KEYS) if (o[k] != null) pilot.add(k);
    for (const k of CLIENT_KEYS) if (o[k] != null) client.add(k);
  }
  return { pilot: [...pilot], client: [...client] };
}

/** The plan a run-agent or kickoff body files its work under, if any. */
export function referencedPlanId(body: unknown): string | null {
  const b = obj(body) ?? {};
  const v = b.plan_id ?? b.task_plan_id;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * The stored tasks a run-agent body points at. `resume` is the SAME task run
 * again (a resume or a continuation token): it keeps its original principal.
 * `related` are parents a child continuation builds on (continue-workflow): a
 * current member may continue a teammate's work, so only scope and workspace
 * are checked for those.
 */
export function referencedTaskIds(body: unknown): { resume: string[]; related: string[] } {
  const b = obj(body) ?? {};
  const pick = (...vs: unknown[]) => [...new Set(vs.filter((v): v is string => typeof v === "string" && v.length > 0))];
  const resume = pick(b.resume_task_id, b.continuation_token);
  return { resume, related: pick(b.lead_resume_parent_task_id, b.continuation_of_task_id).filter((id) => !resume.includes(id)) };
}

/** The reads the guard needs, against the service client (structurally typed). */
type Read = PromiseLike<{ data: unknown; error: unknown }>;
export interface GuardDb {
  from(table: string): {
    select(cols: string): {
      in(col: string, v: string[]): Read;
      eq(col: string, v: string): { eq(col: string, v: string): { maybeSingle(): Read } };
    };
  };
}

export interface GuardInput {
  db: GuardDb;
  workspaceId: string;
  /** The person the work is for: the JWT user, or the service caller's forwarded `user_id`. */
  principalUserId: string | null;
  /** The request body (markers are read from it). */
  body: unknown;
  /** Stored tasks the request points at (`referencedTaskIds`, or the queue row's task as `resume`). */
  taskIds: { resume: string[]; related: string[] };
  /**
   * The plan the work will be filed under (`plan_id` / `task_plan_id`). It must
   * exist in this workspace: a task linked to another workspace's plan is a
   * cross-workspace parent (Codex EXEC-PLAN on #179).
   */
  planId?: string | null;
  /** True when the caller already verified membership from a user JWT. */
  principalMembershipVerified?: boolean;
}

const refuse = (status: 401 | 403 | 409 | 503, code: GuardCode, detail: string): GuardResult => ({ ok: false, status, code, detail });

export async function legacyExecutionGuard(i: GuardInput): Promise<GuardResult> {
  // 1. The request itself.
  const req = scopeMarkers(i.body);
  if (req.pilot.length) return refuse(403, "pilot_execution_disabled", `request carries ${req.pilot.join(", ")}`);
  if (req.client.length) return refuse(403, "client_scope_unsupported", `request carries ${req.client.join(", ")}`);

  // 2. The stored rows it points at: authoritative even when the request's markers were stripped.
  const all = [...i.taskIds.resume, ...i.taskIds.related];
  if (all.length) {
    // The WHOLE row: markers sit in `payload` and, once the held task pins
    // (#174 §9.1) exist, in columns (client_id, client_grant_id, …). A pinned
    // client task must never resume as agency work because its request and
    // payload carry no marker. `*` reads whichever columns this schema has.
    const { data, error } = await i.db.from("tasks").select("*").in("id", all);
    if (error) return refuse(503, "guard_read_failed", "stored task read failed");
    const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; workspace_id: string; user_id: string | null; payload: unknown }>;
    for (const row of rows) {
      if (row.workspace_id !== i.workspaceId) return refuse(409, "referenced_task_foreign", `task ${row.id} belongs to another workspace`);
      const stored = scopeMarkers(row);
      if (stored.pilot.length) return refuse(403, "pilot_execution_disabled", `stored task ${row.id} carries ${stored.pilot.join(", ")}`);
      if (stored.client.length) return refuse(403, "client_scope_unsupported", `stored task ${row.id} carries ${stored.client.join(", ")}`);
      // A resumed task keeps its original principal.
      if (i.taskIds.resume.includes(row.id) && row.user_id && row.user_id !== i.principalUserId) {
        return refuse(403, "principal_mismatch", `task ${row.id} belongs to another principal`);
      }
    }
  }

  // 3. The plan the task will be filed under belongs to this workspace.
  if (i.planId) {
    const { data, error } = await i.db.from("task_plans").select("id, workspace_id").in("id", [i.planId]);
    if (error) return refuse(503, "guard_read_failed", "plan read failed");
    const plan = (Array.isArray(data) ? data[0] : null) as { workspace_id?: string } | null;
    // A missing plan and another workspace's plan answer alike: no existence oracle.
    if (!plan || plan.workspace_id !== i.workspaceId) {
      return refuse(409, "referenced_plan_foreign", "the plan does not belong to this workspace");
    }
  }

  // 4. The principal is still a member (a JWT caller was verified by its entry already).
  // (401, as run-agent's own `unidentified_user` answered this case before the guard.)
  if (!i.principalUserId) return refuse(401, "principal_missing", "no principal for this work");
  if (!i.principalMembershipVerified) {
    const { data, error } = await i.db.from("workspace_members").select("user_id")
      .eq("workspace_id", i.workspaceId).eq("user_id", i.principalUserId).maybeSingle();
    if (error) return refuse(503, "guard_read_failed", "membership read failed");
    if (!data) return refuse(403, "principal_not_member", "the requesting user is no longer a member of this workspace");
  }
  return { ok: true };
}
