// Company Brain Onboarding v3 — premium 5-step setup surface.
//
// Presentation makeover only. Backend contract is byte-identical:
//   invoke('generate-company-brain-draft', { action, workspace_id, ... })
// with actions: research_founder | research_company | draft | save_draft | activate.
//
// Providers run ONLY on an explicit click; founder enrichment also requires
// consent. Nothing sends automatically and no Scout Radar scan is triggered.
// Activation is server-authoritative; this UI mirrors the same rules for the
// live preview panel.

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
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, ArrowRight, Building2, Check, ChevronDown, Cpu, Globe, Info, Loader2, Lock,
  Rocket, Search, ShieldCheck, Sparkles, User,
} from 'lucide-react';

import { BrainPreviewPanel } from '@/components/onboarding/BrainPreviewPanel';
import { BrainReviewCard, FieldList } from '@/components/onboarding/BrainReviewCard';
import { StepProgress } from '@/components/onboarding/StepProgress';
import { ChipInput } from '@/components/onboarding/ChipInput';
import { CompletenessRing } from '@/components/onboarding/CompletenessRing';
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
    setBusy('founder'); setNotice(null);
    try {
      const r = await call('research_founder', {
        linkedin_url: founder.linkedin_url,
        consent: founder.enrichment_consent,
      });
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
      const r = await call('draft', buildDraftInput({
        founder, company, founderResearch, companyResearch, companyLinkedIn,
      }));
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
          ? 'Leads, Scout Radar, Content, Agents and Outreach now use it.'
          : 'You can finish later.',
      });
      if (activate) navigate('/dashboard');
    } catch {
      setNotice('Save failed. Nothing was lost — try again.');
    } finally { setBusy(null); }
  }

  const onQuickAction = (action: QuickAction, value?: string) =>
    setEdited(applyQuickAction(brain, action, value));

  const canNext = canContinue(step, { founder, company });

  // ---------------------------------------------------------------- render --

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      {/* Ambient background wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(1200px 600px at 50% -10%, hsl(var(--primary) / 0.08), transparent 60%), radial-gradient(800px 400px at 90% 20%, hsl(var(--primary) / 0.05), transparent 60%)',
        }}
      />

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-border/40 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary">
              <Cpu className="h-3.5 w-3.5" />
            </div>
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Agentory</p>
              <p className="text-xs font-semibold">Company Brain setup</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            <div className="mb-6">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
                Step {stepIndex + 1} of {STEPS.length}
              </p>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {stepTitle(step)}
              </h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">{stepAt(stepIndex).powers}</p>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                {notice && (
                  <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5 text-xs text-amber-100">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                    <span>{notice}</span>
                  </div>
                )}

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
              </motion.div>
            </AnimatePresence>

            {/* Sticky footer nav */}
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
                  className="min-w-[220px] gap-2 bg-primary text-primary-foreground shadow-[0_0_24px_hsl(var(--primary)/0.35)] hover:bg-primary/90"
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
              <BrainPreviewPanel brain={brain} completeness={completeness} />
            </div>
          </div>

          {/* Right rail — mobile accordion */}
          <div className="lg:hidden">
            <button
              type="button"
              onClick={() => setPreviewOpen((o) => !o)}
              className="mb-3 flex w-full items-center justify-between rounded-xl border border-border/50 bg-card/40 px-4 py-3 text-left"
              aria-expanded={previewOpen}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Cpu className="h-3.5 w-3.5 text-primary" />
                Your Company Brain — {completeness.percent}%
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${previewOpen ? 'rotate-180' : ''}`} />
            </button>
            {previewOpen && <BrainPreviewPanel brain={brain} completeness={completeness} />}
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
    case 'research': return 'Let Agentory draft your Brain';
    case 'review':   return 'Review what Agentory learned';
    case 'activate': return 'Activate your Company Brain';
  }
}

// ============================================================================
// Step 1 — Founder
// ============================================================================

function FounderStep({
  value, onChange, busy, research, onAnalyze, onSkip,
}: {
  value: FounderForm; onChange: (f: FounderForm) => void;
  busy: boolean; research: any; onAnalyze: () => void; onSkip: () => void;
}) {
  const set = <K extends keyof FounderForm>(k: K, v: FounderForm[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-5">
      <PanelCard icon={<User className="h-3.5 w-3.5" />} title="About you" hint="Shapes voice, credibility and outreach tone.">
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
          <Field label="First thing Agentory should help with">
            <Input value={value.first_help_goal} onChange={(e) => set('first_help_goal', e.target.value)} placeholder="Find warm leads" />
          </Field>
        </div>
      </PanelCard>

      <PanelCard
        icon={<Sparkles className="h-3.5 w-3.5" />}
        title="Enrich from LinkedIn"
        hint="Optional. We read only the profile URL you give us — never emails, phones or contacts."
      >
        <Field label="LinkedIn profile URL">
          <Input
            value={value.linkedin_url}
            onChange={(e) => set('linkedin_url', e.target.value)}
            placeholder="https://linkedin.com/in/your-handle"
          />
        </Field>

        <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-border/50 bg-background/40 p-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">Use this URL to enrich my Company Brain</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Consent-based. You can revoke this anytime.</p>
            </div>
          </div>
          <Switch
            checked={value.enrichment_consent}
            onCheckedChange={(c) => set('enrichment_consent', c === true)}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onAnalyze} disabled={!canEnrichFounder(value) || busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
            Analyze founder profile
          </Button>
          <Button size="sm" variant="ghost" onClick={onSkip} disabled={busy}>Skip enrichment</Button>
        </div>
      </PanelCard>

      {research && <FounderFoundCard research={research} />}
    </div>
  );
}

function FounderFoundCard({ research }: { research: any }) {
  const initials = (research.name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s: string) => s[0]).join('').toUpperCase();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
      className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.06] to-transparent p-5"
    >
      <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-primary">
        <Sparkles className="h-3 w-3" /> Found on LinkedIn
      </div>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-sm font-semibold text-primary">
          {initials || '·'}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {research.name}
            {research.current_role ? ` — ${research.current_role}` : ''}
            {research.current_company ? ` at ${research.current_company}` : ''}
          </p>
          {research.headline && <p className="mt-0.5 text-xs text-muted-foreground">{research.headline}</p>}
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <FieldList label="Credibility signals" values={research.credibility_signals ?? []} empty="None detected" />
        <FieldList label="Why this matters for GTM" values={research.gtm_relevance ?? []} empty="No GTM signal detected" />
        {(research.missing_evidence ?? []).length > 0 && (
          <p className="text-xs text-amber-200">Could not read: {research.missing_evidence.join(', ')}</p>
        )}
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
      <PanelCard
        icon={<Building2 className="h-3.5 w-3.5" />}
        title="Your company"
        hint="Agentory reads your homepage plus up to 10 key pages — no broad web crawl."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" required>
            <Input value={value.name} onChange={(e) => set('name', e.target.value)} placeholder="Agentory" />
          </Field>
          <Field label="Website URL" required>
            <Input value={value.website_url} onChange={(e) => set('website_url', e.target.value)} placeholder="https://agentory.space" />
          </Field>
          <Field label="LinkedIn company URL" hint="Optional">
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

        <div className="mt-5 flex items-center gap-3">
          <Button size="sm" onClick={onAnalyze} disabled={!canAnalyzeCompany(value) || busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
            Analyze company
          </Button>
          <span className="text-[11px] text-muted-foreground">Reads homepage + about, pricing, customers…</span>
        </div>
      </PanelCard>

      {research && <CompanyFoundCard research={research} linkedin={linkedin} website={value.website_url} />}
    </div>
  );
}

function CompanyFoundCard({ research, linkedin, website }: { research: any; linkedin: any; website: string }) {
  const host = (() => { try { return new URL(website).hostname; } catch { return ''; } })();
  const favicon = host ? `https://www.google.com/s2/favicons?domain=${host}&sz=64` : '';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
      className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.06] to-transparent p-5"
    >
      <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-primary">
        <Sparkles className="h-3 w-3" /> Read from your site
      </div>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/40 bg-muted/40">
          {favicon ? <img src={favicon} alt="" className="h-6 w-6" /> : <Globe className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="min-w-0">
          {research.description && <p className="text-sm text-foreground/90">{research.description}</p>}
          {host && <p className="mt-0.5 text-[11px] text-muted-foreground">{host}</p>}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <FieldList label="Business model" values={research.business_model ? [research.business_model] : []} />
        <FieldList label="Integrations" values={research.integrations ?? []} empty="None found" />
        <FieldList label="Proof points" values={research.proof_points ?? []} empty="No verifiable proof found" />
        {linkedin && (
          <FieldList label="LinkedIn" values={[linkedin.industry, linkedin.employee_count].filter(Boolean)} />
        )}
      </div>
      <div className="mt-4">
        <FieldList label="Pages read" values={(research.source_pages ?? []).map(shortPath)} empty="None" />
      </div>
      {(research.missing_evidence ?? []).length > 0 && (
        <p className="mt-3 text-xs text-amber-200">Missing evidence: {research.missing_evidence.join(', ')}</p>
      )}
    </motion.div>
  );
}

