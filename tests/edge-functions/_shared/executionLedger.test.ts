// THE EXECUTION LEDGER — lifecycle, redaction, counts, cost and retries.
//
// Everything here is offline. The writer is the only seam the module has, so a
// recording stub is enough to exercise the whole lifecycle without a database,
// a provider or a network call.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  withExecutionAudit, buildStartedRow, buildFinalPatch, redactProviderInput,
  summarizeTaskLedger, renderTaskLedger, inferStage, logicalCallKey,
  REDACTED, EXECUTION_LEDGER_VERSION, LEAD_EXECUTION_CALLS_TABLE,
  type ExecutionLedgerRow, type LedgerWriter, type ExecutionCallSpec,
} from "../../../supabase/functions/_shared/executionLedger.ts";

const WORKSPACE = "00000000-0000-0000-0000-000000000001";

/** A writer that records everything, so assertions read the real row shape. */
function recordingWriter() {
  const inserted: ExecutionLedgerRow[] = [];
  const finalized: Array<{ id: string; patch: Partial<ExecutionLedgerRow> }> = [];
  const writer: LedgerWriter = {
    insert: (row) => { inserted.push(structuredClone(row)); return Promise.resolve(); },
    finalize: (id, patch) => { finalized.push({ id, patch: structuredClone(patch) }); return Promise.resolve(); },
  };
  /** The row as it would exist in the table after finalization. */
  const merged = (i = 0) => ({ ...inserted[i], ...finalized[i]?.patch }) as ExecutionLedgerRow;
  return { writer, inserted, finalized, merged };
}

function spec(over: Partial<ExecutionCallSpec> = {}): ExecutionCallSpec {
  return {
    workspace_id: WORKSPACE,
    task_id: "task-1",
    plan_id: "plan-1",
    execution_owner: "company_first_v1",
    planner_owner: "gpt_lead_strategy_v1",
    stage: "company_discovery",
    capability: "discover_companies",
    reason: "initial_discovery",
    provider_id: "apify",
    actor_id: "memo23/y-combinator-scraper",
    request_input: { query: "b2b saas", maxItems: 50 },
    logical_call_key: "task-1:discover_companies:hash-1",
    ...over,
  };
}

// ═══ SUCCESS ══════════════════════════════════════════════════════════════

Deno.test("success: the row captures input, provider, run id, counts, duration and cost", async () => {
  const { writer, inserted, merged } = recordingWriter();

  const out = await withExecutionAudit(writer, spec(), async () => {
    await new Promise((r) => setTimeout(r, 5));
    return {
      result: ["a", "b", "c"],
      outcome: {
        status: "succeeded" as const,
        provider_run_id: "run_abc",
        dataset_id: "ds_abc",
        counts: { raw: 100, normalized: 82, unique: 80, accepted: 13, rejected: 67 },
        cost: { estimated_usd: 0.42, source: "estimated" as const },
        next_decision: "continue_sourcing",
      },
    };
  });

  assertEquals(out, ["a", "b", "c"], "the ledger must not alter what the call returns");

  // Inserted BEFORE the call, in a non-terminal state.
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].status, "started");
  assertEquals(inserted[0].version, EXECUTION_LEDGER_VERSION);
  assertEquals(inserted[0].finished_at, null);

  const row = merged();
  assertEquals(row.status, "succeeded");
  assertEquals(row.provider_run_id, "run_abc");
  assertEquals(row.dataset_id, "ds_abc");
  assertEquals(row.raw_count, 100);
  assertEquals(row.normalized_count, 82);
  assertEquals(row.accepted_count, 13);
  assertEquals(row.rejected_count, 67);
  assertEquals(row.next_decision, "continue_sourcing");
  assertEquals(row.execution_owner, "company_first_v1");
  assertEquals(row.planner_owner, "gpt_lead_strategy_v1");
  assertEquals(row.capability, "discover_companies");
  assertEquals(row.reason, "initial_discovery");
  assert(typeof row.duration_ms === "number" && row.duration_ms >= 0);
  assert(row.request_input && (row.request_input as Record<string, unknown>).maxItems === 50,
    "the provider-facing input must be reproducible from the row");
});

// ═══ FAILURE / TIMEOUT ════════════════════════════════════════════════════

Deno.test("failure: a throw still leaves a terminal row", async () => {
  const { writer, inserted, merged } = recordingWriter();

  await assertRejects(
    () => withExecutionAudit(writer, spec(), () => {
      throw new Error("apify_unauthorized");
    }),
    Error,
    "apify_unauthorized",
  );

  // The exception is not swallowed AND the call did not disappear.
  assertEquals(inserted.length, 1);
  const row = merged();
  assertEquals(row.status, "failed");
  assertEquals(row.failure_code, "exception");
  assert(row.failure_message?.includes("apify_unauthorized"));
  assert(row.finished_at !== null, "a failed call must still be finalized");
});

