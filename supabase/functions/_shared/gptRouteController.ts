// LEAD V2 P4 — GPT READS A WAVE AND PROPOSES WHAT THE ROUTES DO NEXT.
//
// GPT owns the strategy question ("is this route worth another page, should a
// second READY route join, should discovery stop?"). It owns nothing else: the
// proposal it returns is data for `validateRouteControl`, which checks the
// trigger against the wave's own numbers, the actor's readiness and the budget
// before any plan version changes. A failed or unparseable call proposes
// nothing, and discovery continues exactly as planned.

import { gptStructured, type GptDeps } from "./gptProvider.ts";
import { routeModel, type ModelRoute } from "./gptModelRouter.ts";
import type { LeadMissionV1 } from "./leadMission.ts";
import type { RetrievalPlan } from "./retrievalPlan.ts";
import type { ResearchWaveSummary, RouteControlProposal } from "./researchFeedback.ts";

export const ROUTE_CONTROL_SCHEMA = {
  name: "research_route_control",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["action", "route_id", "trigger", "actor_key", "input_json", "rationale"],
    properties: {
      action: { type: "string", enum: ["continue", "stop_route", "stop_discovery", "add_route", "change_query", "deepen"] },
      route_id: { type: ["string", "null"], description: "The plan route this acts on. Null for continue, stop_discovery and add_route." },
      trigger: {
        type: ["string", "null"],
        enum: ["route_low_yield", "route_exhausted", "insufficient_candidates", "provider_failed", null],
        description: "The measured reason. Null only for continue.",
      },
      actor_key: { type: ["string", "null"], description: "add_route only: a READY actor from ready_actors." },
      input_json: { type: ["string", "null"], description: "add_route/change_query only: the actor-native input as a JSON object string." },
      rationale: { type: "string", description: "One or two sentences citing the wave's numbers." },
    },
  },
} as const;

export const ROUTE_CONTROL_SYSTEM = [
  "You control the retrieval routes of a B2B lead research mission after one discovery wave.",
  "You receive the wave summary: per route rows, new companies, companies merged into ones another route already found, identity coverage, deterministic hard-constraint pass/fail, evidence gaps, settled cost and budget left, plus the admitted pool against its target.",
  "Choose ONE action:",
  "- continue: the routes are doing their job. This is the right answer most of the time.",
  "- stop_route: a route is low-yield or exhausted (cite route_low_yield or route_exhausted); other routes keep running.",
  "- stop_discovery: every active route is low-yield or exhausted.",
  "- add_route: the admitted pool is below target (insufficient_candidates) or routes are exhausted, and a READY actor from ready_actors would find DIFFERENT companies. Give actor_key and input_json.",
  "- change_query: a route's query is low-yield; give its route_id and a better actor-native input_json.",
  "- deepen: the admitted pool is below target and a route is still producing new companies; its next page.",
  "Never propose an actor outside ready_actors. Never propose spending more than cost.remaining_usd. Mission criteria are fixed: a route may not relax a hard constraint.",
  "Code validates your proposal against these same numbers and refuses anything they do not support.",
].join("\n");

export function parseRouteControlProposal(v: unknown): RouteControlProposal | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r.action !== "string") return null;
  const rationale = typeof r.rationale === "string" ? r.rationale.slice(0, 600) : "";
  const trigger = typeof r.trigger === "string" ? r.trigger : null;
  let input: Record<string, unknown> = {};
  if (typeof r.input_json === "string" && r.input_json.trim()) {
    try {
      const parsed = JSON.parse(r.input_json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed;
    } catch { /* an unreadable input proposes nothing to run */ }
  }
  const route_id = typeof r.route_id === "string" ? r.route_id : "";
  switch (r.action) {
    case "continue": return { action: "continue", rationale };
    case "stop_route": return { action: "stop_route", route_id, trigger: trigger as never, rationale };
    case "stop_discovery": return { action: "stop_discovery", trigger: trigger as never, rationale };
    case "add_route":
      return { action: "add_route", capability: "", actor_key: typeof r.actor_key === "string" ? r.actor_key : "", input, trigger: trigger as never, rationale };
    case "change_query": return { action: "change_query", route_id, input, trigger: trigger as never, rationale };
    case "deepen": return { action: "deepen", route_id, trigger: trigger as never, rationale };
    default: return null;
  }
}

/** The payload GPT sees: the wave, the routes as planned, what may be added. Nothing else. */
export function routeControlPayload(i: {
  summary: ResearchWaveSummary; mission: LeadMissionV1; plan: RetrievalPlan; capability: string; ready_actors: string[];
}): Record<string, unknown> {
  return {
    request: i.mission.original_user_query,
    requested_count: i.mission.requested_count ?? null,
    discovery_capability: i.capability,
    ready_actors: i.ready_actors,
    plan_version: i.plan.version,
    routes: i.plan.routes.map((r) => ({
      route_id: r.route_id, actor_key: r.provider, capability: r.capability,
      input: r.proposed_input, refused: r.refused,
    })),
    wave: i.summary,
  };
}

export function makeGptRouteController(deps: GptDeps = {}, ctx: { onRoute?: (r: ModelRoute) => void } = {}) {
  return async (i: {
    summary: ResearchWaveSummary; mission: LeadMissionV1; plan: RetrievalPlan; capability: string; ready_actors: string[];
  }): Promise<RouteControlProposal | null> => {
    const route = routeModel("research_route_control");
    ctx.onRoute?.(route);
    const r = await gptStructured<Record<string, unknown>>({
      purpose: route.stage,
      system: ROUTE_CONTROL_SYSTEM,
      user: JSON.stringify(routeControlPayload(i)),
      schema: ROUTE_CONTROL_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
      maxTokens: 700,
      model: route.model,
      reasoningEffort: route.reasoning_effort,
      tier: route.tier,
      routing_reason: route.reason,
    }, deps);
    if (!r.ok) {
      (deps.log ?? (() => {}))("gpt_route_control_failed", { code: r.code, detail: r.detail });
      return null;
    }
    const p = parseRouteControlProposal(r.value);
    if (p?.action === "add_route") p.capability = i.capability;
    return p;
  };
}
