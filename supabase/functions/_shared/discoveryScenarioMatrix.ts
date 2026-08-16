// SCENARIO → CAPABILITY → ACTOR.
//
// The bridge between what a user asked for and what can actually be run. A
// scenario names a kind of request; a capability names the evidence it needs;
// the registry names the Actors that can produce that evidence. The planner
// walks that chain rather than guessing from an Actor's marketing copy.
//
// ── WHY SOME SCENARIOS HAVE NO ACTORS ────────────────────────────────────────
//
// Several scenarios below carry EMPTY actor lists and a `blocked_reason`. That
// is the most important thing in this file.
//
// Verification against the live Apify Store contradicted the plan for four of
// them. `technology_stack_discovery` and `competitor_technology_adoption` were
// specified as discovery; BuiltWith — the only technology Actor that exists —
// has an input schema with exactly two fields, `startDomains` and
// `maxRequestsPerCrawl`. It answers "what does this domain run", never "who
// runs this technology". `funding_amount` was specified as a filter; the
// Crunchbase Actor's own schema states the amount unlocks only with a session
// cookie pasted from a logged-in browser. `product_launches` had one candidate
// Actor with 20 lifetime users that requires a Product Hunt API token.
//
// A scenario with no Actor is recorded here, loudly, rather than quietly
// dropped or — far worse — pointed at an Actor that cannot answer it. A planner
// that believes BuiltWith can find companies by technology will confidently
// spend money producing nothing, and the failure will look like a bad query
// rather than an impossible request. The honest answer to "find companies using
// Shopify" is that we cannot, and the user should hear that immediately.
//
// PURE. No network, provider, model or database access.

import {
  type ActorCapability, actorIntelligence, actorsWithCapability,
} from "./apifyIntelligenceRegistry.ts";

export type ScenarioId =
  // hiring
  | "hiring_engineers" | "hiring_salespeople" | "hiring_sdrs" | "hiring_executives"
  | "job_growth_signal"
  // funding
  | "recent_funding" | "funding_round_type" | "funding_amount" | "investor_discovery"
  // founder & social
  | "founder_announcements" | "founder_hiring_signals" | "founder_expansion_signals"
  | "company_linkedin_activity" | "founder_linkedin_activity"
  // news
  | "recent_company_news" | "product_launches"
  // discovery
  | "startup_discovery" | "yc_startup_discovery" | "b2b_company_discovery"
  | "saas_company_discovery" | "company_size_discovery" | "geographic_discovery"
  | "market_industry_discovery" | "competitor_discovery"
  // technology
  | "technology_stack_discovery" | "technology_stack_verification"
  | "competitor_technology_adoption"
  // corporate events
  | "acquisition_signals" | "growth_signals" | "expansion_signals";

export type FreshnessRequirement = "any" | "within_month" | "within_week" | "current";

export interface ScenarioSpec {
  id: ScenarioId;
  /** The evidence this scenario needs before it can be answered at all. */
  required_capabilities: ActorCapability[];
  /** Actor ids, best-supported first. EMPTY means no Actor can do this. */
  preferred_actors: string[];
  fallback_actors: string[];
  /** Actors whose output supports a claim but may never introduce a candidate. */
  corroborating_actors: string[];
  /**
   * What must be true before a company may be counted for this scenario.
   * Deliberately prose: it is read by a model and by a person, not by a parser.
   */
  minimum_evidence: string;
  freshness_requirement: FreshnessRequirement;
  /** Set when NO registered Actor can serve this scenario, with the reason. */
  blocked_reason?: string;
}

/** Actors that discover, in the order the evidence supports. */
const YC_DISCOVERY = ["apify_yc_companies_memo23", "haketa/ycombinator-companies-scraper"];
const COMPANY_SEARCH = ["apify_linkedin_company_search"];
const NEWS = ["data_xplorer/google-news-scraper-fast"];
const SERP = ["apidojo/google-search-scraper"];
const POST_SEARCH = ["harvestapi/linkedin-post-search"];
const COMPANY_POSTS = ["harvestapi/linkedin-company-posts"];
const PROFILE_POSTS = ["harvestapi/linkedin-profile-posts"];
const CRUNCHBASE = ["memo23/crunchbase-scraper"];

