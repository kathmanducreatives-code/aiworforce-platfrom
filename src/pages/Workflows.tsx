import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Workflow as WorkflowIcon, Sparkles, History, ExternalLink, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  WORKFLOWS,
  CATEGORY_ORDER,
  resolveStatus,
  type WorkflowDefinition,
  type WorkflowCategory,
} from '@/lib/workflows/registry';
import { useToolAvailability } from '@/lib/workflows/useToolAvailability';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { recommendWorkflows } from '@/lib/workflows/recommend';
import { pilotChat } from '@/lib/pilotChat';
import { listRecentRuns, recordRun, summarizeInputs, type RecentRun } from '@/lib/workflows/recentRuns';
import { AGENT_BY_ID } from '@/data/agentProfiles';
import WorkflowCard from '@/components/workflows/WorkflowCard';
import FeaturedWorkflowCard from '@/components/workflows/FeaturedWorkflowCard';
import WorkflowConfigPanel from '@/components/workflows/WorkflowConfigPanel';
import StatStrip from '@/components/workflows/StatStrip';
import CategoryRail from '@/components/workflows/CategoryRail';
import FilterChips, { type WorkflowChip } from '@/components/workflows/FilterChips';
import InfoHint from '@/components/help/InfoHint';
import AskPilotAboutPage from '@/components/help/AskPilotAboutPage';

const AGENT_FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'All agents' },
  { id: 'pilot', label: 'Pilot' },
  { id: 'scout', label: 'Scout' },
  { id: 'aria', label: 'Aria' },
  { id: 'hawk', label: 'Hawk' },
  { id: 'penn', label: 'Penn' },
  { id: 'scribe', label: 'Scribe' },
];

type SortKey = 'recommended' | 'most_used' | 'newest' | 'ready_first';

const SORT_LABEL: Record<SortKey, string> = {
  recommended: 'Recommended',
  most_used: 'Most used',
  newest: 'Newest',
  ready_first: 'Ready first',
};

