import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  ArrowRight, ArrowLeft, Loader2, Sparkles, CheckCircle2, AlertTriangle,
  Globe, ShieldCheck, Target, Users, Eye, PenLine, Mail, ListOrdered, MessageSquare,
} from 'lucide-react';
import { getBrainDefaults, BRAND_VOICE_TAGS, type StructuredBrain } from '@/lib/companyBrainSchema';
import { mapDraftToStructured, mapDraftToBasics } from '@/lib/onboardingDraftMap';

// ----- helpers -----
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
  'Reading website',
  'Understanding product',
  'Identifying ICP',
  'Extracting use cases',
  'Finding competitor categories',
  'Preparing Company Brain',
];

const FIRST_GOALS = [
  { id: 'leads',        icon: Users,       title: 'Find leads',                    agent: 'Scout',  blurb: 'Scout finds companies and people showing buying signals.', prompt: 'Find leads showing buying signals for my ICP.',                  route: '/leads' },
  { id: 'competitors',  icon: Eye,         title: 'Track competitor conversations', agent: 'Hawk',   blurb: 'Hawk surfaces competitor conversations and market signals.', prompt: 'Find 5 fresh competitor conversations this week.',              route: '/competitors' },
  { id: 'content',      icon: PenLine,     title: 'Create founder content',         agent: 'Scribe', blurb: 'Scribe turns updates into founder-led posts.',               prompt: 'Draft a founder LinkedIn post based on this week\'s activity.', route: '/content' },
  { id: 'outreach',     icon: Mail,        title: 'Draft outreach',                 agent: 'Penn',   blurb: 'Penn drafts approval-ready messages using your Company Brain.', prompt: 'Draft outreach for my highest-priority saved leads.',         route: '/content' },
  { id: 'engagement',   icon: MessageSquare,title: 'LinkedIn engagement',           agent: 'Scout',  blurb: 'Find posts worth commenting on in your voice.',              prompt: 'Find LinkedIn posts worth engaging with this week.',            route: '/signals' },
  { id: 'review',       icon: ListOrdered, title: 'Review saved signals',           agent: 'Pilot',  blurb: 'Pilot helps you rank and review what\'s already in.',         prompt: 'Rank my saved signals by fit and urgency.',                     route: '/signals' },
] as const;

// ----- premium chrome -----
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

function AgentChipsRow({ activeCount = 0 }: { activeCount?: number }) {
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
            <span className={'h-1.5 w-1.5 rounded-full ' + (on ? 'bg-primary animate-pulse' : 'bg-muted-foreground/40')} />
            {a.name}
          </span>
        );
      })}
    </div>
  );
}

function ProgressRail({ step }: { step: number }) {
  return (
    <div className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <div
          key={n}
          className={
            'h-1 flex-1 rounded-full transition-colors ' +
            (n <= step ? 'bg-primary shadow-[0_0_12px_rgba(16,185,129,0.55)]' : 'bg-border/60')
          }
        />
      ))}
    </div>
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

// ----- main -----
type Mode = 'website' | 'manual';

