// RESTATEMENT RECONCILIATION BY VALUE (mission reliability S1, root cause R1/R2).
//
// The model may express a requirement in its proper structured field AND restate it in
// `hard_constraints[]` under any field name it likes: "signal role", "target_roles",
// "sector", "excluded_titles", "freshness"… Every incident in this class (#203, #211,
// #219, cf55180) was a new field spelling missing from a closed list, and each restatement
// compiled to a hard requirement no evidence answers — so the mission blocked.
//
// This pass does not read the field name for meaning. It resolves the constraint's VALUE
// to the canonical identity execution would use, and compares it with what the mission
// already requires:
//
//   role         a registered title by its title id (AE, SDR, BDR), any other role word
//                by its role family — exactly the identity Stage 2's matcher executes,
//                so two values are "the same" only when they would match the same
//                postings. A specific title never merges into a family or another title.
//   exclusion    an excluding operator on a role: already excluded → duplicate; not yet
//                excluded → LIFTED into the hiring signal's exclusions (never discarded).
//                An exclusion of a role the mission also requires is a contradiction and
//                is kept for the interpretation gate.
//   window       a time operator whose number equals the one hiring/funding window, and
//                no other number of the mission — otherwise ambiguous, kept.
//   industry     an equality on values that each equal a stated company type (case and
//                grammatical number aside).
//
// THE FIELD CAN ONLY VETO. The value decides identity; the field never makes two
// values the same, but it can say the constraint is about something ELSE: "Same operator
// and value, another field: only the field tells them apart" (realGptA7 review R2:
// `previous_employer_role equals "Account Executive"` is a person's history, not the
// hiring signal; `company_age_days within_days 30` is the company's age). A field may
// therefore only name the dimension or nothing; a word in it that names anything else —
// any word not in the small schema vocabulary below — keeps the constraint, so an
// unforeseen field fails LOUDLY at the interpretation gate instead of losing meaning
// silently. These are words of the model's FIELD NAMES (schema vocabulary), not of the
// user's request; contract v3 (S4) removes free field names altogether.
//
// Anything else is kept exactly as it was and still reaches the interpretation gate:
// a different role, a count or threshold, a field that names a measured quantity
// ("sales_headcount"), two hiring signals, a value the mission does not carry. Every
// removal and lift is recorded in `changes`. Compile time only: stored missions are not
// re-read, so their meaning is unchanged.

import type { LeadMissionV1 } from "./leadMission.ts";
import { canonicalTitleOf, classifyRoleFamily } from "./roleFamilies.ts";
import { readSignalPhrase } from "./missionSignalDescriptor.ts";

type Raw = { operator?: unknown; value?: unknown; reason?: unknown };
type Signal = LeadMissionV1["required_signals"][number] & {
  qualifier?: { role_terms?: string[]; role_families?: string[]; excluded_role_terms?: string[]; role_match?: string };
};

/** Fields that the geography resolver and the audience reader already match by value. */
const VALUE_MATCHED_ELSEWHERE = new Set(["company_profile.locations", "geography", "location", "locations"]);

/** An operator that negates: the constraint excludes its value. */
const EXCLUDING_OP = /not|exclud|except|without|other_?than|none|^neq?$|!=|<>/;
/** An operator that compares quantities: never a restatement of a role, industry or window. */
const QUANTITY_OP = /gte|lte|>|<|min|max|at_?least|at_?most|count|number|threshold|greater|less|above|below|more|fewer|over|under|between|range/;
/** An operator that bounds a time: the only kind that can restate a window. */
const TIME_OP = /within|recen|posted|since|last/;
/** …and never one that bounds from below ("older_than_days 30" is the inverse). */
const NOT_UPPER_TIME_OP = /older|before|after|more_than|greater|over|exceed/;
/** Field words that say nothing about WHICH dimension: structure, not subject. */
const NEUTRAL_FIELD_WORDS = new Set(["signal", "signals", "required", "requirement", "requirements", "target", "targets",
  "detail", "details", "qualifier", "qualifiers", "criteria", "criterion", "filter", "filters", "value", "values", "must",
  "is", "has", "have", "the", "of", "for", "to", "a", "an", "any", "list", "current", "currently", "active", "actively",
  "primary", "main", "term", "terms", "constraint", "constraints", "condition", "match", "matches", "spec", ""]);
