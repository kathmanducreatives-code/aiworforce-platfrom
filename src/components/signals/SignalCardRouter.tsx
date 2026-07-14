// Routes a signal to its source-specific card. Falls back to the generic
// SignalCard for legacy/unknown types so nothing renders blank.
import type { RawSignal } from "@/lib/radarCardPresenter";
import HiringSignalCard from "./HiringSignalCard";
import LinkedInPostSignalCard from "./LinkedInPostSignalCard";
import LinkedInCommentSignalCard from "./LinkedInCommentSignalCard";
import CompetitorSignalCard from "./CompetitorSignalCard";
import FundingSignalCard from "./FundingSignalCard";
import WorkflowTrendSignalCard from "./WorkflowTrendSignalCard";
import DecisionMakerSignalCard from "./DecisionMakerSignalCard";

/** Map a raw signal_type to the source-specific card key. */
export function cardKindFor(signalType: string | null | undefined): string {
  const t = (signalType ?? "").toLowerCase();
  if (t === "hiring" || t === "hiring_signal") return "hiring";
  if (t === "funding") return "funding";
  if (t === "competitor" || t === "competitor_engagement") return "competitor";
  if (t === "workflow_trend") return "workflow_trend";
  if (t === "linkedin_post" || t === "linkedin_intent" || t === "linkedin_engagement") return "linkedin_post";
  if (t === "linkedin_comment" || t === "comments") return "linkedin_comment";
  if (t === "people_profile" || t === "people" || t === "decision_maker") return "decision_maker";
  return "generic";
}

export default function SignalCardRouter({ signal, fallback }: { signal: RawSignal; fallback?: React.ReactNode }) {
  switch (cardKindFor(signal.signal_type)) {
    case "hiring": return <HiringSignalCard signal={signal} />;
    case "funding": return <FundingSignalCard signal={signal} />;
    case "competitor": return <CompetitorSignalCard signal={signal} />;
    case "workflow_trend": return <WorkflowTrendSignalCard signal={signal} />;
    case "linkedin_post": return <LinkedInPostSignalCard signal={signal} />;
    case "linkedin_comment": return <LinkedInCommentSignalCard signal={signal} />;
    case "decision_maker": return <DecisionMakerSignalCard signal={signal} />;
    default: return <>{fallback ?? null}</>;
  }
}
