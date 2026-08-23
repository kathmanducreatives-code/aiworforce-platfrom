// WHOSE QUESTION IS QUALIFICATION ANSWERING?
//
// TEST run cf6cce3d-1283-468e-9bff-cba13a06d8c0 (2026-08-13) discovered 100
// companies for the Mission "Find 10 AI startups in the United States that are
// hiring software engineers" and qualified ZERO. The exclusions were:
//
//     technical_only            42
//     insufficient_commercial   15
//     employee_size              7
//
// None of those rejections answered the user's question. Two separate
// authorities answered a different one:
//
//   1. `commercialSignalPolicy` classifies "Software Engineer" as `technical`,
//      and `leadCommercialPrequalification` treats a company with no COMMERCIAL
//      role as having no hiring signal at all. That vocabulary encodes
//      Agentory's own buyer — companies hiring RevOps/sales — so a Mission whose
//      required signal IS software engineers was structurally unsatisfiable.
//      It rejected exactly the companies the Mission asked for.
//
//   2. The workspace Company Brain contributed employee bounds 10–150 and
//      `hard_constraints: ["employee_count","industry","business_model"]`. The
//      Mission's own hard constraints were `hiring`, `geography` and
//      `company_profile.locations` — a disjoint set — and its
//      `company_profile.employee_range` was NULL. The Brain's bounds were
//      enforced as hard anyway.
//
// THE RULE THIS MODULE ENCODES.
//
//   Mission hard constraints          absolute
//   Mission target/vertical/stage/
//     location/strategy requirements  authoritative
//   Mission directives                authoritative
//   Company Brain / workspace ICP     SUPPLEMENTARY — ranking and tie-breaking,
//                                     and hard ONLY where the Mission is silent
//   Mission soft_preferences          ranking, never rejection
//
// A workspace Brain may never override a Mission hard constraint. Where the
// Mission says nothing, the Brain keeps its existing authority — a workspace
// that has always filtered to 10–150 employees still does so for a Mission that
// expresses no size opinion.
//
// PURE. No network, no provider, no model, no database.

import type { LeadMissionV1 } from "./leadMission.ts";
import { roleFamilyAliases, type RoleFamily } from "./roleFamilies.ts";

export const QUALIFICATION_CONTEXT_VERSION = "mission-qualification-context-v1" as const;

/** Signal-type words that are never role titles. */
const SIGNAL_TYPE_WORDS: readonly string[] = [
  "hiring", "funding", "expansion", "leadership_change", "leadership change",
  "technology", "product_launch", "product launch", "recently funded",
];

const lc = (v: unknown) => typeof v === "string" ? v.trim().toLowerCase() : "";

/**
 * Mission role-family identifiers → the CANONICAL family whose aliases they mean.
 *
 * `required_signals[].role_families` carries the Mission's own identifiers —
 * `rev_ops`, `sales_ops`, `engineering` — produced by `ROLE_FAMILY_MARKERS` in
 * leadMission.ts. They are keys, not titles: "rev_ops" appears in no job
 * posting, so matching a title against the raw key silently matches nothing and
 * would turn every family-only Mission into a vocabulary that qualifies no one.
 *
 * The titles themselves are NOT redefined here. This maps the Mission's key onto
 * `ROLE_FAMILY_ALIASES`, the table the rest of the funnel already uses, so there
 * is one alias list and it cannot drift. Sales/Revenue/GTM Operations all map to
 * `sales_operations` because roleFamilies.ts treats them as ONE discipline
 * (see its comment at the `sales_operations` entry) — a Mission asking for Sales
 * Operations must still match a "Revenue Operations Manager" posting.
 *
 * A key absent from this table resolves to nothing and the run falls back to the
 * default commercial ladder — failing SAFE, never to an empty vocabulary.
 */
