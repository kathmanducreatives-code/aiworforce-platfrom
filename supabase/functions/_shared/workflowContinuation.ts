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
  | "checkpoint_not_resumable"
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
  checkpoint_not_resumable: 409,
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
  checkpoint_not_resumable:
    "That run saved a checkpoint, but it cannot be continued — the companies it " +
    "found were not stored with it, so continuing would have to search again.",
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

// ------------------------------------------- is the checkpoint enough on its own ----

/** Capabilities that fill the working set. Either name means "discovery ran". */
const DISCOVERY_CAPABILITIES: ReadonlySet<string> = new Set([
  "general_company_discovery",
  "startup_company_discovery",
]);

/**
 * The verdict on ONE checkpoint: can the run be continued from what was saved?
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Continuation was built for a run that had a paid DATASET and nothing else.
 * Task 41342269 finished terminal holding a memo23 run whose 50 companies had
 * never been read, so "continue" meant one thing: re-enter discovery and adopt
 * that run instead of buying a second one. Everything in this module follows
 * from that — `selectResumableRun`, `buildResumeState` with an empty
 * `completed_capabilities`, `wouldStartNewDiscoveryRun`.
 *
 * The engine has since grown a real checkpoint. It writes fifty
 * `CompanyResumeRecord`s, each carrying the company, its triage verdict, its
 * shortlist flag, its resolved identity and its enrichment; `restoreWorkingSet`
 * rebuilds the pool from them; and `completed_capabilities` tells the engine to
 * skip discovery entirely. A run in that state needs NO provider run adopted,
 * because it is not going to call a provider for discovery at all.
 *
 * Nothing taught the continuation gate that. Task 43355471 saved a coherent
 * checkpoint — 50 companies with snapshots, 10 shortlisted, discovery complete,
 * `pending_runs: []`, next capability `company_identity_resolution` — and
 * Continue refused it `no_resumable_provider_run`: "That run has no stored
 * company dataset to continue from." It had one. It was in `tasks.result`.
 *
 * ── WHAT A PROVIDER RUN IS ACTUALLY FOR ────────────────────────────────────
 *
 * Adopting one is how a continuation avoids RE-BUYING a call that is already
 * in flight or already answered. That is a question about the NEXT unfinished
 * capability, not a precondition on continuing at all. A checkpoint whose
 * pending stage has no in-flight call has nothing to adopt and needs nothing
 * adopted — the parent's own `pending_runs` already carries any that exist, and
 * `shouldSkipProviderCall` covers the rest.
 */
export interface CheckpointResumeAssessment {
  /** May a continuation be built from the checkpoint alone? */
  resumable: boolean;
  /** Why not. Null when it is resumable. */
  refusal: "no_capability_state" | "discovery_not_complete" | "no_restorable_companies"
    | "nothing_left_to_do" | null;
  /** Companies the checkpoint can actually restore — snapshot present. */
  restorable_companies: number;
  /** Of those, how many the parent shortlisted for investigation. */
  restorable_shortlisted: number;
  /** The capability a continuation would start at. */
  next_capability: string | null;
  /** Provider runs the parent left in flight, which the child will adopt. */
  pending_runs: number;
}

/**
 * Read the checkpoint and say, in one place, whether it can be continued.
 *
 * ONE FUNCTION, TWO CALLERS, AND THAT IS THE POINT. `continue-workflow` asks it
 * to decide, and `run-agent` asks it BEFORE promising the user that Continue
 * will reuse the work — so the promise and the gate cannot disagree. They did:
 * the checkpoint notice said "Nothing is lost and nothing extra was charged.
 * Use Continue below" beside a button that answered "That run has no stored
 * company dataset to continue from."
 */
