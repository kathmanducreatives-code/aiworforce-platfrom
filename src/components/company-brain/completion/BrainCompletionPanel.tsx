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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowUpRight, BookMarked, Check, ChevronDown, CircleDashed, CircleDot, Info, Pencil, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChipInput } from '@/components/onboarding/ChipInput';
import { cn } from '@/lib/utils';
import {
  acceptSuggestionPatch, buildCompletionPatch, readProfilePath, SECTION_SPECS,
  type AssessmentField, type AssessmentSectionKey, type BrainAssessment, type CompletionSuggestion,
  type CompletionValue, type IcpConflict, type ProvenanceClaim, type SectionAssessment,
} from '@/lib/companyBrain/completion';
import type { SectionKey as DrawerSection } from '@/lib/companyBrainSections';
import type { ProvenanceLine } from '@/lib/companyBrain/provenanceView';

type Raw = Record<string, unknown>;
/** A save; the claim tells the server what the person did (B2.2). The server verifies it. */
/** CB-002: every save says whether it landed and, if not, why — shown next to the form. */
export type SaveOutcome = { ok: boolean; message?: string };
type SaveFn = (patch: Raw, provenance?: ProvenanceClaim) => Promise<SaveOutcome>;

interface Props {
  assessment: BrainAssessment;
  /** The stored profile the assessment was made from (patches are built on it). */
  profile: Raw;
  suggestions: CompletionSuggestion[];
  canEdit: boolean;
  /** Queue one save. Resolves false when it did not save (the page reports why). */
  onSave: SaveFn;
  /** Open the existing section editor (drawer). */
  onOpenEditor: (section: DrawerSection) => void;
  /** B2.1 renders its conflict resolver per section here. */
  renderConflicts?: (section: AssessmentSectionKey) => ReactNode;
  /** B2.2: where each section's knowledge came from (null when nothing is recorded). */
  provenanceFor?: (section: AssessmentSectionKey) => ProvenanceLine | null;
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

export function BrainCompletionPanel({ assessment, profile, suggestions, canEdit, onSave, onOpenEditor, renderConflicts, provenanceFor }: Props) {
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
    provenance: provenanceFor?.(s.key) ?? null,
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
  onSave: SaveFn;
  onOpenEditor: (section: DrawerSection) => void;
  conflicts: ReactNode;
  provenance: ProvenanceLine | null;
}

function SectionRow({ section: s, profile, canEdit, open, onToggle, suggestions, onDismiss, onSave, onOpenEditor, conflicts, provenance }: RowProps) {
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
          {provenance && <ProvenanceBlock p={provenance} />}
          {conflicts}
          {suggestions.length > 0 && (
            <div className="bcp-suggestions">
              {suggestions.map((sug) => (
                <SuggestionCard key={sug.id} sug={sug} canEdit={canEdit}
                  onAccept={(value) => onSave(acceptSuggestionPatch(profile, sug, value), {
                    source: 'suggestion', suggestion_id: sug.id,
                    edited: value !== undefined && JSON.stringify(value) !== JSON.stringify(sug.value),
                  })}
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
  sug: CompletionSuggestion; canEdit: boolean; onAccept: (value?: CompletionValue) => Promise<SaveOutcome>; onDismiss: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CompletionValue>(sug.value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = async (value?: CompletionValue) => {
    setSaving(true); setError(null);
    const r = await onAccept(value).catch((e): SaveOutcome => ({ ok: false, message: e instanceof Error ? e.message : undefined }));
    setSaving(false);
    if (r.ok) setEditing(false); else setError(r.message ?? 'Not saved. Try again.');
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
      {error && <p className="bcp-save-error" role="alert"><AlertTriangle size={12} aria-hidden />Not saved: {error}</p>}
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
  sectionKey: AssessmentSectionKey; profile: Raw; canEdit: boolean; onSave: SaveFn;
}) {
  const spec = SECTION_SPECS.find((x) => x.key === sectionKey)!;
  const initial = useMemo(() => Object.fromEntries(spec.fields.map((f) => [f.path, currentValue(profile, f)])) as Record<string, CompletionValue>, [spec, profile]);
  const [values, setValues] = useState<Record<string, CompletionValue>>(initial);
  const [saving, setSaving] = useState(false);
  // CB-002: what happened to the last Save, next to the button (a toast alone disappears).
  const [status, setStatus] = useState<{ kind: 'saved' } | { kind: 'error'; message: string } | null>(null);
  // Fields the person has typed in. Every other field follows the saved profile, so a
  // value saved elsewhere (an accepted suggestion, another tab) is shown here and is
  // never sent back as an "edit" that would clear it.
  const touched = useRef<Set<string>>(new Set());
  useEffect(() => {
    setValues((cur) => Object.fromEntries(Object.entries(initial).map(([p, v]) => [p, touched.current.has(p) ? cur[p] : v])));
  }, [initial]);
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
      setSaving(true); setStatus(null);
      const r = await onSave(buildCompletionPatch(profile, changed))
        .catch((err): SaveOutcome => ({ ok: false, message: err instanceof Error ? err.message : undefined }));
      setSaving(false);
      // On failure the typed values stay in the form, so Save retries exactly them.
      if (r.ok) { touched.current.clear(); setStatus({ kind: 'saved' }); }
      else setStatus({ kind: 'error', message: r.message ?? 'Not saved. Try again.' });
    }}>
      {spec.fields.map((f) => (
        <div key={f.path} className="bcp-field">
          {/* A list editor labels itself; a text field gets its label here. */}
          {!Array.isArray(values[f.path]) && <span>{f.label}</span>}
          <ValueEditor value={values[f.path]} onChange={(v) => { touched.current.add(f.path); setValues((cur) => ({ ...cur, [f.path]: v })); }} label={f.label} hint={f.hint} />
        </div>
      ))}
      <div className="bcp-actions">
        <Button size="sm" type="submit" disabled={!dirty || saving}>{saving ? 'Saving…' : status?.kind === 'error' ? 'Try again' : `Save ${spec.title.toLowerCase()}`}</Button>
        <Button size="sm" type="button" variant="ghost" disabled={!dirty || saving} onClick={() => { touched.current.clear(); setValues(initial); setStatus(null); }}>Discard changes</Button>
      </div>
      <p className="bcp-save-status" aria-live="polite" data-testid={`save-status-${sectionKey}`}>
        {saving ? 'Saving…'
          : status?.kind === 'saved' && !dirty ? <><Check size={12} aria-hidden /> Saved to your Company Brain</>
          : status?.kind === 'error' ? <span className="bcp-save-error" role="alert"><AlertTriangle size={12} aria-hidden />Not saved: {status.message}</span>
          : null}
      </p>
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
  conflicts: IcpConflict[]; canEdit: boolean; onSave: SaveFn;
}) {
  if (!conflicts.length) return null;
  return <div className="bcp-conflicts">{conflicts.map((c) => <IcpConflictCard key={c.id} conflict={c} canEdit={canEdit} onSave={onSave} />)}</div>;
}

function IcpConflictCard({ conflict: c, canEdit, onSave }: { conflict: IcpConflict; canEdit: boolean; onSave: SaveFn }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
              onClick={async () => {
                setBusy(r.id); setError(null);
                const out = await onSave(r.patch, { source: 'resolution', conflict_id: c.id, resolution_id: r.id })
                  .catch((e): SaveOutcome => ({ ok: false, message: e instanceof Error ? e.message : undefined }));
                setBusy(null);
                if (!out.ok) setError(out.message ?? 'Not saved. Try again.');
              }}>
              {busy === r.id ? 'Saving…' : r.label}
            </Button>
          ))}
        </div>
      )}
      {error && <p className="bcp-save-error" role="alert"><AlertTriangle size={12} aria-hidden />Not saved: {error}</p>}
    </article>
  );
}

