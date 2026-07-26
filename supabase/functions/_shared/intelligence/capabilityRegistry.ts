// SHARED CAPABILITY REGISTRY — what a planner is allowed to ask for.
//
// A planner selects a CAPABILITY KEY ("jobs_search"). It never sees, names or
// influences the thing that actually runs. The binding from key to implementation
// stays on this side of the boundary.
//
// RELATIONSHIP TO `_shared/actorCapabilityRegistry.ts`. That registry already
// describes what each ACTOR can prove and what it costs, and it is the right place
// for that. It is also actor-shaped and carries `implementationId` — the raw Apify
// actor id. Handing it to a model would put provider identifiers in a prompt and
// let a planner reason about actors instead of outcomes.
//
// So this module is a PROJECTION over it, not a replacement:
//
//   actorCapabilityRegistry   "harvestapi/linkedin-profile-search can prove
//                              person_identity, costs medium"      ← internal
//   this registry             "people_search finds people by title and location"
//                                                                  ← planner-facing
//
// `adapter_key` is the join. `resolveAdapterKey()` is the ONLY way back to an
// implementation, and it refuses anything not registered, enabled and callable.
//
// PURE. No network, no environment reads, no provider calls.

import {
  ACTOR_CAPABILITIES,
  getActorCapability,
  isCallable,
  type ActorCapability,
} from "../actorCapabilityRegistry.ts";
import type { AgentoryDepartment, AgentoryEnvironmentMode } from "./mission.ts";

export type CapabilityDepartment = AgentoryDepartment | "shared";

export interface CapabilitySupports {
  titles?: boolean;
  keywords?: boolean;
  locations?: boolean;
  countries?: boolean;
  languages?: boolean;
  company_urls?: boolean;
  company_names?: boolean;
  company_keywords?: boolean;
  current_companies?: boolean;
  current_titles?: boolean;
  date_window?: boolean;
  domain_research?: boolean;
  social_posts?: boolean;
  content_drafting?: boolean;
}

export interface AgentoryCapability {
  key: string;
  department: CapabilityDepartment;
  purpose: string;
  supports: CapabilitySupports;
  limits: {
    maximum_results?: number;
    maximum_calls_per_round: number;
  };
  cost_model: {
    type: "per_call" | "per_record" | "estimated";
    estimated_cost_usd?: number;
  };
  coverage: {
    countries: string[];
    languages: string[];
    global: boolean;
  };
  strengths: string[];
  weaknesses: string[];
  /** Internal join key into the actor registry. NEVER rendered into a prompt. */
  adapter_key: string;
  enabled_environments: Array<AgentoryEnvironmentMode>;
  /**
   * DEFINITION-ONLY capabilities describe planned work with no implementation. They
   * are never selectable and never executable — they exist so the roadmap lives in
   * one place instead of in a document that drifts from the code.
   */
  definition_only?: true;
  definition_note?: string;
}

const ALL_ENVIRONMENTS: AgentoryEnvironmentMode[] = ["development", "test", "production"];

// --------------------------------------------------------- lead capabilities --
//
// Every entry below binds to a capability whose `verifiedBinding` is true in
// actorCapabilityRegistry.ts. That is asserted by a test, so a binding that is
// removed or renamed fails the suite instead of failing in production.