/**
 * Hiring scenarios share a shape: discovery finds the company, the job source
 * proves the role. The ROLE is a filter on the job source, not a different
 * Actor — which is why four separate hiring scenarios resolve to one pair.
 */
const hiring = (id: ScenarioId, role: string): ScenarioSpec => ({
  id,
  required_capabilities: ["company_discovery", "hiring_signal"],
  preferred_actors: [...YC_DISCOVERY, ...COMPANY_SEARCH],
  fallback_actors: [],
  corroborating_actors: [...POST_SEARCH, ...COMPANY_POSTS],
  minimum_evidence:
    `an open ${role} role at the company, dated, from a source that names the ` +
    `employer — a post mentioning hiring is corroboration, never proof`,
  freshness_requirement: "within_month",
});

export const SCENARIO_MATRIX: Readonly<Record<ScenarioId, ScenarioSpec>> = Object.freeze({
  // ── HIRING ─────────────────────────────────────────────────────────────────
  hiring_engineers: hiring("hiring_engineers", "software engineering"),
  hiring_salespeople: hiring("hiring_salespeople", "sales"),
  hiring_sdrs: hiring("hiring_sdrs", "SDR or BDR"),
  hiring_executives: hiring("hiring_executives", "executive"),
  job_growth_signal: {
    id: "job_growth_signal",
    required_capabilities: ["company_discovery", "hiring_signal"],
    preferred_actors: [...YC_DISCOVERY, ...COMPANY_SEARCH],
    fallback_actors: [],
    corroborating_actors: [...COMPANY_POSTS],
    minimum_evidence:
      "open-role COUNT at two points in time. A single snapshot shows hiring, " +
      "not growth, and nothing registered stores history — so this is only " +
      "answerable across repeated runs of the same mission",
    freshness_requirement: "within_month",
  },

  // ── FUNDING ────────────────────────────────────────────────────────────────
  recent_funding: {
    id: "recent_funding",
    required_capabilities: ["funding_signal"],
    preferred_actors: [...CRUNCHBASE],
    fallback_actors: [...NEWS],
    corroborating_actors: [...NEWS, ...POST_SEARCH],
    minimum_evidence:
      "a dated funding event naming the company, from Crunchbase or two " +
      "independent news sources. Anonymous Crunchbase output is signal-only",
    freshness_requirement: "within_month",
  },
  funding_round_type: {
    id: "funding_round_type",
    required_capabilities: ["funding_signal"],
    preferred_actors: [...CRUNCHBASE],
    fallback_actors: [...NEWS],
    corroborating_actors: [...NEWS],
    minimum_evidence:
      "the round stage named explicitly. Crunchbase exposes stage as a filter " +
      "value even anonymously; a news headline stating 'Series A' also serves",
    freshness_requirement: "within_month",
  },
  funding_amount: {
    id: "funding_amount",
    required_capabilities: ["funding_signal"],
    preferred_actors: [],
    fallback_actors: [...NEWS],
    corroborating_actors: [...NEWS],
    minimum_evidence: "a stated figure with a currency and a date",
    freshness_requirement: "within_month",
    // VERIFIED, NOT ASSUMED. The Store schema for memo23/crunchbase-scraper
    // states that the funding amount, announced date and investors unlock only
    // in "LOGGED-IN MODE" with a Crunchbase session cookie pasted from a
    // browser, and describes anonymous mode as "signal-only", capped at 15
    // results per search.
    blocked_reason:
      "no registered Actor returns a funding AMOUNT unattended — Crunchbase " +
      "gates it behind a user-supplied session cookie. A news source may " +
      "mention a figure, but a headline is not a structured amount. Ask the " +
      "user for a Crunchbase cookie, or answer 'raised recently' instead of " +
      "'raised $X'",
  },
  investor_discovery: {
    id: "investor_discovery",
    required_capabilities: ["funding_signal"],
    preferred_actors: [...CRUNCHBASE],
    fallback_actors: [],
    corroborating_actors: [...NEWS],
    minimum_evidence:
      "an investor firm with an observed deal count. Crunchbase's investor " +
      "database mode serves this without a cookie; the investors ON a specific " +
      "round do not",
    freshness_requirement: "any",
  },

  // ── FOUNDER & SOCIAL ───────────────────────────────────────────────────────
  founder_announcements: {
    id: "founder_announcements",
    required_capabilities: ["social_activity"],
    preferred_actors: [...POST_SEARCH],
    fallback_actors: [...PROFILE_POSTS],
    corroborating_actors: [...NEWS],
    minimum_evidence: "a dated post by an identified person at the company",
    freshness_requirement: "within_week",
  },
  founder_hiring_signals: {
    id: "founder_hiring_signals",
    required_capabilities: ["social_activity", "hiring_signal"],
    preferred_actors: [...POST_SEARCH],
    fallback_actors: [...PROFILE_POSTS],
    corroborating_actors: [],
    minimum_evidence:
      "a post stating hiring intent. This is INTENT, not an open role — it may " +
      "prioritise a company but never satisfy a hiring gate on its own",
    freshness_requirement: "within_week",
  },
  founder_expansion_signals: {
    id: "founder_expansion_signals",
    required_capabilities: ["social_activity"],
    preferred_actors: [...POST_SEARCH],
    fallback_actors: [...PROFILE_POSTS],
    corroborating_actors: [...NEWS],
    minimum_evidence: "a dated post describing a new market, office or product line",
    freshness_requirement: "within_month",
  },
  company_linkedin_activity: {
    id: "company_linkedin_activity",
    required_capabilities: ["social_activity"],
    preferred_actors: [...COMPANY_POSTS],
    fallback_actors: [],
    corroborating_actors: [],
    minimum_evidence:
      "posts from the company's own LinkedIn URL — so identity resolution must " +
      "have run first; this Actor consumes URLs and cannot find them",
    freshness_requirement: "within_month",
  },
  founder_linkedin_activity: {
    id: "founder_linkedin_activity",
    required_capabilities: ["social_activity"],
    preferred_actors: [...PROFILE_POSTS],
    fallback_actors: [],
    corroborating_actors: [],
    minimum_evidence:
      "posts from an identified founder's profile URL — again, after identity, " +
      "never before",
    freshness_requirement: "within_month",
  },

  // ── NEWS ───────────────────────────────────────────────────────────────────
  recent_company_news: {
    id: "recent_company_news",
    required_capabilities: ["news_signal"],
    preferred_actors: [...NEWS],
    fallback_actors: [...SERP],
    corroborating_actors: [],
    minimum_evidence:
      "a dated article naming the company. Match on domain or LinkedIn URL, " +
      "never on name alone — two companies sharing a name share their news",
    freshness_requirement: "within_month",
  },
  product_launches: {
    id: "product_launches",
    required_capabilities: ["news_signal"],
    preferred_actors: [],
    fallback_actors: [...NEWS],
    corroborating_actors: [...POST_SEARCH],
    minimum_evidence: "a dated launch naming the product and the company",
    freshness_requirement: "within_month",
    blocked_reason:
      "the only Product Hunt Actor examined has 20 lifetime users, 4 monthly, " +
      "no rating, and requires a Product Hunt API token for every mode except " +
      "a limited leaderboard. News and post search can approximate a launch, " +
      "but no structured launch source is registered",
  },

  // ── DISCOVERY ──────────────────────────────────────────────────────────────
  startup_discovery: {
    id: "startup_discovery",
    required_capabilities: ["company_discovery"],
    preferred_actors: [...YC_DISCOVERY],
    fallback_actors: [...COMPANY_SEARCH],
    corroborating_actors: [],
    minimum_evidence: "a company with a name and a resolvable domain or LinkedIn URL",
    freshness_requirement: "any",
  },
  yc_startup_discovery: {
    id: "yc_startup_discovery",
    required_capabilities: ["company_discovery"],
    preferred_actors: [...YC_DISCOVERY],
    fallback_actors: [],
    corroborating_actors: [],
    minimum_evidence: "a YC batch and company record",
    freshness_requirement: "any",
  },
  b2b_company_discovery: {
    id: "b2b_company_discovery",
    required_capabilities: ["company_discovery", "company_enrichment"],
    preferred_actors: [...YC_DISCOVERY, ...COMPANY_SEARCH],
    fallback_actors: [],
    corroborating_actors: [],
    minimum_evidence:
      "an ENRICHED industry. Both discovery sources report industry as a " +
      "self-declared or unreliable field; only enrichment settles it",
    freshness_requirement: "any",
  },
  saas_company_discovery: {
    id: "saas_company_discovery",
    required_capabilities: ["company_discovery", "company_enrichment"],
    preferred_actors: [...YC_DISCOVERY, ...COMPANY_SEARCH],
    fallback_actors: [],
    corroborating_actors: [...SERP],
    minimum_evidence:
      "a description or enriched industry indicating software sold as a " +
      "subscription. No registered source has a 'SaaS' flag",
    freshness_requirement: "any",
  },
  company_size_discovery: {
    id: "company_size_discovery",
    required_capabilities: ["company_discovery", "company_enrichment"],
    preferred_actors: [...COMPANY_SEARCH, ...YC_DISCOVERY],
    fallback_actors: [],
    corroborating_actors: [],
    minimum_evidence:
      "an ENRICHED exact headcount. Every discovery source here reports a band " +
      "or a self-reported figure, and the LinkedIn company search's own size " +
      "filter disagreed with reality in four of eight observed rows",
    freshness_requirement: "any",
  },
  geographic_discovery: {
    id: "geographic_discovery",
    required_capabilities: ["company_discovery"],
    preferred_actors: [...YC_DISCOVERY, ...COMPANY_SEARCH],
    fallback_actors: [],
    corroborating_actors: [],
    minimum_evidence:
      "a location on the company record. haketa's YC source offers 76 named " +
      "regions and countries — far finer than the incumbent YC source",
    freshness_requirement: "any",
  },
  market_industry_discovery: {
    id: "market_industry_discovery",
    required_capabilities: ["company_discovery", "company_enrichment"],
    preferred_actors: [...COMPANY_SEARCH, ...YC_DISCOVERY],
    fallback_actors: [],
    corroborating_actors: [...NEWS],
    minimum_evidence: "an enriched industry id, never a provider's industry tag",
    freshness_requirement: "any",
  },
  competitor_discovery: {
    id: "competitor_discovery",
    required_capabilities: ["company_discovery"],
    preferred_actors: [...COMPANY_SEARCH],
    fallback_actors: [...SERP],
    corroborating_actors: [...NEWS],
    minimum_evidence:
      "a company in the same market. NOTE: the LinkedIn company search matches " +
      "company NAMES, not concepts, so 'competitors of X' must be expressed as " +
      "named companies or a SERP query, never as a description",
    freshness_requirement: "any",
  },

  // ── TECHNOLOGY ─────────────────────────────────────────────────────────────
  technology_stack_discovery: {
    id: "technology_stack_discovery",
    required_capabilities: ["company_discovery", "technology_signal"],
    preferred_actors: [],
    fallback_actors: [],
    corroborating_actors: [],
    minimum_evidence: "a company confirmed to run the named technology",
    freshness_requirement: "any",
    // VERIFIED, NOT ASSUMED. BuiltWith's live input schema has exactly two
    // fields: startDomains and maxRequestsPerCrawl.
    blocked_reason:
      "no registered Actor can find companies BY technology. BuiltWith — the " +
      "only technology source — takes a list of domains you already have and " +
      "returns what they run. There is no query field and no reverse lookup. " +
      "Discover companies another way first, then VERIFY the technology",
  },
  technology_stack_verification: {
    id: "technology_stack_verification",
    required_capabilities: ["technology_signal"],
    preferred_actors: ["builtwith/builtwith-official-technology-scraper"],
    fallback_actors: [],
    corroborating_actors: [],
    minimum_evidence:
      "the technology detected on the company's own domain — so the domain " +
      "must already be known",
    freshness_requirement: "any",
  },
  competitor_technology_adoption: {
    id: "competitor_technology_adoption",
    required_capabilities: ["company_discovery", "technology_signal"],
    preferred_actors: [],
    fallback_actors: [],
    corroborating_actors: [],
    minimum_evidence: "a competitor confirmed to run the named technology",
    freshness_requirement: "any",
    blocked_reason:
      "same shape as technology_stack_discovery — this asks the reverse lookup " +
      "BuiltWith does not offer. Reachable only as competitor_discovery " +
      "followed by technology_stack_verification, at one enrichment call each",
  },

  // ── CORPORATE EVENTS ───────────────────────────────────────────────────────
  acquisition_signals: {
    id: "acquisition_signals",
    required_capabilities: ["news_signal"],
    preferred_actors: [...NEWS],
    fallback_actors: [...CRUNCHBASE],
    corroborating_actors: [...POST_SEARCH],
    minimum_evidence:
      "a dated article or a Crunchbase status of 'Acquired'. YC's directory " +
      "also carries an Acquired status",
    freshness_requirement: "within_month",
  },
  growth_signals: {
    id: "growth_signals",
    required_capabilities: ["news_signal", "hiring_signal"],
    preferred_actors: [...NEWS],
    fallback_actors: [...COMPANY_POSTS],
    corroborating_actors: [...POST_SEARCH],
    minimum_evidence:
      "two independent indicators — headcount, funding, news or open roles. " +
      "One is an anecdote",
    freshness_requirement: "within_month",
  },
  expansion_signals: {
    id: "expansion_signals",
    required_capabilities: ["news_signal", "social_activity"],
    preferred_actors: [...NEWS],
    fallback_actors: [...COMPANY_POSTS],
    corroborating_actors: [...POST_SEARCH],
    minimum_evidence: "a dated statement of a new market, office or product line",
    freshness_requirement: "within_month",
  },
});

