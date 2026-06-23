import type { DBTask, DBToolCall, DBApproval } from '@/lib/orchestration';
import AgentBadge from './AgentBadge';
import ToolStatusBadge from './ToolStatusBadge';
import ApprovalBadge from './ApprovalBadge';
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { resolveAgent, inferAgentFromContent } from '@/lib/agentResolver';

/** Tiny per-agent outcome chip rendered next to the agent badge. */
function ReactionChip({ slug, task, toolCall }: { slug: string | null; task: DBTask; toolCall?: DBToolCall | null }) {
  if (task.status !== 'complete' && task.status !== 'skipped' && task.status !== 'failed') return null;
  const profile = resolveAgent(slug);
  const accent = profile.accentHex ?? '#7D8590';
  const out = (task.output ?? {}) as Record<string, any>;
  const tcOut = (toolCall?.output_json ?? {}) as Record<string, any>;
  const total = typeof tcOut.total === 'number' ? tcOut.total : (typeof out.total === 'number' ? out.total : null);

  let label: string | null = null;
  if (task.status === 'skipped') label = 'Skipped';
  else if (task.status === 'failed') label = 'Blocked';
  else {
    switch (profile.id) {
      case 'scout':  label = total != null ? `${total} qualified` : 'Sourced'; break;
      case 'aria':   label = total != null ? `${total} ranked` : 'Ranked'; break;
      case 'hawk':   label = total != null ? `${total} researched` : 'Researched'; break;
      case 'penn':   label = total != null ? `${total} drafts` : 'Draft ready'; break;
      case 'scribe': label = 'Written'; break;
      case 'pilot':  label = 'Coordinated'; break;
      default:       label = 'Done';
    }
  }
  if (!label) return null;
  const dim = task.status === 'skipped';
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-medium border"
      style={{
        color: dim ? '#7D8590' : accent,
        borderColor: dim ? 'rgba(125,133,144,0.25)' : `${accent}55`,
        background: dim ? 'rgba(125,133,144,0.05)' : `${accent}14`,
      }}
    >
      {label}
    </span>
  );
}


interface Props {
  index: number;
  task: DBTask;
  agentSlug: string | null;
  latestToolCall?: DBToolCall | null;
  approval?: DBApproval | null;
  connectorMissingFor: (tool: string | null | undefined) => boolean;
  onReviewApproval?: () => void;
  onOpenOutput?: (taskId: string, toolCallId?: string | null) => void;
}

function StatusIcon({ status }: { status: DBTask['status'] }) {
  if (status === 'complete') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
  if (status === 'running')  return <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />;
  if (status === 'failed')   return <XCircle className="h-3.5 w-3.5 text-rose-400" />;
  if (status === 'skipped')  return <Circle className="h-3.5 w-3.5 text-[#484F58]" />;
  return <Circle className="h-3.5 w-3.5 text-[#484F58]" />;
}

function outputPreview(output: unknown): string | null {
  if (!output) return null;
  if (typeof output === 'string') return output.slice(0, 220);
  try {
    const s = JSON.stringify(output);
    return s.length > 220 ? s.slice(0, 220) + '…' : s;
  } catch { return null; }
}

export default function ExecutionTaskRow({
  index, task, agentSlug, latestToolCall, approval, connectorMissingFor, onReviewApproval, onOpenOutput,
}: Props) {
  const payload = (task.payload ?? {}) as Record<string, any>;
  const toolNeeded: string | null = payload.tool_needed ?? null;
  const expected: string | null = payload.expected_output ?? null;
  const success: string | null = payload.success_criteria ?? null;
  const requiresApproval: boolean = !!payload.requires_approval;
  const title: string = payload.task_title ?? task.description ?? `Step ${index + 1}`;
  const metaToolInput = (payload.metadata?.tool_input ?? payload.tool_input ?? null) as
    | { selected_actor_key?: string | null; reason?: string | null }
    | null;
  const actorKey = metaToolInput?.selected_actor_key ?? null;
  const actorReason = metaToolInput?.reason ?? null;

  const canOpenOutput =
    !!onOpenOutput && (task.status === 'complete' || task.status === 'failed' || !!latestToolCall);

  return (
    <li
      className={`rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 ${canOpenOutput ? 'hover:bg-white/[0.04] hover:border-white/[0.10] cursor-pointer transition-colors' : ''}`}
      onClick={canOpenOutput ? () => onOpenOutput!(task.id, latestToolCall?.id ?? null) : undefined}
    >

      <div className="flex items-start gap-3 flex-wrap">
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.05] text-[#7D8590] shrink-0">
          {String(index + 1).padStart(2, '0')}
        </span>
        <StatusIcon status={task.status} />
        <AgentBadge slug={agentSlug} />
        <ReactionChip slug={agentSlug} task={task} toolCall={latestToolCall} />

        <div className="flex-1 min-w-[200px]">
          <div className="text-[13px] text-[#F0F6FC] leading-snug">{title}</div>
          {task.description && task.description !== title && (
            <div className="text-[12px] text-[#7D8590] mt-0.5">{task.description}</div>
          )}
        </div>
      </div>

      {(expected || success) && (
        <div className="mt-2 pl-1 space-y-1 text-[11px] text-[#A6ADB8]">
          {expected && <div><span className="text-[#7D8590]">Output:</span> {expected}</div>}
          {success && <div><span className="text-[#7D8590]">Done when:</span> {success}</div>}
        </div>
      )}

      {(actorKey || actorReason) && (
        <div className="mt-2 pl-1 text-[11px] text-emerald-300/90 flex items-center gap-2 flex-wrap">
          {actorKey && <span className="font-mono">{actorKey}</span>}
          {(() => {
            const err = (latestToolCall?.error ?? '') as string;
            const disabled = err === 'actor_missing' || err === 'actor_key_unknown' || err === 'apify_actor_disabled_by_default';
            return disabled ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">
                disabled
              </span>
            ) : null;
          })()}
          {actorReason && <span className="text-[#C9D1D9]">— {actorReason}</span>}
        </div>
      )}



      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {(toolNeeded || latestToolCall) && (
          <span
            onClick={(e) => {
              if (!onOpenOutput) return;
              e.stopPropagation();
              onOpenOutput(task.id, latestToolCall?.id ?? null);
            }}
            className={onOpenOutput ? 'cursor-pointer' : ''}
          >
            <ToolStatusBadge
              toolNeeded={toolNeeded}
              latestCall={latestToolCall ?? null}
              connectorMissing={connectorMissingFor(toolNeeded)}
            />
          </span>
        )}
        {(requiresApproval || approval) && (
          <ApprovalBadge approval={approval ?? null} onReview={onReviewApproval} />
        )}
        {canOpenOutput && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenOutput!(task.id, latestToolCall?.id ?? null); }}
            className="ml-auto text-[11px] text-emerald-300 hover:text-emerald-200"
          >
            View output →
          </button>
        )}
      </div>

      {task.status === 'failed' && (latestToolCall?.error || (task.output as any)?.error) && (
        <div className="mt-2 text-[11px] text-rose-300 bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1">
          {(latestToolCall?.error ?? (task.output as any)?.error ?? '').toString().slice(0, 240)}
        </div>
      )}

      {task.status === 'complete' && outputPreview(task.output) && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-[#7D8590] hover:text-[#C9D1D9]">Output preview</summary>
          <pre className="mt-1 text-[11px] text-[#C9D1D9] whitespace-pre-wrap break-words bg-white/[0.02] border border-white/[0.06] rounded p-2 max-h-40 overflow-auto">
{outputPreview(task.output)}
          </pre>
        </details>
      )}
    </li>
  );
}
