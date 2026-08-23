// NORMALIZERS — Actor rows into Agentory's canonical company/job/person shapes.
//
// Built ONLY from fields observed in live output on 2026-08-01. Where an Actor
// does not supply a field, the normalizer emits null and records WHY in
// `missing_fields`. It never infers one field from another: the benchmark's
// central lesson is that a plausible-looking value from the wrong field
// (employeeCountRange standing in for employeeCount, a provider industry label
// standing in for a real industry) is worse than an honest null, because a null
// stops a gate while a wrong value passes one.
//
// Pure. No I/O.

import { normalizeCompanyLinkedInUrl, normalizeWebsite, sanitizeUrl } from "./structuredCompanyEnrichment.ts";

export type FieldTrust = "direct" | "alias" | "transformed" | "semantic" | "unsafe";

export interface NormalizedHiringCompany {
  /** Namespaced so YC id 705 never collides with LinkedIn id 705. */
  external_source_id: string;
  company_name: string | null;
  canonical_domain: string | null;
  linkedin_company_url: string | null;
  website: string | null;
  description: string | null;
  /** The provider's own label. NEVER proof of industry. */
  provider_industry: string | null;
  /** LinkedIn industry id + hierarchy, when enrichment supplied it. */
  industry_ids: Array<{ id: string; name: string; hierarchy: string | null }>;
  /** Exact headcount. Only ever from enrichment or full mode. */
  employee_count: number | null;
  /** ADVISORY. Kept apart from employee_count because the two contradict. */
  employee_range_advisory: string | null;
  geography: string | null;
  /** Ownership type ("Privately Held"), NOT a business model. */
  company_type: string | null;
  /** YC vertical/batch evidence. Kept out of canonical industry on purpose. */
  startup_evidence: Record<string, unknown> | null;
  hiring_status: boolean | null;
  source_provenance: string;
  /** Field-level trust, so downstream never has to guess. */
  field_trust: Record<string, FieldTrust>;
  missing_fields: string[];
  /** Raw row kept for evidence refs; never re-derived from. */
  raw_ref: { actor_key: string; source_id: string | number | null };
}

export interface NormalizedHiringJob {
  job_id: string | null;
  job_url: string | null;
  title: string | null;
  company_name: string | null;
  company_linkedin_url: string | null;
  company_source_id: string | null;
  location: string | null;
  workplace_mode: string | null;
  posted_date: string | null;
  description: string | null;
  source: string;
  retrieved_at: string | null;
  missing_fields: string[];
}

export interface NormalizedHiringPerson {
  /** STABLE profile id. Dedupe on this, never on the URL. */
  source_profile_id: string | null;
  external_source_id: string;
  full_name: string | null;
  title: string | null;
  /** Opaque ACwAAA... member URL, not a vanity slug. */
  linkedin_url: string | null;
  current_employer: string | null;
  current_employer_linkedin_url: string | null;
  current_employer_is_current: boolean | null;
  tenure_years: number | null;
  source_provenance: string;
  missing_fields: string[];
}

const s = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
};
const n = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function domainFrom(website: unknown): string | null {
  const w = normalizeWebsite(website) ?? s(website);
  if (!w) return null;
  return w.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0] || null;
}

function miss(o: Record<string, unknown>, keys: string[]): string[] {
  return keys.filter((k) => o[k] === null || o[k] === undefined ||
    (Array.isArray(o[k]) && (o[k] as unknown[]).length === 0));
}

// ── COMPANY: memo23 YC ───────────────────────────────────────────────────────

export function normalizeMemo23Company(r: Record<string, unknown>): NormalizedHiringCompany {
  const out: NormalizedHiringCompany = {
    external_source_id: `yc_memo23:${r.id ?? "unknown"}`,
    company_name: s(r.name),
    canonical_domain: domainFrom(r.website),
    // THIS ACTOR HAS NO LINKEDIN FIELD. Not "missing data" — absent from schema.
    linkedin_company_url: null,
    website: normalizeWebsite(r.website) ?? s(r.website),
    description: s(r.longDescription) ?? s(r.oneLiner),
    // YC "B2B" is a YC VERTICAL, not an industry. Kept out of industry_ids.
    provider_industry: null,
    industry_ids: [],
    // teamSize is self-reported and stale (ShipBob returned 1) — never exact.
    employee_count: null,
    employee_range_advisory: n(r.teamSize) !== null ? `yc_self_reported:${r.teamSize}` : null,
    geography: s(r.allLocations) ?? (Array.isArray(r.regions) ? (r.regions as string[]).join(", ") : null),
    company_type: null,
    startup_evidence: {
      source: "y_combinator", yc_batch: s(r.batch), yc_status: s(r.status),
      yc_stage: s(r.stage), yc_vertical: s(r.industry), yc_subvertical: s(r.subindustry),
      yc_top_company: r.topCompany === true,
      yc_team_size_self_reported: n(r.teamSize),
    },
    hiring_status: typeof r.isHiring === "boolean" ? r.isHiring : null,
    source_provenance: "memo23/y-combinator-scraper",
    field_trust: {
      company_name: "direct", website: "direct", canonical_domain: "transformed",
      description: "alias", employee_range_advisory: "unsafe",
      startup_evidence: "direct", hiring_status: "direct", geography: "alias",
    },
    missing_fields: [],
    raw_ref: { actor_key: "apify_yc_companies_memo23", source_id: (r.id as number) ?? null },
  };
  out.missing_fields = [
    "linkedin_company_url:absent_from_actor_schema",
    "employee_count:yc_team_size_is_self_reported_not_exact",
    "provider_industry:yc_vertical_is_not_an_industry",
    ...miss(out as unknown as Record<string, unknown>, ["company_name", "website", "description"]),
  ];
  return out;
}

