// WHAT THE MODELS COST, WRITTEN DOWN.
//
// ── THE STATE THIS REPLACES ─────────────────────────────────────────────────
//
// Phase 1 built `buildModelTelemetry` — role, model, effort, token counts,
// latency, estimated cost, provenance grade — and both transports emitted it to
// `console.log` and nowhere else. A run could be audited for Apify dollars to
// the cent and could not answer "what did the models cost?", because the answer
// existed only in a log line nothing aggregated.
//
// ── THE ORDERING THAT MATTERS ───────────────────────────────────────────────
//
// `record_kind` was CHECK-constrained to ('provider_call','stage_result'), and
// the ledger writer swallows insert failures BY DESIGN so accounting can never
// take a run down. Shipping the writing code before the migration would have
// made every model row fail SILENTLY and left the table looking exactly as
// empty as it did before. That is not hypothetical — a stray `version` column
// did precisely this and the table held nothing for weeks.
//
// ZERO network, ZERO models, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildStartedRow, recordModelCall, type ExecutionLedgerRow, type LedgerWriter,
} from "../../../supabase/functions/_shared/executionLedger.ts";
import {
  buildModelTelemetry, priceModelCall,
} from "../../../supabase/functions/_shared/modelCostModel.ts";

/** Captures what would have been written. */
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

// ═══ 1. THE ROW IS A MODEL CALL, AND NOTHING ELSE READS IT AS A PURCHASE ═══

Deno.test("1. a model call is its own record kind", async () => {
  const f = fakeWriter();
  await recordModelCall(f.writer, SPEC);
  assertEquals(f.inserted.length, 1);
  assertEquals(f.inserted[0].record_kind, "model_call",
    "anything summing provider spend filters on this");
  assertEquals(f.inserted[0].provider_id, "openai",
    "the vendor that ran it — not `agentory_internal`, which means we observed it ourselves");
});

Deno.test("2. it claims no LEAD stage it is not part of", () => {
  const row = buildStartedRow({
    ...SPEC, record_kind: "model_call", provider_id: "openai",
    stage: "other", reason: "unspecified",
  });
  assertEquals(row.stage, "other",
    "`ExecutionStage` names the paid lead stages; a model call is in none of them");
  assertEquals(row.provider_run_id, null);
  assertEquals(row.dataset_id, null,
    "a row carrying either would be counted as a paid Actor run by anything joining on them");
});

// ═══ 2. THE FIELDS THE AUDIT ASKED FOR ═════════════════════════════════════

Deno.test("3. every requested field is persisted", async () => {
  const f = fakeWriter();
  await recordModelCall(f.writer, SPEC);
  const p = f.patched[0];
  const meta = p.metadata as Record<string, unknown>;

  assertEquals(meta.role, "execution_plan");
  assertEquals(meta.model, "gpt-4.1", "canonicalised, so it groups");
  assertEquals(meta.reasoning_effort, null);
  assertEquals(meta.input_tokens, 16_000);
  assertEquals(meta.cached_input_tokens, 4_000);
  assertEquals(meta.output_tokens, 1_500);
  assertEquals(meta.fallback_reason, null);
  assertEquals(p.duration_ms, 5_272);
  assertEquals(p.cost_source, "event_priced");
  assertEquals(p.status, "succeeded");
  assert(typeof p.estimated_cost_usd === "number");
});

Deno.test("4. LATENCY IS THE MODEL'S, not the ledger's", async () => {
  // `buildFinalPatch` derives `duration_ms` from the wall clock between row
  // creation and finalize. For a provider call the ledger wraps in real time
  // that is right; for a model call recorded AFTER it returned it would be the
  // couple of milliseconds this function took — a latency column full of
  // near-zeroes and a p95 that means nothing.
  const f = fakeWriter();
  await recordModelCall(f.writer, SPEC);
  assertEquals(f.patched[0].duration_ms, 5_272);
  assert((f.patched[0].duration_ms as number) > 100,
    "a wall-clock reading here would be single-digit milliseconds");
});

