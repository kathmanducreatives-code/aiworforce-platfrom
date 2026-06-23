import { useState } from 'react';
import type { DBActivity } from '@/lib/orchestration';

const RELEVANT = new Set([
  'plan_created', 'task_started', 'task_completed', 'tool_used', 'tool_failed',
  'approval_created', 'agent_started', 'handoff',
  'awaiting_approval', 'approved', 'rejected', 'plan_complete',
]);

// Hide raw provider/debug lines unless dev raw mode is on.
const DEBUG_EVENTS = new Set(['ai_provider_call']);

function isDebugTitle(title: string): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return /lovable-ai:|google\/gemini|anthropic\/|openai\/|provider call/.test(t);
}

function fmt(ts: string) {
  const d = new Date(ts); const now = Date.now();
  const diff = Math.max(0, Math.floor((now - d.getTime()) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString();
}

function dotForType(t: string): string {
  if (t === 'task_completed' || t === 'plan_complete' || t === 'approved') return 'bg-emerald-400';
  if (t === 'task_started' || t === 'agent_started') return 'bg-sky-400';
  if (t === 'tool_failed' || t === 'rejected') return 'bg-rose-400';
  if (t === 'awaiting_approval' || t === 'approval_created') return 'bg-amber-400';
  if (t === 'handoff') return 'bg-violet-400';
  return 'bg-[#484F58]';
}

export default function ActivityMiniFeed({ events }: { events: DBActivity[] }) {
  const [showRaw, setShowRaw] = useState(false);

  const cleaned = events.filter((e) => {
    if (!RELEVANT.has(e.event_type as string) && !DEBUG_EVENTS.has(e.event_type as string)) return false;
    if (!showRaw && (DEBUG_EVENTS.has(e.event_type as string) || isDebugTitle(e.title ?? ''))) return false;
    return true;
  });
  const filtered = cleaned.slice(-6).reverse();
  if (filtered.length === 0 && !showRaw) return null;

  return (
    <div className="mt-4 pt-3 border-t border-white/[0.06]">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-[0.14em] text-[#7D8590] font-semibold">Recent activity</div>
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="text-[10.5px] uppercase tracking-wider text-[#7D8590] hover:text-[#C9D1D9] transition-colors"
        >
          {showRaw ? 'hide debug' : 'raw'}
        </button>
      </div>
      <ul className="space-y-1.5">
        {filtered.map((ev) => (
          <li key={ev.id} className="flex items-center gap-2.5 text-[14px] text-[#C9D1D9]">
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotForType(ev.event_type as string)}`} />
            <span className="flex-1 min-w-0 truncate leading-snug">{ev.title}</span>
            <span className="text-[11.5px] text-[#6e7681] shrink-0">{fmt(ev.created_at)}</span>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="text-[12.5px] text-[#6e7681] italic">No activity yet.</li>
        )}
      </ul>
    </div>
  );
}
