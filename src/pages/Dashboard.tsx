import { useState } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkforceState } from '@/hooks/useWorkforceState';
import CompanyBrainStrip from '@/components/workforce/CompanyBrainStrip';
import PilotBriefing from '@/components/workforce/PilotBriefing';
import AgentDock from '@/components/workforce/AgentDock';
import WorkflowTimeline from '@/components/workforce/WorkflowTimeline';
import WorkforceDock from '@/components/workforce/WorkforceDock';
import DepartmentPreview from '@/components/workforce/DepartmentPreview';
import WorkforceHandoffStrip from '@/components/workforce/WorkforceHandoffStrip';
import type { AgentId } from '@/components/workforce/agents';

const Dashboard = () => {
  const { workspaceId } = useWorkspace();
  const { agents, timeline, totals, brainComplete } = useWorkforceState(workspaceId);
  const [selectedId, setSelectedId] = useState<AgentId>('pilot');

  return (
    <div className="min-h-screen bg-transparent">
      {/* Ambient backdrop — quiet, atmospheric only */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-48 left-1/2 -translate-x-1/2 h-[420px] w-[720px] rounded-full bg-emerald-500/[0.06] blur-[160px]" />
      </div>

      <div className="mx-auto w-full max-w-[1440px] px-5 lg:px-8 py-6 pb-32">
        <CompanyBrainStrip visible={!brainComplete} />

        <div className="grid grid-cols-12 gap-5">
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
