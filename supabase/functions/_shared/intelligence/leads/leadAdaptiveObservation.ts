// BOUNDED SOURCE-STEP OBSERVATION + DETERMINISTIC BOTTLENECK CLASSIFICATION.
//
// After every source action Agentory produces ONE bounded observation. Raw
// provider output never leaves the runtime: the model sees counts, reason codes
// and the menu of currently-legal actions, nothing else. Agentory computes every
// number — a model that supplied its own funnel metrics could argue itself into
// any conclusion it liked.
//
// ── WHY THE STAGE COUNTS ARE SEPARATE ────────────────────────────────────────
// `companies_resolved` and `companies_qualified` are DISTINCT inputs, and
// `companies_rejected` is derived from them (`resolved - qualified`) rather than
// supplied. That is a direct response to a real defect: the pre-existing funnel
// computed `companies_rejected` as `normalizedJobs - verifiedCompanies` — jobs
// minus companies, two different units — which reported 25 "rejections" for
// production task c30fbc6d when in fact ZERO companies had been resolved. Rows
// had been discarded upstream at `missing_occurred_at` and never reached the
// Company Brain at all.
//
// The distinction is the whole point of the classifier below:
//   title matches, but nothing resolved  → insufficient_company_resolution
//   companies resolved, none qualified   → company_brain_rejection
// Those two demand opposite remedies. Conflating them is what drove a broadening
// round against a bottleneck that did not exist.
//
// Pure. No provider, model, network or database access.

export const OBSERVATION_VERSION = "lead-source-observation-1.0.0";

/**
 * Deterministic bottleneck labels, in funnel order.
 *
 * The FIRST constriction wins — repairing a later stage is pointless while an
 * earlier one is starving it.
 */
export type AdaptiveBottleneck =
  | "insufficient_raw_coverage"
  | "insufficient_title_coverage"
  | "excessive_title_noise"
  | "insufficient_company_resolution"
  | "company_brain_rejection"
  | "insufficient_qualified_company_coverage"
  | "insufficient_decision_maker_coverage"
  | "current_employer_verification_failure"
  | "insufficient_contact_coverage"
  | "quota_reached"
  | "source_exhausted"
  | "execution_window_reached";

export const ADAPTIVE_BOTTLENECKS: readonly AdaptiveBottleneck[] = [
  "insufficient_raw_coverage", "insufficient_title_coverage", "excessive_title_noise",
  "insufficient_company_resolution", "company_brain_rejection",
  "insufficient_qualified_company_coverage", "insufficient_decision_maker_coverage",
  "current_employer_verification_failure", "insufficient_contact_coverage",
  "quota_reached", "source_exhausted", "execution_window_reached",
];

/** The bounded next-action vocabulary. ATS verification is deliberately absent. */
export type AdaptiveAction =
  | "run_unused_query_pack"
  | "broaden_direct_seniority"
  | "broaden_recency"
  | "advance_source"
  | "activate_direct_adjacent_pack"
  | "activate_evidence_gated_pack"
  | "begin_people_search"
  | "broaden_people_search"
  | "run_contact_enrichment"
  | "stop_success"
  | "stop_partial";

export const ADAPTIVE_ACTIONS: readonly AdaptiveAction[] = [
  "run_unused_query_pack", "broaden_direct_seniority", "broaden_recency", "advance_source",
  "activate_direct_adjacent_pack", "activate_evidence_gated_pack", "begin_people_search",
  "broaden_people_search", "run_contact_enrichment", "stop_success", "stop_partial",
];

export interface SourceStepObservation {
  source_step_id: string;
  source_capability: string;
  query_pack_ids: string[];
  titles_used: string[];
  semantic_filters: Record<string, unknown>;
  /** What Agentory actually compiled and sent. Verified schema fields only. */
  provider_filters: Record<string, unknown>;

  provider_rows: number;
  normalized_jobs: number;
  jobs_within_recency_window: number;
  title_matches: number;
  title_rejections: number;

  /** Companies whose identity was established from a matching job. */
  companies_resolved: number;
  /** Companies that passed the Company Brain / ICP gate. */
  companies_qualified: number;
  /** DERIVED: resolved - qualified. Never supplied by a caller. */
  companies_rejected: number;
  company_rejection_reasons: Record<string, number>;

  decision_makers_verified: number;
  contact_ready_leads: number;
  requested_leads: number;
  remaining_leads: number;

  completed_query_packs: string[];
  unused_query_packs: string[];
  completed_sources: string[];
  remaining_sources: string[];

  bottleneck: AdaptiveBottleneck;
  valid_next_actions: AdaptiveAction[];
}

/** Raw inputs the runtime measures. Every count is Agentory's, never the model's. */
export interface ObservationInput {
  source_step_id: string;
  source_capability: string;
  query_pack_ids: readonly string[];
  titles_used: readonly string[];
  semantic_filters?: Record<string, unknown>;
  provider_filters?: Record<string, unknown>;

