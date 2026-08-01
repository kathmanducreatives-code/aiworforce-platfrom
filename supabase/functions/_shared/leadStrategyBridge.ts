// THE INITIAL-PLANNING BRIDGE FOR THE QUALIFIED-LEAD STRATEGY OWNER.
//
// This is NOT a second planner. It holds no prompt, no schema, no model gateway
// and no fallback of its own: every decision is delegated to `runLeadStrategy`
// in `leadStrategyOwner.ts`, the single authority for this workflow. All this
// module does is:
//
//   1. answer whether the GPT strategy owner may own INITIAL planning for this
//      workspace (flag + explicit allow-list, exactly like the Claude bridge),
//   2. translate the compiled job-search spec into the owner's mission shape,
//   3. translate the owner's validated plan back into `keyword_queries`, and
//   4. produce the safe, persistable provenance block.
//
// Authority order on the gated path is the owner's own:
//     gpt-5.6-luna → gpt-5.6-terra (at most once) → deterministic fallback.
//
// Gemini and Claude are unreachable from here. Unrelated workflows never call
// this module, so their routing is untouched.

// This gate is deliberately SELF-CONTAINED rather than another entry in the
// intelligence-kernel flag registry: that registry is the Gemini/Claude kernel's
// own surface, and adding a GPT-owner flag to it would widen a module this path
// must stay independent of. Same semantics — strict allow-list, default OFF.
import type { EnablementDecision } from "./intelligence/leads/leadPlanningBridge.ts";
import type { LeadStrategyResolution } from "./leadStrategyOwner.ts";
import { createQualifiedLeadStrategist } from "./leadStrategy/strategist.ts";
import type { LeadStrategyMission, LeadStrategyRoundContext } from "./leadStrategyContract.ts";
import type { LeadStrategyModelFn } from "./leadStrategyModels.ts";
import type { QualifiedLeadStrategistProvider } from "./leadStrategy/provider.ts";
import type { StrategistCompanyConstraints } from "./leadStrategistContext.ts";

export type EnvReader = (key: string) => string | undefined;

export const GPT_LEAD_STRATEGY_FLAG = "GPT_LEAD_STRATEGY";
export const GPT_LEAD_STRATEGY_WORKSPACES_ENV = "GPT_LEAD_STRATEGY_WORKSPACES";

