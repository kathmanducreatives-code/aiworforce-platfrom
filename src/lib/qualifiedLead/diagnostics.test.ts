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