const LEAD_CAPABILITIES: AgentoryCapability[] = [
  {
    key: "jobs_search",
    department: "leads",
    purpose: "Find companies that are actively hiring for a role, using the job posting as the timing signal.",
    supports: { titles: true, keywords: true, locations: true, countries: true, date_window: true, company_keywords: true },
    limits: { maximum_results: 25, maximum_calls_per_round: 3 },
    cost_model: { type: "per_record" },
    coverage: { countries: [], languages: [], global: true },
    strengths: ["Proves a company is hiring right now", "Yields the hiring company, not just the role"],
    weaknesses: ["A posting is not proof the company matches the ICP", "Aggregator reposts can duplicate a company"],
    adapter_key: "apify_jobs",
    enabled_environments: ALL_ENVIRONMENTS,
  },
  {
    key: "people_search",
    department: "leads",
    purpose: "Find people by title, seniority and location, independent of any specific company.",
    supports: { titles: true, keywords: true, locations: true, countries: true, current_titles: true, current_companies: true },
    limits: { maximum_results: 25, maximum_calls_per_round: 3 },
    cost_model: { type: "per_record" },
    coverage: { countries: [], languages: [], global: true },
    strengths: ["Direct decision-maker discovery", "Structured title and location filters"],
    weaknesses: ["Current-employer accuracy varies", "Cannot prove the company is hiring"],
    adapter_key: "apify_people_search",
    enabled_environments: ALL_ENVIRONMENTS,
  },
  {
    key: "company_research",
    department: "leads",
    purpose: "Retrieve structured firmographics for an already-identified company.",
    supports: { company_urls: true, company_names: true, domain_research: true },
    limits: { maximum_results: 8, maximum_calls_per_round: 2 },
    cost_model: { type: "per_record" },
    coverage: { countries: [], languages: [], global: true },
    strengths: ["Cheap", "Authoritative size, industry and geography"],
    weaknesses: ["Enrichment only — cannot discover new companies"],
    adapter_key: "apify_linkedin_company_details",
    enabled_environments: ALL_ENVIRONMENTS,
  },
  {
    key: "contact_enrichment",
    department: "leads",
    purpose: "Find people at a KNOWN company, to resolve a decision-maker for an identified account.",
    supports: { titles: true, current_companies: true, company_names: true, company_urls: true },
    limits: { maximum_results: 25, maximum_calls_per_round: 2 },
    cost_model: { type: "per_record" },
    coverage: { countries: [], languages: [], global: true },
    strengths: ["Anchored to a verified company", "Strong current-employer association"],
    weaknesses: ["Requires the company to be identified first"],
    adapter_key: "apify_linkedin_company_employees",
    enabled_environments: ALL_ENVIRONMENTS,
  },
  {
    key: "company_identity_resolution",
    department: "leads",
    purpose: "Resolve a company's canonical website and identity from its domain or name.",
    supports: { company_urls: true, company_names: true, domain_research: true },
    limits: { maximum_results: 3, maximum_calls_per_round: 1 },
    cost_model: { type: "per_call" },
    coverage: { countries: [], languages: [], global: true },
    strengths: ["Works without a LinkedIn presence", "Current web content"],
    weaknesses: ["Expensive per call", "Unstructured output needs interpretation"],
    adapter_key: "firecrawl_scrape_url",
    enabled_environments: ALL_ENVIRONMENTS,
  },
];

// -------------------------------------------------- definition-only entries ---
//
// NO ADAPTER EXISTS for these. They are registered as `definition_only` with an
// empty `enabled_environments`, which makes them unselectable by construction:
// `isCapabilitySelectable` requires both a callable binding and the current
// environment, and neither can ever be satisfied here. Creating a placeholder
// adapter to "wire them up" would be creating a fake capability.

const DEFINITION_ONLY: AgentoryCapability[] = [
  defn("jobs_signal_monitoring", "signals", "Watch hiring activity over time and emit a change signal."),
  defn("company_news_monitoring", "signals", "Watch company news and announcements."),
  defn("website_change_detection", "signals", "Detect meaningful changes to a company's website."),
  defn("social_signal_monitoring", "signals", "Watch social activity for buying and expansion signals."),
  defn("competitor_monitoring", "signals", "Watch named competitors for positioning changes."),
  defn("trend_research", "content", "Research current topics relevant to the workspace's audience."),
  defn("company_evidence_retrieval", "content", "Retrieve evidence supporting a specific claim."),
  defn("content_drafting", "content", "Draft content grounded in retrieved evidence."),
  defn("content_claim_verification", "content", "Verify that a drafted claim is supported by evidence."),
  defn("performance_analysis", "content", "Analyse published content performance."),
];

function defn(key: string, department: CapabilityDepartment, purpose: string): AgentoryCapability {
  return {
    key, department, purpose,
    supports: {},
    limits: { maximum_calls_per_round: 0 },
    cost_model: { type: "estimated" },
    coverage: { countries: [], languages: [], global: false },
    strengths: [], weaknesses: ["No implementation exists yet."],
    adapter_key: "",
    enabled_environments: [],
    definition_only: true,
    definition_note: "Documented for the roadmap. No adapter exists; this can never be selected or executed.",
  };
}

export const AGENTORY_CAPABILITIES: Record<string, AgentoryCapability> = Object.fromEntries(
  [...LEAD_CAPABILITIES, ...DEFINITION_ONLY].map((c) => [c.key, c]),
);

// ------------------------------------------------------------- the gateway ---

export type CapabilityRejection =
  | "unknown_capability"
  | "definition_only"
  | "wrong_department"
  | "environment_unavailable"
  | "no_verified_binding";

export type CapabilityDecision =
  | { ok: true; capability: AgentoryCapability }
  | { ok: false; reason: CapabilityRejection };

export function getCapability(key: string | null | undefined): AgentoryCapability | null {
  if (!key || typeof key !== "string") return null;
  return AGENTORY_CAPABILITIES[key] ?? null;
}

