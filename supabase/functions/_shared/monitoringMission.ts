// A MONITORING MISSION IS NOT A SOURCING MISSION.
//
// ── THE ONE DIFFERENCE THAT MATTERS ─────────────────────────────────────────
//
// Both ask the same capability engine the same kind of question — "which
// companies show this signal?" — and both use the same actors, normalizers,
// identity rules, credits and evidence contracts. Deliberately so: Signals gets
// its own monitoring INTENT, never its own provider stack.
//
// What differs is the TERMINAL. A sourcing mission ends by turning qualified
// companies into leads: accounts, contacts, lead_candidates. A monitoring
// mission ends at `signal_events` and must never write a lead row, because a
// company that showed a hiring signal is not thereby a prospect somebody asked
// to pursue — and a workspace watching its ICP would silently accumulate a
// pipeline it never requested.
//
// ── WHY THIS REUSES `LeadMissionV1` RATHER THAN PARALLELING IT ──────────────
//
// A second mission type would need a second capability graph, a second
// validator and a second set of containment rules, and the two would drift.
// Instead a monitoring mission COMPILES DOWN to the same mission shape with an
// explicit `mission_objective`, and the graph reads that one field to decide
// the terminal. Everything else — discovery routing, signal verification,
// enrichment, qualification — is shared by construction.
//
// ── NOT THE `signal_events` SUBJECT ─────────────────────────────────────────
//
// A MONITORING subject is what a workspace asked Agentory to watch. A signal
// EVENT subject is what a discovered piece of evidence turned out to be about.
// A scan can produce evidence about a competitor nobody tracks, and a tracked
// company can produce no evidence at all. See `signalSubject.ts`.
//
// PURE. No network, provider, model or database access.

import {
  LEAD_MISSION_VERSION, type LeadMissionV1, type MissionSignal,
} from "./leadMission.ts";
import type { SignalEvent, SignalSubject } from "./missionSignalDescriptor.ts";

export const MONITORING_MISSION_VERSION = "monitoring-mission-v1" as const;

/**
 * Why this run exists.
 *
 * `sourcing` is the default everywhere it is absent, so every existing Lead
 * mission keeps its exact behaviour without being rewritten.
 */
export const MISSION_OBJECTIVES = ["sourcing", "monitoring"] as const;
export type MissionObjective = typeof MISSION_OBJECTIVES[number];

export function isMissionObjective(v: unknown): v is MissionObjective {
  return typeof v === "string" && (MISSION_OBJECTIVES as readonly string[]).includes(v);
}

/**
 * The objective of a mission, defaulting to `sourcing`.
 *
 * Read everywhere the terminal matters. Defaulting here rather than at each
 * call site is what makes "absent means sourcing" a single decision instead of
 * a convention every reader has to remember.
 */
export function missionObjective(m: { mission_objective?: unknown }): MissionObjective {
  return isMissionObjective(m.mission_objective) ? m.mission_objective : "sourcing";
}

export function isMonitoringMission(m: { mission_objective?: unknown }): boolean {
  return missionObjective(m) === "monitoring";
}

// ────────────────────────────────────────────────────────── what to watch ────

/**
 * What a workspace has asked to be monitored.
 *
 * `icp` is the workspace's own Company Brain profile — "watch companies like my
 * customers". The others name something specific. A subject carries no signals
 * of its own: which signals to look for is a property of the monitoring
 * INTEREST, so one tracked company can be watched for hiring while another is
 * watched for funding.
 */
export const MONITORING_SUBJECT_KINDS = [
  "icp",
  "tracked_company",
  "competitor",
] as const;
export type MonitoringSubjectKind = typeof MONITORING_SUBJECT_KINDS[number];

export function isMonitoringSubjectKind(v: unknown): v is MonitoringSubjectKind {
  return typeof v === "string" && (MONITORING_SUBJECT_KINDS as readonly string[]).includes(v);
}

export interface MonitoringSubjectInput {
  kind: MonitoringSubjectKind;
  /**
   * The thing being watched. NULL only for `icp`, which names no single entity.
   *
   * For a company or competitor this is a domain or a LinkedIn company URL —
   * an identity the shared engine can resolve — never a bare display name,
   * because a name cannot be verified and two companies share one.
   */
  identifier?: string | null;
  /** Display name, for the UI. Never used as an identity. */
  label?: string | null;
  /** Which signals to watch for. Empty means the caller supplied none. */
  signals: readonly { event: SignalEvent; subject?: SignalSubject }[];
  /** How far back evidence stays interesting. */
  timeframe_days?: number | null;
}

export type MonitoringCompileRefusal =
  /** No subject at all — there is nothing to watch. */
  | "no_subjects"
  /** Every supplied subject was unusable, with per-subject reasons. */
  | "no_usable_subjects"
  /** Subjects exist but name no signal, so there is nothing to look for. */
  | "no_signals";

