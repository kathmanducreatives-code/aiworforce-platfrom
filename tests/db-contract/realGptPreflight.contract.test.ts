// The hosted TEST preflight (scripts/test-project/real-gpt/preflight.sql)
// against the lane's database: a prepared workspace passes every check; a
// claimable queue row, a reserved credit and a Company Brain each fail one.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { seedWorkspace, sql, uuid } from "./lib/harness.ts";
import { reconcilePriorLiability } from "./lib/smokeMission.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const preflight = Deno.readTextFileSync(new URL("../../scripts/test-project/real-gpt/preflight.sql", import.meta.url));
/** psql's variables, as a direct connection to the isolated project sets them. */
const REF = "tlvnfrxzjhsjgdofwehb";
const bind = (ws: string, conn: { ref?: string; host?: string; user?: string } = {}) => preflight
  .replaceAll(":'workspace_id'", `'${ws}'`).replaceAll(":'project_ref'", `'${conn.ref ?? REF}'`)
  .replaceAll(":'HOST'", `'${conn.host ?? `db.${REF}.supabase.co`}'`).replaceAll(":'USER'", `'${conn.user ?? "postgres"}'`);
const run = async (ws: string, conn?: Parameters<typeof bind>[1]) => Object.fromEntries(([...await sql.unsafe(bind(ws, conn))] as Array<Record<string, string>>)
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
  for (const id of ["P00", "P01", "P02", "P03", "P04", "P07", "P08", "P09", "P10", "P11", "P12", "P13", "P14", "P15", "P16"]) {
    assertEquals(ok[id].split(":")[0], "PASS", `${id}: ${ok[id]}`);
  }
  // The billing fixes are a decision, never a failure: reported INFO, installed or not (held until approved).
  for (const id of ["P05", "P06", "P17"]) assertEquals(ok[id].split(":")[0], "INFO", `${id}: ${ok[id]}`);

  // P00: the project's identity, from psql's connection variables (pooler form too).
  assertEquals((await run(ws, { host: "aws-0-us-east-1.pooler.supabase.com", user: `postgres.${REF}` })).P00, "PASS:ok");
  assertEquals((await run(ws, { ref: "ohsdatpvfdjdemstoiuj", host: "db.ohsdatpvfdjdemstoiuj.supabase.co" })).P00, "FAIL:a production ref");
  assertEquals((await run(ws, { host: "db.ohsdatpvfdjdemstoiuj.supabase.co" })).P00, "FAIL:connected to production");
  assertEquals((await run(ws, { user: "postgres.ohsdatpvfdjdemstoiuj", host: "aws-0-us-east-1.pooler.supabase.com" })).P00,
    "FAIL:connected to production");
  assertEquals((await run(ws, { host: "db.abcdefghijklmnopqrst.supabase.co" })).P00, "FAIL:connected elsewhere");
  assertEquals((await run(ws, { ref: "" })).P00, "FAIL:not a project ref");
  assertEquals((await run(uuid())).P00, "FAIL:workspace not in this project");

  await sql`insert into public.lead_mission_queue (id, workspace_id, request, status) values (${uuid()}, ${ws}, ${sql.json({})}, 'queued')`;
  await sql`update public.workspace_credit_balances set reserved_credits = 1 where workspace_id = ${ws}`;
  const bad = await run(ws);
  assertEquals(bad.P13.split(":")[0], "FAIL", "a claimable row would be run by the worker");
  assertEquals(bad.P09.split(":")[0], "FAIL");
  // Exactly 10 (the judge's starting balance): 9 or 11 available fails too.
  await sql`update public.workspace_credit_balances set reserved_credits = 0, balance_credits = 11 where workspace_id = ${ws}`;
  assertEquals((await run(ws)).P09.split(":")[0], "FAIL", "the judge would misread a run that started at 11");
  await sql`update public.lead_mission_queue set status = 'complete' where workspace_id = ${ws}`;
});

Deno.test("preflight: without Candidate B's security migrations P15/P16 fail", opts, async () => {
  const ws = await seedWorkspace();
  await sql.begin(async (tx) => {
    await tx`drop trigger tasks_commit_boundary on public.tasks`;
    await tx`grant update on public.workspace_members to service_role`;
    const r = Object.fromEntries(([...await tx.unsafe(bind(ws))] as Array<Record<string, string>>)
      .map((x) => [x.id, `${x.result}:${x.actual}`]));
    assertEquals([r.P15, r.P16], ["FAIL:3", "FAIL:mismatch"]);
    throw new Error("rollback");
  }).catch((e) => { if (e.message !== "rollback") throw e; });
  assertEquals((await sql`select count(*)::int n from pg_trigger where tgname = 'tasks_commit_boundary'`)[0].n, 1, "restored");
});

Deno.test("preflight: a security trigger that exists but is disabled fails P15", opts, async () => {
  const ws = await seedWorkspace();
  await sql.begin(async (tx) => {
    await tx`alter table public.task_plans disable trigger task_plans_parent_identity`;
    const r = Object.fromEntries(([...await tx.unsafe(bind(ws))] as Array<Record<string, string>>)
      .map((x) => [x.id, `${x.result}:${x.actual}`]));
    assertEquals(r.P15, "FAIL:3");
    throw new Error("rollback");
  }).catch((e) => { if (e.message !== "rollback") throw e; });
});
