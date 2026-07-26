// THE CANONICAL QUALIFIED-LEAD RUN CONTEXT.
//
// The runtime already produced every value below, but each surface rebuilt its
// own subset from a different place — the response envelope, `routing`, the
// compiled intent, or the persisted row. Fields that existed were rendered blank
// downstream, and a disappointing run could not be explained from the export.
//
// This is ONE object, built ONCE by run-agent, and carried unchanged through:
//
//   run-agent response  →  ui_panel  →  conversation result  →  Workbench  →  CSV
//
// Values are copied, never re-derived. A field is null only when the runtime
// genuinely did not produce it.
//
// Pure — no network, no model call.

import { summarizeJobIntent, type JobIntent } from "./jobIntentTaxonomy.ts";
import { inferCompanyStage } from "./qualifiedLeadRouting.ts";

export const RUN_CONTEXT_VERSION = "qualified-lead-run-context-1.0.0";

/** Every field the product surfaces are contractually required to show. */
export interface QualifiedLeadRunContext {
  version: string;
  original_user_query: string | null;
  parsed_intent_summary: string | null;
  workflow_kind: string | null;
  execution_mode: string | null;
  job_family: string | null;
  job_titles: string[];
  company_vertical: string | null;
  company_stage: string | null;
  requested_person_roles: string[];
  /** Seniority of the ROLE BEING HIRED. Empty means the request never said. */
  hiring_seniority: string[];
  /** Seniority of the PERSON TO CONTACT. Never mixed with the above. */
  decision_maker_seniority: string[];
  requested_lead_count: number | null;
  count_entity: string | null;
  quota_policy: string | null;
  provider_query_keywords: string[];
  provider_query_location: string | null;
  planner_source: string | null;
  planner_status: string | null;
  round_number: number | null;
  terminal_status: string | null;
  requested_leads: number | null;
  eligible_leads: number | null;
  remaining_leads: number | null;
}

/** The fields a caller must be able to prove are populated, not merely present. */
export const REQUIRED_RUN_CONTEXT_FIELDS = [
  "original_user_query", "parsed_intent_summary", "workflow_kind", "execution_mode",
  "job_family", "job_titles", "company_vertical", "company_stage",
  "requested_person_roles", "requested_lead_count", "count_entity", "quota_policy",
  "provider_query_keywords", "provider_query_location", "planner_source", "planner_status",
  "round_number", "terminal_status", "requested_leads", "eligible_leads", "remaining_leads",
] as const;

export interface RunContextInput {
  /** The compiled company-first result (executeRunAgentCompanyFirstSourcing). */
  result: {
    status: string;
    rounds_attempted: number;
    plan_sources?: string[];
    planner_metadata?: Array<{ round?: number; source?: string | null; status?: string | null }>;
    quota: { requested_leads: number; eligible_leads: number; remaining_leads: number; quota_policy: string };
    routing: {
      original_user_query: string;
      requested_person_role: string | null;
      job_search_spec: { keyword_queries: string[]; location: string | null; company_vertical: string | null; compilation_status: string };
    };
  };
  /** The composable taxonomy's reading of the same request. */
  jobIntent?: JobIntent | null;
  /** Person roles the intent compiler resolved, when it produced any. */
  requestedPersonRoles?: string[] | null;
  workflowKind?: string;
  countEntity?: string;
}

const firstNonEmpty = (...xs: Array<string | null | undefined>): string | null =>
  xs.find((x) => typeof x === "string" && x.trim().length > 0) ?? null;

/**
 * Build the run context from what the runtime actually returned.
 *
 * `planner_source` / `planner_status` come from the LAST round's planner
 * metadata when the AI planner ran, and otherwise from `plan_sources` — so a
 * deterministic round reports "deterministic", never an empty cell.
 */
export function buildQualifiedLeadRunContext(input: RunContextInput): QualifiedLeadRunContext {
  const r = input.result;
  const spec = r.routing.job_search_spec;
  const intent = input.jobIntent ?? null;
  const round = r.rounds_attempted > 0 ? r.rounds_attempted : null;

  const plannerForRound = (r.planner_metadata ?? []).find((m) => m && m.round === round)
    ?? (r.planner_metadata ?? [])[(r.planner_metadata ?? []).length - 1]
    ?? null;
  const planSources = r.plan_sources ?? [];

  return {
    version: RUN_CONTEXT_VERSION,
    original_user_query: firstNonEmpty(r.routing.original_user_query, intent?.original_query),
    // The taxonomy's own summary is the richest honest description of what we
    // understood; the compiler's status is the fallback.
    parsed_intent_summary: firstNonEmpty(
      intent ? summarizeJobIntent(intent) : null,
      spec.compilation_status,
    ),
    workflow_kind: input.workflowKind ?? "qualified_lead_sourcing",
    execution_mode: "company_first",
    job_family: intent?.family_key ?? null,
    // What was ACTUALLY sent to the provider — the single most useful field when
    // a run returns the wrong kind of company.
    job_titles: [...spec.keyword_queries],
    company_vertical: intent?.vertical ?? spec.company_vertical ?? null,
    // COMPANY stage (how big/mature the target company is) — deliberately not the
    // taxonomy's TEAM stage (whether this is a first hire). They are different
    // questions and the visible contract asks for the former.
    company_stage: inferCompanyStage(r.routing.original_user_query) ?? "unspecified",
    // DECISION-MAKER roles — who Agentory will contact. Deliberately NOT derived
    // from the hiring role: the two are separate entities in the request.
    requested_person_roles: input.requestedPersonRoles?.length
      ? [...input.requestedPersonRoles]
      : intent?.decision_maker.roles.length
        ? [...intent.decision_maker.roles]
        : (r.routing.requested_person_role ? [r.routing.requested_person_role] : []),
    hiring_seniority: intent ? [...intent.hiring_role.seniority] : [],
    decision_maker_seniority: intent ? [...intent.decision_maker.seniority] : [],
    requested_lead_count: r.quota.requested_leads,
    count_entity: input.countEntity ?? "contact_ready_lead",
    quota_policy: r.quota.quota_policy,
    provider_query_keywords: [...spec.keyword_queries],
    provider_query_location: spec.location ?? (intent?.geography?.[0] ?? null),
    planner_source: firstNonEmpty(plannerForRound?.source, planSources[planSources.length - 1], planSources[0]),
    planner_status: firstNonEmpty(plannerForRound?.status, planSources.length ? "deterministic" : null),
    round_number: round,
    terminal_status: r.status,
    requested_leads: r.quota.requested_leads,
    eligible_leads: r.quota.eligible_leads,
    remaining_leads: r.quota.remaining_leads,
  };
}



/** Fields that are null/empty. Empty array means the context is fully populated. */
export function missingRunContextFields(ctx: QualifiedLeadRunContext): string[] {
  return REQUIRED_RUN_CONTEXT_FIELDS.filter((f) => {
    const v = ctx[f];
    if (Array.isArray(v)) return v.length === 0;
    return v === null || v === undefined || v === "";
  });
}
