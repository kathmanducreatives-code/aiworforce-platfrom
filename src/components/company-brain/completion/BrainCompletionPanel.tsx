// "Complete your Company Brain" (Company Brain V2 · B2.0).
//
// What the Brain knows, section by section, from the shared assessment
// (supabase/functions/_shared/companyBrainAssessment.ts): required business
// information first, optional enrichment second, and what is missing,
// incomplete, conflicting or unverified in each.
//
// Every save goes through the page's ordered save queue → the authorized
// `update` (CAS on the row version, role-checked server-side). Suggestions are
// shown, never saved, until the person presses Accept. Nothing here gates a
// feature: readiness for leads, signals and content is decided elsewhere and is
// unchanged.
import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowUpRight, Check, ChevronDown, CircleDashed, CircleDot, Info, Pencil, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChipInput } from '@/components/onboarding/ChipInput';
import { cn } from '@/lib/utils';
import {
  acceptSuggestionPatch, buildCompletionPatch, readProfilePath, SECTION_SPECS,
  type AssessmentField, type AssessmentSectionKey, type BrainAssessment, type CompletionSuggestion,
  type CompletionValue, type IcpConflict, type SectionAssessment,
} from '@/lib/companyBrain/completion';
import type { SectionKey as DrawerSection } from '@/lib/companyBrainSections';

type Raw = Record<string, unknown>;

interface Props {
  assessment: BrainAssessment;
  /** The stored profile the assessment was made from (patches are built on it). */
  profile: Raw;
  suggestions: CompletionSuggestion[];
  canEdit: boolean;
  /** Queue one save. Resolves false when it did not save (the page reports why). */
  onSave: (patch: Raw) => Promise<boolean>;
  /** Open the existing section editor (drawer). */
  onOpenEditor: (section: DrawerSection) => void;
  /** B2.1 renders its conflict resolver per section here. */
  renderConflicts?: (section: AssessmentSectionKey) => ReactNode;
}

const STAGE_COPY: Record<BrainAssessment['stage'], { title: string; text: string }> = {
  foundation: {
    title: 'Finish the essentials your AI team relies on',
    text: 'Agents keep working while you complete these. Each section you fill makes lead search, signals, briefs and drafts sharper.',
  },
  core: {
    title: 'Essentials complete — enrich for sharper results',
    text: 'Your AI team has what it needs. The optional sections below add competitors, voice, go-to-market and evidence.',
  },
  enriched: {
    title: 'Your Company Brain is complete',
    text: 'Every section is filled in. Keep it current as your business changes.',
  },
};

const STATUS_LABEL = { complete: 'Complete', incomplete: 'Incomplete', missing: 'Missing' } as const;

// What each side of a conflict is, in words: "your ICP" is ambiguous when both sides live in it.
const CONFLICT_COLUMNS: Record<string, [string, string]> = {
  size_label_vs_bounds: ['Bounds lead search enforces', 'Size label'],
  industry_targeted_and_excluded: ['Target industries', 'Also excluded'],
  persona_title_excluded: ['Buyer personas', 'Also excluded titles'],
  mirror_size: ['Your size label', 'What lead search reads'],
  mirror_personas: ['Your buyer personas', 'Older copy'],
  mirror_disqualifiers: ['Your disqualifiers', 'Older copy'],
};
const columns = (c: IcpConflict): [string, string] => CONFLICT_COLUMNS[c.id]
  ?? ['Your ICP', c.kind === 'radar_drift' ? 'Signal monitoring' : 'What lead search reads'];

