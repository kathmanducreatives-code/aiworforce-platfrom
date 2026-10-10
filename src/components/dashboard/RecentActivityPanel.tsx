import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import AgentPortrait from '@/components/agents/AgentPortrait';
import { lookupPublicAgent } from '@/config/agentRegistry';
import { useRecentActivity } from '@/hooks/useRecentActivity';
import { agentName, type ActivityItem } from '@/lib/activity/activityFeedModel';
import { formatAgo } from '@/lib/liveIntelligence';

/**
 * RECENT ACTIVITY — the live timeline. Every line comes from a stored backend
 * row (see activityFeedModel.ts); nothing here is sample data. A line opens its
 * signal, plan or approval when a destination exists.
 */
export default function RecentActivityPanel({ workspaceId, pulse }: { workspaceId: string | null; pulse: boolean }) {
  const navigate = useNavigate();
  const { items, state, live, arrivedKey, retry } = useRecentActivity(workspaceId, 4);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);

  return (
    <section className="team-panel team-panel--ops team-activity-panel" data-pulse={pulse ? 'true' : undefined} aria-label="Recent activity">
      <div className="team-panel-header">
        <h2 className="flex items-center gap-2">
          Recent activity
          {state === 'ready' && live === 'live' && <span className="team-live" title="Updates arrive as your team works"><i />Live</span>}
          {state === 'ready' && live === 'offline' && <span className="team-live team-live--off" title="Live updates paused — refreshing every minute"><i />Reconnecting</span>}
        </h2>
        <button onClick={() => navigate('/workflows')}>View all <ArrowUpRight size={12} className="inline" /></button>
      </div>

      {state === 'loading' && (
        <ol className="team-timeline team-timeline--skeleton" aria-label="Loading activity">
          {[62, 48, 55].map((w, i) => (
            <li className="team-activity" key={i}>
              <span className="team-timeline__node"><span className="team-skel team-skel--avatar" /></span>
              <div className="min-w-0 flex-1"><span className="team-skel" style={{ width: `${w}%` }} /><span className="team-skel team-skel--sub" /></div>
            </li>
          ))}
        </ol>
      )}

      {state === 'error' && (
        <div className="team-feed-note" role="status">
          <p>Activity couldn’t load right now.</p>
          <button onClick={retry}>Try again</button>
        </div>
      )}

      {state === 'ready' && items.length === 0 && (
        <div className="team-feed-note">
          <p><b>No activity yet.</b> When your team plans a mission, finds a signal or prepares a draft, it appears here as it happens.</p>
        </div>
      )}

      {state === 'ready' && items.length > 0 && (
        <ol className="team-timeline team-timeline--live">
          {items.map((item) => <ActivityLine key={item.key} item={item} now={now} fresh={item.key === arrivedKey} onOpen={item.route ? () => navigate(item.route!) : undefined} />)}
        </ol>
      )}
    </section>
  );
}

function ActivityLine({ item, now, fresh, onOpen }: { item: ActivityItem; now: number; fresh: boolean; onOpen?: () => void }) {
  const name = agentName(item.agent);
  const accent = lookupPublicAgent(item.agent)?.accentHex ?? '#10B981';
  const rest = item.action.startsWith(name) ? item.action.slice(name.length) : ` ${item.action}`;
  const lead = item.action.startsWith(name) ? name : '';
  const ago = formatAgo(item.at, now);
  const meta = [item.outcome, item.count > 1 && item.kind !== 'signal_discovered' ? `×${item.count}` : null].filter(Boolean).join(' · ');
  const body = (
    <>
      <span className="team-timeline__node" style={{ '--agent-accent': accent } as CSSProperties}>
        <AgentPortrait agentId={item.agent} size={26} decorative />
      </span>
      <span className="min-w-0 flex-1">
        <span className="team-activity__line">
          <span className="team-activity__action" title={item.action}>{lead && <b>{lead}</b>}{lead ? rest : item.action}</span>
          <time dateTime={item.at}>{ago}</time>
        </span>
        {item.detail && <span className="team-activity__detail" title={item.detail}>{item.detail}</span>}
        {meta && <span className="team-activity__outcome" data-tone={item.tone} title={meta}><i aria-hidden /><span>{meta}</span></span>}
      </span>
    </>
  );
  return (
    <li className="team-activity" data-fresh={fresh || undefined}>
      {onOpen
        ? <button type="button" className="team-activity__hit" onClick={onOpen} aria-label={`${item.action}${item.detail ? ` — ${item.detail}` : ''}. Open`}>{body}</button>
        : <div className="team-activity__hit">{body}</div>}
    </li>
  );
}
