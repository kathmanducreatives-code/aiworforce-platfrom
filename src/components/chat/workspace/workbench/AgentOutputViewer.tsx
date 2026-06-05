import type { DBTask, DBToolCall, DBApproval } from '@/lib/orchestration';
import ScoutResultsView from './ScoutResultsView';
import AriaRankingView from './AriaRankingView';
import HawkResearchView from './HawkResearchView';
import PennDraftView from './PennDraftView';
import ScribeReportView from './ScribeReportView';
import RawJsonView from './RawJsonView';

interface Props {
  task: DBTask | null;
  toolCall: DBToolCall | null;
  agentSlug: string | null;
  approval: DBApproval | null;
}

function pickViewer(agentSlug: string | null, toolCall: DBToolCall | null) {
  const slug = (agentSlug ?? '').toLowerCase();
  if (slug === 'scout') return 'scout';
  if (slug === 'aria') return 'aria';
  if (slug === 'hawk') return 'hawk';
  if (slug === 'penn') return 'penn';
  if (slug === 'scribe') return 'scribe';

  const provider = (toolCall?.provider ?? '').toLowerCase();
  const tool = (toolCall?.tool_name ?? '').toLowerCase();
  if (provider === 'apify' || tool === 'source_with_apify') return 'scout';
  if (provider === 'firecrawl' || tool === 'scrape_url') return 'hawk';
  return 'raw';
}

export default function AgentOutputViewer({ task, toolCall, agentSlug, approval }: Props) {
  // Tool call failure
  if (toolCall && toolCall.status === 'failed') {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
          <div className="text-[12px] text-rose-300 font-medium">Tool failed</div>
          {toolCall.error && (
            <div className="mt-1 text-[12px] text-rose-200/80 break-words">{toolCall.error}</div>
          )}
        </div>
        {toolCall.output_json && <RawJsonView data={toolCall.output_json} />}
      </div>
    );
  }

  if (toolCall && toolCall.status === 'unavailable') {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="text-[12px] text-amber-300 font-medium">Tool unavailable</div>
          {toolCall.error && (
            <div className="mt-1 text-[12px] text-amber-200/80 break-words">{toolCall.error}</div>
          )}
        </div>
        {toolCall.output_json && <RawJsonView data={toolCall.output_json} defaultOpen />}
      </div>
    );
  }

  // Prefer tool_call output when present; fall back to task output.
  const data = toolCall?.output_json ?? task?.output ?? null;

  if (data == null) {
    const running = task?.status === 'running' || toolCall?.status === 'running' || toolCall?.status === 'queued';
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-6 text-center">
        <div className="text-[13px] text-[#C9D1D9]">
          {running ? 'Output not available yet. The agent may still be working.' : 'No output for this step.'}
        </div>
      </div>
    );
  }

  const viewer = pickViewer(agentSlug, toolCall);
  switch (viewer) {
    case 'scout': return <ScoutResultsView output={data} />;
    case 'aria': return <AriaRankingView output={data} />;
    case 'hawk': return <HawkResearchView output={data} />;
    case 'penn': return <PennDraftView output={data} approval={approval} />;
    case 'scribe': return <ScribeReportView output={data} />;
    default: return <RawJsonView data={data} defaultOpen />;
  }
}
