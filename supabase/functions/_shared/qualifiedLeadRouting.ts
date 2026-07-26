// QUALIFIED-LEAD ROUTING DECISION.
//
// The 2026-07-26 manual run asked for "founders … Return 5 qualified leads" and was
// routed to the legacy account-opportunity workflow in `fast` mode, so the whole
// company-first runtime (quota controller, employer verification, checkpoint/resume)
// was unreachable from the product.
//
// This module makes the choice DETERMINISTIC and explainable. It runs before any
// model/template output and wins over it: a request that explicitly names people to
// contact, or a final lead quota, is a qualified-lead request — never an
// account-only signal scan.

export type WorkflowKind = "account_opportunity_sourcing" | "qualified_lead_sourcing";
export type WorkflowExecutionMode = "fast" | "company_first";

export interface QualifiedLeadRoute {
  workflowKind: WorkflowKind;
  executionMode: WorkflowExecutionMode;
  reasonCodes: string[];
  /** What the requested count actually counts. */
  countEntity: "account_opportunity" | "contact_ready_lead";
  quotaPolicy: "contact_only" | "account_only";
}

/** Signals that the user wants PEOPLE they can contact, not just companies. */
const PERSON_TARGET_RE = /\b(founders?|co-?founders?|owners?|ceos?|presidents?|decision[-\s]?makers?|people to contact|contacts?|executives?)\b/i;
const QUALIFIED_LEAD_RE = /\b(qualified leads?|contact[-\s]?ready|verified contacts?|leads? i can contact|reach out to)\b/i;
const EMPLOYER_VERIFY_RE = /\b(current employer|currently works?|verified employer|still (?:at|works))\b/i;
/** "Return 5 qualified leads", "give me 10 leads", "5 contact-ready leads". */
const LEAD_QUOTA_RE = /\b(\d{1,3})\s+(?:qualified|contact[-\s]?ready|verified)?\s*leads?\b/i;
/** Explicitly account-shaped asks. */
const ACCOUNT_TARGET_RE = /\b(compan(?:y|ies)|accounts?|organi[sz]ations?|startups?|firms?)\b/i;

export function routeQualifiedLead(instruction: string | null | undefined): QualifiedLeadRoute {
  const text = String(instruction ?? "");
  const reasons: string[] = [];

  if (PERSON_TARGET_RE.test(text)) reasons.push(`person_target:${firstMatch(PERSON_TARGET_RE, text)}`);
  if (QUALIFIED_LEAD_RE.test(text)) reasons.push(`qualified_lead_phrase:${firstMatch(QUALIFIED_LEAD_RE, text)}`);
  if (EMPLOYER_VERIFY_RE.test(text)) reasons.push("current_employer_required");
  const quota = LEAD_QUOTA_RE.exec(text);
  if (quota) reasons.push(`lead_quota:${quota[1]}`);

  if (reasons.length > 0) {
    return {
      workflowKind: "qualified_lead_sourcing",
      executionMode: "company_first",
      reasonCodes: reasons,
      countEntity: "contact_ready_lead",
      quotaPolicy: "contact_only",
    };
  }

  if (ACCOUNT_TARGET_RE.test(text)) reasons.push("account_target_only");
  return {
    workflowKind: "account_opportunity_sourcing",
    executionMode: "fast",
    reasonCodes: reasons.length ? reasons : ["no_person_or_quota_signal"],
    countEntity: "account_opportunity",
    quotaPolicy: "account_only",
  };
}

/** The final-lead quota when the request states one ("Return 5 qualified leads"). */
export function extractRequestedLeadCount(instruction: string | null | undefined): number | null {
  const m = LEAD_QUOTA_RE.exec(String(instruction ?? ""));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}

function firstMatch(re: RegExp, s: string): string {
  const m = new RegExp(re.source, re.flags.replace("g", "")).exec(s);
  return (m?.[0] ?? "").toLowerCase();
}
