// HarvestAPI LinkedIn Profile Search — input adapter (pure, no imports).
// Actor: harvestapi/linkedin-profile-search
//
// Maps Agentory's generic sourcing input to the actor's official input schema.
// Kept import-free so it is unit-testable in isolation (Deno edge + Node tests).
//
// Hard rules enforced here:
//  - Never forward raw Agentory fields (location, max_results, role_keywords)
//    or unknown keys to Apify. Only emit official HarvestAPI fields.
//  - Optional fields are emitted only when present in `filters` (user_input).
//  - Company filters must be FULL LinkedIn company/school URLs; names are dropped.
//  - Locations use full names ("United States", not "us").
//  - profileScraperMode defaults to "Full"; "Full + email search" is never the default.

export interface GenericPeopleInput {
  query?: string | null;
  location?: string | null;
  role_keywords?: string[] | null;
  max_results: number;
  // Optional structured overrides/filters (Agentory tool_input.input).
  user_input?: Record<string, unknown> | null;
}

const HARVEST_SCRAPER_MODES = new Set<string>(["Short", "Full", "Full + email search"]);
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

  // currentJobTitles — explicit filter wins, else derive from role_keywords.
  const currentJobTitles = strArray(f.currentJobTitles) ?? deriveJobTitles(generic.role_keywords);

  // locations — explicit filter wins (each normalized), else single location.
  const explicitLocations = strArray(f.locations);
  const normLoc = normalizeLocationName(generic.location);
  const locations = explicitLocations
    ? explicitLocations.map((l) => normalizeLocationName(l) ?? l)
    : normLoc
      ? [normLoc]
      : null;

  // searchQuery — must carry INDUSTRY/CATEGORY context, not just title+location,
  // or the actor returns any "Founder in London". Compose: one representative
  // title + industry keywords (user_input.keywords) + location. Explicit
  // f.searchQuery wins; generic.query is the final fallback. Cap 300.
  const keywordTerms = strArray(f.keywords) ?? [];
  const repTitle = currentJobTitles[0] ?? (generic.role_keywords ?? [])[0] ?? "";
  const loc = normLoc ?? (generic.location ?? "");
  // Base on generic.query (planner fills it with role + industry/category), then
  // fold in any extra keyword terms + location if not already present.
  const baseTerms = String(generic.query ?? "").trim() || repTitle;
  const composedQuery = [
    baseTerms,
    keywordTerms.filter((k) => !baseTerms.toLowerCase().includes(k.toLowerCase())).join(" "),
    loc && !baseTerms.toLowerCase().includes(loc.toLowerCase()) ? loc : "",
  ]
    .map((p) => String(p).trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  const rawQuery =
    typeof f.searchQuery === "string" && f.searchQuery.trim()
      ? f.searchQuery.trim()
      : composedQuery || repTitle;
  const searchQuery = rawQuery.slice(0, 300);

  const maxItems = Math.max(1, Math.min(100, Number(generic.max_results) || 10));
  const startPage =
    typeof f.startPage === "number" && Number.isFinite(f.startPage) ? Math.max(1, Math.floor(f.startPage)) : 1;

  const out: Record<string, unknown> = {
    profileScraperMode: mode,
    searchQuery,
    maxItems,
    startPage,
  };
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
  
  let mode = "Full";
  if (typeof f.mode === "string" && HARVEST_SCRAPER_MODES.has(f.mode)) {
    mode = f.mode;
  } else if (typeof f.profileScraperMode === "string" && HARVEST_SCRAPER_MODES.has(f.profileScraperMode)) {
    mode = f.profileScraperMode;
  }
  
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
    mode,
    maxItems,
  };
  if (jobTitles && jobTitles.length > 0) out.jobTitles = jobTitles;
  if (locations && locations.length > 0) out.locations = locations;
  if (searchQuery) out.searchQuery = searchQuery;
  
  return out;
}
