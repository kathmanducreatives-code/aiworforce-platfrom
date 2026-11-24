// The ONE way server code reads or writes a CLIENT's Company Brain (Phase 3c).
//
// HELD with its schema (supabase/migrations-held/20261024160000_client_company_brain.sql,
// contract #174). Switched off: nothing in a deployed handler calls this yet,
// and clientBrainsEnabled() is false unless COMPANY_BRAIN_CLIENTS_ENABLED=true.
//
// The agency Brain (public.company_brain, _shared/brainWriter.ts) is a different
// scope and is never read or written here; a client Brain is never read or
// written there (I2). A request for client scope without a client is refused
// (I1) — never answered from the agency Brain, the first/latest client or any
// other default.
//
// Same shape as AUTH-06: a read-only GET pre-check, so an already-refused
// caller sends no write request, then the locked writer, which re-applies the
// rule on the locked rows in its own transaction. A refusal changes nothing.

type RpcResult = { data: unknown; error: { message: string } | null };
type Admin = { rpc: (fn: string, args: Record<string, unknown>, opts?: { get?: boolean }) => PromiseLike<RpcResult> };

export type BrainScope = { kind: "agency" } | { kind: "client"; clientId: string };
export type ClientBrainPermission = "read" | "edit" | "activate";
export type ClientBrainIntent = "interactive" | "task";
export type ClientBrainRefusal =
  | "session_invalid" | "not_member" | "forbidden_role" | "no_grant" | "client_archived"
  | "grant_changed" | "permission_changed" | "client_context_required";
export type ClientBrainOutcome = "ok" | "stale" | ClientBrainRefusal;

/** What a stored task/approval recorded when it was authorized; it must still hold all three. */
export interface ClientBrainPins { grantId: string; generation: number; permissionRevision: string }

export interface ClientBrainActor {
  workspaceId: string;
  clientId: string | null;
  actorId: string;
  sessionId: string | null;
  intent?: ClientBrainIntent;
  pins?: ClientBrainPins | null;
}

