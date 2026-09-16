// LEAD V2 P2 — THE RETRIEVAL PLAN. VERSIONED, HASHED, AMENDED ONLY BY RULE.
//
// Before P2 the "plan" was whatever `executionPlan` held at the moment, and the
// GPT amendment replaced it wholesale after every discovery pass — including
// the discovery question — while the trace recorded "changed" only when the
// list of capabilities differed. fd27bfac's slice 2 bought memo23 with no
// queries at all after slice 1 asked for ["B2B SaaS","SaaS software"], and
// nothing said a new plan existed.
//
// A RetrievalPlan is the single source of truth for what the mission searches:
// routes (discovery, with the planner's proposed actor-native input and its
// query family), stages (identity / enrichment / evidence, with their proposed
// inputs), anchors, evidence policy and ceilings. Each version is immutable and
// content-hashed. The only legal change is a PlanAmendment with a named
// trigger, validated here:
//   - change detection is the canonical hash of the whole plan content;
//   - operational triggers may change only operational fields (counts, pages);
//   - semantic changes (terms, filters, actors, routes, stage inputs) need a
//     semantic trigger and remaining adaptive reserve;
//   - mission criteria never change by amendment.
// A worker continuation executes the current version; it never re-plans.
//
// Pure.

import type { CapabilityPlan } from "./leadCapabilityGraph.ts";
import type { ExecutionPlan } from "./leadExecutionPlan.ts";
import type { LeadMissionV1 } from "./leadMission.ts";
import { isCapabilityExecutable } from "./capabilityExecutability.ts";
import { canonicalJson, sha256Hex } from "./providerInputFingerprint.ts";
import type { CallPurpose, Ceilings } from "./budgetPolicy.ts";
import {
  CRITERIA_EXECUTION_POLICY_VERSION, hardLocations, type CriteriaExecutionPolicy,
} from "./criteriaExecutionPolicy.ts";
import type { CanonicalSignalKind } from "./signalKinds.ts";
import { COUNT_FIELD, PRIMARY_GEOGRAPHY_FIELD, roleOf } from "./actorFieldRoles.ts";

export const RETRIEVAL_PLAN_VERSION = "retrieval-plan-v1" as const;

const DISCOVERY_ANCHOR: Readonly<Record<string, CanonicalSignalKind>> = Object.freeze({
  startup_company_discovery: "company_profile",
  general_company_discovery: "company_profile",
  known_company_resolution: "company_profile",
  funding_signal_discovery: "funding",
  job_discovery: "hiring",
  expansion_signal_discovery: "expansion",
  product_launch_discovery: "product_launch",
});

const STAGE_PURPOSE: Readonly<Record<string, CallPurpose>> = Object.freeze({
  company_identity_resolution: "identity",
  company_enrichment: "enrichment",
  hiring_verification: "hiring_evidence",
  expansion_signal_verification: "news_evidence",
  product_launch_verification: "news_evidence",
  company_post_verification: "news_evidence",
  technology_verification: "technology_evidence",
  founder_discovery: "people",
  employer_verification: "people",
  contact_enrichment: "people",
});

export const isDiscoveryCapability = (cap: string) => cap in DISCOVERY_ANCHOR;
export function purposeForCapability(cap: string): CallPurpose {
  return isDiscoveryCapability(cap) ? "discovery" : STAGE_PURPOSE[cap] ?? "enrichment";
}
export function anchorForCapability(cap: string): CanonicalSignalKind | null {
  return DISCOVERY_ANCHOR[cap] ?? null;
}

export interface QueryFamily {
  family_id: string;
  purpose: "exact" | "adjacent";
  terms: string[];
  filters: Record<string, unknown>;
  relaxations: Array<{ criterion_id: string; description: string }>;
}

export interface RetrievalRoute {
  route_id: string;
  anchor: CanonicalSignalKind;
  capability: string;
  provider: string;
  /** The planner's actor-native input, verbatim. Null when no planner proposed one. */
  proposed_input: Record<string, unknown> | null;
  query_families: QueryFamily[];
  page_cap: number;
  route_ceiling_usd: number;
  /** Set when validation refused this route; its calls are refused too. */
  refused: string | null;
}

