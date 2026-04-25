import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface CapabilityRow {
  capability: string;
  input_type: string;
  output_type: string;
}

interface Props {
  rows: CapabilityRow[];
  onChange: (rows: CapabilityRow[]) => void;
  error?: string;
}

const MAX = 5;

export default function Step5Capabilities({ rows, onChange, error }: Props) {
  const update = (i: number, patch: Partial<CapabilityRow>) => {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () => {
    if (rows.length >= MAX) return;
    onChange([...rows, { capability: '', input_type: '', output_type: '' }]);
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm text-muted-foreground">
          What can this agent do? Add up to {MAX} capabilities.
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Example: <span className="text-foreground/80">draft_post</span> · input{' '}
          <span className="text-foreground/80">topic</span> → output{' '}
          <span className="text-foreground/80">linkedin_post</span>
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground/70">
                Capability {i + 1}
              </Label>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-rose-400 transition"
                  aria-label="Remove capability"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Input
              value={r.capability}
              onChange={(e) => update(i, { capability: e.target.value })}
              placeholder="capability_name (e.g. draft_post)"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={r.input_type}
                onChange={(e) => update(i, { input_type: e.target.value })}
                placeholder="input type"
              />
              <Input
                value={r.output_type}
                onChange={(e) => update(i, { output_type: e.target.value })}
                placeholder="output type"
              />
            </div>
          </div>
        ))}
      </div>

      {rows.length < MAX && (
        <button
          type="button"
          onClick={add}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-border/60 text-sm text-muted-foreground hover:text-emerald-400 hover:border-emerald-500/40 transition"
        >
          <Plus className="h-4 w-4" /> Add capability
        </button>
      )}

      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
