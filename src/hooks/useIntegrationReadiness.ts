import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { withProviderAliases, type IntegrationStatus, type IntegrationEntry } from '@/lib/providerReadiness';

// Re-exported from the pure module so existing importers keep working.
export type { IntegrationStatus, IntegrationEntry };

export interface ReadinessSummary {
  connected: number;
  setup_needed: number;
  optional: number;
}

interface CacheEntry {
  providers: Record<string, IntegrationEntry>;
  summary: ReadinessSummary;
  at: number;
}

const CACHE_TTL = 60_000;
const cache = new Map<string, CacheEntry>();

export function useIntegrationReadiness() {
  const { workspaceId } = useWorkspace();
  const [providers, setProviders] = useState<Record<string, IntegrationEntry>>({});
  const [summary, setSummary] = useState<ReadinessSummary>({ connected: 0, setup_needed: 0, optional: 0 });
  const [loading, setLoading] = useState(false);
  const inflight = useRef<Promise<void> | null>(null);

  const load = useCallback(async (force = false) => {
    if (!workspaceId) return;
    const cached = cache.get(workspaceId);
    if (!force && cached && Date.now() - cached.at < CACHE_TTL) {
      setProviders(cached.providers);
      setSummary(cached.summary);
      return;
    }
    if (inflight.current) return inflight.current;
    setLoading(true);
    inflight.current = (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('integration-readiness', {
          body: { workspace_id: workspaceId },
        });
        if (error) throw error;
        const raw = ((data as any)?.providers ?? {}) as Record<string, IntegrationEntry>;
        const p = withProviderAliases(raw);
        const s = ((data as any)?.summary ?? { connected: 0, setup_needed: 0, optional: 0 }) as ReadinessSummary;
        cache.set(workspaceId, { providers: p, summary: s, at: Date.now() });
        setProviders(p);
        setSummary(s);
      } catch {
        // soft-fail; leave previous state in place
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, [workspaceId]);

  useEffect(() => { void load(false); }, [load]);

  return { providers, summary, loading, refresh: () => load(true) };
}
