// PART 8 — the CSV serializer's qualified-lead columns.
//
// `leadTable/csv.ts` imports browser APIs (Blob/document) and the Supabase
// client transitively, so it cannot be imported into a Deno test. The column
// list and cell values it emits are therefore pure and live here; the wiring is
// asserted against the serializer's SOURCE, the same technique the backend
// boundary proofs use.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  QUALIFIED_LEAD_EXTRA_COLUMNS, EXISTING_TRACE_COLUMNS,
  QUALIFIED_LEAD_DIAGNOSTIC_FIELDS, qualifiedLeadCells,
  type RunDiagnosticsSource,
} from "./diagnostics.ts";

const CSV_SOURCE = await Deno.readTextFile(
  new URL("../../components/chat/workspace/workbench/leadTable/csv.ts", import.meta.url),
);

const RUN: RunDiagnosticsSource = {
  original_user_query: "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.",
  parsed_intent_summary: "compiled",
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
  planner_metadata: [{ round: 1, source: "ai_planner", status: "validated" }],
  terminal_status: "continuation_required",
  rounds_completed: 1,
};

const CANDIDATE = {
  quota_eligible: false,
  failed_gates: ["decision_maker"],
  employer_match_status: "unverified",
  employer_match_reason: "no_current_employer_evidence",
  persistence_reason: "blocked_not_quota_eligible",
  decision_maker_status: "missing",
};

const cell = (field: string) =>
  qualifiedLeadCells(RUN, CANDIDATE)[QUALIFIED_LEAD_EXTRA_COLUMNS.indexOf(field as never)];

Deno.test("PART 8: no qualified-lead column duplicates an existing CSV header", () => {
  for (const f of EXISTING_TRACE_COLUMNS) {
    assertFalse(QUALIFIED_LEAD_EXTRA_COLUMNS.includes(f), `${f} would be a duplicate header`);
    // …but it IS still a diagnostics field — it just already has a column.
    assert(QUALIFIED_LEAD_DIAGNOSTIC_FIELDS.includes(f));
    assertEquals(CSV_SOURCE.split(`'${f}'`).length - 1, 1, `${f} appears more than once in the header list`);
  }
  const dupes = QUALIFIED_LEAD_EXTRA_COLUMNS.filter((f, i) => QUALIFIED_LEAD_EXTRA_COLUMNS.indexOf(f) !== i);
  assertEquals(dupes, []);
});

Deno.test("PART 8: every required diagnostic has a home in the export", () => {
  const covered = new Set<string>([...QUALIFIED_LEAD_EXTRA_COLUMNS, ...EXISTING_TRACE_COLUMNS]);
  for (const f of QUALIFIED_LEAD_DIAGNOSTIC_FIELDS) assert(covered.has(f), `uncovered field: ${f}`);
  assertEquals(QUALIFIED_LEAD_EXTRA_COLUMNS.length + EXISTING_TRACE_COLUMNS.length, QUALIFIED_LEAD_DIAGNOSTIC_FIELDS.length);
});

Deno.test("PART 8: cells align with columns and carry the runtime's own values", () => {
  const cells = qualifiedLeadCells(RUN, CANDIDATE);
  assertEquals(cells.length, QUALIFIED_LEAD_EXTRA_COLUMNS.length);
  assertEquals(cell("workflow_kind"), "qualified_lead_sourcing");
  assertEquals(cell("execution_mode"), "company_first");
  assertEquals(cell("job_family"), "sales_operations");
  assertEquals(cell("job_titles"), "Sales Operations · Revenue Operations · GTM Operations");
  assertEquals(cell("company_vertical"), "b2b_saas");
  assertEquals(cell("company_stage"), "startup_or_small_team");
  assertEquals(cell("requested_person_roles"), "Founder · Co-Founder · CEO");
  assertEquals(cell("requested_lead_count"), 5);
  assertEquals(cell("count_entity"), "contact_ready_lead");
  assertEquals(cell("quota_policy"), "contact_only");
  assertEquals(cell("planner_source"), "ai_planner");
  assertEquals(cell("planner_status"), "validated");
  assertEquals(cell("round_number"), 1);
  assertEquals(cell("terminal_status"), "continuation_required");
  assertEquals(cell("quota_eligible"), false, "false must be exported, not dropped");
  assertEquals(cell("failed_gates"), "decision_maker");
  assertEquals(cell("employer_match_status"), "unverified");
  assertEquals(cell("employer_match_reason"), "no_current_employer_evidence");
  assertEquals(cell("persistence_reason"), "blocked_not_quota_eligible");
});

Deno.test("PART 8: an account-only export invents no qualified-lead values", () => {
  const cells = qualifiedLeadCells({ original_user_query: "Find five SaaS companies with sales hiring signals.", count_entity: "account", workflow_kind: "account_opportunity_sourcing" }, null);
  const byName = Object.fromEntries(QUALIFIED_LEAD_EXTRA_COLUMNS.map((f, i) => [f, cells[i]]));
  assertEquals(byName.count_entity, "account");
  for (const f of ["quota_policy", "requested_lead_count", "job_family", "quota_eligible", "failed_gates"]) {
    assertEquals(byName[f], null, `${f} must stay null for an account-only export`);
  }
});

// ---- wiring proof ----------------------------------------------------------

Deno.test("PART 8 WIRING: the serializer appends the columns and their cells", () => {
  assert(CSV_SOURCE.includes("QUALIFIED_LEAD_EXTRA_COLUMNS"), "csv.ts does not import the column list");
  assert(CSV_SOURCE.includes("...QUALIFIED_LEAD_EXTRA_COLUMNS,"), "columns are not appended to the header row");
  assert(CSV_SOURCE.includes("...QUALIFIED_LEAD_EXTRA_COLUMNS.map((f) => esc(diag[f]))"), "cells are not appended to each row");
  assert(CSV_SOURCE.includes("buildQualifiedLeadDiagnostics(run,"), "per-row diagnostics are not built");
  // The export signature must accept the run context.
  assert(/rowsToCsv\(rows: LeadTableRow\[\], run\?: RunDiagnosticsSource \| null\)/.test(CSV_SOURCE));
  // Pre-existing trace columns are backfilled rather than left blank.
  assert(CSV_SOURCE.includes("raw.original_user_query ?? diag.original_user_query"));
  assert(CSV_SOURCE.includes("raw.provider_query_location ?? diag.provider_query_location"));
});

Deno.test("PART 8 WIRING: the Workbench threads the run context into the export", async () => {
  const view = await Deno.readTextFile(
    new URL("../../components/chat/workspace/workbench/LeadResultsView.tsx", import.meta.url),
  );
  assert(view.includes("rowsToCsv(rows, meta.qualified_lead_run ?? null)"), "export drops the run context");
});
