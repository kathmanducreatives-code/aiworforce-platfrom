import { X, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import AgentBadge from '../plan/AgentBadge';
import type { WorkbenchData } from './useWorkbenchData';
import type { LeadResultsPanelMeta } from '@/contexts/ChatWorkspaceContext';
import { workflowTypeFromToolCall, WORKFLOW_LABELS } from './workflowType';

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-white/[0.04] text-[#7D8590] border-white/[0.08]',
  running: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  queued: 'bg-white/[0.04] text-[#7D8590] border-white/[0.08]',
  complete: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  succeeded: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  failed: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  unavailable: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  awaiting_approval: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  skipped: 'bg-white/[0.04] text-[#7D8590] border-white/[0.08]',
};

const PROVIDER_LABEL: Record<string, string> = {
  apify: 'Apify',
  firecrawl: 'Firecrawl',
  resend: 'Resend',
  perplexity: 'Perplexity',
  gemini: 'Lovable AI',
  openai: 'Lovable AI',
  google: 'Lovable AI',
  lovable: 'Lovable AI',
};

export default function WorkbenchHeader({
  data, onClose, onRefresh, panel,
}: { data: WorkbenchData; onClose: () => void; onRefresh: () => void; panel?: LeadResultsPanelMeta | null }) {
  const { planTitle, task, agentSlug, agentName, toolCall } = data;
  const taskPayload = (task?.payload ?? {}) as Record<string, any>;
  const rawTaskTitle: string | null = taskPayload.task_title ?? task?.description ?? null;
  const status = task?.status ?? toolCall?.status ?? 'pending';
  const toolLabel = toolCall?.tool_name;
  const provider = toolCall?.provider ? (PROVIDER_LABEL[toolCall.provider.toLowerCase()] ?? toolCall.provider) : null;
  const ts = task?.finished_at ?? task?.started_at ?? toolCall?.completed_at ?? toolCall?.created_at ?? null;
  const apifyTotal = typeof toolCall?.output_json?.total === 'number' ? toolCall.output_json.total : null;
  const workflowLabel = WORKFLOW_LABELS[workflowTypeFromToolCall(toolCall)];
  const runShort = typeof toolCall?.output_json?.run_id === 'string'
    ? String(toolCall.output_json.run_id).slice(-8)
    : null;

  const conciseTitle = panel
    ? `${panel.lead_count ?? 0} ${panel.lead_count === 1 ? 'opportunity' : 'opportunities'} found`
    : (rawTaskTitle || planTitle || 'Workbench');
  const subtitle = panel
    ? (rawTaskTitle || planTitle || null)
    : (rawTaskTitle && planTitle && rawTaskTitle !== planTitle ? `From: ${planTitle}` : null);

  return (
    <div className="px-4 pt-3 pb-2.5 border-b border-white/[0.06] bg-gradient-to-b from-emerald-500/[0.04] via-white/[0.015] to-transparent backdrop-blur-sm shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-widest text-emerald-300/80 font-semibold">
            Workbench
          </div>
          <h2 className="mt-0.5 text-[15px] text-[#F0F6FC] font-semibold leading-snug truncate" title={conciseTitle}>
            {conciseTitle}
          </h2>
          {subtitle && (
            <div className="mt-0.5 text-[11px] text-[#7D8590] truncate" title={subtitle}>{subtitle}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onRefresh}
            disabled={data.loading}
            title="Refresh output"
            aria-label="Refresh output"
            className={cn(
              'h-7 w-7 inline-flex items-center justify-center rounded hover:bg-white/[0.06] text-[#7D8590] hover:text-[#F0F6FC] transition-colors',
              data.loading && 'opacity-60 cursor-not-allowed'
            )}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', data.loading && 'animate-spin')} />
          </button>
          <button
            onClick={onClose}
            aria-label="Close workbench"
            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-white/[0.06] text-[#7D8590] hover:text-[#F0F6FC]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5 flex-wrap text-[11px]">
        {agentSlug && <AgentBadge slug={agentSlug} />}
        {provider && (
          <span className="text-[10px] px-2 py-0.5 rounded-md border border-white/[0.08] bg-white/[0.03] text-[#C9D1D9]">
            {provider}
          </span>
        )}
        <span className="text-[10px] px-2 py-0.5 rounded-md border border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-300">
          {workflowLabel}
        </span>
        <span className={`text-[10px] px-2 py-0.5 rounded-md border capitalize ${STATUS_TONE[status] ?? STATUS_TONE.pending}`}>
          {status.replace('_', ' ')}
        </span>
        {(() => {
          const out = toolCall?.output_json;
          const actorLabel = out?.actor_label ?? out?.selected_actor_key ?? out?.actor_key ?? null;
          return actorLabel ? (
            <span className="font-mono text-[10px] px-2 py-0.5 rounded-md border border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-200">
              actor: {actorLabel}
            </span>
          ) : null;
        })()}
        {toolCall?.output_json?.actor_output_type && (
          <span className="text-[10px] px-2 py-0.5 rounded-md border border-white/[0.08] bg-white/[0.02] text-[#C9D1D9]">
            {String(toolCall.output_json.actor_output_type).replace(/_/g, ' ')}
          </span>
        )}
        {agentSlug === 'penn' && (
          <span className="text-[10px] px-2 py-0.5 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300 uppercase tracking-wider">
            approval required
          </span>
        )}
        {toolLabel && (
          <span className="font-mono text-[10px] px-2 py-0.5 rounded-md border border-white/[0.06] bg-white/[0.02] text-[#7D8590]">
            {toolLabel}
          </span>
        )}
      </div>

      <div className="mt-2 text-[10px] text-[#7D8590] flex items-center gap-2 flex-wrap">
        {apifyTotal !== null && <span>{apifyTotal} result{apifyTotal === 1 ? '' : 's'}</span>}
        {apifyTotal !== null && (ts || runShort) && <span className="opacity-40">·</span>}
        {ts && <span>Updated {new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
        {runShort && (
          <>
            <span className="opacity-40">·</span>
            <span>Run <span className="font-mono text-[#C9D1D9]">{runShort}</span></span>
          </>
        )}
      </div>
    </div>
  );
}
