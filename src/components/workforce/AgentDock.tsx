import { useState } from 'react';
import AgentAvatar from './AgentAvatar';
import AgentProfileDrawer from './AgentProfileDrawer';
import { AGENT_ORDER, AGENTS, type AgentId } from './agents';
import type { AgentState } from '@/hooks/useWorkforceState';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  agents: Record<AgentId, AgentState>;
}

export default function AgentDock({ agents }: Props) {
  const [openId, setOpenId] = useState<AgentId | null>(null);
  const [hoverId, setHoverId] = useState<AgentId | null>(null);

  return (
    <>
      <div
        className={cn(
          'fixed bottom-5 left-1/2 -translate-x-1/2 z-40',
          'rounded-2xl px-3 py-2',
          'bg-black/50 border border-white/[0.08] backdrop-blur-2xl',
          'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_20px_60px_-20px_rgba(0,0,0,0.8)]',
        )}
        role="toolbar"
        aria-label="AI workforce dock"
      >
        <div className="flex items-end gap-2">
          {AGENT_ORDER.map((id) => {
            const s = agents[id];
            const meta = AGENTS[id];
            const isHover = hoverId === id;
            return (
              <div key={id} className="relative" onMouseEnter={() => setHoverId(id)} onMouseLeave={() => setHoverId(null)}>
                {isHover && (
                  <div
                    className={cn(
                      'absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-64',
                      'rounded-xl p-3 bg-neutral-950/95 border border-white/[0.08] backdrop-blur-xl',
                      'shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)]',
                      'pointer-events-none animate-in fade-in slide-in-from-bottom-1 duration-150',
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[13px] font-semibold text-white">{meta.name}</span>
                      <span className="text-[11px] text-neutral-400">{meta.role}</span>
                    </div>
                    <p className="text-[12px] text-neutral-300">{s.statusText}</p>
                    <p className="text-[12px] text-emerald-300 mt-1">{s.todayOutput}</p>
                    <p className="text-[11px] text-neutral-500 mt-1.5">Next: {s.nextAction.label}</p>
                  </div>
                )}
                <button
                  onClick={() => setOpenId(id)}
                  className={cn(
                    'transition-transform duration-200',
                    isHover && '-translate-y-1 scale-110',
                  )}
                  aria-label={`Open ${meta.name}`}
                >
                  <AgentAvatar id={id} size={44} status={s.status} badge={s.badgeCount || null} active={isHover} />
                </button>
              </div>
            );
          })}
          <div className="w-px h-8 bg-white/[0.06] mx-1" />
          <button
            className="h-11 w-11 rounded-full flex items-center justify-center bg-white/[0.03] hover:bg-white/[0.08] border border-dashed border-white/[0.12] text-neutral-400 hover:text-white transition-all"
            title="Add agent (coming soon)"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <AgentProfileDrawer
        open={openId !== null}
        onClose={() => setOpenId(null)}
        state={openId ? agents[openId] : null}
      />
    </>
  );
}
