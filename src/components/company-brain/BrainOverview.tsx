import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, Globe, Linkedin, Pencil, Plus, RotateCcw, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { FLOW_SECTIONS, deriveHealth, type SectionHealth, type SectionKey } from '@/lib/companyBrainSections';
import {
  CONFIDENCE_LABEL, SECTION_TAB, brainSources, buildIcpSentences, deriveNextSteps, formatSource, joinValues, monogram,
  type IcpPhrase, type TabKey,
} from '@/lib/companyBrainInsights';
import type { SaveFields } from '@/lib/companyBrainPatch';
import type { CompanyBrainV2 } from '@/lib/normalizeCompanyBrain';
import { HealthBadge, InlineChips } from './InlineEdit';
import { CompanyContextCard, MarketPanel, MomentsPanel, RulesPanel, VoicePanel } from './BrainSectionPanels';
import './brain-overview.css';

interface Props {
  brain: CompanyBrainV2;
  active: boolean;
  activatedAt: string | null;
  saved: SectionKey | null;
  /** A background read is in flight (the page stays usable). */
  syncing?: boolean;
  onEdit: (section: SectionKey) => void;
  onRestart: () => void;
  onSaveFields: SaveFields;
}

const TABS: { key: TabKey; label: string; sections: SectionKey[] }[] = [
  { key: 'overview', label: 'Overview', sections: ['company'] },
  { key: 'market', label: 'Who we sell to', sections: ['targeting', 'buyers'] },
  { key: 'moments', label: 'Buying moments', sections: ['signals'] },
  { key: 'rules', label: 'Qualification', sections: ['disqualifiers'] },
  { key: 'voice', label: 'Voice & positioning', sections: ['messaging'] },
];
const isTab = (v: string | null): v is TabKey => TABS.some((t) => t.key === v);

const COVERAGE_LABEL: Record<SectionKey, string> = {
  company: 'Company identity', targeting: 'Target market', buyers: 'Buyer profile',
  signals: 'Buying moments', disqualifiers: 'Qualification', messaging: 'Messaging',
};

const uniq = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

