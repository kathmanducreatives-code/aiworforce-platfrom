// LEAD V2 P1 — MISSION MEANING, EXPLICIT AND STABLE.
//
// A mission used to carry its meaning across half a dozen carriers —
// `company_profile`, `required_signals`, `hard_constraints`, `soft_preferences`,
// `field_provenance`, `required_signal_terms`, `unrepresented_requirements` —
// and nothing said, in one place, what the user demanded versus preferred,
// what was inferred, what the Company Brain added, and which windows applied.
// Two readings of the same sentence could therefore disagree silently: the
// canonical smoke mission sometimes carried `hard_constraints.stage = "seed"`
// and sometimes did not, depending only on what the model wrote.
//
// This module gives every compiled mission one canonical representation:
//
//   goal · requested_count · criteria[] · canonical signals (+ aliases)
//
// where each criterion has a KIND (hard / target / opportunity_signal /
// hypothesis), a SOURCE (user_explicit / user_inferred / company_brain_policy /
// company_brain_preference / system_default), a time window where relevant and
// a confidence when inferred. Rules follow the plan's "Compilation rules" table:
// GPT proposes, code decides, the card confirms.
//
// ── WHAT P1 CHANGES ON THE EXISTING CARRIERS, AND WHY ONLY THIS ─────────────
//
// Criteria are the meaning. The legacy carriers still drive execution until
// P2 makes ProviderCallSpec authoritative, so P1 rewrites a carrier only where
// the carrier would otherwise contradict the stated meaning:
//   - required_signals: the leadership misread, hypothesis-only signals, and
//     user-stated signals the model dropped (locked rule 2: code owns truth);
//   - timeframe_days: the visible default window, except hiring (below);
//   - hard_constraints.stage vs soft_preferences.stage: ONLY/must → hard;
//     prefer/unqualified → target (plan example table);
//   - unrepresented_requirements: unrecognised signal language is recorded.
// Every rewrite is returned as a named change for `validator_changes`.
//
// HIRING'S DEFAULT WINDOW IS SHOWN, NOT CARRIED. A 30-day posting window on the
// hiring signal would reach evaluator prompts as "within 30 days" while no
// hiring source in the V2 route reads a posting date (YC `openJobs` carry
// none). Stating it as applied would be the silent mismatch this phase removes,
// so the card says it is a default not yet enforced; P3's job route enforces it.
//
// Pure. No network, no model, no database. Not part of `missionHash`.

import { PRODUCTION_READINESS, type ReadinessPolicy } from "./routeReadiness.ts";
import {
  canonicalSignalType, containsPhrase, isHiringSignal,
  type FieldProvenance, type LeadMissionV1, type MissionSignal,
} from "./leadMission.ts";
import { isControlledPhrase } from "./businessModelMatch.ts";
import { sizeRangeProvable } from "./companySize.ts";
import { readSignalPhrase, type SignalQualifier } from "./missionSignalDescriptor.ts";
import {
  CANONICAL_SIGNAL_KINDS, DEFAULT_SIGNAL_WINDOWS, EXEC_TITLE_RE, aliasKindFor,
  companyAgeWindowDays, descriptorForReading, explicitWindowDays, explicitWindowMatch, kindForEvent, readCanonicalSignals,
  sameWindow,
  readHypotheses, unmappedSignalLanguage,
  type CanonicalSignalKind, type CanonicalSignalReading, type HypothesisReading, type WindowBasis,
} from "./signalKinds.ts";

export const MISSION_SEMANTICS_VERSION = "mission-semantics-v1" as const;

export type CriterionKind = "hard" | "target" | "opportunity_signal" | "hypothesis";
export type CriterionSource =
  | "user_explicit"
  | "user_inferred"
  | "company_brain_policy"
  | "company_brain_preference"
  | "system_default";

export type CriterionDimension =
  | CanonicalSignalKind
  | "geography" | "industry" | "business_model" | "company_size" | "company_stage"
  | "known_companies" | "exclusion" | "constraint"
  | "unrecognised_signal" | "unrepresentable_evidence";

export interface CriterionTimeWindow {
  days: number;
  basis: WindowBasis;
  source: CriterionSource;
  /** The phrase class a default is for. */
  rule?: string;
  /** False when the window is shown but no current step enforces it. */
  enforced: boolean;
}

export type CriterionStatus = "ok" | "unrecognised" | "unrepresentable" | "unprovable_today";

export interface MissionCriterion {
  id: string;
  kind: CriterionKind;
  dimension: CriterionDimension;
  value: unknown;
  /** One line for the card. */
  label: string;
  source: CriterionSource;
  time_window?: CriterionTimeWindow;
  /** Required when source = user_inferred. */
  confidence?: number;
  elevated_by?: "only" | "must" | "strictly" | "exactly" | "exclusively" | "excluding" | null;
  user_phrase: string;
  rationale: string;
  status: CriterionStatus;
  /**
   * ANY OF THESE (RC02). Set when the request joins this value with others by
   * "or" ("AI or developer-tools", "Series A or Series B"): every alternative,
   * this one included. Hard criteria sharing it are ONE requirement that any
   * alternative satisfies (`evaluateEligibility`); a stage set is decided as one
   * claim (`fundingStageClaim.stageRequirement`). Absent: an ordinary criterion.
   */
  any_of?: string[];
}

export interface CanonicalSignalRecord {
  kind: CanonicalSignalKind;
  subkind?: string;
  /** The carrier event on `required_signals`. */
  legacy_event: string;
  subject: string;
  phrase: string;
  /** The alias that read it: "reader", a rule name, or "model" for GPT-only. */
  alias: string;
  source: CriterionSource;
}

export interface StageIntent {
  value: string;
  phrase: string;
  kind: "hard" | "target";
  elevated_by: MissionCriterion["elevated_by"];
  hedged: boolean;
  /** Every stage the request joins to this one by "or" ("Seed or Series A"), this one included. RC02. */
  alternatives?: string[];
}

export interface MissionSemanticsRecord {
  version: typeof MISSION_SEMANTICS_VERSION;
  /** The user's words. Immutable, like `original_user_query`. */
  goal: string;
  requested_count: number | null;
  canonical_signals: CanonicalSignalRecord[];
  hypotheses: HypothesisReading[];
  unmapped_signal_language: string[];
  stage: StageIntent | null;
  /** Where each signal's window came from, by canonical kind. */
  window_sources: Record<string, { source: CriterionSource; confidence?: number; rule?: string }>;
  /** Named rewrites of legacy carriers, also pushed to `validator_changes`. */
  corrections: string[];
}

// ── READING THE USER'S WORDS ────────────────────────────────────────────────

const ELEVATION_RE = /\b(only|must(?:\s+be)?|strictly|exactly|exclusively)\b/i;
/**
 * The plan's rule: "a phrase with a temporal word and no window is incomplete".
 * No temporal word, no default window — an unstated window must not become a
 * constraint (R1 contract).
 */
const TEMPORAL_CUE_RE =
  /\b(?:recent(?:ly)?|just|currently|actively|lately|newly|new|now|soon|this\s+(?:week|month|quarter|year)|in\s+the\s+(?:last|past))\b/i;
const HEDGE_RE = /\b(prefer(?:ably|red|ence for)?|ideally|bonus if|nice to have|if possible)\b/i;

const STAGE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bpre-?seed\b/i, "pre-seed"],
  [/\bseed(?:[- ]stage)?\b/i, "seed"],
  [/\bseries\s+([a-e])\b/i, "series_"],
  [/\bearly[- ]stage\b/i, "early_stage"],
];

/** Funding rounds, which no current discovery source proves per company. */
const ROUND_STAGES = new Set(["pre-seed", "seed", "series_a", "series_b", "series_c", "series_d", "series_e"]);

// ── "OR" JOINS ALTERNATIVES (RC02) ──────────────────────────────────────────
//
// Two values the request joins by "or" — or a comma / slash in such a list —
// are alternatives of ONE requirement. "and", or any other words between them,
// is not: "B2B AI" and "Seed and Series A" stay separate requirements.
const OR_JOIN_RE = /^\s*(?:,\s*(?:or\s+)?|or\s+|\/\s*)(?:an?\s+)?$/i;

/** Every stage word in the text, in reading order (a word inside a longer one counts once). */
function stageMentions(text: string): Array<{ index: number; end: number; value: string }> {
  const all: Array<{ index: number; end: number; value: string }> = [];
  for (const [re, value] of STAGE_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, "gi"))) {
      all.push({ index: m.index!, end: m.index! + m[0].length,
        value: value === "series_" ? `series_${m[1].toLowerCase()}` : value });
    }
  }
  all.sort((a, b) => a.index - b.index || b.end - a.end);
  return all.filter((x, i) => !all.some((y, j) => j !== i && y.index <= x.index && y.end >= x.end && (y.end - y.index) > (x.end - x.index)));
}

/** The stages joined by "or" to the one at `index`, itself included — undefined when it stands alone. */
function stageAlternativesAt(text: string, index: number, keep: (v: string) => boolean = () => true): string[] | undefined {
  const ms = stageMentions(text);
  const at = ms.findIndex((m) => m.index === index);
  if (at < 0) return undefined;
  let lo = at, hi = at;
  while (lo > 0 && OR_JOIN_RE.test(text.slice(ms[lo - 1].end, ms[lo].index))) lo--;
  while (hi < ms.length - 1 && OR_JOIN_RE.test(text.slice(ms[hi].end, ms[hi + 1].index))) hi++;
  const values = [...new Set(ms.slice(lo, hi + 1).map((m) => m.value).filter(keep))];
  return values.length > 1 ? values : undefined;
}

