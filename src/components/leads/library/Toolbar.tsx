import { X, Search, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { LeadRow } from "@/lib/leadLibrary/types";
import {
  ACCOUNT_STATUS_LABEL,
  CONTACT_READINESS_LABEL,
} from "@/lib/leadLibrary/types";
import { EMPTY_FILTERS, type Filters } from "./FilterBar";

export type TabId = "all" | "lists" | "runs" | "activity";

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "All leads" },
  { id: "lists", label: "Lists" },
  { id: "runs", label: "Search runs" },
  { id: "activity", label: "Activity" },
];

const FIT_OPTIONS: [string, string][] = [
  ["strong", "Strong fit"],
  ["good", "Good fit"],
  ["soft", "Soft fit"],
  ["poor", "Poor fit"],
];

interface Props {
  tab: TabId;
  onTab: (t: TabId) => void;
  rows: LeadRow[];
  filters: Filters;
  onFilters: (f: Filters) => void;
  onSaveView: () => void;
}

export function Toolbar({ tab, onTab, rows, filters, onFilters, onSaveView }: Props) {
  const industries = Array.from(new Set(rows.map((r) => r.industry).filter((v): v is string => !!v))).sort();
  const sources = Array.from(new Set(rows.map((r) => r.strongestSource?.discoveryMethod).filter((v): v is string => !!v))).sort();
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onFilters({ ...filters, [k]: v });

  const chips: { key: keyof Filters; label: string }[] = [];
  if (filters.account !== "any") chips.push({ key: "account", label: ACCOUNT_STATUS_LABEL[filters.account as never] ?? String(filters.account) });
  if (filters.readiness !== "any") chips.push({ key: "readiness", label: CONTACT_READINESS_LABEL[filters.readiness as never] ?? String(filters.readiness) });
  if (filters.industry !== "any") chips.push({ key: "industry", label: String(filters.industry) });
  if (filters.discoveryMethod !== "any") chips.push({ key: "discoveryMethod", label: String(filters.discoveryMethod) });
  const hasActive = chips.length > 0 || !!filters.q;

  return (
    <div className="space-y-2">
      {/* Row 1: tabs + save view */}
      <div className="flex items-center justify-between">
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
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
          onClick={onSaveView}
        >
          Save view
        </Button>
      </div>

      {/* Row 2: search + filters */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
          <Input
            value={filters.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Search company, buyer, signal…"
            className="h-8 pl-8 bg-black/25 border-white/10 focus-visible:ring-primary/30 text-xs"
          />
        </div>
        <FilterSelect value={filters.account} onChange={(v) => set("account", v)} label="Any status" options={Object.entries(ACCOUNT_STATUS_LABEL)} />
        <FilterSelect value={filters.readiness} onChange={(v) => set("readiness", v)} label="Any readiness" options={Object.entries(CONTACT_READINESS_LABEL)} />
        <FilterSelect value={String((filters as unknown as { fit?: string }).fit ?? "any")} onChange={() => undefined} label="Any fit" options={FIT_OPTIONS} disabled />
        <FilterSelect value={filters.industry} onChange={(v) => set("industry", v)} label="Any industry" options={industries.map((i) => [i, i])} />
        <FilterSelect value={filters.discoveryMethod} onChange={(v) => set("discoveryMethod", v)} label="Any source" options={sources.map((s) => [s, s])} />
        <Button
          size="sm"
          variant="ghost"
          disabled={!hasActive}
          className="h-8 px-2 text-[11.5px] text-muted-foreground hover:text-foreground hover:bg-white/[0.04] disabled:opacity-40"
          onClick={() => onFilters(EMPTY_FILTERS)}
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
  value, onChange, label, options, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: [string, string][];
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-8 w-[130px] bg-black/25 border-white/10 text-[11.5px] hover:bg-white/[0.03]">
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
