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

// ["react","developer"] -> ["React Developer"]. Planner-supplied multi-word
// titles (via filters.currentJobTitles) take precedence and skip this.
function deriveJobTitles(role_keywords: string[] | null | undefined): string[] {
  if (!Array.isArray(role_keywords)) return [];
  const joined = role_keywords.map((k) => String(k).trim()).filter(Boolean).join(" ");
  return joined ? [titleize(joined)] : [];
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

  // searchQuery — explicit filter, else role + location, else raw query. Cap 300.
  const partsQuery = [
    currentJobTitles.length ? currentJobTitles.join(" ") : (generic.role_keywords ?? []).join(" "),
    normLoc ?? (generic.location ?? ""),
  ]
    .map((p) => String(p).trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  const rawQuery =
    typeof f.searchQuery === "string" && f.searchQuery.trim()
      ? f.searchQuery.trim()
      : partsQuery || String(generic.query ?? "").trim();
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