/**
 * The ONE gate. Every check must pass; there is no partial admission and no
 * "warn and continue". A planner naming something not registered, not implemented,
 * belonging to another department, or not enabled in this environment gets nothing.
 */
export function decideCapability(
  key: string | null | undefined,
  opts: { department: CapabilityDepartment; environment: AgentoryEnvironmentMode },
): CapabilityDecision {
  const cap = getCapability(key);
  if (!cap) return { ok: false, reason: "unknown_capability" };
  if (cap.definition_only) return { ok: false, reason: "definition_only" };

  // "shared" capabilities serve any department; anything else must match exactly.
  if (cap.department !== "shared" && cap.department !== opts.department) {
    return { ok: false, reason: "wrong_department" };
  }
  if (!cap.enabled_environments.includes(opts.environment)) {
    return { ok: false, reason: "environment_unavailable" };
  }
  // The binding must still be real and callable in the actor registry.
  if (!isCallable(getActorCapability(cap.adapter_key))) {
    return { ok: false, reason: "no_verified_binding" };
  }
  return { ok: true, capability: cap };
}

export function isCapabilitySelectable(
  key: string | null | undefined,
  opts: { department: CapabilityDepartment; environment: AgentoryEnvironmentMode },
): boolean {
  return decideCapability(key, opts).ok;
}

/** Capability keys a planner may choose from, for this department and environment. */
export function selectableCapabilityKeys(opts: {
  department: CapabilityDepartment;
  environment: AgentoryEnvironmentMode;
}): string[] {
  return Object.keys(AGENTORY_CAPABILITIES)
    .filter((k) => isCapabilitySelectable(k, opts))
    .sort();
}

/**
 * Resolve a capability key to its adapter key. The ONLY crossing of the boundary,
 * and it re-runs the full gate rather than trusting that the caller already did.
 */
export function resolveAdapterKey(
  key: string | null | undefined,
  opts: { department: CapabilityDepartment; environment: AgentoryEnvironmentMode },
): string | null {
  const decision = decideCapability(key, opts);
  return decision.ok ? decision.capability.adapter_key : null;
}

/** Enforce a capability's own result ceiling. A planner cannot raise it. */
export function clampResultLimit(cap: AgentoryCapability, requested: number): number {
  const ceiling = cap.limits.maximum_results ?? 0;
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  return Math.min(Math.floor(requested), ceiling);
}

export function clampCallsPerRound(cap: AgentoryCapability, requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  return Math.min(Math.floor(requested), cap.limits.maximum_calls_per_round);
}

// --------------------------------------------------- the planner projection ---

/** Exactly the fields a planner may see. `adapter_key` is absent BY CONSTRUCTION. */
export interface PlannerVisibleCapability {
  key: string;
  purpose: string;
  supports: CapabilitySupports;
  maximum_results?: number;
  maximum_calls_per_round: number;
  cost_model: AgentoryCapability["cost_model"];
  coverage: AgentoryCapability["coverage"];
  strengths: string[];
  weaknesses: string[];
}

/**
 * Project a capability for a prompt.
 *
 * Built by naming each permitted field, never by deleting from a spread — a spread
 * plus delete leaks every field added later, which is exactly how an actor id
 * eventually reaches a prompt.
 */
export function toPlannerVisible(cap: AgentoryCapability): PlannerVisibleCapability {
  return {
    key: cap.key,
    purpose: cap.purpose,
    supports: { ...cap.supports },
    ...(cap.limits.maximum_results !== undefined ? { maximum_results: cap.limits.maximum_results } : {}),
    maximum_calls_per_round: cap.limits.maximum_calls_per_round,
    cost_model: { ...cap.cost_model },
    coverage: { ...cap.coverage, countries: [...cap.coverage.countries], languages: [...cap.coverage.languages] },
    strengths: [...cap.strengths],
    weaknesses: [...cap.weaknesses],
  };
}

/** The capability menu for a prompt: selectable only, deterministic order. */
export function plannerCapabilityMenu(opts: {
  department: CapabilityDepartment;
  environment: AgentoryEnvironmentMode;
}): PlannerVisibleCapability[] {
  return selectableCapabilityKeys(opts).map((k) => toPlannerVisible(AGENTORY_CAPABILITIES[k]));
}

/** Internal use only — never rendered. Kept so tests can assert the binding exists. */
export function underlyingActor(cap: AgentoryCapability): ActorCapability | null {
  return getActorCapability(cap.adapter_key);
}

export { ACTOR_CAPABILITIES };
