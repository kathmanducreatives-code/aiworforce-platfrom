// Pure content-operations helpers for the Scribe Command Center. Deno-testable,
// no React/network. Derives "Today's Content Brief", content opportunities from
// real signals, and draft-approval statuses — always approval-gated, never any
// auto-post language.

// ----------------------------------------------------------- content brief ---

export interface ContentBriefSignal {
  title: string;
  signal_type: string;
  score: number;
  company?: string | null;
  source_url?: string | null;
}

export interface ContentBrief {
  isEmpty: boolean;
  sourceSignal: { title: string; company: string | null; sourceUrl: string | null } | null;
  angle: string | null;
  direction: string | null;
  nextAction: string | null;
  draftsAwaiting: number;
}

function angleForType(type: string, company: string | null): string {
  switch (type) {
    case "funding":
      return "Congratulate + insight — what newly funded teams get wrong about early pipeline";
    case "hiring":
    case "hiring_signal":
      return "POV — hiring a first seller vs building a repeatable pipeline system";
    case "competitor":
    case "competitor_engagement":
      return `Contrarian take on ${company ?? "the competitor"}'s positioning`;
    case "workflow_trend":
      return "Practical breakdown of the workflow founders are adopting";
    default:
      return "Founder POV grounded in this signal";
  }
}

function directionForType(type: string): string {
  switch (type) {
    case "funding": return "Short founder POV tied to the raise — pipeline before headcount.";
    case "hiring":
    case "hiring_signal": return "Practical post: build the system before hiring the seller.";
    case "competitor":
    case "competitor_engagement": return "Position against the competitor's angle with evidence.";
    case "workflow_trend": return "Teach the workflow with a concrete example.";
    default: return "Turn this into a concise, evidence-backed founder post.";
  }
}

/** Summarize the best content angle from real verified signals. */
export function deriveContentBrief(signals: ContentBriefSignal[], draftsAwaiting = 0): ContentBrief {
  const ranked = [...signals].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) {
    return {
      isEmpty: true,
      sourceSignal: null,
      angle: null,
      direction: null,
      nextAction: draftsAwaiting > 0 ? `Review ${draftsAwaiting} draft${draftsAwaiting > 1 ? "s" : ""} awaiting approval` : null,
      draftsAwaiting,
    };
  }
  const company = best.company ?? null;
  return {
    isEmpty: false,
    sourceSignal: { title: best.title, company, sourceUrl: best.source_url ?? null },
    angle: angleForType(best.signal_type, company),
    direction: directionForType(best.signal_type),
    nextAction: "Turn this signal into a founder post draft (review before publishing)",
    draftsAwaiting,
  };
}

// -------------------------------------------------------- content opportunity ---

export interface ContentOpportunity {
  sourceTitle: string;
  sourceUrl: string | null;
  company: string | null;
  angle: string;
  targetReader: string;
  hook: string;
  format: string;
  cta: string;
}

export function contentOpportunityFromSignal(signal: ContentBriefSignal): ContentOpportunity {
  const company = signal.company ?? null;
  const isComment = signal.signal_type === "linkedin_comment" || signal.signal_type === "comments";
  return {
    sourceTitle: signal.title,
    sourceUrl: signal.source_url ?? null,
    company,
    angle: angleForType(signal.signal_type, company),
    targetReader: "Founders & early growth leads",
    hook: `${signal.title} — here's what most teams miss`,
    format: isComment ? "LinkedIn comment" : "LinkedIn founder post",
    cta: "Draft for review — you publish manually after approval",
  };
}

// ----------------------------------------------------------- draft statuses ---

export type DraftReviewStatus = "draft_ready" | "needs_review" | "needs_proof" | "approved" | "manually_posted";

export const DRAFT_STATUS_LABELS: Record<DraftReviewStatus, string> = {
  draft_ready: "Draft ready",
  needs_review: "Needs review",
  needs_proof: "Needs proof",
  approved: "Approved",
  manually_posted: "Manually posted",
};

/** Map a raw saved_output/outreach_draft status to a review status. */
export function deriveDraftStatus(raw?: string | null, hasProof = true): DraftReviewStatus {
  const s = (raw ?? "").toLowerCase();
  if (!hasProof) return "needs_proof";
  if (s.includes("approve")) return "approved";
  if (s.includes("publish") || s.includes("posted") || s.includes("manual")) return "manually_posted";
  if (s.includes("review") || s.includes("pending")) return "needs_review";
  return "draft_ready";
}

/** Guard used in tests/UI — the content surface must never imply automatic posting. */
export function hasAutoPostLanguage(text: string): boolean {
  return /auto-?post|auto-?publish|posts? automatically|publishes? automatically|auto-?send|auto-?dm|auto-?comment/i.test(text);
}