/** memo23 embeds open jobs on the company row. */
export function normalizeMemo23OpenJobs(
  r: Record<string, unknown>,
): NormalizedHiringJob[] {
  const jobs = Array.isArray(r.openJobs) ? r.openJobs as Record<string, unknown>[] : [];
  return jobs.map((j) => ({
    job_id: j.jobId !== undefined && j.jobId !== null ? `yc_memo23:${j.jobId}` : null,
    job_url: sanitizeUrl(j.url),
    title: s(j.title),
    company_name: s(r.name),
    company_linkedin_url: null,
    company_source_id: `yc_memo23:${r.id ?? "unknown"}`,
    location: s(j.location),
    workplace_mode: null,
    // postedAgo is RELATIVE ("5 days ago"). Converting needs the run timestamp,
    // which the row does not carry, so it stays unresolved rather than guessed.
    posted_date: null,
    description: null,
    source: "memo23/y-combinator-scraper",
    retrieved_at: s(r.scrapedAt),
    missing_fields: [
      "posted_date:actor_returns_relative_postedAgo_only",
      "description:absent_from_openJobs",
      "workplace_mode:absent_from_openJobs",
    ],
  }));
}

// ── COMPANY: solidcode YC ────────────────────────────────────────────────────

export function normalizeSolidcodeCompany(r: Record<string, unknown>): NormalizedHiringCompany {
  const out: NormalizedHiringCompany = {
    external_source_id: `yc_solidcode:${r.companyId ?? "unknown"}`,
    company_name: s(r.name),
    canonical_domain: domainFrom(r.website),
    linkedin_company_url: normalizeCompanyLinkedInUrl(r.linkedin),
    website: normalizeWebsite(r.website) ?? s(r.website),
    description: s(r.longDescription) ?? s(r.shortDescription),
    provider_industry: null,
    industry_ids: [],
    employee_count: null,
    employee_range_advisory: n(r.teamSize) !== null ? `yc_self_reported:${r.teamSize}` : null,
    geography: s(r.location) ?? s(r.country),
    company_type: null,
    startup_evidence: {
      source: "y_combinator", yc_batch: s(r.batch), yc_status: s(r.status),
      yc_vertical: s(r.industry), year_founded: n(r.yearFounded),
      yc_team_size_self_reported: n(r.teamSize),
      open_jobs_count: n(r.openJobsCount),
    },
    hiring_status: typeof r.isHiring === "boolean" ? r.isHiring : null,
    source_provenance: "solidcode/ycombinator-scraper",
    field_trust: {
      company_name: "direct", website: "direct", canonical_domain: "transformed",
      linkedin_company_url: "alias", description: "alias",
      employee_range_advisory: "unsafe", startup_evidence: "direct", hiring_status: "direct",
    },
    missing_fields: [],
    raw_ref: { actor_key: "apify_yc_companies_solidcode", source_id: (r.companyId as number) ?? null },
  };
  out.missing_fields = [
    "employee_count:yc_team_size_is_self_reported_not_exact",
    "provider_industry:yc_vertical_is_not_an_industry",
    ...miss(out as unknown as Record<string, unknown>, ["linkedin_company_url", "website", "description"]),
  ];
  return out;
}

// ── COMPANY: LinkedIn search (CANDIDATE) vs enrichment (AUTHORITATIVE) ───────

function linkedinIndustries(r: Record<string, unknown>) {
  const arr = Array.isArray(r.industries) ? r.industries as Record<string, unknown>[] : [];
  return arr.filter((x) => x && typeof x === "object").map((x) => ({
    id: String(x.id ?? ""), name: String(x.name ?? ""),
    hierarchy: s(x.hierarchy),
  })).filter((x) => x.id || x.name);
}

function rangeText(r: Record<string, unknown>): string | null {
  const er = r.employeeCountRange as Record<string, unknown> | undefined;
  if (!er || typeof er !== "object") return null;
  const a = n(er.start), b = n(er.end);
  return a !== null || b !== null ? `${a ?? "?"}-${b ?? "?"}` : null;
}

/**
 * company-search output. `candidate_only` is always true — this Actor's
 * industry and size filters were both wrong in the benchmark, so nothing here
 * may satisfy a Brain hard gate until enrichment runs.
 */
export function normalizeLinkedInCompanyCandidate(
  r: Record<string, unknown>,
): NormalizedHiringCompany & { candidate_only: true } {
  const inds = linkedinIndustries(r);
  const out: NormalizedHiringCompany & { candidate_only: true } = {
    external_source_id: `li_company:${r.id ?? "unknown"}`,
    company_name: s(r.name),
    canonical_domain: domainFrom(r.website),
    linkedin_company_url: normalizeCompanyLinkedInUrl(r.linkedinUrl),
    website: normalizeWebsite(r.website) ?? s(r.website),
    description: s(r.description),
    // short mode gives `industry` (string); full mode gives `industries` (array).
    provider_industry: inds[0]?.name ?? s(r.industry),
    industry_ids: inds,
    // Present only in full mode; null in short mode. Never taken from the range.
    employee_count: n(r.employeeCount),
    employee_range_advisory: rangeText(r),
    geography: s((Array.isArray(r.locations) && (r.locations as Record<string, unknown>[])[0]
      ? (r.locations as Record<string, unknown>[])[0].linkedinText : null)) ??
      s((r.location as Record<string, unknown> | undefined)?.linkedinText),
    company_type: s(r.companyType),
    startup_evidence: null,
    hiring_status: null,
    source_provenance: "harvestapi/linkedin-company-search",
    field_trust: {
      company_name: "direct", linkedin_company_url: "direct", website: "direct",
      description: "direct", provider_industry: "unsafe",
      employee_count: "direct", employee_range_advisory: "unsafe",
      company_type: "semantic", geography: "transformed",
    },
    missing_fields: [],
    raw_ref: { actor_key: "apify_linkedin_company_search", source_id: s(r.id) },
    candidate_only: true,
  };
  out.missing_fields = [
    "provider_industry:filter_returned_wrong_industries_use_enrichment",
    "employee_range_advisory:contradicts_exact_count_use_enrichment",
    ...(out.employee_count === null ? ["employee_count:null_in_short_mode"] : []),
  ];
  return out;
}

