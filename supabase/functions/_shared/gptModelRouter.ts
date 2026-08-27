// ONE PLACE DECIDES WHICH MODEL EACH STAGE RUNS ON.
//
// ── THE LADDER ───────────────────────────────────────────────────────────────
//
//     LUNA  → deterministic validation → valid?  yes → continue
//                                               no  → TERRA → revalidate
//                                                             valid → continue
//                                                             invalid → fail safely
//
// LUNA is normal Agentory intelligence. TERRA is bounded repair. SOL is outside
// normal production. CODE owns validation, safety, accounting, identity,
// credits and continuation — none of which asks a model anything.
//
// ── WHAT THIS REPLACES ───────────────────────────────────────────────────────
//
// A two-TIER policy over `modelForTier`, which resolved to gpt-4.1 and
// gpt-4.1-mini. Two problems.
//
// The tiers named a COST SHAPE, not a ladder: `reasoning` and `fast` are two
// independent choices, so a stage that failed on its model had nowhere to go.
// Every planning stage therefore had exactly one attempt, and a structurally
// invalid plan was a dead run.
//
// And the models were wrong on price. Measured from the published table on one
// execution-plan call (16k in / 1.5k out):
//
//     gpt-4.1        $0.04400
//     gpt-5.6-terra  $0.05000   ← MORE than 4.1
//     gpt-5.6-luna   $0.00500   ← 8.8x cheaper than 4.1
//
// So the incumbent was neither the cheapest nor the most capable. Luna first
// with Terra as bounded escalation is cheaper than 4.1 on the common path and
// stronger than 4.1 on the path that used to fail outright.
//
// ── ESCALATION IS EARNED BY A VALIDATOR, NOT GUESSED ─────────────────────────
//
// Terra is reached when THE REAL PRODUCTION VALIDATOR rejects Luna's output —
// `validateDiscoveryStrategy`, `validateExecutionPlan`, the mission schema. No
// confidence score, no second opinion, no heuristic. If the thing that decides
// whether a result is usable in production says no, that is the signal; anything
// else would be a second validation system disagreeing with the first.
//
// ── AND A PROVIDER FAILURE IS NOT A MODEL FAILURE ────────────────────────────
//
// THE DISTINCTION THIS MODULE EXISTS TO ENFORCE. Terra runs on the same OpenAI
// account as Luna. Escalating a quota exhaustion, an outage or an auth error
// would call a second model that fails for the identical reason — doubling the
// latency and the noise to reach the same place.
//
//   MODEL OUTPUT failure   schema invalid, validator rejected, constraint
//                          omitted, unusable actor input   → MAY escalate
//
//   PROVIDER failure       quota exhausted, outage, auth, unsafe-to-retry
//                          timeout                          → NEVER escalates;
//                          stop, checkpoint, keep the real code
//
// On 2026-08-21 an empty balance produced four silent retries and a chat that
// answered nothing. Escalation would have made that eight.
//
// ── AND IT IS NOT A KNOB ─────────────────────────────────────────────────────
//
// GPT never chooses its own model. Every route is a pure function of the stage
// and a handful of COUNTS, so the routing of a run can be reproduced from its
// record. A field like `quality_target` would make this the knob it refuses to
// be, and a model asked to pick its own tier will pick the expensive one.
//
// PURE. No network, model or database access.

import type { GptTier } from "./gptProvider.ts";
import type { ReasoningEffort } from "./modelRequestBody.ts";

export const GPT_MODEL_ROUTER_VERSION = "gpt-model-router-v2" as const;

/**
 * The three models, named ONCE.
 *
 * Every other module asks the router for a stage's model. A literal model id
 * anywhere else is a routing decision made outside the router, which is how
 * "which model runs this?" became six greps and a guess the first time.
 */
export const LUNA = "gpt-5.6-luna" as const;
export const TERRA = "gpt-5.6-terra" as const;
/**
 * Declared so its ABSENCE is testable.
 *
 * Sol has no normal production route. Naming it here — and nowhere else — lets a
 * test assert that no stage resolves to it, which an omitted constant could not.
 */
export const SOL = "gpt-5.6-sol" as const;

/**
 * Every GPT decision point in the lead pipeline.
 *
 * Adding a stage here is how a new model call becomes routable. A call that does
 * not name a stage cannot be routed, which is deliberate: an unrouted call is
 * invisible in the cost trace, and this is the module whose job is to make that
 * impossible to do by accident.
 */
