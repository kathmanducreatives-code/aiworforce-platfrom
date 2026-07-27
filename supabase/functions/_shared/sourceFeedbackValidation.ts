// DETERMINISTIC VALIDATION OF A CLAUDE SOURCE-FEEDBACK RECOMMENDATION.
//
// A recommendation is a SUGGESTION until this module says otherwise. Nothing here
// asks whether the suggestion is good — that is a judgment. It asks whether the
// suggestion is EXECUTABLE and SAFE, which is a fact, and it answers from the
// validated plan and the canonical task state rather than from anything the model
// said about itself.
//
// TWO LAYERS, and the first one is structural. The prompt shows only the actions
// that are currently available, so "invent a source" and "run an exhausted step"
// are usually not expressible. This layer assumes that guarantee will eventually
// fail — a model that ignores the menu, a future caller that projects the menu
// wrongly — and re-checks everything against the authorities anyway.
//
// AUTHORITIES REUSED, never reimplemented:
//   the action union            hiringSourcePlan.ts    (ApprovedSourceNextAction)
//   the broadening ladder       hiringSourcePlan.ts    (SafeBroadeningAction)
//   step status + input ledger  sourceExecutionState.ts
//   input compilation           sequentialSourceRuntime.ts -> actorInputPlanner.ts
//   injection patterns          broadeningValidator.ts (detectInjection)
//
// PURE. No network, provider, model or database access.

import { canonicalJson } from "./planHash.ts";
import { detectInjection } from "./broadeningValidator.ts";
import {
  isSafeBroadeningAction, SAFE_BROADENING_ACTIONS,
  type ApprovedSourceNextAction, type OrderedHiringSourcePlan, type SafeBroadeningAction,
  type SourceStepObservation,
} from "./hiringSourcePlan.ts";
import { isStepFinished, stepOf, type SourceExecutionState } from "./sourceExecutionState.ts";
import { prepareStepCall } from "./sequentialSourceRuntime.ts";
import type { BroadeningIntentChange } from "./actorInputPlanner.ts";
import {
  EXPECTED_IMPROVEMENTS, FEEDBACK_BOUNDS, SOURCE_FEEDBACK_REASON_CODES, SOURCE_FEEDBACK_VERSION,
  type AvailableBoundedAction, type ClaudeSourceFeedbackResponse, type FeedbackProjectionContext,
} from "./sourceFeedbackContract.ts";

// ------------------------------------------------------------- the parser ---

export type FeedbackParseOutcome =
  | { ok: true; strategy: ClaudeSourceFeedbackResponse }
  | { ok: false; problem: string };

const CONFIDENCES = new Set(["high", "medium", "low"]);

const RECOMMENDABLE_ACTIONS = new Set<string>([
  "stop_quota_reached", "broaden_current_source", "advance_to_next_source",
  "verify_selected_jobs", "enrich_company_identity", "enrich_contacts", "stop_valid_exhaustion",
]);

/**
 * Shape-only parse, for the planner wrapper's `validateStrategy` hook.
 *
 * Strict by construction: an unrecognised action, a missing field or a
 * `constraintsPreserved` that is anything other than the boolean `true` is a parse
 * failure, not something to coerce. Policy questions — does this step exist, is
 * this rung already used — belong to `validateFeedbackRecommendation` below, which
 * can see the plan and the task state.
 */
