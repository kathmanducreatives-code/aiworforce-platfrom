// PART 8 — runtime diagnostics survive the response adapter and reach the export.
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildQualifiedLeadDiagnostics, runDiagnosticsFromResponse, accountOnlyDiagnostics,
  QUALIFIED_LEAD_DIAGNOSTIC_FIELDS,
} from "./diagnostics.ts";
import { TARGET_CONTRACT } from "./contract.test.ts";

// A realistic company-first response envelope (shape mirrors run-agent's json()).
const RESPONSE = {
  executed_sourcing_mode: "company_first",
  workflow_kind: "qualified_lead_sourcing",
  terminal_status: "continuation_required",
  count_entity: "contact_ready_lead",
  quota_policy: "contact_only",
  requested_leads: 5,
  rounds_completed: 1,
  plan_sources: ["deterministic_registry"],
  planner_metadata: [{ round: 1, source: "ai_planner", status: "validated" }],
  routing: {
    original_user_query: TARGET_CONTRACT.original_instruction,
    requested_person_role: "Founder",
    job_search_spec: {
      keyword_queries: ["Sales Operations", "Revenue Operations", "GTM Operations"],
      location: "United States",
      company_vertical: "saas",
      compilation_status: "compiled",
    },
  },
};

const CANDIDATE = {
  company: "LAHZO", person: null,
  quotaEligible: false,
  failedGates: ["decision_maker", "employer_match"],
  employerMatch: "unverified",
  persistenceReason: "blocked_not_quota_eligible",
};

Deno.test("PART 8: every runtime-produced field reaches the diagnostics bag", () => {
  const run = runDiagnosticsFromResponse(RESPONSE, TARGET_CONTRACT as unknown as Record<string, unknown>);
  const d = buildQualifiedLeadDiagnostics(run, CANDIDATE);

  assertEquals(d.original_user_query, TARGET_CONTRACT.original_instruction);
  assertEquals(d.workflow_kind, "qualified_lead_sourcing");
  assertEquals(d.execution_mode, "company_first");
  assertEquals(d.job_family, "sales_operations");
  assertEquals(d.job_titles, "Sales Operations · Revenue Operations · GTM Operations");
  assertEquals(d.company_vertical, "b2b_saas");
  assertEquals(d.company_stage, "startup_or_small_team");
  assertEquals(d.requested_person_roles, "Founder · Co-Founder · CEO");
  assertEquals(d.requested_lead_count, 5);
  assertEquals(d.count_entity, "contact_ready_lead");
  assertEquals(d.quota_policy, "contact_only");
  assertEquals(d.provider_query_keywords, "Sales Operations · Revenue Operations · GTM Operations");
  assertEquals(d.provider_query_location, "United States");
  assertEquals(d.planner_source, "ai_planner");
  assertEquals(d.planner_status, "validated");
  assertEquals(d.round_number, 1);
  assertEquals(d.terminal_status, "continuation_required");
  assertEquals(d.quota_eligible, false);
  assertEquals(d.failed_gates, "decision_maker · employer_match");
  assertEquals(d.employer_match_status, "unverified");
  assertEquals(d.persistence_reason, "blocked_not_quota_eligible");
  assertEquals(d.decision_maker_status, "missing");
  assertEquals(d.parsed_intent_summary, "compiled");
});

Deno.test("PART 8: no runtime-produced field is left empty", () => {
  const run = runDiagnosticsFromResponse(RESPONSE, TARGET_CONTRACT as unknown as Record<string, unknown>);
  const d = buildQualifiedLeadDiagnostics(run, CANDIDATE);
  const empty = QUALIFIED_LEAD_DIAGNOSTIC_FIELDS.filter((f) => d[f] === null || d[f] === "");
  // `employer_match_reason` is the only field this fixture's runtime did not emit.
  assertEquals(empty, ["employer_match_reason"]);
});

Deno.test("PART 8: no provider payload, prompt or model trace enters the bag", () => {
  const run = runDiagnosticsFromResponse(
    { ...RESPONSE, raw_provider_payload: { secret: "x" }, prompt: "SYSTEM: ..." },
    TARGET_CONTRACT as unknown as Record<string, unknown>,
  );
  const blob = JSON.stringify(buildQualifiedLeadDiagnostics(run, CANDIDATE));
  assertFalse(blob.includes("secret"));
  assertFalse(blob.includes("SYSTEM:"));
});