// ── ACCESSORS ────────────────────────────────────────────────────────────────

export function scenario(id: ScenarioId): ScenarioSpec | null {
  return SCENARIO_MATRIX[id] ?? null;
}

/** Scenarios no registered Actor can serve, with the reason each is blocked. */
export function blockedScenarios(): ScenarioSpec[] {
  return Object.values(SCENARIO_MATRIX).filter((s) => s.blocked_reason != null);
}

/**
 * Can this scenario be attempted at all?
 *
 * A scenario is servable when it has at least one preferred or fallback Actor
 * AND is not explicitly blocked. The two are separate checks on purpose: a
 * blocked scenario may still list fallbacks that PARTLY address it — funding
 * amount can fall back to news — and the planner must be able to tell "there is
 * a lesser answer" from "there is an answer".
 */
export function scenarioIsServable(s: ScenarioSpec): boolean {
  return s.blocked_reason == null && s.preferred_actors.length > 0;
}

/**
 * Every Actor a scenario may legitimately involve, in execution order.
 *
 * Corroborating Actors come LAST and are marked as such by their position:
 * they support a claim another Actor already made, and may never introduce a
 * candidate of their own.
 */
export function scenarioActors(s: ScenarioSpec): string[] {
  return [...s.preferred_actors, ...s.fallback_actors, ...s.corroborating_actors];
}

