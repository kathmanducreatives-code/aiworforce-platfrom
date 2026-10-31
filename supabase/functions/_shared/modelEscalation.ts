// LUNA ATTEMPTS. THE REAL VALIDATOR JUDGES. TERRA REPAIRS, ONCE.
//
// ── THE SHAPE ────────────────────────────────────────────────────────────────
//
//     Luna → validate → valid?  yes → done
//                              no  → Terra (given the validator's exact errors)
//                                     → revalidate
//                                        valid → done
//                                        no    → fail safely
//
// ── THE VALIDATOR IS THE PRODUCTION ONE ──────────────────────────────────────
//
// `validate` is supplied by the caller and MUST be the same function that
// decides whether the result is usable in production — `validateDiscoveryStrategy`,
// `validateExecutionPlan`, the mission schema parse. Not a confidence score,
// not a second opinion, not a heuristic written for routing.
//
// The reason is not purity. A routing-specific validator is a second definition
// of "valid" that will disagree with the first, and every disagreement is either
// a paid escalation nobody needed or a bad result shipped because the cheap
// check liked it.
//
// ── PROVIDER FAILURES DO NOT ESCALATE ────────────────────────────────────────
//
// THE DISTINCTION THIS MODULE ENFORCES, and the reason it exists as code rather
// than a convention. Terra runs on the SAME OpenAI account as Luna:
//
//   MODEL OUTPUT failure   the call succeeded and the answer was wrong —
//                          schema invalid, validator rejected, constraint
//                          omitted, actor input the catalog refuses.
//                          Terra has something to work with: the original
//                          context plus the exact errors.   → ESCALATES
//
//   PROVIDER failure       the call never produced an answer — quota
//                          exhausted, outage, auth, unsafe-to-retry timeout.
//                          Terra would fail identically, for the identical
//                          reason, one HTTP round trip later.  → NEVER
//
// On 2026-08-21 an empty balance produced four silent retries and a chat that
// answered nothing. Escalating that would have made it eight, at twice the
// latency, to reach the same place — and would have buried `quota_exhausted`
// under a second, identical failure.
//
// ── BOUNDED ──────────────────────────────────────────────────────────────────
//
// Exactly one escalation. Not a loop with a limit — a single step, so the worst
// case is two model calls whatever happens. Luna ↔ Terra bouncing would turn
// one malformed response into an unbounded bill for a result nobody has any
// reason to think the next attempt gets right.
//
// PURE. No network, model or database access — the model call is injected.

import {
  activeModelFamily, DEFAULT_MODEL_FAMILY, escalationRoute, type GptStage, type ModelFamilyId, type ModelRoute, routeModel,
  type RoutingSignals,
} from "./gptModelRouter.ts";
import { isUnrecoverableModelFailure } from "./modelFailureContract.ts";

export const MODEL_ESCALATION_VERSION = "model-escalation-v1" as const;

/**
 * Provider-side failure codes that must never reach Terra.
 *
 * Everything here means the PROVIDER did not answer. `isUnrecoverableModelFailure`
 * covers the terminal account states; the rest are transient faults whose retry
 * policy belongs to the transport, not to a second model.
 */
const PROVIDER_FAILURE_CODES = new Set([
  "quota_exhausted", "no_api_key", "http_error", "transport_error", "timeout",
  // The spend gate said no: a dearer model is the one thing that must not follow.
  "admission_refused",
]);

export function isProviderSideFailure(code: string | null | undefined): boolean {
  const c = String(code ?? "");
  return isUnrecoverableModelFailure(c) || PROVIDER_FAILURE_CODES.has(c);
}

/** What one model attempt produced. */
export interface AttemptOutcome<T> {
  ok: boolean;
  value?: T;
  /** The provider's own failure code, when the call itself failed. */
  failureCode?: string | null;
  failureDetail?: string | null;
}

/** What the production validator said. */
export interface ValidationVerdict {
  valid: boolean;
  /**
   * The validator's own messages. Handed to Terra verbatim.
   *
   * Terra repairs what a validator rejected; paraphrasing the rejection would
   * ask it to fix a different problem.
   */
  errors: string[];
}

export type EscalationEvent =
  | "primary_success"
  | "terra_escalation"
  | "terra_success"
  | "final_failure"
  /** The provider failed; no second model was called, deliberately. */
  | "provider_failure_no_escalation";

export interface EscalationRecord {
  version: typeof MODEL_ESCALATION_VERSION;
  stage: GptStage;
  event: EscalationEvent;
  /** The model the stage started on. */
  primary_model: string;
  /** What actually produced the final answer, or the last thing tried. */
  actual_model: string;
  /** The validator's reason, verbatim. Null when nothing was rejected. */
  escalation_reason: string | null;
  /** The provider's code, when a provider failure stopped the ladder. */
  provider_failure_code: string | null;
  attempts: number;
}

