// GPT COMPARES THE POOL; CODE DECIDES WHAT SHIPS.
//
// WHAT WAS MISSING.
//
// The classifier judged one company at a time and never saw two together, so it
// could say "this is a good fit" and never "this is a better fit than that".
// Ordering came from `buildPortfolio`, a deterministic sort on tier then score —
// which is stable and explainable and knows nothing about the query. A user
// asking for manufacturers hiring their first salesperson got them in tier
// order, not in the order a person who understood the request would pick.
//
// THE INPUT IS DELIBERATELY THIN.
//
// The ranking model receives ONLY compact grounded summaries: verdicts,
// verified signals, grounding scores, and claims that already survived
// verification. It never sees raw provider payloads, rejected claims, evidence
// registries or founder data. So a claim that failed verification cannot
// influence rank, and there is no material here from which the ranker could
// invent a new fact about a company.
//
// AND THE OUTPUT IS CHECKED AGAINST THE INPUT.
//
// `validatePoolRanking` refuses a ranking that invents a company, drops one,
// duplicates one, promotes a REJECT above a QUALIFIED, or smuggles a provider
// name or a person into a reason. Anything unusable falls back to the
// deterministic order, which is never worse than what shipped before.
//
// PURE. No network, provider, model or database access.

import type { GroundedVerification } from "./groundedClaims.ts";
import type { BrainOutcome } from "./companyBrainSemanticFit.ts";

export const POOL_RANKING_VERSION = "pool-ranking-v1" as const;

// ─────────────────────────────────────────────── the compact summary ──

export type BrainDecisionLower = "qualified" | "review" | "reject";
export type OpportunityTier = "A" | "B" | "C" | null;
export type SignalStrength = "strong" | "moderate" | "weak" | "none";

export interface GroundedCandidateSummary {
  company_key: string;
  company_name: string;
  brain_decision: BrainDecisionLower;
  opportunity_tier: OpportunityTier;
  grounding_score: number;
  confidence_after_grounding: number;
  business_model: string;
  agentory_use_case: string;
  strongest_signal: string | null;
  signal_strength: SignalStrength;
  validated_claim_ids: string[];
  validated_evidence_ids: string[];
  missing_evidence: string[];
  material_conflicts: string[];
  mission_match_summary: string;
  reason_to_contact_now: string | null;
}

/**
 * Build the summary from a VERIFIED result.
 *
 * Everything here comes from `validated_claims`. Rejected claims are not
 * included, not summarised and not counted — which is what makes "the ranker
 * cannot be influenced by an unsupported claim" a structural property rather
 * than a rule someone has to remember.
 */
export function buildCandidateSummary(i: {
  company_key: string;
  company_name: string | null;
  brain_outcome: BrainOutcome;
  tier: OpportunityTier;
  grounded: GroundedVerification | null;
}): GroundedCandidateSummary {
  const g = i.grounded;
  const validated = g?.validated_claims ?? [];
  const signalClaim = validated.find((c) =>
    c.claim_type === "commercial_signal" || c.claim_type === "timing");
  const fitClaim = validated.find((c) =>
    c.claim_type === "business_model" || c.claim_type === "company_fit");

  return {
    company_key: i.company_key,
    company_name: i.company_name ?? i.company_key,
    brain_decision: i.brain_outcome === "QUALIFIED" ? "qualified"
      : i.brain_outcome === "REJECT" ? "reject" : "review",
    opportunity_tier: i.tier,
    grounding_score: g?.grounding_score ?? 0,
    confidence_after_grounding: g
      ? Number((g.classifier_result.confidence * g.grounding_score).toFixed(4)) : 0,
    business_model: g?.classifier_result.business_model.value ?? "unknown",
    agentory_use_case: g?.classifier_result.agentory_use_case ?? "weak",
    // THE STRONGEST SIGNAL IS A VALIDATED ONE OR NONE. The classifier's own
    // `strongest_signal` field is not used unless a claim backed it.
    strongest_signal: signalClaim ? signalClaim.claim : null,
    signal_strength: signalClaim
      ? (g?.classifier_result.mission_signal_assessment.signal_strength ?? "weak")
      : "none",
    validated_claim_ids: validated.map((c) => c.claim_type),
    validated_evidence_ids: [...new Set(
      validated.flatMap((c) => [
        ...c.evidence_ids, ...c.evidence_excerpts.map((x) => x.evidence_id),
      ]))],
    missing_evidence: g?.classifier_result.missing_evidence ?? [],
    material_conflicts: g?.unacknowledged_conflicts ?? [],
    mission_match_summary: fitClaim ? fitClaim.claim : "no validated fit claim",
    reason_to_contact_now: signalClaim ? signalClaim.claim : null,
  };
}

