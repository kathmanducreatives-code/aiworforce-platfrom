import { Sparkles, Radar, ShieldCheck, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassPanel } from "./GlassPanel";
import atlasPortrait from "@/assets/atlas-portrait.png";
import type { LeadRow } from "@/lib/leadLibrary/types";

const CAPABILITIES = [
  { icon: Radar, label: "Research" },
  { icon: ShieldCheck, label: "Qualification" },
  { icon: TrendingUp, label: "Ranking" },
  { icon: Sparkles, label: "Signals" },
];

export function AtlasPanel({ rows, className }: { rows: LeadRow[]; className?: string }) {
  const indexed = rows.length;
  const draftsReady = rows.filter(
    (r) => r.opener?.status === "draft_ready" || r.opener?.status === "approved",
  ).length;
  const contacted = rows.filter(
    (r) =>
      r.engagementStatus === "contacted" ||
      r.engagementStatus === "replied" ||
      r.engagementStatus === "meeting",
  ).length;

  return (
    <GlassPanel raised className={cn("min-w-0", className)}>
      <div className="flex items-stretch gap-4 p-4 lg:p-5">
        <div className="relative shrink-0">
          <div className="h-20 w-20 rounded-xl overflow-hidden ring-1 ring-white/10 shadow-[0_10px_40px_-15px_rgba(16,185,129,0.6)]">
            <img
              src={atlasPortrait}
              alt="Atlas — AI Account Analyst"
              className="h-full w-full object-cover"
            />
          </div>
          <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-[#050706]" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-primary/80 font-medium">
              AI Employee
            </span>
            <span className="text-[10px] text-emerald-300/80 font-medium">
              · On duty
            </span>
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <h3 className="text-[17px] font-semibold text-foreground tracking-tight">
              Atlas
            </h3>
            <span className="text-[12px] text-muted-foreground">
              AI Account Analyst
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground line-clamp-2">
            Researches every account, verifies fit, and ranks the best opportunities for you to work.
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {CAPABILITIES.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10.5px] text-foreground/80"
              >
                <Icon className="h-3 w-3 text-primary/80" />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 border-t border-white/[0.06] bg-black/20 divide-x divide-white/[0.05]">
        <AtlasStat label="Indexed" value={indexed} />
        <AtlasStat label="Drafts ready" value={draftsReady} accent />
        <AtlasStat label="Contacted" value={contacted} />
      </div>
    </GlassPanel>
  );
}

function AtlasStat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="px-3 py-2.5 text-center">
      <div
        className={cn(
          "text-[18px] font-semibold tabular-nums leading-none",
          accent ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
