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

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildStartedRow, createLedgerWriter, describeDbError, inferStage,
  LEAD_EXECUTION_CALLS_TABLE, type ExecutionCallSpec,
} from "../../../supabase/functions/_shared/executionLedger.ts";

const MIGRATION = new URL(
  "../../../supabase/migrations-archive/20260810090000_lead_execution_calls.sql", import.meta.url);
// Planner provenance and record_kind arrived in a follow-up migration, so the
// "every column exists" check reads the whole schema, not one file.
const MIGRATION_2 = new URL(
  "../../../supabase/migrations-archive/20260810100000_lead_execution_calls_provenance.sql", import.meta.url);
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
  //
  // THIS EXEMPTION WAS RIGHT AND NOT ENOUGH. It was right that `version` is not
  // a column; it assumed something removed it before the insert, and nothing
  // did. See the test below, which asserts the strip rather than trusting it.
  for (const column of Object.keys(row).filter((k) => k !== "version")) {
    assert(new RegExp(`\\b${column}\\b`).test(sql),
      `the writer sets "${column}" but the migration does not declare it`);
  }
});

Deno.test("migration: a field that is NOT a column never reaches the table", async () => {
  const sql = await schemaSql();
  const row = buildStartedRow({
    workspace_id: "w", stage: "company_discovery", reason: "initial_discovery",
    provider_id: "apify", logical_call_key: "k",
  });
  assertEquals(row.version, "lead-execution-ledger-v1",
    "the constant still travels on the in-memory row — that is what it is for");
  assertFalse(/\bversion\b/.test(sql), "and the table still has no such column");

  // So the writer must not send it. PostgREST rejects the WHOLE row over one
  // unknown key, which is why this table held nothing at all rather than rows
  // with a missing field.
  const sent: Record<string, unknown>[] = [];
  const writer = createLedgerWriter({
    from: () => ({
      insert: (r: Record<string, unknown>) => { sent.push(r); return Promise.resolve({ error: null }); },
      update: (r: Record<string, unknown>) => {
        sent.push(r);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  } as never);

  await writer.insert(row);
  await writer.finalize("id-1", { status: "succeeded", version: row.version } as never);

  assertEquals(sent.length, 2);
  for (const payload of sent) {
    assertFalse("version" in payload,
      `the writer sent a key the table does not have: ${JSON.stringify(Object.keys(payload))}`);
  }
  // And nothing else was lost on the way.
  for (const key of Object.keys(row)) {
    if (key === "version") continue;
    assert(key in sent[0], `stripping version must not drop "${key}"`);
  }
  assertEquals(sent[1].status, "succeeded", "a patch still patches");
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

Deno.test("wiring: every remaining provider entry point funnels through the seam", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  // Was three: company-first jobs, company-first people, and the generic
  // adaptive loop. The Mission cutover deleted the generic loop, so two
  // mission-driven entry points remain and both must stay instrumented.
  const calls = src.split('runTool("source_with_apify"').length - 1;
  assertEquals(calls, 2,
    "two provider entry points are expected: company-first jobs and " +
    "company-first people. A new one must be instrumented too.");
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
  // NARROWED FROM AN EXACT SIGNATURE, 2026-08-26. This matched
  // `const executeOnce = async ()` literally, as a proxy for "the ledger does
  // not gate execution". `executeOnce` now takes a `progress` writer so a
  // provider run id can reach its row the instant the run exists — a hard kill
  // used to leave `provider_run_id: null` for a billed, running Apify job that
  // nothing could resume (run 78cff5e5).
  //
  // The property being defended is unchanged and is asserted directly below:
  // the ledger writes, and contains no function that decides what runs.
  assert(registry.includes("const executeOnce = async ("),
    "execution must be a plain closure the ledger wraps, not a decision it makes");
  assert(registry.includes("await withExecutionAudit(writer, auditSpec, executeOnce)"),
    "the audit wraps execution; it is not consulted before it");
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


// ══════════════════════ A SWALLOWED ERROR MUST STILL SAY WHAT IT WAS ══
//
// `lead_execution_calls` holds ZERO rows on TEST and always has. Every insert
// has failed, and every failure printed the same thing:
//
//     [execution-ledger] insert error [object Object]
//
// because `String(error)` on a PostgREST error object is exactly that. TEST run
// b7a9e112 logged four of them in eighty seconds. Swallowing the failure is
// correct — the ledger watches execution and must never be able to fail it —
// but a swallow that also destroys the reason is a silence, and it left every
// paid Actor call this system has ever made unaudited and undiagnosable.

Deno.test("describeDbError: a PostgREST error reads as its message, not [object Object]", () => {
  const described = describeDbError({
    code: "23502", message: 'null value in column "reason" violates not-null constraint',
    details: "Failing row contains (…)", hint: null,
  });
  assert(!described.includes("[object Object]"));
  assert(described.includes("23502"), described);
  assert(described.includes("not-null constraint"), described);
  assert(described.includes("Failing row"), described);
});

Deno.test("describeDbError: an object with none of the four fields still says something", () => {
  const described = describeDbError({ weird: true });
  assert(!described.includes("[object Object]"),
    "a JSON dump beats the string that sent this one undiagnosed");
  assert(described.includes("weird"), described);
});

Deno.test("describeDbError: a plain Error and a string are unchanged", () => {
  assert(describeDbError(new Error("boom")).includes("boom"));
  assertEquals(describeDbError("boom"), "boom");
  assertEquals(describeDbError(null), "null");
});

Deno.test("the writer logs the described error, and still never throws", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const writer = createLedgerWriter({
      from: () => ({
        insert: () => Promise.resolve({
          error: { code: "42703", message: 'column "record_kind" does not exist' },
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    } as never);
    // The contract that matters most: a failed audit write is not a failed run.
    await writer.insert({ workspace_id: "w" } as never);
  } finally {
    console.error = original;
  }
  assertEquals(logged.length, 1);
  assert(logged[0].includes("42703"), logged[0]);
  assert(logged[0].includes("does not exist"), logged[0]);
  assert(!logged[0].includes("[object Object]"), logged[0]);
});
