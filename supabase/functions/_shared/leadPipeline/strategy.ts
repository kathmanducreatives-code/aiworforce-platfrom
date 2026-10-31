// Multi-provider discovery strategy: which provider(s) discover, which verify.
//
//   request ─► GPT mission compiler (leadMissionCompiler, unchanged: the ONLY
//              reader of the user's words) ─► final mission
//           ─► specFromMission        what the request needs, in planner terms
//           ─► planStrategy           every strategy, judged against the
//                                     capability registry below, the workspace's
//                                     connections and permissions, and the budget
//           ─► (optional) GPT advice  the model may PICK among the strategies the
//                                     planner already found feasible, nothing more
//           ─► StrategyPlan           one strategy, its steps, the worst case, the
//                                     limitations, and a hash the approval names
//
// Nothing here authorizes a call or spends anything. The executor
// (`multiProvider.ts`) runs a plan only under an approval naming its hash and
// covering its worst case. The model's choice is advice: it is accepted only
// when the deterministic checks already admitted that strategy, and a rejected
// choice is recorded, never silently swapped. The model never sees or names an
// actor, a price or a credential (the same rule `leadMissionCompiler` enforces).
//
// Discovery is not qualification. Every strategy ends in the shared engine
// (`evaluateEligibility` via `verifyLeads`); a requirement no step can prove is
// listed as a limitation and leaves the lead `pending`, never eligible.
//
// Pure.

import type { DiscoveryRequirements, ProviderId, Range } from "../discoveryProviders/types.ts";
import { requirementsFromMission } from "../discoveryProviders/requirements.ts";
import { stableHash } from "../discoveryProviders/routing.ts";
import { translate } from "../discoveryProviders/vocabulary.ts";
import type { GenerateJsonFn } from "../intelligence/plannerWrapper.ts";
import { classifyRoleFamily } from "../roleFamilies.ts";
import { COMPANY_RECORD_ACTOR } from "./canonical.ts";
import { configureIcp, ICP_A, NON_DECISION_TITLES, type IcpConfig } from "./icp.ts";
import { SIGNAL_ACTORS, worstCaseUsd } from "./signals.ts";

export const STRATEGY_PLANNER_VERSION = "discovery-strategy-v1" as const;

// ── Strategies ──────────────────────────────────────────────────────────────

export const DISCOVERY_STRATEGIES = [
  /** LeadOcean finds people and companies; nothing verifies them (every HQ / size stays unproven). */
  "leadocean_only",
  /** Apify finds companies by a dated signal (open roles) and verifies them; no people. */
  "apify_only",
  /** LeadOcean finds people and companies; Apify's company record proves identity, HQ and size. */
  "leadocean_plus_apify",
  /** Apify finds companies by a dated signal; LeadOcean finds their decision-makers by domain; Apify verifies. */
  "apify_plus_leadocean",
  /** Apollo finds people; Apify verifies. Disabled until Apollo API access is validated. */
  "apollo_plus_apify",
] as const;
export type DiscoveryStrategyId = typeof DISCOVERY_STRATEGIES[number];
export const isStrategy = (s: unknown): s is DiscoveryStrategyId => typeof s === "string" && (DISCOVERY_STRATEGIES as readonly string[]).includes(s);

// ── Capability registry ─────────────────────────────────────────────────────
//
// What each provider route can DISCOVER, FILTER, PROVE and what it costs. The
// planner decides from this table alone. Status is a reviewed constant:
//   available                     wired, priced, on the actor / endpoint allowlist
//   disabled_pending_validation   an adapter exists; access is not validated
//   not_approved                  would answer the need, but is not on an allowlist
//                                 (adding one is a reviewed change, never a setting)

export type CapabilityStatus = "available" | "disabled_pending_validation" | "not_approved";
export type CapabilityRole = "discover_people" | "discover_companies" | "people_at_companies" | "verify_company";
/** Facts a capability can PROVE to the shared engine (evidenceAuthority rules), never mere claims. */
export type Provable = "identity" | "headquarters" | "size_band" | "hiring";
export type SignalKind = "hiring" | "funding" | "social_activity" | "expansion" | "leadership_change" | "other";

export interface DiscoveryCapability {
  id: string;
  provider: ProviderId;
  role: CapabilityRole;
  status: CapabilityStatus;
  /** Discovery filters it applies itself (narrowing only, never proof). */
  filters: ("roles" | "geography" | "employee_range" | "industry" | "domain" | "job_title" | "post_topic")[];
  /** The signal it discovers BY, with a dated event (so a window can be judged). */
  discoversBySignal: SignalKind | null;
  /** Signals its rows carry only as an unproven claim (ranking, never a gate). */
  claims: SignalKind[];
  proves: Provable[];
  cost: { unit: "leadocean_record"; perRow: number } | { unit: "usd"; perItem: number; perStart: number };
  actorKey?: string;
  note: string;
}

