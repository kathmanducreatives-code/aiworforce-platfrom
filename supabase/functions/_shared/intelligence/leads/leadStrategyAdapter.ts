// THE SMALLEST ADAPTER: existing Claude-first strategy → adaptive strategy.
//
// `planInitialLeadSourcing` already owns the model gateway, the prompt, the
// structured parser and the repair pass, and it already answers with an accepted
// `LeadInitialStrategy`. What it does NOT produce is the tiered taxonomy, the
// bounded query packs and the pack-referencing source plan the adaptive runtime
// consumes.
//
// This module derives those from the strategy that planner already returned. It
// makes NO model call, builds NO prompt and holds NO gateway — deleting it would
// cost the adaptive shape, not the Claude call. That is what keeps this an adapter
// rather than a second planner.
//
// The derivation is deliberately literal:
//   exact_titles     → the `exact` family (round-one eligible)
//   safe_synonyms    → the `direct_adjacent` family (deferred, level 2)
//   adjacent_titles  → the `evidence_gated_adjacent` family (deferred, level 3)
//   searches[]       → the source plan, in the planner's own capability order
//
// Everything after that is the existing validation: the taxonomy validator, the
// pack validator and `validateAdaptiveStrategy` all run unchanged, so a derived
// strategy is held to exactly the contract a directly-authored one would be.

import type { LeadInitialStrategy } from "./leadStrategy.ts";
import {
  REVENUE_OPERATIONS_EVIDENCE, TAXONOMY_BOUNDS,
  type RoleFamily, type RoleTaxonomy,
} from "./leadRoleTaxonomy.ts";
import { PACK_BOUNDS, type QueryPack } from "./leadQueryPacks.ts";
import {
  validateAdaptiveStrategy, recommendSourceOrder, MAX_RECENCY_DAYS,
  type AdaptiveSourceStep, type AdaptiveStrategy, type MissionTruth,
} from "./leadSourceStrategy.ts";
import type { AdaptiveCapabilityCard } from "./leadCapabilityCards.ts";

export const STRATEGY_ADAPTER_VERSION = "lead-strategy-adapter-1.0.0";

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
const slug = (v: string) => lower(v).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);

/** Split a title list into bounded packs, so no single call carries them all. */
function packsFor(
  family: RoleFamily, startPriority: number,
): QueryPack[] {
  const out: QueryPack[] = [];
  const size = Math.min(PACK_BOUNDS.maxTitlesPerPack, 5);
  for (let i = 0; i < family.titles.length; i += size) {
    const slice = family.titles.slice(i, i + size);
    if (slice.length === 0) continue;
    const n = out.length + 1;
    out.push({
      pack_id: `${family.family_id}_${n}`,
      label: `${family.canonical_function} ${n}`,
      functional_family_ids: [family.family_id],
      confidence_tier: family.confidence_tier,
      titles: slice,
      aliases: [],
      negative_patterns: [...family.negative_patterns],
      description_evidence: [...family.positive_description_evidence],
      recommended_capabilities: [...family.recommended_capabilities],
      priority: startPriority + out.length,
      broadening_level: family.broadening_level,
      initially_eligible: family.initially_eligible,
      maximum_attempts: 1,
      expected_precision: family.confidence_tier === "exact" ? "high" : "medium",
      expected_coverage: "medium",
    });
    if (out.length >= 3) break;                 // per-family cap; total is bounded below
  }
  return out;
}

export interface AdapterResult {
  ok: boolean;
  reason: string | null;
  strategy: AdaptiveStrategy | null;
  source: "claude" | "claude_repaired";
  /** The packs the ordered steps reference. Generated, never a fixture. */
  packs: QueryPack[];
  /** Safe provenance for persistence. */
  diagnostics: Record<string, unknown>;
}

export interface AdapterInput {
  strategy: LeadInitialStrategy;
  truth: MissionTruth;
  cards: readonly AdaptiveCapabilityCard[];
  /** Preferred posting age, tightened against the mission ceiling. */
  preferredAgeDays?: number;
}

/**
 * Derive and validate an adaptive strategy from the planner's accepted output.
 *
 * Returns `ok: false` with an exact reason whenever the derivation cannot produce
 * a contract-valid strategy — the caller then keeps `deterministicOrderedPlan`.
 */
