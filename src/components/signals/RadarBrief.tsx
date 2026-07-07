// Today's Radar Brief — the premium summary strip at the top of Scout Radar.
// Real data only: strongest signal type, count of useful (verified) signals, the
// single best recommended move, and honest source gaps. Empty state is honest.
import { Radar, Target, Zap, ShieldAlert, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deriveRadarBrief, type BriefSignal } from "@/lib/radarBrief";
import type { FeedSignal } from "@/lib/signalFeedModel";

function toBrief(s: FeedSignal): BriefSignal {
  return {
    signal_type: s.signal_type,
    title: s.title,
    score: Number((s.raw?.score as number) ?? s.fit_score ?? 0),
    verified: s.show_by_default,
    recommended_action: (s.raw?.recommended_action as string) ?? s.next_action ?? null,
    company: s.account_name ?? null,
  };
}

export default function RadarBrief({
  signals,
  missingSources,
  onRunRadar,
  scanning,
}: {
  signals: FeedSignal[];
  missingSources: string[];
  onRunRadar?: () => void;
  scanning?: boolean;
}) {
  const brief = deriveRadarBrief(signals.map(toBrief), missingSources);

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.03] to-transparent p-5 md:p-6">
      <div className="flex items-center gap-2 mb-4">
        <Radar className="h-4 w-4 text-emerald-300" />
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-neutral-400">Today's Radar Brief</h2>
      </div>

      {brief.isEmpty ? (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[17px] font-semibold text-[#F0F6FC]">No verified signals yet</div>
            <p className="text-[14px] text-neutral-400 mt-1 max-w-xl">
              Scout hasn't confirmed market signals for your ICP yet. Run a radar scan to surface hiring,
              funding, competitor and workflow signals with source proof.
            </p>
            {brief.missingSources.length > 0 && (
              <p className="text-[12px] text-amber-300/80 mt-2">
                Sources needing setup: {brief.missingSources.join(" · ")}
              </p>
            )}
          </div>
          {onRunRadar && (
            <Button onClick={onRunRadar} disabled={scanning} size="sm" className="shrink-0 h-9 text-[14px] font-semibold">
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />} Run radar scan
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <BriefCell icon={<Target className="h-4 w-4 text-emerald-300" />} label="Strongest signal">
            {brief.strongestType ? (
              <>
                <div className="text-[18px] font-semibold text-[#F0F6FC]">{brief.strongestType.label}</div>
                <div className="text-[12px] text-neutral-400 mt-0.5">
                  {brief.strongestType.count} verified · {brief.usefulCount} useful today
                </div>
              </>
            ) : <span className="text-neutral-500 text-[14px]">—</span>}
          </BriefCell>

          <BriefCell icon={<Zap className="h-4 w-4 text-emerald-300" />} label="Recommended move">
            {brief.topAction ? (
              <>
                <div className="text-[14px] font-medium text-[#F0F6FC] leading-snug line-clamp-2">
                  {brief.topAction.action}
                </div>
                <div className="text-[12px] text-neutral-400 mt-1 inline-flex items-center gap-1 truncate">
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  <span className="truncate">{brief.topAction.company ?? brief.topAction.title}</span>
                </div>
              </>
            ) : <span className="text-neutral-500 text-[14px]">Review your verified signals.</span>}
          </BriefCell>

          <BriefCell icon={<ShieldAlert className="h-4 w-4 text-amber-300" />} label="Source readiness">
            {brief.missingSources.length === 0 ? (
              <div className="text-[14px] text-emerald-300">All configured sources ready</div>
            ) : (
              <>
                <div className="text-[14px] text-amber-200/90">{brief.missingSources.length} source{brief.missingSources.length > 1 ? "s" : ""} need setup</div>
                <div className="text-[12px] text-neutral-400 mt-1 truncate">{brief.missingSources.join(" · ")}</div>
              </>
            )}
          </BriefCell>
        </div>
      )}
    </section>
  );
}

function BriefCell({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-neutral-500 mb-2">
        {icon} {label}
      </div>
      {children}
    </div>
  );
}
