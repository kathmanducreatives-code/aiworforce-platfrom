import { useId, type ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ArrowRight, Brain, Check, ChevronDown, Loader2, Target, Radar, MessageSquare, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ChipInput } from './ChipInput';
import { SceneFrame } from './SceneFrame';
import { StepProgress } from './StepProgress';
import { ProgressiveBackground } from './ProgressiveBackground';
import { SceneInput, SceneFooter } from './scenes/sceneKit';
import { ErrorState } from './ErrorState';
import { canAnalyzeCompany, canEnrichFounder, type CompanyForm, type FounderForm } from '@/lib/onboardingV3';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';
import type { CompletenessResult } from '@/lib/companyBrainCompleteness';

const STEPS = [
  { id: 'goal', label: 'Your goal' }, { id: 'company', label: 'Company' },
  { id: 'market', label: 'Audience' }, { id: 'signals', label: 'Signals' },
  { id: 'review', label: 'Review' }, { id: 'activate', label: 'Activate' },
];
const GOALS = [
  { title: 'Find qualified companies', detail: 'Focus on accounts that fit your business.', icon: Target },
  { title: 'Detect buying signals', detail: 'Know what changed and why it matters.', icon: Radar },
  { title: 'Improve outbound', detail: 'Give every conversation relevant context.', icon: MessageSquare },
  { title: 'Build a repeatable GTM system', detail: 'Keep decisions and learning in one place.', icon: Workflow },
];
const SIGNALS = ['Hiring growth', 'New funding', 'Leadership changes', 'Product launches', 'Market expansion', 'Technology adoption'];

export interface GuidedSetupProps {
  step: number; onStep: (step: number) => void;
  founder: FounderForm; onFounder: (value: FounderForm) => void;
  company: CompanyForm; onCompany: (value: CompanyForm) => void;
  brain: CompanyBrainV2; onBrain: (value: CompanyBrainV2) => void;
  completeness: CompletenessResult;
  busy: string | null; error: { title: string; body: string } | null;
  saved: string; activated: boolean; hasDraft: boolean;
  companyResearched: boolean; founderResearched: boolean;
  onResearchCompany: () => Promise<void>; onResearchFounder: () => Promise<void>;
  onDraft: () => Promise<boolean>; onSave: () => void; onActivate: () => void;
  onDestination: (path: string) => void;
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = useId();
  return <div><label htmlFor={id} className="mb-2 block text-xs font-medium text-foreground/80">{label}</label>
    <Textarea id={id} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="min-h-24 resize-y rounded-xl border-foreground/15 bg-background/50 text-sm focus-visible:ring-primary/25" /></div>;
}

