// NARROW CLAUDE ROUTE FOR QUALIFIED-LEAD SOURCING.
//
// ── ROUTING AUDIT (what exists today) ────────────────────────────────────────
// `providerRouting.ts` keeps four task types on the Gemini/default chain —
// `pilot_chat`, `orchestration_plan`, `tool_input_planning`, `helper` — via
// `PLANNER_TASK_TYPES`/`isPlannerTask`, whose stated purpose is to assert that
// planning never moves to Claude. Anthropic preference is granted only to the
// writing agents Scribe and Penn (`ANTHROPIC_WRITING_AGENTS`). A single env
// escape hatch, `resolveSourcePlannerProvider`, can pin the Actor Input Planner
// to Anthropic.
//
// This module does NOT change any of that. It adds one narrow, separately-gated
// route for two decisions — the qualified-lead sourcing STRATEGY and the bounded
// source-observation FEEDBACK — and leaves general chat, orchestration and helper
// routing exactly where they are. `isPlannerTask` is untouched, so the existing
// assertion that generic planning stays on Gemini still holds and still passes.
//
// Enablement composes the two EXISTING gates rather than adding a third:
// `isClaudeFirstLeadPlanningEnabled` (CLAUDE_FIRST_LEAD_PLANNING +
// CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES) and `isSourceFeedbackEnabled`
// (CLAUDE_SOURCE_FEEDBACK + CLAUDE_SOURCE_FEEDBACK_WORKSPACES). Both are OFF by
// default and this PR does not enable either.

import type { EnvReader } from "../intelligenceFlags.ts";
import { isClaudeFirstLeadPlanningEnabled } from "./leadPlanningBridge.ts";
import { isSourceFeedbackEnabled } from "../../sourceFeedbackRuntime.ts";

export const ADAPTIVE_ROUTE_VERSION = "lead-adaptive-route-1.0.0";

/** The only two decisions this route covers. */
export type AdaptiveLeadDecision = "sourcing_strategy" | "source_observation_feedback";

export type AdaptiveRouteReason =
  | "enabled"
  | "wrong_workflow"
  | "wrong_execution_mode"
  | "flag_off"
  | "no_workspace_allowlist"
  | "workspace_not_allowed"
  | "strategy_contract_unavailable";

export interface AdaptiveRouteDecision {
  /** True only when Claude should own this specific decision. */
  useClaude: boolean;
  reason: AdaptiveRouteReason;
  /** What the caller passes to aiProvider. `undefined` = leave routing alone. */
  provider: "anthropic" | undefined;
}

export interface AdaptiveRouteInput {
  workflow: string;
  executionMode: string;
  workspaceId: string;
  decision: AdaptiveLeadDecision;
  /** False when no validated strategy contract is available to hold output to. */
  strategyContractAvailable: boolean;
  read?: EnvReader;
}

const lower = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/**
 * Should Claude own this qualified-lead decision?
 *
 * Every condition must hold. The workflow and execution-mode checks come first so
 * an unrelated request can never consume a flag check, and the contract check
 * comes last because routing to a model whose output nothing can validate is the
 * failure mode that produced raw Actor IDs in a strategy once already.
 */
export function routeAdaptiveLeadDecision(input: AdaptiveRouteInput): AdaptiveRouteDecision {
  const off = (reason: AdaptiveRouteReason): AdaptiveRouteDecision =>
    ({ useClaude: false, reason, provider: undefined });

  if (lower(input.workflow) !== "qualified_lead_sourcing") return off("wrong_workflow");
  if (lower(input.executionMode) !== "company_first") return off("wrong_execution_mode");

  // Each decision answers to its own existing flag pair. Both gates already speak
  // the same reason vocabulary, so it is carried across verbatim — matching on
  // substrings would collapse "no_workspace_allowlist" and "workspace_not_allowed"
  // into one another, since each contains the other's distinguishing fragment.
  const enabled = input.decision === "sourcing_strategy"
    ? isClaudeFirstLeadPlanningEnabled(input.workspaceId, input.read)
    : isSourceFeedbackEnabled(input.workspaceId, input.read);

  if (!enabled.enabled) {
    switch (enabled.reason) {
      case "no_workspace_allowlist": return off("no_workspace_allowlist");
      case "workspace_not_allowed": return off("workspace_not_allowed");
      default: return off("flag_off");
    }
  }

  if (!input.strategyContractAvailable) return off("strategy_contract_unavailable");

  return { useClaude: true, reason: "enabled", provider: "anthropic" };
}

/**
 * Does this decision belong to the adaptive lead route at all?
 *
 * Exists so a caller can tell "not our concern, leave routing untouched" from
 * "ours, but currently disabled" without inspecting flags.
 */
export function isAdaptiveLeadDecision(workflow: string, executionMode: string): boolean {
  return lower(workflow) === "qualified_lead_sourcing" && lower(executionMode) === "company_first";
}
