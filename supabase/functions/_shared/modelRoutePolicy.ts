// HYBRID MODEL ROUTING — ONE RESOLVER, OFF BY DEFAULT.
//
// Agentory has two model seams and no third one is added here:
//   * aiProvider.generateText   — prose / planning tasks (TASK_MODELS, Haiku 4.5)
//   * gptModelRouter            — the lead / signal pipeline stages (Luna, repair rung)
// Both ask THIS module "does a workforce task have a configured model?" and
// otherwise behave exactly as before. Nothing routes anywhere new unless every
// gate below holds:
//
//   AGENTORY_HYBRID_ROUTING_ENABLED=true          master switch (unset = today's routing)
//   AGENTORY_ROUTE_<TASK>=<model>[:<effort>]       per task, independently, e.g.
//                                                  AGENTORY_ROUTE_COMPLEX_COMPANY_QA=gpt-6.1-terra:low
//                                                  AGENTORY_ROUTE_VALIDATION_REPAIR=gpt-6.1-terra
//   AGENTORY_VERIFIED_MODELS=gpt-6.1-terra,…       models confirmed callable by THIS account
//                                                  (models already in production use are implicit)
//   AGENTORY_ROUTE_FALLBACK=declared|none          on a failed routed call: retry once on the
//                                                  task's declared model (default) or fail loudly
//   AGENTORY_ROUTE_MAX_CALLS_PER_RUN=8             per-request cap on routed calls (aiProvider)
//   AGENTORY_ROUTE_MAX_USD_PER_CALL=0.05           worst-case cost admission per routed call (aiProvider)
//   AGENTORY_ROUTE_WORKSPACES=<uuid>,…              PILOT SCOPE: only these workspaces route; a
//                                                  call with no workspace (pipeline stages) is
//                                                  refused while the list is set
//
// A model must also be on the allow-list below and PRICED in modelCostModel —
// an unpriced model would escape the spend ceiling. ROLLBACK: unset
// AGENTORY_HYBRID_ROUTING_ENABLED (and the legacy AGENTORY_TERRA_ENABLED); every
// route returns to its declared model on the next request.
//
// The legacy Terra-only variables (terraPolicy.ts) still work as a shorthand.
//
// PURE except reading the environment through an injectable reader.

import { isModelPriced } from "./modelCostModel.ts";
import { minimumReasoningEffort } from "./modelRequestBody.ts";
import { terraRouteFor, WORKFORCE_TASKS, type EnvReader, type WorkforceTask } from "./terraPolicy.ts";

export const MODEL_ROUTE_POLICY_VERSION = "model-route-policy-v1" as const;
export type RouteEffort = "none" | "low" | "medium" | "high";

export interface RoutableModel {
  vendor: "openai" | "anthropic";
  /** Efforts this model accepts; empty = takes no effort parameter. */
  efforts: readonly RouteEffort[];
  /** Already called in production (no account verification needed). */
  in_production: boolean;
}

/**
 * THE ALLOW-LIST. A model not here is refused, whatever the environment says.
 * Efforts per OpenAI's model pages (2026-11-11): GPT-6.1 Terra / GPT-6 Luna accept
 * `none`; GPT-6.1 Sol does not. Anthropic models are limited to the one the
 * transport is built and priced for; Haiku 5.5 is benchmark-only until its
 * request shape (adaptive thinking, default effort medium) is wired and tested.
 */
export const ROUTABLE_MODELS: Readonly<Record<string, RoutableModel>> = Object.freeze({
  "gpt-6.1-terra": { vendor: "openai", efforts: ["none", "low", "medium", "high"], in_production: false },
  "gpt-6-luna": { vendor: "openai", efforts: ["none", "low", "medium", "high"], in_production: false },
  "gpt-6.1-sol": { vendor: "openai", efforts: ["low", "medium", "high"], in_production: false },
  "gpt-5.6-luna": { vendor: "openai", efforts: ["none", "low", "medium", "high"], in_production: true },
  "gpt-5.6-terra": { vendor: "openai", efforts: ["none", "low", "medium", "high"], in_production: true },
  "gpt-4.1-mini": { vendor: "openai", efforts: [], in_production: true },
  "claude-haiku-4-5-20251001": { vendor: "anthropic", efforts: [], in_production: true },
});

export type TaskRoute =
  | { use: true; task: WorkforceTask; model: string; vendor: "openai" | "anthropic"; effort: RouteEffort | null;
      source: "hybrid" | "terra_legacy"; fallback: "declared" | "none" }
  | { use: false; task: WorkforceTask | null; reason:
      | "no_task" | "disabled" | "no_route" | "unsupported_model" | "unsupported_effort"
      | "unpriced" | "not_verified" | "task_not_enabled" | "invalid_task" | "workspace_not_enabled" };

const denoEnv: EnvReader = (k) => {
  try { return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k); } catch { return undefined; }
};
const EFFORTS: readonly RouteEffort[] = ["none", "low", "medium", "high"];

export const routeEnvKey = (task: WorkforceTask) => `AGENTORY_ROUTE_${task.toUpperCase()}`;

/** `model[:effort]` → parts, or null for an empty value. */
export function parseRouteValue(v: string | undefined): { model: string; effort: RouteEffort | null; effortRaw: string | null } | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  const [model, effort] = raw.split(":").map((x) => x.trim());
  const e = (effort ?? "").toLowerCase();
  return { model, effort: (EFFORTS as readonly string[]).includes(e) ? e as RouteEffort : null, effortRaw: effort ? e : null };
}