/** Field words that name each dimension. */
const DIMENSION_FIELD_WORDS: Record<"role" | "exclusion" | "window" | "industry", ReadonlySet<string>> = {
  role: new Set(["role", "roles", "position", "positions", "title", "titles", "job", "jobs", "hiring", "hire", "hires",
    "opening", "openings", "open", "status", "activity", "vacancy", "vacancies", "function", "family", "families", "occupation", "seat", "seats", "for"]),
  exclusion: new Set(["exclude", "excluded", "excludes", "exclusion", "exclusions", "excluding", "negative", "not", "except",
    "without", "no", "avoid", "skip", "omit", "banned", "disallowed"]),
  window: new Set(["window", "recency", "recent", "within", "days", "day", "posted", "posting", "postings", "timeframe",
    "time", "freshness", "fresh", "since", "last", "hiring", "job", "jobs", "funding"]),
  industry: new Set(["industry", "industries", "vertical", "verticals", "sector", "sectors", "segment", "segments", "market",
    "business", "type", "types", "category", "categories", "niche", "domain", "company", "kind", "space", "field"]),
};
/** Does the field name only `dims` (or nothing)? A role word in the field must be the value's own family. */
function fieldAllows(field: string, dims: Array<keyof typeof DIMENSION_FIELD_WORDS>, valueIds: readonly string[] = []): boolean {
  return fieldKey(field).split(/_+/).every((w) =>
    NEUTRAL_FIELD_WORDS.has(w) || dims.some((d) => DIMENSION_FIELD_WORDS[d].has(w)) ||
    (dims.includes("role") && valueIds.length > 0 && (() => {
      const id = roleIdentity(w);
      return !!id && valueIds.every((v) => v === id || v.startsWith("title:") && id.startsWith("family:"));
    })()));
}

/** A field naming a measured quantity: its value is about an amount, not an identity. */
const QUANTITY_FIELD = /count|number|headcount|employee|size|total|amount|revenue|percent|growth|ratio/;

const fieldKey = (f: string) =>
  String(f ?? "").trim().replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[.\s-]+/g, "_");
const singular = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
    .replace(/ies$/, "y").replace(/(ch|sh|x|ss)es$/, "$1").replace(/s$/, "");

/** The execution identity of one role word: `title:<id>` or `family:<id>`, else null. */
export function roleIdentity(term: string): string | null {
  const t = canonicalTitleOf(term);
  if (t) return `title:${t}`;
  const f = classifyRoleFamily(term);
  return f && f !== "custom" ? `family:${f}` : null;
}

/**
 * The role identities a constraint VALUE names, read by the same signal reader that
 * reads the user's signal phrases (so "actively hiring salespeople" names salespeople,
 * and "SDRs or BDRs" names both). Null when any value names no role: a value that is not
 * wholly a role statement is not reconciled.
 */
function valueRoles(values: unknown[]): { terms: string[]; ids: string[] } | null {
  const terms: string[] = [];
  for (const v of values) {
    if (typeof v !== "string" || !v.trim() || /\d/.test(v)) return null;
    const read = readSignalPhrase(`hiring ${v}`);
    const found = read?.qualifier?.role_terms ?? [];
    if (!found.length) return null;
    terms.push(...found);
  }
  const ids = terms.map(roleIdentity);
  if (!ids.length || ids.some((x) => x === null)) return null;
  return { terms, ids: ids as string[] };
}

const idsOf = (terms: readonly string[] | undefined) =>
  new Set((terms ?? []).map(roleIdentity).filter((x): x is string => !!x));

