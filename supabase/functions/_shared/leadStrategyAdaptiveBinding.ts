// GPT STRATEGY → ADAPTIVE RUNTIME BINDING.
//
// THE PRODUCTION DEFECT THIS FIXES (tasks 4851efb0 / b59b422b):
// the OpenAI strategy owner produced separate `query_packs`, and the runtime
// executed ONE merged Boolean per round anyway. The reason was structural, not
// a bug in the pack code: `applySequentialSourceExecution` only ever received an
// adaptive binding derived from the CLAUDE planner. On the GPT path that binding
// carried a null strategy, `strategyOutcome.packs` stayed empty, `activePacks`
// stayed empty, and `prepareStepPackCalls` — which is wired and tested — was
// never selected. `prepareStepCall` (one merged call) ran instead.
//
// This module is the missing edge: it converts an already-validated
// `LeadStrategyPlan` into the `AdaptiveStrategy` shape the sequential runtime
// consumes, so the packs GPT chose survive all the way to the Actor calls.
//
// It makes NO model call, builds NO prompt, holds NO gateway and invents NO
// titles: everything comes from the plan the strategy owner already returned and
// the validator already approved. The existing `validateAdaptiveStrategy` still
// passes final judgment, so a GPT-derived strategy is held to exactly the same
// contract a Claude-derived one is.
//
// Pure. No network, model or database access.

import type { LeadStrategyPlan } from "./leadStrategyContract.ts";
import {
  REVENUE_OPERATIONS_EVIDENCE, TAXONOMY_BOUNDS,
  type RoleFamily, type RoleTaxonomy,
} from "./intelligence/leads/leadRoleTaxonomy.ts";
import { PACK_BOUNDS, type QueryPack } from "./intelligence/leads/leadQueryPacks.ts";
import {
  validateAdaptiveStrategy, recommendSourceOrder, MAX_RECENCY_DAYS,
  type AdaptiveSourceStep, type AdaptiveStrategy, type MissionTruth,
} from "./intelligence/leads/leadSourceStrategy.ts";
import {
  adaptiveCapabilityCards, type AdaptiveCapabilityCard,
} from "./intelligence/leads/leadCapabilityCards.ts";

export const GPT_ADAPTIVE_BINDING_VERSION = "gpt-adaptive-binding-1.0.0";

/**
 * The strategist speaks in DISCOVERY SOURCE keys; the runtime speaks in
 * CAPABILITY keys. One table, both directions of the mismatch that would
 * otherwise silently drop every source GPT scheduled.
 */
export const SOURCE_KEY_TO_CAPABILITY: Record<string, string> = {
  yc_jobs: "yc_job_discovery",
  linkedin_jobs: "linkedin_job_discovery",
  indeed_jobs: "indeed_job_discovery",
  glassdoor_jobs: "glassdoor_job_discovery",
};

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
const slug = (v: string) => lower(v).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);

export interface GptAdaptiveResult {
  ok: boolean;
  reason: string | null;
  strategy: AdaptiveStrategy | null;
  source: "claude" | "claude_repaired";
  packs: QueryPack[];
  diagnostics: Record<string, unknown>;
}

export interface GptAdaptiveInput {
  plan: LeadStrategyPlan;
  truth: MissionTruth;
  cards?: readonly AdaptiveCapabilityCard[];
  preferredAgeDays?: number;
}

/**
 * Convert ONE validated GPT plan into a validated adaptive strategy.
 *
 * The pack grouping is the strategist's, unchanged: each `query_packs[i]`
 * becomes exactly one runtime pack, so pack identity, titles and ordering are
 * preserved end to end. Agentory keeps ownership of the bounds.
 */