export default function Workflows() {
  const tools = useToolAvailability();
  const { workspaceId } = useWorkspace();
  const { data: brain } = useCompanyBrain();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<WorkflowCategory | 'all'>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [chip, setChip] = useState<WorkflowChip>('all');
  const [sortKey, setSortKey] = useState<SortKey>('recommended');
  const [selected, setSelected] = useState<WorkflowDefinition | null>(null);
  const [recent, setRecent] = useState<RecentRun[]>(() => listRecentRuns());

  useEffect(() => {
    const onChange = () => setRecent(listRecentRuns());
    window.addEventListener('workflow:run-recorded', onChange);
    return () => window.removeEventListener('workflow:run-recorded', onChange);
  }, []);

  const statusByWorkflow = useMemo(() => {
    const map: Record<string, ReturnType<typeof resolveStatus>> = {};
    for (const w of WORKFLOWS) map[w.id] = resolveStatus(w, tools);
    return map;
  }, [tools]);

  const lastRunByWorkflow = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of recent) {
      if (map[r.workflowId] === undefined || r.createdAt > map[r.workflowId]) {
        map[r.workflowId] = r.createdAt;
      }
    }
    return map;
  }, [recent]);

  const runCountByWorkflow = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of recent) m[r.workflowId] = (m[r.workflowId] || 0) + 1;
    return m;
  }, [recent]);

  const countByCategory = useMemo(() => {
    const m = { growth: 0, research: 0, outreach: 0, content: 0, competitor: 0, operations: 0 } as Record<WorkflowCategory, number>;
    for (const w of WORKFLOWS) m[w.category]++;
    return m;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const recentIds = new Set(recent.map((r) => r.workflowId));
    const list = WORKFLOWS.filter((w) => {
      if (cat !== 'all' && w.category !== cat) return false;
      if (agentFilter !== 'all' && !w.agents.includes(agentFilter as never)) return false;
      if (q && !`${w.title} ${w.description}`.toLowerCase().includes(q)) return false;
      const s = statusByWorkflow[w.id];
      if (chip === 'recommended' && !w.recommended) return false;
      if (chip === 'ready' && s !== 'ready') return false;
      if (chip === 'setup' && s !== 'setup_needed') return false;
      if (chip === 'coming_soon' && s !== 'coming_soon') return false;
      if (chip === 'recent' && !recentIds.has(w.id)) return false;
      return true;
    });
    const statusOrder = { ready: 0, setup_needed: 1, coming_soon: 2 } as const;
    return list.sort((a, b) => {
      if (sortKey === 'ready_first') return statusOrder[statusByWorkflow[a.id]] - statusOrder[statusByWorkflow[b.id]];
      if (sortKey === 'most_used') return (runCountByWorkflow[b.id] || 0) - (runCountByWorkflow[a.id] || 0);
      if (sortKey === 'newest') return 0; // preserve registry order
      // recommended default
      const ra = a.recommended ? 0 : 1;
      const rb = b.recommended ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return statusOrder[statusByWorkflow[a.id]] - statusOrder[statusByWorkflow[b.id]];
    });
  }, [query, cat, agentFilter, chip, sortKey, statusByWorkflow, runCountByWorkflow, recent]);

  const grouped = useMemo(() => {
    const map = new Map<WorkflowCategory, WorkflowDefinition[]>();
    for (const w of filtered) {
      const arr = map.get(w.category) || [];
      arr.push(w);
      map.set(w.category, arr);
    }
    return map;
  }, [filtered]);

  const recommended = useMemo(() => {
    const fromBrain = recommendWorkflows(brain?.profile, WORKFLOWS, 6)
      .map((r) => ({ workflow: r.workflow, reason: r.reasons[0] }));
    if (fromBrain.length > 0) return fromBrain;
    return WORKFLOWS
      .filter((w) => w.recommended && statusByWorkflow[w.id] !== 'coming_soon')
      .slice(0, 6)
      .map((w) => ({ workflow: w, reason: undefined as string | undefined }));
  }, [brain?.profile, statusByWorkflow]);

  const featured = recommended.slice(0, 3);

  // Counts
  const readyCount = useMemo(() => WORKFLOWS.filter((w) => statusByWorkflow[w.id] === 'ready').length, [statusByWorkflow]);
  const setupCount = useMemo(() => WORKFLOWS.filter((w) => statusByWorkflow[w.id] === 'setup_needed').length, [statusByWorkflow]);
  const chipCounts: Partial<Record<WorkflowChip, number>> = {
    all: WORKFLOWS.length,
    recommended: WORKFLOWS.filter((w) => w.recommended).length,
    ready: readyCount,
    setup: setupCount,
    coming_soon: WORKFLOWS.filter((w) => statusByWorkflow[w.id] === 'coming_soon').length,
    recent: new Set(recent.map((r) => r.workflowId)).size,
  };

  const showFeatured = cat === 'all' && !query && chip === 'all' && agentFilter === 'all' && featured.length > 0;
  const showRecommendedRow = cat === 'all' && !query && chip === 'all' && agentFilter === 'all' && recommended.length > featured.length;

  const handleRun = async (workflow: WorkflowDefinition, values: Record<string, string | number | string[]>) => {
    if (!workspaceId) {
      toast.error('No workspace selected');
      return;
    }
    const prompt = workflow.buildPrompt(values);
    const metadata = workflow.buildMetadata?.(values) ?? { workflow_id: workflow.id, workflow_inputs: values };
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    recordRun({
      id: runId,
      workflowId: workflow.id,
      workflowTitle: workflow.title,
      category: workflow.category,
      agents: workflow.agents,
      inputSummary: summarizeInputs(values) || '—',
      status: 'running',
      createdAt: Date.now(),
    });

    try {
      const result = await pilotChat({
        message: prompt,
        workspace_id: workspaceId,
        action_source: 'workflow_center',
        metadata: { ...metadata, workflow_run_id: runId, workflow_title: workflow.title, agents_used: workflow.agents },
      });
      setSelected(null);
      toast.success(`${workflow.title} dispatched`, { description: `${AGENT_BY_ID[workflow.primaryAgent]?.name || 'Pilot'} is on it.` });
      navigate('/dashboard', { state: { conversationId: result.conversation_id } });
    } catch (e) {
      toast.error('Could not start workflow', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const clearFilters = () => {
    setQuery('');
    setCat('all');
    setAgentFilter('all');
    setChip('all');
  };

  return (
    <div className="min-h-screen w-full pb-16">
      {/* Background grid + glow */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.07),transparent_60%)]" />
      <div className="pointer-events-none fixed inset-0 z-0 opacity-[0.025] [background-image:linear-gradient(rgba(255,255,255,1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,1)_1px,transparent_1px)] [background-size:40px_40px]" />

      <div className="relative z-10 max-w-[1440px] mx-auto px-6 lg:px-10 pt-10 lg:pt-12 animate-fade-in">
        {/* Hero */}
        <header className="flex flex-col gap-5 mb-8">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 self-start text-[11.5px] font-mono font-semibold uppercase tracking-[0.16em] text-emerald-300 border border-emerald-500/25 bg-emerald-500/[0.06] rounded-full px-3 py-1.5">
              <WorkflowIcon className="w-3.5 h-3.5" /> Workflow Center
            </div>
            <AskPilotAboutPage />
          </div>
          <div className="flex flex-col gap-3 max-w-3xl">
            <h1 className="text-[34px] lg:text-[40px] font-semibold text-foreground tracking-tight flex items-center gap-2 leading-[1.05]">
              Workflows <InfoHint topic="workflows" size="sm" />
            </h1>
            <p className="text-[15.5px] text-neutral-300 leading-relaxed">
              Run repeatable AI employee playbooks without writing a prompt. Pick a workflow, fill the inputs, and Agentory opens the output in Workbench.
            </p>
            <p className="text-[12.5px] text-neutral-400">
              Pick a workflow when you want a repeatable process. Use Conversations when you want custom work.
            </p>
          </div>
          <StatStrip
            recommended={chipCounts.recommended || 0}
            ready={readyCount}
            setupNeeded={setupCount}
            runs={recent.length}
          />
        </header>

        {/* Controls */}
        <div className="flex flex-col gap-3 mb-6">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search workflows…"
                className="w-full h-12 pl-11 pr-4 rounded-xl bg-white/[0.03] border border-white/[0.08] text-[15px] text-foreground placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500/35 focus:bg-white/[0.04] transition-colors"
              />
            </div>
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="h-12 px-4 rounded-xl bg-white/[0.03] border border-white/[0.08] text-[14px] text-foreground focus:outline-none focus:border-emerald-500/35"
            >
              {AGENT_FILTERS.map((a) => (
                <option key={a.id} value={a.id} className="bg-[#0a0a0a]">{a.label}</option>
              ))}
            </select>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="h-12 px-4 rounded-xl bg-white/[0.03] border border-white/[0.08] text-[14px] text-foreground focus:outline-none focus:border-emerald-500/35"
            >
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k} className="bg-[#0a0a0a]">Sort · {SORT_LABEL[k]}</option>
              ))}
            </select>
          </div>
          <FilterChips active={chip} onChange={setChip} counts={chipCounts} />
        </div>

        <div className="grid grid-cols-12 gap-7">
          {/* Sidebar */}
          <aside className="col-span-12 lg:col-span-3 space-y-7">
            <div>
              <p className="text-[10.5px] font-mono uppercase tracking-[0.16em] text-neutral-500 mb-3 px-1">Departments</p>
              <CategoryRail
                active={cat}
                onChange={setCat}
                countAll={WORKFLOWS.length}
                countByCategory={countByCategory}
              />
            </div>

            <div>
              <p className="text-[10.5px] font-mono uppercase tracking-[0.16em] text-neutral-500 mb-3 px-1 flex items-center gap-2">
                <History className="w-3 h-3" /> Recent runs
              </p>
              {recent.length === 0 ? (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <Sparkles className="w-4 h-4 text-emerald-300/80 mb-2" />
                  <p className="text-[13px] text-neutral-400 leading-relaxed">
                    No runs yet. Pick a workflow to start your first AI employee playbook.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {recent.slice(0, 5).map((r) => (
                    <div
                      key={r.id}
                      className="group flex items-center justify-between gap-2 p-2.5 rounded-lg hover:bg-white/[0.035] cursor-pointer transition-colors"
                      onClick={() => navigate('/dashboard', { state: { conversationId: r.conversationId } })}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] text-foreground truncate">{r.workflowTitle}</p>
                        <p className="text-[11.5px] text-neutral-500 truncate mt-0.5">{r.inputSummary}</p>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-neutral-600 group-hover:text-emerald-400 shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* Main grid */}
          <main className="col-span-12 lg:col-span-9 space-y-12">
            {/* Featured "Start here" */}
            {showFeatured && (
              <section data-tour="workflows-featured" className="animate-fade-in">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-[20px] font-semibold text-foreground tracking-tight">Start here</h2>
                  <span className="text-[12px] font-mono text-neutral-500 ml-1">Picked from your Company Brain</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {featured.map(({ workflow: w, reason }) => (
                    <FeaturedWorkflowCard
                      key={`f-${w.id}`}
                      workflow={w}
                      status={statusByWorkflow[w.id]}
                      reason={reason}
                      onSelect={() => setSelected(w)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Recommended row */}
            {showRecommendedRow && (
              <section className="animate-fade-in">
                <div className="flex items-baseline gap-2 mb-4">
                  <h2 className="text-[20px] font-semibold text-foreground tracking-tight">Recommended for your company</h2>
                  <span className="text-[12.5px] text-neutral-500">Based on your onboarding and readiness</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {recommended.slice(featured.length).map(({ workflow: w, reason }) => (
                    <div key={`r-${w.id}`} className="flex flex-col gap-1.5">
                      <WorkflowCard
                        workflow={w}
                        status={statusByWorkflow[w.id]}
                        lastRunAt={lastRunByWorkflow[w.id]}
                        onSelect={() => setSelected(w)}
                      />
                      {reason && (
                        <p className="text-[11.5px] text-emerald-300/80 px-1">{reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Grouped by category */}
            {(cat === 'all' ? CATEGORY_ORDER : [cat as WorkflowCategory]).map((c) => {
              const items = grouped.get(c);
              if (!items || items.length === 0) return null;
              return (
                <section key={c} className="animate-fade-in">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-[20px] font-semibold text-foreground tracking-tight flex items-center gap-2.5">
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                      <span className="text-[12px] font-mono text-neutral-500">{items.length}</span>
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {items.map((w) => (
                      <WorkflowCard
                        key={w.id}
                        workflow={w}
                        status={statusByWorkflow[w.id]}
                        lastRunAt={lastRunByWorkflow[w.id]}
                        onSelect={() => setSelected(w)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

            {filtered.length === 0 && (
              <div className="text-center py-16 px-6 rounded-2xl border border-dashed border-white/[0.10] bg-white/[0.02] backdrop-blur-xl">
                <Search className="w-6 h-6 text-neutral-500 mx-auto mb-3" />
                <p className="text-[15px] text-foreground font-medium">No workflows match your filters</p>
                <p className="text-[13.5px] text-neutral-400 mt-1">Try a different search or clear filters to see everything.</p>
                <button
                  onClick={clearFilters}
                  className="mt-4 inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[12.5px] bg-white/[0.04] border border-white/[0.10] text-foreground hover:border-emerald-500/30 hover:text-emerald-300 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Clear filters
                </button>
              </div>
            )}
          </main>
        </div>
      </div>

      <WorkflowConfigPanel
        workflow={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        onRun={handleRun}
      />
    </div>
  );
}