export interface RetrievalStage {
  stage_id: string;
  capability: string;
  provider: string;
  purpose: CallPurpose;
  proposed_input: Record<string, unknown> | null;
}

export type AmendmentTrigger =
  | "insufficient_candidates" | "route_exhausted" | "route_low_yield" | "evidence_unavailable"
  | "provider_failed" | "provider_limit" | "safety_clamp" | "user_decision";

export const SEMANTIC_TRIGGERS: ReadonlySet<AmendmentTrigger> = new Set<AmendmentTrigger>([
  "insufficient_candidates", "route_exhausted", "route_low_yield", "user_decision",
]);

export interface PlanChange {
  path: string;
  before: unknown;
  after: unknown;
  kind: "semantic" | "operational" | "evidence";
  reason: string;
}

export interface PlanAmendment {
  from_version: number;
  to_version: number;
  trigger: AmendmentTrigger;
  component: "retrieval_controller" | "validator" | "budget_policy" | "user";
  changes: PlanChange[];
  rationale: string;
  approved_by: "code_policy" | "user";
  created_at: string;
}

export interface RetrievalPlan {
  version_tag: typeof RETRIEVAL_PLAN_VERSION;
  plan_id: string;
  mission_hash: string;
  version: number;
  anchors: { primary: CanonicalSignalKind; secondary: CanonicalSignalKind | null; reasons: string[] };
  routes: RetrievalRoute[];
  stages: RetrievalStage[];
  evidence_policy: {
    dimensions_required: string[];
    team_composition: "not_needed" | "shortlisted_only";
    freshness: Record<string, number>;
  };
  ceilings: Ceilings;
  /** Canary cap on delivery. Never changes `mission.requested_count`. */
  execution_limit: number | null;
  criteria_policy_version: string;
  created_by: "retrieval_planner" | "amendment";
  amendment: PlanAmendment | null;
  /** Canonical hash of the plan CONTENT (routes, stages, anchors, policy, ceilings). */
  content_hash: string;
}

export interface PlanViolation {
  code: "route_not_executable" | "route_ceiling_above_mission" | "non_narrowing_query"
    | "hard_geography_not_filtered";
  route_id: string;
  blocking: boolean;
  detail: string;
}

const TERM_FIELDS = new Set(["queries", "searchQuery", "keywords", "jobTitles", "currentJobTitles", "topics"]);

function termsOf(input: Record<string, unknown> | null): string[] {
  if (!input) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (!TERM_FIELDS.has(k)) continue;
    for (const t of Array.isArray(v) ? v : [v]) {
      const s = String(t ?? "").trim();
      if (s && !s.includes("{{")) out.push(s);
    }
  }
  return out;
}

function filtersOf(actor: string, input: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    const role = roleOf(actor, k);
    if (role === "geography" || role === "industry" || role === "company_size" ||
        role === "company_stage" || role === "exclusion" || (role === "query" && !TERM_FIELDS.has(k))) {
      out[k] = v;
    }
  }
  return out;
}

export interface BuildPlanInput {
  mission: LeadMissionV1;
  mission_hash: string;
  graph: CapabilityPlan;
  execution_plan: ExecutionPlan | null;
  policy: CriteriaExecutionPolicy;
  ceilings: Ceilings;
  execution_limit?: number | null;
  /** Discovery selections proposed outside the execution plan (a replan). */
  extra_routes?: Array<{ capability: string; provider: string; input: Record<string, unknown>; purpose: "exact" | "adjacent" }>;
}

function contentOf(p: Omit<RetrievalPlan, "content_hash">) {
  return {
    plan_id: p.plan_id, mission_hash: p.mission_hash, anchors: p.anchors, routes: p.routes,
    stages: p.stages, evidence_policy: p.evidence_policy, ceilings: p.ceilings,
    execution_limit: p.execution_limit, criteria_policy_version: p.criteria_policy_version,
  };
}

export function planContentHash(p: Omit<RetrievalPlan, "content_hash">): string {
  return sha256Hex(canonicalJson(contentOf(p)));
}

