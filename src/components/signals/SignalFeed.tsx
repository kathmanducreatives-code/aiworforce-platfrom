import { useMemo, useState } from "react";
import { RefreshCw, Inbox, ListOrdered, Sparkles, CheckSquare, Square, X, Bookmark, Check, EyeOff, MessageSquare, Send, FileText, Radar, Settings2, Plus, Loader2, Filter, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useCompanyBrain } from "@/hooks/useCompanyBrain";
import { useSignalFeed, type RadarCategory } from "@/hooks/useSignalFeed";
import { useSignalReviews } from "@/hooks/useSignalReviews";
import { useIntegrationReadiness } from "@/hooks/useIntegrationReadiness";
import { buildActionCommand, type FeedSignal } from "@/lib/signalFeedModel";
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
import RadarSummaryCards from "./RadarSummaryCards";
import EditRadarDrawer from "./EditRadarDrawer";
import LoadMoreConfirmDialog from "./LoadMoreConfirmDialog";
import SetupNeededCard from "./SetupNeededCard";

type Tab = "all" | "linkedin" | "competitors" | "people" | "hiring" | "drafts" | "saved";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "competitors", label: "Competitors" },
  { key: "people", label: "People" },
  { key: "hiring", label: "Hiring" },
  { key: "drafts", label: "Drafts" },
  { key: "saved", label: "Saved outputs" },
];

const EMPTY_PROMPTS = [
  "Find companies hiring GTM roles",
  "Find LinkedIn posts about AI SDRs",
  "Find competitor conversations for my company",
];

function matchesTab(s: FeedSignal, tab: Tab): boolean {
  switch (tab) {
    case "linkedin": return s.signal_type === "linkedin_engagement" || s.signal_type === "linkedin_intent";
    case "competitors": return s.signal_type === "competitor_engagement" || s.signal_type === "competitor";
    case "people": return s.signal_type === "people_profile" || s.signal_type === "people";
    case "hiring": return s.signal_type === "hiring_signal" || s.signal_type === "hiring";
    default: return true;
  }
}

