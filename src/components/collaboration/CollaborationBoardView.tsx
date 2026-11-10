// The multi-agent collaboration board: what LISA found, why it matters, what
// ORION recommends, which agent acts, what needs your approval, and what has
// been done. Presentational only — it renders a CollaborationBoard (built by
// _shared/collab/board.ts) and calls `onDecide` if the host wires it. It never
// executes anything itself.
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, Hourglass, ShieldCheck, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { BoardAction, CollaborationBoard } from '../../../supabase/functions/_shared/collab/board';

const AGENT: Record<string, string> = { lisa: 'LISA', orion: 'ORION', atlas: 'ATLAS', lyra: 'LYRA' };

function StatusIcon({ status }: { status: BoardAction['status'] }) {
  if (status === 'completed' || status === 'partially_completed') return <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />;
  if (status === 'failed' || status === 'blocked' || status === 'rejected' || status === 'cancelled') return <XCircle className="h-4 w-4 text-rose-400" aria-hidden />;
  if (status === 'awaiting_review') return <Hourglass className="h-4 w-4 text-amber-300" aria-hidden />;
  return <CircleDashed className="h-4 w-4 text-sky-300" aria-hidden />;
}

export interface CollaborationBoardViewProps {
  board: CollaborationBoard;
  /** Wire to the agent-collaboration endpoint's `decide`; omitted in previews. */
  onDecide?: (handoffId: string, decision: 'approve' | 'reject') => void;
  busy?: boolean;
}

export function CollaborationBoardView({ board, onDecide, busy }: CollaborationBoardViewProps) {
  return (
    <div className="space-y-4" data-testid="collaboration-board">
      <div className="flex flex-wrap gap-2 text-xs" data-testid="collaboration-summary">
        <Badge variant="outline">Company Brain: {board.brain.status}</Badge>
        <Badge variant="outline" data-testid="awaiting-count">Awaiting you: {board.awaiting_you}</Badge>
        <Badge variant="outline">In progress: {board.in_progress}</Badge>
        <Badge variant="outline">Completed: {board.completed}</Badge>
        {board.problems > 0 && <Badge variant="destructive">Problems: {board.problems}</Badge>}
      </div>
      {board.brain.goals.length > 0 && (
        <p className="text-xs text-muted-foreground">Priorities from your Company Brain: {board.brain.goals.join(' · ')}</p>
      )}
      {board.items.length === 0 && <p className="text-sm text-muted-foreground">No signals from LISA yet.</p>}
      {board.items.map((it) => (
        <article key={it.signal_id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4" data-testid="collaboration-item">
          <header className="flex flex-wrap items-center gap-2">
            <Badge>Found by {AGENT[it.discovered_by]}</Badge>
            <Badge variant="outline" data-testid="verification">{it.verification}</Badge>
            {it.trusted
              ? <Badge variant="outline" className="border-emerald-400/40 text-emerald-300"><ShieldCheck className="mr-1 h-3 w-3" />Usable for recommendations</Badge>
              : <Badge variant="outline" className="border-amber-400/40 text-amber-200"><AlertTriangle className="mr-1 h-3 w-3" />Not used for recommendations</Badge>}
            <span className="ml-auto text-sm font-semibold">{it.company}</span>
          </header>
          <dl className="mt-3 grid gap-2 text-sm">
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">What happened (confirmed)</dt><dd data-testid="what-happened">{it.what_happened}</dd></div>
            {it.inferred_opportunity && (
              <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">What it might mean (ORION's inference)</dt><dd data-testid="inferred">{it.inferred_opportunity}</dd></div>
            )}
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Why it matters</dt><dd>{it.why_it_matters}</dd></div>
            {it.blocked && <div className="text-amber-200" data-testid="blocked">{it.blocked}</div>}
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Evidence</dt>
              <dd className="flex flex-col gap-0.5" data-testid="evidence">
                {it.evidence.filter((e) => e.url).map((e) => (
                  <a key={e.url!} href={e.url!} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sky-300 hover:underline">
                    <ExternalLink className="h-3 w-3" />{e.url}
                  </a>
                ))}
              </dd>
            </div>
          </dl>
          {it.actions.length > 0 && (
            <ul className="mt-3 space-y-2" data-testid="actions">
              {it.actions.map((a) => (
                <li key={`${a.kind}-${a.handoff_id ?? 'new'}`} className="rounded-lg border border-white/10 p-3" data-testid={`action-${a.kind}`}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusIcon status={a.status} />
                    <span className="font-medium">{AGENT[a.agent]}</span>
                    <span>{a.action}</span>
                    <Badge variant="outline" className="ml-auto" data-testid="action-status">{a.status_label}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Approval: {a.approval}</p>
                  {a.done && <p className="mt-1 text-xs" data-testid="action-done">{a.done}</p>}
                  {a.error && <p className="mt-1 text-xs text-rose-300">{a.error}</p>}
                  {(a.stale_context || a.no_longer_recommended) && (
                    <p className="mt-1 text-xs text-amber-200">Your Company Brain changed since this was proposed — re-check before approving.</p>
                  )}
                  {onDecide && a.handoff_id && a.status === 'awaiting_review' && !a.no_longer_recommended && (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" disabled={busy} onClick={() => onDecide(a.handoff_id!, 'approve')}>Approve</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide(a.handoff_id!, 'reject')}>Reject</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}

export default CollaborationBoardView;