export const GPT_STAGES = [
  "mission_compilation",
  "discovery_actor_selection",
  "discovery_actor_selection_repair",
  "execution_plan",
  "execution_plan_repair",
  "execution_plan_amendment",
  "mission_triage",
  "mission_evaluation",
  "company_qualification",
  "pool_ranking",
  "semantic_classification",
  /** Reads already-purchased evidence and says whether a claim is grounded. */
  "grounded_evidence_evaluation",
  /** Judges a whole pool of companies in batches. */
  "pool_evaluation",
  /** Free-text the user reads: summaries and generated UI copy. */
  "summary_generation",
  /**
   * Judges whether a DETERMINISTIC cluster matters to THIS workspace.
   *
   * It re-ranks what the floor already accepted and explains why, citing the
   * cluster's own events. It cannot create a cluster, add an event, or raise a
   * cluster the evidence gate refused — so a wrong answer costs a misordered
   * card, never a fabricated signal. That ceiling is why Luna leads.
   */
  "signal_relevance",
  /** Terra re-reading a relevance answer the validator could repair. */
  "signal_relevance_repair",
  /**
   * CHAT BRAIN. Turns arbitrary wording into a `RequestV1`.
   *
   * The FIRST decision in the system, and the one every later stage inherits:
   * an utterance read as `source` when it meant `read` spends money answering a
   * question, and nothing downstream can undo that. Same standing as
   * `mission_compilation`, which carries the same note for the same reason.
   */
  "request_understanding",
  /** Terra re-reading an understanding whose SHAPE the parser could repair. */
  "request_understanding_repair",
] as const;

export type GptStage = typeof GPT_STAGES[number];

/**
 * What the router is allowed to know about the run.
 *
 * Deliberately small, and deliberately all COUNTS. A signal the router cannot
 * check is a signal it cannot be tested on, and the moment this grows a field
 * like `quality_target` it has become the knob the header refuses to be.
 */
export interface RoutingSignals {
  /** Companies in this call's batch. Triage's volume, and its stakes. */
  batch_size?: number;
  /** Leads the user asked for. What a wrong verdict is measured against. */
  requested_count?: number;
  /** Candidates still available. A small frontier makes each verdict decisive. */
  pool_size?: number;
}

export interface ModelRoute {
  version: typeof GPT_MODEL_ROUTER_VERSION;
  stage: GptStage;
  /** The model id this resolves to. Recorded so a trace needs no second lookup. */
  model: string;
  /** How hard it should think. Null for a model that takes no effort field. */
  reasoning_effort: ReasoningEffort | null;
  /** `primary` is Luna's attempt; `escalation` is Terra repairing it. */
  slot: "primary" | "escalation";
  /** Why this model, in one sentence. Persisted with the call. */
  reason: string;
  /**
   * Why Terra was reached. Null on the primary attempt.
   *
   * Always a VALIDATOR's rejection, never a heuristic — see the header.
   */
  escalation_reason?: string | null;
  /**
   * Retained so existing diagnostics keep working while the tier vocabulary is
   * retired. Derived from the slot; nothing routes on it any more.
   */
  tier: GptTier;
  signals: RoutingSignals;
}

interface StagePolicy {
  /**
   * The model that runs first.
   *
   * `null` means DETERMINISTIC — this stage asks no model at all, and a caller
   * that tries to route it gets an error rather than a model.
   */
  primary: string | null;
  effort: ReasoningEffort | null;
  /**
   * Where an INVALID result escalates. Null means a failure here is final.
   *
   * Only ever Luna → Terra. There is no third rung and there must not be one:
   * a ladder that keeps climbing turns one bad response into an unbounded bill.
   */
  escalation: string | null;
  reason: string;
}

/**
 * THE POLICY. One entry per stage, each a statement about the work.
 *
 * Read `reason` as the answer to "what does being wrong here cost?".
 *
 * EFFORT IS CONSERVATIVE EVERYWHERE. `low` on the planning stages, `none` on the
 * high-volume ones. Nothing in normal production asks for `high` — a stage that
 * genuinely needs more thought should escalate to Terra, which is a bounded and
 * observable decision, rather than quietly spend more tokens on every call.
 */
