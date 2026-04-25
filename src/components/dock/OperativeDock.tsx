import { useRef, useState, useEffect, useMemo } from 'react';
import { motion, useMotionValue, useTransform, useSpring, AnimatePresence } from 'framer-motion';
import { Plus } from 'lucide-react';
import { DOCK_AGENTS, DockAgent, deptColor } from '@/data/dockAgents';
import { AGENT_BY_ID } from '@/data/agentProfiles';
import { useAgents } from '@/hooks/useAgents';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import AgentHoverCard from './AgentHoverCard';
import AgentDrawer from './AgentDrawer';
import AgentAvatar from '@/components/agents/AgentAvatar';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { openAgentBuilder } from '@/hooks/useAgentBuilder';

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
      className="relative shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-full"
      aria-label={`${agent.name} · ${agent.currentTask}`}
    >
      <motion.div
        style={{ opacity: labelOpacity }}
        className="absolute left-1/2 -translate-x-1/2 -top-9 whitespace-nowrap pointer-events-none"
      >
        <div className="px-2.5 py-1 rounded-md bg-card/95 backdrop-blur-md border border-border/60 text-[11px] font-medium text-foreground shadow-lg">
          <span className="text-muted-foreground">{agent.name} · </span>{agent.currentTask}
        </div>
      </motion.div>

      <div className={cn(
        'w-full h-full rounded-full ring-2 overflow-hidden bg-card shadow-[0_4px_20px_hsl(var(--background)/0.6)]',
        dept.ring,
      )}>
        <img
          src={agent.image}
          alt={agent.name}
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>

      <span className={cn(
        'absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card',
        agent.status === 'active' ? `${dept.dot} animate-pulse` : 'bg-muted',
      )} />
    </motion.button>
  );
}

export default function OperativeDock() {
  const mouseX = useMotionValue(Infinity);
  const [hovered, setHovered] = useState<{ agent: DockAgent; rect: DOMRect } | null>(null);
  const [openAgent, setOpenAgent] = useState<DockAgent | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { workspaceId } = useWorkspace();
  const { agents: liveAgents } = useAgents(workspaceId);

  // Merge live DB agent rows with static profile assets (image, role).
  // If we don't have any live data yet, fall back to the static seed list
  // so the dock never appears empty.
  const dockAgents = useMemo<DockAgent[]>(() => {
    if (!liveAgents || liveAgents.length === 0) return DOCK_AGENTS;
    return liveAgents
      .map((row) => {
        const profile = AGENT_BY_ID[row.slug];
        if (!profile) return null;
        return {
          id: row.slug,
          name: row.name,
          role: profile.role,
          department: row.department,
          model: row.model as DockAgent['model'],
          image: profile.image,
          currentTask: row.current_task ?? 'Idle — ready for tasks',
          progress: row.progress ?? 0,
          status: (row.status === 'running' || row.status === 'awaiting_approval') ? 'active' : 'idle',
          href: '/dashboard',
          recentActivity: [],
        } as DockAgent;
      })
      .filter((x): x is DockAgent => x !== null);
  }, [liveAgents]);

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
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('command-bar:prefill', {
        detail: { text: `Tell ${agent.name} to ` },
      }));
    }, 100);
  };

  const handleDeploy = () => {
    openAgentBuilder();
  };

  useEffect(() => () => cancelDismiss(), []);

  return (
    <>
      <div className="fixed bottom-3 right-4 z-40 hidden md:block">
        <motion.div
          onMouseMove={(e) => mouseX.set(e.clientX)}
          onMouseLeave={() => { mouseX.set(Infinity); scheduleDismiss(); }}
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 24, delay: 0.2 }}
          className="flex items-end gap-3 px-4 py-2.5 rounded-2xl border border-border/60 bg-card/70 backdrop-blur-2xl shadow-[0_20px_60px_hsl(var(--background)/0.7)]"
        >
          {dockAgents.map((agent) => (
            <DockItem
              key={agent.id}
              agent={agent}
              mouseX={mouseX}
              onHover={handleHover}
              onClick={setOpenAgent}
            />
          ))}

          <div className="self-stretch w-px bg-border/60 mx-1" />

          <button
            onClick={handleDeploy}
            className="shrink-0 w-11 h-11 rounded-full border border-dashed border-border bg-foreground/[0.03] hover:bg-foreground/10 hover:border-primary/50 hover:text-primary flex items-center justify-center text-muted-foreground transition-all duration-200"
            aria-label="Deploy new agent"
          >
            <Plus className="h-5 w-5" />
          </button>
        </motion.div>
      </div>

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

      <AgentDrawer
        agent={openAgent}
        open={!!openAgent}
        onOpenChange={(o) => !o && setOpenAgent(null)}
        onSendCommand={handleSendCommand}
      />
    </>
  );
}
