// WHICH ACTORS DISCOVER THE POOL, AND WHAT EACH ONE IS ASKED.
//
// ── WHAT WAS THERE BEFORE ────────────────────────────────────────────────────
//
// `CAPABILITY_REGISTRY.startup_company_discovery.providers` is a frozen pair:
// memo23 primary, solidcode fallback — and solidcode runs only when memo23
// returned nothing at all. The input was a literal in the engine:
//
//     industries: ["B2B"], batch: ["All Batches"], isHiring: true, …
//
// So a mission reading "AI startups in the United States hiring software
// engineers" was answered with "Y Combinator companies tagged B2B". Not a
// filter on the query — a STANDING PROXY for it, identical for every mission
// this workflow has ever run. Whether the user asked for AI startups, fintech,
// or manufacturers, discovery fetched the same YC page and let qualification
// throw away whatever failed to match.
//
// That is why the qualification stages keep looking broken. They are not: a
// gate cannot qualify a company the pool never contained, and no amount of
// enrichment turns the wrong hundred companies into the right ten. The pool is
// upstream of every other fix.
//
// ── WHAT THIS ADDS ───────────────────────────────────────────────────────────
//
// A SELECTION STAGE between the compiled mission and the provider calls: the
// model reads the actor catalog and proposes which discovery actors to run and
// what to ask each one, and this module decides what of that is allowed.
//
// The catalog already carries exactly what such a choice needs, per actor —
// `supported_filters`, `verified_enums`, `input_limits`, `outputs`, `best_for`,
// `not_for`, `cost_model`, `confidence`, `known_defects`. None of it was being
// read by anything that chooses. This is the reader.
//
// ── WHY THE MODEL PROPOSES AND THIS MODULE DECIDES ───────────────────────────
//
// A model naming an Apify actor id directly is a model with an unbounded
// spending instruction. Everything it says here is a PROPOSAL against a closed
// catalog: an actor key that is not registered for `company_discovery` cannot
// be selected, a filter the live schema does not accept is dropped, an enum
// value that is not in the verified list is dropped, and every count is clamped
// to the published limit. A proposal that survives none of that is discarded
// whole and the deterministic strategy runs instead — which is today's exact
// behaviour, so the floor of this change is the current system.
//
// PURE. No network, provider, model or database access. The model call is
// injected by the caller; this module only validates what comes back.

import {
  actorsForPurpose, hiringActorCard, type HiringActorCard,
} from "./hiringActorCatalog.ts";
import type { LeadMissionV1 } from "./leadMission.ts";
import { coverMissionSignals } from "./signalActorCoverage.ts";
import { ACTOR_INPUT_CONTRACTS } from "./actorInputContracts.ts";
import { scenarioBriefing } from "./discoveryScenarioMatrix.ts";

export const DISCOVERY_STRATEGY_VERSION = "lead-discovery-strategy-v1" as const;

/**
 * What a selected actor is FOR in this strategy.
 *
 * `primary` sources must be able to satisfy the mission on their own.
 * `breadth` sources widen the pool and are droppable under a cost ceiling.
 * `fallback` sources run only when the ones before them produced nothing —
 * the existing memo23/solidcode relationship, made explicit rather than
 * special-cased in the engine.
 */
export type DiscoveryActorRole = "primary" | "breadth" | "fallback";

export interface DroppedFilter {
  field: string;
  /** Why it could not be sent. Recorded so a silent drop is never possible. */
  reason: string;
}

export interface DiscoveryActorSelection {
  actor_key: string;
  role: DiscoveryActorRole;
  /** The compiled input, already reduced to filters this actor accepts. */
  input: Record<string, unknown>;
  /** The model's stated reason, carried for the record and never acted on. */
  rationale: string;
  dropped_filters: DroppedFilter[];
  /**
   * TRUE when this actor's rows cannot satisfy a Company Brain gate unaided.
   * Copied from the catalog, never inferred — see the invariant in `validate`.
   */
  requires_enrichment: boolean;
}

export interface StrategyViolation {
  code: string;
  message: string;
  /** `block` discards the selection; `repair` keeps a corrected version. */
  severity: "block" | "repair";
  actor_key?: string;
}

