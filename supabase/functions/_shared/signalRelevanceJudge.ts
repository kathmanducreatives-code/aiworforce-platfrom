// PHASE 7 — THE CALL, THE VALIDATOR, AND THE ONE ESCALATION.
//
// ── LUNA, VALIDATE, THEN TERRA — AND ONLY THEN ──────────────────────────────
//
// Luna answers. The validator decides what may be believed. Terra is asked
// exactly once, and only when the validator found something a re-read could
// FIX: a miscited id, a missing field, a band outside the vocabulary.
//
// A provider that is unavailable, rate-limited or out of credit is NOT
// repairable, and escalating there would pay a more expensive model to hit the
// same wall. Those fall straight back to the deterministic cluster.
//
// Sol is never routed here. The router's policy for this stage names Luna and
// Terra and nothing else, and `signalRelevanceStages` asserts it.
//
// ── WHAT THE MODEL IS SHOWN ─────────────────────────────────────────────────
//
// The cluster's own events, and the workspace's own context. Nothing else —
// no other workspace's data, no other cluster's events, and no free text a
// user typed that the model could mistake for an instruction.

import {
  gptStructured, type GptDeps, type GptResult,
} from "./gptProvider.ts";
import { routeModel, escalationRoute, type ModelRoute } from "./gptModelRouter.ts";
import type { SignalCluster } from "./signalCluster.ts";
import {
  validateRelevance, deterministicVerdict,
  type RelevanceVerdict, type RawRelevanceVerdict,
} from "./signalRelevance.ts";

export const SIGNAL_RELEVANCE_JUDGE_VERSION = "signal-relevance-judge-v1" as const;

/** The workspace's own context. Every field is a fact it stated about itself. */
export interface RelevanceContext {
  /** What the workspace sells, in its own words. */
  offer?: string | null;
  /** The problem it solves. The thing a situation has to connect to. */
  problem_solved?: string | null;
  icp_industries?: readonly string[];
  icp_business_models?: readonly string[];
  icp_locations?: readonly string[];
  buyer_roles?: readonly string[];
  disqualifiers?: readonly string[];
}

const RESPONSE_SCHEMA = {
  name: "signal_relevance",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "relevance", "why_now", "why_it_matters", "evidence_event_ids", "timely",
    ],
    properties: {
      relevance: { type: "string", enum: ["high", "medium", "low", "none"] },
      why_now: { type: "string" },
      why_it_matters: { type: "string" },
      evidence_event_ids: { type: "array", items: { type: "string" } },
      timely: { type: "boolean" },
    },
  },
} as const;

const SYSTEM = [
  "You judge whether a situation at another company matters to THIS workspace.",
  "",
  "The situation is already established: every event you are shown was collected,",
  "evidenced and written by deterministic code. You are NOT deciding whether",
  "anything happened. You are deciding whether it is relevant to this workspace's",
  "ICP, offer and buyer — and whether it is timely.",
  "",
  "RULES:",
  "- Cite only event ids from the list you are given. An id you did not receive",
  "  will be dropped and your verdict discarded.",
  "- Say `timely: true` only if a cited event has a SOURCE date that is recent.",
  "  An 'observed' date is when we looked, not when it happened.",
  "- If the situation does not fit this workspace, say so and rate it low or none.",
  "  A confident 'no' is more useful than a hedged 'maybe'.",
  "- `why_now` describes the situation. `why_it_matters` connects it to THIS",
  "  workspace's offer, ICP or buyer. Two sentences at most each.",
].join("\n");

/**
 * What the model is shown about a cluster.
 *
 * EVENT IDS ARE THE ONLY HANDLE. The model can cite what it is given and
 * nothing else, and the validator checks the citations against this same list —
 * so the prompt and the guard cannot disagree about what exists.
 */
export function buildRelevancePrompt(
  cluster: SignalCluster, ctx: RelevanceContext, now: number = Date.now(),
): { system: string; user: string } {
  const ageDays = (iso: string | null | undefined) => {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? Math.round((now - t) / 86_400_000) : null;
  };

  const events = cluster.events.map((e) => ({
    event_id: e.id,
    signal: e.signal_type,
    category: e.signal_category,
    // THE TWO TIMES, NAMED. Collapsing them is how a year-old story becomes
    // "this week".
    happened_days_ago: e.occurred_at_basis === "source_reported"
      ? ageDays(e.occurred_at)
      : null,
    observed_days_ago: ageDays(e.observed_at),
    date_is_reported_by_source: e.occurred_at_basis === "source_reported",
    verification: e.verification_status ?? "unverified",
  }));

  const user = JSON.stringify({
    workspace: {
      offer: ctx.offer ?? null,
      problem_solved: ctx.problem_solved ?? null,
      icp_industries: [...(ctx.icp_industries ?? [])],
      icp_business_models: [...(ctx.icp_business_models ?? [])],
      icp_locations: [...(ctx.icp_locations ?? [])],
      buyer_roles: [...(ctx.buyer_roles ?? [])],
      disqualifiers: [...(ctx.disqualifiers ?? [])],
    },
    situation: {
      subject_type: cluster.subject_type,
      subject: cluster.subject_key,
      signal_types: cluster.signal_types,
      categories: cluster.categories,
      events,
    },
  }, null, 1);

  return { system: SYSTEM, user };
}

