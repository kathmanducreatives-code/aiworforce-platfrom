// WHO IS WORTH ASKING A MODEL ABOUT.
//
// WHY THIS EXISTS.
//
// Semantic evaluation costs a model call per company, and the allowance is
// small. Spending one on a company that a FREE check already disqualifies —
// wrong country, twice the employee ceiling, an identity that never resolved —
// is money spent to be told what was already known, and it displaces a company
// the model could have helped with.
//
// THE ASYMMETRY THAT MATTERS.
//
// A gate here removes a company from evaluation ENTIRELY, so the cost of a
// wrong gate is a good lead silently never considered. That is why only
// VERIFIED contradictions gate:
//
//   * a verified geography mismatch gates; an unknown geography does not;
//   * a verified size mismatch gates; an unknown headcount does not;
//   * a provider FAILURE never gates — it is the reason we do not know, and
//     treating it as a negative is how an outage becomes a rejection.
//
// Everything uncertain flows through to evaluation and comes back REVIEW, which
// asks a human. Missing evidence must never become a verified negative.
//
// PURE. No network, provider, model or database access.

import type { EvidenceRegistry } from "./leadEvidenceRegistry.ts";
import type { LeadMissionV1 } from "./leadMission.ts";

export const ELIGIBLE_POOL_VERSION = "lead-eligible-pool-v1" as const;

export type ExclusionReason =
  | "duplicate_company"
  | "identity_unresolved"
  | "identity_mismatch"
  | "verified_geography_mismatch"
  | "verified_employee_size_mismatch"
  | "inactive_company"
  | "explicit_business_model_mismatch"
  | "rejected_provider_record"
  | "insufficient_evidence_to_evaluate";

export interface PoolCandidate {
  company_key: string;
  company_name: string | null;
  registry: EvidenceRegistry;
  /** Set when discovery already produced a terminal provider rejection. */
  provider_rejected?: boolean;
  /** Explicit consumer-only evidence, established deterministically. */
  verified_consumer_only?: boolean;
  active?: boolean;
}

export interface ExcludedCandidate {
  company_key: string;
  company_name: string | null;
  reason: ExclusionReason;
  detail: string;
}

export interface EligiblePool {
  version: typeof ELIGIBLE_POOL_VERSION;
  eligible: PoolCandidate[];
  excluded: ExcludedCandidate[];
  metrics: {
    discovered: number;
    hard_gated: number;
    eligible: number;
    /** Reason → count. The answer to "why was this company not pursued?". */
    exclusion_reasons: Record<string, number>;
  };
}

export interface PoolGateOptions {
  mission: LeadMissionV1;
  /** Identity must resolve before a company may be evaluated. */
  requireResolvedIdentity?: boolean;
  employee_min?: number | null;
  employee_max?: number | null;
  /** How far above the ceiling counts as CLEARLY above. */
  ceiling_tolerance?: number;
}

/** A registry with nothing to read cannot be meaningfully evaluated. */
function hasMinimumEvidence(r: EvidenceRegistry): boolean {
  // A description, a YC record, a website or an opening — any ONE of these is
  // something to reason about. Industry alone is not: a broad vendor label has
  // never established anything, which is why the claim verifier refuses it as
  // sole proof, and asking a model to judge on it alone buys a guess.
  return r.items.some((x) =>
    x.evidence_type === "company_description" ||
    x.evidence_type === "yc_company_record" ||
    x.evidence_type === "company_website" ||
    x.evidence_type === "job_posting" ||
    x.evidence_type === "yc_job");
}