export function parseSourceFeedbackResponse(candidate: unknown): FeedbackParseOutcome {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, problem: "response_not_an_object" };
  }
  const o = candidate as Record<string, unknown>;

  if (o.version !== SOURCE_FEEDBACK_VERSION) return { ok: false, problem: "version_mismatch" };
  if (o.constraintsPreserved !== true) return { ok: false, problem: "constraints_preserved_not_true" };

  const reasonCode = String(o.reasonCode ?? "");
  if (!(SOURCE_FEEDBACK_REASON_CODES as readonly string[]).includes(reasonCode)) {
    return { ok: false, problem: `unknown_reason_code:${reasonCode.slice(0, 40)}` };
  }

  const effect = (o.expectedEffect ?? {}) as Record<string, unknown>;
  const improve = String(effect.expectedToImprove ?? "");
  if (!(EXPECTED_IMPROVEMENTS as readonly string[]).includes(improve)) {
    return { ok: false, problem: `unknown_expected_effect:${improve.slice(0, 40)}` };
  }
  const confidence = String(effect.confidence ?? "");
  if (!CONFIDENCES.has(confidence)) return { ok: false, problem: `unknown_confidence:${confidence.slice(0, 20)}` };

  const rec = parseRecommendation(o.recommendation);
  if (!rec.ok) return { ok: false, problem: rec.problem };

  const conciseReason = String(o.conciseReason ?? "").trim();
  if (conciseReason.length > FEEDBACK_BOUNDS.maxReasonChars) {
    return { ok: false, problem: "concise_reason_too_long" };
  }

  return {
    ok: true,
    strategy: {
      version: SOURCE_FEEDBACK_VERSION,
      recommendation: rec.action,
      reasonCode: reasonCode as ClaudeSourceFeedbackResponse["reasonCode"],
      conciseReason,
      expectedEffect: {
        expectedToImprove: improve as ClaudeSourceFeedbackResponse["expectedEffect"]["expectedToImprove"],
        confidence: confidence as ClaudeSourceFeedbackResponse["expectedEffect"]["confidence"],
      },
      constraintsPreserved: true,
    },
  };
}

type RecommendationParse =
  | { ok: true; action: ApprovedSourceNextAction }
  | { ok: false; problem: string };

/**
 * Parse EXACTLY ONE action.
 *
 * The returned object is rebuilt field by field rather than passed through, so an
 * unrecognised extra key — an Actor id, a raw input blob, a nested command — cannot
 * survive into anything the executor sees. It is also rejected outright below, but
 * rebuilding means a future caller that forgets to check still cannot execute it.
 */
function parseRecommendation(raw: unknown): RecommendationParse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, problem: "recommendation_not_an_object" };
  }
  const r = raw as Record<string, unknown>;
  const action = String(r.action ?? "");
  if (!RECOMMENDABLE_ACTIONS.has(action)) return { ok: false, problem: `unknown_action:${action.slice(0, 40)}` };

  switch (action) {
    case "stop_quota_reached":
      return { ok: true, action: { action: "stop_quota_reached" } };

    case "stop_valid_exhaustion":
      return {
        ok: true,
        action: { action: "stop_valid_exhaustion", reason: str(r.reason, FEEDBACK_BOUNDS.maxReasonChars) || "model_recommended_exhaustion" },
      };

    case "broaden_current_source": {
      const stepId = str(r.stepId, FEEDBACK_BOUNDS.maxIdChars);
      if (!stepId) return { ok: false, problem: "broaden_missing_step_id" };
      const b = parseBroadening(r.broadeningAction);
      if (!b.ok) return { ok: false, problem: b.problem };
      return { ok: true, action: { action: "broaden_current_source", stepId, broadeningAction: b.value } };
    }

    case "advance_to_next_source": {
      const currentStepId = str(r.currentStepId, FEEDBACK_BOUNDS.maxIdChars);
      const nextStepId = str(r.nextStepId, FEEDBACK_BOUNDS.maxIdChars);
      if (!currentStepId || !nextStepId) return { ok: false, problem: "advance_missing_step_ids" };
      return { ok: true, action: { action: "advance_to_next_source", currentStepId, nextStepId } };
    }

    case "verify_selected_jobs":
    case "enrich_company_identity": {
      const companyIds = strList(r.companyIds);
      if (companyIds.length === 0) return { ok: false, problem: `${action}_missing_company_ids` };
      return { ok: true, action: { action, companyIds } as ApprovedSourceNextAction };
    }

    case "enrich_contacts": {
      const personIds = strList(r.personIds);
      if (personIds.length === 0) return { ok: false, problem: "enrich_contacts_missing_person_ids" };
      return { ok: true, action: { action: "enrich_contacts", personIds } };
    }

    default:
      return { ok: false, problem: `unknown_action:${action.slice(0, 40)}` };
  }
}

