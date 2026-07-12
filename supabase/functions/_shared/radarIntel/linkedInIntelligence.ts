// LinkedIn post + comment intelligence. PURE / Deno-testable. No provider calls,
// no fabricated engagement. Encodes the contracts for post grouping, honest
// virality, and comment-intent detection so a UI/adapter can present them.

import type { RadarIntelligenceProfile } from "./radarIntelligenceProfile.ts";

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------
export type PostGroup = "competitor" | "category_leader" | "icp_pain" | "high_engagement" | "off_topic";

export interface PostEngagement { reactions?: number | null; comments?: number | null; reposts?: number | null; follower_count?: number | null; }
export type EngagementClass = "viral" | "high_engagement" | "emerging" | "relevant_post";

export interface PostClassification {
  group: PostGroup;
  topic: string | null;
  matched_terms: string[];
  relevant: boolean;
  why: string;
}

const ICP_PAIN_MARKERS = [
  "outbound (is|isn'?t| not) working", "our outbound", "hiring sdrs", "hiring an sdr", "lead quality",
  "leads? are (bad|poor|low quality)", "founder is still doing sales", "need pipeline", "no pipeline",
  "ai sdrs? are spam", "using agents", "how are teams using", "which tool", "tool recommendation",
  "pipeline problem", "not enough pipeline",
];
const CATEGORY_LEADER_MARKERS = [
  "ai agent", "ai gtm", "gtm agent", "ai sdr", "signal-based", "signal based", "playbook",
  "founder-led", "founder led", "pipeline before", "replacing manual", "account brief", "research agent",
];