/** linkedin-company enrichment. The authoritative company record. */
export function normalizeLinkedInCompanyEnriched(
  r: Record<string, unknown>,
): NormalizedHiringCompany {
  const inds = linkedinIndustries(r);
  const founded = r.foundedOn as Record<string, unknown> | undefined;
  const out: NormalizedHiringCompany = {
    external_source_id: `li_company:${r.id ?? "unknown"}`,
    company_name: s(r.name),
    canonical_domain: domainFrom(r.website),
    linkedin_company_url: normalizeCompanyLinkedInUrl(r.linkedinUrl),
    website: normalizeWebsite(r.website) ?? s(r.website),
    description: s(r.description),
    provider_industry: inds[0]?.name ?? null,
    industry_ids: inds,
    employee_count: n(r.employeeCount),
    employee_range_advisory: rangeText(r),
    geography: s((Array.isArray(r.locations) && (r.locations as Record<string, unknown>[])[0]
      ? (r.locations as Record<string, unknown>[])[0].linkedinText : null)),
    company_type: s(r.companyType),
    startup_evidence: founded && n(founded.year) !== null
      ? { year_founded: n(founded.year) } : null,
    hiring_status: null,
    source_provenance: "harvestapi/linkedin-company",
    field_trust: {
      company_name: "direct", linkedin_company_url: "direct", website: "direct",
      description: "direct", provider_industry: "direct", industry_ids: "direct",
      employee_count: "direct", employee_range_advisory: "unsafe",
      company_type: "semantic", geography: "transformed",
    },
    missing_fields: [],
    raw_ref: { actor_key: "apify_linkedin_company_details", source_id: s(r.id) },
  };
  out.missing_fields = [
    ...(out.startup_evidence === null ? ["founded_year:frequently_null_from_actor"] : []),
    "employee_range_advisory:contradicts_exact_count_advisory_only",
  ];
  return out;
}

// ── JOB ──────────────────────────────────────────────────────────────────────

export function normalizeLinkedInJob(r: Record<string, unknown>): NormalizedHiringJob {
  const c = (r.company ?? {}) as Record<string, unknown>;
  const loc = r.location as Record<string, unknown> | undefined;
  return {
    job_id: r.id !== undefined && r.id !== null ? `li_job:${r.id}` : null,
    job_url: sanitizeUrl(r.linkedinUrl),
    title: s(r.title),
    company_name: s(c.name),
    company_linkedin_url: normalizeCompanyLinkedInUrl(c.linkedinUrl),
    company_source_id: c.id !== undefined && c.id !== null ? `li_company:${c.id}` : null,
    location: s(loc?.linkedinText) ?? s(r.location),
    workplace_mode: s(r.workplaceType),
    posted_date: s(r.postedDate),
    description: s(r.descriptionText),
    source: "harvestapi/linkedin-job-search",
    retrieved_at: s((r._meta as Record<string, unknown> | undefined)?.timestamp),
    missing_fields: [],
  };
}