export function BrainCompletionPanel({ assessment, profile, suggestions, canEdit, onSave, onOpenEditor, renderConflicts }: Props) {
  // Open first: a section with a conflict (it changes what agents read), else the next thing to do.
  const [open, setOpen] = useState<AssessmentSectionKey | null>(
    assessment.sections.find((s) => s.issues.some((i) => i.kind === 'conflicting'))?.key ?? assessment.next);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = useMemo(() => suggestions.filter((s) => !dismissed.has(s.id)), [suggestions, dismissed]);
  const bySection = (k: AssessmentSectionKey) => visible.filter((s) => s.section === k);
  const copy = STAGE_COPY[assessment.stage];
  const required = assessment.sections.filter((s) => s.tier === 'required');
  const optional = assessment.sections.filter((s) => s.tier === 'optional');

  const rowProps = (s: SectionAssessment) => ({
    section: s, profile, canEdit, onSave, onOpenEditor,
    open: open === s.key, onToggle: () => setOpen(open === s.key ? null : s.key),
    suggestions: bySection(s.key),
    onDismiss: (id: string) => setDismissed((d) => new Set(d).add(id)),
    conflicts: renderConflicts?.(s.key) ?? null,
  });

  return (
    <section id="brain-completion" className="brain-card bcp" aria-labelledby="bcp-title">
      <div className="bcp-head">
        <div className="min-w-0">
          <p className="brain-kicker">Company Brain readiness</p>
          <h2 id="bcp-title" className="brain-card-title">{copy.title}</h2>
          <p className="brain-card-desc">{copy.text}</p>
        </div>
        <ScoreRing score={assessment.score} />
      </div>

      <dl className="bcp-metrics">
        <Metric label="Essentials" value={`${assessment.required.complete} of ${assessment.required.total}`} tone={assessment.required.complete === assessment.required.total ? 'positive' : 'caution'} />
        <Metric label="Enrichment" value={`${assessment.optional.complete} of ${assessment.optional.total}`} />
        <Metric label="Conflicts" value={String(assessment.conflicts)} tone={assessment.conflicts ? 'caution' : undefined} />
        <Metric label="Needs verification" value={String(assessment.unverified)} tone={assessment.unverified ? 'caution' : undefined} />
      </dl>

      {!canEdit && <p className="bcp-note"><Info size={13} aria-hidden /> View only. An owner, admin or editor can complete these sections.</p>}

      <SectionGroup title="Essential business information" hint="What every agent needs to work for your business.">
        {required.map((s) => <SectionRow key={s.key} {...rowProps(s)} />)}
      </SectionGroup>
      <SectionGroup title="Optional enrichment" hint="Makes results sharper. Never required for an agent to run.">
        {optional.map((s) => <SectionRow key={s.key} {...rowProps(s)} />)}
      </SectionGroup>
    </section>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <svg className="brain-ring" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label={`Company Brain ${score}% complete`}>
      <circle cx="32" cy="32" r={r} className="brain-ring-track" />
      <circle cx="32" cy="32" r={r} className="brain-ring-value" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      <text x="32" y="36" textAnchor="middle" className="brain-ring-label">{score}%</text>
    </svg>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'caution' }) {
  return (
    <div className="bcp-metric">
      <dt>{label}</dt>
      <dd className={cn(tone === 'positive' && 'is-positive', tone === 'caution' && 'is-caution')}>{value}</dd>
    </div>
  );
}

function SectionGroup({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="bcp-group">
      <div className="bcp-group-head"><h3>{title}</h3><span>{hint}</span></div>
      <ul className="bcp-rows">{children}</ul>
    </div>
  );
}

function StatusMark({ status, review }: { status: SectionAssessment['status']; review: boolean }) {
  if (review) return <span className="bcp-mark is-incomplete" aria-hidden><AlertTriangle size={13} /></span>;
  if (status === 'complete') return <span className="bcp-mark is-complete" aria-hidden><Check size={12} strokeWidth={3} /></span>;
  if (status === 'incomplete') return <span className="bcp-mark is-incomplete" aria-hidden><CircleDot size={14} /></span>;
  return <span className="bcp-mark is-missing" aria-hidden><CircleDashed size={14} /></span>;
}

