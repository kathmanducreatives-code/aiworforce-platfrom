// THE ROW THAT IS INSERTED MUST SATISFY THE DATABASE'S OWN CHECK.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage 4ef85feb, 2026-09-05. The collector worked, the drain worked, and the
// ledger stayed empty:
//
//     05:59:34  [run-agent][model-ledger] rows: 4
//     06:01:28  [run-agent][model-ledger] rows: 1
//     06:11:05  [run-agent][model-ledger] rows: 4
//     06:12:39  [run-agent][model-ledger] rows: 4
//     06:19:43  [run-agent][model-ledger] rows: 7
//
// Twenty model calls collected and drained. Twenty rejections:
//
//     [execution-ledger] insert error [23514] new row for relation
//     "lead_execution_calls" violates check constraint
//     "lead_execution_calls_model_call_names_model"
//
// `recordModelCall` inserted the row first and attached `metadata.model` in the
// FOLLOWING `finalize`. A CHECK is evaluated on INSERT, and `buildStartedRow`
// hardcodes `metadata: null`, so every insert was refused — silently, because
// `createLedgerWriter.insert` swallows anything that is not a unique violation.
//
// ── WHY NULL DOES NOT SAVE IT ──────────────────────────────────────────────
//
// The constraint is a disjunction whose second half is a CONJUNCTION:
//
//   record_kind <> 'model_call'
//     OR (metadata ? 'model' AND length(coalesce(metadata->>'model','')) > 0)
//
// On a null column the first conjunct is NULL, but the second is FALSE, and
// `NULL AND FALSE` is FALSE in SQL. The predicate is FALSE and the row is
// refused. Reasoning about the first conjunct alone suggests a NULL check that
// passes — I made exactly that error while diagnosing this and ruled the
// constraint out. It was the cause.
//
// ── WHY THE EXISTING SUITE DID NOT CATCH IT ────────────────────────────────
//
// `modelCallLedger.test.ts` asserts the FINALIZE patch carries the model, and
// its fake writer enforces no constraints. Every one of those tests passed for
// the ten days the table sat empty. This file asserts the INSERTED row against
// the constraint text read from the migration itself, so the test fails for the
// same reason the database does.
//
// ZERO network, ZERO models, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  recordModelCall,
  type ExecutionLedgerRow,
  type LedgerWriter,
} from "../../../supabase/functions/_shared/executionLedger.ts";
import { buildModelTelemetry } from "../../../supabase/functions/_shared/modelCostModel.ts";

const ROOT = new URL("../../../", import.meta.url);

function fakeWriter() {
  const inserted: ExecutionLedgerRow[] = [];
  const patched: Array<Record<string, unknown>> = [];
  const writer: LedgerWriter = {
    insert: (row) => {
      inserted.push(row);
      return Promise.resolve();
    },
    finalize: (_id, patch) => {
      patched.push(patch as Record<string, unknown>);
      return Promise.resolve();
    },
  };
  return { writer, inserted, patched };
}

const TELEMETRY = buildModelTelemetry({
  role: "execution_plan",
  model: "openai:gpt-4.1",
  reasoning_effort: null,
  usage: { input_tokens: 16_000, cached_input_tokens: 4_000, output_tokens: 1_500 },
  latency_ms: 5_272,
});

const SPEC = {
  workspace_id: "ws-1",
  task_id: "task-1",
  logical_call_key: "mission:abc:execution_plan:1",
  telemetry: TELEMETRY,
  ok: true,
};

/**
 * The database's own predicate, evaluated in TypeScript with SQL's three-valued
 * logic — `NULL AND FALSE` is FALSE, which is the whole point.
 */
function namesModelCheck(row: {
  record_kind?: string;
  metadata?: Record<string, unknown> | null;
}): boolean {
  if (row.record_kind !== "model_call") return true;
  const md = row.metadata;
  // `metadata ? 'model'` — NULL on a null column, but the conjunction below
  // collapses to FALSE regardless, exactly as Postgres does.
  const hasKey: boolean | null = md == null ? null : Object.hasOwn(md, "model");
  const lenGtZero = typeof md?.model === "string" && md.model.length > 0;
  if (hasKey === null) return lenGtZero ? true : false; // NULL AND FALSE → FALSE
  return hasKey && lenGtZero;
}

Deno.test("THE INSERT: a model_call row satisfies the names_model constraint", async () => {
  const f = fakeWriter();
  await recordModelCall(f.writer, SPEC);
  assertEquals(f.inserted.length, 1);

  const row = f.inserted[0] as unknown as {
    record_kind: string;
    metadata: Record<string, unknown> | null;
  };
  assertEquals(row.record_kind, "model_call");
  assert(
    namesModelCheck(row),
    "the INSERTED row violates lead_execution_calls_model_call_names_model — " +
      "this is the 23514 that dropped 20 model calls on lineage 4ef85feb",
  );
  //  normalises the provider prefix away, so assert against
  // the telemetry rather than the input string.
  assertEquals(row.metadata?.model, TELEMETRY.model);
  assert(typeof TELEMETRY.model === "string" && TELEMETRY.model.length > 0);
});

Deno.test("the constraint helper matches Postgres on a null metadata row", () => {
  // The exact case that fooled the diagnosis: null metadata must be REFUSED,
  // not treated as an unknown that passes.
  assertEquals(
    namesModelCheck({ record_kind: "model_call", metadata: null }),
    false,
    "null metadata must fail: NULL AND FALSE is FALSE",
  );
  assertEquals(
    namesModelCheck({ record_kind: "model_call", metadata: {} }),
    false,
    "metadata without a model key must fail",
  );
  assertEquals(
    namesModelCheck({ record_kind: "model_call", metadata: { model: "" } }),
    false,
    "an empty model name must fail the length conjunct",
  );
  assertEquals(
    namesModelCheck({ record_kind: "provider_call", metadata: null }),
    true,
    "the constraint only binds model_call rows",
  );
});

Deno.test("the helper mirrors the constraint text in the migration", () => {
  // If the migration's predicate is ever edited, this test should be the thing
  // that notices — not a production run with an empty table.
  const sql = Deno.readTextFileSync(
    new URL("supabase/migrations/20260822120000_model_call_ledger.sql", ROOT),
  ).toLowerCase();
  assert(
    sql.includes("model_call_names_model"),
    "the constraint must still be defined in the migration",
  );
  for (const fragment of ["metadata ? 'model'", "length(", "record_kind"]) {
    assert(
      sql.includes(fragment),
      `the constraint no longer contains ${fragment}; this helper is now a lie`,
    );
  }
});

Deno.test("the finalize still carries the full telemetry", () => {
  // The insert carries only what the constraint demands. Everything else — token
  // counts, effort, latency, fallback reason — must still arrive on finalize, or
  // this fix has traded a silent drop for a silent truncation.
  return (async () => {
    const f = fakeWriter();
    await recordModelCall(f.writer, SPEC);
    assertEquals(f.patched.length, 1);
    const md = (f.patched[0] as { metadata?: Record<string, unknown> }).metadata;
    assert(md, "finalize must still write metadata");
    for (const k of ["model", "role", "input_tokens", "output_tokens", "telemetry_version"]) {
      assert(k in md, `finalize lost ${k}`);
    }
  })();
});