/** Values the request joins by "or", each mapped to its whole group (itself included). Values standing alone are absent. */
function orAlternatives(values: readonly string[], query: string): Map<string, string[]> {
  const q = query.toLowerCase();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = values
    .map((v) => ({ v, m: new RegExp(`(?<![\\w-])${esc(v.toLowerCase())}(?![\\w-])`).exec(q) }))
    .filter((x): x is { v: string; m: RegExpExecArray } => !!x.m && x.v.trim().length > 1)
    .map((x) => ({ v: x.v, index: x.m.index, end: x.m.index + x.m[0].length }))
    .sort((a, b) => a.index - b.index);
  const out = new Map<string, string[]>();
  let run: typeof found = [];
  const flush = () => {
    if (run.length > 1) for (const x of run) out.set(x.v, run.map((y) => y.v));
    run = [];
  };
  for (const x of found) {
    const prev = run[run.length - 1];
    if (prev && !OR_JOIN_RE.test(q.slice(prev.end, x.index))) flush();
    run.push(x);
  }
  flush();
  return out;
}

/**
 * A company-stage requirement the user stated, and how strongly.
 *
 * "raised a seed round" is a FUNDING qualifier, not a stage criterion, so a
 * stage word inside a funding phrase is left to the signal.
 */
export function readStageIntent(query: string): StageIntent | null {
  const text = String(query ?? "");
  for (const [re, value] of STAGE_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const around = text.slice(Math.max(0, m.index - 24), m.index + m[0].length + 8).toLowerCase();
    if (/\b(?:raised|raising|closed)\b|\bround\b/.test(around)) continue;
    const v = value === "series_" ? `series_${m[1].toLowerCase()}` : value;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const clause = text.slice(Math.max(0, m.index - 60), Math.min(text.length, m.index + m[0].length + 60));
    const elevated = before.match(ELEVATION_RE);
    const hedged = HEDGE_RE.test(clause);
    const elevatedBy = elevated
      ? (elevated[1].toLowerCase().startsWith("must") ? "must" : elevated[1].toLowerCase()) as StageIntent["elevated_by"]
      : null;
    const phraseStart = elevated ? Math.max(0, m.index - 40) + (elevated.index ?? 0) : m.index;
    const alternatives = stageAlternativesAt(text, m.index);
    return {
      value: v,
      phrase: text.slice(phraseStart, m.index + m[0].length).trim(),
      kind: elevatedBy && !hedged ? "hard" : "target",
      elevated_by: elevatedBy && !hedged ? elevatedBy : null,
      hedged,
      ...(alternatives ? { alternatives } : {}),
    };
  }
  return null;
}

/**
 * THE ROUND THE USER REQUIRED — the case `readStageIntent` deliberately drops.
 *
 * `readStageIntent` skips a stage word sitting next to "raised"/"raising"/
 * "closed"/"round", and it is right to: "seed-stage company" describes a kind
 * of company, while "raised Seed funding" describes an EVENT, and the two are
 * not the same claim. The event was then supposed to travel as the funding
 * signal's `round_type` qualifier — and does not: the canonical signal reader
 * never extracts it, and `PROJECTABLE_QUALIFIER_FIELDS` would drop it anyway.
 * So "recently raised Seed funding" compiled with the rung missing entirely,
 * the card said `unrepresented:qualifier:round_type`, and the only stage
 * criteria left were the Company Brain's ICP rungs — which are preferences and
 * can never reject anyone.
 *
 * Read here rather than repaired in the reader because the rung only means
 * "required round" when the mission actually asks for funding; the caller
 * checks that before using this.
 *
 * ALWAYS HARD. `readStageIntent` needs an elevation word ("only", "must")
 * because a bare stage word is usually descriptive. A round the user says a
 * company must have RAISED is not descriptive — it is the same kind of stated
 * requirement as "US" or "B2B SaaS", both of which compile hard without
 * elevation.
 */
export function readFundedStageIntent(query: string): StageIntent | null {
  const text = String(query ?? "");
  for (const [re, value] of STAGE_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const around = text.slice(Math.max(0, m.index - 24), m.index + m[0].length + 8).toLowerCase();
    // The MIRROR of readStageIntent's guard: this reader wants exactly what
    // that one refuses, so a rung is read by one of them and never by both.
    if (!/\b(?:raised|raising|closed)\b|\bround\b/.test(around)) continue;
    const v = value === "series_" ? `series_${m[1].toLowerCase()}` : value;
    if (!ROUND_STAGES.has(v)) continue;
    const clause = text.slice(Math.max(0, m.index - 60), Math.min(text.length, m.index + m[0].length + 60));
    if (HEDGE_RE.test(clause)) return null;
    const alternatives = stageAlternativesAt(text, m.index, (s) => ROUND_STAGES.has(s));
    return {
      value: v,
      phrase: text.slice(Math.max(0, m.index - 24), m.index + m[0].length).trim(),
      kind: "hard",
      elevated_by: null,
      hedged: false,
      ...(alternatives ? { alternatives } : {}),
    };
  }
  return null;
}

/** Everything P1 reads out of the sentence, in one pass. */
export function readMissionLanguage(query: string) {
  const readings = readCanonicalSignals(query);
  const hypotheses = readHypotheses(query);
  return {
    readings,
    hypotheses,
    unmapped: unmappedSignalLanguage(query, readings, hypotheses),
    stage: readStageIntent(query),
    explicit_window_days: explicitWindowDays(query),
    window_days_by_kind: windowDaysByKind(query, readings),
    company_age_window_days: companyAgeWindowDays(query),
  };
}

/**
 * WHICH SIGNAL A STATED WINDOW BELONGS TO.
 *
 * "…must have raised funding within the last 12 months, and must currently be
 * hiring a growth role" states ONE window, and it is funding's. Applying it to
 * every temporal signal made "currently hiring" accept a posting eleven months
 * old. A window now goes to the signal whose own clause states it (the clause
 * carrying that signal's cue, as `requirementElevation` reads it) — even when
 * only one temporal signal was named: "founded in the last 5 years that are
 * hiring sales in the last 30 days" names one signal and two windows, and
 * hiring's is 30, not the sentence's first (PR #36 review).
 *
 * ONE WINDOW HAS ONE OWNER (RC06). "…funded in the last 24 months hiring sales"
 * has no clause break, so funding's and hiring's clauses were the same text and
 * both took 730 days; and a window no clause claimed used to go to EVERY
 * signal. Either way "currently hiring" accepted a two-year-old posting
 * (quality run 2026-10-06). A window several signals could claim now goes to
 * the signal it is written after (the verb it completes: "funded in the last
 * 24 months"), else the one it is written before; the others keep their own
 * defaults.
 */
function windowDaysByKind(query: string, readings: readonly CanonicalSignalReading[]):
  Partial<Record<CanonicalSignalKind, number>> {
  const stated = explicitWindowDays(query);
  const out: Partial<Record<CanonicalSignalKind, number>> = {};
  if (stated == null) return out;
  const kinds = [...new Set(readings.map((r) => r.kind))].filter((k) => k !== "technology");
  const byClause = new Map<string, CanonicalSignalKind[]>();
  for (const k of kinds) {
    const cue = SIGNAL_CUE[k];
    if (!cue) continue;
    const phrase = readings.find((r) => r.kind === k)?.phrase ?? "";
    const own = [...(phrase || query).toLowerCase().split(CLAUSE_BREAK)].reverse()
      .map((c) => c.trim()).find((c) => cue.test(c));
    const days = own ? explicitWindowDays(own) : null;
    if (days == null) continue;
    out[k] = days;
    byClause.set(own!, [...(byClause.get(own!) ?? []), k]);
  }
  // One clause, one window: when several signals share the clause, only its owner keeps it.
  for (const [clause, ks] of byClause) {
    if (ks.length < 2) continue;
    const owner = windowOwner(clause, ks, readings);
    if (owner) for (const k of ks) if (k !== owner) delete out[k];
  }
  if (Object.keys(out).length === 0) {
    const owner = windowOwner(query, kinds, readings);
    if (owner) out[owner] = stated;
    else for (const k of kinds) out[k] = stated;
  }
  return out;
}

/**
 * The signal a stated window belongs to: the one whose words come nearest BEFORE
 * the window ("funded in the last 2 years"), else nearest after ("in the last
 * 30 days, hiring…"). A signal is located by its cue word, or by its phrase when
 * it has no cue. Null when none of them can be located.
 */
