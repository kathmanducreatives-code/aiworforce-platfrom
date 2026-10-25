// Which Brain the Company Brain page shows (Phase 3c, held; off unless
// VITE_CLIENT_BRAINS === 'true').
//
// The list of clients comes from the server (`list_clients`: only the active
// clients this user holds a grant for), cached per signed-in session — never
// shared with another login (CACHE-SESSION, Codex #185). The selection is per
// user and workspace, kept for this browser session only (cleared on
// sign-out), and is ALWAYS re-checked against the current list: a client that is no longer listed — revoked, archived, another
// workspace's, or a list that could not be read — falls back to the agency
// Brain. Uncertain means agency, never a guessed client.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { clientBrainsUiEnabled, effectiveBrainScope, principalKeyPart, type BrainPrincipal } from '@/lib/brainScope';
import { listBrainClients } from '@/lib/clientBrainApi';
import { invokeBrain } from '@/lib/brainInvoke';

/** The switcher list's key: per signed-in session and workspace. Without a principal it matches nothing else. */
export const brainClientsKey = (workspaceId: string | null, principal?: BrainPrincipal | null) =>
  ['brain_clients', principalKeyPart(principal), workspaceId] as const;
const SIGNED_OUT_KEY = ['brain_clients', 'signed-out'] as const;
const storageKey = (userId: string, workspaceId: string) => `agentory.brainScope.${userId}.${workspaceId}`;

function readStored(userId: string | null, workspaceId: string | null): string | null {
  if (!userId || !workspaceId) return null;
  try { return sessionStorage.getItem(storageKey(userId, workspaceId)); } catch { return null; }
}
function writeStored(userId: string, workspaceId: string, clientId: string | null) {
  try {
    if (clientId) sessionStorage.setItem(storageKey(userId, workspaceId), clientId);
    else sessionStorage.removeItem(storageKey(userId, workspaceId));
  } catch { /* private mode: the selection just isn't remembered */ }
}

export function useBrainScope() {
  const { workspaceId, principal } = useWorkspace();
  const userId = principal?.userId ?? null;
  const enabled = clientBrainsUiEnabled();
  const qc = useQueryClient();
  const listKey = principal ? brainClientsKey(workspaceId, principal) : SIGNED_OUT_KEY;
  const list = useQuery({
    queryKey: listKey,
    enabled: enabled && !!workspaceId && !!principal,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const r = await listBrainClients(invokeBrain, workspaceId!);
      return r.kind === 'ok' ? r.clients : [];
    },
  });
  const clients = enabled && list.isSuccess ? list.data : null;

  // The requested client, per user and workspace. A workspace or user switch
  // reads that pair's own selection; a client id never crosses either.
  const [requested, setRequested] = useState<{ ws: string | null; user: string | null; clientId: string | null }>(
    () => ({ ws: workspaceId, user: userId, clientId: readStored(userId, workspaceId) }));
  useEffect(() => {
    if (requested.ws !== workspaceId || requested.user !== userId) {
      setRequested({ ws: workspaceId, user: userId, clientId: readStored(userId, workspaceId) });
    }
  }, [workspaceId, userId, requested.ws, requested.user]);

  const scope = useMemo(
    () => effectiveBrainScope(requested.ws === workspaceId && requested.user === userId ? requested.clientId : null, clients),
    [requested, workspaceId, userId, clients],
  );

  const select = useCallback((clientId: string | null) => {
    if (!workspaceId || !userId) return;
    const next = clientId && clients?.some((c) => c.clientId === clientId) ? clientId : null;
    setRequested({ ws: workspaceId, user: userId, clientId: next });
    writeStored(userId, workspaceId, next);
  }, [workspaceId, userId, clients]);

  /** Access changed (a refusal on read or save): drop the selection and re-read the list. */
  const listKeyId = JSON.stringify(listKey);
  const accessChanged = useCallback(() => {
    if (workspaceId && userId) {
      setRequested({ ws: workspaceId, user: userId, clientId: null });
      writeStored(userId, workspaceId, null);
    }
    qc.invalidateQueries({ queryKey: JSON.parse(listKeyId), exact: true });
  }, [qc, workspaceId, userId, listKeyId]);

  const current = scope.kind === 'client' ? clients?.find((c) => c.clientId === scope.clientId) ?? null : null;
  return {
    /** Show the switcher only when there is a choice to make. */
    available: enabled && !!clients && clients.length > 0,
    clients: clients ?? [],
    scope,
    currentClient: current,
    select,
    accessChanged,
  };
}
