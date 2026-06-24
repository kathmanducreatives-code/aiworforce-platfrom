import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { useIntegrationReadiness } from '@/hooks/useIntegrationReadiness';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import {
  ArrowRight, ArrowLeft, Loader2, Sparkles, CheckCircle2, AlertTriangle,
  Globe, ShieldCheck, Target, Eye, Mail, Building2, Compass, Megaphone, Lock,
  ChevronDown, ChevronRight, X, User, Workflow, Plug, Rocket, RefreshCw,
} from 'lucide-react';
import {
  getBrainDefaults, BRAND_VOICE_TAGS, GTM_MOTIONS, PRIMARY_CHANNELS,
  COMPANY_STAGES, TEAM_SIZES, FIRST_HELP_GOALS, type StructuredBrain,
} from '@/lib/companyBrainSchema';
import { mapDraftToStructured, mapDraftToBasics } from '@/lib/onboardingDraftMap';
import { computeCompleteness } from '@/lib/brainCompleteness';
import { recommendWorkflows } from '@/lib/workflows/recommend';
import { WORKFLOWS } from '@/lib/workflows/registry';
import { pilotChat } from '@/lib/pilotChat';
import BrainOrb from '@/components/onboarding/BrainOrb';

// ---------- helpers ----------
async function call(action: string, workspace_id: string, payload: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke('setup-company-brain', {
    body: { action, workspace_id, ...payload },
  });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data;
}

const AGENTS = [
  { slug: 'pilot',  name: 'Pilot' },
  { slug: 'scout',  name: 'Scout' },
  { slug: 'hawk',   name: 'Hawk' },
  { slug: 'aria',   name: 'Aria' },
  { slug: 'penn',   name: 'Penn' },
  { slug: 'scribe', name: 'Scribe' },
];

type AnalysisPhase = { agent: string; label: string; status: 'ok' | 'skipped' | 'failed' | 'running' };
const DEFAULT_PHASES: AnalysisPhase[] = [
  { agent: 'hawk',  label: 'Hawk is reading your website',          status: 'running' },
  { agent: 'pilot', label: 'Pilot is mapping your business model',  status: 'running' },
];

const TONE_CHIPS = [...BRAND_VOICE_TAGS, 'concise', 'bold'] as const;

const FIRST_HELP_LABEL: Record<string, string> = {
  find_leads: 'Find leads',
  research_companies: 'Research companies',
  draft_outreach: 'Draft outreach',
  create_content: 'Create content',
  audit_website: 'Audit a website',
  track_competitors: 'Track competitors',
  organize_founder_ops: 'Organize founder ops',
  not_sure: "I'm not sure yet",
};

// ---------- step model (12 steps) ----------
type StepId =
  | 'welcome'
  | 'founder'
  | 'company'
  | 'analyzing'
  | 'icp'
  | 'gtm'
  | 'positioning'
  | 'voice'
  | 'workflow_prefs'
  | 'integrations'
  | 'approval'
  | 'review';

interface StepDef { id: StepId; label: string; icon: any; skippable?: boolean }

const STEPS: StepDef[] = [
  { id: 'welcome',        label: 'Welcome',         icon: Sparkles },
  { id: 'founder',        label: 'Founder',         icon: User },
  { id: 'company',        label: 'Company',         icon: Building2 },
  { id: 'analyzing',      label: 'AI analysis',     icon: Loader2 },
  { id: 'icp',            label: 'ICP',             icon: Target },
  { id: 'gtm',            label: 'GTM',             icon: Compass, skippable: true },
  { id: 'positioning',    label: 'Positioning',     icon: Eye,     skippable: true },
  { id: 'voice',          label: 'Voice',           icon: Megaphone, skippable: true },
  { id: 'workflow_prefs', label: 'Workflows',       icon: Workflow, skippable: true },
  { id: 'integrations',   label: 'Integrations',    icon: Plug,    skippable: true },
  { id: 'approval',       label: 'Safety',          icon: Lock },
  { id: 'review',         label: 'Review',          icon: Rocket },
];

const stepIdOf = (id: StepId) => STEPS.findIndex((s) => s.id === id);

// ---------- chrome ----------
function BackgroundGrid() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(16,185,129,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.08) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at top, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at top, black 30%, transparent 75%)',
        }}
      />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[420px] w-[820px] rounded-full bg-primary/15 blur-3xl" />
    </div>
  );
}

