// REPRESENTATIVE WORKFORCE TASKS FOR THE TERRA BENCHMARK. ALL FICTIONAL.
//
// Every company, person and figure below is invented for this harness. Each
// task carries its own ground truth: the ICP the answer must respect, the
// evidence ids it may cite, the entities it may name, and the JSON keys a
// structured answer must carry. Scoring is deterministic (scorers.ts).

import type { WorkforceTask } from "../../supabase/functions/_shared/terraPolicy.ts";

export interface BenchTask {
  id: string;
  task: WorkforceTask;
  system: string;
  user: string;
  /** Entities the answer may name. Anything else capitalised and company-shaped is a suspected hallucination. */
  allowedEntities: string[];
  /** Entities the Company Brain excludes. Naming one as a target is an ICP violation. */
  excludedEntities: string[];
  /** Evidence ids present in the prompt. A citation outside this set is fabricated. */
  evidenceIds: string[];
  /** Required JSON keys when the task expects JSON; null for prose. */
  jsonKeys: string[] | null;
  maxOutputTokens: number;
  /** Benchmark category from the Terra audit (§5). */
  category?: "executive" | "icp_qa" | "lead_research" | "market_signal" | "planning" | "content" | "factual_reliability" | "memory";
  /** Phrases a correct answer must contain (case-insensitive; any one of each inner list). */
  mustMention?: string[][];
  /** Entities a correct answer must NOT recommend pursuing. */
  mustNotRecommend?: string[];
}

const BRAIN = `COMPANY BRAIN (approved): ICP = US manufacturing companies, 20–200 employees.
EXCLUDED (approved): software companies; Cloudnova Software.`;

const EVIDENCE = `EVIDENCE:
[E1] Kestrel Fabrication (Ohio, 140 employees) announced a second plant in Dayton — kestrel-fab.example/news, 2026-10-30, verified (2 sources).
[E2] Harbor Valve Works (Texas, 85 employees) is hiring 12 machinists — jobs.example/harbor, 2026-11-02, single source.
[E3] Cloudnova Software raised a Series B — news.example/cloudnova, 2026-10-28, verified.
[E4] Pinecrest Tooling (Michigan, 60 employees) — a forum post claims a new CNC line; no company source — 2026-09-01, unverified.`;

const EVIDENCE_HARD = `EVIDENCE:
[E1] Kestrel Fabrication (Ohio, 140 employees) announced a second plant in Dayton — kestrel-fab.example/news, 2026-10-30, verified (2 sources).
[E5] Ridgeway Castings (Indiana, 90 employees) "is expanding into a new facility" — trade-blog.example, 2026-11-03, single source.
[E6] Ridgeway Castings press office: "we have no expansion plans this year" — ridgeway.example/press, 2026-11-05, company statement.
[E4] Pinecrest Tooling (Michigan, 60 employees) — a forum post claims a new CNC line — 2026-06-01, unverified, older than 60 days.
[E7] Summit Robotics (Texas, 400 employees) is hiring 30 assemblers — jobs.example/summit, 2026-11-07, single source.`;

const ENTITIES = ["Kestrel Fabrication", "Harbor Valve Works", "Pinecrest Tooling", "Cloudnova Software", "Ridgeway Castings", "Summit Robotics", "ORION", "ATLAS", "LISA", "LYRA"];

