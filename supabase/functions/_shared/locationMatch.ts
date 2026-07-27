// Country-aware location matching for strict geography gating. Pure / import-free.
//
// Root cause it fixes (live Q1 plan f9531e85): the gates substring-matched a
// provider location STRING ("Greater Philadelphia") against the required country
// ("United States") and rejected 22 genuine US profiles. Provider output actually
// carries structured geography (location.parsed.country="United States",
// countryCode="US"); this module uses that evidence.
//
// Matching order (Section 5): country code → parsed country → region/locality
// (only for a specific city/region requirement) → human-readable fallback. No
// external geocoding, no LLM, no silent weakening of a hard geography constraint.

// Canonical country codes for common aliases (deliberately small + explicit;
// NOT a broad free-text country detector).
const COUNTRY_ALIASES: Record<string, string> = {
  "united states": "US", "united states of america": "US", "usa": "US",
  "u.s.a.": "US", "u.s.a": "US", "u.s.": "US", "u.s": "US", "us": "US", "america": "US",
  "united kingdom": "GB", "great britain": "GB", "britain": "GB",
  "u.k.": "GB", "u.k": "GB", "uk": "GB", "gb": "GB",
  "canada": "CA", "ca": "CA",
  "australia": "AU", "au": "AU",
};

/** Normalize a country NAME or CODE ("United States"/"USA"/"US") to a canonical
 *  code ("US"), or null if the value is not a recognized country designator. */
export function normalizeCountry(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (COUNTRY_ALIASES[raw]) return COUNTRY_ALIASES[raw];
  const stripped = raw.replace(/[.,]+$/, "").trim();
  if (COUNTRY_ALIASES[stripped]) return COUNTRY_ALIASES[stripped];
  return null;
}

// Free-text country detection: long unambiguous names as substrings; short codes
// only as WHOLE tokens (so "Houston" never matches "us", "California" never "ca").
const TEXT_COUNTRY_PATTERNS: Array<[RegExp, string]> = [
  [/\bunited states of america\b/i, "US"],
  [/\bunited states\b/i, "US"],
  [/\busa\b/i, "US"],
  [/\bu\.?s\.?a\.?\b/i, "US"],
  [/\bamerica\b/i, "US"],
  [/\bunited kingdom\b/i, "GB"],
  [/\bgreat britain\b/i, "GB"],
  [/\bu\.?k\.?\b/i, "GB"],
  [/\bcanada\b/i, "CA"],
  [/\baustralia\b/i, "AU"],
  [/\bus\b/i, "US"],
  [/\buk\b/i, "GB"],
  [/\bgb\b/i, "GB"],
  [/\bau\b/i, "AU"],
  // "ca" is intentionally excluded (ambiguous with the US state California).
];

/** Detect a country in a free-text location string, or null. Alias tables only. */
export function detectCountryInText(text: string | null | undefined): string | null {
  const t = String(text ?? "");
  if (!t.trim()) return null;
  for (const [re, code] of TEXT_COUNTRY_PATTERNS) if (re.test(t)) return code;
  return null;
}

// ------------------------------------------- subnational region evidence ----
//
// SECOND ROOT CAUSE (production task bb1ce7fe): job locations arrive as
// city/state strings — "Dallas, TX", "San Francisco, CA", "Austin, Texas" — and
// the country detector above knows only country names and country codes. Every
// one of those resolved to NO country evidence, so 20 genuinely US jobs were
// rejected as `missing location evidence` and no company ever reached
// enrichment. A US state IS country evidence; the gate just could not read it.
//
// THE RULE THAT KEEPS THIS SAFE: a region is only read from a CONSTRAINED
// STRUCTURE — the trailing comma-delimited component of a location string, or a
// dedicated structured region field. Never from an arbitrary token anywhere in
// free text, because "Account Executive, CA market" and a company name are not
// geography. This is a reviewed lookup table, not a fuzzy guess.
//
// AMBIGUOUS CODES ARE REFUSED. `WA` is Washington and Western Australia; `NT` is
// Northwest Territories and Northern Territory; `SA` is South Australia and
// South Africa. A bare code that maps to more than one country resolves to NULL
// and the full region name is required instead. Under a HARD geography
// constraint a false ACCEPT (sourcing the wrong country) is worse than a false
// reject, so ambiguity always loses.

