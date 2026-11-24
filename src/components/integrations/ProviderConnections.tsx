// Lead-data provider connections on Settings → Integrations (provider
// discovery; off unless VITE_PROVIDER_DISCOVERY === 'true').
//
// A key is typed into a password field, sent once to `provider-connections`
// (which verifies it with a free call and stores it in Vault), and the field
// is cleared. The page only ever shows status, capabilities, usage and a short
// fingerprint.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, KeyRound, RefreshCcw, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { invokeFunction } from '@/lib/agentoryApi';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  PROVIDERS, connectionAction, listConnections, statusLabel, usageLine,
  type ConnectionView, type Invoke, type ProviderId,
} from '@/lib/providerDiscovery';

const invoke = invokeFunction as unknown as Invoke;

const CAPABILITY_LABEL: Record<string, string> = {
  company_search: 'Company search', people_search: 'People search', contact_enrichment: 'Contact enrichment',
  web_research: 'Web research', signal_verification: 'Signal verification',
};

const TONE: Record<string, string> = {
  ok: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
  warn: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
  bad: 'bg-red-400/10 text-red-300 border-red-400/20',
  muted: 'bg-white/[0.04] text-muted-foreground border-border',
};

export function ProviderConnections() {
  const { workspaceId } = useWorkspace();
  const key = ['provider_connections', workspaceId] as const;
  const list = useQuery({
    queryKey: key,
    enabled: !!workspaceId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const r = await listConnections(invoke, workspaceId!);
      if (!r.ok) throw new Error(r.error);
      return r.value;
    },
  });

  return (
    <section className="mt-8">
      <header className="mb-3">
        <h2 className="text-[15px] font-semibold text-foreground tracking-tight">Lead data providers</h2>
        <p className="text-[12.5px] text-muted-foreground mt-0.5">
          Connect your own accounts. Atlas uses them only for searches you approve.
        </p>
      </header>
      {list.isError ? (
        <p className="text-xs text-muted-foreground">{(list.error as Error).message}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PROVIDERS.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p.id}
              blurb={p.blurb}
              conn={list.data?.find((c) => c.provider === p.id) ?? null}
              loading={list.isLoading}
              workspaceId={workspaceId}
              queryKey={key}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProviderCard({ provider, blurb, conn, loading, workspaceId, queryKey }: {
  provider: ProviderId; blurb: string; conn: ConnectionView | null; loading: boolean;
  workspaceId: string | null; queryKey: readonly unknown[];
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = PROVIDERS.find((p) => p.id === provider)!.label;
  const status = conn ? statusLabel(conn) : { text: loading ? 'Checking…' : 'Not connected', tone: 'muted' as const };
  const available = !!conn?.enabled && !!conn?.commercialTermsConfirmed;
  const connected = conn?.status === 'connected' || conn?.status === 'invalid' || conn?.status === 'error';

  const act = async (action: 'connect' | 'verify' | 'disconnect') => {
    if (!workspaceId) return;
    setBusy(true); setError(null);
    const r = await connectionAction(invoke, workspaceId, provider, action, action === 'connect' ? apiKey : undefined);
    setApiKey('');  // the key never stays in the page
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setEditing(false);
    qc.setQueryData(queryKey, (old: ConnectionView[] | undefined) => (old ?? []).map((c) => (c.provider === provider ? r.value : c)));
  };

  const usage = usageLine(conn?.usage ?? null);
  return (
    <div className="rounded-2xl border border-border bg-card/50 p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10 text-primary"><Database className="h-4 w-4" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{label}</p>
            <span className={`text-[10.5px] px-1.5 py-0.5 rounded-md border ${TONE[status.tone]}`}>{status.text}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{blurb}</p>
        </div>
      </div>

      {conn && (
        <div className="flex flex-wrap gap-1.5">
          {conn.capabilities.map((c) => (
            <span key={c} className="text-[10.5px] px-1.5 py-0.5 rounded-md bg-white/[0.04] text-muted-foreground">{CAPABILITY_LABEL[c] ?? c}</span>
          ))}
        </div>
      )}

      {connected && (
        <div className="text-[11.5px] text-muted-foreground space-y-0.5">
          {usage && <div>{usage}</div>}
          <div>
            {conn?.keyFingerprint && <span className="font-mono">key ··{conn.keyFingerprint.slice(-6)}</span>}
            {conn?.lastVerifiedAt && <span> · checked {formatDistanceToNowStrict(new Date(conn.lastVerifiedAt))} ago</span>}
          </div>
          {conn?.lastError && <div className="text-amber-300/90">{conn.lastError}</div>}
        </div>
      )}

      {editing && (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void act('connect'); }}>
          <Input
            type="password" autoComplete="off" spellCheck={false} value={apiKey}
            onChange={(e) => setApiKey(e.target.value)} placeholder={`${label} API key`}
            className="h-8 text-[12.5px]" aria-label={`${label} API key`}
          />
          <Button size="sm" type="submit" disabled={busy || apiKey.length < 8} className="h-8">Verify</Button>
        </form>
      )}
      {error && <p className="text-[11.5px] text-red-300/90">{error}</p>}

      <div className="flex items-center gap-2 mt-auto">
        {!connected && !editing && (
          <Button size="sm" variant="secondary" disabled={!available || busy} onClick={() => setEditing(true)} className="h-8 gap-1.5">
            <KeyRound className="h-3.5 w-3.5" /> Connect
          </Button>
        )}
        {connected && (
          <>
            <Button size="sm" variant="ghost" disabled={busy || !available} onClick={() => void act('verify')} className="h-8 gap-1.5 text-muted-foreground">
              <RefreshCcw className="h-3.5 w-3.5" /> Re-check
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)} className="h-8 text-muted-foreground">Replace key</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('disconnect')} className="h-8 gap-1.5 ml-auto text-muted-foreground hover:text-red-300">
              <Unplug className="h-3.5 w-3.5" /> Disconnect
            </Button>
          </>
        )}
        {editing && (
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setApiKey(''); setError(null); }} className="h-8 text-muted-foreground">Cancel</Button>
        )}
      </div>
    </div>
  );
}
