// MISSION INTERPRETATION CONTRACT v2 — EACH SIGNAL'S OWN TIMEFRAME, IN THE
// USER'S OWN WORDS, CHECKED BY CODE.
//
// ── THE DEFECT CLASS THIS CLOSES ─────────────────────────────────────────────
//
// The mission proposal (contract v1) has ONE timeframe field,
// `signal_recency_days`, and the compiler stamps it on every signal. A request
// with two signals and one window cannot be written down in it:
//
//   "Find companies hiring Account Executives whose funding closed within the
//    last six months."
//
// means hiring (no window) AND funding (180 days). v2 lets the model say so:
//
//   signal_windows: [{ event: "funding", days: 180, phrase: "within the last six months", signal: null }]
//
// ── WHO DECIDES WHAT ─────────────────────────────────────────────────────────
//
//   THE MODEL  attributes each timeframe to a signal (semantics) and quotes the
//              user's words for it.
//   CODE       checks the quote is in the request and IS a time expression,
//              reads its direction (past / future / older-than / negated),
//              computes the days, caps them at the compiler's 730-day limit,
//              and checks that EVERY timeframe the request states is accounted
//              for. The compiler's deterministic sentence reader stays an
//              independent check (`missionCriteria`): where it reads a window
//              the model omitted, its reading is kept; where the two disagree,
//              the compile fails closed. Only the review-R1 hiring regex is
//              consulted for the record alone.
//
// Nothing is rewritten silently: every applied, corrected or refused window is
// a `validator_changes` entry, and the compiled result carries a trace built
// from the FINAL runtime signals.
//
// ── OFF BY DEFAULT ──────────────────────────────────────────────────────────
//
// AGENTORY_MISSION_CONTRACT=v2 turns it on, and the compiler reads
// `signal_windows` ONLY then. Unset, the schema, the prompt and every compiled
// mission are byte-identical to v1.
//
// PURE apart from `activeMissionContract`'s one environment read and the clock
// read by calendar windows ("this quarter").

import { canonicalWindowDays } from "./signalKinds.ts";
import { SIGNAL_EVENTS } from "./missionSignalDescriptor.ts";
import { calendarWindow } from "./missionCriteria.ts";

export const MISSION_CONTRACT_ENV = "AGENTORY_MISSION_CONTRACT";
export type MissionContractVersion = "v1" | "v2";
/** The compiler's existing ceiling on a signal window (`MAX_SIGNAL_RECENCY_DAYS`). */
export const MAX_CONTRACT_WINDOW_DAYS = 730;

export function activeMissionContract(
  read: (k: string) => string | undefined = (k) => {
    try { return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k); }
    catch { return undefined; }
  },
): MissionContractVersion {
  return String(read(MISSION_CONTRACT_ENV) ?? "").trim().toLowerCase() === "v2" ? "v2" : "v1";
}

/** One timeframe the model attributed to one signal. */
export interface ProposedSignalWindow {
  event: string;
  days: number | null;
  /** The user's own words for the timeframe, verbatim. */
  phrase: string;
  /**
   * The `preferred_signals` phrase this window qualifies, when two signals of
   * one event carry different windows ("AEs in the last 2 weeks, SDRs in the
   * last 90 days"). Null when the event has one window.
   */
  signal: string | null;
}

/** The structured-output property v2 adds to the mission proposal. */
export const SIGNAL_WINDOWS_PROPERTY = {
  type: "array",
  description:
    "One entry for EACH signal whose timeframe the request states, and only those. " +
    "`event` is the signal the timeframe belongs to; `phrase` is the user's exact words " +
    "for that timeframe, copied from the request; `days` is your reading of it; `signal` is " +
    "the preferred_signals entry it qualifies when two signals of the same event have " +
    "different timeframes, otherwise null. A signal with no stated timeframe gets NO entry. " +
    "Never copy one signal's timeframe onto another; a company's age ('founded in the last 3 " +
    "years'), a future date and an 'older than' condition are not signal timeframes.",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["event", "days", "phrase", "signal"],
    properties: {
      event: { type: "string", enum: [...SIGNAL_EVENTS] },
      days: { type: ["integer", "null"] },
      phrase: { type: "string" },
      signal: { type: ["string", "null"] },
    },
  },
} as const;

