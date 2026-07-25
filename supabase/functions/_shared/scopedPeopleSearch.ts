// Company-scoped people-search preparation (Phase 4).
//
// For a company_first request, founders are searched INSIDE each verified company
// — never as a generic global "founders" query. This builds the scope carrying the
// strongest company identifier + the requested role + the source job, so a result
// returned for company A can never be silently attached to company B, and two
// similarly-named companies stay distinguishable.

import { hasStrongId, type CompanyIdentity } from "./companyIdentity.ts";

export interface PeopleSearchScope {
  companyName: string | null;
  companyDomain: string | null;
  companyLinkedinUrl: string | null;
  companyLinkedinId: string | null;
  companyDedupeKey: string | null;
  requestedRole: string | null;
  location: string | null;
  sourceJobId: string | null;
  queryIntent: string;
  /** Which identifier the scope is keyed on (strongest available). */
  scopedBy: "linkedin_id" | "linkedin_url" | "domain" | "name_location";
}

export interface BuildScopeOpts {
  requestedRole: string | null;
  queryIntent: string;
  location?: string | null;
  sourceJobId?: string | null;
  /** When true, a company with only a weak (name) identity may still be scoped
   *  (kept false by default: a name-only company is NOT verified enough). */
  allowNameOnly?: boolean;
}

/**
 * Build a people-search scope for ONE verified company, or null when the company
 * lacks a strong enough identity to search safely (an unverified company must not
 * trigger a qualified founder lookup).
 */
export function buildPeopleScope(company: CompanyIdentity, opts: BuildScopeOpts): PeopleSearchScope | null {
  const strong = hasStrongId(company);
  if (!strong && !opts.allowNameOnly) return null;
  if (!strong && !company.normalizedName) return null;

  const scopedBy: PeopleSearchScope["scopedBy"] =
    company.linkedinCompanyId ? "linkedin_id"
      : company.linkedinUrl ? "linkedin_url"
        : company.canonicalDomain ? "domain"
          : "name_location";

  return {
    companyName: company.name,
    companyDomain: company.canonicalDomain,
    companyLinkedinUrl: company.linkedinUrl,
    companyLinkedinId: company.linkedinCompanyId,
    companyDedupeKey: company.dedupeKey,
    requestedRole: opts.requestedRole,
    location: opts.location ?? company.location ?? null,
    sourceJobId: opts.sourceJobId ?? null,
    queryIntent: opts.queryIntent,
    scopedBy,
  };
}

/** True when a people RESULT (its resolved company key) belongs to the scope's
 *  company — used so a result for company A never attaches to company B. */
export function resultBelongsToScope(scope: PeopleSearchScope, resultCompanyDedupeKey: string | null | undefined): boolean {
  if (!scope.companyDedupeKey || !resultCompanyDedupeKey) return false;
  return scope.companyDedupeKey === resultCompanyDedupeKey;
}