function lc(s: string): string { return (s ?? "").toLowerCase(); }
function found(hay: string, terms: string[]): string[] {
  const out: string[] = [];
  for (const t of terms) { const n = lc(t); if (n && (n.includes(" ") || n.length >= 3)) { if (new RegExp(n.includes("(") ? n : n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(hay)) out.push(t); } }
  return [...new Set(out)];
}

export function classifyPost(
  post: { text?: string; author_company?: string; author_role?: string },
  profile: RadarIntelligenceProfile,
): PostClassification {
  const text = lc([post.text, post.author_role, post.author_company].filter(Boolean).join(" "));
  if (!text.trim()) return { group: "off_topic", topic: null, matched_terms: [], relevant: false, why: "Empty post." };

  // A) competitor — author company matches a workspace competitor seed.
  const compHit = [...profile.competitors.seeds, ...profile.competitors.watchlist].find((c) => c && lc(post.author_company ?? "").includes(lc(c)));
  if (compHit) return { group: "competitor", topic: compHit, matched_terms: [compHit], relevant: true, why: `Post from a Company Brain competitor (${compHit}).` };

  // C) ICP pain — buyer complaint/question markers.
  const painHits = found(text, ICP_PAIN_MARKERS);
  if (painHits.length) return { group: "icp_pain", topic: painHits[0], matched_terms: painHits, relevant: true, why: "Post expresses an ICP pain/question your product addresses." };

  // B) category leader — brain topics or generic category-leader markers.
  const topicHits = [...found(text, profile.topics), ...found(text, CATEGORY_LEADER_MARKERS)];
  if (topicHits.length) return { group: "category_leader", topic: topicHits[0], matched_terms: [...new Set(topicHits)], relevant: true, why: "Post discusses your category / GTM-agent topics." };

  return { group: "off_topic", topic: null, matched_terms: [], relevant: false, why: "No connection to this workspace's topics or competitors." };
}

/** Honest engagement classification. NEVER "viral" without real metrics. */
export function classifyEngagement(e: PostEngagement | null | undefined): { class: EngagementClass; score: number | null; has_metrics: boolean } {
  const hasMetrics = !!e && [e.reactions, e.comments, e.reposts].some((v) => typeof v === "number" && (v as number) >= 0);
  if (!hasMetrics) return { class: "relevant_post", score: null, has_metrics: false };
  const r = Math.max(0, e!.reactions ?? 0), c = Math.max(0, e!.comments ?? 0), rp = Math.max(0, e!.reposts ?? 0);
  // Transparent weighted score: comments + reposts weigh more than reactions.
  const score = r + c * 3 + rp * 5;
  let cls: EngagementClass = "emerging";
  if (score >= 800) cls = "viral";
  else if (score >= 200) cls = "high_engagement";
  else if (score >= 40) cls = "emerging";
  else cls = "relevant_post";
  return { class: cls, score, has_metrics: true };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------
export type CommentIntent =
  | "how_it_works" | "asking_playbook" | "implementation" | "pipeline_problem"
  | "hiring_capacity" | "evaluating_agents" | "comparing_tools" | "lead_quality"
  | "asking_recommendation" | "describing_manual_work" | "purchase_intent" | "none";

const INTENT_PATTERNS: [CommentIntent, RegExp][] = [
  ["implementation", /\b(how did you (set|build)|how do you (implement|set up|configure)|what.?s your (stack|setup)|which tools?|how does this work in practice)\b/i],
  ["asking_playbook", /\b(playbook|share the (process|framework)|can you (share|walk through)|breakdown|step by step)\b/i],
  ["how_it_works", /\b(how does (this|it) work|curious how|how are you doing this)\b/i],
  ["pipeline_problem", /\b(our pipeline|not enough pipeline|no pipeline|pipeline is (dry|thin)|struggling (with|to) (get|build) (leads|pipeline))\b/i],
  ["lead_quality", /\b(lead quality|leads? are (bad|poor|junk|low)|bad leads|unqualified leads)\b/i],
  ["hiring_capacity", /\b(we.?re hiring|should we hire|hiring an? (sdr|bdr|ae)|team capacity|stretched thin)\b/i],
  ["evaluating_agents", /\b(evaluating|trying out|testing) .*(agent|ai sdr|automation)|are ai (agents|sdrs) worth\b/i],
  ["comparing_tools", /\b(vs\.?|versus|compared to|alternative to|instead of|better than) \w+/i],
  ["asking_recommendation", /\b(any recommendation|what (would|do) you recommend|suggestions\?|which .* should i)\b/i],
  ["purchase_intent", /\b(sign(ed)? up|start(ing)? a trial|book a demo|pricing|how much (does|is)|want to try)\b/i],
  ["describing_manual_work", /\b(we (currently )?do this manually|manual (research|process)|by hand|spreadsheet)\b/i],
];

// Generic low-value comments that are NOT buying intent.
const GENERIC_COMMENT = /^(great post|love this|so true|well said|congrats|congratulations|amazing|nice|👏+|🔥+|\+1|this\.?|agreed|100%|spot on|thanks for sharing)[\s!.]*$/i;

export interface CommentClassification { intent: CommentIntent; is_buying_signal: boolean; reason: string; }

export function classifyCommentIntent(commentText: string): CommentClassification {
  const text = (commentText ?? "").trim();
  if (!text) return { intent: "none", is_buying_signal: false, reason: "Empty comment." };
  if (GENERIC_COMMENT.test(text)) return { intent: "none", is_buying_signal: false, reason: "Generic compliment — not a buying signal." };
  for (const [intent, re] of INTENT_PATTERNS) {
    if (re.test(text)) return { intent, is_buying_signal: true, reason: `Shows ${intent.replace(/_/g, " ")} intent.` };
  }
  return { intent: "none", is_buying_signal: false, reason: "No clear buying intent detected." };
}

export interface CommentSignal {
  valid: boolean;
  missing_evidence: string[];
  intent: CommentIntent;
  company_fit: boolean;
}

/** A comment signal requires: a real comment, buying intent, and PARENT-POST
 * evidence. A person profile with no relevant comment is never a comment signal. */
export function buildCommentSignal(args: {
  commentText?: string; parentPostUrl?: string; parentPostExcerpt?: string;
  commenterCompanyText?: string; profile: RadarIntelligenceProfile;
}): CommentSignal {
  const missing: string[] = [];
  const cls = classifyCommentIntent(args.commentText ?? "");
  if (!args.commentText?.trim()) missing.push("Comment text");
  if (!args.parentPostUrl?.trim()) missing.push("Parent post URL");
  // Company fit against the ICP (best-effort: no exclusion + some topical/industry overlap).
  const companyBlob = (args.commenterCompanyText ?? "").toLowerCase();
  const fit = !!companyBlob && !args.profile.target_company.excluded_company_types.some((x: string) => companyBlob.includes(x.toLowerCase()))
    && !args.profile.target_company.excluded_industries.some((x: string) => companyBlob.includes(x.toLowerCase()));
  const valid = cls.is_buying_signal && !!args.parentPostUrl?.trim() && !!args.commentText?.trim();
  return { valid, missing_evidence: missing, intent: cls.intent, company_fit: fit };
}
