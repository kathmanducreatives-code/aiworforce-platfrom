// GEOGRAPHY RESOLVER — the one place ATLAS and ORION decide whether a location is
// inside, outside, or not placeable against a required geography.
//
// ATLAS root-cause review, Stage 1 (D5). Three questions used to share one answer:
//   "can this company be EXCLUDED?"  (pool gate)        — only on a contradiction
//   "is this requirement SATISFIED?" (qualification)    — only on a positive match
//   "cannot tell"                                       — neither
// `geographyContradicts` answered the first and qualification reused it for the
// second, so a requirement this module could not place ("Atlantis", "Texas") was
// satisfied by ANY headquarters, Toronto included.
//
// Tables are the existing ones, not copies:
//   GEO_SCOPES  countries (+ spellings, demonyms) and regions (by members) — moved here
//               verbatim from leadEligiblePool.ts
//   REGIONS     sub-national regions by country (US states, Canadian provinces, …)
//               — locationMatch.ts's table, read through its export
//
// Pure.

import { REGIONS } from "./locationMatch.ts";

export const GEOGRAPHY_RESOLVER_VERSION = "geography-resolver-v1" as const;

export type GeoVerdict = "match" | "contradict" | "unresolvable";

export function normalizeGeo(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * What SATISFIES a required geography.
 *
 * ── WHY A REGION NEEDS MEMBERS AND AN ALIAS LIST WILL NOT DO ────────────────
 *
 * This table replaces a two-entry alias map that covered only "united states"
 * and "united kingdom" and matched by substring. A continent is not a token any
 * country string contains, so `("Berlin, Germany", ["Europe"])` answered
 * CONTRADICTS — and the mission compiler emits "Europe" literally, from
 * `GEO_MARKERS`, with no expansion anywhere between.
 *
 * The flagship benchmark is "cybersecurity companies IN EUROPE hiring
 * enterprise sellers whose leadership posted about US expansion". Measured
 * before this fix, it dropped Berlin, London, Paris and Amsterdam — every
 * European company, on a European mission. The gate could not pass anyone.
 *
 * ── THE KEY IS A CLOSED VOCABULARY, WHICH IS WHY THIS IS TRACTABLE ─────────
 *
 * The REQUIRED side is not free text. It comes from `GEO_MARKERS` in
 * `leadMission.ts` or from the workspace Brain, so the set of things that must
 * be adjudicated is small and enumerable. The ESTABLISHED side is the provider's
 * prose ("Berlin, Germany", "San Francisco, CA, USA") and is matched by token,
 * never enumerated.
 */
export const GEO_SCOPES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // ── COUNTRIES: their own spellings and demonyms. ─────────────────────────
  "united states": ["united states", "usa", "us", "u s", "america", "american"],
  "united kingdom": ["united kingdom", "uk", "england", "scotland", "wales",
    "northern ireland", "british", "britain", "london"],
  germany: ["germany", "german", "deutschland"],
  france: ["france", "french"],
  netherlands: ["netherlands", "dutch", "holland"],
  spain: ["spain", "spanish", "espana"],
  italy: ["italy", "italian"],
  ireland: ["ireland", "irish"],
  sweden: ["sweden", "swedish"],
  norway: ["norway", "norwegian"],
  denmark: ["denmark", "danish"],
  finland: ["finland", "finnish"],
  poland: ["poland", "polish"],
  portugal: ["portugal", "portuguese"],
  switzerland: ["switzerland", "swiss"],
  austria: ["austria", "austrian"],
  belgium: ["belgium", "belgian"],
  canada: ["canada", "canadian"],
  mexico: ["mexico", "mexican"],
  india: ["india", "indian"],
  australia: ["australia", "australian"],
  singapore: ["singapore"],
  japan: ["japan", "japanese"],
  israel: ["israel", "israeli"],
  brazil: ["brazil", "brazilian"],

  // ── REGIONS: satisfied by any member. ────────────────────────────────────
  //
  // Listed as a flat member set rather than composed at runtime: the whole
  // point is that a reader can see what a region admits without executing
  // anything, and a set that is assembled by code is a set nobody checks.
  europe: ["europe", "european", "eu", "united kingdom", "uk", "england",
    "scotland", "wales", "british", "britain", "london", "germany", "german",
    "deutschland", "france", "french", "netherlands", "dutch", "holland",
    "spain", "spanish", "italy", "italian", "ireland", "irish", "sweden",
    "swedish", "norway", "norwegian", "denmark", "danish", "finland",
    "finnish", "poland", "polish", "portugal", "portuguese", "switzerland",
    "swiss", "austria", "austrian", "belgium", "belgian", "czech", "greece",
    "greek", "romania", "hungary", "estonia", "lithuania", "latvia"],
  emea: ["emea", "europe", "european", "eu", "middle east", "africa",
    "united kingdom", "uk", "england", "britain", "british", "london",
    "germany", "german", "france", "french", "netherlands", "dutch", "spain",
    "spanish", "italy", "italian", "ireland", "irish", "sweden", "swedish",
    "norway", "denmark", "finland", "poland", "portugal", "switzerland",
    "swiss", "austria", "belgium", "israel", "israeli", "uae", "dubai"],
  "north america": ["north america", "united states", "usa", "us", "u s",
    "america", "american", "canada", "canadian", "mexico", "mexican"],
  apac: ["apac", "asia", "asia pacific", "australia", "australian",
    "singapore", "india", "indian", "japan", "japanese", "new zealand",
    "hong kong", "korea", "korean", "indonesia", "malaysia", "philippines"],
  nordics: ["nordics", "nordic", "sweden", "swedish", "norway", "norwegian",
    "denmark", "danish", "finland", "finnish", "iceland"],
  dach: ["dach", "germany", "german", "deutschland", "austria", "austrian",
    "switzerland", "swiss"],
  benelux: ["benelux", "belgium", "belgian", "netherlands", "dutch",
    "holland", "luxembourg"],
  latam: ["latam", "latin america", "brazil", "brazilian", "mexico",
    "mexican", "argentina", "chile", "colombia", "peru"],
});