/** Full region names → country. Unambiguous by construction. */
const REGION_NAME_TO_COUNTRY: Record<string, string> = {};
/** Region CODES → country. Codes claimed by two countries are omitted. */
const REGION_CODE_TO_COUNTRY: Record<string, string> = {};

/**
 * Register a country's regions.
 *
 * A NULL name means "code only": the region's full name collides with something
 * else (a sovereign country) and must not be matched as text.
 */
function registerRegions(country: string, entries: Array<[string | null, string | null]>): void {
  for (const [name, code] of entries) {
    if (name) REGION_NAME_TO_COUNTRY[name.toLowerCase()] = country;
    if (code) {
      // A code already claimed by another country is ambiguous: remove both.
      const existing = REGION_CODE_TO_COUNTRY[code];
      if (existing && existing !== country) AMBIGUOUS_REGION_CODES.add(code);
      else REGION_CODE_TO_COUNTRY[code] = country;
    }
  }
}

/**
 * Codes deliberately refused because more than one country uses them.
 *
 * Seeded with `SA`, which is South Australia here but is far more widely read as
 * South Africa, and is therefore never safe as a bare code.
 */
const AMBIGUOUS_REGION_CODES = new Set<string>(["SA"]);

registerRegions("US", [
  ["Alabama", "AL"], ["Alaska", "AK"], ["Arizona", "AZ"], ["Arkansas", "AR"],
  ["California", "CA"], ["Colorado", "CO"], ["Connecticut", "CT"], ["Delaware", "DE"],
  ["Florida", "FL"],
  // "Georgia" is a SOVEREIGN COUNTRY as well as a US state, so the NAME is
  // deliberately NOT registered — "Tbilisi, Georgia" must not resolve to the
  // United States. The code `GA` is unambiguous and still resolves, so
  // "Atlanta, GA" works. Same principle as WA / NT / SA: when a token names two
  // places, the unambiguous form is required and a false ACCEPT is never traded
  // away for reach.
  [null, "GA"],
  ["Hawaii", "HI"], ["Idaho", "ID"],
  ["Illinois", "IL"], ["Indiana", "IN"], ["Iowa", "IA"], ["Kansas", "KS"],
  ["Kentucky", "KY"], ["Louisiana", "LA"], ["Maine", "ME"], ["Maryland", "MD"],
  ["Massachusetts", "MA"], ["Michigan", "MI"], ["Minnesota", "MN"], ["Mississippi", "MS"],
  ["Missouri", "MO"], ["Montana", "MT"], ["Nebraska", "NE"], ["Nevada", "NV"],
  ["New Hampshire", "NH"], ["New Jersey", "NJ"], ["New Mexico", "NM"], ["New York", "NY"],
  ["North Carolina", "NC"], ["North Dakota", "ND"], ["Ohio", "OH"], ["Oklahoma", "OK"],
  ["Oregon", "OR"], ["Pennsylvania", "PA"], ["Rhode Island", "RI"], ["South Carolina", "SC"],
  ["South Dakota", "SD"], ["Tennessee", "TN"], ["Texas", "TX"], ["Utah", "UT"],
  ["Vermont", "VT"], ["Virginia", "VA"], ["Washington", "WA"], ["West Virginia", "WV"],
  ["Wisconsin", "WI"], ["Wyoming", "WY"],
  ["District of Columbia", "DC"], ["Washington DC", null], ["Puerto Rico", "PR"],
]);

registerRegions("CA", [
  ["Alberta", "AB"], ["British Columbia", "BC"], ["Manitoba", "MB"],
  ["New Brunswick", "NB"], ["Newfoundland and Labrador", "NL"], ["Nova Scotia", "NS"],
  ["Northwest Territories", "NT"], ["Nunavut", "NU"], ["Ontario", "ON"],
  ["Prince Edward Island", "PE"], ["Quebec", "QC"], ["Québec", "QC"],
  ["Saskatchewan", "SK"], ["Yukon", "YT"],
]);

registerRegions("GB", [
  ["England", null], ["Scotland", null], ["Wales", null], ["Northern Ireland", null],
]);

registerRegions("AU", [
  ["New South Wales", "NSW"], ["Victoria", "VIC"], ["Queensland", "QLD"],
  ["South Australia", "SA"], ["Western Australia", "WA"], ["Tasmania", "TAS"],
  ["Northern Territory", "NT"], ["Australian Capital Territory", "ACT"],
]);

