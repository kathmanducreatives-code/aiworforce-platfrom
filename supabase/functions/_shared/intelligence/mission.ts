// THE AGENTORY MISSION — one canonical envelope for Leads, Signals and Content.
//
// A mission is everything a planner is allowed to know before it plans: the user's
// own words, the workspace's Company Brain and ICP, what it may do autonomously,
// and what it may spend. It is DATA, never instructions — nothing inside a mission
// is executed, and the planner receives it inside a clearly-fenced trusted section
// (see promptAssembly.ts).
//
// ONE contract, not three. A department-specific mission envelope would drift, and
// the first cross-department handoff (Signals finds an account → Leads sources it)
// would need a lossy translation between two shapes that were never reconciled.
// `department` and `requested_outcome` carry the variation instead.
//
// PURE. No network, no database, no environment reads.

import { canonicalJson, sha256Hex } from "../planHash.ts";

export type AgentoryDepartment = "leads" | "signals" | "content";
export type AgentoryEnvironmentMode = "development" | "test" | "production";

export const MISSION_CONTRACT_VERSION = "agentory-mission-1.0.0";

// ------------------------------------------------------------- geography ------
//
// WHY GEOGRAPHY GETS ITS OWN CONTRACT.
//
// The deterministic parser resolves only US locations, and its `\bus\b` alternative
// matches the pronoun — "Show us founders in Germany" parses as United States.
// A planner handed a flat `geography: string[]` cannot tell an asserted country
// from a hallucinated one, and would plan against the wrong one with confidence.
//
// So geography is carried as FOUR separate populations plus a provenance, and the
// user's own wording is never overwritten by, nor merged into, parser output.

export type MissionGeographySource =
  | "explicit_user"
  | "workflow"
  | "icp_hard"
  | "icp_soft"
  | "inferred";

export interface MissionGeographyContext {
  /** The user's own location wording, verbatim. Never normalized, never dropped. */
  explicit_raw_locations: string[];
  /** Confidently normalized locations. EMPTY is the honest answer in Phase 1. */
  normalized_locations: string[];
  /** What the deterministic parser produced. Advisory only. */
  parser_locations: string[];
  /** Explicitly named by the user but not confidently normalized. Retained, never discarded. */
  unresolved_locations: string[];
  source: MissionGeographySource;
  confidence: number;
}

// ----------------------------------------------------------- the envelope -----

export interface MissionCompanyBrain {
  company_name?: string;
  description?: string;
  products: string[];
  services: string[];
  value_propositions: string[];
  target_problems: string[];
  proof_points: string[];
  differentiators: string[];
  competitors: string[];
  exclusions: string[];
  source_ids: string[];
  confidence: number;
}

export interface MissionIcp {
  industries: string[];
  company_types: string[];
  company_verticals: string[];
  employee_range?: { min?: number; max?: number };
  company_stages: string[];
  geographies: string[];
  target_roles: string[];
  buying_problems: string[];
  buying_signals: string[];
  exclusions: string[];
  hard_constraints: string[];
  soft_preferences: string[];
  source_ids: string[];
  confidence: number;
}

export interface AgentoryMission {
  mission_id: string;
  mission_version: string;

  department: AgentoryDepartment;

  /** The user's instruction, byte-for-byte. The highest authority in the system. */
  original_instruction: string;
  /** A whitespace-tidied copy for display. NEVER a substitute for the original. */
  normalized_instruction?: string;

  workspace_id: string;

  company_brain: MissionCompanyBrain;
  icp: MissionIcp;

  /** Geography is separated out of `icp` because provenance decides authority. */
  geography_context: MissionGeographyContext;

  /**
   * What the deterministic parser understood. Carried so a planner can SEE the
   * parser's reading without being able to mistake it for the user's words.
   */
  parser_context: Record<string, unknown>;

  requested_outcome: Record<string, unknown>;

  constraints: {
    hard: Record<string, unknown>;
    soft: Record<string, unknown>;
  };

  approval_policy: {
    autonomously_allowed: string[];
    approval_required: string[];
  };

  budget: {
    maximum_calls: number;
    maximum_estimated_cost_usd: number;
    maximum_rounds: number;
  };

  environment: { mode: AgentoryEnvironmentMode };
}