// ============================================================================
// Step 3 — AI Research / Draft
// ============================================================================

function ResearchStep({
  busy, founderResearch, companyResearch, onDraft,
}: {
  busy: boolean; founderResearch: any; companyResearch: any; onDraft: () => void;
}) {
  const pages = companyResearch?.source_pages?.length ?? 0;
  return (
    <div className="space-y-5">
      <PanelCard
        icon={<Sparkles className="h-3.5 w-3.5" />}
        title="Draft your Company Brain"
        hint="Agentory turns the evidence it read into a draft ICP, buyers, triggers and disqualifiers. It never invents proof — anything it infers is flagged for confirmation."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SourceTile
            label="Founder LinkedIn"
            ok={!!founderResearch}
            detail={founderResearch ? `${founderResearch.confidence} confidence` : 'Skipped'}
          />
          <SourceTile
            label="Company website"
            ok={!!companyResearch}
            detail={companyResearch ? `${pages} page(s) read` : 'Not analyzed'}
          />
        </div>

        <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <Button
            size="lg"
            onClick={onDraft}
            disabled={busy}
            className="min-w-[240px] gap-2 bg-primary text-primary-foreground shadow-[0_0_28px_hsl(var(--primary)/0.4)] hover:bg-primary/90"
          >
            {busy
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading evidence… drafting Brain…</>
              : <><Sparkles className="h-4 w-4" /> Draft my Company Brain</>}
          </Button>
          {!companyResearch && !founderResearch && (
            <p className="text-[11px] text-muted-foreground">
              No research yet — the draft will be thin and mostly need your confirmation.
            </p>
          )}
        </div>
      </PanelCard>
    </div>
  );
}

