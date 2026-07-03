// Per-category radar summary cards. Larger typography + provider-aware states.
import { Briefcase, MessageSquare, Swords, Sparkles, ChevronRight, Settings2 } from "lucide-react";
import type { RadarCategory, CategoryStatus } from "@/hooks/useSignalFeed";
import ProviderBadge, { classifyProviderState } from "./ProviderBadge";
import { Link } from "react-router-dom";

const META: Record<RadarCategory, { label: string; icon: any; tint: string; provider: string; blurb: string }> = {
  hiring: { label: "Hiring signals", icon: Briefcase, tint: "emerald", provider: "Firecrawl · Jobs", blurb: "Founder-support and ops hiring." },
  linkedin_intent: { label: "LinkedIn intent", icon: MessageSquare, tint: "sky", provider: "Firecrawl / Apify · LinkedIn", blurb: "Buyer conversations and pain posts." },
  competitor: { label: "Competitor conversations", icon: Swords, tint: "amber", provider: "Firecrawl · Comments", blurb: "Alternative / comparison threads." },
  workflow_trend: { label: "Workflow trends", icon: Sparkles, tint: "violet", provider: "Firecrawl · Web", blurb: "AI-workflow patterns and tutorials." },
  people: { label: "People / profiles", icon: Sparkles, tint: "rose", provider: "Apify · People", blurb: "Decision-maker profiles." },
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
  verifiedCounts: Record<RadarCategory, number>;
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

const CATEGORIES: RadarCategory[] = ["hiring", "linkedin_intent", "competitor", "workflow_trend", "people"];

export default function RadarSummaryCards({ counts, verifiedCounts, status, topKeywords, lastScanAt, onScanCategory }: RadarSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
      {CATEGORIES.map((cat) => {
        const m = META[cat];
        const Icon = m.icon;
        const s = status?.[cat];
        const providerState = classifyProviderState({ ready: s?.status === "ready", reason: s?.reason });
        const detected = counts[cat] ?? 0;
        const verified = verifiedCounts[cat] ?? 0;
        const unverified = Math.max(detected - verified, 0);
        const blocked = providerState !== "ready";

        return (
          <div
            key={cat}
            className={`group text-left rounded-xl border p-4 transition-all ${TINTS[m.tint]}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className={`p-2 rounded-lg bg-white/[0.04] ${ICON_TINT[m.tint]}`}>
                <Icon className="h-5 w-5" />
              </div>
              <ProviderBadge state={providerState} />
            </div>

            <div className="mt-3">
              <div className="text-[13px] font-medium text-neutral-300">{m.label}</div>
              <div className="text-[34px] leading-none font-bold text-[#F0F6FC] mt-2 tracking-tight">{detected}</div>
              <div className="text-[12px] text-neutral-500 mt-1">
                <span className="text-emerald-300">{verified} verified</span>
                <span className="text-neutral-600"> · </span>
                <span className="text-amber-300/80">{unverified} need verification</span>
              </div>
            </div>

            <div className="mt-3 text-[12px] text-neutral-500 space-y-0.5">
              <div>Provider: <span className="text-neutral-300">{m.provider}</span></div>
              <div>Last scan: <span className="text-neutral-300">{timeAgo(lastScanAt)}</span></div>
              {topKeywords[cat] && (
                <div className="truncate">Top: <span className="text-neutral-300">{topKeywords[cat]}</span></div>
              )}
            </div>

            {blocked && s?.reason && (
              <div className="mt-2 text-[12px] text-amber-200/80 line-clamp-2">{s.reason}</div>
            )}

            <div className="mt-3">
              {blocked ? (
                <Link
                  to="/settings/integrations"
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-neutral-300 hover:text-emerald-300 transition-colors"
                >
                  <Settings2 className="h-3.5 w-3.5" /> Open integrations
                </Link>
              ) : (
                <button
                  onClick={() => onScanCategory(cat)}
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-300 hover:text-emerald-200 transition-colors"
                >
                  Scan now <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
