// ONE PLACE DECIDES WHICH MODEL EACH STAGE RUNS ON.
//
// ── WHAT THIS REPLACES ───────────────────────────────────────────────────────
//
// The tier machinery already existed — `GptTier`, `modelForTier`, and
// `gptDiagnostics` recording both — and every stage set its own tier at its own
// call site, with its own prose reason:
//
//     missionTriageBinding.ts:150      tier: "fast",      reason: "…"
//     missionEvaluationBinding.ts:166  tier: "reasoning", reason: "…"
//     everything else                  (nothing — silently `reasoning`)
//
// Two problems, and the second is the expensive one. The obvious problem is that
// "which stages run on which model" cannot be read anywhere; you have to grep
// six files and hope you found them all. The real problem is that a per-call-site
// tier is a CONSTANT, so it cannot respond to the run it is part of. Triaging
// twenty-five companies down to a shortlist is cheap classification and belongs
// on the fast tier. Triaging four companies when the user asked for two is the
// same code path and the same prompt, and each verdict now decides a lead — the
// work did not change, the STAKES did, and a constant cannot see that.
//
// ── THE RULE ─────────────────────────────────────────────────────────────────
//
// Best result for the lowest defensible cost. Not the biggest model everywhere,
// which is an absence of a decision wearing the costume of caution; and not the
// cheapest, which pays for itself once and then costs a run.
//
//   reasoning   a wrong answer misdirects the run or spends money badly
//   fast        a wrong answer costs one row its ORDER and nothing else
//
// Every stage below states which it is and why, and every ESCALATION states the
// signal that triggered it. Nothing here is tuned; each rule is a sentence about
// what the work does.
//
// ── AND WHY IT IS NOT A KNOB ─────────────────────────────────────────────────
//
// Two tiers, not a continuum. Five settings invite tuning; a binary forces the
// question that actually needs answering — does being wrong here cost a lead, or
// cost a lead its position? A stage that cannot answer that has not been thought
// about, and gets `reasoning`, which cannot quietly degrade a decision.
//
// PURE. No network, model or database access.

import { modelForTier, type GptTier } from "./gptProvider.ts";

export const GPT_MODEL_ROUTER_VERSION = "gpt-model-router-v1" as const;

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
  tier: GptTier;
  /** The model id this resolves to. Recorded so a trace needs no second lookup. */
  model: string;
  /** Why this tier, in one sentence. Persisted with the call. */
  reason: string;
  /** Present when a cheap default was raised, naming the signal that did it. */
  escalated_from?: GptTier;
  signals: RoutingSignals;
}

interface StagePolicy {
  tier: GptTier;
  reason: string;
  /**
   * Raise the tier when this run makes the stage decisive.
   *
   * Only ever fast → reasoning. There is no downgrade path and there must not
   * be one: a stage whose default is `reasoning` was given it because being
   * wrong there costs a lead, and no volume of cheap work changes that.
   */
  escalate?: (s: RoutingSignals) => string | null;
}

/**
 * THE POLICY. One entry per stage, each a statement about the work.
 *
 * Read `reason` as the answer to "what does being wrong here cost?".
 */
const POLICY: Readonly<Record<GptStage, StagePolicy>> = Object.freeze({
  // ── REASONING: a wrong answer misdirects the run ────────────────────────
  mission_compilation: {
    tier: "reasoning",
    reason:
      "one call decides what the entire run is for; misreading the request " +
      "misdirects every stage after it and no later stage can repair it",
  },
  discovery_actor_selection: {
    tier: "reasoning",
    reason:
      "chooses which paid Actors run and what each is asked; a wrong choice " +
      "buys the wrong pool, and no enrichment or qualification can recover it",
  },
  discovery_actor_selection_repair: {
    tier: "reasoning",
    reason:
      "the first proposal was refused; a repair is strictly harder than the " +
      "attempt that failed and must never run on a cheaper model than it did",
  },
  execution_plan: {
    tier: "reasoning",
    reason:
      "plans the whole chain and decides which paid stages are unnecessary; " +
      "this is the most consequential single call the pipeline makes",
  },
  execution_plan_repair: {
    tier: "reasoning",
    reason: "a refused plan is harder to fix than it was to make",
  },
  execution_plan_amendment: {
    tier: "reasoning",
    reason:
      "re-plans against what the pool actually contains; getting this wrong " +
      "either re-buys evidence already held or drops the step that proves it",
  },
  mission_evaluation: {
    tier: "reasoning",
    reason:
      "final qualification authority over already-paid-for evidence; a wrong " +
      "verdict wastes the whole per-company spend or qualifies on weak grounds",
  },
  company_qualification: {
    tier: "reasoning",
    reason: "the verdict IS the product; it is what the user acts on",
  },
  pool_ranking: {
    tier: "reasoning",
    reason:
      "decides which qualified companies the user actually sees first when " +
      "there are more than they asked for",
  },

  // ── FAST: a wrong answer costs one row its ORDER ────────────────────────
  mission_triage: {
    tier: "fast",
    reason:
      "high-volume batch classification; an undecidable verdict degrades to " +
      "`uncertain`, which reorders the shortlist and never excludes a company",
    escalate: (s) => {
      // THE STAKES, NOT THE WORK. Triage is the same prompt either way. What
      // changes is whether a misordering costs a position or costs a lead: when
      // the pool is barely bigger than the quota, every verdict is close to
      // final, and "it only reorders" stops being true.
      const pool = s.pool_size ?? s.batch_size;
      const want = s.requested_count;
      if (pool != null && want != null && pool <= want * 2) {
        return `the pool (${pool}) is within twice the requested count (${want}), ` +
          `so a triage verdict decides a lead rather than its position`;
      }
      // A batch small enough to read carefully costs almost nothing to reason
      // over, and the cheap tier buys nothing at this size.
      if (s.batch_size != null && s.batch_size <= 5) {
        return `a batch of ${s.batch_size} is too small for the cheap tier to save ` +
          `anything meaningful against the cost of being wrong`;
      }
      return null;
    },
  },
  semantic_classification: {
    tier: "fast",
    reason:
      "structural classification of one company's description; a wrong answer " +
      "is corrected by the evaluator that reads the same evidence afterwards",
    escalate: (s) =>
      s.pool_size != null && s.requested_count != null &&
        s.pool_size <= s.requested_count
        ? `the pool (${s.pool_size}) no longer exceeds the requested count ` +
          `(${s.requested_count}); every remaining company must be judged on merit`
        : null,
  },
});

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
  const escalation = policy.tier === "fast" ? policy.escalate?.(signals) ?? null : null;
  const tier: GptTier = escalation ? "reasoning" : policy.tier;

  return {
    version: GPT_MODEL_ROUTER_VERSION,
    stage,
    tier,
    model: modelForTier(tier),
    reason: escalation ? `${policy.reason} — ESCALATED: ${escalation}` : policy.reason,
    ...(escalation ? { escalated_from: policy.tier as GptTier } : {}),
    signals,
  };
}

/** Every stage's default route, for a preflight card or a cost estimate. */
export function routingTable(): ModelRoute[] {
  return GPT_STAGES.map((s) => routeModel(s));
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
      const k = `${r.stage}|${r.tier}`;
      const row = byStage.get(k) ?? {
        stage: r.stage, tier: r.tier, model: r.model, calls: 0,
        reason: r.reason, escalations: 0,
      };
      row.calls++;
      if (r.escalated_from) row.escalations++;
      byStage.set(k, row);
    }
    return {
      version: GPT_MODEL_ROUTER_VERSION,
      total_calls: this.routes.length,
      stages: [...byStage.values()],
    };
  }
}
