// MISSION → RESEARCH PLAYBOOK. The one place that answers "HOW do we research
// this request?" — and nothing else.
//
// ── THE FOUR LAYERS, AND WHAT EACH ONE OWNS ─────────────────────────────────
//
//   MISSION      what the user asked for. Compiled once by the model from their
//                own sentence, and the only semantic authority.
//   PLAYBOOK     the research WORKFLOW that answers it — hiring, funding,
//                social, news, supplied companies. Stable vocabulary: it does
//                not change when an Actor is swapped, repriced or retired.
//   CAPABILITY   an implementation-level ability (`CAPABILITY_REGISTRY`).
//   PROVIDER     an Actor that implements a capability (`hiringActorCatalog`).
//
// A playbook names CAPABILITIES. It never names an Actor. That is what keeps
// this contract stable across provider churn, and it is why a playbook cannot
// be defined by listing the actors it happens to use today.
//
// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
//
//   NOT `company_first` / `person_first` / `job_first`. Those describe which
//   entity a pipeline touches first — an execution detail of one path — and are
//   deliberately absent from this vocabulary. The Workbench is company-first for
//   EVERY playbook: companies are the result, and founders, decision makers and
//   contact details are unlock layers on top (`buildCapabilityGraph` puts all
//   three in `offered_capabilities`, never in `steps`). A playbook chooses how
//   companies are DISCOVERED AND PROVEN, not what the output is made of.
//
//   NOT execution. This selects; it runs nothing. The capability ids below are
//   read out of `CAPABILITY_REGISTRY` so a caller can see what a playbook WOULD
//   reach — facts about the catalogue, not instructions to run it.
//
//   NOT a second registry. Every capability id is checked against
//   `CAPABILITY_REGISTRY` at module load.
//
// THE MISSION IS THE AUTHORITY. Every input is a typed Mission field. Nothing
// here reads `original_user_query`, and nothing here parses text.
//
// PURE. No network, provider, model or database access.

import {
  MISSION_STRATEGIES, isMissionStrategy,
  type LeadMissionV1, type MissionStrategy,
} from "./leadMission.ts";
import { CAPABILITY_REGISTRY, type CapabilityId } from "./leadCapabilityGraph.ts";

export const RESEARCH_PLAYBOOK_VERSION = "lead-research-playbook-v2" as const;

// ─────────────────────────── executability, from the engine ─────────────────

/**
 * Capabilities `runCapabilityPlan` ACTUALLY DRIVES.
 *
 * This is the difference between a capability that exists and one that runs. For
 * a task carrying a LeadMissionV1 the engine claims execution outright
 * ("the capability graph is the state machine"), so a capability the engine does
 * not implement returns `skipped_no_input` and the mission produces nothing from
 * it — however many providers its registry entry lists.
 *
 * Phase 2 got this wrong: it marked `funding` and `supplied_company` supported
 * because their capabilities exist and name providers. They are skipped by the
 * engine, so nothing was ever going to run. `leadResearchPlaybooks.test.ts`
 * re-derives this list from the engine's own source, so it cannot drift into a
 * comfortable fiction.
 */
export const ENGINE_DRIVEN_CAPABILITIES: readonly CapabilityId[] = Object.freeze([
  "startup_company_discovery",
  "general_company_discovery",
  // Joined when the funding capability gained a provider that can keep its
  // claim. It runs through the same shared discovery stage as the two above.
  "funding_signal_discovery",
  "company_identity_resolution",
  "company_enrichment",
  "hiring_verification",
  "company_brain_qualification",
  "founder_discovery",
  "employer_verification",
  "contact_enrichment",
  "persistence",
]);

const ENGINE_DRIVEN: ReadonlySet<string> = new Set(ENGINE_DRIVEN_CAPABILITIES);

export function isEngineDriven(c: CapabilityId): boolean {
  return ENGINE_DRIVEN.has(c);
}

// ───────────────────────────── signals vs shapes ────────────────────────────