const POLICY: Readonly<Record<GptStage, StagePolicy>> = Object.freeze({
  // ── PLANNING: Luna reads, the validator judges, Terra repairs ───────────
  mission_compilation: {
    primary: LUNA, effort: "low", escalation: TERRA,
    reason:
      "one call decides what the entire run is for; misreading the request " +
      "misdirects every stage after it and no later stage can repair it",
  },
  discovery_actor_selection: {
    primary: LUNA, effort: "low", escalation: TERRA,
    reason:
      "chooses which paid Actors run and what each is asked; a wrong choice " +
      "buys the wrong pool, and no enrichment or qualification can recover it",
  },
  execution_plan: {
    primary: LUNA, effort: "low", escalation: TERRA,
    reason:
      "plans the whole chain and decides which paid stages are unnecessary; " +
      "this is the most consequential single call the pipeline makes",
  },
  execution_plan_amendment: {
    primary: LUNA, effort: "low", escalation: TERRA,
    reason:
      "re-plans against what the pool actually contains; getting this wrong " +
      "either re-buys evidence already held or drops the step that proves it",
  },

  // ── REPAIR: already Terra, and it cannot escalate further ───────────────
  //
  // A repair IS the escalation. Starting it on Luna would re-run the model
  // whose output was just rejected, against the same input, and hope.
  discovery_actor_selection_repair: {
    primary: TERRA, effort: "low", escalation: null,
    reason:
      "the first proposal was refused; a repair is strictly harder than the " +
      "attempt that failed and must never run on a weaker model than it did",
  },
  execution_plan_repair: {
    primary: TERRA, effort: "low", escalation: null,
    reason: "a refused plan is harder to fix than it was to make",
  },

  // ── HIGH VOLUME: Luna, no effort, no escalation ─────────────────────────
  //
  // These read evidence that has already been paid for. An undecidable verdict
  // degrades to `uncertain`, which is a defined outcome the pipeline handles —
  // so a second model call buys a better answer to a question that already has
  // an acceptable one, at the volume where that cost multiplies hardest.
  mission_triage: {
    primary: LUNA, effort: "none", escalation: null,
    reason:
      "high-volume batch classification; an undecidable verdict degrades to " +
      "`uncertain`, which reorders the shortlist and never excludes a company",
  },
  mission_evaluation: {
    primary: LUNA, effort: "none", escalation: null,
    reason:
      "final qualification authority over already-paid-for evidence; the " +
      "evidence is the same on a second reading, so a retry changes cost, not " +
      "information",
  },
  signal_relevance: {
    primary: LUNA, effort: "low", escalation: TERRA,
    reason:
      "re-ranks and explains clusters the deterministic floor already built; " +
      "it may demote and must cite, and cannot invent a signal — so the cost " +
      "of a wrong answer is a misordered card, not a fabricated one",
  },
  request_understanding: {
    primary: LUNA, effort: "low", escalation: TERRA,
    reason:
      "the first read of what the user wants; an objective misread here spends " +
      "money on a question, or answers a request that needed fresh evidence, " +
      "and every later stage inherits the mistake",
  },
  request_understanding_repair: {
    primary: TERRA, effort: "low", escalation: null,
    reason:
      "an understanding whose SHAPE the parser could repair — an unknown " +
      "objective, a malformed part. Never used for an unavailable model: a " +
      "provider failure degrades to a clarification rather than paying more",
  },
  signal_relevance_repair: {
    primary: TERRA, effort: "low", escalation: null,
    reason:
      "a relevance answer whose SHAPE the validator could repair — a miscited " +
      "id, a missing field. Never used for an unavailable model: a provider " +
      "failure falls back to the deterministic cluster rather than paying more",
  },
  company_qualification: {
    primary: LUNA, effort: "none", escalation: null,
    reason: "the verdict IS the product; it is what the user acts on",
  },
  semantic_classification: {
    primary: LUNA, effort: "none", escalation: null,
    reason:
      "structural classification of one company's description; a wrong answer " +
      "is corrected by the evaluator that reads the same evidence afterwards",
  },
  grounded_evidence_evaluation: {
    primary: LUNA, effort: "none", escalation: null,
    reason:
      "decides whether a claim is supported by evidence already bought; the " +
      "evidence does not improve on a second reading, so a retry changes cost " +
      "and not the answer",
  },
  pool_evaluation: {
    primary: LUNA, effort: "none", escalation: null,
    reason:
      "batch qualification over a whole pool; the highest-volume reasoning in " +
      "the run, and an undecidable verdict is already a handled outcome",
  },
  summary_generation: {
    primary: LUNA, effort: "none", escalation: null,
    reason:
      "prose the user reads; being wrong costs clarity, never a lead or a " +
      "purchase, and no validator can judge it anyway",
  },

  // ── DETERMINISTIC: no model, by evidence ────────────────────────────────
  //
  // AUDITED, NOT ASSUMED. `POOL_RANKING_MODE` defaults to `shadow`, and in
  // shadow mode the deterministic order is what ships — always, by construction.
  // The live runs say what the model call actually contributes:
  //
  //     run 4fe98f5c   ranking_calls_attempted: 1
  //                    proposed_source: "deterministic_fallback"
  //                    fallback_reason: "ranking response was absent or unreadable"
  //                    identical_order: true, moved_count: 0
  //
  // A call is made and paid for, its output does not parse, and the
  // deterministic ranker's order is delivered. That is not a model contributing
  // semantics; it is a model contributing nothing, twice a run.
  //
  // NOT removed to save tokens — removed because its output never reaches a
  // user. `enforce` mode remains a separate, non-default path and would need
  // its own evidence before it routes anywhere.
  pool_ranking: {
    primary: null, effort: null, escalation: null,
    reason:
      "the deterministic ranker already produces the delivered order; in the " +
      "default shadow mode the model's proposal cannot reach a user at all",
  },
});

