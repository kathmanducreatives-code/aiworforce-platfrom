import { useMemo, useState } from "react";
import { RefreshCw, Inbox, ListOrdered, Sparkles, CheckSquare, Square, X, Bookmark, Check, EyeOff, MessageSquare, Send, FileText, Radar, Settings2, Plus, Loader2, Filter, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompanyBrain } from "@/hooks/useCompanyBrain";
import { useSignalFeed, type RadarCategory } from "@/hooks/useSignalFeed";
import { useSignalReviews } from "@/hooks/useSignalReviews";
import { useIntegrationReadiness } from "@/hooks/useIntegrationReadiness";
import { buildActionCommand, type FeedSignal } from "@/lib/signalFeedModel";
import { sendAgentCommand } from "@/lib/agentCommand";
import { selectTopSignals } from "@/lib/signalRanking";
import ScoutPromptBox, { type ProviderPreview } from "./ScoutPromptBox";
import TrustSummary from "./TrustSummary";
import ManualSourceInput from "./ManualSourceInput";
import { classifyProviderState } from "./ProviderBadge";
import {
  contentDraftMeta,
  contentSubtypeLabel,
  buildContentDraftCommand,
  matchesSavedFilter,
  type SavedFilter,
} from "@/lib/contentDraftModel";
import type { SavedOutputRow } from "@/lib/signalsFeed";
import {
  mergeReviewState,
  matchesReviewFilter,
  buildBulkCommand,
  nextStatusAfterDraft,
  REVIEW_FILTERS,
  type ReviewFilter,
  type ReviewStatus,
  type ReviewedSignal,
  type BulkDraftAction,
} from "@/lib/signalReviewModel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import SignalCard from "./SignalCard";
import SignalCardRouter from "./SignalCardRouter";
import ScanDetailsPanel from "./ScanDetailsPanel";
import { currentScanRunId, signalsForRun, listScanRuns } from "@/lib/radarScanHistory";
import { categoryEmptyState } from "@/lib/radarCategoryModel";
import RadarSummaryCards from "./RadarSummaryCards";
import RadarBrief from "./RadarBrief";
import RadarSourceStrip from "./RadarSourceStrip";
import SignalDetailDrawer from "./SignalDetailDrawer";
import type { SignalActionHandlers } from "./SignalActionBar";
import { computeSourceStatuses } from "@/lib/radarSources";
import { buildTurnIntoCommand } from "@/lib/signalIdeaActions";
import EditRadarDrawer from "./EditRadarDrawer";
import LoadMoreConfirmDialog from "./LoadMoreConfirmDialog";
import SetupNeededCard from "./SetupNeededCard";

type Tab = "all" | "linkedin" | "competitors" | "people" | "hiring" | "funding" | "comments" | "drafts" | "saved" | "workflows" | "reviewed";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "hiring", label: "Hiring" },
  { key: "funding", label: "Funding" },
  { key: "competitors", label: "Competitors" },
  { key: "workflows", label: "Workflow trends" },
  { key: "linkedin", label: "LinkedIn posts" },
  { key: "comments", label: "Comments" },
  { key: "people", label: "Decision makers" },
  { key: "saved", label: "Saved" },
  { key: "reviewed", label: "Reviewed" },
  { key: "drafts", label: "Drafts" },
];

const EMPTY_PROMPTS = [
  "Find recently funded B2B SaaS startups hiring sales roles.",
  "Find companies in our ICP hiring RevOps or Founding AE roles.",
  "Find competitor movement from Clay, Apollo, Instantly, and Attio.",
  "Find founders talking about hiring SDRs too early.",
];

function matchesTab(s: FeedSignal, tab: Tab): boolean {
  switch (tab) {
    case "linkedin": return s.signal_type === "linkedin_engagement" || s.signal_type === "linkedin_intent";
    case "competitors": return s.signal_type === "competitor_engagement" || s.signal_type === "competitor";
    case "people": return s.signal_type === "people_profile" || s.signal_type === "people";
    case "hiring": return s.signal_type === "hiring_signal" || s.signal_type === "hiring";
    case "funding": return s.signal_type === "funding";
    case "comments": return s.signal_type === "linkedin_comment" || s.signal_type === "comments";
    case "workflows": return s.signal_type === "workflow_trend";
    case "reviewed": return true; // review-status filter handles the rest
    default: return true;
  }
}

function sendPrompt(text: string) {
  void sendAgentCommand(text, { success: "Sent to Pilot", action_source: "signal_feed_action" });
}

// Tab → radarCategoryModel category for honest per-category empty states.
const TAB_TO_CATEGORY: Record<Tab, Parameters<typeof categoryEmptyState>[0]["category"]> = {
  all: "all", hiring: "hiring", funding: "funding", competitors: "competitor",
  workflows: "workflow_trend", linkedin: "linkedin_post", comments: "linkedin_comment",
  people: "decision_maker", saved: "saved", reviewed: "reviewed", drafts: "all",
};