interface RowProps {
  section: SectionAssessment;
  profile: Raw;
  canEdit: boolean;
  open: boolean;
  onToggle: () => void;
  suggestions: CompletionSuggestion[];
  onDismiss: (id: string) => void;
  onSave: (patch: Raw) => Promise<boolean>;
  onOpenEditor: (section: DrawerSection) => void;
  conflicts: ReactNode;
}

function SectionRow({ section: s, profile, canEdit, open, onToggle, suggestions, onDismiss, onSave, onOpenEditor, conflicts }: RowProps) {
  const conflicting = s.issues.filter((i) => i.kind === 'conflicting');
  const unverified = s.issues.filter((i) => i.kind === 'unverified');
  const panelId = `bcp-${s.key}`;
  return (
    <li className={cn('bcp-row', open && 'is-open')}>
      <button type="button" className="bcp-row-head" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <StatusMark status={s.status} review={s.needs_review} />
        <span className="bcp-row-main">
          <span className="bcp-row-title">{s.title}</span>
          <span className="bcp-row-used">{s.used_by}</span>
        </span>
        <span className="bcp-row-flags">
          {conflicting.length > 0 && <span className="brain-status is-caution"><AlertTriangle size={11} aria-hidden />{conflicting.length} conflict{conflicting.length === 1 ? '' : 's'}</span>}
          {unverified.length > 0 && <span className="brain-status is-caution">Unverified</span>}
          {suggestions.length > 0 && s.status !== 'complete' && <span className="brain-status"><Sparkles size={11} aria-hidden />{suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'}</span>}
          <span className={cn('brain-status', s.status === 'complete' ? 'is-positive' : s.status === 'incomplete' && 'is-caution')}>{s.needs_review ? 'Needs review' : STATUS_LABEL[s.status]}</span>
        </span>
        <ChevronDown size={15} className="bcp-chevron" aria-hidden />
      </button>
      {open && (
        <div id={panelId} className="bcp-row-body">
          {s.missing.length > 0 && <p className="bcp-missing">{missingText(s)}</p>}
          {s.status === 'complete' && <p className="bcp-missing">Complete. Agents use it as written.</p>}
          {s.needs_review && <p className="bcp-missing">Filled in, but {conflicting.length === 1 ? 'one disagreement needs' : `${conflicting.length} disagreements need`} your decision. Until then agents may read different versions.</p>}
          {unverified.map((i) => <p key={i.message} className="bcp-issue"><Info size={13} aria-hidden />{i.message}</p>)}
          {conflicts}
          {suggestions.length > 0 && (
            <div className="bcp-suggestions">
              {suggestions.map((sug) => (
                <SuggestionCard key={sug.id} sug={sug} canEdit={canEdit}
                  onAccept={(value) => onSave(acceptSuggestionPatch(profile, sug, value))}
                  onDismiss={() => onDismiss(sug.id)} />
              ))}
            </div>
          )}
          {s.editor.kind === 'completion'
            ? <CompletionEditor sectionKey={s.key} profile={profile} canEdit={canEdit} onSave={onSave} />
            : canEdit && (
              <div className="bcp-actions">
                <Button size="sm" variant="outline" className="gap-2"
                  onClick={() => onOpenEditor((s.editor as { section: DrawerSection }).section)}>
                  <Pencil size={13} />{s.status === 'complete' || s.needs_review ? 'Review in the editor' : 'Complete in the editor'}
                </Button>
              </div>
            )}
        </div>
      )}
    </li>
  );
}

function SuggestionCard({ sug, canEdit, onAccept, onDismiss }: {
  sug: CompletionSuggestion; canEdit: boolean; onAccept: (value?: CompletionValue) => Promise<boolean>; onDismiss: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CompletionValue>(sug.value);
  const [saving, setSaving] = useState(false);
  const accept = async (value?: CompletionValue) => {
    setSaving(true);
    const ok = await onAccept(value);
    setSaving(false);
    if (ok) setEditing(false);
  };
  return (
    <article className="bcp-sug" aria-label={`Suggestion for ${sug.label}`}>
      <div className="bcp-sug-head">
        <span className="bcp-sug-label"><Sparkles size={12} aria-hidden />Suggested {sug.label.toLowerCase()}</span>
        <span className={cn('brain-status', sug.confidence === 'low' && 'is-caution')}>{sug.confidence} confidence</span>
      </div>
      {editing
        ? <ValueEditor value={draft} onChange={setDraft} label={sug.label} />
        : Array.isArray(sug.value)
        ? <div className="bcp-chips">{sug.value.map((v) => <span key={v} className="bcp-chip">{v}</span>)}</div>
        : <p className="bcp-sug-text">{sug.value}</p>}
      <p className="bcp-sug-source">
        From {sug.source.label}
        {sug.source.urls.slice(0, 3).map((u) => (
          <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="bcp-link">{hostPath(u)}<ArrowUpRight size={11} aria-hidden /></a>
        ))}
      </p>
      {sug.source.caution && <p className="bcp-caution"><AlertTriangle size={12} aria-hidden />{sug.source.caution}</p>}
      {canEdit && (
        <div className="bcp-actions">
          {editing ? <>
            <Button size="sm" disabled={saving || isEmptyValue(draft)} onClick={() => accept(draft)}>{saving ? 'Saving…' : 'Save'}</Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setEditing(false); setDraft(sug.value); }}>Cancel</Button>
          </> : <>
            <Button size="sm" disabled={saving} onClick={() => accept()} className="gap-1.5"><Check size={13} />{saving ? 'Saving…' : 'Accept'}</Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => setEditing(true)} className="gap-1.5"><Pencil size={13} />Edit first</Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={onDismiss} className="gap-1.5"><X size={13} />Not now</Button>
          </>}
        </div>
      )}
    </article>
  );
}

