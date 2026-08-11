// THE PLAYBOOK IS THE BOUNDARY BETWEEN THE MISSION AND EXECUTION.
//
// `selectResearchPlaybooks` answers "HOW do we research this?". This module is
// the next question and the last one before money moves: "is the plan about to
// execute the research shape that was selected?"
//
// WHY A SEPARATE CHECK AT ALL.
//
// `buildCapabilityGraph` chooses an entry capability from a MIX of mission
// fields — required_capabilities, directives.source_strategy, signals, supplied
// companies, company stages. That mix predates the playbook vocabulary and can
// legitimately disagree with it. The clearest case: a mission whose strategy is
// `hiring` and which also carries a funding signal, with no compiled
// capabilities, enters at `funding_signal_discovery` — a capability the engine
// SKIPS. Today that run reports success having discovered nothing, because
// nothing compares what was selected against what was scheduled.
//
// This module makes that comparison. It authorises, it does not route: the graph
// still builds the plan, and the answer here is only ever "the plan matches the
// selected playbook" or "it does not, and this must not spend".
//
// ── SCOPE: HIRING ONLY, DELIBERATELY ────────────────────────────────────────
//
// `hiring` is the one research shape with a fully traced executable path —
// engine branch, catalogue card, verified input compiler, for every capability
// it needs. `funding`, `social`, `news` and `multi_signal` have no such path, so
// this phase does not authorise, block or otherwise change them: for those
// missions `applies` is false and execution behaves exactly as it did before.
// That is a scope decision, not an oversight — see the phase docs.
//
// PURE. No network, provider, model or database access. It runs nothing.

import type { CapabilityId, CapabilityPlan } from "./leadCapabilityGraph.ts";
import type { LeadMissionV1 } from "./leadMission.ts";
import {
  RESEARCH_PLAYBOOKS, isEngineDriven,
  type ResearchPlaybookId, type ResearchPlaybookSelection,
} from "./leadResearchPlaybooks.ts";

export const PLAYBOOK_EXECUTION_VERSION = "lead-playbook-execution-v1" as const;

/**
 * Entry capabilities a DECIDED MISSION FIELD forces, whatever the shape.
 *
 * These are not the playbook's own entries and they are not a loophole: each is
 * demanded by a field the mission settled, and `buildCapabilityGraph` gives each
 * of them precedence over shape-based routing for exactly that reason. A hiring
 * mission that supplied its own companies still skips discovery; one that asked
 * for job listings still returns job listings.
 *
 * Anything NOT in this map and not in the playbook's own discovery set is a
 * genuine disagreement between the selected shape and the scheduled plan.
 */
function missionForcedEntry(
  mission: Pick<LeadMissionV1, "company_profile" | "requested_output">,
): { capability: CapabilityId; because: string } | null {
  if ((mission.company_profile?.known_companies ?? []).length > 0) {
    return {
      capability: "known_company_resolution",
      because: "the mission supplies its own companies, so discovery is skipped",
    };
  }
  if (mission.requested_output === "job_listings") {
    return {
      capability: "job_discovery",
      because: "the requested output is job listings, so postings are the answer",
    };
  }
  return null;
}

export type PlaybookAuthorizationCode =
  /** The scheduled entry is neither the playbook's nor forced by the mission. */
  | "entry_capability_not_in_playbook"
  /** A capability the playbook requires is scheduled but the engine skips it. */
  | "required_capability_not_engine_driven"
  /** The plan schedules no capability at all. */
  | "empty_plan";

export interface PlaybookAuthorization {
  version: typeof PLAYBOOK_EXECUTION_VERSION;
  /**
   * Does this phase's boundary govern the run?
   *
   * False for every mission whose selected shape is not the supported hiring
   * playbook. Those runs are untouched: the graph decides as it always has.
   */
  applies: boolean;
  playbook: ResearchPlaybookId | null;
  /** The plan's entry, and why the playbook accepts or rejects it. */
  entry_capability: CapabilityId | null;
  entry_source: "playbook_discovery" | "mission_forced" | "unauthorized" | null;
  /**
   * Capabilities the playbook requires that the plan actually schedules, with
   * their executability. This is what Phase 3 hands to the engine.
   */
  authorized_capabilities: Array<{ capability: CapabilityId; engine_driven: boolean }>;
  authorized: boolean;
  violations: Array<{ code: PlaybookAuthorizationCode; message: string }>;
  reason: string;
}

/**
 * May this capability plan execute the selected research playbook?
 *
 * Governs ONLY a run whose selected, supported shape is `hiring`. Everything
 * else returns `applies: false` and is left exactly as it was.
 *
 * Reads decided Mission fields and the plan the graph already built. It touches
 * no raw text, runs no parser, and invokes nothing.
 */
