// Pure planning + message mapping for the canonical Lead Library detail actions.
//
// WHY THIS EXISTS
//   The Lead Library detail drawer rendered "Run Find decision-makers" as dead
//   text — there was no wired control, so a click created no run-agent request,
//   no task, no provider call (proven in production). This module produces the
//   exact `runLeadAction` arguments from the CANONICAL actionable lead id, and
//   maps a result to a distinguished user message. It calls nothing itself, so
//   it is unit-testable without React, Supabase or a provider.
//
//   It never substitutes the account id, company name, an array index, or a
//   stale Workbench selection for the lead_candidate id.

import type { LeadActionKind, BuildLeadActionArgs } from "@/lib/leadActionRequest";
import { ERROR_COPY, PRE_EXECUTION_CODES } from "@/lib/leadActionOutcome";
import type { LeadActionResult } from "@/lib/leadActions";
import type { LeadRow } from "./types";

/** The two actions this drawer wires. Generate outreach is intentionally omitted. */
export type LeadDetailActionKind = Extract<LeadActionKind, "research_company" | "find_decision_makers">;

export type LeadActionGateReason =
  | "no_session"
  | "no_workspace"
  | "workspace_mismatch"
  | "no_actionable_lead";

export type LeadActionPlan =
  | { ok: true; args: BuildLeadActionArgs }
  | { ok: false; reason: LeadActionGateReason; message: string };

export interface PlanLeadActionInput {
  lead: LeadRow;
  /** The ACTIVE workspace from context — never trusted from the row alone. */
  activeWorkspaceId: string | null;
  hasSession: boolean;
}

/**
 * Build the runLeadAction args for a canonical lead detail action, or a typed
 * gate reason. The lead_candidate id ALWAYS comes from
 * `lead.canonical.leadRows.selectedLeadCandidateId`.
 */
export function planLeadDetailAction(input: PlanLeadActionInput, kind: LeadDetailActionKind): LeadActionPlan {
  const { lead, activeWorkspaceId, hasSession } = input;

  if (!hasSession) return { ok: false, reason: "no_session", message: "Your session has expired. Sign in again." };
  if (!activeWorkspaceId) return { ok: false, reason: "no_workspace", message: ERROR_COPY.no_workspace };

  const canonical = lead.canonical;
  // Multi-tenant: the active workspace must own this lead row.
  const leadWorkspaceId = canonical?.identity.workspaceId ?? lead.workspaceId;
  if (leadWorkspaceId !== activeWorkspaceId) {
    return { ok: false, reason: "workspace_mismatch", message: "This lead belongs to a different workspace." };
  }

  const selectedLeadCandidateId = canonical?.leadRows.selectedLeadCandidateId ?? null;
  const accountId = canonical?.identity.accountId ?? null;
  // Never fall back to the account id or company name as the action id.
  if (!selectedLeadCandidateId || !accountId) {
    return { ok: false, reason: "no_actionable_lead", message: "No actionable lead record is available for this account." };
  }

  // plan_id is optional trace linkage. Use the REPRESENTATIVE row's own plan
  // (selectedPlanId) so a lead action can never pair lead A with plan B's id —
  // never an arbitrary planIds[0].
  const planId = canonical?.leadRows.selectedPlanId ?? undefined;

  return {
    ok: true,
    args: {
      leadAction: kind,
      leadCandidateIds: [selectedLeadCandidateId],
      workspaceId: activeWorkspaceId,
      ...(planId ? { planId } : {}),
    },
  };
}

// --------------------------------------------------------- single-flight -------

export interface LeadActionControllerDeps {
  runLeadAction: (args: BuildLeadActionArgs) => Promise<LeadActionResult>;
  onSuccess: (kind: LeadDetailActionKind, result: LeadActionResult) => void | Promise<void>;
  onBlocked: (message: string) => void;
  onError: (message: string) => void;
  /** Notifies the UI which action is running (or null when idle). */
  onStateChange?: (running: LeadDetailActionKind | null) => void;
}

/**
 * A synchronous single-flight runner. The in-flight flag is a plain closure
 * variable (not React state), so two clicks in the SAME tick — before any
 * re-render — cannot both start an invocation. Framework-agnostic and
 * deterministically testable without a DOM.
 */
export function createLeadActionController(deps: LeadActionControllerDeps) {
  let inFlight: LeadDetailActionKind | null = null;

  return {
    isRunning: (): LeadDetailActionKind | null => inFlight,
    /** Run a pre-computed plan for `kind`. A second call while in-flight is ignored. */
    run: async (plan: LeadActionPlan, kind: LeadDetailActionKind): Promise<void> => {
      if (inFlight) return; // synchronous guard — one gesture, one request
      if (plan.ok !== true) { deps.onError(plan.message); return; }
      inFlight = kind;
      deps.onStateChange?.(kind);
      try {
        const result = await deps.runLeadAction(plan.args);
        const m = leadActionResultMessage(result);
        if (m.tone === "success") await deps.onSuccess(kind, result);
        else if (m.tone === "blocked") deps.onBlocked(m.message);
        else deps.onError(m.message);
      } catch {
        deps.onError("The action did not reach the server. No provider ran — try again.");
      } finally {
        inFlight = null;
        deps.onStateChange?.(null);
      }
    },
  };
}

export type ActionMessageTone = "success" | "blocked" | "error";

/**
 * Map a runLeadAction result to a distinguished, user-facing message.
 *
 * A pre-execution/request failure is the ONLY case where "no provider ran" is
 * asserted — the response proves execution never began. Post-execution failures
 * make no such claim.
 */
export function leadActionResultMessage(result: LeadActionResult): { tone: ActionMessageTone; message: string } {
  if (result.success) return { tone: "success", message: "Done." };

  const code = result.error ?? "run_agent_failed";

  if (code === "unidentified_user" || code === "unauthorized") {
    return { tone: "error", message: "Your session has expired. Sign in again." };
  }
  if (code === "no_workspace") return { tone: "error", message: ERROR_COPY.no_workspace };
  if (code === "lead_not_in_workspace") return { tone: "error", message: ERROR_COPY.lead_not_in_workspace };

  // Rejected before any lead was processed → the request did not reach execution.
  if (result.requestError === true || PRE_EXECUTION_CODES.has(code)) {
    return { tone: "error", message: result.message ?? "The action did not reach the server. No provider ran — try again." };
  }

  // A business block (e.g. research not done first) is distinct from a failure.
  if (result.status === "blocked" || code.startsWith("blocked")) {
    return { tone: "blocked", message: result.message ?? "This action is blocked — complete the required previous step first." };
  }

  // Post-execution failure (provider/validation): report it WITHOUT claiming the
  // provider did or did not run.
  return { tone: "error", message: result.message ?? ERROR_COPY[code] ?? "The action failed. You can try again." };
}

/** Research button label — never hides a previous success. */
export function researchActionLabel(status: string | null | undefined): string {
  if (status === "previous_success_retry_failed") return "Retry research";
  if (status === "ready") return "Refresh research";
  return "Research company";
}

/** Decision-maker button label — reflects whether a recipient already exists. */
export function decisionMakerActionLabel(hasSelectedRecipient: boolean): string {
  return hasSelectedRecipient ? "Find more decision-makers" : "Find decision-makers";
}
