// HARD vs SOFT SOURCING CONSTRAINTS.
//
// A planner may only ever widen SOFT constraints. Hard constraints are the user's
// actual requirements — vertical, geography, job family, requested person roles,
// employer verification and evidence — and no proposed strategy may alter them.
// Hashing them lets the validator prove they did not change between rounds.

import type { LeadEntityIntent } from "./leadEntityIntent.ts";
import { inferFamilyKey } from "./jobFamilyRegistry.ts";
import { canonicalJson, sha256Hex } from "./planHash.ts";

export type ConstraintProvenance = "user_explicit" | "intent_inferred" | "workflow_default" | "policy_default";

export interface HardConstraints {
  /** Registry family key, or null when the request is an unknown family. */
  jobFamilyKey: string | null;
  /** The literal titles the user asked for — always searchable. */
  requestedTitles: string[];
  geography: string | null;
  companyVertical: string | null;
  requestedPersonRoles: string[];
  requireCurrentEmployerVerification: boolean;
  requireEvidence: boolean;
  excludedTitles: string[];
  /**
   * The request said "do not broaden", "strictly", "exactly N", or similar —
   * from `spec.no_broadening_requested` (jobSearchSpec.ts), which reuses
   * `parseStrictConstraints` rather than re-detecting the phrase here.
   *
   * Being a field on `HardConstraints` is what does the enforcement: it
   * participates in the same byte-identical hash comparison every other hard
   * constraint already goes through in `broadeningValidator.ts`, so once true
   * it cannot silently become false in a later round without the existing
   * `hard_constraints_changed` violation catching it. No new validator logic
   * was written for this field.
   */
  noBroadeningRequested: boolean;
}

export interface SoftConstraints {
  titleVariantsAllowed: boolean;
  adjacentTitlesAllowed: boolean;
  postingWindowDays: number | null;
  maxRawJobs: number;
  maxCompanies: number;
  maxPeopleLookups: number;
  peoplePerCompany: number;
  approvedActorKeys: string[];
}

export interface SourcingConstraints {
  hard: HardConstraints;
  soft: SoftConstraints;
  provenance: Record<string, ConstraintProvenance>;
  hardHash: string;
}

export const APPROVED_ACTOR_KEYS = ["apify_jobs", "apify_people_search"] as const;

export async function buildSourcingConstraints(
  intent: LeadEntityIntent,
  opts: { maxRawJobs?: number; maxCompanies?: number; maxPeopleLookups?: number; peoplePerCompany?: number } = {},
): Promise<SourcingConstraints> {
  const spec = intent.job_search_spec;
  const familyKey = inferFamilyKey(spec.job_families as string[], spec.keyword_queries, spec.original_query);

  const hard: HardConstraints = {
    jobFamilyKey: familyKey,
    requestedTitles: [...spec.keyword_queries],
    geography: spec.location,
    companyVertical: spec.company_vertical,
    requestedPersonRoles: [...spec.requested_person_roles],
    requireCurrentEmployerVerification: intent.company_gate_required,
    requireEvidence: true,
    excludedTitles: [],
    noBroadeningRequested: spec.no_broadening_requested,
  };

  const soft: SoftConstraints = {
    titleVariantsAllowed: true,
    adjacentTitlesAllowed: familyKey != null,      // unknown family → no adjacency
    postingWindowDays: null,
    maxRawJobs: opts.maxRawJobs ?? 25,
    maxCompanies: opts.maxCompanies ?? 10,
    maxPeopleLookups: opts.maxPeopleLookups ?? 8,
    peoplePerCompany: opts.peoplePerCompany ?? 2,
    approvedActorKeys: [...APPROVED_ACTOR_KEYS],
  };

  const provenance: Record<string, ConstraintProvenance> = {
    jobFamilyKey: familyKey ? "intent_inferred" : "policy_default",
    requestedTitles: "user_explicit",
    geography: spec.location ? "user_explicit" : "policy_default",
    companyVertical: spec.company_vertical ? "intent_inferred" : "policy_default",
    requestedPersonRoles: spec.requested_person_roles.length ? "intent_inferred" : "policy_default",
    requireCurrentEmployerVerification: "policy_default",
    requireEvidence: "policy_default",
    noBroadeningRequested: spec.no_broadening_requested ? "user_explicit" : "policy_default",
    maxRawJobs: "workflow_default",
    maxCompanies: "workflow_default",
    maxPeopleLookups: "workflow_default",
    peoplePerCompany: "workflow_default",
    approvedActorKeys: "policy_default",
  };

  return { hard, soft, provenance, hardHash: await hashHardConstraints(hard) };
}

export function hashHardConstraints(hard: HardConstraints): Promise<string> {
  return sha256Hex(canonicalJson(hard));
}

/** True when two hard-constraint sets are byte-identical after canonicalization. */
export async function hardConstraintsUnchanged(a: HardConstraints, b: HardConstraints): Promise<boolean> {
  return (await hashHardConstraints(a)) === (await hashHardConstraints(b));
}
