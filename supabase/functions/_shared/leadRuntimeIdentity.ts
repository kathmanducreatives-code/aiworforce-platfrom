// WHICH CODE PLANNED THIS TASK, AND WHICH CODE EXECUTED IT.
//
// Planning and execution live in DIFFERENT Edge Functions — `compileLeadMission`
// runs in pilot-chat, the capability engine runs in run-agent — and Supabase
// bundles `_shared` into each of them separately at deploy time. So the two can
// legitimately be running different builds, and on 2026-08-07 they were: a
// pilot-chat bundle from Aug 6 handed a mission to a run-agent bundle from
// Aug 7. Half a day went into inferring that from behaviour, because no task
// row recorded it.
//
// SUPABASE'S `VERSION` IS NOT A BUILD IDENTITY. `supabase secrets set`
// increments it for every function without deploying code, which is precisely
// how a stale bundle read 94 -> 95 -> 96 while its source never moved. The
// identity here comes from git, baked into the bundle at deploy time.
//
// THE CONTRACT VERSION IS SEPARATE FROM THE SHA ON PURPOSE. Requiring planner
// and executor to share a git SHA would forbid deploying one without the other,
// which is a normal and safe thing to do. What must NOT differ is the shape of
// what they exchange: the mission, its directives, what the capability graph
// expects, and what the preflight enforces. That is what this version tracks.
//
// PURE. No network, provider, model or database access.

import { BUILD_INFO } from "./buildInfo.ts";

/**
 * The lead-intelligence contract generation.
 *
 * BUMP THIS when the planner/executor exchange changes shape — a new required
 * mission field, a directives restructure, a capability-graph expectation the
 * executor relies on, or a preflight rule that needs data the planner must now
 * supply. Do NOT bump it for behaviour changes that leave the exchange intact;
 * that would block safe independent deploys for no reason.
 *
 *   v1  LeadMissionV1 + directives + capability graph + paid preflight
 *       + multi-round controller.
 */
export const LEAD_INTELLIGENCE_CONTRACT_VERSION = "v1" as const;

/** Contracts this executor still understands, oldest first. */
export const SUPPORTED_CONTRACT_VERSIONS: readonly string[] = ["v1"];

export type LeadRuntimeRole = "planner" | "executor";

export interface LeadRuntimeIdentity {
  role: LeadRuntimeRole;
  /** The Edge Function this code is running inside. */
  function: string;
  git_sha: string;
  git_short: string;
  /** When the bundle was BUILT, i.e. when the deploy script generated it. */
  build_timestamp: string;
  lead_intelligence_contract_version: string;
  /** True when the bundle was built from a dirty working tree. */
  dirty: boolean;
}

/**
 * Identify the code that is running right now.
 *
 * Everything except the role comes from `buildInfo.ts`, which the deploy script
 * regenerates immediately before deploying. Because `_shared` is bundled per
 * function, each deployed function carries its own copy — which is exactly the
 * property needed: the bundle knows which build it is.
 */
export function runtimeIdentity(
  role: LeadRuntimeRole, fn: string,
): LeadRuntimeIdentity {
  return {
    role,
    function: fn,
    git_sha: BUILD_INFO.git_sha,
    git_short: BUILD_INFO.git_sha.slice(0, 8),
    build_timestamp: BUILD_INFO.build_timestamp,
    lead_intelligence_contract_version: LEAD_INTELLIGENCE_CONTRACT_VERSION,
    dirty: BUILD_INFO.dirty,
  };
}

export type ContractCompatibility =
  | { ok: true; planner_version: string; executor_version: string; same_build: boolean }
  | { ok: false; reason: "unknown_planner_contract" | "unsupported_planner_contract";
      planner_version: string | null; executor_version: string; detail: string };

/**
 * May this executor act on that planner's output?
 *
 * A MISSING VERSION IS NOT TREATED AS COMPATIBLE. A mission compiled before
 * this field existed came from a bundle that predates the whole guard, and
 * assuming it speaks the current contract is the assumption that costs money.
 * It fails closed and the run is re-planned.
 */
export function checkContractCompatibility(
  plannerVersion: string | null | undefined,
  plannerSha?: string | null,
): ContractCompatibility {
  const executor = LEAD_INTELLIGENCE_CONTRACT_VERSION;
  const planner = typeof plannerVersion === "string" ? plannerVersion.trim() : "";

  if (!planner) {
    return {
      ok: false, reason: "unknown_planner_contract",
      planner_version: null, executor_version: executor,
      detail: "the mission carries no contract version, so it was compiled by a " +
        "build that predates this guard; it cannot be assumed compatible",
    };
  }
  if (!SUPPORTED_CONTRACT_VERSIONS.includes(planner)) {
    return {
      ok: false, reason: "unsupported_planner_contract",
      planner_version: planner, executor_version: executor,
      detail: `planner contract "${planner}" is not among the versions this ` +
        `executor supports (${SUPPORTED_CONTRACT_VERSIONS.join(", ")})`,
    };
  }
  return {
    ok: true, planner_version: planner, executor_version: executor,
    // Informational only. Different builds speaking the same contract is a
    // supported, normal state — not a warning.
    same_build: !!plannerSha && plannerSha === BUILD_INFO.git_sha,
  };
}

/** The pair persisted on a task, so one row answers "which code did this?". */
export interface LeadRuntimeRecord {
  planner_runtime: LeadRuntimeIdentity | null;
  executor_runtime: LeadRuntimeIdentity;
  contract: ContractCompatibility;
}
