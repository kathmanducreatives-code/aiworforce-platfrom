// Premium centered editor Dialog for a single Company Brain section.
// Replaces the previous right-side Sheet drawer. Same public props, same
// `initialFor`/`buildPatch` save contract — this is a frontend-only refresh.
//
// Each section maps to a fixed set of top-level `company_brain.profile` keys.
// Save emits a partial patch that the parent shallow-merges onto the raw
// profile, so we never overwrite fields we don't render.

import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Brain, Check, Crosshair, Loader2, Megaphone, Radar, ShieldAlert, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ChipInput } from '@/components/onboarding/ChipInput';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';
import type { BrainProfile } from '@/lib/companyBrainView';

export type SectionKey = 'company' | 'targeting' | 'buyers' | 'signals' | 'disqualifiers' | 'messaging';

interface Props {
  open: boolean;
  section: SectionKey | null;
  brain: CompanyBrainV2;
  onOpenChange: (v: boolean) => void;
  onSave: (patch: BrainProfile) => Promise<void> | void;
}

const SECTION_ORDER: SectionKey[] = ['company', 'targeting', 'buyers', 'signals', 'disqualifiers', 'messaging'];

const TITLES: Record<SectionKey, {
  eyebrow: string;
  title: string;
  short: string;
  description: string;
  influences: string;
  icon: ComponentType<{ className?: string }>;
}> = {
  company:       { eyebrow: 'COMPANY BRAIN', title: 'Edit Company Understanding', short: 'Company',        description: 'What Agentory tells other agents about your company.', influences: 'Grounds every agent in what you do and who you sell to.', icon: Brain },
  targeting:     { eyebrow: 'COMPANY BRAIN', title: 'Edit ICP & Targeting',       short: 'Target Market', description: 'Define which accounts Agentory should research, prioritize, and prepare outreach for.', influences: 'Scout filters, Aria ranks, Outreach positions — all use this.', icon: Crosshair },
  buyers:        { eyebrow: 'COMPANY BRAIN', title: 'Edit Buyer Profile',         short: 'Buyer Profile', description: 'The roles you sell to and the pains you solve.', influences: 'Focuses outreach on the right decision-makers.', icon: Users },
  signals:       { eyebrow: 'COMPANY BRAIN', title: 'Edit Buying Signals',        short: 'Buying Moments',description: 'What Scout Radar should watch for.', influences: 'Decides which timing signals are worth surfacing.', icon: Radar },
  disqualifiers: { eyebrow: 'COMPANY BRAIN', title: 'Edit Qualification',         short: 'Qualification', description: 'Who and what to never target.', influences: 'Stops bad-fit leads and banned claims before anything sends.', icon: ShieldAlert },
  messaging:     { eyebrow: 'COMPANY BRAIN', title: 'Edit Messaging & Positioning', short: 'Messaging Fit', description: 'How Agentory should sound on your behalf.', influences: 'Shapes outreach drafts, content, and brand voice.', icon: Megaphone },
};

