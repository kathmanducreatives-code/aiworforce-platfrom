// PART 3 + PART 4 — status separation and the durable claim path.
// ZERO network, ZERO provider calls, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  projectStatus, projectApprovalPending, readStatuses, isContinuable, isTerminalOutcome,
  isTerminalRowStatus, isResumableRowStatus,
  TASK_ROW_STATUSES, TASK_RESULT_STATUSES, TERMINAL_STATUSES,
} from "./taskStatusContract.ts";
import { claimContinuationViaRpc, classifyClaimError, CLAIM_REFUSAL_MESSAGE, type ClaimRefusal, type ClaimErrorCategory } from "./continuationClaim.ts";

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

Deno.test("1.A continuation_required writes tasks.status = ready", () => {
  const p = projectStatus("continuation_required");
  assertEquals(p, { rowStatus: "ready", taskStatus: "partial", terminalStatus: "continuation_required" });
  assertFalse(p.rowStatus === "complete", "a checkpoint must never be written as complete");
  assert((TASK_RESULT_STATUSES as readonly string[]).includes(p.taskStatus));
});

Deno.test("1.B every genuine terminal outcome writes complete (or failed)", () => {
  assertEquals(projectStatus("completed"), { rowStatus: "complete", taskStatus: "completed", terminalStatus: "completed" });
  assertEquals(projectStatus("search_exhausted"), { rowStatus: "complete", taskStatus: "completed", terminalStatus: "search_exhausted" });
  assertEquals(projectStatus("budget_exhausted"), { rowStatus: "complete", taskStatus: "completed", terminalStatus: "budget_exhausted" });
  assertEquals(projectStatus("round_limit_reached"), { rowStatus: "complete", taskStatus: "completed", terminalStatus: "round_limit_reached" });
  assertEquals(projectStatus("quota_not_met"), { rowStatus: "complete", taskStatus: "completed", terminalStatus: "quota_not_met" });
  assertEquals(projectStatus("provider_failure"), { rowStatus: "failed", taskStatus: "failed", terminalStatus: "provider_failure" });
});

Deno.test("1.C approval-pending is its own row state and is not terminal", () => {
  assertEquals(projectApprovalPending(), { rowStatus: "awaiting_approval", taskStatus: "partial" });
  assertFalse(isTerminalRowStatus("awaiting_approval"));
});

Deno.test("1.D ready is NOT terminal; complete and failed are", () => {
  assertFalse(isTerminalRowStatus("ready"), "a checkpoint is not the end of the lifecycle");
  assertFalse(isTerminalRowStatus("running"));
  assertFalse(isTerminalRowStatus("pending"));
  assert(isTerminalRowStatus("complete"));
  assert(isTerminalRowStatus("failed"));
  assert(isTerminalRowStatus("skipped"));
});

Deno.test("1.E ready is a resumable row state; complete is not (except as legacy)", () => {
  assert(isResumableRowStatus("ready"));
  // Legacy rows persisted before the lifecycle change stay continuable.
  for (const legacy of ["partial", "running", "complete"]) assert(isResumableRowStatus(legacy), legacy);
  for (const never of ["failed", "skipped", "awaiting_approval", "pending", null]) {
    assertFalse(isResumableRowStatus(never as string), String(never));
  }
});

