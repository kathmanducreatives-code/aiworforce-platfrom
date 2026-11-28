// MonitoringPlansPanel — monitoring plans and scan history on the Signals page (Signals recovery).
// Draft → Approve / Reject → Activate (starts recurring monitoring) → Pause, and "Run once" for an
// approved or active plan. Every transition is the database function monitoring_plan_decide (role
// checked there); Run once is lisa-monitor run_plan (role + approval + provider checked there).
// Outcomes are stated exactly: a disabled engine or a missing provider is never shown as success.

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, CircleSlash, Pause, Play, Radar } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { useMonitoringPlans, MonitoringPlanRow, PlanDecision } from '@/hooks/useMonitoringPlans';
import { categoryLabel } from '@/lib/monitoringPlanView';

interface Props {
  workspaceId: string | null;
  monitoring: ReturnType<typeof useMonitoringPlans>;
  accentHex: string;
  agentName: string;
}
interface ScanRun { run_key: string; subject_key: string; trigger: string; status: string; counts: Record<string, unknown>; credits: number; error: string | null; started_at: string; finished_at: string | null }

const RUN_ERRORS: Record<string, string> = {
  lisa_v2_disabled: 'The signal engine (LISA) is not enabled on this project yet. Nothing ran.',
  provider_not_configured: 'No signal provider is configured for this workspace. Nothing ran and nothing was charged.',
  plan_not_approved: 'Approve the plan first. Nothing ran.',
  plan_not_collectable: 'LISA cannot collect these categories yet. Nothing ran.',
  lisa_role_forbidden: 'Only an owner, admin or editor can run a plan.',
};