// ------------------------------------------------- instruction authority ------
//
// PRIORITY ORDER. Lower number wins. This is the whole point of the mission: when
// two sources disagree, the resolution is fixed in advance and is not the planner's
// to renegotiate.

export const AUTHORITY_ORDER = [
  "original_user_instruction",
  "workflow_configuration",
  "icp_hard_constraint",
  "icp_soft_preference",
  "company_brain",
  "strategy_memory",
  "model_inference",
] as const;

export type AuthoritySource = typeof AUTHORITY_ORDER[number];

export function authorityRank(source: AuthoritySource): number {
  return AUTHORITY_ORDER.indexOf(source);
}

/** Which of two sources governs. Ties resolve to `a` (the earlier-declared one). */
export function higherAuthority(a: AuthoritySource, b: AuthoritySource): AuthoritySource {
  return authorityRank(a) <= authorityRank(b) ? a : b;
}

/** True when `challenger` may override `incumbent`. Equal authority may NOT override. */
export function mayOverride(incumbent: AuthoritySource, challenger: AuthoritySource): boolean {
  return authorityRank(challenger) < authorityRank(incumbent);
}

// ------------------------------------------------------------- the builder ----

function cleanList(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

const LIST_CAP = 40;

export interface BuildMissionInput {
  missionId: string;
  department: AgentoryDepartment;
  workspaceId: string;
  /** The user's raw instruction. Stored verbatim — this function never edits it. */
  originalInstruction: string;
  companyBrain?: Partial<MissionCompanyBrain> | null;
  icp?: Partial<MissionIcp> | null;
  geography?: Partial<MissionGeographyContext> | null;
  parserContext?: Record<string, unknown> | null;
  requestedOutcome?: Record<string, unknown> | null;
  hardConstraints?: Record<string, unknown> | null;
  softConstraints?: Record<string, unknown> | null;
  approvalPolicy?: { autonomously_allowed?: string[]; approval_required?: string[] } | null;
  budget?: Partial<AgentoryMission["budget"]> | null;
  environmentMode: AgentoryEnvironmentMode;
}

/**
 * Build a mission.
 *
 * The single invariant that matters: `original_instruction` comes out exactly as it
 * went in. Every other field is derived, bounded and de-duplicated; the user's own
 * sentence is not touched by any of that machinery.
 */
export function buildMission(input: BuildMissionInput): AgentoryMission {
  const brain = input.companyBrain ?? {};
  const icp = input.icp ?? {};
  const geo = input.geography ?? {};

  const explicit = cleanList(geo.explicit_raw_locations, LIST_CAP);
  const normalized = cleanList(geo.normalized_locations, LIST_CAP);
  const parserLocations = cleanList(geo.parser_locations, LIST_CAP);

  // An explicitly-named location that was NOT confidently normalized stays visible
  // as unresolved. Dropping it would silently narrow the request; inventing a
  // normalization for it would silently change the request.
  const normalizedKeys = new Set(normalized.map((s) => s.toLowerCase()));
  const derivedUnresolved = explicit.filter((s) => !normalizedKeys.has(s.toLowerCase()));
  const unresolved = cleanList(
    [...cleanList(geo.unresolved_locations, LIST_CAP), ...derivedUnresolved],
    LIST_CAP,
  );

  return {
    mission_id: input.missionId,
    mission_version: MISSION_CONTRACT_VERSION,
    department: input.department,

    // VERBATIM. No trim, no collapse, no case change, no truncation.
    original_instruction: input.originalInstruction,
    normalized_instruction: normalizeForDisplay(input.originalInstruction),

    workspace_id: input.workspaceId,

    company_brain: {
      company_name: brain.company_name,
      description: brain.description,
      products: cleanList(brain.products, LIST_CAP),
      services: cleanList(brain.services, LIST_CAP),
      value_propositions: cleanList(brain.value_propositions, LIST_CAP),
      target_problems: cleanList(brain.target_problems, LIST_CAP),
      proof_points: cleanList(brain.proof_points, LIST_CAP),
      differentiators: cleanList(brain.differentiators, LIST_CAP),
      competitors: cleanList(brain.competitors, LIST_CAP),
      exclusions: cleanList(brain.exclusions, LIST_CAP),
      source_ids: cleanList(brain.source_ids, LIST_CAP),
      confidence: clampConfidence(brain.confidence),
    },

    icp: {
      industries: cleanList(icp.industries, LIST_CAP),
      company_types: cleanList(icp.company_types, LIST_CAP),
      company_verticals: cleanList(icp.company_verticals, LIST_CAP),
      employee_range: icp.employee_range,
      company_stages: cleanList(icp.company_stages, LIST_CAP),
      geographies: cleanList(icp.geographies, LIST_CAP),
      target_roles: cleanList(icp.target_roles, LIST_CAP),
      buying_problems: cleanList(icp.buying_problems, LIST_CAP),
      buying_signals: cleanList(icp.buying_signals, LIST_CAP),
      exclusions: cleanList(icp.exclusions, LIST_CAP),
      hard_constraints: cleanList(icp.hard_constraints, LIST_CAP),
      soft_preferences: cleanList(icp.soft_preferences, LIST_CAP),
      source_ids: cleanList(icp.source_ids, LIST_CAP),
      confidence: clampConfidence(icp.confidence),
    },

    geography_context: {
      explicit_raw_locations: explicit,
      normalized_locations: normalized,
      parser_locations: parserLocations,
      unresolved_locations: unresolved,
      source: geo.source ?? (explicit.length ? "explicit_user" : "inferred"),
      confidence: clampConfidence(geo.confidence),
    },

    parser_context: { ...(input.parserContext ?? {}) },
    requested_outcome: { ...(input.requestedOutcome ?? {}) },

    constraints: {
      hard: { ...(input.hardConstraints ?? {}) },
      soft: { ...(input.softConstraints ?? {}) },
    },

    approval_policy: {
      autonomously_allowed: cleanList(input.approvalPolicy?.autonomously_allowed, LIST_CAP),
      approval_required: cleanList(input.approvalPolicy?.approval_required, LIST_CAP),
    },

    budget: {
      maximum_calls: positiveInt(input.budget?.maximum_calls, 0),
      maximum_estimated_cost_usd: positiveNumber(input.budget?.maximum_estimated_cost_usd, 0),
      maximum_rounds: positiveInt(input.budget?.maximum_rounds, 0),
    },

    environment: { mode: input.environmentMode },
  };
}

/** Whitespace tidy for display ONLY. Never replaces `original_instruction`. */
export function normalizeForDisplay(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function clampConfidence(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
function positiveInt(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt;
}
function positiveNumber(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

// ------------------------------------------------------ geography authority ---

export interface GeographyResolution {
  /** The locations a planner is permitted to target. */
  effective: string[];
  /** Which population supplied them. */
  authority: AuthoritySource;
  /** True when explicit user wording exists that could not be normalized. */
  hasUnresolvedExplicit: boolean;
}

/**
 * Resolve which locations govern.
 *
 * The rule that matters: if the user named a location AT ALL, parser output cannot
 * contribute. Parser locations are used only when the user named none — which is
 * exactly the case where the parser is adding information rather than contradicting
 * it. This is what stops "Show us founders in Germany" from being planned against
 * the United States.
 */
export function resolveGeographyAuthority(ctx: MissionGeographyContext): GeographyResolution {
  const explicit = ctx.explicit_raw_locations ?? [];
  const unresolved = ctx.unresolved_locations ?? [];

  if (explicit.length > 0) {
    // Prefer confident normalizations, but never DROP an explicit location that
    // could not be normalized — it stays in the effective set as the user wrote it.
    const normalizedKeys = new Set((ctx.normalized_locations ?? []).map((s) => s.toLowerCase()));
    const keptRaw = explicit.filter((s) => !normalizedKeys.has(s.toLowerCase()));
    return {
      effective: [...(ctx.normalized_locations ?? []), ...keptRaw],
      authority: "original_user_instruction",
      hasUnresolvedExplicit: unresolved.length > 0,
    };
  }

  if ((ctx.parser_locations ?? []).length > 0) {
    return { effective: [...ctx.parser_locations], authority: "model_inference", hasUnresolvedExplicit: false };
  }

  return { effective: [], authority: "model_inference", hasUnresolvedExplicit: false };
}

/** Stable identity for a mission, for diagnostics and idempotency. */
export function missionHash(mission: AgentoryMission): Promise<string> {
  return sha256Hex(canonicalJson(mission));
}
