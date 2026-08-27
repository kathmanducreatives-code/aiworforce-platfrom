// Separated Find Leads intent + source routing. Pure / import-free.
//
// Root cause it fixes: "find founders …" conflated the target PERSONA with the
// SOURCE STRATEGY, so the system ran a person-profile search and returned
// profile-only "leads" with no verified company or signal. This module keeps
// persona, company profile, signal and role family as SEPARATE concepts and
// routes signal-based requests account-first (companies → verify signal →
// resolve the decision maker). Profile-first is allowed only for a direct
// named-company lookup.

// ── R1 CLASSIFICATION: COMPATIBILITY ────────────────────────────────────────
//
// `separateIntent` READS THE USER'S SENTENCE. Under the compiled-mission
// architecture that is no longer allowed to decide anything: the canonical
// LeadMissionV1 already answers persona, signal and role family, once, from the
// same sentence. `separatedIntentFromMission` below PROJECTS this same DTO out
// of those decided fields, and both live callers (orchestrate, run-agent) use
// the projection whenever a Mission exists.
//
// The text-reading function survives for tasks that carry NO Mission at all —
// a direct legacy run-agent invocation, or a workspace deliberately on the
// deterministic path before orchestrate derives one. It is never a fallback for
// a FAILED compilation: that case refuses (pilot-chat) or 422s (orchestrate).

import { requestedRoleFamily, classifyRoleFamily, type RoleFamily } from "./roleFamilyMatcher.ts";
import { effectiveRequestedCount } from "./leadMission.ts";

export type SourceStrategy = "account_first" | "profile_first";
export type DecisionMakerStrategy = "resolve_after_account" | "direct_lookup" | "none";

export interface SeparatedIntent {
  original_query: string;
  target_personas: string[];               // WHO to contact (Founder/CEO/…)
  target_company_profile: {
    categories: string[];
    company_size?: { min?: number; max?: number };
  };
  requested_signal: "required" | "preferred" | "none";
  requested_role_family: RoleFamily | null; // hiring role family, if any
  role_exactness: "hard" | "soft" | "none";
  geography: { values: string[]; hard: boolean };
  hard_exclusions: string[];
  evidence_requirements: string[];
  source_strategy: SourceStrategy;
  decision_maker_strategy: DecisionMakerStrategy;
  result_limit: number;
  relaxation_policy: {
    geography: "never" | "last_resort";
    role_family: "never" | "adjacent_watch_only";
    size: "soft" | "hard";
  };
}

const lc = (s: string) => s.toLowerCase();

/** The workspace ICP fields the mission projection reads. */
export interface BrainForIntent {
  industries?: string[];
  disqualifiers?: string[];
  geography?: string | string[];
  buyer_roles?: string[];
}

// ── THE SENTENCE-READING HALF IS GONE ───────────────────────────────────────
//
// `separateIntent({ message })` lived here: PERSONA_PATTERNS, SIGNAL_PHRASES and
// NAMED_COMPANY_LOOKUP, run over the user's words to decide account-first vs
// profile-first sourcing and which personas to look for. Orchestrate stopped
// calling it when the mission became the authority; after that only its own
// tests kept it reachable.
//
// It is a textbook example of why this cleanup reads callers rather than names.
// The file is called `leadIntentModel`, but only half of it was ever a
// classifier. `separatedIntentFromMission` below answers the SAME question from
// a compiled `LeadMissionV1` — no English, no regex — and orchestrate depends on
// it. Deleting the file by its name would have taken a live execution contract
// with it.

export interface MissionForSeparation {
  original_user_query?: string;
  mission_type?: string;
  requested_count?: number | null;
  company_profile?: {
    verticals?: string[];
    locations?: string[];
    employee_range?: { min?: number; max?: number };
    known_companies?: string[];
  };
  required_signals?: Array<{ type?: string; role_families?: string[] } | null>;
  required_signal_terms?: string[];
  decision_makers?: { roles?: string[] };
  strategies?: string[];
  geography_is_hard?: boolean;
  no_broadening_requested?: boolean;
}

/**
 * A taxonomy key ("sales_ops", "rev-ops") in the words the matcher speaks.
 *
 * `classifyRoleFamily` matches title PHRASES, so an underscored key never hits
 * its patterns. This normalises punctuation in an already-decided key; it does
 * not interpret free text.
 */
function familyKeyAsPhrase(key: string): string {
  return String(key ?? "").replace(/[_-]+/g, " ").trim();
}