/** The completion editor for sections the drawer does not cover (goals, GTM, evidence). Explicit Save. */
function CompletionEditor({ sectionKey, profile, canEdit, onSave }: {
  sectionKey: AssessmentSectionKey; profile: Raw; canEdit: boolean; onSave: (patch: Raw) => Promise<boolean>;
}) {
  const spec = SECTION_SPECS.find((x) => x.key === sectionKey)!;
  const initial = useMemo(() => Object.fromEntries(spec.fields.map((f) => [f.path, currentValue(profile, f)])) as Record<string, CompletionValue>, [spec, profile]);
  const [values, setValues] = useState<Record<string, CompletionValue>>(initial);
  const [saving, setSaving] = useState(false);
  const changed = Object.fromEntries(Object.entries(values).filter(([p, v]) => JSON.stringify(v) !== JSON.stringify(initial[p])));
  const dirty = Object.keys(changed).length > 0;
  if (!canEdit) {
    return (
      <dl className="bcp-readonly">
        {spec.fields.map((f) => <div key={f.path}><dt>{f.label}</dt><dd>{display(initial[f.path]) || '—'}</dd></div>)}
      </dl>
    );
  }
  return (
    <form className="bcp-form" onSubmit={async (e) => {
      e.preventDefault();
      if (!dirty) return;
      setSaving(true);
      await onSave(buildCompletionPatch(profile, changed));
      setSaving(false);
    }}>
      {spec.fields.map((f) => (
        <label key={f.path} className="bcp-field">
          <span>{f.label}</span>
          <ValueEditor value={values[f.path]} onChange={(v) => setValues((cur) => ({ ...cur, [f.path]: v }))} label={f.label} hint={f.hint} />
        </label>
      ))}
      <div className="bcp-actions">
        <Button size="sm" type="submit" disabled={!dirty || saving}>{saving ? 'Saving…' : `Save ${spec.title.toLowerCase()}`}</Button>
        <Button size="sm" type="button" variant="ghost" disabled={!dirty || saving} onClick={() => setValues(initial)}>Discard changes</Button>
      </div>
    </form>
  );
}

