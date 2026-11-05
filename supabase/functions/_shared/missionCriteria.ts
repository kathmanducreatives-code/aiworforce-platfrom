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
// HIRING'S DEFAULT WINDOW LIVES ON THE CRITERION, NOT THE CARRIER. When P1
// landed no V2 hiring source read a posting date (YC `openJobs` carry none), so
// the window was kept off `timeframe_days` — evaluator prompts would have read
// "within 30 days" with nothing checking it — and the card called it "not yet
// enforced". It still stays off the carrier. But the criterion's
// `time_window.days` is now what the open-role verifier is given
// (`criteriaWindow` in run-agent): it asks the provider for recent postings and
// keeps only those dated inside the window, and an undated posting proves
// nothing (`hiringClaimVerifier.withinWindow`). So the card states it like any
// other default window, with no caveat.
//
// Pure. No network, no model, no database. Not part of `missionHash`.

import { PRODUCTION_READINESS, type ReadinessPolicy } from "./routeReadiness.ts";
import {
  canonicalSignalType, containsPhrase, hedgedLocations, isHiringSignal, sameLocation,
  type FieldProvenance, type LeadMissionV1, type MissionSignal,
} from "./leadMission.ts";
import { isControlledPhrase, readFacets } from "./businessModelMatch.ts";
import { sizeRangeProvable } from "./companySize.ts";
import { classifyRoleFamily, roleFamilyAliases } from "./roleFamilies.ts";
import { readSignalPhrase, type SignalQualifier } from "./missionSignalDescriptor.ts";
import { placeName, understandingOf, type ValidatedUnderstanding } from "./missionUnderstanding.ts";
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
  geography_scope?: "headquarters" | "presence";
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
  /**
   * CONTRACT v2 only: the window each kind carries because the user stated it
   * (validated contract window, or the reader's where the contract omitted it).
   * Read by criteria derivation, which otherwise recognises a stated window
   * only when this pass's own reader can read it.
   */
  stated_windows?: Record<string, number>;
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

/**
 * Is the sentence that states this size range hedged? The sentence holding either
 * bound's digits ("20–500", "under 100") is read for a preference word, or for an
 * explicit invitation to go outside the range ("include … outside that range").
 */
export function sizeClauseHedged(query: string, range: { min?: number | null; max?: number | null }): boolean {
  const nums = [range.min, range.max].filter((n): n is number => n != null).map(String);
  if (!nums.length) return false;
  for (const sentence of String(query ?? "").split(/(?<=[.;!?])\s+|\n+/)) {
    if (!nums.some((n) => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(sentence.replace(/,/g, "")))) continue;
    if (HEDGE_RE.test(sentence) || /\b(?:outside|beyond)\s+(?:that|this|the)\s+(?:range|band)\b/i.test(sentence)) return true;
  }
  return false;
}

// ── BUSINESS-MODEL AUDIENCE: REQUIRED ONLY WHEN THE USER SAYS SO ─────────────
//
// "Find US B2B companies hiring Account Executives" DESCRIBES the companies; it
// does not make B2B a filter. The model files "B2B" under company_types, the
// value is in the request's words, and `profileList` used to compile every such
// value as a HARD industry — so on TEST (plan 116a1b45) every company stayed
// needs_verification on "B2B", a label no discovery provider can establish.
//
// An AUDIENCE descriptor (B2B / B2C / D2C, read by the controlled vocabulary in
// businessModelMatch.ts, never by substring) is a business model, and how hard it
// is comes from the user's own words in the clause that names it:
//   exclude   "exclude B2C", "no B2C", "not D2C"           → hard exclusion
//   require   "only B2B", "must be B2B", "B2B only"         → hard requirement
//             (no provider verifies it, so a company without evidence stays
//             needs_verification — missing evidence is never proof)
//   prefer    "prefer B2B", "ideally B2B"                    → preference
//   permit    "include strong B2C opportunities"             → no restriction
//   describe  "US B2B companies"                             → preference
// A value mixing in anything else ("B2B SaaS", "fintech") is not an audience
// descriptor and keeps the existing rule.

const B2B_WORDS_RE = /\b(?:b2b|business[\s-]+to[\s-]+business)\b/i;
const CONSUMER_WORDS_RE = /\b(?:b2c|d2c|dtc|direct[\s-]+to[\s-]+consumers?|business[\s-]+to[\s-]+consumers?|consumers?)\b/i;
const AUDIENCE_EXCLUDE_RE = /\b(?:exclude[sd]?|excluding|no|not|non|without|except|avoid|never|other\s+than)\b/i;
const AUDIENCE_REQUIRE_RE = /\b(?:only|must|required?|requires|requirement|exclusively|strictly|solely|mandatory)\b/i;
const AUDIENCE_PERMIT_RE = /\b(?:include|including|also|open\s+to|welcome|fine|ok(?:ay)?|acceptable|consider|allow(?:ed)?)\b/i;

export type AudienceIntent = "exclude" | "require" | "prefer" | "permit" | "describe" | "absent";

/** The audience a value names when it is ONLY an audience descriptor ("B2B", "B2C companies"), else null. */
export function audienceDescriptor(value: unknown): "b2b" | "consumer" | null {
  const text = String(value ?? "");
  const f = readFacets(text);
  if (f.audience === null || f.delivery !== null || f.ai || f.other.length) return null;
  const re = f.audience === "b2b" ? B2B_WORDS_RE : CONSUMER_WORDS_RE;
  return re.test(text) ? f.audience : null;
}

