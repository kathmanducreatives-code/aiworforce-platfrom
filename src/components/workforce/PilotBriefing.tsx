import { useNavigate } from 'react-router-dom';
import AgentAvatar from './AgentAvatar';
import { ArrowRight, MessageCircle } from 'lucide-react';
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
    <section className={cn('card-premium p-6 lg:p-7')}>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-7 items-start">
        <div className="flex items-start gap-4 min-w-0">
          <AgentAvatar id="pilot" size={44} status="working" active />
          <div className="min-w-0 flex-1">
            <div className="eyebrow mb-2">Pilot · Briefing</div>
            <h2 className="text-[20px] font-semibold text-white tracking-tight leading-snug">
              Your AI workforce has {lines.length} update{lines.length === 1 ? '' : 's'} today.
            </h2>
            <ul className="mt-4 space-y-2">
              {lines.map((l, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[15.5px] text-neutral-200 leading-relaxed">
                  <span className="text-emerald-400/90 mt-1">•</span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/[0.06]">
              <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-emerald-300">Next move</span>
              <span className="text-[14.5px] text-neutral-100">{next.label}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap lg:flex-col gap-2 lg:min-w-[200px]">
          <button
            onClick={() => navigate(next.route)}
            className="inline-flex items-center justify-between gap-2 h-10 px-4 rounded-md text-[14px] font-semibold text-black bg-emerald-400 hover:bg-emerald-300 transition-colors"
          >
            {next.primary}
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => navigate('/signals')}
            className="inline-flex items-center justify-between gap-2 h-10 px-4 rounded-md text-[14px] text-neutral-200 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] transition-colors"
          >
            Signal feed
            <ArrowRight className="h-4 w-4 opacity-60" />
          </button>
          <button
            onClick={askPilot}
            className="inline-flex items-center justify-between gap-2 h-10 px-4 rounded-md text-[14px] text-neutral-200 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] transition-colors"
          >
            Ask Pilot
            <MessageCircle className="h-4 w-4 opacity-60" />
          </button>
        </div>
      </div>
    </section>
  );
}
