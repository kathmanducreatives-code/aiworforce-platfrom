import { useMemo } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAgents } from '@/hooks/useAgents';
import { useAllPlans } from '@/hooks/usePlans';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useApprovals } from '@/hooks/useApprovals';
import { ALL_DEPTS } from '@/lib/departmentTheme';
import DepartmentCard from '@/components/department/DepartmentCard';
import DepartmentSummaryBar from '@/components/department/DepartmentSummaryBar';

export default function DepartmentsOverview() {
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const { plans } = useAllPlans(workspaceId, 100);
  const { events } = useActivityFeed(workspaceId, 100);
  const { approvals } = useApprovals(workspaceId);

  // Index agents by id → department for quick lookup
  const agentDeptById = useMemo(() => {
    const m = new Map<string, string>();
    agents.forEach((a) => m.set(a.id, a.department));
    return m;
  }, [agents]);

  const summary = useMemo(() => ({
    activeTasks: plans.filter((p) => p.status === 'planning' || p.status === 'executing').length,
    agentsRunning: agents.filter((a) => a.status === 'running').length,
    awaitingApproval: approvals.length,
  }), [plans, agents, approvals]);

  return (
    <div className="px-6 lg:px-10 py-8 max-w-[1400px] mx-auto space-y-8">
      {/* Page header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold text-foreground tracking-tight">Departments</h1>
        <p className="text-sm text-muted-foreground">Your AI team rooms — walk in and see what they're up to.</p>
      </div>

      {/* Summary KPIs */}
      <DepartmentSummaryBar {...summary} />

      {/* 2x2 grid of department cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {ALL_DEPTS.map((theme) => {
          const deptAgents = agents.filter((a) => a.department === theme.key);
          const deptAgentIds = new Set(deptAgents.map((a) => a.id));

          const deptEvents = events.filter((e) => e.agent_id && deptAgentIds.has(e.agent_id));
          const deptApprovals = approvals.filter((ap) => ap.agent_id && deptAgentIds.has(ap.agent_id));

          // Plans whose agent is in this dept (via activity_feed or approval signal)
          const deptPlanIds = new Set<string>();
          events.forEach((e) => {
            if (e.plan_id && e.agent_id && agentDeptById.get(e.agent_id) === theme.key) {
              deptPlanIds.add(e.plan_id);
            }
          });
          const deptPlans = plans.filter((p) => deptPlanIds.has(p.id));

          return (
            <DepartmentCard
              key={theme.key}
              theme={theme}
              agents={deptAgents}
              events={deptEvents}
              plans={deptPlans}
              approvals={deptApprovals}
            />
          );
        })}
      </div>
    </div>
  );
}
