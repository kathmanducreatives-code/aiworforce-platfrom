// WHO IS WORTH ASKING A MODEL ABOUT.
//
// WHY THIS EXISTS.
//
// Semantic evaluation costs a model call per company, and the allowance is
// small. Spending one on a company that a FREE check already disqualifies —
// wrong country, twice the employee ceiling, an identity that never resolved —
// is money spent to be told what was already known, and it displaces a company
// the model could have helped with.
//
// THE ASYMMETRY THAT MATTERS.
//
// A gate here removes a company from evaluation ENTIRELY, so the cost of a
// wrong gate is a good lead silently never considered. That is why only
// VERIFIED contradictions gate:
//
//   * a verified geography mismatch gates; an unknown geography does not;
//   * a verified size mismatch gates; an unknown headcount does not;
//   * a provider FAILURE never gates — it is the reason we do not know, and
//     treating it as a negative is how an outage becomes a rejection.
//
// Everything uncertain flows through to evaluation and comes back REVIEW, which
// asks a human. Missing evidence must never become a verified negative.
//
// PURE. No network, provider, model or database access.

import { geographyVerdict } from "./geographyResolver.ts";
import { bandSatisfies } from "./companySize.ts";
import type { EvidenceRegistry } from "./leadEvidenceRegistry.ts";
import type { LeadMissionV1 } from "./leadMission.ts";

export const ELIGIBLE_POOL_VERSION = "lead-eligible-pool-v1" as const;

export type ExclusionReason =
  | "duplicate_company"
  | "identity_unresolved"
  | "identity_mismatch"
  | "verified_geography_mismatch"
  | "verified_employee_size_mismatch"
  | "inactive_company"
  | "explicit_business_model_mismatch"
  | "rejected_provider_record"
  | "insufficient_evidence_to_evaluate";

export interface PoolCandidate {
  company_key: string;
  company_name: string | null;
  registry: EvidenceRegistry;
  /** Set when discovery already produced a terminal provider rejection. */
  provider_rejected?: boolean;
  /** Explicit consumer-only evidence, established deterministically. */
  verified_consumer_only?: boolean;
  active?: boolean;
}

export interface ExcludedCandidate {
  company_key: string;
  company_name: string | null;
  reason: ExclusionReason;
  detail: string;
}

export interface EligiblePool {
  version: typeof ELIGIBLE_POOL_VERSION;
  eligible: PoolCandidate[];
  excluded: ExcludedCandidate[];
  metrics: {
    discovered: number;
    hard_gated: number;
    eligible: number;
    /** Reason → count. The answer to "why was this company not pursued?". */
    exclusion_reasons: Record<string, number>;
  };
}

export interface PoolGateOptions {
  mission: LeadMissionV1;
  /** Identity must resolve before a company may be evaluated. */
  requireResolvedIdentity?: boolean;
  employee_min?: number | null;
  employee_max?: number | null;
  /**
   * RETIRED (2026-09-24). A tolerance absorbed noise in a count read as staff;
   * size now gates on the DECLARED band, which is wholly outside a range or it
   * is not. Accepted and ignored so older callers still compile.
   */
  ceiling_tolerance?: number;
}

/** A registry with nothing to read cannot be meaningfully evaluated. */
function hasMinimumEvidence(r: EvidenceRegistry): boolean {
  // A description, a YC record, a website or an opening — any ONE of these is
  // something to reason about. Industry alone is not: a broad vendor label has
  // never established anything, which is why the claim verifier refuses it as
  // sole proof, and asking a model to judge on it alone buys a guess.
  return r.items.some((x) =>
    x.evidence_type === "company_description" ||
    x.evidence_type === "yc_company_record" ||
    x.evidence_type === "company_website" ||
    x.evidence_type === "job_posting" ||
    x.evidence_type === "yc_job");
}