// ═══ 3. THE RULE THE USER SET, ENFORCED IN TWO PLACES ══════════════════════

Deno.test("5. a derived price NEVER lands in actual_cost_usd", async () => {
  // OpenAI returns token counts and no monetary charge. The counts are theirs,
  // the prices are ours, and `event_priced` says exactly that.
  const f = fakeWriter();
  await recordModelCall(f.writer, SPEC);
  assertEquals(f.patched[0].actual_cost_usd, null);
  assert((f.patched[0].estimated_cost_usd as number) > 0,
    "the figure exists — it is just not the provider's number");
});

Deno.test("6. and the ledger would refuse it even if a caller tried", async () => {
  // `buildFinalPatch` drops `actual_usd` unless the grade is `provider_reported`.
  // The database enforces the same invariant independently, so this holds even
  // for a writer that bypasses this module.
  const f = fakeWriter();
  await recordModelCall(f.writer, {
    ...SPEC,
    telemetry: { ...TELEMETRY, actual_cost_usd: 0.044, cost_source: "event_priced" },
  });
  assertEquals(f.patched[0].actual_cost_usd, null,
    "an event-priced figure cannot become an actual charge by being assigned to one");
});

// ═══ 4. A FAILED CALL IS STILL A CALL ══════════════════════════════════════

Deno.test("7. failures are recorded, with the provider's code", async () => {
  // Recording only successes makes an outage look like a quiet period — which
  // is exactly how 2026-08-21 read from the outside.
  const f = fakeWriter();
  await recordModelCall(f.writer, {
    ...SPEC,
    ok: false,
    failure_code: "quota_exhausted",
    failure_message: "OpenAI returned HTTP 429: insufficient_quota",
    telemetry: buildModelTelemetry({
      role: "mission_compilation", model: "gpt-4.1",
      usage: { input_tokens: null, cached_input_tokens: null, output_tokens: null },
      latency_ms: 431, fallback_reason: "quota_exhausted",
    }),
  });
  const p = f.patched[0];
  assertEquals(p.status, "failed");
  assertEquals(p.failure_code, "quota_exhausted");
  assertEquals((p.metadata as Record<string, unknown>).fallback_reason, "quota_exhausted");
});

Deno.test("8. AN UNPRICED FAILURE IS `unknown`, NEVER A PRICED ZERO", () => {
  // A 429 parses no body and reports no counts. Grading that `event_priced: $0`
  // would state that we KNOW it cost nothing, on the same provenance grade as a
  // figure computed from real counts — so during an outage every row would read
  // as a priced free call and the model bill would look untouched.
  const c = priceModelCall({
    model: "gpt-4.1",
    usage: { input_tokens: null, cached_input_tokens: null, output_tokens: null },
  });
  assertEquals(c.source, "unknown");
  assertEquals(c.estimated_usd, null);

  // A genuine zero-token success is still priced — the distinction is REPORTED
  // versus ABSENT, not zero versus non-zero.
  const zero = priceModelCall({
    model: "gpt-4.1", usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 },
  });
  assertEquals(zero.source, "event_priced");
  assertEquals(zero.estimated_usd, 0);
});

// ═══ 5. ACCOUNTING NEVER TAKES A RUN DOWN ══════════════════════════════════

Deno.test("9. a failing insert is swallowed, loudly", async () => {
  const writer: LedgerWriter = {
    insert: () => Promise.reject(new Error("constraint violation")),
    finalize: () => Promise.resolve(),
  };
  // Must not throw. Same rule as every other ledger path.
  await recordModelCall(writer, SPEC);
});

Deno.test("10. no writer is not an error", async () => {
  await recordModelCall(null, SPEC);
  await recordModelCall(undefined, SPEC);
});

