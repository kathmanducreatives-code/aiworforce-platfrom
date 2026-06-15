import AgentAvatar from './AgentAvatar';
import { cn } from '@/lib/utils';
import type { TimelineItem } from '@/hooks/useWorkforceState';

export default function WorkflowTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <section
      className={cn(
        'rounded-xl',
        'bg-white/[0.015] border border-white/[0.06] backdrop-blur-xl',
      )}
    >
      <header className="flex items-center justify-between px-5 h-11 border-b border-white/[0.04]">
        <div className="flex items-baseline gap-3">
          <span className="eyebrow">Activity</span>
          <span className="text-[12px] text-neutral-400">Today</span>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-emerald-400/70 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
          Live
        </span>
      </header>

      {items.length === 0 ? (
        <p className="text-[12.5px] text-neutral-500 px-5 py-6">
          Nothing has happened yet today. Once your agents start working, a live log appears here.
        </p>
      ) : (
        <ol className="max-h-[360px] overflow-y-auto divide-y divide-white/[0.04]">
          {items.map((t) => (
            <li
              key={t.id}
              className="grid grid-cols-[88px_28px_1fr] items-center gap-3 px-5 h-9 hover:bg-white/[0.015] transition-colors"
            >
              <span className="text-[11px] font-mono text-neutral-500 num">{t.time}</span>
              <AgentAvatar id={t.agentId} size={20} withRing={false} />
              <p className="text-[12.5px] text-neutral-200 truncate">{t.text}</p>
            </li>
          ))}
          <li className="grid grid-cols-[88px_28px_1fr] items-center gap-3 px-5 h-9">
            <span className="text-[11px] font-mono text-amber-400/80 num">NOW</span>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse justify-self-center" />
            <p className="text-[12.5px] text-amber-300/90">Waiting for your decision</p>
          </li>
        </ol>
      )}
    </section>
  );
}
