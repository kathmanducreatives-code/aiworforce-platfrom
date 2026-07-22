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
  className,
}: {
  rows: LeadRow[];
  active: MetricKey;
  onSelect: (k: MetricKey) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-stretch h-[72px] rounded-xl overflow-hidden",
        "bg-[rgba(12,16,15,0.55)] backdrop-blur-xl border border-white/[0.06]",
        className,
      )}
    >
      {METRICS.map((m, i) => {
        const count = computeMetric(rows, m.key);
        const isActive = active === m.key;
        return (
          <button
            key={m.key}
            onClick={() => onSelect(m.key)}
            className={cn(
              "relative flex-1 min-w-0 px-3 flex flex-col justify-center gap-1 text-left transition-colors",
              "hover:bg-white/[0.02]",
              i !== 0 && "border-l border-white/[0.05]",
              isActive && "bg-[linear-gradient(180deg,rgba(16,185,129,0.09),transparent)]",
            )}
          >
            <div
              className={cn(
                "text-[10px] uppercase tracking-[0.14em] font-medium truncate",
                isActive ? "text-primary/90" : "text-muted-foreground",
              )}
            >
              {m.label}
            </div>
            <div
              className={cn(
                "text-[20px] font-semibold tabular-nums leading-none",
                isActive ? "text-primary" : "text-foreground",
              )}
            >
              {count}
            </div>
            {isActive && (
              <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-primary/80" />
            )}
          </button>
        );
      })}
    </div>
  );
}
