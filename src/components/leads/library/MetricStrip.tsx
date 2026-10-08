import { cn } from "@/lib/utils";
import type { LeadRow } from "@/lib/leadLibrary/types";
import {
  countByKey,
  deriveLeadDecisionState,
  type CounterKey,
  type LeadDecisionState,
} from "@/lib/leadLibrary/leadDecisionState";
import { useMemo } from "react";
import { METRIC_CELL, METRIC_DIVIDER, METRIC_LABEL, METRIC_STRIP, METRIC_STRIP_H, METRIC_VALUE } from "@/components/layout/workspaceStyles";

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
        METRIC_STRIP,
        METRIC_STRIP_H,
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
              METRIC_CELL,
              "relative px-3 text-left transition-colors hover:bg-white/[0.025]",
              i !== 0 && METRIC_DIVIDER,
              isActive && "bg-[linear-gradient(180deg,rgba(16,185,129,0.09),transparent)]",
            )}
          >
            <div
              className={cn(
                METRIC_LABEL,
                "truncate",
                isActive && "text-primary/90",
              )}
            >
              {m.label}
            </div>
            <div
              className={cn(
                METRIC_VALUE,
                isActive && "text-primary",
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
