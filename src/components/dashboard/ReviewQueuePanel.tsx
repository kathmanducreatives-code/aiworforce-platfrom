import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import AgentPortrait from '@/components/agents/AgentPortrait';
import { visualAgentKey } from '@/lib/agent3d/visualState';
import { formatAgo } from '@/lib/liveIntelligence';
import type { DBApproval } from '@/lib/orchestration';

/** The approval row as stored: `agent_slug` exists on the table even where the type omits it. */
type ApprovalRow = DBApproval & { agent_slug?: string | null };

/**
 * YOUR REVIEW QUEUE — pending approvals from the live `approvals` table
 * (useApprovals, realtime). Longest-waiting first: nothing ranks approvals, so
 * waiting time is the only honest order. Every row opens Awaiting You, where
 * the existing approve / reject flow happens; nothing is approved from here.
 */
export default function ReviewQueuePanel({ approvals, loading }: { approvals: readonly DBApproval[]; loading: boolean }) {
  const navigate = useNavigate();
  const now = Date.now();
  const pending = [...(approvals as ApprovalRow[])]
    .filter((a) => a.status === 'pending')
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const n = pending.length;

  return (
    <section className="team-panel team-panel--ops team-review" aria-label="Your review queue">
      <div className="team-panel-header">
        <h2>Your review queue</h2>
        <span className="team-eyebrow">Human approved</span>
      </div>

      {loading ? (
        <p className="team-review-copy">Checking for decisions…</p>
      ) : n === 0 ? (
        <div className="team-review__clear">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          <div>
            <p className="team-review__title">All caught up</p>
            <p className="team-review-copy">Nothing is waiting on you. New decisions appear here before any work continues.</p>
          </div>
        </div>
      ) : (
        <>
          <p className="team-review__summary"><b>{n}</b> {n === 1 ? 'decision is' : 'decisions are'} waiting{n > 3 ? ' · longest first' : ''}</p>
          <ul className="team-review__list">
            {pending.slice(0, 3).map((a) => {
              const agent = visualAgentKey(a.agent_slug);
              const ago = formatAgo(a.created_at, now);
              return (
                <li key={a.id}>
                  <button type="button" onClick={() => navigate('/awaiting-you')} className="team-review__row">
                    {agent ? <AgentPortrait agentId={agent} size={22} decorative /> : <span className="team-review__dot" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="team-review__row-title" title={a.title}>{a.title}</span>
                      {ago && <span className="team-review__row-meta">Waiting {ago.replace(' ago', '')}</span>}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {!loading && (
        <button className="ag-btn ag-btn-secondary mt-auto inline-flex h-8 items-center justify-between gap-3 rounded-lg px-3 text-[12px]" onClick={() => navigate('/awaiting-you')}>
          {n ? 'Review all' : 'Open approvals'} <ArrowRight size={13} />
        </button>
      )}
    </section>
  );
}
