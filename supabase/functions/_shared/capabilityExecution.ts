// THE EXECUTION SEAM BOTH LEADS AND SIGNALS CALL.
//
// ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ───────────────────────────
//
// `runCapabilityPlan` already takes a clean `CapabilityEngineDeps`. What was
// tangled was CONSTRUCTING those deps: 334 lines of closures inside
// `run-agent`, over ~33 outer bindings. Monitoring could not reach the engine
// without either duplicating that — a second provider stack, which is the thing
// Phase 3 exists to prevent — or threading a second objective through a
// 5337-line lead handler.
//
// So this extracts the INFRASTRUCTURE half only:
//
//   invoke                provider dispatch, credits, ledger, response contract
//   verifyEmployer        employer verification
//   deadline              wall-clock budget
//   onStateChange         checkpointing hook
//   log                   diagnostics
//   triageBatchesAllowed  batch policy
//
// It does NOT extract the model bindings (`planDiscovery`, `planExecution`,
// `triageCompanies`, `evaluateMission`, `groundCompany`) or the lead
// orchestration (`groundingMode`, `onProgress`). Those are caller-shaped:
// grounding mode restores a Lead pool, progress writes a Lead task row, and the
// model bindings carry a Lead run's evaluation budget. Monitoring supplies its
// own or supplies none — the engine already treats every one of them as
// optional, and a run with no evaluator reports `insufficient_evidence` rather
// than qualifying anybody.
//
// ── WHY A FACTORY AND NOT A SHARED SINGLETON ────────────────────────────────
//
// Every dependency here is per-run: the tool context carries the workspace, the
// task and the agent, and the ownership snapshot changes as planning proceeds.
// A module-level instance would leak one run's identity into another's ledger
// rows, which is exactly the kind of cross-tenant defect the audit trail exists
// to make impossible.
//
// PURE ASSEMBLY. This module performs no I/O of its own — it only wires the
// callables it is given. Everything it returns is testable with stubs.

import {
  jobRowsLookIntact, readProviderResultItems, resolveResponseKind,
} from "./providerResponseContract.ts";

export const CAPABILITY_EXECUTION_VERSION = "capability-execution-v1" as const;

/** The `runTool` result shape this seam depends on. */
export interface ToolResultLike {
  ok: boolean;
  data?: unknown;
  error?: string | null;
}

/**
 * The registry entry point, typed structurally.
 *
 * `ctx` is deliberately loose. The real `ToolContext` is a run-agent concern
 * carrying a Supabase client and the agent identity; naming it here would drag
 * that whole type into a module whose entire purpose is to be callable from a
 * second workflow that has a different one.
 */
// deno-lint-ignore no-explicit-any
export type RunToolFn = (toolName: string, input: any, ctx: any) => Promise<ToolResultLike>;

/**
 * Who is accountable for this call, as the execution ledger records it.
 *
 * A function rather than a value because the ownership snapshot changes during
 * a run — planning may fall back to a different adapter partway through, and a
 * ledger row that recorded the ORIGINAL owner would attribute the spend to a
 * planner that did not make the decision.
 */
export type AuditOwnershipFn = () => Record<string, unknown>;

export interface CapabilityExecutionContext {
  /** The registry entry point. Owns credits, the ledger and containment. */
  runTool: RunToolFn;
  /** Workspace / task / agent identity, passed straight through to `runTool`. */
  toolCtx: unknown;
  /** Ownership provenance, re-read per call. */
  auditOwnership: AuditOwnershipFn;
  /**
   * WHICH WORKFLOW IS SPENDING.
   *
   * Reaches the ledger as `persistence_authority`. Leads say
   * `capability_engine`; monitoring says `monitoring_engine`, so a row's spend
   * can be attributed to the workflow that caused it without inspecting the
   * mission. Not cosmetic: it is how "what did monitoring cost?" becomes a
   * query rather than an estimate.
   */
  persistenceAuthority: string;
  /** Diagnostics. Defaults to silence. */
  log?: (msg: string, meta?: unknown) => void;
}

