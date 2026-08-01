// TYPED PROVIDER INPUTS + DETERMINISTIC COMPILERS.
//
// Every compiler here REJECTS an invalid input rather than sending it. That
// matters because the benchmark found three ways an Actor accepts bad input and
// fails quietly instead of erroring:
//
//   * solidcode multi-value teamSize  -> zero rows, reported as "no matches"
//   * an unknown profileScraperMode   -> silent fallback to the expensive default
//   * job-search maxItems             -> per title PER location, so a "cap" of 25
//                                        with 4 titles is really 100 paid rows
//
// A silent wrong answer costs more than a loud failure, so the checks are up
// front and total. Nothing here performs I/O.

import {
  COMPANY_EMPLOYEES_SCRAPER_MODES, COMPANY_SCRAPER_MODES, COMPANY_SIZE_BANDS,
  EMAIL_ENRICHMENT_MODES, HIRING_ACTOR_CATALOG, JOB_EMPLOYMENT_TYPES,
  JOB_POSTED_LIMITS, JOB_SORT_BY, JOB_WORKPLACE_TYPES, PROFILE_SEARCH_SCRAPER_MODES,
  YC_MEMO23_INDUSTRIES, YC_MEMO23_MAX_SIZES, YC_MEMO23_MIN_SIZES, YC_MEMO23_MODES,
  YC_SOLIDCODE_INDUSTRIES, YC_SOLIDCODE_REGIONS, YC_SOLIDCODE_STATUSES,
  YC_SOLIDCODE_TEAM_SIZES,
} from "./hiringActorCatalog.ts";

// ── CONTRACTS ────────────────────────────────────────────────────────────────

export interface Memo23YcCompanyInput {
  mode: "companies" | "jobs";
  regions?: string[];
  industries?: string[];
  batch?: string[];
  isHiring?: boolean;
  minEmployeeSize?: string;
  maxEmployeeSize?: string;
  queries?: string[];
  scrapeOpenJobs?: boolean;
  scrapeFounderDetails?: boolean;
  maxItems: number;
  /** Always false. Email enrichment is out of scope for this architecture. */
  enrichEmails?: false;
}

export interface SolidcodeYcCompanyInput {
  searchQuery?: string;
  status?: string[];
  regions?: string[];
  industries?: string[];
  /** AT MOST ONE VALUE. Multiple values silently return zero rows. */
  teamSize?: string[];
  isHiring?: boolean;
  includeJobs?: boolean;
  includeFounders?: boolean;
  maxResults: number;
}

export interface HarvestCompanySearchInput {
  /** A company NAME keyword. Never a concept phrase. */
  searchQuery?: string;
  locations?: string[];
  industryIds?: string[];
  companySize?: string[];
  scraperMode: "short" | "full";
  maxItems: number;
}

export interface HarvestCompanyDetailsInput {
  companies?: string[];
  searches?: string[];
}

export interface HarvestJobSearchInput {
  /** MAX 10. Verified live schema limit. */
  company: string[];
  jobTitles: string[];
  locations?: string[];
  postedLimit?: typeof JOB_POSTED_LIMITS[number];
  workplaceType?: string[];
  employmentType?: string[];
  sortBy?: typeof JOB_SORT_BY[number];
  /** PER jobTitle PER location. Not a total. */
  maxItems: number;
}

export interface HarvestCompanyEmployeesInput {
  companies: string[];
  jobTitles?: string[];
  locations?: string[];
  /** MUST come from COMPANY_EMPLOYEES_SCRAPER_MODES (price is in the value). */
  profileScraperMode: typeof COMPANY_EMPLOYEES_SCRAPER_MODES[number];
  companyBatchMode?: "all_at_once" | "one_by_one";
  maxItems: number;
  maxItemsPerCompany?: number;
}

export interface HarvestProfileSearchInput {
  currentCompanies?: string[];
  currentJobTitles?: string[];
  locations?: string[];
  /** MUST come from PROFILE_SEARCH_SCRAPER_MODES — NOT the employees enum. */
  profileScraperMode: typeof PROFILE_SEARCH_SCRAPER_MODES[number];
  maxItems: number;
}

// ── COMPILATION RESULT ───────────────────────────────────────────────────────

export interface CostEstimate {
  start_usd: number;
  per_result_usd: number | null;
  /** Worst case for THIS input, including multiplier fields. */
  estimated_max_usd: number;
  /** Rows this input could return at worst — the multiplier made explicit. */
  max_expected_rows: number;
  multiplier_explanation?: string;
}

export interface CompiledActorCall<T> {
  ok: true;
  actorKey: string;
  actorId: string;
  input: T;
  inputHash: string;
  /** Stable identity for the batch this call belongs to (idempotency + audit). */
  batchIdentity: string;
  expectedOutputType: "company" | "job" | "person";
  cost: CostEstimate;
  schemaBuild: string;
  warnings: string[];
}

