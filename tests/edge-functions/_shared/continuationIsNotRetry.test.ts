// A CONTINUATION IS NOT A RETRY — the worker's half, pure.
//
// Canary 53784493 stopped before page 3 because five clean slices spent the V2
// queue's five retries. The database half (refund on a new slice, the slice
// backstop) is replayed against real SQL in
// tests/infra/leadMissionV2ContinuationsNotRetries.test.ts. This file pins the
// decisions the worker makes before and after the call.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cleanContinuationSlices, CONTINUATION_ATTEMPTS_EXHAUSTED, CONTINUATION_SLICES_EXHAUSTED, finalQueueStatus,
  isMissingRpcSignature, type QueueRpc, releaseQueuedMission, RETRY_BUDGET_EXHAUSTED, terminalReasonFor,
  V2_MAX_ATTEMPTS,
} from "../../../supabase/functions/_shared/leadMissionTerminal.ts";
import { mapTaskOutcome } from "../../../supabase/functions/_shared/leadMissionV2Request.ts";
import { createLeadMissionRunner } from "../../../worker/leadMissionRunner.ts";

const CLEAN = { status: "continuation_required", terminal: false, lineageSlices: 5 };

Deno.test("only a clean continuation carries a slice count", () => {
  assertEquals(cleanContinuationSlices(CLEAN), 5);
  assertEquals(cleanContinuationSlices({ ...CLEAN, error: "provider timeout" }), null, "an error is a retry");
  assertEquals(cleanContinuationSlices({ ...CLEAN, aborted: true }), null, "an abort is a retry");
  assertEquals(cleanContinuationSlices({ ...CLEAN, terminal: true, status: "quota_met" }), null);
  assertEquals(cleanContinuationSlices({ ...CLEAN, status: "refused_409" }), null);
  assertEquals(cleanContinuationSlices({ ...CLEAN, lineageSlices: null }), null, "no counter, no claim to a slice");
  assertEquals(cleanContinuationSlices({ ...CLEAN, lineageSlices: 0 }), null);
  assertEquals(cleanContinuationSlices({ ...CLEAN, lineageSlices: 2.5 }), null);
});

Deno.test("CANARY 53784493: the fifth clean slice is released resumable; the database decides", () => {
  assertEquals(finalQueueStatus(CLEAN, V2_MAX_ATTEMPTS), "resumable", "the old rule said `failed` here");
  // Everything else is exactly as before.
  const noCount = { status: "continuation_required", terminal: false };
  assertEquals(finalQueueStatus(noCount, 4), "resumable");
  assertEquals(finalQueueStatus(noCount, V2_MAX_ATTEMPTS), "failed");
  assertEquals(finalQueueStatus({ ...CLEAN, error: "boom" }, V2_MAX_ATTEMPTS), "failed");
  assertEquals(finalQueueStatus({ status: "quota_met", terminal: true }, V2_MAX_ATTEMPTS), "complete");
});

Deno.test("terminal reasons: the database's reason first, the worker's count when there is none", () => {
  assertEquals(terminalReasonFor(CLEAN, 1, "slices_exhausted"), CONTINUATION_SLICES_EXHAUSTED);
  assertEquals(terminalReasonFor(CLEAN, 1, "attempts_exhausted"), CONTINUATION_ATTEMPTS_EXHAUSTED);
  assertEquals(terminalReasonFor({ ...CLEAN, aborted: true }, 1, "attempts_exhausted"), RETRY_BUDGET_EXHAUSTED);
  // An older database returns no reason: unchanged behaviour.
  assertEquals(terminalReasonFor(CLEAN, V2_MAX_ATTEMPTS), CONTINUATION_ATTEMPTS_EXHAUSTED);
  assertEquals(terminalReasonFor({ status: "search_exhausted", terminal: true }, V2_MAX_ATTEMPTS, "x"), "search_exhausted");
});

Deno.test("PGRST202 — and only it — triggers the 4-argument fallback", () => {
  assert(isMissingRpcSignature({ code: "PGRST202", message: "x" }));
  assert(isMissingRpcSignature({ message: "Could not find the function public.release_lead_mission(...)" }));
  assertFalse(isMissingRpcSignature({ code: "57014", message: "canceling statement due to statement timeout" }));
  assertFalse(isMissingRpcSignature(null));
});