function windowOwner(
  text: string, kinds: readonly CanonicalSignalKind[], readings: readonly CanonicalSignalReading[],
): CanonicalSignalKind | null {
  const t = text.toLowerCase();
  const w = explicitWindowMatch(t);
  if (!w) return null;
  let before: { k: CanonicalSignalKind; d: number } | null = null;
  let after: { k: CanonicalSignalKind; d: number } | null = null;
  for (const k of kinds) {
    const cue = SIGNAL_CUE[k];
    const phrase = (readings.find((r) => r.kind === k)?.phrase ?? "").toLowerCase();
    const at: Array<{ index: number; end: number }> = cue
      ? [...t.matchAll(new RegExp(cue.source, "g"))].map((m) => ({ index: m.index!, end: m.index! + m[0].length }))
      : phrase && t.includes(phrase) ? [{ index: t.indexOf(phrase), end: t.indexOf(phrase) + phrase.length }] : [];
    for (const m of at) {
      if (m.end <= w.index && (!before || w.index - m.end < before.d)) before = { k, d: w.index - m.end };
      if (m.index >= w.end && (!after || m.index - w.end < after.d)) after = { k, d: m.index - w.end };
    }
  }
  return before?.k ?? after?.k ?? null;
}

const eventOf = (s: Partial<MissionSignal>): string =>
  String(s.event ?? canonicalSignalType(String(s.type ?? "")));

/**
 * The canonical kind a carried signal expresses. An unrecognised label the
 * model wrote ("social_post") is read through the same reader and aliases, so a
 * signal already carried under an odd name is not added a second time.
 */
const kindOfSignal = (s: Partial<MissionSignal>): CanonicalSignalKind | null => {
  const direct = kindForEvent(eventOf(s));
  if (direct) return direct;
  const label = String(s.type ?? s.phrase ?? "").replace(/[_-]+/g, " ").trim();
  if (!label) return null;
  return kindForEvent(readSignalPhrase(label)?.event) ?? aliasKindFor(label);
};

function signalWords(s: Partial<MissionSignal>): string {
  return [
    s.phrase ?? "", ...(s.qualifier?.role_terms ?? []), ...(s.role_families ?? []),
  ].join(" ");
}

// ── THE SEMANTIC PASS (compile time) ────────────────────────────────────────

export interface SemanticsInput {
  query: string;
  mission: LeadMissionV1;
  /** The validated model proposal's signal-level facts, when a model ran. */
  proposal?: { signal_recency_days: number | null; confidence: number } | null;
}

/**
 * Make the mission's meaning explicit, and correct the carriers that would
 * contradict it. Returns the mission (with `mission_semantics` and `criteria`)
 * and the named changes.
 */
export function compileMissionSemantics(i: SemanticsInput): { mission: LeadMissionV1; changes: string[] } {
  const query = String(i.query ?? i.mission.original_user_query ?? "");
  const lang = readMissionLanguage(query);
  const changes: string[] = [];
  const userKinds = new Set(lang.readings.map((r) => r.kind));
  let signals: MissionSignal[] = (i.mission.required_signals ?? []).map((s) => ({ ...s }));

  // 1. "just hired a VP Sales" is a leadership change, never an open-role search.
  if (userKinds.has("leadership_change")) {
    signals = signals.filter((s) => {
      if (!isHiringSignal(s)) return true;
      if (EXEC_TITLE_RE.test(signalWords(s)) || !userKinds.has("hiring")) {
        changes.push(`semantic_correction:hiring->leadership_change:${JSON.stringify(s.phrase ?? s.type)}`);
        return false;
      }
      return true;
    });
  }

  // 2. A hypothesis is not a verified signal. A signal the model added only
  //    because of "likely to need …" is not required.
  if (lang.hypotheses.length > 0) {
    signals = signals.filter((s) => {
      const k = kindOfSignal(s);
      if (k && !userKinds.has(k)) {
        changes.push(`hypothesis_not_a_verified_signal:${k}:${JSON.stringify(s.phrase ?? s.type)}`);
        return false;
      }
      return true;
    });
  }

  // 3. A signal the user stated is required, whatever the model wrote.
  for (const r of lang.readings) {
    if (signals.some((s) => kindOfSignal(s) === r.kind)) continue;
    signals.push(descriptorForReading(r) as unknown as MissionSignal);
    changes.push(`semantic_signal_added:${r.kind}:${JSON.stringify(r.phrase)}`);
  }

  // 4. Every signal with a temporal meaning gets a visible window.
  const windowSources: MissionSemanticsRecord["window_sources"] = {};
  signals = signals.map((s) => {
    const k = kindOfSignal(s);
    if (!k || k === "technology") return s;
    const statedForK = lang.window_days_by_kind[k];
    if (statedForK != null) {
      windowSources[k] = { source: "user_explicit" };
      if (s.timeframe_days !== statedForK) {
        changes.push(`window_from_user_words:${k}:${statedForK}d`);
      }
      return { ...s, timeframe_days: statedForK };
    }
    // A window the user stated for ANOTHER signal is not this one's: the
    // default applies, and a carried copy of that window is replaced.
    if (lang.explicit_window_days != null && s.timeframe_days != null &&
        sameWindow(s.timeframe_days, lang.explicit_window_days) && DEFAULT_SIGNAL_WINDOWS[k]) {
      windowSources[k] = { source: "system_default", rule: DEFAULT_SIGNAL_WINDOWS[k]!.rule };
      changes.push(`window_belongs_to_another_signal:${k}:${DEFAULT_SIGNAL_WINDOWS[k]!.days}d`);
      return { ...s, timeframe_days: DEFAULT_SIGNAL_WINDOWS[k]!.days };
    }
    // The sentence dates the COMPANY ("founded in the last 3 years") and this
    // signal's own clause names no window: a carried one is the model filing
    // the company's age under the signal, not a window the user gave it.
    if (lang.company_age_window_days != null && s.timeframe_days != null && DEFAULT_SIGNAL_WINDOWS[k] &&
        !FUNDING_WINDOW_WORDS_RE.test(signalClause(k, query) ?? "")) {
      windowSources[k] = { source: "system_default", rule: DEFAULT_SIGNAL_WINDOWS[k]!.rule };
      changes.push(`window_belongs_to_company_age:${k}:${DEFAULT_SIGNAL_WINDOWS[k]!.days}d`);
      return { ...s, timeframe_days: DEFAULT_SIGNAL_WINDOWS[k]!.days };
    }
    if (s.timeframe_days != null) {
      windowSources[k] = i.proposal?.signal_recency_days != null &&
          i.proposal.signal_recency_days === s.timeframe_days
        ? { source: "user_inferred", confidence: i.proposal.confidence }
        : { source: "system_default", rule: "carried from the compiled mission" };
      return s;
    }
    // "funded this year": the user's calendar window, computed now and carried (RC05).
    const calendar = k === "funding" ? calendarWindow(signalClause("funding", query) ?? "") : null;
    if (calendar) {
      windowSources[k] = { source: "user_explicit", rule: calendar.rule };
      changes.push(`window_from_calendar:${k}:${calendar.days}d`);
      return { ...s, timeframe_days: calendar.days };
    }
    const d = DEFAULT_SIGNAL_WINDOWS[k];
    if (!d) return s;
    if (!TEMPORAL_CUE_RE.test(query)) return s; // no temporal word: nothing to default
    windowSources[k] = { source: "system_default", rule: d.rule };
    if (k === "hiring") return s; // shown, not carried — see the header
    changes.push(`window_defaulted:${k}:${d.days}d`);
    return { ...s, timeframe_days: d.days };
  });

  // 5. ONLY seed-stage is hard; prefer / unqualified seed-stage is a target.
  const hard: Record<string, unknown> = { ...(i.mission.hard_constraints ?? {}) };
  const soft: Record<string, unknown> = { ...(i.mission.soft_preferences ?? {}) };
  if (lang.stage) {
    if (lang.stage.kind === "hard") {
      const prior = (hard.stage as { value?: unknown } | undefined)?.value ?? hard.stage;
      if (prior !== lang.stage.value) {
        changes.push(`stage_hard_from_user_words:${lang.stage.value}:${lang.stage.elevated_by}`);
      }
      hard.stage = {
        operator: "equals", value: lang.stage.value,
        reason: `the request says "${lang.stage.phrase}"`,
      };
      if (soft.stage) delete soft.stage;
    } else {
      if (hard.stage) {
        changes.push(`stage_hard_constraint_demoted_to_target:${lang.stage.value}:` +
          (lang.stage.hedged ? "hedged" : "not_elevated"));
        delete hard.stage;
      }
      soft.stage = {
        value: lang.stage.value,
        reason: lang.stage.hedged
          ? `the request says "${lang.stage.phrase}" — a preference`
          : `stated without only/must — a target, not a hard constraint`,
      };
    }
  } else if (hard.stage) {
    changes.push("stage_hard_constraint_demoted_to_target:model_inferred");
    soft.stage = { value: (hard.stage as { value?: unknown })?.value ?? hard.stage,
      reason: "inferred by the model; the request states no stage" };
    delete hard.stage;
  }

  // 5b. "first growth marketer" / "founding AE": the hire is the first in its
  //     function. Read from the user's words only, attached to the hiring
  //     requirement it qualifies — never inferred, never a separate signal.
  const firstHire = firstInFunctionPhrase(query);
  if (firstHire) {
    let attached = false;
    signals = signals.map((s) => {
      if (!isHiringSignal(s)) return s;
      attached = true;
      const q = (s.qualifier ?? {}) as SignalQualifier;
      if (q.first_in_function) return s;
      changes.push(`first_in_function_from_user_words:${JSON.stringify(firstHire)}`);
      return { ...s, qualifier: { ...q, first_in_function: { phrase: firstHire, source: "user_explicit" } } };
    });
    if (!attached) changes.push(`first_in_function_without_hiring_signal:${JSON.stringify(firstHire)}`);
  }

  // 6. Signal language nothing could read is recorded, never dropped.
  const unrepresented = [...(i.mission.unrepresented_requirements ?? [])];
  for (const phrase of lang.unmapped) {
    const sentence = `"${phrase}" — not a signal this system recognises yet`;
    if (!unrepresented.includes(sentence)) {
      unrepresented.push(sentence);
      changes.push(`unrecognised_signal_recorded:${JSON.stringify(phrase)}`);
    }
  }

  const canonical: CanonicalSignalRecord[] = signals.flatMap((s) => {
    const k = kindOfSignal(s);
    if (!k) return [];
    const r = lang.readings.find((x) => x.kind === k);
    return [{
      kind: k,
      ...(r?.subkind ? { subkind: r.subkind } : {}),
      legacy_event: eventOf(s),
      subject: String(s.subject ?? r?.subject ?? "company"),
      phrase: String(r?.phrase ?? s.phrase ?? s.type),
      alias: r?.alias ?? "model",
      source: r ? "user_explicit" : "user_inferred",
    }];
  });

  const semantics: MissionSemanticsRecord = {
    version: MISSION_SEMANTICS_VERSION,
    goal: i.mission.original_user_query || query,
    requested_count: i.mission.requested_count ?? null,
    canonical_signals: canonical,
    hypotheses: lang.hypotheses,
    unmapped_signal_language: lang.unmapped,
    stage: lang.stage,
    window_sources: windowSources,
    corrections: changes,
  };
  const mission: LeadMissionV1 = {
    ...i.mission,
    required_signals: signals,
    hard_constraints: hard,
    soft_preferences: soft,
    ...(unrepresented.length ? { unrepresented_requirements: unrepresented } : {}),
    mission_semantics: semantics,
  };
  return { mission: { ...mission, criteria: deriveMissionCriteria(mission) }, changes };
}

