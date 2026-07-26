import { useMemo } from 'react';
import { Loader2, Gauge, ShieldCheck, Clock } from 'lucide-react';
import { usePlanDetail } from '@/hooks/usePlanDetail';
import { useAgents } from '@/hooks/useAgents';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import AgentBadge from './AgentBadge';
import ExecutionTaskRow from './ExecutionTaskRow';
import ActivityMiniFeed from './ActivityMiniFeed';
import PlanStatusPill from './PlanStatusPill';
import AgentProcessRail from '../agents/AgentProcessRail';
import LiveProgressLine from './LiveProgressLine';
import { inferStage } from '@/lib/chat/progressCopy';
import { isWorkflowActive, isLongRunning } from '@/lib/chat/state';
import type { DBToolCall, DBApproval } from '@/lib/orchestration';
import { executionStages, executionModeBadge, COMPOUND_STAGE_NOTE, runningCopy } from '@/lib/qualifiedLead/planCopy';


interface Props {
  planId: string;
  /** Metadata from the assistant message, used as a fast pre-fetch label. */
  meta?: {
    plan_title?: string;
    task_count?: number;
    agents?: string[];
    connector_limitations?: string[];
    execution_mode?: string;
    /** Set by Pilot for a company-first qualified-lead run. */
    workflow_kind?: string;
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
  const { plan, tasks, activity, approvals, toolCalls, loading, uiState, lastActivityAt, secondsSinceChange } = usePlanDetail(planId);
  const { setView, openWorkbench } = useChatWorkspace();

  const agentById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of agents) m[a.id] = a.slug;
    return m;
  }, [agents]);

  /** Prefer the task's own agent_slug column; fall back to id lookup. */
  const slugForTask = (t: { agent_id?: string | null; agent_slug?: string | null; description?: string | null; payload?: any }): string | null => {
    if (t.agent_slug) return t.agent_slug;
    if (t.agent_id && agentById[t.agent_id]) return agentById[t.agent_id];
    const fromPayload = t.payload?.agent_slug ?? t.payload?.metadata?.agent_slug ?? null;
    return fromPayload ?? null;
  };

  const handleOpenOutput = (taskId: string, toolCallId?: string | null) => {
    const task = tasks.find((t) => t.id === taskId);
    const slug = task ? slugForTask(task) : null;
    openWorkbench({ planId, taskId, agentSlug: slug, toolCallId: toolCallId ?? null });
  };

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
  const rawStatus = plan?.status ?? 'planning';
  const taskCount = tasks.length || meta?.task_count || 0;
  const agentSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      const slug = slugForTask(t);
      if (slug) set.add(slug);
    }
    for (const a of meta?.agents ?? []) set.add(a.toLowerCase());
    return Array.from(set);
  }, [tasks, agentById, meta?.agents]);

  // Derive normalized status — uiState is the single source of truth, but
  // we keep the legacy fallbacks so the status pill is never blank.
  const pendingApprovals = approvals.some((a) => a.status === 'pending');
  const anyFailed = tasks.some((t) => t.status === 'failed');
  const anyRunning = tasks.some((t) => t.status === 'running' || t.status === 'pending');
  const allComplete = tasks.length > 0 && tasks.every((t) => t.status === 'complete' || t.status === 'skipped');
  const normalizedStatus: string =
    uiState === 'stale' ? 'stale' :
    uiState === 'partial' ? 'partial' :
    uiState === 'waiting_confirmation' ? 'awaiting_approval' :
    uiState === 'running' || uiState === 'streaming_progress' ? 'running' :
    uiState === 'complete' ? 'complete' :
    uiState === 'failed' ? 'failed' :
    rawStatus === 'failed' ? 'failed' :
    pendingApprovals ? 'awaiting_approval' :
    anyRunning ? 'running' :
    allComplete && anyFailed ? 'partial' :
    allComplete ? 'complete' :
    rawStatus;

  const totalResults = useMemo(() => {
    let sum = 0;
    for (const tc of toolCalls) {
      const total = tc.output_json?.total;
      if (typeof total === 'number') sum += total;
    }
    return sum;
  }, [toolCalls]);

  // QUALIFIED-LEAD PLAN COPY. The company-first runtime is multi-round and
  // quota-bound, so it must not describe itself as a Fast-mode Apify+ranking run.
  const workflowKind = meta?.workflow_kind
    ?? (plan as any)?.payload?.workflow_kind
    ?? (plan as any)?.payload?.metadata?.workflow_kind
    ?? null;
  const isQualifiedLead = workflowKind === 'qualified_lead_sourcing';
  const rawExecutionMode = meta?.execution_mode ?? (plan as any)?.payload?.execution_mode ?? null;
  const executionMode = executionModeBadge(workflowKind, rawExecutionMode);
  const productStages = isQualifiedLead ? executionStages(workflowKind) : [];
  const pennInvolved = agentSlugs.includes('penn') || tasks.some((t) => slugForTask(t) === 'penn');

  if (loading && !plan) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 mt-2 flex items-center gap-2 text-[12px] text-[#7D8590]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading execution plan…
      </div>
    );
  }

  if (!plan && taskCount === 0) return null;

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] backdrop-blur-xl p-5 mt-3 max-w-full overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[#7D8590] font-semibold mb-1">Execution plan</div>
          <div className="text-[17.5px] text-[#F0F6FC] font-semibold leading-snug">{title}</div>
        </div>
        <PlanStatusPill status={normalizedStatus} />
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap text-[12.5px] text-[#9aa4af]">
        <span>{taskCount} step{taskCount === 1 ? '' : 's'}</span>
        {totalResults > 0 && (
          <>
            <span className="text-[#484F58]">·</span>
            <span className="text-emerald-300">{totalResults} result{totalResults === 1 ? '' : 's'}</span>
          </>
        )}
        {executionMode && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/[0.08] bg-white/[0.02] text-[10px] uppercase tracking-wider text-[#C9D1D9]">
            <Gauge className="h-2.5 w-2.5" /> {executionMode}
          </span>
        )}
        {pennInvolved && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-[10px] uppercase tracking-wider text-amber-300">
            <ShieldCheck className="h-2.5 w-2.5" /> approval required
          </span>
        )}
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


      {productStages.length > 0 && (
        <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#7D8590] font-semibold">What this run does</div>
          <ol className="mt-1.5 space-y-0.5">
            {productStages.map((s, i) => (
              <li key={s.id} className="text-[12.5px] text-[#C9D1D9] flex gap-1.5">
                <span className="text-[#7D8590] tabular-nums">{i + 1}.</span>
                <span>{s.label}</span>
              </li>
            ))}
          </ol>
          <div className="mt-1.5 text-[11px] text-[#7D8590] italic">{COMPOUND_STAGE_NOTE}</div>
        </div>
      )}

      <div className="mt-3 flex gap-3 items-start">
        <AgentProcessRail
          className="pt-1 shrink-0"
          steps={tasks.map((t) => ({
            slug: slugForTask(t),
            status: t.status as any,
          }))}
        />
        <ul className="flex-1 min-w-0 space-y-1">
          {tasks.map((t, i) => (
            <ExecutionTaskRow
              key={t.id}
              index={i}
              task={t}
              agentSlug={slugForTask(t)}
              latestToolCall={latestToolCallByTask[t.id] ?? null}
              approval={approvalByTask[t.id] ?? null}
              connectorMissingFor={connectorMissingFor}
              onReviewApproval={() => setView({ kind: 'conversation', planId })}
              onOpenOutput={handleOpenOutput}
            />
          ))}
          {tasks.length === 0 && (
            <li className="text-[12px] text-[#7D8590] italic">Plan is being created…</li>
          )}
        </ul>
      </div>

      {isWorkflowActive(uiState) && (() => {
        const activeTask = tasks.find((t) => t.status === 'running' || t.status === 'pending') ?? null;
        const tc = activeTask ? latestToolCallByTask[activeTask.id] : null;
        const stage = inferStage({
          agentSlug: activeTask ? slugForTask(activeTask) : null,
          description: activeTask?.description ?? null,
          toolName: tc?.tool_name ?? null,
        });
        const longRunning = isLongRunning(lastActivityAt);
        // A qualified-lead run reports the PRODUCT stage it is on, not
        // "Scout is sourcing signals through Apify".
        if (isQualifiedLead) {
          return (
            <div className="mt-2 text-[12px] text-sky-300 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              {runningCopy(workflowKind, null)}
              {longRunning && <span className="text-[#7D8590]">— this run continues in rounds until the quota is met.</span>}
            </div>
          );
        }
        return <LiveProgressLine stage={stage} longRunning={longRunning} />;
      })()}

      {uiState === 'stale' && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-amber-300 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1.5">
          <Clock className="h-3 w-3" />
          This run looks stale — no backend activity for a while. You can keep waiting or retry.
        </div>
      )}
      {uiState === 'running' && secondsSinceChange > 25 && (
        <div className="mt-2 text-[11px] text-[#9aa4af]">Still working — waiting for the latest backend update.</div>
      )}

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
