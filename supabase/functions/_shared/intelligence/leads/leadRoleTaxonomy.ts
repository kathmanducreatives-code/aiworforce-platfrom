// CLAUDE-PROPOSED ROLE TAXONOMY — contract, bounding and deterministic repair.
//
// "Sales Operations" in a user request is an INTENT SEED, not a query. A seed
// expanded literally produces `Sales Operations OR Revenue Operations OR GTM
// Operations`, which is simultaneously too narrow (it misses `RevOps Manager`,
// `Director of Revenue Systems`) and too broad (it matches `Warehouse Operations
// Manager`). This module lets Claude propose a bounded, tiered taxonomy and then
// holds it to a contract Agentory owns.
//
// AUTHORITY SPLIT. Claude proposes semantics: which titles belong to which
// function, which are adjacent, what evidence an adjacent role needs. Agentory
// owns every bound and every rejection rule below. A taxonomy that cannot be
// repaired safely is REJECTED, and the caller falls back to the existing
// deterministic role-family plan — this module never invents a replacement.
//
// Pure and import-free apart from sibling contracts, so the whole surface is
// unit-testable with no provider, model, network or database access.

export const ROLE_TAXONOMY_VERSION = "lead-role-taxonomy-1.0.0";

/**
 * Confidence tiers, in descending strength.
 *
 * The tier is what decides whether a family may run in round one, whether it
 * needs description evidence before a match counts, and whether it can ever be
 * treated as exact hiring evidence.
 */
export type RoleConfidenceTier =
  | "exact"
  | "direct_adjacent"
  | "evidence_gated_adjacent"
  | "secondary_signal"
  | "excluded";

export const ROLE_CONFIDENCE_TIERS: readonly RoleConfidenceTier[] = [
  "exact", "direct_adjacent", "evidence_gated_adjacent", "secondary_signal", "excluded",
];

export interface RoleFamily {
  family_id: string;
  canonical_function: string;
  confidence_tier: RoleConfidenceTier;
  titles: string[];
  aliases: string[];
  abbreviations: string[];
  seniority_levels: string[];
  positive_description_evidence: string[];
  negative_patterns: string[];
  /** True when a title match alone is NOT sufficient — description evidence is required. */
  evidence_required: boolean;
  /** May this family run before exact families have been tried? */
  initially_eligible: boolean;
  /** 1 = run first. Higher rungs activate only as broadening. */
  broadening_level: number;
  maximum_attempts: number;
  recommended_capabilities: string[];
}

export interface RoleTaxonomy {
  families: RoleFamily[];
  negative_patterns: string[];
}

// ------------------------------------------------------------------ bounds ----

export const TAXONOMY_BOUNDS = {
  maxFamilies: 8,
  maxTitlesPerFamily: 14,
  maxAliasesPerFamily: 12,
  maxAbbreviationsPerFamily: 6,
  maxSeniorityLevels: 8,
  maxEvidencePerFamily: 14,
  maxNegativePatterns: 40,
  maxNegativePerFamily: 12,
  maxCapabilitiesPerFamily: 4,
  maxBroadeningLevel: 5,
  maxAttempts: 3,
  maxTitleChars: 60,
  maxTextChars: 120,
  /** A family this small after repair carries no signal and is dropped. */
  minTitlesPerFamily: 1,
} as const;

/**
 * Operations families that share the word but not the function.
 *
 * These are matched against the canonical function and the individual titles.
 * The list is deliberately about DOMAIN ("warehouse", "clinical"), not seniority,
 * so it cannot accidentally delete `Director of Sales Operations`.
 */
export const REJECTED_OPERATIONS_DOMAINS: readonly string[] = [
  "warehouse", "store", "retail", "production", "manufacturing", "people",
  "hr", "human resources", "clinical", "restaurant", "logistics", "supply chain",
  "field", "flight", "security", "it operations", "network operations",
];

/**
 * Bare Operations titles with no commercial qualifier.
 *
 * `Operations Manager` at a SaaS startup may well be a RevOps hire, but the title
 * alone cannot establish it, and in aggregate these dominate a query pack with
 * noise. They are removed rather than evidence-gated because the title carries no
 * function at all.
 */
export const GENERIC_OPERATION_TITLES: readonly string[] = [
  "operations manager", "operations lead", "operations analyst", "operations specialist",
  "operations coordinator", "operations associate", "operations director",
  "business operations", "business operations manager", "business operations analyst",
  "growth operations", "growth operations manager",
  "strategy and operations", "strategy & operations", "strategy and operations manager",
  "operations", "general operations",
];

