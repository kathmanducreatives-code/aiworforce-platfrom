import { useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'framer-motion';
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

const BASE = 44;
const MAX = 68;
const RANGE = 140;

interface DockItemProps {
  id: AgentId;
  mouseX: MotionValue<number>;
  isSelected: boolean;
  isHover: boolean;
  badge: number | string | null;
  ringHex: string;
  onSelect: () => void;
  onHoverChange: (hovered: boolean) => void;
}

function DockItem({
  id, mouseX, isSelected, isHover, badge, ringHex, onSelect, onHoverChange,
}: DockItemProps) {
  const meta = AGENTS[id];
  const ref = useRef<HTMLButtonElement>(null);

  const distance = useTransform(mouseX, (val) => {
    if (!Number.isFinite(val)) return RANGE * 2;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return RANGE * 2;
    return val - (rect.x + rect.width / 2);
  });

  const sizeRaw = useTransform(distance, [-RANGE, 0, RANGE], [BASE, MAX, BASE]);
  const liftRaw = useTransform(distance, [-RANGE, 0, RANGE], [0, -6, 0]);
  const labelOpacityRaw = useTransform(distance, [-90, 0, 90], [0.55, 1, 0.55]);
  const labelScaleRaw = useTransform(distance, [-90, 0, 90], [0.95, 1.05, 0.95]);

  const spring = { stiffness: 280, damping: 22, mass: 0.5 };
  const size = useSpring(sizeRaw, spring);
  const lift = useSpring(liftRaw, spring);
  const labelOpacity = useSpring(labelOpacityRaw, spring);
  const labelScale = useSpring(labelScaleRaw, spring);

  return (
    <div
      className="relative flex flex-col items-center"
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <motion.button
        ref={ref}
        onClick={onSelect}
        aria-label={`Select ${meta.name}`}
        aria-pressed={isSelected}
        style={{ y: lift }}
        className={cn(
          'group relative flex flex-col items-center gap-1.5 px-2 py-2 rounded-xl outline-none',
          'focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black',
          'transition-colors duration-150',
          isSelected ? 'bg-white/[0.04]' : 'bg-transparent hover:bg-white/[0.025]',
        )}
        style={
          isSelected
            ? { y: lift, boxShadow: `inset 0 0 0 1px ${ringHex}55` }
            : { y: lift }
        }
      >
        <motion.span
          className="relative flex items-center justify-center rounded-full"
          style={{
            width: size,
            height: size,
            boxShadow: isSelected
              ? `0 0 0 2px ${ringHex}aa, 0 8px 24px -8px ${ringHex}66`
              : isHover
              ? `0 0 0 1.5px ${ringHex}77, 0 6px 18px -8px ${ringHex}55`
              : undefined,
          }}
        >
          <AgentAvatar slug={id} size="md" ring={!isSelected} />
          {badge != null && badge !== 0 && badge !== '0' && (
            <span
              className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full text-[9.5px] font-semibold flex items-center justify-center border border-black/80 tabular-nums z-10"
              style={{
                background: badge === '!' ? '#f59e0b' : 'rgba(20,20,20,0.95)',
                color: badge === '!' ? '#000' : '#fff',
                transformOrigin: 'top right',
              }}
            >
              {typeof badge === 'number' && badge > 99 ? '99+' : badge}
            </span>
          )}
        </motion.span>

        <motion.span
          style={{ opacity: labelOpacity, scale: labelScale }}
          className={cn(
            'text-[10.5px] font-medium uppercase tracking-[0.08em] whitespace-nowrap transition-colors',
            isSelected ? 'text-white' : 'text-neutral-400',
          )}
        >
          {meta.name}
        </motion.span>

        {isSelected && (
          <motion.span
            layoutId="dock-selected-underline"
            className="absolute -bottom-0.5 left-4 right-4 h-px rounded-full"
            style={{ background: ringHex }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          />
        )}
      </motion.button>
    </div>
  );
}

export default function WorkforceDock({ agents, totals, brainComplete, selectedId, onSelect }: Props) {
  const mouseX = useMotionValue<number>(Infinity);
  const [hoverId, setHoverId] = useState<AgentId | null>(null);

  const hoveredState = hoverId ? agents[hoverId] : null;
  const hoveredMeta = hoverId ? AGENTS[hoverId] : null;

  return (
    <div
      className={cn(
        'relative w-full overflow-x-auto no-scrollbar',
        'rounded-2xl px-4 pt-3 pb-2',
        'bg-white/[0.02] border border-white/[0.06] backdrop-blur-2xl',
        'shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]',
      )}
    >
      {/* Floating tooltip — single instance, follows hovered agent */}
      {hoveredMeta && hoveredState && (
        <div
          className={cn(
            'pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full w-64 z-30',
            'rounded-lg p-2.5 bg-neutral-950/95 border border-white/[0.08]',
            'shadow-[0_16px_40px_-16px_rgba(0,0,0,0.9)] animate-in fade-in zoom-in-95 duration-150',
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[12px] font-semibold text-white">{hoveredMeta.name}</span>
            <span className="text-[10.5px] text-neutral-500">{hoveredMeta.role}</span>
          </div>
          <p className="text-[11.5px] text-neutral-300 leading-snug">{hoveredState.statusText}</p>
          <p className="text-[11px] text-neutral-500 mt-1">Next: {hoveredState.nextAction.label}</p>
        </div>
      )}

      <motion.div
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        className="flex items-end gap-2 min-w-max"
        style={{ minHeight: MAX + 28 }}
      >
        {AGENT_ORDER.map((id) => {
          const cfg = DEPT_CONFIG[id];
          const state = agents[id];
          const badge = cfg.badge(totals, brainComplete, state.badgeCount);

          return (
            <DockItem
              key={id}
              id={id}
              mouseX={mouseX}
              isSelected={selectedId === id}
              isHover={hoverId === id}
              badge={badge}
              ringHex={cfg.ringHex}
              onSelect={() => onSelect(id)}
              onHoverChange={(h) => setHoverId(h ? id : (cur) => (cur === id ? null : cur) as AgentId | null)}
            />
          );
        })}
      </motion.div>
    </div>
  );
}
