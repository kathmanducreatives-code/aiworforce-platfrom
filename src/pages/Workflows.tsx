import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Workflow as WorkflowIcon, Sparkles, History, ChevronRight, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  WORKFLOWS,
  CATEGORY_ORDER,
  CATEGORY_LABEL,
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
import WorkflowConfigPanel from '@/components/workflows/WorkflowConfigPanel';
import AgentAvatar from '@/components/workflows/AgentAvatar';
import InfoHint from '@/components/help/InfoHint';
import AskPilotAboutPage from '@/components/help/AskPilotAboutPage';
import { cn } from '@/lib/utils';

const AGENT_FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'All agents' },
  { id: 'pilot', label: 'Pilot' },
  { id: 'scout', label: 'Scout' },
  { id: 'aria', label: 'Aria' },
  { id: 'hawk', label: 'Hawk' },
  { id: 'penn', label: 'Penn' },
  { id: 'scribe', label: 'Scribe' },
];

export default function Workflows() {
  const tools = useToolAvailability();
  const { workspaceId } = useWorkspace();
  const { data: brain } = useCompanyBrain();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<WorkflowCategory | 'all'>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [selected, setSelected] = useState<WorkflowDefinition | null>(null);
  const [recent, setRecent] = useState<RecentRun[]>(() => listRecentRuns());

  useEffect(() => {
    const onChange = () => setRecent(listRecentRuns());
    window.addEventListener('workflow:run-recorded', onChange);
    return () => window.removeEventListener('workflow:run-recorded', onChange);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return WORKFLOWS.filter((w) => {
      if (cat !== 'all' && w.category !== cat) return false;
      if (agentFilter !== 'all' && !w.agents.includes(agentFilter as never)) return false;
      if (q && !`${w.title} ${w.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [query, cat, agentFilter]);

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
    const fromBrain = recommendWorkflows(brain?.profile, WORKFLOWS, 4)
      .map((r) => ({ workflow: r.workflow, reason: r.reasons[0] }));
    if (fromBrain.length > 0) return fromBrain;
    return WORKFLOWS
      .filter((w) => w.recommended && resolveStatus(w, tools) !== 'coming_soon')
      .slice(0, 4)
      .map((w) => ({ workflow: w, reason: undefined as string | undefined }));
  }, [brain?.profile, tools]);

  const lastRunByWorkflow = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of recent) {
      if (map[r.workflowId] === undefined || r.createdAt > map[r.workflowId]) {
        map[r.workflowId] = r.createdAt;
      }
    }
    return map;
  }, [recent]);

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
      // Navigate to chat / workbench surface.
      navigate('/dashboard', { state: { conversationId: result.conversation_id } });
    } catch (e) {
      toast.error('Could not start workflow', { description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="min-h-screen w-full pb-16">
      {/* Background grid */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.05),transparent_60%)]" />
      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-10 pt-12">
        {/* Header */}
        <header className="flex flex-col gap-3 mb-10">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 self-start text-[11.5px] font-mono font-semibold uppercase tracking-[0.16em] text-emerald-300 border border-emerald-500/25 bg-emerald-500/[0.06] rounded-full px-3 py-1.5">
              <WorkflowIcon className="w-3.5 h-3.5" /> Workflow Center
            </div>
            <AskPilotAboutPage />
          </div>
          <h1 className="text-page font-semibold text-foreground tracking-tight flex items-center gap-2">
            Workflows <InfoHint topic="workflows" size="sm" />
          </h1>
          <p className="text-[15.5px] text-neutral-300 max-w-2xl leading-relaxed">
            Pick a playbook. Agentory will route it to the right AI employees. Cards marked <span className="text-amber-300 font-medium">Setup needed</span> <InfoHint topic="setup_needed" /> require a provider or integration first.
          </p>
        </header>

        {/* Controls */}
        <div className="flex flex-col lg:flex-row gap-3 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workflows…"
              className="w-full h-11 pl-10 pr-3 rounded-md bg-white/[0.03] border border-white/[0.08] text-[15.5px] text-foreground placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500/35"
            />
          </div>
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="h-11 px-4 rounded-md bg-white/[0.03] border border-white/[0.08] text-[14.5px] text-foreground focus:outline-none focus:border-emerald-500/35"
          >
            {AGENT_FILTERS.map((a) => (
              <option key={a.id} value={a.id} className="bg-[#0a0a0a]">{a.label}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-12 gap-7">
          {/* Sidebar filters */}
          <aside className="col-span-12 lg:col-span-3 space-y-6">
            <div>
              <p className="eyebrow mb-3 px-1">Departments</p>
              <div className="space-y-0.5">
                <CategoryButton active={cat === 'all'} onClick={() => setCat('all')} label="All workflows" count={WORKFLOWS.length} />
                {CATEGORY_ORDER.map((c) => (
                  <CategoryButton
                    key={c}
                    active={cat === c}
                    onClick={() => setCat(c)}
                    label={CATEGORY_LABEL[c]}
                    count={WORKFLOWS.filter((w) => w.category === c).length}
                  />
                ))}
              </div>
            </div>

            {/* Recent runs */}
            <div>
              <p className="eyebrow mb-3 px-1 flex items-center gap-2">
                <History className="w-3.5 h-3.5" /> Recent runs
              </p>
              {recent.length === 0 ? (
                <p className="text-[13px] text-neutral-500 px-1 leading-relaxed">
                  No runs yet. Pick a workflow to start your first AI employee playbook.
                </p>
              ) : (
                <div className="space-y-1">
                  {recent.slice(0, 5).map((r) => (
                    <div key={r.id} className="group flex items-center justify-between gap-2 p-2.5 rounded-md hover:bg-white/[0.03] cursor-pointer"
                      onClick={() => navigate('/dashboard', { state: { conversationId: r.conversationId } })}>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] text-foreground truncate">{r.workflowTitle}</p>
                        <p className="text-[12px] text-neutral-500 truncate mt-0.5">{r.inputSummary}</p>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-neutral-600 group-hover:text-emerald-400 shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* Main grid */}
          <main className="col-span-12 lg:col-span-9 space-y-10">
            {/* Recommended */}
            {recommended.length > 0 && cat === 'all' && !query && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-[18px] font-semibold text-foreground tracking-tight">Recommended for your company</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {recommended.map(({ workflow: w, reason }) => (
                    <div key={`r-${w.id}`} className="flex flex-col gap-1.5">
                      <WorkflowCard
                        workflow={w}
                        status={resolveStatus(w, tools)}
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
                <section key={c}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-[18px] font-semibold text-foreground tracking-tight flex items-center gap-2.5">
                      {CATEGORY_LABEL[c]}
                      <span className="text-[12px] font-mono text-neutral-500">{items.length}</span>
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {items.map((w) => (
                      <WorkflowCard
                        key={w.id}
                        workflow={w}
                        status={resolveStatus(w, tools)}
                        lastRunAt={lastRunByWorkflow[w.id]}
                        onSelect={() => setSelected(w)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

            {filtered.length === 0 && (
              <div className="text-center py-16 text-neutral-400 text-[14.5px] border border-dashed border-white/[0.08] rounded-card">
                No workflows match your filters.
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

function CategoryButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between px-3 h-9 rounded-md text-[14.5px] transition-all border',
        active
          ? 'bg-emerald-500/[0.09] text-foreground font-semibold border-emerald-500/25'
          : 'text-neutral-300 hover:text-foreground hover:bg-white/[0.03] border-transparent',
      )}
    >
      <span className="flex items-center gap-2">
        {active && <ChevronRight className="w-3.5 h-3.5 text-emerald-400" />}
        {label}
      </span>
      <span className="text-[11.5px] font-mono text-neutral-500 tabular-nums">{count}</span>
    </button>
  );
}

// avoid unused-import warning for AgentAvatar (used downstream in cards)
void AgentAvatar;