/** Whole-word containment. "us" must not match "Australia" or "Prussia". */
export function mentions(haystack: string, token: string): boolean {
  return new RegExp(`(?:^| )${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`)
    .test(haystack);
}

// ── Sub-national regions ─────────────────────────────────────────────────────

/** Country (GEO_SCOPES key) of each REGIONS country code. */
const COUNTRY_NAME_OF: Record<string, string> = { US: "united states", CA: "canada", GB: "united kingdom", AU: "australia" };

interface Region { country: string; name: string | null; code: string | null }
const ALL_REGIONS: Region[] = Object.entries(REGIONS).flatMap(([cc, list]) =>
  list.map((r) => ({ country: COUNTRY_NAME_OF[cc] ?? cc.toLowerCase(), name: r.name ? normalizeGeo(r.name) : null, code: r.code })));
/**
 * A region code is read only as a whole comma-delimited part ("Austin, TX"), never inside
 * prose, and only when it can mean ONE thing. "Berlin, DE" is Germany, not Delaware: a
 * code that is also an ISO 3166 country code, or that two countries' regions share
 * (WA: Washington / Western Australia), is never read as a region.
 */
const ISO_COLLISIONS = new Set(["AL", "AR", "AZ", "CA", "CO", "DE", "GA", "ID", "IL", "IN", "KY", "LA", "MA", "MD", "ME", "MN", "MO", "MS", "MT",
  "NC", "NE", "NL", "NU", "PA", "PE", "PR", "SC", "SD", "SK", "TN", "VA"]);
const CODE_OWNERS = new Map<string, Region[]>();
for (const r of ALL_REGIONS) if (r.code) CODE_OWNERS.set(r.code, [...(CODE_OWNERS.get(r.code) ?? []), r]);
for (const [code, owners] of [...CODE_OWNERS]) if (owners.length > 1 || ISO_COLLISIONS.has(code)) CODE_OWNERS.delete(code);

