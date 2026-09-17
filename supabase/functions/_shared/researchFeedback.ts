// LEAD V2 P4 — WHAT A WAVE OF RETRIEVAL PRODUCED, AND THE ONLY WAY TO ACT ON IT.
//
// After each discovery wave the engine summarizes, per route: rows, companies
// it introduced, companies it merely re-found (merged), identity coverage,
// hard-constraint pass, evidence gaps, settled cost and the budget left. The
// summary is the route controller's whole view (GPT's, in production).
//
// The controller PROPOSES. Code decides. A proposal becomes a plan change only
// through `validateRouteControl`:
//   - it names a trigger, and the summary must support that trigger
//     (route_low_yield needs a low-yield route; insufficient_candidates needs
//     the admitted pool below target);
//   - adding, changing or deepening a route is semantic: never on a worker
//     continuation, only for a READY actor (actorIntelligence), and only with
//     budget room for the route's estimate;
//   - stopping a route only reduces spend: allowed on a continuation, and it
//     leaves every other route exactly as it was.
// An accepted stop produces a new RetrievalPlan version whose route carries
// `refused`, which the ProviderCallSpec compiler already enforces. An accepted
// add/change/deepen is handed back to the engine's existing amendment path
// (`amendRetrievalPlan`), which versions and validates it again.
//
// Pure.

import type { SpendLedger } from "./budgetPolicy.ts";
import { spendTotals } from "./budgetPolicy.ts";
import {
  planContentHash, type AmendmentTrigger, type PlanChange, type RetrievalPlan,
} from "./retrievalPlan.ts";
import type { EvidenceDimension } from "./candidateObservation.ts";
import type { FoundBy } from "./entityResolution.ts";

export const RESEARCH_FEEDBACK_VERSION = "research-feedback-v1" as const;

/** Below this share of rows introducing a new company a route is low-yield. */
export const LOW_YIELD_NEW_RATIO = 0.1;
/** A route needs at least this many rows before "low yield" means anything. */
export const LOW_YIELD_MIN_ROWS = 10;

export interface FeedbackCompany {
  key: string;
  found_by: readonly FoundBy[];
  has_linkedin_url: boolean;
  has_domain: boolean;
  /** Deterministic hard-constraint result: true pass, false fail, null not yet judged. */
  hard_pass: boolean | null;
  gaps: readonly EvidenceDimension[];
}

export interface RouteYield {
  route_id: string | null;
  capability: string;
  actor_key: string;
  status: "active" | "stopped" | "refused";
  calls: number;
  rows: number;
  new_companies: number;
  merged_into_existing: number;
  identity_with_linkedin_url: number;
  hard_pass: number;
  hard_fail: number;
  cost_settled_usd: number;
  cost_committed_usd: number;
}

export interface ResearchWaveSummary {
  version: typeof RESEARCH_FEEDBACK_VERSION;
  wave: number;
  plan_version: number | null;
  routes: RouteYield[];
  unique_companies: number;
  multi_source_companies: number;
  identity: { with_linkedin_url: number; domain_only: number; needs_search: number };
  hard_constraints: { passed: number; failed: number; pending: number };
  gaps: Partial<Record<EvidenceDimension, number>>;
  admitted: { available: number; target: number };
  cost: { committed_usd: number; settled_usd: number; mission_ceiling_usd: number; remaining_usd: number; adaptive_reserve_remaining_usd: number };
  low_yield_routes: string[];
  exhausted_routes: string[];
}

export interface RouteCallStat {
  route_id: string | null;
  capability: string;
  actor_key: string;
  calls: number;
  rows: number;
  /** The last call returned fewer rows than it asked for, or none. */
  exhausted: boolean;
}

