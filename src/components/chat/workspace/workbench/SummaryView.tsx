import { CheckCircle2, Loader2, Clock } from 'lucide-react';
import type { DBTask, DBToolCall } from '@/lib/orchestration';
import { workflowTypeFromToolCall, WORKFLOW_LABELS } from './workflowType';
import FailureRecoveryCard from './FailureRecoveryCard';

interface Props {
  task: DBTask | null;
  toolCall: DBToolCall | null;
  agentName: string | null;
  planTitle: string;
}

function fmtDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function SummaryView({ task, toolCall, agentName, planTitle }: Props) {
  const status = toolCall?.status ?? task?.status ?? 'pending';
  const failed = status === 'failed' || status === 'unavailable';

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
  } else if (status === 'succeeded' || status === 'complete') {
    outcome =
      total != null
        ? `Returned ${total} result${total === 1 ? '' : 's'}${duration ? ` in ${duration}` : ''}.`
        : `Completed${duration ? ` in ${duration}` : ''}.`;
  } else if (status === 'running' || status === 'queued') {
    outcome = 'Still working. Results will appear here when the step finishes.';
  } else {
    outcome = 'Waiting to start.';
  }

  const nextStep =
    failed
      ? 'Use a recovery action above, or ask Pilot for an alternative path.'
      : status === 'succeeded' || status === 'complete'
      ? total && total > 0
        ? 'Review the Results tab and pick a follow-up action — rank, enrich, draft outreach, or export.'
        : 'No results to act on. Try refining the request with Pilot.'
      : 'No action required yet — Agentory will update this view automatically.';

  const StatusIcon = failed ? null : status === 'succeeded' || status === 'complete' ? CheckCircle2 : status === 'running' ? Loader2 : Clock;
  const statusTone = failed
    ? 'text-amber-300'
    : status === 'succeeded' || status === 'complete'
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
        <Row label="Recommended next" value={nextStep} />
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
