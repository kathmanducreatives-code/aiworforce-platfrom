// THE ONE CANONICAL STRATEGIST CONTEXT.
//
// ── WHAT THIS FIXES ──────────────────────────────────────────────────────────
// Three defects, all provable by reading the code this replaces:
//
//   1. THE ENVELOPE WAS THIN. `missionFromSpec` sent the query, titles,
//      decision-maker roles, geography, vertical and stages — and hard-coded
//      `company_size: null`. The Company Brain's employee band, its positive and
//      excluded industries, the saved ICP, the recency policy, the Actor
//      capability cards and their limitations, the completed/unused packs and
//      sources, the source-quality history and the allowed next actions were all
//      computed elsewhere and never sent. The model was asked to plan sourcing
//      without being told what the workspace actually buys.
//
//   2. THE TWO PURPOSES DIVERGED. `leadStrategyFeedbackOwner` declares
//      `LEAD_FEEDBACK_POLICY_VERSION`; `leadStrategyOwner` declares no policy
//      version at all. Initial planning and feedback were two prompt systems
//      that happened to share a provider.
//
//   3. THE HASH DID NOT DESCRIBE THE PAYLOAD. `planHash` hashes whatever it is
//      handed. Nothing guaranteed that value was the thing actually sent, so a
//      recorded `prompt_hash` could describe a different object than the model saw.
//
// This module builds ONE sanitized context for BOTH purposes, hashes exactly that
// object, and returns both together so they cannot drift apart.
//
// SANITIZATION IS A CONTRACT, NOT A HABIT. `assertNoSecrets` is exported so tests
// assert it rather than reviewers remembering to.
//
// Pure. No provider, model, network or database access.

import type { LeadStrategyFunnel, LeadStrategyMission, LeadStrategyRoundContext } from "./leadStrategyContract.ts";

/** ONE policy version for both purposes. Bump when the contract changes. */
export const STRATEGIST_POLICY_VERSION = "lead-strategist-policy-1.1.0";
export const STRATEGIST_CONTEXT_VERSION = "lead-strategist-context-1.0.0";

/** The two decisions the strategist owns. Purpose selects the output schema. */
export type StrategistPurpose = "initial_strategy" | "source_feedback";

/** Company Brain + saved ICP, in the shape the strategist is told to respect. */
export interface StrategistCompanyConstraints {
  business_model: string | null;
  positive_industries: string[];
  excluded_industries: string[];
  excluded_company_types: string[];
  employee_count: { min: number | null; max: number | null } | null;
  company_stages: string[];
  country: string | null;
  /** True when the Brain is enforced for this workspace. */
  enforced: boolean;
}

/** What an Actor can and cannot express. Semantic only — never an Actor id. */
export interface StrategistCapabilityCard {
  capability_key: string;
  purpose: string;
  supports_recency: boolean;
  supports_company_size: boolean;
  supports_company_stage: boolean;
  startup_relevance: "low" | "medium" | "high";
  precision: "low" | "medium" | "high";
  recall: "low" | "medium" | "high";
  maximum_results_per_call: number;
  /** Constraints this source CANNOT apply, so the model does not assume it can. */
  limitations: string[];
}

/** What a completed source actually produced. Measured, never estimated. */
export interface StrategistSourceObservation {
  capability_key: string;
  query_pack_id: string | null;
  provider_rows: number;
  title_matches: number;
  title_rejections: number;
  companies_resolved: number;
  companies_qualified: number;
  duplicate_rate: number;
}

export interface StrategistContext {
  context_version: string;
  policy_version: string;
  purpose: StrategistPurpose;

  /** The user's words, unmodified. Interpretation is the model's job. */
  original_user_request: string;
  mission: LeadStrategyMission;
  company_constraints: StrategistCompanyConstraints;
  recency: { preferred_age_days: number; maximum_age_days: number };

  hiring_role_families: string[];
  decision_maker_roles: string[];

  capability_cards: StrategistCapabilityCard[];

  completed_query_packs: string[];
  unused_query_packs: string[];
  completed_sources: string[];
  unused_sources: string[];
  source_observations: StrategistSourceObservation[];

  quota: { requested: number; contact_ready: number; remaining: number };
  budget: { remaining_usd: number; remaining_actions: number };

  /** The ONLY actions the model may return. The menu is the boundary. */
  allowed_next_actions: string[];

  /** The exact structured shape the response is held to. */
  response_schema: Record<string, unknown>;

  /** Named rules, so a violation is reported against a rule. */
  prohibitions: string[];
}

export const STRATEGIST_PROHIBITIONS: readonly string[] = [
  "Never return a provider or Actor identifier. Use capability keys only.",
  "Never return provider JSON or unsupported provider fields.",
  "Never modify the company constraints, the geography or the employee range.",
  "Never modify the requested lead count.",
  "Never exceed the maximum posting age.",
  "Never use a decision-maker role as a hiring-role search title.",
  "Never merge separate query packs into one combined query.",
];

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function strList(v: unknown, max = 24): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    const s = str(raw);
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

