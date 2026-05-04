import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAgents } from '@/hooks/useAgents';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { useUserConversations, type ChatConversationRow } from '@/hooks/useUserConversations';
import { DEPTS } from '@/lib/agentDeptIndex';
import { AGENT_PROFILES, AGENT_BY_ID } from '@/data/agentProfiles';

type Filter = 'all' | 'active' | 'done';

const ACTIVE_STATUSES = new Set(['planning', 'executing', 'awaiting_approval']);
const DONE_STATUSES = new Set(['complete', 'failed']);

const AGENT_HEX: Record<string, string> = {
  scout: '#3B82F6',
  aria: '#8B5CF6',
  penn: '#10B981',
  hawk: '#14B8A6',
  scribe: '#A855F7',
};

function InitialCircle({ slug, name, size = 24, active = false }: { slug: string; name: string; size?: number; active?: boolean }) {
  const hex = AGENT_HEX[slug] ?? '#7D8590';
  const alpha = active ? '40' : '26'; // 25% / 15%
  return (
    <div
      className="rounded-full flex items-center justify-center"
      style={{
        width: size,
        height: size,
        backgroundColor: `${hex}${alpha}`,
        color: hex,
        fontSize: size <= 20 ? 10 : 11,
        fontWeight: active ? 600 : 500,
        lineHeight: 1,
      }}
      aria-label={name}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function PlanItem({ plan }: { plan: any }) {
  const { view, setView } = useChatWorkspace();
  const rel = useRelativeTime(plan.created_at);
  const active = view.kind === 'conversation' && view.planId === plan.id;
  const isRunning = ACTIVE_STATUSES.has(plan.status);

  return (
    <button
      onClick={() => setView({ kind: 'conversation', planId: plan.id })}
      className={cn(
        'w-full text-left py-1.5 transition-colors group',
        active
          ? 'border-l-2 border-white pl-2 text-[#F0F6FC]'
          : 'pl-2.5 text-[#7D8590] hover:text-[#F0F6FC]',
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn('mt-1.5 h-1.5 w-1.5 rounded-full shrink-0', isRunning ? 'bg-[#10B981] animate-pulse' : 'bg-white/30')} />
        <div className="flex-1 min-w-0">
          <div className="text-xs line-clamp-1">{plan.user_instruction}</div>
          <div className="text-[10px] text-[#484F58] mt-0.5">{rel}</div>
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
    <aside
      className={cn(
        'shrink-0 border-r border-white/[0.06] flex flex-col overflow-hidden bg-background/40',
        wide ? 'w-[260px]' : 'w-[220px]',
      )}
    >
      {/* Filters */}
      <div className="px-3 pt-3 pb-2">
        <div className="text-[10px] uppercase tracking-widest text-[#484F58] mb-2">Conversations</div>
        <div className="flex items-center gap-3">
          {(['all', 'active', 'done'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'text-[12px] capitalize transition-colors duration-150',
                filter === f ? 'text-[#F0F6FC]' : 'text-[#7D8590] hover:text-[#F0F6FC]',
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
          <div className="text-xs text-[#484F58] px-2 py-3">No conversations.</div>
        ) : (
          <ul className="space-y-0.5">
            {filteredPlans.map((p) => (
              <li key={p.id}>
                <PlanItem plan={p} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Channels */}
      <div className="px-3 pt-3 pb-2 border-t border-white/[0.06]">
        <div className="text-[10px] uppercase tracking-widest text-[#484F58] mb-1">Channels</div>
        <ul className="space-y-0.5">
          {DEPTS.map((d) => {
            const active = view.kind === 'channel' && view.dept === d.id;
            return (
              <li key={d.id}>
                <button
                  onClick={() => setView({ kind: 'channel', dept: d.id })}
                  className={cn(
                    'w-full flex items-center gap-1.5 py-1.5 text-xs transition-colors duration-150',
                    active
                      ? 'border-l-2 border-white pl-2 text-[#F0F6FC]'
                      : 'pl-2.5 text-[#7D8590] hover:text-[#F0F6FC]',
                  )}
                >
                  <span>#</span>
                  <span>{d.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Team */}
      <div className="px-3 py-3 border-t border-white/[0.06]">
        <div className="text-[10px] uppercase tracking-widest text-[#484F58] mb-2">Your team</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {AGENT_PROFILES.map((a) => {
            const dbA = agents.find((x) => x.slug === a.id);
            const isRunning = dbA?.status === 'running';
            const active = view.kind === 'agent' && view.slug === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setView({ kind: 'agent', slug: a.id })}
                className="relative"
                title={a.name}
              >
                <InitialCircle slug={a.id} name={a.name} size={24} active={active} />
                {isRunning && (
                  <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
