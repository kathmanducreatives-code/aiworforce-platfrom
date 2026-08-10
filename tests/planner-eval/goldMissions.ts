// GOLD MISSIONS — WHAT EACH REQUEST ACTUALLY DECLARES.
//
// One entry per case in `dataset.ts`, keyed by the same id. Each records the
// constraints a correct compiler MUST recover from that sentence, expressed in
// the canonical `LeadMissionV1` vocabulary.
//
// ── HOW THESE WERE PRODUCED, AND HOW THEY WERE NOT ──────────────────────────
//
// Written by reading each `query` string and nothing else, then cross-checked
// against that case's existing `expect` block (itself authored as "what the
// request DECLARES, not what a planner should output"). Disagreements between
// the two are noted per case below rather than silently reconciled.
//
// The deterministic parsers were NOT run to produce any value here, and no
// planner output was consulted. That is the whole point: `leadEntityIntent.ts`,
// `jobSearchSpec.ts` and `parseLeadMissionDeterministic` are the systems under
// evaluation, so using their output as the answer key would score them against
// themselves and every one of them would look perfect.
//
// ── WHAT `undetermined` MEANS ───────────────────────────────────────────────
//
// A field listed there is one the request genuinely does not settle. It is NOT
// a gap in the fixture — asserting a value for it would be inventing a
// constraint the user never stated, which is the exact failure these fixtures
// exist to catch. A compiler that fills one in confidently is wrong even when
// its guess is reasonable.

import type { RequestedOutput } from "../../supabase/functions/_shared/leadMission.ts";

export interface GoldMission {
  /** Matches `EvalCase.id` in dataset.ts. */
  id: string;
  /** Explicit count the request states. Null means it states none. */
  requested_count: number | null;
  /** Geographies as the user wrote them, before any normalisation. */
  geographies: string[];
  /** The user named the place themselves (so it may never be widened). */
  geography_is_hard: boolean;
  /** Personas to CONTACT. Not roles being hired — see persona-02. */
  personas: string[];
  /** Signal families the request implies, in plain words. */
  signals: string[];
  /** The user's own role/signal words, verbatim. */
  required_signal_terms: string[];
  /** "exactly" / "strictly" / "only" / "do not broaden". */
  no_broadening_requested: boolean;
  /** Actions the request forbids. */
  prohibitions: string[];
  /** Companies the request supplies. Non-empty ⇒ discovery must not run. */
  known_companies: string[];
  /** Recency in days when the request states a number. */
  signal_recency_days: number | null;
  /** ICP the request states: verticals, business models, stages. */
  icp: { verticals: string[]; stages: string[] };
  /** What the user asked to RECEIVE. Null when the contract cannot express it. */
  output_intent: RequestedOutput | null;
  /** Fields this request genuinely leaves open. Asserting them would invent. */
  undetermined: string[];
  /** Reviewer's reasoning, including any disagreement with `expect`. */
  review: string;
}

