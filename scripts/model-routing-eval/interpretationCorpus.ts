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

export interface Window { event: string; days: number | null; phrase: string }

export interface InterpretationCase {
  id: string;
  provenance: "synthetic_reference" | "harvested";
  request: string;
  /** The proposal fields that differ from the neutral base below. */
  signals: string[];
  windows: Window[];
  /** What the runtime must carry: event → days (null = the event is required with no window). */
  expect: Record<string, number | null>;
  probes: string;
  model_errors?: Array<{
    id: string;
    windows: Window[];
    detectable: boolean;
    /** For a detectable error: the runtime the compiler must still produce. */
    expect?: Record<string, number | null>;
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
      { id: "T1-E-window-on-hiring-too", detectable: false,
        windows: [{ event: "funding", days: 180, phrase: "within the last six months" }, { event: "hiring", days: 180, phrase: "within the last six months" }],
        probes: "the funding phrase attached to hiring as well: the words are the user's, the attribution is wrong — a model error code cannot see" },
      { id: "T1-E-wrong-days", detectable: true,
        windows: [{ event: "funding", days: 30, phrase: "within the last six months" }],
        expect: { hiring: null, funding: 180 }, expect_change: /signal_window_applied_days_from_phrase:funding=180/,
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
      { id: "T2-E-no-window", detectable: false, windows: [],
        probes: "the model omitted the stated window; v2 trusts the attribution and records the reader's disagreement — W1's v1 regex would have filled it" },
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
  },
  {
    id: "T6-two-windows-two-signals",
    provenance: "synthetic_reference",
    request: "Find companies hiring SDRs in the last 2 weeks that were funded within a year.",
    signals: ["hiring SDRs", "funded within a year"],
    windows: [{ event: "hiring", days: 14, phrase: "in the last 2 weeks" }, { event: "funding", days: 365, phrase: "within a year" }],
    expect: { hiring: 14, funding: 365 },
    probes: "v1 has one field for two windows and cannot express this",
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
    probes: "'less than N days ago' is counted by code; review R1's reader returned no window here",
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
  if (contract === "v2") p.signal_windows = windows;
  else p.signal_recency_days = windows.length === 1 ? windows[0].days : windows.length ? windows[0].days : null;
  return p;
}

export interface CaseOutcome {
  id: string;
  contract: "v1" | "v2";
  /** event → what the runtime signal carries. */
  runtime: Record<string, number | null>;
  missing_events: string[];
  wrong: Array<{ event: string; expected: number | null; got: number | null }>;
  ok: boolean;
  changes: string[];
}

/** Compile one proposal and compare the RUNTIME signals with the expectation. */
export function evaluate(
  compile: (i: { originalUserQuery: string; proposal: Json; requestedCount: number }) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
  id: string, request: string, proposal: Json, expect: Record<string, number | null>, contract: "v1" | "v2",
): CaseOutcome {
  const r = compile({ originalUserQuery: request, proposal, requestedCount: 5 });
  const signals: Json[] = JSON.parse(JSON.stringify(r.final_mission.required_signals ?? []));
  const runtime: Record<string, number | null> = {};
  for (const s of signals) {
    const e = String(s.event ?? s.type);
    if (!(e in runtime)) runtime[e] = s.timeframe_days ?? null;
  }
  const missing = Object.keys(expect).filter((e) => !(e in runtime));
  const wrong = Object.entries(expect).filter(([e, d]) => e in runtime && runtime[e] !== d)
    .map(([event, expected]) => ({ event, expected, got: runtime[event] }));
  return { id, contract, runtime, missing_events: missing, wrong, ok: missing.length === 0 && wrong.length === 0, changes: r.validator_changes };
}
