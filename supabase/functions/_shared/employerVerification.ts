// Deterministic current-employer verification (5-valued).
//
// For a compound "founders of <company>" request, a person may only reach CONTACT
// when they CURRENTLY work at the exact target company. This never collapses to a
// boolean before the hard-gate decision — historical / ambiguous / conflicting
// cases are distinct so the gate can route them to WATCH/REJECT correctly.
// An AI model must not override this result.

import {
  resolveCompanyIdentity, strongSameCompany, hasStrongId, type CompanyIdentity,
} from "./companyIdentity.ts";
import { normalizeCompanyName } from "./companyIdentity.ts";

export type EmployerVerification =
  | "verified_match"
  | "verified_mismatch"
  | "historical_only"
  | "ambiguous"
  | "insufficient_evidence";

export interface PersonEmployment {
  currentCompany?: string | null;
  currentCompanyDomain?: string | null;
  currentCompanyLinkedinUrl?: string | null;
  /** Explicit present/current marker if the provider gives one. */
  isCurrent?: boolean | null;
  /** If the role has ended (ISO date in the past) it is historical. */
  endDate?: string | null;
  title?: string | null;
  /** Other companies the person CURRENTLY works at (name or {name,domain,linkedin}). */
  otherCurrent?: Array<string | { name?: string | null; domain?: string | null; linkedin_url?: string | null }>;
}

export interface EmployerVerifyResult {
  outcome: EmployerVerification;
  reason: string;
  matchedBy: "domain" | "linkedin" | "name" | "none";
}

function toId(v: string | { name?: string | null; domain?: string | null; linkedin_url?: string | null }): CompanyIdentity {
  return typeof v === "string" ? resolveCompanyIdentity({ name: v }) : resolveCompanyIdentity({ name: v.name, domain: v.domain, linkedin_url: v.linkedin_url });
}

export function verifyCurrentEmployer(
  person: PersonEmployment,
  target: CompanyIdentity,
  opts: { now?: string } = {},
): EmployerVerifyResult {
  const now = Date.parse(opts.now ?? new Date().toISOString());
  const anyEvidence = person.currentCompany || person.currentCompanyDomain || person.currentCompanyLinkedinUrl;
  if (!anyEvidence && (!person.otherCurrent || person.otherCurrent.length === 0)) {
    return { outcome: "insufficient_evidence", reason: "No current-employer evidence on the person.", matchedBy: "none" };
  }

  const primary = resolveCompanyIdentity({ name: person.currentCompany, domain: person.currentCompanyDomain, linkedin_url: person.currentCompanyLinkedinUrl });
  const others = (person.otherCurrent ?? []).map(toId);
  const currents = [primary, ...others];

  const isHistorical = person.isCurrent === false || (!!person.endDate && !Number.isNaN(Date.parse(person.endDate)) && Date.parse(person.endDate) < now);

  // 1) Strong identifier match against ANY current role → verified (unless the ONLY
  //    matching role is explicitly historical).
  const strong = currents.find((c) => strongSameCompany(c, target));
  if (strong) {
    if (isHistorical && currents.length === 1) {
      return { outcome: "historical_only", reason: "Matches the target but the role has ended.", matchedBy: strong.canonicalDomain ? "domain" : "linkedin" };
    }
    return { outcome: "verified_match", reason: "A current role strong-matches the target company.", matchedBy: strong.canonicalDomain ? "domain" : "linkedin" };
  }

  // 2) The PRIMARY current employer is a DIFFERENT strong company than the target
  //    → verified_mismatch (off-company / conflicting current employer).
  if (hasStrongId(primary) && hasStrongId(target) && !strongSameCompany(primary, target)) {
    return { outcome: "verified_mismatch", reason: "Primary current employer is a different (strongly identified) company.", matchedBy: "domain" };
  }

  // 3) Name-only relationship to the target.
  const targetName = target.normalizedName;
  const nameMatch = targetName ? currents.some((c) => c.normalizedName && c.normalizedName === targetName) : false;
  if (nameMatch) {
    if (isHistorical) return { outcome: "historical_only", reason: "Name matches the target but the role has ended.", matchedBy: "name" };
    // A similar name without a stronger identity cannot be confirmed as current.
    return { outcome: "ambiguous", reason: "Company name matches but no strong identifier confirms it is the same current employer.", matchedBy: "name" };
  }

  // 4) A named current employer that clearly differs from the target → mismatch.
  const primaryName = normalizeCompanyName(person.currentCompany);
  if (primaryName && targetName && primaryName !== targetName) {
    return { outcome: "verified_mismatch", reason: "Current employer name differs from the target.", matchedBy: "name" };
  }

  return { outcome: "insufficient_evidence", reason: "Current-employer evidence is incomplete.", matchedBy: "none" };
}

/** Does this verification satisfy the CONTACT hard gate? Only a proven current match. */
export function employerGatePasses(outcome: EmployerVerification): boolean {
  return outcome === "verified_match";
}
/** Ambiguous/insufficient → review; explicit mismatch/historical → reject. */
export function employerGateDisposition(outcome: EmployerVerification): "pass" | "review" | "reject" {
  if (outcome === "verified_match") return "pass";
  if (outcome === "ambiguous" || outcome === "insufficient_evidence") return "review";
  return "reject"; // verified_mismatch | historical_only
}
