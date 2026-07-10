// Chip-style list editor used inside Company Brain review cards.
// Behavior identical to the previous comma-textarea EditableList: emits string[].
// - Enter or comma commits the current input as a new chip.
// - Backspace on empty input removes the last chip.
// - Clicking × on a chip removes it.

import { useState, type KeyboardEvent } from 'react';
import { X, Plus } from 'lucide-react';

interface Props {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

export function ChipInput({ label, values, onChange, placeholder = 'Add and press Enter' }: Props) {
  const [draft, setDraft] = useState('');

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
    if (e.key === 'Backspace' && !draft && values.length) { onChange(values.slice(0, -1)); }
  }

  return (
    <div>
      <p className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/50 bg-background/40 p-1.5 transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/40 px-2 py-0.5 text-xs text-foreground/90"
          >
            {v}
            <button
              type="button"
              onClick={() => remove(v)}
              aria-label={`Remove ${v}`}
              className="rounded-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => draft && commit(draft)}
          placeholder={values.length === 0 ? placeholder : ''}
          className="min-w-[9rem] flex-1 border-0 bg-transparent px-1.5 py-0.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
        />
        {draft && (
          <button
            type="button"
            onClick={() => commit(draft)}
            className="inline-flex items-center gap-0.5 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/20"
            aria-label="Add"
          >
            <Plus className="h-3 w-3" /> add
          </button>
        )}
      </div>
    </div>
  );
}
