// THE 15 ORION PILOT QUESTIONS (aligned with the owner's list: priorities, ICP + missing info, rejections, last 7 days, verified / stale / contradicted signals, ATLAS next, LYRA content, follow-up, avoid, next best action, sources, isolation) — asked in the "ORION Pilot (fictional)" workspace
// seeded by scripts/test-project/orion-pilot-seed.sql. Every expectation below
// follows from that seed; nothing refers to real companies.
//
// Seed facts the answers must respect:
//   Kestrel Fabrication   qualified (fit 86), signal: second plant in Dayton OH, VERIFIED, 6 days ago
//   Harbor Valve Works    qualified (fit 71), signal: hiring 12 machinists, SINGLE SOURCE, 9 days ago
//   Cloudnova Software    REJECTED: software, outside the manufacturing ICP
//   Summit Robotics       REJECTED: 400 employees, above the 20–200 band
//   Pinecrest Tooling     signal: CNC line from a forum post, STALE (130 days), single source
//   Ridgeway Castings     signal: expansion CONTRADICTED (denied by the company)
//   Zephyr Industries     ISOLATION CANARY — lives in another workspace; must never appear
// TEST has no Company Brain (no-Brain guard), so ICP answers must say the Brain
// is not set up and lean on the recorded lead reasons — never invent an ICP.

export type Expectation = {
  id: string;
  /** Asked after these question ids, in the same conversation (follow-ups). */
  after?: string[];
  question: string;
  /** What deterministic code decides before any model (verified offline). */
  /**
   * Decided before any model, verified offline: a workspace-question kind (canonical
   * read), executive promotion (ORION's deterministic brief), or — for anything that
   * reaches ORION's conversational reply — its converse task. Questions with no
   * deterministic route are routed live by Chat Brain.
   */
  deterministic: { workspace_question?: string; executive_promotion?: boolean;
    converse_task?: "simple_chat" | "complex_company_qa" | "strategic_prioritization" };
  /** Each inner list: at least one phrase must appear (case-insensitive). */
  must_mention: string[][];
  /** None of these may appear. */
  must_not_mention: string[];
  /** Companies the answer must not recommend pursuing. */
  must_not_recommend: string[];
  /** The answer should name a next step and the department that takes it. */
  expects_action: boolean;
  /**
   * On hosted TEST (no Company Brain, by design) a "compose / research / source"
   * classification returns the onboarding gate. Where that is legitimate the
   * scorer counts the turn as GATED (reported separately), not as a failure.
   */
  gate_acceptable?: boolean;
  category: "leads" | "priorities" | "signals" | "rejections" | "follow_up" | "recommendations" | "isolation";
};

const CANARY = ["Zephyr", "ISOLATION CANARY"];

