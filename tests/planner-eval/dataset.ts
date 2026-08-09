// THE EVALUATION SET — REAL HISTORICAL REQUESTS FROM TEST.
//
// Every `query` below is a verbatim `task_plans.user_instruction` read read-only
// from the TEST project. None is invented. Nothing was written back.
//
// They were chosen to span the query shapes that expose semantic differences,
// not to be numerous. Several are adversarial on purpose — the team clearly used
// them to probe broadening and hallucination — and those are the most valuable
// cases here, because average-case agreement between two planners tells you much
// less than what each does when the query says "do not broaden".
//
// `expect` records what the request DECLARES, not what a planner should output.
// Scoring compares planner output against these declared constraints, so neither
// planner's native schema earns points merely for its shape.

export interface EvalCase {
  id: string;
  category:
    | "simple_icp_hiring" | "tight_icp" | "geo_industry" | "persona_heavy"
    | "multi_constraint" | "exclusion_no_broadening" | "nonsense_probe"
    | "enrichment_only" | "social_signal";
  /** Verbatim from TEST `task_plans.user_instruction`. */
  query: string;
  expect: {
    requestedCount: number | null;
    geography: string | null;
    /** Explicit "do not broaden" style instruction present in the request. */
    noBroadening: boolean;
    /** Personas the request names. */
    personas: string[];
    /** The signal the request implies, in plain words — not a taxonomy key. */
    signal: string | null;
    /** Things the request forbids. */
    prohibitions: string[];
    /** True when the request supplies its own companies and forbids sourcing. */
    suppliedEntities: boolean;
  };
  /** Why this case earns a slot. */
  note: string;
}

