// MISSION UNDERSTANDING — CONTRACT v3 (mission reliability S4, defects NL1–NL4).
//
// ── WHO DECIDES WHAT ─────────────────────────────────────────────────────────
//
//   THE MODEL  reads the user's words however they are written — casual English, slang,
//              typos, abbreviations, synonyms, indirect requests — and states their
//              MEANING in a closed vocabulary: a registered title or a role family, a
//              place from the geography registry with a scope, a signal kind, whether
//              each is required / preferred / excluded, AND vs OR. Every item quotes the
//              user's words it rests on. What it cannot settle it lists as an ambiguity.
//   CODE       validates, never re-decides: each quote must occur in the request
//              (typo-tolerant edit distance — not a keyword list); each id must exist in
//              its registry (the schema's enums already guarantee this for a strict
//              model, and this checks again); nothing is applied that fails. What is
//              applied is exactly what the model stated, converted to the canonical
//              MissionCriterion carriers, and recorded in `validator_changes`.
//
// The keyword re-readers this replaces for a v3 mission — role words copied verbatim
// and matched by lists (NL1), "a hiring cue word makes it required" (NL2), a fixed list
// of country words (NL3), "office/operations words make it presence" (NL4) — still run
// for v1/v2 missions, unchanged.
//
// OFF unless AGENTORY_MISSION_CONTRACT=v3. A v3 mission is compiled from this block
// only when the model produced it; without it the compile is v2.

import { CANONICAL_TITLES, ROLE_FAMILY_ALIASES } from "./roleFamilies.ts";
import { GEO_SCOPES } from "./geographyResolver.ts";

export const UNDERSTANDING_VERSION = "mission-understanding-v1" as const;

export const ROLE_TITLE_IDS = Object.freeze(Object.keys(CANONICAL_TITLES));
export const ROLE_FAMILY_IDS = Object.freeze(Object.keys(ROLE_FAMILY_ALIASES));
export const PLACE_IDS = Object.freeze(Object.keys(GEO_SCOPES));
/** Signal kinds the understanding may name (the compiler's own events). */
export const UNDERSTANDING_SIGNAL_KINDS = Object.freeze([
  "hiring", "funding", "expansion", "product_launch", "leadership_change", "headcount_growth", "technology",
  "social_activity",
] as const);
type SignalKind = typeof UNDERSTANDING_SIGNAL_KINDS[number];
export type Necessity = "required" | "preferred" | "excluded";

export interface ProposedRole { span: string; title: string | null; family: string | null; relation: "required" | "excluded" }
export interface ProposedPlace { span: string; place: string | null; other_place: string | null; scope: "headquarters" | "presence"; necessity: Necessity }
export interface ProposedSignal { span: string; kind: SignalKind; necessity: "required" | "preferred" }
export interface ProposedIndustry { span: string; industry: string; necessity: Necessity }
export interface ProposedUnderstanding {
  roles: ProposedRole[];
  role_match: "any" | "all";
  places: ProposedPlace[];
  /** The kinds of company asked for (industry, vertical, business model) — the user's own term. */
  industries: ProposedIndustry[];
  signals: ProposedSignal[];
  /** How the REQUIRED signals combine: all of them, or any one ("raised funding OR hiring"). */
  signal_logic: "all" | "any";
  ambiguities: { span: string; question: string }[];
  unsupported: { span: string; why: string }[];
}

// ── THE STRICT SCHEMA (OpenAI structured outputs: every key required, closed enums) ──