// ── DERIVING CRITERIA (any time; after every Brain merge) ───────────────────

const sourceFromProvenance = (
  p: FieldProvenance | undefined, valueInQuery: boolean,
): CriterionSource => {
  switch (p) {
    case "explicit_user_request":
    case "workflow_edit": return "user_explicit";
    case "company_brain": return "company_brain_preference";
    case "company_brain_policy": return "company_brain_policy";
    case "system_default": return "system_default";
    case "gpt_inference": return valueInQuery ? "user_explicit" : "user_inferred";
    default: return valueInQuery ? "user_explicit" : "user_inferred";
  }
};

const slug = (v: unknown) =>
  String(typeof v === "string" ? v : JSON.stringify(v)).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);

const SIGNAL_LABEL: Record<CanonicalSignalKind, string> = {
  hiring: "Hiring",
  funding: "Funding",
  product_launch: "Product launch",
  expansion: "Expansion",
  headcount_growth: "Headcount growth",
  leadership_change: "Leadership change",
  technology: "Technology",
  social_activity: "LinkedIn / social activity",
  company_profile: "Company profile",
};

const SOURCE_LABEL: Record<CriterionSource, string> = {
  user_explicit: "you said this",
  user_inferred: "inferred",
  company_brain_policy: "Company Brain rule",
  company_brain_preference: "from your Company Brain",
  system_default: "default",
};

/**
 * "first growth marketer", "founding AE", "our first sales hire". The word must
 * qualify a role, so "first round", "first-party data" and "first 30 days" do
 * not read as a first hire.
 */
const FIRST_IN_FUNCTION_RE =
  /\b(?:first|first-ever|founding)\s+(?:(?:in-house|full-time|dedicated|b2b|saas)\s+)?((?:[a-z&/-]+\s+){0,2}?(?:marketer|marketing\s+(?:hire|lead|manager)|growth(?:\s+(?:marketer|hire|lead|manager))?|sales(?:\s+(?:hire|rep|lead))?|seller|salesperson|ae|account\s+executive|sdr|bdr|engineer|designer|product\s+manager|pm|recruiter|hr|people\s+(?:hire|lead)|ops\s+hire|operations\s+(?:hire|lead)|customer\s+success(?:\s+(?:hire|manager|lead))?|cs\s+hire|data\s+(?:hire|scientist|engineer|analyst)|finance\s+(?:hire|lead)|content\s+(?:marketer|writer|hire)|hire))\b/i;

export function firstInFunctionPhrase(query: string): string | null {
  const m = FIRST_IN_FUNCTION_RE.exec(String(query ?? ""));
  return m ? m[0].trim() : null;
}

function signalDetail(k: CanonicalSignalKind, s: Partial<MissionSignal>, subkind?: string): string {
  const q = (s.qualifier ?? {}) as SignalQualifier & { direction?: string };
  const bits: string[] = [];
  if (q.role_terms?.length) bits.push(q.role_terms.join(", "));
  else if (s.role_families?.length) bits.push(s.role_families.join(", "));
  if (q.first_in_function) bits.push("first hire in the function");
  if (q.round_type) bits.push(q.round_type);
  if (q.region) bits.push(q.region);
  if (q.topic) bits.push(`about ${q.topic}`);
  if (subkind === "geographic_expansion" && !q.region) bits.push("new office / location");
  if (subkind === "market_expansion") bits.push("new market");
  if (s.subject && s.subject !== "company" && k !== "leadership_change") bits.push(`by ${s.subject}`);
  return `${SIGNAL_LABEL[k]}${bits.length ? `: ${bits.join(" · ")}` : ""}`;
}

/**
 * The criteria a mission states, derived from its fields and semantics.
 *
 * Callable on any mission: one compiled before P1 (no `mission_semantics`)
 * is read from its original query on the fly, so the card can show it too.
 */
/**
 * IS THIS SIGNAL STATED AS A REQUIREMENT?
 *
 * Read from the CLAUSE that carries the signal's own verb, not from a fixed
 * window of characters before a phrase. The old check looked 30 characters
 * before the reader's phrase — but the reader's phrase for "…and must currently
 * be hiring a growth role" STARTS with "must", so nothing preceded it and the
 * requirement was read as a preference. And widening the window would be worse:
 * "must be based in the US and recently raised" would make funding hard on a
 * modal that belongs to geography.
 *
 * So: split the signal's text into clauses, take the clause that contains the
 * signal's cue ("hiring", "raised", "funding" …), and ask whether THAT clause
 * says must / required to / needs to / has to / only / strictly. A signal with
 * no cue map keeps the previous reading.
 */
const SIGNAL_CUE: Partial<Record<CanonicalSignalKind, RegExp>> = {
  hiring: /\b(?:hiring|recruit(?:ing|s)?|open\s+(?:\w+\s+){0,2}(?:roles?|positions?|jobs?|openings?)|job openings?|to hire)\b/,
  funding: /\b(?:fund(?:ed|ing|raise|raising)?|rais(?:ed|e|es|ing)|round|series [a-e]\b|seed)\b/,
};
const REQUIREMENT_MODAL =
  /\b(must(?:\s+(?:currently|already|actively|still))?(?:\s+(?:be|have))?|required to|requires?|needs? to|has to|have to|only|strictly)\b/;
const CLAUSE_BREAK = /[,;.:]|\s+(?:and|but|or|which|that|who|whose|while|with)\s+/;

/** The LAST clause of `text` that names the signal's cue, or null. */
function signalClause(kind: CanonicalSignalKind, text: string): string | null {
  const cue = SIGNAL_CUE[kind];
  if (!cue) return null;
  const clauses = text.toLowerCase().split(CLAUSE_BREAK).map((c) => c.trim()).filter(Boolean);
  return [...clauses].reverse().find((c) => cue.test(c)) ?? null;
}

// ── A STATED FACT IS A REQUIREMENT; A HEDGED ONE IS NOT (phased evaluation, 2026-10-01) ──
//
// Only a modal ("must", "only", "required to") used to make a signal hard, so
// "…and are actively hiring salespeople" and "…and at least one currently open
// sales role" compiled as targets — ranked, never verified, never rejecting —
// although the user listed them beside size and funding as what a company must
// be. The rule now: a signal stated as a present fact in its own clause is a
// requirement; one wrapped in hedging language ("appears to be hiring", "signs
// they are hiring", "funding is not required") stays a preference. Words about
// the EVIDENCE ("funding is still uncertain — keep them pending") do not hedge
// the requirement: an unresolved hard claim is what makes a company PENDING.
//
// ── A STATED HIRING REQUIREMENT IS HARD, HOWEVER IT IS PHRASED (RC04) ──────
//
// Hard used to depend on the sentence matching one phrasing ("is hiring",
// "an open … role"), so "Is Anthropic hiring account executives?", "Does
// OpenAI have open sales roles?" and "Find 5 companies hiring salespeople"
// compiled hiring as a TARGET: the job search the question asks for never ran,
// and the sourcing cards had no hard claim at all — although Chat Brain had
// read hiring as a requirement (quality run 2026-10-06). The rule is now
// structural: hiring the USER stated (the reader's user-explicit kind, or a
// hiring cue in the request's own words) is a requirement unless its own
// clause is hedged. Hiring only the model inferred stays a target.
const SIGNAL_HEDGE_RE =
  /\b(?:appears?\s+to|appearing\s+to|seems?\s+to|signs?\s+(?:of|that|they)|likely|(?:may|might)\s+(?:have|be|still|already)|possibly|perhaps|potentially|not\s+(?:strictly\s+)?required)\b/;