// ═══ 6. THE MIGRATION SHIPPED FIRST ════════════════════════════════════════

Deno.test("11. the constraint that permits these rows exists in a migration", () => {
  const sql = Deno.readTextFileSync(new URL(
    "../../../supabase/migrations/20260822120000_model_call_ledger.sql", import.meta.url));

  assert(/record_kind in \([^)]*'model_call'/.test(sql),
    "without this the writer's inserts fail SILENTLY and the table stays empty");
  assert(sql.includes("'provider_call'") && sql.includes("'stage_result'"),
    "and the widening must keep every value that was already legal");
  assert(sql.includes("lead_execution_calls_model_call_has_no_run"),
    "a model call carries no Actor run or dataset");
  assert(sql.includes("lead_execution_calls_model_call_names_model"),
    "a model row that cannot name its model cannot be grouped, priced or compared");
  assert(sql.includes("create or replace view public.lead_model_calls"),
    "the view is what makes the jsonb genuinely queryable");
});

Deno.test("12. the migration does NOT add a model-specific actual-cost ban", () => {
  // The general invariant — actual_cost_usd IS NULL OR cost_source =
  // 'provider_reported' — already guarantees today's behaviour and does it
  // ADAPTIVELY. A `model_call → actual IS NULL` rule would additionally forbid
  // the honest case where a provider begins reporting a real charge, turning
  // "never store a derived price as actual" into "never store an actual".
  const sql = Deno.readTextFileSync(new URL(
    "../../../supabase/migrations/20260822120000_model_call_ledger.sql", import.meta.url));
  assert(!/check\s*\(\s*record_kind\s*<>\s*'model_call'\s*or\s*actual_cost_usd/i.test(sql));
  assert(sql.includes("actual_cost_usd IS NULL OR cost_source = 'provider_reported'"),
    "and it must say which existing invariant it is relying on");
});

Deno.test("13. token counts do NOT reuse the funnel columns", async () => {
  // `accepted_count` and friends are summed across the whole table by existing
  // queries. Making one mean "output tokens" for a single record kind would
  // corrupt every one of those aggregates.
  const f = fakeWriter();
  await recordModelCall(f.writer, SPEC);
  const p = f.patched[0];
  for (const col of [
    "raw_count", "normalized_count", "unique_count", "accepted_count", "rejected_count",
  ]) {
    assertEquals(p[col], null, `${col} must stay a funnel column`);
  }
});

// ═══ 7. BOTH TRANSPORTS CAN REACH THE LEDGER ═══════════════════════════════

Deno.test("14. the seam is EXPLICIT, not a module-level sink", () => {
  // A global "current writer" would be simpler to wire and would misattribute
  // one request's model calls to another's task whenever two runs share an
  // isolate. Passed through the existing dependency objects, the attribution
  // comes from the caller that already knows it.
  const provider = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/gptProvider.ts", import.meta.url));
  const strategist = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/leadStrategy/adapters/shared.ts", import.meta.url));

  assert(provider.includes("onModelCall?:"), "path A exposes the seam on GptDeps");
  assert(strategist.includes("onModelCall?:"), "path B exposes it on the transport options");
  assert(provider.includes("deps.onModelCall?.("), "and calls it");
  assert(strategist.includes("opts.onModelCall?.("));

  for (const [name, src] of [["gptProvider", provider], ["strategist", strategist]] as const) {
    assert(!/^\s*let\s+currentWriter/m.test(src), `${name} must hold no ambient writer`);
  }
});

Deno.test("15. path A reports the FAILED call too, not only the success", () => {
  const src = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/gptProvider.ts", import.meta.url));
  // Two emit sites: one on the failure return, one after a parsed body.
  assertEquals(src.split("deps.onModelCall?.(").length - 1, 2,
    "a transport that reports only successes makes an outage look like a quiet period");
  assert(src.includes("deps.onModelCall?.(failTelemetry, false)"));
});
