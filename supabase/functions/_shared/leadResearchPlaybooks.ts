// MISSION → RESEARCH PLAYBOOK. The one place that answers "HOW do we research
// this request?" — and nothing else.
//
// WHAT WAS MISSING.
//
// `LeadMissionV1.strategies` has existed since R2 and carries exactly this
// answer: the research SHAPE the interpreting model proposed — hiring, funding,
// social, news, supplied_company, multi_signal. Until now it had one consumer in
// the entire codebase (`separatedIntentFromMission`, checking `supplied_company`)
// and nothing dispatched on it.
//
// So the research shape was re-derived instead, in `buildCapabilityGraph`, from
// a mix of `required_capabilities`, `directives.source_strategy`, signals,
// supplied companies and company stages — and that mix has no way at all to
// express "research this through social posts" or "through news". A mission
// asking for either got a company-profile search and no record that its actual
// shape was never attempted.
//
// WHAT THIS IS NOT.
//
//   NOT `company_first` / `person_first` / `job_first`. Those describe which
//   entity a pipeline touches first, which is an execution detail of one path,
//   and they are deliberately absent from this module's vocabulary. The
//   Workbench is company-first for EVERY playbook: companies are the result,
//   and founders, decision makers and contact details are unlock layers on top
//   of them (`buildCapabilityGraph` puts all three in `offered_capabilities`,
//   never in `steps`). A playbook chooses how companies are DISCOVERED AND
//   PROVEN, not what the output is made of.
//
//   NOT execution. This selects; it runs nothing. No scraping, enrichment,
//   deduplication, evidence validation, persistence or rendering happens here,
//   and no provider is invoked. The capability ids and actor keys below are
//   READ out of `CAPABILITY_REGISTRY` so a caller can see what a playbook would
//   reach — they are facts about the catalogue, not instructions to run it.
//
//   NOT a second registry. Every capability id is checked against
//   `CAPABILITY_REGISTRY` at module load (`assertPlaybookCapabilitiesExist`), so
//   a playbook cannot name a stage the graph does not have.
//
// THE MISSION IS THE AUTHORITY. Every input below is a typed Mission field.
// Nothing here reads `original_user_query`, and nothing here parses text.
//
// PURE. No network, provider, model or database access.

import {
  MISSION_STRATEGIES, isMissionStrategy,
  type LeadMissionV1, type MissionStrategy,
} from "./leadMission.ts";
import { CAPABILITY_REGISTRY, type CapabilityId } from "./leadCapabilityGraph.ts";

export const RESEARCH_PLAYBOOK_VERSION = "lead-research-playbook-v1" as const;

// --------------------------------------------------------------- catalogue --

/**
 * A playbook is named after the research shape it serves, one-to-one with
 * `MISSION_STRATEGIES` — except `multi_signal`, which is not a playbook at all.
 *
 * The Mission's own contract already settles that: "`multi_signal` is not a
 * catch-all: it means the request requires two or more of the others to hold
 * TOGETHER". So it is a COMBINATION RULE over the playbooks beside it, and it
 * is modelled as one below rather than as a sixth entry here.
 */
export type ResearchPlaybookId = Exclude<MissionStrategy, "multi_signal">;

/** Why a playbook cannot run today. Structural, so the gap is actionable. */
export type PlaybookSupportGap =
  /** No capability in `CAPABILITY_REGISTRY` implements this research shape. */
  | "no_capability_defined"
  /** The capability exists but no approved Actor implements it. */
  | "no_approved_provider";

export interface ResearchPlaybookSpec {
  id: ResearchPlaybookId;
  /** The strategy this playbook serves. Same value; named for readability. */
  strategy: MissionStrategy;
  /** Human label. Shown in a plan preview, never used for routing. */
  label: string;
  /** What this playbook discovers and proves. Outcome language. */
  description: string;
  /**
   * The capability graph's DISCOVERY entry for this shape, or null when the
   * shape has no implementation yet. Null is the honest answer and is what
   * makes an unsupported playbook visible instead of silently rerouted.
   */
  entry_capability: CapabilityId | null;
  /**
   * Capabilities this shape needs beyond the entry, in addition to the standard
   * company pipeline the graph appends for every mission.
   */
  proving_capabilities: CapabilityId[];
  /** Set when `entry_capability` is null, or when the entry has no providers. */
  support_gap: PlaybookSupportGap | null;
  /**
   * What already exists for an unsupported shape, so the next phase starts from
   * facts rather than a survey. Actor keys registered in `actorRegistry` that a
   * future capability would plausibly reach. NEVER used for routing — a key
   * here is not an approval, and nothing may run it until a capability names it.
   */
  unwired_actor_keys: string[];
}

