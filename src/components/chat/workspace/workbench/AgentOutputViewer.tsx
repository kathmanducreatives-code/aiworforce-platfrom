import { useEffect, useState } from 'react';
import { fetchToolCallOutput, type DBTask, type DBToolCall, type DBApproval } from '@/lib/orchestration';
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
  // ── THE FULL PAYLOAD IS FETCHED HERE, AND ONLY HERE ────────────────────
  //
  // The plan list deliberately omits `output_json`: it is raw provider output,
  // up to 1.4 MB a row, and refetching every row of a plan on every realtime
  // event is what made the project unresponsive. The list carries a handful of
  // scalars and marks itself `output_truncated`; the one view that renders the
  // whole document loads it for a single row, when it is actually on screen.
  const [fullOutput, setFullOutput] = useState<unknown | null>(null);
  const truncated = (toolCall as unknown as { output_truncated?: boolean } | null)
    ?.output_truncated === true;
  const toolCallId = toolCall?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    setFullOutput(null);
    if (!toolCallId || !truncated) return;
    fetchToolCallOutput(toolCallId).then((o) => { if (!cancelled) setFullOutput(o); });
    return () => { cancelled = true; };
  }, [toolCallId, truncated]);

  // The real document once it has arrived; the truncated scalars until then, so
  // a failure banner still renders immediately rather than waiting on a fetch.
  const outputJson = fullOutput ?? toolCall?.output_json ?? null;
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
        {outputJson && <RawJsonView data={outputJson} />}
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
        {outputJson && <RawJsonView data={outputJson} defaultOpen />}
      </div>
    );
  }

  // Prefer tool_call output when present; fall back to task output.
  const data = outputJson ?? task?.output ?? null;

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
