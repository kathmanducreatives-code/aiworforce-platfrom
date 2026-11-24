// MISSION SEMANTICS — what a compiled mission MEANS, as one canonical object and hash.
//
// `missionHash` (leadMission.ts) is the mission's IDENTITY: it keys checkpoints,
// capability plans and monitoring rows, and is deliberately left unchanged here.
// The strategy plan hash binds criterion IDs only (`dimension:slug(value)`), so a
// hard and a preferred "B2B", or a US-headquarters and a US-presence requirement,
// hash the same (architecture review, finding C1).
//
// This module is the semantic fingerprint used to compare meanings: the baseline
// and replay snapshots, the shadow comparison of interpretation contracts, and the
// plan binding. It keeps every field that changes what is required — kind,
// dimension, value, scope, time window, alternatives, status, elevation — and drops
// display text (label, rationale, user_phrase, confidence) so a reworded card is not
// a semantic change.
//
// Pure. No network, no clock, no model.

import { canonicalJson, sha256Hex } from "./providerInputFingerprint.ts";

export const MISSION_SEMANTICS_VERSION = "mission-semantics-v1" as const;

export interface SemanticCriterion {
  id: string;
  kind: string;
  dimension: string;
  value: unknown;
  status: string;
  geography_scope?: string;
  time_window?: unknown;
  any_of?: string[];
  elevated_by?: string;
}

export interface SemanticSignal {
  type: string;
  timeframe_days: number | null;
  role_terms: string[];
  role_families: string[];
  excluded_role_terms: string[];
}

export interface MissionSemantics {
  v: typeof MISSION_SEMANTICS_VERSION;
  target_entity: string | null;
  requested_output: string | null;
  requested_count: number | null;
  criteria: SemanticCriterion[];
  signals: SemanticSignal[];
  decision_maker_roles: string[];
}

interface CriterionLike {
  id?: unknown; kind?: unknown; dimension?: unknown; value?: unknown; status?: unknown;
  geography_scope?: unknown; time_window?: unknown; any_of?: unknown; elevated_by?: unknown;
}
interface SignalLike {
  type?: unknown; event?: unknown; timeframe_days?: unknown;
  qualifier?: { role_terms?: unknown; role_families?: unknown; excluded_role_terms?: unknown } | null;
  role_families?: unknown;
}
interface MissionLike {
  target_entity?: unknown; requested_output?: unknown; requested_count?: unknown;
  required_signals?: unknown; decision_makers?: { roles?: unknown } | null;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strs = (v: unknown): string[] =>
  (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase()) : []).sort();

/** The criteria, reduced to what they require, in a stable order. */
export function semanticCriteria(criteria: readonly unknown[]): SemanticCriterion[] {
  return criteria
    .filter((c): c is CriterionLike => !!c && typeof c === "object")
    .map((c) => {
      const out: SemanticCriterion = {
        id: String(c.id ?? ""), kind: String(c.kind ?? ""), dimension: String(c.dimension ?? ""),
        value: c.value ?? null, status: String(c.status ?? "ok"),
      };
      if (str(c.geography_scope)) out.geography_scope = c.geography_scope as string;
      if (c.time_window != null) out.time_window = c.time_window;
      if (Array.isArray(c.any_of) && c.any_of.length) out.any_of = strs(c.any_of);
      if (str(c.elevated_by)) out.elevated_by = c.elevated_by as string;
      return out;
    })
    .sort((a, b) => (a.id + "\u0000" + a.kind).localeCompare(b.id + "\u0000" + b.kind));
}

/** The mission's meaning: its criteria plus the request-level facts criteria do not carry. */
export function missionSemantics(mission: MissionLike, criteria: readonly unknown[]): MissionSemantics {
  const signals = (Array.isArray(mission.required_signals) ? mission.required_signals : [])
    .filter((s): s is SignalLike => !!s && typeof s === "object")
    .map((s) => ({
      type: String(s.event ?? s.type ?? ""),
      timeframe_days: typeof s.timeframe_days === "number" ? s.timeframe_days : null,
      role_terms: strs(s.qualifier?.role_terms),
      role_families: strs(s.qualifier?.role_families ?? s.role_families),
      excluded_role_terms: strs(s.qualifier?.excluded_role_terms),
    }))
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  return {
    v: MISSION_SEMANTICS_VERSION,
    target_entity: str(mission.target_entity),
    requested_output: str(mission.requested_output),
    requested_count: typeof mission.requested_count === "number" ? mission.requested_count : null,
    criteria: semanticCriteria(criteria),
    signals,
    decision_maker_roles: strs(mission.decision_makers?.roles),
  };
}

/** SHA-256 of the canonical semantics. */
export function semanticsFingerprint(s: MissionSemantics): string {
  return sha256Hex(canonicalJson(s));
}

/**
 * What changed between two semantics, criterion by criterion, for review: a
 * criterion added, removed, or with a different kind / scope / value / window.
 */
export function semanticDiff(before: MissionSemantics, after: MissionSemantics): string[] {
  const out: string[] = [];
  const key = (c: SemanticCriterion) => c.id;
  const b = new Map(before.criteria.map((c) => [key(c), c])), a = new Map(after.criteria.map((c) => [key(c), c]));
  for (const [k, c] of b) if (!a.has(k)) out.push(`removed ${c.kind} ${k}`);
  for (const [k, c] of a) {
    const p = b.get(k);
    if (!p) { out.push(`added ${c.kind} ${k}`); continue; }
    for (const f of ["kind", "dimension", "status", "geography_scope", "elevated_by"] as const) {
      if ((p[f] ?? null) !== (c[f] ?? null)) out.push(`${k}: ${f} ${p[f] ?? "-"} → ${c[f] ?? "-"}`);
    }
    for (const f of ["value", "time_window", "any_of"] as const) {
      if (canonicalJson(p[f] ?? null) !== canonicalJson(c[f] ?? null)) out.push(`${k}: ${f} changed`);
    }
  }
  for (const f of ["target_entity", "requested_output", "requested_count"] as const) {
    if (before[f] !== after[f]) out.push(`${f}: ${before[f]} → ${after[f]}`);
  }
  if (canonicalJson(before.signals) !== canonicalJson(after.signals)) out.push("signals changed");
  if (canonicalJson(before.decision_maker_roles) !== canonicalJson(after.decision_maker_roles)) out.push("decision-maker roles changed");
  return out;
}
