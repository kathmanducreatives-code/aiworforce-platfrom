// THE COMPATIBILITY BOUNDARY: a compiled mission (any contract version: v1, v3, or a
// stored production mission) → a Mission Contract.
//
// This is the ONE place the legacy representation is read. It converts the mission's
// criteria — the meaning the existing compiler produced and froze — into typed contract
// requirements, LOSSLESSLY: every field the engine acts on is carried over, and anything
// this boundary does not model makes the conversion FAIL (a named reason), never silently
// lose meaning. `compileContract` is its exact inverse; `contractRoundTrip` proves it.
//
// It never reads `original_user_query` to decide anything: the query becomes the
// contract's `objective` (display and audit only).

import { criteriaOf } from "../missionCriteriaReader.ts";
import { CANONICAL_SIGNAL_KINDS } from "../signalKinds.ts";
import {
  assumptionsOf, type Evaluability, type MissionContract, MISSION_CONTRACT_VERSION, type Origin, type OriginSource,
  type Requirement, type SignalWindow,
} from "./contract.ts";

type Crit = {
  id: string; kind: string; dimension: string; value: unknown; label?: string; rationale?: string; source?: string;
  user_phrase?: string; status?: string; time_window?: Record<string, unknown>; any_of?: string[];
  geography_scope?: "headquarters" | "presence"; confidence?: number; elevated_by?: string | null;
};
type MissionShape = {
  original_user_query?: string; target_entity?: string; requested_count?: number | null;
  decision_makers?: { roles?: string[] } | null; directives?: { disallowed_broadening?: string[] } | null;
  required_signal_terms?: string[]; criteria?: unknown;
};

const SIGNALS = new Set<string>(CANONICAL_SIGNAL_KINDS);
const CRITERION_KEYS = new Set(["id", "kind", "dimension", "value", "label", "rationale", "source", "user_phrase", "status",
  "time_window", "any_of", "geography_scope", "confidence", "elevated_by"]);
const WINDOW_KEYS = new Set(["days", "basis", "source", "rule", "enforced"]);
const SOURCES = new Set<OriginSource>(["user_explicit", "user_inferred", "company_brain_policy", "company_brain_preference", "system_default"]);
const STATUSES = new Set<Evaluability>(["ok", "unprovable_today", "unrepresentable", "unrecognised"]);
const ROLE_KEYS = ["role_terms", "role_families", "excluded_role_terms", "role_match"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strs = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v as string[] : null);

export type BoundaryResult = { ok: true; contract: MissionContract } | { ok: false; lossy: string[] };

/** A compiled mission → its Mission Contract, or the reasons it cannot be converted without loss. */
export function contractFromMission(mission: MissionShape, opts: { model?: string | null; from?: string | null } = {}): BoundaryResult {
  const lossy: string[] = [];
  const criteria = criteriaOf(mission as never) as unknown as Crit[];
  const requirements: Requirement[] = [];
  for (const c of criteria) {
    const r = requirementOf(c, lossy, mission);
    if (r) requirements.push(r);
  }
  // any_of groups: criteria naming the same alternatives are one requirement.
  const groups = new Map<string, string[]>();
  for (const c of criteria) {
    if (!c.any_of?.length) continue;
    const key = JSON.stringify(c.any_of);
    groups.set(key, [...(groups.get(key) ?? []), c.id]);
  }
  const entity = typeof mission.target_entity === "string" ? mission.target_entity : "company";
  const count = mission.requested_count ?? null;
  if (count !== null && (!Number.isInteger(count) || count < 1)) lossy.push(`requested_count ${String(count)} is not a positive integer`);
  if (lossy.length) return { ok: false, lossy };
  const contract: MissionContract = {
    version: MISSION_CONTRACT_VERSION,
    objective: mission.original_user_query ?? "",
    deliverable: { entity, count, personRoles: [...(mission.decision_makers?.roles ?? [])] },
    forbidBroadening: [...(mission.directives?.disallowed_broadening ?? [])],
    requirements,
    anyOf: [...groups.values()],
    assumptions: assumptionsOf(requirements),
    ambiguities: [],
    authorizedActions: ["discover", "verify"],
    budget: null,
    completion: { targetCount: count, stopWhen: "target_reached_or_budget_exhausted" },
    provenance: { interpreter: "compiled_mission_boundary", model: opts.model ?? null, from: opts.from ?? null },
  };
  return { ok: true, contract };
}

function originOf(c: Crit, lossy: string[]): Origin {
  const source = (c.source ?? "user_explicit") as OriginSource;
  if (!SOURCES.has(source)) lossy.push(`${c.id}: unknown source ${c.source}`);
  return {
    source, span: c.user_phrase ?? "", policy: null,
    ...(c.confidence !== undefined ? { confidence: c.confidence } : {}),
    ...(c.elevated_by !== undefined ? { elevatedBy: c.elevated_by } : {}),
  };
}

