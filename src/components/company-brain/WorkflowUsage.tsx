// Promoted workflow usage — shows the five system areas this Company Brain
// powers, as premium tiles with an icon and a one-line description. Placed
// prominently in the page (not a forgotten footer) and closes with the
// approval-first reassurance line.

import { motion, useReducedMotion } from 'framer-motion';
import { Users, Radar, BookOpen, Sparkles, Mail, ShieldCheck } from 'lucide-react';

const TILES = [
  { icon: Users, label: 'Leads', desc: 'Filters and ranks companies against your ICP.' },
  { icon: Radar, label: 'Scout Radar', desc: 'Watches for relevant buying signals.' },
  { icon: BookOpen, label: 'Content', desc: 'Uses your positioning, buyers, and voice.' },
  { icon: Sparkles, label: 'Agents', desc: 'Grounds AI decisions in your company context.' },
  { icon: Mail, label: 'Outreach', desc: 'Prepares signal-based drafts for approval.' },
];

export function WorkflowUsage() {
  const reduce = useReducedMotion();
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-[20px] border border-border/50 bg-card/35 backdrop-blur-xl"
      style={{ boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.05), 0 30px 60px -48px rgba(0,0,0,0.7)' }}
    >
      <div className="border-b border-border/40 px-5 py-3 sm:px-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/80">How this powers work</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Agentory uses this Company Brain to decide who is worth researching, why now, and what to say.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        {TILES.map(({ icon: Icon, label, desc }, i) => (
          <motion.div
            key={label}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, delay: reduce ? 0 : 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
            className="group relative min-w-0 border-b border-border/40 px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 lg:border-b-0"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              style={{ background: 'radial-gradient(70% 70% at 50% 0%, hsl(var(--primary) / 0.08), transparent 70%)' }}
            />
            <div className="relative">
              <div
                className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg border border-primary/25 bg-primary/10"
                style={{ boxShadow: '0 0 14px -6px hsl(var(--primary) / 0.5)' }}
              >
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <p className="text-[13px] font-semibold tracking-tight text-foreground">{label}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{desc}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <p className="flex items-center gap-1.5 border-t border-border/40 px-5 py-3 text-[11.5px] text-muted-foreground/70 sm:px-6">
        <ShieldCheck className="h-3.5 w-3.5 text-primary/60" />
        Nothing sends automatically. Every external action remains approval-first.
      </p>
    </motion.section>
  );
}
