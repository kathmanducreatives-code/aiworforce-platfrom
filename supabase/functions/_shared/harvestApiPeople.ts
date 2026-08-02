// HarvestAPI LinkedIn Profile Search — input adapter (pure; imports only the
// deterministic people-search query builder). Actor: harvestapi/linkedin-profile-search
//
// Maps Agentory's generic sourcing input to the actor's official input schema.
//
// Hard rules enforced here:
//  - Never forward raw Agentory fields (location, max_results, role_keywords)
//    or unknown keys to Apify. Only emit official HarvestAPI fields.
//  - Optional fields are emitted only when present in `filters` (user_input).
//  - Company filters must be FULL LinkedIn company/school URLs; names are dropped.
//  - Locations use full names ("United States", not "us").
//  - profileScraperMode defaults to "Full"; "Full + email search" is never the default.
//  - searchQuery is a CONCISE market/category query only — never a tool name,
//    requested count, execution-mode phrase, title, location, or the serialized
//    user/agent instruction. Titles go to currentJobTitles, geography to locations.

import {
  parsePersonRoles,
  parseMarketTerms,
  buildMarketQuery,
  sanitizeSearchQuery,
  parsePeopleSearchIntent,
} from "./peopleSearchQueryBuilder.ts";

export interface GenericPeopleInput {
  query?: string | null;
  location?: string | null;
  role_keywords?: string[] | null;
  max_results: number;
  // Optional structured overrides/filters (Agentory tool_input.input).
  user_input?: Record<string, unknown> | null;
}

const HARVEST_SCRAPER_MODES = new Set<string>(["Short", "Full", "Full + email search"]);

// ── THE TWO SHORT ENUMS ARE DIFFERENT STRINGS ───────────────────────────────
// linkedin-profile-search takes "Short"; linkedin-company-employees takes
// "Short ($4 per 1k)" with the price INSIDE the value. Sending the wrong one is
// accepted silently and falls back to that Actor's default, which is Full.
//
// Verified live 2026-08-01; see hiringActorCatalog COMPANY_EMPLOYEES_SCRAPER_MODES.
const COMPANY_EMPLOYEES_MODES = new Set<string>([
  "Short ($4 per 1k)", "Full ($8 per 1k)", "Full + email search ($12 per 1k)",
]);

/**
 * Map any accepted spelling onto the company-employees enum.
 *
 * Callers (and stored tool inputs) have long passed the profile-search spelling,
 * so those aliases are translated rather than rejected — rejecting them would
 * break existing saved inputs. Email modes are never produced here.
 */
function toCompanyEmployeesMode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (COMPANY_EMPLOYEES_MODES.has(v)) return v;
  switch (v.toLowerCase()) {
    case "short": return "Short ($4 per 1k)";
    case "full": return "Full ($8 per 1k)";
    default: return null;
  }
}
const DEDUP_MODES = new Set<string>(["off", "insert_ids", "insert_profiles", "read_only"]);

// Full LinkedIn company/school URL (company filters require these, not names).
const LINKEDIN_COMPANY_URL_RE =
  /^https?:\/\/([a-z0-9-]+\.)?linkedin\.com\/(company|school|showcase)\/[A-Za-z0-9_\-%.]+\/?/i;

// Common abbreviations the planner emits → full country/region names.
const LOCATION_FULL_NAMES: Record<string, string> = {
  "us": "United States",
  "u.s.": "United States",
  "usa": "United States",
  "u.s.a.": "United States",
  "united states": "United States",
  "america": "United States",
  "uk": "United Kingdom",
  "u.k.": "United Kingdom",
  "united kingdom": "United Kingdom",
  "gb": "United Kingdom",
  "uae": "United Arab Emirates",
  "eu": "Europe",
};

export function normalizeLocationName(loc: string | null | undefined): string | null {
  if (!loc) return null;
  const t = String(loc).trim();
  if (!t) return null;
  return LOCATION_FULL_NAMES[t.toLowerCase()] ?? t;
}