function windowOf(c: Crit, lossy: string[]): SignalWindow | null {
  const w = c.time_window;
  if (!w) return null;
  for (const k of Object.keys(w)) if (!WINDOW_KEYS.has(k)) lossy.push(`${c.id}: unmodelled window field ${k}`);
  if (typeof w.days !== "number") { lossy.push(`${c.id}: window without days`); return null; }
  const source = String(w.source ?? "user_explicit") as OriginSource;
  if (!SOURCES.has(source)) lossy.push(`${c.id}: unknown window source ${String(w.source)}`);
  return {
    days: w.days, basis: String(w.basis ?? ""),
    origin: { source, span: "", policy: typeof w.rule === "string" ? w.rule : null },
    enforced: typeof w.enforced === "boolean" ? w.enforced : null,
  };
}

function requirementOf(c: Crit, lossy: string[], mission: MissionShape): Requirement | null {
  for (const k of Object.keys(c)) if (!CRITERION_KEYS.has(k)) lossy.push(`${c.id}: unmodelled criterion field ${k}`);
  const necessity = c.kind === "hard" ? "required" : c.kind === "target" ? "preferred" : null;
  if (!necessity) { lossy.push(`${c.id}: criterion kind ${c.kind} has no contract necessity`); return null; }
  const status = (c.status ?? "ok") as Evaluability;
  if (!STATUSES.has(status)) lossy.push(`${c.id}: unknown status ${c.status}`);
  const base = {
    id: c.id, necessity, origin: originOf(c, lossy), evaluability: status,
    alternatives: c.any_of?.length ? [...c.any_of] : null,
    display: { label: c.label ?? "", rationale: c.rationale ?? "" },
  } as const;
  const notSignal = () => { if (c.time_window) lossy.push(`${c.id}: a ${c.dimension} criterion with a window`); };
  switch (c.dimension) {
    case "geography":
      notSignal();
      if (typeof c.value !== "string") { lossy.push(`${c.id}: geography value is not a place`); return null; }
      return { ...base, dimension: "geography", polarity: "include", place: c.value, scope: c.geography_scope ?? null };
    case "company_size": {
      notSignal();
      const v = c.value;
      if (!isObj(v) || Object.keys(v).some((k) => k !== "min" && k !== "max")) { lossy.push(`${c.id}: size value shape`); return null; }
      const n = (x: unknown) => (typeof x === "number" ? x : null);
      if (("min" in v && n(v.min) === null) || ("max" in v && n(v.max) === null)) lossy.push(`${c.id}: size bound is not a number`);
      return { ...base, dimension: "company_size", min: n(v.min), max: n(v.max) };
    }
    case "industry":
    case "business_model":
      notSignal();
      if (typeof c.value !== "string") { lossy.push(`${c.id}: ${c.dimension} value is not a string`); return null; }
      return { ...base, dimension: "industry", facet: c.dimension, polarity: "include", value: c.value };
    case "company_stage":
      notSignal();
      return { ...base, dimension: "company_stage", stage: c.value };
    case "known_companies": {
      notSignal();
      const v = strs(c.value);
      if (!v) { lossy.push(`${c.id}: known_companies value`); return null; }
      return { ...base, dimension: "known_companies", companies: v };
    }
    case "exclusion": {
      notSignal();
      if (!isObj(c.value) || typeof c.value.field !== "string" || Object.keys(c.value).some((k) => k !== "field" && k !== "value")) {
        lossy.push(`${c.id}: exclusion value shape`); return null;
      }
      return { ...base, dimension: "exclusion", field: c.value.field, values: c.value.value };
    }
    case "constraint":
    case "unrecognised_signal":
    case "unrepresentable_evidence":
      notSignal();
      return { ...base, dimension: "unsupported", polarity: "include", compiledAs: c.dimension, value: c.value };
  }
  if (SIGNALS.has(c.dimension)) {
    const v = c.value;
    if (!isObj(v) || typeof v.event !== "string" || typeof v.subject !== "string" ||
      Object.keys(v).some((k) => !["event", "subject", "qualifier"].includes(k))) {
      lossy.push(`${c.id}: signal value shape`); return null;
    }
    const q = isObj(v.qualifier) ? v.qualifier : {};
    const roleList = (k: string) => (k in q ? (strs(q[k]) ?? (lossy.push(`${c.id}: ${k} is not a string list`), [])) : null);
    const qualifiers = Object.fromEntries(Object.entries(q).filter(([k]) => !(ROLE_KEYS as readonly string[]).includes(k)));
    const topics = c.dimension === "social_activity" ? [...(mission.required_signal_terms ?? [])] : [];
    return {
      ...base, dimension: "signal", kind: c.dimension, event: v.event, subject: v.subject, topics,
      roleTerms: roleList("role_terms"), roleFamilies: roleList("role_families"), excludedRoleTerms: roleList("excluded_role_terms"),
      roleMatch: "role_match" in q ? String(q.role_match) : null,
      qualifiers, qualifierPresent: "qualifier" in v,
      window: windowOf(c, lossy),
    };
  }
  lossy.push(`${c.id}: unmodelled dimension ${c.dimension}`);
  return null;
}
