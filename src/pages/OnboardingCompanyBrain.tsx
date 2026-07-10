// Company Brain Onboarding v3 — premium "Brain Lab" 5-step setup.
//
// Presentation makeover only. Backend contract is byte-identical:
//   invoke('generate-company-brain-draft', { action, workspace_id, ... })
// with actions: research_founder | research_company | draft | save_draft | activate.
//
// Providers run ONLY on an explicit click; founder enrichment also requires
// consent. Nothing sends automatically and no Scout Radar scan is triggered.

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  ArrowLeft, ArrowRight, Building2, ChevronDown, Cpu, Globe, Loader2, Lock,
  MessageSquare, Radar, Rocket, Search, Shield, Sparkles, Target, User,
} from 'lucide-react';

import { AmbientBackground } from '@/components/onboarding/AmbientBackground';
import { BrainPreviewPanel } from '@/components/onboarding/BrainPreviewPanel';
import { BrainReviewCard, FieldList } from '@/components/onboarding/BrainReviewCard';
import { BrainSection } from '@/components/onboarding/BrainSection';
import { StepProgress } from '@/components/onboarding/StepProgress';
import { ChipInput } from '@/components/onboarding/ChipInput';
import { ErrorState } from '@/components/onboarding/ErrorState';
import { PagePreviewChips } from '@/components/onboarding/PagePreviewChips';
import { ResearchTimeline, type TimelineStage } from '@/components/onboarding/ResearchTimeline';
import { SourceEvidenceCard, type EvidenceStatus } from '@/components/onboarding/SourceEvidenceCard';
import { ActivationHero } from '@/components/onboarding/ActivationHero';
import {
  STEPS, stepAt, stepIndexOf, type StepId,
  emptyCompanyForm, emptyFounderForm, type CompanyForm, type FounderForm,
  canAnalyzeCompany, canContinue, canEnrichFounder, isLinkedInCompanyUrl,
  buildDraftInput, buildSavePatch, previewBrain, applyQuickAction, QUICK_ACTIONS,
  type QuickAction,
} from '@/lib/onboardingV3';
import type { CompletenessResult } from '@/lib/companyBrainCompleteness';
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
  const [error, setError] = useState<{ title: string; body: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [edited, setEdited] = useState<CompanyBrainV2 | null>(null);

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

  const evidenceCount = useMemo(() => {
    const pages = companyResearch?.source_pages?.length ?? 0;
    const sources = (founderResearch ? 1 : 0) + (companyResearch ? 1 : 0) + (companyLinkedIn ? 1 : 0);
    return { sources, pages };
  }, [founderResearch, companyResearch, companyLinkedIn]);

  const call = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!workspaceId) throw new Error('No workspace');
    const { data, error } = await supabase.functions.invoke(FN, {
      body: { action, workspace_id: workspaceId, ...payload },
    });
    if (error) throw error;
    return data as any;
  }, [workspaceId]);

  // -------------------------------------------------------- step handlers ---

  async function analyzeFounder() {
    setBusy('founder'); setError(null);
    try {
      const r = await call('research_founder', {
        linkedin_url: founder.linkedin_url,
        consent: founder.enrichment_consent,
      });
      if (r?.ok && r.research) {
        setFounderResearch(r.research);
        toast.success('Founder profile analyzed', { description: `Confidence: ${r.research.confidence}` });
      } else {
        setError({ title: 'Founder analysis unavailable', body: explain(r?.reason ?? r?.error, 'founder') });
      }
    } catch {
      setError({ title: 'Founder analysis failed', body: 'You can continue and fill this in by hand.' });
    } finally { setBusy(null); }
  }

  async function analyzeCompany() {
    setBusy('company'); setError(null);
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
        setError({ title: 'Company analysis unavailable', body: explain(r?.reason ?? r?.error, 'company') });
      }
    } catch {
      setError({ title: 'Company analysis failed', body: 'You can continue and fill this in by hand.' });
    } finally { setBusy(null); }
  }

  async function draftBrain() {
    setBusy('draft'); setError(null);
    try {
      const r = await call('draft', buildDraftInput({
        founder, company, founderResearch, companyResearch, companyLinkedIn,
      }));
      if (r?.ok && r.draft) {
        setDraft(r.draft);
        setEdited(null);
        setStepIndex(stepIndexOf('review'));
        toast.success('Draft Company Brain ready', { description: 'Review each card before activating.' });
      } else {
        setError({ title: 'Could not draft the Brain', body: explain(r?.reason ?? r?.error, 'draft') });
      }
    } catch {
      setError({ title: 'Draft failed', body: 'You can still fill the Brain in by hand.' });
    } finally { setBusy(null); }
  }

  async function persist(activate: boolean) {
    setBusy(activate ? 'activate' : 'save'); setError(null);
    try {
      const patch = buildSavePatch({ founder, company, brain });
      const r = await call(activate ? 'activate' : 'save_draft', { patch });
      if (activate && !r?.activated) {
        setError({
          title: "Can't activate yet",
          body: (r?.blocked_reasons ?? []).join('; ') || 'Requirements not met. Your draft is saved.',
        });
        return;
      }
      toast.success(activate ? 'Company Brain activated' : 'Draft saved', {
        description: activate
          ? 'Leads, Scout Radar, Content, Agents and Outreach now use it.'
          : 'You can finish later.',
      });
      if (activate) navigate('/dashboard');
    } catch {
      setError({ title: 'Save failed', body: 'Nothing was lost — try again.' });
    } finally { setBusy(null); }
  }

  const onQuickAction = (action: QuickAction, value?: string) =>
    setEdited(applyQuickAction(brain, action, value));

  const canNext = canContinue(step, { founder, company });

  // ---------------------------------------------------------------- render --

  return (
    <div className="relative min-h-screen text-foreground">
      <AmbientBackground />

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-border/40 bg-background/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary shadow-[0_0_16px_hsl(var(--primary)/0.25)]">
              <Cpu className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Agentory · Brain Lab</p>
              <p className="text-xs font-semibold">Company Brain setup</p>
            </div>
          </div>
          <Button
            size="sm" variant="ghost"
            onClick={() => persist(false)}
            disabled={!!busy || !workspaceId}
            className="h-8 text-xs"
          >
            {busy === 'save' && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save draft
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        {/* Stepper */}
        <div className="mx-auto max-w-3xl">
          <StepProgress index={stepIndex} steps={STEPS} />
        </div>

        {/* Grid */}
        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <main className="min-w-0">
            <div className="mb-8">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.22em] text-primary">
                Step {stepIndex + 1} of {STEPS.length} · {stepAt(stepIndex).label}
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                {stepTitle(step)}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                {stepSubtitle(step)}
              </p>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="space-y-5"
              >
                {error && (
                  <ErrorState
                    title={error.title}
                    body={error.body}
                    onRetry={
                      step === 'founder' ? analyzeFounder :
                      step === 'company' ? analyzeCompany :
                      step === 'research' ? draftBrain :
                      undefined
                    }
                    onContinue={
                      step === 'founder' || step === 'company' || step === 'research'
                        ? () => { setError(null); setStepIndex((i) => Math.min(STEPS.length - 1, i + 1)); }
                        : undefined
                    }
                  />
                )}

                {step === 'founder' && (
                  <FounderStep
                    value={founder} onChange={setFounder} busy={busy === 'founder'} research={founderResearch}
                    onAnalyze={analyzeFounder}
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
                    busy={busy === 'draft'}
                    founder={founder} company={company}
                    founderResearch={founderResearch}
                    companyResearch={companyResearch}
                    companyLinkedIn={companyLinkedIn}
                    onDraft={draftBrain}
                  />
                )}
                {step === 'review' && (
                  <ReviewStep
                    brain={brain} draft={draft} missingByStep={completeness.missing_by_step}
                    onQuickAction={onQuickAction} onEditBrain={setEdited}
                  />
                )}
                {step === 'activate' && <ActivationHero completeness={completeness} />}
              </motion.div>
            </AnimatePresence>

            {/* Footer nav */}
            <nav className="mt-10 flex items-center justify-between gap-3 border-t border-border/40 pt-6">
              <Button
                variant="ghost" size="sm"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                disabled={stepIndex === 0 || !!busy}
              >
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>

              {step === 'activate' ? (
                <Button
                  size="lg"
                  onClick={() => persist(true)}
                  disabled={!!busy || !completeness.complete || !workspaceId}
                  className="min-w-[240px] gap-2 bg-primary text-primary-foreground shadow-[0_0_28px_hsl(var(--primary)/0.4)] hover:bg-primary/90"
                >
                  {busy === 'activate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  Activate Company Brain
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
                  disabled={!canNext || !!busy}
                  className="gap-2"
                >
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </nav>
          </main>

          {/* Right rail — desktop */}
          <div className="hidden lg:block">
            <div className="sticky top-24">
              <BrainPreviewPanel brain={brain} completeness={completeness} evidenceCount={evidenceCount} />
            </div>
          </div>

          {/* Right rail — mobile */}
          <div className="lg:hidden">
            <button
              type="button"
              onClick={() => setPreviewOpen((o) => !o)}
              className="mb-3 flex w-full items-center justify-between rounded-xl border border-border/50 bg-card/40 px-4 py-3 text-left backdrop-blur-md"
              aria-expanded={previewOpen}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Cpu className="h-3.5 w-3.5 text-primary" />
                Your Company Brain — {completeness.percent}%
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${previewOpen ? 'rotate-180' : ''}`} />
            </button>
            {previewOpen && <BrainPreviewPanel brain={brain} completeness={completeness} evidenceCount={evidenceCount} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function stepTitle(step: StepId): string {
  switch (step) {
    case 'founder':  return 'Tell us who you are';
    case 'company':  return 'What does your company do?';
    case 'research': return 'Let Agentory read your world';
    case 'review':   return 'Review your Brain';
    case 'activate': return 'Activate Company Brain';
  }
}

function stepSubtitle(step: StepId): string {
  switch (step) {
    case 'founder':  return 'We use this to understand your background, credibility, and how Agentory should communicate on your behalf.';
    case 'company':  return 'Agentory will read a few key pages of your site — no broad crawl — and use it to shape your ICP.';
    case 'research': return 'AI turns the evidence it just read into a first draft of your Brain. Nothing sends automatically.';
    case 'review':   return 'You confirm what is true before anything targets a real company. Edit any card — chips, personas, disqualifiers — as you go.';
    case 'activate': return 'This flips the switch for Leads, Scout Radar, Content, Agents and Outreach to start using your context.';
  }
}

// ============================================================================
// Step 1 — Founder
// ============================================================================

function FounderStep({
  value, onChange, busy, research, onAnalyze,
}: {
  value: FounderForm; onChange: (f: FounderForm) => void;
  busy: boolean; research: any; onAnalyze: () => void;
}) {
  const set = <K extends keyof FounderForm>(k: K, v: FounderForm[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <PanelCard icon={<User className="h-4 w-4" />} title="About you" hint="Shapes voice, credibility and outreach tone.">
        <div className="space-y-4">
          <Field label="Your name" required>
            <Input value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field label="Role / title">
            <Input value={value.role} onChange={(e) => set('role', e.target.value)} placeholder="Founder & CEO" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Timezone" hint="Optional">
              <Input value={value.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="UTC+5:45" />
            </Field>
            <Field label="First goal" hint="Optional">
              <Input value={value.first_help_goal} onChange={(e) => set('first_help_goal', e.target.value)} placeholder="Find warm leads" />
            </Field>
          </div>
        </div>
      </PanelCard>

      <PanelCard
        icon={<Sparkles className="h-4 w-4" />}
        title="Enrich from LinkedIn"
        hint="Optional. We read only the profile URL you provide — never emails, phones or contacts."
      >
        {research ? (
          <FounderFoundCard research={research} />
        ) : (
          <div className="space-y-4">
            <Field label="LinkedIn profile URL">
              <Input
                value={value.linkedin_url}
                onChange={(e) => set('linkedin_url', e.target.value)}
                placeholder="https://linkedin.com/in/your-handle"
              />
            </Field>

            <div className="flex items-start justify-between gap-3 rounded-xl border border-primary/25 bg-primary/[0.04] p-3.5">
              <div className="flex min-w-0 items-start gap-2.5">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">Use this URL to enrich my Brain</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">Consent-based. Nothing runs unless you toggle this on and click analyze.</p>
                </div>
              </div>
              <Switch
                checked={value.enrichment_consent}
                onCheckedChange={(c) => set('enrichment_consent', c === true)}
              />
            </div>

            <Button size="sm" onClick={onAnalyze} disabled={!canEnrichFounder(value) || busy} className="w-full sm:w-auto">
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
              Analyze founder profile
            </Button>
          </div>
        )}
      </PanelCard>
    </div>
  );
}

function FounderFoundCard({ research }: { research: any }) {
  const initials = (research.name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s: string) => s[0]).join('').toUpperCase();
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
    >
      <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-primary">
        <Sparkles className="h-3 w-3" /> Found on LinkedIn
      </div>
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-sm font-semibold text-primary shadow-[0_0_20px_hsl(var(--primary)/0.2)]">
          {initials || '·'}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {research.name}
            {research.current_role ? ` — ${research.current_role}` : ''}
          </p>
          {research.current_company && <p className="mt-0.5 text-xs text-muted-foreground">at {research.current_company}</p>}
          {research.headline && <p className="mt-1 text-[11px] italic text-foreground/70">"{research.headline}"</p>}
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <FieldList label="Credibility signals" values={research.credibility_signals ?? []} empty="None detected" />
        <FieldList label="GTM relevance" values={research.gtm_relevance ?? []} empty="No GTM signal detected" />
      </div>
    </motion.div>
  );
}

// ============================================================================
// Step 2 — Company
// ============================================================================

function CompanyStep({
  value, onChange, busy, research, linkedin, onAnalyze,
}: {
  value: CompanyForm; onChange: (c: CompanyForm) => void;
  busy: boolean; research: any; linkedin: any; onAnalyze: () => void;
}) {
  const set = <K extends keyof CompanyForm>(k: K, v: CompanyForm[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <PanelCard icon={<Building2 className="h-4 w-4" />} title="Company identity">
          <div className="space-y-4">
            <Field label="Company name" required>
              <Input value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Agentory" />
            </Field>
            <Field label="One-line description">
              <Textarea rows={2} value={value.description} onChange={(e) => set('description', e.target.value)} placeholder="AI workforce OS for founders building B2B pipeline" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Stage" hint="Optional">
                <Input value={value.stage} onChange={(e) => set('stage', e.target.value)} placeholder="seed" />
              </Field>
              <Field label="Team size" hint="Optional">
                <Input value={value.team_size} onChange={(e) => set('team_size', e.target.value)} placeholder="2-5" />
              </Field>
            </div>
          </div>
        </PanelCard>

        <PanelCard icon={<Globe className="h-4 w-4" />} title="Web presence" hint="Website is required. LinkedIn is optional.">
          <div className="space-y-4">
            <Field label="Website URL" required>
              <Input value={value.website_url} onChange={(e) => set('website_url', e.target.value)} placeholder="https://agentory.space" />
            </Field>
            <Field label="LinkedIn company URL" hint="Optional">
              <Input value={value.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)} placeholder="https://linkedin.com/company/agentory" />
            </Field>
            <Button size="sm" onClick={onAnalyze} disabled={!canAnalyzeCompany(value) || busy} className="w-full sm:w-auto">
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
              Analyze company
            </Button>
          </div>
        </PanelCard>
      </div>

      <PagePreviewChips />

      {research && <CompanyFoundCard research={research} linkedin={linkedin} website={value.website_url} />}
    </div>
  );
}

function CompanyFoundCard({ research, linkedin, website }: { research: any; linkedin: any; website: string }) {
  const host = (() => { try { return new URL(website).hostname; } catch { return ''; } })();
  const favicon = host ? `https://www.google.com/s2/favicons?domain=${host}&sz=64` : '';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.06] to-transparent p-6 backdrop-blur-sm"
    >
      <div className="mb-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-primary">
        <Sparkles className="h-3 w-3" /> Extracted from your site
      </div>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/40 bg-muted/40">
          {favicon ? <img src={favicon} alt="" className="h-6 w-6" /> : <Globe className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="min-w-0">
          {research.description && <p className="text-sm text-foreground/95">{research.description}</p>}
          {host && <p className="mt-0.5 text-[11px] text-muted-foreground">{host}</p>}
        </div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <FieldList label="Business model" values={research.business_model ? [research.business_model] : []} />
        <FieldList label="Integrations" values={research.integrations ?? []} empty="None found" />
        <FieldList label="Proof points" values={research.proof_points ?? []} empty="No verifiable proof found" />
        {linkedin && (
          <FieldList label="LinkedIn" values={[linkedin.industry, linkedin.employee_count].filter(Boolean)} />
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// Step 3 — AI Research / Draft
// ============================================================================

function ResearchStep({
  busy, founder, company, founderResearch, companyResearch, companyLinkedIn, onDraft,
}: {
  busy: boolean;
  founder: FounderForm; company: CompanyForm;
  founderResearch: any; companyResearch: any; companyLinkedIn: any;
  onDraft: () => void;
}) {
  const stages: TimelineStage[] = [
    {
      id: 'founder', label: 'Founder research',
      detail: founderResearch ? `${founderResearch.confidence} confidence` : founder.linkedin_url ? 'Skipped — no consent' : 'Skipped',
      status: founderResearch ? 'done' : 'skipped',
    },
    {
      id: 'website', label: 'Website research',
      detail: companyResearch ? `${companyResearch.source_pages?.length ?? 0} page(s) read` : 'Not analyzed',
      status: companyResearch ? 'done' : company.website_url ? 'pending' : 'skipped',
    },
    {
      id: 'linkedin-co', label: 'LinkedIn company',
      detail: companyLinkedIn ? `${companyLinkedIn.industry ?? 'read'}` : company.linkedin_url ? 'Not read' : 'Skipped',
      status: companyLinkedIn ? 'done' : 'skipped',
    },
    { id: 'evidence',  label: 'Evidence extraction', detail: 'Pulls category, promise, buyers, proof', status: busy ? 'active' : (founderResearch || companyResearch) ? 'pending' : 'pending' },
    { id: 'icp',       label: 'ICP hypothesis',      detail: 'Industries, buyers, triggers, disqualifiers', status: busy ? 'active' : 'pending' },
    { id: 'draft',     label: 'Draft generation',    detail: 'On-voice, evidence-grounded', status: busy ? 'active' : 'pending' },
  ];

  // Build clean evidence cards from research state
  const cards: Array<React.ComponentProps<typeof SourceEvidenceCard>> = [];

  if (founderResearch) {
    cards.push({
      label: 'Founder profile',
      path: 'linkedin.com/in/…',
      status: 'extracted',
      confidence: (founderResearch.confidence as any) ?? 'medium',
      bullets: [
        founderResearch.current_role && `Role: ${founderResearch.current_role}`,
        founderResearch.current_company && `Company: ${founderResearch.current_company}`,
        ...(founderResearch.credibility_signals ?? []).slice(0, 2),
      ].filter(Boolean) as string[],
    });
  }

  if (companyResearch) {
    const pages: string[] = companyResearch.source_pages ?? [];
    pages.slice(0, 5).forEach((p) => {
      let path = p; try { path = new URL(p).pathname || '/'; } catch {}
      const label = pageLabel(path);
      cards.push({
        label, path,
        status: 'extracted' as EvidenceStatus,
        confidence: 'medium',
        bullets: pageBullets(companyResearch, label),
      });
    });
    if (pages.length === 0) {
      cards.push({
        label: 'Website', status: 'weak', confidence: 'low',
        bullets: ['Homepage returned no usable content.'],
      });
    }
  } else if (company.website_url) {
    cards.push({ label: 'Website', path: company.website_url, status: 'skipped', bullets: [] });
  }

  if (companyLinkedIn) {
    cards.push({
      label: 'LinkedIn company', path: 'linkedin.com/company/…',
      status: 'extracted', confidence: 'medium',
      bullets: [
        companyLinkedIn.industry && `Industry: ${companyLinkedIn.industry}`,
        companyLinkedIn.employee_count && `Employees: ${companyLinkedIn.employee_count}`,
      ].filter(Boolean) as string[],
    });
  }

  if (cards.length === 0) {
    cards.push(
      { label: 'Website', status: 'skipped', bullets: [] },
      { label: 'Founder', status: 'skipped', bullets: [] },
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <ResearchTimeline stages={stages} running={busy} />

      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((c, i) => <SourceEvidenceCard key={`${c.label}-${i}`} {...c} index={i} />)}
        </div>

        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/[0.08] via-primary/[0.04] to-transparent p-6 backdrop-blur-sm"
        >
          {busy && (
            <motion.div
              aria-hidden
              className="absolute inset-0 opacity-40"
              style={{ background: 'linear-gradient(90deg, transparent, hsl(var(--primary) / 0.25), transparent)' }}
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
            />
          )}
          <div className="relative flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-primary">Ready to draft</p>
              <p className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                Agentory will turn this evidence into your Brain
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Anything inferred without proof is flagged for your confirmation. Never invented.
              </p>
            </div>
            <Button
              size="lg" onClick={onDraft} disabled={busy}
              className="min-w-[220px] gap-2 bg-primary text-primary-foreground shadow-[0_0_28px_hsl(var(--primary)/0.4)] hover:bg-primary/90"
            >
              {busy
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading evidence…</>
                : <><Sparkles className="h-4 w-4" /> Draft my Company Brain</>}
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function pageLabel(path: string): string {
  const p = path.toLowerCase();
  if (p === '/' || p === '') return 'Homepage';
  if (p.includes('pricing')) return 'Pricing';
  if (p.includes('feature')) return 'Features';
  if (p.includes('about')) return 'About';
  if (p.includes('customer') || p.includes('case')) return 'Customers';
  if (p.includes('career') || p.includes('job')) return 'Careers';
  if (p.includes('blog')) return 'Blog';
  return 'Page';
}
function pageBullets(research: any, label: string): string[] {
  const b: string[] = [];
  if (label === 'Homepage') {
    if (research.category) b.push(`Category: ${research.category}`);
    if (research.description) b.push(research.description);
  } else if (label === 'Pricing') {
    (research.pricing_signals ?? []).slice(0, 2).forEach((s: string) => b.push(s));
  } else if (label === 'Customers') {
    (research.proof_points ?? []).slice(0, 2).forEach((s: string) => b.push(s));
  } else if (label === 'Careers') {
    (research.hiring_signals ?? []).slice(0, 2).forEach((s: string) => b.push(s));
  }
  if (b.length === 0 && research.business_model) b.push(`Business model: ${research.business_model}`);
  if (b.length === 0) b.push('Read successfully — no structured findings surfaced.');
  return b.slice(0, 4);
}

// ============================================================================
// Step 4 — Review "Brain Board"
// ============================================================================

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

  const setList = (mutate: (b: CompanyBrainV2, v: string[]) => void) => (next: string[]) => {
    const nb: CompanyBrainV2 = structuredClone(brain);
    mutate(nb, next);
    onEditBrain(nb);
  };

  return (
    <div className="space-y-10">
      {/* TARGETING */}
      <BrainSection
        icon={<Target className="h-4 w-4" />}
        eyebrow="Targeting"
        title="Who Agentory will target"
        subtitle="Powers Leads, Scout Radar and every scoring surface."
      >
        <BrainReviewCard
          title="Company summary" subtitle="What Agentory thinks you sell"
          confidence={brain.brain_confidence} sources={sources}
          needsConfirmation={needs.filter((n) => n.startsWith('company')).length}
          missing={missingByStep.company?.length ? ['company fields'] : []}
        >
          <p className="text-sm text-foreground/90">{brain.company.description || 'No description yet.'}</p>
          <FieldList label="Category" values={brain.company.category ? [brain.company.category] : []} />
          <FieldList label="Business model" values={brain.company.business_model ? [brain.company.business_model] : []} />
        </BrainReviewCard>

        <BrainReviewCard
          title="Ideal customers" subtitle="Who Leads and Radar will hunt for"
          confidence={brain.brain_confidence} sources={sources}
          needsConfirmation={needs.filter((n) => n.startsWith('target_customer')).length}
          missing={missingByStep.customers?.length ? ['industries or business models'] : []}
          quickActions={QUICK_ACTIONS.filter((a) => ['correct', 'too_broad', 'too_narrow'].includes(a.id))}
          onQuickAction={onQuickAction}
        >
          <ChipInput label="Industries" values={tc.industries} onChange={setList((b, v) => { b.target_customer.industries = v; })} emptyHelper="Add industries you sell into" />
          <ChipInput label="Business models" values={tc.business_models} onChange={setList((b, v) => { b.target_customer.business_models = v; })} emptyHelper="Add business models" />
          <FieldList label="Company size" values={tc.company_size.label ? [tc.company_size.label] : []} />
          <FieldList label="Geography" values={tc.geography} />
          <ChipInput label="Must-have traits" values={tc.must_have} onChange={setList((b, v) => { b.target_customer.must_have = v; })} emptyHelper="Add non-negotiable traits" />
        </BrainReviewCard>
      </BrainSection>

      {/* SIGNALS */}
      <BrainSection
        icon={<Radar className="h-4 w-4" />}
        eyebrow="Signals"
        title="When to act"
        subtitle="Triggers, jobs and tools Scout Radar watches on your behalf."
      >
        <BrainReviewCard
          title="Buyers" subtitle="Who actually signs"
          confidence={brain.brain_confidence} sources={liSources}
          needsConfirmation={needs.filter((n) => n.startsWith('buyer')).length}
          missing={missingByStep.buyers?.length ? ['buyer personas'] : []}
        >
          <ChipInput label="Buyer personas" values={brain.buyer_personas} onChange={setList((b, v) => { b.buyer_personas = v; })} emptyHelper="Add roles that hold the budget" />
          <ChipInput label="Pain points" values={brain.pain_points} onChange={setList((b, v) => { b.pain_points = v; })} emptyHelper="Add the pain your product solves" />
        </BrainReviewCard>

        <BrainReviewCard
          title="Buying triggers" subtitle="What makes now the right moment"
          confidence={brain.brain_confidence} sources={sources}
          missing={missingByStep.triggers?.length ? ['a trigger or job to watch'] : []}
          quickActions={QUICK_ACTIONS.filter((a) => a.id === 'require_proof')}
          onQuickAction={onQuickAction}
        >
          <ChipInput label="Triggers" values={brain.triggers} onChange={setList((b, v) => { b.triggers = v; })} emptyHelper="e.g. new funding, exec hire" />
          <ChipInput label="Jobs to watch" values={brain.jobs_to_watch} onChange={setList((b, v) => { b.jobs_to_watch = v; })} emptyHelper="Job titles that signal intent" />
          <FieldList label="Tools to watch" values={brain.tools} />
          <FieldList label="Competitor activity" values={brain.competitors} />
        </BrainReviewCard>
      </BrainSection>

      {/* MESSAGING */}
      <BrainSection
        icon={<MessageSquare className="h-4 w-4" />}
        eyebrow="Messaging"
        title="How Agentory should speak"
        subtitle="Voice, angles and positioning for Content and Outreach."
      >
        <BrainReviewCard
          title="Positioning & voice"
          confidence={brain.brain_confidence} sources={sources}
          needsConfirmation={needs.filter((n) => n.startsWith('positioning')).length}
          missing={missingByStep.content?.length ? ['a pain point or content angle'] : []}
        >
          <FieldList label="Promise" values={brain.positioning.promise ? [brain.positioning.promise] : []} />
          <FieldList label="Differentiators" values={brain.positioning.differentiators} />
          <ChipInput label="Content angles" values={brain.content_angles} onChange={setList((b, v) => { b.content_angles = v; })} emptyHelper="Add narrative angles" />
          <FieldList label="Tone" values={brain.brand_voice.tone ? [brain.brand_voice.tone] : []} />
        </BrainReviewCard>

        <BrainReviewCard title="Good & bad fit examples" subtitle="Concrete companies train the scorer faster than rules" sources={[]}>
          <ChipInput label="Good-fit companies" values={brain.positive_examples} onChange={setList((b, v) => { b.positive_examples = v; })} emptyHelper="Add companies that would love you" />
          <ChipInput label="Bad-fit companies" values={brain.negative_examples} onChange={setList((b, v) => { b.negative_examples = v; })} emptyHelper="Add companies to avoid" />
        </BrainReviewCard>
      </BrainSection>

      {/* SAFETY */}
      <BrainSection
        icon={<Shield className="h-4 w-4" />}
        eyebrow="Safety"
        title="What Agentory will never do"
        subtitle="Disqualifiers are enforced before anything reaches you or a prospect."
      >
        <BrainReviewCard
          title="Never target these"
          confidence={brain.brain_confidence} sources={[]}
          missing={missingByStep.disqualifiers?.length ? ['at least one disqualifier'] : []}
          quickActions={QUICK_ACTIONS.filter((a) => ['never_target', 'add_bad_fit'].includes(a.id))}
          onQuickAction={onQuickAction}
        >
          <ChipInput label="Industries to avoid" values={disq.industries} onChange={setList((b, v) => { b.target_customer.disqualifiers.industries = v; })} emptyHelper="Add industries Agentory should skip" />
          <ChipInput label="Company types to avoid" values={disq.company_types} onChange={setList((b, v) => { b.target_customer.disqualifiers.company_types = v; })} emptyHelper="e.g. agencies, freelancers" />
          <ChipInput label="Keywords to avoid" values={disq.keywords} onChange={setList((b, v) => { b.target_customer.disqualifiers.keywords = v; })} emptyHelper="Words that mean 'not a fit'" />
        </BrainReviewCard>

        <BrainReviewCard title="Qualification rules" subtitle="Evidence required before a lead is trusted" sources={[]}>
          <ChipInput label="Required evidence" values={brain.qualification_rules.required_evidence} onChange={setList((b, v) => { b.qualification_rules.required_evidence = v; })} emptyHelper="Add proof Agentory must verify" />
          <ChipInput label="Reject if" values={brain.qualification_rules.reject_if} onChange={setList((b, v) => { b.qualification_rules.reject_if = v; })} emptyHelper="Auto-reject conditions" />
          <FieldList label="Manual review if" values={brain.qualification_rules.manual_review_if} />
          <FieldList label="Banned claims" values={[...brain.positioning.avoid_positioning, ...brain.brand_voice.avoid]} empty="None set" />
        </BrainReviewCard>
      </BrainSection>
    </div>
  );
}

// ============================================================================
// Shared primitives
// ============================================================================

function PanelCard({
  icon, title, hint, children,
}: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="group relative overflow-hidden rounded-2xl border border-border/50 bg-card/40 p-6 shadow-[0_20px_60px_-30px_hsl(var(--primary)/0.2)] backdrop-blur-xl transition-colors hover:border-border">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: 'linear-gradient(to right, transparent, hsl(var(--primary) / 0.6), transparent)' }}
      />
      <header className="mb-5 flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary shadow-[0_0_16px_hsl(var(--primary)/0.15)]">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
          {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
        {hint && <span className="ml-1.5 normal-case tracking-normal text-muted-foreground/60">{hint}</span>}
      </Label>
      {children}
    </div>
  );
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
    case 'consent_not_given': return 'Turn on the consent toggle to enrich from LinkedIn.';
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
