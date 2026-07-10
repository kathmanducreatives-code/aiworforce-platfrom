// Company Brain Onboarding v3 — AI-assisted founder + company research.
//
// Five steps: Founder → Company → AI Research → Review Brain → Activate.
// Providers run ONLY on an explicit click (founder enrichment additionally
// requires consent). Nothing is auto-sent and no Scout Radar scan is triggered.
// Activation is refused unless the Brain meets the minimum requirements — the
// server is authoritative; this UI mirrors the same rules for the live preview.

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, ArrowRight, Building2, Check, Loader2, Rocket, Search, Sparkles, User } from 'lucide-react';

import { BrainPreviewPanel } from '@/components/onboarding/BrainPreviewPanel';
import { BrainReviewCard, FieldList } from '@/components/onboarding/BrainReviewCard';
import {
  STEPS, stepAt, stepIndexOf, type StepId,
  emptyCompanyForm, emptyFounderForm, type CompanyForm, type FounderForm,
  canAnalyzeCompany, canContinue, canEnrichFounder, isLinkedInCompanyUrl,
  buildDraftInput, buildSavePatch, previewBrain, applyQuickAction, QUICK_ACTIONS,
  type QuickAction,
} from '@/lib/onboardingV3';
import { BRAIN_POWERS, type CompletenessResult } from '@/lib/companyBrainCompleteness';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';

const FN = 'generate-company-brain-draft';

