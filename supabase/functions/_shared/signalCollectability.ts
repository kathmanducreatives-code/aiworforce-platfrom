// CAN THIS SIGNAL ACTUALLY BE COLLECTED, FOR THIS KIND OF SUBJECT?
//
// ── THE QUESTION NOBODY WAS ASKING ──────────────────────────────────────────
//
// A monitoring subject naming `funding`, `expansion`, `product_launch`,
// `technology` or `post` compiled cleanly, produced a valid capability plan, and
// ran. It resolved the company's identity, paid to enrich it, reached
// qualification — and proved nothing, because the capability that would have
// established the signal is either not scheduled for that subject kind or not
// driven by the engine at all.
//
// The run reported `ok`. The feed stayed empty. Nothing said why. That is the
// exact failure the architecture keeps taking apart elsewhere: silence where a
// stated refusal belongs.
//
// ── WHY IT DEPENDS ON THE SUBJECT KIND ──────────────────────────────────────
//
// A NAMED subject — a tracked company or a competitor — enters through
// `known_company_resolution`, so the graph schedules only VERIFICATION
// capabilities. An ICP subject enters through DISCOVERY, so it gets the
// discovery capability too, and for some signals discovery IS the proof: the
// funding source's job is to find companies that raised.
//
// So `funding` is collectible for an ICP subject and not for a tracked company,
// and stating that once, honestly, is worth more than a filter that quietly
// returns nothing.
//
// ── DERIVED, NEVER RESTATED ─────────────────────────────────────────────────
//
// This asks the REAL graph what it would schedule and the REAL engine-driven
// list what it would run. It holds no table of its own, because a table would
// be a second copy of the routing rules and would disagree with the first one
// the day either changed — which is how `known_company_resolution` sat in the
// graph, carded and unrunnable, for the whole of Phase 3.

import { buildCapabilityGraph } from "./leadCapabilityGraph.ts";
import { compileMonitoringMission, type MonitoringSubjectKind } from "./monitoringMission.ts";
import { isEngineDriven } from "./leadResearchPlaybooks.ts";
import { provingCapabilities } from "./signalQualification.ts";

export const SIGNAL_COLLECTABILITY_VERSION = "signal-collectability-v1" as const;

export interface Collectability {
  /** True when a capability the engine ACTUALLY RUNS would establish this. */
  collectible: boolean;
  /** The capability that would prove it. Null when none would run. */
  proven_by: string | null;
  /**
   * Capabilities the graph schedules for this signal but the engine skips.
   *
   * Reported rather than hidden: "declared but not driven" is a different
   * problem from "no capability exists", and the two need different work.
   */
  scheduled_but_not_driven: string[];
  reason: string;
}

/** The ICP a probe needs to reach a discovery branch. Never used for a real run. */
const PROBE_ICP = Object.freeze({
  verticals: ["b2b saas"],
  business_models: ["saas"],
  locations: ["United States"],
  stages: ["seed"],
});

/**
 * Ask the graph and the engine what would really happen.
 *
 * Pure: it compiles a throwaway mission and builds a plan, which are both
 * in-memory operations. No provider, no model, no database.
 */
export function signalCollectability(
  event: string, subjectKind: MonitoringSubjectKind,
): Collectability {
  const compiled = compileMonitoringMission({
    workspace_id: "probe",
    subjects: [{
      kind: subjectKind,
      // A named subject needs an identifier; an ICP subject must not have one.
      identifier: subjectKind === "icp" ? null : "probe.example",
      label: "probe",
      signals: [{ event: event as never, subject: "company" as never }],
      timeframe_days: 90,
    }],
    icp: subjectKind === "icp" ? PROBE_ICP : null,
  });

  if (!compiled.ok || !compiled.mission) {
    return {
      collectible: false, proven_by: null, scheduled_but_not_driven: [],
      reason: `the monitoring compiler refuses this subject: ${compiled.reason}`,
    };
  }

  let scheduled: string[];
  try {
    scheduled = buildCapabilityGraph(compiled.mission as never).steps
      .map((s) => String(s.capability));
  } catch (e) {
    return {
      collectible: false, proven_by: null, scheduled_but_not_driven: [],
      reason: `no plan could be built: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const proving = provingCapabilities({ event, subject: "company" } as never);
  if (proving.length === 0) {
    return {
      collectible: false, proven_by: null, scheduled_but_not_driven: [],
      reason: `no capability exists that would establish "${event}"`,
    };
  }

  const scheduledProving = proving.filter((c) => scheduled.includes(c));
  const driven = scheduledProving.filter((c) => isEngineDriven(c as never));
  const notDriven = scheduledProving.filter((c) => !isEngineDriven(c as never));

  if (driven.length > 0) {
    return {
      collectible: true, proven_by: driven[0], scheduled_but_not_driven: notDriven,
      reason: `${driven[0]} runs for a ${subjectKind} subject and establishes "${event}"`,
    };
  }
  if (notDriven.length > 0) {
    return {
      collectible: false, proven_by: null, scheduled_but_not_driven: notDriven,
      reason:
        `${notDriven.join(", ")} would prove "${event}" and ${
          notDriven.length === 1 ? "is" : "are"
        } scheduled, but the engine does not drive ${
          notDriven.length === 1 ? "it" : "them"
        } — the run would spend on identity and enrichment and establish nothing`,
    };
  }
  return {
    collectible: false, proven_by: null, scheduled_but_not_driven: [],
    reason:
      `nothing that would prove "${event}" is scheduled for a ${subjectKind} ` +
      `subject (${proving.join(", ")} exist but are not in this plan)`,
  };
}

export interface SubjectSignalFilter<S> {
  /** Signals this subject can actually have collected. */
  kept: S[];
  /** Signals dropped, each with the reason it cannot be collected. */
  dropped: Array<{ event: string; reason: string }>;
}

/**
 * Keep only the signals a subject of this kind can actually have collected.
 *
 * Called BEFORE the mission is compiled, so an uncollectible signal never
 * reaches a plan and never costs anything. A subject left with no signal is
 * refused by the compiler, which already knows how to say `no_signals`.
 */
export function filterCollectableSignals<S extends { event: string }>(
  signals: readonly S[],
  subjectKind: MonitoringSubjectKind,
): SubjectSignalFilter<S> {
  const kept: S[] = [];
  const dropped: SubjectSignalFilter<S>["dropped"] = [];
  for (const s of signals) {
    const c = signalCollectability(s.event, subjectKind);
    if (c.collectible) kept.push(s);
    else dropped.push({ event: s.event, reason: c.reason });
  }
  return { kept, dropped };
}