export function adaptiveStrategyFromGptPlan(input: GptAdaptiveInput): GptAdaptiveResult {
  const cards = input.cards ?? adaptiveCapabilityCards();
  const fail = (reason: string): GptAdaptiveResult =>
    ({ ok: false, reason, strategy: null, source: "claude", packs: [], diagnostics: { reason } });

  const plan = input.plan;
  const concept = plan.role_family || input.truth.hiring_role_seed;
  const familyId = slug(concept) || "exact_roles";

  const titles = [...new Set((plan.title_queries ?? []).map((t) => String(t ?? "").trim()).filter(Boolean))]
    .slice(0, TAXONOMY_BOUNDS.maxTitlesPerFamily);
  if (titles.length === 0) return fail("gpt_plan_has_no_titles");

  const negatives = [...new Set((plan.excluded_titles ?? [])
    .map((t) => String(t ?? "").trim()).filter(Boolean))]
    .slice(0, TAXONOMY_BOUNDS.maxNegativePerFamily);

  const family: RoleFamily = {
    family_id: familyId,
    canonical_function: concept,
    confidence_tier: "exact",
    titles,
    aliases: [],
    abbreviations: [],
    seniority_levels: [],
    positive_description_evidence: [...REVENUE_OPERATIONS_EVIDENCE].slice(0, 10),
    negative_patterns: negatives,
    evidence_required: false,
    initially_eligible: true,
    broadening_level: 1,
    maximum_attempts: 1,
    recommended_capabilities: [],
  };
  const taxonomy: RoleTaxonomy = {
    families: [family],
    negative_patterns: negatives.slice(0, TAXONOMY_BOUNDS.maxNegativePatterns),
  };

  // ---- packs: the strategist's OWN grouping, one for one -------------------
  const packs: QueryPack[] = [];
  for (const p of plan.query_packs ?? []) {
    const packTitles = [...new Set((p.queries ?? [])
      .map((q) => String(q ?? "").trim()).filter(Boolean))]
      .slice(0, PACK_BOUNDS.maxTitlesPerPack);
    if (packTitles.length === 0) continue;
    const id = slug(String(p.pack_id ?? "")) || `pack_${packs.length + 1}`;
    if (packs.some((x) => x.pack_id === id)) continue;
    packs.push({
      pack_id: id,
      label: id.replace(/_/g, " ").slice(0, PACK_BOUNDS.maxLabelChars),
      functional_family_ids: [familyId],
      confidence_tier: "exact",
      titles: packTitles,
      aliases: [],
      negative_patterns: [...negatives].slice(0, PACK_BOUNDS.maxNegativePerPack),
      description_evidence: [],
      recommended_capabilities: [],
      priority: packs.length + 1,
      broadening_level: 1,
      initially_eligible: true,
      maximum_attempts: 1,
      expected_precision: "high",
      expected_coverage: "medium",
    });
    if (packs.length >= PACK_BOUNDS.maxPacks) break;
  }
  if (packs.length === 0) return fail("gpt_plan_has_no_query_packs");

  // ---- source plan: the strategist's order, mapped to capabilities ---------
  const approved = new Set(cards.map((c) => lower(c.capability)));
  const ceiling = Math.min(input.truth.maximum_age_days, MAX_RECENCY_DAYS);
  let ordered = [...new Set((plan.source_plan ?? [])
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((s) => SOURCE_KEY_TO_CAPABILITY[lower(s.source_key)] ?? lower(s.source_key))
    .filter((c) => approved.has(c)))];

  if (ordered.length === 0) {
    ordered = recommendSourceOrder(cards, {
      company_constraints: input.truth.company_constraints,
      maximum_age_days: ceiling,
    }).map((x) => x.capability);
  }
  if (ordered.length === 0) return fail("no_approved_capability_available");

  const allPackIds = packs.map((p) => p.pack_id);
  const source_plan: AdaptiveSourceStep[] = ordered.slice(0, 4).map((cap, i) => ({
    step_id: `s${i + 1}-${cap}`,
    capability_key: cap,
    purpose: "discover_hiring_companies",
    // Every step runs every pack SEPARATELY — that is the whole point of packs.
    query_pack_ids: [...allPackIds].slice(0, 4),
    semantic_filters: {
      countries: input.truth.company_constraints.country ? [input.truth.company_constraints.country] : [],
      preferred_age_days: Math.min(input.preferredAgeDays ?? 30, ceiling),
      maximum_age_days: ceiling,
      company_constraints: {
        business_model: input.truth.company_constraints.business_model,
        employee_max: input.truth.company_constraints.employee_count?.max,
        startup_preferred: true,
      },
      company_enrichment_required: true,
    },
    success_condition: {}, exhaustion_condition: {}, switch_condition: {},
  }));

  const derived: AdaptiveStrategy = {
    mission: {
      interpreted_goal: concept,
      final_entity: input.truth.final_entity,
      requested_count: input.truth.requested_count,
      decision_maker_roles: [...input.truth.decision_maker_roles],
    },
    company_constraints: input.truth.company_constraints,
    recency_policy: {
      preferred_age_days: Math.min(input.preferredAgeDays ?? 30, ceiling),
      maximum_age_days: ceiling,
    },
    role_taxonomy: taxonomy,
    query_packs: packs,
    source_plan,
    broadening_ladder: [],
    people_search_condition: {},
    stop_conditions: {},
  };

  const v = validateAdaptiveStrategy({ strategy: derived, truth: input.truth, cards });
  if (v.outcome === "rejected" || !v.strategy) {
    return {
      ok: false, reason: v.rejection_reason ?? "strategy_invalid", strategy: null,
      source: "claude", packs: [],
      diagnostics: { reason: v.rejection_reason, violations: v.violations.map((x) => x.code) },
    };
  }

  return {
    ok: true, reason: null,
    strategy: v.strategy,
    source: "claude",
    packs: v.strategy.query_packs,
    diagnostics: {
      binding_version: GPT_ADAPTIVE_BINDING_VERSION,
      strategy_source: "openai_lead_strategy",
      validation_outcome: v.outcome,
      pack_ids: v.strategy.query_packs.map((p) => p.pack_id),
      capability_order: v.strategy.source_plan.map((x) => x.capability_key),
      unenforceable_filters: v.unenforceable_filters,
    },
  };
}

export interface GptAdaptiveBinding {
  planAdaptiveStrategy: () => Promise<unknown>;
  validateAdaptiveStrategy: (raw: unknown) => GptAdaptiveResult;
}

/**
 * The binding handed to `applySequentialSourceExecution` on the GPT path.
 *
 * NO model call happens here: the plan was already resolved by the strategy
 * owner, so `planAdaptiveStrategy` merely hands that same plan back and the
 * conversion above is what the runtime validates.
 */
export function gptAdaptiveStrategyBinding(
  plan: LeadStrategyPlan | null | undefined,
  truth: MissionTruth,
  cards?: readonly AdaptiveCapabilityCard[],
): GptAdaptiveBinding {
  return {
    planAdaptiveStrategy: () => Promise.resolve(plan ?? null),
    validateAdaptiveStrategy: (raw: unknown) =>
      adaptiveStrategyFromGptPlan({ plan: raw as LeadStrategyPlan, truth, cards }),
  };
}