function fakeRpc(responses: Array<{ data: unknown; error: { code?: unknown; message?: unknown } | null }>) {
  const calls: Array<Record<string, unknown>> = [];
  const rpc: QueueRpc = async (_fn, args) => {
    calls.push({ ...args });
    return responses.shift()!;
  };
  return { rpc, calls };
}
const R = { queueId: "q", workerId: "w", attempts: 5, outcomeDoc: {} };

Deno.test("release: a clean continuation sends its slice count; anything else sends exactly the old four arguments", async () => {
  const ok = { data: [{ released: true, final_status: "resumable", reason: null, attempts: 0, continuations: 5 }], error: null };
  const a = fakeRpc([ok]);
  const r = await releaseQueuedMission(a.rpc, { ...R, outcome: CLEAN });
  assertEquals(a.calls[0].p_lineage_slices, 5);
  assertEquals([r.finalStatus, r.attempts, r.continuations, r.terminalReason], ["resumable", 0, 5, null]);

  const b = fakeRpc([{ data: [{ released: true, final_status: "failed" }], error: null }]);
  const f = await releaseQueuedMission(b.rpc, { ...R, outcome: { ...CLEAN, error: "boom" } });
  assertEquals(Object.keys(b.calls[0]).sort(), ["p_outcome", "p_queue_id", "p_status", "p_worker_id"]);
  assertEquals([f.finalStatus, f.terminalReason], ["failed", RETRY_BUDGET_EXHAUSTED]);
});

Deno.test("release on a database without the migration: one fallback, the old result", async () => {
  const f = fakeRpc([
    { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
    { data: [{ released: true, final_status: "failed" }], error: null },
  ]);
  const r = await releaseQueuedMission(f.rpc, { ...R, outcome: CLEAN });
  assertEquals(f.calls.length, 2);
  assertFalse("p_lineage_slices" in f.calls[1]);
  assertEquals([r.fallback, r.finalStatus, r.terminalReason], [true, "failed", CONTINUATION_ATTEMPTS_EXHAUSTED],
    "the canary's own ending, reported as before");
});

Deno.test("release errors and refusals: no fallback for other errors; a refused terminal release still reconciles", async () => {
  const e = fakeRpc([{ data: null, error: { code: "57014", message: "timeout" } }]);
  const r = await releaseQueuedMission(e.rpc, { ...R, outcome: CLEAN });
  assertEquals([e.calls.length, r.released, r.error], [1, false, "timeout"]);

  // Ownership lost: the database refuses. As before, the stated status stands.
  const n = fakeRpc([{ data: [{ released: false, final_status: null }], error: null }]);
  const t = await releaseQueuedMission(n.rpc, { ...R, outcome: { status: "quota_met", terminal: true } });
  assertEquals([t.released, t.finalStatus, t.terminalReason], [false, "complete", "quota_met"]);
});

Deno.test("the runner reports the lineage's slice counter with the outcome", async () => {
  const runner = createLeadMissionRunner({
    handler: async () => new Response("{}", { status: 200 }),
    serviceRoleKey: "k", functionsBaseUrl: "http://x",
    createDeadline: () => ({ remainingMs: () => 1e6, expired: () => false }) as never,
    bind: async () => true,
    readTaskOutcome: async () => ({ status: "ready", terminal_status: "continuation_required", lineage_slices: 6 }),
  });
  const out = await runner.run(
    { queueId: "q", workspaceId: "w", request: {}, taskId: "t", lineageId: "t", attempts: 1, isResume: true, heldUntil: null },
    { executionBudgetMs: 1000, signal: new AbortController().signal },
  );
  assertEquals([out.status, out.terminal, out.lineageSlices], ["continuation_required", false, 6]);
  // The mapping itself is untouched.
  assertEquals(mapTaskOutcome({ status: "ready", terminal_status: "continuation_required", lineage_slices: 6 }),
    { status: "continuation_required", terminal: false });
});

Deno.test("the worker releases through releaseQueuedMission and reconciles what it ends", () => {
  const main = Deno.readTextFileSync(new URL("../../../worker/main.ts", import.meta.url));
  assert(main.includes("await releaseQueuedMission((fn, args) => db.rpc(fn, args), {"));
  assert(main.includes("result->lead_lineage_progress->continuations_used"), "the runner reads the slice counter");
  assert(main.includes("if (isTerminalQueueStatus(finalStatus))"));
  assert(main.includes("await reconcileTerminal(finalStatus"));
});