export function buildRetrievalPlan(i: BuildPlanInput): RetrievalPlan {
  const steps = i.execution_plan?.steps ?? [];
  const routes: RetrievalRoute[] = [];
  const stages: RetrievalStage[] = [];
  const idFor = (base: string, taken: Set<string>) => {
    let id = base, n = 2;
    while (taken.has(id)) id = `${base}#${n++}`;
    taken.add(id);
    return id;
  };
  const routeIds = new Set<string>(), stageIds = new Set<string>();

  const pushRoute = (capability: string, provider: string, input: Record<string, unknown> | null,
    purpose: "exact" | "adjacent") => {
    const anchor = anchorForCapability(capability) ?? "company_profile";
    const route_id = idFor(`${capability}:${provider}`, routeIds);
    routes.push({
      route_id, anchor, capability, provider,
      proposed_input: input ? JSON.parse(JSON.stringify(input)) : null,
      query_families: [{
        family_id: sha256Hex(canonicalJson({ terms: termsOf(input), filters: filtersOf(provider, input) })).slice(0, 12),
        purpose, terms: termsOf(input), filters: filtersOf(provider, input), relaxations: [],
      }],
      page_cap: 1,
      route_ceiling_usd: i.ceilings.per_route_usd[anchor] ?? i.ceilings.mission_provider_usd,
      refused: null,
    });
  };

  for (const s of steps) {
    if (!s.actor_key) continue;
    if (isDiscoveryCapability(s.capability)) pushRoute(s.capability, s.actor_key, s.input ?? {}, "exact");
    else {
      stages.push({
        stage_id: idFor(`${s.capability}:${s.actor_key}`, stageIds), capability: s.capability,
        provider: s.actor_key, purpose: purposeForCapability(s.capability),
        proposed_input: JSON.parse(JSON.stringify(s.input ?? {})),
      });
    }
  }
  // A graph discovery step the planner did not plan still runs: its route is
  // recorded with no proposal, so the spec shows the engine chose the input.
  if (routes.length === 0) {
    const entry = i.graph.steps.find((s) => isDiscoveryCapability(s.capability) && s.providers.length > 0);
    if (entry) pushRoute(entry.capability, entry.providers[0], null, "exact");
  }
  for (const r of i.extra_routes ?? []) pushRoute(r.capability, r.provider, r.input, r.purpose);

  const freshness: Record<string, number> = {};
  for (const s of i.mission.required_signals ?? []) {
    if (s.timeframe_days != null) freshness[String(s.event ?? s.type)] = s.timeframe_days;
  }
  const required = Object.values(i.policy.dimensions)
    .filter((d) => d.hard_values.length || d.target_values.length).map((d) => d.dimension);

  const draft: Omit<RetrievalPlan, "content_hash"> = {
    version_tag: RETRIEVAL_PLAN_VERSION,
    plan_id: `rp_${i.mission_hash.slice(0, 16)}`,
    mission_hash: i.mission_hash,
    version: 1,
    anchors: {
      primary: anchorForCapability(String(i.graph.entry_capability)) ?? "company_profile",
      secondary: null,
      reasons: [String(i.graph.routing_reason ?? "")].filter(Boolean),
    },
    routes, stages,
    evidence_policy: { dimensions_required: required, team_composition: "not_needed", freshness },
    ceilings: i.ceilings,
    execution_limit: i.execution_limit ?? null,
    criteria_policy_version: CRITERIA_EXECUTION_POLICY_VERSION,
    created_by: "retrieval_planner",
    amendment: null,
  };
  const violations = validateRetrievalPlan({ ...draft, content_hash: "" }, i.policy);
  for (const v of violations) {
    if (!v.blocking) continue;
    const r = routes.find((x) => x.route_id === v.route_id);
    if (r && !r.refused) r.refused = `${v.code}: ${v.detail}`;
  }
  return { ...draft, content_hash: planContentHash(draft) };
}

