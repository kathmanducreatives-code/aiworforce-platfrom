// FIRING THE NEXT SLICE.
//
// `leadAutoContinuation` decides WHETHER another slice should run; this decides
// HOW it is started, and is the only place in the lead pipeline that calls the
// platform back.
//
// ── WHY SELF-INVOCATION AND NOT A QUEUE ──────────────────────────────────────
//
// The continuation must begin immediately: the user asked once and is watching
// the Workbench. A cron sweeper adds a poll interval of latency to every slice
// of every request, which for a ten-slice job is minutes of visible nothing.
//
// The trade is that a slice which dies between writing its checkpoint and firing
// the next one stalls the chain. That is survivable and recoverable — the
// checkpoint is already durable, the task advertises itself as resumable, and
// the existing claim/lease means a sweeper (or a user pressing Continue) can
// pick it up later without racing anything. A stalled chain loses time; a lost
// checkpoint would lose paid work, and that cannot happen here.
//
// ── AND WHY IT IS FIRE-AND-FORGET ────────────────────────────────────────────
//
// The dispatching invocation must not await the one it starts. Awaiting would
// nest slice inside slice until the outermost isolate is killed at its own wall
// clock — taking the whole chain with it and, worse, killing it mid-write. Each
// slice therefore ends cleanly and independently, and the chain is held together
// by the checkpoint rather than by a call stack.

export const CONTINUATION_DISPATCH_VERSION = "lead-continuation-dispatch-v1" as const;

export interface DispatchRequest {
  /** The checkpointed task to resume. Same row, not a new one. */
  resumeTaskId: string;
  workspaceId: string;
  /** Attributed to the original requester, never to the service identity. */
  userId: string;
  planId: string | null;
  agentSlug: string;
  /** Which slice this will be, for logging and for the depth ceiling. */
  continuationIndex: number;
}

export type DispatchOutcome =
  | { dispatched: true; status: number }
  | { dispatched: false; reason: "not_configured" | "transport_error"; detail: string };

export interface DispatchDeps {
  /** Injected so tests exercise every branch without a network. */
  fetch: (url: string, init: RequestInit) => Promise<{ status: number }>;
  functionsBaseUrl: string | null;
  serviceRoleKey: string | null;
  log?: (msg: string, meta?: unknown) => void;
}

/**
 * Start the next slice.
 *
 * The body is the minimum a continuation needs: the task to resume and who it
 * belongs to. Everything else — the mission, the frontier, the ranking, the
 * verdicts already paid for — is read from the checkpoint by the resuming
 * invocation, which is the whole reason the checkpoint exists.
 *
 * NEVER AWAITED BY THE CALLER for its result beyond the handoff. This resolves
 * as soon as the platform has accepted the request.
 */
export async function dispatchContinuation(
  req: DispatchRequest, deps: DispatchDeps,
): Promise<DispatchOutcome> {
  const log = deps.log ?? (() => {});
  if (!deps.functionsBaseUrl || !deps.serviceRoleKey) {
    // FAIL VISIBLY, NOT SILENTLY. Without credentials the chain cannot continue,
    // and a run that silently stops after one slice is the bug this replaces.
    log("continuation_dispatch_not_configured", {
      has_base_url: !!deps.functionsBaseUrl, has_key: !!deps.serviceRoleKey,
    });
    return {
      dispatched: false, reason: "not_configured",
      detail: "the function base URL or service role key is unavailable",
    };
  }

  const url = `${deps.functionsBaseUrl.replace(/\/+$/, "")}/run-agent`;
  try {
    const res = await deps.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deps.serviceRoleKey}`,
      },
      body: JSON.stringify({
        resume_task_id: req.resumeTaskId,
        workspace_id: req.workspaceId,
        // HONOURED ONLY FOR SERVICE-ROLE CALLERS, which is what this is. The
        // continuation belongs to the person who asked, not to the machine that
        // resumed it, or their Workbench would not show its own results.
        user_id: req.userId,
        plan_id: req.planId,
        agent_slug: req.agentSlug,
        auto_continuation: true,
        continuation_index: req.continuationIndex,
      }),
    });
    log("continuation_dispatched", {
      task_id: req.resumeTaskId, index: req.continuationIndex, status: res.status,
    });
    return { dispatched: true, status: res.status };
  } catch (e) {
    // A FAILED HANDOFF IS NOT A FAILED RUN. This slice's work is already
    // checkpointed and persisted; only the automatic follow-on is lost, and the
    // task stays resumable by any other route.
    log("continuation_dispatch_failed", {
      task_id: req.resumeTaskId, error: String(e),
    });
    return { dispatched: false, reason: "transport_error", detail: String(e) };
  }
}