/**
 * Metro / colloquial areas that unambiguously name one country.
 *
 * Kept deliberately tiny and reviewed. These are matched as whole phrases, never
 * as tokens, so "Bay Area" inside a sentence cannot become geography.
 */
const METRO_TO_COUNTRY: Record<string, string> = {
  "san francisco bay area": "US", "bay area": "US", "greater boston": "US",
  "greater philadelphia": "US", "greater new york city area": "US",
  "greater los angeles area": "US", "greater seattle area": "US",
  "greater toronto area": "CA", "greater london": "GB", "greater sydney": "AU",
};

/**
 * Legal-entity suffixes that collide with region codes.
 *
 * "Delta, Co" is a company, not Colorado. These are refused unless written in
 * the ALL-CAPS form a region code actually uses — "Denver, CO" is Colorado,
 * "Delta, Co" is not. Found by the company-name test in
 * subnationalLocationEvidence.test.ts, which is exactly what it is there for.
 */
const CORPORATE_SUFFIXES = new Set([
  "co", "inc", "llc", "ltd", "lp", "llp", "plc", "corp", "corporation",
  "company", "group", "holdings", "gmbh", "ag", "nv", "bv", "pty", "ab", "oy",
]);

/** Normalize one region token ("TX", "Texas") to a country, or null. */
export function normalizeRegionToken(token: string | null | undefined): string | null {
  const raw = String(token ?? "").trim().replace(/[.]+$/, "");
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (REGION_NAME_TO_COUNTRY[lower]) return REGION_NAME_TO_COUNTRY[lower];
  // Codes only in their canonical short shape, and never when two countries claim them.
  if (/^[A-Za-z]{2,3}$/.test(raw)) {
    // A legal suffix only counts as a region when it is written as a code.
    if (CORPORATE_SUFFIXES.has(lower) && raw !== raw.toUpperCase()) return null;
    const code = raw.toUpperCase();
    if (AMBIGUOUS_REGION_CODES.has(code)) return null;
    return REGION_CODE_TO_COUNTRY[code] ?? null;
  }
  return null;
}

/**
 * Infer a country from the STRUCTURE of a location string.
 *
 * Only two shapes are read: a reviewed metro phrase, and the trailing
 * comma-delimited component ("Dallas, TX" → "TX"). Anything else returns null —
 * this never scans the whole string for region-shaped tokens.
 */
