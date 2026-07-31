// THE PLANNING CONTEXT CLAUDE RECEIVES — and the deterministic plan it falls back to.
//
// Two responsibilities, kept together because they are two halves of one contract:
// what the strategist is told, and what runs when the strategist is unavailable,
// disabled or wrong.
//
// WHAT IS DELIBERATELY ABSENT. No credential, no API key, no Actor ID, no
// provider JSON, no gateway URL and no raw provider row. `contextCarriesNoSecrets`
// asserts it structurally rather than by review, because this object is assembled
// from several upstream shapes and a future field added upstream would otherwise
// flow through silently.
//
// Pure. No provider, model, network or database access.

import {
  adaptiveCapabilityCards, approvedCapabilityKeys, type AdaptiveCapabilityCard,
} from "./leadCapabilityCards.ts";
import {
  ROLE_TAXONOMY_OUTPUT_SCHEMA, REVENUE_OPERATIONS_EVIDENCE,
  type RoleFamily, type RoleTaxonomy,
} from "./leadRoleTaxonomy.ts";
import { QUERY_PACK_OUTPUT_SCHEMA, type QueryPack } from "./leadQueryPacks.ts";
import {
  ADAPTIVE_STRATEGY_OUTPUT_SCHEMA, MAX_RECENCY_DAYS,
  type AdaptiveCompanyConstraints, type MissionTruth,
} from "./leadSourceStrategy.ts";

export const ADAPTIVE_CONTEXT_VERSION = "lead-adaptive-context-1.0.0";

export interface AdaptivePlanningContext {
  /** The user's words, unmodified. Interpretation is the model's job, not ours. */
  original_user_query: string;
  workflow: string;
  execution_mode: string;
  final_entity: string;
  requested_count: number;

  /** The role being HIRED FOR. Never conflated with the person to contact. */
  hiring_role_seed: string;
  /** The person to contact. Never used as a job-search title. */
  decision_maker_roles: string[];

  company_constraints: AdaptiveCompanyConstraints;
  recency_policy: { preferred_age_days: number; maximum_age_days: number };
  current_employer_required: boolean;
  hard_exclusions: string[];

  /** Bounded-execution facts, so the plan is proposed against real allowances. */
  remaining_budget_usd: number;
  remaining_provider_calls: number;

  capability_cards: AdaptiveCapabilityCard[];
  completed_sources: string[];
  completed_query_packs: string[];
  attempted_input_signatures: string[];

  /** The exact JSON shape the response is held to. */
  response_schema: Record<string, unknown>;
  /** Named rules, so a violation can be reported against a rule rather than a vibe. */
  prohibitions: string[];
}

export const ADAPTIVE_PLANNER_PROHIBITIONS: readonly string[] = [
  "Never return a provider or Actor identifier. Use capability keys only.",
  "Never return provider JSON, request bodies or unsupported provider fields.",
  "Never modify the company constraints, the geography or the employee range.",
  "Never modify the requested count or the final entity.",
  "Never exceed the maximum posting age.",
  "Never use a decision-maker role as a hiring-role search title.",
  "Never place unrelated Operations roles (warehouse, retail, clinical, people, logistics) in a pack.",
  "Never mark an evidence-gated or secondary-signal family as initially eligible.",
];

export interface BuildContextInput {
  originalUserQuery: string;
  truth: MissionTruth;
  preferredAgeDays?: number;
  currentEmployerRequired?: boolean;
  hardExclusions?: readonly string[];
  remainingBudgetUsd: number;
  remainingProviderCalls: number;
  completedSources?: readonly string[];
  completedQueryPacks?: readonly string[];
  attemptedInputSignatures?: readonly string[];
  /** Injectable so tests need no runtime actor state. */
  cards?: readonly AdaptiveCapabilityCard[];
}

