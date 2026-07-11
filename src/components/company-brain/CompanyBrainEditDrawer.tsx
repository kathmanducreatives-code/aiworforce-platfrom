// Right-side edit drawer for a single Company Brain section.
// Each section maps to a fixed set of top-level `company_brain.profile` keys.
// Save emits a partial patch that the parent shallow-merges onto the raw
// profile, so we never overwrite fields we don't render (evidence, claims,
// signal_preferences, legacy top-level keys, etc.).

import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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

const TITLES: Record<SectionKey, { title: string; description: string }> = {
  company:       { title: 'Company understanding', description: 'What Agentory tells other agents about your company.' },
  targeting:     { title: 'ICP / targeting',       description: 'Who counts as a fit worth researching.' },
  buyers:        { title: 'Buyer personas',        description: 'The roles you sell to.' },
  signals:       { title: 'Buying signals',        description: 'What Scout Radar should watch for.' },
  disqualifiers: { title: 'Disqualifiers & safety', description: 'Who and what to never target.' },
  messaging:     { title: 'Messaging & positioning', description: 'How Agentory should sound on your behalf.' },
};

export default function CompanyBrainEditDrawer({ open, section, brain, onOpenChange, onSave }: Props) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<any>(null);

  useEffect(() => {
    if (!open || !section) return;
    setState(initialFor(section, brain));
  }, [open, section, brain]);

  if (!section || !state) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md border-border/50 bg-card/80 backdrop-blur-2xl" />
      </Sheet>
    );
  }

  const meta = TITLES[section];

  async function handleSave() {
    setBusy(true);
    try {
      await onSave(buildPatch(section!, state, brain));
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 border-border/50 bg-card/80 backdrop-blur-2xl sm:max-w-lg">
        <SheetHeader className="text-left">
          <SheetTitle className="text-lg tracking-tight">{meta.title}</SheetTitle>
          <SheetDescription className="text-xs">{meta.description}</SheetDescription>
        </SheetHeader>

        <div className="-mr-2 mt-4 flex-1 space-y-5 overflow-y-auto pr-2">
          {section === 'company' && <CompanyEditor state={state} setState={setState} />}
          {section === 'targeting' && <TargetingEditor state={state} setState={setState} />}
          {section === 'buyers' && <BuyersEditor state={state} setState={setState} />}
          {section === 'signals' && <SignalsEditor state={state} setState={setState} />}
          {section === 'disqualifiers' && <DisqualifiersEditor state={state} setState={setState} />}
          {section === 'messaging' && <MessagingEditor state={state} setState={setState} />}
        </div>

        <SheetFooter className="mt-4 gap-2 sm:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// --------------------------------------------------------------- editors ----

function CompanyEditor({ state, setState }: any) {
  return (
    <div className="space-y-4">
      <Field label="Company name">
        <Input value={state.name} onChange={(e) => setState({ ...state, name: e.target.value })} />
      </Field>
      <Field label="Website">
        <Input value={state.website_url} onChange={(e) => setState({ ...state, website_url: e.target.value })} placeholder="https://" />
      </Field>
      <Field label="Category">
        <Input value={state.category} onChange={(e) => setState({ ...state, category: e.target.value })} />
      </Field>
      <Field label="Short description">
        <Textarea rows={3} value={state.description} onChange={(e) => setState({ ...state, description: e.target.value })} />
      </Field>
      <Field label="Business model">
        <Input value={state.business_model} onChange={(e) => setState({ ...state, business_model: e.target.value })} />
      </Field>
      <Field label="Stage">
        <Input value={state.stage} onChange={(e) => setState({ ...state, stage: e.target.value })} />
      </Field>
      <Field label="Team size">
        <Input value={state.team_size} onChange={(e) => setState({ ...state, team_size: e.target.value })} />
      </Field>
    </div>
  );
}

function TargetingEditor({ state, setState }: any) {
  return (
    <div className="space-y-4">
      <ChipInput label="Industries" values={state.industries} onChange={(v) => setState({ ...state, industries: v })} placeholder="e.g. B2B SaaS" />
      <ChipInput label="Business models" values={state.business_models} onChange={(v) => setState({ ...state, business_models: v })} />
      <ChipInput label="Geography" values={state.geography} onChange={(v) => setState({ ...state, geography: v })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Company size (min)">
          <Input inputMode="numeric" value={state.size_min} onChange={(e) => setState({ ...state, size_min: e.target.value })} />
        </Field>
        <Field label="Company size (max)">
          <Input inputMode="numeric" value={state.size_max} onChange={(e) => setState({ ...state, size_max: e.target.value })} />
        </Field>
      </div>
      <Field label="Company size label">
        <Input value={state.size_label} onChange={(e) => setState({ ...state, size_label: e.target.value })} placeholder="11–50" />
      </Field>
      <ChipInput label="Must-have traits" values={state.must_have} onChange={(v) => setState({ ...state, must_have: v })} />
      <ChipInput label="Nice-to-have traits" values={state.nice_to_have} onChange={(v) => setState({ ...state, nice_to_have: v })} />
      <ChipInput label="Funding stage" values={state.funding_stage} onChange={(v) => setState({ ...state, funding_stage: v })} />
    </div>
  );
}

function BuyersEditor({ state, setState }: any) {
  return (
    <div className="space-y-4">
      <ChipInput label="Buyer roles" values={state.buyer_personas} onChange={(v) => setState({ ...state, buyer_personas: v })} placeholder="e.g. Head of RevOps" />
      <ChipInput label="Pain points" values={state.pain_points} onChange={(v) => setState({ ...state, pain_points: v })} />
    </div>
  );
}

function SignalsEditor({ state, setState }: any) {
  return (
    <div className="space-y-4">
      <ChipInput label="Buying triggers" values={state.triggers} onChange={(v) => setState({ ...state, triggers: v })} />
      <ChipInput label="Jobs to watch" values={state.jobs_to_watch} onChange={(v) => setState({ ...state, jobs_to_watch: v })} />
    </div>
  );
}

function DisqualifiersEditor({ state, setState }: any) {
  return (
    <div className="space-y-4">
      <ChipInput label="Industries to avoid" values={state.disq_industries} onChange={(v) => setState({ ...state, disq_industries: v })} />
      <ChipInput label="Company types to avoid" values={state.disq_company_types} onChange={(v) => setState({ ...state, disq_company_types: v })} />
      <ChipInput label="Keywords to avoid" values={state.disq_keywords} onChange={(v) => setState({ ...state, disq_keywords: v })} />
      <ChipInput label="Titles to avoid" values={state.disq_titles} onChange={(v) => setState({ ...state, disq_titles: v })} />
      <ChipInput label="Required evidence" values={state.required_evidence} onChange={(v) => setState({ ...state, required_evidence: v })} />
      <ChipInput label="Reject if" values={state.reject_if} onChange={(v) => setState({ ...state, reject_if: v })} />
      <ChipInput label="Manual review if" values={state.manual_review_if} onChange={(v) => setState({ ...state, manual_review_if: v })} />
      <ChipInput label="Negative examples" values={state.negative_examples} onChange={(v) => setState({ ...state, negative_examples: v })} />
    </div>
  );
}

function MessagingEditor({ state, setState }: any) {
  return (
    <div className="space-y-4">
      <Field label="Positioning promise">
        <Textarea rows={2} value={state.promise} onChange={(e) => setState({ ...state, promise: e.target.value })} />
      </Field>
      <ChipInput label="Differentiators" values={state.differentiators} onChange={(v) => setState({ ...state, differentiators: v })} />
      <ChipInput label="Proof points" values={state.proof_points} onChange={(v) => setState({ ...state, proof_points: v })} />
      <ChipInput label="Content angles" values={state.content_angles} onChange={(v) => setState({ ...state, content_angles: v })} />
      <Field label="Brand voice / tone">
        <Input value={state.tone} onChange={(e) => setState({ ...state, tone: e.target.value })} />
      </Field>
      <ChipInput label="Voice tags" values={state.tags} onChange={(v) => setState({ ...state, tags: v })} />
      <ChipInput label="Style rules" values={state.style_rules} onChange={(v) => setState({ ...state, style_rules: v })} />
      <ChipInput label="Avoid / banned claims" values={state.avoid} onChange={(v) => setState({ ...state, avoid: v })} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      {children}
    </div>
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