function titleize(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Each role keyword is its OWN title alias: ["founder","co-founder","ceo"] ->
// ["Founder","Co-Founder","CEO"] (deduped). The actor filters on a LIST of
// titles, so joining them into one string ("Founder Co-Founder Ceo") matched
// nobody — that was the main people-search yield bug.
function deriveJobTitles(role_keywords: string[] | null | undefined): string[] {
  if (!Array.isArray(role_keywords)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of role_keywords) {
    const t = titleize(String(k).trim());
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out;
}

function strArray(v: unknown): string[] | null {
  if (Array.isArray(v)) {
    const arr = v.map((x) => String(x).trim()).filter(Boolean);
    return arr.length ? arr : null;
  }
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return null;
}

function companyUrls(v: unknown): string[] | null {
  const arr = strArray(v);
  if (!arr) return null;
  const urls = arr.filter((s) => LINKEDIN_COMPANY_URL_RE.test(s));
  return urls.length ? urls : null;
}

const STR_ARRAY_FILTERS = [
  "pastJobTitles",
  "schools",
  "firstNames",
  "lastNames",
  "profileLanguages",
  "companyHeadcount",
  "companyHeadquarterLocations",
  "yearsOfExperienceIds",
  "yearsAtCurrentCompanyIds",
  "seniorityLevelIds",
  "functionIds",
  "industryIds",
  "excludeLocations",
  "excludeCurrentJobTitles",
  "excludePastJobTitles",
  "excludeIndustryIds",
  "excludeSeniorityLevelIds",
  "excludeFunctionIds",
  "excludeSchools",
  "excludeCompanyHeadquarterLocations",
  "autoQuerySegmentationLevels",
  "autoQuerySegmentationTargetCountries",
] as const;

const COMPANY_URL_FILTERS = [
  "currentCompanies",
  "pastCompanies",
  "excludeCurrentCompanies",
  "excludePastCompanies",
] as const;

const BOOL_FILTERS = [
  "recentlyChangedJobs",
  "recentlyPostedOnLinkedIn",
  "autoQuerySegmentation",
] as const;

// Builds the official HarvestAPI actor input. Only official fields are emitted.
export function buildHarvestApiPeopleInput(generic: GenericPeopleInput): Record<string, unknown> {
  const f = (generic.user_input ?? {}) as Record<string, unknown>;

  // profileScraperMode — default "Full"; honor explicit valid override only.
  let mode = "Full";
  if (typeof f.profileScraperMode === "string" && HARVEST_SCRAPER_MODES.has(f.profileScraperMode)) {
    mode = f.profileScraperMode;
  }

  // currentJobTitles — explicit filter wins, else derive from role_keywords, else
  // parse person titles from the query text (fixes empty titles when role_keywords
  // is empty, e.g. plural "founders" that the caller's role regex missed).
  const derivedTitles = deriveJobTitles(generic.role_keywords);
  const currentJobTitles = strArray(f.currentJobTitles)
    ?? (derivedTitles.length ? derivedTitles : parsePersonRoles(generic.query));

  // locations — explicit filter wins (normalized), else the single generic
  // location, else parse geography from the query text.
  const explicitLocations = strArray(f.locations);
  const normLoc = normalizeLocationName(generic.location);
  const parsedLocations = parsePeopleSearchIntent(generic.query).locations;
  const locations = explicitLocations
    ? explicitLocations.map((l) => normalizeLocationName(l) ?? l)
    : normLoc
      ? [normLoc]
      : (parsedLocations.length ? parsedLocations : null);

  // searchQuery — a CONCISE fuzzy market/category query ONLY. Never a tool name,
  // requested count, execution-mode phrase, title, location, or the serialized
  // instruction. Explicit user_input.searchQuery (sanitized) wins; "" ⇒ omit.
  // Otherwise: parsed market/category terms → "A OR B"; else keyword terms; else a
  // sanitized remnant of the query (junk-stripped). Cap 300.
  const keywordTerms = strArray(f.keywords) ?? [];
  let searchQuery: string | undefined;
  if (typeof f.searchQuery === "string") {
    const sq = sanitizeSearchQuery(f.searchQuery);
    searchQuery = sq || undefined;
  } else {
    const marketSource = [String(generic.query ?? ""), keywordTerms.join(" ")].join(" ");
    const market = buildMarketQuery(parseMarketTerms(marketSource));
    searchQuery =
      market
      || sanitizeSearchQuery(keywordTerms.join(" "))
      || sanitizeSearchQuery(String(generic.query ?? ""))
      || undefined;
  }
  if (searchQuery) searchQuery = searchQuery.slice(0, 300);

  const maxItems = Math.max(1, Math.min(100, Number(generic.max_results) || 10));
  const startPage =
    typeof f.startPage === "number" && Number.isFinite(f.startPage) ? Math.max(1, Math.floor(f.startPage)) : 1;

  const out: Record<string, unknown> = {
    profileScraperMode: mode,
    maxItems,
    startPage,
  };
  if (searchQuery) out.searchQuery = searchQuery;
  if (currentJobTitles.length) out.currentJobTitles = currentJobTitles;
  if (locations) out.locations = locations;

  // optional string[] filters
  for (const key of STR_ARRAY_FILTERS) {
    const val = strArray(f[key]);
    if (val) out[key] = val;
  }

  // company filters — full LinkedIn URLs only; names silently dropped (rule 3)
  for (const key of COMPANY_URL_FILTERS) {
    const urls = companyUrls(f[key]);
    if (urls) out[key] = urls;
  }

  // optional booleans
  for (const key of BOOL_FILTERS) {
    if (typeof f[key] === "boolean") out[key] = f[key];
  }

  // optional numbers
  if (typeof f.takePages === "number" && Number.isFinite(f.takePages)) {
    out.takePages = Math.max(1, Math.floor(f.takePages));
  }

  // dedup mode (enum)
  if (typeof f.profileDeduplicationMode === "string" && DEDUP_MODES.has(f.profileDeduplicationMode)) {
    out.profileDeduplicationMode = f.profileDeduplicationMode;
  }

  return out;
}

export function buildHarvestApiCompanyEmployeesInput(generic: any): Record<string, unknown> {
  const f = (generic.user_input ?? {}) as Record<string, unknown>;
  
  let companies: string[] = [];
  if (Array.isArray(generic.companies)) {
    companies = generic.companies.filter((x: unknown): x is string => typeof x === "string" && !!String(x).trim());
  } else if (Array.isArray(f.companies)) {
    companies = f.companies.filter((x: unknown): x is string => typeof x === "string" && !!String(x).trim());
  } else if (typeof f.companyUrl === "string" && f.companyUrl.trim()) {
    companies = [f.companyUrl.trim()];
  } else if (typeof generic.query === "string" && generic.query.includes("linkedin.com/company/")) {
    companies = [generic.query.trim()];
  }
  
  // TWO DEFECTS FIXED HERE (both verified against the live schema 2026-08-01):
  //   1. the value was validated against the PROFILE-SEARCH enum, so
  //      "Short ($4 per 1k)" could never be produced; and
  //   2. it was emitted under the key `mode`, which this Actor does not have —
  //      the live field is `profileScraperMode`. The Actor therefore received no
  //      mode at all and applied its own default, Full ($8 per 1k).
  // Net effect: company-employees runs paid the Full rate and Short was
  // unreachable. Default stays Full here so behaviour changes only for callers
  // that actually asked for Short.
  const mode = toCompanyEmployeesMode(f.mode) ??
    toCompanyEmployeesMode(f.profileScraperMode) ??
    "Full ($8 per 1k)";
  
  const maxItems = Math.max(1, Math.min(100, Number(generic.max_results) || Number(generic.maxItems) || 10));
  
  const jobTitles = strArray(f.jobTitles) || strArray(f.currentJobTitles) || deriveJobTitles(generic.role_keywords);
  
  const explicitLocations = strArray(f.locations);
  const normLoc = normalizeLocationName(generic.location);
  const locations = explicitLocations
    ? explicitLocations.map((l) => normalizeLocationName(l) ?? l)
    : normLoc
      ? [normLoc]
      : null;
      
  const searchQuery = typeof f.searchQuery === "string" ? f.searchQuery : (generic.query && !generic.query.includes("linkedin.com/company/") ? generic.query : undefined);
  
  const out: Record<string, unknown> = {
    companies,
    // The live schema field. `mode` is retained alongside it for backward
    // compatibility with anything that reads this object back, but the Actor
    // only ever reads `profileScraperMode`.
    profileScraperMode: mode,
    mode,
    maxItems,
  };
  // A per-company bound is the whole reason to prefer this Actor over
  // profile-search, which has none. Honour it when the caller supplies one.
  const perCompany = Number(f.maxItemsPerCompany);
  if (Number.isFinite(perCompany) && perCompany > 0) {
    out.maxItemsPerCompany = Math.min(Math.trunc(perCompany), maxItems);
  }
  if (jobTitles && jobTitles.length > 0) out.jobTitles = jobTitles;
  if (locations && locations.length > 0) out.locations = locations;
  if (searchQuery) out.searchQuery = searchQuery;
  
  return out;
}