function SourceTile({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div
      className={[
        'rounded-xl border p-4 transition-colors',
        ok ? 'border-primary/40 bg-primary/[0.06]' : 'border-border/50 bg-background/30',
      ].join(' ')}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span
          className={[
            'flex h-5 w-5 items-center justify-center rounded-full border text-primary',
            ok ? 'border-primary/50 bg-primary/15' : 'border-border/60 bg-muted/30 text-muted-foreground/40',
          ].join(' ')}
        >
          <Check className="h-3 w-3" />
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

// ============================================================================
// Step 4 — Review
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
    <div className="grid gap-5 md:grid-cols-2">
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
        title="Ideal customers" subtitle="Who Leads and Scout Radar will target"
        confidence={brain.brain_confidence} sources={sources}
        needsConfirmation={needs.filter((n) => n.startsWith('target_customer')).length}
        missing={missingByStep.customers?.length ? ['industries or business models'] : []}
        quickActions={QUICK_ACTIONS.filter((a) => ['correct', 'too_broad', 'too_narrow'].includes(a.id))}
        onQuickAction={onQuickAction}
      >
        <ChipInput label="Industries" values={tc.industries} onChange={setList((b, v) => { b.target_customer.industries = v; })} />
        <ChipInput label="Business models" values={tc.business_models} onChange={setList((b, v) => { b.target_customer.business_models = v; })} />
        <FieldList label="Company size" values={tc.company_size.label ? [tc.company_size.label] : []} />
        <FieldList label="Geography" values={tc.geography} />
        <FieldList label="Funding stage" values={tc.funding_stage} />
        <ChipInput label="Must-have traits" values={tc.must_have} onChange={setList((b, v) => { b.target_customer.must_have = v; })} />
        <FieldList label="Nice-to-have" values={tc.nice_to_have} />
      </BrainReviewCard>

      <BrainReviewCard
        title="Buyers" subtitle="Who actually signs"
        confidence={brain.brain_confidence} sources={liSources}
        needsConfirmation={needs.filter((n) => n.startsWith('buyer')).length}
        missing={missingByStep.buyers?.length ? ['buyer personas'] : []}
      >
        <ChipInput label="Buyer personas" values={brain.buyer_personas} onChange={setList((b, v) => { b.buyer_personas = v; })} />
        <ChipInput label="Pain points" values={brain.pain_points} onChange={setList((b, v) => { b.pain_points = v; })} />
      </BrainReviewCard>

      <BrainReviewCard
        title="Buying triggers" subtitle="What makes now the right moment"
        confidence={brain.brain_confidence} sources={sources}
        missing={missingByStep.triggers?.length ? ['a trigger or job to watch'] : []}
        quickActions={QUICK_ACTIONS.filter((a) => a.id === 'require_proof')}
        onQuickAction={onQuickAction}
      >
        <ChipInput label="Triggers" values={brain.triggers} onChange={setList((b, v) => { b.triggers = v; })} />
        <ChipInput label="Jobs to watch" values={brain.jobs_to_watch} onChange={setList((b, v) => { b.jobs_to_watch = v; })} />
        <FieldList label="Tools to watch" values={brain.tools} />
        <FieldList label="Competitor activity" values={brain.competitors} />
      </BrainReviewCard>

      <BrainReviewCard
        title="Never target these" subtitle="Disqualifiers are enforced before anything reaches you"
        confidence={brain.brain_confidence} sources={[]}
        missing={missingByStep.disqualifiers?.length ? ['at least one disqualifier'] : []}
        quickActions={QUICK_ACTIONS.filter((a) => ['never_target', 'add_bad_fit'].includes(a.id))}
        onQuickAction={onQuickAction}
      >
        <ChipInput label="Industries to avoid" values={disq.industries} onChange={setList((b, v) => { b.target_customer.disqualifiers.industries = v; })} />
        <ChipInput label="Company types to avoid" values={disq.company_types} onChange={setList((b, v) => { b.target_customer.disqualifiers.company_types = v; })} />
        <ChipInput label="Keywords to avoid" values={disq.keywords} onChange={setList((b, v) => { b.target_customer.disqualifiers.keywords = v; })} />
        <FieldList label="Titles to avoid" values={disq.titles} />
        <FieldList label="Domains to avoid" values={disq.domains} />
      </BrainReviewCard>

      <BrainReviewCard title="Good fit / bad fit examples" subtitle="Concrete companies teach the scorer faster than rules" sources={[]}>
        <ChipInput label="Good-fit companies" values={brain.positive_examples} onChange={setList((b, v) => { b.positive_examples = v; })} />
        <ChipInput label="Bad-fit companies" values={brain.negative_examples} onChange={setList((b, v) => { b.negative_examples = v; })} />
      </BrainReviewCard>

      <BrainReviewCard
        title="Content & positioning" subtitle="Voice for Content and Outreach"
        confidence={brain.brain_confidence} sources={sources}
        needsConfirmation={needs.filter((n) => n.startsWith('positioning')).length}
        missing={missingByStep.content?.length ? ['a pain point or content angle'] : []}
      >
        <FieldList label="Promise" values={brain.positioning.promise ? [brain.positioning.promise] : []} />
        <FieldList label="Differentiators" values={brain.positioning.differentiators} />
        <ChipInput label="Content angles" values={brain.content_angles} onChange={setList((b, v) => { b.content_angles = v; })} />
        <FieldList label="Tone" values={brain.brand_voice.tone ? [brain.brand_voice.tone] : []} />
        <FieldList label="Banned claims" values={[...brain.positioning.avoid_positioning, ...brain.brand_voice.avoid]} empty="None set" />
      </BrainReviewCard>

      <BrainReviewCard title="Qualification rules" subtitle="Evidence required before a lead is trusted" sources={[]}>
        <ChipInput label="Required evidence" values={brain.qualification_rules.required_evidence} onChange={setList((b, v) => { b.qualification_rules.required_evidence = v; })} />
        <ChipInput label="Reject if" values={brain.qualification_rules.reject_if} onChange={setList((b, v) => { b.qualification_rules.reject_if = v; })} />
        <FieldList label="Manual review if" values={brain.qualification_rules.manual_review_if} />
      </BrainReviewCard>
    </div>
  );
}