export function BrainOverview({ brain, active, activatedAt, saved, syncing, onEdit, onRestart, onSaveFields }: Props) {
  const [params, setParams] = useSearchParams();
  const tab: TabKey = isTab(params.get('tab')) ? (params.get('tab') as TabKey) : 'overview';
  const setTab = (next: string) => {
    const p = new URLSearchParams(params);
    if (next === 'overview') p.delete('tab'); else p.set('tab', next);
    setParams(p, { replace: true });
  };
  const health = useMemo(() => deriveHealth(brain), [brain]);
  const panelProps = { brain, health, saved, onEdit, onSaveFields };

  return (
    <div className="brain-page">
      <header className="brain-header">
        <div className="min-w-0">
          <p className="brain-eyebrow">Company Brain</p>
          <h1 className="brain-title">Your go-to-market intelligence</h1>
          <p className="brain-lede">Everything your AI team knows about who you sell to, when to reach out, and how to sound. Click anything to change it.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {syncing && <span className="brain-sync" aria-live="polite">Syncing…</span>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="gap-2"><Pencil size={14} />Edit section<ChevronDown size={14} /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onEdit('company')}>Company identity</DropdownMenuItem>
              {FLOW_SECTIONS.map((s) => <DropdownMenuItem key={s.drawerKey} onSelect={() => onEdit(s.drawerKey)}>{s.number} · {s.title}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" onClick={onRestart} className="gap-2"><RotateCcw size={14} />Re-run setup</Button>
        </div>
      </header>

      <IdentityCard brain={brain} health={health} active={active} activatedAt={activatedAt} saved={saved === 'company'} onEdit={onEdit} />

      <Tabs value={tab} onValueChange={setTab} className="brain-tabs">
        <div className="brain-tablist-scroll">
          <TabsList className="brain-tablist" aria-label="Company Brain sections">
            {TABS.map((t) => {
              const attention = t.sections.some((s) => health[s] !== 'configured');
              return (
                <TabsTrigger key={t.key} value={t.key} className="brain-tab">
                  {t.label}
                  {attention && <span className="brain-tab-dot" aria-label="needs attention" />}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <TabsContent value="overview" className="brain-panel"><OverviewPanel {...panelProps} onOpenTab={setTab} /></TabsContent>
        <TabsContent value="market" className="brain-panel"><MarketPanel {...panelProps} /></TabsContent>
        <TabsContent value="moments" className="brain-panel"><MomentsPanel {...panelProps} /></TabsContent>
        <TabsContent value="rules" className="brain-panel"><RulesPanel {...panelProps} /></TabsContent>
        <TabsContent value="voice" className="brain-panel"><VoicePanel {...panelProps} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Identity ──────────────────────────────────────────────────────────────

function ReadinessRing({ ready, total }: { ready: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg className="brain-ring" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label={`${ready} of ${total} areas ready`}>
      <circle cx="32" cy="32" r={r} className="brain-ring-track" />
      <circle cx="32" cy="32" r={r} className="brain-ring-value" strokeDasharray={c} strokeDashoffset={c * (1 - ready / total)} />
      <text x="32" y="36" textAnchor="middle" className="brain-ring-label">{ready}/{total}</text>
    </svg>
  );
}

function IdentityCard({ brain, health, active, activatedAt, saved, onEdit }: {
  brain: CompanyBrainV2; health: Record<SectionKey, SectionHealth>; active: boolean; activatedAt: string | null;
  saved: boolean; onEdit: (s: SectionKey) => void;
}) {
  const c = brain.company;
  const site = c.website_url ? formatSource(c.website_url) : null;
  const meta = uniq([c.category, c.business_model, c.stage, c.location, c.team_size ? `${c.team_size} people` : '']);
  const keys = Object.keys(health) as SectionKey[];
  const ready = keys.filter((k) => health[k] === 'configured').length;

  return (
    <section className={cn('brain-card brain-identity', saved && 'is-saved')} aria-label="Company identity">
      <div className="brain-identity-main">
        <span className="brain-monogram" aria-hidden>{monogram(c.name)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="brain-company-name">{c.name || 'Your company'}</h2>
            {site && (site.href
              ? <a className="brain-site" href={site.href} target="_blank" rel="noopener noreferrer">{site.label}<ArrowUpRight size={12} aria-hidden /></a>
              : <span className="brain-site">{site.label}</span>)}
            <button type="button" className="brain-icon-btn" onClick={() => onEdit('company')} aria-label="Edit company identity"><Pencil size={13} /></button>
          </div>
          {meta.length > 0 && <p className="brain-company-meta">{meta.join(' · ')}</p>}
          {brain.positioning.promise
            ? <p className="brain-promise">“{brain.positioning.promise}”</p>
            : c.description && <p className="brain-company-desc">{c.description}</p>}
        </div>
      </div>
      <div className="brain-identity-side">
        <ReadinessRing ready={ready} total={keys.length} />
        <div className="min-w-0">
          <p className="brain-ready-title">{ready === keys.length ? 'Ready for your team' : `${keys.length - ready} area${keys.length - ready === 1 ? '' : 's'} to finish`}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={cn('brain-status', active ? 'is-positive' : 'is-caution')}>{active ? 'Active' : 'Setup needed'}</span>
            <span className="brain-status">{CONFIDENCE_LABEL[brain.brain_confidence]}</span>
          </div>
          {activatedAt && <p className="brain-meta-line">Activated {activatedAt}</p>}
        </div>
      </div>
    </section>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────

interface PanelProps {
  brain: CompanyBrainV2;
  health: Record<SectionKey, SectionHealth>;
  saved: SectionKey | null;
  onEdit: (s: SectionKey) => void;
  onSaveFields: SaveFields;
}

function OverviewPanel({ brain, health, saved, onEdit, onSaveFields, onOpenTab }: PanelProps & { onOpenTab: (t: TabKey) => void }) {
  const steps = useMemo(() => deriveNextSteps(brain), [brain]);
  const sentences = useMemo(() => buildIcpSentences(brain), [brain]);
  const sources = useMemo(() => brainSources(brain), [brain]);
  const notes = uniq(brain.evidence.confidence_notes);
  const t = brain.target_customer;
  const tiles: Record<string, string[]> = {
    targeting: uniq([...t.industries, ...t.business_models, ...t.geography]),
    buyers: uniq(brain.buyer_personas),
    signals: uniq([...brain.triggers, ...brain.jobs_to_watch]),
    disqualifiers: uniq([...brain.qualification_rules.required_evidence, ...brain.qualification_rules.reject_if, ...t.disqualifiers.industries]),
    messaging: uniq([...brain.content_angles, ...brain.brand_voice.tags]),
  };

  return (
    <div className="brain-overview-layout">
      <section className={cn('brain-card brain-icp', saved === 'targeting' && 'is-saved')} aria-labelledby="brain-icp-title">
        <div className="brain-card-head">
          <div>
            <p className="brain-kicker">Your ideal customer</p>
            <h3 id="brain-icp-title" className="brain-card-title">In one paragraph</h3>
          </div>
          <span className="brain-card-hint"><Sparkles size={12} aria-hidden />Click a highlighted phrase to change it</span>
        </div>
        <div className="brain-icp-text">
          {sentences.map((sentence, i) => (
            <p key={i}>{sentence.map((p, j) => <Phrase key={j} phrase={p} onEdit={onEdit} onSaveFields={onSaveFields} />)}</p>
          ))}
        </div>
      </section>

      <section className="brain-card brain-steps" aria-labelledby="brain-steps-title">
        <p className="brain-kicker">Make it sharper</p>
        <h3 id="brain-steps-title" className="brain-card-title">{steps.some((s) => s.kind === 'gap') ? 'Next best improvements' : 'Suggested refinements'}</h3>
        {steps.length === 0 ? (
          <>
            <div className="brain-steps-done"><CheckCircle2 size={18} aria-hidden /><p>Everything is in place. Your team has what it needs.</p></div>
            <ul className="brain-coverage" aria-label="Coverage">
              {(Object.keys(health) as SectionKey[]).map((k) => (
                <li key={k}><span>{COVERAGE_LABEL[k]}</span><HealthBadge state={health[k]} /></li>
              ))}
            </ul>
          </>
        ) : (
          <ol className="brain-step-list">
            {steps.slice(0, 4).map((s) => (
              <li key={s.title}>
                <button type="button" className="brain-step" data-kind={s.kind}
                  onClick={() => (s.section === 'company' ? onEdit('company') : onOpenTab(SECTION_TAB[s.section]))}>
                  <span className="brain-step-mark" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="brain-step-title">{s.title}</span>
                    <span className="brain-step-detail">{s.detail}</span>
                  </span>
                  <ArrowRight size={14} className="brain-step-arrow" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="brain-tiles" role="list" aria-label="Brain modules">
        {FLOW_SECTIONS.map((s) => {
          const values = tiles[s.drawerKey] ?? [];
          const state = health[s.drawerKey];
          return (
            <button type="button" role="listitem" key={s.drawerKey} onClick={() => onOpenTab(SECTION_TAB[s.drawerKey])}
              className={cn('brain-card brain-tile', saved === s.drawerKey && 'is-saved')} aria-label={`Open ${s.title}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="brain-tile-num">{s.number}</span>
                <HealthBadge state={state} />
              </div>
              <h4 className="brain-tile-title">{s.title}</h4>
              <p className="brain-tile-question">{s.question}</p>
              <div className="brain-tile-values">
                {values.length
                  ? values.slice(0, 3).map((v) => <span key={v} className="brain-chip is-static" title={v}><span className="truncate">{v}</span></span>)
                  : <span className="brain-field-empty">Nothing here yet</span>}
                {values.length > 3 && <span className="brain-more">+{values.length - 3}</span>}
              </div>
              <span className="brain-tile-open">Open<ArrowRight size={12} aria-hidden /></span>
            </button>
          );
        })}
      </div>

      <CompanyContextCard brain={brain} saved={saved} onSaveFields={onSaveFields} />

      <section className="brain-card brain-sources" aria-labelledby="brain-sources-title">
        <div className="brain-card-head">
          <div>
            <p className="brain-kicker">Where this came from</p>
            <h3 id="brain-sources-title" className="brain-card-title">
              {sources.length ? `Built from ${sources.length} source${sources.length === 1 ? '' : 's'}` : 'No sources recorded'}
            </h3>
          </div>
          <span className="brain-status">{CONFIDENCE_LABEL[brain.brain_confidence]}</span>
        </div>
        <div className="brain-sources-grid">
          <div>
            {sources.length === 0
              ? <p className="brain-field-empty">No sources were recorded when this brain was set up.</p>
              : (
                <ul className="brain-source-list">
                  {sources.map((s) => (
                    <li key={s.label}>
                      {s.kind === 'linkedin' ? <Linkedin size={13} aria-hidden /> : <Globe size={13} aria-hidden />}
                      {s.href
                        ? <a href={s.href} target="_blank" rel="noopener noreferrer" className="brain-source-link">{s.label}</a>
                        : <span className="truncate">{s.label}</span>}
                    </li>
                  ))}
                </ul>
              )}
          </div>
          {notes.length > 0 && (
            <div>
              <p className="brain-field-label">What we noticed</p>
              <ul className="brain-notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Phrase({ phrase, onEdit, onSaveFields }: {
  phrase: IcpPhrase; onEdit: (s: SectionKey) => void; onSaveFields: SaveFields;
}): ReactNode {
  if (phrase.kind === 'text') return <>{phrase.text === '.' ? '' : ' '}{phrase.text}</>;
  const filled = phrase.values.length > 0;
  const content = filled ? joinValues(phrase.values, phrase.joiner) : <><Plus size={12} aria-hidden />{phrase.label}</>;
  const cls = cn('brain-slot', !filled && 'is-empty');

  if (!phrase.ref) {
    return <>{' '}<button type="button" className={cls} onClick={() => onEdit(phrase.section)} aria-label={`Edit ${phrase.label}`}>{content}</button></>;
  }
  const ref = phrase.ref;
  return (
    <>
      {' '}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={cls} aria-label={`Edit ${phrase.label}`}>{content}</button>
        </PopoverTrigger>
        <PopoverContent align="start" className="brain-popover">
          <p className="brain-field-label">{phrase.label}</p>
          <InlineChips
            bare autoAdd={!filled}
            label={phrase.label}
            values={phrase.values}
            onCommit={(next) => onSaveFields(ref.section, { [ref.field]: next })}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
