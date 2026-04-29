import { useEffect, useMemo, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
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
import { Plus, ChevronLeft, ChevronRight, ArrowRight, Play } from 'lucide-react';
import { openAgentBuilder } from '@/hooks/useAgentBuilder';
import AgentRoster from '@/components/department/AgentRoster';
import { getDeptTheme } from '@/lib/departmentTheme';

const DEPT_META: Record<AgentDept, { label: string; tagline: string }> = {
  talent:       { label: 'Talent',       tagline: 'Sourcing, screening & shortlists' },
  growth:       { label: 'Growth',       tagline: 'Outreach, leads & pipeline' },
  intelligence: { label: 'Intelligence', tagline: 'Competitor & market signals' },
  content:      { label: 'Content',      tagline: 'Posts, copy & brand voice' },
  operations:   { label: 'Operations',   tagline: 'Workflow automation & ops' },
};

const COLUMN_BUCKETS: { id: 'todo' | 'in_progress' | 'awaiting' | 'done'; statuses: DBPlan['status'][] }[] = [
  { id: 'todo',       statuses: ['planning'] },
  { id: 'in_progress',statuses: ['executing'] },
  { id: 'awaiting',   statuses: ['awaiting_approval'] },
  { id: 'done',       statuses: ['complete', 'failed'] },
];

interface PlanWithAgents extends DBPlan {
  agentSlugs: string[];
  totalSteps: number;
  doneSteps: number;
}

const VALID_DEPTS: AgentDept[] = ['talent', 'growth', 'intelligence', 'content', 'operations'];

export default function DepartmentRoom() {
  const { dept } = useParams<{ dept: string }>();
  const isValid = !!dept && VALID_DEPTS.includes(dept as AgentDept);
  const department = (isValid ? dept : 'talent') as AgentDept;
  const meta = DEPT_META[department];
  const { workspaceId } = useWorkspace();

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
  const composerRef = useRef<HTMLDivElement>(null);
  const theme = getDeptTheme(department);
  const latestEvent = deptEvents[deptEvents.length - 1];

  const focusComposer = () => {
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const input = composerRef.current?.querySelector('textarea, input') as HTMLElement | null;
    setTimeout(() => input?.focus(), 300);
  };

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

  if (!isValid) {
    return <div className="p-8 text-muted-foreground">Unknown department.</div>;
  }

  return (
    <>
      {/* Breadcrumb */}
      <div className="px-6 pt-5 pb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Link to="/departments" className="hover:text-foreground inline-flex items-center gap-1 transition-colors">
          <ChevronLeft className="h-3.5 w-3.5" />
          Departments
        </Link>
        <ChevronRight className="h-3 w-3 opacity-40" />
        <span className="text-foreground">{theme.label}</span>
      </div>

      {/* Room header */}
      <div className="px-6 pb-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div
            className="h-11 w-11 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${theme.hex}1a`, color: theme.hex }}
          >
            <theme.icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-foreground leading-tight">{theme.label}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{theme.tagline}</p>
          </div>

          <div className="flex -space-x-2 ml-4">
            {deptAgents.map((a) => {
              const profile = AGENT_BY_NAME[a.name.toLowerCase()];
              if (!profile) return null;
              const running = a.status === 'running';
              return (
                <img
                  key={a.id}
                  src={profile.image}
                  alt={a.name}
                  title={`${a.name} · ${a.status}`}
                  className={cn(
                    'h-8 w-8 rounded-full ring-2 ring-background object-cover transition',
                    running ? '' : 'opacity-70 grayscale-[40%]',
                  )}
                  style={running ? { boxShadow: `0 0 0 2px ${theme.hex}` } : undefined}
                />
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => openAgentBuilder({ department })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 hover:bg-card/80 text-muted-foreground hover:text-foreground px-2.5 py-1.5 text-xs font-semibold transition"
            >
              <Plus className="h-3.5 w-3.5" /> New Agent
            </button>
            <button
              onClick={focusComposer}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-background transition hover:opacity-90"
              style={{ backgroundColor: theme.hex }}
            >
              <Play className="h-3.5 w-3.5" /> Start Task
            </button>
          </div>
        </div>

        {/* Live status line */}
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className={cn('h-1.5 w-1.5 rounded-full', deptDot[department], workingAgents.length > 0 && 'animate-pulse')} />
          <span className="text-muted-foreground">
            {workingAgents.length > 0
              ? `${workingAgents.join(' & ')} ${workingAgents.length === 1 ? 'is' : 'are'} working`
              : latestEvent?.title ?? 'Quiet for now — start a task to wake the team.'}
          </span>
        </div>
      </div>

      <div className="border-b border-border/50" />

      <AgentRoster department={department} />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(0,420px)] gap-0 min-h-[calc(100vh-180px)]">
        <div className="p-5 overflow-x-auto">
          <div className="grid grid-cols-4 gap-4 min-w-[820px]">
            {COLUMN_BUCKETS.map((col, idx) => {
              const cards = deptPlans.filter((p) => col.statuses.includes(p.status));
              const label = theme.workflow[idx];
              return (
                <div key={col.id} className="flex flex-col">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground">
                      {label}
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
            <span className="text-xs font-semibold text-foreground">#{theme.label.toLowerCase()}-room</span>
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

              if (isHandoff) {
                const fromName = (e.metadata as any)?.from_agent_name ?? name;
                const toName = (e.metadata as any)?.to_agent_name ?? (e.body?.match(/→\s*([A-Za-z]+)/)?.[1]);
                return (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 py-1 px-2 rounded-lg"
                    style={{ background: `linear-gradient(90deg, ${theme.hex}10, transparent)` }}
                  >
                    <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: theme.hex }}>
                      Handoff
                    </span>
                    <span className="text-xs text-foreground font-medium">{fromName ?? '—'}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-foreground font-medium">{toName ?? '—'}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto truncate max-w-[140px]">
                      {e.title}
                    </span>
                  </div>
                );
              }

              return (
                <ChatBubble
                  key={e.id}
                  role="agent"
                  agentName={name}
                  text={e.body || e.title}
                  timestamp={e.created_at}
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

          <div ref={composerRef} className="p-3 border-t border-border/50">
            <ChatComposer
              onSubmit={handleSubmit}
              restrictDepartment={department}
              compact
              placeholder={`Message #${theme.label.toLowerCase()} — type @ to mention`}
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
