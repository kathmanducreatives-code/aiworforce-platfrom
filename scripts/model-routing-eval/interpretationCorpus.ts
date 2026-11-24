// INTERPRETATION CORPUS — timeframes, signals and the compiler that carries them.
//
// ── WHAT THIS MEASURES, AND WHAT IT DOES NOT ────────────────────────────────
//
// Each case is a request plus a REFERENCE proposal: what a correct interpreter
// returns for it. The reference is SYNTHETIC — written here, not harvested from
// a model — and is labelled so. It is NOT a claim about what any model emits.
//
// It isolates the COMPILER. Given a correct proposal, does the compiled mission
// (the runtime `required_signals[].timeframe_days`, which the job filter reads)
// say what the user said? A failure here is a compiler error, whatever model
// runs in front of it.
//
// `model_errors` are deliberately wrong proposals. Each says whether CODE can
// detect it (`detectable: true`, and the expected refusal or correction) or
// whether only a better model or a human review can (`detectable: false`) —
// so a live comparison of models can tell a model error from a compiler error.
//
// Pure data and pure functions. No network, no model.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Window { event: string; days: number | null; phrase: string; signal?: string | null }

export interface InterpretationCase {
  id: string;
  provenance: "synthetic_reference" | "harvested";
  request: string;
  /** The proposal fields that differ from the neutral base below. */
  signals: string[];
  windows: Window[];
  /** What the runtime must carry: event → days (null = the event is required with no window). */
  expect: Record<string, number | null>;
  /** Under v2 the compile must be REFUSED before spend, with a reason matching this. */
  expect_refusal?: RegExp;
  probes: string;
  model_errors?: Array<{
    id: string;
    windows: Window[];
    detectable: boolean;
    /** For a detectable error: the runtime the compiler must still produce. */
    expect?: Record<string, number | null>;
    /** For a detectable error code cannot repair: the compile is refused with this reason. */
    expect_refusal?: RegExp;
    /** The validator_changes entry that proves code noticed. */
    expect_change?: RegExp;
    probes: string;
  }>;
}

