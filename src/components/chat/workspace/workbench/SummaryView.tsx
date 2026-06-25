import { CheckCircle2, Loader2, Clock, ArrowRight, ShieldCheck, Lock } from 'lucide-react';
import type { DBTask, DBToolCall } from '@/lib/orchestration';
import { workflowTypeFromToolCall, WORKFLOW_LABELS } from './workflowType';
import FailureRecoveryCard from './FailureRecoveryCard';
import { getRecommendedNextStep, type NextStepResult } from '@/lib/workflows/nextStepEngine';
import { useToolAvailability } from '@/lib/workflows/useToolAvailability';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { dispatchNextStepAction } from '@/lib/chatActions';
import { AGENT_BY_ID } from '@/data/agentProfiles';

interface Props {
  task: DBTask | null;
  toolCall: DBToolCall | null;
  agentName: string | null;
  planTitle: string;
  workbenchRows?: any[];
  conversationId?: string | null;
}

function fmtDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function SummaryView({ task, toolCall, agentName, planTitle, workbenchRows, conversationId }: Props) {
  const status = toolCall?.status ?? task?.status ?? 'pending';
  const failed = status === 'failed' || status === 'unavailable';
  const isComplete = status === 'succeeded' || status === 'complete';

  const workflow = workflowTypeFromToolCall(toolCall);
  const workflowLabel = WORKFLOW_LABELS[workflow];

  const output = toolCall?.output_json ?? task?.output ?? null;
  const total =
    typeof output?.total === 'number'
      ? output.total
      : Array.isArray(output?.items)
      ? output.items.length
      : Array.isArray(output?.people)
      ? output.people.length
      : null;

  const duration = fmtDuration(toolCall?.started_at ?? task?.started_at, toolCall?.completed_at ?? task?.finished_at);

  // Narrative sentences
  const requested = planTitle;
  const ran = `${agentName ?? 'The agent'} ran ${workflowLabel}${
    toolCall?.provider ? ` via ${toolCall.provider}` : ''
  }.`;
  let outcome = '';
  if (failed) {
    outcome = 'The step did not complete. See the recovery options below or open the Raw tab for the full payload.';
  } else if (isComplete) {
    outcome =
      total != null
        ? `Returned ${total} result${total === 1 ? '' : 's'}${duration ? ` in ${duration}` : ''}.`
        : `Completed${duration ? ` in ${duration}` : ''}.`;
  } else if (status === 'running' || status === 'queued') {
    outcome = 'Still working. Results will appear here when the step finishes.';
  } else {
    outcome = 'Waiting to start.';
  }

  const StatusIcon = failed ? null : isComplete ? CheckCircle2 : status === 'running' ? Loader2 : Clock;
  const statusTone = failed
    ? 'text-amber-300'
    : isComplete
    ? 'text-emerald-300'
    : 'text-sky-300';

  return (
    <div className="space-y-4">
      {failed && <FailureRecoveryCard toolCall={toolCall} task={task} />}

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
        <Row label="Requested" value={requested} />
        <Row label="What ran" value={ran} />
        <Row
          label="Outcome"
          value={
            <span className={`inline-flex items-center gap-1.5 ${statusTone}`}>
              {StatusIcon && <StatusIcon className={`h-3.5 w-3.5 ${status === 'running' ? 'animate-spin' : ''}`} />}
              <span className="text-[#C9D1D9]">{outcome}</span>
            </span>
          }
        />
      </div>

      {/* Smart next-step recommendation */}
      {isComplete && total != null && total > 0 && (
        <NextStepCard workbenchRows={workbenchRows} conversationId={conversationId} />
      )}
      {isComplete && (total == null || total === 0) && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
          <div className="text-[10px] uppercase tracking-widest text-[#7D8590]">Recommended next</div>
          <div className="mt-1 text-[13px] text-[#C9D1D9] leading-relaxed">
            No results to act on. Try refining the request with Pilot.
          </div>
        </div>
      )}
      {!isComplete && !failed && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
          <div className="text-[10px] uppercase tracking-widest text-[#7D8590]">Recommended next</div>
          <div className="mt-1 text-[13px] text-[#C9D1D9] leading-relaxed">
            No action required yet — Agentory will update this view automatically.
          </div>
        </div>
      )}
      {failed && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
          <div className="text-[10px] uppercase tracking-widest text-[#7D8590]">Recommended next</div>
          <div className="mt-1 text-[13px] text-[#C9D1D9] leading-relaxed">
            Use a recovery action above, or ask Pilot for an alternative path.
          </div>
        </div>
      )}
    </div>
  );
}

function NextStepCard({ workbenchRows, conversationId }: { workbenchRows?: any[]; conversationId?: string | null }) {
  const capabilities = useToolAvailability();
  const { data: brain } = useCompanyBrain();
  const profile = brain?.profile ?? {};

  const step: NextStepResult = getRecommendedNextStep({
    companyBrain: profile,
    workbenchRows: workbenchRows ?? [],
    capabilities,
  });

  const handleClick = () => {
    if (!step.enabled) return;
    dispatchNextStepAction({
      action_id: step.action_id,
      label: step.label,
      conversation_id: conversationId ?? null,
    });
  };

  return (
    <div className="rounded-xl border border-emerald-500/15 bg-gradient-to-r from-emerald-500/[0.04] to-transparent p-4">
      <div className="text-[10px] uppercase tracking-widest text-[#7D8590] mb-2">Recommended next step</div>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-white flex items-center gap-1.5">
            {step.label}
            {!step.enabled && <Lock className="h-3 w-3 text-amber-400" />}
          </div>
          <p className="text-[12.5px] text-[#8B949E] mt-0.5 leading-relaxed">{step.reason}</p>
          {step.blocked_reason && (
            <p className="text-[11.5px] text-amber-300/80 mt-1 flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" /> {step.blocked_reason}
            </p>
          )}
          <div className="flex items-center gap-1 mt-1.5 text-[11px] text-[#7D8590]">
            {step.agent_team.map((slug, i) => (
              <span key={slug}>
                {AGENT_BY_ID[slug]?.name ?? slug}
                {i < step.agent_team.length - 1 && ' → '}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={handleClick}
          disabled={!step.enabled}
          className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold transition-colors ${
            step.enabled
              ? 'bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
              : 'bg-neutral-800 text-neutral-500 border border-white/[0.04] cursor-not-allowed'
          }`}
        >
          <ArrowRight className="h-3.5 w-3.5" />
          Run
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-[#7D8590]">{label}</div>
      <div className="mt-1 text-[13px] text-[#C9D1D9] leading-relaxed">{value}</div>
    </div>
  );
}