export default function OnboardingCompanyBrain() {
  const { workspaceId } = useWorkspace();
  const navigate = useNavigate();

  const [stepIndex, setStepIndex] = useState(0);
  const step: StepId = stepAt(stepIndex).id;

  const [founder, setFounder] = useState<FounderForm>(emptyFounderForm());
  const [company, setCompany] = useState<CompanyForm>(emptyCompanyForm());

  const [founderResearch, setFounderResearch] = useState<any>(null);
  const [companyResearch, setCompanyResearch] = useState<any>(null);
  const [companyLinkedIn, setCompanyLinkedIn] = useState<any>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Local edits to the reviewed Brain, held as a full normalized overlay. */
  const [edited, setEdited] = useState<CompanyBrainV2 | null>(null);

  // The preview always reflects the draft-so-far merged with what the user typed.
  const rawProfile = useMemo(() => ({
    ...(draft ?? {}),
    ...(edited ? toRaw(edited) : {}),
    company: {
      ...((draft?.company as object) ?? {}),
      ...(edited ? edited.company : {}),
      ...(company.name ? { name: company.name } : {}),
      ...(company.website_url ? { website_url: company.website_url } : {}),
      ...(company.description ? { description: company.description } : {}),
    },
    founder: {
      ...((draft?.founder as object) ?? {}),
      ...(edited ? edited.founder : {}),
      ...(founder.name ? { name: founder.name } : {}),
      ...(founder.role ? { role: founder.role } : {}),
      ...(founder.linkedin_url ? { linkedin_url: founder.linkedin_url } : {}),
    },
  }), [draft, edited, company, founder]);

  const { brain, completeness } = useMemo(() => previewBrain(rawProfile), [rawProfile]);

  const call = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!workspaceId) throw new Error('No workspace');
    const { data, error } = await supabase.functions.invoke(FN, {
      body: { action, workspace_id: workspaceId, ...payload },
    });
    if (error) throw error;
    return data as any;
  }, [workspaceId]);

  // ---------------------------------------------------------- step actions --

  async function analyzeFounder() {
    setBusy('founder'); setNotice(null);
    try {
      const r = await call('research_founder', { linkedin_url: founder.linkedin_url, consent: founder.enrichment_consent });
      if (r?.ok && r.research) {
        setFounderResearch(r.research);
        toast.success('Founder profile analyzed', { description: `Confidence: ${r.research.confidence}` });
      } else {
        setNotice(explain(r?.reason ?? r?.error, 'founder'));
      }
    } catch {
      setNotice('Founder analysis failed. You can continue and fill this in by hand.');
    } finally { setBusy(null); }
  }

  async function analyzeCompany() {
    setBusy('company'); setNotice(null);
    try {
      const r = await call('research_company', {
        website_url: company.website_url,
        linkedin_url: isLinkedInCompanyUrl(company.linkedin_url) ? company.linkedin_url : '',
        name: company.name,
        description: company.description,
      });
      if (r?.ok && r.company_research) {
        setCompanyResearch(r.company_research);
        setCompanyLinkedIn(r.company_linkedin ?? null);
        toast.success('Company analyzed', { description: `${r.pages_fetched} page(s) read` });
      } else {
        setNotice(explain(r?.reason ?? r?.error, 'company'));
      }
    } catch {
      setNotice('Company analysis failed. You can continue and fill this in by hand.');
    } finally { setBusy(null); }
  }

  async function draftBrain() {
    setBusy('draft'); setNotice(null);
    try {
      const r = await call('draft', buildDraftInput({ founder, company, founderResearch, companyResearch, companyLinkedIn }));
      if (r?.ok && r.draft) {
        setDraft(r.draft);
        setEdited(null);
        setStepIndex(stepIndexOf('review'));
        toast.success('Draft Company Brain ready', { description: 'Review each card before activating.' });
      } else {
        setNotice(explain(r?.reason ?? r?.error, 'draft'));
      }
    } catch {
      setNotice('Could not draft the Brain. You can still fill it in by hand.');
    } finally { setBusy(null); }
  }

  async function persist(activate: boolean) {
    setBusy(activate ? 'activate' : 'save'); setNotice(null);
    try {
      const patch = buildSavePatch({ founder, company, brain });
      const r = await call(activate ? 'activate' : 'save_draft', { patch });
      if (activate && !r?.activated) {
        setNotice(`Can't activate yet — ${(r?.blocked_reasons ?? []).join('; ') || 'requirements not met'}. Your draft is saved.`);
        return;
      }
      toast.success(activate ? 'Company Brain activated' : 'Draft saved', {
        description: activate
          ? 'Leads, Radar, Content, Agents and Outreach now use it.'
          : 'You can finish later.',
      });
      if (activate) navigate('/');
    } catch {
      setNotice('Save failed. Nothing was lost — try again.');
    } finally { setBusy(null); }
  }

  const onQuickAction = (action: QuickAction, value?: string) => setEdited(applyQuickAction(brain, action, value));

  const canNext = canContinue(step, { founder, company });

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <StepProgress index={stepIndex} />

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <main className="min-w-0">
            <header className="mb-5">
              <h1 className="text-2xl font-semibold tracking-tight">{stepAt(stepIndex).label}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{stepAt(stepIndex).powers}</p>
            </header>

            {notice && <Card className="mb-4 border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">{notice}</Card>}

            {step === 'founder' && (
              <FounderStep
                value={founder} onChange={setFounder} busy={busy === 'founder'} research={founderResearch}
                onAnalyze={analyzeFounder} onSkip={() => setStepIndex(stepIndexOf('company'))}
              />
            )}
            {step === 'company' && (
              <CompanyStep
                value={company} onChange={setCompany} busy={busy === 'company'}
                research={companyResearch} linkedin={companyLinkedIn} onAnalyze={analyzeCompany}
              />
            )}
            {step === 'research' && (
              <ResearchStep
                busy={busy === 'draft'} founderResearch={founderResearch}
                companyResearch={companyResearch} onDraft={draftBrain}
              />
            )}
            {step === 'review' && (
              <ReviewStep
                brain={brain} draft={draft} missingByStep={completeness.missing_by_step}
                onQuickAction={onQuickAction} onEditBrain={setEdited}
              />
            )}
            {step === 'activate' && <ActivateStep completeness={completeness} />}

            <nav className="mt-8 flex items-center justify-between gap-3 border-t border-border/50 pt-5">
              <Button variant="ghost" size="sm" onClick={() => setStepIndex((i) => Math.max(0, i - 1))} disabled={stepIndex === 0 || !!busy}>
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => persist(false)} disabled={!!busy || !workspaceId}>
                  {busy === 'save' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Save draft
                </Button>

                {step === 'activate' ? (
                  <Button size="sm" onClick={() => persist(true)} disabled={!!busy || !completeness.complete || !workspaceId}>
                    {busy === 'activate' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Rocket className="mr-1.5 h-4 w-4" />}
                    Activate Company Brain
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))} disabled={!canNext || !!busy}>
                    Continue <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Button>
                )}
              </div>
            </nav>
          </main>

          <BrainPreviewPanel brain={brain} completeness={completeness} />
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- progress ---