export interface MonitoringMissionInput {
  workspace_id: string;
  subjects: readonly MonitoringSubjectInput[];
  /** The workspace ICP, when an `icp` subject is present. */
  icp?: {
    verticals?: readonly string[];
    business_models?: readonly string[];
    locations?: readonly string[];
    stages?: readonly string[];
    employee_range?: { min?: number; max?: number } | null;
  } | null;
  /** Default recency when a subject states none. */
  default_timeframe_days?: number;
}

export interface MonitoringCompileResult {
  ok: boolean;
  /** The mission the shared engine executes. Null when refused. */
  mission: LeadMissionV1 | null;
  refusal: MonitoringCompileRefusal | null;
  /** Why each subject was dropped, so a silent empty run is impossible. */
  dropped: Array<{ kind: string; identifier: string | null; reason: string }>;
  /** Subjects that became part of the mission. */
  accepted: MonitoringSubjectInput[];
  reason: string;
}

/** Recency default. Long enough that a weekly cadence never has a blind spot. */
export const DEFAULT_MONITORING_TIMEFRAME_DAYS = 30;

/**
 * A monitoring subject is usable when it can be turned into something the
 * engine can actually look for.
 *
 * An `icp` subject needs a profile with at least one dimension: watching "my
 * ICP" with an empty ICP is watching everything, which is a bill rather than a
 * mission. A named subject needs a resolvable identity, never just a label.
 */
export function monitoringSubjectUsable(
  s: MonitoringSubjectInput, icp: MonitoringMissionInput["icp"],
): { usable: boolean; reason: string } {
  if (!isMonitoringSubjectKind(s.kind)) {
    return { usable: false, reason: `unknown subject kind "${s.kind}"` };
  }
  if (s.signals.length === 0) {
    return { usable: false, reason: "names no signal, so there is nothing to look for" };
  }
  if (s.kind === "icp") {
    const dims = [
      icp?.verticals?.length, icp?.business_models?.length,
      icp?.locations?.length, icp?.stages?.length,
    ].filter((n) => (n ?? 0) > 0).length;
    if (dims === 0 && !icp?.employee_range) {
      return {
        usable: false,
        reason: "the workspace ICP is empty; monitoring it would watch every company",
      };
    }
    return { usable: true, reason: "" };
  }
  const id = (s.identifier ?? "").trim();
  if (!id) {
    return {
      usable: false,
      // A display name is not an identity: two companies share one, and the
      // engine resolves domains and LinkedIn URLs, not labels.
      reason: `${s.kind} has no domain or LinkedIn URL; a display name is not an identity`,
    };
  }
  return { usable: true, reason: "" };
}

/**
 * Compile monitoring intent into a mission the shared engine can run.
 *
 * Deterministic, deliberately. The plan says so and the reason is that a
 * monitoring run is recurring: a model that reads "watch my ICP" differently on
 * Tuesday than on Monday produces a feed whose changes are its own, not the
 * market's.
 */
