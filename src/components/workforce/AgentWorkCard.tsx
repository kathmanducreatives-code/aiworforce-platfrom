import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import AgentAvatar from './AgentAvatar';
import StatusPill from './StatusPill';
import { AGENTS, accentClasses } from './agents';
import { cn } from '@/lib/utils';
import type { AgentState } from '@/hooks/useWorkforceState';

interface Props {
  state: AgentState;
  onOpen?: () => void;
}

export default function AgentWorkCard({ state, onOpen }: Props) {
  const navigate = useNavigate();
  const meta = AGENTS[state.id];
  const c = accentClasses[meta.accent];

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group relative w-full text-left rounded-2xl p-4',
        'bg-white/[0.025] border border-white/[0.06] backdrop-blur-xl',
        'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]',
        'hover:bg-white/[0.04] hover:border-white/[0.10] transition-all duration-200',
        'before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/10 before:to-transparent',
      )}
    >
      <div className="flex items-start gap-3 mb-3">
        <AgentAvatar id={state.id} size={42} status={state.status} active={state.status === 'working' || state.status === 'drafting'} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-white truncate">{meta.name}</h3>
            <span className="text-[11px] text-neutral-500 truncate">{meta.role}</span>
          </div>
          <div className="mt-1">
            <StatusPill status={state.status} label={state.statusText} />
          </div>
        </div>
      </div>

      <div className="space-y-1.5 mb-3">
        <p className={cn('text-[13px] font-medium', c.text)}>{state.todayOutput}</p>
        {state.context && <p className="text-[12px] text-neutral-400 leading-snug">{state.context}</p>}
        {state.blockedReason && (
          <p className="text-[12px] text-rose-300/80 leading-snug">{state.blockedReason}</p>
        )}
      </div>

      <div
        className="inline-flex items-center gap-1.5 text-[12px] text-neutral-300 group-hover:text-white transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          if (state.nextAction.route) navigate(state.nextAction.route);
        }}
      >
        <span>{state.nextAction.label}</span>
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}