/** Deduplicate on job id — the Actor returned 25% duplicate rows in one pack. */
export function dedupeJobs(jobs: NormalizedHiringJob[]): NormalizedHiringJob[] {
  const seen = new Set<string>(); const out: NormalizedHiringJob[] = [];
  for (const j of jobs) {
    const k = j.job_id ?? j.job_url ?? `${j.company_name}|${j.title}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(j);
  }
  return out;
}

// ── PERSON ───────────────────────────────────────────────────────────────────

export function normalizeHarvestPerson(
  r: Record<string, unknown>, provenance: string,
): NormalizedHiringPerson {
  const positions = Array.isArray(r.currentPositions)
    ? r.currentPositions as Record<string, unknown>[] : [];
  const cp = positions[0] ?? {};
  const tenure = cp.tenureAtCompany as Record<string, unknown> | undefined;
  const name = [s(r.firstName), s(r.lastName)].filter(Boolean).join(" ") || null;
  const out: NormalizedHiringPerson = {
    source_profile_id: s(r.id),
    external_source_id: `li_profile:${s(r.id) ?? "unknown"}`,
    full_name: name,
    title: s(cp.title),
    linkedin_url: sanitizeUrl(r.linkedinUrl),
    current_employer: s(cp.companyName),
    current_employer_linkedin_url: normalizeCompanyLinkedInUrl(cp.companyLinkedinUrl),
    current_employer_is_current: typeof cp.current === "boolean" ? cp.current : null,
    tenure_years: n(tenure?.numYears),
    source_provenance: provenance,
    missing_fields: [],
  };
  out.missing_fields = miss(out as unknown as Record<string, unknown>,
    ["source_profile_id", "full_name", "title", "current_employer", "current_employer_linkedin_url"]);
  return out;
}

/**
 * Deduplicate people by STABLE PROFILE ID.
 *
 * Both founder Actors return the opaque `ACwAAA...` member URL rather than a
 * vanity slug, and the same person can surface with different URL forms across
 * Actors. The id is the only stable key.
 */
export function dedupePeople(people: NormalizedHiringPerson[]): NormalizedHiringPerson[] {
  const seen = new Set<string>(); const out: NormalizedHiringPerson[] = [];
  for (const p of people) {
    const k = p.source_profile_id ?? p.linkedin_url ?? p.full_name ?? "";
    if (!k || seen.has(k)) { if (k) continue; }
    seen.add(k); out.push(p);
  }
  return out;
}

// ── FUNDING ROUND: datahyena ─────────────────────────────────────────────────
//
// ── WHY THIS NORMALIZER IS DEFENSIVE AND EVERY OTHER ONE IS NOT ──────────────
//
// Every other normalizer in this file was written against fields OBSERVED in
// live output on 2026-08-01. This one was written against a vendor schema and
// README read from the Store API on 2026-08-22, with no run performed. The
// exact key names are therefore unconfirmed.
//
// Two consequences, both deliberate:
//
//   1. Each field accepts a small set of plausible spellings. That is not
//      inference between DIFFERENT facts — the thing this file's header
//      forbids — it is tolerance of one fact's naming. `amount_usd` and
//      `amountUsd` are the same number; `amount_usd` and `valuation` are not,
//      and no alias here crosses that line.
//
//   2. It FAILS CLOSED. A funding row without a company name or without an
//      announced date yields `is_evidence: false`, and the qualification layer
//      must then treat the signal as unproven. A dated event is the whole of
//      what makes funding evidence rather than rumour, so a row that cannot
//      supply one proves nothing — no matter how confident the rest of it looks.

export interface NormalizedFundingRound {
  company_name: string | null;
  canonical_domain: string | null;
  linkedin_company_url: string | null;
  /** Round stage as the provider reported it. Never inferred from the amount. */
  round_stage: string | null;
  /** Announced amount normalized to USD. An announcement, not an audited figure. */
  amount_usd: number | null;
  currency: string | null;
  /** ISO date the round was ANNOUNCED. Without this there is no evidence. */
  announced_date: string | null;
  investors: string[];
  /** Article URLs the provider matched. The citation for the claim. */
  source_articles: string[];
  provider_industry: string | null;
  provider_verticals: string[];
  employee_range_advisory: string | null;
  geography: string | null;
  source_provenance: string;
  field_trust: Record<string, FieldTrust>;
  missing_fields: string[];
  /**
   * TRUE only when this row can stand as funding evidence: a named company AND
   * an announced date. Read by qualification; a false here must never become a
   * positive funding signal.
   */
  is_evidence: boolean;
  raw_ref: { actor_key: string; source_id: string | number | null };
}

/** First non-empty string among several candidate keys. */
function pick(r: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = s(r[k]);
    if (v) return v;
  }
  return null;
}
function pickNum(r: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = n(r[k]);
    if (v !== null) return v;
  }
  return null;
}
function pickList(r: Record<string, unknown>, keys: string[]): string[] {
  for (const k of keys) {
    const v = r[k];
    if (!Array.isArray(v)) continue;
    const out = v
      .map((x) => typeof x === "string" ? s(x) : s((x as Record<string, unknown>)?.name))
      .filter((x): x is string => !!x);
    if (out.length) return out;
  }
  return [];
}

/** ISO-8601 date, or null. A malformed date is NOT a date. */
function isoDate(v: unknown): string | null {
  const t = s(v);
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : t.slice(0, 10);
}

export function normalizeDatahyenaFundingRound(
  r: Record<string, unknown>,
): NormalizedFundingRound {
  // ── CORRECTED AGAINST LIVE OUTPUT, RUN 0XchPqe0cJpx0Yc2T (2026-08-22) ────
  //
  // The first version of this function read every company field from the TOP
  // level — `company_name`, `company_domain`, `company_linkedin`. The real rows
  // nest all of them under `company`, so it would have produced a null name for
  // every row, `is_evidence: false` for all 18, and a funding capability that
  // silently returned nothing. That is precisely what a validation run is for.
  //
  // Corrected field names, verbatim from the run:
  //   company.{name,domain,linkedinUrl,hqCity,hqCountry.name,employeeCountBucket,
  //            industryGroup,verticals,businessModel,description,foundedYear}
  //   round            — the stage, and NULL on 6 of 18 rows
  //   amountUsd        — dollars (amountUsdCents is the same figure in cents)
  //   announcedAt      — date-only, "2026-08-21"
  //   investors[]      — {id, name}
  //   sources[]        — {url}, and NOT {name}
  const company = (r["company"] ?? {}) as Record<string, unknown>;
  const hqCountry = (company["hqCountry"] ?? {}) as Record<string, unknown>;

  const company_name = pick(company, ["name"]) ?? pick(r, ["company_name", "companyName"]);
  const announced_date = isoDate(r["announcedAt"] ?? r["announced_date"] ?? r["announcedDate"]);

  // `sources` is a list of OBJECTS KEYED BY url. The generic list reader maps
  // `.name` for objects, which returned an empty list here — so the citation,
  // the one field that makes an amount checkable, was being dropped.
  const sources = Array.isArray(r["sources"])
    ? (r["sources"] as Array<Record<string, unknown>>)
      .map((x) => typeof x === "string" ? s(x) : s(x?.["url"]))
      .filter((x): x is string => !!x)
    : [];

  const geoParts = [pick(company, ["hqCity"]), s(hqCountry["name"])].filter(Boolean);

  const out: NormalizedFundingRound = {
    company_name,
    canonical_domain: domainFrom(company["domain"] ?? r["company_domain"]),
    linkedin_company_url: normalizeCompanyLinkedInUrl(company["linkedinUrl"]) ?? null,
    round_stage: pick(r, ["round", "round_stage", "roundStage", "stage"]),
    amount_usd: pickNum(r, ["amountUsd", "amount_usd"]),
    currency: pick(r, ["amountOriginalCurrency", "currency"]),
    announced_date,
    investors: pickList(r, ["investors"]),
    source_articles: sources,
    provider_industry: pick(company, ["industryGroup"]),
    provider_verticals: pickList(company, ["verticals"]),
    employee_range_advisory: pick(company, ["employeeCountBucket"]),
    geography: geoParts.length ? geoParts.join(", ") : null,
    source_provenance: "apify_funding_rounds_datahyena",
    field_trust: {
      company_name: "direct",
      round_stage: "direct",
      // The provider converts from the original currency; that is a transform.
      amount_usd: "transformed",
      announced_date: "direct",
      investors: "direct",
      source_articles: "direct",
      // OBSERVED WRONG ON LIVE DATA. Run 0XchPqe0cJpx0Yc2T returned a biotech
      // tagged industryGroup "Retail" / verticals ["commerce"], and an
      // Australian fintech resolved to a Montreal music ensemble's domain and
      // "Performing Arts". These tags are not merely unproven, they are
      // sometimes about a different company — see the identity-collision defect.
      provider_industry: "unsafe",
      provider_verticals: "unsafe",
      employee_range_advisory: "unsafe",
    },
    missing_fields: [],
    is_evidence: false,
    raw_ref: {
      actor_key: "apify_funding_rounds_datahyena",
      source_id: (s(r["id"]) ?? s(r["round_id"]) ?? null),
    },
  };

  out.missing_fields = miss(out as unknown as Record<string, unknown>, [
    "company_name", "announced_date", "round_stage", "amount_usd",
    "investors", "source_articles", "canonical_domain", "linkedin_company_url",
  ]);

  // THE GATE, unchanged: a named company and an announced date, or this is not
  // evidence. Live data shows both are present on 18 of 18 rows, so the gate
  // costs nothing in recall and still refuses a malformed row.
  out.is_evidence = company_name !== null && announced_date !== null;
  return out;
}

/**
 * Is this round recent enough to satisfy a mission's window?
 *
 * Separate from the normalizer because recency is a MISSION requirement, not a
 * property of the row. A row with no date is never fresh — it fails closed for
 * the same reason `is_evidence` does.
 */
export function fundingRoundIsWithin(
  round: Pick<NormalizedFundingRound, "announced_date">,
  maxAgeDays: number,
  now: Date = new Date(),
): boolean {
  if (!round.announced_date) return false;
  const t = new Date(round.announced_date).getTime();
  if (Number.isNaN(t)) return false;
  const ageDays = (now.getTime() - t) / 86_400_000;
  return ageDays >= 0 && ageDays <= maxAgeDays;
}

/**
 * A funding round, projected into the canonical company shape.
 *
 * The round is the EVIDENCE and the company is the candidate; the pool holds
 * companies, so the round has to yield one. What it must not do is smuggle the
 * provider's tags in as facts: `provider_industry` stays advisory and
 * `employee_range_advisory` stays advisory, exactly as they do for every other
 * discovery source, so a company that raised a Series A still has to be
 * enriched before any ICP gate reads its industry or its size.
 *
 * `hiring_status` is null and not false. This source says nothing about hiring,
 * and false would be a claim.
 */
export function fundingRoundToCompany(
  r: NormalizedFundingRound,
): NormalizedHiringCompany {
  const out: NormalizedHiringCompany = {
    external_source_id: `datahyena:${r.raw_ref.source_id ?? r.company_name ?? "unknown"}`,
    company_name: r.company_name,
    canonical_domain: r.canonical_domain,
    linkedin_company_url: r.linkedin_company_url,
    website: r.canonical_domain ? `https://${r.canonical_domain}` : null,
    description: null,
    provider_industry: r.provider_industry,
    industry_ids: [],
    employee_count: null,
    employee_range_advisory: r.employee_range_advisory,
    geography: r.geography,
    company_type: null,
    startup_evidence: {
      funding_round_stage: r.round_stage,
      funding_amount_usd: r.amount_usd,
      funding_announced_date: r.announced_date,
      funding_investors: r.investors,
      funding_sources: r.source_articles,
    },
    hiring_status: null,
    source_provenance: r.source_provenance,
    field_trust: {
      company_name: "direct",
      canonical_domain: "direct",
      provider_industry: "unsafe",
      employee_range_advisory: "unsafe",
      geography: "direct",
    },
    missing_fields: [],
    raw_ref: r.raw_ref,
  };
  out.missing_fields = miss(out as unknown as Record<string, unknown>, [
    "company_name", "canonical_domain", "linkedin_company_url", "employee_count",
  ]);
  return out;
}

