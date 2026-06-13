import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import AgentAvatar from "@/components/agents/AgentAvatar";
import type { DashboardMetrics } from "./MetricsGrid";

interface Row {
  name: string;
  activity: string;
  to?: string;
}

export default function WorkforceActivityPanel({ m }: { m: DashboardMetrics }) {
  const navigate = useNavigate();
  const rows: Row[] = [
    { name: "Scout",  activity: m.signalsFound      ? `Found ${m.signalsFound} signals`                : "Waiting for first workflow.", to: "/signals" },
    { name: "Aria",   activity: m.savedActioned     ? `Ranked ${m.savedActioned} opportunities`        : "Waiting for first workflow.", to: "/signals" },
    { name: "Hawk",   activity: m.competitorSignals ? `Tracked ${m.competitorSignals} competitor signals` : "Waiting for first workflow.", to: "/competitors" },
    { name: "Penn",   activity: m.outreachDrafts    ? `Prepared ${m.outreachDrafts} outreach drafts`   : "Waiting for first workflow.", to: "/content" },
    { name: "Scribe", activity: m.contentDrafts     ? `Saved ${m.contentDrafts} content drafts`        : "Waiting for first workflow.", to: "/content" },
    { name: "Pilot",  activity: "Coordinating your workflows", to: "/agents" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/80 mb-1">
            Live
          </div>
          <h3 className="text-sm font-semibold text-foreground">AI Workforce Activity</h3>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          Active
        </span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <button
            key={r.name}
            onClick={() => r.to && navigate(r.to)}
            className="group w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl hover:bg-muted/40 transition-colors text-left"
          >
            <AgentAvatar agentName={r.name} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground">{r.name}</div>
              <div className="text-[12px] text-muted-foreground truncate">{r.activity}</div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
