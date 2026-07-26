// PART 3 + PART 4 — status separation and the durable claim path.
// ZERO network, ZERO provider calls, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  projectStatus, readStatuses, isContinuable, isTerminalOutcome,
  TASK_ROW_STATUSES, TASK_RESULT_STATUSES, TERMINAL_STATUSES,
} from "./taskStatusContract.ts";
import { claimContinuationViaRpc, CLAIM_REFUSAL_MESSAGE, type ClaimRefusal } from "./continuationClaim.ts";

// ---- PART 3: the three vocabularies stay separate --------------------------

Deno.test("3.A the task ROW only ever holds database execution state", () => {
  for (const terminal of TERMINAL_STATUSES) {
    const p = projectStatus(terminal);
    assert((TASK_ROW_STATUSES as readonly string[]).includes(p.rowStatus),
      `${terminal} projected an out-of-vocabulary row status: ${p.rowStatus}`);
    // The sourcing vocabulary must NEVER reach the column.
    assertFalse(["partial", "completed", "continuation_required"].includes(p.rowStatus), terminal);
  }
});

Deno.test("3.B sourcing outcome and quota outcome land in result, not the column", () => {
  const p = projectStatus("continuation_required");
  assertEquals(p.rowStatus, "complete", "a checkpointed task is not still executing");
  assertEquals(p.taskStatus, "partial");
  assertEquals(p.terminalStatus, "continuation_required");
  assert((TASK_RESULT_STATUSES as readonly string[]).includes(p.taskStatus));
});

Deno.test("3.C completion and failure project honestly", () => {
  assertEquals(projectStatus("completed"), { rowStatus: "complete", taskStatus: "completed", terminalStatus: "completed" });
  assertEquals(projectStatus("provider_failure"), { rowStatus: "failed", taskStatus: "failed", terminalStatus: "provider_failure" });
  assertEquals(projectStatus("invalid_request"), { rowStatus: "failed", taskStatus: "failed", terminalStatus: "invalid_request" });
  // A write-boundary violation fails the task whatever the sourcing outcome said.
  assertEquals(projectStatus("completed", "provider_side_write").rowStatus, "failed");
  // Partial outcomes are partial, never "completed".
  for (const t of ["quota_not_met", "search_exhausted", "budget_exhausted", "round_limit_reached"]) {
    assertEquals(projectStatus(t).taskStatus, "partial", t);
  }
});

Deno.test("3.D an unknown outcome degrades to invalid_request, not to success", () => {
  const p = projectStatus("something_new");
  assertEquals(p.terminalStatus, "invalid_request");
  assertEquals(p.rowStatus, "failed");
});

Deno.test("3.E continuation eligibility reads the terminal status only", () => {
  assert(isContinuable("continuation_required"));
  for (const t of ["completed", "search_exhausted", "budget_exhausted", "round_limit_reached", "provider_failure", "invalid_request"]) {
    assertFalse(isContinuable(t), t);
    assert(isTerminalOutcome(t), t);
  }
  assertFalse(isTerminalOutcome("continuation_required"));
});

// ---- PART 3: backward compatibility with already-persisted rows ------------

Deno.test("3.F rows written BEFORE the split are still read correctly", () => {
  // The legacy shape: the sourcing outcome was written into the COLUMN.
  const legacy = readStatuses({ status: "partial", result: { company_first: { status: "continuation_required" } } });
  assertEquals(legacy.taskStatus, "partial");
  assertEquals(legacy.terminalStatus, "continuation_required");
  assert(legacy.legacy, "the adapter must flag a legacy read");

  const legacyDone = readStatuses({ status: "completed", result: { company_first: { status: "completed" } } });
  assertEquals(legacyDone.taskStatus, "completed");
  assertEquals(legacyDone.terminalStatus, "completed");
});

Deno.test("3.G rows written AFTER the split read from result and are not flagged legacy", () => {
  const modern = readStatuses({
    status: "complete",
    result: { task_status: "partial", terminal_status: "continuation_required" },
  });
  assertEquals(modern.rowStatus, "complete");
  assertEquals(modern.taskStatus, "partial");
  assertEquals(modern.terminalStatus, "continuation_required");
  assertFalse(modern.legacy);
});

Deno.test("3.H reading never rewrites — the adapter is pure", () => {
  const row = { status: "partial", result: { company_first: { status: "continuation_required" } } };
  const snapshot = JSON.stringify(row);
  readStatuses(row);
  assertEquals(JSON.stringify(row), snapshot, "a persisted record was mutated by a read");
});

Deno.test("3.I a non-sourcing task is read without inventing sourcing state", () => {
  const plain = readStatuses({ status: "complete", result: {} });
  assertEquals(plain.taskStatus, null);
  assertEquals(plain.terminalStatus, null);
  assertFalse(plain.legacy);
});

// ---- PART 4: the RPC claim path -------------------------------------------

function rpcDb(response: { data: unknown; error: unknown }) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    db: { rpc: async (_fn: string, args: Record<string, unknown>) => { calls.push(args); return response; } },
  };
}

