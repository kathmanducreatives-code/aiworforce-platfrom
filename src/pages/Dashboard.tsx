import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkforceState } from '@/hooks/useWorkforceState';
import CompanyBrainStrip from '@/components/workforce/CompanyBrainStrip';
import PilotBriefing from '@/components/workforce/PilotBriefing';
import AgentWorkCard from '@/components/workforce/AgentWorkCard';
import AgentDock from '@/components/workforce/AgentDock';
import DecisionQueue from '@/components/workforce/DecisionQueue';
import WorkflowTimeline from '@/components/workforce/WorkflowTimeline';
import InlineCommandBar from '@/components/workforce/InlineCommandBar';
import AgentProfileDrawer from '@/components/workforce/AgentProfileDrawer';
import { AGENT_ORDER, type AgentId } from '@/components/workforce/agents';
import { useState } from 'react';

const Dashboard = () => {
  const { workspaceId } = useWorkspace();
  const { agents, timeline, decisions, totals, brainComplete } = useWorkforceState(workspaceId);
  const [openId, setOpenId] = useState<AgentId | null>(null);

  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-40">
        <CompanyBrainStrip visible={!brainComplete} />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Left + center */}
          <div className="lg:col-span-3 space-y-4">
            <PilotBriefing totals={totals} />

            <div>
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="text-[13px] font-semibold text-white">Agent work canvas</h3>
                <span className="text-[11px] text-neutral-500 font-mono uppercase tracking-wider">Live</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {AGENT_ORDER.map((id) => (
                  <AgentWorkCard key={id} state={agents[id]} onOpen={() => setOpenId(id)} />
                ))}
              </div>
            </div>

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
      <AgentProfileDrawer open={openId !== null} onClose={() => setOpenId(null)} state={openId ? agents[openId] : null} />
    </div>
  );
};

export default Dashboard;
