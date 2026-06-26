import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Lock, Play, Table, UserPlus, HelpCircle, FileDown, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToolAvailability } from '@/lib/workflows/useToolAvailability';
import { listRecentRuns } from '@/lib/workflows/recentRuns';
import { useSignalFeed } from '@/hooks/useSignalFeed';

interface TaskItem {
  id: number;
  label: string;
  description: string;
  checked: boolean;
  blocked: boolean;
  blockedReason?: string;
  icon: any;
  actionText?: string;
  actionRoute?: string;
}

export default function DashboardChecklist() {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const { drafts } = useSignalFeed(workspaceId);
  const tools = useToolAvailability();

  const [dbState, setDbState] = useState({
    plansCount: 0,
    leadsCount: 0,
    contactsCount: 0,
    enrichedCount: 0,
    draftedCount: 0,
    loading: true,
  });

  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;

    let active = true;

    async function fetchStatus() {
      try {
        const { data: plans } = await supabase
          .from('task_plans' as any)
          .select('id')
          .eq('workspace_id', workspaceId);

        if (!active || !plans || plans.length === 0) {
          setDbState({
            plansCount: 0,
            leadsCount: 0,
            contactsCount: 0,
            enrichedCount: 0,
            draftedCount: 0,
            loading: false,
          });
          return;
        }

        const planIds = plans.map((p) => p.id);

        const { data: leads } = await supabase
          .from('lead_candidates' as any)
          .select('id, contact_id, status')
          .in('plan_id', planIds);

        const leadsList = (leads || []) as any[];
        const leadIds = leadsList.map((l) => l.id);

        let enrichedCount = 0;
        if (leadIds.length > 0) {
          const { data: enrichments } = await supabase
            .from('lead_enrichments' as any)
            .select('id')
            .eq('status', 'enriched')
            .in('lead_candidate_id', leadIds);
          enrichedCount = enrichments?.length || 0;
        }

        const contactsCount = leadsList.filter((l) => l.contact_id !== null).length;
        const draftedCount = leadsList.filter((l) => l.status === 'drafted' || l.status === 'approved').length;

        if (active) {
          setDbState({
            plansCount: plans.length,
            leadsCount: leadsList.length,
            contactsCount,
            enrichedCount,
            draftedCount,
            loading: false,
          });
        }
      } catch (err) {
        console.error('Error fetching checklist state:', err);
        if (active) {
          setDbState((s) => ({ ...s, loading: false }));
        }
      }
    }

    fetchStatus();
    
    // Listen for workflow runs recorded locally
    const handleRunRecorded = () => setTick((t) => t + 1);
    window.addEventListener('workflow:run-recorded', handleRunRecorded);

    return () => {
      active = false;
      window.removeEventListener('workflow:run-recorded', handleRunRecorded);
    };
  }, [workspaceId, tick]);

  const recentRuns = useMemo(() => listRecentRuns(), [tick]);

  const tasks = useMemo<TaskItem[]>(() => {
    const isApifyPeopleReady = tools.apify_people?.configured && tools.apify_people?.enabled;
    const isFirecrawlReady = tools.firecrawl?.configured && tools.firecrawl?.enabled;

    // Task 1: Run first workflow
    const t1Checked = recentRuns.length > 0 || dbState.plansCount > 0;
    
    // Task 2: Review results in Workbench
    const t2Checked = dbState.leadsCount > 0;

    // Task 3: Find decision-makers
    const t3Checked = dbState.contactsCount > 0;
    const t3Blocked = !t1Checked || !t2Checked;

    // Task 4: Enrich companies
    const t4Checked = dbState.enrichedCount > 0;
    const t4Blocked = !t3Checked;

    // Task 5: Draft outreach or export
    const t5Checked = draftedCountCheck() || dbState.draftedCount > 0;
    const t5Blocked = !t3Checked; // Needs contacts to draft

    function draftedCountCheck() {
      return drafts.length > 0;
    }

    return [
      {
        id: 1,
        label: 'Run your first AI workflow',
        description: 'Sourced accounts matching your ICP preferences from Company Brain.',
        checked: t1Checked,
        blocked: false,
        icon: Play,
        actionText: 'Open Workflows',
        actionRoute: '/workflows',
      },
      {
        id: 2,
        label: 'Review results in Workbench',
        description: 'Open the Workbench panel to view qualified accounts and fit reasons.',
        checked: t2Checked,
        blocked: !t1Checked,
        icon: Table,
        actionText: 'Open Workbench',
        actionRoute: '/leads',
      },
      {
        id: 3,
        label: 'Find decision-makers',
        description: 'Find contact details for Founders, CEOs, or GTM leaders.',
        checked: t3Checked,
        blocked: t3Blocked || !isApifyPeopleReady,
        blockedReason: !isApifyPeopleReady ? 'Setup needed: Apify' : undefined,
        icon: UserPlus,
        actionText: 'Workbench',
        actionRoute: '/leads',
      },
      {
        id: 4,
        label: 'Enrich companies',
        description: 'Hawk audits websites to gather customization angles.',
        checked: t4Checked,
        blocked: t4Blocked || !isFirecrawlReady,
        blockedReason: !isFirecrawlReady ? 'Setup needed: Firecrawl' : undefined,
        icon: HelpCircle,
        actionText: 'Workbench',
        actionRoute: '/leads',
      },
      {
        id: 5,
        label: 'Draft or export outreach',
        description: 'Penn prepares drafts or exports results as CSV.',
        checked: t5Checked,
        blocked: t5Blocked,
        icon: FileDown,
        actionText: 'Workbench',
        actionRoute: '/leads',
      },
    ];
  }, [recentRuns, dbState, drafts, tools]);

  // Hide checklist if all completed
  const allCompleted = tasks.every((t) => t.checked);
  if (allCompleted || dbState.loading || !workspaceId) return null;

  return (
    <div className="mb-6 rounded-xl border border-white/[0.06] bg-neutral-950/20 p-5 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-white/[0.04] pb-3 mb-4">
        <div>
          <h4 className="text-[14.5px] font-bold text-white tracking-tight">Your first Agentory loop</h4>
          <p className="text-[12px] text-neutral-400 mt-0.5">Complete these steps to experience the full AI outreach cycle.</p>
        </div>
        <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/[0.06] border border-emerald-500/20 px-2 py-0.5 rounded">
          {tasks.filter((t) => t.checked).length} / 5 complete
        </span>
      </div>

      <div className="space-y-3.5">
        {tasks.map((task) => {
          const Icon = task.icon;
          return (
            <div
              key={task.id}
              className={`flex items-start justify-between gap-4 p-2 rounded-lg border transition-all ${
                task.checked
                  ? 'border-emerald-500/10 bg-emerald-500/[0.01] opacity-75'
                  : task.blocked
                  ? 'border-white/[0.03] bg-transparent opacity-50'
                  : 'border-white/[0.05] bg-white/[0.01] hover:bg-white/[0.02]'
              }`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <button
                  type="button"
                  disabled={task.blocked || task.checked}
                  className="mt-0.5 shrink-0 transition-colors"
                >
                  {task.checked ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-400 fill-emerald-950/20" />
                  ) : task.blocked && task.blockedReason ? (
                    <Lock className="h-4 w-4 text-neutral-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-neutral-600 hover:text-emerald-500" />
                  )}
                </button>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[13px] font-semibold ${task.checked ? 'text-neutral-400 line-through' : 'text-neutral-200'}`}>
                      {task.label}
                    </span>
                    {task.blocked && task.blockedReason && (
                      <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded shrink-0">
                        {task.blockedReason}
                      </span>
                    )}
                  </div>
                  <p className="text-[11.5px] text-neutral-400 leading-normal mt-0.5">
                    {task.description}
                  </p>
                </div>
              </div>

              {!task.checked && !task.blocked && task.actionRoute && (
                <button
                  type="button"
                  onClick={() => navigate(task.actionRoute!)}
                  className="h-7 px-2.5 rounded border border-white/10 hover:border-emerald-500/30 bg-white/[0.02] hover:bg-emerald-500/10 text-[11px] font-semibold text-neutral-200 hover:text-emerald-300 flex items-center gap-1 transition-colors shrink-0"
                >
                  {task.actionText} <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