Deno.test("timeout: recorded distinctly from failure", async () => {
  const { writer, merged } = recordingWriter();
  await assertRejects(() => withExecutionAudit(writer, spec(), () => {
    throw new Error("provider deadline exceeded — timed out after 90s");
  }));
  assertEquals(merged().status, "timed_out",
    "a timeout is a different operational state from a failure and must read as one");
});

Deno.test("timeout: an explicit timed_out outcome is honoured", async () => {
  const { writer, merged } = recordingWriter();
  await withExecutionAudit(writer, spec(), () =>
    Promise.resolve({
      result: null,
      outcome: { status: "timed_out" as const, provider_run_id: "run_pending" },
    }));
  const row = merged();
  assertEquals(row.status, "timed_out");
  assertEquals(row.provider_run_id, "run_pending",
    "a still-running paid run must keep its id so a resume can adopt it");
});

Deno.test("a callback that reports no outcome is recorded as unfinished, not succeeded", async () => {
  const { writer, merged } = recordingWriter();
  // Simulates a future call site forgetting to return an outcome.
  await withExecutionAudit(writer, spec(), () =>
    Promise.resolve({ result: 1, outcome: undefined as never }));
  const row = merged();
  assert(row.status !== "succeeded", "silence must never be recorded as success");
});

// ═══ UNKNOWN COUNTS STAY NULL ═════════════════════════════════════════════

Deno.test("unknown counts remain null, never 0", async () => {
  const { writer, merged } = recordingWriter();
  await withExecutionAudit(writer, spec(), () =>
    Promise.resolve({
      result: [],
      // Only `raw` is knowable at this layer.
      outcome: { status: "succeeded" as const, counts: { raw: 0 } },
    }));

  const row = merged();
  assertEquals(row.raw_count, 0, "a measured zero is a real zero and must be kept");
  assertEquals(row.normalized_count, null, "an unmeasured count must be null, not 0");
  assertEquals(row.accepted_count, null);
  assertEquals(row.rejected_count, null);
  assertEquals(row.unique_count, null);
});

// ═══ COST SEMANTICS ═══════════════════════════════════════════════════════

Deno.test("cost: an estimate is never stored as an actual figure", async () => {
  const { writer, merged } = recordingWriter();
  await withExecutionAudit(writer, spec(), () =>
    Promise.resolve({
      result: null,
      outcome: {
        status: "succeeded" as const,
        // A caller mistakenly supplying an actual alongside an estimated source.
        cost: { actual_usd: 9.99, estimated_usd: 0.5, source: "estimated" as const },
      },
    }));
  const row = merged();
  assertEquals(row.actual_cost_usd, null,
    "actual_cost_usd may only be written when the provider reported the figure");
  assertEquals(row.estimated_cost_usd, 0.5);
  assertEquals(row.cost_source, "estimated");
});

Deno.test("cost: a provider-reported figure is stored as actual", async () => {
  const { writer, merged } = recordingWriter();
  await withExecutionAudit(writer, spec(), () =>
    Promise.resolve({
      result: null,
      outcome: {
        status: "succeeded" as const,
        cost: { actual_usd: 0.0123, source: "provider_reported" as const },
      },
    }));
  const row = merged();
  assertEquals(row.actual_cost_usd, 0.0123);
  assertEquals(row.cost_source, "provider_reported");
});

// ═══ SECRET REDACTION ═════════════════════════════════════════════════════

Deno.test("redaction: credentials never reach the persisted input", () => {
  const input = {
    query: "b2b saas",
    token: "apify_api_SUPERSECRET",
    apiKey: "sk-live-12345",
    "API-KEY": "another",
    Authorization: "Bearer abc.def.ghi",
    password: "hunter2",
    nested: {
      credentials: { secret: "x" },
      accessToken: "at_123",
      url: "https://api.apify.com/v2/acts/x/runs?token=apify_api_LEAKED&limit=5",
    },
    list: [{ cookie: "sid=1" }, "Bearer raw-token-value"],
  };
  const out = redactProviderInput(input) as Record<string, never>;
  const serialized = JSON.stringify(out);

  for (const secret of [
    "SUPERSECRET", "sk-live-12345", "another", "abc.def.ghi", "hunter2",
    "at_123", "LEAKED", "sid=1", "raw-token-value",
  ]) {
    assert(!serialized.includes(secret), `secret leaked into the ledger: ${secret}`);
  }

  // …while the reproducible parts survive, which is the whole point.
  assertEquals(out.query as unknown, "b2b saas");
  assert(serialized.includes("api.apify.com"), "the endpoint must remain legible");
  assert(serialized.includes(REDACTED));
});