export const RESEARCH_PLAYBOOKS:
  Readonly<Record<ResearchPlaybookId, ResearchPlaybookSpec>> = Object.freeze({
    hiring: {
      id: "hiring",
      strategy: "hiring",
      label: "Hiring-signal research",
      description:
        "Discover companies by profile and prove they are hiring the requested " +
        "role, using company-scoped job verification.",
      // Deliberately NOT `job_discovery`. The four job boards can discover but
      // have no card in `hiringActorCatalog`, so no bounded input can be
      // compiled for them — `buildCapabilityGraph` documents this at length and
      // routes hiring the same way. This playbook does not invent a second
      // opinion about it.
      entry_capability: "general_company_discovery",
      proving_capabilities: ["hiring_verification"],
      support_gap: null,
      unwired_actor_keys: [],
    },
    funding: {
      id: "funding",
      strategy: "funding",
      label: "Funding-signal research",
      description:
        "Discover companies through a recent funding event and carry the event " +
        "forward as the evidence for why now.",
      entry_capability: "funding_signal_discovery",
      proving_capabilities: [],
      support_gap: null,
      unwired_actor_keys: [],
    },
    supplied_company: {
      id: "supplied_company",
      strategy: "supplied_company",
      label: "Supplied-company research",
      description:
        "Skip discovery entirely: the request named the companies, so they are " +
        "resolved to canonical identities and evaluated directly.",
      entry_capability: "known_company_resolution",
      proving_capabilities: [],
      support_gap: null,
      unwired_actor_keys: [],
    },
    social: {
      id: "social",
      strategy: "social",
      label: "Social-signal research",
      description:
        "Discover companies through what their people post and discuss on " +
        "social platforms, and carry the post as the evidence.",
      // NO CAPABILITY EXISTS. `CAPABILITY_REGISTRY` has no social discovery
      // stage, so there is nothing for a mission to enter — and saying so is
      // the entire point of this field being nullable.
      entry_capability: null,
      proving_capabilities: [],
      support_gap: "no_capability_defined",
      // These are registered and runtime-gated in `actorRegistry`, and pilot-chat's
      // `signal_sourcing` branch already drives them for the SOCIAL workflow —
      // which is a different product surface from lead research. No lead
      // capability names them, so no lead mission can reach them.
      unwired_actor_keys: [
        "apify_linkedin_posts", "apify_linkedin_company_posts",
        "apify_linkedin_profile_posts", "apify_linkedin_post_comments",
      ],
    },
    news: {
      id: "news",
      strategy: "news",
      label: "News-signal research",
      description:
        "Discover companies through published news — announcements, coverage, " +
        "launches — and carry the article as the evidence.",
      entry_capability: null,
      proving_capabilities: [],
      support_gap: "no_capability_defined",
      // General-purpose search/scrape actors exist, but none is bound to a news
      // discovery capability, and a general web search is not a news source.
      unwired_actor_keys: [
        "apify_google_search", "search_web", "firecrawl_scrape_url",
        "apify_website_content",
      ],
    },
  });

/**
 * Every capability a playbook names must exist in the graph's own registry.
 *
 * Run at module load, so a playbook that references a stage the registry does
 * not have fails immediately rather than at routing time. This is what keeps
 * this file a projection of the capability graph instead of a second registry.
 */
function assertPlaybookCapabilitiesExist(): void {
  for (const p of Object.values(RESEARCH_PLAYBOOKS)) {
    for (const c of [p.entry_capability, ...p.proving_capabilities]) {
      if (c && !(c in CAPABILITY_REGISTRY)) {
        throw new Error(
          `playbook ${p.id} names capability ${c}, which CAPABILITY_REGISTRY does not define`,
        );
      }
    }
  }
}
assertPlaybookCapabilitiesExist();

/** Providers the playbook's entry capability may reach. Read, never restated. */
export function playbookProviders(id: ResearchPlaybookId): string[] {
  const spec = RESEARCH_PLAYBOOKS[id];
  if (!spec.entry_capability) return [];
  return [...CAPABILITY_REGISTRY[spec.entry_capability].providers];
}

/**
 * Is this playbook runnable today?
 *
 * `supplied_company` has no providers by design — resolving companies the user
 * already named is deterministic work, `cost_units: 0` — so "has an entry
 * capability" is the test, and an empty provider list only disqualifies a
 * capability whose registry entry expects to buy something.
 */
export function playbookSupportGap(id: ResearchPlaybookId): PlaybookSupportGap | null {
  const spec = RESEARCH_PLAYBOOKS[id];
  if (!spec.entry_capability) return "no_capability_defined";
  const entry = CAPABILITY_REGISTRY[spec.entry_capability];
  if (entry.providers.length === 0 && entry.cost_units > 0) return "no_approved_provider";
  return null;
}