export interface EscalationResult<T> {
  ok: boolean;
  value?: T;
  record: EscalationRecord;
  route: ModelRoute;
  failureCode?: string | null;
  failureDetail?: string | null;
}

/**
 * Run a stage on its primary model, validate, and escalate once if rejected.
 *
 * `run` receives the route so the caller can build the request from it — the
 * caller never names a model, which is what keeps routing in one place.
 * `previous` carries Luna's rejected output to Terra where that is useful;
 * a caller that cannot use it ignores it.
 */
export async function runWithEscalation<T>(
  stage: GptStage,
  deps: {
    run: (route: ModelRoute, previous: {
      value?: T; errors: string[];
    } | null) => Promise<AttemptOutcome<T>>;
    validate: (value: T) => ValidationVerdict;
    signals?: RoutingSignals;
    onEvent?: (r: EscalationRecord) => void;
    /**
     * A run's allowance of escalations, shared across its stages. Absent means
     * no run-level cap (the per-call ladder is still one rung). Present and
     * spent, a rejected result fails safely instead of escalating.
     */
    escalationBudget?: EscalationBudget;
  },
): Promise<EscalationResult<T>> {
  const signals = deps.signals ?? {};
  const primary = routeModel(stage, signals);
  const emit = (r: EscalationRecord): EscalationRecord => {
    deps.onEvent?.(r);
    return r;
  };
  const base = {
    version: MODEL_ESCALATION_VERSION,
    stage,
    primary_model: primary.model,
  } as const;

  // ── ATTEMPT ONE: LUNA ──────────────────────────────────────────────────
  const first = await deps.run(primary, null);

  if (!first.ok || first.value === undefined) {
    // THE CALL ITSELF FAILED. Terra shares the account; it would fail the same
    // way. Stop, and keep the provider's real code so the layer above can say
    // `quota_exhausted` rather than "planning failed".
    if (isProviderSideFailure(first.failureCode)) {
      return {
        ok: false,
        record: emit({
          ...base, event: "provider_failure_no_escalation",
          actual_model: primary.model,
          escalation_reason: null,
          provider_failure_code: first.failureCode ?? null,
          attempts: 1,
        }),
        route: primary,
        failureCode: first.failureCode ?? null,
        failureDetail: first.failureDetail ?? null,
      };
    }
    // The call returned something unusable — an unparseable body, a refusal.
    // That IS a model-output failure, and Terra may have better luck.
    return await escalate(
      stage, signals, deps, primary, base, emit,
      { value: undefined, errors: [first.failureDetail ?? "primary produced no usable value"] },
      first.failureCode ?? null,
    );
  }

  // ── THE PRODUCTION VALIDATOR DECIDES ───────────────────────────────────
  const verdict = deps.validate(first.value);
  if (verdict.valid) {
    return {
      ok: true,
      value: first.value,
      record: emit({
        ...base, event: "primary_success",
        actual_model: primary.model,
        escalation_reason: null,
        provider_failure_code: null,
        attempts: 1,
      }),
      route: primary,
    };
  }

  return await escalate(
    stage, signals, deps, primary, base, emit,
    { value: first.value, errors: verdict.errors }, null,
  );
}

