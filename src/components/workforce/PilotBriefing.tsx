import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AgentAvatar from './AgentAvatar';
import { ArrowRight, MessageCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { listRecentRuns, type RecentRun } from '@/lib/workflows/recentRuns';

interface Props {
  totals: { signals: number; outreachDrafts: number; approvals: number; contentDrafts: number };
  /**
   * The dashboard's panel form: the same briefing, next move and actions, sized
   * to sit beside Recent activity and the review queue instead of taking a
   * full-width band of its own.
   */
  compact?: boolean;
}

export default function PilotBriefing({ totals, compact = false }: Props) {
  const navigate = useNavigate();
  const { data: brain } = useCompanyBrain();

  const [recentRuns, setRecentRuns] = useState<RecentRun[]>(() => listRecentRuns());

  useEffect(() => {
    const handleRunRecorded = () => {
      setRecentRuns(listRecentRuns());
    };
    window.addEventListener('workflow:run-recorded', handleRunRecorded);
    return () => window.removeEventListener('workflow:run-recorded', handleRunRecorded);
  }, []);

  const runningRun = useMemo(() => recentRuns.find((r) => r.status === 'running'), [recentRuns]);

  const profile = (brain?.profile || {}) as any;
  const founderName = profile.founder?.name || '';
  const companyName = profile.company?.name || '';
  const firstHelp = profile.founder?.first_help_goal || '';
  const primaryChannel = profile.gtm?.primary_channel || '';
  const channels = profile.gtm?.preferred_channels || [];

  const lines: string[] = [];
  if (totals.signals > 0) lines.push(`Lyra found ${totals.signals} new buying signal${totals.signals === 1 ? '' : 's'}.`);
  if (totals.outreachDrafts > 0) lines.push(`Mira prepared ${totals.outreachDrafts} outreach draft${totals.outreachDrafts === 1 ? '' : 's'}.`);
  if (totals.contentDrafts > 0) lines.push(`Agentory drafted ${totals.contentDrafts} content piece${totals.contentDrafts === 1 ? '' : 's'}.`);
  if (totals.approvals > 0) lines.push(`Pilot needs your approval on ${totals.approvals} item${totals.approvals === 1 ? '' : 's'}.`);
  
  if (lines.length === 0) {
    if (brain?.onboarding_completed) {
      lines.push('Your Company Brain is ready. Run your first workflow to create activity.');
    } else {
      lines.push('Your workforce is warming up. Ask Pilot to find your first batch of signals.');
    }
  }

  const next =
    totals.approvals > 0
      ? { label: 'Review approvals so Mira can continue.', primary: 'Review approvals', route: '/awaiting-you' }
      : totals.signals > 0
      ? { label: 'New signals are ready for triage.', primary: 'Open signal feed', route: '/signals' }
      : { label: 'Kick off your first mission.', primary: 'Ask Pilot', route: '/dashboard' };

  const askPilot = () => {
    window.dispatchEvent(new CustomEvent('chat:prefill', { detail: { text: 'Pilot, give me my briefing for today.' } }));
  };

  if (compact) {
    const title = runningRun
      ? `Orchestrating ${runningRun.workflowTitle}…`
      : brain?.onboarding_completed && founderName
        ? `Welcome back, ${founderName}.`
        : `${lines.length} update${lines.length === 1 ? '' : 's'} today`;
    return (
      <section className="team-panel flex flex-col" aria-label="Pilot briefing">
        <div className="team-panel-header">
          <h2 className="flex items-center gap-2">
            <AgentAvatar id="pilot" size={22} status={runningRun ? 'working' : totals.approvals > 0 ? 'awaiting' : 'working'} active />
            Pilot briefing
          </h2>
          <button onClick={askPilot} className="inline-flex items-center gap-1">Ask Pilot <MessageCircle className="h-3 w-3" /></button>
        </div>
        <p className="flex items-center gap-2 text-[13.5px] font-medium text-foreground/90 leading-snug">
          {runningRun && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-400" />}
          <span className="min-w-0 truncate">{title}</span>
        </p>
        {!runningRun && (
          <ul className="mt-1.5 space-y-1">
            {lines.slice(0, 3).map((l, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] leading-snug text-neutral-300">
                <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-emerald-400/80" />
                <span className="min-w-0">{l}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <span className="min-w-0 truncate text-[11.5px] text-neutral-400">
            <span className="font-semibold uppercase tracking-[0.12em] text-emerald-300/90">Next</span> · {runningRun ? 'Workbench opens when it finishes.' : next.label}
          </span>
          {!runningRun && (
            <button
              onClick={() => navigate(next.route)}
              className="ag-btn ag-btn-primary inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium"
            >
              {next.primary}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </section>
    );
  }

  // If a workflow is running, display progress indicators
  if (runningRun) {
    return (
      <section className={cn('card-premium p-6 lg:p-7 relative overflow-hidden bg-gradient-to-br from-emerald-500/[0.05] to-transparent border-emerald-500/20')}>
        <div className="pointer-events-none absolute -top-16 -right-16 h-36 w-36 rounded-full bg-emerald-500/10 blur-3xl animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-7 items-start">
          <div className="flex items-start gap-4 min-w-0">
            <AgentAvatar id="pilot" size={44} status="working" active />
            <div className="min-w-0 flex-1">
              <div className="eyebrow mb-2">Pilot · Active Workflow</div>
              <h2 className="text-[18px] font-bold text-white tracking-tight leading-snug flex items-center gap-2">
                <Loader2 className="h-4.5 w-4.5 text-emerald-400 animate-spin" />
                Orchestrating {runningRun.workflowTitle}...
              </h2>
              <div className="mt-4 space-y-2.5 max-w-xl">
                <div className="flex items-center gap-3 text-[13.5px]">
                  <span className="h-5 w-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-[10px] text-emerald-300 flex items-center justify-center shrink-0">✓</span>
                  <span className="text-neutral-400 line-through">Pilot started your first workflow.</span>
                </div>
                <div className="flex items-center gap-3 text-[14px]">
                  <span className="h-5 w-5 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  </span>
                  <span className="text-neutral-100 font-medium">Lyra is sourcing account opportunities.</span>
                </div>
                <div className="flex items-center gap-3 text-[13.5px] opacity-50">
                  <span className="h-5 w-5 rounded-full bg-neutral-900 border border-white/10 text-[9px] text-neutral-400 flex items-center justify-center shrink-0">3</span>
                  <span className="text-neutral-300">Atlas will rank accepted results.</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end text-[11.5px] font-mono text-neutral-500 lg:h-full lg:items-center">
            Takes ~30-45s · Workbench will open
          </div>
        </div>
      </section>
    );
  }

  const welcomeGreeting = brain?.onboarding_completed && founderName && companyName
    ? `Welcome back, ${founderName}.`
    : `Your AI workforce has ${lines.length} update${lines.length === 1 ? '' : 's'} today.`;

  const contextualSubtitle = brain?.onboarding_completed && companyName
    ? `Orchestrating GTM operations for ${companyName} via ${primaryChannel || channels[0] || 'outbound channels'}.`
    : null;

  return (
    <section className={cn('card-premium p-6 lg:p-7')}>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-7 items-start">
        <div className="flex items-start gap-4 min-w-0">
          <AgentAvatar id="pilot" size={44} status={totals.approvals > 0 ? 'awaiting' : 'working'} active />
          <div className="min-w-0 flex-1">
            <div className="eyebrow mb-2">Pilot · Briefing</div>
            <h2 className="text-[20px] font-semibold text-white tracking-tight leading-snug">
              {welcomeGreeting}
            </h2>
            {contextualSubtitle && (
              <p className="text-[12px] text-emerald-400/90 font-medium mt-1 leading-snug">
                {contextualSubtitle}
              </p>
            )}
            <ul className="mt-4 space-y-2">
              {lines.map((l, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[15.5px] text-neutral-200 leading-relaxed">
                  <span className="text-emerald-400/90 mt-1">•</span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 inline-flex items-center gap-2.5 rounded-lg bg-[var(--ag-fill)] px-3 py-1.5 shadow-[inset_0_0_0_1px_var(--ag-line),inset_2px_0_0_rgb(var(--ag-emerald)/0.8)]">
              <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-emerald-300">Next move</span>
              <span className="text-[14.5px] text-neutral-100">{next.label}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap lg:flex-col gap-2 lg:min-w-[200px]">
          <button
            onClick={() => navigate(next.route)}
            className="ag-btn ag-btn-primary inline-flex items-center justify-between gap-2 h-10 px-4 rounded-lg text-[14px] font-medium"
          >
            {next.primary}
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => navigate('/signals')}
            className="ag-btn ag-btn-secondary inline-flex items-center justify-between gap-2 h-10 px-4 rounded-lg text-[14px]"
          >
            Signal feed
            <ArrowRight className="h-4 w-4 opacity-60" />
          </button>
          <button
            onClick={askPilot}
            className="ag-btn ag-btn-secondary inline-flex items-center justify-between gap-2 h-10 px-4 rounded-lg text-[14px]"
          >
            Ask Pilot
            <MessageCircle className="h-4 w-4 opacity-60" />
          </button>
        </div>
      </div>
    </section>
  );
}