export default function OnboardingCompanyBrain() {
  const navigate = useNavigate();
  const { workspaceId, loading: wsLoading } = useWorkspace();
  const { data: brain, refresh } = useCompanyBrain();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [mode, setMode] = useState<Mode>('website');
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [basics, setBasics] = useState({
    company_name: '',
    website_url: '',
    linkedin_company_url: '',
    founder_linkedin_url: '',
    short_description: '',
    category: '',
    current_primary_goal: 'leads',
  });
  const [structured, setStructured] = useState<StructuredBrain>(getBrainDefaults());
  const [firstGoal, setFirstGoal] = useState<typeof FIRST_GOALS[number]['id']>('leads');

  // Animated analysis step
  const [analysisIdx, setAnalysisIdx] = useState(0);

  // Hydrate from existing brain
  useEffect(() => {
    if (!brain?.profile) return;
    const p = brain.profile as Record<string, any>;
    setBasics((b) => ({
      ...b,
      company_name: p.company_name ?? b.company_name,
      website_url: p.website_url ?? b.website_url,
      linkedin_company_url: p.linkedin_company_url ?? b.linkedin_company_url,
      founder_linkedin_url: p.founder_linkedin_url ?? b.founder_linkedin_url,
      short_description: p.short_description ?? p.company_summary ?? b.short_description,
      category: p.category ?? b.category,
      current_primary_goal: p.current_primary_goal ?? b.current_primary_goal,
    }));
    const defaults = getBrainDefaults();
    setStructured({
      icp:            { ...defaults.icp, ...(p.icp ?? {}) },
      goals:          { ...defaults.goals, ...(p.goals ?? {}) },
      positioning:    { ...defaults.positioning, ...(p.positioning ?? {}) },
      brand_voice:    { ...defaults.brand_voice, ...(p.brand_voice ?? {}) },
      competitors:    { ...defaults.competitors, ...(p.competitors ?? {}) },
      approval_rules: { ...defaults.approval_rules, ...(p.approval_rules ?? {}) },
    });
  }, [brain?.onboarding_completed_at]);

  // Animate "analyzing" labels while saving on step 2
  useEffect(() => {
    if (step !== 2) return;
    setAnalysisIdx(0);
    const t = setInterval(() => {
      setAnalysisIdx((i) => Math.min(i + 1, ANALYSIS_STEPS.length - 1));
    }, 900);
    return () => clearInterval(t);
  }, [step]);

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

  // ----- actions -----
  async function startWebsiteAnalysis() {
    if (!basics.company_name.trim()) {
      toast.error('Add your company name first.');
      return;
    }
    setMode('website');
    setSaving(true);
    setStep(2);
    try {
      await call('save_basics', workspaceId!, {
        company_name: basics.company_name,
        website_url: basics.website_url,
        linkedin_company_url: basics.linkedin_company_url,
        founder_linkedin_url: basics.founder_linkedin_url,
        short_description: basics.short_description,
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
      // small UX pause so the agents row finishes its sweep
      await new Promise((r) => setTimeout(r, 600));
      setStep(3);
    } catch (e: any) {
      setWarnings(["We couldn't analyze the website automatically. Add a short description and we'll build your Company Brain manually."]);
      setStep(3);
    } finally {
      setSaving(false);
    }
  }

  async function skipToManual() {
    if (!basics.company_name.trim()) {
      toast.error('Add your company name first.');
      return;
    }
    setMode('manual');
    setSaving(true);
    try {
      await call('save_basics', workspaceId!, {
        company_name: basics.company_name,
        short_description: basics.short_description,
      });
      setStep(3);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function saveReviewAndNext() {
    setSaving(true);
    try {
      await call('save_basics', workspaceId!, {
        company_name: basics.company_name,
        website_url: basics.website_url,
        linkedin_company_url: basics.linkedin_company_url,
        founder_linkedin_url: basics.founder_linkedin_url,
        short_description: basics.short_description,
        category: basics.category,
      });
      await call('save_structured', workspaceId!, structured);
      setStep(4);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function finalizeAndContinue() {
    setSaving(true);
    try {
      await call('finalize', workspaceId!, { current_primary_goal: firstGoal });
      refresh();
      setStep(5);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to finalize');
    } finally {
      setSaving(false);
    }
  }

  function launchFirstWorkflow() {
    const goal = FIRST_GOALS.find((g) => g.id === firstGoal) ?? FIRST_GOALS[0];
    // Prefill only — never auto-send.
    window.dispatchEvent(new CustomEvent('chat:prefill', { detail: { text: goal.prompt } }));
    navigate(goal.route);
  }

  // ----- render -----
  return (
    <div className="min-h-screen w-full text-foreground py-10 px-4">
      <BackgroundGrid />
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-[11px] font-semibold tracking-[0.18em] text-primary uppercase">
              Company Brain Setup
            </span>
          </div>
          <span className="text-xs text-muted-foreground">Step {step} of 5</span>
        </div>
        <div className="mb-8">
          <ProgressRail step={step} />
        </div>

        {/* Step 1 — Welcome */}
        {step === 1 && (
          <Card className="p-8 sm:p-10">
            <div className="max-w-2xl">
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
                Teach Agentory your business in minutes.
              </h1>
              <p className="text-muted-foreground mt-3 text-[15px] leading-relaxed">
                Your AI workforce uses this context to find signals, write content, track
                competitors, and draft outreach. Nothing is sent without your approval.
              </p>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Company name</Label>
                <Input
                  className="mt-1.5 h-12 text-base"
                  placeholder="Agentory"
                  value={basics.company_name}
                  onChange={(e) => setBasics({ ...basics, company_name: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Website URL</Label>
                <div className="relative mt-1.5">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="h-12 text-base pl-9"
                    placeholder="https://agentory.space"
                    value={basics.website_url}
                    onChange={(e) => setBasics({ ...basics, website_url: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                <ShieldCheck className="inline h-3.5 w-3.5 mr-1 text-primary" />
                Draft-only by default. Approval required for anything sent.
              </div>
              <AgentChipsRow activeCount={0} />
            </div>

            <div className="mt-8 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
              <button
                type="button"
                onClick={skipToManual}
                disabled={saving}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors text-left"
              >
                I don't have a website — describe manually
              </button>
              <Button
                size="lg"
                onClick={startWebsiteAnalysis}
                disabled={saving}
                className="h-12 px-6 text-base"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <>Build Company Brain <ArrowRight className="h-4 w-4 ml-1.5" /></>
                )}
              </Button>
            </div>
          </Card>
        )}

        {/* Step 2 — Analyzing */}
        {step === 2 && (
          <Card className="p-8 sm:p-10">
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center">
                  <Sparkles className="h-6 w-6 text-primary animate-pulse" />
                </div>
                <div className="absolute -inset-2 rounded-3xl bg-primary/10 blur-2xl -z-10" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Your AI workforce is reading your website.</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  This usually takes ~10 seconds. You can keep this tab open.
                </p>
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
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : active ? (
                      <Loader2 className="h-4 w-4 text-primary animate-spin" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                    )}
                    <span className="text-sm">{label}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-8">
              <AgentChipsRow activeCount={Math.min(analysisIdx + 1, AGENTS.length)} />
            </div>
          </Card>
        )}

        {/* Step 3 — Review */}
        {step === 3 && (
          <div className="space-y-4">
            {warnings.length > 0 && (
              <div className="flex gap-2 items-start rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div>{warnings[0]}</div>
              </div>
            )}

            <Card className="p-6 sm:p-8">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-2xl font-semibold tracking-tight">
                  Review what Agentory understood
                </h2>
                <span className="text-[11px] uppercase tracking-widest text-primary/80">
                  Editable
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Edit anything that doesn't sound like you. Nothing is required beyond your company name.
              </p>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Basics */}
              <SectionCard title="Company basics">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Company name"><Input value={basics.company_name} onChange={(e) => setBasics({ ...basics, company_name: e.target.value })} /></Field>
                  <Field label="Website"><Input placeholder="https://…" value={basics.website_url} onChange={(e) => setBasics({ ...basics, website_url: e.target.value })} /></Field>
                  <Field label="LinkedIn company"><Input value={basics.linkedin_company_url} onChange={(e) => setBasics({ ...basics, linkedin_company_url: e.target.value })} /></Field>
                  <Field label="Founder LinkedIn"><Input value={basics.founder_linkedin_url} onChange={(e) => setBasics({ ...basics, founder_linkedin_url: e.target.value })} /></Field>
                  <Field label="Product category" className="sm:col-span-2"><Input placeholder="e.g. AI workforce OS" value={basics.category} onChange={(e) => setBasics({ ...basics, category: e.target.value })} /></Field>
                  <Field label="One-line description" className="sm:col-span-2">
                    <Textarea rows={2} value={basics.short_description} onChange={(e) => setBasics({ ...basics, short_description: e.target.value })} />
                  </Field>
                </div>
              </SectionCard>

              {/* ICP */}
              <SectionCard title="ICP" icon={<Target className="h-4 w-4" />}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Buyer roles"><Input placeholder="Founder, Head of Growth…" value={structured.icp.buyer_roles.join(', ')} onChange={(e) => setStructured({ ...structured, icp: { ...structured.icp, buyer_roles: parseList(e.target.value) } })} /></Field>
                  <Field label="Company size"><Input placeholder="e.g. 10–200" value={structured.icp.company_size} onChange={(e) => setStructured({ ...structured, icp: { ...structured.icp, company_size: e.target.value } })} /></Field>
                  <Field label="Industries"><Input value={structured.icp.industries.join(', ')} onChange={(e) => setStructured({ ...structured, icp: { ...structured.icp, industries: parseList(e.target.value) } })} /></Field>
                  <Field label="Geography"><Input placeholder="US + EU" value={structured.icp.geography} onChange={(e) => setStructured({ ...structured, icp: { ...structured.icp, geography: e.target.value } })} /></Field>
                  <Field label="Pain points" className="sm:col-span-2">
                    <Textarea rows={2} value={structured.icp.pain_points.join('\n')} onChange={(e) => setStructured({ ...structured, icp: { ...structured.icp, pain_points: parseLines(e.target.value) } })} />
                  </Field>
                </div>
              </SectionCard>

              {/* Goals */}
              <SectionCard title="Goals">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(['gtm', 'content', 'outreach', 'competitor_tracking'] as const).map((k) => (
                    <Field key={k} label={k.replace(/_/g, ' ')}>
                      <Input value={structured.goals[k]} onChange={(e) => setStructured({ ...structured, goals: { ...structured.goals, [k]: e.target.value } })} />
                    </Field>
                  ))}
                </div>
              </SectionCard>

              {/* Positioning */}
              <SectionCard title="Positioning">
                <Field label="Main promise"><Input value={structured.positioning.promise} onChange={(e) => setStructured({ ...structured, positioning: { ...structured.positioning, promise: e.target.value } })} /></Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <Field label="Differentiators"><Input value={structured.positioning.differentiators.join(', ')} onChange={(e) => setStructured({ ...structured, positioning: { ...structured.positioning, differentiators: parseList(e.target.value) } })} /></Field>
                  <Field label="Use cases"><Input value={structured.positioning.use_cases.join(', ')} onChange={(e) => setStructured({ ...structured, positioning: { ...structured.positioning, use_cases: parseList(e.target.value) } })} /></Field>
                </div>
                <Field label="Proof points (one per line)" className="mt-3">
                  <Textarea rows={2} value={structured.positioning.proof_points.join('\n')} onChange={(e) => setStructured({ ...structured, positioning: { ...structured.positioning, proof_points: parseLines(e.target.value) } })} />
                </Field>
              </SectionCard>

              {/* Competitors */}
              <SectionCard title="Competitors">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Known competitors"><Input value={structured.competitors.known.join(', ')} onChange={(e) => setStructured({ ...structured, competitors: { ...structured.competitors, known: parseList(e.target.value), unknown: false } })} /></Field>
                  <Field label="Adjacent tools"><Input value={structured.competitors.adjacent.join(', ')} onChange={(e) => setStructured({ ...structured, competitors: { ...structured.competitors, adjacent: parseList(e.target.value) } })} /></Field>
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={structured.competitors.unknown} onChange={(e) => setStructured({ ...structured, competitors: { ...structured.competitors, unknown: e.target.checked } })} />
                  I'm not sure yet — let Agentory help me discover them
                </label>
              </SectionCard>

              {/* Brand voice */}
              <SectionCard title="Brand voice">
                <Field label="Tone"><Input placeholder="founder-led, direct, no hype" value={structured.brand_voice.tone} onChange={(e) => setStructured({ ...structured, brand_voice: { ...structured.brand_voice, tone: e.target.value } })} /></Field>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {BRAND_VOICE_TAGS.map((tag) => {
                    const active = structured.brand_voice.tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setStructured({ ...structured, brand_voice: { ...structured.brand_voice, tags: toggle(structured.brand_voice.tags, tag) } })}
                        className={'text-[11px] rounded-full border px-2.5 py-1 ' + (active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
                <Field label="Things to avoid" className="mt-3"><Input placeholder="hype, emojis, jargon…" value={structured.brand_voice.avoid.join(', ')} onChange={(e) => setStructured({ ...structured, brand_voice: { ...structured.brand_voice, avoid: parseList(e.target.value) } })} /></Field>
              </SectionCard>

              {/* Approval rules */}
              <SectionCard
                title="Approval & safety"
                icon={<ShieldCheck className="h-4 w-4" />}
                accent
              >
                <p className="text-xs text-muted-foreground mb-3">
                  Nothing is sent, posted, commented, or DM'd without your approval.
                </p>
                {([
                  ['draft_only', 'Draft only — never send without my approval'],
                  ['email_requires_approval', 'Email requires my approval before sending'],
                  ['linkedin_manual_only', 'LinkedIn comments & DMs are manual only'],
                ] as const).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between rounded-xl border border-border/60 p-3 mb-2">
                    <span className="text-sm">{label}</span>
                    <Switch
                      checked={structured.approval_rules[key]}
                      onCheckedChange={(v) => setStructured({ ...structured, approval_rules: { ...structured.approval_rules, [key]: v } })}
                    />
                  </div>
                ))}
              </SectionCard>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={saveReviewAndNext} disabled={saving} size="lg">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <>Save and continue <ArrowRight className="h-4 w-4 ml-1.5" /></>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4 — First goal */}
        {step === 4 && (
          <div className="space-y-6">
            <Card className="p-6 sm:p-8">
              <h2 className="text-2xl font-semibold tracking-tight">
                What should your AI workforce help with first?
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Pick one. You can run any workflow from the dashboard later.
              </p>
            </Card>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIRST_GOALS.map((g) => {
                const Icon = g.icon;
                const active = firstGoal === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setFirstGoal(g.id)}
                    className={
                      'text-left rounded-2xl border p-5 transition-all ' +
                      (active
                        ? 'border-primary bg-primary/[0.07] shadow-[0_0_0_1px_rgba(16,185,129,0.35)]'
                        : 'border-border/60 bg-card/60 hover:border-border hover:-translate-y-[1px]')
                    }
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className={'h-9 w-9 rounded-xl flex items-center justify-center ' + (active ? 'bg-primary/15 text-primary' : 'bg-muted/40 text-muted-foreground')}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{g.agent}</span>
                    </div>
                    <div className="text-base font-semibold text-foreground">{g.title}</div>
                    <div className="text-[13px] text-muted-foreground mt-1 leading-snug">{g.blurb}</div>
                    <div className="mt-3 text-[11px] text-muted-foreground/80 italic line-clamp-2">
                      "{g.prompt}"
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(3)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={finalizeAndContinue} disabled={saving} size="lg">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <>Finish setup <ArrowRight className="h-4 w-4 ml-1.5" /></>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Step 5 — Launch */}
        {step === 5 && (
          <Card className="p-10 text-center">
            <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
            <h2 className="mt-6 text-3xl font-semibold tracking-tight">
              Your Company Brain is ready.
            </h2>
            <p className="text-muted-foreground mt-2 max-w-xl mx-auto">
              Your AI workforce is activated and using {basics.company_name || 'your company'} context.
              <br />Nothing is sent, posted, or DM'd without your approval.
            </p>

            <div className="mt-6 flex justify-center">
              <AgentChipsRow activeCount={AGENTS.length} />
            </div>

            <div className="mt-8 mx-auto max-w-md rounded-xl border border-border/60 bg-card/60 p-4 text-left">
              <div className="text-[10px] uppercase tracking-widest text-primary/80 mb-1">
                First workflow
              </div>
              <div className="text-sm font-medium">
                {FIRST_GOALS.find((g) => g.id === firstGoal)?.title}
              </div>
              <div className="text-[12px] text-muted-foreground mt-0.5">
                "{FIRST_GOALS.find((g) => g.id === firstGoal)?.prompt}"
              </div>
            </div>

            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="lg" onClick={launchFirstWorkflow}>
                Launch first workflow <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate('/dashboard')}>
                Go to dashboard
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ----- small UI primitives -----
function SectionCard({
  title, icon, accent = false, children,
}: { title: string; icon?: React.ReactNode; accent?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={
        'rounded-2xl border bg-card/60 backdrop-blur-xl p-5 ' +
        (accent ? 'border-primary/30 shadow-[0_0_0_1px_rgba(16,185,129,0.12)_inset]' : 'border-border/60')
      }
    >
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="text-primary">{icon}</span>}
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/90">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function Field({
  label, className = '', children,
}: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

// ----- utils -----
function parseList(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
function parseLines(v: string): string[] {
  return v.split('\n').map((s) => s.trim()).filter(Boolean);
}
function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}
// Strip empty values so analyzer-mapped defaults don't overwrite user input.
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