/** The single, bounded second step. */
async function escalate<T>(
  stage: GptStage,
  signals: RoutingSignals,
  deps: Parameters<typeof runWithEscalation<T>>[1],
  primary: ModelRoute,
  base: { version: typeof MODEL_ESCALATION_VERSION; stage: GptStage; primary_model: string },
  emit: (r: EscalationRecord) => EscalationRecord,
  previous: { value?: T; errors: string[] },
  primaryFailureCode: string | null,
): Promise<EscalationResult<T>> {
  const reason = previous.errors.join("; ").slice(0, 500) || "primary result rejected";
  const route = escalationRoute(stage, reason, signals);

  // NO ESCALATION PATH. A stage whose policy names no escalation model fails
  // here rather than improvising one — triage and evaluation degrade to
  // `uncertain`, and a repair stage IS the escalation already.
  if (!route) {
    return {
      ok: false,
      record: emit({
        ...base, event: "final_failure",
        actual_model: primary.model,
        escalation_reason: reason,
        provider_failure_code: primaryFailureCode,
        attempts: 1,
      }),
      route: primary,
      failureCode: primaryFailureCode,
      failureDetail: reason,
    };
  }

  // A RUN-LEVEL CAP, on top of the one-rung ladder. Every escalating stage is
  // bounded per call; without this a run whose amendments are each rejected
  // escalates once per amendment. Spent, it fails safely like a stage with no
  // escalation path, and says why.
  if (deps.escalationBudget && !deps.escalationBudget.tryConsume(stage)) {
    return {
      ok: false,
      record: emit({
        ...base, event: "final_failure",
        actual_model: primary.model,
        escalation_reason: `escalation_budget_exhausted (${deps.escalationBudget.max} per run): ${reason}`.slice(0, 500),
        provider_failure_code: primaryFailureCode,
        attempts: 1,
      }),
      route: primary,
      failureCode: "escalation_budget_exhausted",
      failureDetail: reason,
    };
  }

  emit({
    ...base, event: "terra_escalation",
    actual_model: route.model,
    escalation_reason: reason,
    provider_failure_code: null,
    attempts: 1,
  });

  const second = await deps.run(route, previous);

  // A PROVIDER FAILURE ON THE WAY UP still stops here. Terra failing for an
  // account reason is the same fact as Luna failing for one, and it must not be
  // reported as "the plan could not be repaired".
  if (!second.ok || second.value === undefined) {
    return {
      ok: false,
      record: emit({
        ...base,
        event: isProviderSideFailure(second.failureCode)
          ? "provider_failure_no_escalation"
          : "final_failure",
        actual_model: route.model,
        escalation_reason: reason,
        provider_failure_code: second.failureCode ?? null,
        attempts: 2,
      }),
      route,
      failureCode: second.failureCode ?? null,
      failureDetail: second.failureDetail ?? reason,
    };
  }

  // ── REVALIDATED ONCE, BY THE SAME VALIDATOR ────────────────────────────
  //
  // Terra's output is not trusted because it came from Terra. It is the same
  // question — is this usable in production — and the same function answers it.
  const verdict = deps.validate(second.value);
  if (!verdict.valid) {
    return {
      ok: false,
      record: emit({
        ...base, event: "final_failure",
        actual_model: route.model,
        escalation_reason: verdict.errors.join("; ").slice(0, 500) || reason,
        provider_failure_code: null,
        attempts: 2,
      }),
      route,
      failureDetail: verdict.errors.join("; ").slice(0, 500),
    };
  }

  return {
    ok: true,
    value: second.value,
    record: emit({
      ...base, event: "terra_success",
      actual_model: route.model,
      escalation_reason: reason,
      provider_failure_code: null,
      attempts: 2,
    }),
    route,
  };
}

/**
 * How many escalations one run may make, across all of its stages.
 *
 * Deterministic and counted, never a model's judgement. `max` 0 disables
 * escalation for the run. One instance per run, passed to every
 * `runWithEscalation` call that run makes.
 */
export class EscalationBudget {
  readonly max: number;
  private readonly spent: GptStage[] = [];
  constructor(max: number) {
    this.max = Number.isFinite(max) && max >= 0 ? Math.floor(max) : 0;
  }
  /** Spend one escalation for `stage`; false when none is left. */
  tryConsume(stage: GptStage): boolean {
    if (this.spent.length >= this.max) return false;
    this.spent.push(stage);
    return true;
  }
  get used(): readonly GptStage[] { return this.spent; }
}

/**
 * THE MISSION-LEVEL ESCALATION CAP (Luna → Sol under the gpt-6 family).
 *
 * The production escalations of a lead mission are the engine's repair rounds
 * — a refused discovery selection or execution plan asked once more, on the
 * escalation model. Each DECISION already gets at most one. Across a mission,
 * though, discovery is re-planned per wave and slice, so the number of repairs
 * was unbounded. Under gpt-6 each one is a Sol call, so the mission carries a
 * count (`escalations_used`, checkpointed with the engine state) and stops at
 * this cap: a refused plan past it is blocked, exactly as a failed repair is.
 *
 * Null — no cap, today's behaviour — on the default family, which the review
 * required to stay byte-identical. AGENTORY_MAX_ESCALATIONS_PER_MISSION
 * overrides the default of 3; 0 disables escalation for the mission.
 */
export const MISSION_ESCALATION_CAP_ENV = "AGENTORY_MAX_ESCALATIONS_PER_MISSION";
export const DEFAULT_MISSION_ESCALATION_CAP = 3;
export function missionEscalationCap(
  family: ModelFamilyId = activeModelFamily(),
  read: (k: string) => string | undefined = (k) => {
    try { return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k); }
    catch { return undefined; }
  },
): number | null {
  if (family === DEFAULT_MODEL_FAMILY) return null;
  const raw = String(read(MISSION_ESCALATION_CAP_ENV) ?? "").trim();
  const n = raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MISSION_ESCALATION_CAP;
}