/** How the request's own words treat this audience (see the table above). "absent": the request never names it. */
export function audienceIntent(query: string, audience: "b2b" | "consumer"): AudienceIntent {
  const re = audience === "b2b" ? B2B_WORDS_RE : CONSUMER_WORDS_RE;
  const clauses = String(query ?? "").split(/[.;!?\n]+|,?\s+but\s+|,\s*(?=(?:and\s+)?(?:exclude|excluding|include|prefer|ideally|only)\b)/i);
  let found: AudienceIntent = "absent";
  const rank: AudienceIntent[] = ["absent", "describe", "permit", "prefer", "require", "exclude"];
  for (const clause of clauses) {
    const m = re.exec(clause);
    if (!m) continue;
    // Only the words just before the term speak about it ("Only include verified B2B",
    // "exclude B2C"); a "no" further back ("no outside funding … B2B") does not.
    const before = clause.slice(0, m.index).trim().split(/\s+/).slice(-4).join(" ");
    const after = clause.slice(m.index + m[0].length).split(/\s+/).slice(0, 4).join(" ");
    const intent: AudienceIntent = AUDIENCE_EXCLUDE_RE.test(before) ? "exclude"
      : AUDIENCE_REQUIRE_RE.test(before) || /^\s*(?:\w+\s+)?(?:only|exclusively)\b/i.test(after) ? "require"
      : HEDGE_RE.test(clause) ? "prefer"
      : AUDIENCE_PERMIT_RE.test(before) ? "permit"
      : "describe";
    // The strongest statement about the audience anywhere in the request wins.
    if (rank.indexOf(intent) > rank.indexOf(found)) found = intent;
  }
  return found;
}

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

/**
 * A `hard_constraints` entry that only RESTATES the mission's one hiring signal.
 *
 * Canary session 2 (queue 763fc2b9…, "Find one US company hiring Account
 * Executives…"): the model put `hiring: {operator: "currently_hiring", value:
 * "Account Executives"}` in `hard_constraints` beside the hiring signal that
 * already carries those role terms. The value is in the query, so it became a
 * second HARD criterion with dimension `constraint` — which no evidence
 * dimension answers. Every candidate stayed `unknown` on it, `canStillQualify`
 * found a hard gap with no route, and the funding verifier was never run for
 * any of the three companies.
 *
 * Skipped only when all of it is the same: a hiring field from a closed list,
 * a non-excluding operator from a closed list, exactly one hiring signal, and
 * the same set of role terms (case and a plural "s" aside). Any other field,
 * operator or role is kept exactly as before.
 */
const RESTATED_HIRING_FIELDS = new Set(["hiring", "hiring_role", "hiring_roles", "hiring_signal", "open_role",
  "open_roles", "job_title", "job_titles"]);
const RESTATED_HIRING_OPS = new Set(["", "currently_hiring", "actively_hiring", "is_hiring", "hiring", "has_open_role",
  "has_open_roles", "equals", "eq", "is", "in", "includes", "contains", "matches"]);
/**
 * TEST plan 6999eff6 ("Find 5 US B2B companies actively hiring salespeople …"):
 * the model added `hiring_activity: "actively hiring salespeople"` beside the
 * hiring signal that already carries "salespeople" (family gtm_sales). The field
 * was not on the closed list and the value was not the role terms word for word,
 * so it compiled to a hard `constraint` no evidence answers — every company would
 * have stayed needs_verification on it.
 *
 * Also a restatement, read by meaning rather than spelling: a field that NAMES
 * hiring (HIRING_FIELD_RE), a non-excluding, non-numeric operator, one hiring
 * signal, and a value that — once the generic hiring words are removed — says
 * nothing more ("actively hiring", true), says the same role terms, or names the
 * same role FAMILY as the signal ("salespeople" ↔ gtm_sales). Kept as its own
 * requirement: an exclusion, a count or threshold ("at least 5 open roles", any
 * digit), a different family ("also hiring engineers"), or two hiring signals.
 */
const HIRING_FIELD_RE =
  /^(?:is_|currently_|actively_|recent(?:ly)?_)?(?:hiring|hires?|open_?roles?|job_?(?:titles?|postings?|openings?|listings?)|vacanc(?:y|ies)|recruit(?:ing|ment)?)(?:_[a-z]+)*$/;
const NOT_A_RESTATEMENT_OP_RE = /not|exclud|except|other_?than|unless|outside|^neq?$|none|false|without|!=|<>|gte|lte|>|<|min|max|at_?least|at_?most|count|number|threshold|greater|less|above|below|more|fewer|over|under|between|range|before|after|older|newer/;
const HIRING_FILLER_RE =
  /\b(?:actively|currently|recently|now|still|is|are|be|being|hiring|hires?|hired|for|open|roles?|positions?|jobs?|postings?|openings?|vacanc(?:y|ies)|new|the|a|an|in|of|any|some|true|yes|active|activity|recruiting)\b/g;

/**
 * A constraint FIELD name in one spelling: "hiring.role", "hiring role", "hiring-role",
 * "hiringRole" and "HiringRole" are all "hiring_role" (TEST plan run 41466774814: the
 * model wrote the field with a dot, which the closed lists below did not match).
 */
export function normaliseFieldName(field: string): string {
  return String(field ?? "").trim().replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[.\s-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

/**
 * The role words a HARD HIRING CONSTRAINT quotes from the user's request — for the
 * compiler to offer to the hiring signal, exactly like `required_signal_terms`.
 *
 * TEST deploy 9fee47ba (2026-11-02): for "Find 5 US B2B companies actively hiring
 * salespeople" the model left `required_signal_terms` empty and wrote the role as
 * `hiring_status: "actively hiring salespeople"`. The signal reached the mission with
 * no role, so Apify had nothing to search, the plan was blocked, and the constraint
 * compiled as an `unmappable` hard requirement. The role is the USER'S, word for word.
 *
 * Only a field that names hiring, a non-excluding non-count operator, no digit, and a
 * value found verbatim in the request: never the model's own words, never a count or an
 * exclusion. Whether the words qualify the signal is still decided by the signal reader.
 */
export function quotedHiringRoleWords(hardConstraints: unknown, query: string): string[] {
  const q = String(query ?? "").toLowerCase().replace(/\s+/g, " ");
  const list = Array.isArray(hardConstraints) ? hardConstraints : [];
  const out: string[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const { field, operator, value } = c as { field?: unknown; operator?: unknown; value?: unknown };
    const f = normaliseFieldName(String(field ?? ""));
    if (!RESTATED_HIRING_FIELDS.has(f) && !HIRING_FIELD_RE.test(f)) continue;
    if (NOT_A_RESTATEMENT_OP_RE.test(String(operator ?? "").trim().toLowerCase())) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v !== "string" || /\d/.test(v)) continue;
      const t = v.trim().toLowerCase().replace(/\s+/g, " ");
      if (t.length <= 2 || !q.includes(t)) continue;
      // The ROLE words only: "actively hiring salespeople" offers "salespeople" (the same
      // filler restatesHiringSignal strips). "actively hiring" alone names no role.
      const role = t.replace(HIRING_FILLER_RE, " ").replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim();
      if (role) out.push(role);
    }
  }
  return out;
}