function AgentChipsRow({ activeCount = 0, pulse = false }: { activeCount?: number; pulse?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {AGENTS.map((a, i) => {
        const on = i < activeCount;
        return (
          <span
            key={a.slug}
            className={
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border transition-colors ' +
              (on
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border/60 bg-card/40 text-muted-foreground')
            }
          >
            <span className={'h-1.5 w-1.5 rounded-full ' + (on ? `bg-primary ${pulse ? 'animate-pulse' : ''}` : 'bg-muted-foreground/40')} />
            {a.name}
          </span>
        );
      })}
    </div>
  );
}

function ProgressRail({ currentIndex }: { currentIndex: number }) {
  const pct = Math.round(((currentIndex + 1) / STEPS.length) * 100);
  return (
    <div className="space-y-3">
      <div className="hidden md:flex items-stretch gap-1.5">
        {STEPS.map((s, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <div
              key={s.id}
              className="group relative flex-1 flex flex-col items-center"
              title={`${i + 1}. ${s.label}`}
            >
              <div
                className={
                  'h-1.5 w-full rounded-full transition-all duration-500 ' +
                  (done
                    ? 'bg-primary shadow-[0_0_10px_rgba(16,185,129,0.55)]'
                    : active
                    ? 'bg-gradient-to-r from-primary to-primary/40 shadow-[0_0_14px_rgba(16,185,129,0.65)]'
                    : 'bg-border/40')
                }
              >
                {active && (
                  <div className="h-full w-full rounded-full bg-primary/60 animate-pulse" />
                )}
              </div>
              <span
                className={
                  'mt-2 text-[10px] tracking-[0.14em] uppercase truncate transition-colors ' +
                  (done || active ? 'text-foreground/80' : 'text-muted-foreground/60')
                }
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="md:hidden flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          Step {currentIndex + 1} of {STEPS.length} — <span className="text-foreground">{STEPS[currentIndex].label}</span>
        </span>
        <span className="text-primary font-medium">{pct}%</span>
      </div>
      <div className="md:hidden h-1 w-full rounded-full bg-border/40 overflow-hidden">
        <div
          className="h-full bg-primary shadow-[0_0_12px_rgba(16,185,129,0.5)] transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StepShell({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={
        'rounded-2xl border border-border/60 bg-card/70 backdrop-blur-xl ' +
        'shadow-[0_30px_80px_-40px_rgba(16,185,129,0.25)] ' + className
      }
    >
      {children}
    </div>
  );
}

function ChipInput({
  value, onChange, placeholder,
}: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState('');
  function commit(v?: string) {
    const raw = (v ?? text).trim().replace(/,$/, '');
    if (!raw) return;
    if (!value.includes(raw)) onChange([...value, raw]);
    setText('');
  }
  return (
    <div className="rounded-md border border-input bg-background px-2 py-1.5 flex flex-wrap gap-1.5 focus-within:border-emerald-500 focus-within:shadow-[0_0_0_4px_rgba(16,185,129,0.08)] transition-all">
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/30 text-primary px-2 py-0.5 text-xs">
          {v}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="hover:text-foreground">×</button>
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(',')) commit(v.slice(0, -1));
          else setText(v);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        onBlur={() => commit()}
        placeholder={value.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[140px] bg-transparent text-sm outline-none placeholder:text-muted-foreground py-1"
      />
    </div>
  );
}

function Field({ label, hint, className = '', children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="text-[11px] text-muted-foreground/70 mt-1">{hint}</p>}
    </div>
  );
}

function StepHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-8">
      <div className="text-[12px] font-semibold tracking-[0.22em] text-emerald-400 uppercase mb-3">{eyebrow}</div>
      <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-tight text-foreground leading-[1.08]">{title}</h2>
      {subtitle && <p className="text-[17px] text-muted-foreground mt-3 max-w-2xl leading-[1.55]">{subtitle}</p>}
    </div>
  );
}

function ChoiceChips<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={'text-xs rounded-full border px-3 py-1.5 transition-all ' + (active
              ? 'border-primary bg-primary/10 text-primary shadow-[0_0_0_1px_rgba(16,185,129,0.3)]'
              : 'border-border text-muted-foreground hover:text-foreground')}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ---------- main ----------
