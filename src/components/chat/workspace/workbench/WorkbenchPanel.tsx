import { useState, useMemo, useEffect } from 'react';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { dispatchNextAction, isSendNextAction, NEXT_ACTION_LABEL, type NextActionId } from '@/lib/chatActions';
import { useIsMobile } from '@/hooks/use-mobile';
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

type Tab = 'leads' | 'insights' | 'summary' | 'results' | 'rankings' | 'drafts' | 'sources' | 'activity' | 'raw';

export default function WorkbenchPanel() {
  const { selectedOutput, closeWorkbench, workbenchWidth, setWorkbenchWidth } = useChatWorkspace();
  const isMobile = useIsMobile();
  const data = useWorkbenchData(selectedOutput);

  const leadsPanel = selectedOutput?.panel?.kind === 'lead_results' ? selectedOutput.panel : null;

  const status = data.task?.status ?? data.toolCall?.status ?? 'pending';
  const failed = status === 'failed' || status === 'unavailable';

  // Default tab: 'leads' when a lead_results panel hint is present, else 'summary'.
  const defaultTab: Tab = leadsPanel ? 'leads' : 'summary';
  const [tab, setTab] = useState<Tab>(defaultTab);

  // Reset tab when selection changes
  useEffect(() => {
    setTab(leadsPanel ? 'leads' : 'summary');
  }, [selectedOutput?.taskId, selectedOutput?.toolCallId, selectedOutput?.planId, leadsPanel]);

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

  const tabs: { id: Tab; label: string; icon: any }[] = useMemo(() => {
    const list: { id: Tab; label: string; icon: any }[] = [];
    if (leadsPanel) list.push({ id: 'leads', label: 'Leads', icon: Users });
    if (leadsPanel && (leadsPanel as { insights?: unknown }).insights) list.push({ id: 'insights', label: 'Insights', icon: FlaskConical });
    list.push({ id: 'summary', label: 'Summary', icon: FileText });
    if (hasResults || failed || isApify) list.push({ id: 'results', label: 'Results', icon: ListChecks });
    if (hasRankings || isAria) list.push({ id: 'rankings', label: 'Rankings', icon: Trophy });
    if (hasDrafts || isPenn) list.push({ id: 'drafts', label: 'Drafts', icon: Mail });
    if (hasSources || isFirecrawl) list.push({ id: 'sources', label: 'Sources', icon: Link2 });
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

  // Drag-resize (desktop only)
  const onResizePointerDown = (e: React.PointerEvent) => {
    if (isMobile) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = workbenchWidth;
    const move = (ev: PointerEvent) => {
      const dx = startX - ev.clientX;
      const next = Math.max(360, Math.min(900, startW + dx));
      setWorkbenchWidth(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const rawData = data.toolCall?.output_json ?? data.task?.output ?? null;

  return (
    <div className="h-full flex flex-row">
      {!isMobile && (
        <div
          onPointerDown={onResizePointerDown}
          className="w-1 hover:w-1.5 bg-transparent hover:bg-emerald-500/30 cursor-col-resize transition-all shrink-0"
          aria-hidden
        />
      )}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0a0d12] relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-emerald-500/[0.03] to-transparent" />
        {!leadsPanel || tab !== 'leads' ? (
          <WorkbenchHeader data={data} onClose={closeWorkbench} onRefresh={data.refresh} />
        ) : (
          <div className="flex items-center justify-between px-4 h-10 border-b border-white/[0.06]">
            <div className="text-[11px] text-[#7D8590]">Workbench · Lead results</div>
            <button onClick={closeWorkbench} className="text-[11px] text-[#7D8590] hover:text-[#C9D1D9]">Close</button>
          </div>
        )}

        <div className="flex items-center gap-0.5 px-3 border-b border-white/[0.06] bg-white/[0.01]">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`group inline-flex items-center gap-1.5 text-[12px] px-3 py-2 -mb-px border-b-2 transition-colors ${
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
          <div className="flex-1 min-h-0 relative z-[1]">
            <ChatErrorBoundary>
              <LeadResultsView meta={leadsPanel} conversationId={selectedOutput?.conversationId ?? null} />
            </ChatErrorBoundary>
          </div>
        ) : (
        <div className="flex-1 overflow-auto p-4 space-y-3 relative z-[1]">
          <ChatErrorBoundary>
            {tab === 'insights' && leadsPanel && (() => {
              const panel = leadsPanel as Record<string, any>;
              const ins = panel.insights ?? {};
              const outcome = panel.outcome ?? null;
              const nextActions: string[] = Array.isArray(panel.next_actions) ? panel.next_actions : [];
              const sourceBrief: string | null = panel.source_brief ?? null;
              const acceptRate = (typeof ins.raw_reviewed === 'number' && ins.raw_reviewed > 0 && typeof ins.accepted === 'number')
                ? Math.round((ins.accepted / ins.raw_reviewed) * 100) : null;
              const tone = outcome?.status === 'complete' ? 'text-emerald-300'
                : outcome?.status === 'partial' ? 'text-amber-300' : 'text-red-300';
              const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
                <div className="flex gap-2 text-[12px] py-0.5"><span className="text-[#7D8590] w-32 shrink-0">{k}</span><span className="text-[#C9D1D9]">{v}</span></div>
              );
              return (
                <div className="space-y-3">
                  {/* Outcome */}
                  {outcome?.line && (
                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className={`text-[12px] font-semibold ${tone}`}>{outcome.line}</div>
                    </div>
                  )}
                  {/* Search strategy — human phrasing */}
                  <div>
                    <div className="text-[12px] font-semibold text-[#F0F6FC] mb-1">Search strategy</div>
                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                      {ins.primary_query && (
                        <div className="text-[12px] text-[#C9D1D9] mb-1.5">
                          Scout searched <span className="text-[#F0F6FC]">{ins.source ?? 'the source'}</span> using:{' '}
                          <span className="text-emerald-300">{ins.primary_query}</span>
                        </div>
                      )}
                      <Row k="Input planner" v={ins.planner === 'ai' ? 'Claude' : (ins.planner ?? 'deterministic')} />
                      {Array.isArray(ins.role_aliases) && ins.role_aliases.length > 0 && <Row k="Role aliases" v={ins.role_aliases.join(', ')} />}
                    </div>
                  </div>
                  {/* Quality summary */}
                  <div>
                    <div className="text-[12px] font-semibold text-[#F0F6FC] mb-1">Quality summary</div>
                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                      <Row k="Raw reviewed" v={ins.raw_reviewed ?? '—'} />
                      <Row k="Accepted" v={ins.accepted ?? '—'} />
                      <Row k="Rejected" v={ins.rejected ?? '—'} />
                      <Row k="Duplicates" v={ins.duplicates ?? '—'} />
                      {acceptRate != null && <Row k="Acceptance rate" v={`${acceptRate}%`} />}
                      {Array.isArray(ins.main_reject_reasons) && ins.main_reject_reasons.length > 0 && (
                        <Row k="Main reject reason" v={ins.main_reject_reasons.join(', ')} />
                      )}
                    </div>
                  </div>
                  {/* Attempts */}
                  {Array.isArray(ins.attempts) && ins.attempts.length > 0 && (
                    <div>
                      <div className="text-[12px] font-semibold text-[#F0F6FC] mb-1">Attempts</div>
                      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-0.5">
                        {ins.attempts.map((a: string, i: number) => <div key={i} className="text-[12px] text-[#C9D1D9]">{a}</div>)}
                      </div>
                    </div>
                  )}
                  {/* Next actions — Broaden search etc. */}
                  {nextActions.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {(nextActions as NextActionId[]).filter((a) => isSendNextAction(a)).map((a) => (
                        <button
                          key={a}
                          onClick={() => dispatchNextAction(a, { conversationId: selectedOutput?.conversationId ?? null, sourceBrief, planId: panel.plan_id })}
                          className={`h-7 px-3 rounded-md text-[12px] font-medium ${a === 'broaden_search' ? 'bg-emerald-500/90 hover:bg-emerald-500 text-[#03100a]' : 'border border-white/[0.1] text-[#C9D1D9] hover:bg-white/[0.04]'}`}
                        >
                          {NEXT_ACTION_LABEL[a] ?? a}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
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
    </div>
  );
}