/** Apollo People Search returned HTTP 403 (API_INACCESSIBLE) on 2026-10-30. Flipping this is a reviewed change after a validated, approved check. */
export const APOLLO_ACCESS_VALIDATED = false as const;

export const DISCOVERY_CAPABILITIES: Readonly<Record<string, DiscoveryCapability>> = Object.freeze({
  "leadocean.people_search": {
    id: "leadocean.people_search", provider: "leadocean", role: "discover_people", status: "available",
    filters: ["roles", "geography", "employee_range", "industry"], discoversBySignal: null, claims: ["funding"], proves: [],
    cost: { unit: "leadocean_record", perRow: 1 },
    note: "people + employer rows; HQ wrong for ~29% of companies and headcount understated (LEADOCEAN_FINAL_VERDICT) — claims only",
  },
  "leadocean.people_by_domain": {
    id: "leadocean.people_by_domain", provider: "leadocean", role: "people_at_companies", status: "available",
    filters: ["domain", "roles"], discoversBySignal: null, claims: [], proves: [],
    cost: { unit: "leadocean_record", perRow: 1 },
    note: "decision-makers at named company domains (the people search with its exact domain filter)",
  },
  "apify.linkedin_job_search": {
    id: "apify.linkedin_job_search", provider: "apify", role: "discover_companies", status: "available",
    filters: ["job_title", "geography"], discoversBySignal: "hiring", claims: [], proves: ["identity", "hiring"],
    cost: { unit: "usd", perItem: SIGNAL_ACTORS.jobs.perItemUsd, perStart: SIGNAL_ACTORS.jobs.perStartUsd },
    actorKey: SIGNAL_ACTORS.jobs.key,
    note: "employers with a dated open role; titles are fuzzy, so every posting is post-filtered; agency postings dropped",
  },
  "apify.linkedin_company_record": {
    id: "apify.linkedin_company_record", provider: "apify", role: "verify_company", status: "available",
    filters: [], discoversBySignal: null, claims: [], proves: ["identity", "headquarters", "size_band"],
    cost: { unit: "usd", perItem: COMPANY_RECORD_ACTOR.perItemUsd, perStart: COMPANY_RECORD_ACTOR.perStartUsd },
    actorKey: COMPANY_RECORD_ACTOR.key,
    note: "the HQ-flagged location and declared size band (AUTHORITY_RULES), on a record whose identity matches",
  },
  "apify.linkedin_post_search": {
    id: "apify.linkedin_post_search", provider: "apify", role: "discover_companies", status: "not_approved",
    filters: ["post_topic"], discoversBySignal: "social_activity", claims: [], proves: ["identity"],
    cost: { unit: "usd", perItem: 0.002, perStart: 0.00005 },
    note: "searching posts by topic needs a post-search actor; none is on the pipeline allowlist (PIPELINE_ACTORS)",
  },
  "apify.funding_corroboration": {
    id: "apify.funding_corroboration", provider: "apify", role: "verify_company", status: "not_approved",
    filters: [], discoversBySignal: null, claims: [], proves: [],
    cost: { unit: "usd", perItem: 0.0035, perStart: 0 },
    note: "dated funding corroboration is not wired into this pipeline; a funding-gated mission belongs on the Apify engine's verified funding route (Contract 3)",
  },
  "apollo.people_search": {
    id: "apollo.people_search", provider: "apollo", role: "discover_people", status: APOLLO_ACCESS_VALIDATED ? "available" : "disabled_pending_validation",
    filters: ["roles", "geography", "employee_range", "domain"], discoversBySignal: null, claims: [], proves: [],
    cost: { unit: "leadocean_record", perRow: 0 },
    note: "People API Search returned 403 on this plan (2026-10-30); disabled until access is validated",
  },
} satisfies Record<string, DiscoveryCapability>);

/** The capability chain each strategy runs, in order. */
export const STRATEGY_CHAINS: Readonly<Record<DiscoveryStrategyId, readonly string[]>> = Object.freeze({
  leadocean_only: ["leadocean.people_search"],
  apify_only: ["apify.linkedin_job_search", "apify.linkedin_company_record"],
  leadocean_plus_apify: ["leadocean.people_search", "apify.linkedin_company_record"],
  // Companies are verified BEFORE their people are bought: no record is spent on a disproven company.
  apify_plus_leadocean: ["apify.linkedin_job_search", "apify.linkedin_company_record", "leadocean.people_by_domain"],
  apollo_plus_apify: ["apollo.people_search", "apify.linkedin_company_record"],
});

// ── What the request needs ──────────────────────────────────────────────────