/** The instruction lines v2 adds to the mission compiler prompt. */
export const SIGNAL_WINDOWS_INSTRUCTION =
  "Timeframes belong to signals, one by one: put each stated timeframe in 'signal_windows' " +
  "under the signal it qualifies, quoting the user's words. 'Hiring AEs whose funding closed " +
  "within six months' is a funding window of 180 days and NO hiring window. Every timeframe " +
  "the request states must be accounted for. Leave 'signal_recency_days' null: a value that " +
  "disagrees with 'signal_windows' makes the request uncompilable.";

/** Read the model's `signal_windows`, keeping only well-formed entries. */
export function parseSignalWindows(raw: unknown): ProposedSignalWindow[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ProposedSignalWindow[] = [];
  for (const w of raw.slice(0, 12)) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    const n = Number(o.days);
    const signal = typeof o.signal === "string" && o.signal.trim() ? o.signal.trim().slice(0, 200) : null;
    out.push({
      event: String(o.event ?? "").trim().toLowerCase(),
      phrase: String(o.phrase ?? "").trim().slice(0, 160),
      days: o.days == null || !Number.isFinite(n) ? null : Math.trunc(n),
      signal,
    });
  }
  return out;
}

// ── TIME EXPRESSIONS ─────────────────────────────────────────────────────────

const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const COUNT = String.raw`\d{1,4}|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](?:one|two|three|four|five|six|seven|eight|nine)|${Object.keys(NUMBER_WORDS).join("|")}`;
const UNIT = String.raw`day|week|month|quarter|year`;
const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, quarter: 90, year: 365 };
const PRE = String.raw`within|in|over|during|for|from|since`;
const DIRECTION = String.raw`last|past|previous|prior|recent|next|coming|upcoming|following|this`;
const COMPARE = String.raw`less than|fewer than|under|no more than|at most|up to|more than|over|at least|older than|newer than|younger than`;

/**
 * Every time expression in a text, with its span. Both the quote validator and
 * the completeness check read through this one matcher, so "is this a time
 * expression" has a single answer.
 */
const EXPR_RE = new RegExp(
  // Calendar spans first, so "year to date" is not read as a bare "year".
  String.raw`\b(?:year|quarter|month|week)[- ]to[- ]date\b|\b(?:ytd|qtd|mtd)\b` +
  String.raw`|\b(?:(?:${PRE})\s+)?(?:the\s+)?(?:(?:${DIRECTION})\s+)?(?:(?:${COMPARE})\s+)?(?:(${COUNT})\s+)?(${UNIT})s?(?:\s+(ago|old|from now|out))?\b`,
  "g",
);

export interface TimeExpression { text: string; index: number; end: number }

