// Shared presentational bits for source-specific radar cards: the decision badge
// and the gated action bar. The action bar is driven by radarActions, so
// "Draft outreach" only ever renders when the backend gate allows it.
import { ExternalLink } from "lucide-react";
import { allowedRadarActions, ACTION_LABEL, type SignalActionState, type RadarActionKey } from "@/lib/radarActions";
import { DECISION_LABEL, type CanonicalDecision } from "@/lib/radarCardPresenter";

const DECISION_STYLE: Record<string, string> = {
  contact: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  watch: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  needs_review: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  skip: "border-white/10 bg-white/[0.03] text-neutral-400",
};

export function DecisionBadge({ decision }: { decision: CanonicalDecision }) {
  return (
    <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-md border ${DECISION_STYLE[decision] ?? DECISION_STYLE.needs_review}`}>
      {DECISION_LABEL[decision]}
    </span>
  );
}

export function EvidenceLink({ url, label = "Open evidence" }: { url: string | null; label?: string }) {
  if (!url) return <span className="text-[12px] text-amber-300">Verify source — no evidence URL</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
      <ExternalLink className="h-3.5 w-3.5" /> {label}
    </a>
  );
}

export function RadarActionBar({ state, onAction }: { state: SignalActionState; onAction?: (a: RadarActionKey) => void }) {
  const actions = allowedRadarActions(state);
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-3">
      {actions.map((a) => (
        <button
          key={a}
          onClick={() => onAction?.(a)}
          className={`text-[12px] font-semibold px-2.5 py-1 rounded-md border transition ${a === "draft_outreach" ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20" : "border-border bg-background/50 text-foreground/90 hover:bg-muted/40"}`}
        >
          {ACTION_LABEL[a]}
        </button>
      ))}
    </div>
  );
}

/** Build the action state from an enriched raw signal. */
export function actionStateFromRaw(args: {
  decision: CanonicalDecision; raw: Record<string, unknown>; hasCompany: boolean; hasEvidence: boolean;
}): SignalActionState {
  return {
    decision: args.decision,
    can_draft_outreach: !!args.raw["can_draft_outreach"],
    has_company: args.hasCompany,
    has_evidence: args.hasEvidence,
    has_decision_maker: !!args.raw["decision_maker_present"],
    is_person_only: !!args.raw["is_person_only"] || !!args.raw["excluded_from_verified"],
  };
}