export function summarizeResearchWave(i: {
  wave: number;
  plan: RetrievalPlan | null;
  companies: readonly FeedbackCompany[];
  calls: readonly RouteCallStat[];
  ledger: SpendLedger | null;
  admitted: { available: number; target: number };
  adaptive_reserve_remaining_usd: number;
}): ResearchWaveSummary {
  const totals = i.ledger ? spendTotals(i.ledger) : null;
  const keyOf = (capability: string, actor: string, route: string | null) => `${capability}|${actor}|${route ?? ""}`;
  const routes = new Map<string, RouteYield>();
  const ensure = (capability: string, actor: string, route_id: string | null): RouteYield => {
    const k = keyOf(capability, actor, route_id);
    let r = routes.get(k);
    if (!r) {
      const planned = i.plan?.routes.find((x) => x.route_id === route_id);
      r = {
        route_id, capability, actor_key: actor,
        status: planned?.refused ? (/^route_stopped/.test(planned.refused) ? "stopped" : "refused") : "active",
        calls: 0, rows: 0, new_companies: 0, merged_into_existing: 0, identity_with_linkedin_url: 0,
        hard_pass: 0, hard_fail: 0,
        cost_settled_usd: 0,
        cost_committed_usd: route_id ? totals?.by_route[route_id] ?? 0 : 0,
      };
      if (route_id && i.ledger) {
        r.cost_settled_usd = round4(i.ledger.reservations
          .filter((x) => x.route_id === route_id).reduce((n, x) => n + (x.settled_usd ?? 0), 0));
      }
      routes.set(k, r);
    }
    return r;
  };
  for (const c of i.calls) {
    const r = ensure(c.capability, c.actor_key, c.route_id);
    r.calls += c.calls; r.rows += c.rows;
  }
  let multi = 0, withUrl = 0, domainOnly = 0, passed = 0, failed = 0, pending = 0;
  const gaps: Partial<Record<EvidenceDimension, number>> = {};
  for (const c of i.companies) {
    const discovery = c.found_by;
    if (new Set(discovery.map((f) => `${f.capability}|${f.actor_key}|${f.route_id ?? ""}`)).size > 1) multi++;
    if (c.has_linkedin_url) withUrl++; else if (c.has_domain) domainOnly++;
    if (c.hard_pass === true) passed++; else if (c.hard_pass === false) failed++; else pending++;
    for (const g of c.gaps) gaps[g] = (gaps[g] ?? 0) + 1;
    discovery.forEach((f, idx) => {
      const r = ensure(f.capability, f.actor_key, f.route_id);
      if (idx === 0) r.new_companies++; else r.merged_into_existing++;
      if (c.has_linkedin_url) r.identity_with_linkedin_url++;
      if (c.hard_pass === true) r.hard_pass++; else if (c.hard_pass === false) r.hard_fail++;
    });
  }
  const ceiling = i.plan?.ceilings.mission_provider_usd ?? i.ledger?.ceilings.mission_provider_usd ?? 0;
  const committed = totals?.mission_committed_usd ?? 0;
  const list = [...routes.values()];
  return {
    version: RESEARCH_FEEDBACK_VERSION, wave: i.wave, plan_version: i.plan?.version ?? null,
    routes: list,
    unique_companies: i.companies.length,
    multi_source_companies: multi,
    identity: { with_linkedin_url: withUrl, domain_only: domainOnly, needs_search: i.companies.length - withUrl },
    hard_constraints: { passed, failed, pending },
    gaps,
    admitted: i.admitted,
    cost: {
      committed_usd: committed, settled_usd: totals?.settled_usd ?? 0, mission_ceiling_usd: ceiling,
      remaining_usd: round4(Math.max(0, ceiling - committed)),
      adaptive_reserve_remaining_usd: round4(Math.max(0, i.adaptive_reserve_remaining_usd)),
    },
    low_yield_routes: list.filter((r) => r.route_id && r.status === "active" && routeIsLowYield(r)).map((r) => r.route_id!),
    exhausted_routes: i.calls.filter((c) => c.exhausted && c.route_id).map((c) => c.route_id!),
  };
}

export function routeIsLowYield(r: Pick<RouteYield, "rows" | "new_companies" | "hard_pass">): boolean {
  return r.rows >= LOW_YIELD_MIN_ROWS && (r.new_companies / r.rows < LOW_YIELD_NEW_RATIO || r.hard_pass === 0);
}

// ── ROUTE CONTROL ────────────────────────────────────────────────────────────

