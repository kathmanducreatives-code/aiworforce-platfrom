// LinkedIn post card. Shows engagement ONLY when the row carries a real class —
// never fabricates "viral".
import { postCardVM, type RawSignal } from "@/lib/radarCardPresenter";
import { DecisionBadge, EvidenceLink, RadarActionBar, actionStateFromRaw } from "./radarCardBits";

export default function LinkedInPostSignalCard({ signal }: { signal: RawSignal }) {
  const vm = postCardVM(signal);
  const state = actionStateFromRaw({ decision: vm.decision, raw: signal.raw ?? {}, hasCompany: !!vm.company, hasEvidence: !!vm.evidence_url });
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-foreground">{vm.author ?? "Author"}{vm.company ? ` · ${vm.company}` : ""}</p>
          {vm.excerpt && <p className="text-[13px] text-muted-foreground mt-1 line-clamp-3">{vm.excerpt}</p>}
        </div>
        <DecisionBadge decision={vm.decision} />
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-muted-foreground">
        {vm.topic && <span className="inline-flex items-center rounded-full border border-border/70 px-2 py-0.5">{vm.topic}</span>}
        {vm.engagement_label && <span className="inline-flex items-center rounded-full border border-sky-500/30 text-sky-300 px-2 py-0.5">{vm.engagement_label}</span>}
      </div>
      {vm.why && <p className="text-[12px] text-muted-foreground mt-2">{vm.why}</p>}
      <div className="mt-2"><EvidenceLink url={vm.evidence_url} label="Open post" /></div>
      <RadarActionBar state={state} />
    </div>
  );
}
