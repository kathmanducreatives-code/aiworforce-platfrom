// ONE ANSWER TO "DOES THIS WORKSPACE GET THE NEW ARCHITECTURE?"
//
// WHAT WENT WRONG WITHOUT THIS.
//
// Five stages each read their own workspace allow-list, independently, and
// nothing compared them. On TEST the lists were not merely inconsistent, they
// were INVERTED: `SEMANTIC_COMPANY_CLASSIFICATION_WORKSPACES` held exactly
// "My Company" while all five Stage 1-4 lists held exactly the QA workspace.
//
// So My Company ran the one stage that spends model calls classifying
// companies, and none of the stages that make a classification mean anything —
// no compiled mission, no grounded evidence, no pool evaluation, no rounds.
// Task 44b82535 is what that combination produces: a real paid sourcing run
// with no way to qualify what it bought.
//
// THE INVARIANT THIS ENFORCES. A workspace is either in the new architecture or
// it is not. Being half-in is not a rollout state, it is a broken one, and it
// must fail CLOSED — refusing to spend — rather than proceeding on whichever
// half happens to be switched on.
//
// The individual flags survive deliberately. They are how a stage is rolled out
// and how one is switched off in an incident. What they can no longer do is
// silently compose into a combination nobody designed.
//
// PURE. No network, provider, model or database access.

import { isGroundedBrainEnabled } from "./groundedBrainBinding.ts";
import {
  isFullPoolEvaluationEnabled, isPoolRankingEnabled,
} from "./poolEvaluationBinding.ts";
import { isMultiRoundEnabled } from "./multiRoundBinding.ts";
import { isMissionCompilerEnabled } from "./leadMissionCompilerBinding.ts";

export const INTELLIGENCE_POLICY_VERSION = "lead-intelligence-policy-v1" as const;

export type EnvReader = (key: string) => string | undefined;

export type IntelligenceStage =
  | "mission_compiler"
  | "grounded_brain"
  | "full_pool_evaluation"
  | "pool_ranking"
  | "multi_round";

/**
 * The stages that must agree before a workspace may run PAID new-architecture
 * sourcing.
 *
 * `pool_ranking` is deliberately absent: it changes the ORDER of a delivered
 * pool, not whether anything can be qualified, and it has a shadow mode whose
 * whole purpose is to run while disabled-in-effect. Requiring it would make
 * shadow rollout impossible.
 */
export const REQUIRED_FOR_PAID_SOURCING: readonly IntelligenceStage[] = [
  "mission_compiler",
  "grounded_brain",
  "full_pool_evaluation",
  "multi_round",
];

export type IntelligenceMode =
  /** Every required stage is on. The new architecture runs. */
  | "new_architecture"
  /** No required stage is on. The deterministic path runs, as designed. */
  | "deterministic"
  /** Some on, some off. Unsupported — nothing paid may run. */
  | "inconsistent";

export interface LeadIntelligenceCapabilities {
  version: typeof INTELLIGENCE_POLICY_VERSION;
  workspace_id: string;
  mode: IntelligenceMode;
  stages: Record<IntelligenceStage, boolean>;
  /** Required stages that are OFF while others are ON. Empty unless inconsistent. */
  missing_required: IntelligenceStage[];
  /** Required stages that are ON. Used to explain an inconsistent mode. */
  present_required: IntelligenceStage[];
  /**
   * May a PAID new-architecture sourcing run start for this workspace?
   *
   * False for `inconsistent` — that is the whole point. A deterministic
   * workspace is still allowed to spend; it is governed by the mission
   * qualification contract instead, which is a different guard.
   */
  paid_new_architecture_allowed: boolean;
  /** True when the mission compiler is expected to have produced directives. */
  expects_compiled_mission: boolean;
  reason: string;
}

/**
 * Resolve the whole picture for one workspace, once.
 *
 * Every stage is read through its OWN existing binding rather than by
 * re-reading env here, so there is exactly one definition of what each flag
 * means and this module cannot drift away from the stage it describes.
 */
export function getLeadIntelligenceCapabilities(
  workspaceId: string, read?: EnvReader,
): LeadIntelligenceCapabilities {
  const stages: Record<IntelligenceStage, boolean> = {
    mission_compiler: isMissionCompilerEnabled(workspaceId, read).enabled,
    grounded_brain: isGroundedBrainEnabled(workspaceId, read).enabled,
    full_pool_evaluation: isFullPoolEvaluationEnabled(workspaceId, read).enabled,
    pool_ranking: isPoolRankingEnabled(workspaceId, read).enabled,
    multi_round: isMultiRoundEnabled(workspaceId, read).enabled,
  };

  const present = REQUIRED_FOR_PAID_SOURCING.filter((s) => stages[s]);
  const missing = REQUIRED_FOR_PAID_SOURCING.filter((s) => !stages[s]);

  let mode: IntelligenceMode;
  let reason: string;
  if (missing.length === 0) {
    mode = "new_architecture";
    reason = "every required intelligence stage is enabled";
  } else if (present.length === 0) {
    // Nothing new is on. The deterministic path is the INTENDED behaviour here,
    // not a degraded one, so this must not block.
    mode = "deterministic";
    reason = "no new-architecture stage is enabled; the deterministic path is intended";
  } else {
    mode = "inconsistent";
    reason =
      `unsupported partial architecture: ${present.join(", ")} enabled while ` +
      `${missing.join(", ")} disabled`;
  }

  return {
    version: INTELLIGENCE_POLICY_VERSION,
    workspace_id: workspaceId,
    mode,
    stages,
    missing_required: mode === "inconsistent" ? missing : [],
    present_required: present,
    paid_new_architecture_allowed: mode === "new_architecture",
    // THE PROVENANCE RULE. Only a workspace whose compiler is ON should be
    // holding a GPT-compiled mission; that is what makes "compilation failed"
    // distinguishable from "compilation was never meant to happen".
    // ── ALWAYS TRUE: COMPILATION IS NO LONGER OPTIONAL ────────────────────
    //
    // This mirrored `stages.mission_compiler`, i.e. the flag. That made the
    // paid-execution preflight's `mission_not_model_compiled` block dead on
    // every live run: the flag was unset, so the system did not "expect" a
    // compiled mission, so spending against a regex reading was permitted —
    // which is exactly what happened on 2026-08-17.
    //
    // `buildMissionCompilerBinding` now always offers GPT, so every mission is
    // expected to be model-compiled and a `deterministic_fallback` reaching a
    // paid boundary is a genuine fault. This is the second gate, independent of
    // pilot-chat's refusal: one covers where a mission is PRODUCED, this covers
    // where one is SPENT against.
    expects_compiled_mission: true,
    reason,
  };
}
