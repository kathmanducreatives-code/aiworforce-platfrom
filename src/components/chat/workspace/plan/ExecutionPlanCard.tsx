import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { usePlanDetail } from '@/hooks/usePlanDetail';
import { useAgents } from '@/hooks/useAgents';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import AgentBadge from './AgentBadge';
import ExecutionTaskRow from './ExecutionTaskRow';
import ActivityMiniFeed from './ActivityMiniFeed';
import type { DBToolCall, DBApproval } from '@/lib/orchestration';

interface Props {
  planId: string;
  /** Metadata from the assistant message, used as a fast pre-fetch label. */
  meta?: {
    plan_title?: string;
    task_count?: number;
    agents?: string[];
    connector_limitations?: string[];
  };
}

const STATUS_TONE: Record<string, string> = {
  planning: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  executing: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  awaiting_approval: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  complete: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  failed: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
};

const TOOL_PROVIDER_KEY: Record<string, string> = {
  research_web: 'perplexity',
  search_web: 'broad web search',
  scrape_url: 'firecrawl',
  source_with_apify: 'apify',
  send_email: 'resend',
};

export default function ExecutionPlanCard({ planId, meta }: Props) {
  const { workspaceId } = useWorkspace();
  const { agents } = useAgents(workspaceId);
  const { plan, tasks, activity, approvals, toolCalls, loading } = usePlanDetail(planId);
  const { setView } = useChatWorkspace();

  const agentById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of agents) m[a.id] = a.slug;
    return m;
  }, [agents]);

  const latestToolCallByTask = useMemo(() => {
    const m: Record<string, DBToolCall> = {};
    for (const tc of toolCalls) {
      if (!tc.task_id) continue;
      const prev = m[tc.task_id];
      if (!prev || new Date(tc.created_at) > new Date(prev.created_at)) m[tc.task_id] = tc;
    }
    return m;
  }, [toolCalls]);

  const approvalByTask = useMemo(() => {
    const m: Record<string, DBApproval> = {};
    for (const ap of approvals) {
      if (!ap.task_id) continue;
      const prev = m[ap.task_id];
      if (!prev || new Date(ap.created_at) > new Date(prev.created_at)) m[ap.task_id] = ap;
    }
    return m;
  }, [approvals]);

  // Limitations now arrive as human-readable, tool-aware sentences.
  // We still derive a per-provider key set so individual task rows can mark
  // their own tool badge as "connector missing" — but only when the
  // plan actually uses that provider.
  const connectorMissingKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const lim of meta?.connector_limitations ?? []) {
      const s = lim.toLowerCase();
      if (s.includes('apify')) keys.add('apify');
      if (s.includes('firecrawl')) keys.add('firecrawl');
      if (s.includes('broad web search')) keys.add('broad web search');
      if (s.includes('perplexity')) keys.add('perplexity');
      if (s.includes('resend')) keys.add('resend');
    }
    return keys;
  }, [meta?.connector_limitations]);

  const connectorMissingFor = (tool: string | null | undefined) => {
    if (!tool) return false;
    const key = TOOL_PROVIDER_KEY[tool];
    return key ? connectorMissingKeys.has(key) : false;
  };


  const title = plan?.user_instruction ?? meta?.plan_title ?? 'Execution plan';
  const status = plan?.status ?? 'planning';
  const taskCount = tasks.length || meta?.task_count || 0;
  const agentSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      const slug = t.agent_id ? agentById[t.agent_id] : null;
      if (slug) set.add(slug);
    }
    for (const a of meta?.agents ?? []) set.add(a.toLowerCase());
    return Array.from(set);
  }, [tasks, agentById, meta?.agents]);

  if (loading && !plan) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 mt-2 flex items-center gap-2 text-[12px] text-[#7D8590]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading execution plan…
      </div>
    );
  }

  if (!plan && taskCount === 0) return null;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 mt-2 max-w-full overflow-hidden">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-widest text-[#7D8590] font-semibold mb-0.5">Execution plan</div>
          <div className="text-[14px] text-[#F0F6FC] font-medium leading-snug truncate">{title}</div>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded border ${STATUS_TONE[status] ?? STATUS_TONE.planning}`}>
          {status.replace('_', ' ')}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px] text-[#7D8590]">
        <span>{taskCount} step{taskCount === 1 ? '' : 's'}</span>
        {agentSlugs.length > 0 && (
          <>
            <span className="text-[#484F58]">·</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {agentSlugs.map((s) => <AgentBadge key={s} slug={s} />)}
            </div>
          </>
        )}
      </div>

      {(meta?.connector_limitations?.length ?? 0) > 0 && (
        <div className="mt-2 text-[11px] text-amber-300 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1.5">
          {meta!.connector_limitations!.join(' · ')}
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {tasks.map((t, i) => (
          <ExecutionTaskRow
            key={t.id}
            index={i}
            task={t}
            agentSlug={t.agent_id ? agentById[t.agent_id] ?? null : null}
            latestToolCall={latestToolCallByTask[t.id] ?? null}
            approval={approvalByTask[t.id] ?? null}
            connectorMissingFor={connectorMissingFor}
            onReviewApproval={() => setView({ kind: 'conversation', planId })}
          />
        ))}
        {tasks.length === 0 && (
          <li className="text-[12px] text-[#7D8590] italic">Plan is being created…</li>
        )}
      </ul>

      <ActivityMiniFeed events={activity} />

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => setView({ kind: 'conversation', planId })}
          className="text-[11px] text-[#7D8590] hover:text-[#C9D1D9] underline underline-offset-2"
        >
          Open full conversation →
        </button>
      </div>
    </div>
  );
}