/**
 * WHAT A SIGNAL DOES FOR RESEARCH — and why `expansion` is not a strategy.
 *
 * `required_signals[].type` is an OPEN vocabulary (hiring, funding, expansion,
 * leadership_change, technology, …). `MISSION_STRATEGIES` is a CLOSED one. They
 * are not the same question, and the difference is which half of the research
 * they belong to:
 *
 *   `discovery_shape` — the signal is a way to FIND companies. There is a source
 *                       you can search to enumerate companies that have it, so
 *                       it can be a research workflow of its own.
 *   `qualifier`       — the signal is something you PROVE about companies you
 *                       already found. There is no "list the expanding
 *                       companies" source; you discover by profile and then
 *                       check for expansion.
 *
 * The capability graph already draws this line: `hiring_verification` and
 * `expansion_signal_verification` are VERIFICATION stages, applied to a set that
 * discovery produced. Promoting every signal type to a strategy would mean
 * `leadership_change`, `technology` and `product_launch` each need one too —
 * the thirty-name taxonomy `leadCapabilityGraph`'s own header rejects.
 *
 * So a qualifier signal never selects a playbook, and a mission whose ONLY
 * signal is a qualifier has no way to discover anything. That is reported, not
 * rounded to the nearest shape.
 */
export type SignalResearchRole = "discovery_shape" | "qualifier";

export const SIGNAL_RESEARCH_ROLES: Readonly<Record<string, SignalResearchRole>> =
  Object.freeze({
    hiring: "discovery_shape",
    funding: "discovery_shape",
    // `expansion` has BOTH a discovery and a verification capability in the
    // registry, and neither is engine-driven. Its discovery entry
    // (`expansion_signal_discovery`) points at `apify_linkedin_company_search`,
    // which is a company-profile search with no expansion filter — so the
    // "discovery" is a general company search wearing an expansion label.
    // Classifying it as a qualifier is what the implementation actually is.
    expansion: "qualifier",
    leadership_change: "qualifier",
    technology: "qualifier",
    product_launch: "qualifier",
  });

/** The shape a discovery signal implies. Qualifiers map to nothing, by design. */
const SIGNAL_TO_STRATEGY: Readonly<Record<string, MissionStrategy>> = Object.freeze({
  hiring: "hiring",
  funding: "funding",
});

export function signalResearchRole(type: string): SignalResearchRole {
  // Unknown signal types are qualifiers. An unrecognised signal is something to
  // prove at most; it is never a licence to invent a discovery source for it.
  return SIGNAL_RESEARCH_ROLES[type.toLowerCase()] ?? "qualifier";
}

// ─────────────────────────────── the catalogue ──────────────────────────────

/**
 * A playbook is named after the research shape it serves, one-to-one with
 * `MISSION_STRATEGIES` — except `multi_signal`, which is not a playbook.
 *
 * The Mission's own contract settles that: "`multi_signal` is not a catch-all:
 * it means the request requires two or more of the others to hold TOGETHER". So
 * it is a COMBINATION RULE over the playbooks beside it, modelled as one below.
 */
export type ResearchPlaybookId = Exclude<MissionStrategy, "multi_signal">;

/** Why a playbook cannot run. Every value is provable from the code. */
export type PlaybookGap =
  /** No capability in `CAPABILITY_REGISTRY` implements this research shape. */
  | "no_capability_defined"
  /** The capability exists but no approved Actor implements it. */
  | "no_approved_provider"
  /** Registry and providers exist; `runCapabilityPlan` skips the capability. */
  | "capability_not_engine_driven";

export type PlaybookSupportStatus =
  /** Discovery and every proving capability are engine-driven. */
  | "supported"
  /** Discovery runs; at least one proving capability does not. */
  | "partial"
  /** Nothing can discover companies for this shape. */
  | "unsupported";

export interface PlaybookCapabilityRequirement {
  capability: CapabilityId;
  role: "discovery" | "proving";
  /** Approved Actor keys, READ from the registry. Informational only. */
  providers: string[];
  engine_driven: boolean;
}