Deno.test("redaction: applied by the lifecycle, not left to call sites", () => {
  const row = buildStartedRow(spec({
    request_input: { token: "apify_api_SECRET", maxItems: 10 },
  }));
  assertEquals((row.request_input as Record<string, unknown>).token, REDACTED);
  assertEquals((row.request_input as Record<string, unknown>).maxItems, 10);
});

Deno.test("redaction: bounded, so a dataset cannot land in the ledger by accident", () => {
  const deep: Record<string, unknown> = {};
  let cursor = deep;
  for (let i = 0; i < 30; i++) { cursor.next = {}; cursor = cursor.next as Record<string, unknown>; }
  assert(JSON.stringify(redactProviderInput(deep)).includes("truncated:depth"));

  const wide = { rows: Array.from({ length: 5000 }, (_, i) => i) };
  const out = redactProviderInput(wide) as { rows: number[] };
  assertEquals(out.rows.length, 200, "arrays must be capped");

  const long = { note: "x".repeat(9000) };
  assert(((redactProviderInput(long) as { note: string }).note).length < 2100);
});

// ═══ RETRY / IDEMPOTENCY ══════════════════════════════════════════════════

Deno.test("retry: two attempts create two rows sharing one logical key", async () => {
  const { writer, inserted } = recordingWriter();
  const key = "task-1:discover_companies:hash-1";

  await assertRejects(() => withExecutionAudit(
    writer, spec({ logical_call_key: key, attempt_number: 1 }),
    () => { throw new Error("apify_start_failed:502"); },
  ));
  await withExecutionAudit(
    writer, spec({ logical_call_key: key, attempt_number: 2 }),
    () => Promise.resolve({ result: null, outcome: { status: "succeeded" as const } }),
  );

  assertEquals(inserted.length, 2, "attempt 2 must not overwrite attempt 1");
  assertEquals(inserted[0].logical_call_key, inserted[1].logical_call_key);
  assertEquals(inserted[0].attempt_number, 1);
  assertEquals(inserted[1].attempt_number, 2);
  assert(inserted[0].id !== inserted[1].id, "each attempt is its own row");
});

Deno.test("resume: a reused run is a distinct status and does not erase history", async () => {
  const { writer, inserted, merged } = recordingWriter();
  await withExecutionAudit(writer, spec({ attempt_number: 1 }), () =>
    Promise.resolve({ result: null, outcome: { status: "timed_out" as const, provider_run_id: "run_1" } }));
  await withExecutionAudit(writer, spec({ attempt_number: 2, reason: "resumed_run" }), () =>
    Promise.resolve({ result: null, outcome: { status: "reused" as const, provider_run_id: "run_1" } }));

  assertEquals(inserted.length, 2);
  assertEquals(merged(0).status, "timed_out", "the original attempt's record survives");
  assertEquals(inserted[1].reason, "resumed_run");
});

Deno.test("logicalCallKey: same question one key, different question different key", () => {
  const base = { task_id: "t1", capability: "discover", stage: "company_discovery" as const };
  assertEquals(
    logicalCallKey({ ...base, input_hash: "h1" }),
    logicalCallKey({ ...base, input_hash: "h1" }),
  );
  assert(logicalCallKey({ ...base, input_hash: "h1" }) !== logicalCallKey({ ...base, input_hash: "h2" }));
  assert(logicalCallKey({ ...base, input_hash: "h1" }) !==
    logicalCallKey({ ...base, capability: "enrich", input_hash: "h1" }));
});

// ═══ NO BEHAVIOUR CHANGE WHEN DISABLED ════════════════════════════════════

Deno.test("no behaviour change: a null writer returns an identical result", async () => {
  const call = () => Promise.resolve({
    result: { items: [1, 2, 3], ok: true },
    outcome: { status: "succeeded" as const },
  });

  const withAudit = await withExecutionAudit(recordingWriter().writer, spec(), call);
  const withoutAudit = await withExecutionAudit(null, spec(), call);
  assertEquals(withAudit, withoutAudit,
    "auditing must be observationally invisible to the caller");
});

Deno.test("no behaviour change: a writer that throws cannot fail the run", async () => {
  const exploding: LedgerWriter = {
    insert: () => Promise.reject(new Error("db down")),
    finalize: () => Promise.reject(new Error("db down")),
  };
  const out = await withExecutionAudit(exploding, spec(), () =>
    Promise.resolve({ result: "fine", outcome: { status: "succeeded" as const } }));
  assertEquals(out, "fine",
    "observability must never be able to fail the execution it is watching");
});

