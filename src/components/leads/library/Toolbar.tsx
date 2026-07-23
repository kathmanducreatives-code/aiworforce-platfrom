import { X, Search, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { LeadRow } from "@/lib/leadLibrary/types";
import { EMPTY_FILTERS, type Filters } from "./FilterBar";
import {
  decisionLabel,
  fitBandLabel,
  buyerStateLabel,
  lifecycleLabel,
  type SortKey,
} from "@/lib/leadLibrary/leadDecisionState";

export type TabId = "all" | "lists" | "runs" | "activity";

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "All leads" },
  { id: "lists", label: "Lists" },
  { id: "runs", label: "Search runs" },
  { id: "activity", label: "Activity" },
];

const DECISION_OPTS: [Filters["decision"], string][] = [
  ["contact", decisionLabel("contact")],
  ["watch", decisionLabel("watch")],
  ["needs_review", decisionLabel("needs_review")],
  ["skip", decisionLabel("skip")],
];
const LIFECYCLE_OPTS: [Filters["lifecycle"], string][] = [
  ["research_needed", lifecycleLabel("research_needed")],
  ["buyer_needed", lifecycleLabel("buyer_needed")],
  ["qualified", lifecycleLabel("qualified")],
  ["draft_ready", lifecycleLabel("draft_ready")],
  ["awaiting_approval", lifecycleLabel("awaiting_approval")],
  ["contacted", lifecycleLabel("contacted")],
  ["replied", lifecycleLabel("replied")],
  ["meeting", lifecycleLabel("meeting")],
];
const FIT_OPTS: [Filters["fit"], string][] = [
  ["strong", fitBandLabel("strong")],
  ["good", fitBandLabel("good")],
  ["soft", fitBandLabel("soft")],
  ["poor", fitBandLabel("poor")],
  ["unknown", fitBandLabel("unknown")],
];
const BUYER_OPTS: [Filters["buyer"], string][] = [
  ["verified", buyerStateLabel("verified")],
  ["needs_review", buyerStateLabel("needs_review")],
  ["missing", buyerStateLabel("missing")],
];

const SORT_OPTS: { id: SortKey; label: string }[] = [
  { id: "recommended", label: "Recommended" },
  { id: "fit", label: "Strongest fit" },
  { id: "latest_signal", label: "Latest signal" },
  { id: "updated", label: "Recently updated" },
];

interface Props {
  tab: TabId;
  onTab: (t: TabId) => void;
  rows: LeadRow[];
  filters: Filters;
  onFilters: (f: Filters) => void;
  onSaveView: () => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
}

export function Toolbar({ tab, onTab, rows, filters, onFilters, onSaveView, sort, onSort }: Props) {
  const industries = Array.from(new Set(rows.map((r) => r.industry).filter((v): v is string => !!v))).sort();
  const sources = Array.from(new Set(rows.map((r) => r.strongestSource?.discoveryMethod).filter((v): v is string => !!v))).sort();
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onFilters({ ...filters, [k]: v });

  const chips: { key: keyof Filters; label: string }[] = [];
  if (filters.decision !== "any") chips.push({ key: "decision", label: decisionLabel(filters.decision) });
  if (filters.lifecycle !== "any") chips.push({ key: "lifecycle", label: lifecycleLabel(filters.lifecycle) });
  if (filters.fit !== "any") chips.push({ key: "fit", label: fitBandLabel(filters.fit) });
  if (filters.buyer !== "any") chips.push({ key: "buyer", label: buyerStateLabel(filters.buyer) });
  if (filters.industry !== "any") chips.push({ key: "industry", label: filters.industry });
  if (filters.source !== "any") chips.push({ key: "source", label: filters.source });
  const hasActive = chips.length > 0 || !!filters.q || sort !== "recommended";

  return (
    <div className="space-y-2">
      {/* Row 1: tabs + sort + save */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.02] border border-white/[0.05]">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              className={cn(
                "px-3 h-7 text-[12px] rounded-md transition-colors",
                tab === t.id
                  ? "bg-white/[0.06] text-foreground shadow-[inset_0_-2px_0_rgba(16,185,129,0.7)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Sort</span>
          <Select value={sort} onValueChange={(v) => onSort(v as SortKey)}>
            <SelectTrigger className="h-7 w-[160px] bg-black/25 border-white/10 text-[11.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTS.map((o) => (
                <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
            onClick={onSaveView}
          >
            Save view
          </Button>
        </div>
      </div>

      {/* Row 2: search + filters */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
          <Input
            value={filters.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Search account, buyer, why-now…"
            className="h-8 pl-8 bg-black/25 border-white/10 focus-visible:ring-primary/30 text-xs"
          />
        </div>
        <FilterSelect value={filters.decision} onChange={(v) => set("decision", v as Filters["decision"])} label="Any decision" options={DECISION_OPTS as [string, string][]} />
        <FilterSelect value={filters.lifecycle} onChange={(v) => set("lifecycle", v as Filters["lifecycle"])} label="Any stage" options={LIFECYCLE_OPTS as [string, string][]} />
        <FilterSelect value={filters.fit} onChange={(v) => set("fit", v as Filters["fit"])} label="Any fit" options={FIT_OPTS as [string, string][]} />
        <FilterSelect value={filters.buyer} onChange={(v) => set("buyer", v as Filters["buyer"])} label="Any buyer" options={BUYER_OPTS as [string, string][]} />
        <FilterSelect value={filters.industry} onChange={(v) => set("industry", v)} label="Any industry" options={industries.map((i) => [i, i])} />
        <FilterSelect value={filters.source} onChange={(v) => set("source", v)} label="Any source" options={sources.map((s) => [s, s])} />
        <Button
          size="sm"
          variant="ghost"
          disabled={!hasActive}
          className="h-8 px-2 text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-white/[0.04] disabled:opacity-40"
          onClick={() => { onFilters(EMPTY_FILTERS); onSort("recommended"); }}
        >
          <RotateCcw className="h-3 w-3 mr-1" /> Reset
        </Button>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => set(c.key, "any" as never)}
              className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/[0.08] px-2 py-0.5 text-[11px] text-primary/95 hover:bg-primary/[0.14] transition-colors"
            >
              {c.label}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  value, onChange, label, options,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[140px] bg-black/25 border-white/10 text-[11.5px] hover:bg-white/[0.03]">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="any">{label}</SelectItem>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>{l}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