export type RouteControlProposal =
  | { action: "continue"; rationale?: string }
  | { action: "stop_route"; route_id: string; trigger: AmendmentTrigger; rationale: string }
  | { action: "stop_discovery"; trigger: AmendmentTrigger; rationale: string }
  | { action: "add_route"; capability: string; actor_key: string; input: Record<string, unknown>; trigger: AmendmentTrigger; rationale: string }
  | { action: "change_query"; route_id: string; input: Record<string, unknown>; trigger: AmendmentTrigger; rationale: string }
  | { action: "deepen"; route_id: string; trigger: AmendmentTrigger; rationale: string };

export type RouteControlDecision =
  | { accepted: true; action: "continue" }
  | { accepted: true; action: "stop_route" | "stop_discovery"; plan: RetrievalPlan; stopped: string[] }
  | { accepted: true; action: "add_route" | "change_query" | "deepen"; trigger: AmendmentTrigger;
      route: { capability: string; actor_key: string; input: Record<string, unknown>; replaces_route_id: string | null } }
  | { accepted: false; action: string; reason: RouteControlRefusal; detail: string };

export type RouteControlRefusal =
  | "malformed_proposal" | "unknown_route" | "route_not_active" | "trigger_not_allowed_for_action"
  | "trigger_not_supported_by_feedback" | "continuation_holds_plan" | "actor_not_ready"
  | "no_budget_room" | "no_plan";

const ALLOWED_TRIGGERS: Readonly<Record<string, readonly AmendmentTrigger[]>> = Object.freeze({
  stop_route: ["route_low_yield", "route_exhausted", "provider_failed"],
  stop_discovery: ["route_low_yield", "route_exhausted"],
  add_route: ["insufficient_candidates", "route_low_yield", "route_exhausted"],
  change_query: ["route_low_yield", "route_exhausted"],
  deepen: ["insufficient_candidates"],
});

