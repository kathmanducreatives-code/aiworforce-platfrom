// ONE PLANNER INTERFACE. GPT AND CLAUDE ARE ADAPTERS BEHIND IT.
//
// WHAT THIS REPLACES.
//
// `run-agent/index.ts` held two independent planner call sites:
//
//     const gptStrategy = (useLeadStrategyOwner && !persistedPlan)
//       ? await applyLeadStrategyInitialPlanning({ ... })   // line ~1339
//       : null;
//     ...~1200 lines later...
//     const claudeFirst = persistedPlan
//       ? claudeFirstFromPersistedPlan(...)
//       : gptStrategy?.specRewritten ? null
//       : await applyClaudeFirstLeadPlanning({ ... });       // line ~2580
//
// The second call was conditioned on the FIRST CALL'S RESULT, not on whether the
// first call had happened. `specRewritten` is false whenever GPT fell back
// deterministically — a timeout, a schema-rejected plan, an escalation that also
// failed. All of those are ordinary outcomes, and each of them let Claude make a
// second model call and propose a second, different set of round-one titles for
// one task. Whichever ran last won, and nothing recorded that two had run.
//
// THE FIX IS SELECTION, NOT ORDERING.
//
// `selectLeadPlannerAdapter` decides which single adapter owns the task from
// ELIGIBILITY ALONE — flags, allow-lists, and whether a plan artifact already
// exists — before any adapter is invoked. Only the selected adapter is called.
// A failure inside it resolves to the deterministic ladder, exactly as each
// adapter already did on its own; it never falls through to the other model.
//
// That is the difference between "flags choose which subsystem exists" and
// "flags choose which adapter backs the one planner", and it is what makes
// invariant 5 provable: the selector is pure, so every flag combination can be
// enumerated in a test rather than reasoned about in prose.
//
// WHAT THIS IS NOT.
//
// Not a new planning abstraction. It holds no prompt, no schema, no model
// gateway, no validator and no fallback of its own — every one of those stays in
// the adapter that already owns it. This module is a selector plus a claim.
//
// PURE. No network, provider, model or database access; adapters are injected.

import type { LeadPlanningOwner, LeadOwnershipLedger } from "./leadOwnership.ts";

export const LEAD_PLANNER_INTERFACE_VERSION = "lead-planner-interface-v1" as const;

/**
 * Eligibility facts, all resolved WITHOUT calling a model.
 *
 * Every field is a pure read: `leadStrategyOwnerApplies` is a string comparison,
 * `isGptLeadStrategyEnabled` / `isClaudeFirstLeadPlanningEnabled` are flag +
 * allow-list lookups. Nothing here can spend money, which is what allows
 * selection to happen strictly before invocation.
 */
export interface LeadPlannerEligibility {
  /** A plan artifact already travelled with the request. Replay wins over planning. */
  hasPersistedPlan: boolean;
  /** workflow = qualified_lead_sourcing AND execution_mode = company_first. */
  strategyOwnerApplies: boolean;
  /** GPT_LEAD_STRATEGY flag AND workspace allow-list. */
  gptEnabled: boolean;
  /** CLAUDE_FIRST_LEAD_PLANNING flag AND workspace allow-list. */
  claudeEnabled: boolean;
}

export interface LeadPlannerSelection {
  owner: LeadPlanningOwner;
  reason: string;
  /**
   * Adapters that were eligible but not selected. Non-empty only when flags
   * genuinely overlap — the misconfiguration this consolidation removes. Recorded
   * so an operator can see it and fix the flags; it never changes what runs.
   */
  notSelected: Array<{ owner: LeadPlanningOwner; reason: string }>;
}

/**
 * Choose the ONE adapter that owns initial lead strategy for this task.
 *
 * PRECEDENCE, and why each step is where it is:
 *
 *   1. persisted plan artifact — the question was already answered upstream and
 *      the answer is on screen. Re-planning here would be a second paid call for
 *      a decided question, and could decide it differently, so the plan the user
 *      approved and the plan executing would diverge. This precedence is not new;
 *      it is what both call sites already did.
 *
 *   2. GPT — but only on the gated path (`strategyOwnerApplies`). That gate is
 *      the existing, deliberate scope of the strategy owner: qualified lead
 *      sourcing, company-first. Off that path GPT was never the owner and is not
 *      made one here.
 *
 *   3. Claude — the intelligence-kernel adapter, for workspaces allow-listed
 *      into it.
 *
 *   4. deterministic — no model call. Always reachable, never fails.
 *
 * GPT precedes Claude because the GPT owner carries the narrower, explicitly
 * gated scope: it only claims tasks that are already qualified-lead-sourcing +
 * company-first, whereas the Claude adapter is workspace-scoped and would
 * otherwise swallow that narrower gate. When both are eligible the loser is
 * reported in `notSelected` rather than silently dropped.
 */