const span = { type: "string" as const, description: "The user's own words this rests on, copied exactly as written (typos included)." };
export const UNDERSTANDING_SCHEMA = Object.freeze({
  type: "object" as const,
  additionalProperties: false,
  required: ["roles", "role_match", "places", "industries", "signals", "signal_logic", "ambiguities", "unsupported"],
  description: "What the request MEANS, in Agentory's closed vocabulary. Read the user's words for meaning, whatever their spelling or style.",
  properties: {
    roles: {
      type: "array" as const,
      description: "Every job role the request is about (hiring for it, or excluding it). One entry per role.",
      items: {
        type: "object" as const, additionalProperties: false, required: ["span", "title", "family", "relation"],
        properties: {
          span,
          title: { type: ["string", "null"] as const, enum: [...ROLE_TITLE_IDS, null],
            description: "The registered title when the words name exactly that title (any spelling, abbreviation or typo: 'AEs', 'account execs', 'acount executives' are account_executive). Null for a broad word." },
          family: { type: ["string", "null"] as const, enum: [...ROLE_FAMILY_IDS, null],
            description: "The role family when the words name a broad kind of role ('salespeople', 'sales ppl', 'sellers', 'sales team' are gtm_sales). Null when a title is given." },
          relation: { type: "string" as const, enum: ["required", "excluded"],
            description: "excluded when the request rules this role out ('but not SDRs', 'no SDRs')." },
        },
      },
    },
    role_match: { type: "string" as const, enum: ["any", "all"],
      description: "any: a company hiring ANY one of the required roles qualifies (the usual meaning of a list or 'or'). all: only when the request clearly needs every role at once." },
    places: {
      type: "array" as const,
      description: "Every place the request names or refers to ('the states', 'stateside', 'America' are united states).",
      items: {
        type: "object" as const, additionalProperties: false, required: ["span", "place", "other_place", "scope", "necessity"],
        properties: {
          span,
          place: { type: ["string", "null"] as const, enum: [...PLACE_IDS, null], description: "The registry place. Null only when it is not in the list." },
          other_place: { type: ["string", "null"] as const, description: "Only when place is null: the place's own name (a city or state)." },
          scope: { type: "string" as const, enum: ["headquarters", "presence"],
            description: "headquarters: the company IS from / based / HQ'd there ('US companies', 'based out of the states'). presence: it operates, has an office, sells or does business there ('operate in', 'have a US office', 'doing business in')." },
          necessity: { type: "string" as const, enum: ["required", "preferred", "excluded"],
            description: "required unless the request hedges it ('ideally', 'prefer', 'bonus if') or rules it out ('not based in')." },
        },
      },
    },
    industries: {
      type: "array" as const,
      description: "Every kind of company asked for (industry, vertical, business model: 'fintech', 'B2B SaaS', 'insurance agencies').",
      items: {
        type: "object" as const, additionalProperties: false, required: ["span", "industry", "necessity"],
        properties: {
          span,
          industry: { type: "string" as const, description: "The industry in its usual name, correctly spelled." },
          necessity: { type: "string" as const, enum: ["required", "preferred", "excluded"] },
        },
      },
    },
    signals: {
      type: "array" as const,
      description: "Every company event the request asks about. Hiring is any wording about open roles or bringing people on ('looking to bring on', 'need sales ppl', 'growing the sales team').",
      items: {
        type: "object" as const, additionalProperties: false, required: ["span", "kind", "necessity"],
        properties: {
          span,
          kind: { type: "string" as const, enum: [...UNDERSTANDING_SIGNAL_KINDS] },
          necessity: { type: "string" as const, enum: ["required", "preferred"],
            description: "required when the request is defined by it — however indirectly it is said ('any companies looking to bring on…?' requires hiring). preferred only when hedged ('ideally', 'bonus if', 'nice to have')." },
        },
      },
    },
    signal_logic: { type: "string" as const, enum: ["all", "any"],
      description: "all: every required signal must hold (the default, 'and', 'both'). any: one is enough ('either … or', 'or')." },
    ambiguities: {
      type: "array" as const,
      description: "Only a GENUINE ambiguity that changes which companies qualify, as one short question. Empty when the meaning is clear.",
      items: { type: "object" as const, additionalProperties: false, required: ["span", "question"], properties: { span, question: { type: "string" as const } } },
    },
    unsupported: {
      type: "array" as const,
      description: "Requirements the vocabulary above cannot express, so they are never silently dropped.",
      items: { type: "object" as const, additionalProperties: false, required: ["span", "why"], properties: { span, why: { type: "string" as const } } },
    },
  },
});