export interface DiscoveryStrategy {
  /**
   * Violation codes from a FIRST proposal that was rejected and then repaired.
   *
   * Present only when the model needed a second attempt. A run that got it
   * right immediately and a run that recovered from a refusal are different
   * facts about the strategy, and the trace must be able to tell them apart —
   * a silently-repaired plan looks identical to a correct one otherwise.
   */
  repaired_after?: string[];
  version: typeof DISCOVERY_STRATEGY_VERSION;
  selections: DiscoveryActorSelection[];
  /**
   * HOW THIS STRATEGY WAS PRODUCED, so a run can be read after the fact.
   *
   * `deterministic_fallback` is GONE. It used to be described here as "the
   * floor — what runs whenever the model is off, unavailable, or wrong", and
   * that floor was the defect: it mapped `startup_company_discovery` to the YC
   * scraper with `industries: ["B2B"]` written as a literal, so every mission
   * this workflow ever ran asked the same question. "AI startups hiring
   * software engineers" and "manufacturers adopting automation" fetched the
   * same YC page, and qualification was left to discard the mismatch.
   *
   * `blocked` replaces it. When the model cannot produce a usable selection the
   * run STOPS and says so, rather than silently searching for something else.
   * A blocked run is recoverable; a confident, unrelated pool is not.
   */
  source: "model_validated" | "model_repaired" | "blocked";
  violations: StrategyViolation[];
}

/** What a proposal may say. Anything else in the object is ignored. */
export interface ProposedSelection {
  actor_key?: unknown;
  role?: unknown;
  input?: unknown;
  rationale?: unknown;
}

export interface DiscoveryStrategyOptions {
  /**
   * The most actors a single discovery pass may run.
   *
   * Every selection is a paid call, and a model asked for "maximum coverage"
   * will happily name every actor in the catalog. Breadth is trimmed from the
   * end, so the primary always survives the ceiling.
   */
  maxActors?: number;
  /** Rows requested per actor, clamped per actor to its published limit. */
  maxItemsPerActor?: number;
  /** Today's literal, used by the deterministic strategy. Injected for tests. */
  fallbackInput?: Record<string, unknown>;
  /**
   * Execution facts the router knows and the model cannot infer.
   *
   * Carried from `CapabilityPlan.routing_advisories`. These used to be routing
   * BRANCHES that silently rewrote the plan; as text in the payload they inform
   * the choice instead of replacing it.
   */
  routingAdvisories?: string[];
}

export const DEFAULT_MAX_ACTORS = 3;
export const DEFAULT_MAX_ITEMS_PER_ACTOR = 100;

/** The purpose an actor must be registered for to appear here at all. */
const DISCOVERY_PURPOSE = "company_discovery" as const;

const ROLES: readonly DiscoveryActorRole[] = ["primary", "breadth", "fallback"];

function isRole(v: unknown): v is DiscoveryActorRole {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown>
    : null;
}

/**
 * The catalog, reduced to what a selector may see.
 *
 * Deliberately omits `actor_id`. The model has no field in which to name
 * `memo23/y-combinator-scraper`, so it cannot ask for an actor that is not in
 * the catalog even by accident — the same separation `leadCapabilityGraph`
 * already relies on. It DOES include `known_defects` and `not_for`, because a
 * selector that cannot see an actor's failure modes will keep choosing it for
 * the thing it is worst at.
 */
export function discoveryCatalogBriefing(): Array<Record<string, unknown>> {
  return actorsForPurpose(DISCOVERY_PURPOSE).map((c) => ({
    actor_key: c.actor_key,
    supported_filters: c.supported_filters,
    verified_enums: c.verified_enums,
    input_limits: c.input_limits,
    outputs: c.outputs,
    best_for: c.best_for,
    not_for: c.not_for,
    // WHAT A WELL-FORMED INPUT LOOKS LIKE, from the live build schema. Field
    // NAMES alone left the model guessing at types, and three production
    // failures in one week were exactly that guess going wrong.
    ...(ACTOR_INPUT_CONTRACTS[c.actor_key]
      ? {
        input_contract: {
          fields: ACTOR_INPUT_CONTRACTS[c.actor_key].fields,
          example: ACTOR_INPUT_CONTRACTS[c.actor_key].example,
          verified_at: ACTOR_INPUT_CONTRACTS[c.actor_key].verified_at,
        },
        quality: ACTOR_INPUT_CONTRACTS[c.actor_key].quality,
      }
      : {}),
    confidence: c.confidence,
    cost_tier: c.cost_model.tier,
    per_result_usd: c.cost_model.per_result_usd ?? null,
    requires_enrichment_before_qualification: c.requires_enrichment_before_qualification,
    known_defects: c.known_defects.map((d) => ({ id: d.id, summary: d.summary })),
  }));
}

