// What the compiled mission requires, in the terms providers filter on.
//
// Input is `compileLeadMission(...).final_mission` — the mission compiler is
// still the only reader of the user's request, and nothing here re-reads it.
// Every hard criterion becomes exactly one HardRequirement; one this layer
// cannot express becomes `unmappable`, which no provider supports, so a plan
// that would have to ignore it fails closed instead of quietly broadening.
//
// Pure.

import type { DiscoveryRequirements, FilterKey, HardRequirement, Range } from "./types.ts";
import { sharedCriteria } from "./sharedQualification.ts";

interface CriterionLike {
  id?: string; kind?: string; dimension?: string; value?: unknown; label?: string;
  status?: string; any_of?: string[]; geography_scope?: "headquarters" | "presence";
}
interface MissionLike {
  original_user_query?: string;
  target_entity?: string;
  requested_count?: number;
  criteria?: CriterionLike[];
  directives?: { disallowed_broadening?: string[] };
  decision_makers?: { roles?: string[] } | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function asRange(v: unknown): Range | null {
  if (!v || typeof v !== "object") return null;
  const r = v as { min?: unknown; max?: unknown };
  const out = { min: num(r.min), max: num(r.max) };
  return out.min === null && out.max === null ? null : out;
}

function values(c: CriterionLike): string[] {
  if (Array.isArray(c.any_of) && c.any_of.length) return c.any_of.filter((x): x is string => !!str(x));
  if (Array.isArray(c.value)) return c.value.filter((x): x is string => !!str(x));
  const s = str(c.value);
  return s ? [s] : [];
}

const SIGNAL_DIMENSIONS_NOT_SIGNALS = new Set([
  "geography", "industry", "business_model", "company_size", "company_stage",
  "known_companies", "exclusion", "constraint", "unrecognised_signal", "unrepresentable_evidence",
  "company_profile",
]);

/** Map one hard criterion. Returns null for a criterion another one already covers. */
function mapHard(c: CriterionLike): HardRequirement | null {
  const base = { criterionId: c.id ?? `${c.dimension}:?`, label: c.label ?? String(c.dimension), representable: (c.status ?? "ok") === "ok" };
  const unmappable = (why: string): HardRequirement => ({ ...base, key: "unmappable", values: [], detail: why });
  if (!base.representable) return unmappable(`criterion status ${c.status}`);
  switch (c.dimension) {
    case "industry": return { ...base, key: "industry", values: values(c) };
    case "business_model": return { ...base, key: "business_model", values: values(c) };
    case "company_stage": return { ...base, key: "company_stage", values: values(c).flatMap((v) => v.split("|")) };
    case "known_companies": return { ...base, key: "known_companies", values: values(c) };
    case "geography":
      return { ...base, key: c.geography_scope === "presence" ? "geography_person" : "geography_hq", values: values(c) };
    case "company_size": {
      const r = asRange(c.value);
      return r ? { ...base, key: "employee_range", values: r } : unmappable("company size without a range");
    }
    case "exclusion":
    case "constraint": {
      const v = (c.value ?? {}) as { field?: unknown; value?: unknown };
      const field = str(v.field);
      const list = Array.isArray(v.value) ? v.value.filter((x): x is string => !!str(x)) : (str(v.value) ? [v.value as string] : []);
      if (field === "excluded_company_types" || field === "excluded_industries") return { ...base, key: "excluded_company_types", values: list };
      if (field === "excluded_geographies" || field === "excluded_locations") return { ...base, key: "excluded_geography", values: list };
      // The compiler emits the size bound both as company_size and as a
      // constraint; the range carries it, so the constraint adds nothing.
      if (field === "employee_max" || field === "employee_min") return null;
      if (field === "geography" || field === "company_profile.locations") return null;
      return unmappable(`constraint ${field ?? "?"} has no provider filter`);
    }
    case "unrecognised_signal":
    case "unrepresentable_evidence":
      return unmappable(`${c.dimension}: ${c.label ?? ""}`);
    default:
      if (c.dimension && !SIGNAL_DIMENSIONS_NOT_SIGNALS.has(c.dimension)) {
        return { ...base, key: "signal", values: [c.dimension], detail: c.dimension };
      }
      return unmappable(`dimension ${c.dimension ?? "?"}`);
  }
}

// The broadening dimensions, in the compiler's canonical vocabulary
// (`BROADENING_DIMENSIONS` on the newer compiler). The newer compiler keeps
// each entry as written and ADDS its canonical name ("employee_range" and
// "size"); the older one passes entries through. Both read the same here: an
// entry is folded onto the dimension it names, an unreadable one is kept in
// `forbidBroadeningUnread` and never dropped silently.
export type BroadeningDimension = "geography" | "industry" | "business_model" | "stage" | "size" | "role" | "recency";
const BROADENING_ALIASES: Readonly<Record<string, BroadeningDimension>> = Object.freeze({
  "geography": "geography", "geo": "geography", "location": "geography", "locations": "geography", "country": "geography",
  "countries": "geography", "region": "geography", "hq": "geography", "headquarters": "geography", "geography hq": "geography",
  "industry": "industry", "industries": "industry", "vertical": "industry", "sector": "industry", "company type": "industry",
  "company types": "industry",
  "business model": "business_model",
  "stage": "stage", "company stage": "stage", "funding stage": "stage",
  "size": "size", "company size": "size", "employee range": "size", "employee count": "size", "employees": "size",
  "headcount": "size", "employee max": "size", "employee min": "size",
  "role": "role", "roles": "role", "title": "role", "titles": "role", "job title": "role", "job titles": "role",
  "recency": "recency", "posting recency": "recency", "hiring window": "recency", "freshness": "recency",
});
/** The provider filters a broadening ban protects. */
export const BROADENING_FILTER_KEYS: Readonly<Record<BroadeningDimension, readonly FilterKey[]>> = Object.freeze({
  geography: ["geography_hq", "geography_person", "excluded_geography"],
  industry: ["industry", "excluded_company_types"],
  business_model: ["business_model"],
  stage: ["company_stage"],
  size: ["employee_range"],
  role: ["roles"],
  recency: ["signal"],
});

export function canonicalBroadening(entries: readonly unknown[]): { dims: BroadeningDimension[]; unread: string[] } {
  const dims: BroadeningDimension[] = [];
  const unread: string[] = [];
  for (const raw of entries) {
    const entry = str(raw);
    if (!entry) continue;
    const dim = BROADENING_ALIASES[entry.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ")];
    if (!dim) { if (!unread.includes(entry)) unread.push(entry); continue; }
    if (!dims.includes(dim)) dims.push(dim);
  }
  return { dims, unread };
}

/** Fold a compiled mission into provider-facing requirements. */
export function requirementsFromMission(mission: MissionLike): DiscoveryRequirements {
  const hard: HardRequirement[] = [];
  const preferences: DiscoveryRequirements["preferences"] = [];
  const seen = new Set<string>();
  for (const c of mission.criteria ?? []) {
    if (c.kind === "hard") {
      const r = mapHard(c);
      if (!r) continue;
      // any_of alternatives share one requirement (RC02): keep the first.
      const dedupe = `${r.key}:${JSON.stringify(r.values)}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      hard.push(r);
    } else if (c.kind === "target") {
      const r = mapHard({ ...c, status: "ok" });
      if (r && r.key !== "unmappable" && Array.isArray(r.values)) {
        preferences.push({ criterionId: r.criterionId, label: r.label, key: r.key, values: r.values });
      }
    }
  }
  const roles = (mission.decision_makers?.roles ?? []).filter((r): r is string => !!str(r));
  const targetEntity = mission.target_entity === "person" || mission.target_entity === "contact" ? "person" : "company";
  if (targetEntity === "person" && roles.length) {
    hard.push({ criterionId: "decision_makers.roles", key: "roles", values: roles, label: `Role: ${roles.join(" or ")}`, representable: true });
  }
  return {
    originalQuery: mission.original_user_query ?? "",
    targetEntity,
    requestedCount: Math.max(1, Math.min(500, Math.floor(mission.requested_count ?? 25))),
    hard,
    preferences,
    roles,
    criteria: sharedCriteria(mission as { criteria?: unknown[] }),
    ...(() => {
      const b = canonicalBroadening(mission.directives?.disallowed_broadening ?? []);
      return { forbidBroadening: b.dims, forbidBroadeningUnread: b.unread };
    })(),
  };
}

export function hardKeys(r: DiscoveryRequirements): Set<FilterKey> {
  return new Set(r.hard.map((h) => h.key));
}
