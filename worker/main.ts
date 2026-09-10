// LEAD MISSION V2 WORKER — long-running Deno process (NOT an edge function).
//
// Run: deno run --allow-env --allow-net --allow-read worker/main.ts
//
// It claims one V2 queue row at a time, replays its kickoff body into run-agent's
// own handler IN-PROCESS with a longer (revocable) deadline, keeps the queue
// lease — and, once bound, the task and lineage lease — alive with a concurrent
// heartbeat, and releases. State lives entirely in Supabase.
//
// ENVIRONMENT: the same secrets as the run-agent edge function (SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY and every provider/model key it
// reads), plus the worker's own: LEAD_V2_WORKER_WORKSPACES, LEAD_WORKER_ID,
// LEAD_WORKER_MAX_RUNTIME_MS (capped at 20 min), LEAD_WORKER_LEASE_SECONDS,
// LEAD_WORKER_HEARTBEAT_MS, LEAD_WORKER_IDLE_POLL_MS.
//
// DISABLED BY DEFAULT. It claims nothing unless a workspace is allowlisted; with
// the allowlist empty it connects, logs "disabled", and idles.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  runWorkerLoop, makeHeartbeatController, DEFAULT_WORKER_CONFIG,
  type WorkerDeps, type WorkerConfig, type ClaimOutcome, type ClaimedMission, type ReleaseOutcome,
} from "../supabase/functions/_shared/leadMissionWorkerCore.ts";
import {
  v2Enabled, clampWorkerCeilingMs, LEAD_WORKER_MAX_RUNTIME_ENV,
} from "../supabase/functions/_shared/leadExecutionEngine.ts";
import { createExecutionDeadline } from "../supabase/functions/_shared/leadExecutionFinalizer.ts";
import { queueStatusFor, terminalStatusOf } from "../supabase/functions/_shared/leadMissionV2Request.ts";
import { createLeadMissionRunner } from "./leadMissionRunner.ts";
import { newStatus, healthView, startHealthServer } from "./health.ts";

