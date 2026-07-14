// Quiet glass workflow footer for the vertical Company Brain flow.
//
// "Powered by this Company Brain" with compact connected items:
// Leads → Scout Radar → Content → Agents → Outreach.
//
// Includes a subtle "empowering your agents" loop: the workflow nodes
// illuminate in sequence, suggesting the Company Brain is actively powering
// the AI workforce. Very slow, very quiet, reduced-motion safe.

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Users, Radar, BookOpen, Sparkles, Mail } from 'lucide-react';

const CHAIN = [
  { icon: Users, label: 'Leads' },
  { icon: Radar, label: 'Scout Radar' },
  { icon: BookOpen, label: 'Content' },
  { icon: Sparkles, label: 'Agents' },
  { icon: Mail, label: 'Outreach' },
];

const CYCLE_MS = 3200;

export function SystemImpactFooter() {
  const reduce = useReducedMotion();
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setActiveIdx((i) => (i + 1) % CHAIN.length), CYCLE_MS / CHAIN.length);
    return () => clearInterval(t);
  }, [reduce]);

  return (
    <motion.footer
      initial={reduce ? false : { opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5 }}
      className="relative overflow-hidden rounded-[20px] border border-border/25 bg-card/22 backdrop-blur-2xl backdrop-saturate-[1.4]"
      style={{ boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.06), 0 30px 60px -48px rgba(0,0,0,0.6)' }}
    >
      {/* faint pulse core — origin of the "empowering" signal */}
      {!reduce && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute left-6 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full"
          style={{ background: 'radial-gradient(circle, hsl(160 84% 52% / 0.20), transparent 70%)', filter: 'blur(6px)' }}
          animate={{ opacity: [0.3, 0.7, 0.3], scale: [1, 1.3, 1] }}
          transition={{ duration: CYCLE_MS / 1000, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      <div className="relative flex flex-col items-center gap-3 px-5 py-4 sm:flex-row sm:justify-between sm:px-6">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
          <Sparkles className="h-3 w-3 text-emerald-400/50" />
          Powered by this Company Brain
        </p>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {CHAIN.map(({ icon: Icon, label }, i) => {
            const isActive = !reduce && i === activeIdx;
            return (
              <div key={label} className="flex items-center gap-1.5">
                <motion.span
                  animate={{
                    borderColor: isActive ? 'hsl(160 84% 52% / 0.55)' : 'hsl(var(--border) / 0.35)',
                    backgroundColor: isActive ? 'hsl(160 84% 52% / 0.12)' : 'hsl(var(--background) / 0.25)',
                  }}
                  transition={{ duration: 0.5, ease: 'easeInOut' }}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]"
                  style={{
                    color: isActive ? 'hsl(0 0% 92%)' : 'hsl(var(--foreground) / 0.70)',
                    boxShadow: isActive ? '0 0 10px hsl(160 84% 52% / 0.25)' : 'none',
                  }}
                >
                  <Icon
                    className="h-3 w-3"
                    style={{
                      color: isActive ? 'hsl(160 84% 60%)' : 'hsl(var(--primary) / 0.55)',
                      transition: 'color 0.5s',
                    }}
                  />
                  {label}
                </motion.span>
                {i < CHAIN.length - 1 && (
                  <motion.span
                    aria-hidden
                    animate={{ opacity: !reduce && i === activeIdx ? 0.8 : 0.2 }}
                    transition={{ duration: 0.4 }}
                    className="text-muted-foreground/30"
                  >
                    →
                  </motion.span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </motion.footer>
  );
}
