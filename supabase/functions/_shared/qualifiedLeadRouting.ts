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

import { inferVertical, type CompanyVertical as TaxonomyVertical } from "./jobIntentTaxonomy.ts";

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

// --------------------------------------------------------- contract vocabulary
//
// The preview renders from the CONTRACT, never from the generated workflow title,
// so the vocabulary has to be canonical and stable rather than whatever wording
// the industry string happened to carry.

export type CompanyVertical = TaxonomyVertical | null;
export type CompanyStage = "startup_or_small_team" | "growth_stage" | "enterprise" | null;

/**
 * Canonical vertical for the contract.
 *
 * Delegates to the ONE rule table in the taxonomy, so the preview the user
 * approves and the family the runtime searches can never disagree about the
 * industry. Returns "other" — not null — when text was supplied but matched
 * nothing, which is how the contract distinguishes "unrecognised" from "unstated".
 */
export function normalizeCompanyVertical(...sources: Array<string | null | undefined>): CompanyVertical {
  const text = sources.filter(Boolean).join(" ");
  if (!text.trim()) return null;
  return inferVertical(text) ?? "other";
}

const STAGE_RULES: Array<[Exclude<CompanyStage, null>, RegExp]> = [
  ["startup_or_small_team", /\b(startups?|early[-\s]stage|seed|small (?:team|business|compan(?:y|ies))|smb|founder[-\s]led)\b/i],
  ["growth_stage", /\b(growth[-\s]stage|scale[-\s]?ups?|series [b-d]\b|mid[-\s]market)\b/i],
  ["enterprise", /\b(enterprises?|fortune 500|large (?:compan(?:y|ies)|organi[sz]ations?))\b/i],
];

/** Canonical stage, or null when the request never constrained company size. */
export function inferCompanyStage(...sources: Array<string | null | undefined>): CompanyStage {
  const text = sources.filter(Boolean).join(" ");
  if (!text.trim()) return null;
  for (const [key, re] of STAGE_RULES) if (re.test(text)) return key;
  return null;
}

/**
 * The titles the preview shows and the runtime searches for.
 *
 * The UI role families are coarse: `gtm_sales` leads with SDR/BDR, so a request
 * for a manufacturer's FIRST SALESPERSON would have previewed "SDR, BDR, Sales
 * Development Representative" — titles that company never posts. The backend
 * registry is the more precise source when it recognises the request, so it wins;
 * the UI alias set is the fallback.
 */
export function contractJobTitles(
  uiFamilyAliases: string[],
  registryExactTitles: string[] | null | undefined,
): string[] {
  const registry = (registryExactTitles ?? []).filter(Boolean);
  return (registry.length ? registry : uiFamilyAliases).slice(0, 3);
}

/**
 * The structured contract carried through Start Workflow → orchestrate →
 * run-agent. Emitted by Pilot; rendered verbatim by the workflow preview.
 */
export interface QualifiedLeadContract {
  workflow_kind: "qualified_lead_sourcing";
  execution_mode: "company_first";
  target_entity: "company_and_person";
  signal_type: string;
  job_family: string | null;
  job_titles: string[];
  company_vertical: CompanyVertical;
  company_stage: CompanyStage;
  geography: string[];
  requested_person_roles: string[];
  current_employer_required: true;
  requested_lead_count: number;
  count_entity: "contact_ready_lead";
  quota_policy: "contact_only";
  original_instruction: string;
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
