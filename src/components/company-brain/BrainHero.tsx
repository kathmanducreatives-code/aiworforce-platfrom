// Premium Active Brain hero for the saved Company Brain page.
//
// Compact (never consumes too much vertical space): quiet BrainOrb, title,
// Active + Approval-first indicators, company name / category / last-updated,
// and primary (Edit) + secondary (Refresh) actions. The Edit action opens a
// small section picker so "Edit Company Brain" no longer only opens company
// details.

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, ChevronDown, Pencil, RotateCcw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrainOrb } from '@/components/company-brain/BrainOrb';
import type { SectionKey } from '@/lib/companyBrainSections';
import { SECTION_META } from '@/lib/companyBrainSections';

interface Props {
  companyName: string;
  category: string;
  lastUpdated: string | null;
  onEditSection: (key: SectionKey) => void;
  onRestart: () => void;
}

export function BrainHero({ companyName, category, lastUpdated, onEditSection, onRestart }: Props) {
  const reduce = useReducedMotion();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <motion.header
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-[20px] p-px"
      style={{
        background:
          'linear-gradient(165deg, hsl(var(--primary) / 0.42) 0%, hsl(var(--border) / 0.45) 24%, hsl(var(--border) / 0.16) 55%, hsl(var(--primary) / 0.22) 100%)',
      }}
    >
      <div
        className="relative overflow-hidden rounded-[19px] px-5 py-5 backdrop-blur-xl sm:px-7 sm:py-6"
        style={{
          background: 'linear-gradient(180deg, hsl(var(--card) / 0.66) 0%, hsl(var(--card) / 0.46) 100%)',
          boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.07), 0 40px 80px -48px rgba(0,0,0,0.85)',
        }}
      >
        {/* top hairline */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-8 top-0 h-px"
          style={{ background: 'linear-gradient(to right, transparent, hsl(var(--primary) / 0.55), transparent)' }}
        />

        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <BrainOrb size={64} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground sm:text-[26px]">
                  Company Brain
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <CheckCircle2 className="h-3 w-3" /> Active
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <ShieldCheck className="h-3 w-3 text-primary/70" /> Approval-first
                </span>
              </div>
              <p className="mt-1.5 max-w-[52ch] text-[13.5px] leading-relaxed text-muted-foreground">
                Your strategic operating context for customer acquisition. Agentory uses this to decide who is worth
                researching, why now, and what to say.
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground/70">
                {companyName || 'Your company'}
                {category ? <span> · {category}</span> : null}
                {lastUpdated ? <span className="text-muted-foreground/60"> · updated {lastUpdated}</span> : null}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
            <div className="relative">
              <Button onClick={() => setPickerOpen((v) => !v)} className="gap-2">
                <Pencil className="h-3.5 w-3.5" /> Edit Company Brain
                <ChevronDown className="h-3.5 w-3.5 opacity-80" />
              </Button>
              {pickerOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} aria-hidden />
                  <motion.div
                    initial={reduce ? false : { opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-border/60 bg-card/95 p-1 backdrop-blur-2xl"
                    style={{ boxShadow: '0 24px 60px -24px rgba(0,0,0,0.8)' }}
                  >
                    {(Object.keys(SECTION_META) as SectionKey[]).map((key) => {
                      const M = SECTION_META[key];
                      const Ic = M.icon;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => { setPickerOpen(false); onEditSection(key); }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground/90 transition-colors hover:bg-primary/10"
                        >
                          <Ic className="h-4 w-4 text-primary/80" />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate">{M.title}</span>
                            <span className="truncate text-[11px] text-muted-foreground/70">{M.explanation}</span>
                          </span>
                        </button>
                      );
                    })}
                  </motion.div>
                </>
              )}
            </div>
            <Button variant="outline" onClick={onRestart} className="gap-2">
              <RotateCcw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </div>

        {/* safety line */}
        <p className="relative mt-4 flex items-center gap-1.5 text-[11.5px] text-muted-foreground/70">
          <ShieldCheck className="h-3.5 w-3.5 text-primary/60" />
          Nothing sends automatically. You stay in control.
        </p>
      </div>
    </motion.header>
  );
}