/**
 * Reduce a proposed input to what this actor actually accepts.
 *
 * Three separate refusals, because they fail for different reasons and a run
 * that hits one should not read like it hit another:
 *   * a field the live schema has no such key for
 *   * a value outside the enum the schema publishes
 *   * a count above the published ceiling — clamped, not dropped, because the
 *     intent was legitimate and only the magnitude was not
 */
export function compileActorInput(
  card: HiringActorCard, proposed: Record<string, unknown>, maxItems: number,
): { input: Record<string, unknown>; dropped: DroppedFilter[] } {
  const input: Record<string, unknown> = {};
  const dropped: DroppedFilter[] = [];

  for (const [field, value] of Object.entries(proposed)) {
    if (!card.supported_filters.includes(field)) {
      dropped.push({
        field,
        reason: `${card.actor_key} has no such input; its schema accepts ` +
          `${card.supported_filters.join(", ")}`,
      });
      continue;
    }

    const allowed = card.verified_enums[field];
    if (allowed) {
      // AN ENUM IS A CLOSED SET, and a value outside it is not a near-miss the
      // provider will interpret generously — it is a run that fails on input
      // validation after the actor has already started and been billed.
      const values = Array.isArray(value) ? value : [value];
      const kept = values.filter((v) => allowed.includes(String(v)));
      const rejected = values.filter((v) => !allowed.includes(String(v)));
      if (rejected.length > 0) {
        dropped.push({
          field,
          reason: `not in the verified enum for ${field}: ` +
            `${rejected.map(String).join(", ")}`,
        });
      }
      if (kept.length === 0) continue;
      input[field] = Array.isArray(value) ? kept : kept[0];
      continue;
    }

    const limit = card.input_limits[field];
    if (typeof limit === "number") {
      if (Array.isArray(value)) {
        if (value.length > limit) {
          dropped.push({
            field,
            reason: `${value.length} values exceeds the published limit of ${limit}; truncated`,
          });
        }
        input[field] = value.slice(0, limit);
        continue;
      }
      if (typeof value === "number") {
        if (value > limit) {
          dropped.push({
            field, reason: `${value} exceeds the published limit of ${limit}; clamped`,
          });
        }
        input[field] = Math.min(value, limit);
        continue;
      }
    }

    input[field] = value;
  }

  // THE ROW CEILING IS OURS, NOT THE MODEL'S. Whatever it asked for, a pass
  // takes what the budget allows, and the actor's own published maximum is a
  // hard upper bound on top of that.
  //
  // The count field is read from `input_limits`, NOT `supported_filters`: no
  // discovery actor in the catalog lists its row cap as a filter, so gating on
  // `supported_filters` sent an uncapped run to every one of them. And the
  // published limit is not always a number — memo23 records the string
  // "PER start-URL / per filter run — NOT a global cap", which is a caveat
  // about what the cap MEANS rather than a value to clamp against. A
  // non-numeric limit therefore bounds nothing, and our own budget stands.
  const countField = "maxItems" in card.input_limits
    ? "maxItems"
    : "maxResults" in card.input_limits
    ? "maxResults"
    : null;
  if (countField) {
    const published = card.input_limits[countField];
    input[countField] = typeof published === "number"
      ? Math.min(maxItems, published)
      : maxItems;
  }

  return { input, dropped };
}

/**
 * Decide what of a proposal may run.
 *
 * Returns a strategy in every case. When nothing survives, that strategy is the
 * deterministic one, so the caller never has to handle "no strategy" — the
 * floor of this whole mechanism is the behaviour it replaces.
 */
/** The concept terms a mission discovers by, when it names no companies. */
export function conceptTermsOf(mission: LeadMissionV1): string[] {
  const p = mission.company_profile ?? {} as LeadMissionV1["company_profile"];
  return [...new Set([
    ...(p.verticals ?? []),
    ...(p.business_models ?? []),
    ...(p.stages ?? []),
  ].map((s) => String(s).trim()).filter(Boolean))];
}

/**
 * Is this mission asking for a COHORT rather than named companies?
 *
 * The distinction the 2026-08-17 run turned on. "AI startups in the US" names
 * no company — it describes a kind. Resolving it requires an actor that can
 * search by concept. "Find contacts at Anthropic and Figma" names two, and a
 * name matcher is exactly the right tool for that.
 */
export function missionNeedsSemanticDiscovery(mission: LeadMissionV1): boolean {
  const named = (mission as { known_companies?: unknown[] }).known_companies ?? [];
  if (Array.isArray(named) && named.length > 0) return false;
  return conceptTermsOf(mission).length > 0;
}