/** A funding clause that asks about RECENCY (as opposed to a round or stage). */
const FUNDING_RECENCY_RE = /\b(?:recent(?:ly)?|recency|newly|lately|latest)\b/;

// ── FUNDING PRESENCE, CALENDAR WINDOWS AND DATE BOUNDS (RC05) ────────────────
//
// "Has raised venture funding" (presence), "funded this year" (a calendar
// window) and "raised funding before 2024" (a date bound) are stated
// requirements the funding pair can answer. They compiled as targets — never
// verified, never rejecting — and a known-company question with presence as
// its only requirement was refused as unprovable (quality run 2026-10-06:
// A05, E01, S01, S06). Presence and recency stay separate claims: presence has
// no window and is decided by `decideHasRaised`; a calendar window is recency.
/** A past raise, stated as a fact about the company. */
const FUNDING_PRESENCE_RE =
  /\b(?:raised|funded|backed|has\s+(?:\w+\s+)?funding|received\s+(?:\w+\s+){0,2}(?:funding|investment|capital))\b/;
/** A raise that has not happened (yet): never a presence requirement. */
const FUNDING_FUTURE_RE =
  /\b(?:raising|seeking|looking\s+(?:to|for)|plan(?:s|ning)?\s+to\s+raise|about\s+to\s+raise|will\s+raise|going\s+to\s+raise)\b/;
/**
 * Words that state a window, parsed or not ("in the last two years"): a clause
 * carrying one asks about recency, never presence.
 */
const FUNDING_WINDOW_WORDS_RE = /\b(?:the\s+(?:last|past)|since|ago)\b/;
/** Venture (equity) funding, as opposed to any funding. */
const VENTURE_FUNDING_RE = /\b(?:venture|vc[- ]?backed|equity)\b/;
/** "before 2024", "prior to March 2023": the date a qualifying round must precede. */
const FUNDING_BEFORE_RE =
  /\b(?:before|prior\s+to)\s+(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+)?((?:19|20)\d{2})\b/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The ISO date a funding clause bounds its rounds by ("before 2024" → 2024-01-01), or null. */
function fundingBeforeDate(clause: string): string | null {
  const m = FUNDING_BEFORE_RE.exec(clause);
  if (!m) return null;
  const month = m[1] ? MONTHS.indexOf(m[1].slice(0, 3)) + 1 : 1;
  return `${m[2]}-${String(month).padStart(2, "0")}-01`;
}

/**
 * A CALENDAR WINDOW ("this year", "this month", "this quarter", "this week",
 * "year to date"): days from the start of that period to `now`, inclusive. It is
 * computed when the mission is compiled and carried from then on, so a lineage
 * that runs for days keeps the window the user meant.
 */
export function calendarWindow(clause: string, now: Date = new Date()): { days: number; rule: string } | null {
  const m = /\b(this\s+(?:year|month|quarter|week)|year[- ]to[- ]date|ytd)\b/.exec(clause.toLowerCase());
  if (!m) return null;
  const rule = m[1].replace(/\s+/g, " ");
  const y = now.getUTCFullYear(), mo = now.getUTCMonth();
  const start = rule === "this month" ? Date.UTC(y, mo, 1)
    : rule === "this quarter" ? Date.UTC(y, mo - (mo % 3), 1)
    : rule === "this week" ? Date.UTC(y, mo, now.getUTCDate() - ((now.getUTCDay() + 6) % 7))
    : Date.UTC(y, 0, 1);
  const today = Date.UTC(y, mo, now.getUTCDate());
  return { days: Math.floor((today - start) / 86_400_000) + 1, rule };
}
/** A "stage" value that is really a funding-recency phrase ("funded within the last 2 years"). */
const FUNDING_RECENCY_AS_STAGE_RE =
  /\b(?:funded|raised|funding)\b.*\b(?:within|last|past|recent(?:ly)?|ago|\d+\s*(?:days?|weeks?|months?|years?))\b/i;

/** Is the signal's own clause hedged? */
export function signalHedged(kind: CanonicalSignalKind, query: string): boolean {
  const clause = signalClause(kind, query);
  return !!clause && (SIGNAL_HEDGE_RE.test(clause) || HEDGE_RE.test(clause));
}

/** A hiring requirement the user stated, in an unhedged clause (RC04). */
export function statedHiringRequirement(
  kind: CanonicalSignalKind, source: CriterionSource, query: string,
): boolean {
  return kind === "hiring" && source === "user_explicit" && !signalHedged(kind, query);
}

export function requirementElevation(kind: CanonicalSignalKind, phrase: string, query: string):
  RegExpMatchArray | null {
  const cue = SIGNAL_CUE[kind];
  if (cue) {
    // The LAST clause naming the signal: a phrase can carry earlier clauses
    // that belong to other requirements ("…must be based in the US, …").
    const own = signalClause(kind, phrase || query);
    if (own) {
      const at = own.search(cue);
      const m = own.slice(0, at).match(REQUIREMENT_MODAL);
      if (m) return m;
    }
    return null;
  }
  const q = query.toLowerCase();
  const idx = phrase ? q.indexOf(phrase.toLowerCase()) : -1;
  return idx > 0 ? q.slice(Math.max(0, idx - 30), idx).match(/\b(must(?: currently)?(?: be)?|only|required to|strictly)\b[^.]*$/) : null;
}

