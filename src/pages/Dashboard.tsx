import { useState } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkforceState } from '@/hooks/useWorkforceState';
import CompanyBrainStrip from '@/components/workforce/CompanyBrainStrip';
import PilotBriefing from '@/components/workforce/PilotBriefing';
import AgentDock from '@/components/workforce/AgentDock';
import WorkflowTimeline from '@/components/workforce/WorkflowTimeline';
import InlineCommandBar from '@/components/workforce/InlineCommandBar';
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
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-40">
        <CompanyBrainStrip visible={!brainComplete} />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Left + center */}
          <div className="lg:col-span-3 space-y-5">
            <PilotBriefing totals={totals} />

            <section className="space-y-4">
              <div className="flex items-end justify-between px-1">
                <div>
                  <h2 className="text-[15px] font-semibold text-white">AI Workforce Dock</h2>
                  <p className="text-[12px] text-neutral-500 mt-0.5">
                    Choose an AI employee to view their department.
                  </p>
                </div>
                <span className="text-[11px] text-neutral-500 font-mono uppercase tracking-wider">Live</span>
              </div>

              <WorkforceDock
                agents={agents}
                totals={totals}
                brainComplete={brainComplete}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />

              <DepartmentPreview
                agentId={selectedId}
                totals={totals}
                brainComplete={brainComplete}
              />

              <WorkforceHandoffStrip activeId={selectedId} />
            </section>

            <WorkflowTimeline items={timeline} />
          </div>

          {/* Right rail */}
          <div className="lg:col-span-2 space-y-4">
            <DecisionQueue items={decisions} />
            <InlineCommandBar />
          </div>
        </div>
      </div>

      <AgentDock agents={agents} />
    </div>
  );
};

export default Dashboard;
