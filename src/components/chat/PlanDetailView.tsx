import { useMemo } from 'react';
import { CheckCircle2, Loader2, Circle, AlertCircle, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePlanDetail } from '@/hooks/usePlanDetail';
import { useAgents } from '@/hooks/useAgents';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { decideApproval, type DBTask } from '@/lib/orchestration';
import { AGENT_BY_NAME, deptRing, deptText } from '@/data/agentProfiles';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Props {
  planId: string;
  /** Compact mode (used inside a side panel). */
  compact?: boolean;
}

export default function PlanDetailView({ planId, compact }: Props) {
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const { plan, tasks, approvals, loading } = usePlanDetail(planId);

  const agentById = useMemo(() => {
    const m = new Map<string, typeof agents[number]>();
    agents.forEach((a) => m.set(a.id, a));
    return m;
  }, [agents]);

  const pendingApprovals = approvals.filter((a) => a.status === 'pending');

  const handleDecide = async (id: string, action: 'approve' | 'reject') => {
    try {
      await decideApproval(id, action);
      toast.success(action === 'approve' ? 'Approved — resuming' : 'Rejected');
    } catch (e) {
      toast.error('Action failed', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  if (loading || !plan) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading plan…
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', compact ? '' : 'max-w-3xl mx-auto')}>
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <StatusPill status={plan.status} />
          <span className="text-xs text-muted-foreground">
            {new Date(plan.created_at).toLocaleString()}
          </span>
        </div>
        <h1 className={cn('font-semibold text-foreground leading-snug', compact ? 'text-lg' : 'text-2xl')}>
          {plan.user_instruction}
        </h1>
        {plan.plan_summary && (
          <p className="mt-1.5 text-sm text-muted-foreground">{plan.plan_summary}</p>
        )}
      </div>

      {/* Timeline */}
      <div className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-widest text-muted-foreground">Timeline</h2>
        <ol className="space-y-2">
          {tasks.map((task) => {
            const agent = task.agent_id ? agentById.get(task.agent_id) : null;
            const profile = agent ? AGENT_BY_NAME[agent.name.toLowerCase()] : null;
            return (
              <li
                key={task.id}
                className={cn(
                  'flex gap-3 p-3 rounded-xl border transition-all',
                  task.status === 'running'
                    ? 'border-primary/40 bg-primary/5 shadow-[0_0_0_4px_hsl(var(--primary)/0.05)]'
                    : task.status === 'complete'
                      ? 'border-border/40 bg-card/50'
                      : task.status === 'failed'
                        ? 'border-destructive/40 bg-destructive/5'
                        : 'border-border/30 bg-card/30 opacity-70',
                )}
              >
                <StepIcon status={task.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {profile && (
                      <img src={profile.image} alt="" className={cn('h-6 w-6 rounded-full ring-2', deptRing[profile.department])} />
                    )}
                    <span className="text-sm font-semibold text-foreground">
                      {agent?.name ?? 'Agent'}
                    </span>
                    {profile && (
                      <span className={cn('text-[10px] uppercase tracking-wider', deptText[profile.department])}>
                        {profile.department}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                      Step {task.step_index + 1}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{task.description}</p>
                  {task.output && task.status === 'complete' && (
                    <OutputBlock output={task.output} />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Pending approval card */}
      {pendingApprovals.map((a) => (
        <div key={a.id} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-400 text-xs uppercase tracking-widest">
            <AlertCircle className="h-3.5 w-3.5" /> Awaiting your approval
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{a.title}</p>
            {a.description && <p className="text-sm text-muted-foreground mt-1">{a.description}</p>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => handleDecide(a.id, 'approve')} className="bg-primary hover:bg-primary/90">
              <Check className="h-4 w-4 mr-1.5" /> Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleDecide(a.id, 'reject')}>
              <X className="h-4 w-4 mr-1.5" /> Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function StepIcon({ status }: { status: DBTask['status'] }) {
  if (status === 'complete') return <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />;
  if (status === 'running') return <Loader2 className="h-5 w-5 text-primary shrink-0 mt-0.5 animate-spin" />;
  if (status === 'failed') return <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />;
  return <Circle className="h-5 w-5 text-muted-foreground/50 shrink-0 mt-0.5" />;
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    planning: 'bg-muted text-muted-foreground border-border',
    executing: 'bg-primary/10 text-primary border-primary/30',
    awaiting_approval: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    complete: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    failed: 'bg-destructive/10 text-destructive border-destructive/30',
  };
  return (
    <span className={cn('text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border', styles[status] ?? styles.planning)}>
      {status.replace('_', ' ')}
    </span>
  );
}

function OutputBlock({ output }: { output: any }) {
  let text: string;
  try { text = typeof output === 'string' ? output : JSON.stringify(output, null, 2); }
  catch { text = String(output); }
  if (text === '{"note":"auto-completed"}') return null;
  return (
    <pre className="mt-2 text-[11px] font-mono text-muted-foreground bg-background/40 border border-border/30 rounded-md p-2 overflow-auto max-h-48">
      {text}
    </pre>
  );
}