export function deriveMissionCriteria(
  mission: LeadMissionV1,
  /**
   * WHO MAY RUN, for THIS mission — not for production in general.
   *
   * A round-stage criterion is marked `unprovable_today` when no funding
   * verifier may execute, and an unprovable criterion compiles as a preference
   * rather than a requirement. That question was asked of `PRODUCTION_READINESS`
   * directly, which no environment can influence, so a probe or
   * experimental-allowed run — the only ways an EXPERIMENTAL route is ever
   * meant to execute — still compiled funding as a target. Only HARD unknown
   * claims become evidence gaps, so the verifier was never selected, the pair
   * never ran through the spine, and it could never earn the READY that would
   * have made this answer true: a closed loop with no environment variable that
   * opens it.
   *
   * The DEFAULT is still `PRODUCTION_READINESS`, so every caller that does not
   * pass a policy behaves exactly as before.
   */
  readiness: ReadinessPolicy = PRODUCTION_READINESS,
): MissionCriterion[] {
  const query = String(mission.original_user_query ?? "");
  const q = query.toLowerCase();
  const inQuery = (v: unknown) => typeof v === "string" && v.trim().length > 1 && q.includes(v.toLowerCase());
  const sem = mission.mission_semantics;
  const lang = sem ? null : readMissionLanguage(query);
  const readings: CanonicalSignalReading[] = lang?.readings ?? [];
  const userKinds = new Set<string>(
    sem ? sem.canonical_signals.filter((c) => c.source === "user_explicit").map((c) => c.kind)
      : readings.map((r) => r.kind));
  const hypotheses = sem?.hypotheses ?? lang?.hypotheses ?? [];
  const unmapped = sem?.unmapped_signal_language ?? lang?.unmapped ?? [];
  const statedStage = sem ? sem.stage : lang?.stage ?? null;
  /**
   * THE RUNG THIS MISSION IS JUDGED ON.
   *
   * A stage the sentence states outright, or — when the mission asks for
   * funding — the round it says the company must have RAISED. The second is
   * read only under a funding requirement, so a passing mention of a round in
   * an unrelated sentence cannot become a hard filter.
   */
  const fundingRequested = (mission.required_signals ?? []).some((x) => kindOfSignal(x) === "funding");
  const stageIntent = statedStage ?? (fundingRequested ? readFundedStageIntent(query) : null);
  const prov = mission.field_provenance ?? {};
  const cp = mission.company_profile ?? { business_models: [], verticals: [], stages: [], locations: [] };
  const conf = Number.isFinite(mission.confidence) ? mission.confidence : undefined;
  const out: MissionCriterion[] = [];
  const push = (c: Omit<MissionCriterion, "id" | "status"> & { status?: CriterionStatus }) => {
    const id = `${c.dimension}:${slug(c.value)}`;
    if (out.some((x) => x.id === id)) return;
    out.push({
      ...c, id, status: c.status ?? "ok",
      ...(c.source === "user_inferred" && c.confidence == null && conf != null ? { confidence: conf } : {}),
    });
  };

  // ── Company profile ──
  //
  // ── A HARD USER CRITERION IS THE USER'S WORDS (P5.2) ──────────────────────
  //
  // Missions approved before the Brain-merge fix carry a user-explicit value
  // the Brain rewrote: canary 62c8b188 asked for "B2B SaaS" and carries
  // "b2b saas (founder-led or small teams)". The part the request actually
  // says stays hard; the words it does not say become a target — they can rank
  // a company, never reject one. Only that shape (the user's phrase plus a
  // bracketed or separated qualifier) is split; any other value is untouched.
  const QUALIFIED = /^(.+?)\s*(?:[(\[]\s*(.+?)\s*[)\]]|\s[—–-]\s+(.+)|[,;:]\s*(.+))\s*$/;
  const preference = (
    dimension: CriterionDimension, label: string, qualifier: string, full: string,
    source: CriterionSource, rationale: string,
  ) => {
    // A qualifier the controlled vocabulary can read ("b2b" over "saas") is a
    // target evidence can answer; one it cannot ("founder-led or small teams")
    // is disclosed as not established, rather than silently never met.
    const evaluable = (dimension === "industry" || dimension === "business_model") ? isControlledPhrase(full) : true;
    push({
      kind: "target", dimension, value: evaluable ? full : qualifier,
      label: `${label} preference: ${evaluable ? full : qualifier}`, source, user_phrase: "",
      rationale, ...(evaluable ? {} : { status: "unprovable_today" as const }),
    });
  };
  const profileList = (
    dimension: CriterionDimension, field: string, values: readonly string[], label: string,
  ) => {
    // "AI or developer-tools", "New York or California": alternatives of ONE
    // requirement (RC02). Only values the request itself joins by "or".
    const ors = orAlternatives(values, query);
    for (const v of values) {
      const source = sourceFromProvenance(prov[field], inQuery(v));
      const split = source === "user_explicit" && !inQuery(v) ? QUALIFIED.exec(v.trim()) : null;
      const head = split?.[1]?.trim() ?? "";
      const tail = (split?.[2] ?? split?.[3] ?? split?.[4] ?? "").trim();
      if (split && head && tail && inQuery(head)) {
        push({
          kind: "hard", dimension, value: head, label: `${label}: ${head}`, source: "user_explicit",
          user_phrase: head, rationale: "stated in the request",
        });
        preference(dimension, label, tail, v, "user_inferred",
          "not in the request's words (an earlier Company Brain merge added it); can rank, never reject");
        continue;
      }
      const anyOf = source === "user_explicit" ? ors.get(v) : undefined;
      push({
        kind: source === "user_explicit" ? "hard" : "target",
        dimension, value: v, label: `${label}: ${anyOf ? anyOf.join(" or ") : v}`, source,
        user_phrase: inQuery(v) ? v : "",
        rationale: source === "user_explicit"
          ? anyOf ? "stated in the request, as one of alternatives joined by \"or\"" : "stated in the request"
          : source === "company_brain_preference"
          ? "your Company Brain's ICP; you did not state it in this request"
          : "inferred from the request; never a hard requirement",
        ...(anyOf ? { any_of: anyOf } : {}),
      });
    }
  };
  if ((cp.known_companies ?? []).length) {
    push({
      kind: "hard", dimension: "known_companies", value: cp.known_companies,
      label: `Companies you supplied: ${cp.known_companies!.join(", ")}`,
      source: "user_explicit", user_phrase: "", rationale: "the request names these companies",
    });
  }
  profileList("industry", "company_profile.verticals", cp.verticals ?? [], "Industry");
  profileList("business_model", "company_profile.business_models", cp.business_models ?? [], "Business model");
  profileList("geography", "company_profile.locations", cp.locations ?? [], "Geography");

  // ── Company Brain refinements of what the user closed: targets, never hard ──
  const REFINED: Record<string, [CriterionDimension, string]> = {
    "company_profile.verticals": ["industry", "Industry"],
    "company_profile.business_models": ["business_model", "Business model"],
    "company_profile.locations": ["geography", "Geography"],
    "company_profile.stages": ["company_stage", "Company kind"],
  };
  for (const r of mission.brain_refinements ?? []) {
    const d = REFINED[r.field];
    if (!d || !r.qualifier) continue;
    // Only while the user's value it refines is still on the mission.
    const userValues = ((cp as unknown as Record<string, string[] | undefined>)[r.field.split(".")[1]] ?? [])
      .map((x) => String(x).toLowerCase());
    if (!userValues.some((u) => u === r.user_value || containsPhrase(u, r.user_value))) continue;
    preference(d[0], d[1], r.qualifier, r.brain_value, "company_brain_preference",
      `your Company Brain narrows "${r.user_value}"; a preference that can rank, never reject`);
  }

  for (const st of cp.stages ?? []) {
    // ── FIRST-WINS IS WHY THE USER'S OWN RUNG KEPT LOSING ──────────────────
    //
    // `push` ignores a second criterion with the same `dimension:value`, and
    // these Company Brain rungs are pushed BEFORE the stated one below. So a
    // mission that asked for Seed and a Brain whose ICP also lists Seed
    // produced the BRAIN's criterion — a `target`, which ranks and never
    // rejects — and the user's hard requirement was discarded silently, along
    // with the readiness-aware `unprovable_today` the stated rung computes.
    // Skipping here lets the stated rung own the rung it names; every other
    // Brain rung is pushed exactly as before.
    if (stageIntent?.kind === "hard" && slug(stageIntent.value) === slug(st)) continue;
    const source = sourceFromProvenance(prov["company_profile.stages"], true);
    if (st === "startup") {
      // The noun ("startups") is the company kind; a stage word, when the
      // sentence has one, is pushed separately below.
      //
      // UNPROVABLE, AND SAID SO. No ready source states "this is a startup":
      // a provider's industry label does not, a headcount does not (the plan
      // forbids size and cohort proxies as proof — they are hypotheses), and a
      // YC record proves membership of a cohort, not a company kind. Left as a
      // provable hard rule it silently stranded EVERY candidate in `pending`:
      // canary d1eff17a surfaced 0 of 36 for a fact nothing could establish.
      // Disclosed on the card under "will not be established", exactly as the
      // stage word "seed" already is, instead of quietly rejecting everyone.
      push({
        kind: source === "company_brain_preference" ? "target" : "hard",
        dimension: "company_stage", value: "startup", label: "Company kind: startup",
        source, user_phrase: source === "user_explicit" ? "startup" : "",
        rationale: source === "company_brain_preference"
          ? "your Company Brain's ICP" : "the company kind in the request",
        status: "unprovable_today",
      });
      continue;
    }
    push({
      kind: source === "company_brain_preference" ? "target" : "hard",
      dimension: "company_stage", value: st, label: `Company kind: ${st}`, source,
      user_phrase: source === "user_explicit" ? st : "",
      rationale: source === "company_brain_preference"
        ? "your Company Brain's ICP" : "the company kind in the request",
    });
  }
  if (stageIntent) {
    const funded = (mission.required_signals ?? []).some((s) => kindOfSignal(s) === "funding");
    // P6: a round stage is provable for a company ALREADY in the pool once a
    // known-company funding verifier is READY (Actor Intelligence) — not before,
    // so an unproven route can never make a criterion look answerable.
    // "Seed or Series A": ONE requirement with every stage kept (RC02). Its value
    // is the set joined by "|" ("seed|series_a"), which is exactly the
    // `required_stage` the funding-stage claim decides as one — so every
    // verifier and discovery path that passes the value on decides the set.
    const stages = stageIntent.alternatives?.length ? stageIntent.alternatives : [stageIntent.value];
    const unprovable = stages.every((s) => ROUND_STAGES.has(s)) && !funded && !fundingVerifierReady(readiness);
    push({
      kind: stageIntent.kind, dimension: "company_stage", value: stages.join("|"),
      label: `Stage: ${stages.map((s) => s.replace(/_/g, " ")).join(" or ")}` +
        (stageIntent.kind === "hard" ? ` ("${stageIntent.phrase}")` : ""),
      source: "user_explicit", elevated_by: stageIntent.elevated_by,
      user_phrase: stageIntent.phrase,
      rationale: stageIntent.kind === "hard"
        ? `"${stageIntent.phrase}" makes it a requirement`
        : stageIntent.hedged ? "stated as a preference" : "stated without only/must, so a target",
      status: unprovable ? "unprovable_today" : "ok",
      ...(stages.length > 1 ? { any_of: [...stages] } : {}),
    });
  }

  const er = cp.employee_range;
  if (er && (er.min != null || er.max != null)) {
    const source = sourceFromProvenance(prov["company_profile.employee_range"],
      /\b\d{1,5}\s*(?:-|to|–)\s*\d{1,5}\b|\bemployees?\b/.test(q));
    // A SIZE IS PROVEN BY A DECLARED BAND, AND ONLY BY ONE THAT LIES INSIDE IT.
    // An exact count ("exactly 17") or a range that cuts across bands ("20–100",
    // "25–75") can never be passed by any company: every candidate would stay
    // pending forever while the card looked feasible (quality run RC03). A HARD
    // range the user stated is therefore disclosed as unprovable here, and
    // `assessRequestFeasibility` refuses the card with the bands that would work —
    // it is never widened to them silently. A Brain policy range keeps its old
    // behaviour (out of RC03's scope), and a target only ranks.
    const exact = er.min != null && er.max != null && er.min === er.max;
    const kind = source === "user_explicit" || source === "company_brain_policy" ? "hard" : "target";
    const value = { min: er.min ?? null, max: er.max ?? null };
    const range = sizeRangeProvable(value);
    const unprovable = kind === "hard" && source === "user_explicit" && !range.provable;
    push({
      kind, dimension: "company_size", value,
      label: exact ? `Company size: exactly ${er.min} employees`
        : `Company size: ${er.min ?? 0}–${er.max ?? "∞"} employees`, source, user_phrase: "",
      rationale: exact
        ? "an exact staff count is not provable today: LinkedIn gives a declared size band and an associated-member " +
          "count, and neither is a staff headcount" +
          (unprovable ? `; the request asks which band to use (${range.overlapping.join(", ")})` : " — candidates stay pending on it")
        : unprovable
        ? `this range is not provable today: no LinkedIn declared size band lies inside ${er.min ?? 0}–${er.max ?? "∞"}` +
          (range.overlapping.length ? `; the request asks which band to use (${range.overlapping.join(", ")})` : "")
        : source === "company_brain_policy"
        ? "your Company Brain's size rule, enforced on every mission"
        : source === "company_brain_preference"
        ? "your Company Brain's size band; you did not state one" : "stated in the request",
      ...(unprovable ? { status: "unprovable_today" as const } : {}),
    });
  }

  // ── Other constraints the model proposed ──
  const handled = new Set(["company_profile.locations", "stage", "geography", "location", "locations",
    "company_type", "company_types", "industry", "industries", "vertical", "verticals"]);
  for (const [field, raw] of Object.entries(mission.hard_constraints ?? {})) {
    if (handled.has(field)) continue;
    const c = (raw ?? {}) as { operator?: string; value?: unknown; reason?: string };
    const value = c.value ?? raw;
    const values = Array.isArray(value) ? value.map(String) : [String(value ?? "")];
    const stated = values.some(inQuery);
    const excluding = /not|exclud/i.test(String(c.operator ?? ""));
    push({
      kind: stated || excluding ? "hard" : "target",
      dimension: excluding ? "exclusion" : "constraint", value: { field, value },
      label: `${excluding ? "Excluding" : field.replace(/[._]/g, " ")}: ${values.join(", ")}`,
      source: stated ? "user_explicit" : "user_inferred",
      elevated_by: excluding ? "excluding" : null,
      user_phrase: stated ? values.find(inQuery) ?? "" : "",
      rationale: stated ? "stated in the request"
        : "proposed by the model without the request's words; never a hard requirement",
    });
  }
  for (const [field, raw] of Object.entries(mission.soft_preferences ?? {})) {
    if (field === "stage" && stageIntent) continue;
    const c = (raw ?? {}) as { value?: unknown };
    const value = c.value ?? raw;
    const values = Array.isArray(value) ? value.map(String) : [String(value ?? "")];
    // RECENCY IS NOT A STAGE. "funded within the last 2 years" arrives as a
    // stage value when the model files it under `stage`; the funding signal
    // already carries that window as its own claim, so a second "stage"
    // preference would only blur the two.
    if (field === "stage" && fundingRequested && values.every((v) => FUNDING_RECENCY_AS_STAGE_RE.test(v))) continue;
    push({
      kind: "target", dimension: field === "stage" ? "company_stage" : "constraint",
      value: { field, value }, label: `${field.replace(/[._]/g, " ")}: ${values.join(", ")} (preference)`,
      source: values.some(inQuery) ? "user_explicit" : "user_inferred",
      user_phrase: values.find(inQuery) ?? "", rationale: "a preference, which can rank but never reject",
    });
  }

  // ── Signals ──
  for (const s of mission.required_signals ?? []) {
    const k = kindOfSignal(s);
    if (!k) {
      push({
        kind: "target", dimension: "unrecognised_signal", value: s.phrase ?? s.type,
        label: `Signal not recognised: "${s.phrase ?? s.type}"`, source: "user_inferred",
        user_phrase: String(s.phrase ?? ""), status: "unrecognised",
        rationale: "no canonical signal kind matches these words; nothing will prove it",
      });
      continue;
    }
    const rec = sem?.canonical_signals.find((c) => c.kind === k);
    const reading = readings.find((r) => r.kind === k);
    const phrase = String(rec?.phrase ?? reading?.phrase ?? s.phrase ?? s.type);
    const elevated = requirementElevation(k, phrase, q);
    // THE USER'S WORDS, NOT ONLY THE READER'S. "at least one currently open
    // sales role" names hiring although the reader did not label it, so it was
    // tagged `user_inferred` — the request's own cue says otherwise.
    const cueStated = SIGNAL_CUE[k]?.test(q) ?? false;
    const source: CriterionSource = userKinds.has(k) || cueStated ? "user_explicit" : "user_inferred";
    const asserted = !elevated && statedHiringRequirement(k, source, query);
    const def = DEFAULT_SIGNAL_WINDOWS[k];
    const ws = sem?.window_sources?.[k];
    const carried = s.timeframe_days != null;
    let time_window: CriterionTimeWindow | undefined = carried
      ? {
        days: s.timeframe_days!, basis: def?.basis ?? "observed",
        source: ws?.source ?? (lang?.window_days_by_kind?.[k] != null ? "user_explicit" : "system_default"),
        ...(ws?.rule ? { rule: ws.rule } : def ? { rule: def.rule } : {}), enforced: false,
      }
      // Hiring's default is display-only (never carried), so it is shown even
      // without a temporal word — the plan's own "hiring growth marketers" example.
      : def && k !== "technology" && (TEMPORAL_CUE_RE.test(query) || k === "hiring")
      ? { days: def.days, basis: def.basis, source: "system_default", rule: def.rule, enforced: false }
      : undefined;
    // A mission compiled before company-age windows were recognised carries the
    // company's age as this signal's window ("founded in the last 3 years that
    // raised funding" → funding@1095). Read it the way a fresh compile does: the
    // age is no signal's window, so the signal keeps its own default.
    const ageDays = time_window && def ? companyAgeWindowDays(query) : null;
    if (ageDays != null && sameWindow(time_window!.days, ageDays) &&
        (lang ?? readMissionLanguage(query)).window_days_by_kind[k] == null) {
      time_window = { days: def!.days, basis: def!.basis, source: "system_default", rule: def!.rule, enforced: false };
    }
    // ── A STATED FUNDING WINDOW IS A REQUIREMENT, WHEN IT CAN BE PROVEN ────
    //
    // "…that has raised funding in the last 2 years" names a window the user
    // chose, and the READY funding pair answers exactly that (`recently_funded`:
    // a dated round inside the window, or a complete history with none). As a
    // TARGET it ranked and never rejected — and the claim phase only verifies
    // HARD gaps, so the pair was never asked and request feasibility refused
    // the mission as unprovable (2026-09-23, local). The `must` elevation above
    // could not rescue it: both parsers record the whole sentence as the
    // signal's phrase, so there is nothing before it to read.
    //
    // Only a USER-stated window, and only while the pair may run: a default
    // window stays a target, and an unready verifier cannot make a requirement
    // look answerable. And only when the days carried ARE the days the user
    // said: the deterministic parser labels "in the last 2 years" user-stated
    // while carrying the 180-day default, and a hard requirement on the wrong
    // window would reject a company the user asked for.
    const fundingCandidate = !elevated && k === "funding" && source === "user_explicit" &&
      !signalHedged("funding", query) && fundingVerifierReady(readiness);
    // Funding's OWN stated window (RC06), never the sentence's first: "hiring
    // sales in the last 2 weeks and raised funding in the last 2 years" compared
    // 730 against 14 and left a stated funding window soft. A compiled mission
    // carries no language record, so it is read again from the same words.
    const fundingWindow = fundingCandidate &&
      time_window?.source === "user_explicit" &&
      sameWindow(time_window.days,
        (lang ?? readMissionLanguage(query)).window_days_by_kind.funding ?? explicitWindowDays(query));
    // ── "RECENT FUNDING" IS A REQUIREMENT TOO, ON THE CANONICAL DEFAULT ─────
    //
    // "…with 11–50 employees, recent funding, and…" lists funding as something
    // the company must have, but names no window, so it compiled as a target:
    // never verified, and request feasibility then reported funding as
    // "unsupported" — or, when it was the only signal ("verify funding
    // recency"), refused the whole mission. The product DOES define "recently
    // funded": `DEFAULT_SIGNAL_WINDOWS.funding` (180 days, "recently funded /
    // raised"), from the plan's time-window table. So a stated, unhedged
    // recency requirement is hard on that window, and the window stays labelled
    // `system_default` — the card says it is a default, never that the user
    // said it. A bare round or stage ("seed-funded") names no recency and is
    // untouched: recency and stage are separate claims. Only when the user
    // named NO window: a stated window that disagrees with the carried one
    // stays a target (above), and a window the model guessed for "recently"
    // is not the user's either — the hard claim runs on the canonical default.
    const fundingClause = k === "funding" ? signalClause("funding", query) : null;
    const fundingRecency = fundingCandidate && !fundingWindow && !!def && !!fundingClause &&
      FUNDING_RECENCY_RE.test(fundingClause) &&
      lang?.window_days_by_kind?.funding == null && explicitWindowDays(fundingClause) == null;
    if (fundingRecency) {
      time_window = { days: def!.days, basis: def!.basis, source: "system_default", rule: def!.rule, enforced: false };
    }
    // RC05 — a calendar window is a stated recency window; a stated past raise
    // with no window is PRESENCE ("has raised venture funding", "before 2024").
    const calendar = fundingCandidate && !fundingWindow && !fundingRecency && !!fundingClause
      ? calendarWindow(fundingClause) : null;
    if (calendar) {
      time_window = { days: s.timeframe_days ?? calendar.days, basis: def?.basis ?? "observed", source: "user_explicit",
        rule: calendar.rule, enforced: false };
    }
    // Presence only when NOTHING stated a window: no window words in the clause,
    // and no window the user or the model carried (a default the compiler added
    // for a temporal word elsewhere — "…and currently hiring" — is not one).
    const statedWindow = !!time_window && time_window.source !== "system_default";
    // The clause states a past raise with no window: presence, whatever makes it hard.
    const windowlessRaise = k === "funding" && !fundingRecency && !calendar && !!fundingClause && !statedWindow &&
      !FUNDING_WINDOW_WORDS_RE.test(fundingClause) && !FUNDING_FUTURE_RE.test(fundingClause) &&
      (!!fundingClause && (FUNDING_BEFORE_RE.test(fundingClause) || FUNDING_PRESENCE_RE.test(fundingClause)));
    const presenceBefore = windowlessRaise ? fundingBeforeDate(fundingClause!) : null;
    // Hard by the presence rule (stated, unhedged, verifier ready) — or already
    // hard by a modal ("must have raised venture funding"), which must still
    // carry WHAT kind of raise it requires.
    const fundingPresence = fundingCandidate && !fundingWindow && windowlessRaise;
    const presenceClaim = fundingPresence || (!!elevated && windowlessRaise);
    const presenceKind = presenceClaim && VENTURE_FUNDING_RE.test(fundingClause!) ? "venture" : "any";
    // KIND IS ITS OWN DIMENSION (Wave 3): "raised venture funding in the last 24
    // months" is recency over VENTURE rounds. Only presence carried the kind, so
    // a window erased it and a grant inside the window passed.
    const recencyKind = !presenceClaim && k === "funding" && !!fundingClause && VENTURE_FUNDING_RE.test(fundingClause)
      ? "venture" : null;
    if (presenceClaim) time_window = undefined; // presence has no window; a bound is `before`
    push({
      kind: elevated || fundingWindow || fundingRecency || calendar || fundingPresence || asserted ? "hard" : "target",
      dimension: k, value: {
        event: eventOf(s), subject: s.subject ?? "company", qualifier: s.qualifier ?? {},
        ...(presenceClaim ? { presence: presenceKind, ...(presenceBefore ? { before: presenceBefore } : {}) } : {}),
        ...(recencyKind ? { funding_kind: recencyKind } : {}),
      },
      label: presenceClaim
        ? `Funding: has raised ${presenceKind === "venture" ? "venture funding" : "funding"}${presenceBefore ? ` before ${presenceBefore.slice(0, 7)}` : ""}`
        : `${signalDetail(k, s, rec?.subkind ?? reading?.subkind)}${recencyKind ? " (venture funding only)" : ""}`,
      source, ...(time_window ? { time_window } : {}),
      ...(elevated ? { elevated_by: /^(?:only|strictly)$/.test(elevated[1]) ? elevated[1] as MissionCriterion["elevated_by"] : "must" } : {}),
      user_phrase: source === "user_explicit" ? phrase : "",
      rationale: fundingWindow
        ? "a funding window the request states, which the funding pair can verify"
        : calendar
        ? `a funding window the request states ("${calendar.rule}"), which the funding pair can verify`
        : fundingPresence
        ? `a raise the request states the company must have made${presenceBefore ? ` before ${presenceBefore.slice(0, 10)}` : ""} — presence, not recency`
        : fundingRecency
        ? `a funding recency the request requires; no window was stated, so the canonical "${def!.rule}" default (${def!.days} days) applies`
        : asserted
        ? "a signal the request states as a present fact the company must have"
        : source === "user_explicit"
        ? "an observable signal the request asks for"
        : "added by the model's reading; the request's words do not state it",
    });
  }

  // ── Hypotheses and their proxy signals ──
  for (const h of hypotheses) {
    push({
      kind: "hypothesis", dimension: "company_profile", value: h.phrase,
      label: `Hypothesis: ${h.phrase}`, source: "user_explicit", user_phrase: h.phrase,
      rationale: "an opportunity thesis to test — can rank a company, never reject one, and is not a verified signal",
    });
    if (h.role_families.length || h.role_terms.length) {
      const role = h.role_terms[0] ?? h.role_families[0];
      const proxies: Array<[CriterionDimension, string, string]> = [
        ["funding", "Funding in the last 180 days", "a recent round often precedes the first hires in a function"],
        ["hiring", `Hiring adjacent to ${role}`, "adjacent openings suggest the function is being built"],
        ["company_profile", `No existing ${role} leader`, "team-composition evidence, checked only for shortlisted companies"],
      ];
      for (const [dimension, label, why] of proxies) {
        push({
          kind: "opportunity_signal", dimension, value: { proxy_for: h.phrase, label },
          label: `${label} (proxy)`, source: "system_default", user_phrase: "",
          rationale: `proxy for "${h.phrase}": ${why}; can rank, never reject`,
        });
      }
    }
  }

  // ── What the request said that nothing will prove ──
  for (const phrase of unmapped) {
    push({
      kind: "target", dimension: "unrecognised_signal", value: phrase,
      label: `Signal not recognised: "${phrase}"`, source: "user_explicit", user_phrase: phrase,
      status: "unrecognised", rationale: "not a signal this system recognises yet; nothing will prove it",
    });
  }
  for (const sentence of mission.unrepresented_requirements ?? []) {
    if (unmapped.some((p) => sentence.includes(`"${p}"`))) continue;
    push({
      kind: "target", dimension: "unrepresentable_evidence", value: sentence,
      label: sentence, source: "user_explicit", user_phrase: "", status: "unrepresentable",
      rationale: "evidence the system has no vocabulary or source for",
    });
  }
  return out;
}