/** The required region, when the requirement IS a sub-national region (by full name). */
function regionRequirement(n: string): Region | null {
  // A name shared with a country (GEO_SCOPES key) is the country, never the region.
  if (GEO_SCOPES[n]) return null;
  return ALL_REGIONS.find((r) => r.name === n) ?? null;
}

/** The sub-national regions a location states: full names anywhere, codes only as a whole part. */
function regionsIn(raw: string, e: string): Region[] {
  const byName = ALL_REGIONS.filter((r) => r.name && mentions(e, r.name));
  const parts = raw.split(/[,;|/]/).map((p) => p.trim()).filter(Boolean);
  const byCode = parts.slice(1).flatMap((p) => /^[A-Z]{2}$/.test(p) ? (CODE_OWNERS.get(p) ?? []) : []);
  return [...byName, ...byCode];
}

/** The countries (GEO_SCOPES keys) a location states, directly or through a region it names. */
function countriesIn(raw: string, e: string): Set<string> {
  const out = new Set<string>();
  for (const [key, tokens] of Object.entries(GEO_SCOPES)) {
    if (REGION_KEYS.has(key)) continue;
    if (tokens.some((t) => mentions(e, t))) out.add(key);
  }
  for (const r of regionsIn(raw, e)) out.add(r.country);
  return out;
}

/** GEO_SCOPES keys that are multi-country regions (their members include other keys). */
const REGION_KEYS = new Set(Object.entries(GEO_SCOPES).filter(([k, tokens]) =>
  tokens.some((t) => t !== k && GEO_SCOPES[t] !== undefined)).map(([k]) => k));

function verdictFor(raw: string, e: string, r: string): GeoVerdict {
  const n = normalizeGeo(r);
  if (!n) return "match"; // an empty requirement restricts nothing
  // Direct match: the location names the requirement ("Austin, Texas, United States" ∋ "texas").
  if (mentions(e, n)) return "match";
  // The location is BROADER than the requirement ("Germany" for "Munich, Germany"):
  // it cannot prove the narrower place, and does not contradict it.
  if (mentions(n, e)) return "unresolvable";

  const scope = GEO_SCOPES[n];
  if (scope) {
    if (scope.some((token) => mentions(e, token))) return "match";
    // A US state ("Austin, TX") places the location in its country.
    const via = regionsIn(raw, e).map((x) => x.country);
    if (via.some((c) => c === n || scope.some((t) => mentions(c, t)))) return "match";
    // A recognised requirement the location does not mention: outside it (unchanged rule).
    return "contradict";
  }

  const region = regionRequirement(n);
  if (region) {
    const states = regionsIn(raw, e);
    if (states.some((x) => x.name === region.name || (!!x.code && x.code === region.code && x.country === region.country))) return "match";
    if (states.some((x) => x.country === region.country)) return "contradict"; // another region of the same country
    const countries = countriesIn(raw, e);
    if (countries.size && !countries.has(region.country)) return "contradict"; // another country
    return "unresolvable"; // e.g. "United States" alone: inside the country, state unknown
  }

  // A place this resolver cannot place (a city it has no table for, "Atlantis"): only
  // a direct mention — handled above — can satisfy it; nothing here can contradict it.
  return "unresolvable";
}

/**
 * Is `established` inside the required geography (any of `required`)?
 *   match         a positive match for at least one requirement
 *   contradict    every requirement is contradicted by what the location states
 *   unresolvable  otherwise — including a location or requirement that cannot be placed
 */
export function geographyVerdict(established: string | null, required: readonly string[]): GeoVerdict {
  if (!required.length) return "match";
  const raw = String(established ?? "");
  const e = normalizeGeo(raw);
  if (!e) return "unresolvable";
  const vs = required.map((r) => verdictFor(raw, e, r));
  if (vs.includes("match")) return "match";
  return vs.every((v) => v === "contradict") ? "contradict" : "unresolvable";
}
