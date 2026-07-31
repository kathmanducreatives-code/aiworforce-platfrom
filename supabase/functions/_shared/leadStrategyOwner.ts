// THE STRATEGY OWNER — the single authority for qualified-lead sourcing strategy.
//
// One model family (OpenAI GPT-5.6 through Lovable's built-in AI gateway),
// one contract, one validator, one fallback:
//
//     Luna (primary) → Terra (escalation, at most once) → deterministic plan
//
// Gemini and Claude are NOT reachable from this path. Pilot chat, orchestration
// planning, Scribe and Penn keep their existing routing — this owner is gated
// strictly to workflow = qualified_lead_sourcing AND execution_mode = company_first.

import type { BroadeningPlannerFn, PlannerInput, PlannerProposal } from "./broadeningPlan.ts";
import type { PlannerMetadata } from "./broadeningPlannerAdapter.ts";
import {
  callLeadStrategyModel, modelForTier, LEAD_STRATEGY_PRIMARY_MODEL,
  LEAD_STRATEGY_ESCALATION_MODEL, LEAD_STRATEGY_TIMEOUT_MS,
  type LeadStrategyModelFn,
} from "./leadStrategyModels.ts";
import {
  LEAD_STRATEGY_EXECUTION_MODE, LEAD_STRATEGY_PROMPT_VERSION, LEAD_STRATEGY_SCHEMA_VERSION,
  LEAD_STRATEGY_SYSTEM_PROMPT, LEAD_STRATEGY_WORKFLOW, buildLeadStrategyUserMessage,
  type LeadStrategyMission, type LeadStrategyPlan, type LeadStrategyProvenance,
  type LeadStrategyRoundContext,
} from "./leadStrategyContract.ts";
import {
  deterministicLeadStrategy, resolveMissionFamily, validateLeadStrategy,
} from "./leadStrategyValidator.ts";
import { REVENUE_OPS_FAMILY, type QueryPackId, type RoleFamilyDef } from "./leadRoleTaxonomy.ts";

// ------------------------------------------------------------------ gate ----

export interface LeadStrategyGateInput {
  workflow?: string | null;
  executionMode?: string | null;
}

/**
 * The ONLY place that decides whether the OpenAI strategy owner runs.
 * Anything other than qualified_lead_sourcing + company_first keeps its existing
 * planner untouched.
 */
export function leadStrategyOwnerApplies(input: LeadStrategyGateInput): boolean {
  return (input.workflow ?? "").trim().toLowerCase() === LEAD_STRATEGY_WORKFLOW
    && (input.executionMode ?? "").trim().toLowerCase() === LEAD_STRATEGY_EXECUTION_MODE;
}

// ------------------------------------------------------------- resolution ---

export interface LeadStrategyResolution {
  plan: LeadStrategyPlan;
  provenance: LeadStrategyProvenance;
  dropped: string[];
}

export interface RunLeadStrategyOpts {
  mission: LeadStrategyMission;
  context: LeadStrategyRoundContext;
  /** Injected in tests; defaults to the real gateway call. */
  callModel?: LeadStrategyModelFn;
  /** FALSE keeps the run fully deterministic and makes zero model requests. */
  enabled?: boolean;
  timeoutMs?: number;
  workspaceId?: string;
  /** Escalate to Terra when Luna fails or its plan is rejected. Default true. */
  allowEscalation?: boolean;
}

function provenance(round: number): LeadStrategyProvenance {
  return {
    schema_version: LEAD_STRATEGY_SCHEMA_VERSION,
    prompt_version: LEAD_STRATEGY_PROMPT_VERSION,
    round,
    model: null,
    escalated: false,
    source: "deterministic_fallback",
    status: "deterministic_only",
    failure_reason: null,
    latency_ms: 0,
    model_requests: 0,
    title_count: 0,
    pack_ids: [],
  };
}

/**
 * Resolve the strategy for one round. NEVER throws: every failure path resolves
 * to the deterministic plan, because a strategist that can take down the runtime
 * is worse than no strategist at all.
 */