export interface ResearchPlaybookSpec {
  id: ResearchPlaybookId;
  strategy: MissionStrategy;
  label: string;
  /** What this playbook discovers and proves. Outcome language, no provider. */
  description: string;
  /**
   * Discovery capabilities this shape may enter through, most specific first.
   *
   * A LIST, not a single entry, because the capability graph legitimately
   * refines the entry by company profile: a hiring mission targeting startups
   * enters at `startup_company_discovery` and one targeting manufacturers at
   * `general_company_discovery`. Both are the hiring playbook. Naming one entry
   * here would either contradict the graph or duplicate its refinement logic.
   *
   * Empty means the shape has no implementation at all.
   */
  discovery_capabilities: CapabilityId[];
  /** Capabilities that PROVE the shape once companies are discovered. */
  proving_capabilities: CapabilityId[];
  /**
   * Registered Actor keys that a future capability for this shape would
   * plausibly reach. NEVER used for routing — a key here is not an approval,
   * and nothing may run it until a capability names it. It exists so the next
   * phase starts from facts instead of a survey.
   */
  unwired_actor_keys: string[];
  /** Known limitations worth carrying into the next phase. */
  notes: string[];
}

export const RESEARCH_PLAYBOOKS:
  Readonly<Record<ResearchPlaybookId, ResearchPlaybookSpec>> = Object.freeze({
    hiring: {
      id: "hiring",
      strategy: "hiring",
      label: "Hiring-signal research",
      description:
        "Discover companies — from the startup cohort when the mission targets " +
        "startups, otherwise by company profile — and prove they are hiring the " +
        "requested role.",
      // Deliberately NOT `job_discovery`. The four job boards can discover but
      // have no card in `hiringActorCatalog`, so no bounded input can be
      // compiled for them; `buildCapabilityGraph` documents this at length and
      // routes hiring the same way. This module does not hold a second opinion.
      discovery_capabilities: ["startup_company_discovery", "general_company_discovery"],
      proving_capabilities: ["hiring_verification"],
      unwired_actor_keys: [],
      notes: [
        "hiring_verification settles from YC openJobs for free before it will " +
        "consider a paid company-scoped job search",
      ],
    },
    funding: {
      id: "funding",
      strategy: "funding",
      label: "Funding-signal research",
      description:
        "Discover companies through a recent funding event and carry the event " +
        "forward as the evidence for why now.",
      discovery_capabilities: ["funding_signal_discovery"],
      proving_capabilities: [],
      unwired_actor_keys: [],
      notes: [
        "funding_signal_discovery now runs apify_funding_rounds_datahyena, " +
        "which returns one row per funding EVENT — company, stage, amount in " +
        "USD, announced date, investors and source articles — with the amount " +
        "ungated by any session cookie. It replaced apify_yc_companies_memo23, " +
        "whose schema has no funding field at all and whose YC batch membership " +
        "is a funding proxy rather than a funding search",
        "DISCOVERY ONLY. The source has no company, domain or URL input, so it " +
        "cannot confirm funding for a pool discovered another way, and the " +
        "absence of a row proves nothing. A mission needing funding proven " +
        "about companies it already holds is still unserved",
        "a row without an announced date is refused as evidence during " +
        "normalization, so a funding claim always carries a date",
      ],
    },
    supplied_company: {
      id: "supplied_company",
      strategy: "supplied_company",
      label: "Supplied-company research",
      description:
        "Skip discovery entirely: the request named the companies, so they are " +
        "resolved to canonical identities and evaluated directly.",
      discovery_capabilities: ["known_company_resolution"],
      proving_capabilities: [],
      unwired_actor_keys: [],
      notes: [
        "the downstream pipeline (identity, enrichment, qualification) IS " +
        "engine-driven; only the resolution of the supplied list is not, so " +
        "this shape currently starts with an empty company set",
      ],
    },
    social: {
      id: "social",
      strategy: "social",
      label: "Social-signal research",
      description:
        "Discover companies through what their people post and discuss on " +
        "social platforms, and carry the post as the evidence.",
      // NO CAPABILITY EXISTS. `CAPABILITY_REGISTRY` has no social discovery
      // stage, so there is nothing to enter — and saying so is the point.
      discovery_capabilities: [],
      proving_capabilities: [],
      unwired_actor_keys: [
        "apify_linkedin_posts", "apify_linkedin_company_posts",
        "apify_linkedin_profile_posts", "apify_linkedin_post_comments",
      ],
      notes: [
        "these Actors are registered and runtime-gated, and pilot-chat's " +
        "signal_sourcing branch already drives them for the SOCIAL workflow — " +
        "a different product surface. No lead capability names them, so no " +
        "lead mission can reach them",
        "RequestedOutput.social_posts can express 'posts are the artefact' but " +
        "TARGET_ENTITY_FOR_OUTPUT maps it to `person`, because the entity enum " +
        "has no post value; that mapping is provisional until this shape lands",
      ],
    },
    news: {
      id: "news",
      strategy: "news",
      label: "News-signal research",
      description:
        "Discover companies through published news — announcements, coverage, " +
        "launches — and carry the article as the evidence.",
      discovery_capabilities: [],
      proving_capabilities: [],
      unwired_actor_keys: [
        "apify_google_search", "search_web", "firecrawl_scrape_url",
        "apify_website_content",
      ],
      notes: [
        "general search and scrape Actors exist; none is bound to a news " +
        "discovery capability, and a general web search is not a news source",
      ],
    },
  });