/** Thrown when a caller asks for a model on a stage that has none. */
export class DeterministicStageError extends Error {
  readonly stage: GptStage;
  constructor(stage: GptStage, reason: string) {
    super(
      `\`${stage}\` is a deterministic stage and routes to no model: ${reason}. ` +
      "Call the deterministic implementation directly.",
    );
    this.name = "DeterministicStageError";
    this.stage = stage;
  }
}

/** True when this stage asks no model anything. */
export function isDeterministicStage(stage: GptStage): boolean {
  return POLICY[stage].primary === null;
}

/**
 * Decide which model this stage runs on, and say why.
 *
 * Total over `GptStage`, so a new stage cannot be added without a policy — the
 * compiler refuses it, which is the point.
 */
export function routeModel(
  stage: GptStage, signals: RoutingSignals = {},
): ModelRoute {
  const policy = POLICY[stage];
  if (policy.primary === null) throw new DeterministicStageError(stage, policy.reason);
  return {
    version: GPT_MODEL_ROUTER_VERSION,
    stage,
    model: policy.primary,
    reasoning_effort: policy.effort,
    slot: "primary",
    reason: policy.reason,
    escalation_reason: null,
    tier: policy.effort === "none" ? "fast" : "reasoning",
    signals,
  };
}

/**
 * The escalation route for a stage whose primary output was REJECTED.
 *
 * `reason` must be the validator's own words. Null when this stage does not
 * escalate — a caller that gets null must fail safely rather than improvise a
 * second attempt.
 */
export function escalationRoute(
  stage: GptStage, reason: string, signals: RoutingSignals = {},
): ModelRoute | null {
  const policy = POLICY[stage];
  if (!policy.escalation) return null;
  return {
    version: GPT_MODEL_ROUTER_VERSION,
    stage,
    model: policy.escalation,
    reasoning_effort: policy.effort,
    slot: "escalation",
    reason: `${policy.reason} — ESCALATED after validation rejected the primary result`,
    escalation_reason: reason,
    tier: "reasoning",
    signals,
  };
}

/** Every stage's default route, for a preflight card or a cost estimate. */
export function routingTable(): ModelRoute[] {
  return GPT_STAGES.filter((s) => !isDeterministicStage(s)).map((s) => routeModel(s));
}

/**
 * Accumulates the routes a run actually took.
 *
 * A run's model cost is the sum of decisions it made, and those decisions are
 * spread across six modules. This collects them so `state.model_routing` can
 * answer "which model ran which stage, how often, and why" from one object.
 */
export class ModelRoutingLedger {
  private readonly routes: ModelRoute[] = [];

  record(route: ModelRoute): ModelRoute {
    this.routes.push(route);
    return route;
  }

  /** Route and record in one step — the form every call site uses. */
  route(stage: GptStage, signals: RoutingSignals = {}): ModelRoute {
    return this.record(routeModel(stage, signals));
  }

  /** Compact, per-stage, for the persisted state. */
  summary(): Record<string, unknown> {
    const byStage = new Map<string, {
      stage: string; tier: GptTier; model: string; calls: number;
      reason: string; escalations: number;
    }>();
    for (const r of this.routes) {
      const k = `${r.stage}|${r.slot}`;
      const row = byStage.get(k) ?? {
        stage: r.stage, tier: r.tier, model: r.model, calls: 0,
        reason: r.reason, escalations: 0,
      };
      row.calls++;
      // COUNTED BY SLOT. "What percentage of Luna calls needed Terra?" is the
      // question this ledger exists to answer, and it is answerable only if an
      // escalation is a row of its own rather than a flag on the attempt.
      if (r.slot === "escalation") row.escalations++;
      byStage.set(k, row);
    }
    return {
      version: GPT_MODEL_ROUTER_VERSION,
      total_calls: this.routes.length,
      stages: [...byStage.values()],
    };
  }
}
