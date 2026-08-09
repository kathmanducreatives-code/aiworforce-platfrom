// PHASE 0A — TERMINAL COVERAGE FOR ALL THREE EXECUTION OWNERS.
//
// The audit found that only `company_first_v1` records a terminal reason.
// Verifying that against source turned up something slightly different, and
// worse: a capability-engine task runs INSIDE the company-first block and
// reaches the same stage-result writes, so it was not uncovered — it was
// MISATTRIBUTED. The rows said `execution_owner: capability_engine_v1` while
// `next_decision` carried `cf.terminal_reason`, which belongs to the quota
// controller that had been deliberately neutered for that task.
//
// A ledger that names the wrong owner's reason is worse than one that says
// nothing, because it reads as evidence.
//
// Offline: no database, no provider, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  recordStageResult, summarizeTaskLedger, buildStartedRow,
  type ExecutionLedgerRow, type LedgerWriter,
} from "../../../supabase/functions/_shared/executionLedger.ts";

const RUN_AGENT = new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url);
const WORKSPACE = "00000000-0000-0000-0000-000000000001";

function recordingWriter() {
  const rows: ExecutionLedgerRow[] = [];
  const writer: LedgerWriter = {
    insert: (r) => { rows.push(structuredClone(r)); return Promise.resolve(); },
    finalize: (id, patch) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows[i] = { ...rows[i], ...patch } as ExecutionLedgerRow;
      return Promise.resolve();
    },
  };
  return { writer, rows };
}

/** Terminal stage result for one owner, exactly as the runtime writes it. */
async function terminalFor(owner: string, reason: string | null) {
  const { writer, rows } = recordingWriter();
  await recordStageResult(writer, {
    workspace_id: WORKSPACE, task_id: "task-x", plan_id: null,
    execution_owner: owner,
    stage: owner === "generic_sourcing_v1" ? "generic_sourcing" : "person_resolution",
    reason: "unspecified",
    logical_call_key: `task-x:stage:terminal:${owner}`,
    counts: {},
    next_decision: reason,
  });
  return { rows, summary: summarizeTaskLedger(rows) };
}

// ═══ EVERY OWNER PRODUCES A TERMINAL REASON ═══════════════════════════════

Deno.test("stop reason: capability_engine_v1 success is audited", async () => {
  const { summary } = await terminalFor("capability_engine_v1", "quota_satisfied");
  assertEquals(summary.execution_owner, "capability_engine_v1");
  assertEquals(summary.stop_reason, "quota_satisfied");
  assert(summary.stop_reason !== null, "a completed engine run must say why it ended");
});

Deno.test("stop reason: capability_engine_v1 failure is audited", async () => {
  // The engine's OWN vocabulary — not the quota controller's.
  for (const r of [
    "provider_input_validation_failed", "provider_run_pending",
    "execution_deadline_checkpoint",
  ]) {
    const { summary } = await terminalFor("capability_engine_v1", r);
    assertEquals(summary.stop_reason, r);
  }
});

Deno.test("stop reason: generic_sourcing_v1 success is audited", async () => {
  const { summary } = await terminalFor("generic_sourcing_v1", "complete");
  assertEquals(summary.execution_owner, "generic_sourcing_v1");
  assertEquals(summary.stop_reason, "complete");
});

Deno.test("stop reason: generic_sourcing_v1 failure is audited", async () => {
  const { summary } = await terminalFor("generic_sourcing_v1", "apify_unauthorized");
  assertEquals(summary.stop_reason, "apify_unauthorized");
});

Deno.test("stop reason: company_first_v1 is unchanged", async () => {
  const { summary } = await terminalFor("company_first_v1", "quota_satisfied");
  assertEquals(summary.execution_owner, "company_first_v1");
  assertEquals(summary.stop_reason, "quota_satisfied");
});

Deno.test("stop reason: an unmeasured terminal stays NULL, never invented", async () => {
  const { summary } = await terminalFor("capability_engine_v1", null);
  assertEquals(summary.stop_reason, null,
    "a missing reason must stay missing — 'completed' must never be fabricated");
});

// ═══ THE MISATTRIBUTION THIS PHASE FIXES ══════════════════════════════════