/** Attach freshly derived criteria (after a Company Brain merge, say). */
export function attachMissionCriteria<T extends LeadMissionV1>(mission: T): T {
  return { ...mission, criteria: deriveMissionCriteria(mission) };
}

/** The canonical representation, as one object. */
export function canonicalMissionView(mission: LeadMissionV1) {
  const criteria = mission.criteria ?? deriveMissionCriteria(mission);
  return {
    goal: mission.mission_semantics?.goal ?? mission.original_user_query,
    requested_count: mission.requested_count ?? null,
    criteria,
    canonical_signals: mission.mission_semantics?.canonical_signals ?? [],
  };
}

// ── THE CARD ─────────────────────────────────────────────────────────────────

export interface CriteriaSections {
  version: typeof MISSION_SEMANTICS_VERSION;
  hard: string[];
  target: string[];
  opportunity_signals: string[];
  hypotheses: string[];
  time_windows: string[];
  unsupported: string[];
}

const SIGNAL_DIMENSIONS = new Set<string>(CANONICAL_SIGNAL_KINDS.filter((k) => k !== "company_profile"));

function sourceSuffix(c: MissionCriterion): string {
  const base = SOURCE_LABEL[c.source];
  return c.source === "user_inferred" && c.confidence != null
    ? `${base} (confidence ${c.confidence.toFixed(2)})` : base;
}