export default function OnboardingCompanyBrain() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const restart = searchParams.get('restart') === '1';
  const { workspaceId, loading: wsLoading } = useWorkspace();
  const { data: brain, refresh } = useCompanyBrain();
  const readiness = useIntegrationReadiness();

  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [basics, setBasics] = useState({
    company_name: '',
    website_url: '',
    linkedin_company_url: '',
    founder_linkedin_url: '',
    short_description: '',
    category: '',
  });
  const [structured, setStructured] = useState<StructuredBrain>(getBrainDefaults());
  const [analysisPhases, setAnalysisPhases] = useState<AnalysisPhase[]>(DEFAULT_PHASES);
  const [mappedSummary, setMappedSummary] = useState<string[]>([]);
  const [launchVisible, setLaunchVisible] = useState(false);

  const step = STEPS[stepIndex].id;

  // Hydrate from existing brain
  useEffect(() => {
    if (!brain?.profile || hydrated) return;
    const p = brain.profile as Record<string, any>;
    const hasAny =
      p.company_name || p.website_url || p.short_description ||
      (p.icp && Object.values(p.icp).some(Boolean)) ||
      brain.onboarding_completed;
    setBasics((b) => ({
      ...b,
      company_name: p.company_name ?? p.company?.name ?? b.company_name,
      website_url: p.website_url ?? p.company?.website_url ?? b.website_url,
      linkedin_company_url: p.linkedin_company_url ?? p.company?.linkedin_url ?? b.linkedin_company_url,
      founder_linkedin_url: p.founder_linkedin_url ?? p.founder?.linkedin_url ?? b.founder_linkedin_url,
      short_description: p.short_description ?? p.company?.description ?? p.company_summary ?? b.short_description,
      category: p.category ?? p.company?.category ?? b.category,
    }));
    const defaults = getBrainDefaults();
    setStructured({
      ...defaults,
      founder:        { ...defaults.founder,        ...(p.founder ?? {}) },
      company:        { ...defaults.company,        ...(p.company ?? {}) },
      icp:            { ...defaults.icp,            ...(p.icp ?? {}) },
      goals:          { ...defaults.goals,          ...(p.goals ?? {}) },
      gtm:            { ...defaults.gtm,            ...(p.gtm ?? {}) },
      positioning:    { ...defaults.positioning,    ...(p.positioning ?? {}) },
      brand_voice:    { ...defaults.brand_voice,    ...(p.brand_voice ?? {}) },
      competitors:    { ...defaults.competitors,    ...(p.competitors ?? {}) },
      approval_rules: { ...defaults.approval_rules, ...(p.approval_rules ?? {}) },
      workflow_preferences: { ...defaults.workflow_preferences, ...(p.workflow_preferences ?? {}) },
      integration_status:   { ...defaults.integration_status, ...(p.integration_status ?? {}) },
      onboarding_meta:      { ...defaults.onboarding_meta,    ...(p.onboarding_meta ?? {}) },
    });
    const resumeStep = (p.onboarding_meta?.current_step as StepId | undefined);
    if (hasAny && !restart && brain.onboarding_completed) setStepIndex(stepIdOf('review'));
    else if (resumeStep && !restart && stepIdOf(resumeStep) > 0) setStepIndex(stepIdOf(resumeStep));
    setHydrated(true);
  }, [brain, hydrated, restart]);

  // Reset analyzer phases when entering analyzing step (actual statuses come from server)
  useEffect(() => {
    if (step === 'analyzing') setAnalysisPhases(DEFAULT_PHASES);
  }, [step]);


  const recommendedWorkflows = useMemo(
    () => recommendWorkflows({
      founder: structured.founder, gtm: structured.gtm,
      workflow_preferences: structured.workflow_preferences,
    }, WORKFLOWS, 6),
    [structured.founder, structured.gtm, structured.workflow_preferences],
  );

  const completeness = useMemo(
    () => computeCompleteness({ ...basics, ...structured } as any),
    [basics, structured]
  );

  if (wsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!workspaceId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground bg-background">
        No workspace available.
      </div>
    );
  }

  // ---------- actions ----------
  function goto(id: StepId) { setStepIndex(stepIdOf(id)); }

  async function persistStep(nextId: StepId) {
    // Persist current step group + onboarding_meta, then advance.
    const meta = {
      current_step: nextId,
      completed_steps: Array.from(new Set([...(structured.onboarding_meta.completed_steps ?? []), step])),
      updated_at: new Date().toISOString(),
    };
    setStructured((s) => ({ ...s, onboarding_meta: meta }));
    try {
      // Always persist any basics/structured group changes; server merges.
      if (step === 'company' || step === 'welcome') {
        await call('save_basics', workspaceId!, {
          company_name: basics.company_name,
          website_url: basics.website_url,
          linkedin_company_url: basics.linkedin_company_url,
          founder_linkedin_url: basics.founder_linkedin_url,
          short_description: basics.short_description,
        });
      }
      await call('save_structured', workspaceId!, {
        founder: structured.founder,
        company: { ...structured.company, name: basics.company_name, website_url: basics.website_url, linkedin_url: basics.linkedin_company_url, description: basics.short_description, category: basics.category },
        icp: structured.icp,
        gtm: structured.gtm,
        positioning: structured.positioning,
        brand_voice: structured.brand_voice,
        approval_rules: structured.approval_rules,
        workflow_preferences: structured.workflow_preferences,
        onboarding_meta: meta,
      });
    } catch (e: any) {
      // Non-blocking; show toast but allow advancing
      toast.error(e?.message ?? 'Could not save step');
    }
    goto(nextId);
  }

  function back() {
    const i = Math.max(stepIndex - 1, 0);
    setStepIndex(i);
  }

  async function next() {
    const i = Math.min(stepIndex + 1, STEPS.length - 1);
    await persistStep(STEPS[i].id);
  }

  async function skip() {
    const i = Math.min(stepIndex + 1, STEPS.length - 1);
    goto(STEPS[i].id);
  }

  async function startWebsiteAnalysis() {
    if (!basics.company_name.trim()) {
      toast.error('Add your company name first.');
      return;
    }
    setSaving(true);
    goto('analyzing');
    try {
      await call('save_basics', workspaceId!, {
        company_name: basics.company_name,
        website_url: basics.website_url,
        linkedin_company_url: basics.linkedin_company_url,
        founder_linkedin_url: basics.founder_linkedin_url,
      });
      if (basics.website_url.trim()) {
        await call('save_sources', workspaceId!, {
          sources: [{ source_type: 'website', url: basics.website_url.trim() }],
        });
      }
      const res: any = await call('analyze', workspaceId!);
      const w: string[] = res?.warnings ?? [];
      setWarnings(w);
      const draft = { ...(res?.profile ?? {}), ...(res?.draft ?? {}) };
      const mappedBasics = mapDraftToBasics(draft);
      setBasics((b) => ({
        ...b,
        short_description: b.short_description || mappedBasics.short_description,
        category: b.category || mappedBasics.category,
      }));
      const mapped = mapDraftToStructured(draft);
      setStructured((s) => ({
        ...s,
        icp:            { ...mapped.icp,            ...nonEmpty(s.icp) },
        positioning:    { ...mapped.positioning,    ...nonEmpty(s.positioning) },
        brand_voice:    { ...mapped.brand_voice,    ...nonEmpty(s.brand_voice) },
        competitors:    { ...mapped.competitors,    ...nonEmpty(s.competitors) },
      }));
      await new Promise((r) => setTimeout(r, 700));
      goto('icp');
    } catch (e: any) {
      setWarnings(["We couldn't analyze the website automatically. You can still build your Company Brain manually."]);
      goto('icp');
    } finally {
      setSaving(false);
    }
  }

  async function dispatchFirstSafeWorkflow() {
    // Find a safe, ready workflow that aligns with the user's selections.
    const priorityIds = structured.workflow_preferences.priority_workflows;
    const candidates = priorityIds
      .map((id) => WORKFLOWS.find((w) => w.id === id))
      .filter(Boolean) as typeof WORKFLOWS;
    const pool = candidates.length > 0
      ? candidates
      : recommendedWorkflows.map((r) => r.workflow);
    const chosen = pool.find((w) => w.status === 'ready') ?? pool[0];
    if (!chosen) return;

    // Build inputs from field defaults, force count=5 and safety flags.
    const values: Record<string, string | number | string[]> = {};
    for (const f of chosen.fields) {
      if (f.id === 'count') { values.count = '5'; continue; }
      if (f.defaultValue !== undefined) values[f.id] = f.defaultValue as any;
    }
    const prompt = chosen.buildPrompt(values);
    const baseMeta = chosen.buildMetadata?.(values) ?? { workflow_id: chosen.id, workflow_inputs: values };
    const metadata = { ...baseMeta, draft_only: true, first_run: true, workflow_title: chosen.title, agents_used: chosen.agents };

    try {
      await pilotChat({
        message: prompt,
        workspace_id: workspaceId!,
        action_source: 'onboarding_first_run',
        metadata,
      });
      toast.success('Your first workflow is drafting 5 results.', { description: 'Nothing will be sent.' });
    } catch {
      // Non-blocking; user still lands on dashboard.
    }
  }

  async function activateBrain() {
    setSaving(true);
    try {
      const firstHelp = structured.founder.first_help_goal || 'not_sure';
      await call('save_basics', workspaceId!, {
        company_name: basics.company_name,
        website_url: basics.website_url,
        linkedin_company_url: basics.linkedin_company_url,
        founder_linkedin_url: basics.founder_linkedin_url,
        short_description: basics.short_description,
        category: basics.category,
        current_primary_goal: firstHelp,
      });
      await call('save_structured', workspaceId!, {
        founder: structured.founder,
        company: { ...structured.company, name: basics.company_name, website_url: basics.website_url, linkedin_url: basics.linkedin_company_url, description: basics.short_description, category: basics.category },
        icp: structured.icp,
        gtm: structured.gtm,
        positioning: structured.positioning,
        brand_voice: structured.brand_voice,
        approval_rules: structured.approval_rules,
        workflow_preferences: structured.workflow_preferences,
        onboarding_meta: {
          ...structured.onboarding_meta,
          current_step: 'review',
          completed_steps: STEPS.map((s) => s.id),
          updated_at: new Date().toISOString(),
        },
      });
      await call('finalize', workspaceId!, { current_primary_goal: firstHelp });
      refresh();

      // Fire-and-await the first safe workflow (drafts only, count=5).
      await dispatchFirstSafeWorkflow();

      navigate('/dashboard', { state: { firstRun: true }, replace: true });
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to activate');
    } finally {
      setSaving(false);
    }
  }

  // ---------- renderers ----------
  function renderWelcome() {
    return (
      <Card className="p-8 sm:p-10">
        <div className="max-w-2xl">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Teach Agentory your business.</h1>
          <p className="text-muted-foreground mt-3 text-[15px] leading-relaxed">
            Your AI workforce uses this Company Brain to find signals, write content, and draft outreach.
            Nothing is sent without your approval.
          </p>
        </div>
        <div className="mt-8 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            <ShieldCheck className="inline h-3.5 w-3.5 mr-1 text-primary" />
            12 short steps. Draft-only by default. ~3 minutes.
          </div>
          <AgentChipsRow activeCount={0} />
        </div>
        <div className="mt-8 flex justify-end">
          <Button size="lg" onClick={() => persistStep('founder')} className="h-12 px-6 text-base">
            Begin <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        </div>
      </Card>
    );
  }

  function renderFounder() {
    return (
      <Card className="p-6 sm:p-8">
        <StepHeader eyebrow="Founder" title="Who's driving this?" subtitle="Pilot uses this to address you correctly and to choose the right agents." />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Your name">
            <Input value={structured.founder.name} onChange={(e) => setStructured({ ...structured, founder: { ...structured.founder, name: e.target.value } })} placeholder="Alex Founder" />
          </Field>
          <Field label="Your role">
            <Input value={structured.founder.role} onChange={(e) => setStructured({ ...structured, founder: { ...structured.founder, role: e.target.value } })} placeholder="Founder / CEO" />
          </Field>
          <Field label="LinkedIn profile">
            <Input value={structured.founder.linkedin_url} onChange={(e) => setStructured({ ...structured, founder: { ...structured.founder, linkedin_url: e.target.value } })} placeholder="https://linkedin.com/in/…" />
          </Field>
          <Field label="Timezone">
            <Input value={structured.founder.timezone} onChange={(e) => setStructured({ ...structured, founder: { ...structured.founder, timezone: e.target.value } })} placeholder="Europe/Amsterdam" />
          </Field>
          <Field label="What should Agentory help with first?" className="sm:col-span-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {FIRST_HELP_GOALS.map((g) => {
                const active = structured.founder.first_help_goal === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setStructured({ ...structured, founder: { ...structured.founder, first_help_goal: g } })}
                    className={'text-left rounded-md border px-2.5 py-2 text-xs transition-all ' + (active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/60 bg-card/40 text-muted-foreground hover:text-foreground')}
                  >
                    {FIRST_HELP_LABEL[g] ?? g}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      </Card>
    );
  }

  function renderCompany() {
    return (
      <Card className="p-6 sm:p-8">
        <StepHeader eyebrow="Company" title="Tell us about your company." subtitle="One quick pass. Your website lets us pre-fill the rest." />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Company name"><Input value={basics.company_name} onChange={(e) => setBasics({ ...basics, company_name: e.target.value })} /></Field>
          <Field label="Website">
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input className="pl-9" placeholder="https://…" value={basics.website_url} onChange={(e) => setBasics({ ...basics, website_url: e.target.value })} />
            </div>
          </Field>
          <Field label="LinkedIn company"><Input placeholder="https://linkedin.com/company/…" value={basics.linkedin_company_url} onChange={(e) => setBasics({ ...basics, linkedin_company_url: e.target.value })} /></Field>
          <Field label="Product category"><Input placeholder="e.g. AI workforce OS" value={basics.category} onChange={(e) => setBasics({ ...basics, category: e.target.value })} /></Field>
          <Field label="Stage" className="">
            <ChoiceChips value={structured.company.stage as any} options={COMPANY_STAGES} onChange={(v) => setStructured({ ...structured, company: { ...structured.company, stage: v } })} />
          </Field>
          <Field label="Team size">
            <ChoiceChips value={structured.company.team_size as any} options={TEAM_SIZES} onChange={(v) => setStructured({ ...structured, company: { ...structured.company, team_size: v } })} />
          </Field>
          <Field label="Location"><Input placeholder="Amsterdam, NL" value={structured.company.location} onChange={(e) => setStructured({ ...structured, company: { ...structured.company, location: e.target.value } })} /></Field>
          <Field label="One-line description" className="sm:col-span-2">
            <Textarea rows={2} placeholder="What does your company do, in one sentence?" value={basics.short_description} onChange={(e) => setBasics({ ...basics, short_description: e.target.value })} />
          </Field>
        </div>
        <div className="mt-6 flex justify-end">
          <Button size="lg" onClick={startWebsiteAnalysis} disabled={saving || !basics.company_name.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (<>Analyze with Hawk + Pilot <ArrowRight className="h-4 w-4 ml-1.5" /></>)}
          </Button>
        </div>
      </Card>
    );
  }

  function renderAnalyzing() {
    return (
      <Card className="p-8 sm:p-10">
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-primary animate-pulse" />
            </div>
            <div className="absolute -inset-2 rounded-3xl bg-primary/10 blur-2xl -z-10" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Hawk and Pilot are studying your business.</h2>
            <p className="text-sm text-muted-foreground mt-1">Usually ~10 seconds. Keep this tab open.</p>
          </div>
        </div>
        <div className="mt-8 space-y-2">
          {ANALYSIS_STEPS.map((label, i) => {
            const done = i < analysisIdx;
            const active = i === analysisIdx;
            return (
              <div
                key={label}
                className={
                  'flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-all ' +
                  (done
                    ? 'border-primary/30 bg-primary/[0.06] text-foreground'
                    : active
                    ? 'border-primary/40 bg-primary/[0.08] text-foreground'
                    : 'border-border/60 bg-card/40 text-muted-foreground')
                }
              >
                {done ? <CheckCircle2 className="h-4 w-4 text-primary" />
                  : active ? <Loader2 className="h-4 w-4 text-primary animate-spin" />
                  : <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />}
                <span className="text-sm">{label}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-8"><AgentChipsRow activeCount={2} pulse /></div>
      </Card>
    );
  }

  function renderIcp() {
    return (
      <Card className="p-6 sm:p-8">
        <StepHeader eyebrow="ICP" title="Who do you sell to?" subtitle="Use commas or Enter to add chips. Skip what you're unsure about." />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Buyer roles" hint="e.g. Founder, Head of Growth, RevOps">
            <ChipInput value={structured.icp.buyer_roles} placeholder="Founder, Head of Growth…" onChange={(v) => setStructured({ ...structured, icp: { ...structured.icp, buyer_roles: v } })} />
          </Field>
          <Field label="Company size"><Input placeholder="e.g. 10–200" value={structured.icp.company_size} onChange={(e) => setStructured({ ...structured, icp: { ...structured.icp, company_size: e.target.value } })} /></Field>
          <Field label="Industries">
            <ChipInput value={structured.icp.industries} placeholder="B2B SaaS, AI tools…" onChange={(v) => setStructured({ ...structured, icp: { ...structured.icp, industries: v } })} />
          </Field>
          <Field label="Geography"><Input placeholder="US + EU" value={structured.icp.geography} onChange={(e) => setStructured({ ...structured, icp: { ...structured.icp, geography: e.target.value } })} /></Field>
          <Field label="Pain points" className="sm:col-span-2" hint="What problem are buyers trying to solve?">
            <ChipInput value={structured.icp.pain_points} placeholder="Slow outbound, missed signals…" onChange={(v) => setStructured({ ...structured, icp: { ...structured.icp, pain_points: v } })} />
          </Field>
          <Field label="Disqualifiers" className="sm:col-span-2" hint="Who should we never target? (e.g. agencies, sub-1M revenue)">
            <ChipInput value={structured.icp.disqualifiers} placeholder="Agencies, sub-1M revenue…" onChange={(v) => setStructured({ ...structured, icp: { ...structured.icp, disqualifiers: v } })} />
          </Field>
        </div>
      </Card>
    );
  }

  function renderGtm() {
    return (
      <Card className="p-6 sm:p-8">
        <StepHeader eyebrow="GTM" title="How do you go to market?" subtitle="Determines which agents Pilot leans on and which workflows we recommend." />
        <div className="grid gap-4">
          <Field label="Primary motion">
            <ChoiceChips value={structured.gtm.motion as any} options={GTM_MOTIONS} onChange={(v) => setStructured({ ...structured, gtm: { ...structured.gtm, motion: v } })} />
          </Field>
          <Field label="Primary channel">
            <ChoiceChips value={structured.gtm.primary_channel as any} options={PRIMARY_CHANNELS} onChange={(v) => setStructured({ ...structured, gtm: { ...structured.gtm, primary_channel: v } })} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Biggest bottleneck right now">
              <Textarea rows={2} placeholder="e.g. Can't find enough qualified leads" value={structured.gtm.biggest_bottleneck} onChange={(e) => setStructured({ ...structured, gtm: { ...structured.gtm, biggest_bottleneck: e.target.value } })} />
            </Field>
            <Field label="30-day goal">
              <Textarea rows={2} placeholder="e.g. Book 10 qualified demos" value={structured.gtm.thirty_day_goal} onChange={(e) => setStructured({ ...structured, gtm: { ...structured.gtm, thirty_day_goal: e.target.value } })} />
            </Field>
            <Field label="Current tools" hint="The stack you already use">
              <ChipInput value={structured.gtm.current_tools} placeholder="HubSpot, Apollo…" onChange={(v) => setStructured({ ...structured, gtm: { ...structured.gtm, current_tools: v } })} />
            </Field>
            <Field label="Other channels you use">
              <ChipInput value={structured.gtm.preferred_channels} placeholder="webinars, podcast…" onChange={(v) => setStructured({ ...structured, gtm: { ...structured.gtm, preferred_channels: v } })} />
            </Field>
          </div>
        </div>
      </Card>
    );
  }

  function renderPositioning() {
    return (
      <Card className="p-6 sm:p-8">
        <StepHeader eyebrow="Positioning" title="What's your edge?" subtitle="Used by Scribe and Penn when writing anything. Be specific." />
        <div className="grid gap-4">
          <Field label="Core promise" hint="One sentence — what you do for the customer">
            <Input value={structured.positioning.promise} onChange={(e) => setStructured({ ...structured, positioning: { ...structured.positioning, promise: e.target.value } })} placeholder="We turn signals into ready-to-send outreach." />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Differentiators"><ChipInput value={structured.positioning.differentiators} placeholder="Founder-led, no agency markup…" onChange={(v) => setStructured({ ...structured, positioning: { ...structured.positioning, differentiators: v } })} /></Field>
            <Field label="Top use cases"><ChipInput value={structured.positioning.use_cases} placeholder="Outbound, content, signal mining…" onChange={(v) => setStructured({ ...structured, positioning: { ...structured.positioning, use_cases: v } })} /></Field>
            <Field label="Proof points"><ChipInput value={structured.positioning.proof_points} placeholder="3x reply rate, 200 demos…" onChange={(v) => setStructured({ ...structured, positioning: { ...structured.positioning, proof_points: v } })} /></Field>
            <Field label="Offer / pricing">
              <Input value={structured.positioning.offer} onChange={(e) => setStructured({ ...structured, positioning: { ...structured.positioning, offer: e.target.value } })} placeholder="Starts at $X/mo" />
            </Field>
            <Field label="Avoid positioning as" className="sm:col-span-2" hint="Frames we should never use">
              <ChipInput value={structured.positioning.avoid_positioning} placeholder="Just another AI tool…" onChange={(v) => setStructured({ ...structured, positioning: { ...structured.positioning, avoid_positioning: v } })} />
            </Field>
          </div>
        </div>
      </Card>
    );
  }

  function renderVoice() {
    return (
      <Card className="p-6 sm:p-8">
        <StepHeader eyebrow="Brand voice" title="How should Agentory sound when it writes?" subtitle="Pick the tone chips that fit. Scribe and Penn will use this for content and outreach." />
        <Field label="Tone summary"><Input placeholder="founder-led, direct, no hype" value={structured.brand_voice.tone} onChange={(e) => setStructured({ ...structured, brand_voice: { ...structured.brand_voice, tone: e.target.value } })} /></Field>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {TONE_CHIPS.map((tag) => {
            const active = structured.brand_voice.tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setStructured({ ...structured, brand_voice: { ...structured.brand_voice, tags: toggle(structured.brand_voice.tags, tag) } })}
                className={'text-xs rounded-full border px-3 py-1.5 transition-all ' + (active ? 'border-primary bg-primary/10 text-primary shadow-[0_0_0_1px_rgba(16,185,129,0.3)]' : 'border-border text-muted-foreground hover:text-foreground hover:border-border/80')}
              >
                {tag}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
          <Field label="Style rules (one per line)">
            <Textarea rows={3} placeholder="Short sentences&#10;No corporate speak" value={structured.brand_voice.style_rules.join('\n')} onChange={(e) => setStructured({ ...structured, brand_voice: { ...structured.brand_voice, style_rules: parseLines(e.target.value) } })} />
          </Field>
          <Field label="Things to avoid (one per line)">
            <Textarea rows={3} placeholder="Hype words&#10;Emojis" value={structured.brand_voice.avoid.join('\n')} onChange={(e) => setStructured({ ...structured, brand_voice: { ...structured.brand_voice, avoid: parseLines(e.target.value) } })} />
          </Field>
          <Field label="Example message that sounds like you" className="sm:col-span-2">
            <Textarea rows={3} placeholder="Paste a recent post or email so Scribe learns your rhythm." value={structured.brand_voice.example_message} onChange={(e) => setStructured({ ...structured, brand_voice: { ...structured.brand_voice, example_message: e.target.value } })} />
          </Field>
        </div>
      </Card>
    );
  }

  function renderWorkflowPrefs() {
    const selected = new Set(structured.workflow_preferences.priority_workflows);
    const list = recommendedWorkflows.length > 0
      ? recommendedWorkflows.map((r) => ({ w: r.workflow, reason: r.reasons[0] }))
      : WORKFLOWS.filter((w) => w.recommended).slice(0, 6).map((w) => ({ w, reason: undefined as string | undefined }));
    return (
      <Card className="p-6 sm:p-8">
        <StepHeader eyebrow="Workflows" title="Pick 1–3 to run first." subtitle="We'll prioritize these on your dashboard. You can run any workflow later." />
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map(({ w, reason }) => {
            const active = selected.has(w.id);
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  const next = new Set(selected);
                  if (next.has(w.id)) next.delete(w.id); else next.add(w.id);
                  setStructured({ ...structured, workflow_preferences: { priority_workflows: Array.from(next) } });
                }}
                className={'text-left rounded-2xl border p-4 transition-all ' + (active
                  ? 'border-primary bg-primary/[0.07] shadow-[0_0_0_1px_rgba(16,185,129,0.35)]'
                  : 'border-border/60 bg-card/60 hover:border-border')}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{w.title}</div>
                    <div className="text-[12px] text-muted-foreground line-clamp-2 mt-0.5">{w.description}</div>
                  </div>
                  {active ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0" /> : <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{w.primaryAgent}</span>}
                </div>
                {reason && <div className="text-[11px] text-emerald-300/80 mt-2">{reason}</div>}
              </button>
            );
          })}
        </div>
      </Card>
    );
  }

  function renderIntegrations() {
    const entries = Object.entries(readiness.providers);
    return (
      <Card className="p-6 sm:p-8">
        <StepHeader eyebrow="Integrations" title="Check what's ready." subtitle="Agentory will use these capabilities to find leads, research, and draft outreach. Setup needed items don't block onboarding." />
        <div className="space-y-2">
          {entries.length === 0 && (
            <div className="text-sm text-muted-foreground">Checking capabilities…</div>
          )}
          {entries.map(([key, p]) => {
            const color = p.status === 'connected' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/[0.06]'
              : p.status === 'setup_needed' ? 'text-amber-300 border-amber-500/30 bg-amber-500/[0.06]'
              : 'text-muted-foreground border-border/60 bg-card/40';
            return (
              <div key={key} className={'flex items-start gap-3 rounded-xl border p-3.5 ' + color}>
                <div className="mt-0.5">
                  {p.status === 'connected' ? <CheckCircle2 className="h-4 w-4" />
                    : p.status === 'setup_needed' ? <AlertTriangle className="h-4 w-4" />
                    : <Plug className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{p.label}</div>
                  <div className="text-[12px] text-muted-foreground mt-0.5">
                    {p.status === 'connected' ? 'Connected and ready.' : p.reason ?? 'Optional.'}
                  </div>
                </div>
                <span className="text-[10px] uppercase tracking-wider opacity-80 shrink-0">{p.status.replace('_', ' ')}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => readiness.refresh()} disabled={readiness.loading}>
            {readiness.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Recheck
          </Button>
          <div className="text-[11px] text-muted-foreground">
            {readiness.summary.connected} connected · {readiness.summary.setup_needed} setup needed
          </div>
        </div>
      </Card>
    );
  }

  function renderApproval() {
    const items: Array<[keyof StructuredBrain['approval_rules'], string, string]> = [
      ['draft_only',               'Draft-only by default',           'Agents prepare work but never publish or send.'],
      ['email_requires_approval',  'Email requires my approval',      'No email goes out until you review it.'],
      ['linkedin_manual_only',     'LinkedIn comments & DMs are manual', 'You stay in control of every LinkedIn touch.'],
    ];
    return (
      <Card className="p-6 sm:p-8">
        <StepHeader eyebrow="Approval & safety" title="Agentory prepares work. You stay in control." subtitle="These defaults keep everything human-in-the-loop." />
        <div className="space-y-3">
          {items.map(([key, label, hint]) => (
            <div key={key} className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 p-4">
              <div>
                <div className="text-sm font-medium text-foreground">{label}</div>
                <div className="text-xs text-muted-foreground">{hint}</div>
              </div>
              <Switch
                checked={!!structured.approval_rules[key as keyof typeof structured.approval_rules]}
                onCheckedChange={(v) => setStructured({ ...structured, approval_rules: { ...structured.approval_rules, [key]: v } })}
              />
            </div>
          ))}
          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 p-4">
            <div>
              <div className="text-sm font-medium text-foreground">Daily credit limit</div>
              <div className="text-xs text-muted-foreground">Max credits Agentory may spend per day without asking.</div>
            </div>
            <Input
              type="number"
              className="w-28 text-right"
              value={structured.approval_rules.daily_credit_limit}
              onChange={(e) => setStructured({ ...structured, approval_rules: { ...structured.approval_rules, daily_credit_limit: Number(e.target.value) || 0 } })}
            />
          </div>
        </div>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 text-primary px-3 py-1 text-xs">
          <ShieldCheck className="h-3.5 w-3.5" /> Safe by default — nothing is sent without approval.
        </div>
      </Card>
    );
  }

  function renderReview() {
    const sections = [
      { id: 'founder' as StepId, title: 'Founder', icon: User, summary: [structured.founder.name, structured.founder.role, FIRST_HELP_LABEL[structured.founder.first_help_goal] ?? structured.founder.first_help_goal].filter(Boolean) },
      { id: 'company' as StepId, title: 'Company', icon: Building2, summary: [basics.company_name, basics.category, basics.website_url, structured.company.stage, structured.company.team_size, basics.short_description].filter(Boolean) },
      { id: 'icp' as StepId, title: 'ICP', icon: Target, summary: [
        structured.icp.buyer_roles.join(', '), structured.icp.company_size, structured.icp.industries.join(', '),
        structured.icp.geography, structured.icp.pain_points.join(' · '),
        structured.icp.disqualifiers.length ? `Avoid: ${structured.icp.disqualifiers.join(', ')}` : ''
      ].filter(Boolean) },
      { id: 'gtm' as StepId, title: 'GTM', icon: Compass, summary: [structured.gtm.motion, structured.gtm.primary_channel, structured.gtm.thirty_day_goal].filter(Boolean) },
      { id: 'positioning' as StepId, title: 'Positioning', icon: Eye, summary: [structured.positioning.promise, structured.positioning.differentiators.join(', ')].filter(Boolean) },
      { id: 'voice' as StepId, title: 'Brand voice', icon: Megaphone, summary: [structured.brand_voice.tone, structured.brand_voice.tags.join(', ')].filter(Boolean) },
      { id: 'workflow_prefs' as StepId, title: 'Priority workflows', icon: Workflow, summary: structured.workflow_preferences.priority_workflows.map((id) => WORKFLOWS.find((w) => w.id === id)?.title ?? id) },
      { id: 'integrations' as StepId, title: 'Integrations', icon: Plug, summary: [`${readiness.summary.connected} connected · ${readiness.summary.setup_needed} setup needed`] },
      { id: 'approval' as StepId, title: 'Approval rules', icon: Lock, summary: [
        structured.approval_rules.draft_only ? 'Draft-only' : null,
        structured.approval_rules.email_requires_approval ? 'Email needs approval' : null,
        structured.approval_rules.linkedin_manual_only ? 'LinkedIn manual' : null,
        `Daily limit: ${structured.approval_rules.daily_credit_limit}`,
      ].filter(Boolean) as string[] },
    ];
    return (
      <div className="space-y-5">
        {warnings.length > 0 && (
          <div className="flex gap-2 items-start rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>{warnings[0]}</div>
          </div>
        )}
        <Card className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-6 flex-col sm:flex-row">
            <div>
              <div className="text-[11px] font-semibold tracking-[0.18em] text-primary uppercase mb-2">Review</div>
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Your Company Brain</h2>
              <p className="text-sm text-muted-foreground mt-2">Tap any section to expand and edit. When you activate, we'll draft your first workflow safely (5 items, nothing sent).</p>
            </div>
            <CompletenessRing percent={completeness.percent} missing={completeness.missing} />
          </div>
        </Card>

        <div className="grid gap-3">
          {sections.map((s) => {
            const Icon = s.icon;
            return (
              <Collapsible key={s.id} defaultOpen={false}>
                <div className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xl overflow-hidden">
                  <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-card/80 transition-colors group">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary shrink-0">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="text-left min-w-0">
                        <div className="text-sm font-semibold text-foreground">{s.title}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {s.summary.length ? s.summary.slice(0, 2).join(' · ') : 'Not set'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); goto(s.id); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); goto(s.id); } }}
                        className="text-xs text-primary hover:underline px-2 py-1 cursor-pointer"
                      >
                        Edit
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground group-data-[state=open]:rotate-180 transition-transform" />
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground space-y-1.5 border-t border-border/40">
                      {s.summary.length === 0 && <div className="text-muted-foreground/70 italic">Nothing set yet.</div>}
                      {s.summary.map((line, i) => (
                        <div key={i} className="flex gap-2"><ChevronRight className="h-3.5 w-3.5 mt-0.5 text-primary/60 shrink-0" /><span>{line}</span></div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button onClick={activateBrain} disabled={saving} size="lg" className="h-12 px-6">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (<>Activate & run first workflow <ArrowRight className="h-4 w-4 ml-1.5" /></>)}
          </Button>
          <Button variant="outline" size="lg" onClick={() => goto('founder')}>Edit details</Button>
          <Button
            variant="ghost"
            size="lg"
            onClick={() => { goto('welcome'); navigate('/onboarding/company-brain?restart=1', { replace: true }); }}
            className="text-muted-foreground hover:text-foreground sm:ml-auto"
          >
            Start from beginning
          </Button>
        </div>
      </div>
    );
  }

  // ---------- footer nav ----------
  function renderFooter() {
    if (step === 'welcome' || step === 'analyzing' || step === 'company' || step === 'review') return null;
    const stepDef = STEPS[stepIndex];
    const canContinue = true;
    return (
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={back}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex items-center gap-2">
          {stepDef.skippable && (
            <Button variant="ghost" onClick={skip} className="text-muted-foreground">Skip</Button>
          )}
          <Button onClick={next} disabled={!canContinue || saving} size="lg">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (<>Continue <ArrowRight className="h-4 w-4 ml-1.5" /></>)}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full text-foreground py-8 sm:py-10 px-4">
      <BackgroundGrid />
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-[11px] font-semibold tracking-[0.18em] text-primary uppercase">
              Company Brain Setup
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden md:inline text-xs text-muted-foreground">
              Step {stepIndex + 1} of {STEPS.length} — {STEPS[stepIndex].label}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/dashboard')}
              className="h-9 gap-1.5 border-border/60 bg-card/40 hover:border-primary/40 hover:bg-primary/10"
              aria-label="Exit"
              title="Exit"
            >
              <X className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Exit</span>
            </Button>
          </div>
        </div>
        <div className="mb-8"><ProgressRail currentIndex={stepIndex} /></div>

        <AnimatePresence mode="wait">
          <StepShell key={step}>
            {step === 'welcome'         && renderWelcome()}
            {step === 'founder'         && renderFounder()}
            {step === 'company'         && renderCompany()}
            {step === 'analyzing'       && renderAnalyzing()}
            {step === 'icp'             && renderIcp()}
            {step === 'gtm'             && renderGtm()}
            {step === 'positioning'     && renderPositioning()}
            {step === 'voice'           && renderVoice()}
            {step === 'workflow_prefs'  && renderWorkflowPrefs()}
            {step === 'integrations'    && renderIntegrations()}
            {step === 'approval'        && renderApproval()}
            {step === 'review'          && renderReview()}
          </StepShell>
        </AnimatePresence>

        <div className="mt-6">{renderFooter()}</div>
      </div>
    </div>
  );
}

// ---------- small helpers ----------
function CompletenessRing({ percent, missing }: { percent: number; missing: string[] }) {
  const r = 26, c = 2 * Math.PI * r, off = c - (percent / 100) * c;
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-16 w-16">
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
          <circle cx="32" cy="32" r={r} stroke="currentColor" strokeWidth="5" className="text-border/60" fill="none" />
          <circle cx="32" cy="32" r={r} stroke="currentColor" strokeWidth="5" className="text-primary transition-all duration-500" fill="none"
            strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-foreground">{percent}%</div>
      </div>
      <div className="text-xs">
        <div className="text-foreground font-medium">Company Brain {percent}% ready</div>
        {missing.length > 0 ? (
          <div className="text-muted-foreground mt-0.5 max-w-[220px]">Missing: {missing.slice(0, 3).join(', ')}{missing.length > 3 ? '…' : ''}</div>
        ) : (
          <div className="text-primary mt-0.5">All set.</div>
        )}
      </div>
    </div>
  );
}

function parseLines(v: string): string[] {
  return v.split('\n').map((s) => s.trim()).filter(Boolean);
}
function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}
function nonEmpty<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as (keyof T)[]) {
    const v = obj[k];
    if (Array.isArray(v) ? v.length > 0 : v !== '' && v != null && v !== false) {
      out[k] = v;
    }
  }
  return out;
}
