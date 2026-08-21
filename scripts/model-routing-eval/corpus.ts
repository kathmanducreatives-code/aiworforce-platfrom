// THE EVAL CASES, AND AN HONEST ACCOUNT OF WHERE THEY CAME FROM.
//
// ── THE CORPUS PROBLEM, STATED UP FRONT ─────────────────────────────────────
//
// Phase 3 was planned as "golden-fixture evals built from real persisted
// missions". The database does not support that plan. Every compiled mission
// ever persisted — 13 of them, across five days — came from ONE request:
//
//     "Find 10 qualified AI startups in the US currently hiring"        ×12
//     "Find 2 qualified AI startups in the United States that are
//      currently hiring software engineers."                            ×1
//
// and the chat history contains no other lead request at all, only that same
// sentence with and without a full stop. There is no corpus. There is one
// sentence, run repeatedly.
//
// A benchmark on one prompt would produce a confident-looking pass that says
// nothing about the requests the system will actually meet, and would reward a
// model for handling the single case in the fixture file. So the corpus below is
// PARTLY SYNTHETIC, and every case says which it is.
//
//   HARVESTED  verbatim from `tasks.result`, with the run's real outcome.
//              Ground truth in the strongest available sense: this mission ran
//              and delivered 10/10.
//
//   SYNTHETIC  written here to probe a decision the harvested case cannot
//              reach. NOT ground truth. Each carries `probes` — the specific
//              failure it is built to catch — and is scored ONLY by invariants,
//              which are properties of the request text rather than opinions
//              about the right answer.
//
// A synthetic case can never prove a model is good. It can prove a model is
// broken, which is the cheaper half of the question and the half that must be
// answered before any paid comparison is worth running.
//
// ── WHAT THE SYNTHETIC CASES PROBE ──────────────────────────────────────────
//
// Chosen from the failure modes this codebase has ALREADY PAID FOR, not from
// imagination. Each names the run that demonstrated it.

export const EVAL_CORPUS_VERSION = "eval-corpus-v1" as const;

export type CaseProvenance = "harvested" | "synthetic";

export interface EvalCase {
  id: string;
  provenance: CaseProvenance;
  request: string;
  /** The failure this case exists to catch. */
  probes: string;
  /** Where the failure was observed, for harvested and synthetic alike. */
  grounding: string;
  /**
   * Present only for harvested cases: what the incumbent actually produced and
   * what the run delivered. Synthetic cases have no reference output BY DESIGN.
   */
  reference?: {
    run_id: string;
    qualified: number;
    note: string;
  };
}

export const EVAL_CASES: readonly EvalCase[] = Object.freeze([
  // ── HARVESTED ───────────────────────────────────────────────────────────
  {
    id: "anchor-10-ai-us-hiring",
    provenance: "harvested",
    request: "Find 10 qualified AI startups in the US currently hiring",
    probes:
      "the whole pipeline end to end: count, location, vertical, stage and the " +
      "hiring signal, all in one request.",
    grounding:
      "runs 3a231901 and 4fe98f5c (2026-08-21), the only two in the persisted " +
      "history that delivered the full requested count.",
    reference: {
      run_id: "3a231901",
      qualified: 10,
      note:
        "Its twin 4fe98f5c produced the same 10 qualified from the same mission " +
        "at 17 cost units against 9, and 12 identity misses against 5. The " +
        "outcome is reproducible; the cost is not.",
    },
  },

  // ── SYNTHETIC ───────────────────────────────────────────────────────────
  {
    id: "count-not-at-the-front",
    provenance: "synthetic",
    request:
      "I need US fintech companies that are hiring engineers — about 25 of them, " +
      "Series A or later.",
    probes:
      "`requested_count` when the number is not the first integer in the " +
      "sentence and not adjacent to the verb.",
    grounding:
      "`requested_count` sizes every downstream purchase " +
      "(buildDiscoveryPlannerPayload → limits.requested_lead_count). Compiling " +
      "25 as 1 or as 100 is the single most expensive one-field error available.",
  },
  {
    id: "location-stated-obliquely",
    provenance: "synthetic",
    request: "Find 15 Berlin-based B2B SaaS startups that recently raised funding.",
    probes:
      "`company_profile.locations` when the place is an adjective rather than a " +
      "prepositional phrase, and a non-US location.",
    grounding:
      "a dropped `locations` is the defect that made identity resolution search " +
      "worldwide for US companies; the fix that added `locations` to the actor " +
      "input produced the first 10/10 run.",
  },
  {
    id: "signal-is-funding-not-hiring",
    provenance: "synthetic",
    request: "Get me 10 healthtech companies that closed a Series B in the last year.",
    probes:
      "a request whose signal is NOT hiring. Every persisted mission is a hiring " +
      "mission, so nothing in the real corpus exercises the rest of the signal " +
      "vocabulary.",
    grounding:
      "`required_signals[].type` was free text compared with `===` in six " +
      "places; an uncanonical type matches no actor and no predicate.",
  },
  {
    id: "no-count-stated",
    provenance: "synthetic",
    request: "Find AI infrastructure startups in the US that are hiring ML engineers.",
    probes:
      "a request that names no count. The mission must not invent one and call " +
      "it `explicit_user_request`.",
    grounding:
      "`field_provenance` is the mission's own audit trail; a model that marks " +
      "its inference as explicit produces explanations that lie downstream.",
  },
  {
    id: "constraint-bait",
    provenance: "synthetic",
    request: "Find 20 companies hiring senior backend engineers.",
    probes:
      "over-constraining. The request names no geography, no stage, no vertical " +
      "and no size — a mission that adds any of them as a HARD constraint has " +
      "narrowed the pool on the model's own authority.",
    grounding:
      "the user's standing rule for this work: improve retrieval before " +
      "weakening validation. The mirror failure — inventing constraints — looks " +
      "like caution and costs recall silently.",
  },
  {
    id: "two-signals-one-request",
    provenance: "synthetic",
    request:
      "Find 10 US robotics startups that raised funding recently AND are hiring " +
      "hardware engineers.",
    probes:
      "two required signals in one mission, which changes actor coverage and " +
      "which no persisted mission contains (every one has exactly one signal).",
    grounding:
      "`coverMissionSignals` decides which actors can serve the request; a " +
      "mission that silently drops one signal buys a pool that cannot satisfy it.",
  },
]);

export function harvestedCases(): EvalCase[] {
  return EVAL_CASES.filter((c) => c.provenance === "harvested");
}

export function syntheticCases(): EvalCase[] {
  return EVAL_CASES.filter((c) => c.provenance === "synthetic");
}
