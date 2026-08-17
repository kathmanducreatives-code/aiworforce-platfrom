// HANDING WORK TO ANOTHER EDGE FUNCTION, RELIABLY AND VISIBLY.
//
// ── THE DEFECT THIS EXISTS TO REMOVE ────────────────────────────────────────
//
// `orchestrate` persisted a plan as `executing` and then handed off to
// `run-agent` like this:
//
//     fetch(`${SUPABASE_URL}/functions/v1/run-agent`, { ... })
//       .catch((e) => console.error("kickoff failed:", e));
//     return json({ success: true, plan_id: taskPlan.id });
//
// Three consecutive live runs (2026-08-17 10:21, 10:39, 10:49) produced a plan
// row, a `plan_created` activity row, and then NOTHING: no task row, no signal,
// no step event, `updated_at` never once moved off `created_at`. Every other
// explanation was tested and eliminated — SUPABASE_URL resolves to the right
// project, the service-role credential is valid and privileged (it inserted the
// plan, bypassing RLS), `run-agent` answers a malformed body in 390ms, and both
// agents exist in the workspace.
//
// TWO INDEPENDENT BUGS ARE PRESENT IN THOSE THREE LINES.
//
// 1. THE REQUEST IS NOT GUARANTEED TO BE SENT. The Edge Runtime may terminate
//    the isolate as soon as the handler returns, and a promise still in flight
//    dies with it. `EdgeRuntime.waitUntil()` is the platform's mechanism for
//    holding the isolate open for exactly this, and it appeared NOWHERE in this
//    codebase.
//
// 2. `.catch()` CANNOT SEE AN HTTP ERROR. A 401, a 404 or a 500 RESOLVES the
//    promise — `catch` only fires on a transport failure. So a rejected kickoff
//    was as silent as a dropped one.
//
// The second bug is the reason the first went unnoticed for so long, and it is
// the more important of the two to fix. Nothing else ever writes to
// `task_plans`, so a dropped kickoff, a rejected kickoff and a crashed callee
// all presented identically: the plan sat in `executing` forever and the UI
// showed "Pilot is preparing the workflow…" indefinitely. A failure nobody can
// see is worse than a failure, because it cannot be retried or reported.
//
// ── WHY THIS DOES NOT SIMPLY `await` THE CALL ───────────────────────────────
//
// `run-agent` runs the whole step before responding — Actor calls included,
// which take minutes. Awaiting it inside `orchestrate` would hold the user's
// request open past the function timeout and turn a slow success into a 504.
// The handoff MUST stay in the background; what it must not stay is invisible.
// So the call keeps running after the response, and the outcome is reported
// through `onOutcome` rather than through the return value.
//
// Pure transport plus one callback: no Supabase client, no table names, no
// knowledge of what a plan is. The caller decides what a failure means.

/** The subset of the Edge Runtime global this module touches. */
export interface EdgeRuntimeLike {
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Hold the isolate open until `promise` settles.
 *
 * Returns whether the runtime accepted the promise, which is what the wiring
 * test asserts on — "we called waitUntil" is checkable, "the isolate stayed
 * alive" is not.
 *
 * DEGRADES TO THE OLD BEHAVIOUR RATHER THAN THROWING. Outside the Edge Runtime
 * — in `deno test`, or on a runtime that drops the API — there is no isolate to
 * preserve and the promise simply runs as before. A missing platform API must
 * not take down a request that would otherwise succeed.
 */
export function keepIsolateAlive(
  promise: Promise<unknown>,
  runtime: EdgeRuntimeLike | undefined =
    (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime,
): boolean {
  if (typeof runtime?.waitUntil !== "function") return false;
  try {
    runtime.waitUntil(promise);
    return true;
  } catch {
    // A runtime that has the method but rejects the call must not break the
    // request either.
    return false;
  }
}

/**
 * Why a background invocation did not land.
 *
 * `http_error` is the case the original `.catch()` could not observe, and is
 * the reason this is a union rather than a boolean.
 */
export type InvokeFailure =
  | { code: "http_error"; status: number; detail: string }
  | { code: "transport_error"; detail: string };

export interface InvokeOptions {
  url: string;
  /** Sent as `Authorization: Bearer …`. */
  token: string;
  body: unknown;
  /**
   * Called ONLY on failure, and awaited, so the caller's bookkeeping write
   * happens while the isolate is still held open by `keepIsolateAlive`.
   */
  onFailure: (failure: InvokeFailure) => Promise<void> | void;
  fetchImpl?: typeof fetch;
  runtime?: EdgeRuntimeLike;
  log?: (message: string, meta?: unknown) => void;
}

/**
 * POST JSON to another edge function in the background, reporting any failure.
 *
 * Returns the promise it registered so a caller inside an async context can
 * await it in tests. Production callers do not await: the point is that the
 * response goes back to the user immediately.
 *
 * NEVER THROWS AND NEVER REJECTS. A failure in the failure handler is logged
 * and swallowed — a bookkeeping write that throws must not turn a recoverable
 * stall into an unhandled rejection that takes the isolate down with it.
 */
export function invokeInBackground(opts: InvokeOptions): Promise<void> {
  const { url, token, body, onFailure, fetchImpl = fetch, runtime, log } = opts;

  const run = (async () => {
    let failure: InvokeFailure | null = null;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      // THE CHECK THAT WAS MISSING. `res.ok` is false for every 4xx and 5xx,
      // none of which reach a `.catch`.
      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.text()).slice(0, 500);
        } catch {
          detail = "<unreadable body>";
        }
        failure = { code: "http_error", status: res.status, detail };
      }
    } catch (e) {
      failure = { code: "transport_error", detail: String(e).slice(0, 500) };
    }

    if (!failure) return;
    log?.("background invocation failed", { url, failure });
    try {
      await onFailure(failure);
    } catch (e) {
      log?.("failure handler threw", { url, error: String(e) });
    }
  })();

  keepIsolateAlive(run, runtime);
  return run;
}

/** One-line, human-readable reason to persist alongside a failed hand-off. */
export function describeFailure(failure: InvokeFailure): string {
  return failure.code === "http_error"
    ? `handoff rejected with HTTP ${failure.status}: ${failure.detail}`
    : `handoff could not be sent: ${failure.detail}`;
}
