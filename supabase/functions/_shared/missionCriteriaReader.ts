// THE ONE READER OF A MISSION'S MEANING (mission reliability S2/S3, root causes R5/R6).
//
// Every component — the ATLAS planner and provider requirements, ORION's verifier and
// role vocabulary, qualification — asks THIS function what a mission requires. None
// rebuilds requirements from the prose or from carrier fields of its own.
//
//   frozen mission   (`criteria_contract_version` present — S3): the criteria stored at
//                    compile time ARE the approved meaning. Every component reads them as
//                    stored; a later compiler change cannot alter what an approved mission
//                    means.
//   legacy mission   (no version): unchanged behaviour, made explicit. Production stores
//                    these with or without criteria; ORION re-derives at run time, the
//                    planner read the stored copy. A caller states which legacy policy it
//                    keeps (`legacy`), so today's plan hashes, signed approvals and
//                    production verdicts are preserved byte for byte. One improvement is
//                    unconditional: a legacy mission with NO stored criteria is derived,
//                    never read as "no requirements" (the planner used to drop its
//                    geography and hard signals — S0 consistency check, 17 + 11 missions).
//
// Unifying a legacy mission whose stored criteria differ from re-derivation is a change to
// a stored, possibly approved meaning: it is listed for the owner (S5 migration report),
// never done here.

import { deriveMissionCriteria, type MissionCriterion } from "./missionCriteria.ts";
import type { LeadMissionV1 } from "./leadMission.ts";
import { PRODUCTION_READINESS, type ReadinessPolicy } from "./routeReadiness.ts";
import { excludedByRole, namedTitles, type RoleFamily, roleMatchesFamily, titleSatisfiesNamedRole } from "./roleFamilies.ts";

/** The version stamped on a mission whose criteria are frozen at compile time (S3). */
export const CRITERIA_CONTRACT_VERSION = "criteria-v1" as const;

type MissionShape = { criteria?: unknown; criteria_contract_version?: unknown; criteria_fingerprint?: unknown };

/**
 * The mission fields its criteria are derived FROM (what `deriveMissionCriteria` and its
 * helpers read, generously). A frozen mission records their fingerprint; if any of them
 * changes afterwards without the criteria being re-derived and re-frozen, the stored
 * criteria no longer describe the mission and the freeze is void (legacy behaviour then
 * applies, exactly as before S3). Adding a field here only ever voids more freezes.
 */
export const CRITERIA_SOURCE_FIELDS = Object.freeze([
  "original_user_query", "company_profile", "required_signals", "required_signal_terms", "hard_constraints",
  "soft_preferences", "field_provenance", "unrepresented_requirements", "mission_semantics", "brain_refinements",
  "confidence", "directives", "decision_makers", "target_entity", "geography_is_hard", "mission_type",
  "mission_objective", "requested_output", "strategies", "understanding",
] as const);

function fnv(json: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < json.length; i++) { h ^= json.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
const stable = (v: unknown): string => JSON.stringify(v, (_k, val) =>
  val && typeof val === "object" && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)))
    : val);

/** Fingerprint of the criteria's source fields AND the criteria themselves (64 bits, stable key order). */
export function criteriaSourceFingerprint(mission: Record<string, unknown>): string {
  const src: Record<string, unknown> = {};
  for (const f of CRITERIA_SOURCE_FIELDS) if (mission[f] !== undefined) src[f] = mission[f];
  const json = stable({ src, criteria: mission.criteria ?? null });
  return `${fnv(json, 0x811c9dc5)}${fnv(json, 0x01000193 ^ 0x5bd1e995)}`;
}

/**
 * Freeze a mission's criteria as its approved meaning: stamp the contract version and the
 * fingerprint. Call ONLY where the criteria were just derived from this very mission (the
 * compiler's last step, and pilot-chat after the Company Brain merge — the approval card).
 */
export function freezeCriteria<T extends object>(mission: T): T & { criteria_contract_version: string; criteria_fingerprint: string } {
  const m = mission as unknown as Record<string, unknown>;
  if (!Array.isArray(m.criteria) || !m.criteria.length) {
    throw new Error("freezeCriteria: the mission carries no criteria to freeze");
  }
  return { ...mission, criteria_contract_version: CRITERIA_CONTRACT_VERSION, criteria_fingerprint: criteriaSourceFingerprint(m) };
}

/** frozen: honoured · legacy: never frozen · void: frozen, then edited without re-freezing. */
export function criteriaFreezeState(mission: MissionShape | null | undefined): "frozen" | "legacy" | "void" {
  if (!mission || mission.criteria_contract_version === undefined) return "legacy";
  if (mission.criteria_contract_version !== CRITERIA_CONTRACT_VERSION) return "void";
  if (!Array.isArray(mission.criteria) || !mission.criteria.length) return "void";
  return mission.criteria_fingerprint === criteriaSourceFingerprint(mission as Record<string, unknown>) ? "frozen" : "void";
}

