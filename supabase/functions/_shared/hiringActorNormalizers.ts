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