export function buildAdaptivePlanningContext(input: BuildContextInput): AdaptivePlanningContext {
  const cards = [...(input.cards ?? adaptiveCapabilityCards())];
  const maxAge = Math.min(input.truth.maximum_age_days, MAX_RECENCY_DAYS);
  return {
    original_user_query: input.originalUserQuery,
    workflow: "qualified_lead_sourcing",
    execution_mode: "company_first",
    final_entity: input.truth.final_entity,
    requested_count: input.truth.requested_count,
    hiring_role_seed: input.truth.hiring_role_seed,
    decision_maker_roles: [...input.truth.decision_maker_roles],
    company_constraints: input.truth.company_constraints,
    recency_policy: {
      preferred_age_days: Math.min(input.preferredAgeDays ?? 30, maxAge),
      maximum_age_days: maxAge,
    },
    current_employer_required: input.currentEmployerRequired ?? true,
    hard_exclusions: [...(input.hardExclusions ?? [])],
    remaining_budget_usd: input.remainingBudgetUsd,
    remaining_provider_calls: input.remainingProviderCalls,
    capability_cards: cards,
    completed_sources: [...(input.completedSources ?? [])],
    completed_query_packs: [...(input.completedQueryPacks ?? [])],
    attempted_input_signatures: [...(input.attemptedInputSignatures ?? [])],
    response_schema: {
      ...ADAPTIVE_STRATEGY_OUTPUT_SCHEMA,
      properties: {
        ...(ADAPTIVE_STRATEGY_OUTPUT_SCHEMA.properties as Record<string, unknown>),
        role_taxonomy: ROLE_TAXONOMY_OUTPUT_SCHEMA,
        query_packs: QUERY_PACK_OUTPUT_SCHEMA,
      },
    },
    prohibitions: [...ADAPTIVE_PLANNER_PROHIBITIONS],
  };
}

/**
 * Structural assertion that no credential or provider identifier is present.
 *
 * Checks both keys and values: a secret smuggled as a value under an innocuous key
 * is the case a key-name check alone would miss.
 */
export function contextCarriesNoSecrets(ctx: AdaptivePlanningContext): boolean {
  const blob = JSON.stringify(ctx).toLowerCase();
  const banned = [
    "api_key", "apikey", "api-key", "secret", "token", "password", "bearer",
    "authorization", "service_role", "anon_key", "apify", "actor_id", "actorid",
    "provideradapterkey", "sk-", "supabase_url", "gateway_url",
  ];
  return !banned.some((b) => blob.includes(b));
}

// ------------------------------------------------- deterministic fallback ----

/**
 * The canonical deterministic taxonomy for a revenue-operations hiring seed.
 *
 * This is the plan that runs when Claude is disabled, unavailable or rejected. It
 * is intentionally narrower than a good Claude plan — exact families only, with
 * the adjacent tiers present but deferred — because a fallback should be
 * predictable and cheap, not ambitious.
 */
export function deterministicRevenueOpsTaxonomy(): RoleTaxonomy {
  const family = (
    id: string, fn: string, tier: RoleFamily["confidence_tier"], titles: string[],
    opts: Partial<RoleFamily> = {},
  ): RoleFamily => ({
    family_id: id, canonical_function: fn, confidence_tier: tier, titles,
    aliases: [], abbreviations: [], seniority_levels: ["vp", "head", "director", "manager", "lead", "analyst"],
    positive_description_evidence: [], negative_patterns: [],
    evidence_required: false, initially_eligible: tier === "exact",
    broadening_level: tier === "exact" ? 1 : tier === "direct_adjacent" ? 2 : 3,
    maximum_attempts: 1, recommended_capabilities: [],
    ...opts,
  });

  return {
    families: [
      family("sales_operations", "Sales Operations", "exact", [
        "VP of Sales Operations", "Head of Sales Operations", "Director of Sales Operations",
        "Senior Director of Sales Operations", "Sales Operations Manager",
        "Senior Sales Operations Manager", "Sales Operations Lead",
        "Sales Operations Analyst", "Sales Operations Specialist",
      ]),
      family("revenue_operations", "Revenue Operations", "exact", [
        "VP of Revenue Operations", "Head of Revenue Operations", "Director of Revenue Operations",
        "Revenue Operations Manager", "Revenue Operations Lead", "Revenue Operations Analyst",
        "RevOps Manager", "RevOps Lead",
      ]),
      family("gtm_operations", "GTM Operations", "exact", [
        "VP of GTM Operations", "Head of GTM Operations", "Director of GTM Operations",
        "GTM Operations Manager", "Go-to-Market Operations Manager",
      ]),
      family("revenue_systems", "Revenue and Sales Systems", "direct_adjacent", [
        "Director of Revenue Systems", "Revenue Systems Manager", "Sales Systems Manager",
        "CRM Operations Manager", "Salesforce Operations Manager", "Revenue Technology Manager",
      ]),
      family("sales_planning", "Sales Planning and Strategy Operations", "direct_adjacent", [
        "Sales Planning and Operations Manager", "Sales Strategy and Operations Manager",
        "Director of Sales Planning",
      ]),
      family("commercial_operations", "Commercial Operations and Deal Desk", "evidence_gated_adjacent", [
        "Commercial Operations Manager", "Director of Commercial Operations",
        "Deal Desk Manager", "Deal Desk Analyst",
      ], {
        evidence_required: true,
        positive_description_evidence: [...REVENUE_OPERATIONS_EVIDENCE].slice(0, 10),
      }),
      family("commercial_leadership", "Commercial Leadership Signals", "secondary_signal", [
        "Chief Revenue Officer", "VP of Revenue", "Head of Revenue", "Chief Commercial Officer",
      ], { evidence_required: true }),
    ],
    negative_patterns: [],
  };
}