export function validateRetrievalPlan(plan: RetrievalPlan, policy: CriteriaExecutionPolicy): PlanViolation[] {
  const out: PlanViolation[] = [];
  const hardGeo = hardLocations(policy);
  for (const r of plan.routes) {
    if (!isCapabilityExecutable(r.capability)) {
      out.push({ code: "route_not_executable", route_id: r.route_id, blocking: true,
        detail: `${r.capability} is not executable by the engine` });
    }
    if (r.route_ceiling_usd > plan.ceilings.mission_provider_usd + 1e-9) {
      out.push({ code: "route_ceiling_above_mission", route_id: r.route_id, blocking: true,
        detail: `route ceiling $${r.route_ceiling_usd} exceeds the mission ceiling $${plan.ceilings.mission_provider_usd}` });
    }
    if (r.proposed_input && r.capability !== "known_company_resolution") {
      const fam = r.query_families[0];
      if (fam.terms.length === 0 && Object.keys(fam.filters).length === 0) {
        out.push({ code: "non_narrowing_query", route_id: r.route_id, blocking: true,
          detail: "the proposed discovery input has no search terms and no filters — an unfiltered paid sweep" });
      }
    }
    const geoField = PRIMARY_GEOGRAPHY_FIELD[r.provider];
    if (hardGeo.length && geoField && r.proposed_input && !(geoField in r.proposed_input)) {
      out.push({ code: "hard_geography_not_filtered", route_id: r.route_id, blocking: false,
        detail: `hard geography ${hardGeo.join(", ")} is not in ${geoField}; the spec fills it` });
    }
  }
  return out;
}

// ── AMENDMENTS ──────────────────────────────────────────────────────────────

function diffInputs(pathBase: string, actor: string, before: Record<string, unknown> | null,
  after: Record<string, unknown> | null): PlanChange[] {
  const out: PlanChange[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    const b = before?.[k], a = after?.[k];
    if (canonicalJson(b ?? null) === canonicalJson(a ?? null)) continue;
    const role = roleOf(actor, k);
    const operational = role === "count" || role === "page" || role === "operational" || k === COUNT_FIELD[actor];
    out.push({ path: `${pathBase}.${k}`, before: b ?? null, after: a ?? null,
      kind: operational ? "operational" : "semantic",
      reason: operational ? "operational field" : `${role} field changes what is searched` });
  }
  return out;
}

export function diffPlans(from: RetrievalPlan, to: RetrievalPlan): PlanChange[] {
  const changes: PlanChange[] = [];
  const byId = (xs: RetrievalRoute[]) => new Map(xs.map((r) => [r.route_id, r]));
  const fr = byId(from.routes), tr = byId(to.routes);
  for (const [id, r] of tr) {
    const old = fr.get(id);
    if (!old) {
      changes.push({ path: `routes.${id}`, before: null, after: r.proposed_input, kind: "semantic", reason: "route added" });
      continue;
    }
    changes.push(...diffInputs(`routes.${id}.input`, r.provider, old.proposed_input, r.proposed_input));
    if (old.page_cap !== r.page_cap) {
      changes.push({ path: `routes.${id}.page_cap`, before: old.page_cap, after: r.page_cap, kind: "operational", reason: "page cap" });
    }
  }
  for (const [id, r] of fr) {
    if (!tr.has(id)) changes.push({ path: `routes.${id}`, before: r.proposed_input, after: null, kind: "semantic", reason: "route removed" });
  }
  const sb = new Map(from.stages.map((s) => [s.stage_id, s])), sa = new Map(to.stages.map((s) => [s.stage_id, s]));
  for (const [id, s] of sa) {
    const old = sb.get(id);
    if (!old) { changes.push({ path: `stages.${id}`, before: null, after: s.proposed_input, kind: "evidence", reason: "evidence stage added" }); continue; }
    changes.push(...diffInputs(`stages.${id}.input`, s.provider, old.proposed_input, s.proposed_input));
  }
  for (const [id, s] of sb) {
    if (!sa.has(id)) changes.push({ path: `stages.${id}`, before: s.proposed_input, after: null, kind: "evidence", reason: "evidence stage removed" });
  }
  return changes;
}

export type AmendmentDecision =
  | { accepted: true; plan: RetrievalPlan; changes: PlanChange[] }
  | { accepted: false; reason: "no_change" | "trigger_cannot_change_semantics" | "adaptive_reserve_exhausted" | "validation_failed";
      detail: string; changes: PlanChange[] };

