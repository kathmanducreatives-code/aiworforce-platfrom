// FREE PREQUALIFICATION FOR EVERY SOURCE — not only Y Combinator.
//
// ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
//
// `prequalifyYcCompanies` reads memo23's raw row shape: `openJobs`, `teamSize`,
// `batch`, `oneLiner`. So the engine ran it only when `rawYcRows.length > 0`,
// and its own comment stated the consequence plainly — a pool assembled by the
// LinkedIn company search, the funding source or the news source "loses the
// FREE pre-pass, which is exactly what a source that returns no embedded jobs
// cannot support."
//
// The first half of that is true. The second half is not. A source without
// embedded jobs still returns an exact headcount, a description, a domain and a
// LinkedIn URL — and a company whose KNOWN, EXACT headcount is 500 on a 10-150
// mission can be refused for free, before two paid calls and roughly 26 seconds
// of identity resolution and enrichment are spent proving what the row already
// said. Every non-YC pool paid that, for every company, including the ones
// qualification was about to reject.
//
// ── HOW THIS AVOIDS BECOMING A ROUTING TABLE ────────────────────────────────
//
// There is no `if actor === "apify_linkedin_company_search"` here, and there
// must never be. This module reads exactly two things:
//
//   the NORMALIZED company   every discovery actor already produces one;
//   its `field_trust` map    the normalizer's own declaration of how far each
//                            field can be trusted.
//
// A gate fires only when the field is PRESENT and its declared trust permits
// it. Add a discovery actor tomorrow, declare its field trust in its
// normalizer — which is required anyway — and it is triaged here with no change
// to this file. That is the same mechanism `EXACT_HEADCOUNT_SOURCES` uses for
// the growth series, generalised from one field to all of them.
//
// ── WHAT MAY EXCLUDE, AND WHAT MAY ONLY RANK ────────────────────────────────
//
// TWO gates may exclude, and nothing else:
//
//   artifact       a directory or platform page is not a prospect. Y
//                  Combinator's own page was once counted as a qualified lead.
//   employee_size  a TRUSTED EXACT headcount outside a range the MISSION set.
//
// Everything else — a description, an identity, a hiring flag, an industry
// label — ranks. This is the three-valued discipline the ICP gate already
// keeps: absence is `unknown`, never `fail`, and only a contradiction may
// reject. A free pre-pass that excluded on a missing field would delete
// companies for the sin of having been found by a terse actor.
//
// GEOGRAPHY IS DELIBERATELY NOT A GATE HERE. `geographyContradicts` is the
// system's contradiction detector and it answers `true` for
// ("Berlin, Germany", ["Europe"]) — a continent is not a token any country
// string contains. Promoting it into a pre-pass would drop every European
// company from the flagship European mission, for free, before anything could
// reconsider. It stays where it is, after enrichment, until it understands
// continents. See `geographyContradicts` in `leadEligiblePool.ts`.
//
// PURE. No network, provider, model or database access.

import type {
  NormalizedHiringCompany, FieldTrust,
} from "./hiringActorNormalizers.ts";
import {
  ARTIFACT_DOMAINS, normalizeDomain, normalizeCompanyName,
  type PrequalifiedCompany, type PrequalificationResult, type ExcludedArtifact,
  PREQUALIFICATION_VERSION,
} from "./leadCommercialPrequalification.ts";

export const GENERIC_PREQUALIFICATION_VERSION =
  "generic-prequalification-v1" as const;

/**
 * Trust levels a field may be GATED on.
 *
 * ── WHY `semantic` AND `unsafe` ARE ABSENT ─────────────────────────────────
 *
 * `direct`, `alias` and `transformed` are all the provider's own assertion —
 * copied, renamed, or reshaped. The value is still what the provider said.
 *
 * `semantic` is an INTERPRETATION of what the provider said. `company_type` is
 * marked semantic on both LinkedIn actors and carries "Privately Held", which
 * is ownership and not a business model; the benchmark says so in those words.
 *
 * `unsafe` is a field OBSERVED WRONG on live data. `employee_range_advisory`
 * carries it on every actor that returns one, and the funding source's industry
 * tags carry it because run 0XchPqe0cJpx0Yc2T returned a biotech tagged
 * "Retail". Gating on an unsafe field is not a strict rule, it is a wrong one.
 */
const GATE_WORTHY_TRUST: readonly FieldTrust[] =
  Object.freeze(["direct", "alias", "transformed"]);