/** A compiled call, as the engine hands it over. */
export interface CompiledCallLike {
  actorKey: string;
  actorId: string;
  input: unknown;
  inputHash: string;
  /** Set when resuming a run Apify already started. */
  resumeRunId?: string;
}

/**
 * Build the provider invoker.
 *
 * ── THE PASSTHROUGH CONTRACT IS THE WHOLE POINT ─────────────────────────────
 *
 * `runTool` honours a pre-compiled payload only when it arrives as `input`
 * alongside `compiled_actor_input: true`. Without both, it looks up an adapter
 * by `actor_id`, finds none for a carded actor, and synthesises a generic jobs
 * payload — which is how TEST task e8abeb8f sent `{query: null, location: null}`
 * to memo23 and read Apify's schema rejection as "no candidates".
 *
 * Spreading `call.input` at the top level of the envelope reproduces that
 * defect exactly. It must stay nested under `input`.
 */
export function buildInvoker(ctx: CapabilityExecutionContext) {
  return async function invoke(
    call: CompiledCallLike,
  ): Promise<Record<string, unknown>[]> {
    const resumeRunId = call.resumeRunId;
    const envelope: Record<string, unknown> = {
      selected_actor_key: call.actorKey,
      actor_id: call.actorId,
      compiled_actor_input: true,
      capability_key: call.actorKey,
      // The key `runTool` actually reads. See the note above.
      input: call.input as Record<string, unknown>,
      // Hashed before dispatch and re-checked immediately before the POST.
      compiled_input_hash: call.inputHash,
      persistence_authority: ctx.persistenceAuthority,
      ...(resumeRunId ? { resume_run_id: resumeRunId } : {}),
    };

    const rr = await ctx.runTool(
      "source_with_apify", { ...envelope, ...ctx.auditOwnership() }, ctx.toolCtx);

    if (!rr.ok || !rr.data) {
      // THE FAILURE DATA TRAVELS WITH THE ERROR. A RUNNING Apify run comes back
      // as `!ok` carrying its run_id and dataset_id; throwing a bare string
      // discarded both and abandoned a paid run (TEST run rWikfnKgnp5DazDYr).
      // The engine reads these off the error to record the run as pending and
      // resume it later.
      const err = new Error(rr.error ?? "jobs_actor_failed") as Error & {
        toolResult?: unknown;
      };
      err.toolResult = rr.data ?? null;
      throw err;
    }

    // READ THROUGH THE CONTRACT, NOT A FIELD NAME. The structured-company branch
    // returns rows under `company_items`; reading `items` only meant every
    // company-details call received ZERO rows.
    const kind = resolveResponseKind({
      actorKey: call.actorKey ?? null,
      actorId: call.actorId ?? null,
      sourceType: (rr.data as { normalized_source_type?: string })
        .normalized_source_type ?? null,
    });
    // THE PROVIDER'S OWN ROWS, because this caller owns a normalizer per Actor.
    // `hiringActorNormalizers` is written against the output contracts in
    // `hiringActorCatalog`; the legacy flat projection under `items` is written
    // against a different Actor entirely. See `readProviderResultItems`.
    const items = readProviderResultItems(
      rr.data as Record<string, unknown>, kind, { providerRows: true });

    // A STRUCTURED RESPONSE THAT ARRIVED JOB-NORMALIZED IS A TRANSPORT BUG, not
    // an empty result. Reported rather than swallowed — this is what would have
    // caught task 41342269 in the log instead of six hours later in a CSV diff.
    if (kind === "structured_companies") {
      const shape = structuredRowsLookIntact(items);
      if (!shape.intact) {
        (ctx.log ?? (() => {}))("provider_response_shape_violation", {
          actor_id: call.actorId, reason: shape.reason,
        });
      }
    }
    // AND THE SAME QUESTION OF A JOBS RESPONSE. `readProviderResultItems` falls
    // back to `items` when `job_items` is absent, and that fallback is silent —
    // which is exactly how task a76c7b4c lost 84 paid rows without a log line.
    if (kind === "jobs") {
      const shape = jobRowsLookIntact(items);
      if (!shape.intact) {
        (ctx.log ?? (() => {}))("provider_response_shape_violation", {
          actor_id: call.actorId, reason: shape.reason,
        });
      }
    }
    return items as Record<string, unknown>[];
  };
}