function parseAllowlist(raw: string | undefined): string[] {
  return String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** STRICT truthiness — only these exact values enable a flag. */
function flagOn(raw: string | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/**
 * May the GPT strategy owner own INITIAL planning for this workspace?
 *
 * Both the flag AND an explicit allow-list are required, and the allow-list has
 * no wildcard — there is no single switch that enables this globally.
 */
export function isGptLeadStrategyEnabled(
  workspaceId: string,
  read?: EnvReader,
): EnablementDecision {
  const get: EnvReader = read ?? ((k) => {
    try {
      return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
        .Deno?.env.get(k);
    } catch {
      return undefined;
    }
  });

  if (!flagOn(get(GPT_LEAD_STRATEGY_FLAG))) {
    return { enabled: false, reason: "flag_off" };
  }
  const allow = parseAllowlist(get(GPT_LEAD_STRATEGY_WORKSPACES_ENV));
  if (allow.length === 0) return { enabled: false, reason: "no_workspace_allowlist" };
  if (!allow.includes(String(workspaceId))) {
    return { enabled: false, reason: "workspace_not_allowed" };
  }
  return { enabled: true, reason: "enabled" };
}

/** The slice of the compiled spec this bridge is allowed to rewrite. */
export interface LeadStrategySpecSlice {
  keyword_queries: string[];
  requested_person_roles: string[];
  location: string | null;
  country: string | null;
  original_query: string;
  [k: string]: unknown;
}

export interface LeadStrategyInitialInput {
  workspaceId: string;
  spec: LeadStrategySpecSlice;
  requestedLeadCount: number;
  companyVertical?: string | null;
  maturityStages?: string[];
  remainingBudgetUsd?: number;
  /**
   * Company Brain + saved ICP, in the strategist's own shape.
   *
   * WITHOUT THIS THE MODEL IS PLANNING BLIND. `missionFromSpec` hard-coded
   * `company_size: null` and sent no industries, stages or business model, so the
   * strategist was asked to choose sources and titles for a workspace whose ICP it
   * had never been told. Optional so every existing caller stays valid.
   */
  companyConstraints?: StrategistCompanyConstraints | null;
  /** Injected in tests. Production uses the configured adapter. */
  callModel?: LeadStrategyModelFn;
  provider?: QualifiedLeadStrategistProvider;
  readEnv?: EnvReader;
  timeoutMs?: number;
}

export interface LeadStrategyInitialResult {
  spec: LeadStrategySpecSlice;
  specRewritten: boolean;
  enablement: EnablementDecision;
  /** NULL only when the workspace was never eligible — no work was performed. */
  resolution: LeadStrategyResolution | null;
  /** Safe provenance for `tasks.result`. NULL when the feature never engaged. */
  diagnostics: Record<string, unknown> | null;
}

/** Stable, dependency-free 32-bit hash. Used only for plan identity. */
export function planHash(value: unknown): string {
  const s = JSON.stringify(value ?? null);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function missionFromSpec(input: LeadStrategyInitialInput): LeadStrategyMission {
  // The Brain's employee band is real mission truth. It was previously dropped.
  const band = input.companyConstraints?.employee_count ?? null;
  return {
    original_query: String(input.spec.original_query ?? ""),
    requested_lead_count: input.requestedLeadCount,
    requested_titles: [...(input.spec.keyword_queries ?? [])],
    decision_maker_roles: [...(input.spec.requested_person_roles ?? [])],
    geography: input.spec.location ?? input.spec.country ?? null,
    company_vertical: input.companyVertical ?? null,
    company_size: band,
    maturity_stages: input.maturityStages?.length
      ? [...input.maturityStages]
      : [...(input.companyConstraints?.company_stages ?? [])],
  };
}

function initialContext(input: LeadStrategyInitialInput): LeadStrategyRoundContext {
  return {
    round: 1,
    bottleneck: null,
    last_funnel: null,
    attempted_query_packs: [],
    attempted_sources: [],
    remaining_quota: input.requestedLeadCount,
    remaining_budget_usd: input.remainingBudgetUsd ?? 0,
    adjacent_titles_allowed: false,
  };
}

/**
 * Resolve the AUTHORITATIVE initial strategy for the gated qualified-lead path.
 *
 * When the workspace is not eligible the caller's own spec object is returned by
 * reference and no work at all is performed — no mission built, no model called.
 */
export async function applyLeadStrategyInitialPlanning(
  input: LeadStrategyInitialInput,
): Promise<LeadStrategyInitialResult> {
  const enablement = isGptLeadStrategyEnabled(input.workspaceId, input.readEnv);
  if (!enablement.enabled) {
    return {
      spec: input.spec, specRewritten: false, enablement,
      resolution: null, diagnostics: null,
    };
  }

  const mission = missionFromSpec(input);
  // The runtime talks to the FACADE, never to an adapter. Which provider serves
  // this call is configuration (LEAD_STRATEGIST_PROVIDER), not code.
  const strategist = createQualifiedLeadStrategist({
    provider: input.provider,
    callModel: input.callModel,
    timeoutMs: input.timeoutMs,
  });
  const resolution = await strategist.createInitialStrategy({
    mission,
    context: initialContext(input),
    workspaceId: input.workspaceId,
  });

  const p = resolution.provenance;
  const plan = resolution.plan;
  const authoritative = p.source !== "deterministic_fallback";

  const diagnostics: Record<string, unknown> = {
    planner_source: authoritative ? "openai_lead_strategy" : "deterministic_registry",
    gpt_lead_strategy_enabled: true,
    enablement_reason: enablement.reason,
    authority: p.source,
    strategy_status: p.status,
    validation: authoritative ? "approved" : "rejected",
    fallback_reason: p.failure_reason,
    model: p.model,
    provider: p.provider ?? null,
    escalated: p.escalated,
    model_requests: p.model_requests,
    latency_ms: p.latency_ms,
    role_family_ids: [plan.role_family],
    query_pack_ids: plan.query_packs.map((q) => q.pack_id),
    source_order: plan.source_plan
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((s) => s.source_key),
    next_action: plan.next_action,
    dropped: resolution.dropped,
    observability: resolution.observability,
    plan_hash: planHash({
      role_family: plan.role_family,
      titles: plan.title_queries,
      packs: plan.query_packs.map((q) => ({ id: q.pack_id, q: q.queries })),
      sources: plan.source_plan.map((s) => [s.source_key, s.priority]),
      next_action: plan.next_action,
    }),
  };

  // Only the role keywords may change, and only from a validated strategy.
  // The deterministic fallback already IS today's behavior, so rewriting with it
  // would be a no-op at best and a silent divergence at worst.
  const titles = plan.title_queries.filter((t) => String(t ?? "").trim().length > 0);
  if (!authoritative || titles.length === 0) {
    return { spec: input.spec, specRewritten: false, enablement, resolution, diagnostics };
  }

  return {
    spec: { ...input.spec, keyword_queries: titles },
    specRewritten: true,
    enablement,
    resolution,
    diagnostics,
  };
}