export default function CompanyBrainEditDrawer({ open, section, brain, onOpenChange, onSave }: Props) {
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [state, setState] = useState<any>(null);
  const [activeSection, setActiveSection] = useState<SectionKey | null>(section);
  const initialRef = useRef<string>('');

  // Sync active section when opening or when parent changes it.
  useEffect(() => {
    if (open) setActiveSection(section);
  }, [open, section]);

  useEffect(() => {
    if (!open || !activeSection) return;
    const init = initialFor(activeSection, brain);
    setState(init);
    initialRef.current = JSON.stringify(init);
    setSaved(false);
  }, [open, activeSection, brain]);

  const dirty = useMemo(() => {
    if (!state) return false;
    return JSON.stringify(state) !== initialRef.current;
  }, [state]);

  function switchSection(next: SectionKey) {
    if (busy || next === activeSection) return;
    if (dirty && !saved) {
      const ok = typeof window !== 'undefined'
        ? window.confirm('Discard unsaved changes in this section?')
        : true;
      if (!ok) return;
    }
    setActiveSection(next);
  }

  function requestClose(next: boolean) {
    if (busy) return;
    if (!next && dirty && !saved) {
      const ok = typeof window !== 'undefined' ? window.confirm('Discard unsaved changes?') : true;
      if (!ok) return;
    }
    onOpenChange(next);
  }

  async function handleSave() {
    if (!activeSection || !state) return;
    setBusy(true);
    try {
      await onSave(buildPatch(activeSection, state, brain));
      initialRef.current = JSON.stringify(state);
      setSaved(true);
      setTimeout(() => setSaved(false), reduce ? 0 : 1400);
    } finally {
      setBusy(false);
    }
  }

  if (!activeSection) return null;
  const meta = TITLES[activeSection];
  const Icon = meta.icon;
  const sectionIndex = SECTION_ORDER.indexOf(activeSection) + 1;


  return (
    <DialogPrimitive.Root open={open} onOpenChange={requestClose}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          data-testid="cb-editor-dialog"
          onEscapeKeyDown={(e) => {
            if (dirty && !saved) {
              e.preventDefault();
              requestClose(false);
            }
          }}
          onPointerDownOutside={(e) => {
            if (dirty && !saved) {
              e.preventDefault();
              requestClose(false);
            }
          }}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
            'w-[min(1040px,calc(100vw-32px))] max-h-[calc(100vh-72px)]',
            'rounded-3xl border border-emerald-400/20 bg-card/70 backdrop-blur-2xl backdrop-saturate-150',
            'shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200',
          )}
          style={{
            boxShadow: saved
              ? 'inset 0 0 0 1px hsl(160 84% 52% / 0.45), 0 40px 120px -30px rgba(0,0,0,0.9), 0 0 80px -20px hsl(160 84% 52% / 0.35)'
              : 'inset 0 0 0 1px hsl(160 84% 52% / 0.12), 0 40px 120px -30px rgba(0,0,0,0.9)',
          }}
        >
          {/* top hairline */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-10 top-0 h-px"
            style={{ background: 'linear-gradient(to right, transparent, hsl(160 84% 52% / 0.55), transparent)' }}
          />

          {/* Sticky header */}
          <header
            data-testid="cb-editor-header"
            className="sticky top-0 z-10 flex items-start gap-4 border-b border-border/25 bg-card/40 px-7 py-5 backdrop-blur-xl"
          >
            <div
              className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.08]"
              style={{ boxShadow: '0 0 20px -6px hsl(160 84% 52% / 0.5), inset 0 1px 0 hsl(var(--foreground) / 0.06)' }}
            >
              <Icon className="h-[19px] w-[19px] text-emerald-300" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">{meta.eyebrow}</p>
              <DialogPrimitive.Title asChild>
                <h2 className="mt-0.5 text-[22px] font-semibold leading-tight tracking-tight text-foreground sm:text-[26px]">
                  {meta.title}
                </h2>
              </DialogPrimitive.Title>
              <DialogPrimitive.Description asChild>
                <p className="mt-1 max-w-[68ch] text-[13.5px] leading-relaxed text-muted-foreground/85">
                  {meta.description}
                </p>
              </DialogPrimitive.Description>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {dirty && !saved && (
                <span className="hidden items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/[0.08] px-2.5 py-1 text-[11px] font-medium text-amber-300 sm:inline-flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                  Unsaved
                </span>
              )}
              <DialogPrimitive.Close
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/40 bg-background/40 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                aria-label="Close editor"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>
          </header>

          {/* Section context strip */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border/20 bg-background/20 px-7 py-2.5 text-[11.5px] text-muted-foreground/80">
            <span className="font-medium text-foreground/70">Section {sectionIndex} of {SECTION_ORDER.length}</span>
            <span className="text-muted-foreground/40">·</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {SECTION_ORDER.map((s) => {
                const active = s === activeSection;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => switchSection(s)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                      active
                        ? 'border-emerald-400/40 bg-emerald-400/[0.10] text-emerald-200'
                        : 'border-border/30 bg-background/20 text-muted-foreground/70 hover:border-emerald-400/30 hover:text-foreground',
                    )}
                  >
                    {TITLES[s].short}
                  </button>
                );
              })}
            </div>

          </div>

          {/* Scroll body */}
          <div className="flex-1 overflow-y-auto px-7 py-6">
            {saved && (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.08] px-3.5 py-2.5 text-[12.5px] text-emerald-200"
              >
                <Check className="h-4 w-4" /> Saved — your Company Brain is updated.
              </motion.div>
            )}

            {state && (
              <>
                {section === 'company' && <CompanyEditor state={state} setState={setState} />}
                {section === 'targeting' && <TargetingEditor state={state} setState={setState} />}
                {section === 'buyers' && <BuyersEditor state={state} setState={setState} />}
                {section === 'signals' && <SignalsEditor state={state} setState={setState} />}
                {section === 'disqualifiers' && <DisqualifiersEditor state={state} setState={setState} />}
                {section === 'messaging' && <MessagingEditor state={state} setState={setState} />}

                <ImpactPanel section={section} influences={meta.influences} />
              </>
            )}
          </div>

          {/* Sticky footer */}
          <footer
            data-testid="cb-editor-footer"
            className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-border/25 bg-card/50 px-7 py-4 backdrop-blur-xl"
          >
            <div className="min-w-0 text-[12px] text-muted-foreground/80">
              {dirty && !saved ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                  Unsaved changes
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                  All changes saved
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => requestClose(false)}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={busy || !dirty}
                className="gap-2 bg-gradient-to-b from-primary to-[hsl(var(--primary)/0.82)] shadow-[0_1px_0_hsl(var(--foreground)/0.12)_inset,0_8px_24px_-10px_hsl(var(--primary)/0.5)] transition-all hover:shadow-[0_1px_0_hsl(var(--foreground)/0.15)_inset,0_12px_32px_-10px_hsl(var(--primary)/0.65),0_0_24px_hsl(var(--primary)/0.2)] disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------- shared primitives

