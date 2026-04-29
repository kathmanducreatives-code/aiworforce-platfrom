import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import type { CapabilityRow } from './types';
import type { AgentDept } from '@/data/agentProfiles';
import { CAPABILITY_EXAMPLES } from './constants';

interface Props {
  rows: CapabilityRow[];
  onChange: (rows: CapabilityRow[]) => void;
  department: AgentDept | null;
  error?: string;
}

const MAX = 8;

export default function Step5Capabilities({ rows, onChange, department, error }: Props) {
  const update = (i: number, patch: Partial<CapabilityRow>) => {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const add = (preset?: CapabilityRow) => {
    if (rows.length >= MAX) return;
    onChange([...rows, preset ?? { capability: '', input_type: '', output_type: '' }]);
  };
  const remove = (i: number) => {
    onChange(rows.filter((_, idx) => idx !== i));
  };

  const examples = department ? CAPABILITY_EXAMPLES[department] : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl md:text-4xl font-display font-black text-foreground tracking-tight mb-2">
          What tasks can this agent handle?
        </h2>
        <p className="text-sm text-muted-foreground">
          The orchestrator reads this to decide when to call this agent automatically.
        </p>
      </div>

      <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_auto] gap-2 px-3 py-2 bg-card/60 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
          <span>Capability</span>
          <span>Input type</span>
          <span>Output type</span>
          <span className="w-7" />
        </div>
        <div className="divide-y divide-border/40">
          {rows.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">No capabilities yet — add one.</div>
          )}
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1.4fr_1fr_1fr_auto] gap-2 p-2">
              <Input value={r.capability}  onChange={(e) => update(i, { capability:  e.target.value })} placeholder="e.g. screen_candidates" className="h-9 text-xs bg-background/60" />
              <Input value={r.input_type}  onChange={(e) => update(i, { input_type:  e.target.value })} placeholder="candidate_list"      className="h-9 text-xs bg-background/60" />
              <Input value={r.output_type} onChange={(e) => update(i, { output_type: e.target.value })} placeholder="ranked_candidates"   className="h-9 text-xs bg-background/60" />
              <Button variant="ghost" size="icon" className="h-9 w-7 text-muted-foreground hover:text-rose-400" onClick={() => remove(i)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => add()} disabled={rows.length >= MAX} className="text-xs">
          <Plus className="w-3.5 h-3.5 mr-1" /> Add row {rows.length >= MAX && '(max 8)'}
        </Button>
        {error && <span className="text-xs text-rose-400">{error}</span>}
      </div>

      {examples.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-widest font-bold text-muted-foreground mb-2">
            Examples for {department}
          </div>
          <div className="flex flex-wrap gap-2">
            {examples.map((ex) => (
              <button
                key={ex.capability}
                onClick={() => add(ex)}
                disabled={rows.length >= MAX}
                className="text-[11px] font-mono px-3 py-1.5 rounded-full border border-border/60 bg-card/40 hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-300 text-foreground/80 transition disabled:opacity-40"
              >
                + {ex.capability} <span className="text-muted-foreground">({ex.input_type} → {ex.output_type})</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