export function validateRouteControl(
  proposal: unknown,
  ctx: {
    summary: ResearchWaveSummary;
    plan: RetrievalPlan | null;
    /** True on a worker continuation of an existing plan. */
    continuation: boolean;
    routeReady: (actor: string, capability: string) => { ready: true } | { ready: false; reason: string };
    estimateUsd: (actor: string, input: Record<string, unknown>) => number;
    now?: () => Date;
  },
): RouteControlDecision {
  const p = proposal as RouteControlProposal | null;
  const action = typeof p?.action === "string" ? p.action : "";
  const refuse = (reason: RouteControlRefusal, detail: string): RouteControlDecision =>
    ({ accepted: false, action: action || "(none)", reason, detail });
  if (!p || !action) return refuse("malformed_proposal", "no action");
  if (p.action === "continue") return { accepted: true, action: "continue" };
  if (!(action in ALLOWED_TRIGGERS)) return refuse("malformed_proposal", `unknown action ${action}`);
  if (!ctx.plan) return refuse("no_plan", "route control needs a retrieval plan");
  const trigger = (p as { trigger?: AmendmentTrigger }).trigger;
  if (!trigger || !ALLOWED_TRIGGERS[action].includes(trigger)) {
    return refuse("trigger_not_allowed_for_action", `${action} may use ${ALLOWED_TRIGGERS[action].join(", ")}; got ${trigger ?? "none"}`);
  }
  const s = ctx.summary;
  const supported = (routeId: string | null): string | null => {
    if (trigger === "route_low_yield") {
      const ids = routeId ? [routeId] : s.routes.filter((r) => r.status === "active").map((r) => r.route_id);
      return ids.some((id) => id && s.low_yield_routes.includes(id)) ? null
        : `no ${routeId ? `route ${routeId}` : "active route"} is low-yield in wave ${s.wave}`;
    }
    if (trigger === "route_exhausted") {
      const ids = routeId ? [routeId] : s.routes.filter((r) => r.status === "active").map((r) => r.route_id);
      return ids.some((id) => id && s.exhausted_routes.includes(id)) ? null
        : `no ${routeId ? `route ${routeId}` : "active route"} is exhausted in wave ${s.wave}`;
    }
    if (trigger === "insufficient_candidates") {
      return s.admitted.available < s.admitted.target ? null
        : `the admitted pool (${s.admitted.available}) already meets its target (${s.admitted.target})`;
    }
    return null;
  };
  const activeRoute = (id: string) => ctx.plan!.routes.find((r) => r.route_id === id);

  if (p.action === "stop_route" || p.action === "stop_discovery") {
    const targets = p.action === "stop_route"
      ? [p.route_id]
      : ctx.plan.routes.filter((r) => !r.refused).map((r) => r.route_id);
    if (p.action === "stop_route") {
      const r = activeRoute(p.route_id);
      if (!r) return refuse("unknown_route", `plan v${ctx.plan.version} has no route ${p.route_id}`);
      if (r.refused) return refuse("route_not_active", `${p.route_id} is already refused: ${r.refused}`);
    }
    if (targets.length === 0) return refuse("route_not_active", "no active route to stop");
    if (trigger !== "provider_failed") {
      const why = supported(p.action === "stop_route" ? p.route_id : null);
      if (why) return refuse("trigger_not_supported_by_feedback", why);
    }
    return { accepted: true, action: p.action, stopped: targets,
      plan: stopRoutes(ctx.plan, targets, trigger, String(p.rationale ?? ""), ctx.now) };
  }

  // Semantic from here on.
  if (ctx.continuation) {
    return refuse("continuation_holds_plan", `a worker continuation executes plan v${ctx.plan.version}; ${action} is a semantic change`);
  }
  const why = supported(p.action === "add_route" ? null : p.route_id);
  if (why) return refuse("trigger_not_supported_by_feedback", why);

  let capability: string, actor: string, input: Record<string, unknown>, replaces: string | null = null;
  if (p.action === "add_route") {
    capability = String(p.capability ?? ""); actor = String(p.actor_key ?? "");
    input = p.input && typeof p.input === "object" ? p.input : {};
  } else {
    const r = activeRoute(p.route_id);
    if (!r) return refuse("unknown_route", `plan v${ctx.plan.version} has no route ${p.route_id}`);
    if (r.refused) return refuse("route_not_active", `${p.route_id} is refused: ${r.refused}`);
    capability = r.capability; actor = r.provider; replaces = r.route_id;
    const base = r.proposed_input ?? {};
    input = p.action === "change_query"
      ? (p.input && typeof p.input === "object" ? p.input : {})
      : { ...base, startPage: Number((base as { startPage?: number }).startPage ?? 1) + 1 };
  }
  const ready = ctx.routeReady(actor, capability);
  if (!ready.ready) return refuse("actor_not_ready", ready.reason);
  const est = ctx.estimateUsd(actor, input);
  const room = Math.min(s.cost.remaining_usd, s.cost.adaptive_reserve_remaining_usd);
  if (!(est <= room + 1e-9)) {
    return refuse("no_budget_room", `the route estimates $${round4(est)}; $${round4(room)} remains within the mission ceiling and adaptive reserve`);
  }
  return { accepted: true, action: p.action, trigger, route: { capability, actor_key: actor, input, replaces_route_id: replaces } };
}

/** A new plan version with these routes refused. Every other route is unchanged. */
export function stopRoutes(
  current: RetrievalPlan, routeIds: readonly string[], trigger: AmendmentTrigger, rationale: string,
  now: () => Date = () => new Date(),
): RetrievalPlan {
  const changes: PlanChange[] = [];
  const routes = current.routes.map((r) => {
    if (!routeIds.includes(r.route_id) || r.refused) return r;
    const refused = `route_stopped:${trigger}: ${rationale}`.slice(0, 300);
    changes.push({ path: `routes.${r.route_id}.refused`, before: null, after: refused, kind: "operational", reason: "route stopped by route control" });
    return { ...r, refused };
  });
  const draft: Omit<RetrievalPlan, "content_hash"> = {
    ...current, routes, version: current.version + 1, created_by: "amendment",
    amendment: {
      from_version: current.version, to_version: current.version + 1, trigger,
      component: "retrieval_controller", changes, rationale: rationale.slice(0, 1000),
      approved_by: "code_policy", created_at: now().toISOString(),
    },
  };
  return { ...draft, content_hash: planContentHash(draft) };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