export const INTERPRETATION_CORPUS: InterpretationCase[] = [
  {
    id: "T1-hiring-plus-funding-window",
    provenance: "synthetic_reference",
    request: "Find companies hiring Account Executives whose funding closed within the last six months.",
    signals: ["hiring Account Executives", "funding closed within the last six months"],
    windows: [{ event: "funding", days: 180, phrase: "within the last six months" }],
    expect: { hiring: null, funding: 180 },
    probes: "the review's example: six months qualifies funding only; no hiring window was stated",
    model_errors: [
      { id: "T1-E-window-on-hiring-too", detectable: true,
        windows: [{ event: "funding", days: 180, phrase: "within the last six months" }, { event: "hiring", days: 180, phrase: "within the last six months" }],
        expect_refusal: /window_conflict:hiring:contract=180:reader=none:reader_assigns_it_to=funding/,
        probes: "the funding phrase copied onto hiring (review R1's shape): the independent reader puts it on funding only, so the compile is refused" },
      { id: "T1-E-wrong-days", detectable: true,
        windows: [{ event: "funding", days: 30, phrase: "within the last six months" }],
        expect: { hiring: null, funding: 180 }, expect_change: /signal_window_accepted_days_from_phrase:funding=180/,
        probes: "the model mis-counted the user's words; code computes the days" },
      { id: "T1-E-invented-window", detectable: true,
        windows: [{ event: "funding", days: 180, phrase: "within the last six months" }, { event: "hiring", days: 30, phrase: "within the last 30 days" }],
        expect: { hiring: null, funding: 180 }, expect_change: /signal_window_refused:hiring:phrase_not_in_request/,
        probes: "a hiring window the request never states is refused" },
    ],
  },
  {
    id: "T2-a7-hiring-window",
    provenance: "harvested",
    request: "Find 1 US B2B software company with a current declared 11–50 employee band and an open Account Executive posting dated within 30 days.",
    signals: ["open Account Executive posting"],
    windows: [{ event: "hiring", days: 30, phrase: "within 30 days" }],
    expect: { hiring: 30 },
    probes: "the A7 TEST request (harvested); v2 must carry the same 30-day hiring window",
    model_errors: [
      { id: "T2-E-no-window", detectable: true, windows: [], expect_refusal: /timeframe_unaccounted:within 30 days/,
        probes: "the model omitted the stated window: the request's timeframe is unaccounted for, so the compile is refused (never compiled without the window)" },
      { id: "T2-E-quote-is-a-word", detectable: true, windows: [{ event: "hiring", days: 365, phrase: "posting" }],
        expect_refusal: /timeframe_unaccounted:within 30 days/,
        probes: "a quote with no time in it ('posting') is refused, and the real window is then unaccounted for" },
      { id: "T2-E-quote-is-a-unit", detectable: true,
        windows: [{ event: "hiring", days: 30, phrase: "within 30 days" }, { event: "hiring", days: 365, phrase: "days" }],
        expect: { hiring: 30 }, expect_change: /signal_window_refused:hiring:no_time_expression/,
        probes: "a bare unit ('days') is not a timeframe; the correct window beside it stands" },
      { id: "T2-E-quote-is-a-role", detectable: true, windows: [{ event: "hiring", days: 3650, phrase: "Account Executive" }],
        expect_refusal: /timeframe_unaccounted:within 30 days/,
        probes: "a role name quoted as a 10-year window is refused" },
    ],
  },
  {
    id: "T3-tenure-is-not-a-hiring-window",
    provenance: "synthetic_reference",
    request: "Find 5 US companies hiring Account Executives who joined within 90 days.",
    signals: ["hiring Account Executives"],
    windows: [],
    expect: { hiring: null },
    probes: "review R1: 'joined within 90 days' is a person's tenure, not the posting's age",
  },
  {
    id: "T4-company-age-is-not-a-signal-window",
    provenance: "synthetic_reference",
    request: "Find startups founded in the last 2 years hiring AEs within 60 days.",
    signals: ["hiring AEs"],
    windows: [{ event: "hiring", days: 60, phrase: "within 60 days" }],
    expect: { hiring: 60 },
    probes: "a company-age window beside a hiring window",
    model_errors: [
      { id: "T4-E-age-as-funding", detectable: true,
        windows: [{ event: "hiring", days: 60, phrase: "within 60 days" }, { event: "funding", days: 730, phrase: "in the last 2 years" }],
        expect: { hiring: 60 }, expect_change: /signal_window_refused:funding:company_age_not_a_signal_window/,
        probes: "the company's age filed as a funding window is refused" },
    ],
  },
  {
    id: "T5-funding-before-hiring",
    provenance: "synthetic_reference",
    request: "Find startups that raised funding in the last 90 days and are hiring SDRs.",
    signals: ["raised funding in the last 90 days", "hiring SDRs"],
    windows: [{ event: "funding", days: 90, phrase: "in the last 90 days" }],
    expect: { funding: 90, hiring: null },
    probes: "the window precedes the hiring clause and belongs to funding",
    model_errors: [
      { id: "T5-E-funding-window-omitted", detectable: true, windows: [],
        expect: { funding: 90, hiring: null }, expect_change: /window_from_reader_contract_omitted:funding:90d/,
        probes: "self-review defect 1: the model omits the funding window; the independent reader keeps it (hard, 90 days)" },
    ],
  },
  {
    id: "T6-two-windows-two-signals",
    provenance: "synthetic_reference",
    request: "Find companies hiring SDRs in the last 2 weeks that were funded within a year.",
    signals: ["hiring SDRs", "funded within a year"],
    windows: [{ event: "hiring", days: 14, phrase: "in the last 2 weeks" }, { event: "funding", days: 365, phrase: "within a year" }],
    expect: { hiring: 14, funding: 365 },
    probes: "v1 has one field for two windows and cannot express this",
    model_errors: [
      { id: "T6-E-windows-swapped", detectable: true,
        windows: [{ event: "hiring", days: 365, phrase: "within a year" }, { event: "funding", days: 14, phrase: "in the last 2 weeks" }],
        expect_refusal: /window_conflict:hiring:contract=365:reader=14/,
        probes: "both quotes are the user's and both counts are right; only the reader sees they are on the wrong signals" },
    ],
  },
  {
    id: "T7-post-window-not-hiring",
    provenance: "synthetic_reference",
    request: "Find companies hiring Account Executives whose CEO posted on LinkedIn about AI in the last week.",
    signals: ["hiring Account Executives", "CEO posted on LinkedIn about AI in the last week"],
    windows: [{ event: "post", days: 7, phrase: "in the last week" }],
    expect: { hiring: null },
    probes: "a post's window is not hiring's (the post signal itself is person-gated and checked elsewhere)",
  },
  {
    id: "T8-less-than-ago",
    provenance: "synthetic_reference",
    request: "Find companies with new Account Executive roles posted less than 30 days ago.",
    signals: ["new Account Executive roles posted"],
    windows: [{ event: "hiring", days: 30, phrase: "less than 30 days ago" }],
    expect: { hiring: 30 },
    probes: "'less than N days ago' is counted by code; MC-9: 'roles posted' compiles to a social-post signal, so no hiring signal carries the window",
    expect_refusal: /signal_missing_for_window:hiring/,
  },
  {
    id: "T9-recently-no-number",
    provenance: "synthetic_reference",
    request: "Find recently funded companies hiring Account Executives.",
    signals: ["recently funded", "hiring Account Executives"],
    windows: [],
    expect: { hiring: null },
    probes: "'recently' names no number: no contract window; the product's default rule for funding applies, hiring gets none",
  },
  {
    id: "T10-hiring-7-days",
    provenance: "synthetic_reference",
    request: "Find companies hiring Account Executives in the last 7 days.",
    signals: ["hiring Account Executives"],
    windows: [{ event: "hiring", days: 7, phrase: "in the last 7 days" }],
    expect: { hiring: 7 },
    probes: "a short hiring window",
    model_errors: [
      { id: "T10-E-hiring-window-omitted", detectable: true, windows: [],
        expect: { hiring: 7 }, expect_change: /window_from_reader_contract_omitted:hiring:7d/,
        probes: "self-review defect 1: the model omits the hiring window; the reader keeps it" },
    ],
  },
  {
    id: "T11-older-than",
    provenance: "synthetic_reference",
    request: "Find companies hiring Account Executives, posted over 90 days ago.",
    signals: ["hiring Account Executives"],
    windows: [{ event: "hiring", days: 90, phrase: "over 90 days ago" }],
    expect: {},
    expect_refusal: /signal_window_unrepresentable:hiring:older_than/,
    probes: "self-review defect 3: 'over 90 days ago' is OLDER than 90 days; no window can carry it, and reading it as 90 inverts it",
    model_errors: [
      { id: "T11-E-omitted", detectable: true, windows: [], expect_refusal: /timeframe_unaccounted:over 90 days ago/,
        probes: "omitting it does not make it go away" },
    ],
  },
  {
    id: "T12-negated-clause",
    provenance: "synthetic_reference",
    request: "Find companies hiring AEs that have not raised funding in the last 90 days.",
    signals: ["hiring AEs"],
    windows: [],
    expect: {},
    expect_refusal: /timeframe_negated:in the last 90 days/,
    probes: "an exclusion window: no positive signal window can carry it",
    model_errors: [
      { id: "T12-E-as-positive-window", detectable: true, windows: [{ event: "funding", days: 90, phrase: "in the last 90 days" }],
        expect_refusal: /signal_window_unrepresentable:funding:negated/,
        probes: "the negated window attributed as a positive funding window is refused" },
    ],
  },
  {
    id: "T13-negated-phrase",
    provenance: "synthetic_reference",
    request: "Find companies hiring AEs, but not in the last 90 days.",
    signals: ["hiring AEs"],
    windows: [{ event: "hiring", days: 90, phrase: "not in the last 90 days" }],
    expect: {},
    expect_refusal: /negated/,
    probes: "self-review defect 3: 'not in the last 90 days' was read as 90",
  },
  {
    id: "T14-future",
    provenance: "synthetic_reference",
    request: "Find companies that will be hiring AEs within the next 30 days.",
    signals: ["hiring AEs"],
    windows: [{ event: "hiring", days: 30, phrase: "within the next 30 days" }],
    expect: {},
    expect_refusal: /signal_window_unrepresentable:hiring:future/,
    probes: "a future window is not a posting age",
    model_errors: [
      { id: "T14-E-omitted", detectable: true, windows: [], expect_refusal: /timeframe_unaccounted:within the next 30 days/,
        probes: "omitting a future window is refused too" },
    ],
  },
  {
    id: "T15-per-signal-windows",
    provenance: "synthetic_reference",
    request: "Find companies hiring AEs in the last 2 weeks or SDRs in the last 90 days.",
    signals: ["hiring AEs", "hiring SDRs"],
    windows: [
      { event: "hiring", days: 14, phrase: "in the last 2 weeks", signal: "hiring AEs" },
      { event: "hiring", days: 90, phrase: "in the last 90 days", signal: "hiring SDRs" },
    ],
    expect: {},
    expect_refusal: /per_signal_windows_not_enforced_at_runtime:hiring/,
    probes: "self-review defect 8: two hiring windows; the runtime job filter enforces the shortest on every posting, so the compile is refused rather than collapsed",
    model_errors: [
      { id: "T15-E-no-signal-named", detectable: true,
        windows: [{ event: "hiring", days: 14, phrase: "in the last 2 weeks" }, { event: "hiring", days: 90, phrase: "in the last 90 days" }],
        expect_refusal: /signal_window_ambiguous:hiring:14\|90/,
        probes: "two windows for one event that do not say which signal each qualifies" },
    ],
  },
  {
    id: "T16-long-window-capped",
    provenance: "synthetic_reference",
    request: "Find companies hiring AEs that were funded within the last 3 years.",
    signals: ["hiring AEs", "funded within the last 3 years"],
    windows: [{ event: "funding", days: 1095, phrase: "within the last 3 years" }],
    expect: { hiring: null, funding: 730 },
    probes: "the compiler's 730-day limit is enforced and recorded (signal_window_capped)",
  },
  {
    id: "T17-funding-signal-omitted",
    provenance: "synthetic_reference",
    request: "Find companies hiring AEs that raised funding in the last 90 days.",
    signals: ["hiring AEs"],
    windows: [{ event: "funding", days: 90, phrase: "in the last 90 days" }],
    expect: { hiring: null, funding: 90 },
    probes: "the model lists no funding signal; the reader adds the stated one and the contract window lands on it",
  },
  {
    id: "T18-six-months-hiring",
    provenance: "synthetic_reference",
    request: "Find companies hiring SDRs within the last six months.",
    signals: ["hiring SDRs"],
    windows: [{ event: "hiring", days: 180, phrase: "within the last six months" }],
    expect: { hiring: 180 },
    probes: "word numbers are counted by code",
  },
  {
    id: "T19-timeframe-not-about-a-signal",
    provenance: "harvested",
    request: "Find B2B SaaS founders currently hiring for RevOps — who should I contact this week?",
    signals: ["currently hiring for RevOps"],
    windows: [],
    expect: {},
    expect_refusal: /timeframe_unaccounted:this week/,
    probes: "KNOWN FALSE REFUSAL, the cost of failing closed: 'this week' is about the user's outreach, not a signal, and the contract has no way to say so safely",
    model_errors: [
      { id: "T19-E-filed-as-hiring", detectable: false, windows: [{ event: "hiring", days: 3, phrase: "this week" }], expect: { hiring: null },
        probes: "filed as a 3-day hiring window: narrower than asked, the quote is the user's and the reader has no hiring window to disagree with — a model error code cannot see" },
    ],
  },
];

