// Research phase scenes.
//   9.  draft_brain   → the "Draft my Company Brain" moment (calls draft)
//   10. draft_summary → completion: "Your Company Brain is ready."
//
// The busy (drafting) state uses a 40/60 split: left holds the honest area
// checklist + compact progress footer; right shows the WorkforceCollaboration
// animation (Scout → Hawk → Aria → Scribe). The oversized disabled CTA is gone,
// replaced by a compact progress footer. Back lives top-left.

import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Sparkles, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SceneFrame } from '@/components/onboarding/SceneFrame';
import { WorkforceCollaboration } from '@/components/onboarding/WorkforceCollaboration';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';

const AREAS = [
  { id: 't', label: 'Targeting' },
  { id: 'b', label: 'Buyer personas' },
  { id: 's', label: 'Buying signals' },
  { id: 'sf', label: 'Safety rules' },
  { id: 'm', label: 'Messaging' },
];

// -------------------------------------------------------- Scene 9: draft ----

export function DraftBrainScene({ busy, onDraft, onBack }: {
  busy: boolean; onDraft: () => void; onBack: () => void;
}) {
  if (busy) {
    return <DraftingState onBack={onBack} />;
  }
  return (
    <SceneFrame
      eyebrow="Step 3 of 5 · Research"
      title="Ready to draft your Company Brain"
      helper="Agentory turns everything it read into a first ICP. Anything inferred without proof is flagged for you — never invented."
      width="xl"
      footer={
        <div className="flex flex-col gap-3">
          <Button
            size="lg"
            onClick={onDraft}
            className="group h-[52px] w-full gap-2 rounded-xl text-[15px] font-medium tracking-tight text-primary-foreground bg-gradient-to-b from-primary to-[hsl(var(--primary)/0.82)] shadow-[0_1px_0_hsl(var(--foreground)/0.12)_inset,0_10px_30px_-12px_hsl(var(--primary)/0.55)] transition-all duration-300 hover:-translate-y-px hover:shadow-[0_1px_0_hsl(var(--foreground)/0.15)_inset,0_14px_40px_-12px_hsl(var(--primary)/0.7),0_0_30px_hsl(var(--primary)/0.25)] active:translate-y-0"
          >
            <Sparkles className="h-4 w-4" /> Draft my Company Brain
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground/80 transition-colors hover:text-foreground">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
          </Button>
        </div>
      }
    >
      <div className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.04] p-4 text-sm text-foreground/80">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        Targeting, buyers, signals, safety rules and messaging — drafted from real evidence and your own words.
      </div>
    </SceneFrame>
  );
}

/** The drafting (busy) state — 40/60 split with workforce animation. */
function DraftingState({ onBack }: { onBack: () => void }) {
  return (
    <DraftingFrame onBack={onBack}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[5fr_7fr] lg:gap-8">
        {/* Left — research summary + honest area checklist */}
        <div className="flex flex-col justify-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary/80">Step 3 of 5 · Research</p>
          <h2 className="mt-2 text-[22px] font-semibold leading-tight tracking-tight text-foreground sm:text-[26px]">
            Building your Company Brain
          </h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground/85">
            Agentory's AI workforce is turning your company and founder context into a first ICP.
          </p>

          {/* honest area checklist — no fake sequential completion */}
          <div className="mt-5">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
              Building these parts of your Company Brain
            </p>
            <ul className="space-y-1.5">
              {AREAS.map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 text-[13px] text-foreground/75">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full border border-primary/30 bg-primary/[0.06]">
                    <span className="h-1 w-1 rounded-full bg-primary/50" />
                  </span>
                  {a.label}
                </li>
              ))}
            </ul>
          </div>

          {/* compact progress footer — replaces oversized disabled CTA */}
          <div className="mt-6 flex items-center gap-2.5 rounded-xl border border-border/40 bg-background/25 px-3.5 py-2.5">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary/70" />
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-foreground/85">Drafting your Company Brain…</p>
              <p className="text-[11px] leading-snug text-muted-foreground/60">
                This takes a moment. Your active Company Brain stays unchanged until you approve.
              </p>
            </div>
          </div>
        </div>

        {/* Right — workforce collaboration animation */}
        <div className="flex items-center justify-center py-2 lg:py-4">
          <WorkforceCollaboration
            active
            sourceLabel="Reviewing company and founder context"
          />
        </div>
      </div>
    </DraftingFrame>
  );
}

