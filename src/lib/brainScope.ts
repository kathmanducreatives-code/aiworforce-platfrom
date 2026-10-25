// Which Company Brain the page is editing: the agency's own, or one client's
// (Phase 3c, held; off unless VITE_CLIENT_BRAINS === 'true').
//
// The client is always EXPLICIT: it travels as `scope: 'client'` + `client_id`
// on every request, and the server refuses a client request without one. There
// is no "current client" default, no first/latest client, and a workspace
// switch drops the selection. Unsaved text belongs to the Brain it was typed
// for: the autosave buffer key includes the scope, so switching clients never
// carries one client's answers into another.
//
// Pure. No React, no network.

export type BrainScope = { kind: 'agency' } | { kind: 'client'; clientId: string };

export const AGENCY_SCOPE: BrainScope = { kind: 'agency' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clientBrainsUiEnabled(env: Record<string, unknown> = (import.meta as { env?: Record<string, unknown> }).env ?? {}): boolean {
  return env.VITE_CLIENT_BRAINS === 'true';
}

/** A client scope only for a well-formed id; anything else is not a scope at all. */
export function clientScope(clientId: unknown): BrainScope | null {
  return typeof clientId === 'string' && UUID.test(clientId) ? { kind: 'client', clientId } : null;
}

/** The request fields that name the scope. The agency adds nothing (today's requests, unchanged). */
export function brainScopeBody(scope: BrainScope): Record<string, string> {
  return scope.kind === 'client' ? { scope: 'client', client_id: scope.clientId } : {};
}

/**
 * Which Brain a page is editing, for one signed-in session: distinct per
 * principal, workspace AND client. Save answers are matched against it, so an
 * answer that arrives after a switch — of client, workspace or user — is dropped.
 */
export function brainScopeKey(workspaceId: string, scope: BrainScope, principal?: BrainPrincipal | null): string {
  const who = principal ? `${principal.userId}:${principal.sessionId}` : '-';
  return scope.kind === 'client' ? `brain:${who}:${workspaceId}:client:${scope.clientId}` : `brain:${who}:${workspaceId}:agency`;
}

/**
 * The scope after the user changes workspace or picks a client. A workspace
 * change always returns to the agency Brain of the new workspace (a client id
 * never crosses workspaces); picking a client only works for a client the
 * server listed for this user (client_accounts_for_actor).
 */
export function nextBrainScope(
  current: { workspaceId: string; scope: BrainScope },
  change: { workspaceId: string } | { pickClient: string | null; listed: readonly string[] },
): { workspaceId: string; scope: BrainScope } {
  if ('workspaceId' in change) {
    return change.workspaceId === current.workspaceId ? current : { workspaceId: change.workspaceId, scope: AGENCY_SCOPE };
  }
  if (change.pickClient === null) return { workspaceId: current.workspaceId, scope: AGENCY_SCOPE };
  const s = clientScope(change.pickClient);
  if (!s || !change.listed.includes(change.pickClient)) return current;
  return { workspaceId: current.workspaceId, scope: s };
}

/** Same Brain? Used to drop a response that arrives after the user switched away. */
export function sameBrainScope(a: BrainScope, b: BrainScope): boolean {
  return a.kind === b.kind && (a.kind === 'agency' || a.clientId === (b as { clientId: string }).clientId);
}

/**
 * The scope actually shown: the requested client only if the server lists it
 * for this user right now. No list (off, failed, still loading) or an unlisted
 * client — revoked, archived, another workspace's — is the agency Brain.
 */
export function effectiveBrainScope(requested: string | null, listed: readonly { clientId: string }[] | null): BrainScope {
  if (!requested || !listed) return AGENCY_SCOPE;
  return listed.some((c) => c.clientId === requested) ? (clientScope(requested) ?? AGENCY_SCOPE) : AGENCY_SCOPE;
}

// ── Whose Brain data this is (CACHE-SESSION, Codex #185) ─────────────────────
// Brain data in the browser — the query cache, the selected client, drafts —
// belongs to ONE signed-in session. A different user, or a new session of the
// same user, must reach the server's authorization again; nothing cached or in
// flight for another login may be served to it.

/** The signed-in user and their session (the access token's `session_id`). */
export interface BrainPrincipal { userId: string; sessionId: string }

let unknownPrincipal = 0;
/**
 * The principal's part of a Brain cache key. With no known principal, a part
 * that matches no other key, ever — an unidentified request never shares a
 * cache entry with anything (fail closed).
 */
export function principalKeyPart(p?: BrainPrincipal | null): string {
  return p?.userId && p?.sessionId ? `${p.userId}:${p.sessionId}` : `no-principal:${++unknownPrincipal}`;
}

/** The principal of a Supabase session, or null when its user or session id is unknown. */
export function principalOfSession(session: { access_token?: string | null; user?: { id?: string | null } | null } | null | undefined): BrainPrincipal | null {
  const userId = session?.user?.id;
  const token = session?.access_token;
  if (!userId || !token) return null;
  try {
    const part = token.split('.')[1] ?? '';
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='))) as { sub?: unknown; session_id?: unknown };
    if (claims.sub !== userId || typeof claims.session_id !== 'string' || !claims.session_id) return null;
    return { userId, sessionId: claims.session_id };
  } catch {
    return null;
  }
}

/**
 * Session-stored Brain state that must not outlive a sign-out or a change of
 * user: every remembered client selection, every client Brain draft (client
 * data, whoever typed it), and the pre-user-scoping guided-setup buffers. An
 * agency draft and a user-keyed guided-setup buffer stay: they restore only for
 * the same user (draft key + envelope check), so a returning user keeps them.
 */
export function brainStorageKeysToPurge(keys: readonly string[]): string[] {
  return keys.filter((k) =>
    k.startsWith('agentory.brainScope.') ||
    (k.startsWith('agentory.company-brain-draft.v1:') && k.includes(':client:')) ||
    /^agentory:guided-setup:[^:]+$/.test(k));
}

/** The guided-setup offline buffer of one user in one workspace. */
export const guidedSetupStorageKey = (userId: string, workspaceId: string) => `agentory:guided-setup:${userId}:${workspaceId}`;