export const BENCH_TASKS: readonly BenchTask[] = Object.freeze([
  {
    id: "orion-priority-1", category: "executive", task: "orion_reasoning",
    system: `You are ORION. Answer only from the evidence. Cite evidence ids like [E1]. ${BRAIN}`,
    user: `${EVIDENCE}\n\nWhat should I prioritize this week? Reply as JSON {"executive_answer","why_it_matters","evidence":[ids],"recommended_actions":[],"uncertainty"}.`,
    allowedEntities: ENTITIES, excludedEntities: ["Cloudnova Software"], evidenceIds: ["E1", "E2", "E3", "E4"],
    jsonKeys: ["executive_answer", "why_it_matters", "evidence", "recommended_actions", "uncertainty"], maxOutputTokens: 700,
  },
  {
    id: "orion-plan-1", category: "planning", task: "executive_planning",
    system: `You are ORION planning work for ATLAS, LISA and LYRA. ${BRAIN}`,
    user: `${EVIDENCE}\n\nPlan the next steps to turn the expansion signals into qualified leads. JSON {"steps":[{"department","action","needs_approval"}]}.`,
    allowedEntities: ENTITIES, excludedEntities: ["Cloudnova Software"], evidenceIds: ["E1", "E2", "E3", "E4"],
    jsonKeys: ["steps"], maxOutputTokens: 600,
  },
  {
    id: "orion-qa-1", category: "factual_reliability", task: "complex_company_qa",
    system: `You are ORION. Answer only from the evidence and say what is unverified. ${BRAIN}`,
    user: `${EVIDENCE}\n\nIs Pinecrest Tooling's CNC expansion verified, and should ATLAS pursue it?`,
    allowedEntities: ENTITIES, excludedEntities: ["Cloudnova Software"], evidenceIds: ["E1", "E2", "E3", "E4"],
    jsonKeys: null, maxOutputTokens: 400,
  },
  {
    id: "atlas-qual-1", category: "lead_research", task: "atlas_qualification",
    system: `You are ATLAS qualifying companies against the ICP. ${BRAIN}`,
    user: `${EVIDENCE}\n\nQualify each company. JSON {"verdicts":[{"company","qualified","reason","evidence"}]}.`,
    allowedEntities: ENTITIES, excludedEntities: [], evidenceIds: ["E1", "E2", "E3", "E4"],
    jsonKeys: ["verdicts"], maxOutputTokens: 700,
  },
  {
    id: "lisa-interp-1", category: "market_signal", task: "lisa_interpretation",
    system: `You are LISA judging signal relevance to the ICP. ${BRAIN}`,
    user: `${EVIDENCE}\n\nFor each signal: JSON {"signals":[{"id","relevant","verification","why"}]}.`,
    allowedEntities: ENTITIES, excludedEntities: [], evidenceIds: ["E1", "E2", "E3", "E4"],
    jsonKeys: ["signals"], maxOutputTokens: 600,
  },
  {
    id: "lyra-post-1", category: "content", task: "lyra_content",
    system: `You are LYRA writing a LinkedIn post in a plain founder voice. Use only verified facts. ${BRAIN}`,
    user: `${EVIDENCE}\n\nWrite a short LinkedIn post about the Midwest manufacturing expansion signal in [E1]. Do not name excluded companies.`,
    allowedEntities: ENTITIES, excludedEntities: ["Cloudnova Software"], evidenceIds: ["E1"],
    jsonKeys: null, maxOutputTokens: 400,
  },
  {
    id: "orion-icp-qa-1", category: "icp_qa", task: "complex_company_qa",
    system: `You are ORION. Answer only from the evidence and the Company Brain. Cite evidence ids. ${BRAIN}
GOALS (approved): win 3 Midwest manufacturing customers this quarter.`,
    user: `${EVIDENCE}\n\nWhich opportunities best match our ICP and current goals? Rank them and say why.`,
    allowedEntities: ENTITIES, excludedEntities: ["Cloudnova Software"], evidenceIds: ["E1", "E2", "E3", "E4"],
    jsonKeys: null, maxOutputTokens: 500,
    mustMention: [["Kestrel"], ["Midwest", "Ohio"]], mustNotRecommend: ["Cloudnova Software"],
  },
  {
    id: "atlas-research-1", category: "lead_research", task: "atlas_qualification",
    system: `You are ATLAS. Decide whether a company is worth contacting. Use only the evidence. ${BRAIN}`,
    user: `${EVIDENCE_HARD}\n\nEvaluate Summit Robotics and determine whether it is worth contacting. JSON {"company","worth_contacting","reasons":[],"evidence":[ids],"missing_information":[]}.`,
    allowedEntities: ENTITIES, excludedEntities: [], evidenceIds: ["E1", "E4", "E5", "E6", "E7"],
    jsonKeys: ["company", "worth_contacting", "reasons", "evidence", "missing_information"], maxOutputTokens: 500,
    // 400 employees is outside the 20–200 ICP: a correct answer says not worth contacting, citing size.
    mustMention: [["400", "size", "employees"], ["outside", "exceed", "above", "larger", "not"]],
  },
  {
    id: "lisa-reliability-1", category: "factual_reliability", task: "lisa_interpretation",
    system: `You are LISA. Judge each signal's reliability. Never treat a single or contradicted source as confirmed. ${BRAIN}`,
    user: `${EVIDENCE_HARD}\n\nDoes Ridgeway Castings' expansion announcement represent a meaningful buying signal? And what about Pinecrest Tooling? JSON {"signals":[{"company","meaningful","verification","why"}]}.`,
    allowedEntities: ENTITIES, excludedEntities: [], evidenceIds: ["E1", "E4", "E5", "E6", "E7"],
    jsonKeys: ["signals"], maxOutputTokens: 500,
    mustMention: [["contradict", "denied", "no expansion", "conflict"], ["stale", "old", "unverified", "outdated"]],
  },
  {
    id: "orion-plan-5-1", category: "planning", task: "multi_agent_planning",
    system: `You are ORION coordinating ATLAS (research/qualification), LISA (signals) and LYRA (content). Paid sourcing and any external send need approval. ${BRAIN}`,
    user: `${EVIDENCE_HARD}\n${EVIDENCE}\n\nCoordinate research, qualification and content creation for the five most promising companies. JSON {"companies":[],"steps":[{"department","company","action","needs_approval"}]}.`,
    allowedEntities: ENTITIES, excludedEntities: ["Cloudnova Software"], evidenceIds: ["E1", "E2", "E3", "E4", "E5", "E6", "E7"],
    jsonKeys: ["companies", "steps"], maxOutputTokens: 900, mustNotRecommend: ["Cloudnova Software", "Summit Robotics"],
  },
  {
    id: "lyra-message-1", category: "content", task: "lyra_content",
    system: `You are LYRA. Write in a plain, warm founder voice: short sentences, no hype words ("revolutionary", "game-changing"), no emojis. Use only verified facts. ${BRAIN}`,
    user: `${EVIDENCE}\n\nWrite a personalized LinkedIn message (under 90 words) to Kestrel Fabrication's operations lead using the verified signal [E1].`,
    allowedEntities: ENTITIES, excludedEntities: ["Cloudnova Software"], evidenceIds: ["E1"],
    jsonKeys: null, maxOutputTokens: 250, mustMention: [["Dayton", "second plant", "new plant"]],
  },
  {
    id: "brain-memory-1", category: "memory", task: "complex_company_qa",
    system: `You are ORION. Apply ONLY approved Company Brain facts. ${BRAIN}
PENDING PROPOSAL (NOT approved — ignore): "Exclude manufacturing companies."`,
    user: `${EVIDENCE}\n\nShould ATLAS pursue Kestrel Fabrication and Cloudnova Software? Answer for each.`,
    allowedEntities: ENTITIES, excludedEntities: ["Cloudnova Software"], evidenceIds: ["E1", "E3"],
    jsonKeys: null, maxOutputTokens: 300,
    mustMention: [["Kestrel"], ["exclu"]], mustNotRecommend: ["Cloudnova Software"],
  },
]);