/**
 * Terms in `not_for` that mean "cannot discover a concept cohort".
 *
 * `"primary discovery"` is deliberately NOT here, though it reads like it
 * belongs. It is a ROLE constraint — solidcode says "do not open a run with
 * me", which is about ordering — not a CAPABILITY one. Including it blocked
 * solidcode as a legitimate fallback and broke three passing tests, which is
 * how the distinction surfaced. Role is enforced by the primary → breadth →
 * fallback ordering; this regex is only about what an actor can SEARCH BY.
 */
const SEMANTIC_UNFIT = /semantic|concept/i;

export function declaresUnfitForSemantic(card: HiringActorCard): boolean {
  return (card.not_for ?? []).some((n) => SEMANTIC_UNFIT.test(String(n)));
}

/**
 * Is this mission inside the fixed population a cohort-scoped Actor can return?
 *
 * ── WHY THIS IS A PREDICATE AND NOT A PREFERENCE ────────────────────────────
 *
 * `not_for: "semantic/concept search"` stops a name matcher discovering a
 * cohort. This is the mirror: it stops a COHORT source being pointed at a
 * mission whose companies are not in that cohort. `memo23` asked for German
 * industrial-automation integrators returns YC companies — not fewer results,
 * not worse ones, the wrong population entirely — and every gate downstream
 * then rejects a pool that was never right.
 *
 * ── AND WHY IT IS DELIBERATELY SMALL ────────────────────────────────────────
 *
 * One entry per cohort, each a plain statement of who is in it. This is the
 * line the architecture keeps having to hold: the validator may say "that Actor
 * physically cannot return this population", and it may NOT grow into a table
 * of which actor suits which query. If a future cohort needs a paragraph of
 * judgement to decide membership, that judgement belongs to the planner and the
 * card's `best_for`, not here.
 *
 * An unknown cohort id is permissive — an Actor whose population nobody has
 * described yet is not blocked on a guess.
 */
const COHORT_MEMBERSHIP: Record<string, (m: LeadMissionV1) => boolean> = {
  y_combinator: (m) => {
    const stages = (m.company_profile?.stages ?? []).map((s) => String(s).toLowerCase());
    if (stages.some((s) => /startup|seed|series a|early|venture|pre-seed/.test(s))) return true;
    // The user naming the cohort is the other way in, and outranks the profile.
    return /\by ?combinator\b|\byc\b/i.test(String(m.original_user_query ?? ""));
  },
};

export function cohortRefusalFor(
  card: HiringActorCard, mission: LeadMissionV1,
): { cohort: string; label: string } | null {
  const scope = card.cohort_scope;
  if (!scope) return null;
  const inCohort = COHORT_MEMBERSHIP[scope.id];
  if (!inCohort) return null;
  return inCohort(mission) ? null : { cohort: scope.id, label: scope.label };
}

