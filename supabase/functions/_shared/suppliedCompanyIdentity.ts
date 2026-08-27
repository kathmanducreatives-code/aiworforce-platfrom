// A COMPANY THE MISSION NAMED IS A LEAD, NOT AN IDENTITY.
//
// ── WHAT THIS MODULE IS FOR ─────────────────────────────────────────────────
//
// `mission.company_profile.known_companies` holds strings a person or a stored
// monitoring subject wrote: "Vercel", "vercel.com",
// "linkedin.com/company/vercel". Until now the engine could do nothing with
// them — every route into the company pool ran through a discovery provider, so
// `known_company_resolution` was declared in the graph and skipped as
// `skipped_no_input`. A mission that named its own companies discovered
// nothing, whether it came from Leads or from Signals.
//
// This turns one of those strings into a POOL ENTRY: a normalized company row
// carrying exactly what the string proves and nothing more, which then goes
// through the same identity resolution, the same enrichment and the same
// verification as a company an actor found.
//
// ── THE ONE RULE ────────────────────────────────────────────────────────────
//
// A NAME IS NOT AN IDENTITY. "Apollo", "Magic", "Hub" and "Streak" are real
// companies and also ordinary words. `resolveIdentityAgainstLookups` already
// enforces this — a name match with no domain confirmation returns `ambiguous`,
// never `verified_match` — and the value of routing supplied companies through
// it is precisely that the rule applies to them unchanged.
//
// So this module never promotes a name. It fills `canonical_domain` only from
// something that IS a domain, and `linkedin_company_url` only from something
// that IS a LinkedIn company URL. A bare name produces a row whose only
// populated identity field is the name, and such a row cannot resolve to a
// verified identity without a search result that confirms it — which is the
// honest outcome, not a gap to be patched later.

import type { NormalizedHiringCompany } from "./hiringActorNormalizers.ts";
import { normalizeDomain } from "./leadCommercialPrequalification.ts";
import { normalizeCompanyLinkedInUrl } from "./structuredCompanyEnrichment.ts";
import type { ResolvedReferentBinding } from "./referentBinding.ts";
import { canonicalLinkedinCompanyUrl } from "./companyIdentity.ts";

/** Says where the row came from, everywhere provenance is read. */
export const SUPPLIED_COMPANY_PROVENANCE = "mission_supplied" as const;

/**
 * The `external_source_id` prefix for a supplied row.
 *
 * NAMESPACED FOR A REASON. `companyKey` falls back to `external_source_id` when
 * a company has neither a LinkedIn URL nor a domain, so this string becomes the
 * pool key. Prefixing it makes that key unmistakably "a thing the mission
 * asked about" rather than an identifier some provider issued, and guarantees
 * it can never collide with one.
 */
export const SUPPLIED_COMPANY_ID_PREFIX = "mission_supplied:" as const;

/** What the supplied string turned out to be. */
export type SuppliedIdentifierKind = "linkedin_url" | "domain" | "name";

export interface SuppliedCompany {
  /** The pool row, carrying only what the string proves. */
  company: NormalizedHiringCompany;
  /** Which of the three forms was recognised. */
  kind: SuppliedIdentifierKind;
  /** The string as written, kept for evidence and for the run report. */
  raw: string;
}

/**
 * Turn one supplied string into a pool row, or nothing.
 *
 * Returns null for a string that names no company at all — empty, or
 * punctuation. A blank entry in a stored subject list must not become a company
 * row with a blank name.
 */