const MISSION_FAMILY_TO_CANONICAL: Readonly<Record<string, RoleFamily>> = {
  sales_ops: "sales_operations",
  rev_ops: "sales_operations",
  gtm_ops: "sales_operations",
  marketing_ops: "marketing_growth",
  customer_success: "customer_success",
  sdr: "gtm_sales",
  engineering: "engineering",
  // ── A CANONICAL FAMILY IS ALSO A LEGAL MISSION KEY ────────────────────────
  //
  // The mission's own short keys above came from a marker table that predates
  // the structured signal reader. That reader resolves a role against
  // `ROLE_FAMILY_ALIASES` and therefore emits the CANONICAL family name —
  // `sales_operations`, not `sales_ops`.
  //
  // Without these identity entries, such a family resolves to nothing here and
  // the run falls back to the default commercial ladder. That fallback is safe
  // by design, but it is also a silent loss of exactly the precision the
  // structured reader exists to add: a mission that correctly identified
  // "Revenue Operations" would qualify against a generic sales vocabulary.
  //
  // Listed rather than derived so the table stays one readable statement of
  // every key a mission may legally carry.
  sales_operations: "sales_operations",
  gtm_sales: "gtm_sales",
  marketing_growth: "marketing_growth",
  ops: "ops",
  finance: "finance",
};

/**
 * Reduce a Mission-decided term to a matchable title fragment.
 *
 * CANONICALIZATION, NOT INTERPRETATION. Every input here is a field the Mission
 * already decided — `required_signal_terms`, `required_signals[].role_families`.
 * This does not read the user's sentence; it makes a decided value comparable to
 * a job title. "software engineers" and "Software Engineer" must match, so the
 * trailing plural is dropped and a leading signal word is stripped.
 */
export function normalizeRoleTerm(term: unknown): string | null {
  let t = lc(term).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  // "hiring software engineers" -> "software engineers"
  for (const w of SIGNAL_TYPE_WORDS) {
    if (t.startsWith(`${w} `)) { t = t.slice(w.length + 1).trim(); break; }
  }
  if (!t) return null;
  // A bare signal word carries no role information.
  if (SIGNAL_TYPE_WORDS.includes(t)) return null;
  // "software engineers" -> "software engineer".
  //
  // HEAD NOUN ONLY, and only when the singular is still a substantial word.
  // Titles are matched by substring, so the plural form would never match
  // "Software Engineer". The >= 5 character floor is what keeps "sales" as
  // "sales" rather than "sale" — a word that is not a plural of anything we
  // want to match, and whose stem could match unrelated titles.
  const parts = t.split(" ");
  const head = parts[parts.length - 1];
  if (head.length >= 6 && head.endsWith("s") && !head.endsWith("ss")) {
    const stem = head.slice(0, -1);
    if (stem.length >= 5) parts[parts.length - 1] = stem;
  }
  t = parts.join(" ");
  return t || null;
}

/**
 * The role vocabulary this run qualifies against, decided ONCE from the Mission.
 *
 * ONE VOCABULARY PER RUN. `commercialSignalPolicy`'s header records the incident
 * that rule exists to prevent — prequalification scoring on one role list while
 * hiring verification filtered on another, so a company could be shortlisted and
 * then found to have no signal. This does not add a second list. It decides
 * which single list is authoritative for the run, and that decision travels with
 * the context so every stage reads the same one.
 */
export interface MissionRoleVocabulary {
  /** `mission` when the Mission named roles; `default_commercial` otherwise. */
  source: "mission" | "default_commercial";
  /** Normalized title fragments that QUALIFY for this Mission. Empty when default. */
  required_titles: readonly string[];
}

/**
 * Which company facts the Mission itself decided, and therefore owns.
 *
 * A `true` here means the Brain may not reject on that axis. A `false` means the
 * Mission is silent and the Brain keeps whatever authority it already had.
 */
export interface MissionOwnedAxes {
  employee_count: boolean;
  industry: boolean;
  geography: boolean;
  stage: boolean;
  hiring_role: boolean;
}

export interface QualificationContext {
  version: typeof QUALIFICATION_CONTEXT_VERSION;
  original_user_query: string;
  target_entity: string;
  /** Mission hard constraints, by key — absolute. */
  hard_constraints: Record<string, unknown>;
  soft_preferences: Record<string, unknown>;
  verticals: readonly string[];
  stages: readonly string[];
  locations: readonly string[];
  strategies: readonly string[];
  /** Mission-decided employee bounds. NULL means the Mission expressed none. */
  employee_range: { min: number | null; max: number | null };
  role_vocabulary: MissionRoleVocabulary;
  mission_owns: MissionOwnedAxes;
  directives: Record<string, unknown> | null;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => lc(x)).filter(Boolean) : [];
}

