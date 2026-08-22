import { useState, useMemo, useEffect } from 'react';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { workbenchQueryKey } from '@/lib/workbench/workbenchSession';
import { readWorkbenchProgress } from '@/lib/workbench/workbenchProgress';
import { readEvaluationRows } from '@/lib/workbench/evaluationRows';
import { readPortfolio, workbenchIsEmpty } from '@/lib/workbench/portfolioView';
import ContinueVerificationBar from './ContinueVerificationBar';
import { canContinueWorkflow, hasStoredCompanyRun } from '@/lib/workbench/continueWorkflow';

import { useWorkbenchData } from './useWorkbenchData';
import WorkbenchHeader from './WorkbenchHeader';
import AgentOutputViewer from './AgentOutputViewer';
import OutputActionBar from './OutputActionBar';
import FailureRecoveryCard from './FailureRecoveryCard';
import NoResultsCard from './NoResultsCard';
import AriaRankingView from './AriaRankingView';
import PennDraftView from './PennDraftView';
import LeadResultsView from './LeadResultsView';
import InsightsView from './InsightsView';
import ActivityTimeline from './ActivityTimeline';
import RawJsonView from './RawJsonView';
import ChatErrorBoundary from '../ChatErrorBoundary';
import { normalizeApifyItems, normalizeApifyPeople, isPeopleOutput, normalizeAriaRankings, normalizePennDrafts } from './normalize';
import { Loader2, FlaskConical, Table2, Sparkles, Activity } from 'lucide-react';

type Tab = 'table' | 'insights' | 'activity';

