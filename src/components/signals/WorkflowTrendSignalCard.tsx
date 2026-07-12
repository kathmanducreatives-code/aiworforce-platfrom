// Workflow-trend card. Shows maturity (emerging/established/speculative) + every
// supporting evidence URL.
import { trendCardVM, type RawSignal } from "@/lib/radarCardPresenter";
import { DecisionBadge, RadarActionBar, actionStateFromRaw } from "./radarCardBits";
import { ExternalLink } from "lucide-react";

export default function WorkflowTrendSignalCard({ signal }: { signal: RawSignal }) {
  const vm = trendCardVM(signal);
  const state = actionStateFromRaw({ decision: vm.decision, raw: signal.raw ?? {}, hasCompany: false, hasEvidence: vm.evidence_urls.length > 0 });
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-foreground">{vm.workflow ?? "Workflow trend"}</p>
          {vm.why && <p className="text-[13px] text-muted-foreground mt-1">{vm.why}</p>}
        </div>
        <DecisionBadge decision={vm.decision} />
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
        {vm.maturity && <span className="inline-flex items-center rounded-full border border-border/70 text-muted-foreground px-2 py-0.5">{vm.maturity}</span>}
      </div>
      {vm.evidence_urls.length > 0 && (
        <div className="flex flex-col gap-1 mt-2">
          {vm.evidence_urls.slice(0, 3).map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Source {i + 1}</a>
          ))}
        </div>
      )}
      <RadarActionBar state={state} />
    </div>
  );
}
