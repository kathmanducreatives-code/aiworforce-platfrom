import { ArrowUpRight, Brain, ChevronDown, Pencil, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FLOW_SECTIONS, HEALTH_LABEL, deriveHealth, type SectionKey } from '@/lib/companyBrainSections';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';
import './brain-overview.css';

interface Props {
  brain: CompanyBrainV2;
  active: boolean;
  activatedAt: string | null;
  saved: SectionKey | null;
  onEdit: (section: SectionKey) => void;
  onRestart: () => void;
}
const clean = (values: string[]) => [...new Set(values.map(v => v.trim()).filter(Boolean))];

export function BrainOverview({ brain, active, activatedAt, saved, onEdit, onRestart }: Props) {
  const health = deriveHealth(brain);
  const configured = FLOW_SECTIONS.filter(s => health[s.drawerKey] === 'configured').length;
  const t = brain.target_customer;
  const size = t.company_size.label || (t.company_size.min || t.company_size.max ? `${t.company_size.min ?? 0}–${t.company_size.max ?? '∞'} employees` : '');
  const targeting = clean([...t.industries, ...t.business_models, ...t.funding_stage, size, ...t.geography, ...t.must_have]);
  const buyers = clean(brain.buyer_personas);
  const signals = clean([...brain.triggers, ...brain.jobs_to_watch]);
  const rules = clean([...brain.qualification_rules.required_evidence, ...brain.qualification_rules.reject_if, ...Object.values(t.disqualifiers).flat()]);
  const messaging = clean([brain.positioning.promise, brain.brand_voice.tone, ...brain.content_angles]);
  const summaries: Record<string, { values: string[]; footer: string }> = {
    targeting: { values: targeting, footer: `${targeting.length} targeting criteria defined` },
    buyers: { values: buyers, footer: `${buyers.length} buyer roles defined` },
    signals: { values: signals, footer: `${signals.length} signals & roles defined` },
    disqualifiers: { values: rules, footer: `${rules.length} qualification rules defined` },
    messaging: { values: messaging, footer: `${clean(brain.content_angles).length} content angles defined` },
  };
  return <>
    <header className="brain-overview-header">
      <div><p className="text-[10px] font-medium uppercase tracking-[.18em] text-primary">Company Brain</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Your go-to-market intelligence system</h1>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">Turn your company knowledge into focused outreach, better qualification, and higher-converting conversations.</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" className="gap-2"><Pencil size={14} />Edit ICP<ChevronDown size={14} /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => onEdit('company')}>Company identity</DropdownMenuItem>{FLOW_SECTIONS.map(s => <DropdownMenuItem key={s.drawerKey} onSelect={() => onEdit(s.drawerKey)}>{s.number} · {s.title}</DropdownMenuItem>)}</DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" variant="outline" onClick={onRestart} className="gap-2"><RotateCcw size={14} />Refresh</Button>
      </div>
    </header>
    <div className="brain-overview-grid">
      <section className="brain-overview-core brain-overview-card" aria-label="Company Brain overview">
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">Company Brain</span><span className={`brain-overview-status ${active ? 'is-configured' : ''}`}>{active ? 'Active' : 'Setup needed'}</span></div>
        <div className="my-4 flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/5 text-primary"><Brain size={19} /></span><button onClick={() => onEdit('company')} className="truncate text-sm font-medium text-foreground/85 hover:text-primary" title="Edit company identity">{brain.company.name || 'Add your company'} <ArrowUpRight className="inline h-3 w-3" /></button></div>
        <h2 className="text-lg font-semibold tracking-tight">All the pieces work together</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Your company knowledge powers every outreach, signal, qualification decision, and interaction across Agentory.</p>
        <div className="mt-auto grid grid-cols-2 gap-3 border-t border-foreground/[.07] pt-3">
          <div><p className="text-xl font-semibold tracking-tight">{configured}<span className="text-muted-foreground/60"> / 5</span></p><p className="mt-1 text-[10px] text-muted-foreground">Modules configured</p></div>
          <div><p className="text-sm font-medium text-primary">{active && configured === 5 ? 'Ready' : 'Needs review'}</p><p className="mt-1 text-[10px] text-muted-foreground">{active && configured === 5 ? 'Powering your GTM' : 'Complete your context'}</p></div>
        </div>
        {activatedAt && <p className="mt-2 text-[10px] text-muted-foreground/70">Activated {activatedAt}</p>}
      </section>
      {FLOW_SECTIONS.map(section => {
        const summary = summaries[section.drawerKey];
        const state = health[section.drawerKey];
        return <button type="button" key={section.drawerKey} onClick={() => onEdit(section.drawerKey)} className={`brain-overview-card brain-overview-section brain-overview-${section.drawerKey}`} aria-label={`Edit ${section.title}`}>
          <div className="flex items-start justify-between gap-2"><span className="text-lg font-medium tracking-tight text-primary/80">{section.number}</span><span className={`brain-overview-status ${state === 'configured' ? 'is-configured' : ''}`}>{saved === section.drawerKey ? 'Saved' : HEALTH_LABEL[state]}</span></div>
          <h2 className="mt-2 text-base font-semibold tracking-tight">{section.title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{section.question}</p>
          <div className="brain-overview-values">
            {summary.values.length ? summary.values.slice(0, 2).map(value => <span key={value} className="brain-overview-value" title={value}>{value}</span>) : <span className="text-xs text-muted-foreground/60">Add details to guide your workforce.</span>}
            {summary.values.length > 2 && <span className="text-[10px] text-muted-foreground">+{summary.values.length - 2} more</span>}
          </div>
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-foreground/[.07] pt-3 text-[10px] text-muted-foreground"><span>{summary.footer}</span><ArrowUpRight size={14} className="shrink-0" /></div>
        </button>;
      })}
    </div>
  </>;
}
