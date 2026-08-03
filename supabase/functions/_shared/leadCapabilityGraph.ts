// THE CAPABILITY GRAPH — lock the mission, not the individual Actor.
//
// WHY A GRAPH RATHER THAN MORE ROUTE NAMES.
//
// `hiringRouteContract` bounded three routes, which was a real improvement over
// an unbounded default. But three names cannot express "enrich these domains I
// already have", "find 100 job listings", or "recently funded cybersecurity
// companies" without becoming thirty names, and thirty names is a taxonomy
// nobody maintains. A graph composes: each mission assembles the capabilities it
// needs, and the SAME capability definitions serve all of them.
//
// WHAT IS LOCKED AND WHAT IS FREE.
//
//   LOCKED (deterministic): which capabilities may run, in what order, and which
//   providers each capability may reach. This is the containment boundary.
//
//   FREE (planner): which allowed provider to try first, whether to fall back
//   within a capability, and how to spend the attempt budget.
//
// A planner may prefer solidcode over memo23 for a round. It may not decide that
// zero startup results justify Indeed — that is a different capability, and
// capabilities are not reachable unless the mission put them in the graph.
//
// PROVIDER IDS LIVE IN `hiringActorCatalog`. This module names actor KEYS and
// resolves nothing itself, so there is no second registry to drift.
//
// PURE. No network, provider, model or database access.

import type { LeadMissionV1 } from "./leadMission.ts";

export const CAPABILITY_GRAPH_VERSION = "lead-capability-graph-v1" as const;

// ------------------------------------------------------------ capability ----

export const CAPABILITY_IDS = [
  // discovery — mutually exclusive entry points
  "startup_company_discovery",
  "general_company_discovery",
  "known_company_resolution",
  "job_discovery",
  "funding_signal_discovery",
  "expansion_signal_discovery",
  // company pipeline
  "company_identity_resolution",
  "company_enrichment",
  "hiring_verification",
  "expansion_signal_verification",
  "company_brain_qualification",
  // people pipeline
  "founder_discovery",
  "employer_verification",
  "contact_enrichment",
  // terminal
  "job_deduplication",
  "persistence",
] as const;