/**
 * Is this something a second, better read could fix?
 *
 * Only shape and grounding problems. A provider that is down produces no
 * verdict to repair, and paying Terra to meet the same outage is spend with no
 * possible return.
 */
export function isRepairable(v: RelevanceVerdict): boolean {
  if (v.source === "model") return false;
  const why = v.adjustments[0] ?? "";
  return /not a relevance band|cited no evidence|belonged to another cluster|explained nothing/
    .test(why);
}

export interface JudgeDeps extends GptDeps {
  onRoute?: (route: ModelRoute) => void;
  /**
   * Records this judgement in the execution ledger.
   *
   * DISTINCT FROM `GptDeps.onModelCall`, which carries the provider's own
   * telemetry and knows nothing about whether the answer was believed. Both
   * fire: the first says what the call cost, this says what it bought.
   */
  onJudgeCall?: (row: {
    stage: string; model: string; latency_ms: number;
    input_tokens: number | null; output_tokens: number | null;
    estimated_cost_usd: number | null; cost_source: string;
    outcome: "believed" | "refused" | "failed";
    detail: string | null;
  }) => void | Promise<void>;
}

/**
 * Judge one cluster. Never throws, and never returns a cluster it changed.
 *
 * The verdict is the ONLY thing that comes back — the cluster itself is
 * untouched, because relevance re-ranks and explains and has no business
 * altering what was collected.
 */
export async function judgeCluster(
  cluster: SignalCluster,
  ctx: RelevanceContext,
  deps: JudgeDeps = {},
  now: number = Date.now(),
): Promise<RelevanceVerdict> {
  // A CLUSTER WITH NOTHING CITABLE IS NOT WORTH A CALL. Every verdict must cite
  // an event id, so a cluster whose events carry none can only be refused —
  // and paying to be refused is spend with a known outcome.
  const citable = cluster.events.filter((e) => !!e.id).length;
  if (citable === 0) {
    return deterministicVerdict(cluster, "no event in this cluster has an id to cite");
  }

  const { system, user } = buildRelevancePrompt(cluster, ctx, now);

  const attempt = async (route: ModelRoute): Promise<RelevanceVerdict> => {
    deps.onRoute?.(route);
    const r: GptResult<RawRelevanceVerdict> = await gptStructured<RawRelevanceVerdict>({
      purpose: route.stage,
      system,
      user,
      schema: RESPONSE_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
      maxTokens: 700,
      model: route.model,
      reasoningEffort: route.reasoning_effort,
      tier: route.tier,
      routing_reason: route.reason,
    }, deps);

    if (!r.ok) {
      deps.log?.("signal_relevance_failed", {
        stage: route.stage, code: r.code, detail: r.detail, latency_ms: r.latency_ms,
      });
      await deps.onJudgeCall?.({
        stage: route.stage, model: route.model, latency_ms: r.latency_ms,
        input_tokens: null, output_tokens: null,
        estimated_cost_usd: null, cost_source: "unknown",
        outcome: "failed", detail: `${r.code}: ${r.detail}`.slice(0, 300),
      });
      // A PROVIDER FAILURE IS NOT A REPAIRABLE VERDICT. The deterministic
      // cluster stands, and nothing further is bought.
      return deterministicVerdict(cluster, `the model was unavailable (${r.code})`);
    }

    const verdict = validateRelevance(cluster, r.value, { now });
    await deps.onJudgeCall?.({
      stage: route.stage, model: r.model, latency_ms: r.latency_ms,
      input_tokens: r.telemetry?.input_tokens ?? null,
      output_tokens: r.telemetry?.output_tokens ?? null,
      estimated_cost_usd: r.telemetry?.estimated_cost_usd ?? null,
      cost_source: r.telemetry?.cost_source ?? "unknown",
      outcome: verdict.source === "model" ? "believed" : "refused",
      detail: verdict.adjustments.join("; ").slice(0, 300) || null,
    });
    return verdict;
  };

  const first = await attempt(routeModel("signal_relevance"));
  if (first.source === "model" || !isRepairable(first)) return first;

  // ── ONE REPAIR, WITH THE VALIDATOR'S OWN WORDS ──────────────────────────
  const escalate = escalationRoute("signal_relevance", first.adjustments[0] ?? "invalid verdict");
  if (!escalate) return first;
  deps.log?.("signal_relevance_repair", { because: first.adjustments[0] });
  const second = await attempt(escalate);
  // IF THE REPAIR IS ALSO UNUSABLE, THE FLOOR STANDS. There is no third try.
  return second.source === "model" ? second : first;
}