type BroadeningParse = { ok: true; value: SafeBroadeningAction } | { ok: false; problem: string };

/** A rung is rebuilt from its own declared fields — nothing else survives. */
function parseBroadening(raw: unknown): BroadeningParse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, problem: "broadening_not_an_object" };
  }
  const b = raw as Record<string, unknown>;
  const action = String(b.action ?? "");
  if (!(SAFE_BROADENING_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, problem: `unknown_broadening:${action.slice(0, 40)}` };
  }
  switch (action) {
    case "add_approved_role_aliases": {
      const aliases = strList(b.aliases);
      if (aliases.length === 0) return { ok: false, problem: "broadening_missing_aliases" };
      return { ok: true, value: { action: "add_approved_role_aliases", aliases } };
    }
    case "use_equivalent_query_wording": {
      const wording = str(b.wording, FEEDBACK_BOUNDS.maxIdChars);
      if (!wording) return { ok: false, problem: "broadening_missing_wording" };
      return { ok: true, value: { action: "use_equivalent_query_wording", wording } };
    }
    case "include_supported_remote_variants": {
      const remotePolicy = str(b.remotePolicy, FEEDBACK_BOUNDS.maxIdChars);
      if (!remotePolicy) return { ok: false, problem: "broadening_missing_remote_policy" };
      return { ok: true, value: { action: "include_supported_remote_variants", remotePolicy } };
    }
    case "extend_recency_window": {
      const days = num(b.postingWindowDays);
      if (days == null || days <= 0) return { ok: false, problem: "broadening_invalid_window" };
      return { ok: true, value: { action: "extend_recency_window", postingWindowDays: days } };
    }
    case "increase_result_target": {
      const target = num(b.candidateTarget);
      if (target == null || target <= 0) return { ok: false, problem: "broadening_invalid_target" };
      return { ok: true, value: { action: "increase_result_target", candidateTarget: target } };
    }
    case "activate_broader_approved_source":
    case "activate_fallback_source": {
      const capability = str(b.capability, FEEDBACK_BOUNDS.maxIdChars);
      if (!capability) return { ok: false, problem: "broadening_missing_capability" };
      return { ok: true, value: { action, capability } as SafeBroadeningAction };
    }
    default:
      return { ok: false, problem: `unknown_broadening:${action.slice(0, 40)}` };
  }
}

// -------------------------------------------------- provider-artifact scan ---

/**
 * Keys and value shapes that only ever appear in PROVIDER territory.
 *
 * A recommendation that carries any of them is rejected whole rather than cleaned:
 * the model was told it cannot reach a provider, so a response shaped like one is
 * evidence the response should not be trusted at all.
 */
const PROVIDER_KEY_RE =
  /^(actor|actor_?id|actor_?key|apify.*|input|run_?input|run_?id|dataset_?id|token|api_?key|endpoint|url|headers|command|cmd|shell|exec|script)$/i;

const PROVIDER_VALUE_RES: RegExp[] = [
  /\bapify(_api)?[_/~-]/i,
  /^[a-z0-9_-]+~[a-z0-9_-]+$/i,          // apify actor id form: user~actor
  /https?:\/\//i,
  /\b(?:curl|wget|bash|sh\s+-c|rm\s+-rf|npx|deno\s+run)\b/i,
];

