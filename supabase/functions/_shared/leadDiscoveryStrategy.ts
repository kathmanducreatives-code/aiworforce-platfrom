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
  version: typeof DISCOVERY_STRATEGY_VERSION;
  selections: DiscoveryActorSelection[];
  /**
   * HOW THIS STRATEGY WAS PRODUCED, so a run can be read after the fact.
   *
   * `deterministic_fallback` is not a failure state — it is the floor, and it
   * is what runs whenever the model is off, unavailable, or wrong.
   */
  source: "model_validated" | "model_repaired" | "deterministic_fallback";
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
export function validateDiscoveryStrategy(
  proposals: unknown, mission: LeadMissionV1, opts: DiscoveryStrategyOptions = {},
): DiscoveryStrategy {
  const violations: StrategyViolation[] = [];
  const maxActors = opts.maxActors ?? DEFAULT_MAX_ACTORS;
  const maxItems = opts.maxItemsPerActor ?? DEFAULT_MAX_ITEMS_PER_ACTOR;

  if (!Array.isArray(proposals)) {
    return {
      ...deterministicDiscoveryStrategy(mission, opts),
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
    return { ...deterministicDiscoveryStrategy(mission, opts), violations };
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
 * THE FLOOR: what discovery does today, expressed as a strategy.
 *
 * memo23 primary, solidcode fallback, with the engine's existing literal. This
 * runs whenever the model is disabled, unreachable, or proposes nothing usable
 * — so the worst case of the whole selection stage is the behaviour it
 * replaces, not a degraded one.
 */
export function deterministicDiscoveryStrategy(
  mission: LeadMissionV1, opts: DiscoveryStrategyOptions = {},
): DiscoveryStrategy {
  const maxItems = opts.maxItemsPerActor ?? DEFAULT_MAX_ITEMS_PER_ACTOR;
  const selections: DiscoveryActorSelection[] = [];

  const primary = hiringActorCard("apify_yc_companies_memo23");
  if (primary) {
    const proposed = opts.fallbackInput ?? {
      mode: "companies",
      isHiring: true,
      maxItems,
    };
    const { input, dropped } = compileActorInput(primary, proposed, maxItems);
    selections.push({
      actor_key: primary.actor_key, role: "primary", input,
      rationale: "deterministic default: the verified startup-company source",
      dropped_filters: dropped,
      requires_enrichment: primary.requires_enrichment_before_qualification,
    });
  }

  const fallback = hiringActorCard("apify_yc_companies_solidcode");
  if (fallback) {
    const { input, dropped } = compileActorInput(fallback, { maxItems }, maxItems);
    selections.push({
      actor_key: fallback.actor_key, role: "fallback", input,
      rationale: "runs only when the primary produced nothing",
      dropped_filters: dropped,
      requires_enrichment: fallback.requires_enrichment_before_qualification,
    });
  }

  // `mission` is accepted so the deterministic path has the same signature as
  // the validated one and can grow mission-derived defaults without a caller
  // change. It deliberately reads nothing today: the literal above IS the
  // current behaviour, and deriving from the mission here would make the
  // fallback something other than the floor it exists to be.
  void mission;

  return {
    version: DISCOVERY_STRATEGY_VERSION,
    selections,
    source: "deterministic_fallback",
    violations: [],
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
export function discoveryStrategyDiagnostics(s: DiscoveryStrategy): Record<string, unknown> {
  return {
    version: s.version,
    source: s.source,
    actors: s.selections.map((x) => ({
      actor_key: x.actor_key,
      role: x.role,
      input_fields: Object.keys(x.input).sort(),
      dropped_filters: x.dropped_filters.length,
      requires_enrichment: x.requires_enrichment,
    })),
    blocked: s.violations.filter((v) => v.severity === "block").length,
    repaired: s.violations.filter((v) => v.severity === "repair").length,
    // TRUE for every discovery actor registered today. Surfaced because it is
    // the honest cost signal for the pass: no candidate this stage produces can
    // qualify without a further paid enrichment call.
    all_require_enrichment: s.selections.length > 0 &&
      s.selections.every((x) => x.requires_enrichment),
  };
}
