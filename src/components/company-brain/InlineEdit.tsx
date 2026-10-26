// In-place editors for the Company Brain page: a list of values edited as
// chips/rows/people, and a single text value. Each one commits through the
// page's save queue and reports its own Saving… / Saved / Couldn't save — the
// whole page never blocks on a write.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { monogram } from '@/lib/companyBrainInsights';
import { HEALTH_LABEL, type SectionHealth } from '@/lib/companyBrainSections';
import { useBrainEditable } from './brainEditable';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function useSaveState() {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  async function run(commit: () => Promise<boolean>) {
    clearTimeout(timer.current);
    setState('saving');
    const ok = await commit();
    setState(ok ? 'saved' : 'error');
    if (ok) timer.current = setTimeout(() => setState('idle'), 1600);
    return ok;
  }
  return { state, run };
}

export function SaveStatus({ state }: { state: SaveState }) {
  return (
    <span className={cn('brain-save-status', `is-${state}`)} aria-live="polite">
      {state === 'saving' && 'Saving…'}
      {state === 'saved' && <><Check size={11} aria-hidden />Saved</>}
      {state === 'error' && "Couldn't save"}
    </span>
  );
}

export type ChipTone = 'neutral' | 'positive' | 'caution' | 'negative';

interface ChipsProps {
  label: string;
  hint?: string;
  values: string[];
  onCommit: (next: string[]) => Promise<boolean>;
  /** chips: short tags · rows: sentences · people: buyer roles. */
  variant?: 'chips' | 'rows' | 'people';
  tone?: ChipTone;
  addLabel?: string;
  emptyText?: string;
  /** Hide the label row (the editor sits under its own heading, e.g. in a popover). */
  bare?: boolean;
  /** Open the add field immediately. */
  autoAdd?: boolean;
  /** Extra per-value actions (e.g. "move to"). */
  actions?: (value: string) => ReactNode;
}

export function InlineChips({
  label, hint, values, onCommit, variant = 'chips', tone = 'neutral',
  addLabel = 'Add', emptyText, bare, autoAdd, actions,
}: ChipsProps) {
  const { state, run } = useSaveState();
  const editable = useBrainEditable();
  const [adding, setAdding] = useState(!!autoAdd && editable);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  function add() {
    const v = draft.trim();
    if (!v) { setAdding(false); return; }
    setDraft('');
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    void run(() => onCommit([...values, v]));
  }
  function remove(v: string) { void run(() => onCommit(values.filter((x) => x !== v))); }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(''); setAdding(false); }
  }

  const addControl = !editable ? null : adding ? (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKey}
      onBlur={add}
      aria-label={`Add to ${label}`}
      placeholder="Type, then Enter"
      className={cn('brain-add-input', variant !== 'chips' && 'is-wide')}
    />
  ) : (
    <button type="button" className="brain-add" onClick={() => setAdding(true)}>
      <Plus size={12} aria-hidden />{addLabel}
    </button>
  );

  return (
    <div className="brain-field" data-tone={tone}>
      {!bare && (
        <div className="brain-field-head">
          <span className="brain-field-label">{label}</span>
          <SaveStatus state={state} />
        </div>
      )}
      {!bare && hint && <p className="brain-field-hint">{hint}</p>}

      {values.length === 0 && !adding && emptyText && <p className="brain-field-empty">{emptyText}</p>}

      {variant === 'chips' && (
        <div className="brain-chips">
          {values.map((v) => (
            <span key={v} className="brain-chip">
              <span className="truncate">{v}</span>
              {actions?.(v)}
              {editable && <button type="button" className="brain-chip-x" onClick={() => remove(v)} aria-label={`Remove ${v}`}><X size={11} /></button>}
            </span>
          ))}
          {addControl}
        </div>
      )}

      {variant === 'rows' && (
        <ul className="brain-rows">
          {values.map((v) => (
            <li key={v} className="brain-row">
              <span className="brain-row-mark" aria-hidden />
              <span className="min-w-0 flex-1">{v}</span>
              {actions?.(v)}
              {editable && <button type="button" className="brain-chip-x" onClick={() => remove(v)} aria-label={`Remove ${v}`}><X size={12} /></button>}
            </li>
          ))}
          {addControl && <li>{addControl}</li>}
        </ul>
      )}

      {variant === 'people' && (
        <div className="brain-people">
          {values.map((v) => (
            <div key={v} className="brain-person">
              <span className="brain-person-avatar" aria-hidden>{monogram(v)}</span>
              <span className="min-w-0 flex-1 truncate">{v}</span>
              {editable && <button type="button" className="brain-chip-x" onClick={() => remove(v)} aria-label={`Remove ${v}`}><X size={12} /></button>}
            </div>
          ))}
          {addControl && <div className="brain-person is-add">{addControl}</div>}
        </div>
      )}

      {bare && <SaveStatus state={state} />}
    </div>
  );
}

interface TextProps {
  label: string;
  value: string;
  onCommit: (next: string) => Promise<boolean>;
  placeholder: string;
  /** Visual size of the displayed value. */
  size?: 'body' | 'statement';
}

export function InlineText({ label, value, onCommit, placeholder, size = 'body' }: TextProps) {
  const { state, run } = useSaveState();
  const editable = useBrainEditable();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);

  async function save() {
    const next = draft.trim();
    setEditing(false);
    if (next === value.trim()) return;
    await run(() => onCommit(next));
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(value); setEditing(false); }
  }

  return (
    <div className="brain-field">
      <div className="brain-field-head">
        <span className="brain-field-label">{label}</span>
        <SaveStatus state={state} />
      </div>
      {!editable ? (
        <p className={cn('brain-text-view is-static', size === 'statement' && 'is-statement', !value && 'is-empty')}>{value || placeholder}</p>
      ) : editing ? (
        <div className="brain-text-edit">
          <textarea
            ref={ref}
            rows={size === 'statement' ? 3 : 2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            aria-label={label}
            className={cn('brain-textarea', size === 'statement' && 'is-statement')}
          />
          <div className="brain-text-actions">
            <span className="brain-kbd-hint">⌘ Enter to save · Esc to cancel</span>
            <button type="button" className="ag-btn ag-btn-ghost brain-mini-btn" onClick={() => { setDraft(value); setEditing(false); }}>Cancel</button>
            <button type="button" className="ag-btn ag-btn-primary brain-mini-btn" onClick={() => void save()}>Save</button>
          </div>
        </div>
      ) : (
        <button type="button" className={cn('brain-text-view', size === 'statement' && 'is-statement', !value && 'is-empty')} onClick={() => setEditing(true)}>
          <span className="min-w-0 flex-1">{value || placeholder}</span>
          <Pencil size={13} className="brain-text-pencil" aria-hidden />
          <span className="sr-only">Edit {label}</span>
        </button>
      )}
    </div>
  );
}

export function HealthBadge({ state }: { state: SectionHealth }) {
  const tone = state === 'configured' ? 'is-positive' : state === 'needs-confirmation' ? 'is-caution' : '';
  return <span className={cn('brain-status', tone)}><span className="brain-status-dot" aria-hidden />{HEALTH_LABEL[state]}</span>;
}
