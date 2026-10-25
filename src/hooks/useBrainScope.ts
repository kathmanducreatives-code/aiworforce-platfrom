// Which Brain the Company Brain page shows (Phase 3c, held; off unless
// VITE_CLIENT_BRAINS === 'true').
//
// The list of clients comes from the server (`list_clients`: only the active
// clients this user holds a grant for). The selection is per workspace, kept
// for this browser session only, and is ALWAYS re-checked against the current
// list: a client that is no longer listed — revoked, archived, another
// workspace's, or a list that could not be read — falls back to the agency
// Brain. Uncertain means agency, never a guessed client.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { clientBrainsUiEnabled, effectiveBrainScope } from '@/lib/brainScope';
import { listBrainClients } from '@/lib/clientBrainApi';
import { invokeBrain } from '@/lib/brainInvoke';

export const brainClientsKey = (workspaceId: string | null) => ['brain_clients', workspaceId] as const;
const storageKey = (workspaceId: string) => `agentory.brainScope.${workspaceId}`;

function readStored(workspaceId: string | null): string | null {
  if (!workspaceId) return null;
  try { return sessionStorage.getItem(storageKey(workspaceId)); } catch { return null; }
}
function writeStored(workspaceId: string, clientId: string | null) {
  try {
    if (clientId) sessionStorage.setItem(storageKey(workspaceId), clientId);
    else sessionStorage.removeItem(storageKey(workspaceId));
  } catch { /* private mode: the selection just isn't remembered */ }
}

export function useBrainScope() {
  const { workspaceId } = useWorkspace();
  const enabled = clientBrainsUiEnabled();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: brainClientsKey(workspaceId),
    enabled: enabled && !!workspaceId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const r = await listBrainClients(invokeBrain, workspaceId!);
      return r.kind === 'ok' ? r.clients : [];
    },
  });
  const clients = enabled && list.isSuccess ? list.data : null;

  // The requested client, per workspace. A workspace switch reads that
  // workspace's own selection; a client id never crosses workspaces.
  const [requested, setRequested] = useState<{ ws: string | null; clientId: string | null }>(() => ({ ws: workspaceId, clientId: readStored(workspaceId) }));
  useEffect(() => {
    if (requested.ws !== workspaceId) setRequested({ ws: workspaceId, clientId: readStored(workspaceId) });
  }, [workspaceId, requested.ws]);

  const scope = useMemo(
    () => effectiveBrainScope(requested.ws === workspaceId ? requested.clientId : null, clients),
    [requested, workspaceId, clients],
  );

  const select = useCallback((clientId: string | null) => {
    if (!workspaceId) return;
    const next = clientId && clients?.some((c) => c.clientId === clientId) ? clientId : null;
    setRequested({ ws: workspaceId, clientId: next });
    writeStored(workspaceId, next);
  }, [workspaceId, clients]);

  /** Access changed (a refusal on read or save): drop the selection and re-read the list. */
  const accessChanged = useCallback(() => {
    if (workspaceId) {
      setRequested({ ws: workspaceId, clientId: null });
      writeStored(workspaceId, null);
    }
    qc.invalidateQueries({ queryKey: brainClientsKey(workspaceId) });
  }, [qc, workspaceId]);

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
