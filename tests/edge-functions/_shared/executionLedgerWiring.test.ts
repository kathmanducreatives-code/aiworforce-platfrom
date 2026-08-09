// THE LEDGER'S SCHEMA AND ITS WIRING.
//
// Two things the unit tests cannot cover:
//
//   1. the migration actually declares the columns, constraints and indexes the
//      module depends on — a ledger whose table disagrees with its writer is
//      worse than no ledger;
//   2. both execution paths reach it through ONE layer, which is the property a
//      future people-first migration needs in order to compare them.
//
// Offline: the migration is read as text and the wiring as source.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildStartedRow, inferStage, LEAD_EXECUTION_CALLS_TABLE,
  type ExecutionCallSpec,
} from "../../../supabase/functions/_shared/executionLedger.ts";

const MIGRATION = new URL(
  "../../../supabase/migrations/20260810090000_lead_execution_calls.sql", import.meta.url);
// Planner provenance and record_kind arrived in a follow-up migration, so the
// "every column exists" check reads the whole schema, not one file.
const MIGRATION_2 = new URL(
  "../../../supabase/migrations/20260810100000_lead_execution_calls_provenance.sql", import.meta.url);
async function schemaSql(): Promise<string> {
  return (await Deno.readTextFile(MIGRATION)) + "\n" + (await Deno.readTextFile(MIGRATION_2));
}
const TOOL_REGISTRY = new URL(
  "../../../supabase/functions/_shared/toolRegistry.ts", import.meta.url);
const RUN_AGENT = new URL(
  "../../../supabase/functions/run-agent/index.ts", import.meta.url);

// ═══ MIGRATION ════════════════════════════════════════════════════════════

Deno.test("migration: every column the writer sets exists in the table", async () => {
  const sql = await schemaSql();
  const row = buildStartedRow({
    workspace_id: "w", stage: "company_discovery", reason: "initial_discovery",
    provider_id: "apify", logical_call_key: "k",
  });

  // `version` is a module constant carried on the in-memory row for forward
  // compatibility, not a column — everything else must be declared.
  for (const column of Object.keys(row).filter((k) => k !== "version")) {
    assert(new RegExp(`\\b${column}\\b`).test(sql),
      `the writer sets "${column}" but the migration does not declare it`);
  }
});

Deno.test("migration: attempts cannot overwrite each other", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  assert(/CREATE UNIQUE INDEX[\s\S]*?\(workspace_id, logical_call_key, attempt_number\)/.test(sql),
    "one row per attempt must be a constraint, not a convention");
});

Deno.test("migration: an estimate cannot be recorded as an actual cost", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  assert(sql.includes("lead_execution_calls_actual_cost_requires_provider"),
    "the database must enforce the cost distinction the module enforces");
  assert(/actual_cost_usd IS NULL OR cost_source = 'provider_reported'/.test(sql));
});

Deno.test("migration: status and cost_source are constrained to known values", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  for (const v of ["started", "succeeded", "failed", "timed_out", "reused"]) {
    assert(sql.includes(`'${v}'`), `status "${v}" must be permitted`);
  }
  for (const v of ["provider_reported", "estimated", "unknown"]) {
    assert(sql.includes(`'${v}'`), `cost_source "${v}" must be permitted`);
  }
});

Deno.test("migration: counts are nullable so 'unknown' survives into the database", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  for (const c of [
    "raw_count", "normalized_count", "unique_count", "accepted_count", "rejected_count",
  ]) {
    // A NOT NULL or a DEFAULT 0 on any of these would turn "never looked" into
    // "found none" at the storage layer.
    assert(!new RegExp(`${c}\\s+integer[^,]*NOT NULL`).test(sql), `${c} must stay nullable`);
    assert(!new RegExp(`${c}\\s+integer[^,]*DEFAULT\\s+0`).test(sql), `${c} must not default to 0`);
  }
});

Deno.test("migration: workspace isolation and read-only members", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  assert(sql.includes("workspace_id uuid NOT NULL REFERENCES public.workspaces(id)"),
    "every row must belong to a workspace");
  assert(sql.includes("ENABLE ROW LEVEL SECURITY"));
  assert(sql.includes("has_workspace_access(auth.uid(), workspace_id)"),
    "reads must be scoped to workspace membership, like other execution telemetry");
  assert(sql.includes("GRANT SELECT ON public.lead_execution_calls TO authenticated"));
  assert(sql.includes("GRANT ALL ON public.lead_execution_calls TO service_role"));

  // Members may READ but never author audit rows — a ledger a client can write is
  // not evidence.
  assert(!/POLICY[^;]*FOR INSERT TO authenticated/.test(sql),
    "authenticated clients must not be able to insert audit rows");
  assert(!/POLICY[^;]*FOR UPDATE TO authenticated/.test(sql));
});