export function assessCheckpointResume(
  result: Record<string, unknown> | null | undefined,
  /**
   * The records directly, for a caller that HOLDS them rather than a stored
   * `tasks.result` to read them out of.
   *
   * `run-agent` asks this question about a checkpoint it is about to write, so
   * it has `snap.resume_records` in hand and no result row yet. It first
   * synthesised one — and omitted `version`, which `readCheckpointCompanies`
   * requires, so fifty restorable companies read back as zero and the notice
   * told the user their run could not be continued while the gate was happily
   * continuing it. Passing the records removes the shape-matching entirely.
   */
  records?: readonly unknown[],
): CheckpointResumeAssessment {
  const empty: CheckpointResumeAssessment = {
    resumable: false, refusal: "no_capability_state",
    restorable_companies: 0, restorable_shortlisted: 0,
    next_capability: null, pending_runs: 0,
  };
  if (!result || typeof result !== "object") return empty;

  const state = result.capability_execution_state as Record<string, unknown> | undefined;
  if (!state || typeof state !== "object") return empty;

  const completed = Array.isArray(state.completed_capabilities)
    ? state.completed_capabilities.filter((c): c is string => typeof c === "string") : [];
  const pending = Array.isArray(state.pending_capabilities)
    ? state.pending_capabilities.filter((c): c is string => typeof c === "string") : [];
  const pendingRuns = Array.isArray(state.pending_runs) ? state.pending_runs.length : 0;

  // RESTORABLE, NOT MERELY PRESENT. `restoreWorkingSet` skips a record with no
  // `snapshot.company` — checkpoints written before the field existed look like
  // rows and restore as nothing. Counting them would let this promise a resume
  // that comes back holding an empty pool, which is the failure
  // `checkpointSnapshot` refuses to write and this must refuse to trust.
  const known = records ?? readCheckpointCompanies(result);
  const restorable = known.filter((r) => {
    const snap = (r as unknown as { snapshot?: { company?: unknown } }).snapshot;
    return !!snap && !!snap.company;
  });
  const shortlisted = restorable.filter(
    (r) => (r as unknown as { snapshot?: { shortlisted?: unknown } }).snapshot?.shortlisted === true);

  const next = pending.find((c) => !completed.includes(c)) ?? null;

  const base = {
    restorable_companies: restorable.length,
    restorable_shortlisted: shortlisted.length,
    next_capability: next,
    pending_runs: pendingRuns,
  };

  if (!completed.some((c) => DISCOVERY_CAPABILITIES.has(c))) {
    return { resumable: false, refusal: "discovery_not_complete", ...base };
  }
  if (restorable.length === 0) {
    return { resumable: false, refusal: "no_restorable_companies", ...base };
  }
  if (!next) {
    return { resumable: false, refusal: "nothing_left_to_do", ...base };
  }
  return { resumable: true, refusal: null, ...base };
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

  // ── THE CHECKPOINT FIRST, THE PROVIDER RUN ONLY AS A FALLBACK ────────────
  //
  // A run that saved a coherent checkpoint carries its own answer: discovery is
  // complete, the pool is restorable, and the next capability is named. It does
  // not need a provider run adopted, because it is not going to call a provider
  // for discovery. Requiring one refused task 43355471 — 50 companies with
  // snapshots, 10 shortlisted, `pending_runs: []` — with "That run has no
  // stored company dataset to continue from."
  //
  // The legacy path below stays for the case it was written for: a terminal run
  // holding a paid dataset it never read, with no checkpoint at all.
  const checkpoint = assessCheckpointResume(i.task.result);
  const query = readOriginalQuery(i.task.result) ?? i.plan.user_instruction ?? null;

  if (checkpoint.resumable) {
    const state = (i.task.result?.capability_execution_state ?? {}) as Record<string, unknown>;
    // ANY IN-FLIGHT RUN THE PARENT LEFT, CARRIED FOR THE LINEAGE RECORD. It is
    // not a precondition; it is a fact about the parent, and the engine adopts
    // it through the state it already travels in.
    const inFlight = Array.isArray(state.pending_runs)
      ? (state.pending_runs[0] ?? null) as { run_id?: unknown; dataset_id?: unknown;
        provider?: unknown } | null
      : null;
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
          // "" rather than a fabricated id: this continuation adopts nothing,
          // and saying so is the honest record.
          apify_run_id: typeof inFlight?.run_id === "string" ? inFlight.run_id : "",
          apify_dataset_id: typeof inFlight?.dataset_id === "string" ? inFlight.dataset_id : null,
          provider: typeof inFlight?.provider === "string" ? inFlight.provider : "checkpoint",
          original_user_query: query,
          continuation_reason: r.continuation_reason,
        },
        // THE PARENT'S OWN STATE, UNCHANGED. Its `mission_hash` is what lets
        // `stateMatchesMission` adopt it; its `completed_capabilities` is what
        // makes the engine SKIP discovery instead of re-running it; its
        // `pending_runs` is what makes any in-flight call a GET. Rebuilding it
        // here — as `buildResumeState` does for the legacy path — would throw
        // all three away.
        capability_execution_state: state,
        lead_resume_records: readCheckpointCompanies(i.task.result),
        lineage_root_task_id: lineageRootTaskId(i.task.id, i.task.result),
        steps: i.plan.steps,
        user_instruction: i.plan.user_instruction,
      },
    };
  }

  const run = selectResumableRun(i.toolCalls);
  if (!run) {
    // WHICH "NO" THIS IS. A run that saved a checkpoint and a run that saved
    // nothing are different situations and the user is owed the difference:
    // one has data that cannot be used, the other has no data at all.
    return {
      ok: false,
      refusal: checkpoint.refusal === "no_capability_state"
        ? "no_resumable_provider_run" : "checkpoint_not_resumable",
    };
  }

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
export function wouldStartNewDiscoveryRun(
  state: Record<string, unknown>,
  /**
   * How many companies the continuation can RESTORE from the checkpoint.
   *
   * ── WHY THIS ARGUMENT EXISTS ─────────────────────────────────────────────
   *
   * "Discovery complete" used to mean the continuation would run with an empty
   * pool, because nothing rebuilt the working set — so this function treated it
   * as unsafe, correctly, at the time. `restoreWorkingSet` changed that: a
   * checkpoint carrying per-company snapshots restores the pool, and skipping
   * discovery is then the CHEAP outcome rather than the broken one.
   *
   * Omitted, every judgement below is exactly what it was, which is what keeps
   * the legacy adopt-a-run path unchanged.
   */
  opts: { restorableCompanies?: number } = {},
): boolean {
  const completed = state?.completed_capabilities;
  const discoveryComplete = Array.isArray(completed) &&
    completed.some((c) => typeof c === "string" && DISCOVERY_CAPABILITIES.has(c));

  // DISCOVERY IS COMPLETE AND THE POOL COMES BACK WITH IT. The engine skips a
  // completed capability, so no Actor is started — and `restoreWorkingSet`
  // gives it the companies to work on. Nothing to adopt, nothing to buy.
  if (discoveryComplete && (opts.restorableCompanies ?? 0) > 0) return false;

  const pending = state?.pending_runs;
  if (!Array.isArray(pending) || pending.length === 0) return true;
  // A discovery marked complete with NOTHING to restore never runs and never
  // resumes either — the continuation would silently proceed with zero
  // companies. That is the case this guard was written for.
  if (discoveryComplete) return true;
  return !pending.some((r) =>
    r && typeof r === "object" &&
    (r as { capability?: string }).capability === "startup_company_discovery" &&
    typeof (r as { run_id?: unknown }).run_id === "string" &&
    ((r as { run_id: string }).run_id).length > 0);
}
