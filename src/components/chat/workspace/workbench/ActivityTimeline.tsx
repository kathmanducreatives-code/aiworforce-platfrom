import type { DBActivity } from '@/lib/orchestration';
import { resolveAgentFromMetadata, inferAgentFromAction } from '@/lib/agentResolver';
import AgentAvatar from '../agents/AgentAvatar';

const EVENT_LABEL: Record<string, string> = {
  plan_created: 'created a plan',
  agent_started: 'started working',
  task_started: 'started a task',
  task_completed: 'completed a task',
  task_failed: 'hit an error',
  tool_call_started: 'invoked a tool',
  tool_call_completed: 'finished a tool call',
  tool_call_failed: 'tool call failed',
  approval_requested: 'requested approval',
  approval_granted: 'received approval',
  handoff: 'handed off',
  awaiting_approval: 'is awaiting approval',
  approved: 'was approved',
  rejected: 'was rejected',
  plan_complete: 'finished the plan',
  workbench_opened: 'opened the Workbench',
};

export default function ActivityTimeline({ items }: { items: DBActivity[] }) {
  if (items.length === 0) {
    return <div className="text-[12px] text-[#7D8590]">No activity yet.</div>;
  }
  return (
    <ol className="space-y-3">
      {items.map((a) => {
        const profile = resolveAgentFromMetadata(
          a.metadata,
          inferAgentFromAction(a.event_type),
        );
        const verb = EVENT_LABEL[a.event_type] ?? a.event_type.replace(/_/g, ' ');
        const time = new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return (
          <li key={a.id} className="flex items-start gap-3">
            <AgentAvatar slug={profile.id} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[12.5px] font-semibold text-[#E6EDF3]">{profile.name}</span>
                <span className="text-[12px] text-[#9aa4af]">{verb}</span>
                <span className="ml-auto text-[10.5px] text-[#7D8590] font-mono">{time}</span>
              </div>
              <div className="text-[12.5px] text-[#E6EDF3] mt-0.5 truncate">{a.title}</div>
              {a.body && <div className="text-[11.5px] text-[#9aa4af] mt-0.5 leading-relaxed">{a.body}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