export function detectCountryFromRegionText(text: string | null | undefined): string | null {
  const t = String(text ?? "").trim();
  if (!t) return null;

  const lower = t.toLowerCase();
  for (const [phrase, country] of Object.entries(METRO_TO_COUNTRY)) {
    if (lower === phrase || lower.endsWith(` ${phrase}`) || lower.startsWith(`${phrase},`)) return country;
  }

  // Trailing region component. Bounded length so a sentence tail cannot qualify.
  const m = /,\s*([A-Za-z][A-Za-z .'-]{0,28})\s*$/.exec(t);
  if (!m) return null;
  return normalizeRegionToken(m[1]);
}

export interface CandidateLocation {
  /** Human-readable location text ("Greater Philadelphia"). Preserved for UI/ranking. */
  text?: string | null;
  /** Parsed country name ("United States"). */
  country?: string | null;
  /** Parsed ISO country code ("US"). */
  country_code?: string | null;
  city?: string | null;
  region?: string | null;
}

export type LocationRejectReason = "wrong country" | "wrong city/region" | "missing location evidence";

/**
 * How the country was established. Safe metadata only — a field NAME and a
 * normalized code, never a raw provider payload.
 */
export type LocationMatchMode =
  | "structured_country"
  | "structured_region"
  | "city_region_text"
  | "country_text"
  | "unresolved";

export interface LocationMatch {
  ok: boolean;
  reason?: LocationRejectReason;
  /** Which kind of evidence decided it. */
  mode?: LocationMatchMode;
  /** The field the evidence came from ("country_code", "text", …). */
  evidence_source?: string;
  /** Canonical country code resolved from the candidate, when any. */
  normalized_country?: string | null;
}

/**
 * EVIDENCE PRECEDENCE, applied in this exact order.
 *
 *   1. structured country_code   — the provider stated the country outright
 *   2. structured country name
 *   3. structured region field   — a dedicated state/province field
 *   4. country named in the text — "…, United States"
 *   5. region inferred from text structure — "Dallas, TX"
 *
 * Structured beats inferred, always. When a provider says `country_code = "CA"`
 * and the text reads "San Francisco, CA", the structured country WINS and the
 * candidate is Canadian — the text is not consulted at all. That is a documented
 * decision, not a coin toss: a provider's own country field is stronger evidence
 * than our reading of a comma.
 */
function resolveCandidateCountry(
  cand: CandidateLocation,
): { code: string; mode: LocationMatchMode; source: string } | null {
  const byCode = normalizeCountry(cand.country_code);
  if (byCode) return { code: byCode, mode: "structured_country", source: "country_code" };

  const byName = normalizeCountry(cand.country);
  if (byName) return { code: byName, mode: "structured_country", source: "country" };

  const byRegionField = normalizeRegionToken(cand.region);
  if (byRegionField) return { code: byRegionField, mode: "structured_region", source: "region" };

  const byText = detectCountryInText(cand.text);
  if (byText) return { code: byText, mode: "country_text", source: "text" };

  const byRegionText = detectCountryFromRegionText(cand.text);
  if (byRegionText) return { code: byRegionText, mode: "city_region_text", source: "text" };

  return null;
}

/**
 * Extract structured location evidence from a raw provider profile item. Handles
 * the HarvestAPI shape ({ location: { linkedinText, countryCode, parsed:{country,
 * countryCode, city, regionCode} } }), a plain string location, and a
 * currentPosition[].location fallback. Never fabricates — returns only what the
 * provider supplied.
 */
export function extractCandidateLocationEvidence(raw: unknown): CandidateLocation {
  const r = (raw ?? {}) as Record<string, any>;
  const loc = r.location;
  if (loc && typeof loc === "object") {
    const parsed = (loc.parsed ?? {}) as Record<string, any>;
    return {
      text: loc.linkedinText ?? parsed.text ?? parsed.city ?? null,
      country: parsed.country ?? parsed.countryFull ?? null,
      country_code: loc.countryCode ?? parsed.countryCode ?? null,
      city: parsed.city ?? null,
      region: parsed.regionCode ?? parsed.region ?? null,
    };
  }
  if (typeof loc === "string" && loc.trim()) return { text: loc };
  // Fallback: currentPosition/experience carry a location string (often a country).
  const cp = Array.isArray(r.currentPosition) ? r.currentPosition[0] : (r.currentPosition ?? null);
  const cpLoc = cp?.location ?? (Array.isArray(r.experience) ? r.experience[0]?.location : null);
  if (typeof cpLoc === "string" && cpLoc.trim()) return { text: cpLoc };
  return {};
}

/**
 * Does a candidate satisfy a required location under strict geography?
 *  - required is a COUNTRY: match by country_code → country → text-detected country.
 *    No country evidence ⇒ "missing location evidence" (strict never passes unknown).
 *  - required is a CITY/REGION (not a country): match text/city/region contains it.
 * Empty requirement ⇒ ok (no constraint).
 */
export function matchesRequiredLocation(cand: CandidateLocation, required: string | null | undefined): LocationMatch {
  const req = String(required ?? "").trim();
  if (!req) return { ok: true };

  const reqCode = normalizeCountry(req);
  if (reqCode) {
    const resolved = resolveCandidateCountry(cand);
    if (resolved) {
      const base = { mode: resolved.mode, evidence_source: resolved.source, normalized_country: resolved.code };
      // A resolved country that DISAGREES is still a hard rejection. Reading more
      // evidence shapes finds genuine matches; it never turns the wrong country
      // into an accepted one.
      return resolved.code === reqCode ? { ok: true, ...base } : { ok: false, reason: "wrong country", ...base };
    }
    return { ok: false, reason: "missing location evidence", mode: "unresolved", normalized_country: null };
  }

  // City / region requirement — retain the locality/region check.
  const hay = [cand.text, cand.city, cand.region]
    .map((s) => String(s ?? "").toLowerCase())
    .join(" ");
  return hay.includes(req.toLowerCase()) ? { ok: true } : { ok: false, reason: "wrong city/region" };
}

/** Convenience for the string-only gates: candidate has a location STRING plus
 *  optional structured country fields already threaded through the pipeline. */
export function matchesRequiredLocationFromFields(
  fields: { location?: string | null; location_country?: string | null; location_country_code?: string | null },
  required: string | null | undefined,
): LocationMatch {
  return matchesRequiredLocation(
    { text: fields.location ?? null, country: fields.location_country ?? null, country_code: fields.location_country_code ?? null },
    required,
  );
}