export async function runLeadStrategy(opts: RunLeadStrategyOpts): Promise<LeadStrategyResolution> {
  const { mission, context } = opts;
  const fam: RoleFamilyDef = resolveMissionFamily(mission) ?? REVENUE_OPS_FAMILY;
  const prov = provenance(context.round);
  const fallback = () => ({
    plan: deterministicLeadStrategy(mission, context, fam),
    provenance: { ...prov },
    dropped: [] as string[],
  });

  if (opts.enabled === false) {
    prov.failure_reason = "disabled";
    return fallback();
  }

  const call = opts.callModel ?? callLeadStrategyModel;
  const userMessage = buildLeadStrategyUserMessage(mission, context, fam);
  const tiers: Array<"primary" | "escalation"> = opts.allowEscalation === false
    ? ["primary"]
    : ["primary", "escalation"];

  let lastReason = "no_attempt";
  for (const tier of tiers) {
    const model = modelForTier(tier);
    let result;
    try {
      result = await call({
        model,
        systemPrompt: LEAD_STRATEGY_SYSTEM_PROMPT,
        userMessage,
        timeoutMs: opts.timeoutMs ?? LEAD_STRATEGY_TIMEOUT_MS,
      });
    } catch (e) {
      lastReason = `call_threw:${String((e as Error)?.message ?? e).slice(0, 80)}`;
      prov.model_requests += 1;
      prov.model = model;
      continue;
    }
    prov.model_requests += 1;
    prov.model = model;
    prov.latency_ms += result.latencyMs ?? 0;
    prov.usage = result.usage ?? prov.usage;
    if (tier === "escalation") prov.escalated = true;

    if (!result.ok) {
      lastReason = result.errorCode ?? result.error ?? "model_call_failed";
      continue;
    }

    const validated = validateLeadStrategy(result.json, mission, context, fam);
    if (!validated.ok) {
      lastReason = `rejected:${validated.problem}`;
      continue;
    }

    prov.source = tier === "escalation" ? "openai_escalation" : "openai_primary";
    prov.status = tier === "escalation" ? "openai_escalation_approved" : "openai_primary_approved";
    prov.failure_reason = null;
    prov.title_count = validated.plan.title_queries.length;
    prov.pack_ids = validated.plan.query_packs.map((p) => p.pack_id);
    return { plan: validated.plan, provenance: prov, dropped: validated.dropped };
  }

  prov.status = "openai_fallback_used";
  prov.failure_reason = lastReason;
  const det = deterministicLeadStrategy(mission, context, fam);
  prov.title_count = det.title_queries.length;
  prov.pack_ids = det.query_packs.map((p) => p.pack_id);
  return { plan: det, provenance: prov, dropped: [] };
}

// ------------------------------------------------- broadening adapter -------
//
// Drop-in replacement for `createBroadeningPlanner` on the gated path. The
// sequential runtime keeps its existing `BroadeningPlannerFn` seam; only the
// brain behind it changes.

export interface LeadStrategyPlannerOpts {
  workspaceId?: string;
  agentSlug?: string;
  mission?: Partial<LeadStrategyMission>;
  callModel?: LeadStrategyModelFn;
  enabled?: boolean;
  allowEscalation?: boolean;
  timeoutMs?: number;
}

function missionFromPlannerInput(
  input: PlannerInput,
  overrides: Partial<LeadStrategyMission> | undefined,
): LeadStrategyMission {
  return {
    original_query: overrides?.original_query ?? input.intent_summary.requested_titles.join(", "),
    requested_lead_count: overrides?.requested_lead_count ?? input.quota.requested,
    requested_titles: overrides?.requested_titles ?? input.intent_summary.requested_titles,
    decision_maker_roles: overrides?.decision_maker_roles ?? input.intent_summary.requested_person_roles,
    geography: overrides?.geography ?? input.intent_summary.geography,
    company_vertical: overrides?.company_vertical ?? input.intent_summary.company_vertical,
    company_size: overrides?.company_size ?? null,
    maturity_stages: overrides?.maturity_stages ?? [],
  };
}

