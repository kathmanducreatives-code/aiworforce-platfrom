import AgentAvatar from './AgentAvatar';
import { cn } from '@/lib/utils';
import type { TimelineItem } from '@/hooks/useWorkforceState';

export default function WorkflowTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <section
      className={cn(
        'rounded-2xl p-5',
        'bg-white/[0.02] border border-white/[0.06] backdrop-blur-xl',
        'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
      )}
    >
      <header className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500">Workflow</p>
          <h3 className="text-[15px] font-semibold text-white">Today</h3>
        </div>
        <span className="text-[11px] text-neutral-500">Live</span>
      </header>

      {items.length === 0 ? (
        <p className="text-[12px] text-neutral-500 py-4">Nothing has happened yet today. Once your agents start working, you'll see a live timeline here.</p>
      ) : (
        <ol className="relative space-y-3 pl-5 before:absolute before:left-[7px] before:top-1 before:bottom-1 before:w-px before:bg-white/[0.06]">
          {items.map((t, i) => (
            <li key={t.id} className="relative flex items-start gap-3">
              <span className={cn(
                'absolute -left-5 top-1.5 h-2 w-2 rounded-full',
                i === 0 ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-white/20',
              )} />
              <AgentAvatar id={t.agentId} size={24} withRing={false} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-neutral-200 leading-snug">{t.text}</p>
                <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mt-0.5">{t.time}</p>
              </div>
            </li>
          ))}
          <li className="relative flex items-center gap-3">
            <span className="absolute -left-5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <p className="text-[12px] text-amber-300/90 italic">Now — waiting for your decision</p>
          </li>
        </ol>
      )}
    </section>
  );
}
