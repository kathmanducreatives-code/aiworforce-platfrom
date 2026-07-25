import { cn } from "@/lib/utils";
import type { LeadRow } from "@/lib/leadLibrary/types";
import {
  countByKey,
  deriveLeadDecisionState,
  type CounterKey,
  type LeadDecisionState,
} from "@/lib/leadLibrary/leadDecisionState";
import { useMemo } from "react";

// Kept for backwards compatibility with LeadLibrary.tsx.
export type MetricKey = CounterKey;

const METRICS: { key: CounterKey; label: string; help: string }[] = [
  { key: "all", label: "All leads", help: "Every account in the library." },
  { key: "qualified", label: "Qualified", help: "Passed the qualification threshold." },
  { key: "buyer_ready", label: "Buyer ready", help: "Qualified with a verified buyer." },
  { key: "draft_ready", label: "Draft ready", help: "Buyer-ready with a valid opener draft." },
  { key: "awaiting_approval", label: "Awaiting approval", help: "Draft is prepared and waiting on your approval." },
  { key: "contacted", label: "Contacted", help: "Outreach has been sent or logged." },
  { key: "replied", label: "Replied", help: "The buyer has replied." },
  { key: "meetings", label: "Meetings", help: "A meeting is booked or later." },
];

export function computeMetric(rows: LeadRow[], key: CounterKey): number {
  const states = rows.map(deriveLeadDecisionState);
  return countByKey(states, key);
}

export function MetricStrip({
  rows,
  active,
  onSelect,
  className,
}: {
  rows: LeadRow[];
  active: CounterKey;
  onSelect: (k: CounterKey) => void;
  className?: string;
}) {
  const states: LeadDecisionState[] = useMemo(() => rows.map(deriveLeadDecisionState), [rows]);

  return (
    <div
      className={cn(
        "flex items-stretch h-[72px] rounded-xl overflow-hidden",
        "bg-[rgba(12,16,15,0.55)] backdrop-blur-xl border border-white/[0.06]",
        className,
      )}
    >
      {METRICS.map((m, i) => {
        const count = countByKey(states, m.key);
        const isActive = active === m.key;
        return (
          <button
            key={m.key}
            title={m.help}
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