export function authorizePlaybookExecution(
  selection: ResearchPlaybookSelection,
  plan: CapabilityPlan | null,
  mission: Pick<LeadMissionV1, "company_profile" | "requested_output">,
): PlaybookAuthorization {
  const base: Omit<PlaybookAuthorization, "applies" | "authorized" | "reason"> = {
    version: PLAYBOOK_EXECUTION_VERSION,
    playbook: null,
    entry_capability: plan?.entry_capability ?? null,
    entry_source: null,
    authorized_capabilities: [],
    violations: [],
  };

  // ── DOES THE BOUNDARY GOVERN THIS RUN? ───────────────────────────────────
  //
  // Only when hiring is the shape that was selected AND is runnable. A mission
  // that also names an unsupported shape is not governed here: deciding what to
  // do about a half-answerable request is the next phase's question, and
  // guessing at it now would change behaviour this phase promised not to touch.
  const governed = selection.runnable.length === 1 &&
    selection.runnable[0] === "hiring" &&
    selection.blocked.length === 0;

  if (!governed) {
    return {
      ...base,
      applies: false,
      authorized: true,
      reason: selection.runnable.includes("hiring")
        ? "hiring was selected alongside other shapes; this phase governs a " +
          "hiring-only selection and leaves mixed ones to the existing route"
        : `no supported hiring playbook was selected (${selection.reason})`,
    };
  }

  if (!plan || plan.steps.length === 0) {
    return {
      ...base,
      applies: true,
      playbook: "hiring",
      authorized: false,
      violations: [{ code: "empty_plan", message: "the capability plan has no steps" }],
      reason: "the hiring playbook was selected but no capability plan was built",
    };
  }

  const spec = RESEARCH_PLAYBOOKS.hiring;
  const violations: PlaybookAuthorization["violations"] = [];

  // ── THE ENTRY ─────────────────────────────────────────────────────────────
  const entry = plan.entry_capability;
  const forced = missionForcedEntry(mission);
  let entry_source: PlaybookAuthorization["entry_source"];

  if (spec.discovery_capabilities.includes(entry)) {
    entry_source = "playbook_discovery";
  } else if (forced && forced.capability === entry) {
    entry_source = "mission_forced";
  } else {
    entry_source = "unauthorized";
    violations.push({
      code: "entry_capability_not_in_playbook",
      message:
        `the plan enters at "${entry}", which is neither a hiring-playbook ` +
        `discovery capability (${spec.discovery_capabilities.join(", ")}) nor ` +
        `forced by a decided mission field — the selected shape and the ` +
        `scheduled plan disagree`,
    });
  }

  // ── THE CAPABILITIES THE PLAYBOOK REQUIRES ───────────────────────────────
  //
  // Only those the plan actually schedules. The graph decides whether a mission
  // needs paid hiring verification at all (an embedded-evidence mission does
  // not), so its ABSENCE is a legitimate plan — what is not legitimate is
  // scheduling a required capability the engine will skip.
  const scheduled = new Set(plan.steps.map((s) => s.capability));
  const required = [...spec.discovery_capabilities, ...spec.proving_capabilities]
    .filter((c) => scheduled.has(c));

  const authorized_capabilities = required.map((capability) => ({
    capability, engine_driven: isEngineDriven(capability),
  }));
  for (const c of authorized_capabilities) {
    if (!c.engine_driven) {
      violations.push({
        code: "required_capability_not_engine_driven",
        message:
          `the plan schedules "${c.capability}", which the hiring playbook ` +
          `requires and the capability engine does not drive — it would report ` +
          `skipped_no_input and the run would produce nothing from it`,
      });
    }
  }

  const authorized = violations.length === 0;
  return {
    version: PLAYBOOK_EXECUTION_VERSION,
    applies: true,
    playbook: "hiring",
    entry_capability: entry,
    entry_source,
    authorized_capabilities,
    authorized,
    violations,
    reason: authorized
      ? `the plan executes the hiring playbook: entry "${entry}" ` +
        `(${entry_source === "mission_forced" ? forced!.because : "a hiring discovery capability"})` +
        (authorized_capabilities.length
          ? `, requiring ${authorized_capabilities.map((c) => c.capability).join(", ")}`
          : "")
      : violations.map((v) => v.message).join(" | "),
  };
}

/** Compact shape for logs and audit rows. Invokes nothing. */
export function playbookAuthorizationSummary(
  a: PlaybookAuthorization,
): Record<string, unknown> {
  return {
    version: a.version,
    applies: a.applies,
    authorized: a.authorized,
    playbook: a.playbook,
    entry_capability: a.entry_capability,
    entry_source: a.entry_source,
    capabilities: a.authorized_capabilities.map(
      (c) => `${c.capability}:${c.engine_driven ? "driven" : "SKIPPED"}`,
    ),
    violations: a.violations.map((v) => v.code),
    reason: a.reason,
  };
}
