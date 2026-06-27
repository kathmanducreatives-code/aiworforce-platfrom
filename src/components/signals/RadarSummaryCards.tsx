// Per-category radar summary cards. Pure presentation, no data fetching.
import { Briefcase, MessageSquare, Swords, Sparkles, ChevronRight, AlertCircle, CheckCircle2 } from "lucide-react";
import type { RadarCategory, CategoryStatus } from "@/hooks/useSignalFeed";

const META: Record<RadarCategory, { label: string; icon: any; tint: string }> = {
  hiring: { label: "Hiring signals", icon: Briefcase, tint: "emerald" },
  linkedin_intent: { label: "LinkedIn intent", icon: MessageSquare, tint: "sky" },
  competitor: { label: "Competitor conversations", icon: Swords, tint: "amber" },
  workflow_trend: { label: "Workflow trends", icon: Sparkles, tint: "violet" },
  people: { label: "People / profiles", icon: Sparkles, tint: "rose" },
};

const TINTS: Record<string, string> = {
  emerald: "border-emerald-500/20 hover:border-emerald-500/40 bg-emerald-500/[0.03]",
  sky: "border-sky-500/20 hover:border-sky-500/40 bg-sky-500/[0.03]",
  amber: "border-amber-500/20 hover:border-amber-500/40 bg-amber-500/[0.03]",
  violet: "border-violet-500/20 hover:border-violet-500/40 bg-violet-500/[0.03]",
  rose: "border-rose-500/20 hover:border-rose-500/40 bg-rose-500/[0.03]",
};

const ICON_TINT: Record<string, string> = {
  emerald: "text-emerald-300", sky: "text-sky-300", amber: "text-amber-300", violet: "text-violet-300", rose: "text-rose-300",
};

export interface RadarSummaryCardsProps {
  counts: Record<RadarCategory, number>;
  status: Record<RadarCategory, CategoryStatus> | null;
  topKeywords: Partial<Record<RadarCategory, string>>;
  lastScanAt: string | null;
  onScanCategory: (c: RadarCategory) => void;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - Date.parse(iso);
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const CATEGORIES: RadarCategory[] = ["hiring", "linkedin_intent", "competitor", "workflow_trend"];

export default function RadarSummaryCards({ counts, status, topKeywords, lastScanAt, onScanCategory }: RadarSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {CATEGORIES.map((cat) => {
        const m = META[cat];
        const Icon = m.icon;
        const s = status?.[cat];
        const ready = !s || s.status === "ready";
        const setupNeeded = s?.status === "setup_needed";
        return (
          <button
            key={cat}
            onClick={() => onScanCategory(cat)}
            className={`group text-left rounded-xl border p-3.5 transition-all ${TINTS[m.tint]} hover:scale-[1.01]`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className={`p-2 rounded-lg bg-white/[0.04] ${ICON_TINT[m.tint]}`}>
                <Icon className="h-4 w-4" />
              </div>
              <ChevronRight className="h-4 w-4 text-neutral-600 group-hover:text-neutral-300 transition-colors" />
            </div>
            <div className="mt-2.5">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">{m.label}</div>
              <div className="text-2xl font-semibold text-[#F0F6FC] mt-0.5">{counts[cat] ?? 0}</div>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[10px]">
              {setupNeeded ? (
                <span className="inline-flex items-center gap-1 text-amber-300/90"><AlertCircle className="h-3 w-3" /> Setup needed</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-emerald-300/90"><CheckCircle2 className="h-3 w-3" /> Ready</span>
              )}
              <span className="text-neutral-600">·</span>
              <span className="text-neutral-500">{timeAgo(lastScanAt)}</span>
            </div>
            {topKeywords[cat] && (
              <div className="mt-1.5 text-[10px] text-neutral-500 truncate">
                Top: <span className="text-neutral-300">{topKeywords[cat]}</span>
              </div>
            )}
            {setupNeeded && s?.reason && (
              <div className="mt-1.5 text-[10px] text-neutral-500 line-clamp-2">{s.reason}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