export interface CompileFailure {
  ok: false;
  actorKey: string;
  errors: string[];
}

export type CompileResult<T> = CompiledActorCall<T> | CompileFailure;

// ── HELPERS ──────────────────────────────────────────────────────────────────

/** FNV-1a. Stable across runs; used for idempotency keys, never for secrecy. */
export function hashInput(v: unknown): string {
  const s = canonical(v);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

const LINKEDIN_COMPANY_URL =
  /^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\/(company|school|showcase)\/[A-Za-z0-9_\-%.]+\/?$/i;

function checkEnum(errors: string[], field: string, values: string[] | undefined,
                   allowed: readonly string[]): void {
  for (const v of values ?? []) {
    if (!allowed.includes(v)) {
      errors.push(`${field}: "${v}" is not a verified enum value (allowed: ${allowed.join(" | ")})`);
    }
  }
}

function checkMax(errors: string[], field: string, arr: unknown[] | undefined, max: number): void {
  if (arr && arr.length > max) errors.push(`${field}: ${arr.length} exceeds the verified limit of ${max}`);
}

function fail(actorKey: string, errors: string[]): CompileFailure {
  return { ok: false, actorKey, errors };
}

function build<T>(actorKey: string, input: T, outType: "company" | "job" | "person",
                  cost: CostEstimate, warnings: string[], batchSeed: string): CompiledActorCall<T> {
  const card = HIRING_ACTOR_CATALOG[actorKey];
  const inputHash = hashInput(input);
  return {
    ok: true, actorKey, actorId: card.actor_id, input, inputHash,
    batchIdentity: `${actorKey}:${batchSeed}:${inputHash}`,
    expectedOutputType: outType, cost, schemaBuild: card.schema_build, warnings,
  };
}

function cost(actorKey: string, rows: number, perResultOverride?: number,
              explanation?: string): CostEstimate {
  const c = HIRING_ACTOR_CATALOG[actorKey].cost_model;
  const per = perResultOverride ?? c.per_result_usd ?? 0;
  const raw = c.start_usd + rows * per;
  return {
    start_usd: c.start_usd, per_result_usd: per,
    estimated_max_usd: Number(Math.max(raw, c.minimum_total_usd ?? 0).toFixed(6)),
    max_expected_rows: rows,
    ...(explanation ? { multiplier_explanation: explanation } : {}),
  };
}

// ── COMPILERS ────────────────────────────────────────────────────────────────

export function compileMemo23YcInput(i: Memo23YcCompanyInput): CompileResult<Memo23YcCompanyInput> {
  const K = "apify_yc_companies_memo23";
  const e: string[] = []; const w: string[] = [];
  if (!YC_MEMO23_MODES.includes(i.mode)) e.push(`mode: "${i.mode}" invalid`);
  checkEnum(e, "industries", i.industries, YC_MEMO23_INDUSTRIES);
  if (i.minEmployeeSize && !YC_MEMO23_MIN_SIZES.includes(i.minEmployeeSize as never)) {
    e.push(`minEmployeeSize: "${i.minEmployeeSize}" is not a verified value`);
  }
  if (i.maxEmployeeSize && !YC_MEMO23_MAX_SIZES.includes(i.maxEmployeeSize as never)) {
    e.push(`maxEmployeeSize: "${i.maxEmployeeSize}" is not a verified value`);
  }
  if (!Number.isInteger(i.maxItems) || i.maxItems < 1) e.push("maxItems must be a positive integer");
  // COST + CONTACT SAFETY
  if (i.enrichEmails) e.push("enrichEmails is forbidden — no email enrichment in this architecture");
  if ((i.mode ?? "companies") !== "companies" && i.scrapeOpenJobs) {
    w.push("scrapeOpenJobs applies to Companies mode only and will be ignored");
  }
  if (i.scrapeFounderDetails) w.push("scrapeFounderDetails adds one HTTP request per company and slows the run");
  if (e.length) return fail(K, e);
  w.push("teamSize from this Actor is advisory and may be stale — never satisfies a size gate");
  w.push("this Actor supplies no LinkedIn company URL");
  return build(K, { ...i, enrichEmails: false as const }, "company",
    cost(K, i.maxItems, undefined, "maxItems is a PER-URL / per-filter-run cap, not a global cap"),
    w, i.mode);
}

export function compileSolidcodeYcInput(i: SolidcodeYcCompanyInput): CompileResult<SolidcodeYcCompanyInput> {
  const K = "apify_yc_companies_solidcode";
  const e: string[] = []; const w: string[] = [];
  checkEnum(e, "status", i.status, YC_SOLIDCODE_STATUSES);
  checkEnum(e, "regions", i.regions, YC_SOLIDCODE_REGIONS);
  checkEnum(e, "industries", i.industries, YC_SOLIDCODE_INDUSTRIES);
  checkEnum(e, "teamSize", i.teamSize, YC_SOLIDCODE_TEAM_SIZES);
  // THE HARD RULE. Two values return zero rows and look like a true negative.
  if (i.teamSize && i.teamSize.length > 1) {
    e.push(
      `teamSize: ${i.teamSize.length} values supplied, but this Actor ANDs them and returns ZERO rows ` +
      `(verified 2026-08-01). Fan out one call per band via fanOutSolidcodeTeamSizes().`,
    );
  }
  if (!Number.isInteger(i.maxResults) || i.maxResults < 1) e.push("maxResults must be a positive integer");
  if (e.length) return fail(K, e);
  w.push("fallback Actor only — prefer memo23 for primary YC discovery");
  return build(K, i, "company", cost(K, i.maxResults), w, i.teamSize?.[0] ?? "any-size");
}

/**
 * Turn a multi-band size request into one VALID call per band.
 *
 * The whole point of the hard rule above: the caller still gets every band, but
 * as separately identified calls whose cost is visible, instead of one silently
 * empty call.
 */
export function fanOutSolidcodeTeamSizes(
  base: Omit<SolidcodeYcCompanyInput, "teamSize">, bands: string[],
): CompileResult<SolidcodeYcCompanyInput>[] {
  if (bands.length === 0) return [compileSolidcodeYcInput({ ...base })];
  return bands.map((b) => compileSolidcodeYcInput({ ...base, teamSize: [b] }));
}

export function compileHarvestCompanySearchInput(
  i: HarvestCompanySearchInput,
): CompileResult<HarvestCompanySearchInput> {
  const K = "apify_linkedin_company_search";
  const e: string[] = []; const w: string[] = [];
  if (!COMPANY_SCRAPER_MODES.includes(i.scraperMode)) e.push(`scraperMode: "${i.scraperMode}" invalid`);
  checkEnum(e, "companySize", i.companySize, COMPANY_SIZE_BANDS);
  checkMax(e, "locations", i.locations, 20);
  checkMax(e, "industryIds", i.industryIds, 20);
  if (!Number.isInteger(i.maxItems) || i.maxItems < 1 || i.maxItems > 1000) {
    e.push("maxItems must be an integer between 1 and 1000");
  }
  if (e.length) return fail(K, e);
  // searchQuery is a NAME match. A concept phrase returns almost nothing.
  if (i.searchQuery && i.searchQuery.trim().split(/\s+/).length > 2) {
    w.push(
      `searchQuery "${i.searchQuery}" looks conceptual; this field matches company NAMES. ` +
      `A 3-word concept returned 1 company in the benchmark. Prefer filters.`,
    );
  }
  if (i.companySize?.length) {
    w.push("companySize filters employeeCountRange, which contradicts exact employeeCount — a hint, not proof");
  }
  if (i.industryIds?.length) w.push("provider industry is not proof of industry — enrichment is required");
  if (i.scraperMode === "short") w.push("short mode returns employeeCount=null — size is unverifiable here");
  w.push("CANDIDATES ONLY — output cannot satisfy a Company Brain hard gate without enrichment");
  const per = i.scraperMode === "full" ? 0.004 : 0.002;
  return build(K, i, "company", cost(K, i.maxItems, per), w, i.scraperMode);
}

export function compileHarvestCompanyDetailsInput(
  i: HarvestCompanyDetailsInput,
): CompileResult<HarvestCompanyDetailsInput> {
  const K = "apify_linkedin_company_details";
  const e: string[] = [];
  const companies = i.companies ?? []; const searches = i.searches ?? [];
  if (companies.length === 0 && searches.length === 0) {
    e.push("supply at least one of companies[] or searches[]");
  }
  for (const c of companies) {
    if (!LINKEDIN_COMPANY_URL.test(c)) e.push(`companies: "${c}" is not a LinkedIn company URL`);
  }
  if (e.length) return fail(K, e);
  return build(K, i, "company", cost(K, companies.length + searches.length), [
    "foundedOn is frequently null — never require it",
  ], "enrich");
}

export function compileHarvestJobSearchInput(
  i: HarvestJobSearchInput,
): CompileResult<HarvestJobSearchInput> {
  const K = "apify_linkedin_job_search";
  const e: string[] = []; const w: string[] = [];
  if (!i.company?.length) e.push("company[] is required — this Actor is for company-scoped verification only");
  checkMax(e, "company", i.company, 10);
  if (!i.jobTitles?.length) e.push("jobTitles[] is required");
  if (i.postedLimit && !JOB_POSTED_LIMITS.includes(i.postedLimit)) {
    e.push(`postedLimit: "${i.postedLimit}" invalid — verified enum is ${JOB_POSTED_LIMITS.join(" | ")} (never numeric days)`);
  }
  checkEnum(e, "workplaceType", i.workplaceType, JOB_WORKPLACE_TYPES);
  checkEnum(e, "employmentType", i.employmentType, JOB_EMPLOYMENT_TYPES);
  if (i.sortBy && !JOB_SORT_BY.includes(i.sortBy)) e.push(`sortBy: "${i.sortBy}" invalid`);
  if (!Number.isInteger(i.maxItems) || i.maxItems < 1) e.push("maxItems must be a positive integer");
  if (e.length) return fail(K, e);
  // THE MULTIPLIER, MADE EXPLICIT.
  const locs = Math.max(1, i.locations?.length ?? 1);
  const rows = i.maxItems * i.jobTitles.length * locs;
  w.push("jobTitles matching is FUZZY — a deterministic title post-filter is mandatory");
  w.push("the posting company may not be the employer — run aggregator evidence before trusting it");
  return build(K, i, "job",
    cost(K, rows, undefined,
      `maxItems(${i.maxItems}) x jobTitles(${i.jobTitles.length}) x locations(${locs}) = up to ${rows} paid rows`),
    w, `${i.company.length}co`);
}

export function compileHarvestCompanyEmployeesInput(
  i: HarvestCompanyEmployeesInput,
): CompileResult<HarvestCompanyEmployeesInput> {
  const K = "apify_linkedin_company_employees";
  const e: string[] = []; const w: string[] = [];
  if (!i.companies?.length) e.push("companies[] is required");
  checkMax(e, "companies", i.companies, 1000);
  checkMax(e, "jobTitles", i.jobTitles, 50);
  for (const c of i.companies ?? []) {
    if (!LINKEDIN_COMPANY_URL.test(c)) e.push(`companies: "${c}" is not a LinkedIn company URL`);
  }
  if (!COMPANY_EMPLOYEES_SCRAPER_MODES.includes(i.profileScraperMode)) {
    // The most valuable single check here: the sibling Actor's value is the
    // likeliest wrong input, and it fails SILENTLY on the platform.
    const looksLikeProfileSearch = (PROFILE_SEARCH_SCRAPER_MODES as readonly string[])
      .includes(i.profileScraperMode as string);
    e.push(
      `profileScraperMode: "${i.profileScraperMode}" invalid for this Actor` +
      (looksLikeProfileSearch
        ? " — that is the linkedin-profile-search enum. This Actor embeds the price in the value."
        : "") +
      ` Allowed: ${COMPANY_EMPLOYEES_SCRAPER_MODES.join(" | ")}`,
    );
  }
  if (EMAIL_ENRICHMENT_MODES.includes(i.profileScraperMode)) {
    e.push("email search mode is forbidden — no contact enrichment in this layer");
  }
  if (!Number.isInteger(i.maxItems) || i.maxItems < 1) e.push("maxItems must be a positive integer");
  if (e.length) return fail(K, e);
  if (i.maxItemsPerCompany === undefined) {
    w.push("no maxItemsPerCompany set — results are unbounded per company");
  }
  const per = i.profileScraperMode.startsWith("Short") ? 0.003 : 0.008;
  return build(K, i, "person", cost(K, i.maxItems, per), w, `${i.companies.length}co`);
}

export function compileHarvestProfileSearchInput(
  i: HarvestProfileSearchInput,
): CompileResult<HarvestProfileSearchInput> {
  const K = "apify_people_search";
  const e: string[] = []; const w: string[] = [];
  checkMax(e, "currentCompanies", i.currentCompanies, 50);
  checkMax(e, "currentJobTitles", i.currentJobTitles, 50);
  if (!PROFILE_SEARCH_SCRAPER_MODES.includes(i.profileScraperMode)) {
    const looksLikeEmployees = (COMPANY_EMPLOYEES_SCRAPER_MODES as readonly string[])
      .includes(i.profileScraperMode as string);
    e.push(
      `profileScraperMode: "${i.profileScraperMode}" invalid for this Actor` +
      (looksLikeEmployees
        ? " — that is the linkedin-company-employees enum, which embeds a price string."
        : "") +
      ` Allowed: ${PROFILE_SEARCH_SCRAPER_MODES.join(" | ")}`,
    );
  }
  if (EMAIL_ENRICHMENT_MODES.includes(i.profileScraperMode)) {
    e.push("email search mode is forbidden — no contact enrichment in this layer");
  }
  if (!Number.isInteger(i.maxItems) || i.maxItems < 1) e.push("maxItems must be a positive integer");
  if (e.length) return fail(K, e);
  w.push("fallback only — no per-company cap exists and the run minimum is $0.10");
  return build(K, i, "person", cost(K, i.maxItems), w, "profile-search");
}