function ValueEditor({ value, onChange, label, hint }: { value: CompletionValue; onChange: (v: CompletionValue) => void; label: string; hint?: string }) {
  return Array.isArray(value)
    ? <ChipInput label={label} values={value} onChange={onChange} placeholder={hint ?? 'Type and press Enter'} />
    : <Input aria-label={label} value={value} placeholder={hint} onChange={(e) => onChange(e.target.value)} />;
}

/** "Still needed: A, B." — or, for a section complete with any N fields (goals), how many more. */
function missingText(s: SectionAssessment): string {
  const spec = SECTION_SPECS.find((x) => x.key === s.key);
  const min = spec?.complete_min;
  if (min && min < (spec?.fields.length ?? 0)) {
    const more = Math.max(0, min - s.filled.length);
    return `Add ${more === 1 ? 'one more' : `at least ${more}`} of: ${s.missing.map((m) => m.label.toLowerCase()).join(', ')}.`;
  }
  return `Still needed: ${s.missing.map((m) => m.label).join(', ')}.`;
}

function currentValue(profile: Raw, f: AssessmentField): CompletionValue {
  const v = readProfilePath(profile, f.path);
  if (f.type === 'list') return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return typeof v === 'string' ? v : '';
}
const display = (v: CompletionValue | undefined) => (Array.isArray(v) ? v.join(', ') : v ?? '');
const isEmptyValue = (v: CompletionValue) => (Array.isArray(v) ? v.length === 0 : !v.trim());
function hostPath(u: string): string {
  try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + (x.pathname === '/' ? '' : x.pathname)).slice(0, 48); } catch { return u.slice(0, 48); }
}

// ── B2.1 · ICP conflicts: what disagrees, and one-click resolutions ─────────
const KIND_LABEL: Record<IcpConflict['kind'], string> = {
  projection_stale: 'Out of date',
  contradiction: 'Contradiction',
  radar_drift: 'Signal monitoring',
};

export function IcpConflictList({ conflicts, canEdit, onSave }: {
  conflicts: IcpConflict[]; canEdit: boolean; onSave: (patch: Raw) => Promise<boolean>;
}) {
  if (!conflicts.length) return null;
  return <div className="bcp-conflicts">{conflicts.map((c) => <IcpConflictCard key={c.id} conflict={c} canEdit={canEdit} onSave={onSave} />)}</div>;
}

function IcpConflictCard({ conflict: c, canEdit, onSave }: { conflict: IcpConflict; canEdit: boolean; onSave: (patch: Raw) => Promise<boolean> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const same = JSON.stringify(c.authoritative) === JSON.stringify(c.other);
  return (
    <article className="bcp-conflict" aria-label={`Conflict: ${c.message}`} data-conflict={c.id}>
      <div className="bcp-sug-head">
        <span className="bcp-conflict-label"><AlertTriangle size={12} aria-hidden />{KIND_LABEL[c.kind]}</span>
      </div>
      <p className="bcp-sug-text">{c.message}</p>
      {!same && (
        <dl className="bcp-compare">
          <div><dt>{columns(c)[0]}</dt><dd>{c.authoritative.length ? c.authoritative.join(', ') : 'empty'}</dd></div>
          <div><dt>{columns(c)[1]}</dt><dd>{c.other.length ? c.other.join(', ') : 'empty'}</dd></div>
        </dl>
      )}
      {canEdit && (
        <div className="bcp-actions">
          {c.resolutions.map((r, n) => (
            <Button key={r.id} size="sm" variant={n === 0 ? 'default' : 'outline'} disabled={busy !== null}
              onClick={async () => { setBusy(r.id); await onSave(r.patch); setBusy(null); }}>
              {busy === r.id ? 'Saving…' : r.label}
            </Button>
          ))}
        </div>
      )}
    </article>
  );
}
