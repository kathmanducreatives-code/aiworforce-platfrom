// ADAPTIVE SOURCING STRATEGY — contract, query-dependent source order, validation.
//
// This is the layer where Claude's semantic judgment meets Agentory's authority.
// Claude proposes: how to read the market objective, which role families matter,
// how to divide them into packs, and — the part a fixed pipeline cannot do — WHICH
// SOURCE ORDER this particular mission deserves. A founder-led SaaS startup search
// and a mid-market UK search do not want the same first source.
//
// What Claude may NEVER change is enumerated in `MISSION_INVARIANTS` and enforced
// by `validateAdaptiveStrategy`: the final entity, the requested quota, the Company
// Brain constraints, the geography, the employee range and the recency ceiling.
// Those are mission truth. A strategy that alters one is not repaired — it is
// rejected, and the caller uses the existing deterministic plan.
//
// SEMANTIC FILTERS, NOT PROVIDER FIELDS. Claude proposes intent ("US, ≤60 days
// old, full-time, startup preferred"). Agentory's existing capability compiler
// maps that to each Actor's verified schema. When a source cannot express a
// constraint, that fact is RECORDED (`unenforceable_filters`) rather than faked,
// so the next decision can weigh the rejection rate it will cause.
//
// Pure. No provider, model, network or database access.

import {
  type AdaptiveCapabilityCard,
} from "./leadCapabilityCards.ts";
import {
  validateRoleTaxonomy, type RoleTaxonomy, type TaxonomyRepair, type TaxonomyValidation,
} from "./leadRoleTaxonomy.ts";
import {
  validateQueryPacks, type PackRepair, type QueryPack,
} from "./leadQueryPacks.ts";

export const ADAPTIVE_STRATEGY_VERSION = "lead-adaptive-strategy-1.0.0";

/**
 * The hard recency ceiling for hiring evidence, in days.
 *
 * A posting older than this is not current hiring intent, whatever a planner
 * argues. Claude may tighten it; it may never raise it.
 */
export const MAX_RECENCY_DAYS = 60;

export const MISSION_INVARIANTS = [
  "final_entity", "requested_count", "company_constraints",
  "geography", "employee_range", "maximum_recency_days",
] as const;

// ------------------------------------------------------------------- types ----

export interface AdaptiveMission {
  interpreted_goal: string;
  final_entity: string;
  requested_count: number;
  decision_maker_roles: string[];
}

export interface AdaptiveCompanyConstraints {
  business_model?: string;
  company_stage?: string[];
  employee_count?: { min?: number; max?: number };
  country?: string;
  [k: string]: unknown;
}

export interface AdaptiveRecencyPolicy {
  preferred_age_days?: number;
  maximum_age_days: number;
}

/** What Claude proposes per step. Provider fields never appear here. */
export interface AdaptiveSemanticFilters {
  countries?: string[];
  preferred_age_days?: number;
  maximum_age_days?: number;
  employment_types?: string[];
  workplace_types?: string[];
  company_constraints?: {
    business_model?: string;
    employee_max?: number;
    startup_preferred?: boolean;
  };
  company_enrichment_required?: boolean;
}

export interface AdaptiveSourceStep {
  step_id: string;
  capability_key: string;
  purpose: string;
  query_pack_ids: string[];
  semantic_filters: AdaptiveSemanticFilters;
  success_condition: Record<string, unknown>;
  exhaustion_condition: Record<string, unknown>;
  switch_condition: Record<string, unknown>;
  /** Claude's one-line justification for this source at this position. */
  rationale?: string;
}

export interface AdaptiveStrategy {
  mission: AdaptiveMission;
  company_constraints: AdaptiveCompanyConstraints;
  recency_policy: AdaptiveRecencyPolicy;
  role_taxonomy: RoleTaxonomy;
  query_packs: QueryPack[];
  source_plan: AdaptiveSourceStep[];
  broadening_ladder: string[];
  people_search_condition: Record<string, unknown>;
  stop_conditions: Record<string, unknown>;
}