export function restatesHiringSignal(field: string, raw: unknown, signals: readonly Partial<MissionSignal>[]): boolean {
  const f = normaliseFieldName(field);
  const c = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { value: raw }) as
    { operator?: unknown; value?: unknown };
  const op = String(c.operator ?? "").trim().toLowerCase();
  const hiring = signals.filter((s) => kindOfSignal(s) === "hiring");
  if (hiring.length !== 1) return false;
  const form = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/s$/, "");
  const values = Array.isArray(c.value) ? c.value : [c.value];
  const carried = new Set((hiring[0].qualifier?.role_terms ?? []).map(form).filter(Boolean));
  // The original, exact rule (canary session 2).
  if (RESTATED_HIRING_FIELDS.has(f) && RESTATED_HIRING_OPS.has(op)) {
    const stated = new Set(values.map(form).filter(Boolean));
    if (stated.size > 0 && stated.size === carried.size && [...stated].every((t) => carried.has(t))) return true;
  }
  // The same statement in other words.
  if (!RESTATED_HIRING_FIELDS.has(f) && !HIRING_FIELD_RE.test(f)) return false;
  if (op && NOT_A_RESTATEMENT_OP_RE.test(op)) return false;
  if (!values.length || values.some((v) => typeof v === "number" || /\d/.test(String(v ?? "")))) return false;
  const families = new Set<string>([
    ...(hiring[0].qualifier?.role_families ?? []),
    ...[...(hiring[0].qualifier?.role_terms ?? []), hiring[0].phrase ?? ""].map((t) => classifyRoleFamily(t)).filter((x): x is NonNullable<typeof x> => !!x),
  ]);
  return values.every((v) => {
    if (v === true) return true;
    const rest = String(v ?? "").toLowerCase().replace(HIRING_FILLER_RE, " ").replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim();
    if (!rest) return true; // "actively hiring": the signal itself
    if (carried.has(form(rest))) return true;
    const fam = classifyRoleFamily(rest);
    if (!fam || !families.has(fam)) return false;
    // A SPECIFIC title (a listed alias of its family: "SDR", "Account Executive") that
    // the signal does not carry is a different role, kept. Only a generic word for the
    // same family ("salespeople", "sellers") is the same statement.
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z ]/g, "").replace(/s$/, "").trim();
    return !roleFamilyAliases(fam).some((a) => norm(a) === norm(rest));
  });
}

/**
 * The same restatement for the funding WINDOW: canary session 2's proposal also
 * carried `funding_event announced_within_last_days 180` beside the funding
 * signal's own 180-day window. It compiled to a second, unanswerable
 * `constraint` row. Skipped only for a funding field and a within-days operator
 * from closed lists, one funding signal, and the SAME number of days; a
 * different window, a minimum amount or any other operator is kept.
 */
const RESTATED_FUNDING_FIELDS = new Set(["funding_event", "funding", "funding_round", "recent_funding", "funding_recency",
  "funding_recency_days", "last_funding_days", "funding_window_days"]);
const RESTATED_FUNDING_OPS = new Set(["announced_within_last_days", "within_last_days", "within_days", "within",
  "raised_within_days", "announced_within_days", "max_age_days", "at_most_days", "<=", "lte"]);
export function restatesFundingWindow(field: string, raw: unknown, signals: readonly Partial<MissionSignal>[]): boolean {
  if (!RESTATED_FUNDING_FIELDS.has(normaliseFieldName(field))) return false;
  const c = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { value: raw }) as
    { operator?: unknown; value?: unknown };
  if (!RESTATED_FUNDING_OPS.has(String(c.operator ?? "").trim().toLowerCase())) return false;
  const funding = signals.filter((s) => kindOfSignal(s) === "funding");
  if (funding.length !== 1 || typeof funding[0].timeframe_days !== "number") return false;
  const days = typeof c.value === "number" ? c.value : /^\d{1,4}$/.test(String(c.value ?? "").trim()) ? Number(c.value) : NaN;
  return days === funding[0].timeframe_days;
}

/**
 * The same restatement for the SIZE bound: "under 100 employees" arrives as
 * `employee_range.max = 100` AND as `employee_max lte 100` in hard_constraints.
 * The second compiled to a hard `constraint` no evidence dimension answers —
 * `unprovable_today`, so every candidate of such a mission was held blocked
 * (PR #198's provider tests failed on the merge with this branch for the same
 * row). Skipped only for a size field and a bound operator from closed lists
 * whose value EQUALS the mission's own range bound; a different bound ("at
 * most 50" beside 100) is a requirement of its own and is kept.
 */
