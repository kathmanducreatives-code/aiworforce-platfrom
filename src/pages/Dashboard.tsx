import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sparkles, X, ArrowUpRight, ArrowRight } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkforceState } from '@/hooks/useWorkforceState';
import CompanyBrainStrip from '@/components/workforce/CompanyBrainStrip';
import PilotBriefing from '@/components/workforce/PilotBriefing';
import AgentProfileDrawer from '@/components/workforce/AgentProfileDrawer';
import AgentPortrait from '@/components/agents/AgentPortrait';
import WorkforceAgentCard from '@/components/dashboard/WorkforceAgentCard';
import InlineCommandBar from '@/components/workforce/InlineCommandBar';
import { useChatWorkspace } from '@/contexts/ChatWorkspaceContext';
import { prepareChatDraft } from '@/lib/chatDraft';
import { lookupPublicAgent } from '@/config/agentRegistry';
import '@/components/dashboard/workforce-home.css';
import DepartmentPreview from '@/components/workforce/DepartmentPreview';
import WorkforceHandoffStrip from '@/components/workforce/WorkforceHandoffStrip';
import FirstRunHelper from '@/components/dashboard/FirstRunHelper';
import DashboardChecklist from '@/components/dashboard/DashboardChecklist';
import AskPilotAboutPage from '@/components/help/AskPilotAboutPage';
import type { AgentId } from '@/components/workforce/agents';


const Dashboard = () => {
  const { workspaceId } = useWorkspace();
  const { agents, timeline, totals, brainComplete, loading } = useWorkforceState(workspaceId);
  const [selectedId, setSelectedId] = useState<AgentId>('pilot');
  const [profileId, setProfileId] = useState<AgentId | null>(null);
  const chat = useChatWorkspace();
  const talk = (id: AgentId = 'pilot') => { chat.setView({ kind: 'agent', slug: lookupPublicAgent(id)?.id ?? id }); prepareChatDraft(''); chat.open(); };
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
    <div className="workforce-home min-h-screen bg-transparent">
      <div className="mx-auto w-full max-w-[1500px] px-5 lg:px-8 pt-5 pb-16">
        <header className="team-header">
          <div><span className="team-eyebrow">Agentory · Your AI workforce</span><h1>A small team. A bigger edge.</h1><p>Give your team a goal. Make your next move count.</p></div>
          <button className="team-pilot" onClick={() => talk()}><AgentPortrait agentId="pilot" size={32} decorative /><span>Plan with Pilot</span><ArrowUpRight size={14} /></button>
        </header>
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
        <DashboardChecklist />

        <CompanyBrainStrip visible={!brainComplete} />

        <div data-tour="dashboard-main">
          <section className="team-gallery" aria-label="Your AI workforce">
            {(['scout', 'aria', 'penn', 'scribe'] as AgentId[]).map(id => <WorkforceAgentCard key={id} agent={agents[id]} loading={loading} onProfile={() => { setSelectedId(id); setProfileId(id); }} onChat={() => talk(id)} onAction={() => { const action = agents[id].nextAction; if (action.route) navigate(action.route); else talk(id); }} />)}
          </section>
          <InlineCommandBar />
          <div className="team-lower">
            <section className="team-panel" aria-label="Recent activity">
              <div className="team-panel-header"><h2>Recent activity</h2><button onClick={() => navigate('/workflows')}>Workflows <ArrowUpRight size={12} className="inline" /></button></div>
              {loading ? <p className="team-review-copy">Loading your workspace…</p> : timeline.length ? timeline.slice(0, 3).map(item => <div className="team-activity" key={item.id}><AgentPortrait agentId={item.agentId} size={30} decorative /><div className="min-w-0"><p title={item.text}>{item.text}</p><time>{item.time}</time></div></div>) : <p className="team-review-copy">Your team's work will appear here. Start with a goal above.</p>}
            </section>
            <section className="team-panel" aria-label="Your review queue">
              <div className="team-panel-header"><h2>Your review queue</h2><span className="team-eyebrow">Human approved</span></div>
              <div className="team-review-count">{loading ? '—' : totals.approvals.toString().padStart(2, '0')}</div>
              <p className="team-review-copy">{totals.approvals ? 'Decisions waiting for your attention. Review the work and choose what happens next.' : 'Nothing waiting for approval. Your next decisions will appear here.'}</p>
              <button className="ag-btn ag-btn-secondary rounded-lg px-4 py-2 text-xs flex items-center gap-5" onClick={() => navigate('/awaiting-you')}>Open approvals <ArrowRight size={14} /></button>
            </section>
            {/* Pilot's briefing sits in the row instead of below it, so the whole
                command center reads in one screen. */}
            <PilotBriefing totals={totals} compact />
          </div>
          <details className="team-details">
            <summary>Explore department details & team handoffs</summary>
            <div className="flex flex-wrap gap-2 mb-4">{(['pilot', 'scout', 'aria', 'penn', 'scribe'] as AgentId[]).map(id => <button key={id} aria-pressed={selectedId === id} onClick={() => setSelectedId(id)} className={selectedId === id ? 'ag-btn ag-btn-primary px-4 py-2 rounded-lg text-xs' : 'ag-btn ag-btn-secondary px-4 py-2 rounded-lg text-xs'}>{lookupPublicAgent(id)?.name}</button>)}</div>
            <DepartmentPreview agentId={selectedId} totals={totals} brainComplete={brainComplete} />
            <WorkforceHandoffStrip activeId={selectedId} />
          </details>
          <div className="mt-6 flex justify-end"><AskPilotAboutPage /></div>
        </div>
      </div>
      <AgentProfileDrawer open={profileId !== null} onClose={() => setProfileId(null)} state={profileId ? agents[profileId] : null} />
    </div>
  );
};

export default Dashboard;
