import { useState, useMemo, useEffect } from 'react';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';

import { useWorkbenchData } from './useWorkbenchData';
import WorkbenchHeader from './WorkbenchHeader';
import AgentOutputViewer from './AgentOutputViewer';
import OutputActionBar from './OutputActionBar';
import SummaryView from './SummaryView';
import RawJsonView from './RawJsonView';
import FailureRecoveryCard from './FailureRecoveryCard';
import NoResultsCard from './NoResultsCard';
import AriaRankingView from './AriaRankingView';
import PennDraftView from './PennDraftView';
import HawkResearchView from './HawkResearchView';
import LeadResultsView from './LeadResultsView';
import ChatErrorBoundary from '../ChatErrorBoundary';
import { normalizeApifyItems, normalizeApifyPeople, isPeopleOutput, normalizeAriaRankings, normalizePennDrafts, normalizeFirecrawl } from './normalize';
import { Loader2, FlaskConical, FileText, ListChecks, Activity, Code2, Trophy, Mail, Link2, Users } from 'lucide-react';

type Tab = 'leads' | 'summary' | 'results' | 'rankings' | 'drafts' | 'sources' | 'activity' | 'raw';

export default function WorkbenchPanel() {
  const { selectedOutput, closeWorkbench } = useChatWorkspace();

  const data = useWorkbenchData(selectedOutput);

  const leadsPanel = selectedOutput?.panel?.kind === 'lead_results' ? selectedOutput.panel : null;

  const status = data.task?.status ?? data.toolCall?.status ?? 'pending';
  const failed = status === 'failed' || status === 'unavailable';

  // Derived data — keep ALL hooks above early returns to satisfy hooks rules.
  const output = data.toolCall?.output_json ?? (data.task as any)?.output ?? null;
  const peopleMode = isPeopleOutput(output);
  const apifyItems = useMemo(() => peopleMode ? [] : normalizeApifyItems(output), [output, peopleMode]);
  const apifyPeople = useMemo(() => peopleMode ? normalizeApifyPeople(output) : [], [output, peopleMode]);
  const rankings = useMemo(() => normalizeAriaRankings(output), [output]);
  const drafts = useMemo(() => normalizePennDrafts(output), [output]);
  const firecrawl = useMemo(() => normalizeFirecrawl(output), [output]);
  const hasResults = (apifyItems.length + apifyPeople.length) > 0;
  const hasRankings = rankings.length > 0;
  const hasDrafts = drafts.length > 0 && drafts.some((d) => d.subject || d.body || d.linkedin);
  const hasSources = !!(firecrawl.url || firecrawl.markdown || (firecrawl.citations?.length ?? 0) > 0);
  const provider = (data.toolCall?.provider ?? '').toLowerCase();
  const isApify = provider === 'apify' || hasResults;
  const isFirecrawl = provider === 'firecrawl' || hasSources;
  const isPenn = data.agentSlug === 'penn' || hasDrafts;
  const isAria = data.agentSlug === 'aria' || hasRankings;

  // Default tab: results-first; never default to summary or raw.
  const pickDefault = (): Tab => {
    if (leadsPanel) return 'leads';
    if (hasResults) return 'results';
    if (hasRankings) return 'rankings';
    if (hasDrafts) return 'drafts';
    if (hasSources) return 'sources';
    return 'summary';
  };
  const [tab, setTab] = useState<Tab>(pickDefault);

  // Reset tab when selection changes
  useEffect(() => {
    setTab(pickDefault());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOutput?.taskId, selectedOutput?.toolCallId, selectedOutput?.planId, leadsPanel, hasResults, hasRankings, hasDrafts, hasSources]);

  const tabs: { id: Tab; label: string; icon: any }[] = useMemo(() => {
    const list: { id: Tab; label: string; icon: any }[] = [];
    if (leadsPanel) list.push({ id: 'leads', label: 'Leads', icon: Users });
    if (hasResults || failed || isApify) list.push({ id: 'results', label: 'Results', icon: ListChecks });
    if (hasRankings || isAria) list.push({ id: 'rankings', label: 'Rankings', icon: Trophy });
    if (hasDrafts || isPenn) list.push({ id: 'drafts', label: 'Drafts', icon: Mail });
    if (hasSources || isFirecrawl) list.push({ id: 'sources', label: 'Sources', icon: Link2 });
    list.push({ id: 'summary', label: 'Summary', icon: FileText });
    list.push({ id: 'activity', label: 'Activity', icon: Activity });
    list.push({ id: 'raw', label: 'Raw', icon: Code2 });
    return list;
  }, [hasResults, hasRankings, hasDrafts, hasSources, isApify, isFirecrawl, isPenn, isAria, failed, leadsPanel]);

  // Snap to a valid tab if the current one isn't available
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab(tabs[0]?.id ?? 'summary');
  }, [tabs, tab]);

  if (!selectedOutput) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6 text-[#7D8590]">
        <div className="h-12 w-12 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-center justify-center mb-3">
          <FlaskConical className="h-5 w-5 text-emerald-300/80" />
        </div>
        <div className="text-[13px] text-[#C9D1D9] font-medium">Workbench</div>
        <div className="text-[12px] mt-1 max-w-xs">
          Pick a step or tool from any plan to inspect its output, recover from failures, and trigger the next action.
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

  // Mode for NoResultsCard
  const noResultsMode: 'people' | 'jobs' | 'companies' | 'generic' =
    peopleMode ? 'people'
    : (data.toolCall?.output_json?.actor_output_type === 'jobs' || (data.toolCall?.tool_name ?? '').includes('job')) ? 'jobs'
    : 'generic';
  const taskPayload = (data.task?.payload ?? {}) as any;
  const noResultsLocation = taskPayload.location ?? data.toolCall?.output_json?.location ?? null;
  const noResultsRole = Array.isArray(taskPayload.role_keywords) ? taskPayload.role_keywords[0] : null;

  const rawData = data.toolCall?.output_json ?? data.task?.output ?? null;

  return (
    <div className="h-full w-full flex flex-col min-w-0 min-h-0 overflow-hidden bg-[#0a0d12] relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-emerald-500/[0.03] to-transparent" />
      {!leadsPanel || tab !== 'leads' ? (
        <WorkbenchHeader data={data} panel={leadsPanel} onClose={closeWorkbench} onRefresh={data.refresh} />
      ) : (
        <div className="flex items-center justify-between px-4 h-10 border-b border-white/[0.06] shrink-0">
          <div className="text-[11px] text-[#7D8590]">Workbench · Lead results</div>
          <button onClick={closeWorkbench} className="text-[11px] text-[#7D8590] hover:text-[#C9D1D9]">Close</button>
        </div>
      )}

      <div className="flex items-center gap-0.5 px-3 border-b border-white/[0.06] bg-[#0a0d12]/95 backdrop-blur sticky top-0 z-[5] shrink-0 overflow-x-auto">
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
              {t.id === 'summary' && failed && (
                <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>
          );
        })}
      </div>

      {tab === 'leads' && leadsPanel ? (
        <div className="flex-1 min-h-0 min-w-0 relative z-[1] overflow-hidden">
          <ChatErrorBoundary>
            <LeadResultsView meta={leadsPanel} conversationId={selectedOutput?.conversationId ?? null} />
          </ChatErrorBoundary>
        </div>
      ) : (
      <div className="flex-1 min-w-0 overflow-auto p-4 space-y-3 relative z-[1]">
          <ChatErrorBoundary>
            {tab === 'summary' && (
              <>
                <SummaryView
                  task={data.task}
                  toolCall={data.toolCall}
                  agentName={data.agentName}
                  planTitle={data.planTitle}
                />
                <OutputActionBar agentSlug={data.agentSlug} status={status} />
              </>
            )}
            {tab === 'results' && (
              <>
                {failed ? (
                  <FailureRecoveryCard toolCall={data.toolCall} task={data.task} />
                ) : !hasResults && isApify ? (
                  <NoResultsCard mode={noResultsMode} location={noResultsLocation} role={noResultsRole} />
                ) : (
                  <AgentOutputViewer
                    task={data.task}
                    toolCall={data.toolCall}
                    agentSlug={data.agentSlug}
                    approval={data.approval}
                  />
                )}
                <OutputActionBar agentSlug={data.agentSlug} status={status} />
              </>
            )}
            {tab === 'rankings' && (
              <AriaRankingView output={output} />
            )}
            {tab === 'drafts' && (
              <PennDraftView output={output} approval={data.approval} />
            )}
            {tab === 'sources' && (
              <HawkResearchView output={output} />
            )}
            {tab === 'activity' && (
              <ul className="space-y-2">
                {data.activity.length === 0 && (
                  <li className="text-[12px] text-[#7D8590]">No activity yet.</li>
                )}
                {data.activity.map((a) => (
                  <li key={a.id} className="relative rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 pl-6">
                    <span className="absolute left-2 top-3 h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                    <div className="text-[10px] uppercase tracking-wider text-[#7D8590]">
                      {new Date(a.created_at).toLocaleTimeString()} · {a.event_type.replace('_', ' ')}
                    </div>
                    <div className="text-[12px] text-[#C9D1D9] mt-0.5">{a.title}</div>
                    {a.body && <div className="text-[11px] text-[#7D8590] mt-0.5">{a.body}</div>}
                  </li>
                ))}
              </ul>
            )}
            {tab === 'raw' && (
              <div className="space-y-3">
                {failed && data.toolCall?.error && (
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded border border-amber-500/25 bg-amber-500/[0.06] text-amber-200">
                    <span className="opacity-70">error code:</span> {data.toolCall.error}
                  </div>
                )}
                {rawData != null ? (
                  <RawJsonView data={rawData} defaultOpen />
                ) : (
                  <div className="text-[12px] text-[#7D8590]">No raw payload available.</div>
                )}
              </div>
            )}
          </ChatErrorBoundary>
        </div>
      )}
    </div>
  );
}