Deno.test("wiring: the terminal reason comes from the owner that actually executed", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);

  // The stage-result block must select the reason by owner rather than always
  // reading the quota controller's field.
  assert(src.includes("terminalReasonForOwner"),
    "the terminal reason must be chosen from the owner that executed, not assumed");
  assert(src.includes("capabilityRun.state.terminal_reason"),
    "the capability engine's own terminal reason must be reachable at the stage write");
  assert(!/next_decision: cf\.terminal_reason \?\? null,\s*\n\s*\}\);\s*\n\s*\} catch/.test(src),
    "the unconditional `cf.terminal_reason` terminal must be gone");
});

Deno.test("wiring: generic sourcing records its own terminal result", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  assert(src.includes('execution_owner: "generic_sourcing_v1"'),
    "the generic path must identify itself as the execution owner");
  // It must record a terminal stage result from the adaptive loop's own result.
  assert(/recordStageResult\([\s\S]{0,600}generic_sourcing/.test(src),
    "the generic path must write a terminal stage result");
  assert(src.includes("adaptive.status") && src.includes("adaptive.reason"),
    "the adaptive loop's own status/reason is the authority for its terminal");
});

Deno.test("wiring: no second stop-reason enum was introduced", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  for (const invented of [
    "STOP_REASONS", "TerminalReasonEnum", "normalizeStopReason", "mapStopReason",
  ]) {
    assert(!src.includes(invented),
      `${invented} would be a competing vocabulary; the ledger observes, it does not define`);
  }
});

Deno.test("wiring: one ledger API — no per-owner recorder functions", async () => {
  const src = await Deno.readTextFile(RUN_AGENT);
  const mod = await Deno.readTextFile(new URL(
    "../../../supabase/functions/_shared/executionLedger.ts", import.meta.url));
  for (const parallel of [
    "recordCapabilityEngineResult", "recordGenericSourcingResult", "recordCompanyFirstResult",
  ]) {
    assert(!src.includes(parallel) && !mod.includes(parallel),
      `${parallel} would fork the ledger API; recordStageResult stays authoritative`);
  }
});

// ═══ PROVIDER-CALL next_decision: KNOWN ONLY ══════════════════════════════

Deno.test("provider next_decision: written when genuinely known", async () => {
  const { outcomeFromToolResultForTest } = await import(
    "../../../supabase/functions/_shared/toolRegistry.ts");
  const outcome = outcomeFromToolResultForTest(
    { ok: true, data: { items: [1, 2], run_id: "r1" } },
    { audit_next_decision: "continue_sourcing" },
  );
  assertEquals(outcome.next_decision, "continue_sourcing");
});

Deno.test("provider next_decision: NULL when the call site cannot know it", async () => {
  const { outcomeFromToolResultForTest } = await import(
    "../../../supabase/functions/_shared/toolRegistry.ts");
  for (const input of [{}, { audit_next_decision: "" }, { audit_next_decision: 42 }]) {
    const outcome = outcomeFromToolResultForTest(
      { ok: true, data: { items: [], run_id: "r1" } }, input as Record<string, unknown>);
    assertEquals(outcome.next_decision ?? null, null,
      "a provider call must never fabricate a workflow-level decision");
  }
});

Deno.test("provider next_decision: a failed call does not invent a terminal", async () => {
  const { outcomeFromToolResultForTest } = await import(
    "../../../supabase/functions/_shared/toolRegistry.ts");
  const outcome = outcomeFromToolResultForTest(
    { ok: false, error: "apify_start_failed:502" }, {});
  assertEquals(outcome.status, "failed");
  assertEquals(outcome.next_decision ?? null, null);
});

// ═══ PROVIDER FACTS AND STAGE FACTS STAY APART ════════════════════════════

Deno.test("a terminal stage result never becomes a provider call", async () => {
  const { rows } = await terminalFor("capability_engine_v1", "quota_satisfied");
  assertEquals(rows[0].record_kind, "stage_result");
  assertEquals(rows[0].provider_run_id, null);
  const s = summarizeTaskLedger([
    ...rows,
    { ...buildStartedRow({
      workspace_id: WORKSPACE, stage: "company_discovery", reason: "initial_discovery",
      provider_id: "apify", logical_call_key: "k",
    }), status: "succeeded" } as ExecutionLedgerRow,
  ]);
  assertEquals(s.calls, 1, "the terminal stage result must not count as a paid call");
});
