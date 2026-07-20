import { cn } from "@/lib/utils";
import type { LeadRow } from "@/lib/leadLibrary/types";

export type MetricKey =
  | "all"
  | "qualified"
  | "contact_ready"
  | "draft_ready"
  | "contacted"
  | "replied"
  | "meetings";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "all", label: "All leads" },
  { key: "qualified", label: "Qualified" },
  { key: "contact_ready", label: "Contact-ready" },
  { key: "draft_ready", label: "Draft-ready" },
  { key: "contacted", label: "Contacted" },
  { key: "replied", label: "Replied" },
  { key: "meetings", label: "Meetings" },
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
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
      {METRICS.map((m) => {
        const count = computeMetric(rows, m.key);
        const isActive = active === m.key;
        return (
          <button
            key={m.key}
            onClick={() => onSelect(m.key)}
            className={cn(
              "group flex-shrink-0 rounded-lg border px-3 py-2 text-left transition-all",
              "bg-card/40 backdrop-blur-sm hover:bg-card/60",
              isActive
                ? "border-primary/50 shadow-[0_0_0_1px_rgba(16,185,129,0.2)]"
                : "border-border/60",
            )}
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {m.label}
            </div>
            <div
              className={cn(
                "mt-0.5 text-lg font-semibold tabular-nums",
                isActive ? "text-primary" : "text-foreground",
              )}
            >
              {count}
            </div>
          </button>
        );
      })}
    </div>
  );
}
