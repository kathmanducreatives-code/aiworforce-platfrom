import { useNavigate } from "react-router-dom";
import { Inbox, Mail, Eye, Sparkles, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { DashboardMetrics } from "./MetricsGrid";

interface Item {
  icon: ReactNode;
  title: string;
  to: string;
  tone?: "amber" | "emerald" | "blue" | "primary";
}

const toneClass: Record<NonNullable<Item["tone"]>, string> = {
  amber: "bg-amber-500/10 text-amber-400",
  emerald: "bg-primary/10 text-primary",
  blue: "bg-blue-500/10 text-blue-400",
  primary: "bg-primary/10 text-primary",
};

export default function NeedsAttentionPanel({
  m,
  brainIncomplete,
}: {
  m: DashboardMetrics;
  brainIncomplete: boolean;
}) {
  const navigate = useNavigate();
  const items: Item[] = [];

  if (m.pendingApprovals > 0) {
    items.push({
      icon: <Inbox className="h-4 w-4" />,
      title: `${m.pendingApprovals} item${m.pendingApprovals === 1 ? "" : "s"} awaiting approval`,
      to: "/awaiting-you",
      tone: "amber",
    });
  }
  if (m.outreachDrafts > 0) {
    items.push({
      icon: <Mail className="h-4 w-4" />,
      title: `${m.outreachDrafts} draft${m.outreachDrafts === 1 ? "" : "s"} ready`,
      to: "/content",
      tone: "emerald",
    });
  }
  if (brainIncomplete) {
    items.push({
      icon: <Sparkles className="h-4 w-4" />,
      title: "Company Brain incomplete",
      to: "/onboarding/company-brain",
      tone: "primary",
    });
  }
  items.push({
    icon: <Eye className="h-4 w-4" />,
    title:
      m.competitorSignals > 0
        ? `${m.competitorSignals} competitor signal${m.competitorSignals === 1 ? "" : "s"} to review`
        : "0 high-priority competitor signals",
    to: "/competitors",
    tone: "blue",
  });

  return (
    <div className="rounded-2xl border border-border bg-card/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-400/80 mb-1">
            Queue
          </div>
          <h3 className="text-sm font-semibold text-foreground">What needs attention</h3>
        </div>
      </div>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <button
            key={i}
            onClick={() => navigate(it.to)}
            className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/40 transition-colors text-left"
          >
            <div className={"p-2 rounded-lg " + toneClass[it.tone ?? "primary"]}>{it.icon}</div>
            <p className="flex-1 text-sm font-medium text-foreground">{it.title}</p>
            <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
          </button>
        ))}
      </div>
    </div>
  );
}
