// Step 5 — Activation hero. Cinematic launch moment.
// Presentational only; caller provides the completeness object + press handler on the parent.

import { motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { BRAIN_POWERS, type CompletenessResult } from '@/lib/companyBrainCompleteness';
import { CompletenessRing } from './CompletenessRing';

export function ActivationHero({ completeness }: { completeness: CompletenessResult }) {
  const complete = completeness.complete;

  return (
    <div className="space-y-6">
      {/* Orb + readiness */}
      <div className="relative overflow-hidden rounded-3xl border border-border/50 bg-gradient-to-b from-primary/[0.08] via-card/40 to-card/40 p-10 text-center backdrop-blur-xl">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: 'radial-gradient(500px 260px at 50% 0%, hsl(var(--primary) / 0.22), transparent 70%)' }}
        />
        <div className="relative">
          <div className="mb-6 flex justify-center">
            <div className="relative">
              <motion.div
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{ boxShadow: '0 0 60px 20px hsl(var(--primary) / 0.25)' }}
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              />
              <CompletenessRing value={completeness.percent} size={200} stroke={12} caption="Ready" />
            </div>
          </div>
          <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-primary/80">
            {complete ? 'Ready to launch' : 'Almost there'}
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {complete ? 'Your Company Brain is ready.' : 'A few pieces still to confirm.'}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
            {complete
              ? 'Activate to power Leads, Scout Radar, Content, Agents and Outreach with this context.'
              : 'Complete the required fields to activate. You can save a draft and finish later.'}
          </p>
          <div className="mt-5 inline-flex items-center gap-2">
            <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-primary">
              {completeness.confidence} confidence
            </span>
            <span className="text-[11px] text-muted-foreground">
              {completeness.required_met}/{completeness.required_total} required · {completeness.bonus_met}/{completeness.bonus_total} bonus
            </span>
          </div>
        </div>
      </div>

      {/* Powers grid */}
      <div className="rounded-2xl border border-border/50 bg-card/40 p-6 backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">What Agentory will use this for</h3>
          <span className="text-[10px] uppercase tracking-[0.14em] text-primary/70">Real product surfaces</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BRAIN_POWERS.map((p, i) => (
            <motion.div
              key={p.key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i }}
              className={[
                'rounded-xl border p-4 transition-colors',
                complete ? 'border-primary/30 bg-primary/[0.04]' : 'border-border/40 bg-background/30',
              ].join(' ')}
            >
              <p className="text-sm font-semibold tracking-tight text-foreground">{p.label}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{p.blurb}</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Still to review */}
      {completeness.missing.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-5 backdrop-blur-sm">
          <h3 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-amber-300">Still to confirm</h3>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {completeness.missing.map((m) => (
              <li key={m} className="flex items-start gap-2 text-xs text-amber-100/90">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400/80" />
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Safety strip */}
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-border/40 bg-background/40 px-4 py-2.5 backdrop-blur-sm">
        <Pill text="No outreach sent" />
        <Divider />
        <Pill text="No Scout Radar scan started" />
        <Divider />
        <Pill text="You stay in control" />
      </div>
    </div>
  );
}

function Pill({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <ShieldCheck className="h-3 w-3 text-primary" />
      {text}
    </span>
  );
}
function Divider() {
  return <span className="h-3 w-px bg-border/50" aria-hidden />;
}
