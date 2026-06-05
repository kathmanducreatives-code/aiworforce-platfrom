import { useMemo } from 'react';
import { usePlanDetail } from '@/hooks/usePlanDetail';
import { useAgents } from '@/hooks/useAgents';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import type { WorkbenchSelection } from '@/contexts/ChatWorkspaceContext';
import type { DBTask, DBToolCall, DBApproval, DBActivity } from '@/lib/orchestration';

export interface WorkbenchData {
  loading: boolean;
  planTitle: string;
  planStatus: string;
  task: DBTask | null;
  agentSlug: string | null;
  agentName: string | null;
  toolCall: DBToolCall | null;
  allToolCalls: DBToolCall[];
  approval: DBApproval | null;
  activity: DBActivity[];
}

export function useWorkbenchData(selection: WorkbenchSelection | null): WorkbenchData {
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const { plan, tasks, activity, approvals, toolCalls, loading } = usePlanDetail(selection?.planId ?? null);

  return useMemo<WorkbenchData>(() => {
    const task =
      (selection?.taskId && tasks.find((t) => t.id === selection.taskId)) || null;

    const taskToolCalls = task
      ? toolCalls.filter((tc) => tc.task_id === task.id)
      : toolCalls;

    const toolCall =
      (selection?.toolCallId && toolCalls.find((tc) => tc.id === selection.toolCallId)) ||
      taskToolCalls.slice().sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0] ||
      null;

    const agentId = task?.agent_id ?? toolCall?.agent_id ?? null;
    const agentRow = agentId ? agents.find((a) => a.id === agentId) : null;
    const agentSlug =
      selection?.agentSlug ??
      agentRow?.slug ??
      null;
    const agentName = agentRow?.name ?? (agentSlug ? agentSlug[0].toUpperCase() + agentSlug.slice(1) : null);

    const approval =
      (task && approvals.find((a) => a.task_id === task.id)) ||
      null;

    const scopedActivity = task
      ? activity.filter((a) => !a.metadata || a.metadata.task_id === task.id || a.metadata.task_id == null)
      : activity;

    return {
      loading,
      planTitle: plan?.user_instruction ?? 'Execution plan',
      planStatus: plan?.status ?? 'planning',
      task,
      agentSlug,
      agentName,
      toolCall,
      allToolCalls: taskToolCalls,
      approval,
      activity: scopedActivity,
    };
  }, [selection, plan, tasks, toolCalls, approvals, activity, agents, loading]);
}