/** Are this mission's stored criteria its frozen, approved meaning? */
export function criteriaFrozen(mission: MissionShape | null | undefined): boolean {
  return criteriaFreezeState(mission) === "frozen";
}

export interface CriteriaReadOptions {
  readiness?: ReadinessPolicy;
  /**
   * What a LEGACY (unfrozen) mission's criteria are, for this caller:
   *   "stored"     the compile-time copy when present (the ATLAS planner, provider
   *                requirements and plan hash have always read this);
   *   "rederive"   derived from the mission at run time (ORION and run-agent always have).
   * Ignored for a frozen mission.
   */
  legacy?: "stored" | "rederive";
}

/** What this mission requires — the single answer every component uses. */
export function criteriaOf(mission: LeadMissionV1 | MissionShape, opts: CriteriaReadOptions = {}): MissionCriterion[] {
  const m = mission as MissionShape;
  if (criteriaFrozen(m)) return m.criteria as MissionCriterion[];
  if ((opts.legacy ?? "stored") === "stored" && Array.isArray(m.criteria) && m.criteria.length > 0) {
    return m.criteria as MissionCriterion[];
  }
  return deriveMissionCriteria(mission as LeadMissionV1, opts.readiness ?? PRODUCTION_READINESS);
}

// ── THE HIRING REQUIREMENT, READ ONCE ───────────────────────────────────────

export interface HiringRequirement {
  criterionId: string;
  hard: boolean;
  roleTerms: string[];
  roleFamilies: string[];
  excludedRoleTerms: string[];
  roleMatch: "any" | "all";
  windowDays: number | null;
}

/** The mission's hiring requirement as its criteria state it (null: none). Hard first. */
export function hiringRequirementOf(criteria: readonly MissionCriterion[]): HiringRequirement | null {
  const hiring = criteria.filter((c) => c.dimension === "hiring");
  const c = hiring.find((x) => x.kind === "hard") ?? hiring[0];
  if (!c) return null;
  const q = ((c.value as { qualifier?: Record<string, unknown> } | null)?.qualifier ?? {}) as
    { role_terms?: unknown; role_families?: unknown; excluded_role_terms?: unknown; role_match?: unknown };
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
  return {
    criterionId: String(c.id ?? "hiring"),
    hard: c.kind === "hard",
    roleTerms: strs(q.role_terms),
    roleFamilies: strs(q.role_families),
    excludedRoleTerms: strs(q.excluded_role_terms),
    roleMatch: q.role_match === "all" ? "all" : "any",
    windowDays: c.time_window?.days ?? null,
  };
}

/**
 * The signal groups the mission accepts as alternatives: each `any_of` on a HARD
 * criterion whose members are all signals ("raised funding OR hiring sales"). The planner
 * must search for EITHER, and must not treat each member as a requirement on its own.
 */
export function signalAlternativesOf(criteria: readonly MissionCriterion[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const c of criteria) {
    const any = (c as { any_of?: string[] }).any_of;
    if (c.kind !== "hard" || !Array.isArray(any) || any.length < 2 || !any.every((a) => a.startsWith("signal:"))) continue;
    const kinds = [...new Set(any.map((a) => a.slice("signal:".length)))].sort();
    groups.set(kinds.join("|"), kinds);
  }
  return [...groups.values()];
}

// ── ONE POSTING TEST FOR EVERY VERIFIER ─────────────────────────────────────

/**
 * Does a posting's title satisfy the mission's hiring requirement? The single rule ORION's
 * verifier, the replay mirror and qualification share: a registered title the request
 * names is matched as that title; otherwise the requirement's families; otherwise the
 * vocabulary's title fragments. An excluded role NEVER satisfies, on every branch (S2:
 * the family branch used to ignore exclusions).
 */
export function hiringTitleMatcher(req: Pick<HiringRequirement, "roleTerms" | "roleFamilies" | "excludedRoleTerms">,
  vocabularyTitles: readonly string[] = []): (title: string) => boolean {
  const named = { roleTerms: req.roleTerms, roleFamilies: req.roleFamilies, excludedRoleTerms: req.excludedRoleTerms };
  const byTitle = namedTitles(named).length > 0;
  const lowered = vocabularyTitles.map((t) => String(t).toLowerCase());
  return (title: string) => {
    if (excludedByRole(title, named)) return false;
    if (byTitle) return titleSatisfiesNamedRole(title, named);
    if (req.roleFamilies.length) return req.roleFamilies.some((f) => roleMatchesFamily(title, f as RoleFamily));
    return lowered.some((t) => title.toLowerCase().includes(t));
  };
}