export default function SignalFeed() {
  const { workspaceId } = useWorkspace();
  const { data: brainData, refresh: refreshBrain } = useCompanyBrain();
  const { signals, drafts, savedOutputs, loading, error, refresh, runRadarScan, scanning, lastRun, lastScanAt } = useSignalFeed(workspaceId);
  const { reviewsBySignal, setReview, bulkSetReview } = useSignalReviews(workspaceId);

  const [tab, setTab] = useState<Tab>("all");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [hideIgnored, setHideIgnored] = useState(true);
  // Data-trust: the default feed shows only verified signals; this reveals
  // legacy / needs-verification rows (rules 6 & 7).
  const [showUnverified, setShowUnverified] = useState(false);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [hasSource, setHasSource] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [editRadarOpen, setEditRadarOpen] = useState(false);
  const [loadMoreOpen, setLoadMoreOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savedFilter, setSavedFilter] = useState<SavedFilter>("all");
  // Default radar shows the global top 10 verified signals; user can expand.
  const [showAll, setShowAll] = useState(false);
  // Current scan vs. all history — counters default to the current (newest) run
  // so previous scans never inflate them (scan_run_id in signals.raw; no migration).
  const [scanScope, setScanScope] = useState<"current" | "all">("current");

  const savedFiltered = useMemo(
    () => savedOutputs.filter((o) => matchesSavedFilter(o, savedFilter)),
    [savedOutputs, savedFilter],
  );

  // Current scan run + scope. Saved/Reviewed/Drafts always use full history;
  // signal categories default to the current run.
  const scanRuns = useMemo(() => listScanRuns(signals), [signals]);
  const activeRunId = useMemo(() => currentScanRunId(signals), [signals]);
  const usingHistory = scanScope === "all" || tab === "saved" || tab === "reviewed" || tab === "drafts";
  const scopedSignals = useMemo(
    () => (usingHistory || !activeRunId ? signals : signalsForRun(signals, activeRunId)),
    [signals, usingHistory, activeRunId],
  );
  // Person-only / legacy rows must not count as verified market signals.
  const personOnly = (s: FeedSignal) => !!(s.raw?.["is_person_only"] || s.raw?.["excluded_from_verified"]);

  // Merge each signal with its persisted review row (default status `new`).
  const reviewed: ReviewedSignal[] = useMemo(
    () => scopedSignals.map((s) => mergeReviewState(s, reviewsBySignal[s.id])),
    [scopedSignals, reviewsBySignal],
  );

  // Category counts use the CURRENT scan (or full history in "reviewed") and
  // exclude person-only rows from the All counter.
  const counts = useMemo(() => ({
    all: scopedSignals.filter((s) => !personOnly(s)).length,
    linkedin: scopedSignals.filter((s) => s.signal_type === "linkedin_engagement" || s.signal_type === "linkedin_intent" || s.signal_type === "linkedin_post").length,
    competitors: scopedSignals.filter((s) => s.signal_type === "competitor_engagement" || s.signal_type === "competitor").length,
    people: scopedSignals.filter((s) => s.signal_type === "people_profile" || s.signal_type === "people" || s.signal_type === "decision_maker").length,
    hiring: scopedSignals.filter((s) => s.signal_type === "hiring_signal" || s.signal_type === "hiring").length,
    funding: scopedSignals.filter((s) => s.signal_type === "funding").length,
    comments: scopedSignals.filter((s) => s.signal_type === "linkedin_comment" || s.signal_type === "comments").length,
    workflows: scopedSignals.filter((s) => s.signal_type === "workflow_trend").length,
    reviewed: signals.length,
    drafts: drafts.length,
    saved: savedOutputs.length,
  } as Record<Tab, number>), [scopedSignals, signals, drafts, savedOutputs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reviewed.filter((s) => {
      if (!matchesTab(s, tab)) return false;
      if (!matchesReviewFilter(s.review_status, reviewFilter)) return false;
      // Default ("All") view hides ignored unless the user opts in or filters to it.
      if (reviewFilter === "all" && hideIgnored && s.review_status === "ignored") return false;
      // Data-trust: hide legacy / needs-verification signals unless toggled on.
      if (!showUnverified && !s.show_by_default) return false;
      if (priority && (s.priority ?? "").toLowerCase() !== priority) return false;
      if (hasSource && !s.source_url) return false;
      if (q && !(`${s.title} ${s.description ?? ""} ${s.signal_label ?? ""} ${s.competitor_name ?? ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [reviewed, tab, reviewFilter, hideIgnored, showUnverified, query, priority, hasSource]);

  const unverifiedCount = useMemo(
    () => reviewed.filter((s) => !s.show_by_default && s.review_status !== "ignored").length,
    [reviewed],
  );

  const clearFilters = () => { setQuery(""); setPriority(""); setHasSource(false); };
  const hasActiveFilters = !!(query || priority || hasSource);
  const activeFilterCount = [query, priority, hasSource ? "src" : "", reviewFilter !== "all" ? "rev" : ""].filter(Boolean).length;

  // Category-aware empty state: distinguish "this category is genuinely empty"
  // from "filters hid the rows" — never show a global "N hidden" in a zero category.
  const categoryTotal = useMemo(() => reviewed.filter((s) => matchesTab(s, tab)).length, [reviewed, tab]);
  const catEmpty = useMemo(
    () => categoryEmptyState({ category: TAB_TO_CATEGORY[tab], categoryTotal, visibleInCategory: filtered.length, activeFilterCount }),
    [tab, categoryTotal, filtered.length, activeFilterCount],
  );

  // Top-10 default: pristine "All" view ranks the highest-scored verified signals
  // globally across sources. Any tab/filter/search switches to the full list.
  const topDefaultActive = tab === "all" && !hasActiveFilters && reviewFilter === "all" && !showUnverified && !selectMode;
  const topSignals = useMemo(
    () => selectTopSignals(filtered, {
      score: (s) => Number((s.raw?.score as number) ?? s.fit_score ?? 0),
      verified: (s) => s.show_by_default,
      createdAt: (s) => s.created_at,
      limit: 10,
    }),
    [filtered],
  );
  const displaySignals = topDefaultActive && !showAll ? topSignals : filtered;

  // ----- selection -----
  const toggleSelect = (id: string) =>
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const clearSelection = () => setSelected(new Set());
  const selectAllVisible = () => setSelected(new Set(filtered.map((s) => s.id)));
  const selectedSignals = useMemo(() => filtered.filter((s) => selected.has(s.id)), [filtered, selected]);

  // ----- single-card review actions -----
  const handleSetReview = async (id: string, status: ReviewStatus) => {
    try {
      await setReview(id, status);
      toast.success(status === "new" ? "Review cleared" : `Marked ${status}`);
    } catch {
      toast.error("Couldn't save review state");
    }
  };
  // After drafting from a card, mark actioned (unless saved/ignored).
  const handleDraftAction = async (id: string) => {
    const cur = (reviewed.find((s) => s.id === id)?.review_status) ?? "new";
    const next = nextStatusAfterDraft(cur);
    if (next === cur) return;
    try { await setReview(id, next); } catch { /* draft already sent; review state is best-effort */ }
  };

  // ----- bulk actions -----
  const rankAll = () => {
    void sendAgentCommand(buildActionCommand("rank"), {
      success: "Asked Pilot to rank your saved signals",
      action_source: "signal_feed_action",
    });
  };

  const bulkDraft = async (action: BulkDraftAction) => {
    if (selectedSignals.length === 0) return;
    const verb = action === "rank" ? "Ranking" : "Drafting (no auto-send)";
    const ok = await sendAgentCommand(buildBulkCommand(action, selectedSignals), {
      success: `${verb} ${selectedSignals.length} signal${selectedSignals.length > 1 ? "s" : ""} via Pilot`,
      action_source: "signal_feed_action",
    });
    // Mark drafted signals actioned (preserving explicit saved/ignored) only once
    // the command actually reached Pilot.
    if (ok && action !== "rank") {
      const ids = selectedSignals.filter((s) => nextStatusAfterDraft(s.review_status) === "actioned").map((s) => s.id);
      if (ids.length) void bulkSetReview(ids, "actioned").catch(() => {});
    }
  };

  const bulkReview = async (status: ReviewStatus) => {
    const ids = selectedSignals.map((s) => s.id);
    if (ids.length === 0) return;
    try {
      await bulkSetReview(ids, status);
      toast.success(`Marked ${ids.length} ${status}`);
      clearSelection();
    } catch {
      toast.error("Couldn't update selected signals");
    }
  };

  // ----- radar scan handlers -----
  const handleRunRadar = async () => {
    try {
      const result = await runRadarScan({ mode: "default" });
      const ready = Object.values(result.per_category).filter((c) => c.status === "ready").length;
      const setupNeeded = Object.values(result.per_category).filter((c) => c.status === "setup_needed").length;
      if (result.inserted > 0) {
        toast.success(`Scout saved ${result.inserted} new signal${result.inserted > 1 ? "s" : ""}${setupNeeded ? ` · ${setupNeeded} source${setupNeeded > 1 ? "s" : ""} need setup` : ""}`);
      } else if (ready === 0) {
        toast.warning("No sources are ready. Open Settings → Integrations.");
      } else {
        toast.message("Scout didn't find new ICP-matched signals this run. Try editing your radar.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Radar scan failed");
    }
  };

  const handleScanCategory = async (cat: RadarCategory) => {
    try {
      const result = await runRadarScan({ mode: "category", category: cat, limit: 6, confirmed: true });
      const c = result.per_category[cat];
      if (c?.status === "setup_needed") toast.warning(`${cat.replace(/_/g, " ")}: ${c.reason ?? "setup needed"}`);
      else if (result.inserted === 0) toast.message("No new signals in this category right now.");
      else toast.success(`Saved ${result.inserted} ${cat.replace(/_/g, " ")} signal${result.inserted > 1 ? "s" : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    }
  };

  const handleConfirmLoadMore = async () => {
    setLoadMoreOpen(false);
    try {
      const result = await runRadarScan({ mode: "load_more", confirmed: true });
      toast.success(`Loaded ${result.inserted} additional signal${result.inserted === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load more failed");
    }
  };

  // ----- counts/status per radar category -----
  const radarCounts: Record<RadarCategory, number> = useMemo(() => ({
    hiring: scopedSignals.filter((s) => s.signal_type === "hiring" || s.signal_type === "hiring_signal").length,
    linkedin_intent: scopedSignals.filter((s) => s.signal_type === "linkedin_intent" || s.signal_type === "linkedin_engagement" || s.signal_type === "linkedin_post").length,
    competitor: scopedSignals.filter((s) => s.signal_type === "competitor" || s.signal_type === "competitor_engagement").length,
    workflow_trend: scopedSignals.filter((s) => s.signal_type === "workflow_trend").length,
    people: scopedSignals.filter((s) => s.signal_type === "people" || s.signal_type === "people_profile").length,
  }), [scopedSignals]);

  const radarVerifiedCounts: Record<RadarCategory, number> = useMemo(() => ({
    hiring: reviewed.filter((s) => (s.signal_type === "hiring" || s.signal_type === "hiring_signal") && s.show_by_default).length,
    linkedin_intent: reviewed.filter((s) => (s.signal_type === "linkedin_intent" || s.signal_type === "linkedin_engagement") && s.show_by_default).length,
    competitor: reviewed.filter((s) => (s.signal_type === "competitor" || s.signal_type === "competitor_engagement") && s.show_by_default).length,
    workflow_trend: reviewed.filter((s) => s.signal_type === "workflow_trend" && s.show_by_default).length,
    people: reviewed.filter((s) => (s.signal_type === "people" || s.signal_type === "people_profile") && s.show_by_default).length,
  }), [reviewed]);

  const radarStatus = lastRun?.per_category ?? null;
  const verifiedTotal = reviewed.filter((s) => s.show_by_default && !personOnly(s)).length;

  // ----- provider readiness (workspace-level integrations) -----
  const { providers: integrationProviders } = useIntegrationReadiness();
  const firecrawlEntry = integrationProviders["firecrawl"];
  const apifyEntry = integrationProviders["apify"];
  const firecrawlState = classifyProviderState({
    ready: firecrawlEntry?.status === "connected",
    reason: firecrawlEntry?.reason,
    integrationStatus: firecrawlEntry?.status,
  });
  const apifyState = classifyProviderState({
    ready: apifyEntry?.status === "connected",
    reason: apifyEntry?.reason,
    integrationStatus: apifyEntry?.status,
  });

  const providerPreviews: ProviderPreview[] = [
    { key: "firecrawl", label: "Firecrawl", state: firecrawlState, reason: firecrawlEntry?.reason },
    { key: "apify", label: "Apify", state: apifyState, reason: apifyEntry?.reason },
  ];
  const anyProviderReady = providerPreviews.some((p) => p.state === "ready");
  const apifyBlocked = apifyState !== "ready";

  // Honest per-source readiness for the brief + strip.
  const sourceStatuses = useMemo(
    () => computeSourceStatuses({ firecrawlReady: firecrawlState === "ready", apifyReady: apifyState === "ready" }),
    [firecrawlState, apifyState],
  );
  const missingSourceLabels = useMemo(() => sourceStatuses.filter((s) => !s.runnable).map((s) => s.label), [sourceStatuses]);

  // Signal detail drawer.
  const [openSignalId, setOpenSignalId] = useState<string | null>(null);
  const openSignal = useMemo(() => reviewed.find((s) => s.id === openSignalId) ?? null, [reviewed, openSignalId]);
  const drawerHandlers: SignalActionHandlers = openSignal ? {
    onTurnIntoPost: () => { void sendAgentCommand(buildTurnIntoCommand("post", { title: openSignal.title, sourceUrl: openSignal.source_url }), { success: "Sent to Pilot", action_source: "signal_feed_action" }); },
    onTurnIntoComment: () => { void sendAgentCommand(buildTurnIntoCommand("comment", { title: openSignal.title, sourceUrl: openSignal.source_url }), { success: "Sent to Pilot", action_source: "signal_feed_action" }); },
    onSaveIdea: () => void handleSetReview(openSignal.id, "saved"),
    onMarkReviewed: () => void handleSetReview(openSignal.id, "reviewed"),
    onIgnore: () => void handleSetReview(openSignal.id, "ignored"),
  } : {};

  const prefs = (brainData?.profile as any)?.signal_preferences ?? {};
  const topKeywords: Partial<Record<RadarCategory, string>> = {
    hiring: (prefs.hiring_roles?.[0] ?? (brainData?.profile as any)?.icp?.buyer_roles?.[0]) || undefined,
    linkedin_intent: prefs.linkedin_topics?.[0] || undefined,
    competitor: prefs.competitors?.[0] || (brainData?.profile as any)?.competitors?.known?.[0] || undefined,
    workflow_trend: prefs.workflow_topics?.[0] || undefined,
  };

  return (
    <div className="p-6 pb-[260px] md:pb-[240px] space-y-6 text-[#C9D1D9] max-w-[1400px] mx-auto">
      {/* Premium header */}
      <div className="flex items-start gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <Radar className="h-7 w-7 text-emerald-300" />
            <h1 className="text-[30px] leading-tight font-bold text-[#F0F6FC] tracking-tight">Scout Radar</h1>
            <span className="text-[12px] font-medium px-2.5 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
              ICP-aware market radar
            </span>
          </div>
          <p className="text-[15px] text-neutral-400 mt-2 max-w-2xl">
            Scout scans hiring, LinkedIn conversations, competitors, and workflow trends using your Company Brain.
            Default weekly radar covers 10 signals — load more uses extra credits.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={handleRunRadar} disabled={scanning || !anyProviderReady} size="sm" className="text-[14px] font-semibold h-9">
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
            Run radar scan
          </Button>
          <Button onClick={() => setEditRadarOpen(true)} variant="outline" size="sm" className="text-[14px] h-9">
            <Settings2 className="h-4 w-4" /> Edit radar
          </Button>
          <Button onClick={() => setLoadMoreOpen(true)} variant="outline" size="sm" disabled={scanning || !anyProviderReady} className="text-[14px] h-9">
            <Plus className="h-4 w-4" /> Load more
          </Button>
        </div>
      </div>

      {/* Today's Radar Brief — real-data summary */}
      <RadarBrief signals={reviewed} missingSources={missingSourceLabels} onRunRadar={handleRunRadar} scanning={scanning} />

      {/* Scout prompt box */}
      <ScoutPromptBox
        scanning={scanning}
        providers={providerPreviews}
        estimatedCredits={10}
        onStart={async () => { await handleRunRadar(); }}
      />

      {/* Apify billing / unavailability notice */}
      {apifyBlocked && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-300 mt-0.5" />
          <div className="text-[14px] text-amber-100">
            <div className="font-semibold text-[#F0F6FC]">Apify isn't active</div>
            <div className="text-amber-200/80 mt-0.5">
              Scout can't scan LinkedIn people, comments, or company profiles yet. You can still review saved signals,
              scan hiring/workflow trends via Firecrawl, or paste a source manually below.
            </div>
          </div>
        </div>
      )}

      {/* Radar summary */}
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-neutral-300">Radar sources</h2>
        <RadarSourceStrip firecrawlReady={firecrawlState === "ready"} apifyReady={apifyState === "ready"} />
        <RadarSummaryCards
          counts={radarCounts}
          verifiedCounts={radarVerifiedCounts}
          status={radarStatus}
          topKeywords={topKeywords}
          lastScanAt={lastScanAt}
          onScanCategory={handleScanCategory}
        />
      </section>

      {/* Trust summary */}
      <TrustSummary
        totalRaw={signals.length}
        verified={verifiedTotal}
        needsVerification={Math.max(signals.length - verifiedTotal, 0)}
        lastRun={lastRun}
      />

      {/* Scan details diagnostics (per-source readiness; explains every zero) */}
      <ScanDetailsPanel diagnostics={lastRun?.diagnostics} scanRunId={lastRun?.scan_run_id} ranAt={lastScanAt} />

      {/* Current scan vs. history — counters default to the current run */}
      {scanRuns.filter((r) => r.scan_run_id !== "legacy").length > 1 && (
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-neutral-500">Showing:</span>
          <button onClick={() => setScanScope("current")} className={`px-2 py-1 rounded-md border ${scanScope === "current" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-white/[0.08] text-neutral-400 hover:text-neutral-200"}`}>Current scan</button>
          <button onClick={() => setScanScope("all")} className={`px-2 py-1 rounded-md border ${scanScope === "all" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-white/[0.08] text-neutral-400 hover:text-neutral-200"}`}>All scans ({scanRuns.filter((r) => r.scan_run_id !== "legacy").length})</button>
        </div>
      )}

      {/* Manual source */}
      <ManualSourceInput firecrawlState={firecrawlState} />

      {/* Setup-needed banners from last run */}
      {radarStatus && Object.entries(radarStatus).some(([_, v]) => v.status === "setup_needed") && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {(Object.entries(radarStatus) as [RadarCategory, typeof radarStatus[RadarCategory]][])
            .filter(([_, v]) => v.status === "setup_needed")
            .map(([cat, v]) => (
              <SetupNeededCard key={cat} label={cat.replace(/_/g, " ")} reason={v.reason} />
            ))}
        </div>
      )}

      {/* Company-Brain honesty banner: degraded scan / draft-not-activated warnings. */}
      {lastRun?.warnings && lastRun.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2">
          <div className="text-[12px] font-semibold text-amber-300">
            {lastRun.setup_required ? "Company Brain needs setup" : `Company Brain confidence: ${lastRun.brain_confidence ?? "medium"}`}
          </div>
          <ul className="mt-0.5 space-y-0.5">
            {lastRun.warnings.slice(0, 3).map((w, i) => (
              <li key={i} className="text-[11px] text-amber-200/80">{w}</li>
            ))}
          </ul>
        </div>
      )}



      {/* Existing toolbar */}
      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-white/[0.04]">
        <span className="text-[11px] text-neutral-500">{signals.length} saved signals</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => { setSelectMode((v) => !v); clearSelection(); }}
            className={`inline-flex items-center gap-1 text-[12px] px-2.5 py-1.5 rounded-md border ${selectMode ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"}`}>
            {selectMode ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />} Select
          </button>
          <button onClick={rankAll} className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]">
            <ListOrdered className="h-3.5 w-3.5" /> Rank by fit
          </button>
          <button onClick={() => { void refresh(); }} className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      <EditRadarDrawer
        open={editRadarOpen}
        onOpenChange={setEditRadarOpen}
        workspaceId={workspaceId}
        brainProfile={(brainData?.profile as any) ?? null}
        onSaved={() => refreshBrain()}
      />
      <LoadMoreConfirmDialog
        open={loadMoreOpen}
        onOpenChange={setLoadMoreOpen}
        onConfirm={() => void handleConfirmLoadMore()}
        loading={scanning}
      />

      {/* Type tabs */}
      <div className="flex items-center gap-1.5 flex-wrap border-b border-white/[0.06] pb-3">
        {TABS.map((t) => {
          const active = tab === t.key;
          const c = counts[t.key];
          return (
            <button key={t.key} onClick={() => { setTab(t.key); clearFilters(); setReviewFilter(t.key === "reviewed" ? "reviewed" : "all"); }}
              className={`text-[14px] font-medium px-3 py-1.5 rounded-md transition-colors ${active ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300" : "text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.03] border border-transparent"}`}>
              {t.label}
              {c > 0 && <span className={`ml-1.5 text-[11px] ${active ? "text-emerald-300/70" : "text-neutral-500"}`}>{c}</span>}
            </button>
          );
        })}
      </div>


      {/* Filters (signal feed tabs only) */}
      {tab !== "drafts" && tab !== "saved" && (
        <div className="flex items-center gap-2 flex-wrap">
          {/* review status filter */}
          <div className="inline-flex items-center gap-0.5 rounded-md border border-white/[0.08] bg-white/[0.02] p-0.5">
            {REVIEW_FILTERS.map((f) => (
              <button key={f.key} onClick={() => setReviewFilter(f.key)}
                className={`text-[11px] px-2 py-1 rounded transition-colors ${reviewFilter === f.key ? "bg-emerald-500/10 text-emerald-300" : "text-neutral-400 hover:text-neutral-200"}`}>
                {f.label}
              </button>
            ))}
          </div>
          {reviewFilter === "all" && (
            <label className="h-8 text-[12px] inline-flex items-center gap-1.5 text-neutral-400 px-2 rounded-md border border-white/[0.08] bg-white/[0.02]">
              <input type="checkbox" checked={hideIgnored} onChange={(e) => setHideIgnored(e.target.checked)} /> Hide ignored
            </label>
          )}
          {activeFilterCount > 0 && (
            <button onClick={() => { clearFilters(); setReviewFilter("all"); }}
              className="h-8 text-[12px] inline-flex items-center gap-1.5 text-emerald-300 px-2 rounded-md border border-emerald-500/30 bg-emerald-500/10">
              <X className="h-3 w-3" /> Reset filters ({activeFilterCount})
            </button>
          )}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search signals…"
            className="h-8 text-[12px] px-2.5 rounded-md border border-white/[0.08] bg-white/[0.02] text-[#C9D1D9] placeholder:text-neutral-500 w-44 focus:outline-none focus:border-emerald-500/30" />
          <select value={priority} onChange={(e) => setPriority(e.target.value)}
            className="h-8 text-[12px] px-2 rounded-md border border-white/[0.08] bg-[#0d1117] text-[#C9D1D9]">
            <option value="">Any priority</option>
            <option value="hot">Hot</option><option value="warm">Warm</option>
            <option value="maybe">Maybe</option><option value="ignore">Ignore</option>
          </select>
          <label className="h-8 text-[12px] inline-flex items-center gap-1.5 text-neutral-400 px-2 rounded-md border border-white/[0.08] bg-white/[0.02]">
            <input type="checkbox" checked={hasSource} onChange={(e) => setHasSource(e.target.checked)} /> Has source
          </label>
          <label className={`h-8 text-[12px] inline-flex items-center gap-1.5 px-2 rounded-md border ${showUnverified ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-white/[0.08] bg-white/[0.02] text-neutral-400"}`}>
            <input type="checkbox" checked={showUnverified} onChange={(e) => setShowUnverified(e.target.checked)} />
            Show unverified{unverifiedCount > 0 ? ` (${unverifiedCount})` : ""}
          </label>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="h-8 text-[12px] px-2.5 rounded-md text-neutral-400 hover:text-neutral-200">
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Bulk selection toolbar */}
      {selectMode && tab !== "drafts" && tab !== "saved" && (
        <div className="sticky top-0 z-10 flex items-center gap-1.5 flex-wrap rounded-md border border-emerald-500/20 bg-[#0d1117]/95 backdrop-blur px-2.5 py-2">
          <span className="text-[12px] text-emerald-300 font-medium">{selected.size} selected</span>
          <button onClick={selectAllVisible} className="text-[11px] px-2 py-1 rounded text-neutral-300 hover:text-neutral-100">Select all visible</button>
          <button onClick={clearSelection} className="text-[11px] px-2 py-1 rounded text-neutral-400 hover:text-neutral-200 inline-flex items-center gap-1"><X className="h-3 w-3" /> Clear</button>
          <div className="h-4 w-px bg-white/10 mx-1" />
          <BulkBtn disabled={!selected.size} onClick={() => bulkDraft("rank")} icon={ListOrdered} label="Rank selected" />
          <BulkBtn disabled={!selected.size} onClick={() => bulkDraft("draft_comment")} icon={MessageSquare} label="Draft comments" />
          <BulkBtn disabled={!selected.size} onClick={() => bulkDraft("draft_dm")} icon={Send} label="Draft DMs" />
          <BulkBtn disabled={!selected.size} onClick={() => bulkDraft("create_outreach")} icon={FileText} label="Draft outreach" />
          <div className="h-4 w-px bg-white/10 mx-1" />
          <BulkBtn disabled={!selected.size} onClick={() => void bulkReview("saved")} icon={Bookmark} label="Save" />
          <BulkBtn disabled={!selected.size} onClick={() => void bulkReview("reviewed")} icon={Check} label="Mark reviewed" />
          <BulkBtn disabled={!selected.size} onClick={() => void bulkReview("ignored")} icon={EyeOff} label="Ignore" />
        </div>
      )}

      {/* States */}
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 text-red-300 text-[12px] px-3 py-2">
          Couldn't load signals: {error}.{" "}
          <button onClick={() => void refresh()} className="underline">Retry</button>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24 bg-white/[0.04]" />
                  <Skeleton className="h-4 w-3/4 bg-white/[0.04]" />
                  <Skeleton className="h-3 w-full bg-white/[0.03]" />
                  <Skeleton className="h-3 w-5/6 bg-white/[0.03]" />
                </div>
                <Skeleton className="h-24 w-full bg-white/[0.03]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drafts tab */}
      {!loading && tab === "drafts" && (
        drafts.length === 0
          ? <Empty text="No outreach drafts yet. Ask Penn to draft outreach for your leads — nothing is ever sent without your approval." />
          : <ul className="space-y-2">{drafts.map((d) => (
              <li key={d.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="flex items-center gap-1.5"><span className="text-[10px] px-1.5 py-0.5 rounded border border-white/15 bg-white/5">{d.channel ?? "draft"}</span><span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">{d.status ?? "draft"}</span></div>
                {d.subject && <div className="text-[12px] text-[#F0F6FC] mt-1">{d.subject}</div>}
                <div className="text-[12px] text-[#C9D1D9] mt-1 line-clamp-3 whitespace-pre-wrap">{(d.body ?? "").slice(0, 280)}</div>
              </li>))}</ul>
      )}

      {/* Saved outputs tab */}
      {!loading && tab === "saved" && (
        savedOutputs.length === 0
          ? <Empty text="No saved outputs yet. Ask Scribe to write a founder post, post ideas, or comment drafts — or build a content loop." />
          : <>
              <div className="inline-flex items-center gap-0.5 rounded-md border border-white/[0.08] bg-white/[0.02] p-0.5 mb-2">
                {([["all", "All"], ["posts", "Content drafts"], ["comments", "Comment drafts"]] as [SavedFilter, string][]).map(([k, label]) => (
                  <button key={k} onClick={() => setSavedFilter(k)}
                    className={`text-[11px] px-2 py-1 rounded transition-colors ${savedFilter === k ? "bg-violet-500/10 text-violet-300" : "text-neutral-400 hover:text-neutral-200"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {savedFiltered.length === 0
                ? <Empty text="No saved outputs match this filter." />
                : <ul className="space-y-2">{savedFiltered.map((o) => (
                    <SavedOutputCard key={o.id} output={o} />
                  ))}</ul>}
            </>
      )}

      {/* Signal feed */}
      {!loading && tab !== "drafts" && tab !== "saved" && (
        filtered.length === 0
          ? (catEmpty.kind === "hidden_by_filters"
              ? <SmartFilterEmpty
                  hiddenCount={categoryTotal}
                  unverifiedCount={unverifiedCount}
                  showUnverified={showUnverified}
                  onShowUnverified={() => setShowUnverified(true)}
                  onClear={() => { clearFilters(); setReviewFilter("all"); setHideIgnored(false); setShowUnverified(true); }}
                  onRunRadar={handleRunRadar}
                  scanning={scanning}
                />
              : tab !== "all"
                ? <div className="text-center py-10 px-4"><p className="text-[15px] font-semibold text-foreground">{catEmpty.message}</p><Button className="mt-3" size="sm" onClick={handleRunRadar} disabled={scanning}>{scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />} Run radar</Button></div>
                : <NoVerifiedEmpty onRunRadar={handleRunRadar} scanning={scanning} onShowUnverified={() => setShowUnverified(true)} />)
          : <>
              {topDefaultActive && (
                <div className="flex items-center justify-between gap-2 flex-wrap text-[13px]">
                  <span className="text-neutral-300 font-medium">
                    {showAll ? `All ${filtered.length} verified signals` : `Top ${topSignals.length} signals`}
                    <span className="text-neutral-500 font-normal"> · ranked by fit &amp; freshness</span>
                  </span>
                  {filtered.length > topSignals.length && (
                    <button onClick={() => setShowAll((v) => !v)}
                      className="text-[12px] px-2.5 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] text-neutral-300 hover:text-neutral-100">
                      {showAll ? "Show top 10" : `Show all (${filtered.length})`}
                    </button>
                  )}
                </div>
              )}
              {showUnverified && (
                <div className="text-[13px] text-amber-200/80 rounded-md border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2">
                  Unverified signals may be missing source proof. Review before using them.
                </div>
              )}
              <ul className="space-y-2">{displaySignals.map((s) => (
                <li key={s.id}>
                  <SignalCardRouter signal={s} fallback={
                    <SignalCard signal={s}
                      selectable={selectMode}
                      selected={selected.has(s.id)}
                      onToggleSelect={toggleSelect}
                      onSetReview={handleSetReview}
                      onOpenDetail={() => setOpenSignalId(s.id)}
                      onDraftAction={handleDraftAction} />
                  } />
                </li>
              ))}</ul>
            </>
      )}

      <SignalDetailDrawer
        signal={openSignal}
        reviewStatus={openSignal ? ((reviewsBySignal[openSignal.id]?.status ?? openSignal.review_status) as ReviewStatus | null) : null}
        handlers={drawerHandlers}
        onClose={() => setOpenSignalId(null)}
      />
    </div>
  );
}

function SavedOutputCard({ output }: { output: SavedOutputRow }) {
  const meta = contentDraftMeta(output);
  const isContentDraft = output.type === "content_draft";
  const label = isContentDraft ? contentSubtypeLabel(meta.subtype) : (output.type ?? "output");
  return (
    <li className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-300">{label}</span>
        {meta.isContentLoop && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">content loop</span>
        )}
        {meta.competitor_related && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">competitor</span>
        )}
        {output.created_at && <span className="ml-auto text-[10px] text-neutral-500">{new Date(output.created_at).toLocaleDateString()}</span>}
      </div>
      {output.title && <div className="text-[12px] text-[#F0F6FC] mt-1 font-medium">{output.title}</div>}

      {(meta.topic || meta.audience || meta.angle) && (
        <div className="text-[10px] text-neutral-500 mt-1 space-y-0.5">
          {meta.topic && <div>topic: <span className="text-neutral-400">{meta.topic}</span></div>}
          {meta.audience && <div>audience: <span className="text-neutral-400">{meta.audience}</span></div>}
          {meta.angle && <div>angle: <span className="text-neutral-400">{meta.angle}</span></div>}
        </div>
      )}

      <div className="text-[12px] text-[#C9D1D9] mt-1 line-clamp-4 whitespace-pre-wrap">{(output.body ?? "").slice(0, 400)}</div>

      {/* Draft-only actions for content drafts (never posts). */}
      {isContentDraft && meta.subtype !== "comment_draft" && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <button onClick={() => { void sendAgentCommand(buildContentDraftCommand("find_engagement", output), { success: "Asked Pilot to find engagement opportunities", action_source: "signal_feed_action" }); }}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] text-[#C9D1D9] hover:bg-emerald-500/[0.06] hover:border-emerald-500/30 hover:text-[#F0F6FC] transition-colors">
            <Radar className="h-3 w-3" /> Find engagement opportunities
          </button>
          <button onClick={() => { void sendAgentCommand(buildContentDraftCommand("draft_comments", output), { success: "Asked Pilot to draft comments (draft-only)", action_source: "signal_feed_action" }); }}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] text-[#C9D1D9] hover:bg-emerald-500/[0.06] hover:border-emerald-500/30 hover:text-[#F0F6FC] transition-colors">
            <MessageSquare className="h-3 w-3" /> Draft comments from this
          </button>
        </div>
      )}
    </li>
  );
}

function BulkBtn({ onClick, icon: Icon, label, disabled }: { onClick: () => void; icon: any; label: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] text-[#C9D1D9] hover:bg-emerald-500/[0.06] hover:border-emerald-500/30 hover:text-[#F0F6FC] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
      <Icon className="h-3 w-3" /> {label}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-neutral-500">
      <Inbox className="h-6 w-6" />
      <div className="text-[12px] max-w-sm">{text}</div>
    </div>
  );
}

function EmptyWithPrompts({ onRunRadar, scanning }: { onRunRadar?: () => void; scanning?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="p-3 rounded-full bg-emerald-500/10 border border-emerald-500/20">
        <Radar className="h-6 w-6 text-emerald-300" />
      </div>
      <div>
        <div className="text-[14px] font-medium text-[#F0F6FC]">Scout hasn't scanned your market yet</div>
        <div className="text-[12px] text-neutral-400 max-w-sm mt-1">
          Run your first ICP radar scan to load 10 signals across hiring, LinkedIn intent, competitors, and workflow trends.
        </div>
      </div>
      {onRunRadar && (
        <Button onClick={onRunRadar} disabled={scanning} className="mt-1">
          {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
          Run first radar scan
        </Button>
      )}
      <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2">
        {EMPTY_PROMPTS.map((p) => (
          <button key={p} onClick={() => sendPrompt(p)}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.02] text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-200 transition-colors">
            <Sparkles className="h-3 w-3" /> {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function SmartFilterEmpty({
  hiddenCount, unverifiedCount, showUnverified,
  onShowUnverified, onClear, onRunRadar, scanning,
}: {
  hiddenCount: number; unverifiedCount: number; showUnverified: boolean;
  onShowUnverified: () => void; onClear: () => void;
  onRunRadar?: () => void; scanning?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center rounded-xl border border-white/[0.06] bg-white/[0.015]">
      <div className="p-3 rounded-full bg-white/[0.04] border border-white/[0.08]">
        <Filter className="h-6 w-6 text-neutral-400" />
      </div>
      <div>
        <div className="text-[16px] font-semibold text-[#F0F6FC]">
          {hiddenCount} signal{hiddenCount === 1 ? "" : "s"} hidden by your current filters
        </div>
        <div className="text-[15px] text-neutral-400 max-w-md mt-1">
          Most of these signals are unverified or ignored. Turn on "Show unverified" or clear filters to review them.
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap justify-center mt-1">
        {!showUnverified && unverifiedCount > 0 && (
          <Button onClick={onShowUnverified} size="sm" variant="outline" className="text-[14px]">
            Show unverified ({unverifiedCount})
          </Button>
        )}
        <Button onClick={onClear} size="sm" variant="outline" className="text-[14px]">
          Clear filters
        </Button>
        {onRunRadar && (
          <Button onClick={onRunRadar} size="sm" disabled={scanning} className="text-[14px] font-semibold">
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
            Run fresh radar scan
          </Button>
        )}
      </div>
    </div>
  );
}

function NoVerifiedEmpty({ onRunRadar, scanning, onShowUnverified }: { onRunRadar?: () => void; scanning?: boolean; onShowUnverified?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center rounded-xl border border-white/[0.06] bg-white/[0.015]">
      <div className="p-3 rounded-full bg-emerald-500/10 border border-emerald-500/20">
        <Radar className="h-6 w-6 text-emerald-300" />
      </div>
      <div>
        <div className="text-[16px] font-semibold text-[#F0F6FC]">No verified signals yet.</div>
        <div className="text-[15px] text-neutral-400 max-w-md mt-1">
          Scout found signals, but they need source proof before they can be shown as verified.
          Run a fresh radar scan or review unverified signals.
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap justify-center mt-1">
        {onRunRadar && (
          <Button onClick={onRunRadar} size="sm" disabled={scanning} className="text-[14px] font-semibold">
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
            Run fresh radar scan
          </Button>
        )}
        {onShowUnverified && (
          <Button onClick={onShowUnverified} size="sm" variant="outline" className="text-[14px]">
            Review unverified
          </Button>
        )}
      </div>
    </div>
  );
}