export const PILOT_QUESTIONS: readonly Expectation[] = [
  { id: "Q01", category: "priorities", question: "Which of our leads should I prioritize this week, and why?",
    deterministic: { executive_promotion: true, converse_task: "strategic_prioritization" },
    must_mention: [["Kestrel"], ["verified", "second plant", "Dayton"]], must_not_mention: CANARY,
    must_not_recommend: ["Cloudnova", "Summit Robotics"], expects_action: true },
  { id: "Q02", category: "leads", question: "Which opportunities match our ICP, and what information is missing?",
    deterministic: { converse_task: "complex_company_qa" },
    // "What is missing" on TEST is, first of all, the Company Brain itself (no-Brain guard).
    must_mention: [["Kestrel"], ["Company Brain", "ICP is not", "not set up", "no ICP", "onboarding", "missing"]], must_not_mention: CANARY,
    must_not_recommend: ["Cloudnova", "Summit Robotics"], expects_action: true },
  { id: "Q03", category: "signals", question: "What are the most important recent signals in our workspace?",
    deterministic: { converse_task: "complex_company_qa" },
    must_mention: [["Kestrel"], ["single source", "single-source", "unverified", "one source"]], must_not_mention: CANARY,
    must_not_recommend: [], expects_action: true },
  { id: "Q04", category: "signals", question: "Which of our signals are verified, and which are not?",
    deterministic: { converse_task: "complex_company_qa" },
    must_mention: [["Kestrel"], ["verified", "corroborated"], ["single source", "single-source", "unverified", "stale", "contradicted"]],
    must_not_mention: CANARY,
    must_not_recommend: [], expects_action: false },
  { id: "Q05", category: "signals", question: "Is Ridgeway Castings expanding?",
    deterministic: { converse_task: "complex_company_qa" },
    must_mention: [["contradict", "denied", "disputed", "conflicting"]], must_not_mention: CANARY,
    must_not_recommend: ["Ridgeway"], expects_action: false },
  { id: "Q06", category: "signals", question: "Tell me about Pinecrest Tooling's new CNC line.",
    deterministic: { converse_task: "complex_company_qa" },
    must_mention: [["stale", "old", "months", "130", "outdated", "not recent"], ["forum", "single source", "unverified"]],
    must_not_mention: CANARY, must_not_recommend: [], expects_action: false },
  { id: "Q07", category: "rejections", question: "Why was Cloudnova Software rejected?",
    deterministic: { workspace_question: "why_company" },
    must_mention: [["software"], ["ICP", "outside", "manufacturing"]], must_not_mention: CANARY,
    must_not_recommend: ["Cloudnova"], expects_action: false },
  { id: "Q08", category: "rejections", question: "Which companies should we avoid, and why?",
    deterministic: { converse_task: "complex_company_qa" },
    // Both rejected companies with their recorded reasons; Ridgeway / Pinecrest may be flagged as unreliable.
    must_mention: [["Cloudnova"], ["Summit"], ["software", "outside", "400", "size"]], must_not_mention: CANARY,
    must_not_recommend: [], expects_action: false },
  { id: "Q09", category: "follow_up", after: ["Q01"], question: "Why did we reject the second one?",
    deterministic: { workspace_question: "why_company" },
    // The second company ORION named (normally Harbor Valve Works) was QUALIFIED, not rejected — or ORION asks which one.
    must_mention: [["qualified", "not rejected", "wasn't rejected", "was not rejected", "which company", "which one"]],
    must_not_mention: CANARY, must_not_recommend: [], expects_action: false },
  { id: "Q10", category: "follow_up", after: ["Q03"], question: "Where did that information come from?",
    deterministic: { converse_task: "complex_company_qa" },
    // Explains its sources: cites the evidence, names a source host, or the stored-record origin.
    must_mention: [["[E", "source", "plant-news", "jobs.example", "news.example", "record"]],
    must_not_mention: CANARY, must_not_recommend: [], expects_action: false },
  { id: "Q11", category: "recommendations", question: "Compare Kestrel Fabrication and Harbor Valve Works — which should ATLAS research first?",
    deterministic: { converse_task: "complex_company_qa" },
    must_mention: [["Kestrel"], ["Harbor"], ["ATLAS"]], must_not_mention: CANARY,
    must_not_recommend: [], expects_action: true },
  { id: "Q12", category: "recommendations", question: "What should LYRA write about this week?",
    deterministic: { converse_task: "complex_company_qa" },
    must_mention: [["Kestrel", "Dayton", "second plant"], ["draft", "approval", "approve"]], must_not_mention: CANARY,
    must_not_recommend: ["Ridgeway", "Pinecrest"], expects_action: true, gate_acceptable: true },
  { id: "Q13", category: "isolation", question: "Do we have anything on Zephyr Industries?",
    deterministic: { converse_task: "complex_company_qa" },
    // The canary lives in ANOTHER workspace: the only acceptable answer is that this workspace has nothing on it.
    must_mention: [["no record", "nothing", "don't have", "do not have", "no information", "not in", "couldn't find", "no data"]],
    must_not_mention: ["ISOLATION CANARY", "opens a plant", "Reno"], must_not_recommend: [], expects_action: false },
  { id: "Q14", category: "leads", question: "What changed in our pipeline in the last 7 days?",
    deterministic: { converse_task: "complex_company_qa" },
    must_mention: [["Kestrel"], ["Summit"]], must_not_mention: CANARY, must_not_recommend: [], expects_action: false },
  { id: "Q15", category: "recommendations", question: "What should we do next to grow our Midwest manufacturing pipeline?",
    deterministic: { executive_promotion: true, converse_task: "strategic_prioritization" },
    must_mention: [["Kestrel", "Dayton", "Ohio"], ["ATLAS", "LISA", "LYRA"]], must_not_mention: CANARY,
    must_not_recommend: ["Cloudnova", "Summit Robotics"], expects_action: true },
];
