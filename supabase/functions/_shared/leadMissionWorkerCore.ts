// LEAD MISSION WORKER — PURE LIFECYCLE. No Deno, no DB, no network: every effect
// is injected, so the whole claim → heartbeat → run → release cycle is exercised
// in a unit test with zero infrastructure (mirrors the rest of _shared).
//
// WHAT THE WORKER OWNS: the execution LIFECYCLE only — claim one mission, keep
// its lease alive while work is in flight, run it, release. It owns no quota, no
// qualification, no evidence, no money logic; those stay in the injected
// `runMission` (the existing controller). The worker cannot decide what a company
// is or whether to spend — it only decides when to start, renew and stop.
//
// THREE INVARIANTS THIS FILE ENFORCES:
//   1. The lease is renewed CONCURRENTLY while runMission awaits a provider, by a
//      heartbeat that runs independently of the batch loop (refinement 2).
//   2. If the heartbeat loses ownership or the lineage is cancelled, no new paid
//      work begins — the run is aborted via the signal runMission observes.
//   3. The mission ceiling is NOT a worker kill. It is passed to runMission as
//      executionBudgetMs so the EXISTING deadline machinery stops, checkpoints,
//      and returns a truthful resumable reason (refinement 3).

export interface ClaimedMission {
  taskId: string;
  workspaceId: string;
  lineageId: string;
  checkpointVersion: number;
  isResume: boolean;
  heldUntil: string | null;
}

export type ClaimOutcome =
  | { claimed: true; mission: ClaimedMission }
  | { claimed: false; reason: string };

export interface HeartbeatOutcome { ok: boolean; reason: string }

export interface MissionRunControl {
  /** Passed straight through to the controller's executionBudget. */
  executionBudgetMs: number;
  /** Aborted when the worker loses ownership or the lineage is cancelled. */
  signal: AbortSignal;
}

export interface MissionOutcome {
  status: string;
  /** true ⇒ the mission reached a terminal status; false ⇒ resumable. */
  terminal: boolean;
  error?: string;
}

export interface ReleaseOutcome extends MissionOutcome {
  aborted: boolean;
  abortReason: string | null;
}

/** Renews the lease on a timer and reports loss. Default impl below; tests inject a fake. */
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
  leaseSeconds: 180,
  heartbeatIntervalMs: 60_000, // renew at one third of the 180s lease
  // Long-running is not unlimited. Conservative initial ceiling based on existing
  // provider behaviour (a multi-round sourcing run rarely needs more than a few
  // minutes of actual provider time). Overridable via LEAD_WORKER_MAX_RUNTIME_MS.
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

/** Default heartbeat: renews via `heartbeat` every interval; calls onLost on first !ok. */
export function makeHeartbeatController(args: {
  mission: ClaimedMission;
  workerId: string;
  leaseSeconds: number;
  intervalMs: number;
  heartbeat: (taskId: string, workerId: string, leaseSeconds: number) => Promise<HeartbeatOutcome>;
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
            r = await args.heartbeat(args.mission.taskId, args.workerId, args.leaseSeconds);
          } catch (e) {
            r = { ok: false, reason: `heartbeat_error:${(e as Error)?.name ?? "err"}` };
          }
          if (!r.ok) {
            args.log?.("[worker] lease lost", { task: args.mission.taskId, reason: r.reason });
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

/** Run ONE already-claimed mission: heartbeat around it, abort on loss, release once. */
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
    task: mission.taskId, status: release.status, terminal: release.terminal,
    aborted: release.aborted, abortReason: release.abortReason,
  });
  return release;
}

/** Claim at most one mission and run it. Returns whether a mission was claimed. */
export async function workerTick(deps: WorkerDeps): Promise<{ claimed: boolean; reason?: string }> {
  const c = await deps.claim(deps.workerId, deps.config.leaseSeconds);
  if (!c.claimed) return { claimed: false, reason: c.reason };
  deps.log?.("[worker] claimed mission", { task: c.mission.taskId, resume: c.mission.isResume });
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