export function adaptiveStrategyFromLeadStrategy(input: AdapterInput): AdapterResult {
  const s = input.strategy;
  const fail = (reason: string): AdapterResult =>
    ({ ok: false, reason, strategy: null, source: "claude", packs: [], diagnostics: { reason } });

  const ont = s.role_ontology;
  if (!ont) return fail("strategy_has_no_role_ontology");

  const concept = ont.canonical_concept || input.truth.hiring_role_seed;
  const families: RoleFamily[] = [];

  const mkFamily = (
    id: string, fn: string, tier: RoleFamily["confidence_tier"], titles: string[], level: number,
  ): RoleFamily | null => {
    const unique = [...new Set(titles.map((t) => String(t ?? "").trim()).filter(Boolean))]
      .slice(0, TAXONOMY_BOUNDS.maxTitlesPerFamily);
    if (unique.length === 0) return null;
    const gated = tier === "evidence_gated_adjacent";
    return {
      family_id: id, canonical_function: fn, confidence_tier: tier,
      titles: unique, aliases: [], abbreviations: [],
      seniority_levels: [...(ont.seniority ?? [])].slice(0, TAXONOMY_BOUNDS.maxSeniorityLevels),
      positive_description_evidence: gated ? [...REVENUE_OPERATIONS_EVIDENCE].slice(0, 10) : [],
      negative_patterns: [...(ont.excluded_titles ?? [])].slice(0, TAXONOMY_BOUNDS.maxNegativePerFamily),
      evidence_required: gated,
      initially_eligible: tier === "exact",
      broadening_level: level, maximum_attempts: 1, recommended_capabilities: [],
    };
  };

  const exact = mkFamily(slug(concept) || "exact_roles", concept, "exact", ont.exact_titles ?? [], 1);
  if (!exact) return fail("strategy_has_no_exact_titles");
  families.push(exact);

  const synonyms = mkFamily(
    `${exact.family_id}_synonyms`, `${concept} (approved synonyms)`, "direct_adjacent",
    (ont.safe_synonyms ?? []).map((x) => x.title), 2,
  );
  if (synonyms) families.push(synonyms);

  const adjacent = mkFamily(
    `${exact.family_id}_adjacent`, `${concept} (adjacent)`, "evidence_gated_adjacent",
    (ont.adjacent_titles ?? []).map((x) => x.title), 3,
  );
  if (adjacent) families.push(adjacent);

  const taxonomy: RoleTaxonomy = {
    families,
    negative_patterns: [
      ...(ont.excluded_titles ?? []),
      ...(s.exclusions?.titles ?? []),
    ].slice(0, TAXONOMY_BOUNDS.maxNegativePatterns),
  };

  // ---- packs ----
  let priority = 1;
  const packs: QueryPack[] = [];
  for (const f of families) {
    const made = packsFor(f, priority);
    priority += made.length;
    packs.push(...made);
    if (packs.length >= PACK_BOUNDS.maxPacks) break;
  }
  if (packs.length < PACK_BOUNDS.minPacks) {
    // One family with few titles cannot be divided. Rather than emit a single
    // unbounded pack — the exact failure packs exist to prevent — say so.
    return fail("strategy_titles_insufficient_to_divide");
  }

  // ---- source plan ----
  const approved = new Set(input.cards.map((c) => lower(c.capability)));
  const ceiling = Math.min(input.truth.maximum_age_days, MAX_RECENCY_DAYS);
  const eligiblePackIds = packs.filter((p) => p.initially_eligible).map((p) => p.pack_id);
  const deferredPackIds = packs.filter((p) => !p.initially_eligible).map((p) => p.pack_id);

  // The planner's own capability order, filtered to what Agentory will run.
  let ordered = [...new Set((s.searches ?? [])
    .map((x) => lower(x.capability_key))
    .filter((c) => approved.has(c)))];

  if (ordered.length === 0) {
    // The planner named no runnable capability. Rather than fail the mission, fall
    // back to the mission-derived ordering — still query-dependent, not a constant.
    ordered = recommendSourceOrder(input.cards, {
      company_constraints: input.truth.company_constraints,
      maximum_age_days: ceiling,
    }).map((x) => x.capability);
  }
  if (ordered.length === 0) return fail("no_approved_capability_available");

  const source_plan: AdaptiveSourceStep[] = ordered.slice(0, 4).map((cap, i) => {
    const search = (s.searches ?? []).find((x) => lower(x.capability_key) === cap);
    return {
      step_id: `s${i + 1}-${cap}`,
      capability_key: cap,
      purpose: search?.purpose ?? "discover_hiring_companies",
      // Exact packs open; the deferred tiers ride on later steps for broadening.
      query_pack_ids: i === 0 ? eligiblePackIds : [...eligiblePackIds, ...deferredPackIds].slice(0, 4),
      semantic_filters: {
        countries: search?.locations?.length
          ? [...search.locations]
          : input.truth.company_constraints.country ? [input.truth.company_constraints.country] : [],
        preferred_age_days: Math.min(input.preferredAgeDays ?? 30, ceiling),
        maximum_age_days: Math.min(search?.posting_window_days ?? ceiling, ceiling),
        company_constraints: {
          business_model: input.truth.company_constraints.business_model,
          employee_max: input.truth.company_constraints.employee_count?.max,
          startup_preferred: true,
        },
        company_enrichment_required: true,
      },
      success_condition: {}, exhaustion_condition: {}, switch_condition: {},
      rationale: search?.rationale ?? undefined,
    };
  });

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

  // ---- the EXISTING validation, unchanged ----
  const v = validateAdaptiveStrategy({ strategy: derived, truth: input.truth, cards: input.cards });
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
    source: v.strategy_source === "claude_repaired" ? "claude_repaired" : "claude",
    packs: v.strategy.query_packs,
    diagnostics: {
      adapter_version: STRATEGY_ADAPTER_VERSION,
      strategy_source: v.strategy_source,
      validation_outcome: v.outcome,
      pack_ids: v.strategy.query_packs.map((p) => p.pack_id),
      capability_order: v.strategy.source_plan.map((x) => x.capability_key),
      taxonomy_repairs: v.taxonomyRepairs.map((r) => r.code),
      pack_repairs: v.packRepairs.map((r) => r.code),
      unenforceable_filters: v.unenforceable_filters,
    },
  };
}