/**
 * Build the qualification context from a Mission.
 *
 * Everything below reads a field the Mission already settled. Nothing here
 * parses `original_user_query` — it is carried verbatim for evidence and
 * explanation, never re-read for meaning.
 */
export function buildQualificationContext(mission: LeadMissionV1): QualificationContext {
  const profile = rec((mission as unknown as Record<string, unknown>).company_profile);
  const verticals = strs(profile.verticals);
  const stages = strs(profile.stages);
  const locations = strs(profile.locations);
  const strategies = strs((mission as unknown as Record<string, unknown>).strategies);
  const hard = rec((mission as unknown as Record<string, unknown>).hard_constraints);
  const soft = rec((mission as unknown as Record<string, unknown>).soft_preferences);

  const range = rec(profile.employee_range);
  const employee_range = {
    min: typeof range.min === "number" ? range.min : null,
    max: typeof range.max === "number" ? range.max : null,
  };

  // ── THE ROLE VOCABULARY ──────────────────────────────────────────────────
  // Sources, in order: the Mission's own signal role_families, then its
  // required_signal_terms. Both are Mission-decided fields.
  const signals = Array.isArray((mission as unknown as Record<string, unknown>).required_signals)
    ? (mission as unknown as { required_signals: Array<Record<string, unknown>> }).required_signals
    : [];
  // Families are KEYS and must be expanded to titles; terms are already phrases.
  const fromFamilies = signals
    .flatMap((s) => strs(s?.role_families))
    .flatMap((fam) => {
      const canonical = MISSION_FAMILY_TO_CANONICAL[fam];
      return canonical ? roleFamilyAliases(canonical) : [];
    });
  const fromTerms = strs((mission as unknown as Record<string, unknown>).required_signal_terms);
  const required_titles = [...new Set(
    [...fromFamilies, ...fromTerms].map(normalizeRoleTerm).filter((t): t is string => !!t),
  )];

  const role_vocabulary: MissionRoleVocabulary = required_titles.length > 0
    ? { source: "mission", required_titles }
    : { source: "default_commercial", required_titles: [] };

  return {
    version: QUALIFICATION_CONTEXT_VERSION,
    original_user_query: String(
      (mission as unknown as Record<string, unknown>).original_user_query ?? ""),
    target_entity: lc((mission as unknown as Record<string, unknown>).target_entity) || "company",
    hard_constraints: hard,
    soft_preferences: soft,
    verticals, stages, locations, strategies,
    employee_range,
    role_vocabulary,
    mission_owns: {
      // The Mission owns an axis when it actually said something about it.
      employee_count: employee_range.min != null || employee_range.max != null,
      industry: verticals.length > 0,
      geography: locations.length > 0 ||
        (mission as unknown as { geography_is_hard?: boolean }).geography_is_hard === true,
      stage: stages.length > 0,
      hiring_role: role_vocabulary.source === "mission",
    },
    directives: (mission as unknown as { directives?: Record<string, unknown> }).directives ?? null,
  };
}

/**
 * Resolve the employee bounds qualification may ENFORCE.
 *
 * The Mission wins when it stated a range. When it did not, the Brain's bounds
 * are advisory: they still ORDER results, but they may not reject, because
 * nothing the user asked for mentioned company size. This is the rule that
 * would have kept the 7 `employee_size` exclusions in the run above.
 */
export function resolveEmployeeBounds(
  ctx: Pick<QualificationContext, "employee_range" | "mission_owns">,
  brain: { employee_min?: number | null; employee_max?: number | null } | null | undefined,
): { min: number | null; max: number | null; enforceable: boolean; source: "mission" | "brain_advisory" | "none" } {
  if (ctx.mission_owns.employee_count) {
    return {
      min: ctx.employee_range.min, max: ctx.employee_range.max,
      enforceable: true, source: "mission",
    };
  }
  const min = brain?.employee_min ?? null;
  const max = brain?.employee_max ?? null;
  if (min == null && max == null) return { min: null, max: null, enforceable: false, source: "none" };
  // Present for ranking, NOT for rejection.
  return { min, max, enforceable: false, source: "brain_advisory" };
}

