// Compact ICP hero for the vertical Company Brain flow.
//
// Quiet BrainOrb, "Company Brain" / "ICP / Targeting" title, Active + Approval-
// first status, company metadata, last-updated, one-line explanation, Edit ICP
// (opens section picker) + Refresh Brain. Safety statement appears once here.

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, ChevronDown, Pencil, RotateCcw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrainOrb } from '@/components/company-brain/BrainOrb';
import { FLOW_SECTIONS, SECTION_META, type SectionKey } from '@/lib/companyBrainSections';

interface Props {
  companyName: string;
  category: string;
  stage: string;
  lastUpdated: string | null;
  onEditSection: (key: SectionKey) => void;
  onRestart: () => void;
}

export function IcpHero({ companyName, category, stage, lastUpdated, onEditSection, onRestart }: Props) {
  const reduce = useReducedMotion();
  const [pickerOpen, setPickerOpen] = useState(false);

  const meta = [companyName, category, stage].filter(Boolean).join(' · ');

  return (
    <motion.header
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-[24px] p-px"
      style={{
        background:
          'linear-gradient(165deg, hsl(160 84% 52% / 0.24) 0%, hsl(var(--border) / 0.20) 22%, hsl(var(--border) / 0.06) 55%, hsl(160 84% 52% / 0.12) 100%)',
      }}
    >
      <div
        className="relative overflow-hidden rounded-[23px] px-5 py-5 backdrop-blur-2xl backdrop-saturate-[1.5]"
        style={{
          background: 'linear-gradient(180deg, hsl(var(--card) / 0.46) 0%, hsl(var(--card) / 0.28) 100%)',
          boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.09), 0 56px 110px -52px rgba(0,0,0,0.92)',
        }}
      >
        {/* top hairline */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-8 top-0 h-px"
          style={{ background: 'linear-gradient(to right, transparent, hsl(var(--primary) / 0.50), transparent)' }}
        />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <BrainOrb size={60} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="text-[20px] font-semibold leading-tight tracking-tight text-foreground sm:text-[24px]">
                  Company Brain
                </h1>
                <span className="text-[14px] font-medium text-muted-foreground/60">/ ICP / Targeting</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <CheckCircle2 className="h-3 w-3" /> Active
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <ShieldCheck className="h-3 w-3 text-primary/70" /> Approval-first
                </span>
                {meta && <span className="text-[11px] text-muted-foreground/70">{meta}</span>}
                {lastUpdated && <span className="text-[11px] text-muted-foreground/55">· updated {lastUpdated}</span>}
              </div>
              <p className="mt-1.5 max-w-[56ch] text-[12.5px] leading-relaxed text-muted-foreground/85">
                Who Agentory should research, prioritize, and contact — and how it should speak for you.
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="relative">
              <Button onClick={() => setPickerOpen((v) => !v)} className="gap-2">
                <Pencil className="h-3.5 w-3.5" /> Edit ICP
                <ChevronDown className="h-3.5 w-3.5 opacity-80" />
              </Button>
              {pickerOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)} aria-hidden />
                  <motion.div
                    initial={reduce ? false : { opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-border/60 bg-card/95 p-1 backdrop-blur-2xl"
                    style={{ boxShadow: '0 24px 60px -24px rgba(0,0,0,0.8)' }}
                  >
                    {FLOW_SECTIONS.map((f) => {
                      const M = SECTION_META[f.drawerKey];
                      const Ic = M.icon;
                      return (
                        <button
                          key={f.drawerKey}
                          type="button"
                          onClick={() => { setPickerOpen(false); onEditSection(f.drawerKey); }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground/90 transition-colors hover:bg-primary/10"
                        >
                          <Ic className="h-4 w-4 shrink-0 text-primary/80" />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate">{f.title}</span>
                            <span className="truncate text-[11px] text-muted-foreground/70">{f.explanation}</span>
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

        {/* safety line — once, quiet */}
        <p className="relative mt-3.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground/65">
          <ShieldCheck className="h-3.5 w-3.5 text-primary/55" />
          Nothing sends automatically. You stay in control.
        </p>
      </div>
    </motion.header>
  );
}
