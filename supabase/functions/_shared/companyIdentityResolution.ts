// CANONICAL COMPANY IDENTITY — the bridge memo23 cannot build.
//
// The YC Actor supplies no LinkedIn company URL at all. Everything downstream is
// keyed on LinkedIn identity: enrichment, job verification, founder search and
// employer verification. So a YC candidate must be resolved to a LinkedIn
// company before it can be qualified.
//
// The rule that matters: a NAME MATCH IS NOT AN IDENTITY. "Triomics" and
// "Triomics Solutions" are different companies, and accepting a similar name
// would attach a real founder to the wrong employer — a mistake that looks like
// a working lead all the way to the recipient's inbox.
//
// So a match is only `verified_match` when a DOMAIN confirms it, or when the
// candidate already carried a canonical LinkedIn URL. Everything else is
// `ambiguous` or `unresolved`, which is pending evidence, never a rejection and
// never an input to founder search.
//
// NAMING: the pipeline already has a `resolveCompanyIdentity` that NORMALISES a
// single company's own fields. This answers a different question — which of
// several company-details LOOKUP RESULTS is actually this company — so it is
// named `resolveIdentityAgainstLookups` to keep the two distinguishable.
//
// Pure. No I/O — candidate lookups are injected.

import { normalizeCompanyLinkedInUrl, normalizeWebsite } from "./structuredCompanyEnrichment.ts";

export type IdentityStatus = "verified_match" | "ambiguous" | "mismatch" | "unresolved";

export interface IdentityCandidateInput {
  company_key: string;
  name: string | null;
  website: string | null;
  canonical_domain: string | null;
  /** Present when the source already supplied one (solidcode sometimes does). */
  linkedin_company_url?: string | null;
}

/** A company-details search result being considered as the identity. */
export interface IdentityLookupResult {
  name: string | null;
  linkedinUrl: string | null;
  website: string | null;
}

export interface IdentityResolution {
  company_key: string;
  status: IdentityStatus;
  linkedin_company_url: string | null;
  /** How it was established. Persisted so a reviewer can audit the decision. */
  evidence: string[];
  /** Populated when several results were plausible and none was confirmed. */
  ambiguous_candidates: string[];
}

const norm = (v: string | null | undefined): string =>
  (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function domainOf(v: string | null | undefined): string | null {
  const w = normalizeWebsite(v) ?? v ?? "";
  const d = w.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0];
  return d ? d.toLowerCase() : null;
}

/** Legal-suffix-insensitive name comparison. Never sufficient on its own. */
function nameMatches(a: string | null, b: string | null): boolean {
  const strip = (s: string) => s.replace(
    /\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|bv|sa|ag|plc|technologies|technology|labs|software)\b/g, "");
  const na = strip(norm(a)); const nb = strip(norm(b));
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * Resolve one candidate to a canonical LinkedIn company.
 *
 * Evidence order, strongest first:
 *   1. a canonical LinkedIn URL the candidate already carried
 *   2. exact domain match between candidate and lookup result
 *   3. exact normalized-name match CONFIRMED by a domain
 *   4. otherwise ambiguous/unresolved — pending, not rejected
 */
export function resolveIdentityAgainstLookups(
  candidate: IdentityCandidateInput,
  lookups: readonly IdentityLookupResult[],
): IdentityResolution {
  const evidence: string[] = [];

  // 1. ALREADY CANONICAL.
  const existing = normalizeCompanyLinkedInUrl(candidate.linkedin_company_url);
  if (existing) {
    return {
      company_key: candidate.company_key, status: "verified_match",
      linkedin_company_url: existing,
      evidence: ["source_supplied_canonical_linkedin_url"], ambiguous_candidates: [],
    };
  }

  const candDomain = candidate.canonical_domain ?? domainOf(candidate.website);
  if (!candDomain) evidence.push("candidate_has_no_domain");

  if (lookups.length === 0) {
    return {
      company_key: candidate.company_key, status: "unresolved", linkedin_company_url: null,
      evidence: [...evidence, "no_lookup_results"], ambiguous_candidates: [],
    };
  }

  // 2. DOMAIN MATCH — the strongest evidence available without a LinkedIn URL.
  const byDomain = lookups.filter((l) => {
    const d = domainOf(l.website);
    return !!d && !!candDomain && d === candDomain;
  });
  if (byDomain.length === 1) {
    const url = normalizeCompanyLinkedInUrl(byDomain[0].linkedinUrl);
    if (url) {
      return {
        company_key: candidate.company_key, status: "verified_match",
        linkedin_company_url: url,
        evidence: [...evidence, `exact_domain_match:${candDomain}`], ambiguous_candidates: [],
      };
    }
  }
  if (byDomain.length > 1) {
    return {
      company_key: candidate.company_key, status: "ambiguous", linkedin_company_url: null,
      evidence: [...evidence, `multiple_domain_matches:${candDomain}`],
      ambiguous_candidates: byDomain.map((l) => l.linkedinUrl ?? l.name ?? "?"),
    };
  }

  // 3. NAME MATCH — only with domain confirmation. A name alone never resolves.
  const byName = lookups.filter((l) => nameMatches(candidate.name, l.name));
  if (byName.length === 1) {
    const l = byName[0];
    const url = normalizeCompanyLinkedInUrl(l.linkedinUrl);
    const lDomain = domainOf(l.website);
    if (url && lDomain && candDomain && lDomain === candDomain) {
      return {
        company_key: candidate.company_key, status: "verified_match",
        linkedin_company_url: url,
        evidence: [...evidence, "name_match_confirmed_by_domain"], ambiguous_candidates: [],
      };
    }
    // Name agrees but nothing confirms it — explicitly NOT a match.
    return {
      company_key: candidate.company_key, status: "ambiguous", linkedin_company_url: null,
      evidence: [...evidence, "name_match_without_domain_confirmation"],
      ambiguous_candidates: [url ?? l.name ?? "?"],
    };
  }
  if (byName.length > 1) {
    return {
      company_key: candidate.company_key, status: "ambiguous", linkedin_company_url: null,
      evidence: [...evidence, "multiple_name_matches"],
      ambiguous_candidates: byName.map((l) => l.linkedinUrl ?? l.name ?? "?"),
    };
  }

  // 4. Results came back, none corresponds to this company.
  return {
    company_key: candidate.company_key, status: "unresolved", linkedin_company_url: null,
    evidence: [...evidence, "no_result_matched_domain_or_name"],
    ambiguous_candidates: lookups.map((l) => l.linkedinUrl ?? l.name ?? "?").slice(0, 5),
  };
}

/** Only verified identities may be enriched, verified for hiring, or searched. */
export function identityIsActionable(r: IdentityResolution): boolean {
  return r.status === "verified_match" && !!r.linkedin_company_url;
}

/** Pending identities stay in the funnel as evidence-pending, not rejects. */
export function identityIsPending(r: IdentityResolution): boolean {
  return r.status === "ambiguous" || r.status === "unresolved";
}
