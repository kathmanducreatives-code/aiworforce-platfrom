import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LeadRow } from "@/lib/leadLibrary/types";
import {
  ACCOUNT_STATUS_LABEL,
  CONTACT_READINESS_LABEL,
  OUTREACH_STATUS_LABEL,
  ENGAGEMENT_STATUS_LABEL,
} from "@/lib/leadLibrary/types";

export interface Filters {
  q: string;
  account: string | "any";
  readiness: string | "any";
  outreach: string | "any";
  engagement: string | "any";
  industry: string | "any";
  discoveryMethod: string | "any";
}

export const EMPTY_FILTERS: Filters = {
  q: "",
  account: "any",
  readiness: "any",
  outreach: "any",
  engagement: "any",
  industry: "any",
  discoveryMethod: "any",
};

export function applyFilters(rows: LeadRow[], f: Filters): LeadRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q) {
      const hay = [r.name, r.domain, r.industry, r.whySelected, r.selectedRecipient?.fullName]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.account !== "any" && r.accountStatus !== f.account) return false;
    if (f.readiness !== "any" && r.contactReadiness !== f.readiness) return false;
    if (f.outreach !== "any" && r.outreachStatus !== f.outreach) return false;
    if (f.engagement !== "any" && r.engagementStatus !== f.engagement) return false;
    if (f.industry !== "any" && r.industry !== f.industry) return false;
    if (f.discoveryMethod !== "any" && r.strongestSource?.discoveryMethod !== f.discoveryMethod) return false;
    return true;
  });
}

export function FilterBar({
  rows,
  filters,
  onChange,
  onSaveView,
}: {
  rows: LeadRow[];
  filters: Filters;
  onChange: (f: Filters) => void;
  onSaveView: () => void;
}) {
  const industries = Array.from(new Set(rows.map((r) => r.industry).filter((v): v is string => !!v))).sort();
  const methods = Array.from(new Set(rows.map((r) => r.strongestSource?.discoveryMethod).filter((v): v is string => !!v))).sort();

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...filters, [k]: v });

  const chips: { key: keyof Filters; label: string }[] = [];
  if (filters.account !== "any") chips.push({ key: "account", label: `Status · ${ACCOUNT_STATUS_LABEL[filters.account as never] ?? filters.account}` });
  if (filters.readiness !== "any") chips.push({ key: "readiness", label: `Readiness · ${CONTACT_READINESS_LABEL[filters.readiness as never] ?? filters.readiness}` });
  if (filters.outreach !== "any") chips.push({ key: "outreach", label: `Opener · ${OUTREACH_STATUS_LABEL[filters.outreach as never] ?? filters.outreach}` });
  if (filters.engagement !== "any") chips.push({ key: "engagement", label: `Engagement · ${ENGAGEMENT_STATUS_LABEL[filters.engagement as never] ?? filters.engagement}` });
  if (filters.industry !== "any") chips.push({ key: "industry", label: `Industry · ${filters.industry}` });
  if (filters.discoveryMethod !== "any") chips.push({ key: "discoveryMethod", label: `Source · ${filters.discoveryMethod}` });

  const hasActive = chips.length > 0 || !!filters.q;

  return (
    <div className="sticky top-0 z-10 rounded-2xl border border-white/[0.07] bg-[rgba(10,14,12,0.72)] backdrop-blur-2xl shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] px-4 py-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
          <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
            Refine lead view
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasActive && (
            <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => onChange(EMPTY_FILTERS)}>
              Clear all
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-[11px] border-white/10 bg-white/[0.03] hover:bg-white/[0.06]" onClick={onSaveView}>
            Save view
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filters.q}
          onChange={(e) => set("q", e.target.value)}
          placeholder="Search company, buyer, signal…"
          className="h-8 max-w-xs bg-black/30 border-white/10 focus-visible:ring-primary/40 text-xs"
        />
        <SmallSelect value={filters.account} onChange={(v) => set("account", v)} placeholder="Status" options={Object.entries(ACCOUNT_STATUS_LABEL)} />
        <SmallSelect value={filters.readiness} onChange={(v) => set("readiness", v)} placeholder="Readiness" options={Object.entries(CONTACT_READINESS_LABEL)} />
        <SmallSelect value={filters.outreach} onChange={(v) => set("outreach", v)} placeholder="Opener" options={Object.entries(OUTREACH_STATUS_LABEL)} />
        <SmallSelect value={filters.engagement} onChange={(v) => set("engagement", v)} placeholder="Engagement" options={Object.entries(ENGAGEMENT_STATUS_LABEL)} />
        <SmallSelect value={filters.industry} onChange={(v) => set("industry", v)} placeholder="Industry" options={industries.map((i) => [i, i])} />
        <SmallSelect value={filters.discoveryMethod} onChange={(v) => set("discoveryMethod", v)} placeholder="Discovery" options={methods.map((m) => [m, m])} />
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => set(c.key, "any" as never)}
              className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/20 transition-colors"
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

function SmallSelect({
  value, onChange, placeholder, options,
}: {
  value: string; onChange: (v: string) => void; placeholder: string; options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[130px] bg-black/30 border-white/10 text-xs hover:bg-white/[0.04]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="any">Any {placeholder.toLowerCase()}</SelectItem>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>{l}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
