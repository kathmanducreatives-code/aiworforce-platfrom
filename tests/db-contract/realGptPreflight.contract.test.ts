// The hosted TEST preflight (scripts/test-project/real-gpt/preflight.sql)
// against the lane's database: a prepared workspace passes every check; a
// claimable queue row, a reserved credit and a Company Brain each fail one.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { seedWorkspace, sql, uuid } from "./lib/harness.ts";
import { reconcilePriorLiability } from "./lib/smokeMission.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const preflight = Deno.readTextFileSync(new URL("../../scripts/test-project/real-gpt/preflight.sql", import.meta.url));
const run = async (ws: string) => Object.fromEntries(([...await sql.unsafe(preflight.replaceAll(":'workspace_id'", `'${ws}'`))] as Array<Record<string, string>>)
  .map((r) => [r.id, `${r.result}:${r.actual}`]));

Deno.test("preflight: a prepared TEST workspace passes; each unsafe state fails its check", opts, async () => {
  await reconcilePriorLiability();
  await sql`update public.lead_mission_queue set status = 'complete' where status in ('queued', 'running', 'resumable')`;
  await sql`update public.discovery_smoke_authorizations set status = 'stopped', stop_reason = 'preflight test' where status = 'active'`;
  // As built by build-test-schema.sh: the cron jobs that call a hosted project are detached.
  const before = await run(uuid());
  assertEquals(before.P07.split(":")[0], "FAIL", "undetached hosted cron jobs are caught");
  await sql.unsafe(Deno.readTextFileSync(new URL("../../scripts/local-supabase/01-local-cron-detach.sql", import.meta.url)));
  const ws = await seedWorkspace();
  await sql`insert into public.agents (workspace_id, slug, name, role_prompt, department) values (${ws}, 'scout', 'Scout', 'x', 'research')`;
  await sql`insert into public.workspace_credit_balances (workspace_id, balance_credits) values (${ws}, 10)`;
  const ok = await run(ws);
  for (const id of ["P01", "P02", "P03", "P04", "P07", "P08", "P09", "P10", "P11", "P12", "P13", "P14"]) {
    assertEquals(ok[id].split(":")[0], "PASS", `${id}: ${ok[id]}`);
  }
  // The billing fixes are a decision, never a failure: reported INFO, installed or not (held until approved).
  for (const id of ["P05", "P06"]) assertEquals(ok[id].split(":")[0], "INFO", `${id}: ${ok[id]}`);

  await sql`insert into public.lead_mission_queue (id, workspace_id, request, status) values (${uuid()}, ${ws}, ${sql.json({})}, 'queued')`;
  await sql`update public.workspace_credit_balances set reserved_credits = 1 where workspace_id = ${ws}`;
  const bad = await run(ws);
  assertEquals(bad.P13.split(":")[0], "FAIL", "a claimable row would be run by the worker");
  assertEquals(bad.P09.split(":")[0], "FAIL");
  await sql`update public.lead_mission_queue set status = 'complete' where workspace_id = ${ws}`;
});
