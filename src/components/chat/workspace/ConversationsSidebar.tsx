import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAgents } from '@/hooks/useAgents';
import { useAllPlans } from '@/hooks/usePlans';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { profileById, DEPTS } from '@/lib/agentDeptIndex';
import { AGENT_PROFILES, deptDot, deptRing, deptText } from '@/data/agentProfiles';
import { Hash } from 'lucide-react';

type Filter = 'all' | 'active' | 'done';

const ACTIVE_STATUSES = new Set(['planning', 'executing', 'awaiting_approval']);
const DONE_STATUSES = new Set(['complete', 'failed']);

function PlanItem({ plan }: { plan: any }) {
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const { view, setView } = useChatWorkspace();
  const rel = useRelativeTime(plan.created_at);
  const active = view.kind === 'conversation' && view.planId === plan.id;
  const isRunning = ACTIVE_STATUSES.has(plan.status);

  // Best-effort dot color: first agent matching workspace
  const firstAgent = agents[0];
  const profile = profileById(agents, firstAgent?.id);

  return (
    <button
      onClick={() => setView({ kind: 'conversation', planId: plan.id })}
      className={cn(
        'w-full text-left px-2.5 py-2 rounded-md transition-colors group',
        active ? 'bg-primary/10 text-foreground' : 'hover:bg-foreground/5 text-foreground/90',
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn('mt-1.5 h-1.5 w-1.5 rounded-full shrink-0', profile ? deptDot[profile.department] : 'bg-muted-foreground')} />
        <div className="flex-1 min-w-0">
          <div className="text-xs line-clamp-1">{plan.user_instruction}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-muted-foreground/70">{rel}</span>
            {isRunning && <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function ConversationsSidebar({ wide }: { wide?: boolean }) {
  const { workspaceId } = useWorkspace();
  const { plans } = useAllPlans(workspaceId, 30);
  const { agents } = useAgents(workspaceId);
  const { view, setView } = useChatWorkspace();
  const [filter, setFilter] = useState<Filter>('all');

  const filteredPlans = useMemo(() => {
    if (filter === 'all') return plans;
    if (filter === 'active') return plans.filter((p) => ACTIVE_STATUSES.has(p.status));
    return plans.filter((p) => DONE_STATUSES.has(p.status));
  }, [plans, filter]);

  return (
    <aside className={cn(
      'shrink-0 border-r border-border/60 flex flex-col overflow-hidden bg-background/40',
      wide ? 'w-[260px]' : 'w-[220px]',
    )}>
      {/* Filters */}
      <div className="px-3 pt-3 pb-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Conversations</div>
        <div className="flex items-center gap-1 p-0.5 bg-foreground/5 rounded-md">
          {(['all', 'active', 'done'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'flex-1 text-[11px] capitalize py-1 rounded transition-colors',
                filter === f ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Plans list */}
      <div className="flex-1 overflow-y-auto px-2">
        {filteredPlans.length === 0 ? (
          <div className="text-xs text-muted-foreground/70 px-2 py-3">No conversations.</div>
        ) : (
          <ul className="space-y-0.5">
            {filteredPlans.map((p) => <li key={p.id}><PlanItem plan={p} /></li>)}
          </ul>
        )}
      </div>

      {/* Channels */}
      <div className="px-3 pt-3 pb-2 border-t border-border/60">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Channels</div>
        <ul className="space-y-0.5">
          {DEPTS.map((d) => {
            const active = view.kind === 'channel' && view.dept === d.id;
            return (
              <li key={d.id}>
                <button
                  onClick={() => setView({ kind: 'channel', dept: d.id })}
                  className={cn(
                    'w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors',
                    active ? 'bg-primary/10 text-foreground' : 'hover:bg-foreground/5 text-foreground/85',
                  )}
                >
                  <Hash className={cn('h-3 w-3', deptText[d.id])} />
                  <span>{d.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Team */}
      <div className="px-3 py-3 border-t border-border/60">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Your team</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {AGENT_PROFILES.map((a) => {
            const dbA = agents.find((x) => x.slug === a.id);
            const isRunning = dbA?.status === 'running';
            const active = view.kind === 'agent' && view.slug === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setView({ kind: 'agent', slug: a.id })}
                className="relative group"
                title={a.name}
              >
                <div className={cn(
                  'h-8 w-8 rounded-full overflow-hidden ring-2 transition-all',
                  active ? 'ring-primary' : deptRing[a.department],
                )}>
                  <img src={a.image} alt={a.name} className="h-full w-full object-cover" />
                </div>
                {isRunning && (
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 animate-pulse ring-2 ring-background" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