// ---------------------------------------------------------------- selection --

export interface SelectedPlaybook {
  playbook: ResearchPlaybookId;
  entry_capability: CapabilityId;
  proving_capabilities: CapabilityId[];
  /** Actor keys the entry capability may reach. Informational; nothing runs here. */
  providers: string[];
  /** Which Mission field put this playbook in the selection. */
  reason: string;
}

export interface UnsupportedPlaybook {
  playbook: ResearchPlaybookId;
  gap: PlaybookSupportGap;
  /** Registered but unbound Actor keys, so the next phase starts from facts. */
  unwired_actor_keys: string[];
  reason: string;
}

/**
 * How the selected playbooks relate to each other.
 *
 *   `single`         — one shape answers the request.
 *   `all_must_hold`  — the request needs two or more shapes to hold TOGETHER.
 *                      This is what `multi_signal` means in the Mission's own
 *                      contract ("recently funded AND hiring SDRs"), and it is
 *                      a different question from either shape alone.
 *   `any_may_satisfy` — several shapes were named without `multi_signal`, so
 *                      each is a route to the same answer rather than a
 *                      conjunct.
 *   `none`           — nothing was selected.
 */
export type PlaybookCombination = "single" | "all_must_hold" | "any_may_satisfy" | "none";

/** Where the research shape came from. Both are Mission fields; neither is text. */
export type StrategySource =
  /** `mission.strategies` — the interpreting model named the shape. */
  | "mission_strategies"
  /** Derived from other decided fields when the model named none. */
  | "derived_from_mission_fields"
  /** The mission carries nothing this module can turn into a shape. */
  | "none";

export interface ResearchPlaybookSelection {
  version: typeof RESEARCH_PLAYBOOK_VERSION;
  /** Runnable playbooks, in the order their strategies appear. */
  playbooks: SelectedPlaybook[];
  /** Shapes the mission asked for that have no implementation. */
  unsupported: UnsupportedPlaybook[];
  /**
   * Values in `strategies` that are not part of the vocabulary at all.
   *
   * `validateLeadMission` already drops unknown strategies and records
   * `unknown_strategy_dropped`, so this is normally empty — it exists because a
   * mission can also arrive from a persisted row written by an older or newer
   * build, and a strategy nobody recognises must be reported rather than
   * ignored.
   */
  unknown_strategies: string[];
  /**
   * Signals the mission carries that the strategy vocabulary cannot express.
   *
   * `expansion`, `leadership_change` and `technology` are legitimate
   * `required_signals[].type` values with no corresponding `MissionStrategy`.
   * `expansion` even has its own capability (`expansion_signal_discovery`).
   * Recording them here is how that vocabulary gap stays visible instead of
   * being silently rounded to `hiring`.
   */
  signals_without_strategy: string[];
  combination: PlaybookCombination;
  strategy_source: StrategySource;
  /** True when at least one runnable playbook was selected. */
  ok: boolean;
  /** Why this selection came out the way it did. Persisted for audit. */
  reason: string;
}

/** Signal types that map onto a research shape. Everything else is a gap. */
const SIGNAL_TO_STRATEGY: Readonly<Record<string, MissionStrategy>> = Object.freeze({
  hiring: "hiring",
  funding: "funding",
});

/**
 * Choose the research playbook(s) for a decided Mission.
 *
 * INPUTS, all typed Mission fields:
 *   `strategies`               the model's declared research shape — preferred
 *   `required_signals[].type`  the shape implied by what must be proven
 *   `company_profile.known_companies`  the request supplied its own companies
 *
 * It does NOT read `original_user_query`, and it runs no parser. If this
 * function ever needs the sentence, something upstream failed to compile a
 * Mission and the answer is to fix that, not to read the text here.
 *
 * An unsupported shape is REPORTED, never substituted. There is deliberately no
 * branch that falls back to hiring, to general discovery, or to "whatever the
 * capability graph would have done anyway" — a request researched by a shape
 * nobody asked for is a wrong answer delivered confidently.
 */
