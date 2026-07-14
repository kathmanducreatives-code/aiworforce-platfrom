// WorkforceCollaboration — the AI workforce animation for Company Brain research.
//
// Replaces the generic processor-chip loading experience. Shows the real
// Agentory agent roster collaborating around a central Company Brain orb:
//   Scout  — finds signals and source information
//   Hawk   — structures and qualifies account context
//   Aria   — extracts positioning, pains, and messaging
//   Scribe — assembles the final Company Brain
//
// One agent is active at a time (cycles ~3s). The active agent enlarges and
// brightens; a signal trace flows toward the orb. Inactive agents dim.
// `complete` settles all agents at full opacity and pulses the orb once.
//
// Honors prefers-reduced-motion: static arrangement, opacity-only transitions.

import { useEffect, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import { Brain, Check } from 'lucide-react';
import { AGENT_BY_ID, type AgentProfile } from '@/data/agentProfiles';

export interface CollabAgent {
  profile: AgentProfile;
  statement: string;
}

export const COLLAB_AGENTS: CollabAgent[] = [
  { profile: AGENT_BY_ID['scout'], statement: 'Finding relevant signals across your market.' },
  { profile: AGENT_BY_ID['hawk'], statement: 'Structuring your ICP and buyer context.' },
  { profile: AGENT_BY_ID['aria'], statement: 'Extracting positioning, pains, and messaging angles.' },
  { profile: AGENT_BY_ID['scribe'], statement: 'Assembling the final Company Brain for review.' },
];

interface Props {
  /** When true, cycles agents. When false, shows static / settled state. */
  active?: boolean;
  /** Completion state: all agents brighten, orb pulses, check appears. */
  complete?: boolean;
  /** Source label shown beneath the orb (honest, no fake scraping claims). */
  sourceLabel?: string;
  className?: string;
}

export function WorkforceCollaboration({ active = true, complete = false, sourceLabel, className }: Props) {
  const reduce = useReducedMotion();
  const [activeIdx, setActiveIdx] = useState(0);

  // Cycle the active agent every ~3.2s while researching.
  useEffect(() => {
    if (!active || complete || reduce) return;
    const t = setInterval(() => {
      setActiveIdx((i) => (i + 1) % COLLAB_AGENTS.length);
    }, 3200);
    return () => clearInterval(t);
  }, [active, complete, reduce]);

  const shown = complete ? -1 : activeIdx; // -1 = no single active agent (all settled)
  const current = COLLAB_AGENTS[activeIdx];

  return (
    <div className={`flex flex-col items-center ${className ?? ''}`}>
      {/* Central Company Brain orb */}
      <CollabOrb complete={complete} reduce={reduce} />

      {/* Signal traces — vertical lines from active agent up to orb area */}
      {!reduce && !complete && (
        <div aria-hidden className="relative -mt-2 h-6 w-full overflow-hidden">
          <motion.div
            className="absolute left-1/2 h-full w-px -translate-x-1/2"
            style={{ background: 'linear-gradient(to bottom, hsl(var(--primary) / 0.45), transparent)' }}
            animate={{ opacity: [0.2, 0.8, 0.2] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
      )}

      {/* Active agent ability statement */}
      <div className="h-[3.5rem] text-center" aria-live="polite" aria-atomic="true">
        <AnimatePresence mode="wait">
          {complete ? (
            <motion.div
              key="complete"
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
            >
              <p className="text-[13px] font-medium text-foreground/90">All four agents contributed.</p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground/70">Your Company Brain is assembled and ready for review.</p>
            </motion.div>
          ) : (
            <motion.div
              key={activeIdx}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
            >
              <p className="text-[13px] font-medium text-foreground/90">{current.profile.name}</p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground/75">{current.statement}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Agent avatar row */}
      <div className="flex items-start justify-center gap-3 sm:gap-4">
        {COLLAB_AGENTS.map((a, i) => {
          const isActive = !complete && i === shown;
          const dimmed = !complete && !reduce && i !== shown;
          return (
            <AgentNode
              key={a.profile.id}
              agent={a}
              active={isActive}
              dimmed={dimmed}
              reduce={reduce}
            />
          );
        })}
      </div>

      {/* Honest source label */}
      {sourceLabel && (
        <p className="mt-3 text-[11px] text-muted-foreground/55">{sourceLabel}</p>
      )}
    </div>
  );
}

// ---- central orb ---------------------------------------------------------------

function CollabOrb({ complete, reduce }: { complete: boolean; reduce: boolean | null }) {
  const breathing = reduce
    ? undefined
    : { opacity: [0.5, 0.85, 0.5], scale: [1, 1.05, 1] };
  return (
    <motion.div
      className="relative"
      style={{ width: 96, height: 96 }}
      animate={reduce ? undefined : { y: [0, -4, 0] }}
      transition={reduce ? undefined : { duration: 6, repeat: Infinity, ease: 'easeInOut' }}
    >
      {/* bloom */}
      <motion.div
        aria-hidden
        className="absolute -inset-4 rounded-full"
        style={{ background: `radial-gradient(circle at 50% 50%, hsl(var(--primary) / ${complete ? 0.38 : 0.26}), transparent 70%)`, filter: 'blur(18px)' }}
        animate={breathing}
        transition={reduce ? undefined : { duration: complete ? 3 : 5, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* concentric ring */}
      <div aria-hidden className="absolute inset-0 rounded-full border border-primary/15" />
      <div aria-hidden className="absolute inset-[14%] rounded-full border border-primary/10" />

      {/* glass core */}
      <div
        className="absolute inset-[18%] rounded-full p-px"
        style={{ background: 'linear-gradient(155deg, hsl(var(--primary) / 0.55), hsl(var(--primary) / 0.10) 45%, hsl(var(--primary) / 0.32))' }}
      >
        <div
          className="flex h-full w-full items-center justify-center rounded-full bg-background/55 backdrop-blur-xl"
          style={{ boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.10), inset 0 -6px 16px hsl(var(--primary) / 0.08), 0 0 26px hsl(var(--primary) / 0.30)' }}
        >
          {complete ? (
            <motion.span
              initial={reduce ? false : { scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18 }}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground"
              style={{ boxShadow: '0 0 16px hsl(var(--primary) / 0.6)' }}
            >
              <Check className="h-4 w-4" />
            </motion.span>
          ) : (
            <Brain className="text-primary" style={{ width: 20, height: 20, filter: 'drop-shadow(0 0 5px hsl(var(--primary) / 0.55))' }} />
          )}
        </div>
      </div>

      {/* completion pulse ring */}
      {complete && !reduce && (
        <motion.div
          aria-hidden
          className="absolute inset-0 rounded-full border-2 border-primary/40"
          initial={{ scale: 0.8, opacity: 0.8 }}
          animate={{ scale: 1.6, opacity: 0 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
    </motion.div>
  );
}

// ---- agent avatar node ---------------------------------------------------------

function AgentNode({ agent, active, dimmed, reduce }: { agent: CollabAgent; active: boolean; dimmed: boolean; reduce: boolean | null }) {
  const { profile } = agent;
  return (
    <motion.div
      className="flex flex-col items-center gap-1"
      animate={{
        opacity: dimmed ? 0.4 : 1,
        scale: active && !reduce ? 1.08 : 1,
      }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
    >
      <div className="relative">
        <motion.div
          className="absolute -inset-1 rounded-full"
          animate={active && !reduce ? { opacity: [0.3, 0.7, 0.3] } : { opacity: 0 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ background: `radial-gradient(circle, ${profile.accentHex ?? 'hsl(var(--primary))'}55, transparent 70%)` }}
        />
        <div
          className="relative overflow-hidden rounded-full border-2 bg-background/40"
          style={{
            width: active ? 52 : 44,
            height: active ? 52 : 44,
            borderColor: active ? `${profile.accentHex ?? 'hsl(var(--primary))'}99` : 'hsl(var(--border) / 0.5)',
            boxShadow: active ? `0 0 12px ${profile.accentHex ?? 'hsl(var(--primary))'}44` : 'none',
            transition: 'width 0.4s, height 0.4s, border-color 0.4s, box-shadow 0.4s',
          }}
        >
          {profile.image ? (
            <img src={profile.image} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[14px] font-semibold text-muted-foreground">
              {profile.name[0]}
            </div>
          )}
        </div>
      </div>
      <span className={`text-[10px] font-medium tracking-tight ${active ? 'text-foreground/85' : 'text-muted-foreground/60'}`} style={{ transition: 'color 0.4s' }}>
        {profile.name}
      </span>
    </motion.div>
  );
}
