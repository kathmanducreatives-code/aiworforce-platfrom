// THE TASK COMMIT BOUNDARY (held 20261025130000) against real PostgREST + real
// Postgres: a task is authorized in the transaction that writes it.
//
// Codex's independent audit on #179 found two gaps the entry guard alone could
// not close: EXEC-PLAN (a task filed under another workspace's plan) and
// EXEC-REVOKE (a membership removed after the entry check, before the task
// INSERT). Codex's own reproduction (tests/outpost-native/
// execution-integration-audit.test.ts on #185) passes unchanged with this
// migration; these tests pin the database boundary itself, including the
// concurrent case the lock exists for. mutation.sh removes each part.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };
const gatewayFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return fetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), init);
};
let svc: SupabaseClient | null = null;
async function service(): Promise<SupabaseClient> {
  if (svc) return svc;
  const jwt = await mintJwt("service_role");
  svc = createClient(REST_URL, jwt, { auth: { persistSession: false }, global: { fetch: gatewayFetch } });
  return svc;
}
async function world() {
  const ws = await seedWorkspace(), other = await seedWorkspace();
  const member = uuid();
  await sql`insert into auth.users (id, email) values (${member}, ${`cb-${member.slice(0, 8)}@contract.test`})`;
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${member}, 'owner')`;
  const plan = uuid(), foreignPlan = uuid();
  await sql`insert into public.task_plans (id, workspace_id, user_id, user_instruction, status) values (${plan}, ${ws}, ${member}, 'own', 'running')`;
  await sql`insert into public.task_plans (id, workspace_id, user_id, user_instruction, status) values (${foreignPlan}, ${other}, ${member}, 'foreign', 'running')`;
  return { ws, other, member, plan, foreignPlan };
}
const taskCount = async (ws: string) => Number((await sql`select count(*)::int n from public.tasks where workspace_id = ${ws}`)[0].n);
const newTask = (w: { ws: string; member: string }, extra: Record<string, unknown> = {}) =>
  ({ workspace_id: w.ws, user_id: w.member, status: "running", agent_slug: "scout", payload: {}, ...extra });

Deno.test("commit boundary: a task filed under another workspace's plan is refused (plan_id and task_plan_id)", opts, async () => {
  const w = await world(), s = await service();
  for (const col of ["plan_id", "task_plan_id"]) {
    const r = await s.from("tasks").insert(newTask(w, { [col]: w.foreignPlan })).select("id");
    assertEquals(r.error?.code, "23503", `${col}: ${JSON.stringify(r)}`);
  }
  const missing = await s.from("tasks").insert(newTask(w, { plan_id: uuid() })).select("id");
  assertEquals(missing.error?.code, "23503", "a missing plan is refused like a foreign one");
  assertEquals(await taskCount(w.ws), 0);
  // …and an existing task cannot be re-filed under it.
  const own = await s.from("tasks").insert(newTask(w, { plan_id: w.plan })).select("id").single();
  assertEquals(own.error, null, JSON.stringify(own.error));
  const moved = await s.from("tasks").update({ plan_id: w.foreignPlan }).eq("id", own.data!.id).select("id");
  assertEquals(moved.error?.code, "23503");
  assertEquals((await sql`select plan_id from public.tasks where id = ${own.data!.id}`)[0].plan_id, w.plan);
});

Deno.test("commit boundary: a new task's principal must be a current member", opts, async () => {
  const w = await world(), s = await service();
  const stranger = uuid();
  await sql`insert into auth.users (id, email) values (${stranger}, ${`cb-${stranger.slice(0, 8)}@contract.test`})`;
  const r = await s.from("tasks").insert(newTask(w, { user_id: stranger, plan_id: w.plan })).select("id");
  assertEquals(r.error?.code, "42501", JSON.stringify(r));
  const none = await s.from("tasks").insert(newTask(w, { user_id: null, plan_id: w.plan })).select("id");
  assertEquals(none.error?.code, "42501", "no principal, no task");
  assertEquals(await taskCount(w.ws), 0);
});

Deno.test("commit boundary: a membership DELETE racing the INSERT — the INSERT waits, then is refused", opts, async () => {
  const w = await world(), s = await service();
  let deleted!: () => void, release!: () => void;
  const deletedP = new Promise<void>((r) => deleted = r), gate = new Promise<void>((r) => release = r);
  // Session 1 removes the member and holds the transaction open.
  const tx = sql.begin(async (t) => {
    await t`delete from public.workspace_members where workspace_id = ${w.ws} and user_id = ${w.member}`;
    deleted();
    await gate;
  });
  await deletedP;
  // Session 2 (PostgREST, the service role) writes the task meanwhile.
  let settled = false;
  const insert = s.from("tasks").insert(newTask(w, { plan_id: w.plan })).select("id").then((r) => { settled = true; return r; });
  await new Promise((r) => setTimeout(r, 500));
  assert(!settled, "the INSERT must wait on the membership row's lock, not read the pre-delete row");
  release();
  await tx;
  const r = await insert;
  assertEquals(r.error?.code, "42501", JSON.stringify(r));
  assertEquals(await taskCount(w.ws), 0, "nothing committed for a removed member");
});

Deno.test("commit boundary: work already authorized keeps settling after the member is removed", opts, async () => {
  const w = await world(), s = await service();
  const t = await s.from("tasks").insert(newTask(w, { plan_id: w.plan })).select("id").single();
  assertEquals(t.error, null);
  await sql`delete from public.workspace_members where workspace_id = ${w.ws} and user_id = ${w.member}`;
  const settle = await s.from("tasks").update({ status: "failed", result: { terminal_status: "cancelled" } }).eq("id", t.data!.id).select("id");
  assertEquals(settle.error, null, "status/result writes do not re-authorize");
  assertEquals((await sql`select status from public.tasks where id = ${t.data!.id}`)[0].status, "failed");
});

Deno.test("commit boundary positive controls: an own-plan task by a member commits; administrative SQL is not an app writer", opts, async () => {
  const w = await world(), s = await service();
  const ok = await s.from("tasks").insert(newTask(w, { plan_id: w.plan, task_plan_id: w.plan })).select("id");
  assertEquals([ok.error, ok.data?.length], [null, 1]);
  const noPlan = await s.from("tasks").insert(newTask(w)).select("id");
  assertEquals([noPlan.error, noPlan.data?.length], [null, 1], "a task without a plan (direct lead actions) still commits");
  // Fixtures, migrations and operators run as postgres: unchanged.
  await sql`insert into public.tasks (workspace_id, status, agent_slug, payload) values (${w.ws}, 'running', 'scout', '{}')`;
  assertEquals(await taskCount(w.ws), 3);
});
