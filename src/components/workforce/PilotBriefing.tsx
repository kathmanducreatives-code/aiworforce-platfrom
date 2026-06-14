import { useNavigate } from 'react-router-dom';
import AgentAvatar from './AgentAvatar';
import { Sparkles, ArrowRight, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  totals: { signals: number; outreachDrafts: number; approvals: number; contentDrafts: number };
}

export default function PilotBriefing({ totals }: Props) {
  const navigate = useNavigate();
  const lines: string[] = [];
  if (totals.signals > 0) lines.push(`Scout found ${totals.signals} new buying signal${totals.signals === 1 ? '' : 's'}.`);
  if (totals.outreachDrafts > 0) lines.push(`Penn prepared ${totals.outreachDrafts} outreach draft${totals.outreachDrafts === 1 ? '' : 's'}.`);
  if (totals.contentDrafts > 0) lines.push(`Scribe drafted ${totals.contentDrafts} content piece${totals.contentDrafts === 1 ? '' : 's'}.`);
  if (totals.approvals > 0) lines.push(`Pilot needs your approval on ${totals.approvals} item${totals.approvals === 1 ? '' : 's'}.`);
  if (lines.length === 0) lines.push('Your workforce is warming up. Ask Pilot to find your first batch of signals.');

  const next =
    totals.approvals > 0
      ? { label: 'Review approvals so Penn can continue.', primary: 'Review approvals', route: '/awaiting-you' }
      : totals.signals > 0
      ? { label: 'New signals are ready for triage.', primary: 'Open signal feed', route: '/signals' }
      : { label: 'Kick off your first mission.', primary: 'Ask Pilot', route: '/dashboard' };

  const askPilot = () => {
    window.dispatchEvent(new CustomEvent('chat:prefill', { detail: { text: 'Pilot, give me my briefing for today.' } }));
  };

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-3xl p-6 md:p-7',
        'bg-gradient-to-br from-white/[0.045] via-white/[0.02] to-white/[0.01]',
        'border border-white/[0.08] backdrop-blur-2xl',
        'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_24px_64px_-24px_rgba(0,0,0,0.7)]',
      )}
    >
      {/* radial gradients */}
      <div aria-hidden className="absolute -top-32 -left-32 h-80 w-80 rounded-full blur-3xl opacity-40 pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.35), transparent 60%)' }} />
      <div aria-hidden className="absolute -bottom-32 -right-32 h-80 w-80 rounded-full blur-3xl opacity-30 pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.30), transparent 60%)' }} />
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent" />

      <div className="relative flex flex-col md:flex-row md:items-start gap-5">
        <div className="shrink-0 flex items-center gap-3">
          <AgentAvatar id="pilot" size={56} status="working" active />
          <div className="md:hidden">
            <p className="text-[11px] uppercase tracking-wider text-emerald-400/80 font-mono">Pilot Briefing</p>
            <h2 className="text-[18px] font-semibold text-white">Today's update</h2>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className="hidden md:block text-[11px] uppercase tracking-wider text-emerald-400/80 font-mono mb-1">Pilot Briefing</p>
          <h2 className="hidden md:block text-[22px] font-semibold text-white leading-tight">
            Your AI workforce has {lines.length} update{lines.length === 1 ? '' : 's'} today.
          </h2>

          <ul className="mt-4 space-y-2">
            {lines.map((l, i) => (
              <li key={i} className="flex items-start gap-2 text-[14px] text-neutral-200">
                <Sparkles className="h-3.5 w-3.5 text-emerald-400 mt-1 shrink-0" />
                <span>{l}</span>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-[13px] text-neutral-400">
            <span className="text-emerald-300/90">Recommended next move:</span> {next.label}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={() => navigate(next.route)}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-medium text-black bg-gradient-to-b from-emerald-300 to-emerald-500 hover:from-emerald-200 hover:to-emerald-400 shadow-[0_0_24px_rgba(16,185,129,0.35),inset_0_1px_0_0_rgba(255,255,255,0.4)] transition-all"
            >
              {next.primary}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => navigate('/signals')}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] text-neutral-200 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] backdrop-blur-md transition-all"
            >
              Open signal feed
            </button>
            <button
              onClick={askPilot}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] text-neutral-200 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] backdrop-blur-md transition-all"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Ask Pilot
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