/** May this company's `field` be used to EXCLUDE? */
export function mayGateOn(
  company: NormalizedHiringCompany, field: string,
): boolean {
  const trust = company.field_trust?.[field];
  return trust !== undefined && GATE_WORTHY_TRUST.includes(trust);
}

/**
 * The key a generic verdict is filed under.
 *
 * ── EXPORTED SO THE ENGINE CANNOT DERIVE IT DIFFERENTLY ────────────────────
 *
 * The engine has to look a scored verdict back up against the company it came
 * from. Recomputing the key there with a lookalike expression is how a
 * shortlist and its companies quietly stop referring to the same set — the
 * exact failure `prequalificationKey` was extracted to prevent on the YC side.
 * Domain first, normalized name second: the same precedence as the YC key and
 * the internal identity.
 */
export function genericPrequalificationKey(
  company: NormalizedHiringCompany,
): string {
  const domain = company.canonical_domain ?? normalizeDomain(company.website);
  return domain ?? `name:${normalizeCompanyName(company.company_name)}`;
}

export interface GenericSizeBounds { min?: number | null; max?: number | null }

export interface GenericPrequalificationPolicy {
  /**
   * May a size bound REJECT?
   *
   * False when the MISSION expressed no employee range. The workspace Brain's
   * advisory bounds may then still ORDER the pool and may not remove anyone
   * from it — the same rule `prequalifyYcCompanies` keeps, and for the same
   * reason: nothing the user asked for mentioned company size.
   */
  size_enforceable?: boolean;
  /** True when the mission's required signals include hiring. Ranking only. */
  mission_requires_hiring?: boolean;
}

/**
 * Score one normalized company using only fields its source is trusted for.
 *
 * ── THE SCALE IS DELIBERATELY THE SAME AS THE YC PASS ──────────────────────
 *
 * `buildSmartShortlist` orders by relevance tier, signal strength, confidence,
 * then this score — and it reads a missing score as `-1`. So today every
 * non-YC company sorts beneath every scored YC company on that tiebreak, not
 * because it is worse but because nothing scored it.
 *
 * Putting both passes on one scale fixes that. A generic company earns only
 * what its evidence supports: it cannot earn the role-tier points, because it
 * has no job rows, and that is the truth about it rather than a handicap.
 */
