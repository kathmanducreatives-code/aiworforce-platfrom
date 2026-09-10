// LEAD MISSION V2 WORKER — long-running Deno process (NOT an edge function).
//
// Run: deno run --allow-env --allow-net worker/main.ts
//
// It claims one eligible V2 lead mission at a time, keeps its lease alive with a
// concurrent heartbeat, runs it through the injected runner with a configurable
// ceiling, and releases. State lives entirely in Supabase; the worker holds no
// durable state of its own.
//
// DISABLED BY DEFAULT AND DOUBLE-GATED. It will not claim a mission unless BOTH
// (a) a workspace is allowlisted (LEAD_V2_WORKER_WORKSPACES non-empty) AND
// (b) the runner reports ready. Step 2 ships the runner as not-ready, so this
// process simply idles: it connects, logs "disabled", and polls nothing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  runWorkerLoop, makeHeartbeatController,
  type WorkerDeps, type WorkerConfig, type ClaimOutcome, type ClaimedMission, type ReleaseOutcome,
  DEFAULT_WORKER_CONFIG,
} from "../supabase/functions/_shared/leadMissionWorkerCore.ts";
import { v2Enabled } from "../supabase/functions/_shared/leadExecutionEngine.ts";
import { LEAD_MISSION_RUNNER } from "./leadMissionRunner.ts";

const env = (k: string) => Deno.env.get(k);
const num = (k: string, d: number) => { const v = Number(env(k)); return Number.isFinite(v) && v > 0 ? v : d; };

function config(): WorkerConfig {
  return {
    leaseSeconds: num("LEAD_WORKER_LEASE_SECONDS", DEFAULT_WORKER_CONFIG.leaseSeconds),
    heartbeatIntervalMs: num("LEAD_WORKER_HEARTBEAT_MS", DEFAULT_WORKER_CONFIG.heartbeatIntervalMs),
    missionCeilingMs: num("LEAD_WORKER_MAX_RUNTIME_MS", DEFAULT_WORKER_CONFIG.missionCeilingMs),
    idlePollMs: num("LEAD_WORKER_IDLE_POLL_MS", DEFAULT_WORKER_CONFIG.idlePollMs),
  };
}

function main() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) { console.error("[worker] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required"); Deno.exit(1); }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const workerId = env("LEAD_WORKER_ID") ?? crypto.randomUUID();
  const cfg = config();
  const log = (msg: string, meta?: unknown) => console.log(msg, meta ?? "");

  // The claim gate. No DB call unless V2 is enabled AND the runner is ready, so a
  // not-ready runner (Step 2) can never pick up or busy-loop on a mission.
  const gated = v2Enabled(env) && LEAD_MISSION_RUNNER.ready;
  const claim = async (wid: string, lease: number): Promise<ClaimOutcome> => {
    if (!gated) return { claimed: false, reason: "v2_disabled_or_runner_not_ready" };
    const { data, error } = await db.rpc("claim_next_lead_mission", { p_worker_id: wid, p_lease_seconds: lease });
    if (error) { log("[worker] claim error", error.message); return { claimed: false, reason: "claim_error" }; }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.claimed) return { claimed: false, reason: row?.reason ?? "no_eligible_mission" };
    const mission: ClaimedMission = {
      taskId: row.task_id, workspaceId: row.workspace_id, lineageId: row.lineage_id,
      checkpointVersion: row.checkpoint_version, isResume: row.is_resume, heldUntil: row.held_until,
    };
    return { claimed: true, mission };
  };

  const heartbeatFor = (mission: ClaimedMission) => makeHeartbeatController({
    mission, workerId, leaseSeconds: cfg.leaseSeconds, intervalMs: cfg.heartbeatIntervalMs, sleep,
    log,
    heartbeat: async (taskId, wid, lease) => {
      const { data, error } = await db.rpc("heartbeat_lead_mission", {
        p_task_id: taskId, p_worker_id: wid, p_lease_seconds: lease,
      });
      if (error) return { ok: false, reason: "heartbeat_rpc_error" };
      const row = Array.isArray(data) ? data[0] : data;
      return { ok: !!row?.ok, reason: row?.reason ?? "unknown" };
    },
  });

  const release = async (mission: ClaimedMission, outcome: ReleaseOutcome) => {
    // Terminal ⇒ 'complete'; resumable/aborted/error ⇒ 'ready' (re-claimable with
    // its checkpoint). The controller/finalizer already wrote the authoritative
    // terminal_status into tasks.result; this only frees the lease + sets status.
    const rowStatus = outcome.terminal && !outcome.aborted ? "complete" : "ready";
    const { error } = await db.rpc("release_sourcing_continuation", {
      p_task_id: mission.taskId, p_workspace_id: mission.workspaceId,
      p_claim_id: workerId, p_row_status: rowStatus,
    });
    if (error) log("[worker] release error", error.message);
  };

  const deps: WorkerDeps = { workerId, config: cfg, claim, heartbeatFor, runMission: LEAD_MISSION_RUNNER.run, release, sleep, log };

  let stop = false;
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    try { Deno.addSignalListener(sig, () => { log(`[worker] ${sig} — draining`); stop = true; }); } catch { /* signal not supported */ }
  }

  log("[worker] starting", { workerId, gated, runnerReady: LEAD_MISSION_RUNNER.ready, config: cfg });
  if (!gated) log("[worker] V2 disabled or runner not ready — idling, will not claim any mission");
  return runWorkerLoop(deps, () => stop);
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

if (import.meta.main) await main();
