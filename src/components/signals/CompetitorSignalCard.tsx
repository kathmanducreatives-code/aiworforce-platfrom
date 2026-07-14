// Competitor card. Shows the class (direct/adjacent/replacement) + detected change.
import { competitorCardVM, type RawSignal } from "@/lib/radarCardPresenter";
import { DecisionBadge, EvidenceLink, RadarActionBar, actionStateFromRaw } from "./radarCardBits";

const CLASS_STYLE: Record<string, string> = {
  direct: "border-rose-500/30 text-rose-300",
  adjacent: "border-amber-500/30 text-amber-300",
  replacement: "border-sky-500/30 text-sky-300",
};

export default function CompetitorSignalCard({ signal }: { signal: RawSignal }) {
  const vm = competitorCardVM(signal);
  const state = actionStateFromRaw({ decision: vm.decision, raw: signal.raw ?? {}, hasCompany: !!vm.competitor, hasEvidence: !!vm.evidence_url });
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-foreground">{vm.competitor ?? "Competitor"}</p>
          {vm.change && <p className="text-[13px] text-muted-foreground mt-1">{vm.change}</p>}
        </div>
        <DecisionBadge decision={vm.decision} />
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
        {vm.competitor_class && <span className={`inline-flex items-center rounded-full border px-2 py-0.5 ${CLASS_STYLE[vm.competitor_class] ?? "border-border text-muted-foreground"}`}>{vm.competitor_class}</span>}
      </div>
      {vm.implication && <p className="text-[12px] text-muted-foreground mt-2">{vm.implication}</p>}
      <div className="mt-2"><EvidenceLink url={vm.evidence_url} /></div>
      <RadarActionBar state={state} />
    </div>
  );
}
