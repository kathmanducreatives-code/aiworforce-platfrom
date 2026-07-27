// EXPLICIT GEOGRAPHY EXTRACTION for the Lead mission.
//
// The mission contract needs to know what the USER actually named, separately from
// what the deterministic parser inferred. `inferGeography` answers the second
// question and is US-only; this answers the first.
//
// TWO RULES, both about not making things up:
//
//   1. NEVER INVENT. A location is only reported when the user's text contains it.
//      There is no "SaaS implies the US" inference here, and there never should be.
//
//   2. NEVER OVER-CAPTURE. A naive "in <Capitalized Phrase>" scan reads
//      "hiring Sales Operations" as a location called "Sales Operations". A phrase
//      wrongly promoted to an explicit location would OUTRANK the parser under the
//      mission's authority rules — the failure would be worse than missing it.
//
// So recognition is list-driven (deterministic, auditable), and the preposition
// scan exists only to catch places the list does not know — feeding
// `unresolved_locations`, which the planner must treat as "the user named
// somewhere I could not resolve", never as a resolved target.
//
// This is NOT the Phase 4 worldwide ontology. It is the minimum needed for the
// mission to keep the user's own wording authoritative.

import { inferGeography, mentionsUnitedStates } from "../../jobIntentTaxonomy.ts";
import type { MissionGeographyContext } from "../mission.ts";

/** Canonical name -> the surface forms that unambiguously mean it. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  "United States": ["united states of america", "united states", "u.s.a.", "u.s.", "usa"],
  "United Kingdom": ["united kingdom", "great britain", "britain", "england", "scotland", "wales", "u.k.", "uk"],
  Germany: ["germany", "deutschland"],
  France: ["france"],
  Canada: ["canada"],
  India: ["india"],
  Brazil: ["brazil", "brasil"],
  Australia: ["australia"],
  Ireland: ["ireland"],
  Netherlands: ["netherlands", "holland"],
  Spain: ["spain"],
  Italy: ["italy"],
  Portugal: ["portugal"],
  Poland: ["poland"],
  Sweden: ["sweden"],
  Norway: ["norway"],
  Denmark: ["denmark"],
  Finland: ["finland"],
  Belgium: ["belgium"],
  Austria: ["austria"],
  Switzerland: ["switzerland"],
  Mexico: ["mexico"],
  Argentina: ["argentina"],
  Chile: ["chile"],
  Colombia: ["colombia"],
  Japan: ["japan"],
  China: ["china"],
  Singapore: ["singapore"],
  "South Korea": ["south korea"],
  "New Zealand": ["new zealand"],
  "South Africa": ["south africa"],
  "United Arab Emirates": ["united arab emirates", "uae"],
  Israel: ["israel"],
  Turkey: ["turkey"],
  Nigeria: ["nigeria"],
  Kenya: ["kenya"],
  Egypt: ["egypt"],
  Indonesia: ["indonesia"],
  Philippines: ["philippines"],
  Vietnam: ["vietnam"],
  Thailand: ["thailand"],
  Malaysia: ["malaysia"],
  Pakistan: ["pakistan"],
  Bangladesh: ["bangladesh"],
  Ukraine: ["ukraine"],
  Romania: ["romania"],
  "Czech Republic": ["czech republic", "czechia"],
  Greece: ["greece"],
  Hungary: ["hungary"],
};

/** Multi-country regions. Reported as named, never expanded into members. */
const REGION_ALIASES: Record<string, string[]> = {
  Europe: ["europe"],
  EMEA: ["emea"],
  APAC: ["apac", "asia pacific", "asia-pacific"],
  LATAM: ["latam", "latin america"],
  "North America": ["north america"],
  DACH: ["dach"],
  Benelux: ["benelux"],
  Nordics: ["nordics", "scandinavia"],
};

/**
 * Words that follow a location preposition but are NOT places.
 *
 * "hiring in Sales Operations", "in Q4", "in SaaS" — each would otherwise be
 * promoted to an explicit location and outrank the parser.
 */
const NOT_A_PLACE = new Set([
  "sales", "operations", "revenue", "marketing", "engineering", "finance", "product",
  "clinical", "security", "support", "partnerships", "recruiting", "hr", "people",
  "saas", "software", "manufacturing", "healthcare", "logistics", "energy", "fintech",
  "b2b", "b2c", "tech", "technology", "ai", "gtm", "rev", "revops", "cs",
  "q1", "q2", "q3", "q4", "fy", "h1", "h2",
  "general", "total", "charge", "particular", "fact", "order", "addition", "house",
  "the", "a", "an", "any", "their", "our", "your", "this", "that", "these", "those",
]);

