// Decision-maker pipeline: shortcut → bounded search → normalize → verify →
// classify → rank → truthful outcome. Pure and provider-independent.
//
// The provider is injected as a function, so the whole flow is testable without
// a network call. The pipeline never widens a search to avoid an empty result:
// an honest no_match is a better answer than a plausible stranger.

import { resolveCompanyIdentity, type CompanyIdentity, type CompanyIdentityInput } from "./companyIdentity.ts";
import {
  normalizeProviderProfile,
  dedupeProfiles,
  personLinkedInSlug,
  type NormalizedPersonProfile,
  type RawProviderProfile,
} from "./personProfile.ts";
import { verifyCurrentEmployer, type EmployerVerification } from "./employerVerification.ts";
import { classifyDecisionMakerRole, isTargetRoleFamily, type DecisionMakerRoleFamily } from "./roleFamily.ts";
import { rankCandidates, companySizeBand, type CompanySizeBand, type RankComponents } from "./ranking.ts";
import { planPeopleSearch, fallbackStages, type PeopleSearchPlan, type SearchStage } from "./searchPlanner.ts";

export type DecisionMakerOutcome =
  | "succeeded"
  | "no_match"
  | "missing_company_identity"
  | "needs_manual_review"
  | "unavailable"
  | "timed_out"
  | "failed";

export interface AcceptedDecisionMaker {
  full_name: string | null;
  linkedin_url: string | null;
  current_title: string | null;
  current_company_name: string | null;
  role_family: DecisionMakerRoleFamily;
  verification_status: EmployerVerification["status"];
  verification_methods: EmployerVerification["match_methods"];
  confidence: "high" | "medium" | "low";
  rank: number;
  rank_reasons: string[];
  score: RankComponents;
}

/** A dropped candidate, kept for honest reporting in the UI. */
export interface RejectedProfile {
  full_name: string | null;
  linkedin_url: string | null;
  current_title: string | null;
  current_company_name: string | null;
  reason_code: string;
}

export interface RejectionSummary {
  off_company: number;
  former_employee: number;
  role_not_target: number;
  malformed_profile: number;
  unverified: number;
}

export interface DecisionMakerObservability {
  request_mode: "direct_lead_action";
  identity_strength: CompanyIdentity["identity_strength"];
  stage_run: SearchStage | null;
  actor_selected: string | null;
  provider_attempted: string | null;
  provider_status: ProviderStatus | null;
  provider_run_id: string | null;
  raw_returned_count: number;
  normalized_count: number;
  duplicate_count: number;
  employer_rejected_count: number;
  role_rejected_count: number;
  verified_count: number;
  manual_review_count: number;
  persisted_count: number;
  final_outcome: DecisionMakerOutcome;
  duration_class: "fast" | "normal" | "slow" | "unknown";
}

export interface DecisionMakerResult {
  lead_candidate_id: string;
  status: DecisionMakerOutcome;
  reason_code: string;
  retryable: boolean;
  company_identity: CompanyIdentity;
  provider_attempted: string | null;
  provider_run_id: string | null;
  returned_profile_count: number;
  verified_profile_count: number;
  rejected_profile_count: number;
  manual_review_count: number;
  decision_makers: AcceptedDecisionMaker[];
  rejected_profiles: RejectedProfile[];
  rejection_summary: RejectionSummary;
  observability: DecisionMakerObservability;
}

export type ProviderStatus = "ok" | "unavailable" | "timed_out" | "failed";

export interface ProviderResponse {
  status: ProviderStatus;
  profiles?: RawProviderProfile[];
  run_id?: string | null;
  /** Sanitized code only — never a raw provider error string. */
  error_code?: string | null;
}

export type PeopleSearchProvider = (plan: PeopleSearchPlan) => Promise<ProviderResponse>;

export interface PipelineInput {
  lead_candidate_id: string;
  identity_input: CompanyIdentityInput;
  employee_count?: unknown;
  /** Credible person already attached to the lead (job poster, founder metadata). */
  known_person?: RawProviderProfile | null;
  max_results?: number;
  geography?: string[];
}

const MAX_RETURNED = 3;

function completeness(p: NormalizedPersonProfile): number {
  const fields = [p.full_name, p.linkedin_url, p.current_title, p.current_company_name, p.headline, p.location];
  return fields.filter(Boolean).length / fields.length;
}

interface Evaluated {
  profile: NormalizedPersonProfile;
  verification: EmployerVerification;
  role_family: DecisionMakerRoleFamily;
  seniority: string;
  from_direct_source: boolean;
}

function emptyRejections(): RejectionSummary {
  return { off_company: 0, former_employee: 0, role_not_target: 0, malformed_profile: 0, unverified: 0 };
}

/**
 * Evaluate one profile: normalize → verify employer → classify role.
 * Order matters — role is only meaningful once we know the person is actually
 * there, and an off-company person is rejected regardless of how good the title
 * looks.
 */
