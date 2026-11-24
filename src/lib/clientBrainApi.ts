// Client Brain requests from the page (Phase 3c, held; off unless
// VITE_CLIENT_BRAINS === 'true').
//
// Pure: every call takes `invoke`, the function that sends a body to
// generate-company-brain-draft and returns the response body (the page wraps
// supabase.functions.invoke; the database-contract lane drives the actual
// handler with it). Every answer the server did not clearly give is a refusal:
// an unreadable list is "no clients", an unreadable Brain is "denied".

import { brainScopeBody, clientScope, type BrainScope } from './brainScope';

export type BrainInvoke = (body: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
export type BrainProfile = Record<string, unknown>;

export interface BrainClient { clientId: string; name: string }

/** The switcher's list: the clients this user is granted, or nothing. */
export async function listBrainClients(invoke: BrainInvoke, workspaceId: string):
  Promise<{ kind: 'ok'; clients: BrainClient[] } | { kind: 'off' } | { kind: 'failed' }> {
  let body: Record<string, unknown> | null;
  try { body = await invoke({ action: 'list_clients', workspace_id: workspaceId }); } catch { return { kind: 'failed' }; }
  if (body?.error === 'client_brains_disabled') return { kind: 'off' };
  if (body?.ok !== true || !Array.isArray(body.clients)) return { kind: 'failed' };
  const clients: BrainClient[] = [];
  for (const c of body.clients as { client_id?: unknown; name?: unknown }[]) {
    if (clientScope(c?.client_id) && typeof c.name === 'string' && c.name.trim()) clients.push({ clientId: c.client_id as string, name: c.name.trim() });
  }
  return { kind: 'ok', clients };
}

export interface ClientBrainRow {
  profile: BrainProfile;
  onboarding_completed: boolean;
  /** The client Brain's integer version; null before its first save. */
  version: number | null;
}

/** Why a client Brain is not shown. Unknown and ungranted clients look the same. */
export type ClientBrainDenial = 'no_grant' | 'client_archived' | 'not_member' | 'session_invalid' | 'disabled' | 'unknown';

export async function loadClientBrain(invoke: BrainInvoke, workspaceId: string, clientId: string):
  Promise<{ kind: 'ok'; row: ClientBrainRow } | { kind: 'denied'; reason: ClientBrainDenial }> {
  let body: Record<string, unknown> | null;
  try {
    body = await invoke({ action: 'status', workspace_id: workspaceId, scope: 'client', client_id: clientId });
  } catch {
    return { kind: 'denied', reason: 'unknown' };
  }
  if (body?.ok === true && body.client_id === clientId) {
    return {
      kind: 'ok',
      row: {
        profile: (body.profile ?? {}) as BrainProfile,
        onboarding_completed: body.onboarding_completed === true,
        version: typeof body.version === 'number' ? body.version : null,
      },
    };
  }
  return { kind: 'denied', reason: denialOf(body) };
}

function denialOf(body: Record<string, unknown> | null): ClientBrainDenial {
  if (body?.error === 'client_brains_disabled') return 'disabled';
  const r = body?.reason;
  return r === 'no_grant' || r === 'client_archived' || r === 'not_member' || r === 'session_invalid' ? r : 'unknown';
}

export interface BrainPatchResult {
  ok: boolean;
  profile?: BrainProfile;
  /** The new version token: updated_at (agency) or the integer version as a string (client). */
  version?: string;
  /** Changed elsewhere since it was loaded: reload and redo the edit. */
  conflict?: boolean;
  /** Access to this Brain is gone (revoked, archived, signed out): leave it. */
  denied?: ClientBrainDenial;
  message?: string;
}

/**
 * The manual-edit request for either Brain. Agency: today's body exactly. A
 * client Brain with no version yet has no row to edit, so its first edit is a
 * manual-edit save that creates version 1 (and is refused if one now exists).
 */
export function buildBrainUpdateBody(input: { workspaceId: string; scope: BrainScope; patch: BrainProfile; expectedVersion: string | null }): Record<string, unknown> {
  if (input.scope.kind === 'client' && input.expectedVersion === null) {
    return { action: 'save_draft', workspace_id: input.workspaceId, ...brainScopeBody(input.scope),
      patch: input.patch, change_origin: 'manual_edit', expected_version: null };
  }
  const body: Record<string, unknown> = { action: 'update', workspace_id: input.workspaceId, patch: input.patch };
  if (input.scope.kind === 'agency') body.expected_updated_at = input.expectedVersion;
  else Object.assign(body, brainScopeBody(input.scope), { expected_version: input.expectedVersion === null ? null : Number(input.expectedVersion) });
  return body;
}

export function readBrainUpdateResponse(scope: BrainScope, body: Record<string, unknown> | null, errorMessage?: string): BrainPatchResult {
  if (body?.ok === true) {
    const version = scope.kind === 'agency'
      ? (typeof body.updated_at === 'string' ? body.updated_at : undefined)
      : (typeof body.version === 'number' && body.client_id === scope.clientId ? String(body.version) : undefined);
    if (version) return { ok: true, profile: (body.profile ?? {}) as BrainProfile, version };
  }
  if (body?.rejected_reason === 'stale') {
    return { ok: false, conflict: true, message: 'This Brain was changed elsewhere. Showing the latest version — please make your change again.' };
  }
  if (scope.kind === 'client') {
    const denied = denialOf(body);
    if (denied !== 'unknown') return { ok: false, denied, message: DENIAL_TEXT[denied] };
  }
  const reason = typeof body?.detail === 'string' ? body.detail : typeof body?.rejected_reason === 'string' ? body.rejected_reason : errorMessage;
  return { ok: false, conflict: false, message: reason || 'Save failed' };
}

export const DENIAL_TEXT: Record<ClientBrainDenial, string> = {
  no_grant: 'You no longer have access to this client.',
  client_archived: 'This client has been archived.',
  not_member: 'You are no longer a member of this workspace.',
  session_invalid: 'Your session has ended. Please sign in again.',
  disabled: 'Client Brains are not available.',
  unknown: 'This client Brain could not be opened.',
};