  provider_rows: number;
  normalized_jobs: number;
  jobs_within_recency_window: number;
  title_matches: number;
  title_rejections: number;
  companies_resolved: number;
  companies_qualified: number;
  company_rejection_reasons?: Record<string, number>;
  decision_makers_verified: number;
  contact_ready_leads: number;
  requested_leads: number;

  completed_query_packs: readonly string[];
  unused_query_packs: readonly string[];
  completed_sources: readonly string[];
  remaining_sources: readonly string[];

  /** Bounded-execution facts. */
  budget_remaining_usd: number;
  provider_calls_remaining: number;
  /** Deferred packs available for activation, by tier. */
  direct_adjacent_packs_available: number;
  evidence_gated_packs_available: number;
  /** Whether recency/seniority broadening rungs remain unused for this step. */
  seniority_broadening_available: boolean;
  recency_broadening_available: boolean;
  /** People-stage facts, supplied by the existing authorities. */
  people_search_completed_for_qualified: boolean;
  people_needing_contact: number;
}

const nn = (v: number): number => Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

/** Noise ratio above which a pack is producing more junk than signal. */
export const TITLE_NOISE_THRESHOLD = 0.6;
/** Company-rejection ratio above which a source is not serving this ICP. */
export const COMPANY_REJECTION_THRESHOLD = 0.8;

/**
 * Classify the first real constriction.
 *
 * Order is funnel order, with the terminal conditions checked first because a met
 * quota or an exhausted window ends the mission regardless of funnel shape.
 */
export function classifyAdaptiveBottleneck(o: {
  provider_rows: number; title_matches: number; title_rejections: number;
  companies_resolved: number; companies_qualified: number;
  decision_makers_verified: number; contact_ready_leads: number;
  remaining_leads: number; people_needing_contact: number;
  budget_remaining_usd: number; provider_calls_remaining: number;
  unused_query_packs: readonly string[]; remaining_sources: readonly string[];
}): { bottleneck: AdaptiveBottleneck; reason: string } {
  if (o.remaining_leads <= 0) {
    return { bottleneck: "quota_reached", reason: "the requested CONTACT-ready quota is satisfied" };
  }
  if (o.budget_remaining_usd <= 0 || o.provider_calls_remaining <= 0) {
    return { bottleneck: "execution_window_reached", reason: "no budget or provider calls remain" };
  }

  if (o.provider_rows === 0) {
    return { bottleneck: "insufficient_raw_coverage", reason: "the source returned no rows for this query pack" };
  }

  const titleTotal = o.title_matches + o.title_rejections;
  if (o.title_matches === 0) {
    return { bottleneck: "insufficient_title_coverage", reason: "no returned posting matched the requested role family" };
  }
  if (titleTotal > 0 && o.title_rejections / titleTotal > TITLE_NOISE_THRESHOLD) {
    return { bottleneck: "excessive_title_noise", reason: "most returned postings were outside the requested role family" };
  }

  // THE DISTINCTION THAT MATTERS. Relevant titles that produced no company at all
  // is an upstream failure (identity, normalization, evidence admissibility) — not
  // a Company Brain verdict. Reporting it as a Brain rejection sends the next
  // decision after the wrong problem.
  if (o.companies_resolved === 0) {
    return {
      bottleneck: "insufficient_company_resolution",
      reason: "postings matched the role family but no company identity was resolved from them",
    };
  }
  if (o.companies_qualified === 0) {
    return {
      bottleneck: "company_brain_rejection",
      reason: "companies were resolved but none satisfied the Company Brain constraints",
    };
  }
  const rejectionRate = (o.companies_resolved - o.companies_qualified) / Math.max(1, o.companies_resolved);
  if (rejectionRate > COMPANY_REJECTION_THRESHOLD) {
    return {
      bottleneck: "insufficient_qualified_company_coverage",
      reason: "a small minority of resolved companies satisfied the ICP",
    };
  }

  if (o.decision_makers_verified === 0) {
    return {
      bottleneck: "insufficient_decision_maker_coverage",
      reason: "qualified companies exist but no decision maker has been verified",
    };
  }
  if (o.contact_ready_leads === 0 && o.people_needing_contact > 0) {
    return {
      bottleneck: "insufficient_contact_coverage",
      reason: "decision makers are verified but none has a usable contact method",
    };
  }
  if (o.contact_ready_leads === 0 && o.decision_makers_verified > 0) {
    return {
      bottleneck: "current_employer_verification_failure",
      reason: "people were found but none was confirmed at the qualified company",
    };
  }

  if (o.unused_query_packs.length === 0 && o.remaining_sources.length === 0) {
    return { bottleneck: "source_exhausted", reason: "every approved source and query pack has been attempted" };
  }
  return {
    bottleneck: "insufficient_qualified_company_coverage",
    reason: "progress is being made but the quota is not yet met",
  };
}

/**
 * The legal action menu for this state.
 *
 * Every branch answers a question about what EXISTS right now, never about what
 * would be desirable. An action absent from this list cannot be executed, so the
 * menu is the security boundary as well as the prompt.
 */
