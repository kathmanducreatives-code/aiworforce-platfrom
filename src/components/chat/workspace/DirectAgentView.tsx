import { useMemo } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAgents } from '@/hooks/useAgents';
import { useAllPlans } from '@/hooks/usePlans';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { AGENT_PROFILES, deptText, deptRing, deptDot } from '@/data/agentProfiles';
import { cn } from '@/lib/utils';

export default function DirectAgentView({ slug }: { slug: string }) {
  const profile = AGENT_PROFILES.find((p) => p.id === slug);
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const { plans } = useAllPlans(workspaceId, 50);
  const { setView } = useChatWorkspace();

  const dbAgent = agents.find((a) => a.slug === slug);
  const isRunning = dbAgent?.status === 'running';

  // Filter plans whose user_instruction mentions @Name (best heuristic without joining tasks)
  const myPlans = useMemo(() => {
    if (!profile) return [];
    const re = new RegExp(`@${profile.name}\\b`, 'i');
    return plans.filter((p) => re.test(p.user_instruction));
  }, [plans, profile]);

  if (!profile) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground">Agent not found.</div>;
  }

  const dept = profile.department;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/60">
        <div className="flex items-start gap-4">
          <div className={cn('h-14 w-14 rounded-full ring-2 overflow-hidden bg-card border border-border/60', deptRing[dept])}>
            <img src={profile.image} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">{profile.name}</h2>
              <span className={cn('text-xs uppercase tracking-wider', deptText[dept])}>{dept}</span>
              <span className={cn('text-[10px] uppercase px-1.5 py-0.5 rounded border bg-foreground/5 border-border/60 text-muted-foreground')}>
                {profile.model}
              </span>
            </div>
            <div className="text-sm text-muted-foreground">{profile.role}</div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full', isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/50')} />
              <span className="text-xs text-muted-foreground">{isRunning ? 'Running' : 'Idle'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {myPlans.length === 0 ? (
          <div className="max-w-md mx-auto text-center space-y-4 py-12">
            <div className={cn('h-16 w-16 rounded-full mx-auto ring-2 overflow-hidden', deptRing[dept])}>
              <img src={profile.image} alt="" className="h-full w-full object-cover" />
            </div>
            <div>
              <div className="text-lg font-semibold text-foreground">{profile.name} is ready.</div>
              <div className="text-sm text-muted-foreground mt-1">Try one of these starter tasks:</div>
            </div>
            <div className="grid gap-2 text-left">
              {[`@${profile.name} run a quick status check`,
                `@${profile.name} show me what you can do`,
                `@${profile.name} help me get started`].map((t) => (
                <button key={t} className="px-3 py-2 rounded-lg border border-border/60 bg-card hover:border-primary/50 hover:bg-primary/5 text-sm text-foreground/90 transition-all text-left">
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {myPlans.map((p) => <PlanRow key={p.id} plan={p} onClick={() => setView({ kind: 'conversation', planId: p.id })} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanRow({ plan, onClick }: { plan: any; onClick: () => void }) {
  const rel = useRelativeTime(plan.created_at);
  return (
    <button onClick={onClick} className="w-full text-left rounded-lg border border-border/60 bg-card hover:border-primary/40 px-4 py-3 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-foreground truncate">{plan.user_instruction}</div>
        <div className="text-[10px] text-muted-foreground shrink-0">{rel}</div>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{plan.status}</div>
    </button>
  );
}
