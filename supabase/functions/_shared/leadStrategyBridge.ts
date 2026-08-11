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
// ONE DEFINITION OF "ENABLED", NOT TWO. Only the VALUE SET is imported — a
// frozen constant, not the kernel's flag registry — so the independence the
// comment above asks for is kept while the semantics it claims become true.
import { INTELLIGENCE_FLAG_ENABLED_VALUES } from "./intelligence/intelligenceFlags.ts";
import type { EnablementDecision } from "./intelligence/leads/leadPlanningBridge.ts";
import type { LeadStrategyResolution } from "./leadStrategyOwner.ts";
import { createQualifiedLeadStrategist } from "./leadStrategy/strategist.ts";
import type { LeadStrategyMission, LeadStrategyRoundContext } from "./leadStrategyContract.ts";
import type { LeadMissionV1 } from "./leadMission.ts";
import type { LeadStrategyModelFn } from "./leadStrategyModels.ts";
import type { QualifiedLeadStrategistProvider } from "./leadStrategy/provider.ts";
import type { StrategistCompanyConstraints } from "./leadStrategistContext.ts";

export type EnvReader = (key: string) => string | undefined;

export const GPT_LEAD_STRATEGY_FLAG = "GPT_LEAD_STRATEGY";
export const GPT_LEAD_STRATEGY_WORKSPACES_ENV = "GPT_LEAD_STRATEGY_WORKSPACES";

