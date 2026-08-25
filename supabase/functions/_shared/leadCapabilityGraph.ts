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
import { evidenceCoversPopulation, evidenceProducedBy } from "./actorEvidenceCapability.ts";
import { isMonitoringMission } from "./monitoringMission.ts";

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
  "product_launch_discovery",
  // company pipeline
  "company_identity_resolution",
  "company_enrichment",
  "hiring_verification",
  "expansion_signal_verification",
  "company_post_verification",
  "product_launch_verification",
  "technology_verification",
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
  /**
   * Can this capability actually do what it claims? Defaults to true.
   *
   * ── WHY A DECLARED CAPABILITY MAY BE UNSUPPORTED ──────────────────────────
   *
   * A registry entry is a CLAIM: "this stage produces `funding_event` using
   * these providers". Three entries below make a claim their providers cannot
   * keep — `funding_signal_discovery` names a Y Combinator directory scraper
   * whose verified input schema has no funding field at all, and both expansion
   * entries name a company-NAME matcher and a JOB search respectively.
   *
   * Nothing checked the claim, and the cost was not a wasted call — it was
   * WORSE. `ENGINE_DRIVEN_DISCOVERY` contains only the two real discovery
   * capabilities, so an entry of `expansion_signal_discovery` is reported
   * `skipped_no_input` and DISCOVERY NEVER RUNS. "Find European SaaS companies
   * expanding into the US" entered at a stage the engine skips, found nothing,
   * and — before coverage learned to check executability — reported the
   * expansion signal as covered.
   *
   * Marking the claim false here is what stops it being made. An unsupported
   * capability is never chosen as an entry and never scheduled as a step; it
   * falls into `prohibited` by absence, and the reason reaches the planner
   * through `routing_advisories` instead of vanishing into a skipped step.
   *
   * This is a statement about the CURRENT provider set, not a permanent one.
   * Give one of these a provider that genuinely produces its evidence and the
   * flag comes off with it.
   */
  supported?: boolean;
  /** Required when `supported` is false. Verified, specific, and user-legible. */
  unsupported_reason?: string;
}

/** Does this capability's provider set actually keep its evidence claim? */
export function isCapabilitySupported(id: CapabilityId): boolean {
  return CAPABILITY_REGISTRY[id].supported !== false;
}

/** Capabilities declared in the graph whose claim no provider can keep. */
export function unsupportedCapabilities(): CapabilitySpec[] {
  return CAPABILITY_IDS
    .map((c) => CAPABILITY_REGISTRY[c])
    .filter((s) => s.supported === false);
}

/**
 * Capabilities whose SIGNAL claim their own providers cannot keep.
 *
 * ── WHY THIS IS COMPUTED AND NOT MAINTAINED ─────────────────────────────────
 *
 * Phase 1 set `supported: false` on three entries by hand, after reading each
 * provider's card. That fixed the three and prevented none: the claim and the
 * provider still live apart, and the only thing joining them was someone
 * remembering to look.
 *
 * `actorEvidenceCapability` records what each executable Actor genuinely
 * produces, so the join can be COMPUTED. A capability that names a signal in
 * its `produces` list, while no declared provider produces that signal's
 * evidence, is refuted here — and `capabilityEvidenceTruth.test.ts` fails the
 * build rather than letting the claim reach a plan.
 *
 * Returns the offending capabilities with the evidence their providers actually
 * yield, so the message says what is missing rather than merely that something
 * is.
 */

/**
 * Which SIGNAL each `produces` string claims.
 *
 * ── WHY THIS IS A TABLE AND NOT A STRING TRANSFORM ─────────────────────────
 *
 * The check used to strip `_signal|_event|_evidence` and compare the remainder
 * to an event name. That silently mis-parsed real claims: `launch_signal`
 * became "launch" against the event `product_launch`, so a capability could
 * claim a launch and be neither kept nor refuted — it simply fell out of the
 * guard.
 *
 * The names cannot just be aligned: `launch_signal` is a value in a CHECK
 * constraint on `signal_events.evidence_category`, so renaming it is a
 * migration rather than a refactor. The mapping is therefore stated once, here.
 *
 * A `produces` value ABSENT from this table is not a signal claim — it is a
 * pipeline artifact like `company_candidate` or `company_identity`, which the
 * evidence table deliberately says nothing about.
 */