export default function MonitoringPlansPanel({ workspaceId, monitoring, accentHex, agentName }: Props) {
  const { plans, available, decide } = monitoring;
  const [busy, setBusy] = useState<string | null>(null);
  const [runs, setRuns] = useState<ScanRun[] | null>(null);

  const loadRuns = useCallback(async () => {
    if (!workspaceId) return;
    const { data, error } = await supabase.from('lisa_scan_runs' as never)
      .select('run_key, subject_key, trigger, status, counts, credits, error, started_at, finished_at')
      .eq('workspace_id', workspaceId).order('started_at', { ascending: false }).limit(5);
    setRuns(error ? null : ((data ?? []) as unknown as ScanRun[]));
  }, [workspaceId]);
  useEffect(() => { void loadRuns(); }, [loadRuns]);

  const act = async (plan: MonitoringPlanRow, decision: PlanDecision) => {
    setBusy(`${plan.id}:${decision}`);
    try {
      const r = await decide(plan.id, decision);
      (r.ok ? toast.success : toast.error)(r.ok ? `${plan.title}: ${decision === 'activate' ? 'monitoring activated' : decision + 'd'}` : r.message);
    } finally { setBusy(null); }
  };

  const runOnce = async (plan: MonitoringPlanRow) => {
    if (!workspaceId) return;
    setBusy(`${plan.id}:run`);
    try {
      const { data, error } = await supabase.functions.invoke('lisa-monitor', {
        body: { action: 'run_plan', workspace_id: workspaceId, plan_id: plan.id, request_id: `ui_${crypto.randomUUID().replace(/-/g, '')}` },
      });
      let body = data as Record<string, unknown> | null;
      if (error) {
        try { body = await (error as { context?: { json(): Promise<Record<string, unknown>> } }).context?.json() ?? null; } catch { body = null; }
      }
      const code = String(body?.error ?? '');
      if (!body?.ok) {
        toast.error('Plan did not run', { description: RUN_ERRORS[code] ?? (code ? `${code}. Nothing ran.` : 'The signal engine could not be reached. Nothing ran.') });
        return;
      }
      const res = (body.result ?? {}) as { status?: string; counts?: Record<string, number> };
      const stored = Number(res.counts?.stored ?? res.counts?.events ?? 0);
      toast.success(`${agentName} ran "${plan.title}"`, {
        description: `${body.mode === 'fixture' ? 'Fixture mode — test data, not market evidence. ' : ''}${stored} signal${stored === 1 ? '' : 's'} stored (status: ${res.status ?? 'unknown'}).`,
      });
      await loadRuns();
    } finally { setBusy(null); }
  };

  if (available === false) {
    return (
      <section className="mb-4 rounded-xl border border-white/[0.06] p-3 text-[12.5px] text-muted-foreground" data-testid="monitoring-plans-unavailable">
        Monitoring plans are not enabled on this project yet, so nothing is being monitored. Ask {agentName} in Watch mode to describe a plan.
      </section>
    );
  }
  if (!plans.length && !(runs && runs.length)) return null;

  return (
    <section className="mb-5 space-y-2" aria-label="Monitoring plans" data-testid="monitoring-plans">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em]" style={{ color: `${accentHex}CC` }}>Monitoring plans</p>
      {plans.filter((p) => p.status !== 'rejected').map((p) => {
        const usage = p.estimated_usage as { max_credits_per_scan?: number; max_credits_per_week?: number };
        return (
          <article key={p.id} className="rounded-xl border bg-card/30 p-3" style={{ borderColor: `${accentHex}22` }} data-plan-status={p.status}>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[13.5px] font-semibold text-foreground">{p.title}</h4>
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-muted-foreground">{p.status}</span>
              <span className="text-[11.5px] text-muted-foreground">{p.kind === 'icp' ? 'ICP-wide' : 'Named company'} · {p.frequency}</span>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {p.signal_categories.map(categoryLabel).join(', ')}
              {usage?.max_credits_per_scan != null ? ` · up to ${usage.max_credits_per_scan} credits per scan, ${usage.max_credits_per_week ?? '?'} per week` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
              {p.status === 'draft' && <>
                <button disabled={!!busy} onClick={() => void act(p, 'approve')} className="inline-flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 hover:bg-white/5 disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" /> Approve</button>
                <button disabled={!!busy} onClick={() => void act(p, 'reject')} className="inline-flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 text-muted-foreground hover:bg-white/5 disabled:opacity-50"><CircleSlash className="h-3.5 w-3.5" /> Reject</button>
              </>}
              {(p.status === 'approved' || p.status === 'paused') && (
                <button disabled={!!busy} onClick={() => void act(p, 'activate')} className="inline-flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 hover:bg-white/5 disabled:opacity-50"><CalendarClock className="h-3.5 w-3.5" /> Activate recurring monitoring</button>
              )}
              {p.status === 'active' && (
                <button disabled={!!busy} onClick={() => void act(p, 'pause')} className="inline-flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 hover:bg-white/5 disabled:opacity-50"><Pause className="h-3.5 w-3.5" /> Pause</button>
              )}
              {(p.status === 'approved' || p.status === 'active') && (
                <button disabled={!!busy} onClick={() => void runOnce(p)} className="inline-flex h-7 items-center gap-1 rounded-md border border-white/10 px-2 hover:bg-white/5 disabled:opacity-50"><Play className="h-3.5 w-3.5" /> {busy === `${p.id}:run` ? 'Running…' : 'Run once'}</button>
              )}
            </div>
          </article>
        );
      })}
      {runs && runs.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] p-3" data-testid="scan-history">
          <p className="mb-1 inline-flex items-center gap-1 text-[11.5px] uppercase tracking-wide text-muted-foreground"><Radar className="h-3.5 w-3.5" /> Recent scans</p>
          <ul className="space-y-1 text-[12px] text-foreground/80">
            {runs.map((r) => (
              <li key={r.run_key}>
                {new Date(r.started_at).toLocaleString()} · {r.subject_key.replace(/^market:/, 'ICP ')} · {r.status}
                {typeof r.counts?.stored === 'number' ? ` · ${r.counts.stored} stored` : ''} · {r.credits} credits{r.error ? ` · ${r.error}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
