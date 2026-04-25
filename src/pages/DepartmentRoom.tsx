import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAgents } from '@/hooks/useAgents';
import { useAllPlans } from '@/hooks/usePlans';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import {
  submitInstruction, fetchTasksForPlan, type DBPlan,
} from '@/lib/orchestration';
import { AGENT_BY_NAME, deptRing, deptDot, type AgentDept } from '@/data/agentProfiles';
import ChatComposer, { type ComposerSubmit } from '@/components/chat/ChatComposer';
import ChatBubble from '@/components/chat/ChatBubble';
import PlanningThread, { type PlanStep } from '@/components/chat/PlanningThread';
import PlanDetailView from '@/components/chat/PlanDetailView';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const DEPT_META: Record<AgentDept, { label: string; tagline: string }> = {
  talent:       { label: 'Talent',       tagline: 'Sourcing, screening & shortlists' },
  growth:       { label: 'Growth',       tagline: 'Outreach, leads & pipeline' },
  intelligence: { label: 'Intelligence', tagline: 'Competitor & market signals' },
  content:      { label: 'Content',      tagline: 'Posts, copy & brand voice' },
};

const COLUMNS: { id: 'todo' | 'in_progress' | 'awaiting' | 'done'; label: string; statuses: DBPlan['status'][] }[] = [
  { id: 'todo',       label: 'To Do',             statuses: ['planning'] },
  { id: 'in_progress',label: 'In Progress',       statuses: ['executing'] },
  { id: 'awaiting',   label: 'Awaiting Approval', statuses: ['awaiting_approval'] },
  { id: 'done',       label: 'Done',              statuses: ['complete', 'failed'] },
];

interface PlanWithAgents extends DBPlan {
  agentSlugs: string[];
  totalSteps: number;
  doneSteps: number;
}

const VALID_DEPTS: AgentDept[] = ['talent', 'growth', 'intelligence', 'content'];