export interface SpecSignal {
  kind: SignalKind;
  /** A hard criterion: the shared engine will require evidence of it. */
  hard: boolean;
  windowDays: number | null;
  /** The literal role words of a hiring signal ("account executives"), for the job search and its post-filter. */
  roleTerms: string[];
  roleFamilies: string[];
  phrase: string | null;
}

export interface DiscoverySpec {
  version: typeof STRATEGY_PLANNER_VERSION;
  query: string;
  requestedCount: number;
  /** The request names decision-makers: some step must return people. */
  wantsPeople: boolean;
  roles: string[];
  geography: string[];
  employees: Range | null;
  industry: string[];
  /** Signals the request is DEFINED by (required_signals), hard or ranking-only. */
  signals: SpecSignal[];
  /** Hard requirements no planner capability models (they stay the shared engine's, and block nothing here). */
  otherHard: string[];
  forbidBroadening: string[];
  /** For the executor and the shared engine: the compiler's requirements, criteria untouched. */
  requirements: DiscoveryRequirements;
}

interface MissionLike {
  original_user_query?: string;
  requested_count?: number | null;
  target_entity?: string;
  criteria?: { kind?: string; dimension?: string; value?: unknown; time_window?: { days?: number } }[];
  required_signals?: { type?: string; event?: string; timeframe_days?: number | null; role_families?: string[]; qualifier?: { role_terms?: string[]; role_families?: string[] }; phrase?: string }[];
}

const SIGNAL_OF: Record<string, SignalKind> = {
  hiring: "hiring", funding: "funding", social_activity: "social_activity", post: "social_activity", comment: "social_activity",
  expansion: "expansion", leadership_change: "leadership_change",
};
const kindOf = (s: string | undefined): SignalKind => SIGNAL_OF[String(s ?? "")] ?? "other";

/** Read the compiled mission into planner terms. The compiler already did all the interpreting. */
export function specFromMission(mission: MissionLike, opts: { defaultCount?: number } = {}): DiscoverySpec {
  const req = requirementsFromMission({ ...mission, requested_count: mission.requested_count ?? opts.defaultCount ?? 25 } as never);
  const hard = (mission.criteria ?? []).filter((c) => c.kind === "hard");
  const signals: SpecSignal[] = [];
  for (const s of mission.required_signals ?? []) {
    const kind = kindOf(s.event ?? s.type);
    const criterion = (mission.criteria ?? []).find((c) => kindOf(c.dimension) === kind && c.dimension !== "other");
    if (signals.some((x) => x.kind === kind)) continue;
    const roleTerms = s.qualifier?.role_terms ?? [];
    let roleFamilies = s.qualifier?.role_families ?? s.role_families ?? [];
    // "hired salespeople": no literal title survived compilation, but the user's own
    // words name a family. The shared role-family library reads them; nothing is invented.
    if (kind === "hiring" && !roleTerms.length && !roleFamilies.length) {
      const fam = classifyRoleFamily(s.phrase ?? "");
      if (fam && fam !== "custom") roleFamilies = [fam];
    }
    signals.push({
      kind, hard: criterion?.kind === "hard",
      windowDays: s.timeframe_days ?? criterion?.time_window?.days ?? null,
      roleTerms, roleFamilies, phrase: s.phrase ?? null,
    });
  }
  // A hard signal criterion with no required_signals entry still counts.
  for (const c of hard) {
    const kind = kindOf(c.dimension);
    if (kind !== "other" && !signals.some((x) => x.kind === kind)) {
      signals.push({ kind, hard: true, windowDays: c.time_window?.days ?? null, roleTerms: [], roleFamilies: [], phrase: null });
    }
  }
  const values = (k: string) => req.hard.filter((h) => h.key === k).flatMap((h) => (Array.isArray(h.values) ? h.values : []));
  const range = req.hard.find((h) => h.key === "employee_range")?.values as Range | undefined;
  const modelled = new Set(["roles", "geography_hq", "geography_person", "employee_range", "industry", "signal"]);
  return {
    version: STRATEGY_PLANNER_VERSION,
    query: req.originalQuery,
    requestedCount: req.requestedCount,
    wantsPeople: req.targetEntity === "person" || req.roles.length > 0,
    roles: req.roles,
    geography: [...values("geography_hq"), ...values("geography_person")],
    employees: range ?? null,
    industry: values("industry"),
    signals,
    otherHard: req.hard.filter((h) => !modelled.has(h.key)).map((h) => `${h.key}: ${h.label}`),
    forbidBroadening: req.forbidBroadening,
    requirements: req,
  };
}

// ── Context: who may do what, with what money ───────────────────────────────

