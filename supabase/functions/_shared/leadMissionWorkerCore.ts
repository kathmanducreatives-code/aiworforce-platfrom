// LEAD MISSION WORKER — PURE LIFECYCLE. No Deno, no DB, no network: every effect
// is injected, so the whole claim → heartbeat → run → release cycle is exercised
// in a unit test with zero infrastructure (mirrors the rest of _shared).
//
// WHAT THE WORKER OWNS: the execution LIFECYCLE of one QUEUE ROW — claim it, keep
// its lease (and, once bound, its task and lineage lease) alive while work is in
// flight, run it, release. It owns no quota, no qualification, no evidence and no
// money logic; those stay inside run-agent's handler, which `runMission` calls.
//
// THREE INVARIANTS THIS FILE ENFORCES:
//   1. The lease is renewed CONCURRENTLY while runMission awaits a provider, by a
//      heartbeat that runs independently of anything the run is doing.
//   2. If the heartbeat loses ownership or the mission/lineage is cancelled, the
//      run is signalled — the runner revokes the run's deadline, so no new paid
//      work begins and the engine checkpoints through its existing reserve logic.
//   3. The mission ceiling is NOT a worker kill. It is the run's deadline budget,
//      so the EXISTING deadline machinery stops, checkpoints and ends resumable.

export interface ClaimedMission {
  queueId: string;
  workspaceId: string;
  /** Orchestrate's kickoff body, as queued. */
  request: Record<string, unknown>;
  /** Null until the handler has created the task (a first run). */
  taskId: string | null;
  lineageId: string | null;
  attempts: number;
  /** A previous run already bound a task — this run resumes it. */
  isResume: boolean;
  heldUntil: string | null;
}

export type ClaimOutcome =
  | { claimed: true; mission: ClaimedMission }
  | { claimed: false; reason: string };

export interface HeartbeatOutcome { ok: boolean; reason: string }

export interface MissionRunControl {
  /** The run's deadline budget. */
  executionBudgetMs: number;
  /** Aborted when the worker loses ownership or the mission/lineage is cancelled. */
  signal: AbortSignal;
}

export interface MissionOutcome {
  status: string;
  /** true ⇒ the run reached a terminal status; false ⇒ resumable. */
  terminal: boolean;
  error?: string;
}

export interface ReleaseOutcome extends MissionOutcome {
  aborted: boolean;
  abortReason: string | null;
}

/** Renews leases on a timer and reports loss. Default impl below; tests inject a fake. */
export interface HeartbeatController {
  start(onLost: (reason: string) => void): void;
  stop(): void;
}

export interface WorkerConfig {
  leaseSeconds: number;
  heartbeatIntervalMs: number;
  missionCeilingMs: number;
  idlePollMs: number;
}

export const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  // Matches the lineage lease. Renewed every 60s: well inside it, and well inside
  // the 5-minute quiet window `tasks_sweep_stuck_runs` treats as a dead run.
  leaseSeconds: 180,
  heartbeatIntervalMs: 60_000,
  // See LEAD_WORKER_DEFAULT_RUNTIME_MS / _MAX_RUNTIME_CAP_MS in leadExecutionEngine.ts.
  missionCeilingMs: 300_000,
  idlePollMs: 5_000,
};

export interface WorkerDeps {
  workerId: string;
  config: WorkerConfig;
  claim: (workerId: string, leaseSeconds: number) => Promise<ClaimOutcome>;
  /** Builds the heartbeat controller for a claimed mission (default factory provided). */
  heartbeatFor: (mission: ClaimedMission) => HeartbeatController;
  runMission: (mission: ClaimedMission, ctl: MissionRunControl) => Promise<MissionOutcome>;
  release: (mission: ClaimedMission, outcome: ReleaseOutcome) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  log?: (msg: string, meta?: unknown) => void;
}

/**
 * Default heartbeat: renews via `heartbeat` every interval; calls onLost on the
 * first !ok. The heartbeat is keyed on the QUEUE ROW — the database resolves the
 * task and lineage bound to it, so it renews them without the worker needing to
 * know their ids at the moment the run starts.
 */
export function makeHeartbeatController(args: {
  mission: ClaimedMission;
  workerId: string;
  leaseSeconds: number;
  intervalMs: number;
  heartbeat: (queueId: string, workerId: string, leaseSeconds: number) => Promise<HeartbeatOutcome>;
  sleep: (ms: number) => Promise<void>;
  log?: (msg: string, meta?: unknown) => void;
}): HeartbeatController {
  let running = false;
  return {
    start(onLost) {
      running = true;
      (async () => {
        while (running) {
          await args.sleep(args.intervalMs);
          if (!running) return;
          let r: HeartbeatOutcome;
          try {
            r = await args.heartbeat(args.mission.queueId, args.workerId, args.leaseSeconds);
          } catch (e) {
            r = { ok: false, reason: `heartbeat_error:${(e as Error)?.name ?? "err"}` };
          }
          if (!r.ok) {
            args.log?.("[worker] lease lost", { queue: args.mission.queueId, reason: r.reason });
            running = false;
            onLost(r.reason);
            return;
          }
        }
      })();
    },
    stop() { running = false; },
  };
}

/** Run ONE already-claimed mission: heartbeat around it, signal on loss, release once. */
export async function runClaimedMission(
  deps: WorkerDeps,
  mission: ClaimedMission,
): Promise<ReleaseOutcome> {
  const ac = new AbortController();
  let abortReason: string | null = null;
  const hb = deps.heartbeatFor(mission);
  hb.start((reason) => { abortReason = reason; ac.abort(); });

  let outcome: MissionOutcome;
  try {
    outcome = await deps.runMission(mission, {
      executionBudgetMs: deps.config.missionCeilingMs,
      signal: ac.signal,
    });
  } catch (e) {
    outcome = { status: "worker_error", terminal: false, error: String((e as Error)?.message ?? e) };
  } finally {
    hb.stop();
  }

  const release: ReleaseOutcome = {
    ...outcome,
    aborted: ac.signal.aborted,
    abortReason,
  };
  await deps.release(mission, release);
  deps.log?.("[worker] mission released", {
    queue: mission.queueId, status: release.status, terminal: release.terminal,
    aborted: release.aborted, abortReason: release.abortReason,
  });
  return release;
}

/** Claim at most one mission and run it. Returns whether a mission was claimed. */
export async function workerTick(deps: WorkerDeps): Promise<{ claimed: boolean; reason?: string }> {
  const c = await deps.claim(deps.workerId, deps.config.leaseSeconds);
  if (!c.claimed) return { claimed: false, reason: c.reason };
  deps.log?.("[worker] claimed mission", { queue: c.mission.queueId, resume: c.mission.isResume });
  await runClaimedMission(deps, c.mission);
  return { claimed: true };
}

/** Poll loop: claim+run while there is work; sleep when idle; stop when asked. */
export async function runWorkerLoop(
  deps: WorkerDeps,
  shouldStop: () => boolean,
): Promise<void> {
  while (!shouldStop()) {
    const tick = await workerTick(deps);
    if (!tick.claimed && !shouldStop()) {
      await deps.sleep(deps.config.idlePollMs);
    }
  }
}