// ────────────────────────────────────────────────── the ranking contract ──

export const COMPARISON_BASES = [
  "mission_fit", "signal_strength", "timing",
  "agentory_use_case", "evidence_quality", "company_stage",
] as const;
export type ComparisonBasis = typeof COMPARISON_BASES[number];

export type RecommendedAction =
  | "offer_founder_unlock" | "review" | "watch" | "exclude";

export interface RankedCandidate {
  company_key: string;
  rank: number;
  relative_strength: "strong" | "moderate" | "weak";
  ranking_reason: string;
  comparison_basis: ComparisonBasis[];
  recommended_action: RecommendedAction;
}

export interface PoolSummary {
  qualified_available: number;
  review_available: number;
  watch_available: number;
  rejected_available: number;
  recommended_shortfall: number;
  ranking_confidence: number;
  pool_explanation: string;
}

export interface PoolRankingResult {
  ranked_candidates: RankedCandidate[];
  portfolio_summary: PoolSummary;
}

export const POOL_RANKING_PROMPT = [
  "You compare prospect companies that have ALREADY been assessed and verified.",
  "Rank them against the user's request: which is the better opportunity, and why.",
  "Use ONLY the supplied summaries. Every statement you make must be traceable to",
  "one of them.",
  "Never invent a company fact. Never change a decision, tier, score or signal.",
  "A company marked 'reject' may never rank above one marked 'qualified' or 'review'.",
  "Never mention a person, a founder, a contact detail, a data provider, a tool or",
  "an Actor.",
  "Give each company a distinct rank starting at 1.",
  "State honestly how many strong opportunities the pool actually contains; do not",
  "pad the list to reach the requested number.",
  "Return only the requested JSON object. Do not explain your reasoning process.",
].join(" ");

export function buildPoolRankingPayload(i: {
  originalUserQuery: string | null;
  requestedCount: number;
  summaries: readonly GroundedCandidateSummary[];
  unevaluatedCount: number;
  allowReview?: boolean;
  allowWatch?: boolean;
  missionDirectives?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    schema_version: POOL_RANKING_VERSION,
    instruction: POOL_RANKING_PROMPT,
    mission: {
      original_user_query: i.originalUserQuery,
      requested_opportunity_count: i.requestedCount,
      ...(i.missionDirectives ?? {}),
    },
    portfolio_rules: {
      qualified_first: true,
      review_allowed: i.allowReview !== false,
      watch_allowed: i.allowWatch !== false,
      reject_excluded: true,
      never_pad_to_reach_requested_count: true,
    },
    // HONESTY ABOUT COVERAGE. If some eligible companies were never evaluated,
    // the ranker is told — so its `pool_explanation` describes the pool it
    // actually saw rather than implying it saw everything.
    coverage: { evaluated: i.summaries.length, unevaluated: i.unevaluatedCount },
    comparison_basis_vocabulary: COMPARISON_BASES,
    candidates: i.summaries,
  };
}

// ─────────────────────────────────────────────────────────── validation ──

export type RankingSource = "gpt_validated" | "gpt_repaired" | "deterministic_fallback";

export type RankingRejection =
  | "unknown_company_key"
  | "duplicate_company_key"
  | "reject_outranks_qualified"
  | "forbidden_vocabulary"
  | "unusable_ranking";