const env = (k: string) => Deno.env.get(k);
const num = (k: string, d: number) => { const v = Number(env(k)); return Number.isFinite(v) && v > 0 ? v : d; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function config(): WorkerConfig {
  return {
    leaseSeconds: num("LEAD_WORKER_LEASE_SECONDS", DEFAULT_WORKER_CONFIG.leaseSeconds),
    heartbeatIntervalMs: num("LEAD_WORKER_HEARTBEAT_MS", DEFAULT_WORKER_CONFIG.heartbeatIntervalMs),
    missionCeilingMs: clampWorkerCeilingMs(env(LEAD_WORKER_MAX_RUNTIME_ENV)),
    idlePollMs: num("LEAD_WORKER_IDLE_POLL_MS", DEFAULT_WORKER_CONFIG.idlePollMs),
  };
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }
const firstRow = (data: unknown) => (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;

async function main() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) { console.error("[worker] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required"); Deno.exit(1); }

  // BEFORE the import: run-agent must not start an HTTP server in this process.
  Deno.env.set("RUN_AGENT_IMPORT_ONLY", "1");
  const { handleRunAgent } = await import("../supabase/functions/run-agent/index.ts");

  const db = createClient(url, key, { auth: { persistSession: false } });
  const idEnv = env("LEAD_WORKER_ID");
  const workerId = idEnv && UUID.test(idEnv) ? idEnv : crypto.randomUUID();
  const cfg = config();
  const log = (msg: string, meta?: unknown) => console.log(msg, meta ?? "");

  const runner = createLeadMissionRunner({
    handler: handleRunAgent,
    serviceRoleKey: key,
    functionsBaseUrl: `${url.replace(/\/+$/, "")}/functions/v1`,
    createDeadline: (budgetMs) => createExecutionDeadline({ budgetMs }),
    bind: async (queueId, taskId, lineageId) => {
      const { data, error } = await db.rpc("bind_lead_mission_execution", {
        p_queue_id: queueId, p_worker_id: workerId, p_task_id: taskId, p_lineage_id: lineageId,
      });
      if (error) { log("[worker] bind error", error.message); return false; }
      return firstRow(data)?.bound === true;
    },
    readTaskOutcome: async (taskId) => {
      const { data } = await db.from("tasks").select("status, result").eq("id", taskId).maybeSingle();
      if (!data) return null;
      const row = data as { status?: string | null; result?: unknown };
      return { status: row.status ?? null, terminal_status: terminalStatusOf(row.result) };
    },
    log,
  });

  // The gate. No DB claim unless V2 is enabled for at least one workspace.
  const gated = v2Enabled(env) && runner.ready;

  // OBSERVABILITY ONLY. Counters are recorded around the existing claim; the
  // claim itself, and every queue semantic, is untouched.
  const status = newStatus();
  let working = false;

  const claim = async (wid: string, lease: number): Promise<ClaimOutcome> => {
    status.polls++;
    status.lastPollAt = Date.now();
    if (!gated) {
      status.lastPollReason = "v2_disabled";
      return { claimed: false, reason: "v2_disabled" };
    }
    const { data, error } = await db.rpc("claim_next_lead_mission", { p_worker_id: wid, p_lease_seconds: lease });
    if (error) {
      log("[worker] claim error", error.message);
      status.lastErrorAt = Date.now();
      status.lastError = `claim_error: ${error.message}`;
      status.lastPollReason = "claim_error";
      return { claimed: false, reason: "claim_error" };
    }
    const row = firstRow(data);
    if (!row || row.claimed !== true) {
      status.lastPollReason = String(row?.reason ?? "no_eligible_mission");
      return { claimed: false, reason: String(row?.reason ?? "no_eligible_mission") };
    }
    status.claims++;
    status.lastClaimAt = Date.now();
    status.lastPollReason = "claimed";
    const mission: ClaimedMission = {
      queueId: String(row.queue_id),
      workspaceId: String(row.workspace_id),
      request: (row.request ?? {}) as Record<string, unknown>,
      taskId: (row.task_id as string | null) ?? null,
      lineageId: (row.lineage_id as string | null) ?? null,
      attempts: Number(row.attempts ?? 0),
      isResume: !!row.task_id,
      heldUntil: (row.held_until as string | null) ?? null,
    };
    return { claimed: true, mission };
  };

  const heartbeatFor = (mission: ClaimedMission) => makeHeartbeatController({
    mission, workerId, leaseSeconds: cfg.leaseSeconds, intervalMs: cfg.heartbeatIntervalMs, sleep, log,
    heartbeat: async (queueId, wid, lease) => {
      const { data, error } = await db.rpc("heartbeat_lead_mission", {
        p_queue_id: queueId, p_worker_id: wid, p_lease_seconds: lease,
      });
      if (error) return { ok: false, reason: "heartbeat_rpc_error" };
      const row = firstRow(data);
      return { ok: row?.ok === true, reason: String(row?.reason ?? "unknown") };
    },
  });

  const release = async (mission: ClaimedMission, outcome: ReleaseOutcome) => {
    const { error } = await db.rpc("release_lead_mission", {
      p_queue_id: mission.queueId, p_worker_id: workerId,
      p_status: queueStatusFor(outcome),
      p_outcome: {
        status: outcome.status, terminal: outcome.terminal, error: outcome.error ?? null,
        aborted: outcome.aborted, abort_reason: outcome.abortReason, worker_id: workerId,
        ceiling_ms: cfg.missionCeilingMs,
      },
    });
    if (error) log("[worker] release error", error.message);
  };

  // A claimed mission legitimately stops polling for as long as it runs, so the
  // health view is told — otherwise a healthy 5-minute run reports `stalled`.
  const runMission: WorkerDeps["runMission"] = async (...args) => {
    working = true;
    try { return await runner.run(...args); } finally { working = false; }
  };

  const deps: WorkerDeps = { workerId, config: cfg, claim, heartbeatFor, runMission, release, sleep, log };

  let stop = false;
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    try {
      Deno.addSignalListener(sig, () => {
        // DRAIN, NEVER ABORT. `runWorkerLoop` reads this between ticks, so a
        // mission already executing finishes and checkpoints on its own terms.
        // Being killed mid-mission would also be safe — the lease lapses and the
        // row is reclaimable — but it wastes work already paid for.
        log(`[worker] ${sig} — draining`);
        status.draining = true;
        stop = true;
      });
    } catch { /* unsupported platform */ }
  }

  // PORT is the platform's contract. Absent locally ⇒ no socket, no extra
  // permission, behaviour identical to before.
  const port = Number(env("PORT"));
  const health = Number.isFinite(port) && port > 0
    ? startHealthServer(port, () => healthView({
      status, workerId, gated, idlePollMs: cfg.idlePollMs, working,
      config: {
        lease_seconds: cfg.leaseSeconds,
        heartbeat_interval_ms: cfg.heartbeatIntervalMs,
        mission_ceiling_ms: cfg.missionCeilingMs,
        idle_poll_ms: cfg.idlePollMs,
      },
    }), log)
    : null;

  log("[worker] starting", { workerId, gated, config: cfg });
  if (!gated) log("[worker] V2 disabled (no allowlisted workspace) — idling, will not claim any mission");
  try {
    await runWorkerLoop(deps, () => stop);
  } finally {
    await health?.close();
    log("[worker] stopped", { polls: status.polls, claims: status.claims });
  }
}

if (import.meta.main) await main();