/**
 * May the Brain reject on this axis?
 *
 * False whenever the Mission decided the same axis — the Brain is supplementary
 * there and contributes ranking only.
 */
export function brainMayReject(
  ctx: Pick<QualificationContext, "mission_owns">,
  axis: keyof MissionOwnedAxes,
): boolean {
  return !ctx.mission_owns[axis];
}

// ───────────────────────────── the four-tier authority ─────────────────────

/**
 * WHAT THE BRAIN IS ALLOWED TO DO, FIELD BY FIELD.
 *
 * TWO CONTRADICTORY PRECEDENCE MODELS WERE LIVE AT ONCE.
 *
 *   `companyBrainEffectivePolicy` — "a mission may narrow a hard Brain
 *   constraint, never widen it", merged as an INTERSECTION.
 *
 *   this module's header — "the Brain is supplementary: hard ONLY where the
 *   Mission is silent".
 *
 * They disagree on the case that matters. For the Mission "AI startups in the
 * United States hiring software engineers", which states no employee range, the
 * first keeps the workspace's 10-150 ceiling HARD and rejects a 220-person AI
 * startup that satisfies every stated requirement; the second lets it through
 * and ranks it below its in-range peers. Both ran in TEST run d787cfc7, in
 * different stages of the same pipeline.
 *
 * This resolves it, and the resolution is scoped to qualification: the shared
 * `companyBrainEffectivePolicy` keeps its own semantics for Scout Radar,
 * Content and Outreach, which are not this pipeline and are not covered by
 * these tests.
 *
 * ── THE FOUR TIERS ────────────────────────────────────────────────────────
 *
 *   1 MISSION HARD      the user said it in this request              absolute
 *   2 BRAIN HARD        an axis the Mission never mentions            absolute
 *   3 BRAIN PREFERENCE  an axis the Mission never mentions        score only
 *   4 CONFLICT          both spoke and disagreed          Mission wins, recorded
 *
 * ── WHY EACH FIELD SITS WHERE IT DOES ─────────────────────────────────────
 *
 * `excluded_industries` and `disqualifier_keywords` are tier 2 ALWAYS. They say
 * who the workspace can never sell to, which is a different question from which
 * slice the user wants today — a Mission naming "AI startups" is not a Mission
 * authorising Manufacturing.
 *
 * `positive_industries` is tier 3 ALWAYS. LinkedIn's vocabulary has no
 * "B2B SaaS"; `evaluateCompanyFit` already demoted the label to soft evidence
 * for exactly that reason, and a wording mismatch is a question for the
 * evaluator, not a rejection.
 *
 * `employee_range` is tier 3 ALWAYS. A preferred size is a preference; it may
 * order results and may never be the sole reason a company that satisfies the
 * Mission is discarded.
 *
 * `required_geography` is tier 2 when the Mission is silent and tier 4 when it
 * is not — the Mission's own locations then govern.
 */
export const BRAIN_AUTHORITY_VERSION = "mission-brain-authority-v1" as const;

/** A Brain field the evaluator may REJECT on. */
export interface BrainRejectingConstraints {
  excluded_industries: readonly string[];
  disqualifier_keywords: readonly string[];
  /** Null when the Mission owns geography, or the Brain named none. */
  required_geography: string | null;
}

/** A Brain field that may only move the score. */
export interface BrainPreferences {
  employee_range: { min: number | null; max: number | null };
  target_industries: readonly string[];
  business_models: readonly string[];
  buyer_roles: readonly string[];
  target_signals: readonly string[];
}

export interface AuthorityConflict {
  axis: keyof MissionOwnedAxes | "geography_value";
  mission_value: unknown;
  brain_value: unknown;
  /** Always `mission`. Recorded so a decision can be explained, never inferred. */
  resolved_to: "mission";
  reason: string;
}

export interface BrainAuthority {
  version: typeof BRAIN_AUTHORITY_VERSION;
  rejecting: BrainRejectingConstraints;
  preferences: BrainPreferences;
  /** Axes the Mission decided. The Brain contributes ranking on these only. */
  mission_owned: readonly string[];
  conflicts: readonly AuthorityConflict[];
}