export interface BuildStrategistContextInput {
  purpose: StrategistPurpose;
  originalUserRequest: string;
  mission: LeadStrategyMission;
  companyConstraints: StrategistCompanyConstraints;
  recency?: { preferred_age_days?: number; maximum_age_days?: number };
  hiringRoleFamilies?: readonly string[];
  capabilityCards?: readonly StrategistCapabilityCard[];
  round?: LeadStrategyRoundContext | null;
  completedQueryPacks?: readonly string[];
  unusedQueryPacks?: readonly string[];
  completedSources?: readonly string[];
  unusedSources?: readonly string[];
  sourceObservations?: readonly StrategistSourceObservation[];
  contactReady?: number;
  remainingActions?: number;
  allowedNextActions?: readonly string[];
  responseSchema: Record<string, unknown>;
}

/** The mission's own recency ceiling. A strategist may tighten, never exceed. */
export const STRATEGIST_MAX_RECENCY_DAYS = 60;

/**
 * Build the canonical context.
 *
 * Both purposes call THIS function. The only difference between an initial call
 * and a feedback call is `purpose`, the observation history, and the response
 * schema — not a separate prompt system.
 */
export function buildStrategistContext(input: BuildStrategistContextInput): StrategistContext {
  const maxAge = Math.min(
    num(input.recency?.maximum_age_days) || STRATEGIST_MAX_RECENCY_DAYS,
    STRATEGIST_MAX_RECENCY_DAYS,
  );
  const requested = num(input.mission.requested_lead_count);
  const contactReady = num(input.contactReady);

  return {
    context_version: STRATEGIST_CONTEXT_VERSION,
    policy_version: STRATEGIST_POLICY_VERSION,
    purpose: input.purpose,

    original_user_request: str(input.originalUserRequest),
    mission: input.mission,
    company_constraints: input.companyConstraints,
    recency: {
      preferred_age_days: Math.min(num(input.recency?.preferred_age_days) || 30, maxAge),
      maximum_age_days: maxAge,
    },

    hiring_role_families: strList(input.hiringRoleFamilies),
    decision_maker_roles: [...(input.mission.decision_maker_roles ?? [])],

    capability_cards: [...(input.capabilityCards ?? [])],

    completed_query_packs: strList(input.completedQueryPacks ?? input.round?.attempted_query_packs),
    unused_query_packs: strList(input.unusedQueryPacks),
    completed_sources: strList(input.completedSources ?? input.round?.attempted_sources),
    unused_sources: strList(input.unusedSources),
    source_observations: [...(input.sourceObservations ?? [])],

    quota: {
      requested,
      contact_ready: contactReady,
      remaining: Math.max(0, requested - contactReady),
    },
    budget: {
      remaining_usd: num(input.round?.remaining_budget_usd),
      remaining_actions: num(input.remainingActions),
    },

    allowed_next_actions: strList(input.allowedNextActions, 16),
    response_schema: input.responseSchema,
    prohibitions: [...STRATEGIST_PROHIBITIONS],
  };
}

// ------------------------------------------------------------------ hashing ----