function FieldGroup({ title, hint, children, cols = 1 }: { title: string; hint?: string; children: ReactNode; cols?: 1 | 2 | 3 }) {
  return (
    <section className="mb-5 rounded-2xl border border-border/30 bg-background/25 p-5 backdrop-blur-sm">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-foreground/85">{title}</h3>
        {hint && <p className="text-[11.5px] text-muted-foreground/70">{hint}</p>}
      </div>
      <div className={cn('grid gap-4', cols === 2 && 'md:grid-cols-2', cols === 3 && 'md:grid-cols-3')}>
        {children}
      </div>
    </section>
  );
}

function Field({ label, children, helper, error, className }: { label: string; children: ReactNode; helper?: string; error?: string; className?: string }) {
  return (
    <div className={className}>
      <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      {children}
      {error ? (
        <p className="mt-1.5 text-[11.5px] text-red-400/90">{error}</p>
      ) : helper ? (
        <p className="mt-1.5 text-[11.5px] text-muted-foreground/65">{helper}</p>
      ) : null}
    </div>
  );
}

function ImpactPanel({ section, influences }: { section: SectionKey; influences: string }) {
  return (
    <section
      className="mt-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4"
      style={{ boxShadow: 'inset 0 1px 0 hsl(var(--foreground) / 0.05)' }}
    >
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-emerald-300/85">
        How this affects Agentory
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground/90">{influences}</p>
    </section>
  );
}

// -------------------------------------------------------------- section forms

function CompanyEditor({ state, setState }: any) {
  return (
    <>
      <FieldGroup title="Identity" cols={2}>
        <Field label="Company name"><Input value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} /></Field>
        <Field label="Website"><Input value={state.website_url} onChange={(e) => setState({ ...state, website_url: e.target.value })} placeholder="https://" /></Field>
        <Field label="Category"><Input value={state.category} onChange={(e) => setState({ ...state, category: e.target.value })} /></Field>
        <Field label="Business model"><Input value={state.business_model} onChange={(e) => setState({ ...state, business_model: e.target.value })} /></Field>
        <Field label="Stage"><Input value={state.stage} onChange={(e) => setState({ ...state, stage: e.target.value })} /></Field>
        <Field label="Team size"><Input value={state.team_size} onChange={(e) => setState({ ...state, team_size: e.target.value })} /></Field>
      </FieldGroup>
      <FieldGroup title="Summary">
        <Field label="Short description"><Textarea rows={4} value={state.description} onChange={(e) => setState({ ...state, description: e.target.value })} /></Field>
      </FieldGroup>
    </>
  );
}

