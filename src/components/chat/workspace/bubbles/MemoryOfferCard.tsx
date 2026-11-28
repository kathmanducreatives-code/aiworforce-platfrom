// Company Brain V2 · B2.3 — ORION's offer to remember something you said.
// Rendered when the server attached `metadata.memory_offer` (pilot-chat). The
// proposal's LIVE status is read from the database, so a reload, another tab or
// a teammate's review shows what actually happened. Remembering is a person's
// approval (company-brain-memory review_proposal); "Not now" leaves it in the
// review queue; "Don't remember" rejects it and ORION will not offer it again.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Check, Clock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkspaceRole } from '@/hooks/useWorkspaceRole';
import { MemoryWriteError, fetchProposal, newIdempotencyKey, reviewProposal } from '@/lib/companyBrain/memoryApi';
import { correctedProposalValue, editableProposalText, formatValue } from '@/lib/companyBrain/memoryView';
import { readMemoryOffer } from '@/lib/chat/memoryOffer';
import { ConflictConfirm } from '@/components/company-brain/memory/ConflictConfirm';

export default function MemoryOfferCard({ metadata }: { metadata: unknown }) {
  const offer = readMemoryOffer(metadata);
  const { workspaceId } = useWorkspace();
  const { canEditBrain } = useWorkspaceRole();
  const qc = useQueryClient();
  const proposalId = offer?.status === 'pending' ? offer.proposal_id : null;
  const live = useQuery({
    queryKey: ['memory-offer', workspaceId, proposalId],
    enabled: !!workspaceId && !!proposalId,
    queryFn: () => fetchProposal(workspaceId as string, proposalId as string),
    staleTime: 10_000,
    retry: false,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [later, setLater] = useState(false);
  const [conflict, setConflict] = useState<{ text: string; decision: 'approve' | 'correct' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idem] = useState(() => ({ approve: newIdempotencyKey(), correct: newIdempotencyKey(), reject: newIdempotencyKey() }));
  const act = useMutation({
    mutationFn: ({ decision, confirm }: { decision: 'approve' | 'correct' | 'reject'; confirm?: boolean }) => {
      let corrected: unknown;
      if (decision === 'correct' && live.data) {
        const c = correctedProposalValue(live.data, draft);
        if (!c.ok) throw new MemoryWriteError('invalid', (c as { error: string }).error);
        corrected = (c as { value: unknown }).value;
      }
      return reviewProposal(workspaceId as string, proposalId as string, decision, {
        correctedValue: corrected, idempotencyKey: idem[decision], confirmConflict: confirm,
        expectedMemoryVersion: live.data?.contradicts_version ?? null,
        note: decision === 'reject' ? 'Declined in chat' : 'Approved in chat',
      });
    },
    onSuccess: () => { setError(null); setEditing(false); refresh(); },
    onError: (e, v) => {
      if (e instanceof MemoryWriteError && e.outcome === 'needs_resolution' && v.decision !== 'reject') { setConflict({ text: e.conflict ?? e.message, decision: v.decision }); return; }
      setError(e instanceof MemoryWriteError ? e.message : 'Something went wrong. Nothing was changed.');
      refresh();
    },
  });
  function refresh() {
    void qc.invalidateQueries({ queryKey: ['memory-offer', workspaceId, proposalId] });
    void qc.invalidateQueries({ queryKey: ['brain-memory', workspaceId] });
    void qc.invalidateQueries({ queryKey: ['brain-memory-pending', workspaceId] });
  }

  if (!offer || offer.status === 'temporary' || offer.status === 'already_known') return null;
  const status = live.data?.status ?? 'pending';
  const done = status === 'approved' || status === 'corrected' ? 'remembered' : status === 'rejected' ? 'declined' : status === 'withdrawn' ? 'withdrawn' : null;

  return (
    <div data-testid="memory-offer" data-status={done ?? (later ? 'later' : 'pending')}
      className="mt-1.5 max-w-[720px] rounded-xl border border-emerald-300/25 bg-emerald-300/[0.06] px-3 py-2.5 text-[13px] text-[#ECE9E4]">
      <div className="flex items-start gap-2">
        <BookmarkPlus className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-emerald-200/80">
            {offer.kind === 'decision' ? 'Business decision' : 'Lasting preference'} · suggested by ORION
          </div>
          {editing
            ? <Input className="mt-1 h-8" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Edit before remembering" autoFocus />
            : <div className="mt-0.5 font-medium">{done === 'remembered' && live.data?.remembered && status === 'corrected'
              ? formatValue(live.data.remembered.value_type, live.data.remembered.value) : offer.summary}</div>}
          {done === 'remembered' && <p className="mt-1 inline-flex items-center gap-1 text-emerald-200"><Check className="h-3.5 w-3.5" aria-hidden />{status === 'corrected' ? 'Remembered with your edit.' : 'Remembered.'} Every agent uses it from its next run.</p>}
          {done === 'declined' && <p className="mt-1 inline-flex items-center gap-1 text-[#9aa4af]"><X className="h-3.5 w-3.5" aria-hidden />Not remembered. ORION will not suggest it again.</p>}
          {done === 'withdrawn' && <p className="mt-1 text-[#9aa4af]">This suggestion was withdrawn.</p>}
          {!done && later && <p className="mt-1 inline-flex items-center gap-1 text-[#9aa4af]"><Clock className="h-3.5 w-3.5" aria-hidden />Waiting in your Company Brain review queue.</p>}
          {!done && !later && conflict && (
            <div className="mt-2 text-foreground">
              <ConflictConfirm conflict={conflict.text} busy={act.isPending}
                onConfirm={() => { const d = conflict.decision; setConflict(null); act.mutate({ decision: d, confirm: true }); }}
                onCancel={() => setConflict(null)} />
            </div>
          )}
          {!done && !later && !conflict && offer.conflict && <p className="mt-1 text-amber-200/90">{offer.conflict}</p>}
          {error && <p role="alert" className="mt-1 text-red-300">{error}</p>}
          {!done && !later && !conflict && (canEditBrain ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {editing ? (
                <>
                  <Button size="sm" disabled={act.isPending || !live.data} onClick={() => act.mutate({ decision: 'correct' })}>Remember this version</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                </>
              ) : (
                <>
                  <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ decision: 'approve' })}>Remember</Button>
                  <Button size="sm" variant="outline" disabled={act.isPending || !live.data}
                    onClick={() => { setDraft(live.data ? editableProposalText(live.data) : ''); setEditing(true); }}>Edit</Button>
                  <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => setLater(true)}>Not now</Button>
                  <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ decision: 'reject' })}>Don’t remember</Button>
                </>
              )}
            </div>
          ) : <p className="mt-1 text-[#9aa4af]">An editor, admin or owner can approve this in the Company Brain.</p>)}
        </div>
      </div>
    </div>
  );
}