export function projectValidActions(
  o: ObservationInput,
  bottleneck: AdaptiveBottleneck,
): AdaptiveAction[] {
  const remaining = nn(o.requested_leads) - nn(o.contact_ready_leads);
  if (remaining <= 0) return ["stop_success"];

  const canCall = o.budget_remaining_usd > 0 && o.provider_calls_remaining > 0;
  if (!canCall) return ["stop_partial"];

  const actions = new Set<AdaptiveAction>();

  // ---- people/contact stages: available whenever their prerequisite exists ----
  if (o.companies_qualified > 0 && !o.people_search_completed_for_qualified) {
    actions.add("begin_people_search");
  }
  if (o.companies_qualified > 0 && o.people_search_completed_for_qualified && o.decision_makers_verified === 0) {
    actions.add("broaden_people_search");
  }
  if (o.people_needing_contact > 0) actions.add("run_contact_enrichment");

  // ---- discovery stages ----
  if (o.unused_query_packs.length > 0) actions.add("run_unused_query_pack");
  if (o.remaining_sources.length > 0) actions.add("advance_source");
  if (o.seniority_broadening_available) actions.add("broaden_direct_seniority");
  if (o.recency_broadening_available) actions.add("broaden_recency");

  // Adjacent tiers activate only once the exact packs have actually been tried.
  const exactTried = o.unused_query_packs.length === 0;
  if (exactTried && o.direct_adjacent_packs_available > 0) actions.add("activate_direct_adjacent_pack");
  // Evidence-gated is the last discovery rung: it needs the direct-adjacent tier
  // to be spent too, otherwise a weak-evidence pack pre-empts a strong one.
  if (exactTried && o.direct_adjacent_packs_available === 0 && o.evidence_gated_packs_available > 0) {
    actions.add("activate_evidence_gated_pack");
  }

  // ---- honest terminal ----
  if (actions.size === 0 || bottleneck === "source_exhausted") actions.add("stop_partial");

  return ADAPTIVE_ACTIONS.filter((a) => actions.has(a));
}

/**
 * Build the bounded observation.
 *
 * `companies_rejected` is derived here and nowhere else, so the units-mismatch
 * that produced phantom rejections cannot be reintroduced by a caller.
 */
export function buildSourceStepObservation(input: ObservationInput): SourceStepObservation {
  const resolved = nn(input.companies_resolved);
  const qualified = Math.min(nn(input.companies_qualified), resolved);
  const contactReady = nn(input.contact_ready_leads);
  const requested = nn(input.requested_leads);
  const remaining = Math.max(0, requested - contactReady);

  const { bottleneck } = classifyAdaptiveBottleneck({
    provider_rows: nn(input.provider_rows),
    title_matches: nn(input.title_matches),
    title_rejections: nn(input.title_rejections),
    companies_resolved: resolved,
    companies_qualified: qualified,
    decision_makers_verified: nn(input.decision_makers_verified),
    contact_ready_leads: contactReady,
    remaining_leads: remaining,
    people_needing_contact: nn(input.people_needing_contact),
    budget_remaining_usd: input.budget_remaining_usd,
    provider_calls_remaining: input.provider_calls_remaining,
    unused_query_packs: input.unused_query_packs,
    remaining_sources: input.remaining_sources,
  });

  return {
    source_step_id: input.source_step_id,
    source_capability: input.source_capability,
    query_pack_ids: [...input.query_pack_ids],
    titles_used: [...input.titles_used],
    semantic_filters: input.semantic_filters ?? {},
    provider_filters: input.provider_filters ?? {},
    provider_rows: nn(input.provider_rows),
    normalized_jobs: nn(input.normalized_jobs),
    jobs_within_recency_window: nn(input.jobs_within_recency_window),
    title_matches: nn(input.title_matches),
    title_rejections: nn(input.title_rejections),
    companies_resolved: resolved,
    companies_qualified: qualified,
    companies_rejected: resolved - qualified,
    company_rejection_reasons: input.company_rejection_reasons ?? {},
    decision_makers_verified: nn(input.decision_makers_verified),
    contact_ready_leads: contactReady,
    requested_leads: requested,
    remaining_leads: remaining,
    completed_query_packs: [...input.completed_query_packs],
    unused_query_packs: [...input.unused_query_packs],
    completed_sources: [...input.completed_sources],
    remaining_sources: [...input.remaining_sources],
    bottleneck,
    valid_next_actions: projectValidActions(input, bottleneck),
  };
}

/**
 * Assert the observation carries no raw provider payload.
 *
 * Used by tests: the observation is the only thing crossing to the model, so its
 * boundedness is a contract, not a habit.
 */
export function observationIsBounded(o: SourceStepObservation): boolean {
  const blob = JSON.stringify(o);
  if (blob.length > 8000) return false;
  const banned = ["jobDescription", "job_description", "description", "provider_payload", "raw", "apify"];
  return !banned.some((b) => blob.includes(b));
}