/** Walk the whole recommendation, keys and primitives alike. */
export function containsProviderArtifact(value: unknown, depth = 0): string | null {
  if (depth > 6) return "recommendation_too_deep";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    for (const re of PROVIDER_VALUE_RES) if (re.test(value)) return `provider_value:${re.source.slice(0, 24)}`;
    return null;
  }
  if (typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const v of value) { const hit = containsProviderArtifact(v, depth + 1); if (hit) return hit; }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (PROVIDER_KEY_RE.test(k)) return `provider_key:${k.slice(0, 32)}`;
    const hit = containsProviderArtifact(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

// ----------------------------------------------------------- the validator --

export interface FeedbackValidationInput {
  taskId: string;
  plan: OrderedHiringSourcePlan;
  state: SourceExecutionState;
  observation: SourceStepObservation;
  available: AvailableBoundedAction[];
  context: FeedbackProjectionContext;
  response: ClaudeSourceFeedbackResponse;
}

export type FeedbackValidation =
  | { ok: true; action: ApprovedSourceNextAction; reasonCodes: [] }
  | { ok: false; reasonCodes: string[] };

/**
 * Decide whether a recommendation may be executed.
 *
 * Every rejection is a CODE, and the codes are cumulative for one action — a
 * recommendation that both names a finished step and exceeds the budget reports
 * both, because "why was this rejected" is a debugging question and one reason is
 * rarely the whole story.
 */
export async function validateFeedbackRecommendation(
  input: FeedbackValidationInput,
): Promise<FeedbackValidation> {
  const { plan, state, observation, response, context } = input;
  const codes: string[] = [];
  const rec = response.recommendation;

  // 21. The model's own assertion that it changed nothing. Checked again here so a
  // caller that skipped the parser still cannot execute without it.
  if (response.constraintsPreserved !== true) codes.push("constraints_preserved_not_true");

  // 22. No provider-specific object anywhere in the recommendation.
  const artifact = containsProviderArtifact(rec);
  if (artifact) codes.push(`provider_artifact:${artifact}`);

  // An instruction smuggled into any free-text field.
  const injection = detectInjection(canonicalJson(rec) + " " + response.conciseReason);
  if (injection) codes.push(`injection:${injection}`);

  // 18. Quota is the completion authority and is not the model's to reopen.
  if (observation.totalContactReady >= plan.completionCondition.target && rec.action !== "stop_quota_reached") {
    codes.push("quota_already_reached");
  }

  // 2. The action must be one the projection actually offered.
  const offered = input.available.find((a) => a.action === rec.action);
  if (!offered && rec.action !== "stop_quota_reached") codes.push(`action_not_available:${rec.action}`);

  // 15/16. Ceilings, for every action that would spend.
  const spends = rec.action === "broaden_current_source" || rec.action === "advance_to_next_source"
    || rec.action === "verify_selected_jobs" || rec.action === "enrich_company_identity"
    || rec.action === "enrich_contacts";
  if (spends) {
    if (observation.remainingBudgetUsd <= 0 || state.cumulative_cost >= plan.maximumEstimatedCostUsd) {
      codes.push("budget_exhausted");
    }
    if (state.provider_calls >= plan.maximumProviderCalls) codes.push("provider_call_limit_reached");
  }

  switch (rec.action) {
    case "stop_quota_reached": {
      if (observation.totalContactReady < plan.completionCondition.target) codes.push("quota_not_reached");
      break;
    }

    case "stop_valid_exhaustion": {
      // Stopping while real options remain throws away a request the user made.
      const realOptions = input.available.filter((a) => a.action !== "stop_valid_exhaustion");
      if (realOptions.length > 0) codes.push("exhaustion_claimed_with_options_remaining");
      break;
    }

    case "broaden_current_source": {
      // 3/5. The step must exist, be the current one, and not be finished.
      const step = plan.steps.find((s) => s.stepId === rec.stepId);
      if (!step) { codes.push(`unknown_step:${rec.stepId}`); break; }
      if (rec.stepId !== observation.stepId) codes.push("broadening_targets_another_step");
      const record = stepOf(state, rec.stepId);
      if (record && isStepFinished(record)) codes.push(`step_finished:${record.status}`);
      if (observation.sourceExhausted) codes.push("step_exhausted");

      // 6. The rung must belong to THIS step's approved ladder.
      if (!isSafeBroadeningAction(rec.broadeningAction)) { codes.push("broadening_not_approved"); break; }
      const ladder = step.broadeningLadder ?? [];
      const rung = ladder.find((b) => b.action === rec.broadeningAction.action);
      if (!rung) { codes.push(`broadening_not_in_ladder:${rec.broadeningAction.action}`); break; }

      // 7/17. Already spent, or beyond the attempt ceiling.
      if ((observation.broadeningActionsUsed ?? []).includes(rec.broadeningAction.action)) {
        codes.push(`broadening_already_used:${rec.broadeningAction.action}`);
      }
      if ((record?.broadening_used ?? []).includes(rec.broadeningAction.action)) {
        codes.push(`broadening_already_used:${rec.broadeningAction.action}`);
      }
      if (observation.attempt >= plan.maximumBroadeningAttempts) codes.push("broadening_attempt_limit_reached");

      // 8. A rung may make the same question easier; it may not change the question.
      codes.push(...weakensHardConstraint(plan, step.stepId, rec.broadeningAction));

      // 9. The compiled provider input must actually DIFFER from one already sent.
      if (codes.length === 0) {
        const prepared = await prepareStepCall({
          taskId: input.taskId, step, state,
          broadening: rec.broadeningAction as BroadeningIntentChange,
        });
        if (!prepared.ok && prepared.status === "duplicate_input") codes.push("identical_provider_input");
        else if (!prepared.ok) codes.push(`uncompilable:${prepared.status}`);
      }
      break;
    }

    case "advance_to_next_source": {
      // 3. Both ends must exist, and the near end must be the step we just ran.
      const current = plan.steps.find((s) => s.stepId === rec.currentStepId);
      const next = plan.steps.find((s) => s.stepId === rec.nextStepId);
      if (!current) { codes.push(`unknown_step:${rec.currentStepId}`); break; }
      if (!next) { codes.push(`unknown_step:${rec.nextStepId}`); break; }
      if (rec.currentStepId !== observation.stepId) codes.push("advance_from_another_step");

      // 4/34. The validated successor, or the next step in plan order that is not
      // already finished. Anything else is a jump to an arbitrary source.
      const successor = current.nextStepId;
      const nextUnfinished = plan.steps
        .filter((s) => s.order > current.order)
        .sort((a, b) => a.order - b.order)
        .find((s) => { const r = stepOf(state, s.stepId); return !r || !isStepFinished(r); });
      const permitted = rec.nextStepId === successor || rec.nextStepId === nextUnfinished?.stepId;
      if (!permitted) codes.push(`step_not_permitted_successor:${rec.nextStepId}`);

      // 19/20. Forward only, and never back onto finished work.
      if (next.order <= current.order) codes.push("cyclic_source_transition");
      const nextRecord = stepOf(state, rec.nextStepId);
      if (nextRecord && isStepFinished(nextRecord)) codes.push(`step_finished:${nextRecord.status}`);
      if (state.completed_step_ids.includes(rec.nextStepId) || state.exhausted_step_ids.includes(rec.nextStepId)) {
        codes.push("repeats_completed_work");
      }
      break;
    }

    case "verify_selected_jobs": {
      // 10. Verification without an ATS identity is a paid call that cannot succeed.
      if (context.atsIdentitiesAvailable <= 0) codes.push("ats_identity_missing");
      const verificationStep = plan.steps.find((s) => s.role === "verification");
      if (!verificationStep) { codes.push("no_verification_step_in_plan"); break; }
      const record = stepOf(state, verificationStep.stepId);
      if (record && isStepFinished(record)) codes.push(`step_finished:${record.status}`);
      // 11. Every referenced company must exist in canonical task state.
      codes.push(...unknownIds(rec.companyIds, context.knownCompanyIds, "unknown_company"));
      // The subset that actually needs verifying, so a broad list cannot smuggle in
      // companies nobody asked about.
      codes.push(...notInScope(rec.companyIds, context.companiesForVerification, "company_not_pending_verification"));
      break;
    }

    case "enrich_company_identity": {
      codes.push(...unknownIds(rec.companyIds, context.knownCompanyIds, "unknown_company"));
      // 13. Enrichment must be NEEDED. Re-enriching a resolved company is spend
      // with no possible outcome.
      codes.push(...notInScope(rec.companyIds, context.companiesNeedingIdentity, "company_identity_not_needed"));
      break;
    }

    case "enrich_contacts": {
      // 12/14. Existing people, and only the ones actually missing a contact method.
      codes.push(...unknownIds(rec.personIds, context.knownPersonIds, "unknown_person"));
      codes.push(...notInScope(rec.personIds, context.peopleNeedingContact, "contact_enrichment_not_needed"));
      break;
    }
  }

  if (codes.length > 0) return { ok: false, reasonCodes: [...new Set(codes)] };
  return { ok: true, action: rec, reasonCodes: [] };
}

// ---------------------------------------------------------------- helpers ---

/**
 * Hard constraints a rung would move.
 *
 * The union already makes most of these inexpressible; what remains expressible is
 * an alias outside the approved role-family registry, and a target or window beyond
 * what the plan itself sanctioned. Those are checked here.
 */
function weakensHardConstraint(
  plan: OrderedHiringSourcePlan,
  stepId: string,
  b: SafeBroadeningAction,
): string[] {
  const codes: string[] = [];
  const step = plan.steps.find((s) => s.stepId === stepId);
  const ladderRung = (step?.broadeningLadder ?? []).find((x) => x.action === b.action);

  if (b.action === "add_approved_role_aliases") {
    // The approved registry for this mission: the ladder's own sanctioned aliases,
    // the mission profile's approved aliases, and the step's semantic intent.
    const approved = new Set<string>([
      ...(ladderRung?.action === "add_approved_role_aliases" ? ladderRung.aliases : []),
      ...(plan.missionProfile.hiring?.approvedAliases ?? []),
      ...(step?.semanticIntent.approvedTitleAliases ?? []),
      ...(plan.missionProfile.hiring?.roleFamily ? [plan.missionProfile.hiring.roleFamily] : []),
    ].map((s) => s.toLowerCase()));
    for (const alias of b.aliases) {
      if (!approved.has(alias.toLowerCase())) codes.push(`unknown_role_alias:${alias.slice(0, 40)}`);
    }
  }

  if (b.action === "increase_result_target" && ladderRung?.action === "increase_result_target") {
    if (b.candidateTarget > ladderRung.candidateTarget) codes.push("result_target_above_approved");
  }
  if (b.action === "extend_recency_window" && ladderRung?.action === "extend_recency_window") {
    if (b.postingWindowDays > ladderRung.postingWindowDays) codes.push("recency_window_above_approved");
  }
  // A rung that activates another capability must name one the plan already holds.
  if (b.action === "activate_broader_approved_source" || b.action === "activate_fallback_source") {
    if (!plan.steps.some((s) => s.capability === b.capability)) {
      codes.push(`capability_not_in_plan:${b.capability}`);
    }
  }
  return codes;
}

function unknownIds(ids: string[], known: string[], code: string): string[] {
  const set = new Set(known);
  return ids.filter((id) => !set.has(id)).map((id) => `${code}:${id.slice(0, 40)}`);
}

function notInScope(ids: string[], scope: string[], code: string): string[] {
  const set = new Set(scope);
  return ids.filter((id) => !set.has(id)).map((id) => `${code}:${id.slice(0, 40)}`);
}

function str(v: unknown, max: number): string {
  const s = String(v ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const s = str(raw, FEEDBACK_BOUNDS.maxIdChars);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= FEEDBACK_BOUNDS.maxListItems) break;
  }
  return out;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}