export default function WorkbenchPanel() {
  const { workspaceId } = useWorkspace();
  const { selectedOutput, activeConversationId, closeWorkbench, openWorkbench } = useChatWorkspace();
  const data = useWorkbenchData(selectedOutput);
  const leadsPanel = selectedOutput?.panel?.kind === 'lead_results' ? selectedOutput.panel : null;

  // REMOUNT WHEN THE OWNER CHANGES.
  //
  // `LeadResultsView` holds a lot of local state: selected rows, per-row action
  // progress, account research views, filters, the open drawer. Clearing the
  // fetched rows alone would leave every one of those pointing at leads that are
  // no longer on screen — a selection of ids from another chat's plan. A `key`
  // change discards all of it in one step, which is the only way to be sure none
  // of it survived.
  const workbenchKey = workbenchQueryKey({
    workspaceId: workspaceId ?? null,
    conversationId: selectedOutput?.conversationId ?? activeConversationId ?? null,
    taskId: selectedOutput?.taskId ?? null,
    planId: selectedOutput?.planId ?? null,
  }).join('|');

  // INCREMENTAL PROGRESS. Written stage by stage by the capability engine into
  // `tasks.result.workbench_progress`, so the panel fills in as the run proceeds
  // instead of staying empty until the very end.
  const taskResult = (data.task as { result?: unknown } | null)?.result ?? null;
  const progress = readWorkbenchProgress(taskResult);
  // Evaluated-but-unqualified companies. A SEPARATE projection from the lead
  // table: these rows have no lead_candidate_id, so nothing can act on them.
  const evaluationRows = readEvaluationRows(taskResult);
  // The ranked portfolio the engine built for this run.
  const portfolio = readPortfolio(taskResult);

  // CONTINUE VERIFICATION. Offered only when the run genuinely stopped owing
  // results AND still holds a paid company dataset — otherwise continuing would
  // just re-run discovery, which is the double-charge this avoids.
  const showContinue = canContinueWorkflow({
    workflowState: data.planStatus === 'partial' ? 'partial' : (data.planStatus ?? null),
    hasStoredCompanyRun: hasStoredCompanyRun(taskResult),
    continuationActive: progress?.in_progress === true,
    hasWorkspaceAccess: !!workspaceId,
    taskId: selectedOutput?.taskId ?? null,
    planId: selectedOutput?.planId ?? null,
    conversationId: selectedOutput?.conversationId ?? activeConversationId ?? null,
  });

  const status = data.task?.status ?? data.toolCall?.status ?? 'pending';
  const failed = status === 'failed' || status === 'unavailable';

  const output = data.toolCall?.output_json ?? (data.task as any)?.output ?? null;
  const peopleMode = isPeopleOutput(output);
  const apifyItems = useMemo(() => peopleMode ? [] : normalizeApifyItems(output), [output, peopleMode]);
  const apifyPeople = useMemo(() => peopleMode ? normalizeApifyPeople(output) : [], [output, peopleMode]);
  const rankings = useMemo(() => normalizeAriaRankings(output), [output]);
  const drafts = useMemo(() => normalizePennDrafts(output), [output]);
  const hasResults = (apifyItems.length + apifyPeople.length) > 0;
  const hasRankings = rankings.length > 0;
  const hasDrafts = drafts.length > 0 && drafts.some((d) => d.subject || d.body || d.linkedin);
  const provider = (data.toolCall?.provider ?? '').toLowerCase();
  const isApify = provider === 'apify' || hasResults;

  const [tab, setTab] = useState<Tab>('table');
  useEffect(() => {
    setTab('table');
  }, [selectedOutput?.taskId, selectedOutput?.toolCallId, selectedOutput?.planId]);

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'table', label: leadsPanel ? 'Opportunities' : 'Table', icon: Table2 },
    { id: 'insights', label: 'Insights', icon: Sparkles },
    { id: 'activity', label: 'Activity', icon: Activity },
  ];

  if (!selectedOutput) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6 text-[#7D8590]">
        <div className="h-12 w-12 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-center justify-center mb-3">
          <FlaskConical className="h-5 w-5 text-emerald-300/80" />
        </div>
        <div className="text-[13px] text-[#C9D1D9] font-medium">Workbench</div>
        <div className="text-[12px] mt-1 max-w-xs">
          Results will appear here after a workflow runs. Start with a recommended workflow from Dashboard or Workflows.
        </div>
      </div>
    );
  }

  if (data.loading && !data.task && !data.toolCall && !leadsPanel) {
    return (
      <div className="h-full flex items-center justify-center text-[#7D8590] text-[12px]">
        <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Loading output…
      </div>
    );
  }

  const noResultsMode: 'people' | 'jobs' | 'companies' | 'generic' =
    peopleMode ? 'people'
    : (data.toolCall?.output_json?.actor_output_type === 'jobs' || (data.toolCall?.tool_name ?? '').includes('job')) ? 'jobs'
    : 'generic';
  const taskPayload = (data.task?.payload ?? {}) as any;
  const noResultsLocation = taskPayload.location ?? data.toolCall?.output_json?.location ?? null;
  const noResultsRole = Array.isArray(taskPayload.role_keywords) ? taskPayload.role_keywords[0] : null;

  const renderTable = () => {
    if (leadsPanel) {
      return <LeadResultsView key={workbenchKey} meta={leadsPanel} conversationId={selectedOutput?.conversationId ?? null} taskId={selectedOutput?.taskId ?? null} />;
    }
    if (failed) return <FailureRecoveryCard toolCall={data.toolCall} task={data.task} />;
    if (!hasResults && !hasRankings && !hasDrafts && isApify) {
      return <NoResultsCard mode={noResultsMode} location={noResultsLocation} role={noResultsRole} />;
    }
    if (hasRankings && !hasResults) return <AriaRankingView output={output} />;
    if (hasDrafts && !hasResults) return <PennDraftView output={output} approval={data.approval} />;
    return (
      <>
        <AgentOutputViewer
          task={data.task}
          toolCall={data.toolCall}
          agentSlug={data.agentSlug}
          approval={data.approval}
        />
        <OutputActionBar agentSlug={data.agentSlug} status={status} />
      </>
    );
  };

  return (
    <div className="h-full w-full flex flex-col min-w-0 min-h-0 overflow-hidden bg-[#0a0d12] relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-emerald-500/[0.03] to-transparent" />

      {!leadsPanel || tab !== 'table' ? (
        <WorkbenchHeader data={data} panel={leadsPanel} onClose={closeWorkbench} onRefresh={data.refresh} />
      ) : (
        <div className="flex items-center justify-between px-4 h-10 border-b border-white/[0.06] shrink-0">
          <div className="text-[11px] text-[#7D8590]">Workbench · Lead results</div>
          <button onClick={closeWorkbench} className="text-[11px] text-[#7D8590] hover:text-[#C9D1D9]">Close</button>
        </div>
      )}

      {/* ── ONE TAB ROW, OWNED BY WHOEVER HAS THE DATA ────────────────────
          The leads path used to render THIS bar (Table / Insights / Activity)
          and then a second set of result states inside a single table below
          it. Its own tabs now live in `LeadResultsView`, which is the only
          place that holds the rows and can therefore count them — a tab
          labelled "Qualified 10" cannot be rendered by a component that does
          not know what qualified. */}
      {!leadsPanel && (
      <div className="flex items-center gap-0.5 px-3 border-b border-white/[0.06] bg-[#0a0d12]/95 backdrop-blur sticky top-0 z-[5] shrink-0">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`group inline-flex items-center gap-1.5 text-[12px] px-3 py-2 -mb-px border-b-2 transition-colors shrink-0 ${
                active
                  ? 'border-emerald-400 text-[#F0F6FC]'
                  : 'border-transparent text-[#7D8590] hover:text-[#C9D1D9]'
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${active ? 'text-emerald-300' : ''}`} />
              {t.label}
              {t.id === 'insights' && failed && (
                <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>
          );
        })}
      </div>
      )}

      {tab === 'table' || leadsPanel ? (
        <div className="flex-1 min-h-0 min-w-0 relative z-[1] overflow-hidden flex flex-col">
          {leadsPanel && showContinue && (
            <ContinueVerificationBar
              originalTaskId={selectedOutput!.taskId!}
              originalPlanId={selectedOutput!.planId!}
              conversationId={(selectedOutput?.conversationId ?? activeConversationId)!}
              onContinued={({ planId, taskId, conversationId }) => {
                // OWNERSHIP FOLLOWS THE CONTINUATION; the conversation does not
                // change, so the user stays in the same chat and Workbench.
                openWorkbench({
                  planId, taskId, conversationId,
                  panel: leadsPanel ? { ...leadsPanel, plan_id: planId } : null,
                });
              }}
            />
          )}
          {/* ── THE LEADS ARE THE ONLY FLEX CHILD ────────────────────────
              PortfolioSummary (11 cells), WorkflowProgressStrip (7 stage
              lines) and EvaluatedCompaniesTable used to render HERE, above and
              below the leads, the last of them taking `max-h-[45%]` of what
              remained. Stacked with the panel header, the tab bar and the
              view's own header and action bar, the qualified leads — the thing
              the user opened the panel for — were left roughly 180px of an
              800px panel, and could not be given more because every sibling
              was fixed-height.

              All three now live inside `RunDetails`, rendered by the view
              itself under the table. Nothing was deleted; it stopped
              outranking the answer. */}
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
            <ChatErrorBoundary>
              {leadsPanel ? (
                <LeadResultsView
                  key={workbenchKey}
                  meta={leadsPanel}
                  conversationId={selectedOutput?.conversationId ?? null}
                  taskId={selectedOutput?.taskId ?? null}
                  portfolio={portfolio}
                  progress={progress}
                  evaluationRows={evaluationRows}
                  // BUILT HERE, PLACED THERE. Both need `data`, which this
                  // component owns; passing the built elements avoids fetching
                  // the leads twice — `useLeadResults` holds plain state with
                  // no shared cache, so a second call is a second query.
                  insightsSlot={<InsightsView data={data} panel={leadsPanel} />}
                  activitySlot={<ActivityTimeline items={data.activity} />}
                />
              ) : (
                <div className="h-full overflow-auto p-4 space-y-3">{renderTable()}</div>
              )}
            </ChatErrorBoundary>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-w-0 overflow-auto p-4 space-y-3 relative z-[1]">
          <ChatErrorBoundary>
            {tab === 'insights' && <InsightsView data={data} panel={leadsPanel} />}
            {tab === 'activity' && <ActivityTimeline items={data.activity} />}
          </ChatErrorBoundary>
        </div>
      )}

      {import.meta.env.DEV && (
        <details className="border-t border-white/[0.04] bg-black/40 shrink-0">
          <summary className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[#7D8590] cursor-pointer hover:text-[#C9D1D9] select-none">
            Dev · raw payload
          </summary>
          <div className="max-h-64 overflow-auto p-3">
            {output != null ? <RawJsonView data={output} defaultOpen /> : <div className="text-[11px] text-[#7D8590]">No raw payload.</div>}
          </div>
        </details>
      )}
    </div>
  );
}
