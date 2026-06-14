import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import {
  ArrowRight, ArrowLeft, Loader2, Sparkles, CheckCircle2, AlertTriangle,
  Globe, ShieldCheck, Target, Users, Eye, PenLine, Mail, ListOrdered, MessageSquare,
  Building2, Compass, Megaphone, Lock, ChevronDown, ChevronRight, X,
} from 'lucide-react';
import { getBrainDefaults, BRAND_VOICE_TAGS, type StructuredBrain } from '@/lib/companyBrainSchema';
import { mapDraftToStructured, mapDraftToBasics } from '@/lib/onboardingDraftMap';
import { computeCompleteness } from '@/lib/brainCompleteness';

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

const ANALYSIS_STEPS = [
  'Hawk is reading your website',
  'Pilot is identifying your business model',
  'Scout is finding ICP and signal opportunities',
  'Scribe is extracting positioning and tone',
  'Aria is preparing prioritization rules',
  'Penn is learning outreach style',
];

const TONE_CHIPS = [...BRAND_VOICE_TAGS, 'concise', 'bold'] as const;

const FIRST_GOALS = [
  { id: 'leads',       icon: Users,        title: 'Find leads',                     agent: 'Scout',  blurb: 'Scout finds companies and people showing buying signals.',         prompt: 'Find leads showing buying signals for my ICP.',                  route: '/leads' },
  { id: 'competitors', icon: Eye,          title: 'Track competitor conversations', agent: 'Hawk',   blurb: 'Hawk surfaces competitor conversations and market signals.',       prompt: 'Find 5 fresh competitor conversations this week.',              route: '/competitors' },
  { id: 'content',     icon: PenLine,      title: 'Create founder content',          agent: 'Scribe', blurb: 'Scribe turns updates into founder-led posts.',                     prompt: 'Draft a founder LinkedIn post based on this week\'s activity.', route: '/content' },
  { id: 'outreach',    icon: Mail,         title: 'Draft outreach',                  agent: 'Penn',   blurb: 'Penn drafts approval-ready messages using your Company Brain.',    prompt: 'Draft outreach for my highest-priority saved leads.',           route: '/content' },
  { id: 'engagement',  icon: MessageSquare,title: 'LinkedIn engagement',             agent: 'Scout',  blurb: 'Find posts worth commenting on in your voice.',                    prompt: 'Find LinkedIn posts worth engaging with this week.',            route: '/signals' },
  { id: 'review',      icon: ListOrdered,  title: 'Review saved signals',            agent: 'Pilot',  blurb: 'Pilot helps you rank and review what\'s already in.',              prompt: 'Rank my saved signals by fit and urgency.',                     route: '/signals' },
] as const;

type GoalId = typeof FIRST_GOALS[number]['id'];

// ---------- step model ----------
type StepId =
  | 'welcome' | 'analyzing' | 'basics' | 'icp' | 'goals'
  | 'competitors' | 'voice' | 'approval' | 'review' | 'launch';

interface StepDef { id: StepId; label: string; icon: any }