/** The neutral proposal every case starts from: no industry, place or size. */
export function baseProposal(): Json {
  return {
    requested_opportunity_count: 5, requested_contact_ready_count: null,
    company_types: [], geographies: [], geography_is_hard: false, employee_range: { min: null, max: null },
    decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
    preferred_signals: [], required_signal_terms: [], signal_recency_days: null,
    adjacent_signals: [], excluded_signals: [],
    allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
    disallowed_broadening: ["role"], required_evidence: [],
    required_capabilities: ["general_company_discovery", "embedded_hiring_evidence", "company_semantic_evaluation"],
    preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false,
    confidence: 0.9, unknowns: [], known_companies: [],
  };
}

/**
 * The proposal for a case, in a contract. v1 has one window field: a v1 model
 * must pick one, and the most charitable pick — the only window when there is
 * exactly one — is used, so a v1 failure is the contract's, not the pick's.
 */
export function proposalFor(c: { signals: string[] }, windows: Window[], contract: "v1" | "v2"): Json {
  const p = baseProposal();
  p.preferred_signals = [...c.signals];
  p.required_signal_terms = [...c.signals];
  if (contract === "v2") p.signal_windows = windows.map((w) => ({ ...w, signal: w.signal ?? null }));
  else p.signal_recency_days = windows.length === 1 ? windows[0].days : windows.length ? windows[0].days : null;
  return p;
}