Deno.test("no behaviour change: the caller's exception is re-thrown unchanged", async () => {
  const original = new Error("provider exploded");
  const thrown = await withExecutionAudit(recordingWriter().writer, spec(), () => {
    throw original;
  }).catch((e) => e);
  assertEquals(thrown, original, "the ledger must not wrap or replace the error");
});

// ═══ STAGE INFERENCE ══════════════════════════════════════════════════════

Deno.test("stage inference uses the vocabulary call sites already pass", () => {
  assertEquals(inferStage("hiring_verification", "jobs"), "hiring_evidence");
  assertEquals(inferStage("founder_discovery", "people_profiles"), "person_resolution");
  assertEquals(inferStage("contact_enrichment", null), "contact_enrichment");
  assertEquals(inferStage("company_identity_resolution", "company_search"), "company_discovery");
  assertEquals(inferStage(null, null), "other");
});

// ═══ TASK SUMMARY ═════════════════════════════════════════════════════════

function row(over: Partial<ExecutionLedgerRow>): ExecutionLedgerRow {
  return {
    ...buildStartedRow(spec()),
    status: "succeeded",
    finished_at: new Date().toISOString(),
    duration_ms: 1000,
    ...over,
  } as ExecutionLedgerRow;
}

Deno.test("summary: one task's execution is reconstructable from rows alone", () => {
  const rows: ExecutionLedgerRow[] = [
    row({
      started_at: "2026-08-10T10:00:00.000Z", stage: "company_discovery",
      raw_count: 100, normalized_count: 82, accepted_count: 82,
      estimated_cost_usd: 0.10, cost_source: "estimated",
    }),
    row({
      started_at: "2026-08-10T10:01:00.000Z", stage: "hiring_evidence",
      raw_count: 40, normalized_count: 40, accepted_count: 13, rejected_count: 27,
      estimated_cost_usd: 0.40, cost_source: "estimated",
    }),
    row({
      started_at: "2026-08-10T10:02:00.000Z", stage: "person_resolution",
      raw_count: 13, accepted_count: 11,
      actual_cost_usd: 0.31, cost_source: "provider_reported",
      next_decision: "stop_quota_satisfied",
    }),
  ];

  const s = summarizeTaskLedger(rows);
  assertEquals(s.calls, 3);
  assertEquals(s.succeeded, 3);
  assertEquals(s.actual_cost_usd, 0.31);
  assertEquals(s.estimated_cost_usd, 0.5);
  assertEquals(s.cost_is_partly_estimated, true,
    "a mixed-confidence total must say so rather than presenting one number");
  assertEquals(s.stop_reason, "stop_quota_satisfied");
  assertEquals(s.by_stage.length, 3);
  assertEquals(s.by_stage[0].stage, "company_discovery");
  assertEquals(s.by_stage[1].accepted, 13);

  const text = renderTaskLedger(s);
  assert(text.includes("3 external calls"));
  assert(text.includes("hiring_evidence"));
  assert(text.includes("stopped: stop_quota_satisfied"));
});

Deno.test("summary: unknown counts render as unknown, never as zero", () => {
  const s = summarizeTaskLedger([row({ stage: "hiring_evidence", raw_count: 40 })]);
  assertEquals(s.by_stage[0].normalized, null);
  const text = renderTaskLedger(s);
  assert(text.includes("unknown normalized"),
    "'we never looked' must not render as 'we checked and found none'");
});

Deno.test("summary: retries are visible", () => {
  const s = summarizeTaskLedger([
    row({ attempt_number: 1, status: "failed" }),
    row({ attempt_number: 2, status: "succeeded" }),
  ]);
  assertEquals(s.attempts_beyond_first, 1);
  assertEquals(s.failed, 1);
  assertEquals(s.succeeded, 1);
});

Deno.test("summary: an empty ledger does not fabricate a story", () => {
  const s = summarizeTaskLedger([]);
  assertEquals(s.calls, 0);
  assertEquals(s.task_id, null);
  assertEquals(s.stop_reason, null);
  assertEquals(s.by_stage, []);
});

// ═══ THE FINAL PATCH IS PURE ══════════════════════════════════════════════

Deno.test("buildFinalPatch computes duration from the started row", () => {
  const started = { started_at: new Date(Date.now() - 2500).toISOString() };
  const patch = buildFinalPatch(started, { status: "succeeded" });
  assert((patch.duration_ms ?? 0) >= 2400, `expected ~2500ms, got ${patch.duration_ms}`);
  assert(patch.finished_at !== null);
});

Deno.test("the table name is a single constant, not a scattered string", () => {
  assertEquals(LEAD_EXECUTION_CALLS_TABLE, "lead_execution_calls");
});
