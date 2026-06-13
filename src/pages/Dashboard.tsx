import { useMemo } from "react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompanyBrain } from "@/hooks/useCompanyBrain";
import { useSignalFeed } from "@/hooks/useSignalFeed";
import { useApprovals } from "@/hooks/useApprovals";
import { useSignalReviews } from "@/hooks/useSignalReviews";
import SkeletonCard from "@/components/shared/SkeletonCard";
import BrainReadinessCard from "@/components/dashboard/BrainReadinessCard";
import WorkforceBriefHero from "@/components/dashboard/WorkforceBriefHero";
import MetricsGrid, { type DashboardMetrics } from "@/components/dashboard/MetricsGrid";
import WorkforceActivityPanel from "@/components/dashboard/WorkforceActivityPanel";
import NeedsAttentionPanel from "@/components/dashboard/NeedsAttentionPanel";
import RecommendedMoves from "@/components/dashboard/RecommendedMoves";

const Dashboard = () => {
  const { workspaceId } = useWorkspace();
  const { signals, drafts, savedOutputs, loading } = useSignalFeed(workspaceId);
  const { approvals } = useApprovals(workspaceId);
  const { reviewsBySignal } = useSignalReviews(workspaceId);
  const { data: brain } = useCompanyBrain();

  const metrics: DashboardMetrics = useMemo(() => {
    const signalsFound = signals.length;
    const hotLeads = signals.filter((s) => (s.signal_label ?? "").toLowerCase().includes("hot")).length;
    const competitorSignals = signals.filter((s) =>
      (s.signal_type ?? "").toLowerCase().includes("competitor"),
    ).length;
    const contentDrafts = savedOutputs.filter(
      (o) => (o.type ?? "").includes("content") || (o.type ?? "").includes("post"),
    ).length;
    const outreachDrafts = drafts.length;
    const savedActioned = Object.values(reviewsBySignal).filter(
      (r) => r.status === "saved" || r.status === "actioned",
    ).length;
    const pendingApprovals = approvals.length;
    const timeSavedMin = (savedActioned + outreachDrafts + contentDrafts) * 8;
    return {
      signalsFound,
      hotLeads,
      competitorSignals,
      contentDrafts,
      outreachDrafts,
      savedActioned,
      pendingApprovals,
      timeSavedMin,
    };
  }, [signals, drafts, savedOutputs, reviewsBySignal, approvals]);

  const brainIncomplete = !brain?.onboarding_completed;

  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-32">
        <BrainReadinessCard />

        <WorkforceBriefHero
          signals={metrics.signalsFound}
          drafts={metrics.outreachDrafts + metrics.contentDrafts}
          approvals={metrics.pendingApprovals}
        />

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <SkeletonCard variant="metric" count={8} className="contents" />
          </div>
        ) : (
          <MetricsGrid m={metrics} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3">
            <WorkforceActivityPanel m={metrics} />
          </div>
          <div className="lg:col-span-2">
            <NeedsAttentionPanel m={metrics} brainIncomplete={brainIncomplete} />
          </div>
        </div>

        <RecommendedMoves brainIncomplete={brainIncomplete} />
      </div>
    </div>
  );
};

export default Dashboard;
