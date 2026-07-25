import { PUBLIC_AGENTS } from "@/config/agentRegistry";
import type { LeadRow } from "@/lib/leadLibrary/types";
import { cn } from "@/lib/utils";

interface Props {
  rows: LeadRow[];
  className?: string;
}

export function AtlasStrip({ rows, className }: Props) {
  const atlas = PUBLIC_AGENTS.atlas;
  const indexed = rows.length;
  const draftsReady = rows.filter(
    (r) => r.opener?.status === "draft_ready" || r.opener?.status === "approved",
  ).length;

  return (
    <div
      className={cn(
        "flex items-center gap-3 h-[72px] px-3.5 rounded-xl",
        "bg-[rgba(12,16,15,0.6)] backdrop-blur-xl border border-white/[0.06]",
        "max-w-[420px]",
        className,
      )}
    >
      <div className="relative shrink-0">
        <div className="h-11 w-11 rounded-lg overflow-hidden ring-1 ring-white/10">
          <img src={atlas.avatar} alt={`${atlas.name} — ${atlas.title}`} className="h-full w-full object-cover" />
        </div>
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0b0d0c]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13px] font-semibold text-foreground">{atlas.name}</span>
          <span className="text-[11px] text-muted-foreground truncate">· {atlas.title}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          <span className="text-foreground/90 font-medium">{indexed}</span> accounts indexed
          <span className="mx-1.5 text-white/15">·</span>
          <span className="text-foreground/90 font-medium">{draftsReady}</span> drafts ready
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-emerald-300/90">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
        On duty
      </div>
    </div>
  );
}
