import type { DBActivity } from '@/lib/orchestration';

const EVENT_LABEL: Record<string, string> = {
  plan_created: 'Plan created',
  task_started: 'Task started',
  task_completed: 'Task completed',
  task_failed: 'Task failed',
  tool_call_started: 'Tool started',
  tool_call_completed: 'Tool completed',
  tool_call_failed: 'Tool failed',
  approval_requested: 'Approval requested',
  approval_granted: 'Approval granted',
  workbench_opened: 'Workbench opened',
};

export default function ActivityTimeline({ items }: { items: DBActivity[] }) {
  if (items.length === 0) {
    return <div className="text-[12px] text-[#7D8590]">No activity yet.</div>;
  }
  return (
    <ol className="relative space-y-3 pl-5 before:absolute before:left-1.5 before:top-1.5 before:bottom-1.5 before:w-px before:bg-white/[0.08]">
      {items.map((a) => {
        const label = EVENT_LABEL[a.event_type] ?? a.event_type.replace(/_/g, ' ');
        const time = new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return (
          <li key={a.id} className="relative">
            <span className="absolute -left-[18px] top-1.5 h-2 w-2 rounded-full bg-emerald-400/70 ring-2 ring-[#0a0d12]" />
            <div className="text-[11px] text-[#7D8590] font-mono">{time} · {label}</div>
            <div className="text-[12.5px] text-[#E6EDF3] mt-0.5">{a.title}</div>
            {a.body && <div className="text-[11.5px] text-[#9aa4af] mt-0.5 leading-relaxed">{a.body}</div>}
          </li>
        );
      })}
    </ol>
  );
}