export function amendRetrievalPlan(current: RetrievalPlan, i: {
  build: BuildPlanInput;
  trigger: AmendmentTrigger;
  component: PlanAmendment["component"];
  rationale: string;
  reserve_remaining_usd: number;
  now?: () => Date;
}): AmendmentDecision {
  const candidate = buildRetrievalPlan({ ...i.build, ceilings: current.ceilings,
    execution_limit: current.execution_limit });
  if (candidate.content_hash === current.content_hash) {
    return { accepted: false, reason: "no_change", detail: "the proposed plan is identical in content", changes: [] };
  }
  const changes = diffPlans(current, candidate);
  if (changes.length === 0) {
    return { accepted: false, reason: "no_change", detail: "no route or stage input changed", changes };
  }
  const semantic = changes.some((c) => c.kind === "semantic");
  const evidence = changes.some((c) => c.kind === "evidence");
  const operationalOnlyTrigger = !SEMANTIC_TRIGGERS.has(i.trigger);
  if (semantic && operationalOnlyTrigger) {
    return { accepted: false, reason: "trigger_cannot_change_semantics",
      detail: `trigger ${i.trigger} may change only operational fields; ${changes.filter((c) => c.kind === "semantic").map((c) => c.path).join(", ")} are semantic`,
      changes };
  }
  if (evidence && operationalOnlyTrigger && i.trigger !== "evidence_unavailable") {
    return { accepted: false, reason: "trigger_cannot_change_semantics",
      detail: `trigger ${i.trigger} cannot change the evidence stages`, changes };
  }
  if (semantic && i.trigger !== "user_decision" && i.reserve_remaining_usd <= 0) {
    return { accepted: false, reason: "adaptive_reserve_exhausted",
      detail: "no adaptive reserve remains for a semantic amendment", changes };
  }
  const blocking = candidate.routes.filter((r) => r.refused &&
    changes.some((c) => c.path.startsWith(`routes.${r.route_id}`)));
  if (blocking.length) {
    return { accepted: false, reason: "validation_failed",
      detail: blocking.map((r) => `${r.route_id}: ${r.refused}`).join("; "), changes };
  }
  const now = (i.now ?? (() => new Date()))();
  const draft: Omit<RetrievalPlan, "content_hash"> = {
    ...candidate,
    version: current.version + 1,
    created_by: "amendment",
    amendment: {
      from_version: current.version, to_version: current.version + 1, trigger: i.trigger,
      component: i.component, changes, rationale: String(i.rationale ?? "").slice(0, 1000),
      approved_by: i.trigger === "user_decision" ? "user" : "code_policy", created_at: now.toISOString(),
    },
  };
  return { accepted: true, plan: { ...draft, content_hash: candidate.content_hash }, changes };
}

/** The route or stage a provider call belongs to, in the current version. */
export function planEntryFor(plan: RetrievalPlan, capability: string, provider: string):
  { kind: "route"; route: RetrievalRoute } | { kind: "stage"; stage: RetrievalStage } | null {
  const route = plan.routes.find((r) => r.capability === capability && r.provider === provider);
  if (route) return { kind: "route", route };
  const stage = plan.stages.find((s) => s.capability === capability && s.provider === provider);
  if (stage) return { kind: "stage", stage };
  return null;
}

/**
 * The plan entry a concrete call belongs to.
 *
 * A replan may add a second route for the same actor with a different
 * question, so matching on capability + actor alone would hand the call the
 * FIRST route's proposal. The route whose proposed input agrees with the call
 * on the most fields wins; the latest route breaks ties.
 */
export function planEntryForCall(
  plan: RetrievalPlan, capability: string, provider: string, input: Record<string, unknown>,
): ReturnType<typeof planEntryFor> {
  const routes = plan.routes.filter((r) => r.capability === capability && r.provider === provider);
  if (routes.length > 1) {
    let best = routes[routes.length - 1], bestScore = -1;
    for (const r of routes) {
      const p = r.proposed_input ?? {};
      const score = Object.keys(p).filter((k) =>
        canonicalJson(p[k] ?? null) === canonicalJson(input[k] ?? null)).length;
      if (score >= bestScore) { best = r; bestScore = score; }
    }
    return { kind: "route", route: best };
  }
  return planEntryFor(plan, capability, provider);
}