/**
 * Commercial executives. A company hiring a CRO is a revenue-motion signal, but it
 * is NOT evidence that the company is hiring Sales Operations — the requested
 * hiring role. These may inform prioritisation; they may never be tier `exact`.
 */
export const SECONDARY_EXECUTIVE_TITLES: readonly string[] = [
  "chief revenue officer", "cro", "vp of revenue", "vice president of revenue",
  "head of revenue", "chief commercial officer", "cco", "chief sales officer",
];

/**
 * Description signals that can promote an evidence-gated adjacent role to a match.
 *
 * Every one of these names a concrete revenue-operations responsibility. A
 * `Commercial Operations Manager` whose posting mentions quota planning and
 * Salesforce administration is doing the job; one that does not, is not.
 */
export const REVENUE_OPERATIONS_EVIDENCE: readonly string[] = [
  "crm ownership", "crm administration", "salesforce administration", "salesforce admin",
  "sales forecasting", "revenue forecasting", "pipeline reporting", "pipeline governance",
  "territory planning", "quota planning", "sales compensation", "commission planning",
  "deal approvals", "deal desk", "revenue systems", "gtm systems", "sales systems",
  "sales analytics", "revenue analytics", "sales enablement systems",
];

// ------------------------------------------------------------------ helpers ----

const norm = (v: unknown): string => String(v ?? "").trim();
const lower = (v: unknown): string => norm(v).toLowerCase();

function str(v: unknown, max: number): string {
  const s = norm(v);
  return s.length > max ? s.slice(0, max) : s;
}