// ── SOCIAL POSTS AND COMMENTS ────────────────────────────────────────────────
//
// Written against vendor READMEs, not observed rows — same defensive posture as
// the funding normalizer, and for the same reason. Each field accepts a small
// set of plausible spellings of ONE fact; no alias crosses between facts.
//
// THE GATE: a post is evidence only with a URL and a date. A comment is evidence
// only with a commenter identity and a date. Undated social activity is not a
// signal, it is a screenshot.

export type PostAuthorType = "company" | "person" | "unknown";

export interface NormalizedSocialPost {
  post_url: string | null;
  posted_at: string | null;
  text: string | null;
  /**
   * WHO PUBLISHED IT. The subject boundary, carried on the evidence itself.
   *
   * Derived from the author's own LinkedIn URL shape wherever possible, because
   * that is the one signal the provider cannot get wrong: a `/company/` URL is
   * a page and an `/in/` URL is a person. A provider-supplied `type` string is
   * only consulted when no URL is present.
   */
  author_type: PostAuthorType;
  author_name: string | null;
  author_url: string | null;
  /**
   * The STABLE person identity, when the author is a person.
   *
   * `author.id` / `author.profileId` is the opaque `ACoAAA…` member urn, which
   * is the only author field that does not change: the public handle can be
   * edited and the URL carries a rotating `miniProfileUrn` tracking parameter.
   * Dedupe and identity matching key on this, never on the URL.
   */
  author_member_id: string | null;
  /** The vanity handle — "hnshah". Human-readable, and editable by its owner. */
  author_public_id: string | null;
  /** Self-written. NOT verified employment — see the post-search card. */
  author_headline: string | null;
  reaction_count: number | null;
  comment_count: number | null;
  source_provenance: string;
  field_trust: Record<string, FieldTrust>;
  missing_fields: string[];
  /** TRUE only with a post URL and a date. */
  is_evidence: boolean;
}

