import { cn } from "@/lib/utils";
import type { LeadRow } from "@/lib/leadLibrary/types";
import { edgeHighlight, glassActive, glassSurface } from "./premium/tokens";

export type MetricKey =
  | "all"
  | "qualified"
  | "contact_ready"
  | "draft_ready"
  | "contacted"
  | "replied"
  | "meetings";

const METRICS: { key: MetricKey; label: string; sub: string }[] = [
  { key: "all", label: "All leads", sub: "In library" },
  { key: "qualified", label: "Qualified", sub: "By Atlas" },
  { key: "contact_ready", label: "Contact-ready", sub: "Verified buyer" },
  { key: "draft_ready", label: "Draft-ready", sub: "Opener drafted" },
  { key: "contacted", label: "Contacted", sub: "Outreach sent" },
  { key: "replied", label: "Replied", sub: "Active thread" },
  { key: "meetings", label: "Meetings", sub: "Booked" },
];

export function computeMetric(rows: LeadRow[], key: MetricKey): number {
  switch (key) {
    case "all": return rows.length;
    case "qualified": return rows.filter((r) => r.accountStatus === "qualified").length;
    case "contact_ready": return rows.filter((r) => r.contactReadiness === "verified").length;
    case "draft_ready": return rows.filter((r) => r.opener?.status === "draft_ready" || r.opener?.status === "approved").length;
    case "contacted": return rows.filter((r) => r.engagementStatus === "contacted").length;
    case "replied": return rows.filter((r) => r.engagementStatus === "replied").length;
    case "meetings": return rows.filter((r) => r.engagementStatus === "meeting").length;
  }
}

export function MetricStrip({
  rows,
  active,
  onSelect,
}: {
  rows: LeadRow[];
  active: MetricKey;
  onSelect: (k: MetricKey) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
      {METRICS.map((m) => {
        const count = computeMetric(rows, m.key);
        const isActive = active === m.key;
        return (
          <button
            key={m.key}
            onClick={() => onSelect(m.key)}
            className={cn(
              "group relative rounded-xl px-3.5 py-3 text-left transition-all",
              "hover:-translate-y-0.5 hover:border-white/[0.12]",
              glassSurface,
              edgeHighlight,
              isActive && glassActive,
            )}
          >
            <div className="relative z-[1]">
              <div className={cn(
                "text-[10px] uppercase tracking-[0.14em] font-medium",
                isActive ? "text-primary/90" : "text-muted-foreground",
              )}>
                {m.label}
              </div>
              <div
                className={cn(
                  "mt-1.5 text-[22px] font-semibold tabular-nums leading-none",
                  isActive ? "text-primary" : "text-foreground",
                )}
              >
                {count}
              </div>
              <div className="mt-1.5 text-[10.5px] text-muted-foreground/80">
                {m.sub}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