const RESTATED_MAX_FIELDS = new Set(["employee_max", "max_employees", "employee_count_max", "employees_max", "headcount_max"]);
const RESTATED_MIN_FIELDS = new Set(["employee_min", "min_employees", "employee_count_min", "employees_min", "headcount_min"]);
const RESTATED_MAX_OPS = new Set(["lte", "<=", "max", "at_most", "less_than_or_equal", "maximum"]);
const RESTATED_MIN_OPS = new Set(["gte", ">=", "min", "at_least", "greater_than_or_equal", "minimum"]);
export function restatesEmployeeBound(
  field: string, raw: unknown, range: { min?: number | null; max?: number | null } | null | undefined,
): boolean {
  const f = normaliseFieldName(field);
  const isMax = RESTATED_MAX_FIELDS.has(f), isMin = RESTATED_MIN_FIELDS.has(f);
  if (!isMax && !isMin) return false;
  const c = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { value: raw }) as { operator?: unknown; value?: unknown };
  const op = String(c.operator ?? "").trim().toLowerCase();
  if (!(isMax ? RESTATED_MAX_OPS : RESTATED_MIN_OPS).has(op)) return false;
  const n = typeof c.value === "number" ? c.value : /^\d{1,7}$/.test(String(c.value ?? "").trim()) ? Number(c.value) : NaN;
  const bound = isMax ? range?.max : range?.min;
  return typeof bound === "number" && n === bound;
}

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
  /**
   * CONTRACT v2: each signal's window as the model attributed it and the
   * compiler validated it against the request (`missionInterpretationContract`).
   * Present ⇒ it is the ONLY source of a stated window: a kind absent here was
   * stated without one, and this pass's own sentence reader is recorded where
   * it disagrees, never applied. Absent ⇒ v1, unchanged.
   */
  signalWindows?: Readonly<Record<string, number>> | null;
  /**
   * CONTRACT v2: kinds whose signals already carry their OWN window, set per
   * signal by the compiler ("AEs in the last 2 weeks, SDRs in the last 90
   * days"). This pass leaves those windows alone and only checks the reader.
   */
  contractPerSignalKinds?: readonly string[] | null;
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
  const statedWindows: Record<string, number> = {};
  signals = signals.map((s) => {
    const k = kindOfSignal(s);
    if (!k || k === "technology") return s;
    const readerForK = lang.window_days_by_kind[k];
    let statedForK: number | null = readerForK ?? null;
    if (i.signalWindows) {
      // ── CONTRACT v2: THE MODEL ATTRIBUTES, THE READER CHECKS ────────────
      //
      // The reader is an INDEPENDENT check, not a record: where the model
      // omitted a window the reader reads, the reader's window is kept (so a
      // stated requirement is never downgraded by an omission); where both
      // read a window and disagree, the conflict is named and the compiler
      // refuses the mission. Both are capped at the compiler's 730-day limit.
      const cap = (d: number | null | undefined) => d == null ? null : Math.min(d, 730);
      const reader = cap(readerForK);
      const once = (c: string) => { if (!changes.includes(c)) changes.push(c); };
      if (i.contractPerSignalKinds?.includes(k)) {
        windowSources[k] = { source: "user_explicit" };
        const own = signals.filter((x) => kindOfSignal(x) === k).map((x) => x.timeframe_days);
        if (reader != null && !own.some((d) => d != null && sameWindow(d, reader))) {
          once(`window_conflict:${k}:contract=per_signal:reader=${readerForK}`);
        }
        return s;
      }
      const contract = cap(i.signalWindows[k]);
      // The reader puts this window on ANOTHER signal and none on this one:
      // the model copied one signal's timeframe onto a second (review R1's
      // shape, "hiring AEs whose funding closed within 6 months" read as a
      // hiring window too). A disagreement like any other.
      const elsewhere = contract != null && reader == null
        ? Object.entries(lang.window_days_by_kind).find(([other, d]) => other !== k && d != null && sameWindow(cap(d)!, contract))?.[0]
        : undefined;
      if (contract != null && reader != null && !sameWindow(contract, reader)) {
        once(`window_conflict:${k}:contract=${contract}:reader=${readerForK}`);
        statedForK = contract;
      } else if (elsewhere) {
        once(`window_conflict:${k}:contract=${contract}:reader=none:reader_assigns_it_to=${elsewhere}`);
        statedForK = contract;
      } else if (contract == null && reader != null) {
        once(`window_from_reader_contract_omitted:${k}:${reader}d`);
        statedForK = reader;
      } else {
        statedForK = contract;
      }
      if (readerForK != null && readerForK > 730 && statedForK === 730) once(`window_capped:${k}:${readerForK}->730`);
      if (statedForK != null) statedWindows[k] = statedForK;
    }
    if (statedForK != null) {
      windowSources[k] = { source: "user_explicit" };
      if (s.timeframe_days !== statedForK) {
        changes.push(`window_from_user_words:${k}:${statedForK}d`);
      }
      return { ...s, timeframe_days: statedForK };
    }
    // A window the user stated for ANOTHER signal is not this one's: the
    // default applies, and a carried copy of that window is replaced.
    if (!i.signalWindows && lang.explicit_window_days != null && s.timeframe_days != null &&
        sameWindow(s.timeframe_days, lang.explicit_window_days) && DEFAULT_SIGNAL_WINDOWS[k]) {
      windowSources[k] = { source: "system_default", rule: DEFAULT_SIGNAL_WINDOWS[k]!.rule };
      changes.push(`window_belongs_to_another_signal:${k}:${DEFAULT_SIGNAL_WINDOWS[k]!.days}d`);
      return { ...s, timeframe_days: DEFAULT_SIGNAL_WINDOWS[k]!.days };
    }
    // The sentence dates the COMPANY ("founded in the last 3 years") and this
    // signal's own clause names no window: a carried one is the model filing
    // the company's age under the signal, not a window the user gave it.
    if (!i.signalWindows && lang.company_age_window_days != null && s.timeframe_days != null && DEFAULT_SIGNAL_WINDOWS[k] &&
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
      // Under contract v2 it is a stated window like any other: the timeframe
      // audit must see it accounted for.
      if (i.signalWindows) statedWindows[k] = calendar.days;
      return { ...s, timeframe_days: calendar.days };
    }
    const d = DEFAULT_SIGNAL_WINDOWS[k];
    if (!d) return s;
    if (!TEMPORAL_CUE_RE.test(query)) return s; // no temporal word: nothing to default
    windowSources[k] = { source: "system_default", rule: d.rule };
    if (k === "hiring") return s; // on the criterion, not the carrier — see the header
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
    ...(i.signalWindows ? { stated_windows: statedWindows } : {}),
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
  // Q3 (Codex routing audit C01, L08, C04): without a cue, a social clause's own
  // "must" and "in the last 30 days" were never read as its own — "whose founder
  // must have discussed …" compiled as a preference on another clause's window.
  social_activity:
    /\b(?:comment(?:ed|ing|s)?|discuss(?:ed|es|ing)?|post(?:ed|ing|s)?|talk(?:ed|ing|s)?\s+about|wr(?:ote|iting|ites)\s+about|shar(?:ed|ing|es)|mention(?:ed|ing|s)?|engag(?:ed|ing|es)\s+with)\b/,
  // Q3 (H04): "must be rapidly expanding its sales team" is a requirement on
  // team growth; with no cue its "must" was never read as its own.
  headcount_growth:
    /\b(?:growing|expanding|scaling|increasing)\b(?:\s+[\w-]+){0,3}?\s+(?:headcount|teams?|workforce)\b|\bheadcount\b|\bhiring spree\b/,
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

/**
 * Q3 — the geography scope the customer's own words state. PRESENCE when they
 * speak of an office, presence, operations, a team or a location IN the place;
 * HEADQUARTERS otherwise. Read only from the request, never from a rewrite.
 * ("50 employees in the US" states a size, not a presence, so headcount words
 * are not presence words.)
 */
/** The company-kind noun itself — "startup(s)", "start-up(s)" — as the customer wrote it. */
const STARTUP_NOUN = /\bstart-?ups?\b/i;
/**
 * Q3 — the company kind made MANDATORY by the customer's own words: "only …
 * startups", "must be a startup", "strictly early-stage startups". The modal
 * must govern the noun inside the same clause.
 */
const STARTUP_REQUIRED =
  /\b(only|must(?:\s+currently)?(?:\s+be)?|strictly|exclusively|required\s+to\s+be|ha(?:s|ve)\s+to\s+be|needs?\s+to\s+be)\b[^.,;]{0,40}?\bstart-?ups?\b/i;

export function scopeFromWords(query: string): "headquarters" | "presence" {
  return /\b(?:offices?|presence|operations|operating|operates|branch(?:es)?|locations?|teams?)\s+(?:in|across|throughout)\b/i.test(query)
    ? "presence" : "headquarters";
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
  /**
   * Compile an audience descriptor by the request's own words (see `audienceIntent`).
   * Returns false when the value is not an audience descriptor or the request never
   * names that audience (the caller's existing rule then applies: not in the
   * request's words → a target).
   */
  const audienceCriterion = (v: string, how: string): boolean => {
    const audience = audienceDescriptor(v);
    if (!audience) return false;
    const intent = audienceIntent(query, audience);
    if (intent === "absent") return false;
    const said = inQuery(v) ? v : "";
    if (intent === "exclude") {
      push({
        kind: "hard", dimension: "exclusion", value: { field: "excluded_company_types", value: [v] },
        label: `Excluding: ${v}`, source: "user_explicit", elevated_by: "excluding", user_phrase: said,
        rationale: "the request excludes it; a company is rejected only on evidence that it is one",
      });
    } else if (intent === "require") {
      push({
        kind: "hard", dimension: "business_model", value: v, label: `Business model: ${v}`, source: "user_explicit",
        user_phrase: said,
        rationale: "the request requires it; no discovery provider verifies a business model, so a company " +
          "without evidence stays needs_verification — missing evidence is never taken as proof",
      });
    } else if (intent === "prefer" || intent === "describe") {
      push({
        kind: "target", dimension: "business_model", value: v, label: `Business model preference: ${v}`,
        source: "user_explicit", user_phrase: said,
        rationale: intent === "prefer"
          ? "stated as a preference; can rank, never reject"
          : `${how} describing the companies, not a stated requirement: it ranks and never rejects ` +
            "(no provider can verify a business model; say \"only\" to require it)",
      });
    }
    // "permit" ("include strong B2C opportunities"): nothing restricts it, so no criterion.
    return true;
  };
  const profileList = (
    dimension: CriterionDimension, field: string, values: readonly string[], label: string,
  ) => {
    // "AI or developer-tools", "New York or California": alternatives of ONE
    // requirement (RC02). Only values the request itself joins by "or".
    const ors = orAlternatives(values, query);
    const hedged = dimension === "geography" ? hedgedLocations(query, values) : [];
    for (const v of values) {
      // Q4 — A HEDGED LOCATION RANKS AND NEVER REJECTS. "…, ideally in the US"
      // is the customer's own word for a preference, whatever a carrier says.
      if (hedged.length && sameLocation(v, hedged)) {
        push({
          kind: "target", dimension, value: v, label: `${label} preference: ${v}`, source: "user_explicit",
          user_phrase: inQuery(v) ? v : "", rationale: "stated as a preference (\"ideally\"); can rank, never reject",
        });
        continue;
      }
      const source = sourceFromProvenance(prov[field], inQuery(v));
      // An audience descriptor ("B2B") the request names: hard only in the user's words.
      if ((dimension === "industry" || dimension === "business_model") && source !== "company_brain_policy" &&
        source !== "company_brain_preference" && audienceCriterion(v, "proposed as a company type")) continue;
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
  // S4 (D2): a v3 mission's stated industries carry the model's validated necessity;
  // the request's own words need not repeat the value letter for letter ("insurance
  // agency" for "insurance agencies", a typo, a synonym).
  const U4 = understandingOf(mission);
  const sing = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().replace(/ies$/, "y").replace(/s$/, "");
  const industryOf = (v: string) => U4?.industries?.find((x) => sing(x.industry) === sing(v)) ?? null;
  for (const [field, list, dimension, label] of [
    ["company_profile.verticals", cp.verticals ?? [], "industry", "Industry"],
    ["company_profile.business_models", cp.business_models ?? [], "business_model", "Business model"],
  ] as const) {
    const rest: string[] = [];
    for (const v of list) {
      const x = industryOf(v);
      if (!x || x.necessity === "excluded" || audienceDescriptor(v) !== null) { rest.push(v); continue; }
      push({
        kind: x.necessity === "required" ? "hard" : "target", dimension, value: v,
        label: x.necessity === "required" ? `${label}: ${v}` : `${label} preference: ${v}`, source: "user_explicit", user_phrase: x.span,
        rationale: x.necessity === "required" ? `stated in the request ("${x.span}")` : `stated as a preference ("${x.span}"); can rank, never reject`,
      });
    }
    // A v3 MISSION'S INDUSTRIES ARE ITS VALIDATED UNDERSTANDING'S (live study run #24): a
    // legacy company type the understanding does not name ("businesses", "US companies")
    // is the model's word, not the user's requirement — it ranks, it never rejects. A
    // Company Brain value keeps its own rules.
    // Named = its words lie within an understood industry ("saas" within "B2B SaaS", the
    // compiler's own split of it), not only an exact match.
    const words = (x: string) => sing(x).split(" ").filter(Boolean);
    const withinUnderstood = (v: string) => (U4?.industries ?? []).some((x) => x.necessity !== "excluded" &&
      words(v).length > 0 && words(v).every((w) => words(x.industry).includes(w) || words(x.span).includes(w)));
    const unnamed = U4 && field === "company_profile.verticals"
      ? rest.filter((v) => audienceDescriptor(v) === null && !withinUnderstood(v) &&
        !String(sourceFromProvenance(prov[field], inQuery(v))).startsWith("company_brain"))
      : [];
    for (const v of unnamed) {
      push({
        kind: "target", dimension, value: v, label: `${label} preference: ${v}`, source: "user_inferred", user_phrase: "",
        rationale: "a company type the model proposed outside its validated understanding; can rank, never reject",
      });
    }
    const kept = rest.filter((v) => !unnamed.includes(v));
    if (field === "company_profile.verticals") profileList("industry", field, kept, label);
    else profileList("business_model", field, kept, label);
  }
  // ── S4: A v3 MISSION'S PLACES ARE THE MODEL'S VALIDATED READING ─────────
  //
  // Necessity and scope come from the understanding (each place quoted from the
  // request and checked against the registry), not from a fixed list of country words
  // (NL3: "the states" was demoted to a preference) or office words (NL4). A location
  // the understanding does not name keeps the v1 reading.
  const U = understandingOf(mission);
  const placeOf = (v: string) => U?.places.find((p) =>
    (p.place ? placeName(p.place) : String(p.other_place ?? "")).toLowerCase() === String(v).toLowerCase()) ?? null;
  if (U && U.places.length) {
    const rest: string[] = [];
    for (const v of cp.locations ?? []) {
      const p = placeOf(v);
      if (!p || p.necessity === "excluded") { if (!p) rest.push(v); continue; }
      push({
        kind: p.necessity === "required" ? "hard" : "target", dimension: "geography", value: v,
        label: p.necessity === "required" ? `${p.scope === "headquarters" ? "Headquarters" : "Geography"}: ${v}` : `Geography preference: ${v}`,
        source: "user_explicit", user_phrase: p.span, geography_scope: p.scope,
        rationale: p.necessity === "required" ? `stated in the request ("${p.span}")` : `stated as a preference ("${p.span}"); can rank, never reject`,
      });
    }
    profileList("geography", "company_profile.locations", rest, "Geography");
  } else {
    profileList("geography", "company_profile.locations", cp.locations ?? [], "Geography");
  }
  // ── Q3 — A HARD GEOGRAPHY IS ALWAYS COMPILED WITH A SCOPE (A7 S02, S03b) ──
  //
  // The scope reached a criterion only from the model's proposal; when that was
  // null the RUNTIME evaluator's answer chose it, and a model reading "US
  // company" as office presence qualified a Canadian-HQ company with a US office.
  // The scope is fixed here, from the customer's own words, where the intent is:
  // the proposal's scope when it gives one; otherwise PRESENCE when the request
  // itself speaks of an office / presence / operations in the place; otherwise
  // HEADQUARTERS — "a US company" is a company headquartered in the US. A
  // compiled scope is never replaced by an evaluator's (#113 refuses a verdict
  // whose scope disagrees).
  //
  // PRESENCE ONLY IN THE USER'S WORDS. The model's "presence" is kept only when the
  // request itself speaks of an office / presence / operations in the place; a bare
  // "US companies" stays HEADQUARTERS whatever the model proposed (TEST smoke on
  // ea30436: "Find 5 US B2B companies …" compiled as US presence). The model's
  // "headquarters" is always kept: it is the stricter reading.
  const wordsScope = scopeFromWords(query);
  const geographyScope = cp.geography_scope === "presence" && wordsScope !== "presence"
    ? "headquarters" : cp.geography_scope ?? wordsScope;
  for (const c of out) {
    if (c.dimension !== "geography") continue;
    if (U && placeOf(String(c.value))) continue; // S4: its scope is the understanding's own
    const scope = cp.geography_scope || c.kind === "hard" ? geographyScope : undefined;
    if (scope) {
      c.geography_scope = scope;
      if (scope === "headquarters") c.label = `Headquarters: ${String(c.value)}`;
    }
  }

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
    // Q3 — NO COMPANY KIND THE CUSTOMER DID NOT STATE. The deterministic parser
    // files stage and cohort words ("seed-stage", "Series A", "early stage",
    // "YC") under the company kind "startup" for ROUTING, with
    // explicit-request provenance — so "must be seed-stage" compiled a
    // MANDATORY, user_explicit "Company kind: startup" nothing can prove. The
    // stage word is already its own criterion (`stageIntent`); the company kind
    // is a criterion only when the request itself says "startup".
    //
    // A MONITORING mission has no request text: its profile IS the workspace's
    // stored ICP (field_provenance.company_profile = "monitoring_subject") and its
    // query is a placeholder. The test above is about the user's words, so it
    // cannot apply — skipping there silently dropped the ICP's "startup" from
    // every monitor (production replay, Stage 7). The ICP states it; it is kept,
    // disclosed and ranking, as the target the code below makes it.
    const fromMonitor = (prov as Record<string, unknown>)["company_profile"] === "monitoring_subject";
    if (st === "startup" && source === "user_explicit" && !fromMonitor && !STARTUP_NOUN.test(query)) continue;
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
      //
      // MANDATORY ONLY WHEN SAID TO BE (Q3, audit G08). Every mandatory
      // requirement is now enforced, so an unprovable one keeps a company
      // pending unless its own words establish it. "Find B2B SaaS startups"
      // describes the population, and is disclosed and ranks as a target;
      // "only startups" / "must be a startup" makes it a requirement, enforced.
      const required = source === "user_explicit" ? query.match(STARTUP_REQUIRED) : null;
      push({
        kind: source === "company_brain_policy" || required ? "hard" : "target",
        dimension: "company_stage", value: "startup", label: "Company kind: startup",
        source, user_phrase: source === "user_explicit" ? "startup" : "",
        ...(required ? { elevated_by: (/^(?:only|strictly|exclusively)$/i.test(required[1])
          ? required[1].toLowerCase() : "must") as MissionCriterion["elevated_by"] } : {}),
        rationale: source === "company_brain_preference"
          ? "your Company Brain's ICP"
          : required ? `"${required[0]}" makes it a requirement`
          : fromMonitor ? "the monitored ICP names the company kind; disclosed, it ranks and never rejects"
          : "the company kind in the request, stated as a description, so a target",
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
    // A HEDGED SIZE RANKS AND NEVER REJECTS (TEST planning, 2026-11-01). "Prefer
    // 20–500 employees, but include strong opportunities outside that range" was
    // compiled to a HARD 20–500 criterion, so a company whose declared band lay
    // outside it was disproven — the opposite of what was asked. The clause that
    // states the range is read with the same HEDGE_RE that softens a stated stage
    // and location; an unhedged stated range stays a requirement.
    const sizeHedged = source === "user_explicit" && sizeClauseHedged(query, er);
    const kind = !sizeHedged && (source === "user_explicit" || source === "company_brain_policy") ? "hard" : "target";
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
        ? "your Company Brain's size band; you did not state one"
        : sizeHedged ? "stated as a preference: it ranks and never rejects" : "stated in the request",
      ...(unprovable ? { status: "unprovable_today" as const } : {}),
    });
  }

  // ── Other constraints the model proposed ──
  const handled = new Set(["company_profile.locations", "stage", "geography", "location", "locations",
    "company_type", "company_types", "industry", "industries", "vertical", "verticals"]);
  for (const [field, raw] of Object.entries(mission.hard_constraints ?? {})) {
    if (handled.has(field)) continue;
    if (restatesHiringSignal(field, raw, mission.required_signals ?? [])) continue;
    if (restatesFundingWindow(field, raw, mission.required_signals ?? [])) continue;
    if (restatesEmployeeBound(field, raw, cp.employee_range)) continue;
    const c = (raw ?? {}) as { operator?: string; value?: unknown; reason?: string };
    const value = c.value ?? raw;
    const values = Array.isArray(value) ? value.map(String) : [String(value ?? "")];
    const stated = values.some(inQuery);
    const excluding = /not|exclud/i.test(String(c.operator ?? ""));
    // AN AUDIENCE THE MODEL MARKED HARD IS STILL DECIDED BY THE USER'S WORDS. "B2B" in
    // hard_constraints is the model's reading, not the request's; an exclusion of an
    // audience the request already excludes (compiled above) is not added twice.
    const audiences = values.map(audienceDescriptor);
    if (values.length && audiences.every((a) => a !== null)) {
      if (excluding && audiences.every((a) => out.some((x) => x.dimension === "exclusion" &&
        ((x.value as { value?: unknown[] })?.value ?? []).some((e) => audienceDescriptor(e) === a)))) continue;
      if (!excluding && values.every((v) => audienceCriterion(v, "proposed as a hard constraint") ||
        out.some((x) => x.dimension === "business_model" && audienceDescriptor(x.value) === audienceDescriptor(v)))) continue;
    }
    // A HARD `constraint` IS A REQUIREMENT NO EVIDENCE DIMENSION ANSWERS. It used
    // to compile as status "ok", so the approval card called it provable, the
    // interpretation gate passed it, and every candidate stayed unknown on it
    // with no route — the shape that held canary session 2 at zero. Marked
    // `unprovable_today` like every other requirement no source establishes:
    // disclosed at approval (`assessRequestFeasibility`), answerable only by the
    // evaluator citing the company's own words, and never silently "ok".
    const unprovable = stated && !excluding;
    push({
      kind: stated || excluding ? "hard" : "target",
      dimension: excluding ? "exclusion" : "constraint", value: { field, value },
      label: `${excluding ? "Excluding" : field.replace(/[._]/g, " ")}: ${values.join(", ")}`,
      source: stated ? "user_explicit" : "user_inferred",
      elevated_by: excluding ? "excluding" : null,
      user_phrase: stated ? values.find(inQuery) ?? "" : "",
      rationale: stated ? "stated in the request"
        : "proposed by the model without the request's words; never a hard requirement",
      ...(unprovable ? { status: "unprovable_today" as const } : {}),
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
    // S4 (NL2): a v3 mission's necessity is the model's validated reading of the user's
    // words, however indirect ("looking to bring on…", "need sales ppl"), not a cue word.
    const uSig = understandingSignal(U, k);
    const source: CriterionSource = uSig || userKinds.has(k) || cueStated ? "user_explicit" : "user_inferred";
    const asserted = uSig
      ? uSig.necessity === "required" && k !== "funding" && !elevated
      : !elevated && statedHiringRequirement(k, source, query);
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
        // Contract v2: the validated window IS the user's, even in a form the
        // reader cannot read ("within 6 months").
        sem?.stated_windows?.funding ??
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
      kind: uSig?.necessity === "preferred" ? "target"
        : elevated || fundingWindow || fundingRecency || calendar || fundingPresence || asserted ? "hard" : "target",
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
  // ── CROSS-SIGNAL OR (Q3, Codex routing audit C02) ──
  //
  // "hiring Account Executives OR having raised funding" is ONE requirement
  // either signal satisfies. Read as two, it rejected every company that had
  // only one of them. The mandatory signal criteria the request joins by "or"
  // carry the same `any_of` (`signal:<kind>`), and `anyOfGroupKey` makes them
  // one group wherever a decision is made. AND keeps them two requirements; a
  // member the request hedged is not part of the requirement at all.
  // S4: a v3 mission's AND/OR is the model's validated `signal_logic` (D3: "hiring OR
  // expansion" lost its OR because "expansion" has no cue word here).
  const signalGroups = U
    ? (U.signal_logic === "any"
      ? [[...new Set(out.filter((c) => c.kind === "hard" && U.signals.some((x) => x.necessity === "required" && x.kind === c.dimension))
        .map((c) => c.dimension as CanonicalSignalKind))]]
      : [])
    : crossSignalAlternatives(query,
      out.filter((c) => c.kind === "hard" && SIGNAL_CUE[c.dimension as CanonicalSignalKind]).map((c) => c.dimension as CanonicalSignalKind));
  for (const group of signalGroups) {
    const members = out.filter((c) => c.kind === "hard" && group.includes(c.dimension as CanonicalSignalKind));
    if (new Set(members.map((c) => c.dimension)).size < 2) continue;
    const anyOf = group.map((k) => `signal:${k}`);
    for (const c of members) c.any_of = anyOf;
  }
  return out;
}

/**
 * The signal kinds a request joins by "or", in groups ("hiring … OR raised
 * funding" → [["hiring", "funding"]]). Two kinds are alternatives when the text
 * between the cue of one and the cue of the next says "or" and not "and": a
 * conjunction of the request's own, read only between signals it actually
 * states. One kind's alternatives ("Series A or Series B") are its own any_of.
 */
export function crossSignalAlternatives(query: string, kinds: readonly CanonicalSignalKind[]): CanonicalSignalKind[][] {
  const t = query.toLowerCase();
  const hits = [...new Set(kinds)].flatMap((k) => {
    const cue = SIGNAL_CUE[k];
    return cue ? [...t.matchAll(new RegExp(cue.source, "g"))].map((m) => ({ k, start: m.index!, end: m.index! + m[0].length })) : [];
  }).sort((a, b) => a.start - b.start);
  const parent = new Map<CanonicalSignalKind, CanonicalSignalKind>();
  const find = (k: CanonicalSignalKind): CanonicalSignalKind => (parent.get(k) ?? k) === k ? k : find(parent.get(k)!);
  const joined = new Set<CanonicalSignalKind>();
  for (let i = 0; i + 1 < hits.length; i++) {
    const a = hits[i], b = hits[i + 1];
    if (a.k === b.k || b.start < a.end) continue;
    const between = t.slice(a.end, b.start);
    if (!/\bor\b/.test(between) || /\band\b|\bas well as\b|\bplus\b/.test(between)) continue;
    parent.set(find(b.k), find(a.k));
    joined.add(a.k).add(b.k);
  }
  const groups = new Map<CanonicalSignalKind, CanonicalSignalKind[]>();
  for (const k of joined) groups.set(find(k), [...(groups.get(find(k)) ?? []), k]);
  return [...groups.values()].map((g) => g.sort());
}

/**
 * The ONE key that makes hard criteria a single any-of requirement, used by
 * every decision (eligibility and the evaluator's verdict): alternatives of one
 * dimension ("AI or developer-tools") group within it; cross-signal
 * alternatives (`signal:<kind>`) group across dimensions. Null: an ordinary AND.
 */
export function anyOfGroupKey(c: Pick<MissionCriterion, "kind" | "dimension" | "any_of">): string | null {
  if (c.kind !== "hard" || (c.any_of?.length ?? 0) < 2) return null;
  const sorted = [...c.any_of!].sort().join("|");
  return c.any_of!.every((a) => a.startsWith("signal:")) ? `signals|${sorted}` : `${c.dimension}|${sorted}`;
}

/** The understanding's statement about one signal kind (S4), when the mission has one. */
function understandingSignal(u: ValidatedUnderstanding | null, kind: string) {
  if (!u) return null;
  const k = kind === "headcount_growth" ? ["headcount_growth"] : [kind];
  return u.signals.find((s) => k.includes(s.kind)) ?? null;
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
 *
 * `targetNote` lets a caller that knows the PLAN say what a target also does
 * there — the card uses it for a Company Brain industry that chooses the
 * discovery population (missionConfirmationCard.ts). Criteria alone cannot
 * know that: it depends on which providers the graph reaches.
 *
 * THE SOURCE IS ALWAYS THE LAST PART OF A LINE. Lines read
 * `<label> · <qualifiers…> · <source>`, and card readers split on " · " and
 * take the source from the end to tell what the person asked for from what was
 * added. So a note goes BEFORE the source, never after it — appended after,
 * the line had no recognisable source and a Brain industry read as neither the
 * person's nor added.
 */
export function criteriaSections(
  mission: LeadMissionV1, extraUnsupported: readonly string[] = [],
  opts: { targetNote?: (c: MissionCriterion) => string | null } = {},
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
    else {
      const note = opts.targetNote?.(c);
      add(sections.target, `${c.label}${note ? ` · ${note}` : ""} · ${sourceSuffix(c)}`);
    }
    if (c.time_window) {
      const w = c.time_window;
      const how = w.source === "system_default" ? `default for "${w.rule ?? "recent"}"`
        : w.source === "user_explicit" ? "you said this" : "inferred";
      add(sections.time_windows,
        `${SIGNAL_LABEL[c.dimension as CanonicalSignalKind] ?? c.label}: last ${w.days} days · ${how}`);
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
