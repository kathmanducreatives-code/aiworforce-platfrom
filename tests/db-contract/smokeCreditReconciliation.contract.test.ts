// The operator's credit check (scripts/test-project/smoke-credit-reconciliation.sql)
// against the real path: a purchase the admission ledger proves, whose credit
// the execution ledger cannot confirm, is listed once the reaper releases it,
// and the documented correction charges it once. A recovered mission lists
// nothing. Real runner, handler, gate, credits and PostgREST.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sql } from "./lib/harness.ts";
import { runScenario } from "./lib/discoveryScenario.ts";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const opts = { sanitizeOps: false, sanitizeResources: false };
const check = Deno.readTextFileSync(new URL("../../scripts/test-project/smoke-credit-reconciliation.sql", import.meta.url));
const uncharged = async (queueId: string) => [...await sql.unsafe(check.replace(":'queue_id'", `'${queueId}'`))] as Json[];
const reap = async (ws: string) => {
  await sql`update public.credit_transactions set created_at = now() - interval '31 minutes' where workspace_id = ${ws}`;
  await sql`select public.credits_release_stale(interval '30 minutes')`;
};

Deno.test("credit check: a run the gate proved, never adopted, released by the reaper — listed, then corrected and charged once", opts, async () => {
  // Killed between the paid start and its ledger run id; the authorization
  // expires before the next worker, so nothing adopts the run.
  const r = await runScenario({ label: "credit-check-gap", interrupt: "jobs_run_id_write",
    beforeResume: async ({ m }) => {
      await sql`update public.discovery_smoke_authorizations set authorized_at = now() - interval '4 minutes',
                  deadline_at = now() - interval '1 second' where id = ${m.authorizationId}`;
    } });
  const held = await uncharged(r.m.queueId);
  assertEquals(held.map((x) => [x.actor, x.provider_run_id, x.credit_status]), [["apify:harvestapi~linkedin-job-search", "run-jobs", "reserved"]]);

  await reap(r.m.ws);
  const released = await uncharged(r.m.queueId);
  assertEquals(released.map((x) => x.credit_status), ["released"], "the reaper had no proof in the execution ledger");
  const [b0] = await sql`select balance_credits from public.workspace_credit_balances where workspace_id = ${r.m.ws}`;
  assertEquals(b0.balance_credits, 10, "the proven purchase went uncharged");

  // The documented correction: re-arm (balance-checked), then charge.
  const x = released[0];
  await sql`select public.credits_reserve(${x.workspace_id}::uuid, ${x.reserved_credits}::int, ${x.idempotency_key}, 'provider_call', ${x.task_id}::uuid, null)`;
  await sql`select public.credits_finalize(${x.transaction_id}::uuid, ${x.reserved_credits}::int, 'charged', ${"operator: run " + x.provider_run_id + " confirmed by the smoke admission ledger"})`;
  assertEquals(await uncharged(r.m.queueId), [], "nothing left to correct");
  const [b1] = await sql`select balance_credits, reserved_credits from public.workspace_credit_balances where workspace_id = ${r.m.ws}`;
  assertEquals([b1.balance_credits, b1.reserved_credits], [9, 0], "charged once");
  // Running the correction's finalize again is a replay.
  const [again] = await sql`select public.credits_finalize(${x.transaction_id}::uuid, ${x.reserved_credits}::int, 'charged', 'again') as r`;
  assertEquals((again.r as Json).replayed, true);
});

Deno.test("credit check: a mission that adopted its dead slice's run lists nothing", opts, async () => {
  const r = await runScenario({ label: "credit-check-recovered", interrupt: "jobs_run_id_write" });
  assert(r.outcome.qualified.length === 1, JSON.stringify(r.outcome));
  await reap(r.m.ws);
  assertEquals(await uncharged(r.m.queueId), []);
});

Deno.test("credit check: an uncertain start (no run id anywhere) is not listed — it is liability, not a proven purchase", opts, async () => {
  const r = await runScenario({ label: "credit-check-uncertain", interrupt: "jobs_post" });
  await reap(r.m.ws);
  assertEquals(await uncharged(r.m.queueId), []);
});