export const UNDERSTANDING_INSTRUCTION = [
  "Also return 'understanding': what the request MEANS, in the closed vocabulary its schema gives.",
  "Users write casually, with typos, slang, abbreviations and indirect wording — read the meaning, not the keywords.",
  "Quote in every 'span' the user's own words exactly as written. Never invent a requirement the words do not support,",
  "never drop one they state, and never broaden or narrow it: a named title stays that title; a broad word is its family.",
  "'Headquartered / based / from / US companies' is headquarters; 'operate in / office in / do business in' is presence.",
  // DEFAULT READINGS, NEVER QUESTIONS (live paraphrase study 2026-11-05: 24 of 165 live
  // readings asked one of these instead of reading it; the TEST smoke failed twice on
  // "what recency window?"). Each is a reading the product already applies or the owner ruled.
  "These are settled readings, never ambiguities:",
  "a time window the user did not state ('recently', 'lately', 'currently', 'actively') — Agentory applies and discloses its default window;",
  "a bare 'in the US / in the States / US companies' with nothing about offices or operations — headquarters;",
  "a broad role word ('salespeople', 'sellers', 'sales reps', 'sales guys') — that role family, not a question about titles;",
  "'not X / no X / but not X' about a role — X is an excluded role, whatever the company's other openings;",
  "'growing the team / getting bigger / expanding headcount' — headcount_growth, not hiring;",
  "'hiring / recruiting / taking on staff / needing <role>' — hiring.",
  "If a difference that changes which companies qualify still cannot be settled from the words, list it in 'ambiguities'.",
].join(" ");

// ── TYPO-TOLERANT SPAN CHECK (an edit distance, not a word list) ─────────────

const tokens = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);

/** Optimal-string-alignment distance (Damerau–Levenshtein with adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
const allowedEdits = (len: number) => (len <= 4 ? 0 : len <= 8 ? 1 : 2);
/** One word is the other, allowing a typo: never across a different first letter (SDRs ≠ BDRs). */
const sameWord = (a: string, b: string) =>
  a === b || (a[0] === b[0] && editDistance(a, b) <= allowedEdits(Math.max(a.length, b.length)));

/**
 * Does the quoted span occur in the request? Token by token, contiguous, each token within
 * a small edit distance of the request's (0 for ≤4 letters, 1 up to 8, 2 beyond; never a
 * different first letter) — so a
 * quote that copies the user's typo, or corrects it, both verify; a quote of words the
 * user never wrote does not.
 */
export function spanInRequest(query: string, quoted: string): boolean {
  const q = tokens(query), s = tokens(quoted);
  if (!s.length || s.length > q.length) return false;
  for (let i = 0; i + s.length <= q.length; i++) {
    if (s.every((t, j) => sameWord(t, q[i + j]))) return true;
  }
  return false;
}

// ── VALIDATION ───────────────────────────────────────────────────────────────

export interface ValidatedUnderstanding extends ProposedUnderstanding {
  version: typeof UNDERSTANDING_VERSION;
  /** Items refused, with why — recorded, never applied. */
  rejected: { item: string; reason: string }[];
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
/** The display name of a registry place ("united states" → "United States"). */
export const placeName = (id: string) => (id.length <= 4 ? id.toUpperCase() : titleCase(id));
/** The canonical role term a registered title is carried as ("Account Executive"). */
export const titleTerm = (id: string) => titleCase(CANONICAL_TITLES[id]?.[0] ?? id);

export function parseUnderstanding(raw: unknown): ProposedUnderstanding | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as Record<string, unknown>[] : []);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    roles: arr(r.roles).map((x) => ({ span: String(x.span ?? ""), title: str(x.title), family: str(x.family),
      relation: x.relation === "excluded" ? "excluded" : "required" })),
    role_match: r.role_match === "all" ? "all" : "any",
    places: arr(r.places).map((x) => ({ span: String(x.span ?? ""), place: str(x.place), other_place: str(x.other_place),
      scope: x.scope === "presence" ? "presence" : "headquarters",
      necessity: x.necessity === "preferred" ? "preferred" : x.necessity === "excluded" ? "excluded" : "required" })),
    industries: arr(r.industries).map((x) => ({ span: String(x.span ?? ""), industry: String(x.industry ?? "").trim(),
      necessity: x.necessity === "preferred" ? "preferred" : x.necessity === "excluded" ? "excluded" : "required" })),
    signals: arr(r.signals).map((x) => ({ span: String(x.span ?? ""), kind: String(x.kind ?? "") as SignalKind,
      necessity: x.necessity === "preferred" ? "preferred" : "required" })),
    signal_logic: r.signal_logic === "any" ? "any" : "all",
    ambiguities: arr(r.ambiguities).map((x) => ({ span: String(x.span ?? ""), question: String(x.question ?? "") })),
    unsupported: arr(r.unsupported).map((x) => ({ span: String(x.span ?? ""), why: String(x.why ?? "") })),
  };
}