const STEPS: StepDef[] = [
  { id: 'welcome',     label: 'Welcome',         icon: Sparkles },
  { id: 'analyzing',   label: 'AI analysis',     icon: Loader2 },
  { id: 'basics',      label: 'Company basics',  icon: Building2 },
  { id: 'icp',         label: 'ICP',             icon: Target },
  { id: 'goals',       label: 'Goals',           icon: Compass },
  { id: 'competitors', label: 'Competitors',     icon: Eye },
  { id: 'voice',       label: 'Brand voice',     icon: Megaphone },
  { id: 'approval',    label: 'Safety',          icon: Lock },
  { id: 'review',      label: 'Review',          icon: CheckCircle2 },
  { id: 'launch',      label: 'Launch',          icon: ArrowRight },
];

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
      {/* Desktop: dotted rail */}
      <div className="hidden md:flex items-center gap-1.5">
        {STEPS.map((s, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <div key={s.id} className="flex items-center gap-1.5 flex-1 last:flex-initial">
              <div
                className={
                  'h-7 w-7 shrink-0 rounded-full border flex items-center justify-center text-[10px] font-semibold transition-all ' +
                  (done
                    ? 'border-primary bg-primary/15 text-primary'
                    : active
                    ? 'border-primary bg-primary/10 text-primary shadow-[0_0_0_4px_rgba(16,185,129,0.12)]'
                    : 'border-border/60 bg-card/40 text-muted-foreground')
                }
              >
                {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className="h-px flex-1 bg-border/60 relative overflow-hidden">
                  <div
                    className={'h-full bg-primary/70 transition-all duration-500 ' + (done ? 'w-full' : 'w-0')}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Mobile: compact pill */}
      <div className="md:hidden flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          Step {currentIndex + 1} of {STEPS.length} — <span className="text-foreground">{STEPS[currentIndex].label}</span>
        </span>
        <span className="text-primary font-medium">{pct}%</span>
      </div>
      {/* Animated fill bar */}
      <div className="h-1 w-full rounded-full bg-border/40 overflow-hidden">
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
    <div className="mb-6">
      <div className="text-[11px] font-semibold tracking-[0.18em] text-primary uppercase mb-2">{eyebrow}</div>
      <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">{title}</h2>
      {subtitle && <p className="text-sm text-muted-foreground mt-2 max-w-2xl leading-relaxed">{subtitle}</p>}
    </div>
  );
}

// ---------- main ----------
export default function OnboardingCompanyBrain() {
  const navigate = useNavigate();
  const { workspaceId, loading: wsLoading } = useWorkspace();
  const { data: brain, refresh } = useCompanyBrain();

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
  const [selectedGoals, setSelectedGoals] = useState<GoalId[]>(['leads']);
  const [firstGoal, setFirstGoal] = useState<GoalId>('leads');
  const [analysisIdx, setAnalysisIdx] = useState(0);

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
      company_name: p.company_name ?? b.company_name,
      website_url: p.website_url ?? b.website_url,
      linkedin_company_url: p.linkedin_company_url ?? b.linkedin_company_url,
      founder_linkedin_url: p.founder_linkedin_url ?? b.founder_linkedin_url,
      short_description: p.short_description ?? p.company_summary ?? b.short_description,
      category: p.category ?? b.category,
    }));
    const defaults = getBrainDefaults();
    setStructured({
      icp:            { ...defaults.icp,            ...(p.icp ?? {}) },
      goals:          { ...defaults.goals,          ...(p.goals ?? {}) },
      positioning:    { ...defaults.positioning,    ...(p.positioning ?? {}) },
      brand_voice:    { ...defaults.brand_voice,    ...(p.brand_voice ?? {}) },
      competitors:    { ...defaults.competitors,    ...(p.competitors ?? {}) },
      approval_rules: { ...defaults.approval_rules, ...(p.approval_rules ?? {}) },
    });
    if (hasAny) setStepIndex(stepIdOf('review'));
    setHydrated(true);
  }, [brain, hydrated]);

  // Animate analysis labels
  useEffect(() => {
    if (step !== 'analyzing') return;
    setAnalysisIdx(0);
    const t = setInterval(() => {
      setAnalysisIdx((i) => Math.min(i + 1, ANALYSIS_STEPS.length - 1));
    }, 1100);
    return () => clearInterval(t);
  }, [step]);

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
  function next() { setStepIndex((i) => Math.min(i + 1, STEPS.length - 1)); }
  function back() { setStepIndex((i) => Math.max(i - 1, 0)); }

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
        icp:            { ...mapped.icp,            ...nonEmpty(s.icp) },
        goals:          { ...mapped.goals,          ...nonEmpty(s.goals) },
        positioning:    { ...mapped.positioning,    ...nonEmpty(s.positioning) },
        brand_voice:    { ...mapped.brand_voice,    ...nonEmpty(s.brand_voice) },
        competitors:    { ...mapped.competitors,    ...nonEmpty(s.competitors) },
        approval_rules: { ...s.approval_rules },
      }));
      await new Promise((r) => setTimeout(r, 700));
      goto('basics');
    } catch (e: any) {
      setWarnings(["We couldn't analyze the website automatically. You can still build your Company Brain manually."]);
      goto('basics');
    } finally {
      setSaving(false);
    }
  }

  async function skipToManual() {
    if (!basics.company_name.trim()) {
      toast.error('Add your company name first.');
      return;
    }
    setSaving(true);
    try {
      await call('save_basics', workspaceId!, { company_name: basics.company_name });
      goto('basics');
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function activateBrain() {
    setSaving(true);
    try {
      // Persist selected goals as short text summaries into goals.* fields.
      const goalSummary = selectedGoals.map((id) => FIRST_GOALS.find((g) => g.id === id)?.title).filter(Boolean).join(', ');
      const goalsPatch: StructuredBrain['goals'] = {
        ...structured.goals,
        gtm: structured.goals.gtm || (selectedGoals.includes('leads') ? goalSummary : structured.goals.gtm),
        content: structured.goals.content || (selectedGoals.includes('content') ? 'Founder-led content' : structured.goals.content),
        competitor_tracking: structured.goals.competitor_tracking || (selectedGoals.includes('competitors') ? 'Track competitor signals' : structured.goals.competitor_tracking),
        outreach: structured.goals.outreach || (selectedGoals.includes('outreach') ? 'Approval-first outreach' : structured.goals.outreach),
      };
      await call('save_basics', workspaceId!, {
        company_name: basics.company_name,
        website_url: basics.website_url,
        linkedin_company_url: basics.linkedin_company_url,
        founder_linkedin_url: basics.founder_linkedin_url,
        short_description: basics.short_description,
        category: basics.category,
      });
      await call('save_structured', workspaceId!, { ...structured, goals: goalsPatch });
      await call('finalize', workspaceId!, { current_primary_goal: firstGoal });
      refresh();
      setFirstGoal(selectedGoals[0] ?? 'leads');
      goto('launch');
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to activate');
    } finally {
      setSaving(false);
    }
  }

  function launchFirstWorkflow(id: GoalId) {
    const goal = FIRST_GOALS.find((g) => g.id === id) ?? FIRST_GOALS[0];
    // Prefill only — never auto-send.
    window.dispatchEvent(new CustomEvent('chat:prefill', { detail: { text: goal.prompt } }));
    navigate(goal.route);
  }

  // ---------- step renderers ----------
  function renderWelcome() {
    return (
      <Card className="p-8 sm:p-10">
        <div className="max-w-2xl">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Teach Agentory your business.</h1>
          <p className="text-muted-foreground mt-3 text-[15px] leading-relaxed">
            Your AI workforce uses this Company Brain to find signals, track competitors,
            write content, and draft outreach. Nothing is sent without your approval.
          </p>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Field label="Company name">
            <Input
              className="h-12 text-base"
              placeholder="Agentory"
              value={basics.company_name}
              onChange={(e) => setBasics({ ...basics, company_name: e.target.value })}
            />
          </Field>
          <Field label="Website URL">
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="h-12 text-base pl-9"
                placeholder="https://agentory.space"
                value={basics.website_url}
                onChange={(e) => setBasics({ ...basics, website_url: e.target.value })}
              />
            </div>
          </Field>
        </div>
        <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            <ShieldCheck className="inline h-3.5 w-3.5 mr-1 text-primary" />
            Draft-only by default. Approval required for anything sent.
          </div>
          <AgentChipsRow activeCount={0} />
        </div>
        <div className="mt-8 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          <button type="button" onClick={skipToManual} disabled={saving} className="text-sm text-muted-foreground hover:text-foreground transition-colors text-left">
            I'll describe my company manually
          </button>
          <Button size="lg" onClick={startWebsiteAnalysis} disabled={saving} className="h-12 px-6 text-base">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (<>Build Company Brain <ArrowRight className="h-4 w-4 ml-1.5" /></>)}
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
            <h2 className="text-2xl font-semibold tracking-tight">Your AI workforce is studying your business.</h2>
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
        <div className="mt-8">
          <AgentChipsRow activeCount={Math.min(analysisIdx + 1, AGENTS.length)} pulse />
        </div>
      </Card>
    );
  }

  function renderBasics() {
    return (
      <Card className="p-6 sm:p-8">
        <StepHeader eyebrow="Company basics" title="Tell us who you are." subtitle="One short focused step. We pre-filled what we could from your website." />
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Company name"><Input value={basics.company_name} onChange={(e) => setBasics({ ...basics, company_name: e.target.value })} /></Field>
            <Field label="Website"><Input placeholder="https://…" value={basics.website_url} onChange={(e) => setBasics({ ...basics, website_url: e.target.value })} /></Field>
            <Field label="LinkedIn company"><Input placeholder="https://linkedin.com/company/…" value={basics.linkedin_company_url} onChange={(e) => setBasics({ ...basics, linkedin_company_url: e.target.value })} /></Field>
            <Field label="Founder LinkedIn"><Input placeholder="https://linkedin.com/in/…" value={basics.founder_linkedin_url} onChange={(e) => setBasics({ ...basics, founder_linkedin_url: e.target.value })} /></Field>
            <Field label="Product category" className="sm:col-span-2"><Input placeholder="e.g. AI workforce OS" value={basics.category} onChange={(e) => setBasics({ ...basics, category: e.target.value })} /></Field>
            <Field label="One-line description" className="sm:col-span-2">
              <Textarea rows={2} placeholder="What does your company do, in one sentence?" value={basics.short_description} onChange={(e) => setBasics({ ...basics, short_description: e.target.value })} />
            </Field>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/40 p-4 self-start">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/80 mb-3">What your agents will remember</div>
            <ul className="space-y-2 text-[13px]">
              <Memory label="Company" value={basics.company_name} />
              <Memory label="Category" value={basics.category} />
              <Memory label="Website" value={basics.website_url} />
              <Memory label="One-liner" value={basics.short_description} />
            </ul>
          </div>
        </div>
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
        </div>
        <button
          type="button"
          onClick={() => setStructured({ ...structured, icp: { ...structured.icp, buyer_roles: structured.icp.buyer_roles.length ? structured.icp.buyer_roles : ['Founder', 'Head of Growth'], pain_points: structured.icp.pain_points.length ? structured.icp.pain_points : ['Slow manual outbound'] } })}
          className="mt-4 text-xs text-primary hover:underline"
        >
          Not sure yet — give me suggestions
        </button>
      </Card>
    );
  }

  function renderGoals() {
    return (
      <Card className="p-6 sm:p-8">
        <StepHeader eyebrow="Goals" title="What should Agentory help with first?" subtitle="Pick one or more. You can run any workflow later." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIRST_GOALS.map((g) => {
            const Icon = g.icon;
            const active = selectedGoals.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelectedGoals((s) => s.includes(g.id) ? s.filter((x) => x !== g.id) : [...s, g.id])}
                className={
                  'text-left rounded-2xl border p-5 transition-all ' +
                  (active
                    ? 'border-primary bg-primary/[0.07] shadow-[0_0_0_1px_rgba(16,185,129,0.35),0_0_30px_-10px_rgba(16,185,129,0.5)] -translate-y-[1px]'
                    : 'border-border/60 bg-card/60 hover:border-border hover:-translate-y-[1px]')
                }
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={'h-9 w-9 rounded-xl flex items-center justify-center ' + (active ? 'bg-primary/15 text-primary' : 'bg-muted/40 text-muted-foreground')}>
                    <Icon className="h-4 w-4" />
                  </div>
                  {active ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{g.agent}</span>}
                </div>
                <div className="text-base font-semibold text-foreground">{g.title}</div>
                <div className="text-[13px] text-muted-foreground mt-1 leading-snug">{g.blurb}</div>
              </button>
            );
          })}
        </div>
      </Card>
    );
  }

  function renderCompetitors() {
    return (
      <Card className="p-6 sm:p-8">
        <StepHeader eyebrow="Competitors" title="Who else are buyers comparing you to?" subtitle="Agentory uses this to find competitor mentions and conversations." />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Known competitors">
            <ChipInput value={structured.competitors.known} placeholder="Clay, Apollo…" onChange={(v) => setStructured({ ...structured, competitors: { ...structured.competitors, known: v, unknown: false } })} />
          </Field>
          <Field label="Adjacent tools" hint="Not direct competitors, but in the same workflow.">
            <ChipInput value={structured.competitors.adjacent} placeholder="HubSpot, Lemlist…" onChange={(v) => setStructured({ ...structured, competitors: { ...structured.competitors, adjacent: v } })} />
          </Field>
        </div>
        <label className="mt-5 flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 p-4 cursor-pointer hover:border-primary/40 transition-colors">
          <Switch
            checked={structured.competitors.unknown}
            onCheckedChange={(v) => setStructured({ ...structured, competitors: { ...structured.competitors, unknown: v } })}
          />
          <div>
            <div className="text-sm font-medium text-foreground">I'm not sure — help me discover them</div>
            <div className="text-xs text-muted-foreground">Hawk will surface candidates from your space.</div>
          </div>
        </label>
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
        </div>
        <div className="mt-5 rounded-xl border border-primary/20 bg-primary/[0.04] p-3 text-xs text-muted-foreground">
          Agentory will use this voice when Scribe writes content and Penn drafts outreach.
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
                checked={structured.approval_rules[key]}
                onCheckedChange={(v) => setStructured({ ...structured, approval_rules: { ...structured.approval_rules, [key]: v } })}
              />
            </div>
          ))}
        </div>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 text-primary px-3 py-1 text-xs">
          <ShieldCheck className="h-3.5 w-3.5" /> Safe by default — nothing is sent without approval.
        </div>
      </Card>
    );
  }

  function renderReview() {
    const sections = [
      { id: 'basics' as StepId, title: 'Company', icon: Building2, summary: [basics.company_name, basics.category, basics.website_url, basics.short_description].filter(Boolean) },
      { id: 'icp' as StepId, title: 'ICP', icon: Target, summary: [
        structured.icp.buyer_roles.join(', '), structured.icp.company_size, structured.icp.industries.join(', '),
        structured.icp.geography, structured.icp.pain_points.join(' · ')
      ].filter(Boolean) },
      { id: 'goals' as StepId, title: 'Goals', icon: Compass, summary: selectedGoals.map((g) => FIRST_GOALS.find((x) => x.id === g)?.title ?? '').filter(Boolean) },
      { id: 'competitors' as StepId, title: 'Competitors', icon: Eye, summary: structured.competitors.unknown ? ['Discovering competitors with Hawk'] : [structured.competitors.known.join(', '), structured.competitors.adjacent.join(', ')].filter(Boolean) },
      { id: 'voice' as StepId, title: 'Brand voice', icon: Megaphone, summary: [structured.brand_voice.tone, structured.brand_voice.tags.join(', '), structured.brand_voice.avoid.length ? `Avoid: ${structured.brand_voice.avoid.join(', ')}` : ''].filter(Boolean) },
      { id: 'approval' as StepId, title: 'Approval rules', icon: Lock, summary: [
        structured.approval_rules.draft_only ? 'Draft-only' : null,
        structured.approval_rules.email_requires_approval ? 'Email needs approval' : null,
        structured.approval_rules.linkedin_manual_only ? 'LinkedIn manual' : null,
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
              <p className="text-sm text-muted-foreground mt-2">Tap any section to expand and edit.</p>
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
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (<>Activate Company Brain <ArrowRight className="h-4 w-4 ml-1.5" /></>)}
          </Button>
          <Button variant="outline" size="lg" onClick={() => goto('basics')}>Edit details</Button>
        </div>
      </div>
    );
  }

  function renderLaunch() {
    return (
      <Card className="p-10 text-center">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8 text-primary" />
        </div>
        <h2 className="mt-6 text-3xl font-semibold tracking-tight">Your Company Brain is ready.</h2>
        <p className="text-muted-foreground mt-2 max-w-xl mx-auto">
          Your AI workforce is activated and using {basics.company_name || 'your company'} context.
          <br />Nothing is sent, posted, or DM'd without your approval.
        </p>
        <div className="mt-6 flex justify-center"><AgentChipsRow activeCount={AGENTS.length} /></div>

        <div className="mt-10 text-left">
          <div className="text-[11px] font-semibold tracking-[0.18em] text-primary uppercase mb-3 text-center">
            What should your AI workforce do first?
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl mx-auto">
            {FIRST_GOALS.map((g) => {
              const Icon = g.icon;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => launchFirstWorkflow(g.id)}
                  className="text-left rounded-2xl border border-border/60 bg-card/60 p-5 hover:border-primary hover:-translate-y-[1px] transition-all"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon className="h-4 w-4" /></div>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{g.agent}</span>
                  </div>
                  <div className="text-sm font-semibold text-foreground">{g.title}</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-snug">{g.blurb}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-8">
          <Button variant="outline" size="lg" onClick={() => navigate('/dashboard')}>Open Dashboard</Button>
        </div>
      </Card>
    );
  }

  // ---------- footer nav ----------
  function renderFooter() {
    // No footer on welcome/analyzing/launch; review has its own primary CTA.
    if (step === 'welcome' || step === 'analyzing' || step === 'launch' || step === 'review') return null;
    const canContinue = step === 'basics' ? basics.company_name.trim().length > 0 : true;
    const isLast = step === 'approval';
    return (
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={back}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex items-center gap-2">
          {(step === 'icp' || step === 'competitors' || step === 'voice') && (
            <Button variant="ghost" onClick={next} className="text-muted-foreground">Skip</Button>
          )}
          <Button onClick={isLast ? () => goto('review') : next} disabled={!canContinue} size="lg">
            {isLast ? 'Review Company Brain' : 'Continue'} <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        </div>
      </div>
    );
  }

  // ---------- shell ----------
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
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              aria-label="Close and return to Dashboard"
              title="Close and return to Dashboard"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mb-8"><ProgressRail currentIndex={stepIndex} /></div>

        <AnimatePresence mode="wait">
          <StepShell key={step}>
            {step === 'welcome'     && renderWelcome()}
            {step === 'analyzing'   && renderAnalyzing()}
            {step === 'basics'      && renderBasics()}
            {step === 'icp'         && renderIcp()}
            {step === 'goals'       && renderGoals()}
            {step === 'competitors' && renderCompetitors()}
            {step === 'voice'       && renderVoice()}
            {step === 'approval'    && renderApproval()}
            {step === 'review'      && renderReview()}
            {step === 'launch'      && renderLaunch()}
          </StepShell>
        </AnimatePresence>

        <div className="mt-6">{renderFooter()}</div>
      </div>
    </div>
  );
}

// ---------- small helpers ----------
function Memory({ label, value }: { label: string; value?: string }) {
  return (
    <li className="flex gap-2">
      <span className="text-muted-foreground/60 w-20 shrink-0 text-[11px] uppercase tracking-wider">{label}</span>
      <span className="text-foreground/90 truncate">{value || <span className="text-muted-foreground/50">—</span>}</span>
    </li>
  );
}

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

function stepIdOf(id: StepId): number {
  return STEPS.findIndex((s) => s.id === id);
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