export type CapabilityId = typeof CAPABILITY_IDS[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(CAPABILITY_IDS);

export function isCapabilityId(s: string): s is CapabilityId {
  return CAPABILITY_SET.has(s);
}

/** What a capability does when its providers are exhausted. */
export type FallbackPolicy =
  /** Try the next provider inside this capability, then stop. */
  | "provider_fallback_only"
  /** Nothing to fall back to; exhaustion is a terminal, reportable state. */
  | "terminal_on_exhaustion"
  /** May leave the capability only with recorded user approval. */
  | "requires_user_approval";

export interface CapabilitySpec {
  id: CapabilityId;
  /** Human label for the preview card. */
  label: string;
  /** Mission/graph facts that must hold before this may run. */
  requires: string[];
  /** What downstream capabilities may consume. */
  produces: string[];
  /** The ONLY capabilities reachable from here. */
  allowed_next: CapabilityId[];
  /**
   * Approved provider actor keys, in preference order. The planner may reorder
   * WITHIN this list; it may not add to it. Empty = no provider (pure code).
   */
  providers: string[];
  /** Relative cost units, for budget forecasting. */
  cost_units: number;
  max_attempts: number;
  fallback_policy: FallbackPolicy;
  /** Evidence this capability must produce for the next one to be legitimate. */
  evidence_required: string[];
}

/**
 * THE REGISTRY.
 *
 * `providers` maps a business capability onto approved Actor keys. A planner
 * never sees an Actor id; `hiringActorCatalog` resolves keys to ids, keeps the
 * verified enums and enforces input limits. That separation is why GPT cannot
 * name `memo23/y-combinator-scraper` — it has no field in which to say it.
 */
export const CAPABILITY_REGISTRY: Readonly<Record<CapabilityId, CapabilitySpec>> = Object.freeze({
  startup_company_discovery: {
    id: "startup_company_discovery",
    label: "Discover startup companies",
    requires: ["company_profile.stages includes startup"],
    produces: ["company_candidate"],
    allowed_next: ["company_identity_resolution"],
    // memo23 PRIMARY, solidcode FALLBACK. Order is the contract, not a hint.
    providers: ["apify_yc_companies_memo23", "apify_yc_companies_solidcode"],
    cost_units: 1,
    max_attempts: 2,
    fallback_policy: "provider_fallback_only",
    evidence_required: ["company_name"],
  },
  general_company_discovery: {
    id: "general_company_discovery",
    label: "Discover companies by profile",
    requires: ["company_profile.verticals or company_profile.locations"],
    produces: ["company_candidate"],
    allowed_next: ["company_identity_resolution"],
    providers: ["apify_linkedin_company_search"],
    cost_units: 1,
    max_attempts: 2,
    fallback_policy: "terminal_on_exhaustion",
    evidence_required: ["company_name"],
  },
  known_company_resolution: {
    id: "known_company_resolution",
    label: "Resolve supplied companies",
    requires: ["company_profile.known_companies is non-empty"],
    produces: ["company_candidate"],
    allowed_next: ["company_identity_resolution", "company_enrichment"],
    providers: [],
    cost_units: 0,
    max_attempts: 1,
    fallback_policy: "terminal_on_exhaustion",
    evidence_required: ["company_domain"],
  },
  job_discovery: {
    id: "job_discovery",
    label: "Discover job postings",
    requires: ["requested_output is job_listings, or job_discovery explicitly allowed"],
    produces: ["job_posting"],
    allowed_next: ["job_deduplication", "company_identity_resolution"],
    providers: [
      "apify_jobs", "apify_linkedin_jobs_crawlworks",
      "apify_indeed_jobs_automation_lab", "apify_glassdoor_jobs",
    ],
    cost_units: 1,
    max_attempts: 3,
    fallback_policy: "provider_fallback_only",
    evidence_required: ["job_title", "company_name"],
  },
  funding_signal_discovery: {
    id: "funding_signal_discovery",
    label: "Discover recently funded companies",
    requires: ["required_signals includes funding"],
    produces: ["company_candidate", "funding_signal"],
    allowed_next: ["company_identity_resolution"],
    providers: ["apify_yc_companies_memo23"],
    cost_units: 1,
    max_attempts: 2,
    fallback_policy: "terminal_on_exhaustion",
    evidence_required: ["company_name", "funding_event"],
  },
  expansion_signal_discovery: {
    id: "expansion_signal_discovery",
    label: "Discover expanding companies",
    requires: ["required_signals includes expansion"],
    produces: ["company_candidate", "expansion_signal"],
    allowed_next: ["company_identity_resolution"],
    providers: ["apify_linkedin_company_search"],
    cost_units: 1,
    max_attempts: 2,
    fallback_policy: "terminal_on_exhaustion",
    evidence_required: ["company_name"],
  },

  company_identity_resolution: {
    id: "company_identity_resolution",
    label: "Resolve company identity",
    requires: ["company_candidate"],
    produces: ["company_identity"],
    allowed_next: ["company_enrichment"],
    providers: [],
    cost_units: 0,
    max_attempts: 1,
    fallback_policy: "terminal_on_exhaustion",
    evidence_required: ["canonical_domain or linkedin_company_url"],
  },
  company_enrichment: {
    id: "company_enrichment",
    label: "Enrich company",
    requires: ["company_identity"],
    produces: ["company_evidence"],
    // Enrichment ALWAYS precedes qualification. Qualifying on discovery-time
    // provider fields is what produced founder outreach to a job board.
    allowed_next: [
      "hiring_verification", "expansion_signal_verification", "company_brain_qualification",
    ],
    providers: ["apify_linkedin_company_details"],
    cost_units: 1,
    max_attempts: 2,
    fallback_policy: "provider_fallback_only",
    evidence_required: ["employee_count or industry_ids or description"],
  },
  hiring_verification: {
    id: "hiring_verification",
    label: "Verify hiring signal",
    requires: ["company_identity", "required_signals includes hiring"],
    produces: ["hiring_evidence"],
    allowed_next: ["company_brain_qualification"],
    providers: ["apify_linkedin_job_search"],
    cost_units: 1,
    max_attempts: 2,
    fallback_policy: "provider_fallback_only",
    evidence_required: ["job_title", "posted_date"],
  },
  expansion_signal_verification: {
    id: "expansion_signal_verification",
    label: "Verify expansion signal",
    requires: ["company_identity", "required_signals includes expansion"],
    produces: ["expansion_evidence"],
    allowed_next: ["company_brain_qualification"],
    providers: ["apify_linkedin_job_search"],
    cost_units: 1,
    max_attempts: 2,
    fallback_policy: "provider_fallback_only",
    evidence_required: ["location_evidence"],
  },
  company_brain_qualification: {
    id: "company_brain_qualification",
    label: "Qualify against Company Brain",
    requires: ["company_evidence"],
    produces: ["qualification_verdict"],
    allowed_next: ["founder_discovery", "persistence"],
    providers: [],
    cost_units: 0,
    max_attempts: 1,
    fallback_policy: "terminal_on_exhaustion",
    evidence_required: ["verdict", "reasons"],
  },

  founder_discovery: {
    id: "founder_discovery",
    label: "Find decision-makers",
    requires: ["qualification_verdict is pass"],
    produces: ["person_candidate"],
    allowed_next: ["employer_verification"],
    providers: ["apify_linkedin_company_employees", "apify_people_search"],
    cost_units: 1,
    max_attempts: 2,
    fallback_policy: "provider_fallback_only",
    evidence_required: ["person_name", "person_title"],
  },
  employer_verification: {
    id: "employer_verification",
    label: "Verify current employer",
    requires: ["person_candidate"],
    produces: ["employment_evidence"],
    allowed_next: ["contact_enrichment", "persistence"],
    providers: [],
    cost_units: 0,
    max_attempts: 1,
    fallback_policy: "terminal_on_exhaustion",
    evidence_required: ["employer_match"],
  },
  contact_enrichment: {
    id: "contact_enrichment",
    label: "Find contact method",
    requires: ["employment_evidence"],
    produces: ["contact_method"],
    allowed_next: ["persistence"],
    providers: ["apify_people_search"],
    cost_units: 1,
    max_attempts: 2,
    fallback_policy: "provider_fallback_only",
    evidence_required: ["email or profile_url"],
  },

  job_deduplication: {
    id: "job_deduplication",
    label: "Deduplicate job postings",
    requires: ["job_posting"],
    produces: ["unique_job_posting"],
    allowed_next: ["company_identity_resolution", "persistence"],
    providers: [],
    cost_units: 0,
    max_attempts: 1,
    fallback_policy: "terminal_on_exhaustion",
    evidence_required: ["job_url"],
  },
  persistence: {
    id: "persistence",
    label: "Persist results",
    requires: [],
    produces: ["persisted_record"],
    allowed_next: [],
    providers: [],
    cost_units: 0,
    max_attempts: 1,
    fallback_policy: "terminal_on_exhaustion",
    evidence_required: [],
  },
});

/** Every actor key any capability may reach. Used for containment assertions. */
export const ALL_GRAPH_PROVIDERS: ReadonlySet<string> = new Set(
  CAPABILITY_IDS.flatMap((c) => CAPABILITY_REGISTRY[c].providers),
);

/** Broad job-board keys. Reachable ONLY through `job_discovery`. */
export const BROAD_JOB_PROVIDERS: readonly string[] =
  CAPABILITY_REGISTRY.job_discovery.providers;

// ------------------------------------------------------------------ plan ----

export interface CapabilityStep {
  capability: CapabilityId;
  order: number;
  providers: string[];
  cost_units: number;
  max_attempts: number;
  fallback_policy: FallbackPolicy;
  /** Why this capability is in the plan. Persisted for audit. */
  reason: string;
}

export interface CapabilityPlan {
  version: typeof CAPABILITY_GRAPH_VERSION;
  steps: CapabilityStep[];
  /** Capabilities explicitly unreachable for this mission. */
  prohibited: CapabilityId[];
  /** Actor keys this mission may reach, across all its steps. */
  allowed_providers: string[];
  entry_capability: CapabilityId;
  estimated_cost_units: number;
}

function step(
  capability: CapabilityId, order: number, reason: string,
): CapabilityStep {
  const s = CAPABILITY_REGISTRY[capability];
  return {
    capability, order, reason,
    providers: [...s.providers],
    cost_units: s.cost_units,
    max_attempts: s.max_attempts,
    fallback_policy: s.fallback_policy,
  };
}

function hasSignal(m: LeadMissionV1, type: string): boolean {
  return m.required_signals.some((s) => s.type === type);
}

/**
 * Assemble the capability plan for a mission.
 *
 * The ENTRY capability is chosen from what the mission actually is, in a fixed
 * precedence: supplied companies beat discovery; a job-listing output beats
 * company discovery; a startup stage beats general discovery. Everything after
 * the entry follows from `allowed_next`, so an ordering that the registry does
 * not permit cannot be produced here.
 */
export function buildCapabilityGraph(mission: LeadMissionV1): CapabilityPlan {
  const steps: CapabilityStep[] = [];
  const known = mission.company_profile.known_companies ?? [];
  const wantsPeople = mission.requested_output === "contact_ready_leads" ||
    mission.target_entity === "person";

  let entry: CapabilityId;
  let entryReason: string;

  if (known.length > 0) {
    entry = "known_company_resolution";
    entryReason = `${known.length} company identifier(s) supplied by the user — discovery is skipped`;
  } else if (mission.requested_output === "job_listings") {
    entry = "job_discovery";
    entryReason = "the requested output is job listings";
  } else if (hasSignal(mission, "funding")) {
    entry = "funding_signal_discovery";
    entryReason = "the mission requires a funding signal";
  } else if (hasSignal(mission, "expansion")) {
    entry = "expansion_signal_discovery";
    entryReason = "the mission requires an expansion signal";
  } else if (mission.company_profile.stages.some((s) => /startup|seed|series a|early/.test(s))) {
    entry = "startup_company_discovery";
    entryReason = "the mission targets startups";
  } else {
    entry = "general_company_discovery";
    entryReason = "the mission targets companies by profile";
  }

  let order = 0;
  steps.push(step(entry, order++, entryReason));

  if (entry === "job_discovery") {
    steps.push(step("job_deduplication", order++, "job output must be deduplicated"));
    // A job mission enriches employers only when it also wants companies/people.
    if (wantsPeople || mission.requested_output === "enriched_companies") {
      steps.push(step("company_identity_resolution", order++, "employer enrichment was requested"));
      steps.push(step("company_enrichment", order++, "employer enrichment was requested"));
    }
  } else {
    if (entry !== "known_company_resolution") {
      steps.push(step("company_identity_resolution", order++, "candidates need a canonical identity before enrichment"));
    } else {
      steps.push(step("company_identity_resolution", order++, "supplied identifiers are resolved to canonical identities"));
    }
    // MANDATORY, and always BEFORE qualification.
    steps.push(step("company_enrichment", order++, "qualification requires enriched evidence, never discovery-time fields"));

    if (hasSignal(mission, "hiring")) {
      steps.push(step("hiring_verification", order++, "the mission requires a verified hiring signal"));
    }
    if (hasSignal(mission, "expansion")) {
      steps.push(step("expansion_signal_verification", order++, "the mission requires a verified expansion signal"));
    }
    steps.push(step("company_brain_qualification", order++, "companies are qualified against the Company Brain"));
  }

  if (wantsPeople) {
    steps.push(step("founder_discovery", order++, `the mission requests ${mission.decision_makers.roles.join("/") || "decision-makers"}`));
    if (mission.decision_makers.current_employment_required) {
      steps.push(step("employer_verification", order++, "current employment must be verified"));
    }
    steps.push(step("contact_enrichment", order++, "a lead needs a contact method to be CONTACT-ready"));
  }

  steps.push(step("persistence", order++, "results are persisted to the Workbench"));

  // Anything not in the plan is PROHIBITED. Stated positively so containment is
  // a set membership test rather than a list of remembered exclusions.
  const present = new Set(steps.map((s) => s.capability));
  const prohibited = CAPABILITY_IDS.filter((c) => !present.has(c));
  for (const c of mission.prohibited_capabilities) {
    if (!prohibited.includes(c)) prohibited.push(c);
  }

  const allowed_providers = [...new Set(steps.flatMap((s) => s.providers))]
    .filter((p) => !mission.prohibited_capabilities.some(
      (c) => CAPABILITY_REGISTRY[c].providers.includes(p)));

  return {
    version: CAPABILITY_GRAPH_VERSION,
    steps,
    prohibited,
    allowed_providers,
    entry_capability: entry,
    estimated_cost_units: steps.reduce((n, s) => n + s.cost_units * s.max_attempts, 0),
  };
}

// ------------------------------------------------------------ invariants ----

export class CapabilityContainmentError extends Error {
  readonly capability: string | null;
  readonly provider: string | null;
  constructor(message: string, opts: { capability?: string; provider?: string } = {}) {
    super(message);
    this.name = "CapabilityContainmentError";
    this.capability = opts.capability ?? null;
    this.provider = opts.provider ?? null;
  }
}

export function isCapabilityAllowed(plan: CapabilityPlan, capability: string): boolean {
  return plan.steps.some((s) => s.capability === capability);
}

export function isProviderAllowed(plan: CapabilityPlan, actorKey: string): boolean {
  return plan.allowed_providers.includes(actorKey);
}

/**
 * HARD INVARIANT at the provider boundary.
 *
 * Throws rather than logs. The 2026-08-03 failure was fully visible in the logs
 * and still cost a run, because a log is a note and a throw is a fact. This is
 * the call that makes "zero startup results silently ran LinkedIn Jobs"
 * impossible rather than merely discouraged.
 */
export function assertProviderAllowed(
  plan: CapabilityPlan, actorKey: string, ctx: { capability?: string } = {},
): void {
  if (isProviderAllowed(plan, actorKey)) return;
  const broad = BROAD_JOB_PROVIDERS.includes(actorKey);
  throw new CapabilityContainmentError(
    broad
      ? `broad job provider "${actorKey}" is unreachable: job_discovery is not in this mission's capability graph ` +
        `(entry: ${plan.entry_capability}; allowed providers: ${plan.allowed_providers.join(", ") || "none"})`
      : `provider "${actorKey}" is outside this mission's capability graph ` +
        `(allowed: ${plan.allowed_providers.join(", ") || "none"})`,
    { provider: actorKey, ...(ctx.capability ? { capability: ctx.capability } : {}) },
  );
}

export function assertCapabilityAllowed(plan: CapabilityPlan, capability: string): void {
  if (isCapabilityAllowed(plan, capability)) return;
  throw new CapabilityContainmentError(
    `capability "${capability}" is not in this mission's graph (entry: ${plan.entry_capability})`,
    { capability },
  );
}

/**
 * Exhaustion is a REPORTABLE STATE, not a licence to leave the graph.
 *
 * Zero startup companies means the startup capability is exhausted. It does not
 * mean the mission becomes a job-board sweep — that would answer a question the
 * user did not ask, at full cost, and the old code did exactly that.
 */
export interface ExhaustionOutcome {
  status: "provider_fallback_available" | "exhausted" | "requires_user_approval";
  next_provider: string | null;
  reason: string;
}

export function onCapabilityExhausted(
  plan: CapabilityPlan, capability: CapabilityId, triedProviders: readonly string[],
): ExhaustionOutcome {
  const s = plan.steps.find((x) => x.capability === capability);
  if (!s) {
    return { status: "exhausted", next_provider: null, reason: `${capability} is not in the plan` };
  }
  const remaining = s.providers.filter((p) => !triedProviders.includes(p));
  if (remaining.length > 0) {
    return {
      status: "provider_fallback_available",
      next_provider: remaining[0],
      reason: `${capability}: ${remaining[0]} has not been tried`,
    };
  }
  if (s.fallback_policy === "requires_user_approval") {
    return {
      status: "requires_user_approval", next_provider: null,
      reason: `${capability} exhausted every approved provider; leaving the graph needs approval`,
    };
  }
  return {
    status: "exhausted", next_provider: null,
    reason: `${capability} exhausted every approved provider (${s.providers.join(", ") || "none"}); ` +
      `the mission reports a partial result rather than sourcing outside its graph`,
  };
}