/** Every capability a playbook names must exist in the graph's own registry. */
function assertPlaybookCapabilitiesExist(): void {
  for (const p of Object.values(RESEARCH_PLAYBOOKS)) {
    for (const c of [...p.discovery_capabilities, ...p.proving_capabilities]) {
      if (!(c in CAPABILITY_REGISTRY)) {
        throw new Error(
          `playbook ${p.id} names capability ${c}, which CAPABILITY_REGISTRY does not define`,
        );
      }
    }
  }
}
assertPlaybookCapabilitiesExist();

/** Requirements for a playbook, with providers and executability resolved. */
export function playbookRequirements(
  id: ResearchPlaybookId,
): PlaybookCapabilityRequirement[] {
  const spec = RESEARCH_PLAYBOOKS[id];
  const req = (capability: CapabilityId, role: "discovery" | "proving") => ({
    capability, role,
    providers: [...CAPABILITY_REGISTRY[capability].providers],
    engine_driven: isEngineDriven(capability),
  });
  return [
    ...spec.discovery_capabilities.map((c) => req(c, "discovery")),
    ...spec.proving_capabilities.map((c) => req(c, "proving")),
  ];
}

/**
 * Can this playbook actually run, and if not, why?
 *
 * A shape is only `supported` when something can DISCOVER companies for it.
 * `known_company_resolution` having `providers: []` is not a gap on its own —
 * resolving companies the user named is deterministic work the registry prices
 * at zero — so the provider check applies only to a capability that expects to
 * buy something.
 */
export function playbookSupport(
  id: ResearchPlaybookId,
): { status: PlaybookSupportStatus; gaps: PlaybookGap[] } {
  const spec = RESEARCH_PLAYBOOKS[id];
  const gaps: PlaybookGap[] = [];

  if (spec.discovery_capabilities.length === 0) {
    return { status: "unsupported", gaps: ["no_capability_defined"] };
  }

  const runnableDiscovery = spec.discovery_capabilities.filter((c) => {
    const entry = CAPABILITY_REGISTRY[c];
    if (entry.providers.length === 0 && entry.cost_units > 0) {
      if (!gaps.includes("no_approved_provider")) gaps.push("no_approved_provider");
      return false;
    }
    if (!isEngineDriven(c)) {
      if (!gaps.includes("capability_not_engine_driven")) {
        gaps.push("capability_not_engine_driven");
      }
      return false;
    }
    return true;
  });

  if (runnableDiscovery.length === 0) return { status: "unsupported", gaps };

  const provingGaps = spec.proving_capabilities.filter((c) => !isEngineDriven(c));
  if (provingGaps.length > 0) {
    if (!gaps.includes("capability_not_engine_driven")) {
      gaps.push("capability_not_engine_driven");
    }
    return { status: "partial", gaps };
  }
  return { status: "supported", gaps };
}

// ──────────────────────── the two strategy vocabularies ─────────────────────