export function validateDiscoveryStrategy(
  proposals: unknown, mission: LeadMissionV1, opts: DiscoveryStrategyOptions = {},
): DiscoveryStrategy {
  const violations: StrategyViolation[] = [];
  const maxActors = opts.maxActors ?? DEFAULT_MAX_ACTORS;
  const maxItems = opts.maxItemsPerActor ?? DEFAULT_MAX_ITEMS_PER_ACTOR;

  if (!Array.isArray(proposals)) {
    return {
      version: DISCOVERY_STRATEGY_VERSION,
      selections: [],
      source: "blocked",
      violations: [{
        code: "proposal_not_a_list",
        message: "the selector returned no list of actors",
        severity: "block",
      }],
    };
  }

  let repaired = false;
  const selections: DiscoveryActorSelection[] = [];
  const seen = new Set<string>();

  for (const raw of proposals as ProposedSelection[]) {
    const p = asRecord(raw);
    if (!p) {
      violations.push({
        code: "selection_not_an_object", message: "a selection was not an object",
        severity: "block",
      });
      continue;
    }

    const key = typeof p.actor_key === "string" ? p.actor_key : "";
    const card = hiringActorCard(key);

    // THE CLOSED CATALOG. This is the line that makes model-chosen sourcing
    // safe to run at all: an unregistered key names nothing this system can
    // call, and a registered key for the wrong purpose is an actor being asked
    // to do a job it was never verified for.
    if (!card) {
      violations.push({
        code: "unknown_actor", actor_key: key || "(none)",
        message: `"${key}" is not in the actor catalog`, severity: "block",
      });
      continue;
    }
    if (!card.purposes.includes(DISCOVERY_PURPOSE)) {
      violations.push({
        code: "actor_not_for_discovery", actor_key: key,
        message: `${key} is registered for ${card.purposes.join(", ")}, not ${DISCOVERY_PURPOSE}`,
        severity: "block",
      });
      continue;
    }
    // ── `not_for` IS ENFORCED, NOT JUST BRIEFED ────────────────────────────
    //
    // The catalog has always carried `not_for`, and the planner prompt has
    // always shown it — "An actor listed as not_for a task…". Nothing checked
    // it. On 2026-08-17 (task e01dbd5b) that gap cost a whole run: the mission
    // was "AI startups", GPT selected `apify_linkedin_company_search`, and that
    // actor's own card says `not_for: [… "semantic/concept search" …]`.
    //
    // It is a company-NAME matcher. Asked to discover a concept it returned 20
    // LinkedIn pages whose names contain the words: `AI Central | ChatGPT &
    // Generative AI Tutorials`, `Startup San Diego`, `AWS AI`, `NVIDIA AI`.
    // Two of twenty were plausibly companies. Everything downstream —
    // 6 enriched, 0 evaluated, 0 qualified — was that pool, not a budget.
    //
    // A mission that names no specific companies and discovers by concept
    // (vertical, stage, business model) IS a semantic search. An actor that
    // declares itself unfit for one may not perform it.
    if (missionNeedsSemanticDiscovery(mission) && declaresUnfitForSemantic(card)) {
      violations.push({
        code: "actor_not_for_semantic_discovery", actor_key: key,
        message:
          `${key} declares not_for "${card.not_for.join('", "')}" — this mission ` +
          `discovers by concept (${conceptTermsOf(mission).join(", ")}) and names no ` +
          `specific companies, so a name matcher cannot produce this cohort`,
        severity: "block",
      });
      continue;
    }
    // ── THE MIRROR OF `not_for`: A COHORT SOURCE OUTSIDE ITS COHORT ────────
    //
    // `general_company_discovery` used to declare one provider, and widening it
    // to the discovery universe is what lets a startup mission reach a startup
    // source. The same widening makes `memo23` reachable for a German
    // industrial-automation mission, where it can only return YC companies.
    //
    // Containment used to carry this guarantee — the capability simply did not
    // list the actor — and a permission list cannot tell "this actor is wrong
    // here" from "this actor is unavailable". Stated on the card and enforced
    // here, the refusal is specific, it is explained, and it is handed back to
    // the planner as feedback it can act on.
    const cohort = cohortRefusalFor(card, mission);
    if (cohort) {
      violations.push({
        code: "actor_outside_mission_cohort", actor_key: key,
        message:
          `${key} can only return companies from ${cohort.label} — this mission ` +
          `does not target that cohort, so the actor would return the wrong ` +
          `population rather than fewer results. Choose a source whose index ` +
          `covers ${conceptTermsOf(mission).join(", ") || "this mission's companies"}.`,
        severity: "block",
      });
      continue;
    }
    if (seen.has(key)) {
      violations.push({
        code: "duplicate_actor", actor_key: key,
        message: `${key} was selected more than once`, severity: "repair",
      });
      repaired = true;
      continue;
    }

    let role: DiscoveryActorRole;
    if (isRole(p.role)) {
      role = p.role;
    } else {
      role = "breadth";
      violations.push({
        code: "role_defaulted", actor_key: key,
        message: `role "${String(p.role)}" is not one of ${ROLES.join(", ")}; treated as breadth`,
        severity: "repair",
      });
      repaired = true;
    }

    const { input, dropped } = compileActorInput(card, asRecord(p.input) ?? {}, maxItems);
    if (dropped.length > 0) repaired = true;
    for (const d of dropped) {
      violations.push({
        code: "filter_dropped", actor_key: key,
        message: `${d.field}: ${d.reason}`, severity: "repair",
      });
    }

    seen.add(key);
    selections.push({
      actor_key: key,
      role,
      input,
      rationale: typeof p.rationale === "string" ? p.rationale : "",
      dropped_filters: dropped,
      requires_enrichment: card.requires_enrichment_before_qualification,
    });
  }

  // A PASS WITH NO PRIMARY HAS NOTHING THAT MUST RUN.
  //
  // `breadth` stops once the pool is full and `fallback` runs only on an empty
  // one, so a strategy of those alone can legally execute nothing at all and
  // report discovery "complete" over an empty pool. Something has to be
  // unconditional, and the first selection is the honest candidate.
  //
  // NOTE ON `requires_enrichment_before_qualification`. It is the catalog's
  // most important field — it marks an actor whose rows cannot satisfy a
  // Company Brain gate unaided — but it is TRUE for every company_discovery
  // actor registered today, YC sources included. So it cannot be a condition on
  // being primary: that would refuse every possible strategy. It is recorded
  // per selection and surfaced in the diagnostics instead, because what it
  // really tells the operator is that discovery is never the last word on a
  // company and every candidate costs a further enrichment call.
  if (selections.length > 0 && !selections.some((s) => s.role === "primary")) {
    selections[0].role = "primary";
    repaired = true;
    violations.push({
      code: "primary_promoted", actor_key: selections[0].actor_key,
      message: `no primary was named; ${selections[0].actor_key} promoted so the pass runs something`,
      severity: "repair",
    });
  }

  if (selections.length === 0) {
    // NOTHING SURVIVED VALIDATION. Previously this fell to the YC literal, so a
    // model proposing three unusable actors produced the same B2B/YC search as
    // a model proposing nothing — and the run looked healthy either way.
    violations.push({
      code: "no_valid_selection",
      message: "no proposed actor survived validation against the catalog",
      severity: "block",
    });
    return {
      version: DISCOVERY_STRATEGY_VERSION,
      selections: [],
      source: "blocked",
      violations,
    };
  }

  // THE COST CEILING TRIMS BREADTH, NEVER THE PRIMARY. Ordered primary →
  // breadth → fallback first, so what the ceiling removes is always the most
  // droppable thing left rather than whatever happened to be last.
  const rank = (r: DiscoveryActorRole) => ROLES.indexOf(r);
  selections.sort((a, b) => rank(a.role) - rank(b.role));
  if (selections.length > maxActors) {
    for (const cut of selections.slice(maxActors)) {
      violations.push({
        code: "actor_ceiling", actor_key: cut.actor_key,
        message: `dropped: a discovery pass runs at most ${maxActors} actors`,
        severity: "repair",
      });
    }
    selections.length = maxActors;
    repaired = true;
  }

  return {
    version: DISCOVERY_STRATEGY_VERSION,
    selections,
    source: repaired ? "model_repaired" : "model_validated",
    violations,
  };
}

