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
    <section
      className={cn(
        'rounded-xl p-5',
        'bg-white/[0.015] border border-white/[0.06] backdrop-blur-xl',
      )}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-start">
        <div className="flex items-start gap-4 min-w-0">
          <AgentAvatar id="pilot" size={40} status="working" active />
          <div className="min-w-0 flex-1">
            <div className="eyebrow mb-1">Pilot · Briefing</div>
            <h2 className="text-[15px] font-semibold text-white tracking-tight leading-snug">
              Your AI workforce has {lines.length} update{lines.length === 1 ? '' : 's'} today.
            </h2>
            <ul className="mt-3 space-y-1">
              {lines.map((l, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] text-neutral-300 leading-snug">
                  <span className="text-emerald-400/80 mt-0.5">•</span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] text-neutral-500">
              <span className="text-emerald-300/80">Next move:</span> {next.label}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap lg:flex-col gap-1.5 lg:min-w-[180px]">
          <button
            onClick={() => navigate(next.route)}
            className="inline-flex items-center justify-between gap-2 h-9 px-3.5 rounded-md text-[12.5px] font-medium text-black bg-emerald-400 hover:bg-emerald-300 transition-colors"
          >
            {next.primary}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => navigate('/signals')}
            className="inline-flex items-center justify-between gap-2 h-9 px-3.5 rounded-md text-[12.5px] text-neutral-300 hover:text-white bg-white/[0.025] hover:bg-white/[0.05] border border-white/[0.06] transition-colors"
          >
            Signal feed
            <ArrowRight className="h-3.5 w-3.5 opacity-60" />
          </button>
          <button
            onClick={askPilot}
            className="inline-flex items-center justify-between gap-2 h-9 px-3.5 rounded-md text-[12.5px] text-neutral-300 hover:text-white bg-white/[0.025] hover:bg-white/[0.05] border border-white/[0.06] transition-colors"
          >
            Ask Pilot
            <MessageCircle className="h-3.5 w-3.5 opacity-60" />
          </button>
        </div>
      </div>
    </section>
  );
}
