// Step 5 — Activation. Cinematic one-screen launch moment.
//
// Presentational: the caller owns the activate/save handlers and wiring.
// Copy rules enforced here: real product surfaces only, nothing claims to
// send automatically, Scout Radar does not auto-start.

import { motion } from 'framer-motion';
import {
  AlertTriangle, Cpu, Loader2, PenLine, Radar, Rocket, Send, ShieldCheck, Target,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BRAIN_POWERS, type CompletenessResult } from '@/lib/companyBrainCompleteness';
import { CompletenessRing } from './CompletenessRing';

const POWER_ICONS: Record<string, React.ReactNode> = {
  leads: <Target className="h-4 w-4" />,
  radar: <Radar className="h-4 w-4" />,
  content: <PenLine className="h-4 w-4" />,
  agents: <Cpu className="h-4 w-4" />,
  outreach: <Send className="h-4 w-4" />,
};

export function ActivationHero({
  completeness, busy, canActivate, onActivate, onSaveDraft,
}: {
  completeness: CompletenessResult;
  busy?: 'activate' | 'save' | null;
  canActivate?: boolean;
  onActivate?: () => void;
  onSaveDraft?: () => void;
}) {
  const complete = completeness.complete;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* Orb + readiness + CTA */}
      <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-3xl border border-border/50 bg-gradient-to-b from-primary/[0.08] via-card/40 to-card/40 p-6 text-center backdrop-blur-xl lg:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: 'radial-gradient(480px 260px at 50% 0%, hsl(var(--primary) / 0.22), transparent 70%)' }}
        />

        <div className="relative">
          {/* Readiness orb */}
          <div className="relative mx-auto mb-4 w-fit">
            <motion.div
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{ boxShadow: '0 0 70px 24px hsl(var(--primary) / 0.22)' }}
              animate={{ opacity: complete ? [0.5, 0.95, 0.5] : [0.25, 0.5, 0.25] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              aria-hidden
              className="absolute -inset-3 rounded-full border border-primary/20"
              animate={{ rotate: 360 }}
              transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
              style={{
                background:
                  'conic-gradient(from 0deg, transparent 0%, hsl(var(--primary) / 0.18) 12%, transparent 26%)',
              }}
            />
            <CompletenessRing value={completeness.percent} size={136} stroke={10} caption="Ready" />
          </div>

          <p className="mb-1.5 text-[11px] uppercase tracking-[0.22em] text-primary/80">
            {complete ? 'Ready to launch' : 'Almost there'}
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {complete ? 'Your Company Brain is ready.' : 'A few pieces still to confirm.'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground sm:text-sm">
            Agentory will use this to qualify leads, score signals, draft content, and prepare
            outreach. Nothing sends automatically.
          </p>

          <div className="mt-3 inline-flex flex-wrap items-center justify-center gap-2">
            <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-primary">
              {completeness.confidence} confidence
            </span>
            <span className="text-[11px] text-muted-foreground">
              {completeness.required_met}/{completeness.required_total} required · {completeness.bonus_met}/{completeness.bonus_total} bonus
            </span>
          </div>

          {/* Launch CTA */}
          <div className="mt-4 flex flex-col items-center gap-2">
            <Button
              size="lg"
              onClick={onActivate}
              disabled={!canActivate || busy === 'activate'}
              className="min-w-[250px] gap-2 bg-primary text-primary-foreground shadow-[0_0_32px_hsl(var(--primary)/0.45)] transition-shadow hover:bg-primary/90 hover:shadow-[0_0_44px_hsl(var(--primary)/0.6)]"
            >
              {busy === 'activate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Activate Company Brain
            </Button>
            {!complete && onSaveDraft && (
              <Button variant="ghost" size="sm" onClick={onSaveDraft} disabled={busy === 'save'} className="h-8 text-xs text-muted-foreground">
                {busy === 'save' && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                Save draft and finish later
              </Button>
            )}
          </div>

          {/* Safety strip */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Pill text="No outreach sent" />
            <Divider />
            <Pill text="No Scout Radar scan started" />
            <Divider />
            <Pill text="You stay in control" />
          </div>
        </div>
      </div>

      {/* Right column — powers + missing */}
      <div className="flex min-w-0 flex-col gap-4">
        <div className="rounded-2xl border border-border/50 bg-card/40 p-4 backdrop-blur-xl">
          <h3 className="mb-3 px-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            What this powers
          </h3>
          <div className="space-y-1.5">
            {BRAIN_POWERS.map((p, i) => (
              <motion.div
                key={p.key}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 * i, duration: 0.3 }}
                className={[
                  'flex items-start gap-3 rounded-xl border p-2.5 transition-colors',
                  complete ? 'border-primary/25 bg-primary/[0.05]' : 'border-border/40 bg-background/30',
                ].join(' ')}
              >
                <span
                  className={[
                    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border',
                    complete
                      ? 'border-primary/30 bg-primary/10 text-primary shadow-[0_0_12px_hsl(var(--primary)/0.2)]'
                      : 'border-border/40 bg-background/40 text-muted-foreground',
                  ].join(' ')}
                >
                  {POWER_ICONS[p.key]}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-tight text-foreground">{p.label}</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{p.blurb}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {completeness.missing.length > 0 && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-4 backdrop-blur-sm">
            <h3 className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-amber-300">
              <AlertTriangle className="h-3 w-3" /> Still to confirm
            </h3>
            <ul className="space-y-1.5">
              {completeness.missing.slice(0, 6).map((m) => (
                <li key={m} className="flex items-start gap-2 text-xs text-amber-100/90">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400/80" />
                  {m}
                </li>
              ))}
              {completeness.missing.length > 6 && (
                <li className="text-[11px] text-amber-200/60">
                  +{completeness.missing.length - 6} more in the Brain panel
                </li>
              )}
            </ul>
          </div>
        )}
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