/** Glass frame for the drafting state — owns the Back button in the top-left. */
function DraftingFrame({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="relative mx-auto w-full max-w-[900px]">
      {/* Back — top-left, quiet */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="absolute -top-2 left-0 z-10 text-muted-foreground/70 transition-colors hover:text-foreground sm:-left-2"
      >
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
      </Button>

      {/* glass shell */}
      <div
        className="rounded-[22px] p-px"
        style={{
          background:
            'linear-gradient(165deg, hsl(var(--primary) / 0.45) 0%, hsl(var(--border) / 0.5) 22%, hsl(var(--border) / 0.18) 55%, hsl(var(--primary) / 0.22) 100%)',
        }}
      >
        <div
          className="relative overflow-hidden rounded-[21px] px-6 py-8 backdrop-blur-2xl sm:px-10 sm:py-10"
          style={{
            background: 'linear-gradient(180deg, hsl(var(--card) / 0.72) 0%, hsl(var(--card) / 0.55) 100%)',
            boxShadow: [
              'inset 0 1px 0 hsl(var(--foreground) / 0.07)',
              '0 50px 100px -48px rgba(0,0,0,0.85)',
              '0 24px 80px -36px hsl(var(--primary) / 0.35)',
            ].join(', '),
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-0 h-px"
            style={{ background: 'linear-gradient(to right, transparent, hsl(var(--primary) / 0.6), transparent)' }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-28"
            style={{ background: 'linear-gradient(180deg, hsl(var(--foreground) / 0.035), transparent)' }}
          />
          {children}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------ Scene 10: summary ---

export function DraftSummaryScene({ brain, onReview, onBack }: {
  brain: CompanyBrainV2; onReview: () => void; onBack: () => void;
}) {
  const [revealed, setRevealed] = useState(false);

  const counts = [
    { label: 'Industries', n: brain.target_customer.industries.length },
    { label: 'Buyer personas', n: brain.buyer_personas.length },
    { label: 'Signals', n: brain.triggers.length + brain.jobs_to_watch.length },
    { label: 'Disqualifiers', n:
      brain.target_customer.disqualifiers.industries.length +
      brain.target_customer.disqualifiers.company_types.length +
      brain.target_customer.disqualifiers.keywords.length },
    { label: 'Content angles', n: brain.content_angles.length },
  ];

  // Trigger the completion reveal shortly after mount.
  useEffect(() => { const t = setTimeout(() => setRevealed(true), 100); return () => clearTimeout(t); }, []);

  return (
    <div className="relative mx-auto w-full max-w-[820px]">
      <div
        className="rounded-[22px] p-px"
        style={{
          background:
            'linear-gradient(165deg, hsl(var(--primary) / 0.50) 0%, hsl(var(--border) / 0.5) 22%, hsl(var(--border) / 0.18) 55%, hsl(var(--primary) / 0.28) 100%)',
        }}
      >
        <div
          className="relative overflow-hidden rounded-[21px] px-6 py-8 backdrop-blur-2xl sm:px-10 sm:py-10"
          style={{
            background: 'linear-gradient(180deg, hsl(var(--card) / 0.72) 0%, hsl(var(--card) / 0.55) 100%)',
            boxShadow: [
              'inset 0 1px 0 hsl(var(--foreground) / 0.07)',
              '0 50px 100px -48px rgba(0,0,0,0.85)',
              '0 24px 80px -36px hsl(var(--primary) / 0.40)',
            ].join(', '),
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-8 top-0 h-px"
            style={{ background: 'linear-gradient(to right, transparent, hsl(var(--primary) / 0.6), transparent)' }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-28"
            style={{ background: 'linear-gradient(180deg, hsl(var(--foreground) / 0.035), transparent)' }}
          />

          {/* convergence completion animation */}
          <div className="flex flex-col items-center">
            <WorkforceCollaboration active={false} complete={revealed} />
          </div>

          {/* headline */}
          <div className="mt-6 text-center">
            <div className="mb-1.5 flex items-center justify-center gap-1.5">
              <Check className="h-4 w-4 text-primary" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary/80">Step 3 of 5 · Research</p>
            </div>
            <h1 className="text-balance text-[26px] font-semibold leading-[1.12] tracking-[-0.022em] text-foreground sm:text-[30px]">
              Your Company Brain is ready
            </h1>
            <p className="mx-auto mt-2.5 max-w-[48ch] text-[14px] leading-relaxed text-muted-foreground/90">
              Review the targeting, buyers, signals, safety rules, and messaging Agentory prepared.
            </p>
          </div>

          {/* counts */}
          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-5 sm:gap-3">
            {counts.map((c) => (
              <div key={c.label} className="rounded-xl border border-border/50 bg-background/30 px-3 py-3 text-center">
                <p className="text-xl font-semibold tabular-nums text-primary">{c.n}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-[0.13em] text-muted-foreground/80">{c.label}</p>
              </div>
            ))}
          </div>

          {/* CTAs */}
          <div className="mt-7 flex flex-col gap-3">
            <Button
              size="lg"
              onClick={onReview}
              className="group h-[52px] w-full gap-2 rounded-xl text-[15px] font-medium tracking-tight text-primary-foreground bg-gradient-to-b from-primary to-[hsl(var(--primary)/0.82)] shadow-[0_1px_0_hsl(var(--foreground)/0.12)_inset,0_10px_30px_-12px_hsl(var(--primary)/0.55)] transition-all duration-300 hover:-translate-y-px hover:shadow-[0_1px_0_hsl(var(--foreground)/0.15)_inset,0_14px_40px_-12px_hsl(var(--primary)/0.7),0_0_30px_hsl(var(--primary)/0.25)] active:translate-y-0"
            >
              Review my Brain
            </Button>
            <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground/80 transition-colors hover:text-foreground">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
