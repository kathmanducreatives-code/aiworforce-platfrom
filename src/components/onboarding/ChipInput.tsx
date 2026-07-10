// Chip-style list editor for Company Brain review cards.
// Emits string[]. Enter/comma commits. Backspace on empty removes last.
// Premium look: rounded, hover states, smart empty affordance.

import { useState, type KeyboardEvent } from 'react';
import { X, Plus } from 'lucide-react';

interface Props {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Custom empty-state helper shown when values is [] and input is empty. */
  emptyHelper?: string;
}

export function ChipInput({ label, values, onChange, placeholder = 'Type and press Enter', emptyHelper }: Props) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);

  function commit(raw: string) {
    const v = raw.trim();
    if (!v) return;
    if (values.includes(v)) { setDraft(''); return; }
    onChange([...values, v]);
    setDraft('');
  }
  function remove(v: string) { onChange(values.filter((x) => x !== v)); }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(draft); return; }
    if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
  }

  const isEmpty = values.length === 0 && !focused && !draft;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        {values.length > 0 && (
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">{values.length}</span>
        )}
      </div>

      <div
        className={[
          'flex flex-wrap items-center gap-1.5 rounded-xl border bg-background/40 p-2 transition-all',
          focused
            ? 'border-primary/50 shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]'
            : 'border-border/50 hover:border-border',
        ].join(' ')}
      >
        {values.map((v) => (
          <span
            key={v}
            className="group inline-flex items-center gap-1 rounded-lg border border-border/50 bg-muted/50 px-2 py-0.5 text-xs text-foreground/90 transition-colors hover:border-primary/40 hover:bg-primary/[0.06]"
          >
            {v}
            <button
              type="button"
              onClick={() => remove(v)}
              aria-label={`Remove ${v}`}
              className="rounded-sm text-muted-foreground/70 transition-colors group-hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        {isEmpty && emptyHelper ? (
          <button
            type="button"
            onClick={() => setFocused(true)}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-border/50 bg-transparent px-2 py-1 text-[11px] text-muted-foreground/80 transition-colors hover:border-primary/40 hover:text-primary"
          >
            <Plus className="h-3 w-3" />
            {emptyHelper}
          </button>
        ) : (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); if (draft) commit(draft); }}
            placeholder={values.length === 0 ? placeholder : ''}
            className="min-w-[9rem] flex-1 border-0 bg-transparent px-1.5 py-0.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        )}

        {draft && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); commit(draft); }}
            className="inline-flex items-center gap-0.5 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary transition-colors hover:bg-primary/20"
            aria-label="Add"
          >
            <Plus className="h-3 w-3" /> add
          </button>
        )}
      </div>
    </div>
  );
}