export function timeExpressionsIn(text: string): TimeExpression[] {
  const t = norm(text);
  const out: TimeExpression[] = [];
  for (const m of t.matchAll(EXPR_RE)) {
    const s = m[0].trim();
    // A bare unit word with no count, direction or calendar word is not a
    // window ("annual revenue", "per month", "day one"); "within a year" is.
    const counted = /\d/.test(s) ||
      new RegExp(String.raw`\b(?:${Object.keys(NUMBER_WORDS).filter((w) => w !== "a" && w !== "an").join("|")})\b`).test(s) ||
      /^(?:within|in|over|during)\s+(?:the\s+)?(?:(?:last|past)\s+)?an?\s/.test(s);
    if (!counted && !/\b(?:last|past|previous|prior|recent|next|coming|upcoming|this|ago|from now|to[- ]date|ytd|qtd|mtd)\b/.test(s)) continue;
    // A rate is not a window: "7 days a week", "two days per month".
    if (/^\s*(?:a|an|per|each|every)\s+(?:day|week|month|quarter|year)\b/.test(t.slice(m.index! + m[0].length))) continue;
    out.push({ text: s, index: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

export type TimeframeReading =
  | { kind: "past"; days: number }
  | { kind: "refused"; reason: "no_time_expression" | "future" | "older_than" | "ambiguous_direction" | "negated" | "multiple_expressions" };

function countOf(raw: string | undefined): number {
  if (!raw) return 1;
  if (/^\d+$/.test(raw)) return Number(raw);
  const [tens, unit] = raw.split(/[- ]/);
  return (NUMBER_WORDS[tens] ?? 0) + (unit ? NUMBER_WORDS[unit] ?? 0 : 0);
}

/**
 * Read one timeframe phrase. A window is a PAST span ending now ("in the last
 * 90 days", "within 30 days", "less than 2 weeks ago", "this quarter"). A
 * future span, an older-than condition, a negated span and a bare point in
 * time are not windows a signal can carry, and are refused rather than turned
 * into one — "over 90 days ago" means OLDER than 90 days.
 */
export function readTimeframePhrase(phrase: string, now: Date = new Date()): TimeframeReading {
  const p = norm(phrase);
  const exprs = timeExpressionsIn(p);
  if (exprs.length === 0) return { kind: "refused", reason: "no_time_expression" };
  if (exprs.length > 1) return { kind: "refused", reason: "multiple_expressions" };
  if (/\b(?:not|never|no|without|excluding|except)\b|n't\b/.test(p)) return { kind: "refused", reason: "negated" };
  const e = exprs[0].text;
  if (/\b(?:next|coming|upcoming|following)\b|\bfrom now\b|\bout\b/.test(e)) return { kind: "refused", reason: "future" };
  if (/\b(?:more than|over|at least|older than)\b[^]*\b(?:ago|old)\b/.test(e) || /\bolder than\b/.test(e)) {
    return { kind: "refused", reason: "older_than" };
  }
  // Calendar spans ("this quarter", "year to date"), computed now.
  const cal = /\bthis\s+(week|month|quarter|year)\b|\b(year|quarter|month|week)[- ]to[- ]date\b|\b(ytd|qtd|mtd)\b/.exec(e);
  // "this quarter" is matched as direction-less "quarter" plus a calendar word.
  if (cal) {
    const c = calendarWindow(`funded ${e}`, now);
    return c ? { kind: "past", days: c.days } : { kind: "refused", reason: "ambiguous_direction" };
  }
  const m = new RegExp(String.raw`(?:(${COUNT})\s+)?(${UNIT})s?`).exec(e.replace(/^(?:the|a)\s+/, ""));
  if (!m) return { kind: "refused", reason: "no_time_expression" };
  const n = countOf(m[1]);
  const unit = m[2];
  const raw = unit === "month" && n % 12 === 0 ? (n / 12) * 365 : n * UNIT_DAYS[unit];
  const days = canonicalWindowDays(raw);
  if (!(days > 0)) return { kind: "refused", reason: "no_time_expression" };
  const past =
    /\b(?:last|past|previous|prior|recent)\b/.test(e) ||                                   // "the last 90 days", "past six months"
    /^(?:within)\b/.test(e) ||                                                            // "within 30 days" (a window ending now)
    /\b(?:less than|fewer than|under|no more than|at most|up to|newer than|younger than)\b[^]*\b(?:ago|old)\b/.test(e);
  if (past) return { kind: "past", days };
  // "in 6 months", "for 30 days", "30 days ago", "since 90 days": no direction a window can take.
  return { kind: "refused", reason: "ambiguous_direction" };
}

/** Days for a timeframe phrase, or null when it is not a past window. */
export function windowDaysOfPhrase(phrase: string): number | null {
  const r = readTimeframePhrase(phrase);
  return r.kind === "past" ? r.days : null;
}

// ── VALIDATION ───────────────────────────────────────────────────────────────

export interface SignalWindowDecision {
  event: string;
  phrase: string;
  signal: string | null;
  proposed_days: number | null;
  /** The days code computed from the user's words, after the 730-day cap. Null when refused. */
  days: number | null;
  status: "accepted" | "accepted_days_from_phrase" | "accepted_capped" | "refused";
  reason: string;
}

export interface ValidatedSignalWindows {
  /** kind-agnostic: event → days, for events with exactly one window. */
  byEvent: Record<string, number>;
  /** event → [{ signal phrase, days }], for events whose signals carry different windows. */
  perSignal: Record<string, Array<{ signal: string; days: number }>>;
  decisions: SignalWindowDecision[];
  changes: string[];
  /** Fail-closed problems: the compile must not proceed with these. */
  conflicts: string[];
}

const COMPANY_AGE_BEFORE = /\b(?:founded|established|incorporated|formed|started|launched|created)\s+(?:in\s+|within\s+|during\s+|over\s+)?$/;
const NEGATION_BEFORE = /\b(?:not|never|no|without|excluding|except|other than|haven't|hasn't|hadn't|didn't|don't|doesn't|isn't|aren't|wasn't|weren't)\b(?:\s+\S+){0,5}\s*$/;

/** A PERSON's tenure ("Account Executives who joined within 90 days"), not a company signal (review R1). */
const PERSON_TENURE_BEFORE = /\bwho\s+(?:recently\s+|have\s+|has\s+)?joined\s+(?:in\s+|within\s+|during\s+|over\s+)?$/;

/** Is the expression at `index` in `q` a company-age or tenure window, or negated by its own clause? */
function contextOf(q: string, index: number): "company_age" | "person_tenure" | "negated" | null {
  const before = q.slice(Math.max(0, index - 80), index);
  const clause = before.split(/[,;.]|\b(?:and|but|or|while|whose|who|that|which)\b/).pop() ?? "";
  if (COMPANY_AGE_BEFORE.test(clause)) return "company_age";
  if (PERSON_TENURE_BEFORE.test(before)) return "person_tenure";
  if (NEGATION_BEFORE.test(clause)) return "negated";
  return null;
}

/**
 * Check every proposed window against the request and turn the survivors into
 * per-event (or per-signal) days. Never invents a window, never moves one
 * between signals, never collapses two different windows into one.
 */
export function validateSignalWindows(
  query: string, proposed: readonly ProposedSignalWindow[], now: Date = new Date(),
): ValidatedSignalWindows {
  const q = norm(query);
  const decisions: SignalWindowDecision[] = [];
  const changes: string[] = [];
  const conflicts: string[] = [];
  const refuse = (w: ProposedSignalWindow, reason: string) => {
    decisions.push({ event: w.event, phrase: w.phrase, signal: w.signal, proposed_days: w.days, days: null, status: "refused", reason });
    changes.push(`signal_window_refused:${w.event}:${reason}`);
  };
  for (const w of proposed) {
    if (!(SIGNAL_EVENTS as readonly string[]).includes(w.event)) { refuse(w, "unknown_event"); continue; }
    const phrase = norm(w.phrase);
    const at = phrase ? q.indexOf(phrase) : -1;
    // A timeframe the request does not contain is the model's, not the user's.
    if (at < 0) { refuse(w, "phrase_not_in_request"); continue; }
    const ctx = contextOf(q, at);
    if (ctx === "company_age") { refuse(w, "company_age_not_a_signal_window"); continue; }
    if (ctx === "person_tenure") { refuse(w, "person_tenure_not_a_signal_window"); continue; }
    if (ctx === "negated") { refuse(w, "negated"); conflicts.push(`signal_window_unrepresentable:${w.event}:negated:${phrase}`); continue; }
    const r = readTimeframePhrase(phrase, now);
    if (r.kind === "refused") {
      refuse(w, r.reason);
      // A quote with no time in it is the model's mistake, refused and
      // harmless: the audit still checks the request's real expressions. A
      // future, older-than, negated or undirected timeframe IS the user's, and
      // no runtime window can carry it: dropping it would widen the mission.
      if (r.reason !== "no_time_expression") conflicts.push(`signal_window_unrepresentable:${w.event}:${r.reason}:${phrase}`);
      continue;
    }
    let days = r.days;
    let status: SignalWindowDecision["status"] = w.days === days ? "accepted" : "accepted_days_from_phrase";
    let reason = w.days === days ? "phrase and days agree" : `model read ${w.days ?? "no number"}; the phrase states ${days}`;
    if (days > MAX_CONTRACT_WINDOW_DAYS) {
      changes.push(`signal_window_capped:${w.event}:${days}->${MAX_CONTRACT_WINDOW_DAYS}`);
      reason = `the phrase states ${days}; capped at the compiler's ${MAX_CONTRACT_WINDOW_DAYS}-day limit`;
      days = MAX_CONTRACT_WINDOW_DAYS;
      status = "accepted_capped";
    }
    decisions.push({ event: w.event, phrase: w.phrase, signal: w.signal, proposed_days: w.days, days, status, reason });
    changes.push(`signal_window_${status}:${w.event}=${days}`);
  }
  const byEvent: Record<string, number> = {};
  const perSignal: Record<string, Array<{ signal: string; days: number }>> = {};
  const accepted = decisions.filter((d) => d.days != null);
  for (const event of new Set(accepted.map((d) => d.event))) {
    const ds = accepted.filter((d) => d.event === event);
    const distinct = new Set(ds.map((d) => d.days));
    if (distinct.size === 1) { byEvent[event] = ds[0].days!; continue; }
    // Two windows for one event are two requirements only when each names the
    // signal it qualifies. Otherwise which signal gets which is a guess: refuse.
    if (ds.every((d) => d.signal) && new Set(ds.map((d) => norm(d.signal!))).size === ds.length) {
      perSignal[event] = ds.map((d) => ({ signal: d.signal!, days: d.days! }));
    } else {
      conflicts.push(`signal_window_ambiguous:${event}:${[...distinct].join("|")}`);
    }
  }
  return { byEvent, perSignal, decisions, changes, conflicts };
}

/**
 * EVERY TIMEFRAME THE REQUEST STATES MUST BE ACCOUNTED FOR.
 *
 * The model can omit a window it should have attributed (the A7 sentence with
 * no `signal_windows`), and an omission is invisible to quote validation. So
 * each PAST time expression in the request must be either quoted by a proposed
 * window (accepted or deliberately refused), a company-age window, or a window
 * the deterministic reader itself carried onto a signal. A past expression
 * nobody owns is `unaccounted`. A NEGATED one ("have not raised funding in the
 * last 90 days") states an exclusion no signal can carry, and is reported as
 * such. Both fail the compile closed. Expressions with no direction ("7 days")
 * are listed, not enforced.
 */
export function timeframeAudit(
  query: string, proposed: readonly ProposedSignalWindow[], readerDays: readonly number[],
): { unaccounted: string[]; negated: string[]; undirected: string[] } {
  const q = norm(query);
  // Only a quote that itself states a time can account for one, and only for
  // the expression it CONTAINS: "days" or "posting" quoted beside "within 30
  // days" accounts for nothing (re-review of the corrected contract).
  const quoted = proposed.map((w) => norm(w.phrase)).filter((p) => p && timeExpressionsIn(p).length > 0)
    .map((p) => { const i = q.indexOf(p); return i < 0 ? null : { index: i, end: i + p.length }; })
    .filter((x): x is { index: number; end: number } => x !== null);
  const out = { unaccounted: [] as string[], negated: [] as string[], undirected: [] as string[] };
  for (const e of timeExpressionsIn(q)) {
    const ctx = contextOf(q, e.index);
    if (ctx === "company_age" || ctx === "person_tenure") continue;
    if (ctx === "negated" || /\b(?:not|never|no|without)\b/.test(e.text)) { out.negated.push(e.text); continue; }
    if (quoted.some((s) => s.index <= e.index && e.end <= s.end)) continue;
    const r = readTimeframePhrase(e.text);
    if (r.kind === "refused") {
      if (r.reason === "ambiguous_direction") out.undirected.push(e.text);
      else out.unaccounted.push(e.text); // future / older-than nobody quoted
      continue;
    }
    if (readerDays.some((d) => d === Math.min(r.days, MAX_CONTRACT_WINDOW_DAYS) || d === r.days)) continue;
    out.unaccounted.push(e.text);
  }
  return out;
}