// ============================================================================
// Step 5 — Activate
// ============================================================================

function ActivateStep({ completeness }: { completeness: CompletenessResult }) {
  return (
    <div className="space-y-6">
      <div
        className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-primary/[0.08] via-card/40 to-card/40 p-8 text-center backdrop-blur-md"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{ background: 'radial-gradient(400px 200px at 50% 0%, hsl(var(--primary) / 0.18), transparent 60%)' }}
        />
        <div className="relative">
          <div className="mb-5 flex justify-center">
            <CompletenessRing value={completeness.percent} size={168} caption="Complete" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {completeness.complete ? 'Your Company Brain is ready.' : 'Almost there.'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {completeness.complete
              ? 'Activate to let Leads, Scout Radar, Content, Agents and Outreach use it.'
              : 'Fill the remaining required fields to activate. You can save a draft and finish later.'}
          </p>
          <div className="mt-4 inline-flex items-center gap-2">
            <Badge
              variant="outline"
              className="gap-1 rounded-full border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-primary"
            >
              {completeness.confidence} confidence
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {completeness.required_met}/{completeness.required_total} required
            </span>
          </div>
        </div>
      </div>

      {completeness.missing.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-5">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">Still missing</h3>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {completeness.missing.map((m) => (
              <li key={m} className="text-xs text-amber-100/90">• {m}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-border/50 bg-card/40 p-5 backdrop-blur-sm">
        <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">What this powers</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {BRAIN_POWERS.map((p) => (
            <div key={p.key} className="rounded-xl border border-border/40 bg-background/30 p-3">
              <p className="text-sm font-medium text-foreground">{p.label}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{p.blurb}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ReassurancePill icon={<ShieldCheck className="h-3 w-3" />} text="No outreach sent" />
        <ReassurancePill icon={<ShieldCheck className="h-3 w-3" />} text="No Scout Radar scan started" />
        <ReassurancePill icon={<ShieldCheck className="h-3 w-3" />} text="You stay in control" />
      </div>
    </div>
  );
}

function ReassurancePill({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/40 px-2.5 py-1 text-[11px] text-muted-foreground">
      <span className="text-primary">{icon}</span>
      {text}
    </span>
  );
}

// ============================================================================
// Shared primitives
// ============================================================================

function PanelCard({
  icon, title, hint, children,
}: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/50 bg-card/40 p-6 backdrop-blur-sm shadow-[0_1px_0_hsl(var(--border))_inset]">
      <header className="mb-5 flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-foreground/90">
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