function Disclosure({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return <details className="group rounded-xl border border-foreground/10 bg-background/20" open={open || undefined}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium marker:content-none focus-visible:outline-primary">
      {title}<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
    </summary><div className="space-y-5 border-t border-foreground/5 p-4">{children}</div>
  </details>;
}

export function GuidedSetup(p: GuidedSetupProps) {
  const { step, brain, busy, activated, completeness } = p;
  const update = (mutate: (b: CompanyBrainV2) => void) => { const next = structuredClone(brain); mutate(next); p.onBrain(next); };
  const list = (label: string, values: string[], set: (b: CompanyBrainV2, values: string[]) => void, hint: string) =>
    <ChipInput label={label} values={values} onChange={values => update(b => set(b, values))} placeholder={hint} emptyHelper="Type a value and press Enter to add it." />;
  const next = () => p.onStep(Math.min(5, step + 1));
  const back = () => p.onStep(Math.max(0, step - 1));
  const companyValid = !!p.company.name.trim() && !!p.company.description.trim() && !!brain.company.business_model.trim();
  const marketValid = (brain.target_customer.industries.length > 0 || brain.target_customer.business_models.length > 0) && brain.buyer_personas.length > 0 && brain.pain_points.length > 0;
  const signalsValid = (brain.triggers.length > 0 || brain.jobs_to_watch.length > 0) && Object.values(brain.target_customer.disqualifiers).some(v => v.length > 0);
  const allowed = step === 0 ? !!p.founder.first_help_goal && !!p.founder.name.trim() : step === 1 ? companyValid : step === 2 ? marketValid : step === 3 ? signalsValid : true;
  const footer = <SceneFooter onBack={step > 0 ? back : undefined} backDisabled={!!busy}
    primaryLabel={step === 4 ? 'Confirm and continue' : step === 5 ? 'Activate Company Brain' : 'Continue'}
    onPrimary={step === 5 ? p.onActivate : next} primaryBusy={busy === 'activate'}
    primaryDisabled={!!busy || !allowed || (step === 5 && !completeness.complete)} />;

  const marketFields = <>
    {list('Industries', brain.target_customer.industries, (b,v) => { b.target_customer.industries = v; }, 'e.g. B2B software')}
    {list('Buyer roles', brain.buyer_personas, (b,v) => { b.buyer_personas = v; }, 'e.g. Head of Sales')}
    {list('Problems you solve', brain.pain_points, (b,v) => { b.pain_points = v; }, 'e.g. Too much time spent researching accounts')}
    <div className="grid gap-5 sm:grid-cols-2">
      <SceneInput label="Company size (optional)" value={brain.target_customer.company_size.label} onChange={v => update(b => { b.target_customer.company_size.label = v; })} placeholder="e.g. 20–200 employees" />
      {list('Geography (optional)', brain.target_customer.geography, (b,v) => { b.target_customer.geography = v; }, 'e.g. United States')}
    </div>
    {list('Customer business models (optional)', brain.target_customer.business_models, (b,v) => { b.target_customer.business_models = v; }, 'e.g. Subscription software')}
  </>;
  const signalFields = <>
    {list('Buying signals', brain.triggers, (b,v) => { b.triggers = v; }, 'Add a meaningful change')}
    <div className="flex flex-wrap gap-2" aria-label="Signal ideas">
      {SIGNALS.map(signal => <button key={signal} type="button" aria-pressed={brain.triggers.includes(signal)}
        onClick={() => update(b => { b.triggers = b.triggers.includes(signal) ? b.triggers.filter(s => s !== signal) : [...b.triggers, signal]; })}
        className={`rounded-full border px-3 py-2 text-xs transition-colors ${brain.triggers.includes(signal) ? 'border-primary/40 bg-primary/15 text-primary' : 'border-foreground/10 bg-background/30 text-muted-foreground hover:border-primary/30 hover:text-foreground'}`}>
        {brain.triggers.includes(signal) ? '✓ ' : '+ '}{signal}
      </button>)}
    </div>
    <p className="text-xs leading-5 text-muted-foreground">These are starting ideas. Choose only the changes that actually indicate demand for your product.</p>
    {list('Job titles to watch (optional)', brain.jobs_to_watch, (b,v) => { b.jobs_to_watch = v; }, 'e.g. First revenue operations hire')}
  </>;
  const safetyFields = <>
    {list('Company types to exclude', brain.target_customer.disqualifiers.company_types, (b,v) => { b.target_customer.disqualifiers.company_types = v; }, 'e.g. Agencies, sole traders')}
    {list('Industries to exclude (optional)', brain.target_customer.disqualifiers.industries, (b,v) => { b.target_customer.disqualifiers.industries = v; }, 'Add an industry')}
    {list('Required evidence (optional)', brain.qualification_rules.required_evidence, (b,v) => { b.qualification_rules.required_evidence = v; }, 'e.g. A dated source confirming the change')}
    {list('Reject if (optional)', brain.qualification_rules.reject_if, (b,v) => { b.qualification_rules.reject_if = v; }, 'Add a rejection rule')}
  </>;
  const messagingFields = <>
    <TextField label="Positioning promise" value={brain.positioning.promise} onChange={v => update(b => { b.positioning.promise = v; })} placeholder="The outcome your customers can expect" />
    <SceneInput label="Brand voice" value={brain.brand_voice.tone} onChange={v => update(b => { b.brand_voice.tone = v; })} placeholder="e.g. Clear, direct, thoughtful" />
    {list('Content angles', brain.content_angles, (b,v) => { b.content_angles = v; }, 'Add an angle')}
    {list('Claims to avoid', brain.brand_voice.avoid, (b,v) => { b.brand_voice.avoid = v; }, 'Add a claim to avoid')}
  </>;

  return <div className="relative isolate flex min-h-screen flex-col overflow-x-clip text-foreground">
    <ProgressiveBackground />
    <header className="border-b border-foreground/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2.5"><span className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary"><Brain className="h-4 w-4" /></span><span className="text-sm font-semibold">Agentory <span className="ml-2 hidden font-normal text-muted-foreground sm:inline">/ Company Brain</span></span></div>
        <div className="flex items-center gap-3"><span role="status" className="max-w-32 text-right text-[11px] text-muted-foreground">{p.saved}</span>
          {!activated && <Button variant="ghost" size="sm" disabled={!!busy} onClick={p.onSave}>{busy === 'save' ? 'Saving…' : 'Save draft'}</Button>}</div>
      </div>
    </header>
    <div className="mx-auto w-full max-w-[948px] px-5 py-6 sm:px-6"><StepProgress index={step} steps={STEPS} progress={activated ? 100 : step / STEPS.length * 100} /></div>
    <main className="w-full px-4 pb-16">
      {p.error && <div className="mx-auto mb-4 max-w-[900px]"><ErrorState title={p.error.title} body={p.error.body} /></div>}
      <fieldset disabled={!!busy} className="m-0 min-w-0 border-0 p-0">
      <AnimatePresence mode="wait" initial={false}>
      {activated ? <SceneFrame key="complete" eyebrow="Company Brain activated" title="Your AI team has context." helper="Your market, buyers, signals, and qualification rules are now available to your workforce." footer={<SceneFooter primaryLabel={p.founder.first_help_goal === 'Detect buying signals' ? 'Explore buying signals' : 'Find my first opportunity'} onPrimary={() => p.onDestination(p.founder.first_help_goal === 'Detect buying signals' ? '/signals' : '/leads/find')} />}>
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary"><Check className="h-6 w-6" /></div>
        <p className="text-sm leading-6 text-muted-foreground">Your next step is to define a search. You can review its scope before starting any work.</p>
        <Button variant="ghost" onClick={() => p.onDestination('/company-brain')} className="mt-4 px-0">Review Company Brain <ArrowRight className="ml-2 h-4 w-4" /></Button>
      </SceneFrame> : step === 0 ? <SceneFrame key="goal" width="xl" eyebrow="01 / Your goal" title="Give your AI team a direction." helper="Start with what matters most. We’ll use it to guide your first step in Agentory." footer={footer}>
        <div className="mb-6"><SceneInput label="What should we call you?" value={p.founder.name} onChange={name => p.onFounder({ ...p.founder, name })} placeholder="Your name" /></div>
        <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Your first goal">
          {GOALS.map(({title,detail,icon:Icon}) => <button type="button" key={title} aria-pressed={p.founder.first_help_goal === title} onClick={() => p.onFounder({...p.founder,first_help_goal:title})}
            className={`rounded-xl border p-4 text-left transition-colors ${p.founder.first_help_goal === title ? 'border-primary/50 bg-primary/10' : 'border-foreground/10 bg-background/25 hover:border-primary/30'}`}>
            <Icon className="mb-3 h-5 w-5 text-primary" /><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span>
          </button>)}
        </div>
        <p className="mt-5 text-xs leading-5 text-muted-foreground">Company context → a focused audience → a reviewed Company Brain.</p>
      </SceneFrame> : step === 1 ? <SceneFrame key="company" width="xl" eyebrow="02 / Company context" title="Tell us what you’re building." helper="Your own words come first. Public research can add context if you choose." footer={footer}>
        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2"><SceneInput label="Company name" value={p.company.name} onChange={name => p.onCompany({...p.company,name})} placeholder="Company name" /><SceneInput label="Business model" value={brain.company.business_model} onChange={v => update(b => {b.company.business_model=v;})} placeholder="e.g. B2B SaaS" /></div>
          <TextField label="What do you help customers do?" value={p.company.description} onChange={description => p.onCompany({...p.company,description})} placeholder="We help [who] achieve [outcome]." />
          <SceneInput label="Website (optional for manual setup)" value={p.company.website_url} onChange={website_url => p.onCompany({...p.company,website_url})} placeholder="https://yourcompany.com" type="url" />
          <Disclosure title="Add public research · optional">
            <p className="text-xs leading-5 text-muted-foreground">Research runs only when you request it. You can continue manually at any time.</p>
            <Button variant="outline" disabled={!!busy || !canAnalyzeCompany(p.company)} onClick={p.onResearchCompany}>{busy === 'company' ? 'Reading website…' : p.companyResearched ? 'Research website again' : 'Analyze company website'}</Button>
            <SceneInput label="Your LinkedIn profile (optional)" value={p.founder.linkedin_url} onChange={linkedin_url => p.onFounder({...p.founder,linkedin_url})} placeholder="https://linkedin.com/in/your-name" />
            <label className="flex items-start gap-3 text-xs leading-5 text-muted-foreground"><input type="checkbox" className="mt-1 accent-emerald-500" checked={p.founder.enrichment_consent} onChange={e => p.onFounder({...p.founder,enrichment_consent:e.target.checked})} />Allow Agentory to research this public profile. No contacts are imported.</label>
            <Button variant="outline" disabled={!!busy || !canEnrichFounder(p.founder)} onClick={p.onResearchFounder}>{busy === 'founder' ? 'Reading profile…' : p.founderResearched ? 'Research profile again' : 'Analyze LinkedIn profile'}</Button>
            <div className="border-t border-foreground/10 pt-4"><Button disabled={!!busy || !companyValid} onClick={async () => { if (await p.onDraft()) next(); }}>{busy === 'draft' ? 'Preparing your draft…' : 'Draft Company Brain from context'}</Button><p className="mt-2 text-xs text-muted-foreground">You’ll review every suggestion before activating.</p></div>
          </Disclosure>
          {(busy === 'company' || busy === 'founder' || busy === 'draft') && <p role="status" className="flex items-center gap-2 text-sm text-primary"><Loader2 className="h-4 w-4 animate-spin" />{busy === 'draft' ? 'Organizing the available context…' : 'Reading the public sources you requested…'}</p>}
          {!busy && (p.companyResearched || p.founderResearched) && <p role="status" className="text-xs text-primary">Research received. Generate a draft to review its suggestions, or continue with your own details.</p>}
        </div>
      </SceneFrame> : step === 2 ? <SceneFrame key="market" width="xl" eyebrow="03 / Market & buyers" title="Who is a good fit?" helper="Define the companies and people worth your team’s attention. Add at least one market, buyer role, and problem you solve." footer={footer}><div className="space-y-5">{marketFields}</div></SceneFrame>
      : step === 3 ? <SceneFrame key="signals" width="xl" eyebrow="04 / Timing & qualification" title="What makes now the right time?" helper="Choose relevant buying signals and at least one exclusion to keep your results focused." footer={footer}><div className="space-y-5">{signalFields}<Disclosure title="Qualification & exclusions" open>{safetyFields}</Disclosure></div></SceneFrame>
      : step === 4 ? <SceneFrame key="review" width="xl" eyebrow="05 / Company Brain preview" title="Here’s what your team will know." helper="Review your context in one place. Expand any section to make a correction." footer={footer}>
        <div className="mb-5 rounded-xl border border-primary/15 bg-primary/5 p-4"><p className="text-sm font-medium">{p.company.name}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{p.company.description}</p><p className="mt-3 text-xs text-primary">{completeness.required_met} of {completeness.required_total} required decisions provided</p><p className="mt-1 text-xs text-muted-foreground">{p.hasDraft ? 'AI draft with your edits. Check the details before confirming.' : 'Based on the details you entered.'}</p></div>
        <div className="space-y-3"><Disclosure title={`Target market · ${brain.target_customer.industries.join(', ') || 'Review audience'}`}>{marketFields}</Disclosure>
          <Disclosure title={`Buyer profile · ${brain.buyer_personas.join(', ') || 'Add buyers'}`}>{list('Buyer roles',brain.buyer_personas,(b,v)=>{b.buyer_personas=v;},'Add a buyer role')}{list('Pain points',brain.pain_points,(b,v)=>{b.pain_points=v;},'Add a pain point')}</Disclosure>
          <Disclosure title={`Buying moments · ${brain.triggers.length} signals`}>{signalFields}</Disclosure>
          <Disclosure title="Qualification & safety">{safetyFields}</Disclosure><Disclosure title="Messaging fit · refine your voice">{messagingFields}</Disclosure>
          <Disclosure title="Evidence & sources"><p className="text-xs leading-5 text-muted-foreground">{brain.evidence.source_pages.length + brain.evidence.linkedin_sources.length === 0 ? 'No external sources attached. This Brain uses your input; research has not verified it.' : 'Sources returned by research:'}</p>{[...brain.evidence.source_pages,...brain.evidence.linkedin_sources].map((source,i)=><p key={`${source}-${i}`} className="break-all text-xs text-muted-foreground">{source}</p>)}{brain.evidence.confidence_notes.map((note,i)=><p key={i} className="text-xs text-muted-foreground">{note}</p>)}</Disclosure></div>
      </SceneFrame> : <SceneFrame key="activate" width="xl" eyebrow="06 / Ready to work" title={completeness.complete ? 'Make this your team’s shared context.' : 'A few details still need your attention.'} helper="Your AI employees will use this Company Brain to guide research, qualification, and messaging." footer={footer}>
        {completeness.complete ? <div className="space-y-3">{['Your target market and buyer roles','The signals that make timing relevant','Your exclusions and qualification rules','Your positioning and customer pain points'].map(label=><p key={label} className="flex items-center gap-3 text-sm"><Check className="h-4 w-4 text-primary" />{label}</p>)}<p className="pt-3 text-xs leading-5 text-muted-foreground">Activation saves your context. Searches and outreach still require a separate action.</p></div> : <div className="space-y-3">{completeness.missing.map(label=><p key={label} className="text-sm text-muted-foreground">• {label}</p>)}<Button variant="outline" onClick={()=>p.onStep(1)}>Review company details</Button><Button variant="ghost" onClick={()=>p.onStep(4)}>Review audience and rules</Button></div>}
      </SceneFrame>}
      </AnimatePresence>
      </fieldset>
    </main>
  </div>;
}
