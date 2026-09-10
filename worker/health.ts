// LIVENESS FOR A PROCESS THAT HAS NO REQUESTS.
//
// ── WHY A WORKER NEEDS AN HTTP PORT AT ALL ──────────────────────────────────
//
// The worker answers nothing and calls out only to Supabase, so it has no
// natural endpoint. Without one the only evidence it is alive is the host's log
// stream — which means "is it healthy?" can only be answered by whoever holds
// the hosting credentials, and "it polled the queue and claimed nothing" is
// indistinguishable from "it wedged on the first poll and printed nothing".
//
// Both are states this deployment has to prove while V2 is disabled, so the
// process reports them itself.
//
// ── WHAT IT DELIBERATELY DOES NOT REPORT ───────────────────────────────────
//
// No secrets, no queue payloads, no workspace ids beyond the count of what is
// allowlisted. The endpoint is unauthenticated — Railway exposes it publicly —
// so it carries operational counters and nothing a stranger could use.
//
// ── AND WHY IT IS OPTIONAL ─────────────────────────────────────────────────
//
// No PORT, no server. A local run stays exactly what it was: one process, no
// listening socket, no permission prompt.

/** Counters the loop updates; every field is safe to publish. */
export interface WorkerStatus {
  startedAt: number;
  polls: number;
  claims: number;
  lastPollAt: number | null;
  lastPollReason: string | null;
  lastClaimAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  draining: boolean;
}

export function newStatus(): WorkerStatus {
  return {
    startedAt: Date.now(),
    polls: 0,
    claims: 0,
    lastPollAt: null,
    lastPollReason: null,
    lastClaimAt: null,
    lastErrorAt: null,
    lastError: null,
    draining: false,
  };
}

export interface HealthView {
  /** Liveness, not readiness: true whenever the loop has not wedged. */
  ok: boolean;
  status: "polling" | "working" | "draining" | "starting" | "stalled";
  worker_id: string;
  /** V2 gate. `false` means the allowlist is empty and nothing can be claimed. */
  gated: boolean;
  uptime_s: number;
  polls: number;
  claims: number;
  seconds_since_last_poll: number | null;
  last_poll_reason: string | null;
  last_error: string | null;
  seconds_since_last_error: number | null;
  config: Record<string, number>;
}

/**
 * STALLED IS NOT DEAD, and the distinction is the whole point of the field.
 *
 * A process can be up, holding its socket, and no longer polling — a wedged
 * await inside the claim, a Supabase connection that never times out. Reporting
 * `ok: true` on the strength of "the server answered" would make that invisible,
 * which is the failure mode this endpoint exists to catch.
 *
 * So liveness is judged on the LOOP, not the socket: no poll for several
 * intervals while not working and not draining is `stalled`, and `ok` is false.
 * The multiple is generous because a claimed mission legitimately stops polling
 * for as long as it runs.
 */
export const STALL_INTERVALS = 4;

export function healthView(args: {
  status: WorkerStatus;
  workerId: string;
  gated: boolean;
  idlePollMs: number;
  config: Record<string, number>;
  now?: number;
  /** True while a claimed mission is executing, which suspends polling. */
  working?: boolean;
}): HealthView {
  const now = args.now ?? Date.now();
  const s = args.status;
  const sinceLastPoll = s.lastPollAt === null ? null : Math.floor((now - s.lastPollAt) / 1000);
  const stallAfterS = Math.ceil((args.idlePollMs * STALL_INTERVALS) / 1000);

  let state: HealthView["status"];
  if (s.draining) state = "draining";
  else if (args.working) state = "working";
  else if (s.lastPollAt === null) state = "starting";
  else if (sinceLastPoll !== null && sinceLastPoll > stallAfterS) state = "stalled";
  else state = "polling";

  return {
    // `starting` and `draining` are healthy; only a stalled loop is not.
    ok: state !== "stalled",
    status: state,
    worker_id: args.workerId,
    gated: args.gated,
    uptime_s: Math.floor((now - s.startedAt) / 1000),
    polls: s.polls,
    claims: s.claims,
    seconds_since_last_poll: sinceLastPoll,
    last_poll_reason: s.lastPollReason,
    last_error: s.lastError,
    seconds_since_last_error: s.lastErrorAt === null
      ? null
      : Math.floor((now - s.lastErrorAt) / 1000),
    config: args.config,
  };
}

/**
 * Serve the view on `PORT`. Returns a closer, or null when no port is set.
 *
 * 200 when `ok`, 503 when stalled — so a platform health check fails on a
 * wedged loop rather than on a dead socket only.
 */
export function startHealthServer(
  port: number,
  view: () => HealthView,
  log: (msg: string, meta?: unknown) => void,
): { close: () => Promise<void> } {
  const server = Deno.serve({
    port,
    hostname: "0.0.0.0",
    onListen: ({ hostname, port }) => log("[worker] health listening", { hostname, port }),
  }, (req) => {
    const path = new URL(req.url).pathname;
    if (path !== "/" && path !== "/health" && path !== "/healthz") {
      return new Response("not found", { status: 404 });
    }
    const v = view();
    return new Response(JSON.stringify(v, null, 2), {
      status: v.ok ? 200 : 503,
      headers: { "content-type": "application/json" },
    });
  });
  return { close: () => server.shutdown() };
}