export default function DepartmentRoom() {
  const { dept } = useParams<{ dept: string }>();
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();

  if (!dept || !VALID_DEPTS.includes(dept as AgentDept)) {
    return <div className="p-8 text-muted-foreground">Unknown department.</div>;
  }
  const department = dept as AgentDept;
  const meta = DEPT_META[department];

  const { agents } = useAgents(workspaceId);
  const { plans } = useAllPlans(workspaceId, 100);
  const { events } = useActivityFeed(workspaceId, 100);

  const deptAgents = useMemo(() => agents.filter((a) => a.department === department), [agents, department]);
  const deptAgentIds = useMemo(() => new Set(deptAgents.map((a) => a.id)), [deptAgents]);
  const agentNameById = useMemo(() => {
    const m = new Map<string, string>();
    agents.forEach((a) => m.set(a.id, a.name));
    return m;
  }, [agents]);

  const [planMeta, setPlanMeta] = useState<Map<string, { agentIds: Set<string>; total: number; done: number }>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = new Map<string, { agentIds: Set<string>; total: number; done: number }>();
      const targets = plans.slice(0, 30);
      await Promise.all(targets.map(async (p) => {
        const ts = await fetchTasksForPlan(p.id);
        const ids = new Set<string>();
        let done = 0;
        ts.forEach((t) => {
          if (t.agent_id) ids.add(t.agent_id);
          if (t.status === 'complete') done += 1;
        });
        next.set(p.id, { agentIds: ids, total: ts.length, done });
      }));
      if (!cancelled) setPlanMeta(next);
    })();
    return () => { cancelled = true; };
  }, [plans]);

  const deptPlans: PlanWithAgents[] = useMemo(() => {
    return plans
      .map((p) => {
        const meta = planMeta.get(p.id);
        if (!meta) return null;
        const overlap = [...meta.agentIds].some((id) => deptAgentIds.has(id));
        if (!overlap) return null;
        return {
          ...p,
          agentSlugs: [...meta.agentIds]
            .map((id) => agentNameById.get(id) ?? '')
            .filter(Boolean),
          totalSteps: meta.total,
          doneSteps: meta.done,
        } as PlanWithAgents;
      })
      .filter((x): x is PlanWithAgents => x !== null);
  }, [plans, planMeta, deptAgentIds, agentNameById]);

  const deptEvents = useMemo(
    () => events
      .filter((e) => !e.agent_id || deptAgentIds.has(e.agent_id))
      .filter((e) => e.event_type !== 'plan_created')
      .slice()
      .reverse(),
    [events, deptAgentIds],
  );

  const workingAgents = deptAgents.filter((a) => a.status === 'running').map((a) => a.name);

  const [planning, setPlanning] = useState<{ steps: PlanStep[]; planId: string } | null>(null);
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);

  const handleSubmit = async ({ text, mentioned }: ComposerSubmit) => {
    if (!workspaceId) { toast.error('Workspace not ready'); return; }

    if (mentioned && mentioned.department !== department) {
      toast.message(`Sending to ${mentioned.name} (${mentioned.department})`);
    }

    try {
      const result = await submitInstruction(workspaceId, text, {
        agentSlug: mentioned?.id,
      });
      if (result.steps && result.steps.length > 1 && !mentioned) {
        setPlanning({ steps: result.steps, planId: result.plan_id });
        setTimeout(() => setPlanning(null), result.steps.length * 550 + 1500);
      }
      toast.success('Plan dispatched', { description: result.plan_summary });
    } catch (e) {
      toast.error('Could not dispatch', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <div className="px-6 py-5 border-b border-border/50">
        <div className="flex items-center gap-3">
          <span className={cn('h-2.5 w-2.5 rounded-full', deptDot[department])} />
          <h1 className="text-xl font-semibold text-foreground">{meta.label}</h1>
          <span className="text-sm text-muted-foreground">· {meta.tagline}</span>
          <div className="ml-auto flex -space-x-2">
            {deptAgents.map((a) => {
              const profile = AGENT_BY_NAME[a.name.toLowerCase()];
              if (!profile) return null;
              return (
                <img
                  key={a.id}
                  src={profile.image}
                  alt={a.name}
                  title={`${a.name} · ${a.status}`}
                  className={cn('h-7 w-7 rounded-full ring-2 ring-background object-cover', deptRing[department])}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(0,420px)] gap-0 min-h-[calc(100vh-180px)]">
        <div className="p-5 overflow-x-auto">
          <div className="grid grid-cols-4 gap-4 min-w-[820px]">
            {COLUMNS.map((col) => {
              const cards = deptPlans.filter((p) => col.statuses.includes(p.status));
              return (
                <div key={col.id} className="flex flex-col">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
                      {col.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70 tabular-nums">{cards.length}</span>
                  </div>
                  <div className="space-y-2 min-h-[60px]">
                    {cards.length === 0 && (
                      <div className="rounded-xl border border-dashed border-border/40 px-3 py-6 text-center text-[11px] text-muted-foreground/60">
                        Empty
                      </div>
                    )}
                    {cards.map((card) => (
                      <button
                        key={card.id}
                        onClick={() => setOpenPlanId(card.id)}
                        className="w-full text-left rounded-xl border border-border/60 bg-card/70 backdrop-blur-md hover:border-primary/40 hover:bg-card transition-all p-3 group"
                      >
                        <p className="text-sm font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
                          {card.user_instruction}
                        </p>
                        <div className="flex items-center justify-between mt-3 gap-2">
                          <div className="flex -space-x-1.5">
                            {card.agentSlugs.slice(0, 3).map((name) => {
                              const profile = AGENT_BY_NAME[name.toLowerCase()];
                              if (!profile) return null;
                              return (
                                <img
                                  key={name}
                                  src={profile.image}
                                  alt={name}
                                  className="h-5 w-5 rounded-full ring-2 ring-card object-cover"
                                />
                              );
                            })}
                          </div>
                          {card.totalSteps > 0 && (
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              Step {Math.min(card.doneSteps + (card.status === 'complete' ? 0 : 1), card.totalSteps)} of {card.totalSteps}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-l border-border/50 flex flex-col bg-background/40">
          <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2">
            <span className={cn('h-1.5 w-1.5 rounded-full', deptDot[department], 'animate-pulse')} />
            <span className="text-xs font-semibold text-foreground">#{meta.label.toLowerCase()}-room</span>
            <span className="text-[10px] text-muted-foreground ml-auto">{deptEvents.length} messages</span>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {deptEvents.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No activity yet — message the team below.
              </div>
            )}
            {deptEvents.map((e) => {
              const name = e.agent_id ? agentNameById.get(e.agent_id) : undefined;
              const isHandoff = e.event_type === 'handoff';
              return (
                <ChatBubble
                  key={e.id}
                  role="agent"
                  agentName={name}
                  text={e.body || e.title}
                  timestamp={e.created_at}
                  nested={isHandoff}
                />
              );
            })}

            {planning && (
              <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-3">
                <PlanningThread steps={planning.steps} />
              </div>
            )}

            {workingAgents.length > 0 && (
              <div className="flex items-center gap-2 pl-1 text-xs text-muted-foreground">
                <span className="flex gap-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary/70 animate-pulse [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-pulse [animation-delay:240ms]" />
                </span>
                {workingAgents.join(' and ')} {workingAgents.length === 1 ? 'is' : 'are'} working…
              </div>
            )}
          </div>

          <div className="p-3 border-t border-border/50">
            <ChatComposer
              onSubmit={handleSubmit}
              restrictDepartment={department}
              compact
              placeholder={`Message #${meta.label.toLowerCase()} — type @ to mention`}
            />
          </div>
        </div>
      </div>

      <Dialog open={!!openPlanId} onOpenChange={(o) => !o && setOpenPlanId(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="sr-only">Plan detail</DialogTitle>
          </DialogHeader>
          {openPlanId && <PlanDetailView planId={openPlanId} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