export const EVAL_SET: readonly EvalCase[] = [
  {
    id: "simple-01",
    category: "simple_icp_hiring",
    query: "Find 10 founders at B2B SaaS companies currently building or hiring their sales teams.",
    expect: { requestedCount: 10, geography: null, noBroadening: false, personas: ["founder"], signal: "sales hiring", prohibitions: [], suppliedEntities: false },
    note: "The canonical request. 'building or hiring their sales teams' must read as SALES hiring specifically — this is the exact phrasing that produced prose instead of a typed signal in the live failure.",
  },
  {
    id: "simple-02",
    category: "simple_icp_hiring",
    query: "Find 10 Founder their sales teams in B2B SaaS. Save them to Signal Feed. Do not send any outreach.",
    expect: { requestedCount: 10, geography: null, noBroadening: false, personas: ["founder"], signal: "sales hiring", prohibitions: ["outreach"], suppliedEntities: false },
    note: "Malformed real query — a verb is missing. Tests robustness to the ungrammatical input users actually send, plus an explicit outreach prohibition.",
  },
  {
    id: "tight-01",
    category: "tight_icp",
    query: "Find B2B SaaS companies hiring Revenue Operations, RevOps, or first sales in the United States.",
    expect: { requestedCount: null, geography: "United States", noBroadening: false, personas: [], signal: "revops hiring", prohibitions: [], suppliedEntities: false },
    note: "Three role synonyms plus geography, and NO requested count — tests whether a planner invents one.",
  },
  {
    id: "tight-02",
    category: "tight_icp",
    query: "Find B2B SaaS founders currently hiring for RevOps — who should I contact this week?",
    expect: { requestedCount: null, geography: null, noBroadening: false, personas: ["founder"], signal: "revops hiring", prohibitions: [], suppliedEntities: false },
    note: "Conversational framing with an embedded question. Tests whether the trailing question is treated as part of the ICP.",
  },
  {
    id: "geo-01",
    category: "geo_industry",
    query: "Find 5 AI workflow companies in Europe",
    expect: { requestedCount: 5, geography: "Europe", noBroadening: false, personas: [], signal: null, prohibitions: [], suppliedEntities: false },
    note: "Non-US geography. The deterministic parser is US-only, so this exposes how each planner handles a region it cannot normalize.",
  },
  {
    id: "geo-02",
    category: "geo_industry",
    query: "Find companies hiring GTM roles in London and draft outreach.",
    expect: { requestedCount: null, geography: "London", noBroadening: false, personas: [], signal: "gtm hiring", prohibitions: [], suppliedEntities: false },
    note: "City-level geography plus a second requested action.",
  },
  {
    id: "persona-01",
    category: "persona_heavy",
    query: "Find 5 recruiting Agency in B2B in USA where a founder or owner is likely the decision-maker. Open results in Workbench. Do not send outreach.",
    expect: { requestedCount: 5, geography: "USA", noBroadening: false, personas: ["founder", "owner"], signal: null, prohibitions: ["outreach"], suppliedEntities: false },
    note: "Owner as a persona alongside founder — the variant the master plan flags as under-served by a Founder/CEO-only rank order.",
  },
  {
    id: "persona-02",
    category: "persona_heavy",
    query: "Find 5 companies hiring Executive Assistant / founder-support roles in USA",
    expect: { requestedCount: 5, geography: "USA", noBroadening: false, personas: [], signal: "executive assistant hiring", prohibitions: [], suppliedEntities: false },
    note: "A hiring signal that is NOT sales. Tests whether 'hiring' is over-generalized to the revenue family.",
  },
  {
    id: "multi-01",
    category: "multi_constraint",
    query: "Find 3 AI SaaS companies recently funded hiring SDRs or GTM roles for outbound in US + EU",
    expect: { requestedCount: 3, geography: "US + EU", noBroadening: false, personas: [], signal: "funding AND gtm hiring", prohibitions: [], suppliedEntities: false },
    note: "TWO signals at once plus a compound geography — the AND case the roadmap defers to Phase 6. Records how each planner degrades today.",
  },
  {
    id: "multi-02",
    category: "multi_constraint",
    query: "Find 30 early-stage SaaS companies in the US that are hiring SDRs, AEs, or growth marketers. Rank them by how likely they are to need Agentory, enrich the top 5, and draft short founder-style outreach.",
    expect: { requestedCount: 30, geography: "US", noBroadening: false, personas: [], signal: "sales hiring", prohibitions: [], suppliedEntities: false },
    note: "Stage + geography + three roles + a staged downstream pipeline, and a count far above the usual 5-10.",
  },
  {
    id: "noBroaden-01",
    category: "exclusion_no_broadening",
    query: "Find exactly 5 SDR hiring leads in London. Do not broaden outside London.",
    expect: { requestedCount: 5, geography: "London", noBroadening: true, personas: [], signal: "sdr hiring", prohibitions: ["broaden geography"], suppliedEntities: false },
    note: "THE decisive case. 'exactly' plus an explicit geographic no-broadening instruction. Loosening London here is a severe failure, not a style difference.",
  },
  {
    id: "noBroaden-02",
    category: "exclusion_no_broadening",
    query: "Find exactly 5 companies hiring Quantum Banana Sandwich Wizard Engineers strictly in Antarctica only. Do not broaden.",
    expect: { requestedCount: 5, geography: "Antarctica", noBroadening: true, personas: [], signal: "engineering hiring", prohibitions: ["broaden"], suppliedEntities: false },
    note: "Unsatisfiable BY DESIGN. The correct behaviour is an honest zero, not a broadened substitute — this separates a planner that refuses from one that quietly rewrites the request into something findable.",
  },
  {
    id: "nonsense-01",
    category: "nonsense_probe",
    query: "Find 5 companies hiring quantum banana GTM roles in Antarctica",
    expect: { requestedCount: 5, geography: "Antarctica", noBroadening: false, personas: [], signal: "gtm hiring", prohibitions: [], suppliedEntities: false },
    note: "Same nonsense WITHOUT the no-broadening instruction. The pair isolates how much of the refusal comes from the instruction versus the planner's own judgement.",
  },
  {
    id: "enrich-01",
    category: "enrichment_only",
    query: "Find decision-makers (Founder, CEO, Head of Sales) at these companies: Fireworks AI, Notch, 1Commerce, Palo Alto Networks, Atlassian. Attach each contact to its company. Do not invent contacts.",
    expect: { requestedCount: null, geography: null, noBroadening: false, personas: ["founder", "ceo", "head of sales"], signal: null, prohibitions: ["invent contacts"], suppliedEntities: true },
    note: "Supplied entities — discovery must NOT run. A planner that schedules company discovery here has misunderstood the request entirely.",
  },
  {
    id: "social-01",
    category: "social_signal",
    query: "Find 5 LinkedIn posts where founders complain about outbound problems",
    expect: { requestedCount: 5, geography: null, noBroadening: false, personas: ["founder"], signal: "linkedin post about outbound pain", prohibitions: [], suppliedEntities: false },
    note: "A signal with NO executable provider today. The honest outcome is a refusal; a planner that produces a confident plan is planning something that cannot run.",
  },
] as const;

export const CATEGORIES = [...new Set(EVAL_SET.map((c) => c.category))];