const CANONICAL: Array<[string, string[]]> = [
  ...Object.entries(COUNTRY_ALIASES),
  ...Object.entries(REGION_ALIASES),
];

function aliasPattern(alias: string): RegExp {
  // Escape regex metacharacters (the dotted forms carry `.`), then require the
  // alias to stand alone rather than sit inside a longer word.
  const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z])${esc}(?![A-Za-z])`, "i");
}

export interface ExplicitLocationScan {
  /** The user's own wording, in the order it appeared. */
  explicit_raw: string[];
  /** Canonical names for the wording we recognised. */
  normalized: string[];
  /** Named somewhere, but not resolvable here. Preserved, never dropped. */
  unresolved: string[];
}

/**
 * Find the locations the user explicitly named.
 *
 * `US`/`us` is delegated to `mentionsUnitedStates`, so the pronoun fix applies here
 * too — this module never re-derives that rule.
 */
export function extractExplicitLocations(query: string | null | undefined): ExplicitLocationScan {
  const text = String(query ?? "");
  const explicit_raw: string[] = [];
  const normalized: string[] = [];
  const unresolved: string[] = [];

  const push = (raw: string, canonical: string | null) => {
    if (!explicit_raw.some((x) => x.toLowerCase() === raw.toLowerCase())) explicit_raw.push(raw);
    if (canonical && !normalized.includes(canonical)) normalized.push(canonical);
  };

  // 1. US states — already deterministic and unambiguous in the taxonomy.
  for (const state of inferGeography(text)) {
    if (state !== "United States") push(state, state);
  }

  // 2. Known countries and regions.
  for (const [canonical, aliases] of CANONICAL) {
    for (const alias of aliases) {
      // The United States forms are decided by mentionsUnitedStates, so the
      // lowercase-pronoun rule is enforced in exactly one place.
      if (canonical === "United States") continue;
      const m = aliasPattern(alias).exec(text);
      if (m) { push(m[0], canonical); break; }
    }
  }
  if (mentionsUnitedStates(text)) {
    const m = /(?<![A-Za-z])(united states of america|united states|u\.s\.a\.|u\.s\.|usa)(?![A-Za-z])/i.exec(text)
      ?? /(?<![A-Za-z])US(?![A-Za-z])/.exec(text);
    push(m ? m[0] : "United States", "United States");
  }

  // 3. Conservative preposition scan for places the lists do not know.
  //    Feeds `unresolved` ONLY — never `normalized` — because a phrase we cannot
  //    canonicalize is exactly the thing we must not pretend to understand.
  const PREP = /\b(?:in|from|based in|located in|across|throughout)\s+(?:the\s+)?([A-Z][\w'-]*(?:[ -][A-Z][\w'-]*){0,2})/g;
  for (const m of text.matchAll(PREP)) {
    const phrase = m[1].trim();
    const head = phrase.split(/[\s-]+/)[0].toLowerCase();
    if (NOT_A_PLACE.has(head)) continue;
    if (phrase.split(/[\s-]+/).every((w) => NOT_A_PLACE.has(w.toLowerCase()))) continue;
    const alreadyKnown = explicit_raw.some((x) => x.toLowerCase() === phrase.toLowerCase())
      || normalized.some((n) => n.toLowerCase() === phrase.toLowerCase())
      || explicit_raw.some((x) => phrase.toLowerCase().includes(x.toLowerCase()));
    if (alreadyKnown) continue;
    if (!explicit_raw.some((x) => x.toLowerCase() === phrase.toLowerCase())) explicit_raw.push(phrase);
    if (!unresolved.includes(phrase)) unresolved.push(phrase);
  }

  return { explicit_raw, normalized, unresolved };
}

/**
 * Build the mission's geography context.
 *
 * `parser_locations` is carried as ADVISORY. The authority rule lives in
 * `resolveGeographyAuthority` (mission.ts) and is not duplicated here: if the user
 * named anything, parser output cannot contribute.
 */
export function buildLeadGeographyContext(query: string | null | undefined): MissionGeographyContext {
  const text = String(query ?? "");
  const scan = extractExplicitLocations(text);
  const parser = inferGeography(text);

  const hasExplicit = scan.explicit_raw.length > 0;
  const fullyResolved = hasExplicit && scan.unresolved.length === 0;

  return {
    explicit_raw_locations: scan.explicit_raw,
    normalized_locations: scan.normalized,
    parser_locations: parser,
    unresolved_locations: scan.unresolved,
    source: hasExplicit ? "explicit_user" : "inferred",
    // Confidence describes the RESOLUTION, not the fact that the user spoke:
    // a named-but-unresolved location is high-signal and low-confidence at once.
    confidence: !hasExplicit ? 0 : fullyResolved ? 1 : 0.5,
  };
}
