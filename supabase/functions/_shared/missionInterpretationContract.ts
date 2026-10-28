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
// means hiring (no window) AND funding (180 days). In v1 the model must either
// drop the 180 or put it on both signals — and the compiler then tries to
// recover which signal a window belongs to with a regex over the sentence
// (`statedHiringWindowDays`, review R1), which reads "funding closed within 6
// months" and "who joined within 90 days" as HIRING windows.
//
// The Chat Brain path already carries a window per requirement
// (`projectToLeadMission` → `signalRecencyByEvent`, RC06). The direct mission
// path did not. v2 gives it the same shape:
//
//   signal_windows: [{ event: "funding", days: 180, phrase: "within the last six months" }]
//
// ── WHO DECIDES WHAT ─────────────────────────────────────────────────────────
//
//   THE MODEL  says which signal a timeframe belongs to (semantics), and quotes
//              the user's words for it.
//   CODE       checks the quote is in the request, computes the days from it
//              (date arithmetic is never a model's job), and refuses a window
//              on the company's age ("founded in the last 3 years") as a
//              signal's. A signal with no entry carries NO window — never a
//              default, never another signal's.
//
// Nothing is rewritten silently: every applied, corrected or refused window is
// a `validator_changes` entry and an `interpretation_trace` row.
//
// ── OFF BY DEFAULT ──────────────────────────────────────────────────────────
//
// AGENTORY_MISSION_CONTRACT=v2 turns it on. Unset, the mission compiler, its
// schema, its prompt and every compiled mission are byte-identical to v1 — the
// agency-only A7 TEST and its I1–I9 gate run on v1.
//
// PURE apart from `activeMissionContract`'s one environment read.

import { explicitWindowDays } from "./signalKinds.ts";
import { SIGNAL_EVENTS } from "./missionSignalDescriptor.ts";

export const MISSION_CONTRACT_ENV = "AGENTORY_MISSION_CONTRACT";
export type MissionContractVersion = "v1" | "v2";

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
}

/** The structured-output property v2 adds to the mission proposal. */
export const SIGNAL_WINDOWS_PROPERTY = {
  type: "array",
  description:
    "One entry for EACH signal whose timeframe the request states, and only those. " +
    "`event` is the signal the timeframe belongs to; `phrase` is the user's exact words " +
    "for that timeframe, copied from the request; `days` is your reading of it. " +
    "A signal with no stated timeframe gets NO entry. Never copy one signal's " +
    "timeframe onto another, and a company's age ('founded in the last 3 years') is " +
    "not a signal timeframe.",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["event", "days", "phrase"],
    properties: {
      event: { type: "string", enum: [...SIGNAL_EVENTS] },
      days: { type: ["integer", "null"] },
      phrase: { type: "string" },
    },
  },
} as const;

/** The instruction lines v2 adds to the mission compiler prompt. */
export const SIGNAL_WINDOWS_INSTRUCTION =
  "Timeframes belong to signals, one by one: put each stated timeframe in 'signal_windows' " +
  "under the signal it qualifies, quoting the user's words. 'Hiring AEs whose funding closed " +
  "within six months' is a funding window of 180 days and NO hiring window. Leave " +
  "'signal_recency_days' null; it is not read when 'signal_windows' is present.";