export function prequalifyNormalizedCompany(
  company: NormalizedHiringCompany,
  size: GenericSizeBounds = {},
  policy: GenericPrequalificationPolicy = {},
): PrequalifiedCompany {
  const sizeEnforceable = policy.size_enforceable !== false;
  const name = (company.company_name ?? "").trim();
  const domain = company.canonical_domain
    ?? normalizeDomain(company.website);

  const reasons: string[] = [];
  let score = 0;

  // ── SIZE: THE ONE GATE WORTH PAYING FOR ──────────────────────────────────
  //
  // Read from `employee_count` and NEVER from `employee_range_advisory`. The
  // advisory band is declared `unsafe` by every normalizer that sets it and
  // was observed contradicting the exact count in four of eight rows on the
  // LinkedIn company search. `mayGateOn` is what enforces that, so the rule is
  // the trust declaration rather than a field name spelled out here.
  const exactCount = typeof company.employee_count === "number" &&
    Number.isFinite(company.employee_count) && company.employee_count > 0 &&
    mayGateOn(company, "employee_count")
      ? company.employee_count
      : null;

  const size_status: PrequalifiedCompany["size_status"] =
    exactCount === null ? "size_unverified"
    : (size.min != null && exactCount < size.min) ? "below_min"
    : (size.max != null && exactCount > size.max) ? "above_max"
    : "in_range";
  const size_fit = size_status === "in_range";

  if (size_fit) {
    score += 30;
    reasons.push(`exact headcount ${exactCount} is inside the target range`);
  } else if (size_status === "above_max") {
    reasons.push(
      `exact headcount ${exactCount} exceeds the maximum — excluded before ` +
      `identity resolution and enrichment, which is two paid calls this row ` +
      `already answered`);
  } else if (size_status === "below_min") {
    reasons.push(
      `exact headcount ${exactCount} is below the minimum — excluded before ` +
      `any paid call`);
  } else if (company.employee_range_advisory) {
    // SAID, NOT USED. Naming the band and refusing to act on it is the
    // difference between a pre-pass that is quiet about what it ignored and
    // one an auditor can check.
    reasons.push(
      `size unverified: the only figure is the advisory band ` +
      `"${company.employee_range_advisory}", which is declared unsafe and may ` +
      `not exclude anyone`);
  } else {
    reasons.push("size unverified — ranks below every verified in-range company");
  }

  // ── IDENTITY: WHAT THE NEXT PAID STAGE WOULD HAVE TO BUY ─────────────────
  //
  // A company that already carries a LinkedIn URL skips identity resolution
  // entirely, so it is cheaper to investigate than one that does not. That is
  // a fact about cost, and ranking on it spends the budget further.
  const identity_confidence: PrequalifiedCompany["identity_confidence"] =
    domain ? "domain_exact" : "name_only";
  if (company.linkedin_company_url) {
    score += 20;
    reasons.push("already carries a LinkedIn identity — no resolution to pay for");
  } else if (domain) {
    score += 10;
    reasons.push("has a domain — identity is corroboratable without a name-only match");
  } else {
    reasons.push("no domain and no LinkedIn URL — identity rests on the name alone");
  }

  // ── DESCRIPTION: THE MINIMUM-EVIDENCE FIELD ──────────────────────────────
  //
  // `hasMinimumEvidence` in `leadEligiblePool` drops a company with no
  // description, cohort record, site or opening as
  // `insufficient_evidence_to_evaluate`. A company arriving here without one is
  // therefore already likely to be unjudgeable — worth ranking down, and NOT
  // worth excluding, because enrichment may still supply it.
  if ((company.description ?? "").trim().length > 0) {
    score += 25;
    reasons.push("carries a description — the field the ICP gate reasons from");
  } else {
    reasons.push(
      "no description yet; enrichment may supply one, so this ranks down " +
      "rather than out");
  }

  // ── HIRING: A FACT, WHEN THE MISSION ASKED FOR IT ────────────────────────
  //
  // Ranking only, in both directions. `hiring_status === false` is not proof a
  // company is not hiring — most actors simply do not answer the question, and
  // `hiring_status` is absent from the LinkedIn normalizers' trust maps
  // entirely, so `mayGateOn` refuses it there.
  const has_open_roles = company.hiring_status === true;
  if (policy.mission_requires_hiring && has_open_roles &&
      mayGateOn(company, "hiring_status")) {
    score += 20;
    reasons.push("the source reports this company as hiring");
  }

  const key = genericPrequalificationKey(company);

  return {
    company_key: key,
    name: name || key,
    canonical_domain: domain,
    // YC-SHAPED FIELDS, HONESTLY EMPTY. This company did not come from a YC
    // cohort and inventing a batch or a one-liner to fill the shape would put
    // a fabricated fact where a downstream reader expects a provider's.
    yc_url: null,
    yc_id: null,
    team_size: exactCount,
    batch: null,
    one_liner: null,
    locations: company.geography,
    jobs: [],
    has_open_roles,
    tier_a: 0, tier_b: 0, tier_c: 0, technical: 0,
    // NULL IS THE TRUTH, NOT A ZERO. `best_tier` means "the highest commercial
    // role tier with evidence". No job rows were seen, so there is no tier —
    // which is different from having looked and found none.
    best_tier: null,
    score,
    strongest_signal: null,
    size_fit, size_status,
    // ── ELIGIBILITY: ONE GATE, AND ONLY WHEN THE MISSION SET A RANGE ───────
    //
    // The YC pass also refuses a company with no commercial role tier. That
    // rule cannot apply here: a source that returns no jobs has not reported
    // the absence of jobs, and reading its silence as "no commercial hiring"
    // would exclude every LinkedIn and funding row on the strength of a
    // question nobody asked the provider.
    eligible: !(sizeEnforceable &&
      (size_status === "above_max" || size_status === "below_min")),
    exclusion: (sizeEnforceable &&
      (size_status === "above_max" || size_status === "below_min"))
      ? "employee_size"
      : null,
    reasons,
    linkedin_identity_status: "unresolved",
    identity_confidence,
  };
}

/** A row refused before scoring, with the reason. */
export interface GenericPrequalificationResult {
  version: typeof GENERIC_PREQUALIFICATION_VERSION;
  total_rows: number;
  unique_companies: number;
  excluded: ExcludedArtifact[];
  companies: PrequalifiedCompany[];
  employee_size_excluded: number;
  eligible_companies: number;
  /** How many rows carried an exact, trusted headcount at all. */
  companies_with_trusted_size: number;
  /** How many carried a description — the ICP gate's primary input. */
  companies_with_description: number;
}

/**
 * Score a whole discovered pool.
 *
 * Deduplicated on domain first, then normalized name — the same precedence the
 * YC pass and the internal identity both use, so one company cannot occupy two
 * shortlist slots.
 */
