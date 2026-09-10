// Worker lifecycle invariants, proven with injected mocks (no DB, no timers).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runClaimedMission, workerTick, makeHeartbeatController,
  type WorkerDeps, type ClaimedMission, type HeartbeatController,
} from "../../../supabase/functions/_shared/leadMissionWorkerCore.ts";

const mission: ClaimedMission = {
  queueId: "q1", workspaceId: "ws-1", request: { plan_id: "p" },
  taskId: null, lineageId: null, attempts: 1, isResume: false, heldUntil: null,
};
const cfg = { leaseSeconds: 180, heartbeatIntervalMs: 60_000, missionCeilingMs: 123_456, idlePollMs: 5_000 };
const noHb: HeartbeatController = { start() {}, stop() {} };

function baseDeps(over: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    workerId: "w1", config: cfg,
    claim: async () => ({ claimed: true, mission }),
    heartbeatFor: () => noHb,
    runMission: async () => ({ status: "quota_met", terminal: true }),
    release: async () => {},
    sleep: async () => {},
    ...over,
  };
}

Deno.test("happy path: ceiling reaches the run as its budget; released exactly once; not aborted", async () => {
  let budget = -1; let releases = 0;
  const deps = baseDeps({
    runMission: async (_m, ctl) => { budget = ctl.executionBudgetMs; return { status: "quota_met", terminal: true }; },
    release: async () => { releases++; },
  });
  const r = await runClaimedMission(deps, mission);
  assertEquals(budget, 123_456);
  assertEquals(releases, 1);
  assertEquals(r.aborted, false);
  assertEquals(r.terminal, true);
});

Deno.test("ordering: heartbeat starts before run, stops before release", async () => {
  const ev: string[] = [];
  const hb: HeartbeatController = { start() { ev.push("hb_start"); }, stop() { ev.push("hb_stop"); } };
  const deps = baseDeps({
    heartbeatFor: () => hb,
    runMission: async () => { ev.push("run"); return { status: "quota_met", terminal: true }; },
    release: async () => { ev.push("release"); },
  });
  await runClaimedMission(deps, mission);
  assertEquals(ev, ["hb_start", "run", "hb_stop", "release"]);
});

Deno.test("heartbeat loss signals the run; release records the reason", async () => {
  let onLost: ((r: string) => void) | null = null;
  const hb: HeartbeatController = { start(cb) { onLost = cb; }, stop() {} };
  const deps = baseDeps({
    heartbeatFor: () => hb,
    runMission: async (_m, ctl) => {
      onLost!("lineage_cancelled");
      await Promise.resolve();
      return { status: ctl.signal.aborted ? "continuation_required" : "quota_met", terminal: !ctl.signal.aborted };
    },
  });
  const r = await runClaimedMission(deps, mission);
  assert(r.aborted);
  assertEquals(r.abortReason, "lineage_cancelled");
  assertEquals(r.terminal, false);
});

Deno.test("a throwing run still releases, resumable", async () => {
  let released: unknown = null;
  const deps = baseDeps({
    runMission: async () => { throw new Error("boom"); },
    release: async (_m, o) => { released = o; },
  });
  const r = await runClaimedMission(deps, mission);
  assertEquals(r.terminal, false);
  assertEquals(r.status, "worker_error");
  assert(released !== null);
});

Deno.test("workerTick reports idle when nothing is claimable", async () => {
  const deps = baseDeps({ claim: async () => ({ claimed: false, reason: "no_eligible_mission" }) });
  const t = await workerTick(deps);
  assertEquals(t.claimed, false);
  assertEquals(t.reason, "no_eligible_mission");
});

Deno.test("heartbeat controller renews by QUEUE ROW, then reports loss on first !ok", async () => {
  let lost: string | null = null;
  const seen: string[] = [];
  let resolveDone!: () => void;
  const done = new Promise<void>((res) => { resolveDone = res; });
  const seq = [{ ok: true, reason: "renewed" }, { ok: false, reason: "ownership_lost" }];
  const ctl = makeHeartbeatController({
    mission, workerId: "w1", leaseSeconds: 180, intervalMs: 0,
    heartbeat: async (queueId) => { seen.push(queueId); return seq[Math.min(seen.length - 1, seq.length - 1)]; },
    sleep: () => Promise.resolve(),
  });
  ctl.start((r) => { lost = r; resolveDone(); });
  await done;
  ctl.stop();
  assertEquals(lost, "ownership_lost");
  assert(seen.length >= 2, "must have renewed at least once before losing");
  assert(seen.every((q) => q === "q1"), "the heartbeat is keyed on the queue row");
});
