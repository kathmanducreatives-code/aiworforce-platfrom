// EVIDENCE PLANNER (P1) — prompt contract + strict parser. Pure.
//
// NOT INVOKED IN PRODUCTION AT P1. This module defines the contract and the
// validation; wiring the model call is P2. Keeping the parser separate and pure
// means the guardrails are testable with fixtures before a single token is
// spent, which is the point of a dry-run phase.
//
// ── WHAT THE MODEL IS ALLOWED TO DECIDE ────────────────────────────────────
//
//   research_question : one sentence, what would answer this requirement
//   page_intents      : which KINDS of page would carry that answer
//
// ── WHAT IT IS NOT ─────────────────────────────────────────────────────────
//
//   the domain, any URL, the page budget, the freshness window, whether to
//   spend at all. Those arrive from code, and `parseEvidencePlanStrict`
//   OVERWRITES them from the caller's own values rather than reading them out
//   of the model's reply. A model that emits a URL does not get one honoured;
//   the field does not exist in the parsed shape.
//
// ── WHY AN EMPTY PLAN IS A GOOD ANSWER ─────────────────────────────────────
//
// Some requirements are not publicly documented — private revenue, internal
// tooling, unannounced plans. `page_intents: []` is the model saying so, and it
// routes to a truthful `insufficient_evidence` at zero cost. A planner that
// could never say "no page will answer this" would spend money pretending.

import {
  EVIDENCE_REQUEST_VERSION,
  evidenceRequestId,
  isPageIntent,
  PAGE_INTENTS,
  type EvidenceRequestV1,
  type PageIntent,
} from "./evidenceRequest.ts";
import type { EvidenceDebt } from "./webEvidenceDebt.ts";

export const EVIDENCE_PLANNER_VERSION = "evidence-planner-v1" as const;

/** Code-owned budget applied to every parsed plan. */
export interface PlannerBudget {
  max_pages: number;
  freshness_window_hours: number;
  /** Hard cap on intents per company, applied after parsing. */
  max_intents: number;
}

export const DEFAULT_PLANNER_BUDGET: Readonly<PlannerBudget> = Object.freeze({
  max_pages: 3,
  freshness_window_hours: 720,
  max_intents: 3,
});

export type PlanRejection =
  | "unknown_company"
  | "no_page_intents"
  | "invalid_page_intent"
  | "missing_research_question"
  | "duplicate_company";

export interface ParsedEvidencePlan {
  requests: EvidenceRequestV1[];
  /** Companies the model answered for that we could not accept, and why. */
  rejected: Array<{ company_key: string; reason: PlanRejection }>;
  /** Debts the model did not answer for at all. */
  unanswered: string[];
}

// ─────────────────────────────────── prompt ─────────────────────────────────

/**
 * The planner prompt.
 *
 * Deliberately says nothing about any specific requirement. It is handed the
 * requirement text and the evaluator's open question as DATA, and reasons from
 * them. There is no list of business models, industries or phrases anywhere in
 * this file — that absence is the feature.
 */
export const EVIDENCE_PLANNER_PROMPT = [
  "You are planning EVIDENCE COLLECTION. You are not making a decision about",
  "any company, and nothing you return qualifies or rejects anyone.",
  "",
  "For each company you are given:",
  "  - the mission requirement that is unresolved",
  "  - the specific open question the evaluator could not answer",
  "  - the kinds of evidence already held for that company",
  "",
  "Return, for each company:",
  "  research_question : ONE sentence, answerable from public web pages",
  "  page_intents      : ranked, most likely first, from the ALLOWED LIST ONLY",
  "",
  "ALLOWED PAGE INTENTS (use these exact strings, nothing else):",
  `  ${PAGE_INTENTS.join(", ")}`,
  "",
  "RULES",
  "- Choose page intents by what would ANSWER the open question for that",
  "  company. Different questions should produce different intents.",
  "- Never invent or name a URL, a domain, or a hostname.",
  "- Never propose a page intent outside the allowed list.",
  "- Do not repeat a kind of evidence already held.",
  "- Return at most 3 page intents per company.",
  "- If NO public web page could reasonably answer the question, return",
  "  page_intents: []. That is a correct and useful answer; do not guess.",
  "",
  "Return strict JSON: { \"plans\": [ { \"company_key\": string,",
  "\"research_question\": string, \"page_intents\": string[] } ] }",
].join("\n");

