// Company Brain V2 · B2.3 — "Teach Agentory": the four ways a person adds lasting
// knowledge, in business words — a preference, a decision, a fact, or a
// correction. Each is saved as the team's own statement through the
// company-brain-memory function (role checked twice, idempotent), and every agent
// reads it through the shared loader from its next run. Something that disagrees
// with the business profile is saved only after the person confirms it.
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, Gavel, Loader2, PencilLine, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MemoryWriteError, newIdempotencyKey, writeMemory } from '@/lib/companyBrain/memoryApi';
import {
  ADD_OPTIONS, buildAddPayload, buildCorrectionPayload, buildDecisionPayload, type AddKind,
} from '@/lib/companyBrain/memoryView';
import { cn } from '@/lib/utils';
import { ConflictConfirm } from './ConflictConfirm';

type Intent = 'preference' | 'decision' | 'fact' | 'correction';
type DecisionCategory = 'strategy_selected' | 'icp_changed' | 'brand_preference';

const INTENTS: Array<{ id: Intent; label: string; text: string; icon: typeof SlidersHorizontal }> = [
  { id: 'preference', label: 'Add a preference', text: 'Who to exclude, target size, tone, priorities', icon: SlidersHorizontal },
  { id: 'decision', label: 'Record a decision', text: 'A standing business decision the team made', icon: Gavel },
  { id: 'fact', label: 'Record a fact', text: 'Something true about your business', icon: BadgeCheck },
  { id: 'correction', label: 'Correct something', text: 'Agentory has it wrong — set it right', icon: PencilLine },
];
const PREFERENCE_OPTIONS = ADD_OPTIONS.filter((o) => o.kind !== 'product' && o.kind !== 'goal');
const DECISION_OPTIONS: Array<{ id: DecisionCategory; label: string }> = [
  { id: 'strategy_selected', label: 'Strategy' },
  { id: 'icp_changed', label: 'Who we target' },
  { id: 'brand_preference', label: 'Brand and messaging' },
];

export function TeachAgentoryButton({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<Intent>('preference');
  const [pref, setPref] = useState<AddKind>('exclude_industry');
  const [decisionCat, setDecisionCat] = useState<DecisionCategory>('strategy_selected');
  const [value, setValue] = useState('');
  const [second, setSecond] = useState('');
  const [until, setUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [idem, setIdem] = useState(newIdempotencyKey);

  const reset = () => { setValue(''); setSecond(''); setUntil(''); setError(null); setConflict(null); setIdem(newIdempotencyKey()); };
  const build = (): { op: string; payload: Record<string, unknown> } => {
    const fail = (e: string): never => { throw new MemoryWriteError('invalid', e); };
    if (intent === 'decision') {
      const b = buildDecisionPayload(value, decisionCat, second);
      return b.ok ? { op: 'decide', payload: b.payload } : fail((b as { error: string }).error);
    }
    if (intent === 'correction') {
      const b = buildCorrectionPayload(value, second);
      return b.ok ? { op: 'correct', payload: b.payload } : fail((b as { error: string }).error);
    }
    const b = buildAddPayload(intent === 'fact' ? 'fact' : pref, value,
      { temporaryUntil: intent === 'preference' && until ? new Date(`${until}T23:59:59Z`).toISOString() : null });
    return b.ok ? { op: 'set', payload: b.payload } : fail((b as { error: string }).error);
  };
  const save = useMutation({
    mutationFn: (confirm: boolean) => { const { op, payload } = build(); return writeMemory(workspaceId, op, payload, idem, confirm); },
    onSuccess: (r) => {
      toast.success(r.outcome === 'unchanged' || r.outcome === 'already_recorded' ? 'Already in your Company Brain.' : 'Saved. Every agent uses it from its next run.');
      setOpen(false); reset(); onDone();
    },
    onError: (e) => {
      if (e instanceof MemoryWriteError && e.outcome === 'needs_resolution') { setConflict(e.conflict); setError(null); return; }
      setError(e instanceof MemoryWriteError
        ? (e.outcome === 'stale' ? 'This already exists. Correct it in the list instead.' : e.message)
        : 'Something went wrong. Nothing was changed.');
    },
  });
  const hint = PREFERENCE_OPTIONS.find((o) => o.kind === pref)?.hint ?? '';

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Teach Agentory</Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Teach Agentory</DialogTitle>
            <DialogDescription>Saved as your team’s own statement. Every agent follows it, and every change is kept in history.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What do you want to teach?">
            {INTENTS.map((i) => (
              <button key={i.id} type="button" role="radio" aria-checked={intent === i.id}
                onClick={() => { setIntent(i.id); setError(null); setConflict(null); }}
                className={cn('flex items-start gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors',
                  intent === i.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/40')}>
                <i.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span><span className="block font-medium">{i.label}</span><span className="block text-xs text-muted-foreground">{i.text}</span></span>
              </button>
            ))}
          </div>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(false); }}>
            {intent === 'preference' && (
              <>
                <Select value={pref} onValueChange={(v) => { setPref(v as AddKind); setError(null); setConflict(null); }}>
                  <SelectTrigger aria-label="Which preference"><SelectValue /></SelectTrigger>
                  <SelectContent>{PREFERENCE_OPTIONS.map((o) => <SelectItem key={o.kind} value={o.kind}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input value={value} onChange={(e) => { setValue(e.target.value); setConflict(null); }} placeholder={hint} aria-label="Value" autoFocus />
                <label className="block text-sm text-muted-foreground">
                  Only until (optional — leave empty to keep it)
                  <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-1" aria-label="Expires on" />
                </label>
              </>
            )}
            {intent === 'decision' && (
              <>
                <Select value={decisionCat} onValueChange={(v) => setDecisionCat(v as DecisionCategory)}>
                  <SelectTrigger aria-label="Kind of decision"><SelectValue /></SelectTrigger>
                  <SelectContent>{DECISION_OPTIONS.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="What did you decide? e.g. Focus on dental clinics in Portugal" aria-label="Decision" autoFocus />
                <Input value={second} onChange={(e) => setSecond(e.target.value)} placeholder="Why (optional)" aria-label="Why" />
              </>
            )}
            {intent === 'fact' && (
              <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. We have 12 employees and no sales team yet" aria-label="Fact" autoFocus />
            )}
            {intent === 'correction' && (
              <>
                <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="What does Agentory have wrong?" aria-label="What is wrong" autoFocus />
                <Input value={second} onChange={(e) => setSecond(e.target.value)} placeholder="What is actually true?" aria-label="What is true" />
              </>
            )}
            {conflict && <ConflictConfirm conflict={conflict} busy={save.isPending} onConfirm={() => save.mutate(true)} onCancel={() => setConflict(null)} />}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              {!conflict && <Button type="submit" disabled={save.isPending}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
