import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sparkles, X, ArrowUpRight, ArrowRight } from 'lucide-react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useWorkforceState } from '@/hooks/useWorkforceState';
import CompanyBrainStrip from '@/components/workforce/CompanyBrainStrip';
import PilotBriefing from '@/components/workforce/PilotBriefing';
import AgentProfileDrawer from '@/components/workforce/AgentProfileDrawer';
import AgentPortrait from '@/components/agents/AgentPortrait';
import WorkforceAgentCard from '@/components/dashboard/WorkforceAgentCard';
import WorkforceGreeting from '@/components/dashboard/WorkforceGreeting';
import { useAgentVisualStates } from '@/hooks/useAgentVisualStates';
import { visualAgentKey, type VisualAgentKey } from '@/lib/agent3d/visualState';
import { takeNewCompletions } from '@/lib/completionPulse';
import { formatAgo, watchlistOf } from '@/lib/liveIntelligence';
import { normalizeCompanyBrain } from '@/lib/normalizeCompanyBrain';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { AmbientBackdrop } from '@/components/layout/AmbientBackdrop';
import { publishWorkforcePulse } from '@/lib/workforcePulse';
import LiveIntelligenceBar from '@/components/dashboard/LiveIntelligenceBar';
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
  const { agents, timeline, totals, brainComplete, loading, signalFeed } = useWorkforceState(workspaceId);
  // Live execution truth for the agents' visuals — separate from the count-based copy above.
  const { states: visualStates, ready: visualReady } = useAgentVisualStates(workspaceId);
  const { data: brain } = useCompanyBrain();
  const watchlist = useMemo(() => watchlistOf(normalizeCompanyBrain(brain?.profile as Record<string, unknown> | null)), [brain?.profile]);

  // ONE COORDINATED BEAT when an agent really finishes a task while the page is
  // open: that agent's card acknowledges it, Recent activity lights once, and the
  // feed is re-read so the timeline and Live Intelligence show what changed.
  // Only real `completed` events fire it (see completionPulse.ts).
  const seenCompletions = useRef<Set<string> | null>(null);
  const [pulse, setPulse] = useState<{ agent: VisualAgentKey; nonce: number } | null>(null);
  const pulseTimer = useRef(0);
  const refreshFeed = signalFeed.refresh;
  useEffect(() => { seenCompletions.current = null; setPulse(null); }, [workspaceId]);
  useEffect(() => {
    if (!visualReady) return;
    const { seen, fresh } = takeNewCompletions(visualStates, seenCompletions.current);
    seenCompletions.current = seen;
    if (!fresh.length) return;
    setPulse((p) => ({ agent: fresh[0].agent, nonce: (p?.nonce ?? 0) + 1 }));
    void refreshFeed();
    window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => setPulse(null), 2800);
  }, [visualStates, visualReady, refreshFeed]);
  useEffect(() => () => window.clearTimeout(pulseTimer.current), []);
  // Share the live counts the command bar reacts to (see workforcePulse.ts).
  useEffect(() => { if (workspaceId && !loading) publishWorkforcePulse({ workspaceId, signals24h: totals.signals24h }); }, [workspaceId, loading, totals.signals24h]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
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
      <AmbientBackdrop variant="dashboard" />
      <div className="mx-auto w-full max-w-[1500px] px-5 lg:px-8 pt-5 pb-16">
        <header className="team-header">
          <WorkforceGreeting />
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
            {(['scout', 'aria', 'penn', 'scribe'] as AgentId[]).map(id => <WorkforceAgentCard key={id} agent={agents[id]} visual={visualStates[visualAgentKey(id)!]} loading={loading} onProfile={() => { setSelectedId(id); setProfileId(id); }} justFinished={!!pulse && pulse.agent === visualAgentKey(id)} onChat={() => talk(id)} onAction={() => { const action = agents[id].nextAction; if (action.route) navigate(action.route); else talk(id); }} />)}
          </section>
          <LiveIntelligenceBar workspaceId={workspaceId} feed={signalFeed} watchlist={watchlist} />
          <div className="team-lower">
            <section className="team-panel team-panel--ops" data-pulse={pulse ? 'true' : undefined} aria-label="Recent activity">
              <div className="team-panel-header"><h2>Recent activity</h2><button onClick={() => navigate('/workflows')}>Workflows <ArrowUpRight size={12} className="inline" /></button></div>
              {loading ? <TimelineSkeleton /> : timeline.length ? (
                <ol className="team-timeline">
                  {timeline.slice(0, 3).map(item => {
                    const name = lookupPublicAgent(item.agentId)?.name ?? '';
                    const rest = name && item.text.startsWith(name) ? item.text.slice(name.length) : ` ${item.text}`;
                    return <li className="team-activity" key={item.id}>
                      <span className="team-timeline__node"><AgentPortrait agentId={item.agentId} size={26} decorative /></span>
                      <div className="min-w-0"><p title={item.text}><b>{name}</b>{rest}</p><time dateTime={item.at ?? undefined}>{formatAgo(item.at, now) ?? item.time}</time></div>
                    </li>;
                  })}
                </ol>
              ) : (
                <div className="team-empty">
                  <TimelineSkeleton />
                  <p className="team-review-copy">Your team's work will appear here as a timeline. Start with a goal below.</p>
                </div>
              )}
            </section>
            <section className="team-panel team-panel--ops" aria-label="Your review queue">
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

/** A faint preview of the timeline to come — structure, never fake entries. */
function TimelineSkeleton() {
  return (
    <ol className="team-timeline team-timeline--skeleton" aria-hidden>
      {[62, 48, 55].map((w, i) => (
        <li className="team-activity" key={i}>
          <span className="team-timeline__node"><span className="team-skel team-skel--avatar" /></span>
          <div className="min-w-0 flex-1"><span className="team-skel" style={{ width: `${w}%` }} /><span className="team-skel team-skel--sub" /></div>
        </li>
      ))}
    </ol>
  );
}

export default Dashboard;