export function compileMonitoringMission(
  i: MonitoringMissionInput,
): MonitoringCompileResult {
  const dropped: MonitoringCompileResult["dropped"] = [];
  const accepted: MonitoringSubjectInput[] = [];

  if (i.subjects.length === 0) {
    return {
      ok: false, mission: null, refusal: "no_subjects", dropped, accepted,
      reason: "no monitoring subject was supplied; there is nothing to watch",
    };
  }

  for (const s of i.subjects) {
    const u = monitoringSubjectUsable(s, i.icp);
    if (u.usable) accepted.push(s);
    else dropped.push({ kind: String(s.kind), identifier: s.identifier ?? null, reason: u.reason });
  }

  if (accepted.length === 0) {
    return {
      ok: false, mission: null, refusal: "no_usable_subjects", dropped, accepted,
      reason: `every subject was unusable: ${dropped.map((d) => d.reason).join("; ")}`,
    };
  }

  // ── SIGNALS ──────────────────────────────────────────────────────────────
  //
  // Deduplicated across subjects on (event, subject): watching two competitors
  // for funding is one funding investigation over two identities, not two.
  const seen = new Set<string>();
  const required_signals: MissionSignal[] = [];
  const fallbackDays = i.default_timeframe_days ?? DEFAULT_MONITORING_TIMEFRAME_DAYS;

  for (const s of accepted) {
    for (const sig of s.signals) {
      const subject = sig.subject ?? "company";
      const key = `${sig.event}/${subject}`;
      if (seen.has(key)) continue;
      seen.add(key);
      required_signals.push({
        type: sig.event,
        subject,
        timeframe_days: s.timeframe_days ?? fallbackDays,
      } as MissionSignal);
    }
  }

  if (required_signals.length === 0) {
    return {
      ok: false, mission: null, refusal: "no_signals", dropped, accepted,
      reason: "the usable subjects name no signal",
    };
  }

  // ── NAMED SUBJECTS BECOME known_companies ────────────────────────────────
  //
  // Which is exactly right and not a shortcut: a tracked company or competitor
  // IS a supplied company, so the graph routes it to identity resolution rather
  // than discovery — no cohort search, no discovery spend, and the same path
  // Leads already uses for "check these accounts".
  const known_companies = accepted
    .filter((s) => s.kind !== "icp")
    .map((s) => (s.identifier ?? "").trim())
    .filter((x) => x.length > 0);

  const watchingIcp = accepted.some((s) => s.kind === "icp");

  const mission: LeadMissionV1 = {
    version: LEAD_MISSION_VERSION,
    // The monitoring intent in the user's terms. Never a planner rewrite, and
    // never presented as something a person typed.
    original_user_query: monitoringQueryText(accepted),
    mission_type: "company_research",
    target_entity: "company",
    requested_output: "qualified_companies",
    // MONITORING HAS NO QUOTA. A sourcing mission stops at the number asked
    // for; a monitor reports everything it found, because a signal suppressed
    // for exceeding a count is a signal the workspace never learns about.
    requested_count: null,
    company_profile: {
      business_models: [...(i.icp?.business_models ?? [])],
      verticals: watchingIcp ? [...(i.icp?.verticals ?? [])] : [],
      stages: watchingIcp ? [...(i.icp?.stages ?? [])] : [],
      locations: watchingIcp ? [...(i.icp?.locations ?? [])] : [],
      ...(watchingIcp && i.icp?.employee_range ? { employee_range: i.icp.employee_range } : {}),
      ...(known_companies.length ? { known_companies } : {}),
    },
    required_signals,
    decision_makers: { roles: [], current_employment_required: false },
    hard_constraints: {},
    soft_preferences: {},
    // EMPTY, DELIBERATELY. A non-empty `required_capabilities` constrains the
    // graph to a model-proposed stage list, and this compiler is deterministic:
    // the signals decide the plan, exactly as they do for a sourcing mission
    // that named no capabilities. Prohibiting the lead stages here as well
    // would be belt-and-braces, but the graph's terminal branch and
    // `monitoringPlanViolations` already own that rule and a third copy would
    // be a third place to forget.
    required_capabilities: [],
    prohibited_capabilities: [],
    // Every field above is derived from stored monitoring subjects, not from a
    // sentence a person typed — which is what this provenance value says.
    field_provenance: {
      "company_profile": "monitoring_subject",
      "required_signals": "monitoring_subject",
    } as unknown as LeadMissionV1["field_provenance"],
    confidence: 1,
    // THE ONE FIELD THAT CHANGES THE TERMINAL.
    mission_objective: "monitoring",
  } as unknown as LeadMissionV1;

  return {
    ok: true, mission, refusal: null, dropped, accepted,
    reason: `monitoring ${accepted.length} subject(s) for ` +
      `${required_signals.map((s) => s.type).join(", ")}`,
  };
}

/** A readable description of what is being watched. Never fabricated as user text. */
function monitoringQueryText(subjects: readonly MonitoringSubjectInput[]): string {
  const parts = subjects.map((s) =>
    s.kind === "icp"
      ? "the workspace ICP"
      : `${s.kind.replace("_", " ")} ${s.label ?? s.identifier ?? "(unnamed)"}`);
  return `[monitoring] ${parts.join(", ")}`;
}

// ──────────────────────────────────────────────────────────── boundaries ────

/**
 * Capabilities a monitoring plan may never contain.
 *
 * These are the LEAD terminal and the people stages. A monitoring run that
 * reached them would turn a watchlist into a pipeline nobody asked for, and
 * would spend unlock-gated credits on people without a person pressing a button.
 */
export const LEAD_ONLY_CAPABILITIES: readonly string[] = Object.freeze([
  "persistence",
  "founder_discovery",
  "employer_verification",
  "contact_enrichment",
]);

/**
 * Ways a monitoring plan could still behave like a sourcing run.
 *
 * Returns violations rather than throwing: the caller is deciding whether to
 * run, and a list of what is wrong is more useful than a stack trace.
 */
/**
 * Check a mission and its plan together.
 *
 * `monitoringPlanViolations` reads the plan alone, which is the right shape for
 * a guard a test can point at a hand-built object. This one is what a CALLER
 * uses: it refuses the mismatch where a mission says monitoring and its plan
 * was built from something else, which is how a terminal leaks back in after a
 * refactor moves the two apart.
 */
export function monitoringObjectiveGuard(
  mission: { mission_objective?: unknown },
  plan: { steps: ReadonlyArray<{ capability: string }>; offered_capabilities?: readonly string[] },
): string[] {
  if (!isMonitoringMission(mission)) return [];
  return monitoringPlanViolations(plan);
}

export function monitoringPlanViolations(
  plan: { steps: ReadonlyArray<{ capability: string }>; offered_capabilities?: readonly string[] },
): string[] {
  const out: string[] = [];
  for (const s of plan.steps) {
    if (LEAD_ONLY_CAPABILITIES.includes(s.capability)) {
      out.push(
        `${s.capability} is a lead-only stage and must not be scheduled by a ` +
        `monitoring mission`);
    }
  }
  return out;
}
