// Honest per-source readiness strip for the Scout Radar. Reflects real provider
// state (Firecrawl / Apify) via the pure radarSources registry — no fabrication,
// no provider calls. Hover shows the capability-specific reason.
import { computeSourceStatuses, type SourceState } from "@/lib/radarSources";

const STATE_STYLE: Record<SourceState, { label: string; className: string }> = {
  ready:        { label: "Ready", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  ready_basic:  { label: "Basic", className: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  setup_needed: { label: "Setup", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  flag_off:     { label: "Off",   className: "border-white/10 bg-white/[0.03] text-neutral-500" },
};

export default function RadarSourceStatus({
  firecrawlReady,
  apifyReady,
}: {
  firecrawlReady: boolean;
  apifyReady: boolean;
}) {
  const statuses = computeSourceStatuses({ firecrawlReady, apifyReady });
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Radar source readiness">
      {statuses.map((s) => {
        const st = STATE_STYLE[s.state];
        return (
          <span
            key={s.key}
            title={s.reason}
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${st.className}`}
          >
            <span className="font-medium">{s.label}</span>
            <span className="opacity-70">· {st.label}</span>
          </span>
        );
      })}
    </div>
  );
}
