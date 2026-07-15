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
export interface LocationMatch { ok: boolean; reason?: LocationRejectReason }

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
    const candCode =
      normalizeCountry(cand.country_code) ??
      normalizeCountry(cand.country) ??
      detectCountryInText(cand.text);
    if (candCode) return candCode === reqCode ? { ok: true } : { ok: false, reason: "wrong country" };
    return { ok: false, reason: "missing location evidence" };
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
