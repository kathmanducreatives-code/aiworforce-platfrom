// REQUIREMENT VOCABULARY — the closed set of requirement types a model may name.
//
// Stage 4 of Option E (architecture review C3). The mission schema lets the model write
// any `hard_constraints[].field` string, and three of five live interpretation bugs came
// through that door (`hiring_activity`, `hiring.role`, a business model filed as an
// industry). This module is the vocabulary the stricter contract will require, and the
// canonicaliser that maps today's free-text fields onto it.
//
// It is used in SHADOW only (scripts/dev/contract-shadow.ts): nothing in the request
// path reads it yet. A field it cannot place is never dropped and never satisfied: it
// becomes `other`, which must quote the user's own words (`quoted`), and the compiler's
// existing unmappable / unprovable_today path keeps it visible as unverifiable.
//
// Pure.

import { normaliseFieldName } from "./missionCriteria.ts";

export const REQUIREMENT_VOCABULARY_VERSION = "requirement-vocabulary-v1" as const;

/** The canonical requirement types, each with the field spellings models have used for it. */
export const CANONICAL_REQUIREMENTS = {
  geography: ["geography", "geo", "location", "locations", "company_profile_locations", "country", "countries", "region", "hq", "headquarters", "hq_location", "headquarters_location"],
  geography_presence: ["presence", "office_location", "offices", "operating_location", "operations_location"],
  company_stage: ["stage", "company_stage", "funding_stage"],
  industry: ["industry", "industries", "vertical", "verticals", "sector", "sectors", "company_type", "company_types", "industry_or_company_type"],
  business_model: ["business_model", "business_models", "audience", "customer_type"],
  hiring_role: ["hiring", "hiring_role", "hiring_roles", "hiring_activity", "hiring_signal", "hiring_status", "open_role", "open_roles", "open_role_type", "job_title", "job_titles", "job_postings", "is_hiring", "actively_hiring", "currently_hiring"],
  /** A number of open roles ("at least 5 open roles"): a count, never a role. */
  hiring_count: ["open_roles_count", "number_of_open_roles", "open_role_count", "open_positions_count", "hiring_count"],
  hiring_window: ["hiring_signal_recency", "hiring_recency", "posting_recency", "job_posted_within_days", "hiring_window"],
  funding_event: ["funding", "funding_event", "funding_round", "recent_funding"],
  funding_window: ["funding_recency", "funding_recency_days", "last_funding_days", "funding_window_days"],
  employee_range: ["employee_range", "employee_count", "employees", "headcount", "company_size", "size"],
  employee_min: ["employee_min", "min_employees", "employee_count_min", "employees_min", "headcount_min"],
  employee_max: ["employee_max", "max_employees", "employee_count_max", "employees_max", "headcount_max"],
  excluded_company_types: ["excluded_company_types", "excluded_industries", "exclude_company_types", "exclude_industries"],
  excluded_geographies: ["excluded_geographies", "excluded_locations", "exclude_geographies", "exclude_locations"],
  excluded_roles: ["excluded_roles", "excluded_role_terms", "exclude_roles"],
  known_companies: ["known_companies", "companies", "company_names", "target_companies"],
} as const satisfies Record<string, readonly string[]>;

export type CanonicalRequirement = keyof typeof CANONICAL_REQUIREMENTS;

const ALIAS: ReadonlyMap<string, CanonicalRequirement> = new Map(
  (Object.entries(CANONICAL_REQUIREMENTS) as [CanonicalRequirement, readonly string[]][])
    .flatMap(([canon, aliases]) => aliases.map((a) => [normaliseFieldName(a), canon] as const)),
);

export type Classified =
  | { kind: "canonical"; field: CanonicalRequirement; originalField: string }
  | { kind: "other"; originalField: string; quoted: boolean; phrase: string };

const text = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).filter((x) => x != null && typeof x !== "object").map((x) => String(x).trim()).filter(Boolean);

/**
 * Place one proposed constraint: a canonical type, or `other`. `other` records whether its
 * value is quoted from the request — an unquoted `other` is the model's own idea and the
 * strict contract will refuse to make it hard.
 */
export function classifyConstraint(field: string, value: unknown, query: string): Classified {
  const canon = ALIAS.get(normaliseFieldName(field));
  // A hiring field whose value is a number is a COUNT ("open_roles: 5"), not a role.
  if (canon === "hiring_role" && text(value).length > 0 && text(value).every((v) => /^\s*\d+\s*$/.test(v))) {
    return { kind: "canonical", field: "hiring_count", originalField: field };
  }
  if (canon) return { kind: "canonical", field: canon, originalField: field };
  const q = String(query ?? "").toLowerCase();
  const values = text(value);
  const phrase = values.find((v) => v.length > 1 && q.includes(v.toLowerCase())) ?? "";
  return { kind: "other", originalField: field, quoted: !!phrase, phrase };
}

/** Every proposed constraint of a mission or proposal, classified. Works on the array (proposal) and record (mission) shapes. */
export function classifyConstraints(hardConstraints: unknown, query: string): Classified[] {
  const entries: [string, unknown][] = Array.isArray(hardConstraints)
    ? hardConstraints.filter((c) => c && typeof c === "object").map((c) => [String((c as { field?: unknown }).field ?? ""), (c as { value?: unknown }).value])
    : Object.entries((hardConstraints ?? {}) as Record<string, unknown>).map(([k, v]) => [k, v && typeof v === "object" && !Array.isArray(v) ? (v as { value?: unknown }).value : v]);
  return entries.filter(([f]) => f).map(([f, v]) => classifyConstraint(f, v, query));
}