function parseAllowlist(raw: string | undefined): string[] {
  return String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * STRICT truthiness — only these exact values enable a flag.
 *
 * ── NORMALIZED, AND WHY IT IS SAFE ──────────────────────────────────────────
 *
 * This used to accept `yes` and `on` as well, while the intelligence-kernel
 * registry accepted only `true` / `1` / `enabled`. The comment at the head of
 * this file already claimed "Same semantics — strict allow-list"; it simply was
 * not true, and two definitions of "enabled" in one system is the kind of drift
 * that makes a flag audit unreliable.
 *
 * Verified before changing, rather than assumed: on TEST, `GPT_LEAD_STRATEGY` —
 * the only flag this function gates — is NOT SET AT ALL, so no current value can
 * change meaning. The values that ARE configured (`CLAUDE_FIRST_LEAD_PLANNING`,
 * `GPT_LEAD_MISSION_COMPILER`) are both the literal string `true`, which both the
 * old and new sets accept.
 *
 * BEFORE THIS REACHES PRODUCTION: confirm `GPT_LEAD_STRATEGY` there is unset or
 * `true`/`1`/`enabled`. A `yes` or `on` would now resolve to disabled — which
 * fails SAFE (the deterministic ladder owns titles, no model call) but is still a
 * change, and should be a decision rather than a surprise.
 */
function flagOn(raw: string | undefined): boolean {
  if (typeof raw !== "string") return false;
  return INTELLIGENCE_FLAG_ENABLED_VALUES.has(raw.trim().toLowerCase());
}

/**
 * May the GPT strategy owner own INITIAL planning for this workspace?
 *
 * Both the flag AND an explicit allow-list are required, and the allow-list has
 * no wildcard — there is no single switch that enables this globally.
 *
 * ── WHAT THIS FLAG NOW MEANS ────────────────────────────────────────────────
 *
 * It selects WHICH ADAPTER BACKS THE ONE PLANNER. It does not decide whether a
 * competing planning subsystem exists.
 *
 * Before: this flag and `CLAUDE_FIRST_LEAD_PLANNING` each switched on an
 * independent stack, and run-agent invoked the Claude stack whenever the GPT
 * stack had not rewritten the spec. Both flags on meant both stacks could make
 * model calls for one task, and whichever ran last won.
 *
 * Now: `selectLeadPlannerAdapter` (leadPlannerInterface.ts) reads this decision
 * together with the Claude one and resolves BOTH to exactly one owner before any
 * adapter is invoked. With both flags on, GPT owns the gated path and Claude is
 * recorded in `notSelected` — recorded, never run. A flag combination can no
 * longer produce two plans, which is asserted by enumeration in
 * `tests/edge-functions/_shared/leadOwnershipInvariants.test.ts`.
 *
 * This function is unchanged and remains the single definition of GPT
 * eligibility; only what the runtime does with the answer changed.
 *
 * NOTE, NOT CHANGED HERE: `flagOn` below accepts "yes"/"on" as well as
 * "true"/"1", while the intelligence-kernel registry accepts only
 * "true"/"1"/"enabled". Narrowing this would silently disable any workspace
 * currently enabled with "yes", so it is deliberately left for a later,
 * separately-verified change.
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
  /**
   * THE CANONICAL MISSION, when one was compiled for this request.
   *
   * R2: the semantic constraints below (`no_broadening_requested`,
   * `required_signal_terms`) used to be read off `input.spec` — i.e. off
   * jobSearchSpec's regex reading of the raw sentence, computed a second time,
   * downstream of the compiler that had already answered the same question.
   * When a Mission is present it is the authority and the spec is not consulted
   * for them.
   *
   * Optional because the deterministic-workspace path has no Mission to supply.
   * That is a migration state governed by orchestrate's intelligence-mode gate,
   * not a semantic fallback for a compiled request: a workspace in
   * `new_architecture` mode never reaches here without one, because orchestrate
   * returns 422 `mission_not_compiled` first.
   */
  mission?: LeadMissionV1 | null;
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

/**
 * Rebuild this adapter's result from an ALREADY-PLANNED artifact. No model call.
 *
 * The mirror of `claudeFirstFromPersistedPlan`. It exists because initial
 * planning consolidated onto one call site in orchestrate: run-agent no longer
 * invokes this adapter, it reconstitutes what the adapter decided from the plan
 * artifact that travelled with — or was loaded for — the task.
 *
 * `model_requests: 0` is the field that distinguishes "reused the persisted
 * plan" from "planned again", and it is what the resume tests assert on.
 */
export function gptStrategyFromPersistedPlan(
  artifact: {
    plan_source: string;
    approved_titles: string[];
    fallback_reason: string | null;
    planner: Record<string, unknown> | null;
    strategy_plan?: unknown;
    source_order?: string[];
    route?: string | null;
  },
  spec: Record<string, unknown>,
): LeadStrategyInitialResult {
  const usedGpt = artifact.plan_source === "gpt_validated";
  const p = (artifact.planner ?? {}) as Record<string, unknown>;

  return {
    spec: (usedGpt
      ? { ...spec, keyword_queries: [...artifact.approved_titles] }
      : spec) as unknown as LeadStrategySpecSlice,
    specRewritten: usedGpt,
    enablement: { enabled: true, reason: "enabled" },
    // Only the PLAN is reconstituted. Provenance stays on `diagnostics`; nothing
    // downstream reads the resolution's own provenance block.
    resolution: usedGpt && artifact.strategy_plan
      ? ({ plan: artifact.strategy_plan, provenance: p, dropped: [] } as unknown as LeadStrategyResolution)
      : null,
    diagnostics: artifact.planner
      ? {
        ...p,
        planner_source: usedGpt ? "openai_lead_strategy" : "deterministic_registry",
        // The routing decisions the executor reads, carried on the artifact
        // because the adapter that produced them ran in another Edge Function.
        source_order: artifact.source_order ?? [],
        route: artifact.route ?? null,
        fallback_reason: artifact.fallback_reason,
        model_requests: 0,
        reused_persisted_plan: true,
      }
      : null,
  };
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
    // ── ONE READING OF THE SENTENCE, NOT TWO ────────────────────────────────
    //
    // The Mission wins whenever there is one. Both fields were computed by the
    // GPT compiler from the raw query and carried on `LeadMissionV1` as of R1;
    // reading them off `input.spec` here meant jobSearchSpec's regex answered
    // the same question a second time, downstream of the authority.
    //
    // `?? undefined` and not `?? spec`: when a Mission is present and says
    // nothing, that IS the answer. Falling through to the regex reading for a
    // field the compiler left empty would reintroduce the second opinion this
    // removes. The spec is consulted only when no Mission exists at all — the
    // deterministic-workspace path, which orchestrate gates separately.
    no_broadening_requested: input.mission
      ? input.mission.no_broadening_requested
      : input.spec.no_broadening_requested as boolean | undefined,
    required_signal_terms: input.mission
      ? input.mission.required_signal_terms
      : input.spec.required_signal_terms as string[] | undefined,
  };
}

/** Where each semantic constraint on the strategy mission came from. Diagnostics only. */
export function missionConstraintSource(
  input: Pick<LeadStrategyInitialInput, "mission">,
): "lead_mission_v1" | "job_search_spec_regex" {
  return input.mission ? "lead_mission_v1" : "job_search_spec_regex";
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
