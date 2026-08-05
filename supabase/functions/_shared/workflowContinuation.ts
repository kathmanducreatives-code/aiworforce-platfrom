// CONTINUE A TERMINAL WORKFLOW — from the browser, as the signed-in user.
//
// TEST task 41342269 finished terminal (`round_limit_reached`, row `complete`),
// so `decideResume` correctly refuses it: a finished run is finished. But its
// paid memo23 dataset — 50 structured companies, 177 embedded roles — is still
// there, and everything downstream of discovery was never attempted.
//
// Re-running discovery to get at data we already own would be paying twice for
// the same question. A CONTINUATION creates a new task and plan, adopts the
// existing run id, and carries on from prequalification.
//
// THE SECURITY SHAPE MATTERS MORE THAN THE FEATURE.
//
// The browser sends only three ids and a reason. It does NOT send the workspace,
// the Apify run, the dataset, the mission or the capability state — every one of
// those is DERIVED server-side from records the caller has been proven to own.
// A request that could name its own dataset id would let any member of any
// workspace read any Apify dataset in the account.
//
// The caller is the USER, authenticated by their own Supabase JWT and checked
// against workspace membership by the same `decideWorkspaceAccess` every other
// path uses. No service-role token ever reaches the browser.
//
// PURE. No network, no provider, no database — the caller injects every read and
// write, which is what lets the whole decision be tested without a database and
// without a paid Actor.

import {
  lineageRootTaskId, readCheckpointCompanies, type CompanyResumeRecord,
} from "./leadResumeState.ts";

export const CONTINUATION_VERSION = "workflow-continuation-v1" as const;

/** The only reason currently supported. Kept closed on purpose. */
export const CONTINUATION_REASONS = ["resume_from_existing_company_dataset"] as const;
export type ContinuationReason = typeof CONTINUATION_REASONS[number];

/** Exactly what the browser is allowed to say. */
export interface ContinuationRequest {
  original_task_id: string;
  original_plan_id: string;
  conversation_id: string;
  continuation_reason: string;
}

export type ContinuationRefusal =
  | "invalid_request"
  | "unknown_continuation_reason"
  | "task_not_found"
  | "plan_not_found"
  | "task_plan_mismatch"
  | "conversation_workspace_mismatch"
  | "task_not_terminal"
  | "no_resumable_provider_run"
  | "already_continued";

export const REFUSAL_STATUS: Readonly<Record<ContinuationRefusal, number>> = Object.freeze({
  invalid_request: 400,
  unknown_continuation_reason: 400,
  task_not_found: 404,
  plan_not_found: 404,
  task_plan_mismatch: 409,
  conversation_workspace_mismatch: 403,
  task_not_terminal: 409,
  no_resumable_provider_run: 409,
  already_continued: 200,
});

