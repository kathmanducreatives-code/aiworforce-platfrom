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
      {/* Ambient premium backdrop */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[600px] w-[900px] rounded-full bg-emerald-500/10 blur-[140px]" />
        <div className="absolute top-1/3 left-1/4 h-[400px] w-[400px] rounded-full bg-emerald-400/5 blur-[120px]" />
      </div>

      <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 lg:px-8 py-10 pb-40 flex flex-col items-center">
        <div className="w-full max-w-[920px]">
          <CompanyBrainStrip visible={!brainComplete} />
        </div>

        <div className="mt-6 w-full max-w-[920px] flex flex-col items-stretch space-y-8">
          <PilotBriefing totals={totals} />

          <section className="space-y-5">
            <div className="flex items-end justify-between px-1">
              <div className="text-center sm:text-left mx-auto sm:mx-0">
                <h2 className="text-[15px] font-semibold text-white tracking-tight">AI Workforce Dock</h2>
                <p className="text-[12px] text-neutral-500 mt-0.5">
                  Choose an AI employee to view their department.
                </p>
              </div>
              <span className="hidden sm:inline text-[11px] text-emerald-400/70 font-mono uppercase tracking-[0.2em]">● Live</span>
            </div>

            <div className="relative rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl p-5 shadow-[0_8px_40px_-12px_rgba(16,185,129,0.15)]">
              <WorkforceDock
                agents={agents}
                totals={totals}
                brainComplete={brainComplete}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </div>

            <DepartmentPreview
              agentId={selectedId}
              totals={totals}
              brainComplete={brainComplete}
            />

            <div className="flex justify-center">
              <WorkforceHandoffStrip activeId={selectedId} />
            </div>
          </section>

          <WorkflowTimeline items={timeline} />
        </div>
      </div>

      <AgentDock agents={agents} />
    </div>
  );
};

export default Dashboard;