/**
 * Raised when no usable actor selection exists.
 *
 * A distinct class, so a blocked selection cannot be mistaken for a provider
 * outage or an empty result set further down. It carries the violations because
 * "why was nothing selected?" is the only question anyone will ask.
 */
/**
 * Say, in the user's terms, why nothing ran.
 *
 * ── WHY THE REFUSAL NEEDS ITS OWN SENTENCE ──────────────────────────────────
 *
 * The architecture decision of 2026-08-19 is that a mission no registered Actor
 * can serve STOPS, rather than being answered with the nearest tool. That is
 * only the better answer if the person reading it can tell a refusal from a
 * crash — "0 of 10 leads" and "nothing here can discover that cohort, here is
 * what would" are different facts, and the second one is actionable.
 *
 * Written from the violation codes, which already carry the specifics.
 */
export function refusalMessageFor(violations: readonly StrategyViolation[]): string {
  const blocking = violations.filter((v) => v.severity === "block");
  const semantic = blocking.find((v) => v.code === "actor_not_for_semantic_discovery");
  const cohort = blocking.find((v) => v.code === "actor_outside_mission_cohort");

  if (semantic) {
    return [
      "I stopped before spending anything, because no source I have can find " +
      "that KIND of company.",
      "",
      "The company index I can search matches company NAMES, not what a company " +
      "does — asking it for a concept returns whatever happens to be CALLED " +
      "that: newsletters, communities and consultancies that look like results " +
      "and qualify as nothing.",
      "",
      "What would work instead:",
      "  • name the companies you want evaluated, and I will research them; or",
      "  • narrow to a cohort I do have a real source for, such as venture-backed " +
      "startups; or",
      "  • add a source that can search companies by what they do.",
    ].join("\n");
  }
  if (cohort) {
    return [
      "I stopped before spending anything. The sources I have for this kind of " +
      "request only cover a fixed population, and the companies you asked for " +
      "are not in it.",
      "",
      cohort.message,
    ].join("\n");
  }
  return [
    "I stopped before spending anything, because I could not choose a source " +
    "that would genuinely answer this request.",
    "",
    ...blocking.map((v) => `  • ${v.message}`),
  ].join("\n");
}