/**
 * Does a structured-company response still look like one?
 *
 * Kept here beside its only caller. A row that carries none of the identity
 * fields a company row must have arrived through the wrong normalizer.
 */
export function structuredRowsLookIntact(
  items: readonly unknown[],
): { intact: boolean; reason: string } {
  if (items.length === 0) return { intact: true, reason: "" };
  const first = items[0];
  if (!first || typeof first !== "object") {
    return { intact: false, reason: "rows are not objects" };
  }
  const r = first as Record<string, unknown>;
  const identityish = ["id", "name", "companyName", "website", "linkedinUrl", "domain"]
    .some((k) => r[k] !== undefined);
  return identityish
    ? { intact: true, reason: "" }
    : { intact: false, reason: "no company identity field on the first row" };
}

/**
 * The infrastructure half of `CapabilityEngineDeps`.
 *
 * Spread into the engine call alongside the caller's own model bindings and
 * orchestration hooks. Both Leads and monitoring build it the same way, so the
 * provider path, the credit path, the ledger and the response contract cannot
 * diverge between them.
 */
export interface CapabilityExecutionDeps {
  invoke: ReturnType<typeof buildInvoker>;
  log: (msg: string, meta?: unknown) => void;
}

export function buildCapabilityExecution(
  ctx: CapabilityExecutionContext,
): CapabilityExecutionDeps {
  return {
    invoke: buildInvoker(ctx),
    log: ctx.log ?? (() => {}),
  };
}

/** Authorities that may reach the shared execution seam. */
export const PERSISTENCE_AUTHORITIES = [
  "capability_engine",
  "monitoring_engine",
] as const;
export type PersistenceAuthority = typeof PERSISTENCE_AUTHORITIES[number];

export function isPersistenceAuthority(v: unknown): v is PersistenceAuthority {
  return typeof v === "string" &&
    (PERSISTENCE_AUTHORITIES as readonly string[]).includes(v);
}

/**
 * Recognise a started-but-unfinished Apify run on a thrown invoker error.
 *
 * ── WHY THIS LIVES BESIDE `buildInvoker` ────────────────────────────────────
 *
 * It reads the error shape `buildInvoker` throws — the `toolResult` it attaches
 * — so the two are one contract, and a caller that uses the invoker without
 * this reads a PENDING run as a failure. Phase 3F's first two-company live run
 * is what that costs: a job search that was still running when the worker hit
 * its wall clock was recorded as `provider_error`, which fails the capability,
 * discards a run that had already been paid for, and lets a fallback spend
 * against it.
 *
 * ONLY A RUN APIFY SAYS IS RUNNING/READY COUNTS. A schema rejection, an auth
 * failure or a timeout are NOT pending and must keep failing, or "pending"
 * becomes a way to swallow real errors.
 */
export function readPendingRun(e: unknown): PendingRunLike | null {
  const d = (e as { toolResult?: Record<string, unknown> } | null)?.toolResult;
  if (!d || typeof d !== "object") return null;
  const runId = typeof d.run_id === "string" ? d.run_id : "";
  if (!runId || d.pending !== true) return null;
  return {
    run_id: runId,
    dataset_id: typeof d.dataset_id === "string" ? d.dataset_id : null,
    actor_build_id: typeof d.build_id === "string" ? d.build_id : null,
  };
}

/** The engine's `PendingRun`, restated structurally to avoid a cycle. */
export interface PendingRunLike {
  run_id: string;
  dataset_id: string | null;
  actor_build_id?: string | null;
}