export interface CaseOutcome {
  id: string;
  contract: "v1" | "v2";
  /** event → what the runtime signal carries. Empty when refused. */
  runtime: Record<string, number | null>;
  /** The compile was refused before spend (MissionCompilationBlockedError): its reasons. */
  refused: string[] | null;
  missing_events: string[];
  wrong: Array<{ event: string; expected: number | null; got: number | null }>;
  ok: boolean;
  changes: string[];
}

/**
 * Compile one proposal under `contract` and compare the RUNTIME signals with
 * the expectation. A refusal is an outcome, not an exception: it is `ok` only
 * when `expectRefusal` is given and matches one of its reasons.
 */
export function evaluate(
  compile: (i: { originalUserQuery: string; proposal: Json; requestedCount: number; contract: "v1" | "v2" }) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
  id: string, request: string, proposal: Json, expect: Record<string, number | null>, contract: "v1" | "v2",
  expectRefusal?: RegExp,
): CaseOutcome {
  let r: Json;
  try {
    r = compile({ originalUserQuery: request, proposal, requestedCount: 5, contract });
  } catch (e) {
    const reasons = (e as { reasons?: unknown }).reasons;
    if (!Array.isArray(reasons)) throw e;
    const refused = reasons.map(String);
    const ok = !!expectRefusal && refused.some((x) => expectRefusal.test(x));
    return { id, contract, runtime: {}, refused, missing_events: [], wrong: [], ok, changes: [] };
  }
  const signals: Json[] = JSON.parse(JSON.stringify(r.final_mission.required_signals ?? []));
  const runtime: Record<string, number | null> = {};
  for (const s of signals) {
    const e = String(s.event ?? s.type);
    if (!(e in runtime)) runtime[e] = s.timeframe_days ?? null;
  }
  const missing = Object.keys(expect).filter((e) => !(e in runtime));
  const wrong = Object.entries(expect).filter(([e, d]) => e in runtime && runtime[e] !== d)
    .map(([event, expected]) => ({ event, expected, got: runtime[event] }));
  const ok = !expectRefusal && missing.length === 0 && wrong.length === 0;
  return { id, contract, runtime, refused: null, missing_events: missing, wrong, ok, changes: r.validator_changes };
}