Deno.test("migration: the queries this table exists for are indexed", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  for (const idx of ["task_id", "workspace_id, started_at", "provider_id"]) {
    assert(sql.includes(idx), `expected an index covering ${idx}`);
  }
});

Deno.test("migration: tool_calls is left alone", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  assert(!/ALTER TABLE[^;]*tool_calls/i.test(sql),
    "the idempotency mechanism reads tool_calls; this migration must not touch it");
  assert(!/DROP\s+(TABLE|COLUMN|POLICY)/i.test(sql),
    "an observability migration must be purely additive");
});

// ═══ ONE LAYER, BOTH PATHS ════════════════════════════════════════════════

Deno.test("wiring: both execution paths funnel through the instrumented seam", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  // company-first jobs, company-first people, generic adaptive sourcing.
  const calls = src.split('runTool("source_with_apify"').length - 1;
  assertEquals(calls, 3,
    "three provider entry points are expected: company-first jobs, company-first " +
    "people, and the generic adaptive loop. A new one must be instrumented too.");
});

Deno.test("wiring: the ledger is applied once, in runTool, not per adapter", async () => {
  const registry = await Deno.readTextFile(TOOL_REGISTRY);
  assertEquals(registry.split("withExecutionAudit(").length - 1, 1,
    "one call site keeps this an observability LAYER rather than 15 sprinkled inserts");
  assert(registry.includes('tool.name === "source_with_apify"'),
    "instrumentation must be scoped to the paid provider boundary");
  // The ledger must not be reachable from provider adapters directly.
  assert(!registry.includes("from(\"lead_execution_calls\")"),
    "no raw table access outside the ledger module");
});

Deno.test("wiring: the ledger writes through its own module, never inline SQL", async () => {
  const registry = await Deno.readTextFile(TOOL_REGISTRY);
  assert(registry.includes("createLedgerWriter("),
    "the writer must come from the ledger module");
  assert(registry.includes("outcomeFromToolResult("),
    "provider results must be translated in one place");
});

Deno.test("wiring: the ledger cannot influence what runs", async () => {
  const registry = await Deno.readTextFile(TOOL_REGISTRY);
  // The audited branch and the plain branch must both simply execute the tool.
  // If the ledger ever gates execution, this phrase stops being true.
  assert(registry.includes("const executeOnce = async ()"),
    "execution must be a plain closure the ledger wraps, not a decision it makes");
  const module = await Deno.readTextFile(new URL(
    "../../../supabase/functions/_shared/executionLedger.ts", import.meta.url));
  for (const name of ["selectProvider", "decideRetry", "shouldBroaden", "computeQuota"]) {
    assert(!module.includes(name), `the ledger must not contain ${name} — it observes only`);
  }
});

// ═══ SAME SCHEMA FOR BOTH PATHS ═══════════════════════════════════════════

Deno.test("both paths produce the same row shape", () => {
  const companyFirst: ExecutionCallSpec = {
    workspace_id: "w", task_id: "t", plan_id: "p",
    execution_owner: "company_first_v1", planner_owner: "gpt_lead_strategy_v1",
    stage: inferStage("hiring_verification", "jobs"),
    capability: "hiring_verification", reason: "fill_required_evidence",
    provider_id: "apify", actor_id: "curious_coder/linkedin-jobs-scraper",
    request_input: { keywords: ["Sales Operations"] },
    logical_call_key: "t:hiring_verification:h1",
  };
  const peopleFirst: ExecutionCallSpec = {
    workspace_id: "w", task_id: "t2", plan_id: null,
    execution_owner: "generic_sourcing_v1", planner_owner: null,
    stage: "generic_sourcing", capability: null, reason: "broadened_retry",
    provider_id: "apify", actor_id: "harvestapi/linkedin-profile-search",
    request_input: { role_keywords: ["Founder"] },
    logical_call_key: "t2:generic_sourcing:h2",
  };

  const a = buildStartedRow(companyFirst);
  const b = buildStartedRow(peopleFirst);
  assertEquals(Object.keys(a).sort(), Object.keys(b).sort(),
    "one ledger, one schema — not companyFirstAudit and peopleFirstAudit");
  assertEquals(a.status, b.status);
  assertEquals(a.version, b.version);
  assertEquals(LEAD_EXECUTION_CALLS_TABLE, "lead_execution_calls");
});