const REFUSALS: readonly string[] = [
  "session_invalid", "not_member", "forbidden_role", "no_grant", "client_archived",
  "grant_changed", "permission_changed", "client_context_required",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clientBrainsEnabled(env: (k: string) => string | undefined): boolean {
  return env("COMPANY_BRAIN_CLIENTS_ENABLED") === "true";
}

/**
 * The scope a request asked for, explicitly. No client_id and no client scope
 * is the agency Brain (today's behaviour). `scope: "client"` without a valid
 * client_id is refused, never defaulted.
 */
export function resolveBrainScope(body: { scope?: unknown; client_id?: unknown } | null | undefined):
  { ok: true; scope: BrainScope } | { ok: false; outcome: "client_context_required" | "invalid_scope" } {
  const scope = body?.scope;
  const clientId = body?.client_id;
  if (scope !== undefined && scope !== null && scope !== "agency" && scope !== "client") return { ok: false, outcome: "invalid_scope" };
  const hasClient = clientId !== undefined && clientId !== null && clientId !== "";
  if (hasClient && (typeof clientId !== "string" || !UUID.test(clientId))) return { ok: false, outcome: "invalid_scope" };
  if (scope === "agency" && hasClient) return { ok: false, outcome: "invalid_scope" };
  if (scope === "client" || hasClient) {
    return hasClient ? { ok: true, scope: { kind: "client", clientId: clientId as string } } : { ok: false, outcome: "client_context_required" };
  }
  return { ok: true, scope: { kind: "agency" } };
}

// The functions take uuids, integers and bigints; a GET passes every argument
// as a query parameter, so absent ones are omitted rather than sent as "null".
function actorArgs(a: ClientBrainActor): Record<string, unknown> {
  const args: Record<string, unknown> = {
    p_workspace_id: a.workspaceId, p_client_id: a.clientId, p_actor_id: a.actorId, p_session_id: a.sessionId,
  };
  const intent = a.intent ?? "interactive";
  args.p_intent = intent;
  if (intent === "task") {
    if (!a.pins) throw new Error("clientBrain: a task must pass its grant and permission pins");
    args.p_pin_grant_id = a.pins.grantId;
    args.p_pin_generation = a.pins.generation;
    args.p_pin_revision = a.pins.permissionRevision;
  } else if (a.pins) {
    throw new Error("clientBrain: pins belong to tasks");
  }
  return args;
}

function asRefusal(v: unknown, fn: string): ClientBrainRefusal {
  const s = String(v ?? "");
  if (!REFUSALS.includes(s)) throw new Error(`${fn}: unexpected result ${JSON.stringify(v)}`);
  return s as ClientBrainRefusal;
}

function early(a: ClientBrainActor): ClientBrainRefusal | null {
  if (!a.clientId) return "client_context_required";
  if (!a.sessionId) return "session_invalid";
  return null;
}

/** The read-only rule (a GET). */
export async function clientBrainAuthorization(admin: Admin, a: ClientBrainActor, permission: ClientBrainPermission): Promise<"ok" | ClientBrainRefusal> {
  const refused = early(a);
  if (refused) return refused;
  // Arguments built from actorArgs are passed as a variable (the schema-compat
  // sweep checks literal objects only); the client contract tests call these
  // functions for real.
  const args = { ...actorArgs(a), p_permission: permission };
  const { data, error } = await admin.rpc("client_brain_authorization", args, { get: true });
  if (error) throw error;
  return data === "ok" ? "ok" : asRefusal(data, "client_brain_authorization");
}

export interface ClientBrainRow { profile: Record<string, unknown> | null; version: number | null; onboarding_completed: boolean; updated_at: string | null }

/** A client's Brain, only on an authorized read; never another scope's. */
export async function readClientBrain(admin: Admin, a: ClientBrainActor):
  Promise<{ outcome: "ok"; brain: ClientBrainRow } | { outcome: ClientBrainRefusal }> {
  const refused = early(a);
  if (refused) return { outcome: refused };
  const { data, error } = await admin.rpc("client_brain_read", actorArgs(a), { get: true });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (row?.outcome !== "ok") return { outcome: asRefusal(row?.outcome, "client_brain_read") };
  return {
    outcome: "ok",
    brain: {
      profile: (row.profile ?? null) as Record<string, unknown> | null,
      version: row.version == null ? null : Number(row.version),
      onboarding_completed: row.onboarding_completed === true,
      updated_at: (row.updated_at ?? null) as string | null,
    },
  };
}

/** What a task records at authorization time (an interactive read of the grant and revision). */
export async function pinClientBrain(admin: Admin, a: Omit<ClientBrainActor, "intent" | "pins">, permission: ClientBrainPermission):
  Promise<{ outcome: "ok"; pins: ClientBrainPins } | { outcome: ClientBrainRefusal }> {
  const refused = early(a);
  if (refused) return { outcome: refused };
  const { data, error } = await admin.rpc("client_brain_pin", {
    p_workspace_id: a.workspaceId, p_client_id: a.clientId, p_actor_id: a.actorId, p_session_id: a.sessionId, p_permission: permission,
  }, { get: true });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (row?.outcome !== "ok") return { outcome: asRefusal(row?.outcome, "client_brain_pin") };
  return { outcome: "ok", pins: { grantId: String(row.grant_id), generation: Number(row.generation), permissionRevision: String(row.permission_revision) } };
}

export interface ClientBrainWrite extends ClientBrainActor {
  permission: "edit" | "activate";
  /** 'insert' creates the first version; 'cas' replaces exactly `expectedVersion`. No blind overwrite. */
  mode: "cas" | "insert";
  profile: Record<string, unknown>;
  expectedVersion?: number | null;
  activate?: boolean;
}

export async function writeClientBrain(admin: Admin, w: ClientBrainWrite): Promise<{ outcome: ClientBrainOutcome; version: number | null }> {
  // 1. Read-only check (a GET): an already-refused caller sends no write request.
  const pre = await clientBrainAuthorization(admin, w, w.permission);
  if (pre !== "ok") return { outcome: pre, version: null };
  // 2. The locked writer re-applies the same rule in the write's transaction.
  const args = {
    ...actorArgs(w),
    p_permission: w.permission,
    p_mode: w.mode,
    p_profile: w.profile,
    p_expected_version: w.expectedVersion ?? null,
    p_activate: w.activate === true,
  };
  const { data, error } = await admin.rpc("client_brain_authorized_write", args);
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string; version?: number | string | null } | null;
  const outcome = row?.outcome;
  if (outcome === "ok" || outcome === "stale") return { outcome, version: row?.version == null ? null : Number(row.version) };
  return { outcome: asRefusal(outcome, "client_brain_authorized_write"), version: null };
}

