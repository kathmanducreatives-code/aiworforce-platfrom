import type { DBActivity } from '@/lib/orchestration';

const RELEVANT = new Set([
  'plan_created', 'task_started', 'task_completed', 'tool_used', 'tool_failed',
  'approval_created', 'ai_provider_call', 'agent_started', 'handoff',
  'awaiting_approval', 'approved', 'rejected', 'plan_complete',
]);

function fmt(ts: string) {
  const d = new Date(ts); const now = Date.now();
  const diff = Math.max(0, Math.floor((now - d.getTime()) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString();
}

export default function ActivityMiniFeed({ events }: { events: DBActivity[] }) {
  const filtered = events
    .filter((e) => RELEVANT.has(e.event_type as string))
    .slice(-5)
    .reverse();
  if (filtered.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-white/[0.06]">
      <div className="text-[10px] uppercase tracking-widest text-[#7D8590] font-semibold mb-1.5">Recent activity</div>
      <ul className="space-y-1">
        {filtered.map((ev) => (
          <li key={ev.id} className="flex items-start gap-2 text-[12px] text-[#C9D1D9]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#484F58] mt-1.5 shrink-0" />
            <span className="flex-1 min-w-0 truncate">{ev.title}</span>
            <span className="text-[10px] text-[#484F58] shrink-0">{fmt(ev.created_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