export interface ProviderAccess {
  /** Server-side feature flag. */
  enabled: boolean;
  /** A verified credential for THIS workspace (Apify: the deployment's token). */
  connected: boolean;
  /** The workspace's own permission to use it (allowlist / member role). */
  authorized: boolean;
  /** LeadOcean records left (lifetime on the Free plan); null = unknown. */
  remaining?: number | null;
}

export interface StrategyContext {
  providers: Partial<Record<ProviderId, ProviderAccess>>;
  /** The most a plan may cost; a plan whose worst case exceeds it is shrunk or refused. */
  budget: { maxLeadoceanRecords: number; maxApifyUsd: number };
  /** Company records already held (fresh), by LinkedIn slug: not bought again. */
  cachedCompanyRecords?: number;
  /** What the USER stated about providers. Honoured only when feasible; never silently switched. */
  user?: { strategy?: DiscoveryStrategyId; excludeProviders?: ProviderId[]; allowReviewOnly?: boolean };
  /** People to look up per discovered company (apify_plus_leadocean). */
  peoplePerCompany?: number;
}

// ── The plan ────────────────────────────────────────────────────────────────

export interface Limitation {
  code: "unverifiable_requirement" | "unverified_claim" | "capability_not_approved" | "provider_disabled" | "budget_limited" | "signal_not_discoverable" | "fuzzy_source";
  detail: string;
}

export interface StrategyStep {
  capability: string;
  provider: ProviderId;
  role: CapabilityRole;
  /** Ceiling for this step. */
  maxItems: number;
  estimate: { leadoceanRecords: number; apifyUsd: number };
  why: string;
}

export interface StrategyCandidate {
  strategy: DiscoveryStrategyId;
  feasible: boolean;
  /** Why it is not feasible; empty when feasible. */
  refusals: string[];
  steps: StrategyStep[];
  limitations: Limitation[];
  estimate: { leadoceanRecords: number; apifyUsd: number };
  /** Hard requirements this strategy can PROVE (to the shared engine). */
  provable: string[];
  score: number;
  rationale: string[];
}

export interface ModelAdvice {
  proposed: DiscoveryStrategyId | null;
  rationale: string;
  accepted: boolean;
  reason: string;
  model: string | null;
}