function StepProgress({ index }: { index: number }) {
  const pct = Math.round(((index + 1) / STEPS.length) * 100);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        {STEPS.map((s, i) => {
          const done = i < index;
          const active = i === index;
          return (
            <div key={s.id} className="flex min-w-0 flex-1 items-center gap-2">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                  done ? 'bg-primary text-primary-foreground'
                    : active ? 'border-2 border-primary bg-primary/10 text-primary'
                      : 'border border-border bg-muted/30 text-muted-foreground'
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span className={`hidden truncate text-xs sm:block ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{s.label}</span>
              {i < STEPS.length - 1 && <div className="mx-2 hidden h-px flex-1 bg-border md:block" />}
            </div>
          );
        })}
      </div>
      <Progress value={pct} className="h-1" />
    </div>
  );
}

// ------------------------------------------------------------------ step 1 --

function FounderStep({
  value, onChange, busy, research, onAnalyze, onSkip,
}: {
  value: FounderForm; onChange: (f: FounderForm) => void;
  busy: boolean; research: any; onAnalyze: () => void; onSkip: () => void;
}) {
  const set = <K extends keyof FounderForm>(k: K, v: FounderForm[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-4">
      <Card className="border-border/60 bg-card/60 p-5">
        <div className="mb-4 flex items-center gap-2">
          <User className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">About you</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" required>
            <Input value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field label="Role / title">
            <Input value={value.role} onChange={(e) => set('role', e.target.value)} placeholder="Founder & CEO" />
          </Field>
          <Field label="Timezone" hint="Optional">
            <Input value={value.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="UTC+5:45" />
          </Field>
          <Field label="What should Agentory help with first?">
            <Input value={value.first_help_goal} onChange={(e) => set('first_help_goal', e.target.value)} placeholder="Find warm leads" />
          </Field>
        </div>
      </Card>

      <Card className="border-border/60 bg-card/60 p-5">
        <h2 className="mb-1 text-sm font-semibold">Enrich from LinkedIn</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          We read only the profile URL you give us. We never collect emails, phone numbers or contacts.
        </p>
        <Field label="LinkedIn profile URL">
          <Input value={value.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)} placeholder="https://linkedin.com/in/your-handle" />
        </Field>
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
          <Checkbox checked={value.enrichment_consent} onCheckedChange={(c) => set('enrichment_consent', c === true)} className="mt-0.5" />
          <span>Use this LinkedIn URL to enrich my Company Brain.</span>
        </label>

        <div className="mt-4 flex items-center gap-2">
          <Button size="sm" onClick={onAnalyze} disabled={!canEnrichFounder(value) || busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
            Analyze founder profile
          </Button>
          <Button size="sm" variant="ghost" onClick={onSkip} disabled={busy}>Skip enrichment</Button>
        </div>
      </Card>

      {research && (
        <Card className="border-emerald-500/25 bg-emerald-500/5 p-5">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-emerald-200">
            <Sparkles className="h-3.5 w-3.5" /> What Agentory found
          </h3>
          <div className="space-y-3">
            <p className="text-sm text-foreground/90">
              <span className="font-medium">{research.name}</span>
              {research.current_role ? ` — ${research.current_role}` : ''}
              {research.current_company ? ` at ${research.current_company}` : ''}
            </p>
            {research.headline && <p className="text-xs text-muted-foreground">{research.headline}</p>}
            <FieldList label="Credibility signals" values={research.credibility_signals ?? []} empty="None detected" />
            <FieldList label="Why this matters for GTM" values={research.gtm_relevance ?? []} empty="No GTM signal detected" />
            {(research.missing_evidence ?? []).length > 0 && (
              <p className="text-xs text-amber-200">Could not read: {research.missing_evidence.join(', ')}</p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ step 2 --

function CompanyStep({
  value, onChange, busy, research, linkedin, onAnalyze,
}: {
  value: CompanyForm; onChange: (c: CompanyForm) => void;
  busy: boolean; research: any; linkedin: any; onAnalyze: () => void;
}) {
  const set = <K extends keyof CompanyForm>(k: K, v: CompanyForm[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-4">
      <Card className="border-border/60 bg-card/60 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Your company</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" required>
            <Input value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Agentory" />
          </Field>
          <Field label="Website URL" required>
            <Input value={value.website_url} onChange={(e) => set('website_url', e.target.value)} placeholder="https://agentory.ai" />
          </Field>
          <Field label="LinkedIn company URL" hint="Optional — the website is enough">
            <Input value={value.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)} placeholder="https://linkedin.com/company/agentory" />
          </Field>
          <Field label="Stage" hint="Optional">
            <Input value={value.stage} onChange={(e) => set('stage', e.target.value)} placeholder="seed" />
          </Field>
          <Field label="Team size" hint="Optional">
            <Input value={value.team_size} onChange={(e) => set('team_size', e.target.value)} placeholder="2-5" />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="One-line description" hint="If you already know it">
            <Textarea rows={2} value={value.description} onChange={(e) => set('description', e.target.value)} placeholder="AI workforce OS for founders building B2B pipeline" />
          </Field>
        </div>

        <div className="mt-4">
          <Button size="sm" onClick={onAnalyze} disabled={!canAnalyzeCompany(value) || busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
            Analyze company
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Reads your homepage plus up to 10 key pages (about, pricing, customers…). No broad web crawl.
          </p>
        </div>
      </Card>

      {research && (
        <Card className="border-emerald-500/25 bg-emerald-500/5 p-5">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-emerald-200">
            <Sparkles className="h-3.5 w-3.5" /> What Agentory found
          </h3>
          <div className="space-y-3">
            {research.description && <p className="text-sm text-foreground/90">{research.description}</p>}
            <FieldList label="Business model" values={research.business_model ? [research.business_model] : []} />
            <FieldList label="Proof points" values={research.proof_points ?? []} empty="No verifiable proof found" />
            <FieldList label="Integrations" values={research.integrations ?? []} empty="None found" />
            {linkedin && <FieldList label="LinkedIn" values={[linkedin.industry, linkedin.employee_count].filter(Boolean)} />}
            <FieldList label="Pages read" values={(research.source_pages ?? []).map(shortPath)} empty="None" />
            {(research.missing_evidence ?? []).length > 0 && (
              <p className="text-xs text-amber-200">Missing evidence: {research.missing_evidence.join(', ')}</p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ step 3 --

function ResearchStep({
  busy, founderResearch, companyResearch, onDraft,
}: {
  busy: boolean; founderResearch: any; companyResearch: any; onDraft: () => void;
}) {
  const pages = companyResearch?.source_pages?.length ?? 0;
  return (
    <Card className="border-border/60 bg-card/60 p-5">
      <h2 className="mb-1 text-sm font-semibold">Draft your Company Brain</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Agentory turns the evidence it read into a draft ICP, buyers, triggers and disqualifiers.
        It never invents proof — anything it infers is flagged for your confirmation.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <SourceTile label="Founder LinkedIn" ok={!!founderResearch} detail={founderResearch ? `${founderResearch.confidence} confidence` : 'Skipped'} />
        <SourceTile label="Company website" ok={!!companyResearch} detail={companyResearch ? `${pages} page(s) read` : 'Not analyzed'} />
      </div>

      <Button className="mt-5" size="sm" onClick={onDraft} disabled={busy}>
        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
        {busy ? 'Reading evidence and drafting…' : 'Draft my Company Brain'}
      </Button>
      {!companyResearch && !founderResearch && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          No research yet — the draft will be thin and mostly need your confirmation.
        </p>
      )}
    </Card>
  );
}

function SourceTile({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className={`rounded-lg border p-3 ${ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/60 bg-muted/20'}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {ok && <Check className="h-3.5 w-3.5 text-emerald-400" />}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

// ------------------------------------------------------------------ step 4 --

function ReviewStep({
  brain, draft, missingByStep, onQuickAction, onEditBrain,
}: {
  brain: CompanyBrainV2;
  draft: Record<string, unknown> | null;
  missingByStep: Record<string, string[]>;
  onQuickAction: (a: QuickAction, v?: string) => void;
  onEditBrain: (b: CompanyBrainV2) => void;
}) {
  const needs = (draft?.needs_confirmation as string[]) ?? [];
  const sources = brain.evidence.source_pages;
  const liSources = brain.evidence.linkedin_sources;
  const tc = brain.target_customer;
  const disq = tc.disqualifiers;

  const setList = (mutate: (b: CompanyBrainV2, v: string[]) => void) => (raw: string) => {
    const next: CompanyBrainV2 = structuredClone(brain);
    mutate(next, raw.split(',').map((s) => s.trim()).filter(Boolean));
    onEditBrain(next);
  };

  return (
    <div className="grid gap-4">
      <BrainReviewCard
        title="Company summary" subtitle="What we think you sell"
        confidence={brain.brain_confidence} sources={sources}
        needsConfirmation={needs.filter((n) => n.startsWith('company')).length}
        missing={missingByStep.company?.length ? ['company fields'] : []}
      >
        <p className="text-sm text-foreground/90">{brain.company.description || 'No description yet.'}</p>
        <FieldList label="Category" values={brain.company.category ? [brain.company.category] : []} />
        <FieldList label="Business model" values={brain.company.business_model ? [brain.company.business_model] : []} />
      </BrainReviewCard>

      <BrainReviewCard
        title="Ideal customers" subtitle="Who Leads and Radar will target"
        confidence={brain.brain_confidence} sources={sources}
        needsConfirmation={needs.filter((n) => n.startsWith('target_customer')).length}
        missing={missingByStep.customers?.length ? ['industries or business models'] : []}
        quickActions={QUICK_ACTIONS.filter((a) => ['correct', 'too_broad', 'too_narrow'].includes(a.id))}
        onQuickAction={onQuickAction}
      >
        <EditableList label="Industries" values={tc.industries} onSave={setList((b, v) => { b.target_customer.industries = v; })} />
        <EditableList label="Business models" values={tc.business_models} onSave={setList((b, v) => { b.target_customer.business_models = v; })} />
        <FieldList label="Company size" values={tc.company_size.label ? [tc.company_size.label] : []} />
        <FieldList label="Geography" values={tc.geography} />
        <FieldList label="Funding stage" values={tc.funding_stage} />
        <EditableList label="Must-have traits" values={tc.must_have} onSave={setList((b, v) => { b.target_customer.must_have = v; })} />
        <FieldList label="Nice-to-have" values={tc.nice_to_have} />
      </BrainReviewCard>

      <BrainReviewCard
        title="Buyers" subtitle="Who actually signs"
        confidence={brain.brain_confidence} sources={liSources}
        needsConfirmation={needs.filter((n) => n.startsWith('buyer')).length}
        missing={missingByStep.buyers?.length ? ['buyer personas'] : []}
      >
        <EditableList label="Buyer personas" values={brain.buyer_personas} onSave={setList((b, v) => { b.buyer_personas = v; })} />
        <EditableList label="Pain points" values={brain.pain_points} onSave={setList((b, v) => { b.pain_points = v; })} />
      </BrainReviewCard>

      <BrainReviewCard
        title="Buying triggers" subtitle="What makes now the right moment"
        confidence={brain.brain_confidence} sources={sources}
        missing={missingByStep.triggers?.length ? ['a trigger or job to watch'] : []}
        quickActions={QUICK_ACTIONS.filter((a) => a.id === 'require_proof')}
        onQuickAction={onQuickAction}
      >
        <EditableList label="Triggers" values={brain.triggers} onSave={setList((b, v) => { b.triggers = v; })} />
        <EditableList label="Jobs to watch" values={brain.jobs_to_watch} onSave={setList((b, v) => { b.jobs_to_watch = v; })} />
        <FieldList label="Tools to watch" values={brain.tools} />
        <FieldList label="Competitor activity" values={brain.competitors} />
      </BrainReviewCard>

      <BrainReviewCard
        title="Never target these companies" subtitle="Disqualifiers are enforced before anything reaches you"
        confidence={brain.brain_confidence} sources={[]}
        missing={missingByStep.disqualifiers?.length ? ['at least one disqualifier'] : []}
        quickActions={QUICK_ACTIONS.filter((a) => ['never_target', 'add_bad_fit'].includes(a.id))}
        onQuickAction={onQuickAction}
      >
        <EditableList label="Industries to avoid" values={disq.industries} onSave={setList((b, v) => { b.target_customer.disqualifiers.industries = v; })} />
        <EditableList label="Company types to avoid" values={disq.company_types} onSave={setList((b, v) => { b.target_customer.disqualifiers.company_types = v; })} />
        <EditableList label="Keywords to avoid" values={disq.keywords} onSave={setList((b, v) => { b.target_customer.disqualifiers.keywords = v; })} />
        <FieldList label="Titles to avoid" values={disq.titles} />
        <FieldList label="Domains to avoid" values={disq.domains} />
      </BrainReviewCard>

      <BrainReviewCard title="Good fit / bad fit examples" subtitle="Concrete companies teach the scorer faster than rules" sources={[]}>
        <EditableList label="Good-fit companies" values={brain.positive_examples} onSave={setList((b, v) => { b.positive_examples = v; })} />
        <EditableList label="Bad-fit companies" values={brain.negative_examples} onSave={setList((b, v) => { b.negative_examples = v; })} />
      </BrainReviewCard>

      <BrainReviewCard
        title="Content & positioning" subtitle="Voice for Content and Outreach"
        confidence={brain.brain_confidence} sources={sources}
        needsConfirmation={needs.filter((n) => n.startsWith('positioning')).length}
        missing={missingByStep.content?.length ? ['a pain point or content angle'] : []}
      >
        <FieldList label="Promise" values={brain.positioning.promise ? [brain.positioning.promise] : []} />
        <FieldList label="Differentiators" values={brain.positioning.differentiators} />
        <EditableList label="Content angles" values={brain.content_angles} onSave={setList((b, v) => { b.content_angles = v; })} />
        <FieldList label="Tone" values={brain.brand_voice.tone ? [brain.brand_voice.tone] : []} />
        <FieldList label="Banned claims" values={[...brain.positioning.avoid_positioning, ...brain.brand_voice.avoid]} empty="None set" />
      </BrainReviewCard>

      <BrainReviewCard title="Qualification rules" subtitle="Evidence required before a lead is trusted" sources={[]}>
        <EditableList label="Required evidence" values={brain.qualification_rules.required_evidence} onSave={setList((b, v) => { b.qualification_rules.required_evidence = v; })} />
        <EditableList label="Reject if" values={brain.qualification_rules.reject_if} onSave={setList((b, v) => { b.qualification_rules.reject_if = v; })} />
        <FieldList label="Manual review if" values={brain.qualification_rules.manual_review_if} />
      </BrainReviewCard>
    </div>
  );
}

/** Comma-separated inline editor for a list field. */
function EditableList({ label, values, onSave }: { label: string; values: string[]; onSave: (raw: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');

  if (!editing) {
    return (
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
          <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => { setRaw(values.join(', ')); setEditing(true); }}>
            Edit
          </button>
        </div>
        {values.length === 0
          ? <p className="text-xs text-muted-foreground/70">Not set</p>
          : <div className="flex flex-wrap gap-1">{values.map((v) => <span key={v} className="rounded bg-muted/50 px-1.5 py-0.5 text-xs">{v}</span>)}</div>}
      </div>
    );
  }
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <Textarea rows={2} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Comma-separated" />
      <div className="mt-1.5 flex gap-1.5">
        <Button size="sm" className="h-7 text-xs" onClick={() => { onSave(raw); setEditing(false); }}>Save</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ step 5 --

function ActivateStep({ completeness }: { completeness: CompletenessResult }) {
  return (
    <div className="space-y-4">
      <Card className="border-border/60 bg-card/60 p-6 text-center">
        <Rocket className="mx-auto mb-3 h-8 w-8 text-primary" />
        <h2 className="text-lg font-semibold">{completeness.complete ? 'Your Company Brain is ready.' : 'Almost there.'}</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {completeness.complete
            ? 'Activate to let Leads, Radar, Content, Agents and Outreach use it. Nothing sends automatically.'
            : 'Fill the remaining required fields to activate. You can save a draft and finish later.'}
        </p>

        <div className="mx-auto mt-5 max-w-sm">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Completeness</span>
            <span className="font-medium">{completeness.percent}%</span>
          </div>
          <Progress value={completeness.percent} className="h-1.5" />
          <Badge variant="outline" className="mt-3">{completeness.confidence} confidence</Badge>
        </div>
      </Card>

      {completeness.missing.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-4">
          <h3 className="mb-2 text-xs font-semibold text-amber-200">Still missing</h3>
          <ul className="space-y-1 text-xs text-amber-100/90">
            {completeness.missing.map((m) => <li key={m}>• {m}</li>)}
          </ul>
        </Card>
      )}

      <Card className="border-border/60 bg-card/40 p-4">
        <h3 className="mb-3 text-xs font-semibold">What this powers</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {BRAIN_POWERS.map((p) => (
            <div key={p.key} className="rounded-md border border-border/50 bg-muted/20 p-2.5">
              <p className="text-xs font-medium text-foreground">{p.label}</p>
              <p className="text-[11px] text-muted-foreground">{p.blurb}</p>
            </div>
          ))}
        </div>
        <Separator className="my-3" />
        <p className="text-[11px] text-muted-foreground">
          Activation never sends an email, post, comment or DM, and never starts a Scout Radar scan.
          You can run your first scan manually from Signals afterwards.
        </p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- helpers ---

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
        {hint && <span className="ml-1.5 font-normal text-muted-foreground">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}

function shortPath(u: string): string {
  try { return new URL(u).pathname || '/'; } catch { return u; }
}

/** Project a normalized Brain back onto a raw profile patch for previewing. */
function toRaw(b: CompanyBrainV2): Record<string, unknown> {
  return {
    target_customer: b.target_customer,
    buyer_personas: b.buyer_personas, triggers: b.triggers, jobs_to_watch: b.jobs_to_watch,
    competitors: b.competitors, tools: b.tools, pain_points: b.pain_points,
    positive_examples: b.positive_examples, negative_examples: b.negative_examples,
    content_angles: b.content_angles, positioning: b.positioning, brand_voice: b.brand_voice,
    qualification_rules: b.qualification_rules, evidence: b.evidence,
  };
}

function explain(reason: string | undefined, ctx: 'founder' | 'company' | 'draft'): string {
  switch (reason) {
    case 'consent_not_given': return 'Tick the consent box to enrich from LinkedIn.';
    case 'invalid_linkedin_profile_url': return 'That does not look like a linkedin.com/in/… profile URL.';
    case 'invalid_linkedin_company_url': return 'That does not look like a linkedin.com/company/… URL.';
    case 'apify_not_configured': return 'LinkedIn enrichment is not configured yet. Continue and fill this in by hand.';
    case 'firecrawl_not_configured': return 'Website research is not configured yet. Continue and fill this in by hand.';
    case 'llm_not_configured': return 'AI drafting is not configured yet. You can still fill the Brain in by hand.';
    case 'invalid_website_url': return 'Enter a full website URL starting with https://';
    default:
      return ctx === 'draft'
        ? 'Could not draft the Brain from the available evidence.'
        : 'Nothing could be read from that source. You can continue by hand.';
  }
}