const CLAIM_TO_EVENT: Readonly<Record<string, string>> = Object.freeze({
  hiring_evidence: "hiring",
  funding_signal: "funding",
  funding_event: "funding",
  expansion_signal: "expansion",
  expansion_evidence: "expansion",
  launch_signal: "product_launch",
  launch_evidence: "product_launch",
  company_activity_evidence: "post",
  technology_evidence: "technology",
});

export function capabilitiesClaimingUnproducibleEvidence(): Array<{
  id: CapabilityId; claims: string[]; providers: string[]; actually_produces: string[];
}> {
  const out: Array<{
    id: CapabilityId; claims: string[]; providers: string[]; actually_produces: string[];
  }> = [];
  for (const id of CAPABILITY_IDS) {
    const spec = CAPABILITY_REGISTRY[id];
    // Only SIGNAL claims are checkable this way. A capability producing
    // `company_candidate` or `company_evidence` is making a discovery or
    // enrichment claim, which the evidence table deliberately says nothing
    // about — it records what proves a SIGNAL.
    const claims = spec.produces.filter((p) => p in CLAIM_TO_EVENT);
    if (claims.length === 0) continue;
    const produced = evidenceProducedBy(spec.providers);
    const producedNames = produced.map((p) => `${p.event}/${p.subject}`);

    // A claim is kept only when some declared provider produces evidence for
    // the same event. `hiring_evidence` is kept by an Actor producing `hiring`.
    const unmet = claims.filter((claim) =>
      !produced.some((p) => p.event === CLAIM_TO_EVENT[claim]));
    if (unmet.length > 0) {
      out.push({
        id, claims: unmet, providers: [...spec.providers],
        actually_produces: producedNames.length ? producedNames : ["nothing"],
      });
    }
  }
  return out;
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
    // WHAT THIS CAPABILITY MAY CALL. Order is the contract, not a hint: memo23
    // first, then solidcode, then the LinkedIn company search.
    //
    // The third entry is new, and it is what lets discovery answer a request
    // that Y Combinator cannot. Both YC sources search the same cohort, so a
    // mission for manufacturers, agencies or engineering firms had no declared
    // route at all and was answered with YC companies tagged B2B — the pool
    // being wrong upstream of every gate that then failed to qualify it.
    //
    // It stays LAST deliberately. It is the only one of the three whose own
    // catalog entry records that its query matches company NAMES rather than
    // concepts, that its size filter disagreed with reality in four of eight
    // observed rows, and that its industry field is not proof. That makes it a
    // legitimate breadth and last-resort source, and a poor first choice.
    providers: [
      "apify_yc_companies_memo23",
      "apify_yc_companies_solidcode",
      "apify_linkedin_company_search",
    ],
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
    // ── THE SAME DISCOVERY UNIVERSE AS THE STARTUP ENTRY ──────────────────
    //
    // This declared ONE provider — the LinkedIn company search — and that made
    // the capability a trap rather than a route. `guardedInvoker` enforces
    // containment per capability, so a single-provider capability is not a
    // preference the planner may weigh; it is the only call it can make. On run
    // 25f3ff57 (2026-08-18) a mission for "AI startups" was routed here and had
    // to be answered with a company-NAME matcher, whose own card declares it
    // `not_for: ["semantic/concept search"]`. It returned 50 newsletters, 26
    // accelerator communities and a podcast. Nothing downstream could recover.
    //
    // `providers` is a CONTAINMENT boundary — which Actors this capability may
    // reach — not a ranking. Widening it to the discovery universe does not
    // make a bad choice more likely: `validateDiscoveryStrategy` still refuses
    // an unregistered key, a non-discovery purpose and a `not_for` violation,
    // and the planner is shown every card's `best_for` and `known_defects`
    // before it chooses. What it does make possible is the RIGHT choice — a
    // profile mission that happens to describe startups can now reach a startup
    // cohort source instead of being answered by a name index.
    providers: [
      "apify_yc_companies_memo23",
      "apify_yc_companies_solidcode",
      "apify_linkedin_company_search",
    ],
    cost_units: 1,
    max_attempts: 2,
    // WAS `terminal_on_exhaustion`, which was honest when there was one
    // provider and nothing to fall back TO. With a real provider set, an
    // exhausted primary has somewhere to go.
    fallback_policy: "provider_fallback_only",
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
    // STILL THE BOARD SET, AND STILL UNDRIVEN.
    //
    // `apify_linkedin_job_search` deliberately does NOT appear here. It is
    // company-SCOPED by contract — `compileHarvestJobSearchInput` rejects an
    // input without `company[]`, because that Actor verifies hiring inside a
    // known company set and cannot discover employers it was not given.
    //
    // The four boards can discover, but none of them has a card in
    // `hiringActorCatalog`, so no bounded input can be compiled for them and no
    // cost can be estimated. Driving one needs a live schema verification pass
    // first; until then a hiring-first mission is routed through company
    // discovery plus company-scoped verification, which uses only carded
    // Actors — see `buildCapabilityGraph`.
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
    // ── THE PROVIDER THAT CAN ACTUALLY KEEP THIS CLAIM ────────────────────
    //
    // This declared `apify_yc_companies_memo23` — a Y Combinator directory
    // scraper with no funding field anywhere in its verified schema — while
    // claiming to produce `funding_event`. The claim was refuted by
    // `capabilitiesClaimingUnproducibleEvidence` and the capability was marked
    // unsupported.
    //
    // `apify_funding_rounds_datahyena` returns one row per funding EVENT:
    // company, stage, amount in USD, announced date, investors and the source
    // articles, with the amount ungated by any session cookie. That is the
    // evidence this capability always claimed, so the claim is now keepable and
    // the `supported: false` flag is gone — removed because the derivation
    // stopped refuting it, not because anyone decided it should be.
    //
    // DISCOVERY ONLY. There is no company or URL input, so this cannot verify
    // funding for a company set already in hand; `funding_verification` is
    // deliberately absent from the graph rather than faked with this provider.
    providers: ["apify_funding_rounds_datahyena"],
    // The most expensive row in the catalog at $0.045, so the forecast must not
    // treat it like a $0.001 job row.
    cost_units: 3,
    max_attempts: 2,
    fallback_policy: "terminal_on_exhaustion",
    evidence_required: ["company_name", "funding_event", "announced_date"],
  },
  expansion_signal_discovery: {
    id: "expansion_signal_discovery",
    label: "Discover expanding companies",
    requires: ["required_signals includes expansion"],
    produces: ["company_candidate", "expansion_signal"],
    allowed_next: ["company_identity_resolution"],
    // ── A SOURCE THAT CAN ACTUALLY STATE AN EXPANSION ─────────────────────
    //
    // This declared `apify_linkedin_company_search` — a company-NAME matcher
    // whose own card says `not_for: ["semantic/concept search"]` — so the
    // "discovery" was a general company search wearing an expansion label, and
    // the derivation refuted it in Phase 3.
    //
    // News is the right substrate: a dated article naming a company and a new
    // market IS the evidence, and Google News operators can scope a keyword
    // search to expansion language. The claim inside the article is prose that
    // qualification must read — which is why the capability produces an article,
    // not a verdict.
    providers: ["apify_google_news"],
    cost_units: 2,
    max_attempts: 2,
    fallback_policy: "terminal_on_exhaustion",
    evidence_required: ["company_name", "expansion_statement", "published_at", "source_url"],
  },
  product_launch_discovery: {
    id: "product_launch_discovery",
    label: "Discover companies by a product launch",
    requires: ["required_signals includes product_launch"],
    produces: ["company_candidate", "launch_signal"],
    allowed_next: ["company_identity_resolution"],
    providers: ["apify_google_news"],
    cost_units: 2,
    max_attempts: 2,
    fallback_policy: "terminal_on_exhaustion",
    evidence_required: ["company_name", "launch_statement", "published_at", "source_url"],
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
    // WAS `apify_linkedin_job_search`, which let a role's LOCATION stand as
    // proof that a company entered a market — a US-located opening at a company
    // with a decade-old US office would have satisfied the gate.
    //
    // Expansion evidence is an explicit dated statement of a new market. News
    // carries it; a company's own post can corroborate it.
    providers: ["apify_google_news", "apify_linkedin_company_posts"],
    cost_units: 2,
    max_attempts: 2,
    fallback_policy: "provider_fallback_only",
    evidence_required: ["expansion_statement", "published_at", "source_url"],
  },
  company_post_verification: {
    id: "company_post_verification",
    label: "Read the company's own posts",
    requires: ["company_identity"],
    produces: ["company_activity_evidence"],
    allowed_next: ["company_brain_qualification"],
    // Consumes a resolved LinkedIn company URL and cannot find one, so identity
    // strictly precedes it. The compiler refuses a person URL here, which is
    // where the company/leadership boundary is actually enforced.
    providers: ["apify_linkedin_company_posts"],
    cost_units: 1,
    max_attempts: 2,
    fallback_policy: "terminal_on_exhaustion",
    evidence_required: ["post_url", "posted_at"],
  },
  product_launch_verification: {
    id: "product_launch_verification",
    label: "Verify a product launch",
    requires: ["company_identity", "required_signals includes product_launch"],
    produces: ["launch_evidence"],
    allowed_next: ["company_brain_qualification"],
    providers: ["apify_google_news", "apify_linkedin_company_posts"],
    cost_units: 2,
    max_attempts: 2,
    fallback_policy: "provider_fallback_only",
    evidence_required: ["launch_statement", "published_at", "source_url"],
  },
  technology_verification: {
    id: "technology_verification",
    label: "Verify the company's technology",
    requires: ["company_domain", "required_signals includes technology"],
    produces: ["technology_evidence"],
    allowed_next: ["company_brain_qualification"],
    // VERIFICATION ONLY, permanently as far as this provider is concerned:
    // BuiltWith takes a domain list and returns what those domains run. There is
    // no discovery counterpart because there is no query field to build one on.
    providers: ["apify_builtwith_technology"],
    cost_units: 1,
    max_attempts: 1,
    fallback_policy: "terminal_on_exhaustion",
    evidence_required: ["domain", "technologies"],
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

/**
 * Broad job-BOARD keys. Reachable only through `job_discovery`.
 *
 * STATED EXPLICITLY, no longer derived from `job_discovery.providers`.
 * "Broad" means an untargeted board sweep — the thing that turned a startup
 * mission into 50 raw Indeed rows. LinkedIn Jobs joined that capability as its
 * primary provider, and deriving this list would have silently reclassified a
 * targeted, company-scoped search as a broad sweep, changing what every
 * downstream guard and diagnostic means.
 */
export const BROAD_JOB_PROVIDERS: readonly string[] = Object.freeze([
  "apify_jobs", "apify_linkedin_jobs_crawlworks",
  "apify_indeed_jobs_automation_lab", "apify_glassdoor_jobs",
]);

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
  /**
   * Facts about THIS mission's execution constraints, for the planner to weigh.
   *
   * These are things deterministic code knows and the model cannot infer — an
   * Actor family with no verified schema, a signal with no discovery source.
   * They used to be encoded as routing branches that silently changed the plan;
   * carried here instead, they inform a decision rather than replacing one.
   *
   * ADVISORY. Nothing reads these to gate execution. If one ever needs to be
   * enforced it belongs in `validateDiscoveryStrategy`, where a refusal is
   * recorded and handed back to the model — not in the router, where it is
   * invisible.
   */
  routing_advisories: string[];
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
 * Does the mission require this event ABOUT THIS SUBJECT?
 *
 * ── WHY THE SUBJECT CANNOT BE IGNORED HERE ─────────────────────────────────
 *
 * `post` means two different jobs depending on who posted. A company post is a
 * page read against a resolved company URL, costs one unit and needs no
 * authorisation. A leadership post is a claim about a PERSON — it needs an
 * identified individual first and is unlock-gated all the way down.
 *
 * Scheduling a company-page read for a leadership signal would answer a
 * question about a founder with a question about their employer's marketing,
 * and then report the signal as satisfied.
 *
 * An UNDECLARED subject defaults to `company`, which is the conservative
 * direction: the company read is the cheap, unauthorised one. Defaulting the
 * other way would schedule person work — and person work is never scheduled,
 * only offered.
 */
function hasSignalSubject(m: LeadMissionV1, type: string, subject: string): boolean {
  return m.required_signals.some((sig) =>
    sig.type === type &&
    (((sig as { subject?: string }).subject ?? "company") === subject));
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

  // ── WHAT USED TO SIT HERE, AND WHY IT IS GONE ─────────────────────────────
  //
  //     else if (strategy.includes("job_signal_first"))
  //       entry = "general_company_discovery";
  //
  // A hiring-first mission was rerouted to profile discovery, on the honest
  // reasoning that the four job-board Actors are uncarded and cannot be given a
  // bounded, priced input. The reasoning was sound. Expressing it as a ROUTE
  // OVERRIDE was not, for three reasons that run 25f3ff57 (2026-08-18)
  // demonstrated in one pass:
  //
  //   1. It tested MEMBERSHIP, not order. The mission's own preference was
  //      ["startup_cohort_first", "job_signal_first"] — startup cohort FIRST —
  //      and the second entry silently won.
  //   2. It overrode a capability the gate had already APPROVED.
  //      `capability_decision` recorded `requested: [startup_company_discovery]`,
  //      `approved: [startup_company_discovery]`, `rejected: []` — and then the
  //      plan ran general discovery. Nothing in the record said otherwise.
  //   3. `general_company_discovery` declared one provider, so the override was
  //      not a route change but a tool change: a concept cohort was handed to a
  //      company-NAME matcher, which returned newsletters.
  //
  // The constraint it encoded is REAL and has not been discarded — it is now
  // knowledge rather than a branch. `routing_advisories` below carries it into
  // the planner briefing, where the model can weigh "no carded actor discovers
  // open job postings" against everything else it knows, and answer with an
  // Actor that carries embedded hiring evidence instead. That is the same fact
  // reaching the same decision, at a layer that can act on it intelligently.
  } else if (missionSaysSo && asked("startup_company_discovery")) {
    entry = "startup_company_discovery";
    entryReason = "the mission requires startup-cohort discovery";
  } else if (missionSaysSo && asked("general_company_discovery")) {
    entry = "general_company_discovery";
    entryReason = "the mission requires general company discovery outside startup cohorts";
  // ── A SIGNAL NO LONGER PICKS AN ENTRY THAT CANNOT DISCOVER ────────────────
  //
  // These two branches used to fire unconditionally, and the result was the
  // worst outcome in the graph: not a wasted call, but NO CALL AT ALL.
  // `ENGINE_DRIVEN_DISCOVERY` holds only the two real discovery capabilities,
  // so entering at `funding_signal_discovery` or `expansion_signal_discovery`
  // produced `skipped_no_input` for the ENTRY step — discovery never ran, the
  // pool was empty, and the mission returned zero companies while reporting
  // the signal as served.
  //
  // It also inverted the routing. `hasSignal(expansion)` was tested BEFORE the
  // profile branches, so adding an expansion requirement to a cybersecurity
  // mission REPLACED profile discovery with a company-name matcher. The mission
  // got worse at finding the companies it asked for because it asked for more
  // evidence about them.
  //
  // Guarded by `isCapabilitySupported`, both fall through to real discovery and
  // the signal is carried as a qualifier — which is what `SIGNAL_RESEARCH_ROLES`
  // has always said expansion is. The reason reaches the planner below.
  // ── A SIGNAL ENTRY MUST AGREE WITH THE DECLARED RESEARCH SHAPE ────────────
  //
  // Funding discovery became real in Phase 4, and the first thing that exposed
  // was an alignment problem the old `supported: false` had been hiding. A
  // mission may carry a funding signal while its declared strategy is `hiring`
  // — "B2B SaaS companies hiring RevOps that recently raised" is exactly that.
  // Entering at funding discovery there makes the GRAPH disagree with the
  // PLAYBOOK, and `authorizePlaybookExecution` then correctly refuses a mission
  // that was never wrong.
  //
  // So the funding entry is taken only when funding is genuinely the research
  // shape: the mission declared it, or it declared nothing and the signal is
  // the only basis for discovery. A hiring-shaped mission keeps its profile
  // entry and proves funding as a qualifier over the pool it finds.
  } else if (
    hasSignal(mission, "funding") &&
    isCapabilitySupported("funding_signal_discovery") &&
    ((mission.strategies ?? []).length === 0 ||
      (mission.strategies ?? []).includes("funding"))
  ) {
    entry = "funding_signal_discovery";
    entryReason = "the mission requires a funding signal";
  } else if (hasSignal(mission, "expansion") && isCapabilitySupported("expansion_signal_discovery")) {
    entry = "expansion_signal_discovery";
    entryReason = "the mission requires an expansion signal";
  } else if (
    hasSignal(mission, "product_launch") &&
    isCapabilitySupported("product_launch_discovery") &&
    (mission.strategies ?? []).length === 0
  ) {
    // Same rule as funding and expansion: a signal may choose the entry only
    // when it is genuinely the research shape. A mission that declared a
    // different strategy keeps its own entry and proves the launch as a
    // qualifier over the pool that shape produces.
    entry = "product_launch_discovery";
    entryReason = "the mission requires a product-launch signal";
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
    //
    // ── AND "EMBEDDED EVIDENCE" MUST ACTUALLY REACH THIS POPULATION ────────
    //
    // `embedded_hiring_evidence` maps to no internal stage on purpose: it is
    // the free branch INSIDE `hiring_verification`, reading YC `openJobs[]`.
    // That branch only exists if something schedules the stage, so asking for
    // it and nothing else used to mean no hiring evidence was collected at
    // all — not even the free kind.
    //
    // Conversation bcbabb10 is the cost: "companies matching my ICP that are
    // actively hiring sales roles" planned discovery, identity, enrichment and
    // qualification, and bought nothing that could prove hiring. The YC actor
    // sits in `general_company_discovery`'s provider list and does produce
    // `isHiring`, so the embedded assumption looked satisfied — but it is
    // `cohort_scope: "y_combinator"` and that mission's own entry reason is
    // "outside startup cohorts". Every non-YC company arrived unproven.
    //
    // So the assumption is CHECKED against the evidence table rather than
    // taken on trust. This is not the old "the word hiring appeared" rule
    // returning: a mission with no hiring signal still schedules nothing, and
    // a genuinely covered mission still pays nothing.
    const missionCohort = entry === "startup_company_discovery" ? "y_combinator" : null;
    const discoveryProviders = steps.find((s) => s.capability === entry)?.providers ?? [];
    const embeddedCovers = evidenceCoversPopulation(
      discoveryProviders, "hiring", "company", missionCohort);
    const embeddedGap = hasSignal(mission, "hiring") && !embeddedCovers;
    const needsPaidHiring = missionSaysSo
      ? (asked("hiring_verification") || embeddedGap)
      : hasSignal(mission, "hiring");
    if (needsPaidHiring) {
      steps.push(step("hiring_verification", order++,
        !missionSaysSo
          ? "the mission requires a verified hiring signal"
          : asked("hiring_verification")
          ? "the mission requires externally verified hiring evidence"
          : "the mission requires hiring evidence and no discovery provider " +
            "supplies it for this population"));
    } else if (hasSignal(mission, "hiring")) {
      // Recorded so the ABSENCE is legible: hiring matters to this mission and
      // embedded evidence is expected to settle it without a paid call.
      entryReason += "; hiring evidence taken from embedded sources, not purchased";
    }
    // A verification step whose provider cannot produce the evidence is not a
    // weak step, it is a false one — it would let a job posting's location
    // stand as proof that a company entered a new market. Not scheduled; the
    // gap is reported in `routing_advisories` instead.
    if (hasSignal(mission, "expansion") && isCapabilitySupported("expansion_signal_verification")) {
      steps.push(step("expansion_signal_verification", order++, "the mission requires a verified expansion signal"));
    }

    // ── THE THREE VERIFICATIONS THAT WERE DECLARED AND NEVER SCHEDULED ──────
    //
    // `company_post_verification`, `product_launch_verification` and
    // `technology_verification` have existed in CAPABILITY_IDS, in the registry,
    // with approved providers and declared `evidence_required`, since Phase 1 —
    // and no branch ever pushed a step for any of them.
    //
    // The effect was the worst kind of silent gap. `resolveSignalSupport` says
    // `technology/company` is SUPPORTED and BuiltWith is approved for it, so the
    // system truthfully advertised a capability that a mission could never
    // reach: "companies using Snowflake" planned discovery, identity, enrichment
    // and qualification, and nothing that could look at a technology stack. The
    // Brain was then asked to judge a technology signal from firmographics.
    //
    // Each is gated on `isCapabilitySupported` for the same reason the expansion
    // branch above is: a verification step whose provider cannot produce the
    // evidence is not a weak step, it is a false one.
    if (hasSignal(mission, "technology") && isCapabilitySupported("technology_verification")) {
      steps.push(step("technology_verification", order++,
        "the mission requires evidence of the company's technology stack"));
    }
    // COMPANY posts only. A `post` signal whose subject is leadership is a
    // PERSON claim and is unlock-gated — scheduling a company-page read for it
    // would answer a question about a founder with a question about their
    // employer's marketing.
    if (hasSignalSubject(mission, "post", "company") &&
        isCapabilitySupported("company_post_verification")) {
      steps.push(step("company_post_verification", order++,
        "the mission requires evidence from the company's own posts"));
    }
    if (hasSignal(mission, "product_launch") &&
        isCapabilitySupported("product_launch_verification")) {
      steps.push(step("product_launch_verification", order++,
        "the mission requires a verified product-launch signal"));
    }

    steps.push(step("company_brain_qualification", order++, "companies are qualified against the Company Brain"));
  }

  // ── THE TERMINAL IS WHERE SOURCING AND MONITORING DIVERGE ─────────────────
  //
  // Everything above is shared by construction: the same discovery routing, the
  // same actors, the same identity and enrichment, the same qualification. That
  // is the point — Signals gets its own monitoring INTENT, never its own
  // provider stack.
  //
  // Only the ending differs. A sourcing run turns qualified companies into
  // leads. A monitoring run stops at qualification and its evidence goes to
  // `signal_events`; scheduling `persistence` here would turn a watchlist into
  // a pipeline nobody asked for, and a workspace monitoring its ICP would
  // silently accumulate prospects it never requested.
  //
  // `monitoringPlanViolations` asserts this from the outside, so the rule holds
  // even if a future branch forgets it.
  if (!isMonitoringMission(mission)) {
    steps.push(step("persistence", order++, "results are persisted to the Workbench"));
  }

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
  // ── A PERSON-LEVEL SIGNAL DECLARES ITS DEPENDENCY ─────────────────────────
  //
  // "Whose leadership has recently posted about US expansion" is a claim about
  // a PERSON, and nothing can be proven about a person who has not been
  // identified. Identity is reachable — `apify_linkedin_company_employees`
  // produces it — and it is unlock-gated by deliberate design.
  //
  // Before the signal carried a subject, this mission asked for a leadership
  // signal and the plan offered NOTHING: the requirement was invisible, so the
  // dependency it implied was invisible too. Surfacing the offer is the honest
  // middle between the two wrong answers — spending on people automatically,
  // and dropping the requirement because no automatic route exists.
  //
  // An offer runs nothing. This adds no step and no cost; it puts a button in
  // the Workbench and tells the user what it is for.
  const needsPersonIdentity = (mission.required_signals ?? [])
    .some((sig) => sig.subject === "leadership" || sig.subject === "employee");
  if (needsPersonIdentity && !offered_capabilities.includes("offer_founder_unlock")) {
    offered_capabilities.push("offer_founder_unlock");
  }
  if (mission.requested_output === "contact_ready_leads") {
    // ── BOTH HALVES, IN ORDER ────────────────────────────────────────────────
    //
    // "Contact ready" needs a PERSON and then a WAY TO REACH THEM, and those
    // are two different purchases from two different Actors. Offering the
    // contact unlock alone produced the defect this fixed: a button that could
    // only ever run against somebody nobody had found yet.
    if (!offered_capabilities.includes("offer_founder_unlock")) {
      offered_capabilities.push("offer_founder_unlock");
    }
    offered_capabilities.push("offer_contact_unlock");
  }

  // ── DEEP RESEARCH IS OFFERED, NEVER SCHEDULED ───────────────────────────
  //
  // Every qualified company can be researched more deeply, and none of them
  // needs to be: qualification already establishes industry, size, geography
  // and what the company does from evidence the run collects anyway. So this is
  // an offer on every plan that produces companies — a button, costing nothing
  // until pressed — and never a step.
  //
  // Deliberately NOT conditional on the mission's wording. A user who did not
  // say "research deeply" may still want it once they see the shortlist, and a
  // capability that appears only when a sentence matched is one nobody can find.
  if (!offered_capabilities.includes("offer_deep_company_research")) {
    offered_capabilities.push("offer_deep_company_research");
  }

  // Anything not in the plan is PROHIBITED. Stated positively so containment is
  // a set membership test rather than a list of remembered exclusions.
  const present = new Set(steps.map((s) => s.capability));
  const prohibited = CAPABILITY_IDS.filter((c) => !present.has(c));
  for (const c of mission.prohibited_capabilities) {
    if (!prohibited.includes(c)) prohibited.push(c);
  }

  // ── ALLOWED PROVIDERS ARE THE ONES SCHEDULED STEPS NEED ──────────────────
  //
  // This used to subtract any provider that ALSO appears under a prohibited
  // capability, which conflates two different things: prohibiting a CAPABILITY
  // and banning a PROVIDER. Providers legitimately implement several
  // capabilities, so the subtraction removed tools the plan depends on.
  //
  // Live task dc87ffa1 is the proof. `apify_linkedin_company_search` implements
  // `general_company_discovery` (scheduled), `company_identity_resolution`
  // (scheduled) and `expansion_signal_discovery` (prohibited). The prohibited
  // one won, the entry capability lost its own provider, and the preflight
  // refused the run with `provider_not_in_plan` before spending anything.
  //
  // CONTAINMENT IS UNAFFECTED. A provider only ever reaches a capability
  // through that capability's own step, and `assertProviderAllowed` checks the
  // step it is running under — so a prohibited capability still cannot execute.
  // What it can no longer do is disarm a scheduled one.
  //
  // There is deliberately no provider-level subtraction here because no
  // provider-level prohibition contract exists. If one is ever added, it
  // belongs in its own field (`prohibited_providers`) and applies here — never
  // inferred from capability membership.
  const allowed_providers = [...new Set(steps.flatMap((s) => s.providers))];

  // ── WHAT THE ROUTER KNOWS AND THE MODEL CANNOT INFER ──────────────────────
  //
  // Each of these was, or could easily have become, a routing branch. Stated as
  // knowledge they reach the planner's briefing and inform an actor choice;
  // stated as branches they silently replace one.
  const routing_advisories: string[] = [];
  if (strategy.includes("job_signal_first") || hasSignal(mission, "hiring")) {
    routing_advisories.push(
      "This mission is hiring-first. No registered Actor can DISCOVER open job " +
      "postings across employers: the four job-board Actors have no verified " +
      "schema card, so no bounded input can be compiled for them, and " +
      "apify_linkedin_job_search is company-scoped by contract — it verifies " +
      "hiring inside a company set it is given and cannot find employers. " +
      "Prefer a discovery Actor that carries EMBEDDED hiring evidence, or plan " +
      "discovery first and hiring verification second over the pool it returns.",
    );
  }
  if (mission.company_profile.stages.some((s) => /startup|seed|series a|early/.test(s))) {
    routing_advisories.push(
      "The mission targets startups. Startup-cohort sources carry stage, team " +
      "size and hiring state natively; a general company index does not and " +
      "cannot prove any of them.",
    );
  }

  // ── THE CAPABILITY THIS MISSION WANTED AND CANNOT HAVE ────────────────────
  //
  // A signal whose capability is unsupported is not simply absent from the
  // plan; the planner has to know WHY, or it will keep proposing the shape and
  // reading the empty result as a bad query. The reason is the registry's own
  // verified sentence, so there is no second wording to drift.
  // ── A REQUIRED SIGNAL THAT THIS PLAN WILL NOT COLLECT ─────────────────────
  //
  // Funding became supported in Phase 4, and support is not the same as being
  // SCHEDULED. A mission whose declared shape is hiring keeps its profile entry
  // (see the entry rule above), so a funding signal it also carries has no step
  // in this plan — the capability exists and this plan does not use it.
  //
  // That difference has to be visible or it becomes the Phase 0 defect wearing
  // new clothes: a signal the system genuinely can serve, required by the
  // mission, and quietly uncollected. The funding source is DISCOVERY-ONLY —
  // it has no company input — so there is no way to prove funding over a pool
  // this plan found some other way, and the planner needs to know that before
  // it decides the shape is good enough.
  if (hasSignal(mission, "funding") &&
      !steps.some((st) => st.capability === "funding_signal_discovery")) {
    routing_advisories.push(
      "This mission requires funding evidence and this plan schedules no " +
      "funding step, because its declared research shape discovers companies " +
      "another way. The funding source is DISCOVERY-ONLY — it finds companies " +
      "BY a round and has no company or domain input — so funding cannot be " +
      "proven over the pool this plan produces. Either enter through funding " +
      "discovery and verify the other signals over that pool, or expect the " +
      "funding requirement to be reported as uncollected.",
    );
  }

  for (const spec of unsupportedCapabilities()) {
    const wanted =
      (spec.id === "funding_signal_discovery" && hasSignal(mission, "funding")) ||
      ((spec.id === "expansion_signal_discovery" ||
        spec.id === "expansion_signal_verification") && hasSignal(mission, "expansion"));
    if (!wanted) continue;
    routing_advisories.push(
      `This mission requires evidence that "${spec.label}" claims to produce, ` +
      `and that capability is NOT SUPPORTED: ${spec.unsupported_reason} ` +
      `No step was planned for it. Discovery proceeds on the company profile, ` +
      `and this signal must be treated as unproven rather than assumed.`,
    );
  }

  return {
    version: CAPABILITY_GRAPH_VERSION,
    steps,
    prohibited,
    allowed_providers,
    entry_capability: entry,
    estimated_cost_units: steps.reduce((n, s) => n + s.cost_units * s.max_attempts, 0),
    offered_capabilities,
    routing_reason: entryReason,
    routing_advisories,
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
