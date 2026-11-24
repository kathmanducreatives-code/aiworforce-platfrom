// The live Workforce V2 dashboard. FEATURE-FLAGGED: routed only when
// VITE_WORKFORCE_DASHBOARD_ENABLED=true, and its endpoint answers only when
// WORKFORCE_DASHBOARD_ENABLED=true. Every number comes from the workspace's own
// records; a section whose table could not be read says "unavailable" rather
// than showing zero. Fictional data lives only at /dev/collaboration.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { supabase } from '@/integrations/supabase/client';
import type { WorkforceDashboard as Model } from '../../supabase/functions/_shared/workforceDashboard';

const usd = (x: number | null) => (x == null ? 'unavailable' : `$${x.toFixed(2)}`);
const num = (x: number | null) => (x == null ? '—' : String(x));

function Section({ title, available = true, children, testId }: { title: string; available?: boolean; children: React.ReactNode; testId: string }) {
  return (
    <section className="rounded-xl border border-white/10 p-4" data-testid={testId}>
      <h2 className="mb-2 text-sm font-semibold">{title}{!available && <Badge variant="outline" className="ml-2">unavailable</Badge>}</h2>
      {children}
    </section>
  );
}

export default function WorkforceDashboard() {
  const { workspaceId } = useWorkspace();
  const [data, setData] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await supabase.functions.invoke('workforce-dashboard', { body: { workspace_id: workspaceId } });
    setLoading(false);
    if (err || !res?.ok) { setError(res?.error ?? err?.message ?? 'Could not load the dashboard.'); return; }
    setData(res.dashboard as Model);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6" data-testid="workforce-dashboard">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">AI workforce</h1>
          <p className="text-xs text-muted-foreground">Live from your workspace records{data ? ` · ${new Date(data.generated_at).toLocaleString()}` : ''}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="mr-1 h-4 w-4" aria-hidden /> Refresh
        </Button>
      </header>
      {error && <p className="text-sm text-rose-300" role="alert">{error}</p>}
      {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && (
        <>
          <Section title="ORION brief" testId="orion-brief">
            <ul className="list-disc space-y-1 pl-5 text-sm">{data.orion_brief.map((b) => <li key={b}>{b}</li>)}</ul>
          </Section>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="departments">
            {data.departments.map((d) => (
              <div key={d.id} className="rounded-xl border border-white/10 p-3 text-sm">
                <div className="font-semibold">{d.name}</div>
                <div className="text-xs text-muted-foreground">{d.title}</div>
                <div className="mt-2 text-xs">Working on {num(d.current)} · done {num(d.completed_7d)} · failed {num(d.failed_7d)} (7 days)</div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Section title="Awaiting your approval" available={data.availability.approvals === 'live'} testId="approvals">
              {data.pending_approvals.length === 0 ? <p className="text-xs text-muted-foreground">Nothing waiting.</p>
                : <ul className="space-y-1 text-xs">{data.pending_approvals.map((a) => <li key={a.id}>{a.title} <span className="text-muted-foreground">({a.type})</span></li>)}</ul>}
              <p className="mt-2 text-xs text-muted-foreground">Agent handoffs awaiting review: {num(data.handoffs.awaiting_you)}</p>
            </Section>
            <Section title="Spend (7 days)" available={data.availability.spend === 'live'} testId="spend">
              <div className="text-xs">Actual {usd(data.spend.actual_usd_7d)} · estimated {usd(data.spend.estimated_usd_7d)}</div>
              <div className="text-xs text-muted-foreground">{num(data.spend.calls_7d)} model calls, {num(data.spend.retried_calls_7d)} retries, {num(data.spend.unpriced_calls_7d)} unpriced</div>
            </Section>
            <Section title="Current work" available={data.availability.tasks === 'live'} testId="current-tasks">
              {data.current_tasks.length === 0 ? <p className="text-xs text-muted-foreground">No tasks running.</p>
                : <ul className="space-y-1 text-xs">{data.current_tasks.map((t) => <li key={t.id}>{t.department}: {t.title} — {t.status}</li>)}</ul>}
            </Section>
            <Section title="Recently completed" available={data.availability.tasks === 'live'} testId="completed-tasks">
              {data.completed_tasks.length === 0 ? <p className="text-xs text-muted-foreground">Nothing completed yet.</p>
                : <ul className="space-y-1 text-xs">{data.completed_tasks.map((t) => <li key={t.id}>{t.department}: {t.title}</li>)}</ul>}
            </Section>
            <Section title="Failures and retries" available={data.availability.tasks === 'live'} testId="failures">
              {data.failures.length === 0 ? <p className="text-xs text-muted-foreground">No recent failures.</p>
                : <ul className="space-y-1 text-xs">{data.failures.map((f) => <li key={f.id}>{f.department}: {f.title} — {f.error} <Badge variant="outline">{f.retry.replace('_', ' ')}</Badge></li>)}</ul>}
            </Section>
            <Section title="Findings and Company Brain" available={data.availability.signals === 'live'} testId="findings">
              <div className="text-xs">LISA signals this week: {num(data.findings.signals_7d)} · verified {num(data.findings.verified_7d)} · contradicted {num(data.findings.contradicted_7d)}</div>
              <div className="text-xs">Company Brain: {data.brain.status} · learning proposals to review: {num(data.brain.pending_proposals)}</div>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
