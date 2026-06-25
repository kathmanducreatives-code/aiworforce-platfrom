import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkforceState } from '@/hooks/useWorkforceState';
import CompanyBrainStrip from '@/components/workforce/CompanyBrainStrip';
import PilotBriefing from '@/components/workforce/PilotBriefing';
import AgentDock from '@/components/workforce/AgentDock';
import WorkflowTimeline from '@/components/workforce/WorkflowTimeline';
import WorkforceDock from '@/components/workforce/WorkforceDock';
import DepartmentPreview from '@/components/workforce/DepartmentPreview';
import WorkforceHandoffStrip from '@/components/workforce/WorkforceHandoffStrip';
import FirstRunHelper from '@/components/dashboard/FirstRunHelper';
import AskPilotAboutPage from '@/components/help/AskPilotAboutPage';
import type { AgentId } from '@/components/workforce/agents';


const Dashboard = () => {
  const { workspaceId } = useWorkspace();
  const { agents, timeline, totals, brainComplete } = useWorkforceState(workspaceId);
  const [selectedId, setSelectedId] = useState<AgentId>('pilot');
  const location = useLocation();
  const navigate = useNavigate();
  const [showFirstRun, setShowFirstRun] = useState<boolean>(
    Boolean((location.state as { firstRun?: boolean } | null)?.firstRun),
  );

  // Clear the first-run flag so a refresh doesn't keep the banner.
  useEffect(() => {
    if (showFirstRun && location.state) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [showFirstRun, location, navigate]);

  return (
    <div className="min-h-screen bg-transparent">
      {/* Ambient backdrop — quiet, atmospheric only */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-48 left-1/2 -translate-x-1/2 h-[420px] w-[720px] rounded-full bg-emerald-500/[0.06] blur-[160px]" />
      </div>

      <div className="mx-auto w-full max-w-[1440px] px-5 lg:px-8 py-6 pb-32">
        <div className="flex items-center justify-end mb-3">
          <AskPilotAboutPage />
        </div>

        {showFirstRun && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
            <div className="h-9 w-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4 text-emerald-300" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground">Welcome to your AI workforce.</div>
              <div className="text-[13px] text-neutral-300 mt-0.5">
                Your Company Brain is ready. Pilot will walk you through how Agentory works — skip anytime.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowFirstRun(false)}
              aria-label="Dismiss"
              className="text-neutral-400 hover:text-foreground shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <FirstRunHelper />

        <CompanyBrainStrip visible={!brainComplete} />

        <div data-tour="dashboard-main" className="grid grid-cols-12 gap-5">
          <div className="col-span-12">
            <PilotBriefing totals={totals} />
          </div>


          <section className="col-span-12 space-y-3">
            <div className="flex items-end justify-between px-0.5">
              <span className="eyebrow">Workforce</span>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-emerald-400/70 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
                Live
              </span>
            </div>
            <WorkforceDock
              agents={agents}
              totals={totals}
              brainComplete={brainComplete}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </section>

          <div className="col-span-12">
            <DepartmentPreview
              agentId={selectedId}
              totals={totals}
              brainComplete={brainComplete}
            />
          </div>

          <div className="col-span-12">
            <WorkforceHandoffStrip activeId={selectedId} />
          </div>

          <div className="col-span-12">
            <WorkflowTimeline items={timeline} />
          </div>
        </div>
      </div>

      <AgentDock agents={agents} />
    </div>
  );
};

export default Dashboard;