function TargetingEditor({ state, setState }: any) {
  const min = state.size_min === '' ? null : Number(state.size_min);
  const max = state.size_max === '' ? null : Number(state.size_max);
  const rangeError =
    Number.isFinite(min as number) && Number.isFinite(max as number) && (min as number) > (max as number)
      ? 'Minimum must be less than maximum.'
      : undefined;
  const qualifiedRange =
    Number.isFinite(min as number) && Number.isFinite(max as number)
      ? `Qualified range: ${min}–${max} employees`
      : Number.isFinite(min as number)
        ? `Qualified range: ${min}+ employees`
        : Number.isFinite(max as number)
          ? `Qualified range: up to ${max} employees`
          : 'Numeric limits are used for qualification. The label is shown to users.';

  return (
    <>
      <FieldGroup title="Market Definition">
        <div><ChipInput label="Industries" values={state.industries} onChange={(v) => setState({ ...state, industries: v })} placeholder="e.g. B2B SaaS" /></div>
        <div className="grid gap-4 md:grid-cols-2">
          <ChipInput label="Business models" values={state.business_models} onChange={(v) => setState({ ...state, business_models: v })} placeholder="SaaS, Marketplace…" />
          <ChipInput label="Geography" values={state.geography} onChange={(v) => setState({ ...state, geography: v })} placeholder="US, EU, Global…" />
        </div>
      </FieldGroup>

      <FieldGroup title="Company Size" hint={qualifiedRange}>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Minimum employees" error={rangeError}>
            <Input inputMode="numeric" value={state.size_min} onChange={(e) => setState({ ...state, size_min: e.target.value })} />
          </Field>
          <Field label="Maximum employees">
            <Input inputMode="numeric" value={state.size_max} onChange={(e) => setState({ ...state, size_max: e.target.value })} />
          </Field>
          <Field label="Display label" helper="Shown to users. Numbers drive qualification.">
            <Input value={state.size_label} onChange={(e) => setState({ ...state, size_label: e.target.value })} placeholder="Small teams / early-stage" />
          </Field>
        </div>
      </FieldGroup>

      <FieldGroup title="Must-have traits" hint="These accounts should always match.">
        <ChipInput label="Must-have" values={state.must_have} onChange={(v) => setState({ ...state, must_have: v })} placeholder="Add a trait and press Enter" />
      </FieldGroup>

      <FieldGroup title="Optional" cols={2}>
        <ChipInput label="Nice-to-have" values={state.nice_to_have} onChange={(v) => setState({ ...state, nice_to_have: v })} />
        <ChipInput label="Funding stage" values={state.funding_stage} onChange={(v) => setState({ ...state, funding_stage: v })} placeholder="pre-seed, Series A…" />
      </FieldGroup>
    </>
  );
}

function BuyersEditor({ state, setState }: any) {
  return (
    <FieldGroup title="Buyer Profile" cols={2}>
      <ChipInput label="Buyer roles" values={state.buyer_personas} onChange={(v) => setState({ ...state, buyer_personas: v })} placeholder="e.g. Head of RevOps" />
      <ChipInput label="Pain points" values={state.pain_points} onChange={(v) => setState({ ...state, pain_points: v })} />
    </FieldGroup>
  );
}

function SignalsEditor({ state, setState }: any) {
  return (
    <FieldGroup title="Buying Moments" cols={2}>
      <ChipInput label="Buying triggers" values={state.triggers} onChange={(v) => setState({ ...state, triggers: v })} />
      <ChipInput label="Jobs to watch" values={state.jobs_to_watch} onChange={(v) => setState({ ...state, jobs_to_watch: v })} />
    </FieldGroup>
  );
}

function DisqualifiersEditor({ state, setState }: any) {
  return (
    <>
      <FieldGroup title="Disqualifiers" cols={2}>
        <ChipInput label="Industries to avoid" values={state.disq_industries} onChange={(v) => setState({ ...state, disq_industries: v })} />
        <ChipInput label="Company types to avoid" values={state.disq_company_types} onChange={(v) => setState({ ...state, disq_company_types: v })} />
        <ChipInput label="Keywords to avoid" values={state.disq_keywords} onChange={(v) => setState({ ...state, disq_keywords: v })} />
        <ChipInput label="Titles to avoid" values={state.disq_titles} onChange={(v) => setState({ ...state, disq_titles: v })} />
      </FieldGroup>
      <FieldGroup title="Qualification rules" cols={2}>
        <ChipInput label="Required evidence" values={state.required_evidence} onChange={(v) => setState({ ...state, required_evidence: v })} />
        <ChipInput label="Reject if" values={state.reject_if} onChange={(v) => setState({ ...state, reject_if: v })} />
        <ChipInput label="Manual review if" values={state.manual_review_if} onChange={(v) => setState({ ...state, manual_review_if: v })} />
        <ChipInput label="Negative examples" values={state.negative_examples} onChange={(v) => setState({ ...state, negative_examples: v })} />
      </FieldGroup>
    </>
  );
}

function MessagingEditor({ state, setState }: any) {
  return (
    <>
      <FieldGroup title="Positioning">
        <Field label="Positioning promise"><Textarea rows={3} value={state.promise} onChange={(e) => setState({ ...state, promise: e.target.value })} /></Field>
        <div className="grid gap-4 md:grid-cols-2">
          <ChipInput label="Differentiators" values={state.differentiators} onChange={(v) => setState({ ...state, differentiators: v })} />
          <ChipInput label="Proof points" values={state.proof_points} onChange={(v) => setState({ ...state, proof_points: v })} />
        </div>
        <ChipInput label="Content angles" values={state.content_angles} onChange={(v) => setState({ ...state, content_angles: v })} />
      </FieldGroup>
      <FieldGroup title="Brand voice">
        <Field label="Tone"><Input value={state.tone} onChange={(e) => setState({ ...state, tone: e.target.value })} /></Field>
        <div className="grid gap-4 md:grid-cols-2">
          <ChipInput label="Voice tags" values={state.tags} onChange={(v) => setState({ ...state, tags: v })} />
          <ChipInput label="Style rules" values={state.style_rules} onChange={(v) => setState({ ...state, style_rules: v })} />
        </div>
        <ChipInput label="Avoid / banned claims" values={state.avoid} onChange={(v) => setState({ ...state, avoid: v })} />
      </FieldGroup>
    </>
  );
}

