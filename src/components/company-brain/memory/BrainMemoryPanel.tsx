// Company Brain — MEMORY: what the team decided, prefers and confirmed, what
// agents suggested, and how all of it changed over time.
//
// Reads over RLS (memoryApi.fetchMemorySnapshot); writes through the
// company-brain-memory edge function. Viewers see everything and can change
// nothing (the server refuses them too). Every write carries an idempotency
// key, so a double-click is one change.
import { useEffect, useMemo, useState } from 'react';
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
  AGENT_USE, buildEditPayload, buildSections, buildTimeline, correctedProposalValue, editableProposalText, proposalSummary,
  type MemoryCard,
} from '@/lib/companyBrain/memoryView';
import { TeachAgentoryButton } from './TeachAgentoryDialog';
import { ConflictConfirm } from './ConflictConfirm';

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
  // Arriving from the dashboard's "Review in Company Brain": bring the review queue into view once it renders.
  const loaded = !!q.data;
  useEffect(() => {
    if (loaded && typeof window !== 'undefined' && window.location.hash === '#brain-memory') {
      document.getElementById('brain-memory')?.scrollIntoView({ block: 'start' });
    }
  }, [loaded]);
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
    <section id="brain-memory" aria-labelledby="brain-memory-title" className="mt-8 scroll-mt-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="brain-memory-title" className="text-lg font-semibold">What Agentory knows</h2>
          <p className="text-sm text-muted-foreground">
            What your team decided, prefers and confirmed. Agents use {sections.servedCount} confirmed item{sections.servedCount === 1 ? '' : 's'}; anything an agent suggests waits for a person to approve it.
          </p>
        </div>
        {canEdit ? <TeachAgentoryButton workspaceId={workspaceId} onDone={refresh} /> : (
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
            <span>· {card.freshness} · v{card.version}</span>
            {card.sourceUrl && <a className="inline-flex items-center gap-0.5 underline" href={card.sourceUrl} target="_blank" rel="noreferrer noopener">source <ExternalLink className="h-3 w-3" aria-hidden /></a>}
          </div>
          {card.usedBy.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground" aria-label="Used by">
              <span>Used by</span>
              {card.usedBy.map((a) => <span key={a} className="rounded-full border border-border px-1.5 py-px text-[10.5px] tracking-wide">{a}</span>)}
            </div>
          )}
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
  const [draft, setDraft] = useState(() => editableProposalText(p));
  const [conflict, setConflict] = useState<{ text: string; decision: 'approve' | 'correct' } | null>(null);
  // One key per decision: a double-click, a retry or a second tab records ONE outcome.
  const [idem] = useState(() => ({ approve: newIdempotencyKey(), correct: newIdempotencyKey(), reject: newIdempotencyKey() }));
  const act = useMutation({
    mutationFn: ({ decision, confirm }: { decision: 'approve' | 'correct' | 'reject'; confirm?: boolean }) => {
      let corrected: unknown;
      if (decision === 'correct') {
        const c = correctedProposalValue(p, draft);
        if (!c.ok) throw new MemoryWriteError('invalid', (c as { error: string }).error);
        corrected = (c as { value: unknown }).value;
      }
      return reviewProposal(workspaceId, p.id, decision, {
        correctedValue: corrected, expectedMemoryVersion: contradicts?.version ?? null, idempotencyKey: idem[decision], confirmConflict: confirm,
      });
    },
    onSuccess: (_r, v) => { toast.success(v.decision === 'reject' ? 'Rejected — it will not be suggested again.' : 'Remembered — every agent uses it from its next run.'); onDone(); },
    onError: (e, v) => {
      if (e instanceof MemoryWriteError && e.outcome === 'needs_resolution' && v.decision !== 'reject') { setConflict({ text: e.conflict ?? e.message, decision: v.decision }); return; }
      fail(e); onDone();
    },
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
      {conflict && (
        <div className="mt-2">
          <ConflictConfirm conflict={conflict.text} busy={act.isPending}
            onConfirm={() => { const d = conflict.decision; setConflict(null); act.mutate({ decision: d, confirm: true }); }}
            onCancel={() => setConflict(null)} />
        </div>
      )}
      {canEdit && !conflict ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {correcting ? (
            <>
              <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ decision: 'correct' })}>Save and remember</Button>
              <Button size="sm" variant="ghost" onClick={() => setCorrecting(false)}>Cancel</Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ decision: 'approve' })}>Approve</Button>
              <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => setCorrecting(true)}>Edit</Button>
              <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ decision: 'reject' })}>Reject</Button>
            </>
          )}
        </div>
      ) : !canEdit ? <div className="mt-2 text-xs text-muted-foreground">An editor, admin or owner can approve or reject this.</div> : null}
    </article>
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