/**
 * Canonical JSON: object keys sorted at every depth.
 *
 * Without this, two structurally identical contexts hash differently purely
 * because a builder happened to assign fields in another order — which makes a
 * recorded `prompt_hash` useless for telling "same request" from "different
 * request".
 */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) out[k] = walk(o[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/** Stable, dependency-free 32-bit hash over the canonical form. */
export function hashPayload(value: unknown): string {
  const s = canonicalJson(value);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface SealedStrategistPayload {
  /** The EXACT object to send. Nothing may be added after sealing. */
  payload: StrategistContext;
  /** A hash OF THAT OBJECT — not of a summary or a different value. */
  prompt_hash: string;
  policy_version: string;
  context_version: string;
  purpose: StrategistPurpose;
}

/**
 * Seal a context: hash exactly what will be sent, and return them together.
 *
 * Returning the payload and its hash from ONE call is the whole point. The
 * previous shape let a caller hash one value and send another; here the recorded
 * hash cannot describe anything except the object handed back.
 */
export function sealStrategistPayload(context: StrategistContext): SealedStrategistPayload {
  return {
    payload: context,
    prompt_hash: hashPayload(context),
    policy_version: context.policy_version,
    context_version: context.context_version,
    purpose: context.purpose,
  };
}

/** Does a sealed hash still describe its payload? Used to prove no drift. */
export function sealMatchesPayload(sealed: SealedStrategistPayload): boolean {
  return hashPayload(sealed.payload) === sealed.prompt_hash;
}

// ------------------------------------------------------------ sanitization ----

const BANNED_SUBSTRINGS = [
  "api_key", "apikey", "api-key", "secret", "password", "bearer ", "authorization",
  "service_role", "anon_key", "sk-", "openai_api_key", "anthropic_api_key",
  "supabase_url", "gateway_url", "actor_id", "apify",
];

/**
 * Assert a context carries no credential and no provider identifier.
 *
 * Checks keys AND values: a credential smuggled as a value under an innocuous key
 * is exactly what a key-name check misses.
 */
export function assertNoSecrets(value: unknown): boolean {
  const blob = canonicalJson(value).toLowerCase();
  return !BANNED_SUBSTRINGS.some((b) => blob.includes(b));
}

// --------------------------------------------------------- observability ----

export interface StrategistObservability {
  purpose: StrategistPurpose;
  provider: string | null;
  model: string | null;
  model_tier: string | null;
  policy_version: string;
  context_version: string;
  schema_version: string | null;
  /** The hash OF THE SENT PAYLOAD. */
  prompt_hash: string;
  /** The sanitized structured input. Never a prompt string. */
  sanitized_input: Record<string, unknown>;
  /** The canonical structured output, when one parsed. */
  canonical_output: Record<string, unknown> | null;
  validation_errors: string[];
  repairs: string[];
  escalated: boolean;
  fallback_reason: string | null;
  selected_action: string | null;
  latency_ms: number | null;
  usage: Record<string, unknown> | null;
}

export interface BuildObservabilityInput {
  sealed: SealedStrategistPayload;
  provider?: string | null;
  model?: string | null;
  modelTier?: string | null;
  schemaVersion?: string | null;
  canonicalOutput?: Record<string, unknown> | null;
  validationErrors?: readonly string[];
  repairs?: readonly string[];
  escalated?: boolean;
  fallbackReason?: string | null;
  selectedAction?: string | null;
  latencyMs?: number | null;
  usage?: Record<string, unknown> | null;
}

/**
 * Build the safe lineage record.
 *
 * `sanitized_input` is a PROJECTION of the sealed payload — the mission shape,
 * the constraint summary and the counts — never the payload verbatim and never a
 * rendered prompt. The hash is what ties this record back to the exact request.
 */
export function buildStrategistObservability(
  input: BuildObservabilityInput,
): StrategistObservability {
  const p = input.sealed.payload;
  const sanitized: Record<string, unknown> = {
    purpose: p.purpose,
    requested_lead_count: p.quota.requested,
    remaining_quota: p.quota.remaining,
    hiring_role_families: p.hiring_role_families,
    decision_maker_roles: p.decision_maker_roles,
    company_constraints: {
      business_model: p.company_constraints.business_model,
      positive_industries: p.company_constraints.positive_industries,
      excluded_industries: p.company_constraints.excluded_industries,
      employee_count: p.company_constraints.employee_count,
      company_stages: p.company_constraints.company_stages,
      country: p.company_constraints.country,
      enforced: p.company_constraints.enforced,
    },
    recency: p.recency,
    capability_keys: p.capability_cards.map((c) => c.capability_key),
    completed_query_packs: p.completed_query_packs,
    unused_query_packs: p.unused_query_packs,
    completed_sources: p.completed_sources,
    unused_sources: p.unused_sources,
    allowed_next_actions: p.allowed_next_actions,
    budget: p.budget,
  };

  return {
    purpose: p.purpose,
    provider: input.provider ?? null,
    model: input.model ?? null,
    model_tier: input.modelTier ?? null,
    policy_version: p.policy_version,
    context_version: p.context_version,
    schema_version: input.schemaVersion ?? null,
    prompt_hash: input.sealed.prompt_hash,
    sanitized_input: sanitized,
    canonical_output: input.canonicalOutput ?? null,
    validation_errors: [...(input.validationErrors ?? [])],
    repairs: [...(input.repairs ?? [])],
    escalated: input.escalated === true,
    fallback_reason: input.fallbackReason ?? null,
    selected_action: input.selectedAction ?? null,
    latency_ms: input.latencyMs ?? null,
    usage: input.usage ?? null,
  };
}

/** Convenience for the Brain slice most callers already hold. */
export function constraintsFromBrain(
  brain: {
    positive_industries?: string[] | null;
    negative_industries?: string[] | null;
    excluded_company_types?: string[] | null;
    min_employees?: number | null;
    max_employees?: number | null;
    allowed_stages?: string[] | null;
    business_models?: string[] | null;
  } | null | undefined,
  extra: { country?: string | null; vertical?: string | null } = {},
): StrategistCompanyConstraints {
  const min = brain?.min_employees ?? null;
  const max = brain?.max_employees ?? null;
  return {
    business_model: (brain?.business_models ?? [])[0] ?? extra.vertical ?? null,
    positive_industries: strList(brain?.positive_industries),
    excluded_industries: strList(brain?.negative_industries),
    excluded_company_types: strList(brain?.excluded_company_types),
    employee_count: min == null && max == null ? null : { min, max },
    company_stages: strList(brain?.allowed_stages),
    country: extra.country ?? null,
    enforced: !!brain,
  };
}

export type { LeadStrategyFunnel, LeadStrategyMission, LeadStrategyRoundContext };