function strList(v: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    const s = str(raw, maxChars);
    if (!s) continue;
    if (out.some((x) => x.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function intIn(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function tierOf(v: unknown): RoleConfidenceTier | null {
  const s = lower(v);
  return (ROLE_CONFIDENCE_TIERS as readonly string[]).includes(s) ? s as RoleConfidenceTier : null;
}

/** Slug-safe id. Prevents an id being used to smuggle punctuation into a key. */
function idOf(v: unknown, max = 48): string {
  return lower(v).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max);
}

export function isRejectedOperationsTitle(title: string): boolean {
  const t = lower(title);
  if (!t) return false;
  // Domain-qualified Operations ("Warehouse Operations Manager").
  if (t.includes("operations") && REJECTED_OPERATIONS_DOMAINS.some((d) => t.includes(d))) return true;
  // Bare Operations with no commercial qualifier.
  return GENERIC_OPERATION_TITLES.includes(t);
}

export function isSecondaryExecutiveTitle(title: string): boolean {
  return SECONDARY_EXECUTIVE_TITLES.includes(lower(title));
}

// ------------------------------------------------------------------- parse ----

/**
 * SHAPE parse with bounding applied on the way through.
 *
 * Returns the bounded value, never the raw one, so nothing downstream can observe
 * an unbounded array. Policy — is this title allowed, is this tier legal for this
 * family — is the separate `validateRoleTaxonomy` pass.
 */
export function parseRoleTaxonomy(raw: unknown): RoleTaxonomy | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rawFamilies = Array.isArray(r.families) ? r.families : null;
  if (!rawFamilies) return null;

  const families: RoleFamily[] = [];
  for (const f of rawFamilies) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    const tier = tierOf(o.confidence_tier);
    const family_id = idOf(o.family_id);
    if (!family_id || !tier) continue;                 // unusable without an id and a tier

    families.push({
      family_id,
      canonical_function: str(o.canonical_function, TAXONOMY_BOUNDS.maxTextChars),
      confidence_tier: tier,
      titles: strList(o.titles, TAXONOMY_BOUNDS.maxTitlesPerFamily, TAXONOMY_BOUNDS.maxTitleChars),
      aliases: strList(o.aliases, TAXONOMY_BOUNDS.maxAliasesPerFamily, TAXONOMY_BOUNDS.maxTitleChars),
      abbreviations: strList(o.abbreviations, TAXONOMY_BOUNDS.maxAbbreviationsPerFamily, TAXONOMY_BOUNDS.maxTitleChars),
      seniority_levels: strList(o.seniority_levels, TAXONOMY_BOUNDS.maxSeniorityLevels, TAXONOMY_BOUNDS.maxTitleChars),
      positive_description_evidence: strList(o.positive_description_evidence, TAXONOMY_BOUNDS.maxEvidencePerFamily, TAXONOMY_BOUNDS.maxTextChars),
      negative_patterns: strList(o.negative_patterns, TAXONOMY_BOUNDS.maxNegativePerFamily, TAXONOMY_BOUNDS.maxTitleChars),
      evidence_required: o.evidence_required === true,
      initially_eligible: o.initially_eligible === true,
      broadening_level: intIn(o.broadening_level, 1, TAXONOMY_BOUNDS.maxBroadeningLevel, 1),
      maximum_attempts: intIn(o.maximum_attempts, 1, TAXONOMY_BOUNDS.maxAttempts, 1),
      recommended_capabilities: strList(o.recommended_capabilities, TAXONOMY_BOUNDS.maxCapabilitiesPerFamily, TAXONOMY_BOUNDS.maxTitleChars),
    });
    if (families.length >= TAXONOMY_BOUNDS.maxFamilies) break;
  }
  if (families.length === 0) return null;

  return {
    families,
    negative_patterns: strList(r.negative_patterns, TAXONOMY_BOUNDS.maxNegativePatterns, TAXONOMY_BOUNDS.maxTitleChars),
  };
}

// ---------------------------------------------------------------- validate ----

export type TaxonomyRepairCode =
  | "duplicate_title_removed"
  | "duplicate_family_removed"
  | "generic_operations_title_removed"
  | "rejected_operations_family_removed"
  | "secondary_executive_downgraded"
  | "evidence_requirement_added"
  | "evidence_gated_family_deferred"
  | "unsupported_capability_removed"
  | "family_capped"
  | "empty_family_removed"
  | "eligibility_revoked";

export interface TaxonomyRepair {
  code: TaxonomyRepairCode;
  family_id: string;
  detail: string;
}

export type TaxonomyOutcome = "valid" | "repaired" | "rejected";

export interface TaxonomyValidation {
  outcome: TaxonomyOutcome;
  taxonomy: RoleTaxonomy | null;
  repairs: TaxonomyRepair[];
  /** Populated only when `outcome === "rejected"`. */
  rejection_reason: string | null;
  /** What the caller should record as the authoritative source of the plan. */
  strategy_source: "claude" | "claude_repaired" | "deterministic_fallback";
}

export interface TaxonomyValidationInput {
  taxonomy: RoleTaxonomy;
  /** Capability keys Agentory will actually run. Anything else is removed. */
  approvedCapabilities: readonly string[];
  /** The user's own seed, e.g. "Sales Operations". Used for the relevance check. */
  hiringRoleSeed: string;
}

/**
 * Does this family plausibly serve the user's stated seed?
 *
 * Deliberately weak: it asks whether the family shares a meaningful token with the
 * seed, or is an explicitly recognised revenue-operations concept. The strong
 * checks are the rejection lists. A weak relevance test avoids deleting a
 * legitimate family whose naming Claude chose differently from the user's.
 */
function isRelevantToSeed(family: RoleFamily, seed: string): boolean {
  const seedTokens = lower(seed).split(/[^a-z0-9]+/).filter((t) => t.length > 2 && t !== "and" && t !== "the");
  const hay = [family.canonical_function, family.family_id, ...family.titles, ...family.aliases]
    .map(lower).join(" ");
  if (seedTokens.some((t) => hay.includes(t))) return true;
  // Recognised revenue-operations vocabulary, even when worded unlike the seed.
  // The commercial-leadership entries matter: a secondary-signal family of
  // executives ("Chief Revenue Officer", "VP of Revenue") shares no token with a
  // seed like "Sales Operations", so a token test alone would delete the very tier
  // that exists to be carried WITHOUT being treated as exact hiring evidence.
  return ["revops", "revenue operation", "gtm operation", "go-to-market operation",
    "revenue system", "sales system", "deal desk", "commercial operation",
    "sales planning", "revenue strategy",
    "chief revenue", "chief commercial", "head of revenue", "vp of revenue",
    "chief sales"].some((k) => hay.includes(k));
}

/**
 * Hold a proposed taxonomy to the contract, repairing what is safely repairable.
 *
 * Repairs only ever REMOVE reach or DELAY activation — they never add a title, a
 * capability or an eligibility Claude did not ask for. That asymmetry is what
 * makes "repaired" a safe outcome rather than a silent rewrite.
 */
export function validateRoleTaxonomy(input: TaxonomyValidationInput): TaxonomyValidation {
  const repairs: TaxonomyRepair[] = [];
  const approved = new Set(input.approvedCapabilities.map(lower));
  const seenFamilyIds = new Set<string>();
  const seenTitles = new Set<string>();
  const kept: RoleFamily[] = [];

  for (const f of input.taxonomy.families) {
    if (f.confidence_tier === "excluded") continue;    // an excluded family is not a plan

    if (seenFamilyIds.has(f.family_id)) {
      repairs.push({ code: "duplicate_family_removed", family_id: f.family_id, detail: "family_id repeated" });
      continue;
    }

    // A family whose FUNCTION is a rejected Operations domain goes entirely — its
    // titles are not salvageable by de-duplication.
    const fnHay = `${f.canonical_function} ${f.family_id}`;
    if (REJECTED_OPERATIONS_DOMAINS.some((d) => fnHay.includes(d)) ||
        GENERIC_OPERATION_TITLES.includes(lower(f.canonical_function))) {
      repairs.push({ code: "rejected_operations_family_removed", family_id: f.family_id, detail: `unrelated operations function: ${f.canonical_function}` });
      continue;
    }
    if (!isRelevantToSeed(f, input.hiringRoleSeed)) {
      repairs.push({ code: "rejected_operations_family_removed", family_id: f.family_id, detail: "family unrelated to the requested hiring role" });
      continue;
    }

    const family: RoleFamily = { ...f, titles: [], aliases: [...f.aliases], recommended_capabilities: [] };

    // ---- titles ----
    for (const t of f.titles) {
      const key = lower(t);
      if (seenTitles.has(key)) {
        repairs.push({ code: "duplicate_title_removed", family_id: f.family_id, detail: t });
        continue;
      }
      if (isRejectedOperationsTitle(t)) {
        repairs.push({ code: "generic_operations_title_removed", family_id: f.family_id, detail: t });
        continue;
      }
      seenTitles.add(key);
      family.titles.push(t);
      if (family.titles.length >= TAXONOMY_BOUNDS.maxTitlesPerFamily) {
        repairs.push({ code: "family_capped", family_id: f.family_id, detail: `titles capped at ${TAXONOMY_BOUNDS.maxTitlesPerFamily}` });
        break;
      }
    }

    // ---- capabilities ----
    for (const c of f.recommended_capabilities) {
      if (!approved.has(lower(c))) {
        repairs.push({ code: "unsupported_capability_removed", family_id: f.family_id, detail: c });
        continue;
      }
      family.recommended_capabilities.push(c);
    }

    // ---- tier policy ----
    // A family made of commercial executives can never be exact hiring evidence.
    const allSecondary = family.titles.length > 0 && family.titles.every(isSecondaryExecutiveTitle);
    if (allSecondary && (family.confidence_tier === "exact" || family.confidence_tier === "direct_adjacent")) {
      family.confidence_tier = "secondary_signal";
      repairs.push({ code: "secondary_executive_downgraded", family_id: f.family_id, detail: "executive titles are not exact hiring evidence" });
    }
    if (family.confidence_tier === "secondary_signal") {
      // Never round-one, and never a title-only match.
      if (family.initially_eligible) {
        family.initially_eligible = false;
        repairs.push({ code: "eligibility_revoked", family_id: f.family_id, detail: "secondary signals are not initially eligible" });
      }
      if (!family.evidence_required) {
        family.evidence_required = true;
        repairs.push({ code: "evidence_requirement_added", family_id: f.family_id, detail: "secondary signals always require evidence" });
      }
    }

    if (family.confidence_tier === "evidence_gated_adjacent") {
      if (!family.evidence_required) {
        family.evidence_required = true;
        repairs.push({ code: "evidence_requirement_added", family_id: f.family_id, detail: "evidence-gated tier requires description evidence" });
      }
      if (family.positive_description_evidence.length === 0) {
        // Supply the canonical revenue-operations evidence rather than deleting a
        // legitimate family for omitting it.
        family.positive_description_evidence = [...REVENUE_OPERATIONS_EVIDENCE].slice(0, 8);
        repairs.push({ code: "evidence_requirement_added", family_id: f.family_id, detail: "default revenue-operations evidence applied" });
      }
      if (family.initially_eligible) {
        family.initially_eligible = false;
        repairs.push({ code: "evidence_gated_family_deferred", family_id: f.family_id, detail: "evidence-gated families cannot run before exact families" });
      }
      if (family.broadening_level < 2) {
        family.broadening_level = Math.max(2, family.broadening_level);
        repairs.push({ code: "evidence_gated_family_deferred", family_id: f.family_id, detail: "moved to a later broadening level" });
      }
    }

    if (family.titles.length < TAXONOMY_BOUNDS.minTitlesPerFamily) {
      repairs.push({ code: "empty_family_removed", family_id: f.family_id, detail: "no usable titles after repair" });
      continue;
    }

    seenFamilyIds.add(family.family_id);
    kept.push(family);
  }

  // ---- whole-taxonomy invariants ----
  if (kept.length === 0) {
    return {
      outcome: "rejected", taxonomy: null, repairs,
      rejection_reason: "no usable role family survived validation",
      strategy_source: "deterministic_fallback",
    };
  }
  // Something must be runnable in round one, and it must be an exact family.
  const hasEligibleExact = kept.some((f) => f.confidence_tier === "exact" && f.initially_eligible);
  if (!hasEligibleExact) {
    return {
      outcome: "rejected", taxonomy: null, repairs,
      rejection_reason: "no initially-eligible exact role family — the strategy would open on adjacent roles",
      strategy_source: "deterministic_fallback",
    };
  }

  const negatives = strList(
    [...input.taxonomy.negative_patterns, ...GENERIC_OPERATION_TITLES],
    TAXONOMY_BOUNDS.maxNegativePatterns, TAXONOMY_BOUNDS.maxTitleChars,
  );

  return {
    outcome: repairs.length > 0 ? "repaired" : "valid",
    taxonomy: { families: kept, negative_patterns: negatives },
    repairs,
    rejection_reason: null,
    strategy_source: repairs.length > 0 ? "claude_repaired" : "claude",
  };
}

/** Families runnable right now, in execution order. */
export function eligibleFamilies(t: RoleTaxonomy): RoleFamily[] {
  return t.families
    .filter((f) => f.initially_eligible && f.confidence_tier !== "excluded")
    .sort((a, b) => a.broadening_level - b.broadening_level);
}

/** Families held back for broadening, in the order they should be activated. */
export function deferredFamilies(t: RoleTaxonomy): RoleFamily[] {
  return t.families
    .filter((f) => !f.initially_eligible && f.confidence_tier !== "excluded")
    .sort((a, b) => a.broadening_level - b.broadening_level ||
      ROLE_CONFIDENCE_TIERS.indexOf(a.confidence_tier) - ROLE_CONFIDENCE_TIERS.indexOf(b.confidence_tier));
}

/** The JSON shape the planner prompt advertises. Kept beside the parser it feeds. */
export const ROLE_TAXONOMY_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["families", "negative_patterns"],
  properties: {
    families: {
      type: "array", maxItems: TAXONOMY_BOUNDS.maxFamilies,
      items: {
        type: "object",
        required: ["family_id", "canonical_function", "confidence_tier", "titles", "broadening_level"],
        properties: {
          family_id: { type: "string" },
          canonical_function: { type: "string" },
          confidence_tier: { type: "string", enum: [...ROLE_CONFIDENCE_TIERS] },
          titles: { type: "array", maxItems: TAXONOMY_BOUNDS.maxTitlesPerFamily, items: { type: "string" } },
          aliases: { type: "array", maxItems: TAXONOMY_BOUNDS.maxAliasesPerFamily, items: { type: "string" } },
          abbreviations: { type: "array", maxItems: TAXONOMY_BOUNDS.maxAbbreviationsPerFamily, items: { type: "string" } },
          seniority_levels: { type: "array", maxItems: TAXONOMY_BOUNDS.maxSeniorityLevels, items: { type: "string" } },
          positive_description_evidence: { type: "array", maxItems: TAXONOMY_BOUNDS.maxEvidencePerFamily, items: { type: "string" } },
          negative_patterns: { type: "array", maxItems: TAXONOMY_BOUNDS.maxNegativePerFamily, items: { type: "string" } },
          evidence_required: { type: "boolean" },
          initially_eligible: { type: "boolean" },
          broadening_level: { type: "integer", minimum: 1, maximum: TAXONOMY_BOUNDS.maxBroadeningLevel },
          maximum_attempts: { type: "integer", minimum: 1, maximum: TAXONOMY_BOUNDS.maxAttempts },
          recommended_capabilities: { type: "array", maxItems: TAXONOMY_BOUNDS.maxCapabilitiesPerFamily, items: { type: "string" } },
        },
      },
    },
    negative_patterns: { type: "array", maxItems: TAXONOMY_BOUNDS.maxNegativePatterns, items: { type: "string" } },
  },
};