/**
 * THE OTHER "STRATEGY", AND WHY IT IS NOT ONE.
 *
 * `directives.source_strategy` (`SOURCE_STRATEGIES` in leadMissionCompiler) is a
 * separate, model-proposed list: `startup_cohort_first`, `job_signal_first`,
 * `company_profile_first`, `known_companies_only`, `evidence_reuse_first`.
 *
 * It is an EXECUTION PREFERENCE — a hint about which approved source to reach
 * for first — and it is NOT a research shape. Two of its five values are
 * nonetheless close enough to a shape to be mistaken for one, and
 * `buildCapabilityGraph` reads one of them (`job_signal_first`) when choosing an
 * entry capability. That is the second routing authority this phase exists to
 * make visible: a mission could declare `strategies: ["funding"]` while its
 * directives said `job_signal_first`, and the graph would route the hiring shape
 * while the playbook said funding, with nothing recording the disagreement.
 *
 * SELECTION DOES NOT READ IT. `selectResearchPlaybooks` takes `strategies`,
 * `required_signals` and `known_companies` — nothing else — so a source-strategy
 * hint cannot turn one shape into another here. When the caller supplies the
 * directives, a disagreement is REPORTED as a conflict so Phase 3 can retire the
 * graph's use of it against measured data rather than assumption.
 *
 * The three unmapped values imply no shape: they express a preference among
 * sources for a shape already chosen, which is exactly what an execution hint
 * should be.
 */
export const SOURCE_STRATEGY_IMPLIED_SHAPE:
  Readonly<Record<string, ResearchPlaybookId | null>> = Object.freeze({
    job_signal_first: "hiring",
    known_companies_only: "supplied_company",
    startup_cohort_first: null,
    company_profile_first: null,
    evidence_reuse_first: null,
  });

export interface RoutingAuthorityConflict {
  source_strategy: string;
  implies_playbook: ResearchPlaybookId;
  selected_playbooks: ResearchPlaybookId[];
  detail: string;
}

// ───────────────────────────────── selection ────────────────────────────────

export interface SelectedPlaybook {
  playbook: ResearchPlaybookId;
  status: PlaybookSupportStatus;
  gaps: PlaybookGap[];
  /** Capabilities this playbook needs, with providers and executability. */
  requirements: PlaybookCapabilityRequirement[];
  /** Which Mission field selected it. */
  selected_by: "mission_strategies" | "required_signals" | "known_companies";
  reason: string;
}

/**
 * How the selected playbooks relate.
 *
 *   `single`          — one shape answers the request.
 *   `all_must_hold`   — `multi_signal`: the request needs two or more shapes to
 *                       hold TOGETHER ("recently funded AND hiring SDRs"), which
 *                       is a different question from either alone.
 *   `any_may_satisfy` — several shapes named without `multi_signal`: each is a
 *                       route to the same answer rather than a conjunct.
 *   `none`            — nothing was selected.
 */
export type PlaybookCombination = "single" | "all_must_hold" | "any_may_satisfy" | "none";

export type StrategySource =
  | "mission_strategies"
  | "derived_from_mission_fields"
  | "none";

export interface ResearchPlaybookSelection {
  version: typeof RESEARCH_PLAYBOOK_VERSION;
  /** EVERY shape the mission asked for, each with its own support status. */
  playbooks: SelectedPlaybook[];
  /** The subset that can actually run today. */
  runnable: ResearchPlaybookId[];
  /** The subset that cannot, with the gap that stops each one. */
  blocked: Array<{
    playbook: ResearchPlaybookId;
    status: PlaybookSupportStatus;
    gaps: PlaybookGap[];
    unwired_actor_keys: string[];
    notes: string[];
  }>;
  /**
   * Values in `strategies` outside the vocabulary.
   *
   * `validateLeadMission` already drops unknown strategies and records
   * `unknown_strategy_dropped`, so this is normally empty — it exists because a
   * mission can arrive from a row written by an older or newer build, and a
   * strategy nobody recognises must be reported rather than ignored.
   */
  unknown_strategies: string[];
  /**
   * Signals that are QUALIFIERS rather than research shapes — `expansion`,
   * `leadership_change`, `technology` and anything unrecognised. They are
   * things to prove about companies discovered some other way, so they select
   * no playbook. Reported so the distinction is visible rather than looking
   * like a dropped constraint.
   */
  qualifying_signals: string[];
  combination: PlaybookCombination;
  strategy_source: StrategySource;
  /** Disagreements between `strategies` and `directives.source_strategy`. */
  routing_conflicts: RoutingAuthorityConflict[];
  /**
   * True when the request is answerable today: for a conjunction every shape
   * must be supported; otherwise at least one must be.
   */
  ok: boolean;
  reason: string;
}

