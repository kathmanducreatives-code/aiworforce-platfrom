import { useState } from 'react';
import { cn } from '@/lib/utils';
import { AGENT_ORDER, AGENTS, type AgentId } from './agents';
import type { AgentState } from '@/hooks/useWorkforceState';
import { DEPT_CONFIG, type DeptTotals } from './departmentConfig';
import AgentAvatar from '@/components/chat/workspace/agents/AgentAvatar';


interface Props {
  agents: Record<AgentId, AgentState>;
  totals: DeptTotals;
  brainComplete: boolean;
  selectedId: AgentId;
  onSelect: (id: AgentId) => void;
}

export default function WorkforceDock({ agents, totals, brainComplete, selectedId, onSelect }: Props) {
  const [hoverId, setHoverId] = useState<AgentId | null>(null);

  return (
    <div
      className={cn(
        'w-full overflow-x-auto no-scrollbar',
        'rounded-xl px-3 py-3',
        'bg-white/[0.015] border border-white/[0.06] backdrop-blur-xl',
      )}
    >
      <div className="flex items-stretch gap-1.5 min-w-max">
        {AGENT_ORDER.map((id) => {
          const meta = AGENTS[id];
          const cfg = DEPT_CONFIG[id];
          const state = agents[id];

          const isSelected = selectedId === id;
          const isHover = hoverId === id;
          const badge = cfg.badge(totals, brainComplete, state.badgeCount);

          return (
            <div
              key={id}
              className="relative flex flex-col items-center"
              onMouseEnter={() => setHoverId(id)}
              onMouseLeave={() => setHoverId(null)}
            >
              {isHover && (
                <div
                  className={cn(
                    'absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-60 z-20',
                    'rounded-lg p-2.5 bg-neutral-950/95 border border-white/[0.08]',
                    'shadow-[0_16px_40px_-16px_rgba(0,0,0,0.9)]',
                    'pointer-events-none animate-in fade-in duration-100',
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[12px] font-semibold text-white">{meta.name}</span>
                    <span className="text-[10.5px] text-neutral-500">{meta.role}</span>
                  </div>
                  <p className="text-[11.5px] text-neutral-300 leading-snug">{state.statusText}</p>
                  <p className="text-[11px] text-neutral-500 mt-1">Next: {state.nextAction.label}</p>
                </div>
              )}

              <button
                onClick={() => onSelect(id)}
                aria-label={`Select ${meta.name}`}
                aria-pressed={isSelected}
                className={cn(
                  'group relative flex flex-col items-center gap-1.5 px-3 py-2 rounded-lg transition-colors duration-150',
                  isSelected
                    ? 'bg-white/[0.05]'
                    : isHover
                    ? 'bg-white/[0.03]'
                    : 'bg-transparent',
                )}
                style={
                  isSelected
                    ? { boxShadow: `inset 0 0 0 1px ${cfg.ringHex}66` }
                    : undefined
                }
              >
                <span
                  className="relative h-10 w-10 rounded-full flex items-center justify-center"
                  style={{
                    boxShadow: isSelected ? `0 0 0 2px ${cfg.ringHex}88` : undefined,
                  }}
                >
                  <AgentAvatar slug={id} size="md" ring={!isSelected} />
                  {badge != null && badge !== 0 && badge !== '0' && (
                    <span
                      className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full text-[9.5px] font-semibold flex items-center justify-center border border-black/80 tabular-nums z-10"
                      style={{
                        background: badge === '!' ? '#f59e0b' : 'rgba(20,20,20,0.92)',
                        color: badge === '!' ? '#000' : '#fff',
                      }}
                    >
                      {typeof badge === 'number' && badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'text-[10.5px] font-medium uppercase tracking-[0.08em] transition-colors',
                    isSelected ? 'text-white' : 'text-neutral-500',
                  )}
                >
                  {meta.name}
                </span>
                {isSelected && (
                  <span
                    className="absolute -bottom-px left-3 right-3 h-px"
                    style={{ background: cfg.ringHex }}
                  />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
