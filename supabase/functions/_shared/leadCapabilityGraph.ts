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
    // THE SEARCH ACTOR, NOT THE ENRICHMENT ACTOR.
    //
    // This list was empty, and the engine reached for
    // `apify_linkedin_company_details` with `{searches:[name]}` instead —
    // allowed only because containment is checked plan-wide and enrichment
    // declares that provider one step later. `harvestapi/linkedin-company` is an
    // enrichment Actor: it turns a LinkedIn URL into a record, and is not a name
    // index. On TEST task c8a6e53d that produced 16 zero-row Actor starts.
    // Declaring the real provider here is what makes the graph describe what
    // actually runs.
    providers: ["apify_linkedin_company_search"],
    // IT SPENDS, SO IT COSTS. Zero said this stage was free while it was the
    // most expensive thing in the run.
    cost_units: 1,
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
  /**
   * Work the Workbench may OFFER when the run finishes. Not steps, not costed,
   * and not reachable by the engine — an offer is a button, and the button has
   * to be pressed by a person before anything is bought.
   */
  offered_capabilities: string[];
  /** Why the entry capability was chosen. Persisted for "why YC?" questions. */
  routing_reason: string;
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

  // WHAT THE COMPILED MISSION ASKED FOR.
  //
  // Non-empty only on the model-compiled path, where a validated proposal has
  // already been mapped onto internal stages by `leadCapabilityCatalogue`. When
  // it IS non-empty it constrains the plan, which is what makes one query's
  // graph differ from another's instead of every query getting the same
  // sequence. Empty, the deterministic inference below is unchanged.
  const requested = mission.required_capabilities;
  const asked = (c: CapabilityId) => requested.includes(c);
  const missionSaysSo = requested.length > 0;
  const strategy = mission.directives?.source_strategy ?? [];

  let entry: CapabilityId;
  let entryReason: string;

  // DISCOVERY WINS OVER RESOLUTION WHEN BOTH ARE ASKED FOR.
  //
  // `known_company_identity_resolution` in the catalogue expands to TWO internal
  // stages — `known_company_resolution` and `company_identity_resolution` —
  // because resolving a named company and resolving a discovered one are the
  // same work. A startup mission legitimately asks for it as a PIPELINE step,
  // and reading that as "the user named the companies" sent every YC query to
  // the known-company entry and skipped discovery entirely.
  const asksDiscovery = asked("startup_company_discovery") ||
    asked("general_company_discovery");

  if (known.length > 0) {
    entry = "known_company_resolution";
    entryReason = `${known.length} company identifier(s) supplied by the user — discovery is skipped`;
  } else if (missionSaysSo && asked("known_company_resolution") && !asksDiscovery) {
    entry = "known_company_resolution";
    entryReason = "the mission names the companies to evaluate — no discovery is needed";
  } else if (mission.requested_output === "job_listings") {
    entry = "job_discovery";
    entryReason = "the requested output is job listings";
  } else if (strategy.includes("job_signal_first")) {
    // HIRING-FIRST. The companies worth looking at are the ones with the opening,
    // so the opening is what is searched for — not a company profile that is then
    // checked for hiring one company at a time.
    entry = "job_discovery";
    entryReason = "the mission is hiring-first: companies are reached through their openings";
  } else if (missionSaysSo && asked("startup_company_discovery")) {
    entry = "startup_company_discovery";
    entryReason = "the mission requires startup-cohort discovery";
  } else if (missionSaysSo && asked("general_company_discovery")) {
    entry = "general_company_discovery";
    entryReason = "the mission requires general company discovery outside startup cohorts";
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
    // ── JOBS AS THE DELIVERABLE, OR JOBS AS THE ROUTE TO A COMPANY ──────────
    //
    // These are different missions and used to produce the same plan. When the
    // user asked for JOB LISTINGS, the postings are the answer and the plan is
    // finished. When the user asked for COMPANIES and the opening is merely how
    // they are found — "manufacturers hiring their first salesperson" — the
    // employer still has to be resolved, enriched and evaluated, or the run
    // returns job rows to a question about companies.
    //
    // The old condition asked only whether people or enriched companies were
    // wanted, so a hiring-first COMPANY mission stopped at deduplication.
    const jobsAreTheDeliverable = mission.requested_output === "job_listings";
    if (!jobsAreTheDeliverable) {
      steps.push(step("company_identity_resolution", order++,
        "companies reached through their openings still need a canonical identity"));
      steps.push(step("company_enrichment", order++,
        "qualification requires enriched evidence, never job-row fields"));
      steps.push(step("company_brain_qualification", order++,
        "the employers are qualified against the Company Brain"));
    } else if (wantsPeople || mission.requested_output === "enriched_companies") {
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

    // ── PAID HIRING VERIFICATION IS NOT AUTOMATIC ──────────────────────────
    //
    // It used to follow from the word "hiring" appearing anywhere in the query,
    // so a partner-fit question ("agencies that could partner with us") and a
    // fit question ("companies that could use Agentory") would each buy a job
    // search per company to prove something neither one asked about.
    //
    // A compiled mission states whether it needs EXTERNAL verification. When it
    // does not, embedded evidence answers for nothing. Only a mission with no
    // compiled capabilities falls back to the old signal-presence reading.
    const needsPaidHiring = missionSaysSo
      ? asked("hiring_verification")
      : hasSignal(mission, "hiring");
    if (needsPaidHiring) {
      steps.push(step("hiring_verification", order++,
        missionSaysSo
          ? "the mission requires externally verified hiring evidence"
          : "the mission requires a verified hiring signal"));
    } else if (hasSignal(mission, "hiring")) {
      // Recorded so the ABSENCE is legible: hiring matters to this mission and
      // embedded evidence is expected to settle it without a paid call.
      entryReason += "; hiring evidence taken from embedded sources, not purchased";
    }
    if (hasSignal(mission, "expansion")) {
      steps.push(step("expansion_signal_verification", order++, "the mission requires a verified expansion signal"));
    }
    steps.push(step("company_brain_qualification", order++, "companies are qualified against the Company Brain"));
  }

  steps.push(step("persistence", order++, "results are persisted to the Workbench"));

  // ── PEOPLE ARE OFFERED, NEVER SCHEDULED ────────────────────────────────────
  //
  // `founder_discovery`, `employer_verification` and `contact_enrichment` were
  // appended here whenever the query mentioned founders — which is most lead
  // queries. Every company that qualified then had its people bought, before
  // anyone had agreed to buy a single one.
  //
  // They are OFFERS now. Nothing here adds a step; the Workbench renders a
  // locked row and the purchase happens, if ever, on an explicit action. The
  // three stages fall into `prohibited` below by simple absence, so
  // `assertProviderAllowed` refuses their Actors for this plan outright.
  const offered_capabilities: string[] = [];
  if (wantsPeople || mission.directives?.founder_unlock_recommended) {
    offered_capabilities.push("offer_founder_unlock");
  }
  if (mission.requested_output === "contact_ready_leads") {
    offered_capabilities.push("offer_contact_unlock");
  }

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
    offered_capabilities,
    routing_reason: entryReason,
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
/**
 * Is this provider allowed FOR THIS CAPABILITY?
 *
 * Plan-wide containment is too coarse to catch the mistake that mattered.
 * `company_identity_resolution` reached for `apify_linkedin_company_details`
 * with `{searches:[name]}` — an ENRICHMENT Actor used as a name index — and
 * nothing objected, because enrichment declares that provider one step later
 * and the plan-wide set is a union. Sixteen zero-row Actor starts later, the
 * edge function was killed.
 *
 * A capability may only use a provider it DECLARES. An unknown capability falls
 * back to the plan-wide answer rather than failing open on a typo.
 */
export function isProviderAllowedForCapability(
  plan: CapabilityPlan, actorKey: string, capability: string,
): boolean {
  const step = plan.steps.find((s) => s.capability === capability);
  if (!step) return isProviderAllowed(plan, actorKey);
  return step.providers.includes(actorKey as CapabilityId extends never ? never : string);
}

export function assertProviderAllowed(
  plan: CapabilityPlan, actorKey: string, ctx: { capability?: string } = {},
): void {
  if (ctx.capability && isProviderAllowed(plan, actorKey) &&
      !isProviderAllowedForCapability(plan, actorKey, ctx.capability)) {
    const step = plan.steps.find((s) => s.capability === ctx.capability);
    throw new CapabilityContainmentError(
      `provider "${actorKey}" is in this mission's plan but is NOT declared by capability ` +
      `"${ctx.capability}" (that capability may use: ${step?.providers.join(", ") || "none"}). ` +
      `Using another capability's provider is how an enrichment Actor became a name-search index.`,
      { provider: actorKey, capability: ctx.capability },
    );
  }
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