/**
 * Choose the research playbook(s) for a decided Mission.
 *
 * INPUTS, all typed Mission fields:
 *   `strategies`                       the model's declared research shape
 *   `required_signals[].type`          the shape implied by what must be proven
 *   `company_profile.known_companies`  the request supplied its own companies
 *
 * `directives` is accepted ONLY to detect a routing conflict and never to
 * select. It does not read `original_user_query` and runs no parser.
 *
 * An unsupported shape is REPORTED, never substituted. There is deliberately no
 * branch that falls back to hiring, to general discovery, or to whatever the
 * capability graph would have done anyway.
 */
export function selectResearchPlaybooks(
  mission: Pick<LeadMissionV1, "strategies" | "required_signals" | "company_profile"> &
    { directives?: { source_strategy?: string[] } },
): ResearchPlaybookSelection {
  const declared = mission.strategies ?? [];
  const unknown_strategies = declared
    .map((s) => String(s ?? "").trim())
    .filter((s) => s.length > 0 && !isMissionStrategy(s));

  const known = declared.filter((s): s is MissionStrategy => isMissionStrategy(s));
  const signalTypes = (mission.required_signals ?? [])
    .map((s) => String(s?.type ?? "").trim().toLowerCase())
    .filter(Boolean);
  const suppliedCompanies = (mission.company_profile?.known_companies ?? []).length > 0;

  const qualifying_signals = [...new Set(
    signalTypes.filter((t) => signalResearchRole(t) === "qualifier"),
  )];

  const requiresAllTogether = known.includes("multi_signal");
  const declaredShapes = known.filter((s): s is ResearchPlaybookId => s !== "multi_signal");

  // ── WHICH SHAPES ──────────────────────────────────────────────────────────
  let shapes: Array<{ id: ResearchPlaybookId; by: SelectedPlaybook["selected_by"] }>;
  let strategy_source: StrategySource;
  let reason: string;

  if (declaredShapes.length > 0) {
    shapes = dedupeById(declaredShapes.map((id) => ({ id, by: "mission_strategies" as const })));
    strategy_source = "mission_strategies";
    reason = `the mission declares ${shapes.map((s) => s.id).join(", ")}`;
  } else {
    // DERIVED — from other decided fields, never from the sentence. A mission
    // compiled deterministically has no `strategies` at all, and a model may
    // legitimately name none; supplied companies and discovery signals each
    // state a shape on their own.
    const derived: Array<{ id: ResearchPlaybookId; by: SelectedPlaybook["selected_by"] }> = [];
    if (suppliedCompanies) derived.push({ id: "supplied_company", by: "known_companies" });
    for (const t of signalTypes) {
      const s = SIGNAL_TO_STRATEGY[t];
      if (s && s !== "multi_signal") {
        derived.push({ id: s as ResearchPlaybookId, by: "required_signals" });
      }
    }
    shapes = dedupeById(derived);
    strategy_source = shapes.length ? "derived_from_mission_fields" : "none";
    reason = shapes.length
      ? `the mission declares no strategy; ${shapes.map((s) => s.id).join(", ")} ` +
        `derived from ${suppliedCompanies ? "supplied companies and " : ""}required signals`
      : "the mission declares no strategy and carries no discovery signal or " +
        "supplied companies from which one could be derived";
    if (requiresAllTogether && shapes.length > 0) {
      reason += "; multi_signal was declared without the shapes it combines";
    }
  }

  // ── SUPPORT ───────────────────────────────────────────────────────────────
  const playbooks: SelectedPlaybook[] = shapes.map(({ id, by }) => {
    const { status, gaps } = playbookSupport(id);
    return {
      playbook: id,
      status,
      gaps,
      requirements: playbookRequirements(id),
      selected_by: by,
      reason: by === "mission_strategies"
        ? `the mission's strategies include ${id}`
        : by === "known_companies"
        ? "the mission supplies its own companies"
        : `derived from the mission's required signals`,
    };
  });

  const runnable = playbooks.filter((p) => p.status === "supported").map((p) => p.playbook);
  const blocked = playbooks
    .filter((p) => p.status !== "supported")
    .map((p) => ({
      playbook: p.playbook,
      status: p.status,
      gaps: p.gaps,
      unwired_actor_keys: [...RESEARCH_PLAYBOOKS[p.playbook].unwired_actor_keys],
      notes: [...RESEARCH_PLAYBOOKS[p.playbook].notes],
    }));

  // ── ROUTING CONFLICTS ─────────────────────────────────────────────────────
  const selectedIds = playbooks.map((p) => p.playbook);
  const routing_conflicts: RoutingAuthorityConflict[] = [];
  for (const hint of mission.directives?.source_strategy ?? []) {
    const implied = SOURCE_STRATEGY_IMPLIED_SHAPE[String(hint ?? "").trim()];
    if (implied && !selectedIds.includes(implied)) {
      routing_conflicts.push({
        source_strategy: String(hint),
        implies_playbook: implied,
        selected_playbooks: [...selectedIds],
        detail:
          `directives.source_strategy "${hint}" implies the ${implied} shape, which ` +
          `the mission's strategies do not select — the Mission is the authority ` +
          `and this hint does not change the selection`,
      });
    }
  }

  // ── COMBINATION ───────────────────────────────────────────────────────────
  //
  // Decided from what was ASKED FOR, not from what survived support filtering:
  // a request needing funding AND social still needs both, and the fact that
  // neither can run today is a support gap, not a change to the question.
  let combination: PlaybookCombination;
  if (shapes.length === 0) combination = "none";
  else if (requiresAllTogether) combination = "all_must_hold";
  else if (shapes.length > 1) combination = "any_may_satisfy";
  else combination = "single";

  if (blocked.length > 0) {
    reason += `; blocked: ${blocked.map((b) => `${b.playbook}=${b.gaps.join("+") || b.status}`).join(", ")}`;
  }
  if (unknown_strategies.length > 0) {
    reason += `; unrecognised strategies: ${unknown_strategies.join(", ")}`;
  }
  if (qualifying_signals.length > 0) {
    reason += `; qualifier signals (no research shape): ${qualifying_signals.join(", ")}`;
  }
  if (routing_conflicts.length > 0) {
    reason += `; source_strategy conflicts: ${routing_conflicts.map((c) => c.source_strategy).join(", ")}`;
  }

  // A conjunctive request is satisfiable only when EVERY shape it names can run.
  // "Recently funded AND posting about outbound" is not answered by the funding
  // half; delivering that half as the answer is the substitution this prevents.
  const ok = requiresAllTogether
    ? playbooks.length > 0 && blocked.length === 0
    : runnable.length > 0;

  return {
    version: RESEARCH_PLAYBOOK_VERSION,
    playbooks, runnable, blocked,
    unknown_strategies, qualifying_signals,
    combination, strategy_source, routing_conflicts,
    ok, reason,
  };
}