Deno.test("3.C a write-boundary violation fails the task whatever sourcing said", () => {
  assertEquals(projectStatus("completed", "provider_side_write").rowStatus, "failed");
  assertEquals(projectStatus("continuation_required", "provider_side_write").rowStatus, "failed");
  assertEquals(projectStatus("invalid_request"), { rowStatus: "failed", taskStatus: "failed", terminalStatus: "invalid_request" });
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

Deno.test("3.F1 the legacy `done` dialect present in TEST is readable", () => {
  const done = readStatuses({ status: "done", result: {} });
  assertEquals(done.taskStatus, "completed");
  assert(done.legacy);
});

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

// ---- PART 3: the fallback runs ONLY for a genuinely missing function --------
//
// `available: false` is the ONLY value that permits the weaker compatibility
// claim. Every other outcome must keep `available: true`, so run-agent stops.

Deno.test("3.1 RPC succeeds → the fallback never runs", async () => {
  const { db } = rpcDb({ data: [{ claimed: true, reason: "claimed", task_id: "t", checkpoint_version: 1, held_by: "c", held_until: null }], error: null });
  const r = await claimContinuationViaRpc({ db, taskId: "t", workspaceId: "ws", claimId: "c" });
  assert(r.available, "a successful claim must not permit the fallback");
});

Deno.test("3.2-3.8 conflicts, permissions, RLS, database and validation failures never fall back", async () => {
  const cases: Array<[string, { data: unknown; error: unknown }, ClaimErrorCategory]> = [
    ["claim conflict", { data: [{ claimed: false, reason: "already_claimed", task_id: "t", checkpoint_version: 1, held_by: "x", held_until: null }], error: null }, "conflict"],
    ["workspace mismatch", { data: [{ claimed: false, reason: "workspace_mismatch", task_id: "t", checkpoint_version: null, held_by: null, held_until: null }], error: null }, "conflict"],
    ["invalid checkpoint", { data: [{ claimed: false, reason: "no_checkpoint", task_id: "t", checkpoint_version: null, held_by: null, held_until: null }], error: null }, "conflict"],
    ["terminal task", { data: [{ claimed: false, reason: "already_terminal", task_id: "t", checkpoint_version: 1, held_by: null, held_until: null }], error: null }, "conflict"],
    ["permission denied", { data: null, error: { code: "42501", message: "permission denied for table tasks" } }, "permission"],
    ["RLS refusal", { data: null, error: { code: "PGRST301", message: "row-level security policy" } }, "permission"],
    ["database timeout", { data: null, error: { code: "57014", message: "statement timeout" } }, "database"],
    ["connection failure", { data: null, error: { code: "08006", message: "connection failure" } }, "database"],
    ["validation failure", { data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } }, "validation"],
    ["unexpected response", { data: [{ nonsense: true }], error: null }, "unexpected_response"],
    ["unknown error", { data: null, error: { message: "something odd" } }, "unknown"],
  ];
  for (const [name, response, _category] of cases) {
    const { db } = rpcDb(response);
    const r = await claimContinuationViaRpc({ db, taskId: "t", workspaceId: "ws", claimId: "c" });
    assert(r.available, `${name} incorrectly permitted the compatibility fallback`);
    assert(!r.claimed, `${name} was treated as a successful claim`);
  }
});

Deno.test("3.9 ONLY a missing function permits the compatibility fallback", async () => {
  for (const error of [
    { code: "42883", message: "function claim_sourcing_continuation does not exist" },
    { code: "PGRST202", message: "Could not find the function in the schema cache" },
  ]) {
    const { db } = rpcDb({ data: null, error });
    const r = await claimContinuationViaRpc({ db, taskId: "t", workspaceId: "ws", claimId: "c" });
    assertEquals(r, { available: false, category: "missing_function" }, JSON.stringify(error));
  }
});

Deno.test("3.10 a transport failure fails CLOSED — it is not evidence of a missing RPC", async () => {
  const db = { rpc: async () => { throw new Error("network down"); } };
  const r = await claimContinuationViaRpc({ db, taskId: "t", workspaceId: "ws", claimId: "c" });
  assert(r.available, "a network failure must not downgrade to the weaker claim");
  assert(!r.claimed);
  assertEquals(r.available && !r.claimed && r.category, "transport");
});

Deno.test("3.x error classification never leaks raw database text to the user", async () => {
  const { db } = rpcDb({ data: null, error: { code: "42501", message: "permission denied for relation tasks OWNER=postgres" } });
  const r = await claimContinuationViaRpc({ db, taskId: "t", workspaceId: "ws", claimId: "c" });
  assert(r.available && !r.claimed);
  const shown = CLAIM_REFUSAL_MESSAGE[(r.available && !r.claimed && r.reason) as ClaimRefusal];
  assertFalse(shown.includes("postgres"), "raw database text reached user-visible copy");
  assertFalse(shown.includes("permission denied for relation"));
  assertEquals(classifyClaimError({ code: "42501", message: "x" }), "permission");
});

// ---- wiring + migration proofs --------------------------------------------

Deno.test("WIRING: run-agent prefers the RPC and falls back only when it is absent", async () => {
  const src = await Deno.readTextFile(new URL("../run-agent/index.ts", import.meta.url));
  assertStringIncludes(src, "claimContinuationViaRpc({");
  assertStringIncludes(src, "if (rpc.available && !rpc.claimed)");
  assertStringIncludes(src, "const cas = rpc.available");
  assertStringIncludes(src, 'claim_path: rpc.available ? "rpc" : "compatibility_fallback"');
  // Status separation is applied on the finishing write.
  assertStringIncludes(src, "const statuses = projectStatus(cf.status, cf.writeBoundary.invariantViolation);");
  assertStringIncludes(src, "status: statuses.rowStatus,");
  assertStringIncludes(src, "task_status: statuses.taskStatus,");
  assertStringIncludes(src, "terminal_status: statuses.terminalStatus,");
});

// NOTE: these are MIGRATION-CONTRACT tests over the SQL TEXT. They prove the
// file declares the required properties. They are NOT execution proof against a
// real Postgres — that is what the controlled TEST plan exists for.
Deno.test("MIGRATION CONTRACT: the claim RPC declares the required properties, and is NOT applied", async () => {
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
  // Lifecycle: the normal claim is ready → running, and terminal rows are refused.
  assertStringIncludes(sql, "v_row.status is distinct from 'ready'");
  assertStringIncludes(sql, "v_row.status in ('complete', 'failed', 'skipped')");
  assertStringIncludes(sql, "not_resumable_state");
  // The row status the release writes stays inside the lifecycle vocabulary.
  assertStringIncludes(sql, "'pending', 'running', 'ready', 'awaiting_approval', 'complete', 'failed', 'skipped'");
  assertStringIncludes(sql, "p_row_status   text default 'ready'");
  // result is MERGED, never replaced, so a concurrent checkpoint is not lost.
  assertStringIncludes(sql, "coalesce(public.tasks.result, '{}'::jsonb) || jsonb_build_object(");
  assertStringIncludes(sql, "coalesce(public.tasks.result, '{}'::jsonb) - 'continuation_claim'");
  // Security posture.
  assertStringIncludes(sql, "set search_path = public, pg_temp");
  assertStringIncludes(sql, "revoke all on function public.claim_sourcing_continuation");
  assertStringIncludes(sql, "grant execute on function public.claim_sourcing_continuation(uuid, uuid, uuid, integer) to service_role");
  // Strip comments before checking: the header DISCUSSES security definer, it
  // must not USE it.
  const executable = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assertFalse(/security\s+definer/i.test(executable), "SECURITY DEFINER is not needed here");

  // NOT APPLIED: the file exists in the repo and nothing in this branch runs it.
  assertStringIncludes(sql, "NOT APPLIED");
});