export function selectLeadPlannerAdapter(e: LeadPlannerEligibility): LeadPlannerSelection {
  const notSelected: Array<{ owner: LeadPlanningOwner; reason: string }> = [];
  const gptEligible = e.strategyOwnerApplies && e.gptEnabled;

  if (e.hasPersistedPlan) {
    if (gptEligible) {
      notSelected.push({ owner: "gpt_lead_strategy_v1", reason: "persisted_plan_artifact_wins" });
    }
    if (e.claudeEnabled) {
      notSelected.push({ owner: "claude_lead_planner_v1", reason: "persisted_plan_artifact_wins" });
    }
    return {
      owner: "persisted_plan_artifact_v1",
      reason: "a plan artifact travelled with the request; replay never re-plans",
      notSelected,
    };
  }

  if (gptEligible) {
    if (e.claudeEnabled) {
      notSelected.push({
        owner: "claude_lead_planner_v1",
        reason: "gpt_lead_strategy_owns_the_gated_path",
      });
    }
    return {
      owner: "gpt_lead_strategy_v1",
      reason: "GPT_LEAD_STRATEGY is enabled for this workspace on the gated path",
      notSelected,
    };
  }

  if (e.claudeEnabled) {
    if (e.gptEnabled && !e.strategyOwnerApplies) {
      notSelected.push({
        owner: "gpt_lead_strategy_v1",
        reason: "not_the_gated_path",
      });
    }
    return {
      owner: "claude_lead_planner_v1",
      reason: "CLAUDE_FIRST_LEAD_PLANNING is enabled for this workspace",
      notSelected,
    };
  }

  if (e.gptEnabled && !e.strategyOwnerApplies) {
    notSelected.push({ owner: "gpt_lead_strategy_v1", reason: "not_the_gated_path" });
  }
  return {
    owner: "deterministic_registry_v1",
    reason: "no planner adapter is enabled for this workspace; the deterministic ladder owns titles",
    notSelected,
  };
}

/**
 * The shape every adapter already returns, narrowed to what the runtime consumes.
 *
 * Both existing bridges return `{ spec, specRewritten, ... }` and both return the
 * untouched input spec with `specRewritten: false` when their own gate is closed,
 * so no adapter needed changing to sit behind this interface.
 */
export interface LeadPlannerOutcome<Spec, Extra = unknown> {
  spec: Spec;
  specRewritten: boolean;
  /** Adapter-specific detail, persisted as diagnostics. Never interpreted here. */
  detail: Extra;
}

export interface LeadPlannerResult<Spec, Extra = unknown> extends LeadPlannerOutcome<Spec, Extra> {
  owner: LeadPlanningOwner;
  selection: LeadPlannerSelection;
}

/**
 * Adapters, injected. Exactly one of these is awaited per task.
 *
 * A missing adapter for a selected owner is a wiring bug, not a runtime
 * condition, and resolves to the deterministic outcome with the reason recorded
 * — a planner that throws is worse than a planner that plans nothing.
 */
export interface LeadPlannerAdapters<Spec, Extra = unknown> {
  persisted?: () => LeadPlannerOutcome<Spec, Extra> | null;
  gpt?: () => Promise<LeadPlannerOutcome<Spec, Extra>>;
  claude?: () => Promise<LeadPlannerOutcome<Spec, Extra>>;
}

/**
 * Select one adapter, invoke only that one, and claim planning ownership.
 *
 * The ledger claim is what makes a second planner impossible rather than merely
 * unlikely: any other call site that later tries to claim planning for this task
 * throws `LeadOwnershipViolation`.
 */
export async function runLeadPlanner<Spec, Extra = unknown>(args: {
  eligibility: LeadPlannerEligibility;
  adapters: LeadPlannerAdapters<Spec, Extra>;
  /** Returned untouched when no adapter plans. */
  deterministicSpec: Spec;
  deterministicDetail: Extra;
  ledger?: LeadOwnershipLedger;
}): Promise<LeadPlannerResult<Spec, Extra>> {
  const selection = selectLeadPlannerAdapter(args.eligibility);

  // CLAIM BEFORE INVOKING. If the adapter throws, the task still records who was
  // supposed to own planning — a failed run with no owner recorded is exactly the
  // state that made the live-run postmortem require log spelunking.
  args.ledger?.claimPlanning(selection.owner, selection.reason);
  for (const n of selection.notSelected) args.ledger?.decline(n.owner, n.reason);

  let outcome: LeadPlannerOutcome<Spec, Extra> | null = null;
  switch (selection.owner) {
    case "persisted_plan_artifact_v1":
      outcome = args.adapters.persisted ? args.adapters.persisted() : null;
      break;
    case "gpt_lead_strategy_v1":
      outcome = args.adapters.gpt ? await args.adapters.gpt() : null;
      break;
    case "claude_lead_planner_v1":
      outcome = args.adapters.claude ? await args.adapters.claude() : null;
      break;
    case "deterministic_registry_v1":
      outcome = null;
      break;
  }

  if (outcome === null) {
    return {
      owner: selection.owner,
      selection,
      spec: args.deterministicSpec,
      specRewritten: false,
      detail: args.deterministicDetail,
    };
  }
  return { owner: selection.owner, selection, ...outcome };
}
