// The stale credit reaper against real PostgREST + real Postgres, with the
// evidence written by the production ledger writer and the reservations made
// and settled by the production caller (`authorizeProviderCall` /
// `settleProviderCall`).
//
// A worker that dies after a paid provider run started, but before it settled
// the reservation, leaves the row `reserved` with the run id already in the
// execution ledger. Before the held fix
// (supabase/migrations-held/20261022120000_credits_reaper_charges_confirmed_purchase.sql)
// the reaper refunded it: a confirmed purchase went uncharged. Unused and
// uncertain reservations must still be released exactly as before.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildStartedRow, createLedgerWriter, type LedgerDb } from "../../supabase/functions/_shared/executionLedger.ts";
import {
  authorizeProviderCall, CREDITS_PER_PROVIDER_CALL, settleProviderCall,
} from "../../supabase/functions/_shared/creditAuthorization.ts";
import { seedTask, seedWorkspace, serviceClient, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

async function workspaceWith(balance: number): Promise<string> {
  const ws = await seedWorkspace();
  await sql`insert into public.workspace_credit_balances (workspace_id, balance_credits) values (${ws}, ${balance})`;
  return ws;
}
async function balances(ws: string) {
  const [b] = await sql`select balance_credits, reserved_credits from public.workspace_credit_balances where workspace_id = ${ws}`;
  return { balance: b.balance_credits as number, reserved: b.reserved_credits as number };
}
async function txn(ws: string, key: string) {
  const rows = await sql`select id, status, actual_credits, refunded_credits, reason from public.credit_transactions where workspace_id = ${ws} and idempotency_key = ${key}`;
  assertEquals(rows.length, 1, "one transaction per key");
  return rows[0];
}
const authorize = async (ws: string, key: string, task: string | null, amount?: number) =>
  authorizeProviderCall({
    db: (await serviceClient()) as never, workspace_id: ws, logical_call_key: key, task_id: task,
    mode: "enforce", ...(amount !== undefined ? { amount } : {}),
  });
const settle = async (id: string | null, started: boolean) =>
  settleProviderCall({ db: (await serviceClient()) as never, transaction_id: id, started });
/** Ages a reservation past the reaper window, as a dead worker's would be. */
const age = (id: string | null) =>
  sql`update public.credit_transactions set created_at = now() - interval '31 minutes' where id = ${id!}`;
const reap = async () => {
  const [{ n }] = await sql`select public.credits_release_stale(interval '30 minutes') as n`;
  return n as number;
};

/** The provider-call row the transport writes; `run` is what `onRunStarted` records. */
async function ledgerCall(ws: string, task: string | null, key: string, run: string | null, over: { kind?: string } = {}) {
  const w = createLedgerWriter((await serviceClient()) as unknown as LedgerDb);
  const row = buildStartedRow({
    workspace_id: ws, task_id: task, stage: "discovery", reason: "initial_sourcing",
    provider_id: "apify", actor_id: "fantastic-jobs~career-site-job-listing-api", logical_call_key: key,
    request_input: { selected_actor_key: "apify_jobs" },
    ...(over.kind ? { record_kind: over.kind } : {}),
  } as never);
  await w.insert(row);
  if (run !== null) await w.finalize(row.id!, { provider_run_id: run });  // still `started`: the worker died here
  return row.id!;
}

Deno.test("reaper: a confirmed purchase whose worker died before settling is charged, not refunded", opts, async () => {
  const ws = await workspaceWith(5);
  const task = await seedTask(ws);
  const key = `${task}:jobs-${uuid()}`;
  const a = await authorize(ws, key, task);
  await ledgerCall(ws, task, key, "run-confirmed");
  await age(a.transaction_id);

  assert(await reap() >= 1);
  const t = await txn(ws, key);
  assertEquals(t.status, "charged", "the provider named the run: it was bought");
  assertEquals(t.actual_credits, 1);
  assertEquals(await balances(ws), { balance: 4, reserved: 0 }, "the credit stays spent; nothing is refunded");
});

Deno.test("reaper: a truly unused reservation (no provider call recorded) is still released", opts, async () => {
  const ws = await workspaceWith(5);
  const task = await seedTask(ws);
  const key = `${task}:jobs-${uuid()}`;
  const a = await authorize(ws, key, task);
  await age(a.transaction_id);

  await reap();
  assertEquals((await txn(ws, key)).status, "released");
  assertEquals(await balances(ws), { balance: 5, reserved: 0 }, "the hold is returned in full");
});

Deno.test("reaper: an uncertain start (a provider call with no run id) keeps the approved policy — released", opts, async () => {
  const ws = await workspaceWith(5);
  const task = await seedTask(ws);
  const key = `${task}:jobs-${uuid()}`;
  const a = await authorize(ws, key, task);
  await ledgerCall(ws, task, key, null);  // started; the start answer was lost
  await age(a.transaction_id);

  await reap();
  const t = await txn(ws, key);
  assertEquals(t.status, "released", "no run id is no proof of purchase: the customer is not charged");
  assertEquals(t.reason, "stale reservation released by reaper");
  assertEquals(await balances(ws), { balance: 5, reserved: 0 });
});

Deno.test("reaper: evidence is bound to the workspace — another workspace's run id under the same key confirms nothing", opts, async () => {
  const ws = await workspaceWith(5);
  const other = await seedWorkspace();
  const task = await seedTask(ws);
  const key = `${task}:jobs-${uuid()}`;
  const a = await authorize(ws, key, task);
  await ledgerCall(other, task, key, "run-foreign");
  await age(a.transaction_id);

  await reap();
  assertEquals((await txn(ws, key)).status, "released");
  assertEquals(await balances(ws), { balance: 5, reserved: 0 });
});

Deno.test("reaper: evidence is bound to the task — another task's run id under the same key confirms nothing", opts, async () => {
  const ws = await workspaceWith(5);
  const task = await seedTask(ws);
  const otherTask = await seedTask(ws);
  const key = `shared-key-${uuid()}`;
  const a = await authorize(ws, key, task);
  await ledgerCall(ws, otherTask, key, "run-other-task");
  await age(a.transaction_id);

  await reap();
  assertEquals((await txn(ws, key)).status, "released");
});

Deno.test("reaper: a stage_result row or a blank run id is not evidence of a purchase", opts, async () => {
  const ws = await workspaceWith(5);
  const task = await seedTask(ws);
  const k1 = `${task}:stage-${uuid()}`;
  const k2 = `${task}:blank-${uuid()}`;
  const a1 = await authorize(ws, k1, task);
  const a2 = await authorize(ws, k2, task);
  await ledgerCall(ws, task, k1, null, { kind: "stage_result" });
  await ledgerCall(ws, task, k2, "   ");
  await age(a1.transaction_id);
  await age(a2.transaction_id);

  await reap();
  assertEquals((await txn(ws, k1)).status, "released");
  assertEquals((await txn(ws, k2)).status, "released");
  assertEquals(await balances(ws), { balance: 5, reserved: 0 });
});

Deno.test("reaper: a later attempt of the same call that named the run confirms it", opts, async () => {
  const ws = await workspaceWith(5);
  const task = await seedTask(ws);
  const key = `${task}:jobs-${uuid()}`;
  const a = await authorize(ws, key, task);
  await ledgerCall(ws, task, key, null);             // attempt 1: answer lost
  await ledgerCall(ws, task, key, "run-attempt-2");  // attempt 2 (adoption) recorded the run
  await age(a.transaction_id);

  await reap();
  assertEquals((await txn(ws, key)).status, "charged");
  assertEquals(await balances(ws), { balance: 4, reserved: 0 });
});

Deno.test("reaper: settlement stays idempotent — a late live settle, a second pass and a recovering worker charge once", opts, async () => {
  const ws = await workspaceWith(5);
  const task = await seedTask(ws);
  const key = `${task}:jobs-${uuid()}`;
  const a = await authorize(ws, key, task);
  await ledgerCall(ws, task, key, "run-once");
  await age(a.transaction_id);
  await reap();
  assertEquals(await balances(ws), { balance: 4, reserved: 0 });

  // The stalled first worker wakes and settles: a replay.
  const late = await settle(a.transaction_id, true);
  assertEquals(late.settled, true);
  assertEquals(late.charged, 1, "the replay reports the one charge already taken");
  // A second reaper pass finds nothing reserved under this key.
  await reap();
  // A recovering worker reuses the settled key: a replay, never a second hold.
  const again = await authorize(ws, key, task);
  assertEquals(again.reason, "replayed");
  assertEquals(again.transaction_id, a.transaction_id);
  await settle(again.transaction_id, true);
  assertEquals(await balances(ws), { balance: 4, reserved: 0 }, "one purchase, one credit");
  assertEquals((await txn(ws, key)).status, "charged");
});

Deno.test("reaper: a live settle before the reaper wins, and a delayed reaper changes nothing", opts, async () => {
  const ws = await workspaceWith(5);
  const task = await seedTask(ws);
  const k1 = `${task}:jobs-${uuid()}`;
  const k2 = `${task}:refused-${uuid()}`;
  const a1 = await authorize(ws, k1, task);
  const a2 = await authorize(ws, k2, task);
  await ledgerCall(ws, task, k1, "run-live");
  await settle(a1.transaction_id, true);   // the worker lived: charged
  await ledgerCall(ws, task, k2, "run-ignored");
  await settle(a2.transaction_id, false);  // settled not_charged by the live path: final
  await age(a1.transaction_id);
  await age(a2.transaction_id);

  await reap();
  assertEquals((await txn(ws, k1)).status, "charged");
  assertEquals((await txn(ws, k2)).status, "not_charged", "the reaper never revisits a settled row");
  assertEquals(await balances(ws), { balance: 4, reserved: 0 });
});

Deno.test("reaper: the window still holds — a young confirmed reservation is left to its worker", opts, async () => {
  const ws = await workspaceWith(5);
  const task = await seedTask(ws);
  const key = `${task}:jobs-${uuid()}`;
  await authorize(ws, key, task);
  await ledgerCall(ws, task, key, "run-young");

  await reap();
  assertEquals((await txn(ws, key)).status, "reserved");
  assertEquals(await balances(ws), { balance: 4, reserved: 1 });
});

Deno.test("reaper: never charges more than the live settle would — a quoted hold is charged the per-call credit", opts, async () => {
  assertEquals(CREDITS_PER_PROVIDER_CALL, 1, "the SQL mirrors this constant; change both together");
  const ws = await workspaceWith(10);
  const task = await seedTask(ws);
  const key = `${task}:unlock-${uuid()}`;
  const a = await authorize(ws, key, task, 3);
  assertEquals(await balances(ws), { balance: 7, reserved: 3 });
  await ledgerCall(ws, task, key, "run-quoted");
  await age(a.transaction_id);

  await reap();
  const t = await txn(ws, key);
  assertEquals(t.status, "charged");
  assertEquals(t.actual_credits, CREDITS_PER_PROVIDER_CALL);
  assertEquals(t.refunded_credits, 2);
  assertEquals(await balances(ws), { balance: 9, reserved: 0 });
});

Deno.test("reaper: a non-provider reservation is never charged by ledger evidence", opts, async () => {
  const ws = await workspaceWith(5);
  const task = await seedTask(ws);
  const key = `${task}:unlock-${uuid()}`;
  const [r] = await sql`select public.credits_reserve(${ws}::uuid, 1, ${key}, 'contact_unlock', ${task}::uuid, null) as r`;
  const id = (r.r as { transaction_id: string }).transaction_id;
  await ledgerCall(ws, task, key, "run-unrelated");
  await age(id);

  await reap();
  assertEquals((await txn(ws, key)).status, "released", "only provider and monitoring calls are settled by the ledger");
});
