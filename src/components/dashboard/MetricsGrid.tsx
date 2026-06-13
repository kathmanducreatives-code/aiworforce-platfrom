import { useNavigate } from "react-router-dom";
import {
  Radar, Users, Inbox, Mail, Eye, FileEdit, Bookmark, Clock, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

export interface DashboardMetrics {
  signalsFound: number;
  hotLeads: number;
  pendingApprovals: number;
  outreachDrafts: number;
  competitorSignals: number;
  contentDrafts: number;
  savedActioned: number;
  timeSavedMin: number;
}

interface CardProps {
  label: string;
  value: string | number;
  sub: string;
  icon: ReactNode;
  to?: string;
  emphasized?: "amber" | "emerald";
}

function Card({ label, value, sub, icon, to, emphasized }: CardProps) {
  const navigate = useNavigate();
  const interactive = !!to;
  return (
    <button
      type="button"
      onClick={() => to && navigate(to)}
      disabled={!interactive}
      className={cn(
        "group text-left rounded-2xl border bg-card/70 p-5 transition-all",
        "border-border-subtle hover:border-border",
        interactive && "hover:bg-card hover:-translate-y-[1px]",
        emphasized === "amber" && "ring-1 ring-amber-500/40 border-amber-500/30 bg-amber-500/[0.04]",
        emphasized === "emerald" && "ring-1 ring-primary/40 border-primary/30 bg-primary/[0.04]",
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="w-7 h-7 rounded-full flex items-center justify-center bg-white/[0.04]">
          {icon}
        </div>
      </div>
      <div className="text-[32px] leading-none font-semibold tracking-tight tabular-nums text-foreground">
        {value}
      </div>
      <div className="flex items-center justify-between mt-3">
        <span className="text-[12px] text-muted-foreground">{sub}</span>
        {interactive && (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
        )}
      </div>
    </button>
  );
}

export default function MetricsGrid({ m }: { m: DashboardMetrics }) {
  return (
    <div className="space-y-4 mb-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          label="Signals found"
          value={m.signalsFound}
          sub={`${m.signalsFound} saved signals`}
          icon={<Radar className="h-3.5 w-3.5 text-emerald-400" />}
          to="/signals"
        />
        <Card
          label="Hot leads"
          value={m.hotLeads}
          sub={`${m.hotLeads} marked hot`}
          icon={<Users className="h-3.5 w-3.5 text-amber-400" />}
          to="/signals?filter=hot"
        />
        <Card
          label="Approvals pending"
          value={m.pendingApprovals}
          sub={`${m.pendingApprovals} need your review`}
          icon={<Inbox className="h-3.5 w-3.5 text-amber-400" />}
          to="/awaiting-you"
          emphasized={m.pendingApprovals > 0 ? "amber" : undefined}
        />
        <Card
          label="Drafts ready"
          value={m.outreachDrafts}
          sub={`${m.outreachDrafts} outreach drafts`}
          icon={<Mail className="h-3.5 w-3.5 text-teal-400" />}
          to="/content"
          emphasized={m.outreachDrafts > 0 ? "emerald" : undefined}
        />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          label="Competitor signals"
          value={m.competitorSignals}
          sub={`${m.competitorSignals} new this week`}
          icon={<Eye className="h-3.5 w-3.5 text-blue-400" />}
          to="/competitors"
        />
        <Card
          label="Content drafts"
          value={m.contentDrafts}
          sub={`${m.contentDrafts} saved drafts`}
          icon={<FileEdit className="h-3.5 w-3.5 text-violet-400" />}
          to="/content"
        />
        <Card
          label="Saved / actioned"
          value={m.savedActioned}
          sub={`${m.savedActioned} signals worked`}
          icon={<Bookmark className="h-3.5 w-3.5 text-emerald-400" />}
          to="/signals"
        />
        <Card
          label="Time saved"
          value={`${m.timeSavedMin}m`}
          sub="estimate this week"
          icon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />}
        />
      </div>
    </div>
  );
}
