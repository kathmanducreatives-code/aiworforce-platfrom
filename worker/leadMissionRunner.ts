// THE MISSION RUNNER SEAM — the ONE place real execution plugs in.
//
// The worker lifecycle (claim, heartbeat, ceiling, release) is complete and
// tested. What is NOT yet wired is reconstructing run-agent's full runtime
// context inside a worker process: the intent compile, Company Brain policy,
// sequential sources, persistence adapters, broadening planner and the
// classification binding that run-agent assembles before calling
// `buildCompanyFirstRuntimeDeps`. That is a deliberate, separate step.
//
// UNTIL THEN `ready` is false. The worker REFUSES TO CLAIM while the runner is
// not ready (see worker/main.ts), so no mission is ever picked up and this stub
// is never executed in production. If it somehow were, it performs NO paid work
// and returns a resumable outcome — the mission is released back as `ready` and
// simply waits, it is never corrupted or charged.
//
// STEP 3 will replace this file's `run` with real deps assembly:
//   1. load the queued mission spec from tasks.result->'lead_mission_v2'
//   2. build the real invokers / stateStore / durableIdempotency / planner
//   3. deps = buildCompanyFirstRuntimeDeps({ ...those..., executionBudget: ceiling })
//   4. return executeRunAgentCompanyFirstSourcing(deps) mapped to MissionOutcome
// and set `ready = true`.

import type {
  ClaimedMission, MissionOutcome, MissionRunControl,
} from "../supabase/functions/_shared/leadMissionWorkerCore.ts";

export interface LeadMissionRunner {
  /** The worker will not claim any mission unless this is true. */
  ready: boolean;
  run: (mission: ClaimedMission, ctl: MissionRunControl) => Promise<MissionOutcome>;
}

export const LEAD_MISSION_RUNNER: LeadMissionRunner = {
  ready: false,
  run: (_mission, _ctl) =>
    Promise.resolve({
      status: "v2_runner_not_implemented",
      terminal: false, // resumable — never mark a mission done without doing the work
      error: "LeadMission V2 runner is not wired yet (Step 3); worker must not claim.",
    }),
};
