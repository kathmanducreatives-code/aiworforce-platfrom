import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Moon, Sun, ChevronRight, Sparkles, Radar, Users, Eye, FileEdit, Inbox, Mail, Bookmark, Clock,
} from "lucide-react";
import MetricCard from "@/components/shared/MetricCard";
import SkeletonCard from "@/components/shared/SkeletonCard";
import NotificationCenter from "@/components/shared/NotificationCenter";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompanyBrain } from "@/hooks/useCompanyBrain";
import { useSignalFeed } from "@/hooks/useSignalFeed";
import { useApprovals } from "@/hooks/useApprovals";
import { useSignalReviews } from "@/hooks/useSignalReviews";

const Dashboard = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { workspaceId } = useWorkspace();
  const { signals, drafts, savedOutputs, loading } = useSignalFeed(workspaceId);
  const { approvals } = useApprovals(workspaceId);
  const { reviewsBySignal } = useSignalReviews(workspaceId);

  const metrics = useMemo(() => {
    const signalsFound = signals.length;
    const hotLeads = signals.filter((s) => (s.signal_label ?? "").toLowerCase().includes("hot")).length;
    const competitorSignals = signals.filter((s) => (s.signal_type ?? "").toLowerCase().includes("competitor")).length;
    const contentDrafts = savedOutputs.filter((o) => (o.type ?? "").includes("content") || (o.type ?? "").includes("post")).length;
    const outreachDrafts = drafts.length;
    const savedActioned = Object.values(reviewsBySignal).filter((r) =>
      r.status === "saved" || r.status === "actioned"
    ).length;
    const pendingApprovals = approvals.length;
    // Rough estimate: 8 min per draft / signal reviewed
    const timeSavedMin = (savedActioned + outreachDrafts + contentDrafts) * 8;
    return { signalsFound, hotLeads, competitorSignals, contentDrafts, outreachDrafts, savedActioned, pendingApprovals, timeSavedMin };
  }, [signals, drafts, savedOutputs, reviewsBySignal, approvals]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6">
        <CompanyBrainBanner />

        {/* Welcome */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            {profile?.logo_url && <img src={profile.logo_url} alt="Logo" className="h-10 w-auto" />}
            <div>
              <h1 className="text-[22px] font-semibold text-foreground tracking-tight leading-tight">
                {getGreeting()}, {profile?.full_name?.split(" ")[0] || "there"}
              </h1>
              <p className="text-[13px] text-muted-foreground mt-1">
                Here's what your AI workforce surfaced for you today.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-full border border-border-subtle hover:border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
            <NotificationCenter />
          </div>
        </div>

        {/* GTM Metrics */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <SkeletonCard variant="metric" count={4} className="contents" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <MetricCard label="Signals found"      value={metrics.signalsFound}      icon={<Radar className="h-3.5 w-3.5 text-emerald-400" />} />
              <MetricCard label="Hot leads"          value={metrics.hotLeads}          icon={<Users className="h-3.5 w-3.5 text-amber-400" />} />
              <MetricCard label="Competitor signals" value={metrics.competitorSignals} icon={<Eye className="h-3.5 w-3.5 text-blue-400" />} />
              <MetricCard label="Content drafts"     value={metrics.contentDrafts}     icon={<FileEdit className="h-3.5 w-3.5 text-violet-400" />} />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <MetricCard label="Pending approvals" value={metrics.pendingApprovals} icon={<Inbox className="h-3.5 w-3.5 text-amber-400" />} valueColor={metrics.pendingApprovals > 0 ? "primary" : undefined} />
              <MetricCard label="Outreach drafts"   value={metrics.outreachDrafts}   icon={<Mail className="h-3.5 w-3.5 text-teal-400" />} />
              <MetricCard label="Saved / actioned"  value={metrics.savedActioned}    icon={<Bookmark className="h-3.5 w-3.5 text-emerald-400" />} />
              <MetricCard label="Time saved"        value={`${metrics.timeSavedMin}m`} icon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />} />
            </div>
          </>
        )}

        {/* Getting started + What needs attention */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 rounded-2xl border border-border bg-card/50 p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Getting started with Agentory</h3>
            <ol className="space-y-3">
              <Step n={1} title="Set up Company Brain"
                desc="Tell Agentory what you sell, who you sell to, and your goals."
                cta="Open" onClick={() => navigate("/onboarding/company-brain")} />
              <Step n={2} title="Find signals"
                desc="Scout finds leads, competitor conversations, and engagement opportunities."
                cta="Go to Signals" onClick={() => navigate("/signals")} />
              <Step n={3} title="Review and act"
                desc="Aria ranks signals. Scribe and Penn draft comments, DMs, and outreach for your approval."
                cta="Open Awaiting You" onClick={() => navigate("/awaiting-you")} />
            </ol>
          </div>

          <div className="lg:col-span-2 rounded-2xl border border-border bg-card/50 p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">What needs attention</h3>
            <div className="space-y-2">
              {metrics.pendingApprovals > 0 && (
                <Action icon={<Inbox className="h-4 w-4 text-amber-400" />} title={`${metrics.pendingApprovals} item${metrics.pendingApprovals === 1 ? "" : "s"} awaiting approval`} onClick={() => navigate("/awaiting-you")} />
              )}
              {metrics.hotLeads > 0 && (
                <Action icon={<Users className="h-4 w-4 text-emerald-400" />} title={`${metrics.hotLeads} hot lead${metrics.hotLeads === 1 ? "" : "s"} to review`} onClick={() => navigate("/signals")} />
              )}
              {metrics.competitorSignals > 0 && (
                <Action icon={<Eye className="h-4 w-4 text-blue-400" />} title={`${metrics.competitorSignals} new competitor signal${metrics.competitorSignals === 1 ? "" : "s"}`} onClick={() => navigate("/competitors")} />
              )}
              {metrics.contentDrafts > 0 && (
                <Action icon={<FileEdit className="h-4 w-4 text-violet-400" />} title={`${metrics.contentDrafts} content draft${metrics.contentDrafts === 1 ? "" : "s"} ready`} onClick={() => navigate("/content")} />
              )}
              {metrics.pendingApprovals + metrics.hotLeads + metrics.competitorSignals + metrics.contentDrafts === 0 && (
                <p className="text-xs text-muted-foreground py-4 text-center">All clear. Ask Pilot for a task to get started.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function Step({ n, title, desc, cta, onClick }: { n: number; title: string; desc: string; cta: string; onClick: () => void }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">{n}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <button onClick={onClick} className="text-xs font-medium text-primary hover:underline shrink-0">{cta} →</button>
    </li>
  );
}

function Action({ icon, title, onClick }: { icon: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-all group text-left">
      <div className="p-2 rounded-lg bg-muted/80 group-hover:bg-primary/10 transition-colors">{icon}</div>
      <p className="flex-1 text-sm font-medium text-foreground">{title}</p>
      <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
    </button>
  );
}

function CompanyBrainBanner() {
  const navigate = useNavigate();
  const { data, loading } = useCompanyBrain();
  if (loading || !data || data.onboarding_completed) return null;
  return (
    <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-3">
        <Sparkles className="h-4 w-4 text-primary" />
        <div>
          <div className="text-sm font-semibold">Complete Company Brain setup</div>
          <div className="text-xs text-muted-foreground">Teach Pilot, Scout, Aria, Penn, Hawk, and Scribe about your company.</div>
        </div>
      </div>
      <button onClick={() => navigate("/onboarding/company-brain")} className="text-sm font-semibold text-primary hover:underline">
        Set up now →
      </button>
    </div>
  );
}

export default Dashboard;
