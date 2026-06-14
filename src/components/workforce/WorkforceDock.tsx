import { useState } from 'react';
import { Plus, Radar, Crown, BarChart3, PenLine, Eye, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AGENT_ORDER, AGENTS, type AgentId } from './agents';
import type { AgentState } from '@/hooks/useWorkforceState';
import { DEPT_CONFIG, type DeptTotals } from './departmentConfig';

const ICONS = {
  command: Crown,
  radar: Radar,
  rank: BarChart3,
  pen: PenLine,
  eye: Eye,
  doc: FileText,
  plus: Plus,
} as const;

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
    <div className="relative">
      <div
        className={cn(
          'mx-auto w-full overflow-x-auto no-scrollbar',
          'rounded-3xl px-6 py-5',
          'bg-black/45 border border-white/[0.08] backdrop-blur-2xl',
          'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_30px_80px_-30px_rgba(0,0,0,0.9)]',
        )}
      >
        <div className="flex items-end justify-center gap-5 min-w-max">
          {AGENT_ORDER.map((id) => {
            const meta = AGENTS[id];
            const cfg = DEPT_CONFIG[id];
            const state = agents[id];
            const Icon = ICONS[cfg.iconKey];
            const isSelected = selectedId === id;
            const isHover = hoverId === id;
            const lift = isHover || isSelected;
            const badge = cfg.badge(totals, brainComplete, state.badgeCount);

            return (
              <div
                key={id}
                className="relative flex flex-col items-center"
                onMouseEnter={() => setHoverId(id)}
                onMouseLeave={() => setHoverId(null)}
              >
                {/* tooltip */}
                {isHover && (
                  <div
                    className={cn(
                      'absolute bottom-full mb-4 left-1/2 -translate-x-1/2 w-64 z-20',
                      'rounded-xl p-3 bg-neutral-950/95 border border-white/[0.08] backdrop-blur-xl',
                      'shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)]',
                      'pointer-events-none animate-in fade-in slide-in-from-bottom-1 duration-150',
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[13px] font-semibold text-white">{meta.name}</span>
                      <span className="text-[11px] text-neutral-400">{meta.role}</span>
                    </div>
                    <p className="text-[12px] text-neutral-300">{state.statusText}</p>
                    <p className="text-[12px] mt-1" style={{ color: cfg.ringHex }}>{state.todayOutput}</p>
                    <p className="text-[11px] text-neutral-500 mt-1.5">Next: {state.nextAction.label}</p>
                  </div>
                )}

                <button
                  onClick={() => onSelect(id)}
                  aria-label={`Select ${meta.name}`}
                  aria-pressed={isSelected}
                  className={cn(
                    'relative h-[68px] w-[68px] rounded-full transition-all duration-300 ease-out',
                    lift && '-translate-y-1.5 scale-[1.08]',
                  )}
                  style={{
                    boxShadow: isSelected
                      ? `0 0 0 2px ${cfg.ringHex}, 0 0 32px ${cfg.glowRgba}`
                      : isHover
                      ? `0 0 0 1px ${cfg.ringHex}80, 0 0 18px ${cfg.glowRgba}`
                      : `0 0 0 1px rgba(255,255,255,0.08)`,
                  }}
                >
                  {/* glossy circle */}
                  <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-white/[0.10] to-white/[0.02] border border-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12)]" />
                  <span
                    className="absolute inset-[3px] rounded-full pointer-events-none"
                    style={{ background: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.20), transparent 50%)' }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Icon className="h-6 w-6" style={{ color: cfg.ringHex }} strokeWidth={1.75} />
                  </span>

                  {badge != null && badge !== 0 && badge !== '0' && (
                    <span
                      className="absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1.5 rounded-full text-white text-[10px] font-semibold flex items-center justify-center border border-black/70 tabular-nums"
                      style={{ background: badge === '!' ? '#f59e0b' : '#ef4444' }}
                    >
                      {typeof badge === 'number' && badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </button>

                <span
                  className={cn(
                    'mt-2.5 text-[11px] font-medium tracking-wide transition-colors',
                    isSelected ? 'text-white' : 'text-neutral-400',
                  )}
                >
                  {meta.name}
                </span>
                <span className="text-[10px] text-neutral-500 -mt-0.5">{meta.role.replace(/Agent/i, '').trim()}</span>
              </div>
            );
          })}

          {/* divider */}
          <div className="w-px h-14 bg-white/[0.06] self-center mx-1" />

          {/* plus */}
          <div className="relative flex flex-col items-center">
            <button
              title="Add agent or workflow (coming soon)"
              className="h-[68px] w-[68px] rounded-full flex items-center justify-center bg-white/[0.03] hover:bg-white/[0.06] border border-dashed border-white/[0.14] text-neutral-400 hover:text-white transition-all"
            >
              <Plus className="h-6 w-6" />
            </button>
            <span className="mt-2.5 text-[11px] font-medium tracking-wide text-neutral-500">Add</span>
            <span className="text-[10px] text-neutral-600 -mt-0.5">Agent</span>
          </div>
        </div>
      </div>
    </div>
  );
}