export function normalizeSuppliedCompany(raw: unknown): SuppliedCompany | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  // A string with no letter or digit names nothing.
  if (!/[a-z0-9]/i.test(s)) return null;

  const linkedin = normalizeCompanyLinkedInUrl(s);
  // `normalizeDomain` is the SAME function `acceptLinkedInMatch` and the
  // generic prequalification use. Sharing it is what stops "vercel.com" being
  // a domain here and a name there.
  const domain = linkedin ? null : normalizeDomain(s);

  const kind: SuppliedIdentifierKind = linkedin
    ? "linkedin_url"
    : domain
    ? "domain"
    : "name";

  /**
   * THE NAME, WHEN THE STRING IS NOT ONE.
   *
   * A domain carries a name a person would recognise — `vercel.com` is
   * "vercel" — and identity resolution's name path can use it. It is derived,
   * not asserted, so `field_trust` records it as `transformed`. A LinkedIn URL
   * gets no invented name at all: the slug is a handle, and the search stage
   * never needs one because the URL already resolves.
   */
  const company_name = kind === "name"
    ? s
    : kind === "domain"
    ? (domain as string).split(".")[0]
    : null;

  const missing_fields = [
    ...(company_name ? [] : ["company_name"]),
    ...(domain ? [] : ["canonical_domain"]),
    ...(linkedin ? [] : ["linkedin_company_url"]),
    // Stated explicitly: nothing supplied any of this, and a later stage that
    // wants it must go and get it.
    "description", "employee_count", "geography", "provider_industry",
  ];

  return {
    kind,
    raw: s,
    company: {
      external_source_id: `${SUPPLIED_COMPANY_ID_PREFIX}${s.toLowerCase()}`,
      company_name,
      canonical_domain: domain,
      linkedin_company_url: linkedin,
      // `website` mirrors the domain ONLY when a domain was actually supplied.
      website: domain ? `https://${domain}` : null,
      description: null,
      provider_industry: null,
      industry_ids: [],
      employee_count: null,
      employee_range_advisory: null,
      geography: null,
      company_type: null,
      startup_evidence: null,
      // NOT FALSE — UNKNOWN. Nobody asked whether this company is hiring; that
      // is what the mission is about to find out. `false` here would be a claim
      // no source made, and the prequalification's hiring rule reads it.
      hiring_status: null,
      source_provenance: SUPPLIED_COMPANY_PROVENANCE,
      /**
       * WHAT MAY BE GATED ON, AND AT WHAT STRENGTH.
       *
       * `direct` for a field the string itself IS. Nothing here is `semantic`
       * or `alias`, because nothing here was inferred from prose — and the name
       * derived from a domain is `transformed`, so a stage that demands direct
       * evidence does not get it from a hostname.
       */
      field_trust: {
        ...(company_name
          ? { company_name: kind === "domain" ? "transformed" as const : "direct" as const }
          : {}),
        ...(domain ? { canonical_domain: "direct" as const } : {}),
        ...(linkedin ? { linkedin_company_url: "direct" as const } : {}),
      },
      missing_fields,
      // NO ACTOR PRODUCED THIS ROW, and the evidence trail must not imply one.
      raw_ref: { actor_key: SUPPLIED_COMPANY_PROVENANCE, source_id: s },
    },
  };
}

/**
 * The pool row for a company the RESOLVER already identified.
 *
 * ── WHY THIS EXISTS BESIDE `normalizeSuppliedCompany` ───────────────────────
 *
 * That function turns a STRING into a row, and a bare name is the weakest thing
 * a string can be: it produces a row whose only populated field is the name, and
 * `company_identity_resolution` then pays a LinkedIn search to find out which
 * real company it is. That is the correct behaviour for a name a user typed.
 *
 * It is the WRONG behaviour for a company the user pointed at in a result we
 * already showed them, because the identity is not in question — it was
 * established deterministically by `resolveCompanyIdentity` from the record the
 * system itself wrote, and a binding never carries a weak dedupe kind. Paying a
 * provider to rediscover it buys an answer we are already holding, and buys it
 * with a name-search that can come back ambiguous and lose a company that was
 * never ambiguous.
 *
 * So the identity is SEEDED. The row carries the binding's domain and canonical
 * LinkedIn URL as `direct` evidence, which is exactly the state a row reaches
 * after a successful paid resolution — and `resolveIdentityAgainstLookups`
 * returns `verified_match` from `source_supplied_canonical_linkedin_url`
 * without a lookup, on the same rule that has always applied to a source that
 * supplied one.
 *
 * NOTHING IS PROMOTED. A binding carries a domain or a LinkedIn id because
 * `resolveReferents` refuses to bind anything weaker, so this never turns a name
 * into an identity — the one rule the module exists to keep.
 */
