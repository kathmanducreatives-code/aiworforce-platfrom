import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { DockAgent, deptColor } from '@/data/dockAgents';
import { cn } from '@/lib/utils';
import ModelBadge from '@/components/agents/ModelBadge';

interface Props {
  agent: DockAgent;
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onViewOutput: () => void;
  onSendCommand: () => void;
}

export default function AgentHoverCard({
  agent, anchorRect, onMouseEnter, onMouseLeave, onViewOutput, onSendCommand,
}: Props) {
  const [progress, setProgress] = useState(0);
  const dept = deptColor[agent.department];

  useEffect(() => {
    const t = setTimeout(() => setProgress(agent.progress), 80);
    return () => clearTimeout(t);
  }, [agent.progress]);

  const cardWidth = 300;
  const left = Math.min(
    Math.max(8, anchorRect.left + anchorRect.width / 2 - cardWidth / 2),
    window.innerWidth - cardWidth - 8,
  );
  const bottom = window.innerHeight - anchorRect.top + 18;

  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-[60] pointer-events-auto"
      style={{ left, bottom, width: cardWidth }}
    >
      <div className="rounded-2xl border border-border/60 bg-card/95 backdrop-blur-2xl shadow-[0_20px_60px_hsl(var(--background)/0.7)] overflow-hidden">
        <div className="p-4 flex items-start gap-3 border-b border-border/40">
          <div className={cn(
            'w-12 h-12 rounded-full ring-2 overflow-hidden shrink-0 bg-card',
            dept.ring,
          )}>
            <img src={agent.image} alt={agent.name} className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground leading-tight">{agent.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{agent.role}</p>
          </div>
          <span className={cn(
            'text-[10px] font-semibold uppercase tracking-wider',
            agent.status === 'active' ? 'text-primary' : 'text-muted-foreground',
          )}>
            {agent.status === 'active' ? '● Live' : '○ Idle'}
          </span>
        </div>

        <div className="px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Current Task</p>
          <p className="text-sm text-foreground/90 mb-2.5">{agent.currentTask}</p>
          <div className="h-1 rounded-full bg-foreground/5 overflow-hidden">
            <motion.div
              className={cn('h-full rounded-full bg-gradient-to-r', dept.bg.replace(/\/30/g, '/80'))}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
            />
          </div>
        </div>

        <div className="px-4 py-2 flex items-center gap-2 border-t border-border/40">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Powered by</span>
          <ModelBadge model={agent.model} />
        </div>

        <div className="p-3 grid grid-cols-2 gap-2 border-t border-border/40 bg-background/40">
          <button
            onClick={onViewOutput}
            className="text-xs font-semibold py-2 rounded-lg bg-foreground/5 hover:bg-foreground/10 text-foreground/90 transition-colors"
          >
            View output
          </button>
          <button
            onClick={onSendCommand}
            className="text-xs font-semibold py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
          >
            Send command
          </button>
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}
