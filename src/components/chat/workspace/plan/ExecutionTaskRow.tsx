import { useState } from 'react';
import type { DBTask, DBToolCall, DBApproval } from '@/lib/orchestration';
import AgentBadge from './AgentBadge';
import ToolStatusBadge from './ToolStatusBadge';
import ApprovalBadge from './ApprovalBadge';
import { CheckCircle2, ChevronRight, Circle, Loader2, PauseCircle, ShieldAlert, XCircle } from 'lucide-react';
import { resolveAgent, inferAgentFromContent } from '@/lib/agentResolver';

/** Tiny per-agent outcome chip rendered next to the agent badge. */
function ReactionChip({ slug, task, toolCall }: { slug: string | null; task: DBTask; toolCall?: DBToolCall | null }) {
  if (task.status !== 'complete' && task.status !== 'skipped'
      && task.status !== 'failed' && task.status !== 'blocked') return null;
  const profile = resolveAgent(slug);
  const accent = profile.accentHex ?? '#7D8590';
  const out = (task.output ?? {}) as Record<string, any>;
  const tcOut = (toolCall?.output_json ?? {}) as Record<string, any>;
  const total = typeof tcOut.total === 'number' ? tcOut.total : (typeof out.total === 'number' ? out.total : null);

  let label: string | null = null;
  if (task.status === 'skipped') label = 'Skipped';
  // A REFUSAL AND A FAILURE ARE DIFFERENT EVENTS, and they were labelled the
  // same. `failed` here read "Blocked" while the plan pill read "failed" and a
  // fabricated Penn step added "approval required" — three words for one
  // preflight refusal, none of which said what to supply.
  else if (task.status === 'blocked') label = 'Blocked';
  else if (task.status === 'failed') label = 'Failed';
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
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border shrink-0"
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
  if (status === 'complete') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
  if (status === 'running')  return <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400 shrink-0" />;
  if (status === 'failed')   return <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />;
  // AMBER, NOT RED. Nothing went wrong — a guard declined, and the reason is
  // rendered beside it.
  if (status === 'blocked')  return <ShieldAlert className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
  // PAUSED WITH WORK SAVED — not spinning, not finished, not broken.
  if (status === 'ready')    return <PauseCircle className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
  if (status === 'skipped')  return <Circle className="h-3.5 w-3.5 text-[#484F58] shrink-0" />;
  return <Circle className="h-3.5 w-3.5 text-[#484F58] shrink-0" />;
}

export default function ExecutionTaskRow({
  index, task, agentSlug, latestToolCall, approval, connectorMissingFor, onReviewApproval, onOpenOutput,
}: Props) {
  const [expanded, setExpanded] = useState(false);
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

  const effectiveSlug = agentSlug
    ?? (task as any).agent_slug
    ?? payload.agent_slug
    ?? inferAgentFromContent(`${title} ${task.description ?? ''}`)
    ?? null;

  const canOpenOutput =
    !!onOpenOutput && (task.status === 'complete' || task.status === 'failed'
      || task.status === 'blocked' || !!latestToolCall);

  const connectorMissing = connectorMissingFor(toolNeeded);
  const showToolBadge = (task.status === 'failed' || connectorMissing) && (toolNeeded || latestToolCall);
  // ── THE REASON THE BACKEND RECORDED, NOT A GUESS ───────────────────────
  //
  // A blocked run carries `blocked_by` codes naming exactly what was missing
  // ("no LeadMissionV1 on this task"). The row showed a red X and a tool badge
  // instead, so the one piece of information that said what to fix was the one
  // thing never rendered.
  const blockedBy = task.status === 'blocked'
    ? (((task.result as any)?.terminal_record?.blocked_by ?? []) as Array<{ code?: string; message?: string }>)
    : [];
  const errorText = task.status === 'blocked'
    ? (blockedBy.map((b) => b.message || b.code).filter(Boolean).join(' · ')
      || String((task as any).error_message ?? 'refused before execution'))
    : task.status === 'failed'
    ? ((latestToolCall?.error ?? (task.output as any)?.error ?? '') as string)
    : '';

  const hasExpandable = !!(expected || success || actorKey || actorReason);

  return (
    <li
      className={`group rounded-md border border-white/[0.05] bg-white/[0.02] ${canOpenOutput ? 'hover:bg-white/[0.05] hover:border-white/[0.09] cursor-pointer' : ''} transition-colors`}
      onClick={canOpenOutput ? () => onOpenOutput!(task.id, latestToolCall?.id ?? null) : undefined}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 min-w-0">
        <span className="text-[10.5px] font-mono text-[#6b7480] shrink-0 w-6 text-right">
          {String(index + 1).padStart(2, '0')}
        </span>
        <StatusIcon status={task.status} />
        <AgentBadge slug={effectiveSlug} />

        <div className="flex-1 min-w-0 text-[13px] text-[#F0F6FC] truncate" title={title}>
          {title}
        </div>

        <ReactionChip slug={effectiveSlug} task={task} toolCall={latestToolCall} />

        {showToolBadge && (
          <span onClick={(e) => e.stopPropagation()} className="shrink-0">
            <ToolStatusBadge
              toolNeeded={toolNeeded}
              latestCall={latestToolCall ?? null}
              connectorMissing={connectorMissing}
            />
          </span>
        )}

        {(requiresApproval || approval) && (
          <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <ApprovalBadge approval={approval ?? null} onReview={onReviewApproval} />
          </span>
        )}

        {hasExpandable && (
          <button
            type="button"
            aria-label={expanded ? 'Hide details' : 'Show details'}
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="shrink-0 p-0.5 rounded hover:bg-white/[0.06] text-[#7D8590]"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        )}

        {canOpenOutput && (
          <ChevronRight className="h-3.5 w-3.5 text-[#484F58] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>

      {expanded && hasExpandable && (
        <div className="px-2.5 pb-2 pl-[52px] space-y-0.5 text-[11px] text-[#A6ADB8]">
          {expected && <div><span className="text-[#7D8590]">Output:</span> {expected}</div>}
          {success && <div><span className="text-[#7D8590]">Done when:</span> {success}</div>}
          {(actorKey || actorReason) && (
            <div className="flex items-center gap-2 flex-wrap text-emerald-300/90">
              {actorKey && <span className="font-mono">{actorKey}</span>}
              {actorReason && <span className="text-[#C9D1D9]">— {actorReason}</span>}
            </div>
          )}
        </div>
      )}

      {errorText && (
        <div className="mx-2.5 mb-1.5 text-[11px] text-rose-300 bg-rose-500/5 border border-rose-500/20 rounded px-2 py-0.5 truncate" title={errorText}>
          {errorText}
        </div>
      )}
    </li>
  );
}