export interface StrategyPlan {
  version: typeof STRATEGY_PLANNER_VERSION;
  status: "ready" | "blocked";
  blockedReason: string | null;
  strategy: DiscoveryStrategyId | null;
  selectedBy: "user" | "model" | "deterministic" | null;
  rationale: string[];
  steps: StrategyStep[];
  limitations: Limitation[];
  estimate: { leadoceanRecords: number; apifyUsd: number };
  candidates: StrategyCandidate[];
  modelAdvice: ModelAdvice | null;
  /** Binds an approval to exactly this strategy, these steps, ceilings and limitations. */
  planHash: string;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const usd = (c: DiscoveryCapability, items: number) => c.cost.unit === "usd" ? r6(c.cost.perStart + c.cost.perItem * Math.max(1, items)) : 0;

/** Overfetch for discovery: the shared engine rejects some candidates (Test E: 7 of 10 eligible). */
const OVERFETCH = 2;
const JOB_ROWS_PER_COMPANY = 2;

function access(ctx: StrategyContext, p: ProviderId): string | null {
  if (ctx.user?.excludeProviders?.includes(p)) return `${p} excluded by the request`;
  const a = ctx.providers[p];
  if (!a) return `${p} not connected`;
  if (!a.enabled) return `${p} disabled (feature flag off)`;
  if (!a.connected) return `${p} not connected for this workspace`;
  if (!a.authorized) return `${p} not authorized for this workspace`;
  if (p === "leadocean" && a.remaining != null && a.remaining <= 0) return "leadocean allowance exhausted";
  return null;
}

/** The job-search titles for the request's hiring signal (≤3, the catalogued discovery limit). */
export function hiringTitles(spec: DiscoverySpec): string[] {
  const s = spec.signals.find((x) => x.kind === "hiring");
  return (s?.roleTerms.length ? s.roleTerms : s?.roleFamilies.length ? s.roleFamilies.map((f) => FAMILY_TITLES[f]).filter((t): t is string => !!t) : []).slice(0, 3);
}
/** Job-search titles for a role family the user named only as a family ("salespeople"). Fuzzy search input only; postings are post-filtered. */
const FAMILY_TITLES: Record<string, string> = { gtm_sales: "Account Executive", sales_operations: "Sales Operations", marketing_growth: "Marketing Manager", growth: "Growth Manager", customer_success: "Customer Success Manager", engineering: "Software Engineer", finance: "Finance Manager", ops: "Operations Manager" };

function judge(strategy: DiscoveryStrategyId, spec: DiscoverySpec, ctx: StrategyContext): StrategyCandidate {
  const refusals: string[] = [];
  const limitations: Limitation[] = [];
  const rationale: string[] = [];
  const chain = STRATEGY_CHAINS[strategy].map((id) => DISCOVERY_CAPABILITIES[id]);
  const n = spec.requestedCount;

  // 1 every capability in the chain must be available, its provider usable here
  for (const c of chain) {
    if (c.status === "disabled_pending_validation") refusals.push(`${c.id} is disabled pending validation: ${c.note}`);
    else if (c.status === "not_approved") refusals.push(`${c.id} is not approved: ${c.note}`);
    const why = access(ctx, c.provider);
    if (why && !refusals.includes(why)) refusals.push(why);
  }

  // 2 the request's shape
  const discover = chain[0];
  const verifies = chain.filter((c) => c.role === "verify_company");
  const peopleStep = chain.find((c) => c.role === "discover_people" || c.role === "people_at_companies");
  if (spec.wantsPeople && !peopleStep) refusals.push(`the request asks for people (${spec.roles.join(", ") || "decision-makers"}) and ${strategy} has no approved people source`);
  const hiring = spec.signals.find((s) => s.kind === "hiring");
  if (discover.discoversBySignal === "hiring" && !hiring) refusals.push("job-search discovery finds employers by an open role; the request names no hiring signal");
  if (discover.discoversBySignal === "hiring" && hiring && !hiringTitles(spec).length) refusals.push("the hiring signal names no role to search postings for");

  // 3 what can be PROVED (the shared engine decides; this predicts honestly)
  const proves = new Set(chain.flatMap((c) => c.proves));
  const provable: string[] = [];
  // Identity is a fact too: a discovery row's employer can be the wrong company (LeadOcean: 5 of 17 HQs wrong).
  if (proves.has("identity")) provable.push("company identity");
  const need =(label: string, ok: boolean, hard: boolean) => {
    if (ok) provable.push(label);
    else if (hard) limitations.push({ code: "unverifiable_requirement", detail: `${label}: no step of ${strategy} can prove it; leads stay needs_verification on it` });
  };
  if (spec.geography.length) need(`headquarters in ${spec.geography.join(" or ")}`, proves.has("headquarters"), true);
  if (spec.employees) need(`size ${spec.employees.min ?? "?"}–${spec.employees.max ?? "?"} employees`, proves.has("size_band"), true);
  if (spec.industry.length) limitations.push({ code: "unverifiable_requirement", detail: `industry "${spec.industry.join(", ")}": a taxonomy label proves no industry; it narrows discovery only and leads stay needs_verification on it` });
  for (const s of spec.signals) {
    const label = `${s.kind} signal${s.windowDays ? ` (last ${s.windowDays} days)` : ""}`;
    if (s.kind === "hiring") {
      need(label, proves.has("hiring"), s.hard);
      if (!proves.has("hiring") && !s.hard) limitations.push({ code: "signal_not_discoverable", detail: `the request is defined by a ${label}; ${strategy} neither discovers by it nor proves it, so it can only rank — candidates will mostly lack it` });
    }
    else if (s.kind === "funding") {
      need(label, false, s.hard);
      limitations.push({ code: "capability_not_approved", detail: DISCOVERY_CAPABILITIES["apify.funding_corroboration"].note });
      if (chain.some((c) => c.claims.includes("funding"))) limitations.push({ code: "unverified_claim", detail: "LeadOcean company_funding is a claim (a year alone is not a date; public-company securities included) — ranking only" });
    } else if (s.kind === "social_activity") {
      need(label, false, s.hard);
      limitations.push({ code: "signal_not_discoverable", detail: `${DISCOVERY_CAPABILITIES["apify.linkedin_post_search"].note}; posts can only be read per company after discovery (ranking)` });
    } else need(label, false, s.hard);
  }
  if (spec.otherHard.length) limitations.push({ code: "unverifiable_requirement", detail: `not modelled by the planner, decided by the shared engine only: ${spec.otherHard.join("; ")}` });
  if (chain.some((c) => c.provider === "leadocean") && !verifies.length) {
    limitations.push({ code: "unverified_claim", detail: "LeadOcean HQ, size and funding are claims; with no Apify company record every lead stays needs_verification" });
  }
  if (discover.id === "apify.linkedin_job_search") limitations.push({ code: "fuzzy_source", detail: "job-search titles are fuzzy: each posting must match the requested role and window before it counts" });

  // A hard requirement no step proves means nothing bought can become eligible.
  const unprovable = limitations.filter((l) => l.code === "unverifiable_requirement" && !l.detail.startsWith("industry") && !l.detail.startsWith("not modelled"));
  if (unprovable.length && !ctx.user?.allowReviewOnly) {
    refusals.push(`no lead could become eligible: ${unprovable.map((l) => l.detail.split(":")[0]).join("; ")} cannot be proven (set allowReviewOnly to buy candidates for manual review)`);
  }

  // 4 forbidden broadening: a required filter the discovery step cannot apply
  if (spec.forbidBroadening.includes("geography") && spec.geography.length && !discover.filters.includes("geography") && !proves.has("headquarters")) {
    refusals.push("geography may not be broadened and no step filters or proves it");
  }

  // 5 cost: size the chain for the request, then shrink discovery until the
  // worst case fits both ceilings (stated as budget_limited), or refuse if not even one fits.
  const peoplePer = Math.max(1, Math.min(3, ctx.peoplePerCompany ?? 1));
  const sized = (cap: number) => {
    const out: StrategyStep[] = [];
    let companies = 0;
    for (const c of chain) {
      const remaining = ctx.providers[c.provider]?.remaining ?? Infinity;
      if (c.role === "discover_people") {
        const max = Math.max(0, Math.min(cap, ctx.budget.maxLeadoceanRecords, remaining, 150));
        companies = max;
        out.push({ capability: c.id, provider: c.provider, role: c.role, maxItems: max, estimate: { leadoceanRecords: c.cost.unit === "leadocean_record" ? max * c.cost.perRow : 0, apifyUsd: 0 }, why: "people and employers matching roles, geography, size and industry labels (narrowing only)" });
      } else if (c.role === "discover_companies") {
        const max = Math.max(1, Math.min(100, cap * JOB_ROWS_PER_COMPANY));
        companies = Math.ceil(max / JOB_ROWS_PER_COMPANY);
        out.push({ capability: c.id, provider: c.provider, role: c.role, maxItems: max, estimate: { leadoceanRecords: 0, apifyUsd: usd(c, max) }, why: `employers with an open ${hiringTitles(spec).join(" / ") || "role"} posting${hiring?.windowDays ? ` in the last ${hiring.windowDays} days` : ""}` });
      } else if (c.role === "people_at_companies") {
        const max = Math.max(0, Math.min(companies * peoplePer, ctx.budget.maxLeadoceanRecords, remaining, 150));
        out.push({ capability: c.id, provider: c.provider, role: c.role, maxItems: max, estimate: { leadoceanRecords: max, apifyUsd: 0 }, why: `${spec.roles.join(" / ") || "decision-makers"} at the discovered companies, by exact domain` });
      } else if (c.role === "verify_company") {
        const max = Math.max(0, Math.min(100, companies - (ctx.cachedCompanyRecords ?? 0)));
        out.push({ capability: c.id, provider: c.provider, role: c.role, maxItems: Math.max(1, max), estimate: { leadoceanRecords: 0, apifyUsd: max ? usd(c, max) : 0 }, why: "identity, HQ-flagged location and declared size band for each discovered company (one batched run)" });
      }
    }
    const est = { leadoceanRecords: out.reduce((a, x) => a + x.estimate.leadoceanRecords, 0), apifyUsd: r6(out.reduce((a, x) => a + x.estimate.apifyUsd, 0)) };
    return { steps: out, estimate: est, fits: est.apifyUsd <= ctx.budget.maxApifyUsd + 1e-9 && est.leadoceanRecords <= ctx.budget.maxLeadoceanRecords };
  };
  const wanted = n * OVERFETCH;
  let size = wanted;
  let plan = sized(size);
  while (!plan.fits && size > 1) { size = Math.max(1, Math.floor(size * 0.9)); plan = sized(size); }
  const { steps, estimate } = plan;
  if (!plan.fits) refusals.push(`not even one company fits the ceilings ($${ctx.budget.maxApifyUsd} Apify, ${ctx.budget.maxLeadoceanRecords} LeadOcean records): worst case $${estimate.apifyUsd}, ${estimate.leadoceanRecords} records`);
  if (steps.some((s) => (s.role === "discover_people" || s.role === "people_at_companies") && s.maxItems < 1)) refusals.push("LeadOcean budget or allowance too small for one record");
  const discovered = steps[0]?.role === "discover_companies" ? Math.ceil(steps[0].maxItems / JOB_ROWS_PER_COMPANY) : steps[0]?.maxItems ?? 0;
  if (plan.fits && discovered < wanted && discovered < n) {
    limitations.push({ code: "budget_limited", detail: `the ceilings allow discovering about ${discovered} companies for ${n} requested; fewer leads may result` });
  } else if (plan.fits && size < wanted) {
    limitations.push({ code: "budget_limited", detail: `discovery overfetch reduced to ${discovered} candidates for ${n} requested to fit the ceilings` });
  }

  // 6 score (feasible candidates only are compared)
  let score = provable.length * 10;
  if (hiring && discover.discoversBySignal === "hiring") { score += 25; rationale.push("discovers BY the requested hiring signal (dated postings), so every candidate already carries it"); }
  if (hiring && discover.discoversBySignal !== "hiring") { score -= 15; rationale.push("discovers without the hiring signal: most candidates will not carry it"); }
  if (!hiring && discover.role === "discover_people") { score += 10; rationale.push("structured people search matches roles, geography and size directly"); }
  if (verifies.length) rationale.push("Apify company record proves identity, HQ and size for the shared engine");
  score -= estimate.apifyUsd * 20 + estimate.leadoceanRecords * 0.05;
  score -= limitations.filter((l) => l.code === "unverifiable_requirement" || l.code === "unverified_claim").length * 3;

  return { strategy, feasible: refusals.length === 0, refusals, steps, limitations, estimate, provable, score: Math.round(score * 100) / 100, rationale };
}

// ── GPT advice (optional, validated) ────────────────────────────────────────

export const STRATEGY_ADVISOR_SYSTEM_PROMPT = [
  "You choose how Agentory discovers leads for one request.",
  "You are given the request, what it requires, and the discovery strategies that are ALREADY permitted, each with what it can prove, its limitations and its relative cost.",
  "Pick exactly one of the permitted strategy ids. You cannot add a strategy, a provider, an actor, a price or a budget.",
  "Prefer the strategy that discovers by the signal the request is defined by, proves the most hard requirements, and costs least.",
  'Answer JSON only: {"strategy": "<one permitted id>", "rationale": "<one sentence>"}.',
].join("\n");

/** Ask the model to pick among the feasible strategies. Never throws; a failure is no advice. */
export async function adviseStrategy(spec: DiscoverySpec, candidates: readonly StrategyCandidate[], generate: GenerateJsonFn | null, workspaceId?: string): Promise<{ proposed: DiscoveryStrategyId | null; rationale: string; model: string | null; error: string | null }> {
  const permitted = candidates.filter((c) => c.feasible);
  if (!generate || permitted.length === 0) return { proposed: null, rationale: "", model: null, error: generate ? "no permitted strategy" : null };
  const payload = {
    request: spec.query,
    requires: { people: spec.wantsPeople, roles: spec.roles, geography: spec.geography, employees: spec.employees, industry: spec.industry, signals: spec.signals.map((s) => ({ kind: s.kind, hard: s.hard, windowDays: s.windowDays })) },
    permitted: permitted.map((c) => ({ id: c.strategy, proves: c.provable, limitations: c.limitations.map((l) => l.detail), relativeCost: Math.round((c.estimate.apifyUsd * 100 + c.estimate.leadoceanRecords) * 10) / 10 })),
  };
  try {
    const res = await generate({ taskType: "orchestration_plan", jsonMode: true, temperature: 0, maxTokens: 300, systemPrompt: STRATEGY_ADVISOR_SYSTEM_PROMPT, functionName: "lead-pipeline-strategy", workspaceId, messages: [{ role: "user", content: JSON.stringify(payload) }] } as never);
    if (!res.ok) return { proposed: null, rationale: "", model: res.model ?? null, error: res.error ?? "model call failed" };
    const j = (res.json ?? (() => { try { return JSON.parse(res.content); } catch { return null; } })()) as { strategy?: unknown; rationale?: unknown } | null;
    const proposed = j && isStrategy(j.strategy) ? j.strategy : null;
    return { proposed, rationale: typeof j?.rationale === "string" ? j.rationale.slice(0, 400) : "", model: res.model ?? null, error: proposed ? null : `unrecognised strategy ${JSON.stringify(j?.strategy ?? null)}` };
  } catch (e) {
    return { proposed: null, rationale: "", model: null, error: `model call threw: ${(e as Error)?.message ?? e}` };
  }
}

// ── The planner ─────────────────────────────────────────────────────────────

/**
 * Judge every strategy deterministically, then pick: the user's stated strategy
 * (if feasible — otherwise the plan is BLOCKED with the reason, never switched),
 * else the model's advice (if feasible), else the best-scoring feasible one.
 */
export function planStrategy(spec: DiscoverySpec, ctx: StrategyContext, advice?: { proposed: DiscoveryStrategyId | null; rationale: string; model: string | null; error: string | null } | null): StrategyPlan {
  const candidates = DISCOVERY_STRATEGIES.map((s) => judge(s, spec, ctx));
  const feasible = candidates.filter((c) => c.feasible).sort((a, b) => b.score - a.score || DISCOVERY_STRATEGIES.indexOf(a.strategy) - DISCOVERY_STRATEGIES.indexOf(b.strategy));
  let chosen: StrategyCandidate | null = null;
  let selectedBy: StrategyPlan["selectedBy"] = null;
  let blockedReason: string | null = null;
  let modelAdvice: ModelAdvice | null = null;

  const forced = ctx.user?.strategy;
  if (forced) {
    const c = candidates.find((x) => x.strategy === forced)!;
    if (c.feasible) { chosen = c; selectedBy = "user"; }
    else blockedReason = `the requested strategy ${forced} cannot run: ${c.refusals.join("; ")}`;
  } else {
    if (advice) {
      const c = advice.proposed ? candidates.find((x) => x.strategy === advice.proposed) : null;
      const accepted = !!c?.feasible;
      modelAdvice = {
        proposed: advice.proposed, rationale: advice.rationale, accepted, model: advice.model,
        reason: accepted ? "the proposed strategy passed every deterministic check"
          : advice.error ? `no usable advice: ${advice.error}`
          : `rejected: ${c?.refusals.join("; ") ?? "unknown strategy"}`,
      };
      if (accepted) { chosen = c!; selectedBy = "model"; }
    }
    if (!chosen && feasible.length) { chosen = feasible[0]; selectedBy = "deterministic"; }
    if (!chosen) blockedReason = `no strategy can satisfy the request: ${candidates.map((c) => `${c.strategy} — ${c.refusals[0]}`).join(" | ")}`;
  }

  const rationale = chosen ? [
    ...(selectedBy === "user" ? ["the request named this strategy and it passed every check"] : []),
    ...(selectedBy === "model" ? [`model: ${modelAdvice!.rationale || "(no rationale)"}`] : []),
    ...chosen.rationale,
    ...candidates.filter((c) => c !== chosen).map((c) => c.feasible ? `${c.strategy}: feasible, scored ${c.score} vs ${chosen!.score}` : `${c.strategy}: ${c.refusals[0]}`),
  ] : [];
  const body = { strategy: chosen?.strategy ?? null, steps: chosen?.steps ?? [], limitations: chosen?.limitations ?? [], estimate: chosen?.estimate ?? null, spec: { q: spec.query, n: spec.requestedCount, criteria: spec.requirements.criteria.map((c) => c.id) } };
  return {
    version: STRATEGY_PLANNER_VERSION,
    status: chosen ? "ready" : "blocked",
    blockedReason,
    strategy: chosen?.strategy ?? null,
    selectedBy: chosen ? selectedBy : null,
    rationale,
    steps: chosen?.steps ?? [],
    limitations: chosen?.limitations ?? [],
    estimate: chosen?.estimate ?? { leadoceanRecords: 0, apifyUsd: 0 },
    candidates,
    modelAdvice,
    planHash: stableHash(body),
  };
}

// ── Bridges to the existing pipeline ────────────────────────────────────────

/** An ICP for ranking and LeadOcean narrowing, from the spec. Narrowing never qualifies. */
export function icpFromSpec(spec: DiscoverySpec): IcpConfig {
  const industry = spec.industry.filter((v) => translate("leadocean", "people_search", { criterionId: "x", key: "industry", values: [v], label: v, representable: true }).ok);
  const icp = configureIcp(ICP_A, {
    label: spec.query.slice(0, 120), query: spec.query, requestedCount: spec.requestedCount,
    employees: { min: spec.employees?.min ?? 1, max: spec.employees?.max ?? 1_000_000 },
    roleTitles: spec.roles.length ? spec.roles : ["Founder", "Co-Founder", "CEO", "Owner"],
    // Decision-maker bands either way: a company request still needs someone to review for outreach.
    leadocean: { industry, seniority: spec.roles.length ? ["owner", "founder", "c_suite", "vp", "head", "partner"] : ["owner", "founder", "c_suite"], excludeTitle: NON_DECISION_TITLES, personCountry: undefined },
    relevance: { positive: spec.industry.map((x) => x.toLowerCase()), negative: [], industryLabels: industry },
  });
  return { ...icp, id: `spec:${stableHash({ q: spec.query, c: spec.requirements.criteria.map((c) => c.id) })}` };
}

/**
 * The requirements a LeadOcean search is planned on: the compiler's requirements
 * minus what LeadOcean cannot filter exactly (signals; an industry word with no
 * exact label). Those are NOT dropped from qualification — `criteria` is the
 * shared engine's input and is passed untouched — they just do not narrow the
 * search. Every one of them is already a limitation on the plan.
 */
export function leadoceanDiscoveryRequirements(spec: DiscoverySpec): DiscoveryRequirements {
  const r = spec.requirements;
  const hard = r.hard.filter((h) => {
    if (h.key === "signal" || h.key === "unmappable") return false;
    if (h.key === "industry") return translate("leadocean", "people_search", h).ok;
    return true;
  });
  return { ...r, targetEntity: "person", hard };
}