export function suppliedCompanyFromBinding(
  binding: ResolvedReferentBinding, raw: string,
): SuppliedCompany | null {
  // ── THE CANONICAL FORM IS SCHEMELESS; THIS ONE IS NOT ───────────────────
  //
  // `canonicalLinkedinCompany` stores `linkedin.com/company/linear` — no
  // scheme, deliberately, because it is a comparison key. `normalizeCompanyLinkedInUrl`
  // parses a real URL and returns null for anything else, so handing it the
  // canonical form silently produced NO LinkedIn URL: the seeded row kept only
  // its domain, `company_identity_resolution`'s skip guard reads
  // `linkedin_company_url`, and the redundant paid search ran anyway. The
  // sidecar was being carried the whole way and then dropped one line from the
  // end.
  //
  // The slug is the stable identifier and `normalizeCompanyLinkedInUrl` emits
  // exactly this shape from it, so re-attaching the scheme restores the URL the
  // resolver already had rather than inventing one.
  const linkedin = normalizeCompanyLinkedInUrl(
    canonicalLinkedinCompanyUrl(binding.identity));
  const domain = binding.identity.canonicalDomain;
  // A binding with neither is not one this pipeline can act on. It cannot occur
  // — `resolveReferents` rejects the weak dedupe kinds — and is refused here
  // rather than assumed away, so a future caller cannot smuggle one through.
  if (!linkedin && !domain) return null;

  const name = binding.identity.name ?? binding.label ?? null;
  const missing_fields = [
    ...(name ? [] : ["company_name"]),
    ...(domain ? [] : ["canonical_domain"]),
    ...(linkedin ? [] : ["linkedin_company_url"]),
    "description", "employee_count", "geography", "provider_industry",
  ];

  return {
    kind: linkedin ? "linkedin_url" : "domain",
    raw,
    company: {
      // THE SAME KEY THE RAW STRING WOULD HAVE PRODUCED, so a pool that was
      // seeded from a binding and one that was not describe the same entry.
      external_source_id: `${SUPPLIED_COMPANY_ID_PREFIX}${raw.toLowerCase()}`,
      company_name: name,
      canonical_domain: domain,
      linkedin_company_url: linkedin,
      website: domain ? `https://${domain}` : null,
      description: null,
      provider_industry: null,
      industry_ids: [],
      employee_count: null,
      employee_range_advisory: null,
      geography: null,
      company_type: null,
      startup_evidence: null,
      // Unknown, not false — see `normalizeSuppliedCompany`. A binding says
      // which company this is; it says nothing about whether it is hiring.
      hiring_status: null,
      source_provenance: SUPPLIED_COMPANY_PROVENANCE,
      // `direct` for the identifiers the binding actually carries. The name is
      // `direct` only when the resolved identity carried one; a label the user
      // was shown is still a name a person read, not an inference.
      field_trust: {
        ...(name ? { company_name: "direct" as const } : {}),
        ...(domain ? { canonical_domain: "direct" as const } : {}),
        ...(linkedin ? { linkedin_company_url: "direct" as const } : {}),
      },
      missing_fields,
      raw_ref: { actor_key: SUPPLIED_COMPANY_PROVENANCE, source_id: raw },
    },
  };
}

/**
 * Normalize a whole supplied list, dropping unusable entries and duplicates.
 *
 * Deduplicated on the row's own `external_source_id`, so "Vercel" and "vercel"
 * are one company while "Vercel" and "vercel.com" are two — they prove
 * different things, and the second may resolve where the first cannot.
 *
 * ── A BOUND ENTRY IS SEEDED, NOT RE-RESOLVED ────────────────────────────────
 *
 * A supplied string that matches a binding's label or resolved name is built
 * from the BINDING instead, so the identity the resolver already established
 * enters the pool rather than being bought again. Matching is exact and
 * case-insensitive on the whole string: a nearest-name match here would attach
 * one company's identity to another's name, which is the same mistake
 * `resolveReferents` refuses to make one layer up.
 *
 * A binding that matches no supplied string is NOT added. The mission decides
 * which companies a run investigates, and a sidecar that could add one would be
 * a second authority over scope.
 */
export function normalizeSuppliedCompanies(
  raws: readonly unknown[],
  bindings: readonly ResolvedReferentBinding[] = [],
): { companies: SuppliedCompany[]; rejected: string[]; seeded: number } {
  const companies: SuppliedCompany[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  let seeded = 0;

  const key = (v: string) => v.trim().toLowerCase();
  const byName = new Map<string, ResolvedReferentBinding>();
  for (const b of bindings) {
    if (b.entity_type !== "company") continue;
    for (const n of [b.label, b.identity.name]) {
      if (typeof n === "string" && n.trim()) {
        // FIRST BINDING WINS for a name two of them share. Two bindings with
        // the same label are two different companies the user was shown under
        // one name, and picking between them by position would be a guess —
        // so the later one simply does not seed, and its company resolves the
        // ordinary way rather than borrowing the other's identity.
        if (!byName.has(key(n))) byName.set(key(n), b);
      }
    }
  }

  for (const r of raws) {
    const raw = typeof r === "string" ? r.trim() : "";
    const bound = raw ? byName.get(key(raw)) : undefined;
    const n = bound
      ? (suppliedCompanyFromBinding(bound, raw) ?? normalizeSuppliedCompany(r))
      : normalizeSuppliedCompany(r);
    if (!n) {
      rejected.push(typeof r === "string" ? r : String(r));
      continue;
    }
    if (seen.has(n.company.external_source_id)) continue;
    seen.add(n.company.external_source_id);
    if (bound) seeded++;
    companies.push(n);
  }
  return { companies, rejected, seeded };
}