/**
 * Project the SeparatedIntent DTO out of a decided Mission.
 *
 * Field-by-field authority:
 *   target_personas            ← decision_makers.roles
 *   requested_signal           ← required_signals (present ⇒ required)
 *   requested_role_family      ← required_signals[].role_families,
 *                                then required_signal_terms
 *   geography                  ← company_profile.locations + geography_is_hard
 *   source_strategy            ← whether the request SUPPLIED its companies
 *                                (known_companies / known_company_enrichment /
 *                                the supplied_company strategy), which is the
 *                                mission's way of saying discovery is skipped
 *   decision_maker_strategy    ← source_strategy + target_personas
 *   relaxation_policy          ← geography_is_hard, the role family, and the
 *                                mission's own no_broadening_requested
 *   result_limit               ← effectiveRequestedCount(), the ONE runtime
 *                                default; no sentence is re-read for a count
 *
 * `hardExclusions` and `brain` are workspace/step configuration, not readings of
 * the request, and are carried through exactly as `separateIntent` carries them.
 */
export function separatedIntentFromMission(
  mission: MissionForSeparation,
  opts: { brain?: BrainForIntent | null; hardExclusions?: string[] } = {},
): SeparatedIntent {
  const brain = opts.brain ?? null;

  const target_personas = [...new Set(
    (mission.decision_makers?.roles ?? []).map((r) => String(r ?? "").trim()).filter(Boolean),
  )];

  const signals = (mission.required_signals ?? []).filter(Boolean);
  const requested_signal: SeparatedIntent["requested_signal"] =
    signals.length > 0 ? "required" : "none";

  // The role family the request named, from the mission's own record of it:
  // the taxonomy keys it attached to a signal first, then the literal words the
  // user typed which the mission preserved verbatim.
  const familyCandidates = [
    ...signals.flatMap((s) => s?.role_families ?? []),
    ...(mission.required_signal_terms ?? []),
  ];
  let requested_role_family: RoleFamily | null = null;
  for (const candidate of familyCandidates) {
    const f = classifyRoleFamily(familyKeyAsPhrase(candidate));
    if (f !== "other") { requested_role_family = f; break; }
  }
  const role_exactness: SeparatedIntent["role_exactness"] =
    requested_role_family ? "hard" : "none";

  const locations = [...new Set(
    (mission.company_profile?.locations ?? []).map((l) => String(l ?? "").trim()).filter(Boolean),
  )];
  // Absent, `geography_is_hard` is unstated rather than false: a named location
  // that no one marked soft is still a constraint, which is what `separateIntent`
  // concluded too.
  const geoHard = mission.geography_is_hard ?? locations.length > 0;

  // DISCOVERY SKIPPED ⇒ profile-first. This is the mission's version of the
  // "profiles of the founders at Acme and Globex" lookup: the companies came
  // with the request, so there is no account search to run first.
  const suppliedCompanies =
    (mission.company_profile?.known_companies ?? []).length > 0 ||
    mission.mission_type === "known_company_enrichment" ||
    (mission.strategies ?? []).includes("supplied_company");
  const source_strategy: SourceStrategy = suppliedCompanies ? "profile_first" : "account_first";
  const decision_maker_strategy: DecisionMakerStrategy = suppliedCompanies
    ? "direct_lookup"
    : (target_personas.length ? "resolve_after_account" : "none");

  const evidence_requirements = ["company_identity", "source_url"];
  if (requested_signal === "required") {
    evidence_requirements.push("company_level_signal", "signal_evidence_url");
  }
  if (requested_role_family) evidence_requirements.push("exact_role_family_job_post");
  if (decision_maker_strategy !== "none") evidence_requirements.push("decision_maker_profile_url");

  const hard_exclusions = [...new Set([
    ...(opts.hardExclusions ?? []), ...(brain?.disqualifiers ?? []),
  ])];

  const verticals = (mission.company_profile?.verticals ?? []).filter(Boolean);
  const employeeRange = mission.company_profile?.employee_range;

  const noBroadening = mission.no_broadening_requested === true;

  return {
    original_query: String(mission.original_user_query ?? ""),
    target_personas,
    target_company_profile: {
      categories: verticals.length ? verticals : (brain?.industries ?? []),
      ...(employeeRange ? { company_size: employeeRange } : {}),
    },
    requested_signal,
    requested_role_family,
    role_exactness,
    geography: { values: locations, hard: geoHard },
    hard_exclusions,
    evidence_requirements,
    source_strategy,
    decision_maker_strategy,
    result_limit: Math.max(1, Math.min(50, effectiveRequestedCount({
      requested_count: mission.requested_count ?? null,
    }))),
    relaxation_policy: {
      geography: (noBroadening || geoHard) ? "never" : "last_resort",
      role_family: (requested_role_family && !noBroadening) ? "adjacent_watch_only" : "never",
      size: noBroadening ? "hard" : "soft",
    },
  };
}