/**
 * The model-readable matrix.
 *
 * Blocked scenarios are INCLUDED, with their reason. A planner that cannot see
 * what is impossible will keep proposing it, and the user will keep receiving
 * confident empty results instead of "we cannot answer that, here is why".
 */
export function scenarioBriefing(): Array<Record<string, unknown>> {
  return Object.values(SCENARIO_MATRIX).map((s) => ({
    scenario: s.id,
    required_capabilities: s.required_capabilities,
    preferred_actors: s.preferred_actors,
    fallback_actors: s.fallback_actors,
    corroborating_actors: s.corroborating_actors,
    minimum_evidence: s.minimum_evidence,
    freshness_requirement: s.freshness_requirement,
    servable: scenarioIsServable(s),
    ...(s.blocked_reason ? { blocked_reason: s.blocked_reason } : {}),
  }));
}

/**
 * Actor ids named by the matrix that this registry cannot resolve.
 *
 * The matrix references two naming systems: the repo's capability keys
 * (`apify_yc_companies_memo23`, `apify_linkedin_company_search`), which are
 * validated by `hiringActorCatalog`, and Store ids from the intelligence
 * registry. This reports only the second kind, so a typo in a Store id cannot
 * sit unnoticed in a scenario nobody has exercised yet.
 */
export function unresolvedIntelligenceIds(): string[] {
  const out = new Set<string>();
  for (const s of Object.values(SCENARIO_MATRIX)) {
    for (const id of scenarioActors(s)) {
      if (!id.includes("/")) continue; // a repo capability key, not a Store id
      if (!actorIntelligence(id)) out.add(id);
    }
  }
  return [...out];
}

/** Capabilities a scenario needs that no registered Actor can produce. */
export function unmetCapabilities(s: ScenarioSpec): ActorCapability[] {
  return s.required_capabilities.filter((c) => actorsWithCapability(c).length === 0);
}