/** Read the model's `signal_windows`, keeping only well-formed entries. */
export function parseSignalWindows(raw: unknown): ProposedSignalWindow[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ProposedSignalWindow[] = [];
  for (const w of raw.slice(0, 12)) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    const event = String(o.event ?? "").trim().toLowerCase();
    const phrase = String(o.phrase ?? "").trim().slice(0, 160);
    const n = Number(o.days);
    out.push({ event, phrase, days: o.days == null || !Number.isFinite(n) ? null : Math.trunc(n) });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();

/**
 * The days a timeframe phrase states, computed by code, or null when the
 * phrase states no countable window ("recently", "this quarter").
 */
export function windowDaysOfPhrase(phrase: string): number | null {
  const p = norm(phrase)
    // "less than 30 days ago", "under 2 weeks ago", "no more than 6 months old"
    .replace(/\b(?:less than|under|no more than|at most|up to)\s+(.+?)\s+(?:ago|old)\b/g, "in the last $1")
    // "within 30 days", "in six months" name the same window as "within the last …".
    .replace(/\b(within|in|over|during)\s+(?!the\b)(?=(?:\d|a\b|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|ninety))/g,
      "$1 the last ");
  return explicitWindowDays(p);
}

export interface SignalWindowTrace {
  event: string;
  phrase: string;
  proposed_days: number | null;
  /** What the runtime signal will carry. */
  applied_days: number | null;
  status: "applied" | "applied_days_from_phrase" | "applied_unparsed_phrase" | "refused";
  reason: string;
}

export interface ValidatedSignalWindows {
  /** event → days, for `signalRecencyByEvent`. An event absent here carries no window. */
  byEvent: Record<string, number>;
  trace: SignalWindowTrace[];
  changes: string[];
}

const MAX_WINDOW_DAYS = 3650;
const COMPANY_AGE_BEFORE = /\b(?:founded|established|incorporated|formed|started|launched in)\s*$/;

/**
 * Check every proposed window against the request and turn the survivors into
 * per-event days. Never invents a window and never moves one between signals.
 */
export function validateSignalWindows(
  query: string, proposed: readonly ProposedSignalWindow[],
): ValidatedSignalWindows {
  const q = norm(query);
  const byEvent: Record<string, number> = {};
  const trace: SignalWindowTrace[] = [];
  const changes: string[] = [];
  const refuse = (w: ProposedSignalWindow, reason: string) => {
    trace.push({ event: w.event, phrase: w.phrase, proposed_days: w.days, applied_days: null, status: "refused", reason });
    changes.push(`signal_window_refused:${w.event}:${reason}`);
  };
  for (const w of proposed) {
    if (!(SIGNAL_EVENTS as readonly string[]).includes(w.event)) { refuse(w, "unknown_event"); continue; }
    const phrase = norm(w.phrase);
    const at = phrase ? q.indexOf(phrase) : -1;
    // A timeframe the request does not contain is the model's, not the user's.
    if (at < 0) { refuse(w, "phrase_not_in_request"); continue; }
    if (COMPANY_AGE_BEFORE.test(q.slice(0, at))) { refuse(w, "company_age_not_a_signal_window"); continue; }
    const parsed = windowDaysOfPhrase(phrase);
    let days: number;
    let status: SignalWindowTrace["status"];
    let reason: string;
    if (parsed != null) {
      days = parsed;
      status = w.days === parsed ? "applied" : "applied_days_from_phrase";
      reason = w.days === parsed ? "phrase and days agree" : `model read ${w.days ?? "no number"}; the phrase states ${parsed}`;
    } else if (w.days != null && w.days > 0) {
      // The quote is the user's and names a window code cannot count ("this
      // quarter"). The model's reading stands, marked as unverified arithmetic.
      days = w.days;
      status = "applied_unparsed_phrase";
      reason = "phrase is in the request but states no countable window; the model's days are used";
    } else { refuse(w, "no_countable_window"); continue; }
    if (!(days > 0) || days > MAX_WINDOW_DAYS) { refuse(w, "out_of_range"); continue; }
    if (byEvent[w.event] != null && byEvent[w.event] !== days) {
      // Two different windows for one event: the narrower one is the stricter
      // reading of the user's words, and the conflict is recorded.
      changes.push(`signal_window_conflict:${w.event}:${byEvent[w.event]}|${days}`);
      days = Math.min(days, byEvent[w.event]);
    }
    byEvent[w.event] = days;
    trace.push({ event: w.event, phrase: w.phrase, proposed_days: w.days, applied_days: days, status, reason });
    changes.push(`signal_window_${status}:${w.event}=${days}`);
  }
  return { byEvent, trace, changes };
}