export const REFUSAL_MESSAGE: Readonly<Record<ContinuationRefusal, string>> = Object.freeze({
  invalid_request: "A continuation needs the original task, plan and conversation ids.",
  unknown_continuation_reason: "That continuation reason is not supported.",
  task_not_found: "That task does not exist.",
  plan_not_found: "That plan does not exist.",
  task_plan_mismatch: "That task does not belong to that plan.",
  conversation_workspace_mismatch: "That conversation belongs to a different workspace.",
  task_not_terminal: "That workflow is still running — there is nothing to continue yet.",
  no_resumable_provider_run: "That run has no stored company dataset to continue from.",
  already_continued: "This workflow has already been continued.",
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseContinuationRequest(
  body: unknown,
): { ok: true; request: ContinuationRequest } | { ok: false; refusal: ContinuationRefusal } {
  if (!body || typeof body !== "object") return { ok: false, refusal: "invalid_request" };
  const b = body as Record<string, unknown>;
  const ids = ["original_task_id", "original_plan_id", "conversation_id"] as const;
  for (const k of ids) {
    if (typeof b[k] !== "string" || !UUID.test(b[k] as string)) {
      return { ok: false, refusal: "invalid_request" };
    }
  }
  const reason = String(b.continuation_reason ?? "");
  if (!CONTINUATION_REASONS.includes(reason as ContinuationReason)) {
    return { ok: false, refusal: "unknown_continuation_reason" };
  }
  return {
    ok: true,
    request: {
      original_task_id: b.original_task_id as string,
      original_plan_id: b.original_plan_id as string,
      conversation_id: b.conversation_id as string,
      continuation_reason: reason,
    },
  };
}

// ------------------------------------------------------- derived, not sent ----

/** A stored, already-paid provider run this continuation may adopt. */
export interface StoredProviderRun {
  run_id: string;
  dataset_id: string | null;
  provider: string;
  capability: string;
  started_at: string | null;
}

/** Only these providers may be adopted — a company DISCOVERY run, nothing else. */
export const RESUMABLE_DISCOVERY_PROVIDERS: ReadonlySet<string> = new Set([
  "apify_yc_companies_memo23",
  "apify_yc_companies_solidcode",
]);

/**
 * Find the discovery run to adopt, from the ORIGINAL task's own tool calls.
 *
 * Server-derived on purpose. A `run_id` supplied by the browser would be a
 * request to read an arbitrary Apify dataset from this account, which is a data
 * exfiltration primitive, not a feature.
 */
export function selectResumableRun(
  toolCalls: ReadonlyArray<{
    status?: string | null;
    input_json?: Record<string, unknown> | null;
    output_json?: Record<string, unknown> | null;
  }>,
): StoredProviderRun | null {
  for (const tc of toolCalls) {
    if (tc.status && tc.status !== "succeeded") continue;
    const out = tc.output_json ?? {};
    const inp = tc.input_json ?? {};
    const actorKey = String(
      (inp.selected_actor_key as string) ?? (inp.capability_key as string) ?? "");
    if (!RESUMABLE_DISCOVERY_PROVIDERS.has(actorKey)) continue;
    const runId = typeof out.run_id === "string" ? out.run_id : null;
    if (!runId) continue;
    const rows = Number(out.total ?? 0);
    if (!Number.isFinite(rows) || rows <= 0) continue;
    return {
      run_id: runId,
      dataset_id: typeof out.dataset_id === "string" ? out.dataset_id : null,
      provider: actorKey,
      capability: "startup_company_discovery",
      started_at: null,
    };
  }
  return null;
}

/** Terminal statuses a continuation is allowed to follow. */
const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set([
  "complete", "completed", "failed", "skipped", "done", "ready",
]);

export function taskIsTerminal(status: string | null | undefined): boolean {
  return TERMINAL_TASK_STATUSES.has(String(status ?? ""));
}

/**
 * The idempotency key.
 *
 * `workspace_id + original_task_id + continuation_reason`. Deliberately does NOT
 * include a timestamp or a nonce: two clicks a second apart must collide, which
 * is the entire point. A second continuation would start a second set of paid
 * identity searches for a dataset already being processed.
 */
export function continuationKey(
  workspaceId: string, originalTaskId: string, reason: string,
): string {
  return `${CONTINUATION_VERSION}:${workspaceId}:${originalTaskId}:${reason}`;
}

// --------------------------------------------------------------- decision ----

export interface ContinuationInputs {
  request: ContinuationRequest;
  task: {
    id: string; plan_id: string | null; workspace_id: string | null;
    status: string | null; result: Record<string, unknown> | null;
  } | null;
  plan: { id: string; workspace_id: string | null; user_id: string | null;
    steps: unknown; user_instruction: string | null } | null;
  conversation: { id: string; workspace_id: string | null; user_id?: string | null } | null;
  /**
   * Does this conversation demonstrably contain the ORIGINAL plan?
   *
   * `conversations.workspace_id` is NULL on 232 of 234 rows in TEST — the column
   * exists but this application never populates it, so requiring it to equal the
   * task's workspace refused every real conversation with a 403. That is exactly
   * what happened to the first "Continue verification" click.
   *
   * The caller proves linkage instead: the conversation must already carry a
   * message for the original plan. That is STRONGER than the column check it
   * replaces — it is positive evidence that this conversation is the one that
   * ran this workflow, rather than a field that happens to agree.
   */
  conversationCarriesOriginalPlan: boolean;
  toolCalls: ReadonlyArray<{
    status?: string | null;
    input_json?: Record<string, unknown> | null;
    output_json?: Record<string, unknown> | null;
  }>;
  /** An existing continuation for this key, if one was already created. */
  existing: { plan_id: string; task_id: string } | null;
}

export interface ContinuationPlanSpec {
  idempotency_key: string;
  workspace_id: string;
  user_id: string | null;
  conversation_id: string;
  /** Audit lineage, persisted on both the plan and the task. */
  lineage: {
    version: typeof CONTINUATION_VERSION;
    continuation_of_task_id: string;
    continuation_of_plan_id: string;
    parent_task_id: string;
    parent_plan_id: string;
    conversation_id: string;
    apify_run_id: string;
    apify_dataset_id: string | null;
    provider: string;
    original_user_query: string | null;
    continuation_reason: string;
  };
  /** The engine state that makes discovery ADOPT the run instead of starting it. */
  capability_execution_state: Record<string, unknown>;
  /**
   * Per-company stage state from the parent run's checkpoint.
   *
   * The capability state above stops discovery buying a SECOND Actor run. This
   * is the other half: it stops the per-company stages re-buying work the parent
   * already paid for. Empty when the parent wrote no checkpoint, which simply
   * means nothing is known to be done.
   */
  lead_resume_records: CompanyResumeRecord[];
  /** Stable across the whole chain — the operation keys are built from it. */
  lineage_root_task_id: string;
  steps: unknown;
  user_instruction: string | null;
}

export type ContinuationDecision =
  | { ok: true; created: false; existing: { plan_id: string; task_id: string } }
  | { ok: true; created: true; spec: ContinuationPlanSpec }
  | { ok: false; refusal: ContinuationRefusal };

/**
 * Decide whether this continuation may be created, and exactly what it contains.
 *
 * Every check is a REFUSAL rather than a silent adjustment, because the failure
 * modes here are a duplicate paid run or a cross-workspace read.
 */
export function decideContinuation(i: ContinuationInputs): ContinuationDecision {
  const { request: r } = i;
  if (!i.task) return { ok: false, refusal: "task_not_found" };
  if (!i.plan) return { ok: false, refusal: "plan_not_found" };
  if (i.task.plan_id !== i.plan.id || i.task.id !== r.original_task_id ||
      i.plan.id !== r.original_plan_id) {
    return { ok: false, refusal: "task_plan_mismatch" };
  }
  const workspaceId = i.task.workspace_id ?? i.plan.workspace_id;
  if (!workspaceId) return { ok: false, refusal: "task_not_found" };
  // THE CONVERSATION MUST BELONG TO THIS WORKFLOW.
  //
  // Without this a member of workspace A could graft a continuation onto a
  // conversation in workspace B. The original check compared
  // `conversations.workspace_id` — but that column is NULL on 232 of 234 rows in
  // TEST, so it refused every genuine conversation with a 403.
  //
  // Two ways to establish ownership, and at least one must hold:
  //   * the conversation DECLARES the same workspace (when the column is set), or
  //   * the conversation demonstrably CARRIES the original plan.
  // The second is stronger evidence than the first, because it proves this
  // conversation actually ran this workflow. A conversation that declares a
  // DIFFERENT workspace is refused outright, whatever else is true.
  if (!i.conversation || i.conversation.id !== r.conversation_id) {
    return { ok: false, refusal: "conversation_workspace_mismatch" };
  }
  const declaresOtherWorkspace = i.conversation.workspace_id != null &&
    i.conversation.workspace_id !== workspaceId;
  const declaresThisWorkspace = i.conversation.workspace_id === workspaceId;
  if (declaresOtherWorkspace || !(declaresThisWorkspace || i.conversationCarriesOriginalPlan)) {
    return { ok: false, refusal: "conversation_workspace_mismatch" };
  }
  if (!taskIsTerminal(i.task.status)) return { ok: false, refusal: "task_not_terminal" };

  // IDEMPOTENT: an existing continuation is RETURNED, never duplicated.
  if (i.existing) return { ok: true, created: false, existing: i.existing };

  const run = selectResumableRun(i.toolCalls);
  if (!run) return { ok: false, refusal: "no_resumable_provider_run" };

  const query = readOriginalQuery(i.task.result) ?? i.plan.user_instruction ?? null;

  return {
    ok: true,
    created: true,
    spec: {
      idempotency_key: continuationKey(workspaceId, r.original_task_id, r.continuation_reason),
      workspace_id: workspaceId,
      user_id: i.plan.user_id ?? null,
      conversation_id: r.conversation_id,
      lineage: {
        version: CONTINUATION_VERSION,
        continuation_of_task_id: r.original_task_id,
        continuation_of_plan_id: r.original_plan_id,
        parent_task_id: r.original_task_id,
        parent_plan_id: r.original_plan_id,
        conversation_id: r.conversation_id,
        apify_run_id: run.run_id,
        apify_dataset_id: run.dataset_id,
        provider: run.provider,
        original_user_query: query,
        continuation_reason: r.continuation_reason,
      },
      capability_execution_state: buildResumeState(run),
      lead_resume_records: readCheckpointCompanies(i.task.result),
      lineage_root_task_id: lineageRootTaskId(i.task.id, i.task.result),
      steps: i.plan.steps,
      user_instruction: i.plan.user_instruction,
    },
  };
}

function readOriginalQuery(result: Record<string, unknown> | null): string | null {
  if (!result) return null;
  const direct = result.original_user_query;
  if (typeof direct === "string" && direct.trim()) return direct;
  const mission = result.lead_mission as { original_user_query?: unknown } | undefined;
  const q = mission?.original_user_query;
  return typeof q === "string" && q.trim() ? q : null;
}

/**
 * The capability state that makes discovery adopt the existing run.
 *
 * `completed_capabilities` is EMPTY so discovery still executes — the engine
 * skips a completed capability entirely and rebuilds its working set in memory
 * each invocation, so marking discovery done would leave the continuation with
 * zero companies. `pending_runs` is what turns the call into a GET.
 */
export function buildResumeState(run: StoredProviderRun): Record<string, unknown> {
  return {
    version: "capability-execution-state-v1",
    mission_hash: "continuation",
    entry_capability: "startup_company_discovery",
    completed_capabilities: [],
    current_capability: null,
    pending_capabilities: [],
    provider_attempts: [],
    accumulated_cost_units: 0,
    company_keys: [],
    qualified_company_keys: [],
    unknown_company_keys: [],
    contact_identities: [],
    terminal_reason: null,
    fallback_reason: null,
    pending_runs: [{
      capability: run.capability,
      provider: run.provider,
      run_id: run.run_id,
      dataset_id: run.dataset_id,
      actor_build_id: null,
      started_at: run.started_at ?? new Date(0).toISOString(),
    }],
    prequalification: null,
    progress: null,
  };
}

/**
 * Would this state cause a NEW Actor start?
 *
 * The invariant the whole continuation rests on, expressed as a function so a
 * test can assert it and the runtime can fail closed on it rather than
 * discovering the answer on the invoice.
 */
export function wouldStartNewDiscoveryRun(state: Record<string, unknown>): boolean {
  const pending = state?.pending_runs;
  if (!Array.isArray(pending) || pending.length === 0) return true;
  const completed = state?.completed_capabilities;
  // A discovery already marked complete never runs, and never resumes either —
  // the continuation would silently proceed with zero companies.
  if (Array.isArray(completed) && completed.includes("startup_company_discovery")) return true;
  return !pending.some((r) =>
    r && typeof r === "object" &&
    (r as { capability?: string }).capability === "startup_company_discovery" &&
    typeof (r as { run_id?: unknown }).run_id === "string" &&
    ((r as { run_id: string }).run_id).length > 0);
}
