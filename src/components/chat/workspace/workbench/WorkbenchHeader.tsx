import { X } from 'lucide-react';
import AgentBadge from '../plan/AgentBadge';
import type { WorkbenchData } from './useWorkbenchData';

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-white/[0.04] text-[#7D8590] border-white/[0.08]',
  running: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  queued: 'bg-white/[0.04] text-[#7D8590] border-white/[0.08]',
  complete: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  succeeded: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  failed: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
  unavailable: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
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
  data, onClose,
}: { data: WorkbenchData; onClose: () => void }) {
  const { planTitle, task, agentSlug, agentName, toolCall } = data;
  const taskPayload = (task?.payload ?? {}) as Record<string, any>;
  const taskTitle: string = taskPayload.task_title ?? task?.description ?? null;
  const status = task?.status ?? toolCall?.status ?? 'pending';
  const toolLabel = toolCall?.tool_name;
  const provider = toolCall?.provider ? (PROVIDER_LABEL[toolCall.provider.toLowerCase()] ?? toolCall.provider) : null;
  const ts = task?.finished_at ?? task?.started_at ?? toolCall?.completed_at ?? toolCall?.created_at ?? null;
  const apifyTotal = typeof toolCall?.output_json?.total === 'number' ? toolCall.output_json.total : null;

  return (
    <div className="px-4 pt-3 pb-3 border-b border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-widest text-[#7D8590] font-semibold">
            Workbench {agentName ? `· ${agentName} output` : ''}
          </div>
          <div className="mt-0.5 text-[14px] text-[#F0F6FC] font-medium truncate">
            {planTitle}
          </div>
          {taskTitle && (
            <div className="mt-1 text-[12px] text-[#C9D1D9] truncate">{taskTitle}</div>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close workbench"
          className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-white/[0.06] text-[#7D8590] hover:text-[#F0F6FC] shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-[#7D8590]">
        {agentSlug && <AgentBadge slug={agentSlug} />}
        <span className={`text-[10px] px-2 py-0.5 rounded-md border ${STATUS_TONE[status] ?? STATUS_TONE.pending}`}>
          {status.replace('_', ' ')}
        </span>
        {toolLabel && (
          <span className="font-mono text-[10px] px-2 py-0.5 rounded-md border border-white/[0.06] bg-white/[0.03]">
            {toolLabel}
          </span>
        )}
        {provider && <span>· {provider}</span>}
        {apifyTotal !== null && <span>· {apifyTotal} result{apifyTotal === 1 ? '' : 's'}</span>}
        {ts && <span>· {new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
    </div>
  );
}