export function selectResearchPlaybooks(
  mission: Pick<LeadMissionV1, "strategies" | "required_signals" | "company_profile">,
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

  // Signals with no strategy vocabulary. Reported whether or not the model
  // declared strategies, because the gap is in the contract, not in the answer.
  const signals_without_strategy = [...new Set(
    signalTypes.filter((t) => !(t in SIGNAL_TO_STRATEGY)),
  )];

  const requiresAllTogether = known.includes("multi_signal");

  // ── WHICH SHAPES ──────────────────────────────────────────────────────────
  let shapes: ResearchPlaybookId[];
  let strategy_source: StrategySource;
  let reason: string;

  const declaredShapes = known.filter(
    (s): s is ResearchPlaybookId => s !== "multi_signal",
  );

  if (declaredShapes.length > 0) {
    shapes = dedupe(declaredShapes);
    strategy_source = "mission_strategies";
    reason = `the mission declares ${shapes.join(", ")}`;
  } else {
    // DERIVED — from other decided fields, never from the sentence.
    //
    // A mission compiled deterministically has no `strategies` at all, and a
    // model may legitimately name none. What it cannot do is leave the request
    // shapeless: supplied companies and required signals each state a shape.
    const derived: ResearchPlaybookId[] = [];
    if (suppliedCompanies) derived.push("supplied_company");
    for (const t of signalTypes) {
      const s = SIGNAL_TO_STRATEGY[t];
      if (s && s !== "multi_signal") derived.push(s as ResearchPlaybookId);
    }
    shapes = dedupe(derived);
    strategy_source = shapes.length ? "derived_from_mission_fields" : "none";
    reason = shapes.length
      ? `the mission declares no strategy; ${shapes.join(", ")} derived from ` +
        `${suppliedCompanies ? "supplied companies and " : ""}required signals`
      : "the mission declares no strategy and carries no signal or supplied " +
        "companies from which one could be derived";

    if (requiresAllTogether && shapes.length > 0) {
      reason += "; multi_signal was declared without the shapes it combines";
    }
  }

  // ── SUPPORTED vs NOT ──────────────────────────────────────────────────────
  const playbooks: SelectedPlaybook[] = [];
  const unsupported: UnsupportedPlaybook[] = [];

  for (const id of shapes) {
    const spec = RESEARCH_PLAYBOOKS[id];
    const gap = playbookSupportGap(id);
    if (gap || !spec.entry_capability) {
      unsupported.push({
        playbook: id,
        gap: gap ?? "no_capability_defined",
        unwired_actor_keys: [...spec.unwired_actor_keys],
        reason: gap === "no_approved_provider"
          ? `${id} has a capability (${spec.entry_capability}) but no approved provider implements it`
          : `${id} has no discovery capability in the capability graph`,
      });
      continue;
    }
    playbooks.push({
      playbook: id,
      entry_capability: spec.entry_capability,
      proving_capabilities: [...spec.proving_capabilities],
      providers: playbookProviders(id),
      reason: strategy_source === "mission_strategies"
        ? `the mission's strategies include ${id}`
        : `derived from the mission's ${id === "supplied_company" ? "supplied companies" : "required signals"}`,
    });
  }

  // ── HOW THEY COMBINE ──────────────────────────────────────────────────────
  //
  // `multi_signal` is decided from the DECLARED strategies, not from how many
  // playbooks survived support filtering: a request that needs funding AND
  // social still needs both, and the fact that only one can run today is a
  // support gap, not a change to what was asked.
  let combination: PlaybookCombination;
  if (shapes.length === 0) combination = "none";
  else if (requiresAllTogether) combination = "all_must_hold";
  else if (shapes.length > 1) combination = "any_may_satisfy";
  else combination = "single";

  if (unsupported.length > 0) {
    reason += `; ${unsupported.map((u) => `${u.playbook}=${u.gap}`).join(", ")}`;
  }
  if (unknown_strategies.length > 0) {
    reason += `; unrecognised strategies: ${unknown_strategies.join(", ")}`;
  }

  // ── OK ────────────────────────────────────────────────────────────────────
  //
  // A conjunctive request is only satisfiable when EVERY shape it names can
  // run. "Recently funded AND posting about outbound" is not answered by the
  // funding half; delivering that half as though it were the answer is exactly
  // the silent substitution this module exists to prevent.
  const ok = requiresAllTogether
    ? playbooks.length > 0 && unsupported.length === 0
    : playbooks.length > 0;

  return {
    version: RESEARCH_PLAYBOOK_VERSION,
    playbooks,
    unsupported,
    unknown_strategies,
    signals_without_strategy,
    combination,
    strategy_source,
    ok,
    reason,
  };
}

function dedupe<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Compact shape for logs and audit rows. No provider is invoked to build it. */
export function playbookSelectionSummary(s: ResearchPlaybookSelection): Record<string, unknown> {
  return {
    version: s.version,
    ok: s.ok,
    combination: s.combination,
    strategy_source: s.strategy_source,
    playbooks: s.playbooks.map((p) => p.playbook),
    entry_capabilities: s.playbooks.map((p) => p.entry_capability),
    unsupported: s.unsupported.map((u) => `${u.playbook}:${u.gap}`),
    unknown_strategies: s.unknown_strategies,
    signals_without_strategy: s.signals_without_strategy,
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