export function reconcileRestatements(mission: LeadMissionV1, changes: string[]): LeadMissionV1 {
  const hard = { ...(mission.hard_constraints ?? {}) } as Record<string, Raw>;
  let signals = [...(mission.required_signals ?? [])] as Signal[];
  const kindOf = (s: Signal) => String(s.event ?? s.type ?? "");
  const hiringIdx = signals.map((s, i) => (kindOf(s) === "hiring" ? i : -1)).filter((i) => i >= 0);
  const er = mission.company_profile?.employee_range ?? {};
  // Every descriptor the profile carries: the compiler files a stated industry under
  // company_types, verticals or business_models depending on what it is.
  const cp = (mission.company_profile ?? {}) as unknown as Record<string, unknown>;
  const companyTypes = new Set(["company_types", "verticals", "business_models"]
    .flatMap((k) => (Array.isArray(cp[k]) ? cp[k] as unknown[] : [])).map((t) => singular(String(t))));

  for (const [field, raw0] of Object.entries(hard)) {
    if (VALUE_MATCHED_ELSEWHERE.has(field)) continue;
    const raw = (raw0 && typeof raw0 === "object" && !Array.isArray(raw0) ? raw0 : { value: raw0 }) as Raw;
    const op = String(raw.operator ?? "").trim().toLowerCase();
    const values = Array.isArray(raw.value) ? raw.value : [raw.value];
    if (!values.length || values.every((v) => v === null || v === undefined || v === "")) continue;
    if (QUANTITY_FIELD.test(fieldKey(field))) continue;
    const excluding = EXCLUDING_OP.test(op);
    const record = (what: string) => {
      changes.push(`hard_constraint_${what}:${field}:${op}:${JSON.stringify(raw.value)}`);
      delete hard[field];
    };

    // ── Role (requirement or exclusion) ──
    const roles = hiringIdx.length === 1 && !QUANTITY_OP.test(op) ? valueRoles(values) : null;
    if (roles && !fieldAllows(field, excluding ? ["role", "exclusion"] : ["role"], roles.ids)) continue;
    if (roles) {
      const i = hiringIdx[0];
      const q = { ...(signals[i].qualifier ?? {}) };
      const required = new Set([...idsOf(q.role_terms), ...(q.role_terms?.length ? [] : (q.role_families ?? []).map((f) => `family:${f}`))]);
      const excluded = idsOf(q.excluded_role_terms);
      if (excluding) {
        if (roles.ids.some((id) => required.has(id))) continue; // contradiction: kept for the gate
        if (roles.ids.every((id) => excluded.has(id))) { record("deduplicated->hiring.excluded"); continue; }
        const add = roles.terms.filter((t) => !excluded.has(roleIdentity(t)!));
        q.excluded_role_terms = [...(q.excluded_role_terms ?? []), ...add];
        signals = signals.map((s, j) => (j === i ? { ...s, qualifier: q } as Signal : s));
        record("lifted->hiring.excluded");
        continue;
      }
      if (roles.ids.every((id) => required.has(id))) { record("deduplicated->hiring"); continue; }
      continue; // a different role: a requirement of its own, kept
    }
    if (excluding || QUANTITY_OP.test(op) && !TIME_OP.test(op)) continue;

    // ── Window ──
    if (values.length === 1 && TIME_OP.test(op) && !NOT_UPPER_TIME_OP.test(op) && fieldAllows(field, ["window"])) {
      const v = values[0];
      const n = typeof v === "number" ? v : /^\s*\d{1,4}\s*$/.test(String(v ?? "")) ? Number(v) : NaN;
      if (Number.isFinite(n)) {
        const windows = signals.filter((s) => typeof s.timeframe_days === "number" && s.timeframe_days === n);
        const collides = n === er.min || n === er.max;
        if (windows.length === 1 && !collides && signals.filter((s) => kindOf(s) === kindOf(windows[0])).length === 1) {
          record(`deduplicated->${kindOf(windows[0])}.window`);
        }
        continue;
      }
    }

    // ── Industry / company type ──
    if (companyTypes.size && fieldAllows(field, ["industry"]) && values.every((v) => typeof v === "string" && companyTypes.has(singular(v)))) {
      record("deduplicated->company_types");
    }
  }
  return { ...mission, hard_constraints: hard, required_signals: signals as LeadMissionV1["required_signals"] };
}