/**
 * What the model is shown. Assembled from decided values only — the debt gate
 * already established every field here, and nothing re-reads the user's
 * sentence.
 */
export interface EvidencePlannerInput {
  schema_version: typeof EVIDENCE_PLANNER_VERSION;
  companies: Array<{
    company_key: string;
    company_name: string | null;
    requirement_text: string;
    open_question: string;
    known_evidence_types: string[];
  }>;
}

export function buildEvidencePlannerInput(
  debts: readonly EvidenceDebt[],
): EvidencePlannerInput {
  return {
    schema_version: EVIDENCE_PLANNER_VERSION,
    companies: debts.map((d) => ({
      company_key: d.company_key,
      company_name: d.company_name,
      // The requirement and the open question are the SAME text at P1: the
      // evaluator's `unknown_fields` entry is the most precise statement of
      // what is missing that the system has. Kept as two fields because P4's
      // requirement_states will separate them.
      requirement_text: d.open_question,
      open_question: d.open_question,
      known_evidence_types: d.known_evidence_types,
    })),
  };
}

// ─────────────────────────────────── parser ─────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? v as Record<string, unknown>
    : null;
}

/**
 * Parse a planner reply into requests, strictly.
 *
 * Every budget field is taken from `budget`, never from the model. Every
 * company is matched back to a debt the gate approved — a plan for a company
 * that was never in debt is dropped as `unknown_company`, so a model cannot
 * widen the research set by inventing entries.
 */
export function parseEvidencePlanStrict(
  raw: unknown,
  debts: readonly EvidenceDebt[],
  budget: PlannerBudget = DEFAULT_PLANNER_BUDGET,
): ParsedEvidencePlan {
  const byKey = new Map(debts.map((d) => [d.company_key, d]));
  const requests: EvidenceRequestV1[] = [];
  const rejected: ParsedEvidencePlan["rejected"] = [];
  const answered = new Set<string>();

  const root = asRecord(raw);
  const plans = Array.isArray(root?.plans) ? root!.plans : [];

  for (const entry of plans) {
    const p = asRecord(entry);
    if (!p) continue;
    const key = typeof p.company_key === "string" ? p.company_key : "";
    const debt = byKey.get(key);

    // A plan for a company the gate did not approve. Dropped, not honoured.
    if (!debt) {
      if (key) rejected.push({ company_key: key, reason: "unknown_company" });
      continue;
    }
    if (answered.has(key)) {
      rejected.push({ company_key: key, reason: "duplicate_company" });
      continue;
    }
    answered.add(key);

    const question = typeof p.research_question === "string"
      ? p.research_question.trim()
      : "";
    if (!question) {
      rejected.push({ company_key: key, reason: "missing_research_question" });
      continue;
    }

    const rawIntents = Array.isArray(p.page_intents) ? p.page_intents : [];
    // An intent outside the vocabulary is a contract violation, not a typo to
    // be guessed at. The whole plan for that company is rejected rather than
    // silently narrowed, so the failure is visible in telemetry.
    if (rawIntents.some((x) => !isPageIntent(x))) {
      rejected.push({ company_key: key, reason: "invalid_page_intent" });
      continue;
    }
    const intents = [...new Set(rawIntents as PageIntent[])]
      .slice(0, budget.max_intents);

    // The model's honest "no page will answer this". Not a rejection of the
    // company — it routes to a truthful insufficient_evidence at zero cost.
    if (intents.length === 0) {
      rejected.push({ company_key: key, reason: "no_page_intents" });
      continue;
    }

    requests.push({
      version: EVIDENCE_REQUEST_VERSION,
      request_id: evidenceRequestId({
        domain: debt.domain,
        requirement_id: debt.requirement_id,
        page_intents: intents,
      }),
      company_key: debt.company_key,
      // CODE-SUPPLIED. Read from the debt, never from the model's reply.
      domain: debt.domain,
      requirement_id: debt.requirement_id,
      requirement_text: debt.open_question,
      research_question: question,
      page_intents: intents,
      known_evidence_types: debt.known_evidence_types,
      // CODE-SUPPLIED BUDGET. A model cannot raise its own limits.
      max_pages: Math.min(budget.max_pages, intents.length),
      freshness_window_hours: budget.freshness_window_hours,
      blocking_qualification: true,
    });
  }

  return {
    requests,
    rejected,
    unanswered: debts
      .map((d) => d.company_key)
      .filter((k) => !answered.has(k)),
  };
}