/** The Brain slice this resolver reads. Loose, so it works on the wire shape. */
export interface BrainAuthorityInput {
  employee_min?: number | null;
  employee_max?: number | null;
  positive_industries?: readonly string[];
  excluded_industries?: readonly string[];
  required_geography?: string | null;
  business_models?: readonly string[];
  buyer_roles?: readonly string[];
  target_signals?: readonly string[];
  disqualifier_keywords?: readonly string[];
}

const arr = (v: readonly string[] | undefined): string[] =>
  (v ?? []).map((x) => String(x ?? "").trim()).filter(Boolean);

/**
 * Split the Brain into what may reject and what may only score.
 *
 * TOTAL. Every supplied field lands in exactly one of the two, and every axis
 * the Mission also decided is recorded — as a conflict when the Brain
 * disagreed, so "the Mission won here" is a fact in the artifact rather than an
 * inference from absence.
 */
export function resolveBrainAuthority(
  ctx: Pick<QualificationContext, "mission_owns" | "verticals" | "locations" | "employee_range">,
  brain: BrainAuthorityInput | null | undefined,
): BrainAuthority {
  const conflicts: AuthorityConflict[] = [];
  const missionOwned = (Object.keys(ctx.mission_owns) as Array<keyof MissionOwnedAxes>)
    .filter((k) => ctx.mission_owns[k]);

  // GEOGRAPHY — tier 2 when the Mission is silent, tier 4 when it is not.
  const brainGeo = typeof brain?.required_geography === "string" && brain.required_geography.trim()
    ? brain.required_geography.trim()
    : null;
  let rejectingGeo = brainGeo;
  if (brainGeo && ctx.mission_owns.geography) {
    rejectingGeo = null;
    conflicts.push({
      axis: "geography_value",
      mission_value: ctx.locations,
      brain_value: brainGeo,
      resolved_to: "mission",
      reason: "the Mission stated its own geography; the workspace default may not narrow it",
    });
  }

  // EMPLOYEE RANGE — tier 3 always. Recorded as a conflict only when the
  // Mission also stated one, because that is the case where two numbers exist.
  const bMin = brain?.employee_min ?? null;
  const bMax = brain?.employee_max ?? null;
  if ((bMin != null || bMax != null) && ctx.mission_owns.employee_count) {
    conflicts.push({
      axis: "employee_count",
      mission_value: ctx.employee_range,
      brain_value: { min: bMin, max: bMax },
      resolved_to: "mission",
      reason: "the Mission stated its own employee range",
    });
  }

  // INDUSTRY — positive industries are a preference either way; a conflict is
  // recorded when the Mission named verticals of its own.
  const positives = arr(brain?.positive_industries);
  if (positives.length > 0 && ctx.mission_owns.industry) {
    conflicts.push({
      axis: "industry",
      mission_value: ctx.verticals,
      brain_value: positives,
      resolved_to: "mission",
      reason: "the Mission named its own verticals; workspace industries rank, they do not gate",
    });
  }

  return {
    version: BRAIN_AUTHORITY_VERSION,
    rejecting: {
      // TIER 2 ALWAYS — who the workspace can never sell to.
      excluded_industries: arr(brain?.excluded_industries),
      disqualifier_keywords: arr(brain?.disqualifier_keywords),
      required_geography: rejectingGeo,
    },
    preferences: {
      // TIER 3 ALWAYS.
      employee_range: { min: bMin, max: bMax },
      target_industries: positives,
      business_models: arr(brain?.business_models),
      buyer_roles: arr(brain?.buyer_roles),
      target_signals: arr(brain?.target_signals),
    },
    mission_owned: missionOwned,
    conflicts,
  };
}

/** Compact, loggable summary. No user text beyond the query the Mission owns. */
export function qualificationContextSummary(ctx: QualificationContext) {
  return {
    version: ctx.version,
    target_entity: ctx.target_entity,
    role_vocabulary_source: ctx.role_vocabulary.source,
    required_titles: ctx.role_vocabulary.required_titles,
    verticals: ctx.verticals,
    stages: ctx.stages,
    locations: ctx.locations,
    strategies: ctx.strategies,
    employee_range: ctx.employee_range,
    mission_owns: ctx.mission_owns,
    hard_constraint_keys: Object.keys(ctx.hard_constraints).sort(),
  };
}
