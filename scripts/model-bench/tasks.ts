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
}

const BRAIN = `COMPANY BRAIN (approved): ICP = US manufacturing companies, 20–200 employees.
EXCLUDED (approved): software companies; Cloudnova Software.`;

const EVIDENCE = `EVIDENCE:
[E1] Kestrel Fabrication (Ohio, 140 employees) announced a second plant in Dayton — kestrel-fab.example/news, 2026-10-30, verified (2 sources).
[E2] Harbor Valve Works (Texas, 85 employees) is hiring 12 machinists — jobs.example/harbor, 2026-11-02, single source.
[E3] Cloudnova Software raised a Series B — news.example/cloudnova, 2026-10-28, verified.
[E4] Pinecrest Tooling (Michigan, 60 employees) — a forum post claims a new CNC line; no company source — 2026-09-01, unverified.`;

const ENTITIES = ["Kestrel Fabrication", "Harbor Valve Works", "Pinecrest Tooling", "Cloudnova Software", "ORION", "ATLAS", "LISA", "LYRA"];

export const BENCH_TASKS: readonly BenchTask[] = Object.freeze([
  {
    id: "orion-priority-1", task: "orion_reasoning",
    system: `You are ORION. Answer only from the evidence. Cite evidence ids like [E1]. ${BRAIN}`,
    user: `${EVIDENCE}\n\nWhat should I prioritize this week? Reply as JSON {"executive_answer","why_it_matters","evidence":[ids],"recommended_actions":[],"uncertainty"}.`,
    allowedEntities: ENTITIES, excludedEntities: ["Cloudnova Software"], evidenceIds: ["E1", "E2", "E3", "E4"],
    jsonKeys: ["executive_answer", "why_it_matters", "evidence", "recommended_actions", "uncertainty"], maxOutputTokens: 700,
  },
  {
    id: "orion-plan-1", task: "executive_planning",
    system: `You are ORION planning work for ATLAS, LISA and LYRA. ${BRAIN}`,
    user: `${EVIDENCE}\n\nPlan the next steps to turn the expansion signals into qualified leads. JSON {"steps":[{"department","action","needs_approval"}]}.`,
    allowedEntities: ENTITIES, excludedEntities: ["Cloudnova Software"], evidenceIds: ["E1", "E2", "E3", "E4"],
    jsonKeys: ["steps"], maxOutputTokens: 600,
  },
  {
    id: "orion-qa-1", task: "complex_company_qa",
    system: `You are ORION. Answer only from the evidence and say what is unverified. ${BRAIN}`,
    user: `${EVIDENCE}\n\nIs Pinecrest Tooling's CNC expansion verified, and should ATLAS pursue it?`,
    allowedEntities: ENTITIES, excludedEntities: ["Cloudnova Software"], evidenceIds: ["E1", "E2", "E3", "E4"],
    jsonKeys: null, maxOutputTokens: 400,
  },
  {
    id: "atlas-qual-1", task: "atlas_qualification",
    system: `You are ATLAS qualifying companies against the ICP. ${BRAIN}`,
    user: `${EVIDENCE}\n\nQualify each company. JSON {"verdicts":[{"company","qualified","reason","evidence"}]}.`,
    allowedEntities: ENTITIES, excludedEntities: [], evidenceIds: ["E1", "E2", "E3", "E4"],
    jsonKeys: ["verdicts"], maxOutputTokens: 700,
  },
  {
    id: "lisa-interp-1", task: "lisa_interpretation",
    system: `You are LISA judging signal relevance to the ICP. ${BRAIN}`,
    user: `${EVIDENCE}\n\nFor each signal: JSON {"signals":[{"id","relevant","verification","why"}]}.`,
    allowedEntities: ENTITIES, excludedEntities: [], evidenceIds: ["E1", "E2", "E3", "E4"],
    jsonKeys: ["signals"], maxOutputTokens: 600,
  },
  {
    id: "lyra-post-1", task: "lyra_content",
    system: `You are LYRA writing a LinkedIn post in a plain founder voice. Use only verified facts. ${BRAIN}`,
    user: `${EVIDENCE}\n\nWrite a short LinkedIn post about the Midwest manufacturing expansion signal in [E1]. Do not name excluded companies.`,
    allowedEntities: ENTITIES, excludedEntities: ["Cloudnova Software"], evidenceIds: ["E1"],
    jsonKeys: null, maxOutputTokens: 400,
  },
]);
