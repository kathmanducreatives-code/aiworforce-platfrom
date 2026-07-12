// Funding card. Round/amount/date render ONLY when the row carries them — never
// fabricated. Funding alone is usually Watch.
import { fundingCardVM, type RawSignal } from "@/lib/radarCardPresenter";
import { DecisionBadge, EvidenceLink, RadarActionBar, actionStateFromRaw } from "./radarCardBits";

export default function FundingSignalCard({ signal }: { signal: RawSignal }) {
  const vm = fundingCardVM(signal);
  const state = actionStateFromRaw({ decision: vm.decision, raw: signal.raw ?? {}, hasCompany: !!vm.company, hasEvidence: !!vm.evidence_url });
  const facts = [vm.round, vm.amount, vm.announced_date].filter(Boolean) as string[];
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-foreground">{vm.company ?? "Company"}</p>
          {facts.length > 0 ? (
            <p className="text-[13px] text-muted-foreground mt-1">{facts.join(" · ")}</p>
          ) : (
            <p className="text-[12px] text-muted-foreground mt-1">Funding reported — round/amount not verified.</p>
          )}
        </div>
        <DecisionBadge decision={vm.decision} />
      </div>
      {vm.enables && <p className="text-[12px] text-muted-foreground mt-2">{vm.enables}</p>}
      <div className="mt-2"><EvidenceLink url={vm.evidence_url} label="Open announcement" /></div>
      <RadarActionBar state={state} />
    </div>
  );
}
