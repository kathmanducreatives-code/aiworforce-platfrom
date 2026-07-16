// Typed geography constraint resolution for Find Leads source gating. Pure /
// import-light (reuses locationMatch primitives).
//
// Root cause it fixes (live Q1 v81, plan 860a19c8): the Company Brain ICP
// geography and the actor filter were both the COUNTRY "United States", but the
// source gate received a diverged, non-country `criteria.location` value and
// applied STRICT city/region matching — rejecting all 15 genuine US profiles as
// "wrong city/region (strict)". `normalizeCountry` is exact-alias-only, so a
// country value that was reworded/qualified never country-matched.
//
// This module (a) classifies a geography value into a TYPE (country/region/city/
// text) — recognizing an embedded country designator, not only an exact alias —
// and (b) resolves the AUTHORITATIVE constraint so a country intent governs and a
// planner/Scout-derived locality can never silently strengthen a country
// constraint into a locality one. It never weakens an EXPLICIT user locality.

import {
  normalizeCountry,
  detectCountryInText,
  matchesRequiredLocation,
  type CandidateLocation,
  type LocationRejectReason,
} from "./locationMatch.ts";

export type GeographyType = "country" | "region" | "city" | "text";
export type MatcherMode = "country" | "region" | "city" | "text_fallback";

export interface GeographyConstraint {
  type: GeographyType;
  /** Original (trimmed) requested value. */
  value: string;
  /** Canonical ISO country code when type=country. */
  country_code?: string | null;
}

// A small, explicit US state table (full name → 2-letter). Region classification
// stays deliberately narrow; anything else non-country is treated as a city.
const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york state": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN",
  texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

/** Classify a geography value into a typed constraint. Country recognition uses
 * an exact alias first, then an embedded-country designator (so "United States
 * (Remote)" still classifies as a country). City is the default for any other
 * non-empty locality text. */
export function classifyGeography(value: string | null | undefined): GeographyConstraint {
  const v = String(value ?? "").trim();
  if (!v) return { type: "text", value: "" };
  const exact = normalizeCountry(v);
  if (exact) return { type: "country", value: v, country_code: exact };
  const embedded = detectCountryInText(v);
  if (embedded) return { type: "country", value: v, country_code: embedded };
  const key = v.toLowerCase().replace(/[.,]+$/, "").trim();
  if (US_STATES[key]) return { type: "region", value: v };
  return { type: "city", value: v };
}

export interface GeographyCandidateSource {
  value: string | null | undefined;
  /** Where the value came from — used to let an explicit user locality win. */
  source: "user_explicit" | "brain" | "actor" | "planner" | "instruction";
}

/**
 * Resolve the authoritative source-gate geography constraint.
 *  - An EXPLICIT user locality (city/region the user actually asked for) wins.
 *  - Otherwise a COUNTRY designator (from brain/actor/planner/instruction) governs
 *    — a diverged planner/actor locality can never downgrade a country intent.
 *  - Falls back to the first usable value, else an empty (no-constraint) text.
 */
export function resolveGeographyConstraint(sources: GeographyCandidateSource[]): GeographyConstraint {
  const classified = sources
    .map((s) => ({ ...s, c: classifyGeography(s.value) }))
    .filter((s) => s.c.value.length > 0);

  // 1) An explicit user city/region request is authoritative.
  const explicitLocality = classified.find((s) => s.source === "user_explicit" && (s.c.type === "city" || s.c.type === "region"));
  if (explicitLocality) return explicitLocality.c;

  // 2) A country designator governs (country intent beats a diverged locality).
  const country = classified.find((s) => s.c.type === "country");
  if (country) return country.c;

  // 3) Any explicit user value, then any value.
  const explicit = classified.find((s) => s.source === "user_explicit");
  if (explicit) return explicit.c;
  return classified[0]?.c ?? { type: "text", value: "" };
}

export interface TypedGeographyMatch {
  ok: boolean;
  reason?: LocationRejectReason;
  reason_code?: string;
  matcher_mode: MatcherMode;
}

/** Match a candidate location against a typed constraint. Country uses structured
 * country evidence; region/city use structured region/city + safe text fallback. */
export function matchTypedGeography(cand: CandidateLocation, constraint: GeographyConstraint): TypedGeographyMatch {
  if (!constraint.value) return { ok: true, matcher_mode: "text_fallback" };

  if (constraint.type === "country") {
    // Reuse the proven country-aware matcher (country_code → country → text).
    const m = matchesRequiredLocation(cand, constraint.country_code ?? constraint.value);
    return { ok: m.ok, reason: m.reason, reason_code: m.reason ? m.reason.replace(/[^a-z]+/gi, "_") : undefined, matcher_mode: "country" };
  }

  const mode: MatcherMode = constraint.type === "region" ? "region" : constraint.type === "city" ? "city" : "text_fallback";
  const needle = constraint.value.toLowerCase();
  const hay = [cand.text, cand.city, cand.region].map((s) => String(s ?? "").toLowerCase()).join(" ");
  // Region requests also accept the state's 2-letter code in structured region.
  const stateCode = constraint.type === "region" ? US_STATES[needle.replace(/[.,]+$/, "").trim()] : null;
  const regionCode = String(cand.region ?? "").toUpperCase();
  const ok = hay.includes(needle) || (!!stateCode && regionCode === stateCode);
  return ok
    ? { ok: true, matcher_mode: mode }
    : { ok: false, reason: "wrong city/region", reason_code: "wrong_city_region", matcher_mode: mode };
}