function verified(model: string, read: EnvReader): boolean {
  if (ROUTABLE_MODELS[model]?.in_production) return true;
  const list = String(read("AGENTORY_VERIFIED_MODELS") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (list.includes(model)) return true;
  // The legacy Terra verification flag covers the Terra id only.
  return /^gpt-6[a-z0-9.-]*terra/i.test(model) && String(read("AGENTORY_TERRA_MODEL_VERIFIED") ?? "").trim() === "true";
}

/** The effort a model will actually receive: the requested one, or its floor (GPT-6.1 Sol rejects `none`). */
export function effectiveEffort(model: string, requested: RouteEffort | null): RouteEffort | null {
  const spec = ROUTABLE_MODELS[model];
  if (!spec || spec.efforts.length === 0) return null;
  if (requested == null) return null; // the caller's own default applies
  const floor = minimumReasoningEffort(model) as RouteEffort | null;
  return requested === "none" && floor ? floor : requested;
}

/** Which model should this workforce task use right now? Every refusal names its reason. */
export function resolveTaskRoute(task: WorkforceTask | string | null | undefined, read: EnvReader = denoEnv,
  now: Date = new Date(), ctx: { workspaceId?: string | null } = {}): TaskRoute {
  if (!task) return { use: false, task: null, reason: "no_task" };
  if (!(WORKFORCE_TASKS as readonly string[]).includes(task)) return { use: false, task: null, reason: "invalid_task" };
  const t = task as WorkforceTask;
  // PILOT SCOPE. With a workspace list set, nothing outside it routes — and a
  // call that cannot say which workspace it serves does not route at all.
  const scope = String(read("AGENTORY_ROUTE_WORKSPACES") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (scope.length && (!ctx.workspaceId || !scope.includes(String(ctx.workspaceId).toLowerCase()))) {
    return { use: false, task: t, reason: "workspace_not_enabled" };
  }
  const fallback = String(read("AGENTORY_ROUTE_FALLBACK") ?? "").trim() === "none" ? "none" as const : "declared" as const;

  const hybridOn = String(read("AGENTORY_HYBRID_ROUTING_ENABLED") ?? "").trim() === "true";
  const value = hybridOn ? parseRouteValue(read(routeEnvKey(t))) : null;
  if (value) {
    const spec = ROUTABLE_MODELS[value.model];
    if (!spec) return { use: false, task: t, reason: "unsupported_model" };
    if (value.effortRaw && (!value.effort || !spec.efforts.includes(value.effort))) return { use: false, task: t, reason: "unsupported_effort" };
    if (!isModelPriced(value.model, now)) return { use: false, task: t, reason: "unpriced" };
    if (!verified(value.model, read)) return { use: false, task: t, reason: "not_verified" };
    return { use: true, task: t, model: value.model, vendor: spec.vendor, effort: effectiveEffort(value.model, value.effort),
      source: "hybrid", fallback };
  }

  // Legacy Terra-only shorthand (AGENTORY_TERRA_*), priced by the static table.
  const legacy = terraRouteFor(t, read, (id) => isModelPriced(id, now));
  if (legacy.use) {
    const effort = (String(read("AGENTORY_TERRA_EFFORT") ?? "").trim().toLowerCase() || null) as RouteEffort | null;
    return { use: true, task: t, model: legacy.model, vendor: "openai",
      effort: effectiveEffort(legacy.model, effort && EFFORTS.includes(effort) ? effort : null) ?? null,
      source: "terra_legacy", fallback };
  }
  if (!hybridOn && legacy.reason === "disabled") return { use: false, task: t, reason: "disabled" };
  return { use: false, task: t, reason: hybridOn ? "no_route" : legacy.reason };
}

/** Every task's current resolution — for a preflight card, the dashboard, or a rollback check. */
export function routingSnapshot(read: EnvReader = denoEnv, now: Date = new Date()): Record<WorkforceTask, TaskRoute> {
  return Object.fromEntries(WORKFORCE_TASKS.map((t) => [t, resolveTaskRoute(t, read, now)])) as Record<WorkforceTask, TaskRoute>;
}

/** Tasks that reason by default when routed without an explicit effort. Everything else runs at `none`. */
export const REASONING_TASKS: ReadonlySet<WorkforceTask> = new Set<WorkforceTask>([
  "orion_reasoning", "executive_planning", "multi_agent_planning", "complex_company_qa",
  "strategic_prioritization", "evidence_interpretation", "validation_repair", "atlas_planning", "lyra_strategy",
]);

export const DEFAULT_MAX_USD_PER_CALL = 0.05;
/** The per-call worst-case admission cap for routed calls (AGENTORY_ROUTE_MAX_USD_PER_CALL). */
export function maxUsdPerCall(read: EnvReader = denoEnv): number {
  const raw = String(read("AGENTORY_ROUTE_MAX_USD_PER_CALL") ?? "").trim();
  const v = raw === "" ? NaN : Number(raw);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_USD_PER_CALL;
}

/**
 * The effort a routed call uses when its route names none: `low` for reasoning
 * tasks, `none` for routine ones (no reasoning tokens bought for extraction or
 * small talk), raised to the model's floor. Null for models with no effort field.
 */
export function defaultEffortFor(task: WorkforceTask, model: string): RouteEffort | null {
  const spec = ROUTABLE_MODELS[model];
  if (!spec || spec.efforts.length === 0) return null;
  return effectiveEffort(model, REASONING_TASKS.has(task) ? "low" : "none");
}