/** The authoritative mission facts a strategy is checked against. */
export interface MissionTruth {
  final_entity: string;
  requested_count: number;
  hiring_role_seed: string;
  decision_maker_roles: string[];
  company_constraints: AdaptiveCompanyConstraints;
  maximum_age_days: number;
}

export const STRATEGY_BOUNDS = {
  maxSourceSteps: 6,
  maxBroadeningRungs: 8,
  maxTextChars: 240,
  maxCountries: 8,
  maxEmploymentTypes: 6,
  maxWorkplaceTypes: 4,
} as const;

// ----------------------------------------------------------------- helpers ----

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
    if (!s || out.some((x) => x.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function posInt(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * Does this string name a provider Actor rather than a capability?
 *
 * A raw Actor ID in a strategy is not a small mistake — it means the planner
 * believes it is addressing providers directly, and it has happened before. Any
 * hit invalidates the whole strategy rather than being stripped, because the
 * intent it reveals cannot be repaired.
 */
export function looksLikeRawActorId(v: string): boolean {
  const s = lower(v);
  if (!s) return false;
  if (s.includes("apify") || s.includes("~")) return true;
  // "owner/actor-name" — the universal Apify store shape.
  return /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(s);
}

// ------------------------------------------------------------------- parse ----

function parseSemanticFilters(raw: unknown): AdaptiveSemanticFilters {
  const o = obj(raw);
  const cc = obj(o.company_constraints);
  const out: AdaptiveSemanticFilters = {
    countries: strList(o.countries, STRATEGY_BOUNDS.maxCountries, 80),
    employment_types: strList(o.employment_types, STRATEGY_BOUNDS.maxEmploymentTypes, 40),
    workplace_types: strList(o.workplace_types, STRATEGY_BOUNDS.maxWorkplaceTypes, 40),
    company_enrichment_required: o.company_enrichment_required === true,
  };
  const pref = posInt(o.preferred_age_days);
  const max = posInt(o.maximum_age_days);
  if (pref !== undefined) out.preferred_age_days = pref;
  if (max !== undefined) out.maximum_age_days = max;
  if (Object.keys(cc).length > 0) {
    out.company_constraints = {
      business_model: str(cc.business_model, 80) || undefined,
      employee_max: posInt(cc.employee_max),
      startup_preferred: cc.startup_preferred === true,
    };
  }
  return out;
}

export function parseAdaptiveStrategy(raw: unknown): AdaptiveStrategy | null {
  const r = obj(raw);
  if (Object.keys(r).length === 0) return null;

  const m = obj(r.mission);
  const rp = obj(r.recency_policy);
  const maxAge = posInt(rp.maximum_age_days);

  const steps: AdaptiveSourceStep[] = [];
  const rawSteps = Array.isArray(r.source_plan) ? r.source_plan : [];
  for (const s of rawSteps) {
    const o = obj(s);
    const capability_key = str(o.capability_key, 60);
    const step_id = str(o.step_id, 60);
    if (!capability_key || !step_id) continue;
    steps.push({
      step_id,
      capability_key,
      purpose: str(o.purpose, STRATEGY_BOUNDS.maxTextChars),
      query_pack_ids: strList(o.query_pack_ids, 8, 48),
      semantic_filters: parseSemanticFilters(o.semantic_filters),
      success_condition: obj(o.success_condition),
      exhaustion_condition: obj(o.exhaustion_condition),
      switch_condition: obj(o.switch_condition),
      rationale: str(o.rationale, STRATEGY_BOUNDS.maxTextChars) || undefined,
    });
    if (steps.length >= STRATEGY_BOUNDS.maxSourceSteps) break;
  }

  const requested = posInt(m.requested_count);
  if (requested === undefined) return null;

  return {
    mission: {
      interpreted_goal: str(m.interpreted_goal, STRATEGY_BOUNDS.maxTextChars),
      final_entity: str(m.final_entity, 60),
      requested_count: requested,
      decision_maker_roles: strList(m.decision_maker_roles, 8, 60),
    },
    company_constraints: obj(r.company_constraints) as AdaptiveCompanyConstraints,
    recency_policy: {
      preferred_age_days: posInt(rp.preferred_age_days),
      maximum_age_days: maxAge ?? MAX_RECENCY_DAYS,
    },
    // Taxonomy and packs are parsed by their own modules; the caller supplies the
    // already-parsed values. Here we only carry them.
    role_taxonomy: (r.role_taxonomy as RoleTaxonomy) ?? { families: [], negative_patterns: [] },
    query_packs: (r.query_packs as QueryPack[]) ?? [],
    source_plan: steps,
    broadening_ladder: strList(r.broadening_ladder, STRATEGY_BOUNDS.maxBroadeningRungs, 60),
    people_search_condition: obj(r.people_search_condition),
    stop_conditions: obj(r.stop_conditions),
  };
}

// ------------------------------------------------------- source ordering ----

export interface SourceOrderContext {
  /** Company Brain / ICP constraints for THIS mission. */
  company_constraints: AdaptiveCompanyConstraints;
  /** Whether the mission wants current postings only. */
  maximum_age_days: number;
}

export interface ScoredSource {
  capability: string;
  score: number;
  rationale: string;
}

/**
 * Deterministic source ordering derived from the mission.
 *
 * This is NOT the universal order — that is the point. It reads the mission's own
 * constraints and scores each card against them, so a startup/small-team mission
 * ranks YC first while a large-company or non-startup mission does not. It serves
 * two jobs: the fallback order when Claude's plan is rejected, and the reference
 * a test can use to prove ordering actually varies with the query.
 */
export function recommendSourceOrder(
  cards: readonly AdaptiveCapabilityCard[],
  ctx: SourceOrderContext,
): ScoredSource[] {
  const cc = ctx.company_constraints ?? {};
  const empMax = cc.employee_count?.max;
  const stages = (cc.company_stage ?? []).map(lower).join(" ");
  const startupMission = (empMax !== undefined && empMax <= 200) ||
    /startup|early|seed|small team|pre-seed|series a/.test(stages);
  const model = lower(cc.business_model);
  const techMission = /saas|software|b2b|tech/.test(model);

  const scored = cards.map((c) => {
    let score = 0;
    const why: string[] = [];

    // Precision is worth more than recall when a strict ICP will reject most rows:
    // a wide net simply produces more rejections, not more leads.
    if (c.sourceQuality.precision === "high") { score += 2; why.push("high precision"); }
    else if (c.sourceQuality.precision === "low") { score -= 1; why.push("low precision"); }

    if (startupMission) {
      if (c.startup_relevance === "high") { score += 4; why.push("concentrates on early-stage companies"); }
      else if (c.startup_relevance === "medium") { score += 1; }
      else { score -= 1; why.push("little startup concentration"); }
    } else {
      // Without a startup constraint, breadth is the more useful property.
      if (c.sourceQuality.recall === "high") { score += 2; why.push("broad recall"); }
      if (c.startup_relevance === "high") { score -= 1; why.push("startup-only corpus is too narrow here"); }
    }

    if (techMission && (c.bestFor.industries ?? []).some((i) => /saas|software|tech|developer/.test(lower(i)))) {
      score += 1; why.push("industry match");
    }
    // Company identity is what the Brain gate needs to decide anything at all.
    if (c.company_metadata_quality === "high") { score += 1; why.push("strong company metadata"); }

    // A source that cannot filter recency provider-side still works — the bound is
    // applied after normalization — but it costs rows to do it.
    if (ctx.maximum_age_days > 0 && c.recency_enforcement === "post_normalization") {
      score -= 1; why.push("recency enforced after retrieval");
    }
    if (c.cost_class === "low") score += 1;
    else if (c.cost_class === "high") score -= 1;

    return { capability: c.capability, score, rationale: why.join("; ") || "no distinguishing traits" };
  });

  return scored.sort((a, b) => b.score - a.score || a.capability.localeCompare(b.capability));
}

// ---------------------------------------------------------------- validate ----

export type StrategyViolationCode =
  | "final_entity_changed"
  | "requested_count_changed"
  | "company_constraints_weakened"
  | "geography_changed"
  | "employee_range_widened"
  | "recency_exceeded"
  | "raw_actor_id"
  | "unapproved_capability"
  | "unknown_query_pack"
  | "no_source_steps"
  | "decision_maker_role_used_as_hiring_title"
  | "taxonomy_rejected"
  | "query_packs_rejected";

export interface StrategyViolation { code: StrategyViolationCode; detail: string }

export type StrategyRepairCode =
  | "recency_tightened_to_ceiling"
  | "unknown_pack_reference_removed"
  | "duplicate_step_removed"
  | "step_capped";

export interface StrategyRepair { code: StrategyRepairCode; detail: string }

export interface StrategyValidation {
  outcome: "valid" | "repaired" | "rejected";
  strategy: AdaptiveStrategy | null;
  violations: StrategyViolation[];
  repairs: StrategyRepair[];
  taxonomyRepairs: TaxonomyRepair[];
  packRepairs: PackRepair[];
  /** Filters the chosen sources cannot express provider-side, by capability. */
  unenforceable_filters: Record<string, string[]>;
  strategy_source: "claude" | "claude_repaired" | "deterministic_fallback";
  rejection_reason: string | null;
}

export interface StrategyValidationInput {
  strategy: AdaptiveStrategy;
  truth: MissionTruth;
  cards: readonly AdaptiveCapabilityCard[];
}

/** Constraints present in truth but absent/weakened in the proposal. */
function companyConstraintsWeakened(
  proposed: AdaptiveCompanyConstraints, truth: AdaptiveCompanyConstraints,
): string | null {
  if (truth.business_model && lower(proposed.business_model) !== lower(truth.business_model)) {
    return `business_model ${JSON.stringify(proposed.business_model)} != ${JSON.stringify(truth.business_model)}`;
  }
  if (truth.country && lower(proposed.country) !== lower(truth.country)) {
    return `country ${JSON.stringify(proposed.country)} != ${JSON.stringify(truth.country)}`;
  }
  const tMax = truth.employee_count?.max;
  const pMax = proposed.employee_count?.max;
  if (tMax !== undefined && (pMax === undefined || pMax > tMax)) {
    return `employee_count.max ${String(pMax)} exceeds ${tMax}`;
  }
  const tMin = truth.employee_count?.min;
  const pMin = proposed.employee_count?.min;
  if (tMin !== undefined && (pMin === undefined || pMin < tMin)) {
    return `employee_count.min ${String(pMin)} below ${tMin}`;
  }
  return null;
}

/**
 * Validate a proposed strategy against mission truth.
 *
 * Ordering matters: invariant violations are checked BEFORE any repair, so a
 * strategy that quietly widened the employee range can never be "repaired" into
 * acceptance. Repairs are reserved for narrowing and for dropping dangling
 * references.
 */
export function validateAdaptiveStrategy(input: StrategyValidationInput): StrategyValidation {
  const { strategy: s, truth, cards } = input;
  const violations: StrategyViolation[] = [];
  const repairs: StrategyRepair[] = [];
  const approved = new Set(cards.map((c) => c.capability.toLowerCase()));

  const reject = (reason: string): StrategyValidation => ({
    outcome: "rejected", strategy: null, violations, repairs,
    taxonomyRepairs: [], packRepairs: [], unenforceable_filters: {},
    strategy_source: "deterministic_fallback", rejection_reason: reason,
  });

  // ---- 1. mission invariants (never repairable) ----
  if (lower(s.mission.final_entity) !== lower(truth.final_entity)) {
    violations.push({ code: "final_entity_changed", detail: `${s.mission.final_entity} != ${truth.final_entity}` });
  }
  if (s.mission.requested_count !== truth.requested_count) {
    violations.push({ code: "requested_count_changed", detail: `${s.mission.requested_count} != ${truth.requested_count}` });
  }
  const weakened = companyConstraintsWeakened(s.company_constraints, truth.company_constraints);
  if (weakened) {
    const code: StrategyViolationCode = weakened.startsWith("country")
      ? "geography_changed"
      : weakened.startsWith("employee_count") ? "employee_range_widened" : "company_constraints_weakened";
    violations.push({ code, detail: weakened });
  }

  // ---- 2. raw Actor IDs anywhere in the plan ----
  for (const step of s.source_plan) {
    if (looksLikeRawActorId(step.capability_key)) {
      violations.push({ code: "raw_actor_id", detail: step.capability_key });
    }
  }

  if (violations.length > 0) {
    return reject(`strategy violates mission authority: ${violations.map((v) => v.code).join(", ")}`);
  }

  // ---- 3. recency ceiling (tightening is a repair; exceeding is a violation) ----
  const ceiling = Math.min(truth.maximum_age_days, MAX_RECENCY_DAYS);
  if (s.recency_policy.maximum_age_days > ceiling) {
    violations.push({
      code: "recency_exceeded",
      detail: `${s.recency_policy.maximum_age_days} days exceeds the ${ceiling}-day ceiling`,
    });
    return reject(`recency ceiling exceeded: ${s.recency_policy.maximum_age_days} > ${ceiling}`);
  }

  // ---- 4. decision-maker roles must not be used as hiring titles ----
  const dmRoles = new Set(truth.decision_maker_roles.map(lower));
  const hiringTitles = new Set(s.query_packs.flatMap((p) => p.titles.map(lower)));
  for (const r of dmRoles) {
    if (hiringTitles.has(r)) {
      violations.push({ code: "decision_maker_role_used_as_hiring_title", detail: r });
    }
  }
  if (violations.length > 0) {
    return reject("decision-maker roles were used as hiring-role titles");
  }

  // ---- 5. delegate taxonomy + packs to their own validators ----
  const taxV: TaxonomyValidation = validateRoleTaxonomy({
    taxonomy: s.role_taxonomy,
    approvedCapabilities: [...approved],
    hiringRoleSeed: truth.hiring_role_seed,
  });
  if (taxV.outcome === "rejected" || !taxV.taxonomy) {
    violations.push({ code: "taxonomy_rejected", detail: taxV.rejection_reason ?? "unknown" });
    return reject(`role taxonomy rejected: ${taxV.rejection_reason}`);
  }

  const packV = validateQueryPacks({
    packs: s.query_packs, taxonomy: taxV.taxonomy, approvedCapabilities: [...approved],
  });
  if (packV.outcome === "rejected") {
    violations.push({ code: "query_packs_rejected", detail: packV.rejection_reason ?? "unknown" });
    return reject(`query packs rejected: ${packV.rejection_reason}`);
  }

  // ---- 6. source steps ----
  const knownPacks = new Set(packV.packs.map((p) => p.pack_id));
  const seenSteps = new Set<string>();
  const steps: AdaptiveSourceStep[] = [];
  for (const step of s.source_plan) {
    if (!approved.has(lower(step.capability_key))) {
      violations.push({ code: "unapproved_capability", detail: step.capability_key });
      return reject(`unapproved capability: ${step.capability_key}`);
    }
    if (seenSteps.has(step.step_id)) {
      repairs.push({ code: "duplicate_step_removed", detail: step.step_id });
      continue;
    }
    const packIds = step.query_pack_ids.filter((id) => {
      if (knownPacks.has(id)) return true;
      repairs.push({ code: "unknown_pack_reference_removed", detail: `${step.step_id}:${id}` });
      return false;
    });
    const filters: AdaptiveSemanticFilters = { ...step.semantic_filters };
    if ((filters.maximum_age_days ?? 0) > ceiling) {
      filters.maximum_age_days = ceiling;
      repairs.push({ code: "recency_tightened_to_ceiling", detail: `${step.step_id} → ${ceiling}d` });
    }
    seenSteps.add(step.step_id);
    steps.push({ ...step, query_pack_ids: packIds, semantic_filters: filters });
    if (steps.length >= STRATEGY_BOUNDS.maxSourceSteps) {
      if (s.source_plan.length > STRATEGY_BOUNDS.maxSourceSteps) {
        repairs.push({ code: "step_capped", detail: `capped at ${STRATEGY_BOUNDS.maxSourceSteps}` });
      }
      break;
    }
  }
  if (steps.length === 0) {
    violations.push({ code: "no_source_steps", detail: "source_plan is empty after validation" });
    return reject("source plan is empty");
  }

  // ---- 7. record what each chosen source cannot enforce provider-side ----
  const unenforceable: Record<string, string[]> = {};
  const byId = new Map(cards.map((c) => [c.capability.toLowerCase(), c]));
  for (const step of steps) {
    const card = byId.get(lower(step.capability_key));
    if (!card) continue;
    const missing: string[] = [];
    if (truth.company_constraints.employee_count?.max !== undefined && !card.company_filter_support.company_size) {
      missing.push("employee_count");
    }
    if ((truth.company_constraints.company_stage ?? []).length > 0 && !card.company_filter_support.company_stage) {
      missing.push("company_stage");
    }
    if (truth.company_constraints.business_model && !card.company_filter_support.company_stage) {
      missing.push("business_model");
    }
    if (card.recency_enforcement === "post_normalization") missing.push("posting_window");
    if (missing.length > 0) unenforceable[step.capability_key] = [...new Set(missing)];
  }

  const allRepairs = repairs.length + taxV.repairs.length + packV.repairs.length;
  return {
    outcome: allRepairs > 0 ? "repaired" : "valid",
    strategy: {
      ...s,
      role_taxonomy: taxV.taxonomy,
      query_packs: packV.packs,
      source_plan: steps,
      recency_policy: { ...s.recency_policy, maximum_age_days: Math.min(s.recency_policy.maximum_age_days, ceiling) },
    },
    violations, repairs,
    taxonomyRepairs: taxV.repairs,
    packRepairs: packV.repairs,
    unenforceable_filters: unenforceable,
    strategy_source: allRepairs > 0 ? "claude_repaired" : "claude",
    rejection_reason: null,
  };
}

export const ADAPTIVE_STRATEGY_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["mission", "company_constraints", "recency_policy", "role_taxonomy", "query_packs", "source_plan"],
  properties: {
    mission: {
      type: "object",
      required: ["interpreted_goal", "final_entity", "requested_count", "decision_maker_roles"],
      properties: {
        interpreted_goal: { type: "string" },
        final_entity: { type: "string" },
        requested_count: { type: "integer", minimum: 1 },
        decision_maker_roles: { type: "array", items: { type: "string" } },
      },
    },
    company_constraints: { type: "object" },
    recency_policy: {
      type: "object", required: ["maximum_age_days"],
      properties: {
        preferred_age_days: { type: "integer", minimum: 1 },
        maximum_age_days: { type: "integer", minimum: 1, maximum: MAX_RECENCY_DAYS },
      },
    },
    role_taxonomy: { type: "object" },
    query_packs: { type: "array" },
    source_plan: {
      type: "array", maxItems: STRATEGY_BOUNDS.maxSourceSteps,
      items: {
        type: "object",
        required: ["step_id", "capability_key", "purpose", "query_pack_ids"],
        properties: {
          step_id: { type: "string" },
          capability_key: { type: "string", description: "A capability key. NEVER a provider or Actor identifier." },
          purpose: { type: "string" },
          query_pack_ids: { type: "array", items: { type: "string" } },
          semantic_filters: { type: "object" },
          success_condition: { type: "object" },
          exhaustion_condition: { type: "object" },
          switch_condition: { type: "object" },
          rationale: { type: "string" },
        },
      },
    },
    broadening_ladder: { type: "array", maxItems: STRATEGY_BOUNDS.maxBroadeningRungs, items: { type: "string" } },
    people_search_condition: { type: "object" },
    stop_conditions: { type: "object" },
  },
};
