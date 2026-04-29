import type { DBPlan, DBTask, DBActivity, DBApproval, DBAgent } from './orchestration';

export type ChatMessage =
  | { kind: 'user'; id: string; ts: string; text: string }
  | { kind: 'system'; id: string; ts: string; text: string }
  | {
      kind: 'agent';
      id: string;
      ts: string;
      agentId: string | null;
      task: DBTask;
      state: 'thinking' | 'working' | 'done' | 'failed';
    }
  | { kind: 'handoff'; id: string; ts: string; fromAgentId: string | null; toAgentId: string | null }
  | { kind: 'approval'; id: string; ts: string; approval: DBApproval; agentId: string | null };

export function buildPlanMessages(
  plan: DBPlan,
  tasks: DBTask[],
  activity: DBActivity[],
  approvals: DBApproval[],
  _agents: DBAgent[],
): ChatMessage[] {
  const msgs: ChatMessage[] = [];

  // 1. user instruction
  msgs.push({
    kind: 'user',
    id: `plan-${plan.id}-user`,
    ts: plan.created_at,
    text: plan.user_instruction,
  });

  // 2. plan_created system message
  const created = activity.find((a) => a.event_type === 'plan_created');
  msgs.push({
    kind: 'system',
    id: `plan-${plan.id}-created`,
    ts: created?.created_at ?? plan.created_at,
    text: `Plan created · ${tasks.length} step${tasks.length === 1 ? '' : 's'}`,
  });

  // Build per-task message + insert handoffs / approvals between
  const sortedTasks = [...tasks].sort((a, b) => a.step_index - b.step_index);

  sortedTasks.forEach((task, idx) => {
    // Handoff between previous and this task
    if (idx > 0) {
      const prev = sortedTasks[idx - 1];
      const handoff = activity.find(
        (a) =>
          a.event_type === 'handoff' &&
          (a.metadata?.from_task_id === prev.id || a.metadata?.to_task_id === task.id),
      );
      if (handoff) {
        msgs.push({
          kind: 'handoff',
          id: `handoff-${handoff.id}`,
          ts: handoff.created_at,
          fromAgentId: prev.agent_id,
          toAgentId: task.agent_id,
        });
      }
    }

    // Pending approval for this task
    const pending = approvals.find((ap) => ap.task_id === task.id);
    if (pending) {
      msgs.push({
        kind: 'approval',
        id: `approval-${pending.id}`,
        ts: pending.created_at,
        approval: pending,
        agentId: task.agent_id,
      });
    }

    let state: 'thinking' | 'working' | 'done' | 'failed' = 'thinking';
    if (task.status === 'complete') state = 'done';
    else if (task.status === 'failed') state = 'failed';
    else if (task.status === 'running') {
      const started = activity.some(
        (a) => a.agent_id === task.agent_id && a.event_type === 'agent_started',
      );
      state = started ? 'working' : 'thinking';
    }

    msgs.push({
      kind: 'agent',
      id: `task-${task.id}`,
      ts: task.started_at ?? task.finished_at ?? task.created_at,
      agentId: task.agent_id,
      task,
      state,
    });
  });

  // 3. completion marker
  if (plan.status === 'complete') {
    msgs.push({
      kind: 'system',
      id: `plan-${plan.id}-done`,
      ts: plan.completed_at ?? plan.created_at,
      text: 'Plan complete',
    });
  } else if (plan.status === 'failed') {
    msgs.push({
      kind: 'system',
      id: `plan-${plan.id}-failed`,
      ts: plan.completed_at ?? plan.created_at,
      text: 'Plan failed',
    });
  }

  return msgs;
}