Deno.test("4.A a successful RPC claim reports the new checkpoint version", async () => {
  const { db, calls } = rpcDb({ data: [{ claimed: true, reason: "claimed", task_id: "t", checkpoint_version: 3, held_by: "c", held_until: "2026-07-26T12:05:00Z" }], error: null });
  const r = await claimContinuationViaRpc({ db, taskId: "t", workspaceId: "ws", claimId: "c" });
  assertEquals(r, { available: true, claimed: true, checkpointVersion: 3 });
  // Task AND workspace are both scoped in the call.
  assertEquals(calls[0].p_task_id, "t");
  assertEquals(calls[0].p_workspace_id, "ws");
  assertEquals(calls[0].p_claim_id, "c");
});

Deno.test("4.B every RPC refusal reason maps to a message", async () => {
  const reasons: ClaimRefusal[] = ["already_claimed", "task_not_found", "workspace_mismatch", "no_checkpoint", "already_terminal"];
  for (const reason of reasons) {
    const { db } = rpcDb({ data: [{ claimed: false, reason, task_id: "t", checkpoint_version: 1, held_by: null, held_until: null }], error: null });
    const r = await claimContinuationViaRpc({ db, taskId: "t", workspaceId: "ws", claimId: "c" });
    assert(r.available && !r.claimed, reason);
    assertEquals(r.available && !r.claimed && r.reason, reason);
    assert(CLAIM_REFUSAL_MESSAGE[reason].length > 0, reason);
  }
});

Deno.test("4.C a missing migration reports 'unavailable', never a false claim", async () => {
  for (const error of [{ code: "42883", message: "function does not exist" }, { code: "PGRST202", message: "Could not find the function" }]) {
    const { db } = rpcDb({ data: null, error });
    const r = await claimContinuationViaRpc({ db, taskId: "t", workspaceId: "ws", claimId: "c" });
    assertEquals(r, { available: false }, JSON.stringify(error));
  }
});

Deno.test("4.D a REAL database error fails closed — it is not a claim", async () => {
  const { db } = rpcDb({ data: null, error: { code: "57014", message: "statement timeout" } });
  const r = await claimContinuationViaRpc({ db, taskId: "t", workspaceId: "ws", claimId: "c" });
  assert(r.available && !r.claimed, "a database error must never be treated as a successful claim");
});

Deno.test("4.E a thrown transport error also fails to 'unavailable', not to a claim", async () => {
  const db = { rpc: async () => { throw new Error("network down"); } };
  const r = await claimContinuationViaRpc({ db, taskId: "t", workspaceId: "ws", claimId: "c" });
  assertEquals(r, { available: false });
});

// ---- wiring + migration proofs --------------------------------------------

Deno.test("WIRING: run-agent prefers the RPC and falls back to the conditional update", async () => {
  const src = await Deno.readTextFile(new URL("../run-agent/index.ts", import.meta.url));
  assertStringIncludes(src, "claimContinuationViaRpc({");
  assertStringIncludes(src, "if (rpc.available && !rpc.claimed)");
  assertStringIncludes(src, "const cas = rpc.available");
  assertStringIncludes(src, 'claim_path: rpc.available ? "rpc_for_update" : "conditional_update"');
  // Status separation is applied on the finishing write.
  assertStringIncludes(src, "const statuses = projectStatus(cf.status, cf.writeBoundary.invariantViolation);");
  assertStringIncludes(src, "status: statuses.rowStatus,");
  assertStringIncludes(src, "task_status: statuses.taskStatus,");
  assertStringIncludes(src, "terminal_status: statuses.terminalStatus,");
});

Deno.test("MIGRATION: the claim RPC is a single locking transaction, and is NOT applied", async () => {
  const sql = await Deno.readTextFile(new URL("../../migrations/20260727090000_continuation_claim_lease.sql", import.meta.url));
  // The property the PostgREST version cannot provide.
  assertStringIncludes(sql, "for update");
  assertStringIncludes(sql, "create or replace function public.claim_sourcing_continuation");
  assertStringIncludes(sql, "create or replace function public.release_sourcing_continuation");
  // Tenant scope, terminal refusal, lease expiry, claim identity.
  assertStringIncludes(sql, "workspace_id is distinct from p_workspace_id");
  assertStringIncludes(sql, "already_terminal");
  assertStringIncludes(sql, "continuation_claim_expires_at > now()");
  assertStringIncludes(sql, "checkpoint_version            = public.tasks.checkpoint_version + 1");
  // Additive, reversible, documented rollback.
  assertStringIncludes(sql, "add column if not exists continuation_claim_id uuid");
  assertStringIncludes(sql, "-- ROLLBACK");
  assertStringIncludes(sql, "drop function public.claim_sourcing_continuation");
  // Release is claim-scoped so a straggler cannot clear a successor's lease.
  assertStringIncludes(sql, "and continuation_claim_id = p_claim_id");
  // The row status it writes stays inside the column's vocabulary.
  assertStringIncludes(sql, "'pending', 'running', 'complete', 'failed', 'skipped'");

  // NOT APPLIED: the file exists in the repo and nothing in this branch runs it.
  assertStringIncludes(sql, "NOT APPLIED");
});