/**
 * Does the established geography CONTRADICT the mission's required one?
 *
 * ── THE THREE-VALUED RULE, MADE STRUCTURAL ──────────────────────────────────
 *
 * Returns false whenever either side is unknown. "We could not establish where
 * they are" is not "they are in the wrong place", and gating on the first would
 * remove every company whose enrichment happened to omit a location. A required
 * geography the resolver cannot place does not contradict anything either.
 *
 * The rule lives in ONE place, `geographyResolver.ts`: this asks it whether the
 * location is OUTSIDE the requirement. Whether it is INSIDE (qualification) is a
 * different question with a different answer for "cannot tell" — conflating the
 * two let an unrecognised place ("Atlantis", "Texas") qualify any HQ (D5).
 */
export function geographyContradicts(
  established: string | null, required: readonly string[],
): boolean {
  return geographyVerdict(established, required) === "contradict";
}

/**
 * Build the pool.
 *
 * ORDER MATTERS. Duplicates are removed first so a company excluded for a real
 * reason is reported once, under that reason, rather than as a duplicate of
 * itself.
 */
export function buildEligiblePool(
  candidates: readonly PoolCandidate[], opts: PoolGateOptions,
): EligiblePool {
  const eligible: PoolCandidate[] = [];
  const excluded: ExcludedCandidate[] = [];
  const seen = new Set<string>();
  const requiredGeo = opts.mission.company_profile.locations ?? [];

  const drop = (c: PoolCandidate, reason: ExclusionReason, detail: string) =>
    excluded.push({
      company_key: c.company_key, company_name: c.company_name, reason, detail,
    });

  for (const c of candidates) {
    if (seen.has(c.company_key)) {
      drop(c, "duplicate_company", "already present in the pool");
      continue;
    }
    seen.add(c.company_key);

    const f = c.registry.hard_facts;

    if (c.provider_rejected) {
      drop(c, "rejected_provider_record", "the provider record was rejected at normalization");
      continue;
    }
    if (c.active === false) {
      drop(c, "inactive_company", "the company is not active");
      continue;
    }
    if (f.identity_state === "mismatch") {
      drop(c, "identity_mismatch", "the resolved identity belongs to another company");
      continue;
    }
    if (opts.requireResolvedIdentity && f.identity_state !== "resolved") {
      drop(c, "identity_unresolved", `identity is ${f.identity_state}`);
      continue;
    }
    if (geographyContradicts(f.geography, requiredGeo)) {
      drop(c, "verified_geography_mismatch",
        `established "${f.geography}" is outside ${requiredGeo.join(", ")}`);
      continue;
    }
    // ONLY A DECLARED BAND WHOLLY OUTSIDE THE RANGE GATES (companySize.ts).
    // No band, a partial overlap or an exact count is a REVIEW question, not
    // an exclusion; the LinkedIn associated-member count is never read here.
    if (f.company_size_band != null && (opts.employee_min != null || opts.employee_max != null)) {
      const v = bandSatisfies({ min: opts.employee_min ?? null, max: opts.employee_max ?? null }, f.company_size_band);
      if (v.verdict === "fail") {
        drop(c, "verified_employee_size_mismatch", v.reason);
        continue;
      }
    }
    if (c.verified_consumer_only && requiresB2B(opts.mission)) {
      drop(c, "explicit_business_model_mismatch",
        "verified consumer-only, and the mission requires B2B");
      continue;
    }
    if (!hasMinimumEvidence(c.registry)) {
      drop(c, "insufficient_evidence_to_evaluate",
        "no description, cohort record, site or opening to reason about");
      continue;
    }
    eligible.push(c);
  }

  const exclusion_reasons: Record<string, number> = {};
  for (const e of excluded) {
    exclusion_reasons[e.reason] = (exclusion_reasons[e.reason] ?? 0) + 1;
  }

  return {
    version: ELIGIBLE_POOL_VERSION,
    eligible,
    excluded,
    metrics: {
      discovered: candidates.length,
      hard_gated: excluded.length,
      eligible: eligible.length,
      exclusion_reasons,
    },
  };
}

/** Does this mission demand a business buyer? */
export function requiresB2B(m: LeadMissionV1): boolean {
  const hay = [
    ...m.company_profile.verticals, ...m.company_profile.business_models,
    m.original_user_query,
  ].join(" ").toLowerCase();
  return /\bb2b\b|\bsaas\b|\benterprise\b|\bbusiness\b/.test(hay);
}
