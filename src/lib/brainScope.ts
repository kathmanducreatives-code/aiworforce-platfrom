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

/** Where this scope's unsaved onboarding answers are buffered. Distinct per workspace AND per client. */
export function brainScopeKey(workspaceId: string, scope: BrainScope): string {
  return scope.kind === 'client' ? `brain:${workspaceId}:client:${scope.clientId}` : `brain:${workspaceId}:agency`;
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
