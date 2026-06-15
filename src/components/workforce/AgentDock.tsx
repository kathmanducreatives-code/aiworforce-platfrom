import { useState } from 'react';
import AgentAvatar from './AgentAvatar';
import AgentProfileDrawer from './AgentProfileDrawer';
import { AGENT_ORDER, AGENTS, type AgentId } from './agents';
import type { AgentState } from '@/hooks/useWorkforceState';
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
          'fixed bottom-4 left-1/2 -translate-x-1/2 z-40',
          'rounded-xl px-2 py-1.5',
          'bg-neutral-950/70 border border-white/[0.06] backdrop-blur-2xl',
          'shadow-[0_16px_48px_-16px_rgba(0,0,0,0.8)]',
        )}
        role="toolbar"
        aria-label="AI workforce dock"
      >
        <div className="flex items-center gap-1">
          {AGENT_ORDER.map((id) => {
            const s = agents[id];
            const meta = AGENTS[id];
            const isHover = hoverId === id;
            return (
              <div key={id} className="relative" onMouseEnter={() => setHoverId(id)} onMouseLeave={() => setHoverId(null)}>
                {isHover && (
                  <div
                    className={cn(
                      'absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-56',
                      'rounded-lg p-2.5 bg-neutral-950/95 border border-white/[0.08]',
                      'shadow-[0_16px_40px_-16px_rgba(0,0,0,0.9)]',
                      'pointer-events-none animate-in fade-in duration-100',
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12px] font-semibold text-white">{meta.name}</span>
                      <span className="text-[10.5px] text-neutral-500">{meta.role}</span>
                    </div>
                    <p className="text-[11.5px] text-neutral-300 leading-snug">{s.statusText}</p>
                    <p className="text-[11px] text-neutral-500 mt-1">Next: {s.nextAction.label}</p>
                  </div>
                )}
                <button
                  onClick={() => setOpenId(id)}
                  className={cn(
                    'p-1 rounded-md transition-colors',
                    isHover ? 'bg-white/[0.05]' : 'bg-transparent',
                  )}
                  aria-label={`Open ${meta.name}`}
                >
                  <AgentAvatar id={id} size={32} status={s.status} badge={s.badgeCount || null} active={isHover} />
                </button>
              </div>
            );
          })}
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