/** The canonical deterministic packs matching the taxonomy above. */
export function deterministicRevenueOpsPacks(): QueryPack[] {
  const pack = (
    id: string, label: string, families: string[], tier: QueryPack["confidence_tier"],
    titles: string[], priority: number, opts: Partial<QueryPack> = {},
  ): QueryPack => ({
    pack_id: id, label, functional_family_ids: families, confidence_tier: tier,
    titles, aliases: [], negative_patterns: [], description_evidence: [],
    recommended_capabilities: [], priority,
    broadening_level: tier === "exact" ? 1 : tier === "direct_adjacent" ? 2 : 3,
    initially_eligible: tier === "exact", maximum_attempts: 1,
    expected_precision: tier === "exact" ? "high" : "medium",
    expected_coverage: "medium",
    ...opts,
  });

  return [
    pack("sales_ops_leadership", "Sales Operations leadership", ["sales_operations"], "exact", [
      "VP of Sales Operations", "Head of Sales Operations", "Director of Sales Operations",
      "Senior Director of Sales Operations",
    ], 1),
    pack("revenue_ops_leadership", "Revenue Operations leadership", ["revenue_operations"], "exact", [
      "VP of Revenue Operations", "Head of Revenue Operations", "Director of Revenue Operations",
    ], 2),
    pack("direct_ops_ic", "Sales and Revenue Operations individual contributors", ["sales_operations", "revenue_operations"], "exact", [
      "Sales Operations Manager", "Sales Operations Analyst", "Revenue Operations Manager",
      "Revenue Operations Analyst", "RevOps Manager",
    ], 3),
    pack("gtm_and_systems", "GTM Operations and Revenue Systems", ["gtm_operations", "revenue_systems"], "direct_adjacent", [
      "GTM Operations Manager", "Director of GTM Operations", "Revenue Systems Manager",
      "CRM Operations Manager",
    ], 4),
    pack("sales_planning_systems", "Sales Planning and Sales Systems", ["sales_planning", "revenue_systems"], "direct_adjacent", [
      "Sales Planning and Operations Manager", "Sales Strategy and Operations Manager",
      "Sales Systems Manager",
    ], 5),
    pack("commercial_ops_gated", "Commercial Operations and Deal Desk", ["commercial_operations"], "evidence_gated_adjacent", [
      "Commercial Operations Manager", "Deal Desk Manager", "Deal Desk Analyst",
    ], 6, { description_evidence: [...REVENUE_OPERATIONS_EVIDENCE].slice(0, 10) }),
    pack("commercial_leadership_signal", "Commercial leadership signals", ["commercial_leadership"], "secondary_signal", [
      "Chief Revenue Officer", "VP of Revenue", "Chief Commercial Officer",
    ], 7),
  ];
}

/** Capability keys the validator will accept. Re-exported for callers. */
export { approvedCapabilityKeys };
