// LinkedIn comment card. Requires + shows parent-post evidence; a generic
// compliment never reaches here (backend classifies intent).
import { commentCardVM, type RawSignal } from "@/lib/radarCardPresenter";
import { DecisionBadge, EvidenceLink, RadarActionBar, actionStateFromRaw } from "./radarCardBits";

export default function LinkedInCommentSignalCard({ signal }: { signal: RawSignal }) {
  const vm = commentCardVM(signal);
  const state = actionStateFromRaw({ decision: vm.decision, raw: signal.raw ?? {}, hasCompany: !!vm.company, hasEvidence: !!vm.parent_post_url });
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-foreground">{vm.commenter ?? "Commenter"}{vm.company ? ` · ${vm.company}` : ""}</p>
          {vm.comment && <p className="text-[13px] text-foreground/90 mt-1 italic">“{vm.comment}”</p>}
        </div>
        <DecisionBadge decision={vm.decision} />
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-muted-foreground">
        {vm.intent && <span className="inline-flex items-center rounded-full border border-emerald-500/30 text-emerald-300 px-2 py-0.5">{vm.intent.replace(/_/g, " ")}</span>}
      </div>
      {vm.why_now && <p className="text-[12px] text-muted-foreground mt-2">{vm.why_now}</p>}
      <div className="mt-2"><EvidenceLink url={vm.parent_post_url} label="Open parent post" /></div>
      <RadarActionBar state={state} />
    </div>
  );
}
