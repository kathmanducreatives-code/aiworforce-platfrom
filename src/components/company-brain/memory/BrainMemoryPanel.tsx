// Company Brain — MEMORY: what the team decided, prefers and confirmed, what
// agents suggested, and how all of it changed over time.
//
// Reads over RLS (memoryApi.fetchMemorySnapshot); writes through the
// company-brain-memory edge function. Viewers see everything and can change
// nothing (the server refuses them too). Every write carries an idempotency
// key, so a double-click is one change.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, Loader2, ShieldAlert, Sparkles } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import {
  MemoryUnavailableError, MemoryWriteError, fetchAgentUsage, fetchMemorySnapshot, newIdempotencyKey, reviewProposal, writeMemory,
  type MemoryProposal,
} from '@/lib/companyBrain/memoryApi';
import {
  ADD_OPTIONS, AGENT_USE, buildAddPayload, buildEditPayload, buildSections, buildTimeline, proposalSummary,
  type AddKind, type MemoryCard,
} from '@/lib/companyBrain/memoryView';

interface Props {
  workspaceId: string;
  canEdit: boolean;
}

const fail = (e: unknown) => toast.error(e instanceof MemoryWriteError ? e.message : 'Something went wrong. Nothing was changed.');

export function BrainMemoryPanel({ workspaceId, canEdit }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ['brain-memory', workspaceId];
  const q = useQuery({ queryKey: key, queryFn: () => fetchMemorySnapshot(workspaceId), staleTime: 15_000, retry: (n, e) => !(e instanceof MemoryUnavailableError) && n < 2 });
  const sections = useMemo(() => (q.data ? buildSections(q.data) : null), [q.data]);
  const timeline = useMemo(() => (q.data ? buildTimeline(q.data, user?.id ?? null) : []), [q.data, user?.id]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['brain-memory-usage', workspaceId] });
    void qc.invalidateQueries({ queryKey: ['company-brain'] });
  };

  if (q.isLoading) {
    return (
      <section aria-label="Company memory" aria-busy="true" className="mt-8 space-y-3">
        <Skeleton className="h-6 w-48" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" />
      </section>
    );
  }
  if (q.error instanceof MemoryUnavailableError) {
    return (
      <section aria-label="Company memory" className="mt-8 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <div className="font-medium text-foreground">Company memory</div>
        Memory (history, decisions and agent suggestions) is not enabled on this environment yet. Your profile above still works as before.
      </section>
    );
  }
  if (q.error || !sections || !q.data) {
    return (
      <section role="alert" aria-label="Company memory" className="mt-8 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4 text-sm">
        <span>Company memory could not load.</span>
        <Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>
      </section>
    );
  }

  const reviewCount = sections.pendingProposals.length + sections.needsReview.length;
  return (
    <section aria-labelledby="brain-memory-title" className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="brain-memory-title" className="text-lg font-semibold">Company memory</h2>
          <p className="text-sm text-muted-foreground">
            What your team decided, prefers and confirmed. Agents use {sections.servedCount} confirmed item{sections.servedCount === 1 ? '' : 's'}; suggestions stay untrusted until someone approves them.
          </p>
        </div>
        {canEdit ? <AddMemoryButton workspaceId={workspaceId} onDone={refresh} /> : (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ShieldAlert className="h-3.5 w-3.5" aria-hidden /> View only — your role cannot change memory</span>
        )}
      </div>
      <Tabs defaultValue={reviewCount ? 'review' : 'preferences'}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="review">Needs review{reviewCount ? ` (${reviewCount})` : ''}</TabsTrigger>
          <TabsTrigger value="preferences">Preferences ({sections.preferences.length})</TabsTrigger>
          <TabsTrigger value="decisions">Decisions ({sections.decisions.length})</TabsTrigger>
          <TabsTrigger value="facts">Facts ({sections.facts.length})</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="agents">How agents use it</TabsTrigger>
        </TabsList>

        <TabsContent value="review" className="space-y-3">
          {sections.pendingProposals.length === 0 && sections.needsReview.length === 0 && (
            <Empty text="Nothing needs your review. Agent suggestions and out-of-date items will appear here." />
          )}
          {sections.pendingProposals.map((p) => (
            <ProposalCard key={p.id} p={p} workspaceId={workspaceId} canEdit={canEdit} onDone={refresh}
              contradicts={p.contradicts_memory_id ? q.data.items.find((i) => i.id === p.contradicts_memory_id) ?? null : null} />
          ))}
          {sections.needsReview.map((c) => <ItemCard key={c.id} card={c} workspaceId={workspaceId} canEdit={canEdit} onDone={refresh} />)}
        </TabsContent>
        <TabsContent value="preferences" className="space-y-3">
          {sections.preferences.length === 0 && <Empty text="No preferences yet. Add exclusions, a target size or a content tone, and every agent will follow them." />}
          {sections.preferences.map((c) => <ItemCard key={c.id} card={c} workspaceId={workspaceId} canEdit={canEdit} onDone={refresh} />)}
        </TabsContent>
        <TabsContent value="decisions" className="space-y-3">
          {sections.decisions.length === 0 && <Empty text="No decisions recorded yet. Rejecting a lead or dismissing a signal is remembered here — for that record only." />}
          {sections.decisions.map((c) => <ItemCard key={c.id} card={c} workspaceId={workspaceId} canEdit={canEdit} onDone={refresh} />)}
        </TabsContent>
        <TabsContent value="facts" className="space-y-3">
          {sections.facts.length === 0 && <Empty text="No confirmed facts beyond your profile yet. Approved agent suggestions and facts you add appear here." />}
          {sections.facts.map((c) => <ItemCard key={c.id} card={c} workspaceId={workspaceId} canEdit={canEdit} onDone={refresh} />)}
          {sections.archived.length > 0 && (
            <details className="rounded-lg border border-border p-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Retracted and superseded ({sections.archived.length}) — kept for the record, never used by agents</summary>
              <div className="mt-3 space-y-2">{sections.archived.map((c) => <ItemCard key={c.id} card={c} workspaceId={workspaceId} canEdit={false} onDone={refresh} />)}</div>
            </details>
          )}
        </TabsContent>
        <TabsContent value="history">
          {timeline.length === 0 ? <Empty text="No changes recorded yet." /> : (
            <ol className="space-y-2 text-sm" aria-label="Change history">
              {timeline.slice(0, 100).map((t) => (
                <li key={t.id} className="rounded-lg border border-border px-3 py-2">
                  <div><span className="font-medium">{t.who}</span> {t.text}</div>
                  {t.detail && <div className="text-muted-foreground">{t.detail}</div>}
                  <time className="text-xs text-muted-foreground" dateTime={t.at}>{new Date(t.at).toLocaleString()}</time>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
        <TabsContent value="agents"><AgentUsage workspaceId={workspaceId} /></TabsContent>
      </Tabs>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{text}</div>;
}

function ItemCard({ card, workspaceId, canEdit, onDone }: { card: MemoryCard; workspaceId: string; canEdit: boolean; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.value);
  const [idem] = useState(newIdempotencyKey);
  const life = useMutation({
    mutationFn: (op: 'retract' | 'dispute' | 'reactivate') =>
      writeMemory(workspaceId, op, { memory_id: card.id, expected_version: card.version }),
    onSuccess: (_r, op) => { toast.success(op === 'retract' ? 'Retracted — agents no longer use it.' : op === 'dispute' ? 'Marked disputed — agents stop using it until it is confirmed.' : 'Confirmed.'); onDone(); },
    onError: (e) => { fail(e); onDone(); },
  });
  const save = useMutation({
    mutationFn: () => {
      const built = buildEditPayload(card, draft);
      if ('error' in built) throw new MemoryWriteError('invalid', built.error);
      return writeMemory(workspaceId, 'correct', built.payload, idem);
    },
    onSuccess: () => { toast.success('Saved. The previous value is kept in history.'); setEditing(false); onDone(); },
    onError: (e) => { fail(e); if (e instanceof MemoryWriteError && e.outcome === 'stale') onDone(); },
  });
  const busy = life.isPending || save.isPending;
  return (
    <article className="rounded-xl border border-border p-3" aria-label={card.title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.title}</div>
          {editing ? (
            <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`New value for ${card.title}`} autoFocus />
              <Button size="sm" type="submit" disabled={busy}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => { setEditing(false); setDraft(card.value); }}>Cancel</Button>
            </form>
          ) : <div className="mt-0.5 break-words">{card.value}</div>}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{card.provenance}</span>
            {card.scopeLabel && <span>· {card.scopeLabel}</span>}
            <span>· v{card.version} · {new Date(card.updatedAt).toLocaleDateString()}</span>
            {card.sourceUrl && <a className="inline-flex items-center gap-0.5 underline" href={card.sourceUrl} target="_blank" rel="noreferrer noopener">source <ExternalLink className="h-3 w-3" aria-hidden /></a>}
          </div>
        </div>
        {card.statusLabel && <Badge variant={card.status === 'disputed' || card.status === 'stale' ? 'outline' : 'secondary'}>{card.statusLabel}</Badge>}
      </div>
      {canEdit && card.actionable && !editing && (
        <div className="mt-2 flex flex-wrap gap-2">
          {card.kind !== 'decision' && <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>Correct</Button>}
          {(card.status === 'stale' || card.status === 'disputed') && <Button size="sm" variant="outline" disabled={busy} onClick={() => life.mutate('reactivate')}>Still true</Button>}
          {card.status === 'active' && card.kind !== 'decision' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => life.mutate('dispute')}>Dispute</Button>}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => life.mutate('retract')}>{card.kind === 'decision' ? 'Undo decision' : 'Retract'}</Button>
        </div>
      )}
    </article>
  );
}

function ProposalCard({ p, workspaceId, canEdit, onDone, contradicts }: {
  p: MemoryProposal; workspaceId: string; canEdit: boolean; onDone: () => void;
  contradicts: { id: string; version: number; value: unknown; value_type: string } | null;
}) {
  const s = proposalSummary(p);
  const [correcting, setCorrecting] = useState(false);
  const [draft, setDraft] = useState(s.value);
  const [idem] = useState(newIdempotencyKey);
  const act = useMutation({
    mutationFn: (decision: 'approve' | 'correct' | 'reject') => {
      let corrected: unknown;
      if (decision === 'correct') {
        corrected = p.value_type === 'object' && p.value && typeof p.value === 'object'
          ? { ...(p.value as Record<string, unknown>), name: draft.trim() }
          : p.value_type === 'list' ? draft.split(',').map((x) => x.trim()).filter(Boolean) : draft.trim();
      }
      return reviewProposal(workspaceId, p.id, decision, {
        correctedValue: corrected, expectedMemoryVersion: contradicts?.version ?? null, idempotencyKey: idem,
      });
    },
    onSuccess: (_r, d) => { toast.success(d === 'reject' ? 'Rejected — it will not be suggested again.' : 'Approved — agents can now use it.'); onDone(); },
    onError: (e) => { fail(e); onDone(); },
  });
  return (
    <article className="rounded-xl border border-primary/30 bg-primary/5 p-3" aria-label={`Suggestion: ${s.title}`}>
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Suggested: {s.title}</div>
          {correcting ? (
            <Input className="mt-1" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Corrected value" autoFocus />
          ) : <div className="mt-0.5 break-words font-medium">{s.value}</div>}
          <p className="mt-1 text-sm">{p.rationale}</p>
          {contradicts && <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">This disagrees with what your Brain says now. Approving replaces it; the old value stays in history.</p>}
          <div className="mt-1 text-xs text-muted-foreground">{s.provenance}</div>
          {p.evidence?.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {p.evidence.slice(0, 5).map((e, i) => (
                <li key={i}>{e.source_url ? <a className="underline" href={e.source_url} target="_blank" rel="noreferrer noopener">{e.source_url}</a> : e.excerpt ?? e.source_ref}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {canEdit ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {correcting ? (
            <>
              <Button size="sm" disabled={act.isPending} onClick={() => act.mutate('correct')}>Save correction</Button>
              <Button size="sm" variant="ghost" onClick={() => setCorrecting(false)}>Cancel</Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={act.isPending} onClick={() => act.mutate('approve')}>Approve</Button>
              {p.value_type !== 'number_range' && <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => setCorrecting(true)}>Correct</Button>}
              <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate('reject')}>Reject</Button>
            </>
          )}
        </div>
      ) : <div className="mt-2 text-xs text-muted-foreground">An editor, admin or owner can approve or reject this.</div>}
    </article>
  );
}

function AddMemoryButton({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AddKind>('exclude_industry');
  const [value, setValue] = useState('');
  const [until, setUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [idem, setIdem] = useState(newIdempotencyKey);
  const hint = ADD_OPTIONS.find((o) => o.kind === kind)?.hint ?? '';
  const add = useMutation({
    mutationFn: () => {
      const built = buildAddPayload(kind, value, { temporaryUntil: until ? new Date(`${until}T23:59:59Z`).toISOString() : null });
      if ('error' in built) throw new MemoryWriteError('invalid', built.error);
      return writeMemory(workspaceId, 'set', built.payload, idem);
    },
    onSuccess: (r) => {
      toast.success(r.outcome === 'unchanged' ? 'Already saved.' : 'Saved. Every agent will use it from the next run.');
      setOpen(false); setValue(''); setUntil(''); setError(null); setIdem(newIdempotencyKey()); onDone();
    },
    onError: (e) => setError(e instanceof MemoryWriteError
      ? (e.outcome === 'stale' ? 'This already exists — edit it in the list instead.' : e.message)
      : 'Something went wrong. Nothing was changed.'),
  });
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Add to memory</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to company memory</DialogTitle>
            <DialogDescription>Saved as your team’s own statement. Every agent will follow it, and the change is kept in history.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(null); add.mutate(); }}>
            <Select value={kind} onValueChange={(v) => { setKind(v as AddKind); setError(null); }}>
              <SelectTrigger aria-label="What to add"><SelectValue /></SelectTrigger>
              <SelectContent>{ADD_OPTIONS.map((o) => <SelectItem key={o.kind} value={o.kind}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={hint} aria-label="Value" autoFocus />
            {kind !== 'product' && (
              <label className="block text-sm text-muted-foreground">
                Temporary until (optional)
                <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-1" aria-label="Expires on" />
              </label>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={add.isPending}>{add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AgentUsage({ workspaceId }: { workspaceId: string }) {
  const q = useQuery({ queryKey: ['brain-memory-usage', workspaceId], queryFn: () => fetchAgentUsage(workspaceId), staleTime: 30_000 });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Each agent receives your profile plus the confirmed memory below. Stale, disputed, retracted and unapproved items are never included.</p>
      {AGENT_USE.map((a) => (
        <details key={a.id} className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer"><span className="font-medium">{a.name}</span> <span className="text-sm text-muted-foreground">— {a.uses}</span></summary>
          {q.isLoading ? <Skeleton className="mt-2 h-16 w-full" /> : q.error ? (
            <p className="mt-2 text-sm text-muted-foreground">Could not load what {a.name} receives right now.</p>
          ) : (
            <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/40 p-2 text-xs">{q.data?.agents?.[a.id] ?? ''}</pre>
          )}
        </details>
      ))}
    </div>
  );
}
