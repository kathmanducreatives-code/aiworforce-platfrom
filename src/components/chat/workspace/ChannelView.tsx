import { useMemo } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAgents } from '@/hooks/useAgents';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useAllPlans } from '@/hooks/usePlans';
import { profileById, agentsForDept } from '@/lib/agentDeptIndex';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { cn } from '@/lib/utils';
import { deptDot, deptText, type AgentDept } from '@/data/agentProfiles';
import { Hash } from 'lucide-react';

const DEPT_DESC: Record<AgentDept, string> = {
  talent: 'Sourcing, screening, and hiring activity',
  growth: 'Outreach, leads, revenue motion',
  intelligence: 'Market and competitor signals',
  content: 'Posts, articles, and narratives',
  operations: 'Operational coordination',
};

function ActivityRow({ ev, agentId }: { ev: any; agentId: string | null }) {
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const { setView } = useChatWorkspace();
  const profile = profileById(agents, agentId);
  const rel = useRelativeTime(ev.created_at);
  const dept = profile?.department ?? 'operations';

  return (
    <button
      onClick={() => ev.plan_id && setView({ kind: 'conversation', planId: ev.plan_id })}
      className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-foreground/5 transition-colors"
    >
      <div className={cn('h-7 w-7 rounded-full ring-2 overflow-hidden bg-card border border-border/60 shrink-0',
        `ring-offset-0`)}>
        {profile?.image ? <img src={profile.image} alt="" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('text-xs font-semibold', deptText[dept])}>{profile?.name ?? 'System'}</span>
          <span className="text-[10px] text-muted-foreground">{rel}</span>
        </div>
        <div className="text-sm text-foreground/90 truncate">{ev.title}</div>
        {ev.body && <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{ev.body}</div>}
      </div>
    </button>
  );
}

export default function ChannelView({ dept }: { dept: AgentDept }) {
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const { events } = useActivityFeed(workspaceId, 100);
  const { plans } = useAllPlans(workspaceId, 30);

  const deptAgents = useMemo(() => agentsForDept(agents, dept), [agents, dept]);
  const deptAgentIds = useMemo(() => new Set(deptAgents.map((a) => a.id)), [deptAgents]);

  const filtered = useMemo(
    () => events.filter((e) => e.agent_id && deptAgentIds.has(e.agent_id)).reverse(),
    [events, deptAgentIds],
  );

  const running = deptAgents.filter((a) => a.status === 'running');
  const idle = deptAgents.length - running.length;

  const activePlan = plans.find(
    (p) => ['planning', 'executing', 'awaiting_approval'].includes(p.status),
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/60 space-y-2">
        <div className="flex items-center gap-2">
          <Hash className={cn('h-5 w-5', deptText[dept])} />
          <h2 className="text-lg font-semibold text-foreground">{dept}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{DEPT_DESC[dept]}</p>
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            {deptAgents.map((a) => {
              const p = profileById([a], a.id) ?? profileById(agents, a.id);
              return (
                <div key={a.id} className="h-7 w-7 rounded-full ring-2 ring-background border border-border/60 bg-card overflow-hidden">
                  {p?.image && <img src={p.image} alt="" className="h-full w-full object-cover" />}
                </div>
              );
            })}
          </div>
          <span className="text-xs text-muted-foreground">
            {running.length > 0
              ? `${running.length} agent${running.length > 1 ? 's' : ''} running`
              : `${idle} agent${idle === 1 ? '' : 's'} idle`}
          </span>
        </div>
      </div>

      {/* Pinned active plan */}
      {activePlan && (
        <div className="mx-6 mt-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-widest text-primary font-semibold mb-0.5">Active plan</div>
          <div className="text-sm text-foreground truncate">{activePlan.user_instruction}</div>
        </div>
      )}

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            No activity in this channel yet.
          </div>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((ev) => (
              <ActivityRow key={ev.id} ev={ev} agentId={ev.agent_id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