export interface NormalizedSocialComment {
  comment_url: string | null;
  posted_at: string | null;
  text: string | null;
  commenter_name: string | null;
  commenter_url: string | null;
  /** `actor.position` — self-written, and it names a role and an employer. */
  commenter_headline: string | null;
  /** Stable commenter key. One person may comment across many posts. */
  commenter_member_id: string | null;
  /** TRUE when the commenter is the post's own author replying to their thread. */
  is_post_author: boolean;
  /** The post the comment was left ON. A comment without one is unanchored. */
  parent_post_url: string | null;
  parent_post_id: string | null;
  source_provenance: string;
  missing_fields: string[];
  /** TRUE only with a commenter identity, a date AND a parent post. */
  is_evidence: boolean;
}

/** A LinkedIn URL decides the author's kind. The provider's label does not. */
export function authorTypeFromUrl(url: unknown, claimed?: unknown): PostAuthorType {
  const u = (s(url) ?? "").toLowerCase();
  if (/linkedin\.com\/company\//.test(u)) return "company";
  if (/linkedin\.com\/in\//.test(u)) return "person";
  const c = (s(claimed) ?? "").toLowerCase();
  if (c === "company" || c === "organization") return "company";
  // OBSERVED: the provider's label for a person is "profile", not "person" —
  // run 8Ks7TvqIiejDct5ha returned `author.type: "profile"` throughout, against
  // `"company"` on the company run. Both spellings are accepted.
  if (c === "person" || c === "profile" || c === "member") return "person";
  return "unknown";
}

function isoDateTime(v: unknown): string | null {
  const t = s(v);
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function normalizeSocialPost(
  r: Record<string, unknown>, actorKey: string,
): NormalizedSocialPost {
  const author = (r["author"] ?? {}) as Record<string, unknown>;
  const engagement = (r["engagement"] ?? r["socialCounts"] ?? {}) as Record<string, unknown>;

  // ── CORRECTED AGAINST LIVE OUTPUT, RUN 34dB6dpHJr34h8bIr (2026-08-22) ────
  //
  // Two misses, and either alone would have failed every row:
  //
  //   the post URL is `linkedinUrl`, not `postUrl` or `url`; and
  //   `postedAt` is an OBJECT — {timestamp, date, postedAgoShort,
  //   postedAgoText} — not a string. Passing the object to a date reader
  //   yielded null, so `is_evidence` was false for all 8 rows.
  //
  // The run also confirmed `author.type` is a real discriminator ("company"),
  // and that `author.linkedinUrl` carries a `/posts` suffix — which the
  // URL-shape check tolerates, since it matches on `/company/`.
  const postedAt = (r["postedAt"] ?? {}) as Record<string, unknown>;
  const post_url = pick(r, ["linkedinUrl", "shareLinkedinUrl", "postUrl", "post_url", "url"]);
  const posted_at = isoDateTime(
    postedAt["date"] ?? r["posted_at"] ?? r["publishedAt"] ?? r["date"]);
  // OBSERVED, run 8Ks7TvqIiejDct5ha: a person's `linkedinUrl` arrives as
  // `https://www.linkedin.com/in/hnshah?miniProfileUrn=urn%3Ali%3Afsd_profile%3A…`.
  // The query string is a rotating tracking parameter, so two posts by the same
  // person can carry two different URLs. Stripping it is what makes the URL
  // comparable at all; the stable key remains `author_member_id`.
  const author_url_raw = pick(author, ["linkedinUrl", "url", "profileUrl", "publicUrl"]);
  const author_url = author_url_raw ? author_url_raw.split("?")[0] : null;

  const out: NormalizedSocialPost = {
    post_url,
    posted_at,
    text: pick(r, ["content", "text", "postText", "commentary"]),
    author_type: authorTypeFromUrl(author_url, author["type"] ?? r["authorType"]),
    author_name: pick(author, ["name", "fullName", "title"]),
    author_url,
    // For a PERSON this is the headline. For a COMPANY the live run showed
    // `info` holding "1,649,614 followers" — a follower count, not a headline —
    // so it is only read when the author is a person.
    author_member_id: pick(author, ["profileId", "id"]),
    author_public_id: pick(author, ["publicIdentifier", "universalName"]),
    // OBSERVED, run 8Ks7TvqIiejDct5ha: for a PERSON `info` is the headline —
    // "CEO @ Crazy Egg (est. 2005), building tools teams use to make marketing
    // decisions." — which carries both the role and the employer. For a COMPANY
    // the same field held "1,649,614 followers". Same key, different facts, so
    // it is read only when the author is a person.
    author_headline: authorTypeFromUrl(author_url, author["type"]) === "person"
      ? pick(author, ["headline", "subtitle", "occupation", "info"])
      : pick(author, ["headline", "subtitle", "occupation"]),
    // `engagement.reactions` is an ARRAY of {type,count} breakdowns, so the
    // scalar total is `likes`. Reading `reactions` first would have returned
    // null from an array.
    reaction_count: pickNum(engagement, ["likes", "reactionCount"]),
    comment_count: pickNum(engagement, ["comments", "commentCount"]),
    source_provenance: actorKey,
    field_trust: {
      post_url: "direct",
      posted_at: "direct",
      text: "direct",
      // Derived from the URL shape, which is why it is trustworthy at all.
      author_type: "transformed",
      // Self-written by the author. Never employment evidence.
      author_headline: "unsafe",
    },
    missing_fields: [],
    is_evidence: false,
  };
  out.missing_fields = miss(out as unknown as Record<string, unknown>, [
    "post_url", "posted_at", "text", "author_name", "author_url",
    "author_member_id",
  ]);
  // THE GATE. A post with no URL cannot be cited and a post with no date cannot
  // be recent, so neither is evidence of anything.
  out.is_evidence = post_url !== null && posted_at !== null;
  return out;
}

export function normalizeSocialComment(
  r: Record<string, unknown>, actorKey: string, parentPostUrl: string | null = null,
): NormalizedSocialComment {
  // ── CORRECTED AGAINST LIVE OUTPUT, RUN 6YHiwmXEcP933uqst (2026-08-22) ────
  //
  // A COMMENT IS NOT A POST WITH A DIFFERENT NAME. The post-search actor emits
  // comments as SEPARATE dataset items discriminated by `type`, and almost
  // every field differs from the post shape:
  //
  //   post                        comment
  //   ----------------------      ---------------------------
  //   author.{name,linkedinUrl}   actor.{name,linkedinUrl}
  //   author.info (headline)      actor.position (headline)
  //   content                     commentary
  //   postedAt.date (object)      createdAt (flat ISO string)
  //   —                           postId  (the parent post)
  //   —                           actor.author (is this the OP replying?)
  //
  // Written from the post shape, this returned null for the commenter, the text
  // and the date on every comment — the whole comment-intent capability.
  //
  // The commenter's URL is also CLEAN here (`/in/apoorva-growth`), unlike a post
  // author's, which carries a rotating `miniProfileUrn` parameter.
  const author = (r["actor"] ?? r["author"] ?? r["commenter"] ?? {}) as Record<string, unknown>;
  const commenter_url_raw = pick(author, ["linkedinUrl", "url", "profileUrl"]);
  const commenter_url = commenter_url_raw ? commenter_url_raw.split("?")[0] : null;
  const posted_at = isoDateTime(
    r["createdAt"] ?? r["postedAt"] ?? r["posted_at"] ?? r["date"]);
  const commenter_name = pick(author, ["name", "fullName"]);
  const query = (r["query"] ?? {}) as Record<string, unknown>;

  const out: NormalizedSocialComment = {
    comment_url: pick(r, ["linkedinUrl", "commentUrl", "url", "permalink"]),
    posted_at,
    text: pick(r, ["commentary", "text", "content", "comment"]),
    commenter_name,
    commenter_url,
    // `actor.position` IS the headline on a comment, and it names role and
    // employer — "Co-founder, TriForge Labs", "CEO @ FastForward". It is
    // self-written, so it proposes an identity and verifies none of it.
    commenter_headline: pick(author, ["position", "headline", "subtitle", "occupation"]),
    // The STABLE commenter key. Observed: one person commented on three
    // different posts in a single run, under the same `actor.id`.
    commenter_member_id: pick(author, ["id", "profileId"]),
    // TRUE when the commenter is the post's own author replying in their own
    // thread — which is a different thing from a third party engaging.
    is_post_author: author["author"] === true,
    // `postId` is the parent's id; `query.post` is its URL. Both are provenance
    // that a comment cannot be read without: a comment with no parent has no
    // subject, and its words mean nothing on their own.
    parent_post_id: pick(r, ["postId"]),
    parent_post_url: parentPostUrl ?? pick(query, ["post"]) ?? pick(r, ["parentPostUrl"]),
    source_provenance: actorKey,
    missing_fields: [],
    is_evidence: false,
  };
  out.missing_fields = miss(out as unknown as Record<string, unknown>, [
    "posted_at", "text", "commenter_name", "commenter_url",
    "commenter_headline", "parent_post_url", "parent_post_id",
  ]);
  // THE GATE. A comment proves that a PERSON said something ABOUT something.
  // Without an identity there is no person; without a date there is no
  // "recently"; without a parent there is no subject the words are about.
  out.is_evidence = (commenter_url !== null || commenter_name !== null) &&
    posted_at !== null &&
    (out.parent_post_url !== null || out.parent_post_id !== null);
  return out;
}

/**
 * Split a post-search dataset into posts and comments.
 *
 * OBSERVED: one run with `maxPosts: 6` and `maxComments: 4` returned 28 items —
 * 5 posts and 23 comments — in ONE flat dataset, discriminated only by `type`.
 * A caller that assumed every row was a post would have normalised 23 comments
 * as malformed posts and billed for all of them.
 */
export function splitPostSearchRows(
  rows: readonly Record<string, unknown>[],
): { posts: Record<string, unknown>[]; comments: Record<string, unknown>[] } {
  const posts: Record<string, unknown>[] = [];
  const comments: Record<string, unknown>[] = [];
  for (const r of rows) {
    // The discriminator is explicit; the shape check is the fallback for a row
    // that somehow lacks it.
    const t = (s(r["type"]) ?? "").toLowerCase();
    if (t === "comment" || (r["postId"] != null && r["commentary"] != null)) {
      comments.push(r);
    } else {
      posts.push(r);
    }
  }
  return { posts, comments };
}

// ── NEWS ─────────────────────────────────────────────────────────────────────

export interface NormalizedNewsArticle {
  title: string | null;
  url: string | null;
  source: string | null;
  published_at: string | null;
  description: string | null;
  source_provenance: string;
  missing_fields: string[];
  /** TRUE only with a followable URL and a publication date. */
  is_evidence: boolean;
}

export function normalizeNewsArticle(r: Record<string, unknown>): NormalizedNewsArticle {
  // ── CORRECTED AGAINST LIVE OUTPUT, RUN ak9nBcyYkolVrLQhM (2026-08-22) ────
  //
  // The field is `url`, not `link`; `source` is a PLAIN STRING ("CNBC"), not an
  // object; and `description` is absent unless `extractDescriptions` is on —
  // which the compiler now forces, because the claim text is the evidence.
  // `decodeUrls: true` was confirmed working: the run returned real cnbc.com and
  // bloomberg.com URLs rather than Google redirects.
  const url = sanitizeUrl(pick(r, ["url", "link", "articleUrl"]));
  const published_at = isoDateTime(
    r["publishedAt"] ?? r["published_at"] ?? r["date"] ?? r["pubDate"]);
  const src = r["source"];
  const out: NormalizedNewsArticle = {
    title: pick(r, ["title", "headline"]),
    url,
    source: typeof src === "string" ? s(src)
      : s((src as Record<string, unknown>)?.["name"] ?? (src as Record<string, unknown>)?.["title"]),
    published_at,
    description: pick(r, ["description", "summary", "snippet"]),
    source_provenance: "apify_google_news",
    missing_fields: [],
    is_evidence: false,
  };
  out.missing_fields = miss(out as unknown as Record<string, unknown>, [
    "title", "url", "source", "published_at", "description",
  ]);
  // A claim with no article behind it is a rumour, and an undated article
  // cannot support "recently".
  out.is_evidence = url !== null && published_at !== null;
  return out;
}

// ── TECHNOLOGY ───────────────────────────────────────────────────────────────

export interface NormalizedTechnologyProfile {
  domain: string | null;
  technologies: string[];
  categories: string[];
  source_provenance: string;
  missing_fields: string[];
  /** TRUE with a domain and at least one detected technology. */
  is_evidence: boolean;
  /**
   * ALWAYS NULL, and deliberately present.
   *
   * BuiltWith reports what a domain runs NOW. It publishes no adoption date, so
   * "recently adopted X" is unanswerable. A field that is always null is louder
   * than an absent one: it says the question was asked and has no answer.
   */
  adopted_at: null;
}

export function normalizeTechnologyProfile(
  r: Record<string, unknown>,
): NormalizedTechnologyProfile {
  // ── CORRECTED AGAINST LIVE OUTPUT, RUN PD0F1XtytK3Z7juwM (2026-08-22) ────
  //
  // The row has exactly two top-level keys, `domain` and `techs`, and each tech
  // is {name, tag, categories[], link}. Categories are NESTED PER TECHNOLOGY,
  // so reading them from the top level returned an empty list — losing the
  // field that answers an AI-adoption question, since "AI" appears there.
  //
  // Volume observed: 120 technologies for notion.so, 260 for stripe.com, across
  // 22 distinct tags. Billing is per DOMAIN, so the volume is free in money and
  // expensive in payload.
  const domain = pick(r, ["domain", "rootDomain", "url", "hostname"]);
  const techs = Array.isArray(r["techs"]) ? r["techs"] as Array<Record<string, unknown>> : [];
  const technologies = techs.length
    ? techs.map((t) => s(t?.["name"])).filter((x): x is string => !!x)
    : pickList(r, ["technologies", "detected", "names"]);
  const categories = techs.length
    ? [...new Set(techs.flatMap((t) =>
        Array.isArray(t?.["categories"]) ? (t["categories"] as unknown[]).map((c) => s(c)) : []))]
      .filter((x): x is string => !!x)
    : pickList(r, ["categories", "groups"]);
  const out: NormalizedTechnologyProfile = {
    domain: domain ? domain.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0] : null,
    technologies,
    categories,
    source_provenance: "apify_builtwith_technology",
    missing_fields: [],
    is_evidence: false,
    adopted_at: null,
  };
  out.missing_fields = miss(out as unknown as Record<string, unknown>, [
    "domain", "technologies", "categories",
  ]);
  out.is_evidence = out.domain !== null && technologies.length > 0;
  return out;
}
