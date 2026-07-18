// Current-employer verification. Pure + dependency-free.
//
// This is the guard that decides whether a person actually works at the target
// company RIGHT NOW. The old logic accepted a normalized-name match (and even a
// headline mention) as sufficient, which admits:
//   - former employees whose past experience names the company
//   - different companies with a similar name
//   - consultants/recruiters whose headline mentions their clients
//
// Verified is deliberately hard to reach: only an identifier match (company
// LinkedIn URL or domain) verifies. Name evidence alone can reach "probable" at
// best, which routes to manual review rather than persistence.

import {
  companyLinkedInSlug,
  normalizeCompanyName,
  normalizeDomain,
  type CompanyIdentity,
} from "./companyIdentity.ts";
import type { NormalizedPersonProfile } from "./personProfile.ts";

export type EmployerVerificationStatus = "verified" | "probable" | "unverified" | "rejected";

export type MatchMethod =
  | "company_linkedin_url"
  | "company_domain"
  | "company_name_with_corroboration";

export interface EmployerVerification {
  status: EmployerVerificationStatus;
  match_methods: MatchMethod[];
  confidence: "high" | "medium" | "low";
  rejection_reasons: string[];
}

function sameSlug(a: unknown, b: unknown): boolean {
  const x = companyLinkedInSlug(a);
  const y = companyLinkedInSlug(b);
  return !!x && !!y && x === y;
}

function sameDomain(a: unknown, b: unknown): boolean {
  const x = normalizeDomain(a);
  const y = normalizeDomain(b);
  return !!x && !!y && x === y;
}

function sameName(a: unknown, b: unknown): boolean {
  const x = normalizeCompanyName(a);
  const y = normalizeCompanyName(b);
  return !!x && !!y && x === y;
}

/**
 * Does the target company appear ONLY in the person's past experience?
 * Distinguishing this from "no evidence at all" matters: a former employee is a
 * confident rejection, not an inconclusive one.
 */
function targetOnlyInPast(profile: NormalizedPersonProfile, target: CompanyIdentity): boolean {
  const past = profile.experience.filter((e) => !e.is_current);
  const matchesTarget = (e: { company_linkedin_url: string | null; company_domain: string | null; company_name: string | null }) =>
    sameSlug(e.company_linkedin_url, target.company_linkedin_url) ||
    sameDomain(e.company_domain, target.domain) ||
    sameName(e.company_name, target.company_name);

  const inPast = past.some(matchesTarget);
  const inCurrent = profile.experience.filter((e) => e.is_current).some(matchesTarget);
  return inPast && !inCurrent;
}

/**
 * Verify that `profile` currently works at `target`.
 *
 * verified  → current company LinkedIn URL or domain matches the target's
 * probable  → current company NAME matches AND a second signal corroborates,
 *             but no identifier confirms it
 * rejected  → evidence positively contradicts (different current employer, or
 *             target appears only in past experience)
 * unverified→ no usable current-employment evidence either way
 */
export function verifyCurrentEmployer(
  profile: NormalizedPersonProfile,
  target: CompanyIdentity,
): EmployerVerification {
  const rejection_reasons: string[] = [];
  const match_methods: MatchMethod[] = [];

  if (!target.search_ready && target.identity_strength !== "strong") {
    // Cannot verify against an identity we could not resolve.
    return {
      status: "unverified",
      match_methods: [],
      confidence: "low",
      rejection_reasons: ["target_identity_too_weak"],
    };
  }

  // --- Strong identifier matches -------------------------------------------
  if (sameSlug(profile.current_company_linkedin_url, target.company_linkedin_url)) {
    match_methods.push("company_linkedin_url");
  }
  if (sameDomain(profile.current_company_domain, target.domain)) {
    match_methods.push("company_domain");
  }
  if (match_methods.length > 0) {
    return { status: "verified", match_methods, confidence: "high", rejection_reasons: [] };
  }

  // --- Contradicting evidence ----------------------------------------------
  // A current employer identified as some OTHER company is a rejection, not an
  // absence of evidence.
  const currentSlug = companyLinkedInSlug(profile.current_company_linkedin_url);
  const targetSlug = companyLinkedInSlug(target.company_linkedin_url);
  if (currentSlug && targetSlug && currentSlug !== targetSlug) {
    rejection_reasons.push("current_employer_is_another_company");
  }
  const currentDomain = normalizeDomain(profile.current_company_domain);
  if (currentDomain && target.domain && currentDomain !== target.domain) {
    // Same name but different domain is the classic impostor case.
    if (sameName(profile.current_company_name, target.company_name)) {
      rejection_reasons.push("similar_name_different_domain");
    } else {
      rejection_reasons.push("current_employer_is_another_company");
    }
  }
  if (targetOnlyInPast(profile, target)) {
    rejection_reasons.push("target_company_only_in_past_experience");
  }
  if (rejection_reasons.length > 0) {
    return { status: "rejected", match_methods: [], confidence: "low", rejection_reasons };
  }

  // --- Name-only evidence ---------------------------------------------------
  if (sameName(profile.current_company_name, target.company_name)) {
    // Corroboration = the profile independently supports current employment.
    const corroborated =
      profile.experience.some(
        (e) => e.is_current && sameName(e.company_name, target.company_name),
      ) ||
      (!!profile.headline &&
        !!target.normalized_company_name &&
        normalizeCompanyName(profile.headline)?.includes(target.normalized_company_name) === true);

    if (corroborated) {
      match_methods.push("company_name_with_corroboration");
      return { status: "probable", match_methods, confidence: "medium", rejection_reasons: [] };
    }
    return {
      status: "unverified",
      match_methods: [],
      confidence: "low",
      rejection_reasons: ["company_name_match_without_corroboration"],
    };
  }

  return {
    status: "unverified",
    match_methods: [],
    confidence: "low",
    rejection_reasons: ["no_current_employment_evidence"],
  };
}