function normalizeGeo(s: string): string {
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
const GEO_SCOPES: Readonly<Record<string, readonly string[]>> = Object.freeze({
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
function mentions(haystack: string, token: string): boolean {
  return new RegExp(`(?:^| )${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`)
    .test(haystack);
}

/**
 * Does the established geography CONTRADICT the mission's required one?
 *
 * ── THE THREE-VALUED RULE, MADE STRUCTURAL ──────────────────────────────────
 *
 * Returns false whenever either side is unknown. "We could not establish where
 * they are" is not "they are in the wrong place", and gating on the first would
 * remove every company whose enrichment happened to omit a location.
 *
 * That now extends to a required value this module does not RECOGNISE. A
 * required geography absent from `GEO_SCOPES` — a city, a state, a region
 * nobody has enumerated — cannot be adjudicated, so it does not contradict
 * anything. This is the rule that stops the Europe bug from having a sequel:
 * the failure was not a missing continent, it was a matcher that treated
 * "I cannot evaluate this" as "this fails".
 */
export function geographyContradicts(
  established: string | null, required: readonly string[],
): boolean {
  if (!established || required.length === 0) return false;
  const e = normalizeGeo(established);
  if (!e) return false;

  return !required.some((r) => {
    const n = normalizeGeo(r);
    if (!n) return true;                       // an empty requirement excludes nobody
    // Direct match, either direction — "Germany" against "Munich, Germany",
    // and "Munich, Germany" against a Brain value of "Germany".
    if (mentions(e, n) || mentions(n, e)) return true;

    const scope = GEO_SCOPES[n];
    // UNRECOGNISED REQUIREMENT ⇒ NOT A CONTRADICTION. Satisfying it is the
    // honest answer: nothing here can tell whether Berlin is in it.
    if (!scope) return true;
    return scope.some((token) => mentions(e, token));
  });
}

/**
 * Build the pool.
 *
 * ORDER MATTERS. Duplicates are removed first so a company excluded for a real
 * reason is reported once, under that reason, rather than as a duplicate of
 * itself.
 */
export function buildEligiblePool(
  candidates: readonly PoolCandidate[], opts: PoolGateOptions,
): EligiblePool {
  const eligible: PoolCandidate[] = [];
  const excluded: ExcludedCandidate[] = [];
  const seen = new Set<string>();
  const tolerance = opts.ceiling_tolerance ?? 1.0;
  const requiredGeo = opts.mission.company_profile.locations ?? [];

  const drop = (c: PoolCandidate, reason: ExclusionReason, detail: string) =>
    excluded.push({
      company_key: c.company_key, company_name: c.company_name, reason, detail,
    });

  for (const c of candidates) {
    if (seen.has(c.company_key)) {
      drop(c, "duplicate_company", "already present in the pool");
      continue;
    }
    seen.add(c.company_key);

    const f = c.registry.hard_facts;

    if (c.provider_rejected) {
      drop(c, "rejected_provider_record", "the provider record was rejected at normalization");
      continue;
    }
    if (c.active === false) {
      drop(c, "inactive_company", "the company is not active");
      continue;
    }
    if (f.identity_state === "mismatch") {
      drop(c, "identity_mismatch", "the resolved identity belongs to another company");
      continue;
    }
    if (opts.requireResolvedIdentity && f.identity_state !== "resolved") {
      drop(c, "identity_unresolved", `identity is ${f.identity_state}`);
      continue;
    }
    if (geographyContradicts(f.geography, requiredGeo)) {
      drop(c, "verified_geography_mismatch",
        `established "${f.geography}" is outside ${requiredGeo.join(", ")}`);
      continue;
    }
    // ONLY A VERIFIED COUNT GATES. A null headcount is unknown, and unknown is
    // a REVIEW question, not an exclusion.
    if (f.employee_count != null) {
      const max = opts.employee_max ?? null;
      const min = opts.employee_min ?? null;
      if (max != null && f.employee_count > max * (1 + tolerance)) {
        drop(c, "verified_employee_size_mismatch",
          `${f.employee_count} is clearly above the ${max} ceiling`);
        continue;
      }
      if (min != null && f.employee_count < min / (1 + tolerance)) {
        drop(c, "verified_employee_size_mismatch",
          `${f.employee_count} is clearly below the ${min} floor`);
        continue;
      }
    }
    if (c.verified_consumer_only && requiresB2B(opts.mission)) {
      drop(c, "explicit_business_model_mismatch",
        "verified consumer-only, and the mission requires B2B");
      continue;
    }
    if (!hasMinimumEvidence(c.registry)) {
      drop(c, "insufficient_evidence_to_evaluate",
        "no description, cohort record, site or opening to reason about");
      continue;
    }
    eligible.push(c);
  }

  const exclusion_reasons: Record<string, number> = {};
  for (const e of excluded) {
    exclusion_reasons[e.reason] = (exclusion_reasons[e.reason] ?? 0) + 1;
  }

  return {
    version: ELIGIBLE_POOL_VERSION,
    eligible,
    excluded,
    metrics: {
      discovered: candidates.length,
      hard_gated: excluded.length,
      eligible: eligible.length,
      exclusion_reasons,
    },
  };
}

/** Does this mission demand a business buyer? */
export function requiresB2B(m: LeadMissionV1): boolean {
  const hay = [
    ...m.company_profile.verticals, ...m.company_profile.business_models,
    m.original_user_query,
  ].join(" ").toLowerCase();
  return /\bb2b\b|\bsaas\b|\benterprise\b|\bbusiness\b/.test(hay);
}
