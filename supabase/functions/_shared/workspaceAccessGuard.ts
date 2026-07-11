// Workspace access decision for edge functions that accept a request-supplied
// `workspace_id` (e.g. run-agent's direct lead-action path).
//
// Two legitimate callers exist:
//   * A trusted server (orchestrate) calling with the SERVICE_ROLE bearer — it
//     has already validated JWT + membership, so it is trusted verbatim.
//   * The browser calling with a user JWT — which MUST be checked for membership
//     of the target workspace, so a frontend-supplied workspace_id cannot reach
//     another workspace's Company Brain / leads.
//
// This module is pure (no Supabase, no network) so the decision is unit-tested
// deterministically. The caller does the IO (read header, getUser, query
// workspace_members) and feeds the booleans in.

export interface AccessDecisionInput {
  /** true when the Authorization bearer equals the service-role key. */
  bearerIsServiceRole: boolean;
  /** The user id resolved from a validated JWT, or null if none/invalid. */
  authenticatedUserId: string | null;
  /** Whether that user is a member of the target workspace. */
  isMember: boolean;
}

export type AccessDecision =
  | { ok: true; trusted: boolean }
  | { ok: false; status: number; error: string };

/**
 * Decide whether a caller may act on the target workspace. Fail-closed: a
 * non-service-role caller with no valid user, or one who is not a member, is
 * rejected before any work happens.
 */
export function decideWorkspaceAccess(i: AccessDecisionInput): AccessDecision {
  // Trusted server-to-server (orchestrate already gated the user).
  if (i.bearerIsServiceRole) return { ok: true, trusted: true };
  // A user request must carry a valid JWT.
  if (!i.authenticatedUserId) return { ok: false, status: 401, error: "unauthorized" };
  // …and be a member of the workspace it is targeting.
  if (!i.isMember) return { ok: false, status: 403, error: "forbidden_workspace" };
  return { ok: true, trusted: false };
}