export class DiscoveryStrategyBlockedError extends Error {
  readonly violations: StrategyViolation[];
  /** The refusal in the user's terms. See `refusalMessageFor`. */
  readonly userMessage: string;
  constructor(violations: StrategyViolation[]) {
    const first = violations[0];
    super(
      `discovery actor selection was blocked (${first?.code ?? "unknown"}): ` +
      `${first?.message ?? "no actors were selected"}. No deterministic ` +
      `strategy was substituted and no provider work was scheduled.`,
    );
    this.name = "DiscoveryStrategyBlockedError";
    this.violations = violations;
    this.userMessage = refusalMessageFor(violations);
  }
}

/**
 * A strategy that selects nothing, and says why.
 *
 * The replacement for `deterministicDiscoveryStrategy`: where the old code
 * answered a failed selection with the YC literal, this answers it with a
 * refusal the engine turns into a stopped run.
 */
export function blockedDiscoveryStrategy(
  code: string, message: string,
): DiscoveryStrategy {
  return {
    version: DISCOVERY_STRATEGY_VERSION,
    selections: [],
    source: "blocked",
    violations: [{ code, message, severity: "block" }],
  };
}

// ── `deterministicDiscoveryStrategy` WAS HERE, AND IS DELETED ──────────────
//
// It pinned `startup_company_discovery` to the YC scraper and handed it a
// literal input — `mode: "companies", isHiring: true` — with the engine layering
// `industries: ["B2B"]` on top. Its own comment called it "the floor ... the
// current behaviour", and that was accurate: it answered every mission with the
// same question.
//
// Deleting it rather than leaving it unreferenced is deliberate. An unreachable
// fallback is one edit away from being reachable again, and this one had the
// property that reaching it produced a confident, plausible, entirely unrelated
// pool. `validateDiscoveryStrategy` now returns `source: "blocked"` where this
// used to be called, and the engine refuses the run.

/**
 * What the selector is shown: the request, the compiled mission, the catalog.
 *
 * `original_user_query` is included ALONGSIDE the compiled profile, not instead
 * of it. The profile is what the mission compiler decided the request meant, and
 * it is authoritative for gating — but it is lossy by design, and the actor
 * choice is exactly where the lost nuance matters. A mission compiled to
 * `verticals: ["artificial intelligence"]` does not record whether the user said
 * "AI startups" or "companies building LLM tooling", and those want different
 * queries from a name-matching company search.
 *
 * The query is DATA here, never instruction. Nothing it can say changes which
 * actors exist or which filters are legal — `validateDiscoveryStrategy` decides
 * that against the catalog, after the model has spoken.
 */
export function buildDiscoveryPlannerPayload(
  mission: LeadMissionV1, opts: DiscoveryStrategyOptions = {},
): Record<string, unknown> {
  const p = mission.company_profile;
  return {
    task: "select_discovery_actors",
    request: {
      original_user_query: mission.original_user_query,
      requested_count: mission.requested_count,
    },
    compiled_mission: {
      verticals: p.verticals,
      business_models: p.business_models,
      stages: p.stages,
      locations: p.locations,
      employee_range: p.employee_range ?? null,
      required_signals: mission.required_signals,
      source_strategy: mission.directives?.source_strategy ?? [],
    },
    available_actors: discoveryCatalogBriefing(),
    // ── WHAT THE REQUEST NEEDS, RESOLVED ──────────────────────────────────
    //
    // These three lived in `buildPrompt`, which is the TEST-facing helper. The
    // live path built its payload here and never had them, so the prompt that
    // was pinned by tests and the prompt a real run sent were different
    // objects — the "correct, covered and unreachable" shape this codebase has
    // already paid for once. Built here, there is one payload and both callers
    // get it.
    //
    // The model is not asked to work out which signals map to which actor:
    // that is deterministic and already done, and asking twice invites the two
    // answers to disagree.
    signal_coverage: coverMissionSignals(mission).signals.map((s) => ({
      signal: s.signal,
      status: s.status,
      actors_that_serve_it: s.actors,
      minimum_evidence: s.minimum_evidence,
      ...(s.limitation ? { limitation: s.limitation } : {}),
    })),
    // Scenarios NO actor can serve, with the verified reason. A planner that
    // cannot see what is impossible keeps proposing it.
    unserveable_scenarios: scenarioBriefing()
      .filter((s) => s.servable === false)
      .map((s) => ({ scenario: s.scenario, why: s.blocked_reason })),
    // Facts the router knows: an actor family with no verified schema, a cohort
    // whose stage data only one source carries.
    ...(opts.routingAdvisories?.length
      ? { execution_advisories: opts.routingAdvisories }
      : {}),
    limits: {
      max_actors: opts.maxActors ?? DEFAULT_MAX_ACTORS,
      max_items_per_actor: opts.maxItemsPerActor ?? DEFAULT_MAX_ITEMS_PER_ACTOR,
      requested_lead_count: mission.requested_count,
    },
    response_shape: {
      actors: [{
        actor_key: "<one of available_actors[].actor_key>",
        role: "primary | breadth | fallback",
        input: "<object using only that actor's supported_filters and verified_enums>",
        rationale: "<why this actor, for this request>",
      }],
    },
    rules: [
      "Only actor_key values from available_actors may be used.",
      "Only that actor's supported_filters may appear in its input.",
      "Enum-valued fields must use values from that actor's verified_enums.",
      "Exactly one actor should be primary: the one that must run.",
      "Use breadth for actors that widen the pool, fallback for actors worth running only if nothing else returned anything.",
      "Prefer an actor's best_for; avoid its not_for and its known_defects.",
    ],
  };
}