function dedupeById<T extends { id: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

/** Compact shape for logs and audit rows. No provider is invoked to build it. */
export function playbookSelectionSummary(s: ResearchPlaybookSelection): Record<string, unknown> {
  return {
    version: s.version,
    ok: s.ok,
    combination: s.combination,
    strategy_source: s.strategy_source,
    selected: s.playbooks.map((p) => `${p.playbook}:${p.status}`),
    runnable: s.runnable,
    blocked: s.blocked.map((b) => `${b.playbook}:${b.gaps.join("+") || b.status}`),
    unknown_strategies: s.unknown_strategies,
    qualifying_signals: s.qualifying_signals,
    routing_conflicts: s.routing_conflicts.map((c) => `${c.source_strategy}->${c.implies_playbook}`),
    reason: s.reason,
  };
}

/**
 * The vocabulary this module refuses to speak.
 *
 * `company_first`, `person_first` and `job_first` describe which entity a
 * pipeline touches first. They are not research shapes, they are not playbooks,
 * and the Workbench is company-first for all of them — so admitting one here
 * would re-create the entity-ordering taxonomy the Mission was built to replace.
 * Exported so the prohibition is testable rather than a comment.
 */
export const FORBIDDEN_PLAYBOOK_VOCABULARY: readonly string[] = Object.freeze([
  "company_first", "person_first", "job_first",
]);

/** Every strategy in the Mission's vocabulary maps to a playbook or a rule. */
export const PLAYBOOK_STRATEGY_COVERAGE: Readonly<Record<MissionStrategy, string>> =
  Object.freeze(
    Object.fromEntries(
      MISSION_STRATEGIES.map((s) => [
        s,
        s === "multi_signal" ? "combination_rule" : `playbook:${s}`,
      ]),
    ) as Record<MissionStrategy, string>,
  );
