import { useMemo, useState } from "react";
import { RefreshCw, Inbox, ListOrdered, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useSignalFeed } from "@/hooks/useSignalFeed";
import { buildActionCommand, type FeedSignal } from "@/lib/signalFeedModel";
import { Skeleton } from "@/components/ui/skeleton";
import SignalCard from "./SignalCard";

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
    case "linkedin": return s.signal_type === "linkedin_engagement";
    case "competitors": return s.signal_type === "competitor_engagement";
    case "people": return s.signal_type === "people_profile";
    case "hiring": return s.signal_type === "hiring_signal";
    default: return true;
  }
}

function sendPrompt(text: string) {
  window.dispatchEvent(new CustomEvent("chat:send", { detail: text }));
  toast.success("Sent to Pilot");
}

export default function SignalFeed() {
  const { workspaceId } = useWorkspace();
  const { signals, drafts, savedOutputs, loading, error, refresh } = useSignalFeed(workspaceId);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [hasSource, setHasSource] = useState(false);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());

  const counts = useMemo(() => ({
    all: signals.length,
    linkedin: signals.filter((s) => s.signal_type === "linkedin_engagement").length,
    competitors: signals.filter((s) => s.signal_type === "competitor_engagement").length,
    people: signals.filter((s) => s.signal_type === "people_profile").length,
    hiring: signals.filter((s) => s.signal_type === "hiring_signal").length,
    drafts: drafts.length,
    saved: savedOutputs.length,
  } as Record<Tab, number>), [signals, drafts, savedOutputs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return signals.filter((s) => {
      if (!matchesTab(s, tab)) return false;
      if (priority && (s.priority ?? "").toLowerCase() !== priority) return false;
      if (hasSource && !s.source_url) return false;
      if (q && !(`${s.title} ${s.description ?? ""} ${s.signal_label ?? ""} ${s.competitor_name ?? ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [signals, tab, query, priority, hasSource]);

  const toggleReviewed = (id: string) =>
    setReviewed((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const clearFilters = () => { setQuery(""); setPriority(""); setHasSource(false); };
  const hasActiveFilters = !!(query || priority || hasSource);

  const rankAll = () => {
    window.dispatchEvent(new CustomEvent("chat:send", { detail: buildActionCommand("rank") }));
    toast.success("Asked Pilot to rank your saved signals");
  };

  return (
    <div className="p-4 pb-[180px] space-y-3 text-[#C9D1D9]">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-lg font-semibold text-[#F0F6FC]">Signal Feed</h1>
        <span className="text-[11px] text-neutral-500">{signals.length} saved signals</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={rankAll} className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]">
            <ListOrdered className="h-3.5 w-3.5" /> Rank by fit
          </button>
          <button onClick={() => { void refresh(); }} className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1.5 rounded-md border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
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
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search signals…"
            className="h-8 text-[12px] px-2.5 rounded-md border border-white/[0.08] bg-white/[0.02] text-[#C9D1D9] placeholder:text-neutral-500 w-48 focus:outline-none focus:border-emerald-500/30" />
          <select value={priority} onChange={(e) => setPriority(e.target.value)}
            className="h-8 text-[12px] px-2 rounded-md border border-white/[0.08] bg-[#0d1117] text-[#C9D1D9]">
            <option value="">Any priority</option>
            <option value="hot">Hot</option><option value="warm">Warm</option>
            <option value="maybe">Maybe</option><option value="ignore">Ignore</option>
          </select>
          <label className="h-8 text-[12px] inline-flex items-center gap-1.5 text-neutral-400 px-2 rounded-md border border-white/[0.08] bg-white/[0.02]">
            <input type="checkbox" checked={hasSource} onChange={(e) => setHasSource(e.target.checked)} /> Has source
          </label>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="h-8 text-[12px] px-2.5 rounded-md text-neutral-400 hover:text-neutral-200">
              Clear filters
            </button>
          )}
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
          ? <Empty text="No saved outputs yet. Ask Scribe to write a post, report, or comment drafts." />
          : <ul className="space-y-2">{savedOutputs.map((o) => (
              <li key={o.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="flex items-center gap-1.5"><span className="text-[10px] px-1.5 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-300">{o.type ?? "output"}</span>{o.created_at && <span className="ml-auto text-[10px] text-neutral-500">{new Date(o.created_at).toLocaleDateString()}</span>}</div>
                {o.title && <div className="text-[12px] text-[#F0F6FC] mt-1">{o.title}</div>}
                <div className="text-[12px] text-[#C9D1D9] mt-1 line-clamp-4 whitespace-pre-wrap">{(o.body ?? "").slice(0, 400)}</div>
              </li>))}</ul>
      )}

      {/* Signal feed */}
      {!loading && tab !== "drafts" && tab !== "saved" && (
        filtered.length === 0
          ? (signals.length > 0 && hasActiveFilters
              ? <FilterEmpty onClear={clearFilters} />
              : <EmptyWithPrompts />)
          : <ul className="space-y-2">{filtered.map((s) => (
              <SignalCard key={s.id} signal={s} reviewed={reviewed.has(s.id)} onIgnore={toggleReviewed} />
            ))}</ul>
      )}
    </div>
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

function EmptyWithPrompts() {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center text-neutral-500">
      <Inbox className="h-6 w-6" />
      <div className="text-[12px] max-w-sm">
        No saved signals yet. Ask Scout to find hiring signals, LinkedIn engagement, or competitor conversations.
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5 mt-1">
        {EMPTY_PROMPTS.map((p) => (
          <button key={p} onClick={() => sendPrompt(p)}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-300 hover:bg-emerald-500/[0.1] transition-colors">
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
      <div className="text-[12px]">No signals match these filters.</div>
      <button onClick={onClear} className="text-[11px] px-2.5 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] text-neutral-300">
        Clear filters
      </button>
    </div>
  );
}