export function validateUnderstanding(query: string, u: ProposedUnderstanding): ValidatedUnderstanding {
  const rejected: { item: string; reason: string }[] = [];
  const quoted = (kind: string, s: string) => {
    if (spanInRequest(query, s)) return true;
    rejected.push({ item: `${kind}:${JSON.stringify(s)}`, reason: "quote_not_in_request" });
    return false;
  };
  const roles = u.roles.filter((r) => {
    if (!quoted("role", r.span)) return false;
    if (r.title && !ROLE_TITLE_IDS.includes(r.title)) { rejected.push({ item: `role:${r.title}`, reason: "unknown_title_id" }); return false; }
    if (r.family && !ROLE_FAMILY_IDS.includes(r.family)) { rejected.push({ item: `role:${r.family}`, reason: "unknown_family_id" }); return false; }
    if (!r.title && !r.family) { rejected.push({ item: `role:${JSON.stringify(r.span)}`, reason: "no_role_id" }); return false; }
    return true;
  });
  // A role both required and excluded is a contradiction the model must not settle silently.
  const key = (r: ProposedRole) => r.title ?? `family:${r.family}`;
  const conflicted = new Set(roles.filter((r) => r.relation === "required").map(key)
    .filter((k) => roles.some((r) => r.relation === "excluded" && key(r) === k)));
  const ambiguities = [...u.ambiguities.filter((a) => quoted("ambiguity", a.span))];
  for (const k of conflicted) ambiguities.push({ span: k, question: `Should ${k} be included or excluded?` });
  const places = u.places.filter((p) => {
    if (!quoted("place", p.span)) return false;
    if (p.place && !PLACE_IDS.includes(p.place)) { rejected.push({ item: `place:${p.place}`, reason: "unknown_place_id" }); return false; }
    if (!p.place && !(p.other_place ?? "").trim()) { rejected.push({ item: `place:${JSON.stringify(p.span)}`, reason: "no_place" }); return false; }
    return true;
  });
  const industries = (u.industries ?? []).filter((x) => quoted("industry", x.span) && !!x.industry);
  const signals = u.signals.filter((s) => {
    if (!quoted("signal", s.span)) return false;
    if (!(UNDERSTANDING_SIGNAL_KINDS as readonly string[]).includes(s.kind)) { rejected.push({ item: `signal:${s.kind}`, reason: "unknown_signal_kind" }); return false; }
    return true;
  });
  return {
    version: UNDERSTANDING_VERSION,
    roles: roles.filter((r) => !conflicted.has(key(r))),
    role_match: u.role_match,
    places, industries, signals,
    signal_logic: u.signal_logic,
    ambiguities,
    unsupported: u.unsupported.filter((x) => quoted("unsupported", x.span)),
    rejected,
  };
}

// ── APPLYING A VALIDATED UNDERSTANDING TO THE CANONICAL CARRIERS (compile time) ──

type Mission = import("./leadMission.ts").LeadMissionV1;
type Sig = Mission["required_signals"][number] & {
  qualifier?: { role_terms?: string[]; role_families?: string[]; excluded_role_terms?: string[]; role_match?: string };
};

export const familyOfTitle = (id: string): string | null =>
  (Object.entries(ROLE_FAMILY_ALIASES).find(([, aliases]) =>
    aliases.some((a) => a.toLowerCase() === (CANONICAL_TITLES[id]?.[0] ?? ""))) ?? [null])[0];