// B2.2 — where this section's knowledge came from: the latest recorded change
// (who, how, when, why) and the confirmed memory that also shapes it.
function ProvenanceBlock({ p }: { p: ProvenanceLine }) {
  return (
    <div className={cn('bcp-prov', `is-${p.tone}`)} data-provenance={p.tone}>
      <div className="bcp-prov-head">
        <span className="bcp-prov-kicker">Where this came from</span>
        {p.history && <span className="bcp-prov-history">{p.history}</span>}
      </div>
      <p className="bcp-prov-line">
        <strong>{p.headline}</strong>
        {p.at && <> · <time dateTime={p.at}>{new Date(p.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></>}
      </p>
      {p.trust && <p className="bcp-prov-trust">{p.trust}</p>}
      {p.reason && <p className="bcp-prov-reason">“{p.reason}”</p>}
      {p.link && (
        <a className="bcp-prov-link" href={p.link.href} target="_blank" rel="noreferrer noopener">
          {p.link.text}<ArrowUpRight size={12} aria-hidden />
        </a>
      )}
      {p.memory.length > 0 && (
        <ul className="bcp-prov-memory" aria-label="Company memory used here">
          {p.memory.map((m) => (
            <li key={m.id}><BookMarked size={12} aria-hidden /><span>{m.title}</span><span className="bcp-prov-trust"> · {m.detail}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}
