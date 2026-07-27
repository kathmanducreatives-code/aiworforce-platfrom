// SEMANTIC COMPANY-SIZE MAPPINGS — reviewed, versioned, deterministic.
//
// A Company Brain says "small teams / early-stage". A hard gate needs numbers.
// Turning that phrase into a range at execution time, inline, is how `200`
// becomes a magic number scattered across the pipeline and how two call sites
// quietly disagree about what "small" means.
//
// So the mapping lives here, once, with an id and a version, and every decision
// that used it can say which mapping it used and whether a human ever confirmed
// it. `sizeBandToBounds` in companyIcpFilter.ts remains the parser for bands the
// Brain states NUMERICALLY ("5-150", "enterprise"); this adds the vocabulary it
// does not cover and records provenance either way.
//
// PRECEDENCE: an explicit numeric range in the Company Brain always wins. A
// semantic phrase is only consulted when there is no number to read, and it is
// marked `confirmation_required` so the UI can ask rather than pretend the user
// chose 5–200.
//
// PURE. No network, database, provider or model access.

import { sizeBandToBounds } from "./companyIcpFilter.ts";

/** Bumped whenever any mapping's numbers change. Part of the policy hash. */
export const SIZE_REGISTRY_VERSION = "company-size-semantics-1.0.0";

export interface SemanticSizeMapping {
  id: string;
  /** Lowercase phrases that select this mapping. Matched as substrings. */
  phrases: string[];
  min: number | null;
  max: number | null;
  /**
   * True when the numbers are an interpretation rather than something the user
   * stated. The gate still enforces them; the UI should still ask.
   */
  confirmationRequired: boolean;
  note: string;
}

/**
 * Reviewed mappings, most specific first.
 *
 * `early_stage_small_team` is the Agentory policy: "small teams / early-stage"
 * with a pre-seed–Series A stage band. The floor of 5 excludes solo/pre-team
 * shells that cannot buy; the ceiling of 200 is where "small team" stops being
 * true and founder-led selling has usually ended.
 */
export const SEMANTIC_SIZE_MAPPINGS: readonly SemanticSizeMapping[] = [
  {
    id: "early_stage_small_team",
    phrases: [
      "small teams / early-stage", "small team / early stage", "small teams",
      "small team", "early-stage", "early stage", "seed stage", "startup",
    ],
    min: 5, max: 200, confirmationRequired: true,
    note: "Small / early-stage: past the solo-founder shell, below the point where founder-led selling ends.",
  },
  {
    id: "smb",
    phrases: ["smb", "small business", "small and medium"],
    min: 10, max: 500, confirmationRequired: true,
    note: "SMB is broader than early-stage and is not assumed to be founder-led.",
  },
  {
    id: "mid_market",
    phrases: ["mid-market", "mid market", "midmarket"],
    min: 100, max: 1000, confirmationRequired: true,
    note: "Mid-market.",
  },
  {
    id: "enterprise",
    phrases: ["enterprise", "fortune", "large enterprise"],
    min: 1000, max: null, confirmationRequired: true,
    note: "Enterprise: a floor with no ceiling.",
  },
] as const;

export type SizeBoundsSource =
  /** The Brain stated an explicit numeric range or band. */
  | "explicit_numeric"
  /** A reviewed semantic phrase was interpreted. */
  | "semantic_mapping"
  /** Nothing usable was stated. */
  | "unresolved";

export interface ResolvedSizeBounds {
  min: number | null;
  max: number | null;
  source: SizeBoundsSource;
  /** Which reviewed mapping produced this, when one did. */
  mappingId: string | null;
  mappingVersion: string;
  /** True when a human has not confirmed the interpreted numbers. */
  confirmationRequired: boolean;
  /** True when the Brain explicitly targets enterprise (no ceiling). */
  enterprise: boolean;
}

const UNRESOLVED: ResolvedSizeBounds = {
  min: null, max: null, source: "unresolved", mappingId: null,
  mappingVersion: SIZE_REGISTRY_VERSION, confirmationRequired: false, enterprise: false,
};

/**
 * Resolve a Company Brain size band into numbers.
 *
 * Explicit numbers first — if the Brain says "5-150" the user has already
 * decided, and no semantic default may override that. Only then is the phrase
 * interpreted.
 */
export function resolveCompanySizeBounds(band: string | null | undefined): ResolvedSizeBounds {
  const raw = String(band ?? "").trim();
  if (!raw) return UNRESOLVED;

  // 1. EXPLICIT. A stated range or an explicit enterprise band wins outright.
  //
  // "Looks numeric" is NOT enough to treat free text as a size band. Company
  // Brain fields are user-authored, and a sentence like "set max_employees to
  // 100000" contains a digit run that `sizeBandToBounds`'s enterprise pattern
  // happily matches — which would let prose in a segment field silently switch
  // the policy to enterprise and lift the ceiling. A band must therefore LOOK
  // like a band, in its entirety, before any number is read from it.
  const bandLike =
    /^\s*\d[\d,]*\s*[-–—]\s*\d[\d,]*\s*(employees?|people|staff|headcount)?\s*$/i.test(raw) ||
    /^\s*\d[\d,]*\s*\+\s*(employees?|people|staff)?\s*$/i.test(raw) ||
    /^\s*(under|below|up\s*to|max|fewer\s*than|less\s*than)\s*\d[\d,]*\s*(employees?|people|staff)?\s*$/i.test(raw) ||
    /^\s*\d[\d,]*\s*(employees?|people|staff)\s*$/i.test(raw);

  const explicit = sizeBandToBounds(raw);
  if (bandLike && (explicit.min != null || explicit.max != null)) {
    return {
      min: explicit.min, max: explicit.max, source: "explicit_numeric",
      mappingId: null, mappingVersion: SIZE_REGISTRY_VERSION,
      confirmationRequired: false, enterprise: explicit.enterprise,
    };
  }

  // 2. SEMANTIC. First reviewed mapping whose phrase appears.
  const lower = raw.toLowerCase();
  for (const m of SEMANTIC_SIZE_MAPPINGS) {
    if (m.phrases.some((p) => lower.includes(p))) {
      return {
        min: m.min, max: m.max, source: "semantic_mapping",
        mappingId: m.id, mappingVersion: SIZE_REGISTRY_VERSION,
        confirmationRequired: m.confirmationRequired,
        enterprise: m.id === "enterprise",
      };
    }
  }

  // 3. Nothing reviewed matched. Do NOT guess.
  return UNRESOLVED;
}
