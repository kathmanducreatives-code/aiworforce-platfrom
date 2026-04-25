import { useRef, useState, useEffect } from 'react';
import { motion, useMotionValue, useTransform, useSpring, AnimatePresence } from 'framer-motion';
import { Plus } from 'lucide-react';
import { DOCK_AGENTS, DockAgent, deptColor } from '@/data/dockAgents';
import AgentHoverCard from './AgentHoverCard';
import AgentDrawer from './AgentDrawer';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface DockItemProps {
  agent: DockAgent;
  mouseX: ReturnType<typeof useMotionValue<number>>;
  onHover: (agent: DockAgent | null, rect: DOMRect | null) => void;
  onClick: (agent: DockAgent) => void;
}

const BASE = 44;
const MAX = 70;

function DockItem({ agent, mouseX, onHover, onClick }: DockItemProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const dept = deptColor[agent.department];

  // Distance from cursor → scale
  const distance = useTransform(mouseX, (val) => {
    const rect = ref.current?.getBoundingClientRect() ?? { x: 0, width: BASE } as DOMRect;
    return val - (rect.x + rect.width / 2);
  });
  const sizeRaw = useTransform(distance, [-120, 0, 120], [BASE, MAX, BASE]);
  const size = useSpring(sizeRaw, { stiffness: 320, damping: 22, mass: 0.4 });
  const labelOpacityRaw = useTransform(distance, [-50, 0, 50], [0, 1, 0]);
  const labelOpacity = useSpring(labelOpacityRaw, { stiffness: 300, damping: 25 });

  return (
    <motion.button
      ref={ref}
      style={{ width: size, height: size }}
      onMouseEnter={() => ref.current && onHover(agent, ref.current.getBoundingClientRect())}
      onClick={() => onClick(agent)}
      className="relative shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 rounded-full"
      aria-label={`${agent.name} · ${agent.currentTask}`}
    >
      {/* Floating mini-label above avatar */}
      <motion.div
        style={{ opacity: labelOpacity }}
        className="absolute left-1/2 -translate-x-1/2 -top-9 whitespace-nowrap pointer-events-none"
      >
        <div className="px-2.5 py-1 rounded-md bg-[#13151C]/95 backdrop-blur-md border border-white/10 text-[11px] font-medium text-white shadow-lg">
          <span className="text-zinc-400">{agent.name} · </span>{agent.currentTask}
        </div>
      </motion.div>

      {/* Avatar */}
      <div className={cn(
        'w-full h-full rounded-full ring-2 flex items-center justify-center text-sm font-bold text-white bg-gradient-to-br shadow-[0_4px_20px_rgba(0,0,0,0.4)]',
        dept.ring, dept.bg,
      )}>
        {agent.name[0]}
      </div>

      {/* Status dot */}
      <span className={cn(
        'absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#13151C]',
        agent.isRunning ? `${dept.dot} animate-pulse` : 'bg-zinc-600',
      )} />
    </motion.button>
  );
}

export default function OperativeDock() {
  const mouseX = useMotionValue(Infinity);
  const [hovered, setHovered] = useState<{ agent: DockAgent; rect: DOMRect } | null>(null);
  const [openAgent, setOpenAgent] = useState<DockAgent | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelDismiss = () => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  };

  const scheduleDismiss = () => {
    cancelDismiss();
    dismissTimer.current = setTimeout(() => setHovered(null), 180);
  };

  const handleHover = (agent: DockAgent | null, rect: DOMRect | null) => {
    cancelDismiss();
    if (agent && rect) setHovered({ agent, rect });
  };

  const handleSendCommand = (agent: DockAgent) => {
    setOpenAgent(null);
    // Trigger global ⌘K via keyboard event
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('command-bar:prefill', {
        detail: { text: `Tell ${agent.name} to ` },
      }));
    }, 100);
  };

  const handleDeploy = () => {
    toast('Deploy a new agent', {
      description: 'Choose a department to spin up a new operative.',
    });
  };

  useEffect(() => () => cancelDismiss(), []);

  return (
    <>
      {/* Dock pill */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 hidden md:block">
        <motion.div
          onMouseMove={(e) => mouseX.set(e.clientX)}
          onMouseLeave={() => { mouseX.set(Infinity); scheduleDismiss(); }}
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 24, delay: 0.2 }}
          className="flex items-end gap-3 px-4 py-2.5 rounded-2xl border border-white/10 bg-[#13151C]/70 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
        >
          {DOCK_AGENTS.map((agent) => (
            <DockItem
              key={agent.id}
              agent={agent}
              mouseX={mouseX}
              onHover={handleHover}
              onClick={setOpenAgent}
            />
          ))}

          <div className="self-stretch w-px bg-white/10 mx-1" />

          <button
            onClick={handleDeploy}
            className="shrink-0 w-11 h-11 rounded-full border border-dashed border-white/20 bg-white/[0.03] hover:bg-white/10 hover:border-white/40 flex items-center justify-center text-zinc-400 hover:text-white transition-all"
            aria-label="Deploy new agent"
          >
            <Plus className="h-5 w-5" />
          </button>
        </motion.div>
      </div>

      {/* Hover card */}
      <AnimatePresence>
        {hovered && (
          <AgentHoverCard
            agent={hovered.agent}
            anchorRect={hovered.rect}
            onMouseEnter={cancelDismiss}
            onMouseLeave={scheduleDismiss}
            onViewOutput={() => { setHovered(null); setOpenAgent(hovered.agent); }}
            onSendCommand={() => { setHovered(null); handleSendCommand(hovered.agent); }}
          />
        )}
      </AnimatePresence>

      {/* Drawer */}
      <AgentDrawer
        agent={openAgent}
        open={!!openAgent}
        onOpenChange={(o) => !o && setOpenAgent(null)}
        onSendCommand={handleSendCommand}
      />
    </>
  );
}
