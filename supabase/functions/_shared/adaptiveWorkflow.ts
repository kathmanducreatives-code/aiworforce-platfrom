// Adaptive workflow engine — shared primitives so every Agentory workflow acts
// like a smart operator, not a rigid automation. Pure / import-free (Deno + Node
// testable). The headline rule: NEVER mark a plan "complete" just because the
// last step ran — status is derived from whether success criteria were met.

export type WorkflowType =
  | "lead_sourcing"
  | "linkedin_signal_discovery"
  | "competitor_tracking"
  | "company_research"
  | "website_enrichment"
  | "lead_ranking"
  | "outreach_drafting"
  | "content_creation"
  | "comment_drafting"
  | "report_generation"
  | "onboarding"
  | "post_lead_action";

export type WorkflowStatus = "planning" | "running" | "complete" | "partial" | "failed" | "blocked";

export interface WorkflowAttempt {
  n: number;
  strategy: string;       // what was tried this attempt
  produced: number;       // usable outputs from this attempt
  note?: string;
}

export interface StatusSignals {
  workflow_type: WorkflowType;
  requested?: number;          // requested count (sourcing/ranking/drafting)
  produced?: number;           // usable outputs produced overall
  tool_failed?: boolean;       // required tool auth/config/credits failed
  has_required_context?: boolean; // required context present (default true)
  needs_user_input?: boolean;  // workflow can't proceed without the user
  needs_confirmation?: boolean; // paid/expensive action awaiting confirm
  awaiting_approval?: boolean;  // draft created, awaiting approval (drafting = done)
}

export interface StatusResult {
  status: WorkflowStatus;
  reason: string;
}

// Workflows that are count-driven (a target N matters for complete vs partial).
const COUNT_DRIVEN: ReadonlySet<WorkflowType> = new Set<WorkflowType>([
  "lead_sourcing", "linkedin_signal_discovery", "competitor_tracking",
  "website_enrichment", "lead_ranking", "outreach_drafting", "comment_drafting",
]);

/**
 * Derive an honest workflow status. Order of precedence:
 *   blocked (needs input/confirmation) > failed (tool/context/zero) >
 *   complete (criteria met) > partial (some output, short of target).
 */
export function evaluateWorkflowStatus(s: StatusSignals): StatusResult {
  const requested = Math.max(0, Math.floor(s.requested ?? 0));
  const produced = Math.max(0, Math.floor(s.produced ?? 0));
  const hasContext = s.has_required_context !== false;

  // 1) Blocked — needs the user before anything useful can happen.
  if (s.needs_confirmation) return { status: "blocked", reason: "awaiting confirmation for a paid/expensive action" };
  if (s.needs_user_input && produced === 0) return { status: "blocked", reason: "needs more context/input from the user" };

  // 2) Failed — required tool down, required context missing, or zero output.
  if (s.tool_failed && produced === 0) return { status: "failed", reason: "required tool auth/config/credits failed" };
  if (!hasContext && produced === 0) return { status: "failed", reason: "required context unavailable" };

  // 3) Drafting/content: a created draft awaiting approval is COMPLETE for the
  //    drafting workflow (sending is a separate, approval-gated step).
  if (s.workflow_type === "outreach_drafting" || s.workflow_type === "comment_drafting" || s.workflow_type === "content_creation" || s.workflow_type === "report_generation") {
    if (produced > 0) {
      // Short of requested count of drafts → partial.
      if (requested > 0 && produced < requested) return { status: "partial", reason: `${produced}/${requested} drafts created (approval-gated, nothing sent)` };
      return { status: "complete", reason: s.awaiting_approval ? "drafts created — awaiting approval, nothing sent" : "output created" };
    }
    return { status: "failed", reason: "no draft/content could be produced" };
  }

  // 4) Onboarding / company_research: presence-based.
  if (s.workflow_type === "onboarding" || s.workflow_type === "company_research") {
    if (s.needs_user_input) return { status: "blocked", reason: "needs user input to continue" };
    return produced > 0 || hasContext ? { status: "complete", reason: "context captured" } : { status: "partial", reason: "incomplete — some fields still missing" };
  }

  // 5) Count-driven workflows (sourcing/enrichment/ranking/signals).
  if (produced === 0) return { status: "failed", reason: "no usable results produced" };
  if (COUNT_DRIVEN.has(s.workflow_type)) {
    if (requested > 0 && produced < requested) return { status: "partial", reason: `${produced}/${requested} produced` };
    return { status: "complete", reason: requested > 0 ? `${produced}/${requested} produced` : `${produced} produced` };
  }

  // 6) Fallback: any output → complete.
  return { status: "complete", reason: `${produced} produced` };
}

/** Render an attempt log (chat/panel) like: "Attempt 2: broadened roles — 3 found". */
export function summarizeAttempts(attempts: WorkflowAttempt[]): string {
  if (!attempts || attempts.length === 0) return "";
  return attempts
    .map((a) => `Attempt ${a.n}: ${a.strategy} — ${a.produced} found${a.note ? ` (${a.note})` : ""}`)
    .join("\n");
}

/** True when an adaptive workflow should keep retrying (under caps). */
export function shouldRetry(opts: { attempt: number; maxAttempts: number; produced: number; requested: number; toolFailed?: boolean }): boolean {
  if (opts.toolFailed) return false;            // tool auth/config failure — don't hammer
  if (opts.attempt >= opts.maxAttempts) return false;
  if (opts.requested > 0 && opts.produced >= opts.requested) return false;
  return true;                                   // short of target, attempts left
}

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_COUNT = 5;