/**
 * The Brain profile an agent run may use, for exactly the scope it was given.
 * Client scope goes through the authorized client read (a task passes its
 * pins); there is no path from a client scope to the agency Brain, and the
 * agency path is the caller's existing agency reader, unchanged.
 */
export async function clientBrainContextForScope(
  admin: Admin,
  scope: BrainScope,
  a: Omit<ClientBrainActor, "clientId">,
): Promise<{ outcome: "ok"; scope: "client"; clientId: string; version: number | null; profile: Record<string, unknown> } | { outcome: ClientBrainRefusal } | { outcome: "agency_scope" }> {
  if (scope.kind === "agency") return { outcome: "agency_scope" };
  const r = await readClientBrain(admin, { ...a, clientId: scope.clientId });
  if (r.outcome !== "ok") return r;
  return { outcome: "ok", scope: "client", clientId: scope.clientId, version: r.brain.version, profile: r.brain.profile ?? {} };
}

/**
 * The client switcher's list: only the ACTIVE clients this actor holds an
 * active grant for, on a live session (client_accounts_for_actor). Ids and
 * names only — never grant ids, other clients or a reason. Empty when the
 * session or membership is gone.
 */
export async function listClientsForActor(admin: Admin, a: { workspaceId: string; actorId: string; sessionId: string | null }):
  Promise<{ client_id: string; name: string }[]> {
  if (!a.sessionId) return [];
  const args = { p_workspace_id: a.workspaceId, p_actor_id: a.actorId, p_session_id: a.sessionId };
  const { data, error } = await admin.rpc("client_accounts_for_actor", args, { get: true });
  if (error) throw error;
  return ((data ?? []) as { client_id?: unknown; name?: unknown }[])
    .filter((r) => typeof r.client_id === "string" && typeof r.name === "string")
    .map((r) => ({ client_id: r.client_id as string, name: r.name as string }));
}

/** HTTP status and body for a refusal. Unknown and ungranted clients look the same (O1). */
export function clientBrainRefusal(outcome: ClientBrainRefusal | "invalid_scope"): { status: number; body: Record<string, unknown> } {
  switch (outcome) {
    case "session_invalid": return { status: 401, body: { error: "Unauthorized", reason: "session_invalid" } };
    case "client_context_required": return { status: 400, body: { error: "client_context_required" } };
    case "invalid_scope": return { status: 400, body: { error: "invalid_scope" } };
    case "not_member": return { status: 403, body: { error: "forbidden", reason: "not_member" } };
    case "forbidden_role": return { status: 403, body: { error: "brain_role_forbidden", reason: "role" } };
    case "no_grant": return { status: 403, body: { error: "client_forbidden", reason: "no_grant" } };
    case "client_archived": return { status: 403, body: { error: "client_forbidden", reason: "client_archived" } };
    case "grant_changed": return { status: 403, body: { error: "client_forbidden", reason: "grant_changed" } };
    case "permission_changed": return { status: 403, body: { error: "client_forbidden", reason: "permission_changed" } };
  }
}