/**
 * What the confirmation card shows, grouped the way the user reads a request.
 *
 * `extraUnsupported` carries Stage 0's own gaps (the feasibility report), so
 * requirements the plan cannot prove appear beside those the language could
 * not express — one list of "will not be established".
 */
export function criteriaSections(
  mission: LeadMissionV1, extraUnsupported: readonly string[] = [],
): CriteriaSections {
  const criteria = mission.criteria ?? deriveMissionCriteria(mission);
  const sections: CriteriaSections = {
    version: MISSION_SEMANTICS_VERSION,
    hard: [], target: [], opportunity_signals: [], hypotheses: [], time_windows: [], unsupported: [],
  };
  const add = (list: string[], line: string) => { if (line && !list.includes(line)) list.push(line); };
  for (const c of criteria) {
    const isSignal = SIGNAL_DIMENSIONS.has(c.dimension);
    if (c.status !== "ok") {
      const why = c.status === "unprovable_today"
        ? `${c.label} (${c.kind}) — no current source proves it`
        : c.label;
      add(sections.unsupported, why);
      if (c.status !== "unprovable_today") continue;
    }
    if (c.kind === "hypothesis") add(sections.hypotheses, `${c.label.replace(/^Hypothesis: /, "")} · to be tested, never required`);
    else if (c.kind === "opportunity_signal") add(sections.opportunity_signals, `${c.label} · can rank, never reject`);
    else if (isSignal) add(sections.opportunity_signals, `${c.label} · ${c.kind === "hard" ? "required" : "target"} · ${sourceSuffix(c)}`);
    else if (c.kind === "hard") add(sections.hard, `${c.label} · ${sourceSuffix(c)}`);
    else add(sections.target, `${c.label} · ${sourceSuffix(c)}`);
    if (c.time_window) {
      const w = c.time_window;
      const how = w.source === "system_default" ? `default for "${w.rule ?? "recent"}"`
        : w.source === "user_explicit" ? "you said this" : "inferred";
      add(sections.time_windows,
        `${SIGNAL_LABEL[c.dimension as CanonicalSignalKind] ?? c.label}: last ${w.days} days · ${how}` +
        (c.dimension === "hiring" && w.source === "system_default" ? " · shown, not yet enforced" : ""));
    }
  }
  for (const g of extraUnsupported) add(sections.unsupported, String(g));
  return sections;
}

/**
 * Is the known-company funding-stage route live IN PRODUCTION? Criteria are
 * derived without a mission's policy (every reader derives them the same way),
 * so provability follows the production decision of the one readiness
 * authority — a provider probe never makes a criterion look answerable.
 */
export function fundingVerifierReady(
  readiness: ReadinessPolicy = PRODUCTION_READINESS,
): boolean {
  return readiness.decide("apify_funding_atomus", "funding_verification").executable;
}