/** The actors this strategy will actually call, in execution order. */
export function strategyActorKeys(s: DiscoveryStrategy): string[] {
  return s.selections.map((x) => x.actor_key);
}

/**
 * Should this selection run, given what the pass has already collected?
 *
 * `fallback` is the existing memo23/solidcode contract, unchanged: it runs only
 * when nothing before it produced a row. `breadth` stops once the pool is
 * already large enough to satisfy the request, because widening a pool that is
 * already big enough is spend with nothing to buy.
 */
export function shouldRunSelection(
  sel: DiscoveryActorSelection, collectedSoFar: number, poolTarget: number,
): boolean {
  if (sel.role === "primary") return true;
  if (sel.role === "fallback") return collectedSoFar === 0;
  return collectedSoFar < poolTarget;
}

/** Compact record of what the strategy decided, for the execution state. */
/**
 * The record a run leaves behind about HOW its actors were chosen.
 *
 * ── WHY THIS CARRIES THE INPUTS AND THE REASONS, NOT COUNTS ────────────────
 *
 * This used to report `input_fields` (key names only), `dropped_filters` as a
 * NUMBER, and `blocked`/`repaired` as counts. Auditing the 2026-08-17 run then
 * had to infer which interpreter had chosen the actors by comparing the live
 * Apify input against the hardcoded literals in the engine, character by
 * character, and concluding "these match, so it must have been deterministic".
 *
 * That is not observability, it is archaeology. A run must be able to answer,
 * from its own record: did the model choose this actor, WHY, what input did it
 * generate, and what did the validator change or refuse? So the reasons, the
 * inputs and the violations are all carried in full.
 *
 * The inputs are small — a compiled actor input is tens of fields at most — and
 * they are the single most valuable thing to have when a run returns a pool
 * nobody expected.
 */
export function discoveryStrategyDiagnostics(s: DiscoveryStrategy): Record<string, unknown> {
  return {
    version: s.version,
    source: s.source,
    /** True when a model chose these actors; false when code did. */
    model_chosen: s.source === "model_validated" || s.source === "model_repaired",
    actors: s.selections.map((x) => ({
      actor_key: x.actor_key,
      role: x.role,
      // WHY THIS ACTOR. Empty on the deterministic path, which is itself the
      // answer to "did a model choose this?".
      rationale: x.rationale,
      // WHAT WAS ACTUALLY SENT. The field that would have made the "where did
      // industries: ['B2B'] come from?" question a lookup instead of a hunt.
      input: x.input,
      input_fields: Object.keys(x.input).sort(),
      dropped_filters: x.dropped_filters,
      requires_enrichment: x.requires_enrichment,
    })),
    /**
     * VIOLATIONS FROM A FIRST PLAN THAT WAS REFUSED AND THEN REPAIRED.
     *
     * Absent on a plan that validated first time. Without it a run that
     * recovered from a refusal is indistinguishable from one that never needed
     * to — and a RISING repair rate is the signal that the briefing is teaching
     * the model the wrong thing, which is a prompt problem rather than a reason
     * for another validator rule.
     */
    ...(s.repaired_after ? { repaired_after: s.repaired_after } : {}),
    // WHAT THE VALIDATOR DID, in full — not just how many times it did it.
    violations: s.violations,
    blocked: s.violations.filter((v) => v.severity === "block").length,
    repaired: s.violations.filter((v) => v.severity === "repair").length,
    // TRUE for every discovery actor registered today. Surfaced because it is
    // the honest cost signal for the pass: no candidate this stage produces can
    // qualify without a further paid enrichment call.
    all_require_enrichment: s.selections.length > 0 &&
      s.selections.every((x) => x.requires_enrichment),
  };
}
