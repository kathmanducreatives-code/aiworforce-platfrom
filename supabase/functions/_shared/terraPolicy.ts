// GPT-6.1 TERRA — FEATURE-FLAGGED, VERIFIED-BEFORE-USE, PRICED-BEFORE-USE.
//
// The Workforce V2 plan asks for `gpt-6.1-terra` on ORION's complex reasoning
// and planning, with ATLAS / LISA / LYRA tasks to be benchmarked before any
// switch. This repository's own record (gptModelRouter.ts, read from OpenAI's
// model pages on 2026-10-28) states "OpenAI offers no GPT-6 Terra". So the id
// is treated as UNVERIFIED: nothing routes to it until an operator confirms the
// model exists for this account AND supplies its price. Every condition below
// must hold, or the task keeps its current model:
//
//   AGENTORY_TERRA_ENABLED=true              the master switch
//   AGENTORY_TERRA_MODEL_VERIFIED=true       an operator ran the availability
//                                            check (scripts/model-bench --check-model)
//   AGENTORY_TERRA_PRICE_USD_PER_1M="in,cached_in,out"
//                                            the published price — an UNPRICED
//                                            model would count $0 against the spend
//                                            ceiling and escape budget enforcement
//   AGENTORY_TERRA_TASKS=orion_reasoning,…   which tasks opt in (none by default)
//   AGENTORY_TERRA_MODEL_ID (optional)       override the id if OpenAI names it
//                                            differently (e.g. a dated snapshot)
//
// PURE except reading the environment through an injectable reader.

export const TERRA_DEFAULT_MODEL = "gpt-6.1-terra" as const;

/** Tasks Terra may be enabled for. Permission decisions and ranking are never model tasks. */
export const WORKFORCE_TASKS = [
  "orion_reasoning",      // ORION's executive answers and brief wording
  "executive_planning",   // ORION plans
  "multi_agent_planning", // orchestrate's multi-step plan
  "complex_company_qa",   // evidence-grounded company Q&A
  "atlas_qualification",  // ATLAS company qualification / evaluation (benchmark first)
  "lyra_content",         // LYRA drafts (benchmark first)
  "lisa_interpretation",  // LISA signal relevance (benchmark first)
] as const;
export type WorkforceTask = typeof WORKFORCE_TASKS[number];

export type EnvReader = (k: string) => string | undefined;
const denoEnv: EnvReader = (k) => {
  try { return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k); } catch { return undefined; }
};

export interface TerraPrice { input_per_1m: number; cached_input_per_1m: number; output_per_1m: number }

export function terraPrice(read: EnvReader = denoEnv): TerraPrice | null {
  const parts = String(read("AGENTORY_TERRA_PRICE_USD_PER_1M") ?? "").split(",").map((x) => Number(x.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0) || parts[2] <= 0) return null;
  return { input_per_1m: parts[0], cached_input_per_1m: parts[1], output_per_1m: parts[2] };
}

export function terraModelId(read: EnvReader = denoEnv): string {
  const v = String(read("AGENTORY_TERRA_MODEL_ID") ?? "").trim();
  return /^gpt-6[a-z0-9.-]*terra[a-z0-9.-]*$/i.test(v) ? v : TERRA_DEFAULT_MODEL;
}

export type TerraRoute =
  | { use: true; model: string; reason: string }
  | { use: false; reason: "disabled" | "not_verified" | "unpriced" | "task_not_enabled" | "no_task" };

/** Should this task run on Terra right now? Every refusal names its reason. */
export function terraRouteFor(task: WorkforceTask | null | undefined, read: EnvReader = denoEnv): TerraRoute {
  if (!task) return { use: false, reason: "no_task" };
  if (String(read("AGENTORY_TERRA_ENABLED") ?? "").trim() !== "true") return { use: false, reason: "disabled" };
  if (String(read("AGENTORY_TERRA_MODEL_VERIFIED") ?? "").trim() !== "true") return { use: false, reason: "not_verified" };
  if (!terraPrice(read)) return { use: false, reason: "unpriced" };
  const enabled = String(read("AGENTORY_TERRA_TASKS") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!enabled.includes(task)) return { use: false, reason: "task_not_enabled" };
  return { use: true, model: terraModelId(read), reason: `${task} opted into Terra (AGENTORY_TERRA_TASKS)` };
}

/** The runtime price for a model id the static table does not know (Terra only). */
export function runtimeModelPrice(modelId: string, read: EnvReader = denoEnv): TerraPrice | null {
  return modelId === terraModelId(read) ? terraPrice(read) : null;
}

/**
 * PER-RUN CALL LIMIT FOR TERRA. A request makes one limiter and passes it to
 * every call it makes; past the cap, calls run on the task's ordinary model.
 * `AGENTORY_TERRA_MAX_CALLS_PER_RUN` (default 8). A Terra call without a
 * limiter is not made: an unbounded loop must not be able to buy a premium model.
 */
export const TERRA_DEFAULT_MAX_CALLS_PER_RUN = 8;
export interface TerraRunLimiter { take(): boolean; used(): number; max: number }
export function createTerraRunLimiter(read: EnvReader = denoEnv): TerraRunLimiter {
  const raw = String(read("AGENTORY_TERRA_MAX_CALLS_PER_RUN") ?? "").trim();
  const v = raw === "" ? NaN : Number(raw);
  const max = Number.isFinite(v) && v >= 0 ? Math.floor(v) : TERRA_DEFAULT_MAX_CALLS_PER_RUN;
  let n = 0;
  return { max, used: () => n, take: () => (n < max ? (n++, true) : false) };
}