export function prequalifyDiscoveredCompanies(
  companies: readonly NormalizedHiringCompany[],
  size: GenericSizeBounds = {},
  policy: GenericPrequalificationPolicy = {},
): GenericPrequalificationResult {
  const excluded: ExcludedArtifact[] = [];
  const byKey = new Map<string, PrequalifiedCompany>();
  let withTrustedSize = 0;
  let withDescription = 0;

  for (const c of companies) {
    const name = (c.company_name ?? "").trim();
    const domain = c.canonical_domain ?? normalizeDomain(c.website);

    if (!name && !domain) {
      excluded.push({
        name: name || "(unnamed)", domain,
        reason: "no name and no website — not a company row",
      });
      continue;
    }
    // THE ONLY EXCLUSION THAT REMOVES A ROW OUTRIGHT. Y Combinator's own page
    // reached persistence as a qualified lead on an earlier run.
    if (domain && ARTIFACT_DOMAINS.includes(domain)) {
      excluded.push({
        name, domain, reason: "directory/platform artifact, not a prospect",
      });
      continue;
    }

    const scored = prequalifyNormalizedCompany(c, size, policy);
    if (byKey.has(scored.company_key)) continue;
    // INVARIANT, held in code rather than in a comment: the verdict's key is
    // the one the engine will look it up by.
    if (scored.company_key !== genericPrequalificationKey(c)) {
      throw new Error(
        `generic prequalification key drift for ${scored.name}: ` +
        `${scored.company_key} !== ${genericPrequalificationKey(c)}`);
    }
    byKey.set(scored.company_key, scored);

    if (scored.team_size !== null) withTrustedSize++;
    if ((c.description ?? "").trim().length > 0) withDescription++;
  }

  const rank = (c: PrequalifiedCompany) => c.size_status === "in_range" ? 0 : 1;
  const out = [...byKey.values()].sort((a, b) =>
    rank(a) - rank(b) || b.score - a.score || a.name.localeCompare(b.name));

  return {
    version: GENERIC_PREQUALIFICATION_VERSION,
    total_rows: companies.length,
    unique_companies: out.length,
    excluded,
    companies: out,
    employee_size_excluded: out.filter((c) => c.exclusion === "employee_size").length,
    eligible_companies: out.filter((c) => c.eligible).length,
    companies_with_trusted_size: withTrustedSize,
    companies_with_description: withDescription,
  };
}

/**
 * Fold a generic result into the YC result the run reports.
 *
 * ── WHY MERGE RATHER THAN REPORT TWO ───────────────────────────────────────
 *
 * `state.prequalification` is what the run REPORTS as its free pre-pass, and
 * the funnel reads `eligible_companies` and `employee_size_excluded` off it.
 * Publishing a second, separate result would leave those numbers describing the
 * YC half of a mixed pool while the run acted on both — the same class of
 * mistake as the old shortlist telemetry, which named a set of companies that
 * had not been the ones investigated.
 *
 * The tier counts are NOT summed into: a generic company has no role tiers and
 * adding zeroes would be honest but pointless, while adding it to
 * `companies_with_commercial_roles` would claim a fact nobody established.
 */
export function mergePrequalification(
  yc: PrequalificationResult, generic: GenericPrequalificationResult,
): PrequalificationResult {
  const seen = new Set(yc.companies.map((c) => c.company_key));
  const added = generic.companies.filter((c) => !seen.has(c.company_key));
  return {
    ...yc,
    total_rows: yc.total_rows + generic.total_rows,
    unique_companies: yc.unique_companies + added.length,
    excluded: [...yc.excluded, ...generic.excluded],
    companies: [...yc.companies, ...added],
    companies_with_open_roles:
      yc.companies_with_open_roles + added.filter((c) => c.has_open_roles).length,
    employee_size_excluded: yc.employee_size_excluded +
      added.filter((c) => c.exclusion === "employee_size").length,
    eligible_companies: yc.eligible_companies +
      added.filter((c) => c.eligible).length,
  };
}

/** An empty YC-shaped result, for a pool with no YC rows at all. */
export function emptyPrequalificationResult(): PrequalificationResult {
  return {
    version: PREQUALIFICATION_VERSION,
    total_rows: 0, unique_companies: 0, excluded: [], companies: [],
    tier_a_companies: 0, tier_b_companies: 0, tier_c_only_companies: 0,
    technical_only_companies: 0, companies_with_open_roles: 0,
    companies_with_commercial_roles: 0, companies_with_technical_roles: 0,
    technical_roles_satisfy_signal: false, any_open_role_satisfies_signal: false,
    employee_size_excluded: 0, eligible_companies: 0,
  };
}