function contextFromPlannerInput(input: PlannerInput, round: number): LeadStrategyRoundContext {
  const f = input.last_round as unknown as Record<string, number> | null;
  return {
    round,
    bottleneck: input.bottleneck,
    last_funnel: f
      ? {
        raw_results: Number(f.rawResults ?? f.raw_results ?? 0),
        normalized_jobs: Number(f.normalizedJobs ?? f.normalized_jobs ?? 0),
        unique_companies: Number(f.uniqueCompanies ?? f.unique_companies ?? 0),
        company_brain_pass: Number(f.companyBrainPass ?? f.company_brain_pass ?? 0),
        company_brain_fail: Number(f.companyBrainFail ?? f.company_brain_fail ?? 0),
        evidence_pending: Number(f.evidencePending ?? f.evidence_pending ?? 0),
        contact_ready: Number(f.contactReady ?? f.contact_ready ?? 0),
      }
      : null,
    attempted_query_packs: [],
    attempted_sources: [],
    remaining_quota: input.quota.remaining,
    remaining_budget_usd: input.remaining_budget,
    adjacent_titles_allowed: input.approved_capabilities.adjacent_titles_allowed,
  };
}

/** Provenance → the PlannerMetadata shape the quota controller already records. */
export function plannerMetadataFrom(p: LeadStrategyProvenance): PlannerMetadata {
  const approved = p.source !== "deterministic_fallback";
  return {
    provider: "lovable-ai",
    model: p.model ?? "",
    prompt_version: p.prompt_version,
    schema_version: p.schema_version,
    request_id: `ls_${p.round}_${p.model_requests}`,
    latency_ms: p.latency_ms,
    status: approved ? "ai_approved" : "ai_rejected_fallback_used",
    failure_reason: p.failure_reason,
    proposed_title_count: p.title_count,
    rationale: null,
  };
}

export function createLeadStrategyPlanner(opts: LeadStrategyPlannerOpts = {}): {
  plan: BroadeningPlannerFn;
  lastMetadata: () => PlannerMetadata | null;
  lastResolution: () => LeadStrategyResolution | null;
} {
  let lastMeta: PlannerMetadata | null = null;
  let lastRes: LeadStrategyResolution | null = null;
  let round = 1;

  const plan: BroadeningPlannerFn = async (input: PlannerInput): Promise<PlannerProposal | null> => {
    round += 1;
    const resolution = await runLeadStrategy({
      mission: missionFromPlannerInput(input, opts.mission),
      context: contextFromPlannerInput(input, round),
      callModel: opts.callModel,
      enabled: opts.enabled,
      allowEscalation: opts.allowEscalation,
      timeoutMs: opts.timeoutMs,
      workspaceId: opts.workspaceId,
    });
    lastRes = resolution;
    lastMeta = plannerMetadataFrom(resolution.provenance);
    console.log("[lead-strategy]", {
      workspace: opts.workspaceId ?? null,
      round,
      source: resolution.provenance.source,
      model: resolution.provenance.model,
      escalated: resolution.provenance.escalated,
      packs: resolution.provenance.pack_ids,
      titles: resolution.provenance.title_count,
      failure: resolution.provenance.failure_reason,
    });
    // Deterministic fallback proposes nothing — the existing deterministic
    // broadening ladder then runs exactly as it does today.
    if (resolution.provenance.source === "deterministic_fallback") return null;
    return {
      title_queries: resolution.plan.title_queries,
      goal: `openai strategy: ${resolution.plan.query_packs.map((p) => p.pack_id).join("+")}`,
      rationale: resolution.plan.rationale,
      risk: "low",
    };
  };

  return { plan, lastMetadata: () => lastMeta, lastResolution: () => lastRes };
}

export const LEAD_STRATEGY_MODELS = {
  primary: LEAD_STRATEGY_PRIMARY_MODEL,
  escalation: LEAD_STRATEGY_ESCALATION_MODEL,
} as const;

export type { QueryPackId };