// -------------------------------------------------- initial state + patch ---

function initialFor(section: SectionKey, b: CompanyBrainV2): any {
  switch (section) {
    case 'company': return {
      name: b.company.name, website_url: b.company.website_url, category: b.company.category,
      description: b.company.description, business_model: b.company.business_model,
      stage: b.company.stage, team_size: b.company.team_size,
    };
    case 'targeting': return {
      industries: [...b.target_customer.industries],
      business_models: [...b.target_customer.business_models],
      geography: [...b.target_customer.geography],
      must_have: [...b.target_customer.must_have],
      nice_to_have: [...b.target_customer.nice_to_have],
      funding_stage: [...b.target_customer.funding_stage],
      size_min: b.target_customer.company_size.min?.toString() ?? '',
      size_max: b.target_customer.company_size.max?.toString() ?? '',
      size_label: b.target_customer.company_size.label ?? '',
    };
    case 'buyers': return {
      buyer_personas: [...b.buyer_personas],
      pain_points: [...b.pain_points],
    };
    case 'signals': return {
      triggers: [...b.triggers],
      jobs_to_watch: [...b.jobs_to_watch],
    };
    case 'disqualifiers': return {
      disq_industries: [...b.target_customer.disqualifiers.industries],
      disq_company_types: [...b.target_customer.disqualifiers.company_types],
      disq_keywords: [...b.target_customer.disqualifiers.keywords],
      disq_titles: [...b.target_customer.disqualifiers.titles],
      required_evidence: [...b.qualification_rules.required_evidence],
      reject_if: [...b.qualification_rules.reject_if],
      manual_review_if: [...b.qualification_rules.manual_review_if],
      negative_examples: [...b.negative_examples],
    };
    case 'messaging': return {
      promise: b.positioning.promise,
      differentiators: [...b.positioning.differentiators],
      proof_points: [...b.positioning.proof_points],
      content_angles: [...b.content_angles],
      tone: b.brand_voice.tone,
      tags: [...b.brand_voice.tags],
      style_rules: [...b.brand_voice.style_rules],
      avoid: [...b.brand_voice.avoid],
    };
  }
}

function buildPatch(section: SectionKey, s: any, b: CompanyBrainV2): BrainProfile {
  switch (section) {
    case 'company':
      return { company: { ...b.company, ...s } };
    case 'targeting': {
      const min = s.size_min === '' ? null : Number(s.size_min);
      const max = s.size_max === '' ? null : Number(s.size_max);
      return {
        target_customer: {
          ...b.target_customer,
          industries: s.industries, business_models: s.business_models, geography: s.geography,
          must_have: s.must_have, nice_to_have: s.nice_to_have, funding_stage: s.funding_stage,
          company_size: {
            min: Number.isFinite(min as number) ? (min as number) : null,
            max: Number.isFinite(max as number) ? (max as number) : null,
            label: s.size_label,
          },
        },
      };
    }
    case 'buyers':
      return { buyer_personas: s.buyer_personas, pain_points: s.pain_points };
    case 'signals':
      return { triggers: s.triggers, jobs_to_watch: s.jobs_to_watch };
    case 'disqualifiers':
      return {
        target_customer: {
          ...b.target_customer,
          disqualifiers: {
            ...b.target_customer.disqualifiers,
            industries: s.disq_industries, company_types: s.disq_company_types,
            keywords: s.disq_keywords, titles: s.disq_titles,
          },
        },
        qualification_rules: {
          ...b.qualification_rules,
          required_evidence: s.required_evidence,
          reject_if: s.reject_if,
          manual_review_if: s.manual_review_if,
        },
        negative_examples: s.negative_examples,
      };
    case 'messaging':
      return {
        positioning: {
          ...b.positioning,
          promise: s.promise, differentiators: s.differentiators, proof_points: s.proof_points,
        },
        content_angles: s.content_angles,
        brand_voice: {
          ...b.brand_voice,
          tone: s.tone, tags: s.tags, style_rules: s.style_rules, avoid: s.avoid,
        },
      };
  }
}