/** hard_constraints fields missionCriteria maps itself (its `handled` set). */
const NATIVE_FIELDS = new Set(["company_profile.locations", "stage", "geography", "location", "locations",
  "company_type", "company_types", "industry", "industries", "vertical", "verticals"]);
const NEGATION = new Set(["no", "not", "non", "excluding", "exclude", "except", "without", "but"]);
/** Tokens of a phrase without a leading negation, plural s dropped ("no SDRs" → ["sdr"]). */
const itemTokens = (s: string) => {
  const t = tokens(s);
  while (t.length && NEGATION.has(t[0])) t.shift();
  return t.map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
};
/** Same item, token by token: exact up to typo, plural and a leading negation. */
const sameItem = (a: string, b: string) => {
  const x = itemTokens(a), y = itemTokens(b);
  return x.length > 0 && x.length === y.length && x.every((w, i) => sameWord(w, y[i]));
};

/**
 * Does a free-form constraint value only RESTATE the understanding, with the same polarity?
 * Compared with each item's span (the user's words), its canonical value (title id and
 * names, place, industry) and, for requirements, the signal kinds and spans.
 */
export function restatesUnderstanding(value: string, u: ProposedUnderstanding, excluding: boolean): boolean {
  const titles = (t: string | null) => (t ? [t, ...(CANONICAL_TITLES[t] ?? [])] : []);
  const names: string[] = excluding
    ? [
      ...u.roles.filter((r) => r.relation === "excluded").flatMap((r) => [r.span, ...titles(r.title)]),
      ...u.places.filter((p) => p.necessity === "excluded").flatMap((p) => [p.span, p.place ?? "", p.other_place ?? ""]),
      ...u.industries.filter((i) => i.necessity === "excluded").flatMap((i) => [i.span, i.industry]),
    ]
    : [
      ...u.roles.filter((r) => r.relation === "required").flatMap((r) => [r.span, ...titles(r.title), r.family ?? ""]),
      ...u.places.filter((p) => p.necessity !== "excluded").flatMap((p) => [p.span, p.place ?? "", p.other_place ?? ""]),
      ...u.industries.filter((i) => i.necessity !== "excluded").flatMap((i) => [i.span, i.industry]),
      ...u.signals.filter((s) => s.necessity === "required").flatMap((s) => [s.span, s.kind]),
    ];
  return names.some((n) => !!n && sameItem(value, n.replace(/_/g, " ")));
}

/**
 * A size constraint that only restates the stated employee range: every number it names
 * (`["10","100"]`, `[">=50","<=200"]`, `{min, max}`, `100`) is one of the range's own bounds.
 */
export function restatesSize(field: string, value: unknown, range: { min?: number | null; max?: number | null }): boolean {
  if (!/employee|headcount|company_size|team_size|size/i.test(field)) return false;
  const bounds = [range.min, range.max].filter((n): n is number => typeof n === "number");
  if (!bounds.length) return false;
  const parts = value && typeof value === "object" && !Array.isArray(value) ? Object.values(value as object) : Array.isArray(value) ? value : [value];
  const nums: number[] = [];
  for (const p of parts) {
    const m = /^\s*(?:>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?)\s*$/.exec(String(p ?? ""));
    if (!m) return false;
    nums.push(Number(m[1]));
  }
  return nums.length > 0 && nums.every((n) => bounds.includes(n));
}

/**
 * A window constraint that only restates a signal's own window: a window-named field
 * ("signal_recency_days", "hiring_window") whose number equals the timeframe a signal
 * already carries. A different number is a requirement of its own and is kept.
 */
export function restatesWindow(field: string, value: unknown, signals: readonly { timeframe_days?: number | null }[]): boolean {
  if (!/recen|window|timeframe|within|_days$/i.test(field)) return false;
  const n = typeof value === "number" ? value : /^\s*\d{1,4}\s*$/.test(String(value ?? "")) ? Number(value) : NaN;
  return Number.isFinite(n) && signals.some((s) => s.timeframe_days === n);
}

