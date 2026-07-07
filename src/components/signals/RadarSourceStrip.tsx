// Premium source-readiness strip. Reflects REAL provider state (Firecrawl/Apify)
// via the pure radarSources registry — never fakes an active source. Each tile
// shows a source, its state, and (on hover) the capability-specific reason.
import { Briefcase, Banknote, Swords, TrendingUp, MessagesSquare, MessageCircle } from "lucide-react";
import { computeSourceStatuses, type RadarSourceKey, type SourceState } from "@/lib/radarSources";

const ICONS: Record<RadarSourceKey, React.ComponentType<{ className?: string }>> = {
  hiring: Briefcase,
  funding: Banknote,
  competitor: Swords,
  workflow: TrendingUp,
  linkedin_posts: MessagesSquare,
  comments: MessageCircle,
  people: MessageCircle,
};

const STATE: Record<SourceState, { label: string; dot: string; text: string }> = {
  ready:        { label: "Ready", dot: "bg-emerald-400", text: "text-emerald-300" },
  ready_basic:  { label: "Basic", dot: "bg-sky-400", text: "text-sky-300" },
  setup_needed: { label: "Setup", dot: "bg-amber-400", text: "text-amber-300" },
  flag_off:     { label: "Off", dot: "bg-neutral-500", text: "text-neutral-500" },
};

// The six market-radar sources shown to the user (people is verified-workflow only).
const SHOWN: RadarSourceKey[] = ["hiring", "funding", "competitor", "workflow", "linkedin_posts", "comments"];

export default function RadarSourceStrip({
  firecrawlReady,
  apifyReady,
}: {
  firecrawlReady: boolean;
  apifyReady: boolean;
}) {
  const statuses = computeSourceStatuses({ firecrawlReady, apifyReady });
  const byKey = Object.fromEntries(statuses.map((s) => [s.key, s]));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {SHOWN.map((key) => {
        const s = byKey[key];
        if (!s) return null;
        const st = STATE[s.state];
        const Icon = ICONS[key];
        return (
          <div
            key={key}
            title={s.reason}
            className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 flex flex-col gap-1.5 hover:border-white/[0.12] transition-colors"
          >
            <div className="flex items-center gap-1.5 text-neutral-300">
              <Icon className="h-3.5 w-3.5 text-neutral-400" />
              <span className="text-[12px] font-medium truncate">{s.label}</span>
            </div>
            <div className={`inline-flex items-center gap-1.5 text-[11px] ${st.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
              {st.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