function sendPrompt(text: string) {
  window.dispatchEvent(new CustomEvent("chat:send", { detail: text }));
  toast.success("Sent to Pilot");
}

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

  const savedFiltered = useMemo(
    () => savedOutputs.filter((o) => matchesSavedFilter(o, savedFilter)),
    [savedOutputs, savedFilter],
  );

  // Merge each signal with its persisted review row (default status `new`).
  const reviewed: ReviewedSignal[] = useMemo(
    () => signals.map((s) => mergeReviewState(s, reviewsBySignal[s.id])),
    [signals, reviewsBySignal],
  );

  const counts = useMemo(() => ({
    all: signals.length,
    linkedin: signals.filter((s) => s.signal_type === "linkedin_engagement" || s.signal_type === "linkedin_intent").length,
    competitors: signals.filter((s) => s.signal_type === "competitor_engagement" || s.signal_type === "competitor").length,
    people: signals.filter((s) => s.signal_type === "people_profile" || s.signal_type === "people").length,
    hiring: signals.filter((s) => s.signal_type === "hiring_signal" || s.signal_type === "hiring").length,
    drafts: drafts.length,
    saved: savedOutputs.length,
  } as Record<Tab, number>), [signals, drafts, savedOutputs]);

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
    window.dispatchEvent(new CustomEvent("chat:send", { detail: buildActionCommand("rank") }));
    toast.success("Asked Pilot to rank your saved signals");
  };

  const bulkDraft = (action: BulkDraftAction) => {
    if (selectedSignals.length === 0) return;
    window.dispatchEvent(new CustomEvent("chat:send", { detail: buildBulkCommand(action, selectedSignals) }));
    const verb = action === "rank" ? "Ranking" : "Drafting (no auto-send)";
    toast.success(`${verb} ${selectedSignals.length} signal${selectedSignals.length > 1 ? "s" : ""} via Pilot`);
    // Mark drafted signals actioned (preserving explicit saved/ignored).
    if (action !== "rank") {
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
    hiring: signals.filter((s) => s.signal_type === "hiring" || s.signal_type === "hiring_signal").length,
    linkedin_intent: signals.filter((s) => s.signal_type === "linkedin_intent" || s.signal_type === "linkedin_engagement").length,
    competitor: signals.filter((s) => s.signal_type === "competitor" || s.signal_type === "competitor_engagement").length,
    workflow_trend: signals.filter((s) => s.signal_type === "workflow_trend").length,
    people: signals.filter((s) => s.signal_type === "people" || s.signal_type === "people_profile").length,
  }), [signals]);

  const radarStatus = lastRun?.per_category ?? null;

  const prefs = (brainData?.profile as any)?.signal_preferences ?? {};
  const topKeywords: Partial<Record<RadarCategory, string>> = {
    hiring: (prefs.hiring_roles?.[0] ?? (brainData?.profile as any)?.icp?.buyer_roles?.[0]) || undefined,
    linkedin_intent: prefs.linkedin_topics?.[0] || undefined,
    competitor: prefs.competitors?.[0] || (brainData?.profile as any)?.competitors?.known?.[0] || undefined,
    workflow_trend: prefs.workflow_topics?.[0] || undefined,
  };

  return (
    <div className="p-4 pb-[260px] md:pb-[240px] space-y-4 text-[#C9D1D9]">
      {/* Premium header */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-emerald-300" />
            <h1 className="text-xl font-semibold text-[#F0F6FC]">Signal Feed</h1>
            <span className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">Your ICP-aware market radar</span>
          </div>
          <p className="text-[12px] text-neutral-400 mt-1">
            Scout scans hiring, LinkedIn conversations, competitors, and workflow trends using your Company Brain.
          </p>
          <p className="text-[11px] text-neutral-600 mt-0.5">
            Default weekly radar: 10 signals included. Load more uses extra credits.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Button onClick={handleRunRadar} disabled={scanning} size="sm">
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
            Run radar scan
          </Button>
          <Button onClick={() => setEditRadarOpen(true)} variant="outline" size="sm">
            <Settings2 className="h-3.5 w-3.5" /> Edit radar
          </Button>
          <Button onClick={() => setLoadMoreOpen(true)} variant="outline" size="sm" disabled={scanning}>
            <Plus className="h-3.5 w-3.5" /> Load more
          </Button>
        </div>
      </div>

      {/* Radar summary */}
      <RadarSummaryCards
        counts={radarCounts}
        status={radarStatus}
        topKeywords={topKeywords}
        lastScanAt={lastScanAt}
        onScanCategory={handleScanCategory}
      />

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
      <div className="flex items-center gap-1 flex-wrap border-b border-white/[0.06] pb-2">
        {TABS.map((t) => {
          const active = tab === t.key;
          const c = counts[t.key];
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`text-[12px] px-2.5 py-1 rounded-md transition-colors ${active ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300" : "text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.03] border border-transparent"}`}>
              {t.label}
              {c > 0 && <span className={`ml-1.5 text-[10px] ${active ? "text-emerald-300/70" : "text-neutral-500"}`}>{c}</span>}
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
          ? (signals.length > 0
              ? <FilterEmpty onClear={() => { clearFilters(); setReviewFilter("all"); setHideIgnored(true); }} />
              : <EmptyWithPrompts onRunRadar={handleRunRadar} scanning={scanning} />)
          : <ul className="space-y-2">{filtered.map((s) => (
              <SignalCard key={s.id} signal={s}
                selectable={selectMode}
                selected={selected.has(s.id)}
                onToggleSelect={toggleSelect}
                onSetReview={handleSetReview}
                onDraftAction={handleDraftAction} />
            ))}</ul>
      )}
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
          <button onClick={() => { window.dispatchEvent(new CustomEvent("chat:send", { detail: buildContentDraftCommand("find_engagement", output) })); toast.success("Asked Pilot to find engagement opportunities"); }}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] text-[#C9D1D9] hover:bg-emerald-500/[0.06] hover:border-emerald-500/30 hover:text-[#F0F6FC] transition-colors">
            <Radar className="h-3 w-3" /> Find engagement opportunities
          </button>
          <button onClick={() => { window.dispatchEvent(new CustomEvent("chat:send", { detail: buildContentDraftCommand("draft_comments", output) })); toast.success("Asked Pilot to draft comments (draft-only)"); }}
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

function FilterEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-neutral-500">
      <Inbox className="h-6 w-6" />
      <div className="text-[12px]">No signals match this review filter.</div>
      <button onClick={onClear} className="text-[11px] px-2.5 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] text-neutral-300">
        Clear filters
      </button>
    </div>
  );
}