/**
 * Write a validated understanding into the mission's canonical carriers, exactly as the
 * model stated it, and keep it on the mission (`understanding`) for the criteria
 * derivation to read at its decision points. Every write is recorded.
 */
export function applyUnderstanding(mission: Mission, u: ValidatedUnderstanding, changes: string[]): Mission {
  let signals = [...(mission.required_signals ?? [])] as Sig[];
  const kindOf = (s: Sig) => String(s.event ?? s.type ?? "");

  // Signals the understanding names but the carriers lack (indirect wording the phrase
  // reader did not recognise: "growing the sales team", "looking to bring on").
  for (const s of u.signals) {
    if (signals.some((x) => kindOf(x) === s.kind)) continue;
    signals.push({ type: s.kind, event: s.kind, subject: "company", phrase: s.span, qualifier: {} } as unknown as Sig);
    changes.push(`understanding_signal_added:${s.kind}:${JSON.stringify(s.span)}`);
  }

  // ── ROLES (NL1): the registered title or family the model named, never a literal word ──
  if (u.roles.length) {
    if (!signals.some((x) => kindOf(x) === "hiring")) {
      signals.push({ type: "hiring", event: "hiring", subject: "company", phrase: u.roles[0].span, qualifier: {} } as unknown as Sig);
      changes.push("understanding_signal_added:hiring:roles");
    }
    const req = u.roles.filter((r) => r.relation === "required");
    const exc = u.roles.filter((r) => r.relation === "excluded");
    const terms = [...new Set(req.filter((r) => r.title).map((r) => titleTerm(r.title!)))];
    const families = [...new Set(req.map((r) => r.family ?? (r.title ? familyOfTitle(r.title) : null)).filter((f): f is string => !!f))];
    const excluded = [...new Set(exc.map((r) => (r.title ? titleTerm(r.title) : r.span)))];
    signals = signals.map((s) => {
      if (kindOf(s) !== "hiring") return s;
      const q: Record<string, unknown> = { ...(s.qualifier ?? {}) };
      delete q.role_terms; delete q.role_families; delete q.role_match; delete q.excluded_role_terms;
      if (terms.length) q.role_terms = terms;
      if (families.length) q.role_families = families;
      if (terms.length > 1) q.role_match = u.role_match;
      if (excluded.length) q.excluded_role_terms = excluded;
      const out = { ...s, qualifier: q } as Sig;
      if (families.length) (out as { role_families?: string[] }).role_families = families;
      else delete (out as { role_families?: string[] }).role_families;
      return out;
    });
    changes.push(`understanding_roles:${JSON.stringify({ terms, families, excluded, match: u.role_match })}`);
  }

  // ── PLACES (NL3, NL4): registry places, with the scope the model stated ──
  let cp = { ...(mission.company_profile ?? {}) } as Mission["company_profile"] & { geography_scope?: string };
  const hard = { ...(mission.hard_constraints ?? {}) } as Record<string, unknown>;
  let geographyIsHard = mission.geography_is_hard;
  if (u.places.length) {
    const name = (p: ProposedPlace) => (p.place ? placeName(p.place) : String(p.other_place).trim());
    const required = u.places.filter((p) => p.necessity === "required");
    const preferred = u.places.filter((p) => p.necessity === "preferred");
    const locations = [...new Set([...required, ...preferred].map(name))];
    cp = { ...cp, locations };
    const scopes = new Set(required.map((p) => p.scope));
    if (scopes.size === 1) cp.geography_scope = [...scopes][0];
    else delete cp.geography_scope;
    if (required.length) {
      hard["company_profile.locations"] = { operator: "in", value: required.map(name), reason: "stated in the request (understanding)" };
      geographyIsHard = true;
    } else {
      delete hard["company_profile.locations"];
      geographyIsHard = false;
    }
    const excludedPlaces = u.places.filter((p) => p.necessity === "excluded").map(name);
    if (excludedPlaces.length) hard.excluded_geographies = { operator: "not_in", value: excludedPlaces, reason: "excluded in the request (understanding)" };
    changes.push(`understanding_places:${JSON.stringify(u.places.map((p) => `${name(p)}@${p.scope}:${p.necessity}`))}`);
  }
  // ── RESTATEMENTS (live paraphrase studies, 2026-11-05) ──
  // The model often ALSO files what its understanding says as a free-form hard constraint
  // (`signal: "hiring"`, `hiring_role excludes "SDRs"`, `headquarters: "North America"`,
  // `employee_count between ["10","100"]`). Compiled again, each became a second hard
  // `constraint`/`exclusion` no evidence answers: 54 of 165 live readings in run #24, every
  // one with a CORRECT understanding. A constraint is skipped ONLY when every value restates
  // what the mission already carries with the same polarity (restatesUnderstanding,
  // restatesSize). Anything else is kept exactly as before, so nothing the user said is
  // dropped and a contradiction (excluding a role the understanding requires) is never hidden.
  const range = (mission.company_profile?.employee_range ?? {}) as { min?: number | null; max?: number | null };
  for (const [field, raw] of Object.entries(hard)) {
    // Fields the criteria derivation already maps natively (missionCriteria `handled`) are
    // never restatements: they are how the industry or place itself reaches the mission.
    if (NATIVE_FIELDS.has(field) || field === "excluded_geographies") continue;
    const c = (raw ?? {}) as { operator?: string; value?: unknown };
    const value = c && typeof c === "object" && "value" in c ? c.value : raw;
    const excluding = /not|exclud/i.test(String(c?.operator ?? ""));
    const restated = restatesSize(field, value, range) || restatesWindow(field, value, signals) ||
      (value === true && u.signals.some((s) => s.necessity === "required" && sameItem(field, s.kind))) ||
      (() => {
        const values = Array.isArray(value) ? value : [value];
        return values.length > 0 && values.every((v) => typeof v === "string" && !!v.trim() && restatesUnderstanding(v, u, excluding));
      })();
    if (restated) {
      delete hard[field];
      changes.push(`understanding_restatement_skipped:${field}:${JSON.stringify(value)}`);
    }
  }

  // ── NO ROLE NAMED: HIRING FOR ANY ROLE (M23, run #24) ──
  // A hiring signal with no role in the understanding ("taking on more staff") is hiring
  // for any role; the signal's own phrase is never a role term.
  if (!u.roles.length && u.signals.some((s) => s.kind === "hiring")) {
    signals = signals.map((s) => {
      if (kindOf(s) !== "hiring") return s;
      const q: Record<string, unknown> = { ...(s.qualifier ?? {}) };
      if (!q.role_terms && !q.role_families) return s;
      delete q.role_terms; delete q.role_families; delete q.role_match;
      changes.push(`understanding_hiring_any_role:${JSON.stringify(s.qualifier?.role_terms ?? s.qualifier?.role_families ?? [])}`);
      const out = { ...s, qualifier: q } as Sig;
      delete (out as { role_families?: string[] }).role_families;
      return out;
    });
  }

  // What the vocabulary cannot express is never dropped: it becomes an explicit
  // unrepresentable criterion (disclosed on the approval card, never silently enforced).
  const unrepresented = [...(mission.unrepresented_requirements ?? [])];
  for (const x of u.unsupported) {
    const line = `"${x.span}" — ${x.why || "not expressible in the mission vocabulary"}`;
    if (!unrepresented.includes(line)) unrepresented.push(line);
  }
  if (u.rejected.length) changes.push(`understanding_rejected:${JSON.stringify(u.rejected)}`);
  if (u.ambiguities.length) changes.push(`understanding_ambiguities:${u.ambiguities.length}`);
  return {
    ...mission, company_profile: cp, hard_constraints: hard, required_signals: signals as Mission["required_signals"],
    ...(unrepresented.length ? { unrepresented_requirements: unrepresented } : {}),
    ...(geographyIsHard === undefined ? {} : { geography_is_hard: geographyIsHard }),
    understanding: u,
  } as Mission;
}

/** The validated understanding a mission carries, when it was compiled under v3. */
export function understandingOf(mission: unknown): ValidatedUnderstanding | null {
  const u = (mission as { understanding?: ValidatedUnderstanding } | null)?.understanding;
  return u && u.version === UNDERSTANDING_VERSION ? u : null;
}
