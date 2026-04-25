import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import ChatBubble from './ChatBubble';

export interface PlanStep {
  agent_slug: string;
  agent_name: string;
  description: string;
}

interface Props {
  steps: PlanStep[];
  /** Called once after all bubbles have been revealed and the "Starting now" pause completed. */
  onDone?: () => void;
}

/**
 * Reveals each step as a chat bubble, one after another, then a "Starting now"
 * confirmation. Used as the brief planning pause before live execution begins.
 */
export default function PlanningThread({ steps, onDone }: Props) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [showStart, setShowStart] = useState(false);

  useEffect(() => {
    if (visibleCount < steps.length) {
      const t = setTimeout(() => setVisibleCount((c) => c + 1), 550);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setShowStart(true);
      const t2 = setTimeout(() => onDone?.(), 900);
      return () => clearTimeout(t2);
    }, 400);
    return () => clearTimeout(t);
  }, [visibleCount, steps.length, onDone]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground/80">
        <Sparkles className="h-3 w-3 text-primary" />
        Agents are planning
      </div>

      <AnimatePresence>
        {steps.slice(0, visibleCount).map((step, i) => (
          <motion.div
            key={`${step.agent_slug}-${i}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <ChatBubble
              role="agent"
              agentName={step.agent_name}
              text={step.description}
            />
          </motion.div>
        ))}
      </AnimatePresence>

      {visibleCount < steps.length && (
        <div className="flex items-center gap-1.5 pl-11 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          <span className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-pulse [animation-delay:120ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-pulse [animation-delay:240ms]" />
        </div>
      )}

      {showStart && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/30 bg-primary/5 text-xs text-primary"
        >
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          Starting now — your team is on it.
        </motion.div>
      )}
    </div>
  );
}