Deno.test("PART 8: a verified person yields decision_maker_status 'verified'", () => {
  const run = runDiagnosticsFromResponse(RESPONSE, TARGET_CONTRACT as unknown as Record<string, unknown>);
  const d = buildQualifiedLeadDiagnostics(run, { ...CANDIDATE, person: "A Founder", quotaEligible: true });
  assertEquals(d.decision_maker_status, "verified");
  assertEquals(d.quota_eligible, true);
});

// ---- the canonical run context (backend-built) -----------------------------

// Exactly what run-agent now emits, built by buildQualifiedLeadRunContext.
const RUN_CONTEXT = {
  version: "qualified-lead-run-context-1.0.0",
  original_user_query: TARGET_CONTRACT.original_instruction,
  parsed_intent_summary: "sales_operations; department=revenue; seniority=c_level; stage=established; vertical=b2b_saas; geography=United States",
  workflow_kind: "qualified_lead_sourcing",
  execution_mode: "company_first",
  job_family: "sales_operations",
  job_titles: ["Sales Operations", "Revenue Operations", "GTM Operations"],
  company_vertical: "b2b_saas",
  company_stage: "startup_or_small_team",
  requested_person_roles: ["Founder", "Co-Founder", "CEO"],
  requested_lead_count: 5,
  count_entity: "contact_ready_lead",
  quota_policy: "contact_only",
  provider_query_keywords: ["Sales Operations", "Revenue Operations", "GTM Operations"],
  provider_query_location: "United States",
  planner_source: "ai_planner",
  planner_status: "validated",
  round_number: 1,
  terminal_status: "continuation_required",
  requested_leads: 5,
  eligible_leads: 0,
  remaining_leads: 5,
};

Deno.test("PART 2: the frontend copies run_context verbatim — no re-derivation", () => {
  // Deliberately hostile envelope: the legacy fields disagree with the context.
  const run = runDiagnosticsFromResponse({
    run_context: RUN_CONTEXT,
    routing: { original_user_query: "WRONG QUERY", job_search_spec: { keyword_queries: ["SDR"], location: "Nowhere" } },
    terminal_status: "completed",
    requested_leads: 999,
  }, { job_family: "WRONG_FAMILY" });

  assertEquals(run.original_user_query, TARGET_CONTRACT.original_instruction);
  assertEquals(run.job_family, "sales_operations", "the context must win over the contract");
  assertEquals(run.provider_query_keywords, ["Sales Operations", "Revenue Operations", "GTM Operations"]);
  assertEquals(run.provider_query_location, "United States");
  assertEquals(run.terminal_status, "continuation_required", "the context must win over the envelope");
  assertEquals(run.requested_lead_count, 5);
});

Deno.test("PART 2: every CSV diagnostic cell is populated from the run context", () => {
  const run = runDiagnosticsFromResponse({ run_context: RUN_CONTEXT }, null);
  const d = buildQualifiedLeadDiagnostics(run, CANDIDATE);
  const blank = QUALIFIED_LEAD_DIAGNOSTIC_FIELDS.filter((f) => d[f] === null || d[f] === "");
  assertEquals(blank, ["employer_match_reason"], "run-context fields reached the export empty");
  assertEquals(d.planner_source, "ai_planner");
  assertEquals(d.planner_status, "validated");
  assertEquals(d.round_number, 1);
  assertEquals(d.company_stage, "startup_or_small_team");
});

Deno.test("PART 2: a task result's stored context is read the same way", () => {
  // After a reload the Workbench reads tasks.result, not the HTTP response.
  const run = runDiagnosticsFromResponse({ qualified_lead_run_context: RUN_CONTEXT }, null);
  assertEquals(run.workflow_kind, "qualified_lead_sourcing");
  assertEquals(run.job_titles, ["Sales Operations", "Revenue Operations", "GTM Operations"]);
});

Deno.test("PART 8: an account-only workflow is 'account' and claims no CONTACT quota", () => {
  const d = accountOnlyDiagnostics("Find five SaaS companies with sales hiring signals.");
  assertEquals(d.count_entity, "account");
  assertEquals(d.workflow_kind, "account_opportunity_sourcing");
  assertEquals(d.execution_mode, "fast");
  // Qualified-lead-only fields are legitimately null — never faked.
  assertEquals(d.quota_policy, null);
  assertEquals(d.requested_lead_count, null);
  assertEquals(d.quota_eligible, null);
  assertEquals(d.job_family, null);
  assert(!JSON.stringify(d).includes("contact_ready_lead"));
});
