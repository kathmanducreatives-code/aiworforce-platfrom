import { useNavigate } from 'react-router-dom';
import AgentAvatar from './AgentAvatar';
import { Check, Pencil, X, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AGENTS } from './agents';
import type { DecisionItem } from '@/hooks/useWorkforceState';

export default function DecisionQueue({ items }: { items: DecisionItem[] }) {
  const navigate = useNavigate();
  return (
    <aside
      className={cn(
        'relative rounded-2xl p-4',
        'bg-white/[0.025] border border-white/[0.06] backdrop-blur-xl',
        'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
      )}
    >
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/30 to-transparent" />

      <header className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-amber-400/80">Decision Queue</p>
          <h3 className="text-[15px] font-semibold text-white">Needs your approval</h3>
        </div>
        <button
          onClick={() => navigate('/awaiting-you')}
          className="text-[11px] text-neutral-400 hover:text-white transition-colors"
        >
          Review all
        </button>
      </header>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="h-10 w-10 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-2">
            <Inbox className="h-4 w-4 text-neutral-500" />
          </div>
          <p className="text-[13px] text-neutral-300">All clear.</p>
          <p className="text-[12px] text-neutral-500 mt-0.5">Nothing waiting on you right now.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((d) => (
            <li
              key={d.id}
              className="rounded-xl p-3 bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.08] transition-colors"
            >
              <div className="flex items-start gap-2.5">
                <AgentAvatar id={d.agentId} size={32} withRing={false} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-white font-medium leading-snug truncate">{d.title}</p>
                  <p className="text-[11px] text-neutral-400 line-clamp-2 mt-0.5">{d.reason}</p>
                  <p className="text-[10px] text-neutral-500 mt-1 uppercase tracking-wider font-mono">
                    From {AGENTS[d.agentId].name}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-2.5">
                <button
                  onClick={() => navigate('/awaiting-you')}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors"
                >
                  <Check className="h-3 w-3" />
                  Approve
                </button>
                <button
                  onClick={() => navigate('/awaiting-you')}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] text-neutral-300 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] transition-colors"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </button>
                <button
                  onClick={() => navigate('/awaiting-you')}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] text-neutral-400 hover:text-rose-300 bg-white/[0.02] hover:bg-rose-500/10 border border-white/[0.04] hover:border-rose-500/20 transition-colors"
                >
                  <X className="h-3 w-3" />
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