function evaluate(
  profile: NormalizedPersonProfile,
  identity: CompanyIdentity,
  fromDirect: boolean,
  rejections: RejectionSummary,
  rejected: RejectedProfile[],
): Evaluated | null {
  const drop = (reason_code: string) => {
    rejected.push({
      full_name: profile.full_name,
      linkedin_url: profile.linkedin_url,
      current_title: profile.current_title,
      current_company_name: profile.current_company_name,
      reason_code,
    });
    return null;
  };

  if (profile.rejection_reasons.includes("invalid_profile_url") || !profile.linkedin_url) {
    rejections.malformed_profile += 1;
    return drop("invalid_profile_url");
  }

  const verification = verifyCurrentEmployer(profile, identity);
  if (verification.status === "rejected") {
    if (verification.rejection_reasons.includes("target_company_only_in_past_experience")) {
      rejections.former_employee += 1;
    } else {
      rejections.off_company += 1;
    }
    return drop(verification.rejection_reasons[0] ?? "off_company");
  }
  if (verification.status === "unverified") {
    rejections.unverified += 1;
    return drop(verification.rejection_reasons[0] ?? "employer_unverified");
  }

  const role = classifyDecisionMakerRole(profile.current_title ?? profile.headline);
  if (!isTargetRoleFamily(role.role_family)) {
    rejections.role_not_target += 1;
    return drop(role.disqualified_by ?? "role_not_target");
  }

  return {
    profile,
    verification,
    role_family: role.role_family,
    seniority: role.seniority,
    from_direct_source: fromDirect,
  };
}

function toAccepted(e: Evaluated, rank: number, score: RankComponents, reasons: string[]): AcceptedDecisionMaker {
  return {
    full_name: e.profile.full_name,
    linkedin_url: e.profile.linkedin_url,
    current_title: e.profile.current_title,
    current_company_name: e.profile.current_company_name,
    role_family: e.role_family,
    verification_status: e.verification.status,
    verification_methods: e.verification.match_methods,
    confidence: e.verification.confidence,
    rank,
    rank_reasons: reasons,
    score,
  };
}

/**
 * Run the decision-maker flow for one lead.
 *
 * `provider` is injected; in tests it returns fixtures, so no network or provider
 * call ever occurs.
 */