export const GOLD_MISSIONS: readonly GoldMission[] = [
  {
    id: "simple-01",
    requested_count: 10,
    geographies: [], geography_is_hard: false,
    personas: ["founder"],
    signals: ["hiring"],
    required_signal_terms: ["sales"],
    no_broadening_requested: false,
    prohibitions: [], known_companies: [], signal_recency_days: null,
    icp: { verticals: ["B2B SaaS"], stages: [] },
    output_intent: "contact_ready_leads",
    undetermined: ["signal_recency_days"],
    review:
      "'building or hiring their sales teams' is ONE hiring signal about SALES, " +
      "not two signals and not generic hiring. 'founders' is who to contact, so " +
      "the output is people, not companies.",
  },
  {
    id: "simple-02",
    requested_count: 10,
    geographies: [], geography_is_hard: false,
    personas: ["founder"],
    signals: ["hiring"],
    required_signal_terms: ["sales"],
    no_broadening_requested: false,
    prohibitions: ["send outreach"], known_companies: [], signal_recency_days: null,
    icp: { verticals: ["B2B SaaS"], stages: [] },
    output_intent: "contact_ready_leads",
    undetermined: ["signal_recency_days"],
    review:
      "Ungrammatical ('Find 10 Founder their sales teams') but unambiguous. " +
      "'Save them to Signal Feed' is a destination, not a prohibition; 'Do not " +
      "send any outreach' is the prohibition.",
  },
  {
    id: "tight-01",
    requested_count: null,
    geographies: ["United States"], geography_is_hard: true,
    personas: [],
    signals: ["hiring"],
    required_signal_terms: ["Revenue Operations", "RevOps", "first sales"],
    no_broadening_requested: false,
    prohibitions: [], known_companies: [], signal_recency_days: null,
    icp: { verticals: ["B2B SaaS"], stages: [] },
    output_intent: "qualified_companies",
    undetermined: ["requested_count", "signal_recency_days"],
    review:
      "NO count is stated — a compiler that emits one has invented it. The three " +
      "role phrases are alternatives for the same signal, and all three are the " +
      "user's own words, so all three are preserved verbatim. The request asks " +
      "for companies, not people.",
  },
  {
    id: "tight-02",
    requested_count: null,
    geographies: [], geography_is_hard: false,
    personas: ["founder"],
    signals: ["hiring"],
    required_signal_terms: ["RevOps"],
    no_broadening_requested: false,
    prohibitions: [], known_companies: [], signal_recency_days: null,
    icp: { verticals: ["B2B SaaS"], stages: [] },
    output_intent: "contact_ready_leads",
    undetermined: ["requested_count", "signal_recency_days"],
    review:
      "'who should I contact this week?' is a question about the answer, not an " +
      "ICP constraint and not a recency window on the SIGNAL. Treating 'this " +
      "week' as signal recency would narrow the search on something the user " +
      "never said about the companies.",
  },
  {
    id: "geo-01",
    requested_count: 5,
    geographies: ["Europe"], geography_is_hard: true,
    personas: [],
    signals: [],
    required_signal_terms: [],
    no_broadening_requested: false,
    prohibitions: [], known_companies: [], signal_recency_days: null,
    icp: { verticals: ["AI workflow"], stages: [] },
    output_intent: "qualified_companies",
    undetermined: ["signals", "signal_recency_days"],
    review:
      "NO signal at all — the request names an ICP and a place. A compiler that " +
      "attaches a hiring signal here has added a constraint that will silently " +
      "discard correct companies.",
  },
  {
    id: "geo-02",
    requested_count: null,
    geographies: ["London"], geography_is_hard: true,
    personas: [],
    signals: ["hiring"],
    required_signal_terms: ["GTM"],
    no_broadening_requested: false,
    prohibitions: [], known_companies: [], signal_recency_days: null,
    icp: { verticals: [], stages: [] },
    output_intent: "qualified_companies",
    undetermined: ["requested_count", "icp.verticals", "signal_recency_days"],
    review:
      "'and draft outreach' is a REQUESTED downstream action, not a prohibition " +
      "and not part of the ICP. No vertical is named at all.",
  },
  {
    id: "persona-01",
    requested_count: 5,
    geographies: ["USA"], geography_is_hard: true,
    personas: ["founder", "owner"],
    signals: [],
    required_signal_terms: [],
    no_broadening_requested: false,
    prohibitions: ["send outreach"], known_companies: [], signal_recency_days: null,
    icp: { verticals: ["recruiting agency", "B2B"], stages: [] },
    output_intent: "contact_ready_leads",
    undetermined: ["signals", "signal_recency_days"],
    review:
      "'owner' is a persona in its own right, NOT a synonym to be folded into " +
      "founder/CEO. No hiring signal is stated. 'Open results in Workbench' is a " +
      "destination, not a constraint.",
  },
  {
    id: "persona-02",
    requested_count: 5,
    geographies: ["USA"], geography_is_hard: true,
    personas: [],
    signals: ["hiring"],
    required_signal_terms: ["Executive Assistant", "founder-support"],
    no_broadening_requested: false,
    prohibitions: [], known_companies: [], signal_recency_days: null,
    icp: { verticals: [], stages: [] },
    output_intent: "qualified_companies",
    undetermined: ["personas", "icp.verticals", "signal_recency_days"],
    review:
      "THE PERSONA TRAP. 'founder-support roles' is the role being HIRED, not the " +
      "person to contact — personas is empty. A compiler that reads 'founder' " +
      "here and targets founders has inverted the request. Also not a sales " +
      "signal: 'hiring' must not be generalised to the revenue family.",
  },
  {
    id: "multi-01",
    requested_count: 3,
    geographies: ["US", "EU"], geography_is_hard: true,
    personas: [],
    signals: ["funding", "hiring"],
    required_signal_terms: ["SDR", "GTM"],
    no_broadening_requested: false,
    prohibitions: [], known_companies: [], signal_recency_days: null,
    icp: { verticals: ["AI SaaS"], stages: [] },
    output_intent: "qualified_companies",
    undetermined: ["signal_recency_days"],
    review:
      "TWO signals that must both hold — funding AND hiring. 'recently funded' " +
      "declares that recency applies WITHOUT naming a number, so the gold day " +
      "count stays null and the field is undetermined: any specific window here " +
      "is the compiler's invention, not the user's constraint.",
  },
  {
    id: "multi-02",
    requested_count: 30,
    geographies: ["US"], geography_is_hard: true,
    personas: [],
    signals: ["hiring"],
    required_signal_terms: ["SDR", "AE", "growth marketer"],
    no_broadening_requested: false,
    prohibitions: [], known_companies: [], signal_recency_days: null,
    icp: { verticals: ["SaaS"], stages: ["early-stage"] },
    output_intent: "qualified_companies",
    undetermined: ["signal_recency_days"],
    review:
      "Count is 30, well above the usual 5-10, and must survive intact. " +
      "'enrich the top 5' is a downstream stage size, NOT the requested count — " +
      "reading 5 here would discard 25 of the companies the user asked for.",
  },
  {
    id: "noBroaden-01",
    requested_count: 5,
    geographies: ["London"], geography_is_hard: true,
    personas: [],
    signals: ["hiring"],
    required_signal_terms: ["SDR"],
    no_broadening_requested: true,
    prohibitions: ["broaden geography"], known_companies: [], signal_recency_days: null,
    icp: { verticals: [], stages: [] },
    output_intent: "contact_ready_leads",
    undetermined: ["personas", "icp.verticals", "signal_recency_days"],
    review:
      "THE DECISIVE CASE. 'exactly' AND an explicit geographic no-broadening " +
      "instruction. personas is EMPTY: 'leads' says what to return, not who to " +
      "contact, and injecting Founder/CEO here fabricates a targeting constraint " +
      "the user never gave.",
  },
  {
    id: "noBroaden-02",
    requested_count: 5,
    geographies: ["Antarctica"], geography_is_hard: true,
    personas: [],
    signals: ["hiring"],
    required_signal_terms: ["Quantum Banana Sandwich Wizard Engineer"],
    no_broadening_requested: true,
    prohibitions: ["broaden"], known_companies: [], signal_recency_days: null,
    icp: { verticals: [], stages: [] },
    output_intent: "qualified_companies",
    undetermined: ["icp.verticals", "signal_recency_days"],
    review:
      "Unsatisfiable by design, and the mission must record it faithfully anyway. " +
      "The nonsense role is preserved VERBATIM — normalising it to 'engineering' " +
      "is how an honest zero turns into a broadened substitute nobody asked for.",
  },
  {
    id: "nonsense-01",
    requested_count: 5,
    geographies: ["Antarctica"], geography_is_hard: true,
    personas: [],
    signals: ["hiring"],
    required_signal_terms: ["quantum banana GTM"],
    no_broadening_requested: false,
    prohibitions: [], known_companies: [], signal_recency_days: null,
    icp: { verticals: [], stages: [] },
    output_intent: "qualified_companies",
    undetermined: ["icp.verticals", "signal_recency_days"],
    review:
      "Identical to noBroaden-02 except no_broadening_requested is FALSE — the " +
      "pair isolates the instruction's effect. Geography is still hard: the user " +
      "named Antarctica themselves.",
  },
  {
    id: "enrich-01",
    requested_count: null,
    geographies: [], geography_is_hard: false,
    personas: ["founder", "ceo", "head of sales"],
    signals: [],
    required_signal_terms: [],
    no_broadening_requested: false,
    prohibitions: ["invent contacts"],
    known_companies: ["Fireworks AI", "Notch", "1Commerce", "Palo Alto Networks", "Atlassian"],
    signal_recency_days: null,
    icp: { verticals: [], stages: [] },
    output_intent: "contact_ready_leads",
    undetermined: ["requested_count", "icp.verticals", "signals"],
    review:
      "SUPPLIED ENTITIES. Five companies named in prose, no domains. " +
      "known_companies being non-empty is the operative constraint — it is what " +
      "must suppress discovery. Output is contact_ready_leads, not " +
      "enriched_companies: the user wants PEOPLE at companies they already have. " +
      "The five supplied companies are not a requested count.",
  },
  {
    id: "social-01",
    requested_count: 5,
    geographies: [], geography_is_hard: false,
    personas: ["founder"],
    signals: ["social_post"],
    required_signal_terms: ["outbound"],
    no_broadening_requested: false,
    prohibitions: [], known_companies: [], signal_recency_days: null,
    icp: { verticals: [], stages: [] },
    output_intent: null,
    undetermined: ["output_intent", "icp.verticals", "signal_recency_days"],
    review:
      "CONTRACT GAP, recorded rather than papered over. The user asks for POSTS. " +
      "RequestedOutput has no value that means that — contact_ready_leads, " +
      "qualified_companies, job_listings and enriched_companies are all something " +
      "else. output_intent is therefore null BECAUSE THE CONTRACT CANNOT SAY IT, " +
      "not because the request is vague. Picking the closest wrong value here is " +
      "how a request with no executable provider becomes a confident plan.",
  },
] as const;

/** Gold entries keyed by case id. */
export const GOLD_BY_ID: ReadonlyMap<string, GoldMission> =
  new Map(GOLD_MISSIONS.map((g) => [g.id, g]));
