// The ONE way a Company Brain handler writes the Brain (AUTH-06).
//
// The handlers authorize when a request starts (and refuse there, before any
// model or provider call). That first check is not enough on its own: a
// membership removal, a demotion or a logout can commit while the request is
// in flight. So the write itself goes through
// public.company_brain_authorized_write, which re-checks the caller's live
// session, current membership and current role in the SAME transaction as the
// write, under row locks (see migration 20261024120000). A refusal changes
// nothing.
//
// The session id comes from the caller's access token, which getUser has
// already verified with the Auth server; a token with no session (a service
// key, an anon key) cannot write a Brain.

type RpcResult = { data: unknown; error: { message: string } | null };
type Admin = { rpc: (fn: string, args: Record<string, unknown>, opts?: { get?: boolean }) => PromiseLike<RpcResult> };

export type BrainPermissionToWrite = "edit" | "activate";
export type BrainWriteMode = "cas" | "insert" | "upsert";
export type BrainWriteOutcome = "ok" | "session_invalid" | "not_member" | "forbidden_role" | "stale";

/** The `session_id` claim of a bearer token getUser has already verified, or null. */
export function sessionIdFromBearer(authHeader: string | null | undefined): string | null {
  const token = (authHeader ?? "").replace(/^Bearer\s+/i, "");
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const sid = (JSON.parse(json) as { session_id?: unknown }).session_id;
    return typeof sid === "string" && /^[0-9a-f-]{36}$/i.test(sid) ? sid : null;
  } catch {
    return null;
  }
}

export interface AuthorizedBrainWrite {
  workspaceId: string;
  actorId: string;
  sessionId: string | null;
  permission: BrainPermissionToWrite;
  mode: BrainWriteMode;
  profile: Record<string, unknown>;
  expectedUpdatedAt?: string | null;
  activate?: boolean;
  /**
   * B2.2: where this change came from, decided by SERVER code (never taken from
   * the request as-is). Recorded on the revision by company_brain_provenanced_write,
   * which also checks a research run or memory item against the database.
   */
  provenance?: BrainProvenance | null;
}

export type BrainSourceKind = "founder" | "research" | "memory" | "ai_inference";
export interface BrainProvenance {
  kind: BrainSourceKind;
  /** The research run id (research) or memory item id (memory); null otherwise. */
  ref?: string | null;
  reason?: string | null;
}

/** The provenanced writer is absent where the held B2.2 migration is not applied. */
const provenanceUnavailable = (e: { message?: string; code?: string } | null) =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || (/company_brain_provenanced_write/.test(e.message ?? "") && /(not find|does not exist|schema cache)/i.test(e.message ?? "")));

export async function authorizedBrainWrite(admin: Admin, w: AuthorizedBrainWrite): Promise<{ outcome: BrainWriteOutcome; updated_at: string | null }> {
  if (!w.sessionId) return { outcome: "session_invalid", updated_at: null };
  // 1. Read-only check (a GET): a caller whose access was already revoked is
  //    refused before any write request is sent.
  const check = await admin.rpc("company_brain_write_authorization", {
    p_workspace_id: w.workspaceId, p_actor_id: w.actorId, p_session_id: w.sessionId, p_permission: w.permission,
  }, { get: true });
  if (check.error) throw check.error;
  const pre = String(check.data ?? "");
  if (pre !== "ok") {
    if (!["session_invalid", "not_member", "forbidden_role"].includes(pre)) {
      throw new Error(`company_brain_write_authorization: unexpected result ${JSON.stringify(check.data)}`);
    }
    return { outcome: pre as BrainWriteOutcome, updated_at: null };
  }
  // 2. The write, which locks the session and membership rows and applies the
  //    same rule again in its own transaction — closing the window between the
  //    check above and this write.
  const args = {
    p_workspace_id: w.workspaceId,
    p_actor_id: w.actorId,
    p_session_id: w.sessionId,
    p_permission: w.permission,
    p_mode: w.mode,
    p_profile: w.profile,
    p_expected_updated_at: w.expectedUpdatedAt ?? null,
    p_activate: w.activate === true,
  };
  let res: RpcResult | null = null;
  if (w.provenance) {
    res = await admin.rpc("company_brain_provenanced_write", {
      ...args,
      p_source_kind: w.provenance.kind,
      p_source_ref: w.provenance.ref ?? null,
      p_reason: w.provenance.reason?.trim() ? w.provenance.reason.trim().slice(0, 500) : null,
    });
    // An environment without the held B2.2 migration: the same authorized write,
    // with the revision marked 'unrecorded' (never a guessed source).
    if (res.error && provenanceUnavailable(res.error)) res = null;
  }
  const { data, error } = res ?? await admin.rpc("company_brain_authorized_write", args);
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string; updated_at?: string | null } | null;
  const outcome = (row?.outcome ?? "") as BrainWriteOutcome;
  if (!["ok", "session_invalid", "not_member", "forbidden_role", "stale"].includes(outcome)) {
    throw new Error(`company_brain_authorized_write: unexpected outcome ${JSON.stringify(row)}`);
  }
  return { outcome, updated_at: row?.updated_at ?? null };
}

/** HTTP status and body for a refused write. `stale` is the caller's to word (it differs per action). */
export function brainWriteRefusal(outcome: Exclude<BrainWriteOutcome, "ok" | "stale">): { status: number; body: Record<string, unknown> } {
  if (outcome === "session_invalid") return { status: 401, body: { error: "Unauthorized", reason: "session_invalid" } };
  if (outcome === "not_member") return { status: 403, body: { error: "forbidden", reason: "not_member" } };
  return { status: 403, body: { error: "brain_role_forbidden", reason: "role_changed" } };
}