export async function findDecisionMakers(
  input: PipelineInput,
  provider: PeopleSearchProvider,
): Promise<DecisionMakerResult> {
  const identity = resolveCompanyIdentity(input.identity_input);
  const band: CompanySizeBand = companySizeBand(input.employee_count);
  const rejections = emptyRejections();
  const rejected_profiles: RejectedProfile[] = [];

  const obs: DecisionMakerObservability = {
    request_mode: "direct_lead_action",
    identity_strength: identity.identity_strength,
    stage_run: null,
    actor_selected: null,
    provider_attempted: null,
    provider_status: null,
    provider_run_id: null,
    raw_returned_count: 0,
    normalized_count: 0,
    duplicate_count: 0,
    employer_rejected_count: 0,
    role_rejected_count: 0,
    verified_count: 0,
    manual_review_count: 0,
    persisted_count: 0,
    final_outcome: "failed",
    duration_class: "unknown",
  };

  const finish = (
    status: DecisionMakerOutcome,
    reason_code: string,
    retryable: boolean,
    accepted: AcceptedDecisionMaker[] = [],
    manualReview = 0,
  ): DecisionMakerResult => {
    obs.final_outcome = status;
    obs.employer_rejected_count = rejections.off_company + rejections.former_employee;
    obs.role_rejected_count = rejections.role_not_target;
    obs.verified_count = accepted.filter((a) => a.verification_status === "verified").length;
    obs.manual_review_count = manualReview;
    return {
      lead_candidate_id: input.lead_candidate_id,
      status,
      reason_code,
      retryable,
      company_identity: identity,
      provider_attempted: obs.provider_attempted,
      provider_run_id: obs.provider_run_id,
      returned_profile_count: obs.raw_returned_count,
      verified_profile_count: obs.verified_count,
      rejected_profile_count:
        rejections.off_company + rejections.former_employee + rejections.role_not_target +
        rejections.malformed_profile + rejections.unverified,
      manual_review_count: manualReview,
      decision_makers: accepted,
      rejected_profiles,
      rejection_summary: rejections,
      observability: obs,
    };
  };

  // ---- Stage 1: direct known-person shortcut --------------------------------
  // A job poster is NOT automatically the decision-maker — it must still pass
  // company + employment + role verification like any search result.
  if (input.known_person) {
    obs.stage_run = "direct_known_person";
    const normalized = normalizeProviderProfile(input.known_person, { provider: "lead_record", actor: "known_person" });
    obs.normalized_count = 1;
    const evaluated = evaluate(normalized, identity, true, rejections, rejected_profiles);
    if (evaluated && evaluated.verification.status === "verified") {
      const ranked = rankCandidates(
        [{
          candidate: evaluated,
          input: {
            role_family: evaluated.role_family,
            seniority: evaluated.seniority,
            verification_status: evaluated.verification.status,
            profile_completeness: completeness(evaluated.profile),
            from_direct_source: true,
          },
        }],
        band,
        MAX_RETURNED,
      );
      const accepted = ranked.map((r) => toAccepted(r.candidate, r.rank, r.score, r.rank_reasons));
      return finish("succeeded", "decision_maker_found", false, accepted);
    }
    // Shortcut did not verify — fall through to the bounded search rather than
    // returning a guess.
  }

  // ---- Identity gate --------------------------------------------------------
  if (!identity.search_ready) {
    return finish(
      "missing_company_identity",
      identity.identity_strength === "missing" ? "company_identity_missing" : "company_domain_missing",
      false,
    );
  }

  // ---- Stage 2/3: bounded provider search ----------------------------------
  const stages = fallbackStages(identity).filter(
    (s): s is "company_employee_search" | "domain_people_search" =>
      s === "company_employee_search" || s === "domain_people_search",
  );

  const evaluated: Evaluated[] = [];
  let lastStatus: ProviderStatus | null = null;
  let lastFailure: { status: ProviderStatus; error_code: string | null } | null = null;
  // Dedupe ACROSS stages, not just within one. The fallback stages routinely
  // return the same person, and per-stage dedupe would count them twice —
  // inflating manual_review_count and the rejection tallies.
  const seenSlugs = new Set<string>();

  for (const stage of stages) {
    const planned = planPeopleSearch(identity, stage, {
      maxResults: input.max_results,
      geography: input.geography,
    });
    if (!planned.ok) continue;

    obs.stage_run = stage;
    obs.actor_selected = planned.plan.actor_key;
    obs.provider_attempted = planned.plan.provider;

    const res = await provider(planned.plan);
    lastStatus = res.status;
    obs.provider_status = res.status;
    obs.provider_run_id = res.run_id ?? null;

    // A single unavailable/failed ACTOR must not mask a working later stage: an
    // unconfigured company-page actor would otherwise report "people search is
    // disabled" even though the domain actor is configured and would have found
    // the person. Only give up when every stage has been tried.
    if (res.status !== "ok") {
      lastFailure = { status: res.status, error_code: res.error_code ?? null };
      continue;
    }

    const raw = Array.isArray(res.profiles) ? res.profiles : [];
    obs.raw_returned_count += raw.length;

    const normalized = raw.map((r) =>
      normalizeProviderProfile(r, { provider: planned.plan.provider, actor: planned.plan.actor_key })
    );
    const { unique, duplicate_count } = dedupeProfiles(normalized);
    obs.duplicate_count += duplicate_count;

    for (const p of unique) {
      const slug = personLinkedInSlug(p.linkedin_url);
      if (slug) {
        if (seenSlugs.has(slug)) { obs.duplicate_count += 1; continue; }
        seenSlugs.add(slug);
      }
      obs.normalized_count += 1;
      const ev = evaluate(p, identity, false, rejections, rejected_profiles);
      if (ev) evaluated.push(ev);
    }

    // Stop as soon as a stage yields a verified candidate — no extra provider
    // spend once the question is answered.
    if (evaluated.some((e) => e.verification.status === "verified")) break;
  }

  // ---- Outcome -------------------------------------------------------------
  const verified = evaluated.filter((e) => e.verification.status === "verified");
  const probable = evaluated.filter((e) => e.verification.status === "probable");

  if (verified.length > 0) {
    const ranked = rankCandidates(
      verified.map((e) => ({
        candidate: e,
        input: {
          role_family: e.role_family,
          seniority: e.seniority,
          verification_status: e.verification.status,
          profile_completeness: completeness(e.profile),
          from_direct_source: e.from_direct_source,
        },
      })),
      band,
      MAX_RETURNED,
    );
    const accepted = ranked.map((r) => toAccepted(r.candidate, r.rank, r.score, r.rank_reasons));
    return finish("succeeded", "decision_maker_found", false, accepted);
  }

  if (probable.length > 0) {
    // Probable people are surfaced for a human, never auto-persisted.
    return finish("needs_manual_review", "employment_unverified", false, [], probable.length);
  }

  // Every stage failed at the provider boundary — report the real reason.
  if (evaluated.length === 0 && lastFailure) {
    if (lastFailure.status === "unavailable") {
      return finish("unavailable", lastFailure.error_code ?? "people_search_disabled", false);
    }
    if (lastFailure.status === "timed_out") return finish("timed_out", "provider_timed_out", true);
    return finish("failed", lastFailure.error_code ?? "provider_failed", true);
  }

  if (lastStatus === null) {
    // No stage was runnable despite a search-ready identity.
    return finish("missing_company_identity", "company_domain_missing", false);
  }

  return finish("no_match", obs.raw_returned_count === 0 ? "provider_no_results" : "company_match_failed", false);
}
