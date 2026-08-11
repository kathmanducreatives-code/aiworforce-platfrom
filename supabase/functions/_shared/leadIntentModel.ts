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

const PERSONA_PATTERNS: Array<{ re: RegExp; personas: string[] }> = [
  { re: /\b(co[- ]?founders?|founders?)\b/i, personas: ["Founder", "Co-Founder", "CEO"] },
  { re: /\bceos?\b/i, personas: ["CEO", "Founder"] },
  { re: /\bhead of (sales|revenue|growth)\b/i, personas: ["Head of Sales", "Head of Revenue", "Head of Growth"] },
  { re: /\bhead of talent\b/i, personas: ["Head of Talent", "Founder"] },
];

const SIGNAL_PHRASES = /\b(reason to talk|why now|ready to buy|buying signal|hot leads?|hiring|recently funded|raised|growth activity|product launch|outbound expansion|scaling|clear reason)\b/i;

// A profile-first lookup is only for named companies ("at Acme, Globex").
const NAMED_COMPANY_LOOKUP = /\b(profiles? of|linkedin profiles?|find the (founder|ceo)s? (of|at))\b/i;

export interface BrainForIntent {
  industries?: string[];
  disqualifiers?: string[];
  geography?: string | string[];
  buyer_roles?: string[];
}

export function separateIntent(opts: { message: string; brain?: BrainForIntent | null; parsedCategories?: string[]; parsedGeographyHard?: boolean; parsedLocations?: string[]; hardExclusions?: string[] }): SeparatedIntent {
  const message = (opts.message ?? "").trim();
  const brain = opts.brain ?? null;

  // Personas (who to contact) — never a source strategy.
  const target_personas: string[] = [];
  for (const p of PERSONA_PATTERNS) if (p.re.test(message)) for (const x of p.personas) if (!target_personas.includes(x)) target_personas.push(x);
  if (target_personas.length === 0 && brain?.buyer_roles?.length) target_personas.push(...brain.buyer_roles);

  // Requested hiring role family + exactness.
  const requested_role_family = requestedRoleFamily(message);
  const role_exactness: SeparatedIntent["role_exactness"] = requested_role_family ? "hard" : "none";

  // Signal requirement.
  const requested_signal: SeparatedIntent["requested_signal"] = SIGNAL_PHRASES.test(message) ? "required" : "none";

  // Geography (hard when explicitly named unless opt-out). Prefer caller-parsed
  // locations; otherwise self-detect a named geography from the message so the
  // hard-filter guard never depends on an upstream parser being wired.
  const NAMED_GEO = /\b(united states|usa|\bus\b|united kingdom|\buk\b|canada|germany|france|netherlands|europe|emea|apac|india|australia|singapore|new york|san francisco|london)\b/i;
  const optOut = /\b(anywhere|global(ly)?|worldwide)\b/i.test(message);
  const detectedLocations = opts.parsedLocations && opts.parsedLocations.length
    ? opts.parsedLocations
    : (NAMED_GEO.test(message) ? [(message.match(NAMED_GEO)![0])] : []);
  const geoHard = opts.parsedGeographyHard ?? (detectedLocations.length > 0 && !optOut);
  const geography = { values: detectedLocations, hard: geoHard };

  // Source routing — THE key decision.
  // A direct named-company profile lookup → profile_first.
  // Anything signal/persona-based → account_first (companies → signal → person).
  const source_strategy: SourceStrategy = NAMED_COMPANY_LOOKUP.test(message) ? "profile_first" : "account_first";
  const decision_maker_strategy: DecisionMakerStrategy =
    source_strategy === "profile_first" ? "direct_lookup"
      : (target_personas.length ? "resolve_after_account" : "none");

  // Evidence requirements grow with a required signal.
  const evidence_requirements = ["company_identity", "source_url"];
  if (requested_signal === "required") evidence_requirements.push("company_level_signal", "signal_evidence_url");
  if (requested_role_family) evidence_requirements.push("exact_role_family_job_post");
  if (decision_maker_strategy !== "none") evidence_requirements.push("decision_maker_profile_url");

  const hard_exclusions = [...new Set([...(opts.hardExclusions ?? []), ...(brain?.disqualifiers ?? [])])];

  const countMatch = message.match(/\b(?:find|up to|get)\s+(\d{1,3})\b/i);
  const result_limit = countMatch ? Math.max(1, Math.min(50, Number(countMatch[1]))) : 5;

  return {
    original_query: message,
    target_personas,
    target_company_profile: { categories: opts.parsedCategories ?? brain?.industries ?? [] },
    requested_signal,
    requested_role_family,
    role_exactness,
    geography,
    hard_exclusions,
    evidence_requirements,
    source_strategy,
    decision_maker_strategy,
    result_limit,
    relaxation_policy: {
      geography: geoHard ? "never" : "last_resort",
      role_family: requested_role_family ? "adjacent_watch_only" : "never",
      size: "soft",
    },
  };
}

// ── THE SAME DTO, PROJECTED FROM THE CANONICAL MISSION ──────────────────────
//
// Every semantic field below reads a field the Mission ALREADY DECIDED. There is
// no parsing here: no regular expression, no keyword table, and the user's
// sentence is touched only to be copied onto `original_query`, which exists so a
// run trace can show what was asked — never so this module can re-read it.
//
// Structurally typed rather than importing `LeadMissionV1`, matching
// `workflowTypeFromMission` in leadEntityIntent.ts: the projection depends on the
// four fields it names and on nothing else about the mission's shape.

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