export interface RejectedRankingEntry {
  company_key: string;
  reason: RankingRejection;
  detail: string;
}

export interface ValidatedRanking {
  version: typeof POOL_RANKING_VERSION;
  ranking_source: RankingSource;
  ranked: RankedCandidate[];
  validator_changes: string[];
  rejected_entries: RejectedRankingEntry[];
  fallback_reason: string | null;
  portfolio_summary: PoolSummary;
}

/** Words a ranking reason may never contain. */
const FORBIDDEN_IN_REASON =
  /\b(apify|harvestapi|memo23|solidcode|crawlworks|actor|scraper|linkedin\.com\/in\/|founder'?s? (name|email|phone)|@[a-z0-9.-]+\.[a-z]{2,})\b/i;

const DECISION_RANK: Record<BrainDecisionLower, number> = {
  qualified: 0, review: 1, reject: 2,
};
const TIER_RANK: Record<string, number> = { A: 0, B: 1, C: 2, null: 3 };
const STRENGTH_RANK: Record<SignalStrength, number> = {
  strong: 0, moderate: 1, weak: 2, none: 3,
};

/**
 * THE DETERMINISTIC ORDER — the floor this system never falls below.
 *
 * Also the fallback whenever a ranking is unusable. Deliberately total and
 * stable: same pool, same order, every time, with company name as the final
 * tiebreak so two equal candidates never swap places between runs.
 */
export function deterministicOrder(
  summaries: readonly GroundedCandidateSummary[],
): GroundedCandidateSummary[] {
  return [...summaries].sort((a, b) =>
    DECISION_RANK[a.brain_decision] - DECISION_RANK[b.brain_decision] ||
    TIER_RANK[String(a.opportunity_tier)] - TIER_RANK[String(b.opportunity_tier)] ||
    b.grounding_score - a.grounding_score ||
    b.confidence_after_grounding - a.confidence_after_grounding ||
    STRENGTH_RANK[a.signal_strength] - STRENGTH_RANK[b.signal_strength] ||
    a.company_name.localeCompare(b.company_name));
}

function fallbackRanking(
  summaries: readonly GroundedCandidateSummary[], reason: string,
): ValidatedRanking {
  const ordered = deterministicOrder(summaries);
  return {
    version: POOL_RANKING_VERSION,
    ranking_source: "deterministic_fallback",
    ranked: ordered.map((s, i) => ({
      company_key: s.company_key,
      rank: i + 1,
      relative_strength: s.brain_decision === "qualified" && s.grounding_score >= 0.8
        ? "strong" : s.brain_decision === "reject" ? "weak" : "moderate",
      ranking_reason: `deterministic order: ${s.brain_decision}` +
        `${s.opportunity_tier ? `, tier ${s.opportunity_tier}` : ""}` +
        `, grounding ${s.grounding_score}`,
      comparison_basis: ["mission_fit", "evidence_quality"] as ComparisonBasis[],
      recommended_action: actionFor(s),
    })),
    validator_changes: [],
    rejected_entries: [],
    fallback_reason: reason,
    portfolio_summary: summarize(summaries, 0),
  };
}

/**
 * The deterministic order, with an explicit reason for shipping it.
 *
 * `validatePoolRanking({ raw: null })` also produces the deterministic order,
 * but stamps it "ranking response was absent or unreadable" — which is a lie in
 * shadow mode, where the ranking was computed successfully and simply is not
 * allowed to govern. Shadow needs to say WHY the deterministic order shipped,
 * because "the ranker failed" and "the ranker is being observed" are the two
 * facts a reader is trying to tell apart.
 */
export function deterministicRanking(
  summaries: readonly GroundedCandidateSummary[], reason: string,
): ValidatedRanking {
  return fallbackRanking(summaries, reason);
}

function actionFor(s: GroundedCandidateSummary): RecommendedAction {
  return s.brain_decision === "qualified" ? "offer_founder_unlock"
    : s.brain_decision === "review" ? "review"
    : s.opportunity_tier === "C" ? "watch" : "exclude";
}

function summarize(
  summaries: readonly GroundedCandidateSummary[], shortfall: number,
): PoolSummary {
  const by = (d: BrainDecisionLower) =>
    summaries.filter((s) => s.brain_decision === d).length;
  return {
    qualified_available: by("qualified"),
    review_available: by("review"),
    watch_available: summaries.filter((s) =>
      s.brain_decision !== "reject" && s.opportunity_tier === "C").length,
    rejected_available: by("reject"),
    recommended_shortfall: shortfall,
    ranking_confidence: 0,
    pool_explanation: "deterministic ordering; no semantic comparison available",
  };
}

/**
 * Validate the model's ranking against the pool it was given.
 *
 * REPAIRS what is harmless — a gap in the rank numbers, a candidate the model
 * forgot, an ordering that puts a REJECT too high. REFUSES what is not: an
 * invented company, or a reason carrying a provider name or a person. The
 * distinction is whether the error changes WHAT IS TRUE about a company or only
 * where it sits in a list.
 */
export function validatePoolRanking(i: {
  raw: unknown;
  summaries: readonly GroundedCandidateSummary[];
  requestedCount: number;
}): ValidatedRanking {
  const known = new Map(i.summaries.map((s) => [s.company_key, s]));
  if (i.summaries.length === 0) {
    return fallbackRanking(i.summaries, "no evaluated candidates to rank");
  }

  const parsed = readRanking(i.raw);
  if (!parsed || parsed.ranked_candidates.length === 0) {
    return fallbackRanking(i.summaries, "ranking response was absent or unreadable");
  }

  const changes: string[] = [];
  const rejected: RejectedRankingEntry[] = [];
  const accepted: RankedCandidate[] = [];
  const seen = new Set<string>();

  for (const c of parsed.ranked_candidates) {
    const key = String(c.company_key ?? "").trim();
    if (!known.has(key)) {
      // AN INVENTED COMPANY IS NOT A RANKING ERROR, it is a fabrication.
      rejected.push({
        company_key: key || "(empty)", reason: "unknown_company_key",
        detail: "not present in the evaluated pool",
      });
      continue;
    }
    if (seen.has(key)) {
      rejected.push({
        company_key: key, reason: "duplicate_company_key",
        detail: "appeared more than once in the ranking",
      });
      continue;
    }
    if (FORBIDDEN_IN_REASON.test(c.ranking_reason ?? "")) {
      rejected.push({
        company_key: key, reason: "forbidden_vocabulary",
        detail: "the reason named a provider, tool or person",
      });
      continue;
    }
    seen.add(key);
    accepted.push({
      company_key: key,
      rank: Number(c.rank) || accepted.length + 1,
      relative_strength: ["strong", "moderate", "weak"].includes(String(c.relative_strength))
        ? c.relative_strength as RankedCandidate["relative_strength"] : "moderate",
      ranking_reason: String(c.ranking_reason ?? "").slice(0, 400),
      comparison_basis: (Array.isArray(c.comparison_basis) ? c.comparison_basis : [])
        .filter((b: unknown): b is ComparisonBasis =>
          (COMPARISON_BASES as readonly string[]).includes(String(b))),
      recommended_action: ["offer_founder_unlock", "review", "watch", "exclude"]
        .includes(String(c.recommended_action))
        ? c.recommended_action as RecommendedAction
        : actionFor(known.get(key)!),
    });
  }

  if (accepted.length === 0) {
    return fallbackRanking(i.summaries,
      `every ranked entry was rejected (${rejected.length})`);
  }

  // ── A CANDIDATE THE MODEL FORGOT IS APPENDED, NOT LOST ────────────────
  const missing = i.summaries.filter((s) => !seen.has(s.company_key));
  if (missing.length > 0) {
    changes.push(`appended_${missing.length}_omitted_candidates`);
    for (const s of deterministicOrder(missing)) {
      accepted.push({
        company_key: s.company_key, rank: accepted.length + 1,
        relative_strength: s.brain_decision === "qualified" ? "moderate" : "weak",
        ranking_reason: "omitted by the ranking model; ordered deterministically",
        comparison_basis: ["mission_fit"],
        recommended_action: actionFor(s),
      });
    }
  }

  // ── ORDER, THEN RENUMBER ──────────────────────────────────────────────
  //
  // The model's relative order is respected WITHIN a decision class, and code
  // owns the class boundaries: a REJECT can never be lifted above a QUALIFIED
  // by a persuasive sentence.
  accepted.sort((a, b) => {
    const sa = known.get(a.company_key)!, sb = known.get(b.company_key)!;
    const d = DECISION_RANK[sa.brain_decision] - DECISION_RANK[sb.brain_decision];
    if (d !== 0) return d;
    return (Number(a.rank) || 0) - (Number(b.rank) || 0);
  });
  const beforeOrder = accepted.map((a) => a.company_key).join(",");
  let renumbered = false;
  accepted.forEach((a, idx) => {
    if (a.rank !== idx + 1) renumbered = true;
    a.rank = idx + 1;
  });
  if (renumbered) changes.push("ranks_renumbered_to_be_unique_and_sequential");

  // Did the class ordering actually move anything the model had ranked?
  const modelOrder = parsed.ranked_candidates
    .map((c) => String(c.company_key)).filter((k) => known.has(k)).join(",");
  if (modelOrder && !beforeOrder.startsWith(modelOrder.split(",")[0])) {
    changes.push("decision_class_ordering_enforced");
  }
  for (const r of rejected) {
    if (r.reason === "unknown_company_key") changes.push(`dropped_unknown:${r.company_key}`);
  }

  const s = parsed.portfolio_summary ?? {};
  const conf = Number(s.ranking_confidence);
  return {
    version: POOL_RANKING_VERSION,
    ranking_source: changes.length > 0 || rejected.length > 0
      ? "gpt_repaired" : "gpt_validated",
    ranked: accepted,
    validator_changes: changes,
    rejected_entries: rejected,
    fallback_reason: null,
    portfolio_summary: {
      ...summarize(i.summaries, Math.max(0,
        i.requestedCount - i.summaries.filter((x) => x.brain_decision !== "reject").length)),
      ranking_confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5,
      pool_explanation: String(s.pool_explanation ?? "").slice(0, 600) ||
        "semantic comparison of the evaluated pool",
    },
  };
}

function readRanking(raw: unknown): {
  ranked_candidates: Array<Record<string, any>>;
  portfolio_summary?: Record<string, any>;
} | null {
  const o = typeof raw === "string" ? safeJson(raw) : raw;
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const list = Array.isArray(r.ranked_candidates) ? r.ranked_candidates : null;
  if (!list) return null;
  return {
    ranked_candidates: list.filter((x): x is Record<string, any> =>
      !!x && typeof x === "object" && !Array.isArray(x)),
    portfolio_summary: (r.portfolio_summary && typeof r.portfolio_summary === "object")
      ? r.portfolio_summary as Record<string, any> : {},
  };
}
function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// ───────────────────────────────────────────────────── portfolio policy ──

export interface PortfolioDelivery {
  delivered: Array<{
    rank: number;
    summary: GroundedCandidateSummary;
    ranking_reason: string;
    relative_strength: string;
    recommended_action: RecommendedAction;
  }>;
  metrics: {
    requested: number;
    eligible: number;
    evaluated: number;
    unevaluated: number;
    qualified: number;
    review: number;
    watch: number;
    rejected: number;
    delivered: number;
    shortfall: number;
    contact_ready: number;
    founder_unlocked: number;
  };
  ranking_source: RankingSource;
}

/**
 * Apply the final policy. CODE decides what ships.
 *
 * The semantic ranking supplies order; this supplies membership. Rejects never
 * ship, the cap is honoured, and the list is NOT padded — a request for 25 that
 * finds 6 real opportunities delivers 6 and reports a shortfall of 19. Filling
 * the gap with weak rows is how a shortfall becomes invisible and a user spends
 * an afternoon on companies the system already knew were poor.
 */
export function applyPortfolioPolicy(i: {
  ranking: ValidatedRanking;
  summaries: readonly GroundedCandidateSummary[];
  requestedCount: number;
  eligibleCount: number;
  unevaluatedCount: number;
  allowReview?: boolean;
  allowWatch?: boolean;
}): PortfolioDelivery {
  const byKey = new Map(i.summaries.map((s) => [s.company_key, s]));
  const allowReview = i.allowReview !== false;
  const allowWatch = i.allowWatch !== false;

  const eligibleForDelivery = i.ranking.ranked.filter((r) => {
    const s = byKey.get(r.company_key);
    if (!s) return false;
    if (s.brain_decision === "reject") return false;
    if (s.brain_decision === "review" && !allowReview && s.opportunity_tier !== "C") {
      return false;
    }
    if (s.opportunity_tier === "C" && !allowWatch) return false;
    return true;
  });

  const delivered = eligibleForDelivery
    .slice(0, Math.max(0, i.requestedCount))
    .map((r, idx) => ({
      rank: idx + 1,
      summary: byKey.get(r.company_key)!,
      ranking_reason: r.ranking_reason,
      relative_strength: r.relative_strength,
      recommended_action: r.recommended_action,
    }));

  const count = (d: BrainDecisionLower) =>
    i.summaries.filter((s) => s.brain_decision === d).length;

  return {
    delivered,
    ranking_source: i.ranking.ranking_source,
    metrics: {
      requested: i.requestedCount,
      eligible: i.eligibleCount,
      evaluated: i.summaries.length,
      unevaluated: i.unevaluatedCount,
      qualified: count("qualified"),
      review: count("review"),
      watch: i.summaries.filter((s) =>
        s.brain_decision !== "reject" && s.opportunity_tier === "C").length,
      rejected: count("reject"),
      delivered: delivered.length,
      // HONEST. Never negative, and never hidden by padding.
      shortfall: Math.max(0, i.requestedCount - delivered.length),
      // NOTHING IS CONTACT-READY OR UNLOCKED IN THIS STAGE. Stated as zero
      // rather than omitted, so "delivered" is never read as "contactable".
      contact_ready: 0,
      founder_unlocked: 0,
    },
  };
}

// ───────────────────────────────────────────── what enforcing would do ──
//
// SHADOW MODE HAS TO COMPUTE SOMETHING OR IT IS NOT SHADOW MODE.
//
// The first version gated the ranker on `enforce`, so shadow ran no comparison
// and persisted nothing — which meant the only way to find out what semantic
// ranking would do was to switch it on and let it do it. That is the opposite
// of what a shadow mode is for, and it made "enable enforce" an unevidenced
// decision.
//
// So: shadow runs the ranker, ships the DETERMINISTIC order, and records this
// diff. The question it exists to answer is not "did the order change" — it is
// "would a different set of companies have reached the user", which is the only
// difference anybody actually pays for.

export interface RankingRankChange {
  company_key: string;
  deterministic_rank: number;
  proposed_rank: number;
  /** Positive ⇒ the ranker moved it UP the list. */
  delta: number;
}

export interface RankingActionChange {
  company_key: string;
  deterministic_action: RecommendedAction;
  proposed_action: RecommendedAction;
}

export interface RankingShadowComparison {
  version: typeof POOL_RANKING_VERSION;
  /** False ⇒ the ranker returned nothing; there is no comparison, only a fact. */
  computed: boolean;
  proposed_source: RankingSource | null;
  proposed_confidence: number | null;
  identical_order: boolean;
  moved_count: number;
  max_rank_delta: number;
  rank_changes: RankingRankChange[];
  /** How many rows the portfolio policy would actually deliver. */
  delivered_window: number;
  /** Companies the ranker would have put in front of the user, and code did not. */
  would_enter_delivery: string[];
  /** Companies code delivered that the ranker would have dropped out of the window. */
  would_leave_delivery: string[];
  action_changes: RankingActionChange[];
  validator_changes: string[];
  rejected_entries: RejectedRankingEntry[];
  fallback_reason: string | null;
}

/**
 * Compare the ranking that WOULD have governed against the one that did.
 *
 * Both sides go through `applyPortfolioPolicy`, so the membership diff is
 * produced by the same function that decides real delivery rather than by a
 * reimplementation of its rules that could drift away from it. Only `delivered`
 * is read from those two calls; the metrics they also compute are discarded,
 * which is why the counts passed in below are the honest local ones and not
 * invented figures.
 */
export function buildRankingShadowComparison(i: {
  proposed: ValidatedRanking | null;
  deterministic: ValidatedRanking;
  summaries: readonly GroundedCandidateSummary[];
  requestedCount: number;
  allowReview?: boolean;
  allowWatch?: boolean;
}): RankingShadowComparison {
  const base: RankingShadowComparison = {
    version: POOL_RANKING_VERSION,
    computed: i.proposed !== null,
    proposed_source: i.proposed?.ranking_source ?? null,
    proposed_confidence: i.proposed?.portfolio_summary.ranking_confidence ?? null,
    identical_order: true,
    moved_count: 0,
    max_rank_delta: 0,
    rank_changes: [],
    delivered_window: 0,
    would_enter_delivery: [],
    would_leave_delivery: [],
    action_changes: [],
    validator_changes: i.proposed?.validator_changes ?? [],
    rejected_entries: i.proposed?.rejected_entries ?? [],
    fallback_reason: i.proposed?.fallback_reason ?? null,
  };
  if (!i.proposed) return base;

  const policy = (ranking: ValidatedRanking) =>
    applyPortfolioPolicy({
      ranking, summaries: i.summaries, requestedCount: i.requestedCount,
      // METRICS-ONLY ARGUMENTS, and the metrics are thrown away. Membership
      // depends on the ranked order, the summaries and the caps — never on
      // these two — so passing the local counts fabricates nothing.
      eligibleCount: i.summaries.length, unevaluatedCount: 0,
      ...(i.allowReview !== undefined ? { allowReview: i.allowReview } : {}),
      ...(i.allowWatch !== undefined ? { allowWatch: i.allowWatch } : {}),
    }).delivered.map((d) => d.summary.company_key);

  const shipped = policy(i.deterministic);
  const wouldShip = policy(i.proposed);
  const shippedSet = new Set(shipped);
  const wouldShipSet = new Set(wouldShip);

  const detRank = new Map(i.deterministic.ranked.map((r) => [r.company_key, r.rank]));
  const detAction = new Map(
    i.deterministic.ranked.map((r) => [r.company_key, r.recommended_action]));

  const changes: RankingRankChange[] = [];
  const actionChanges: RankingActionChange[] = [];
  for (const r of i.proposed.ranked) {
    const was = detRank.get(r.company_key);
    if (was !== undefined && was !== r.rank) {
      changes.push({
        company_key: r.company_key,
        deterministic_rank: was,
        proposed_rank: r.rank,
        delta: was - r.rank,
      });
    }
    const wasAction = detAction.get(r.company_key);
    if (wasAction !== undefined && wasAction !== r.recommended_action) {
      actionChanges.push({
        company_key: r.company_key,
        deterministic_action: wasAction,
        proposed_action: r.recommended_action,
      });
    }
  }

  return {
    ...base,
    identical_order: changes.length === 0,
    moved_count: changes.length,
    max_rank_delta: changes.reduce((m, c) => Math.max(m, Math.abs(c.delta)), 0),
    rank_changes: changes,
    delivered_window: shipped.length,
    would_enter_delivery: wouldShip.filter((k) => !shippedSet.has(k)),
    would_leave_delivery: shipped.filter((k) => !wouldShipSet.has(k)),
    action_changes: actionChanges,
  };
}
