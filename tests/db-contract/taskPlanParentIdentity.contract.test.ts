// THE PLAN PARENT SIDE (held 20261025150000) against real PostgREST + real
// Postgres: a plan's id and workspace are fixed once it exists, for every
// application writer.
//
// Codex's PLAN-PARENT finding (#185 follow-up): a service writer created a
// valid task in workspace A under plan A, then PATCHed the plan to workspace B
// (200), leaving a committed task under a foreign plan. Codex's own
// reproduction (tests/outpost-native/task-parent-membership-audit.test.ts)
// passes unchanged with this migration; these tests pin the boundary and the
// legitimate writes it must leave alone. mutation.sh removes each part.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };
const gatewayFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return fetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), init);
};
async function as(role: "service_role" | "authenticated", sub?: string): Promise<SupabaseClient> {
  const jwt = await mintJwt(role, sub);
  return createClient(REST_URL, jwt, { auth: { persistSession: false }, global: { fetch: gatewayFetch } });
}
async function world() {
  const ws = await seedWorkspace(), other = await seedWorkspace();
  const member = uuid();
  await sql`insert into auth.users (id, email) values (${member}, ${`pp-${member.slice(0, 8)}@contract.test`})`;
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${member}, 'owner')`;
  const plan = uuid();
  await sql`insert into public.task_plans (id, workspace_id, user_id, user_instruction, status) values (${plan}, ${ws}, ${member}, 'own', 'running')`;
  const task = (await sql`insert into public.tasks (workspace_id, user_id, plan_id, task_plan_id, status, agent_slug, payload)
    values (${ws}, ${member}, ${plan}, ${plan}, 'running', 'scout', '{}') returning id`)[0].id as string;
  return { ws, other, member, plan, task };
}
const planRow = async (id: string) => (await sql`select id, workspace_id, status from public.task_plans where id = ${id}`)[0] ?? null;
const mismatched = async (plan: string) => Number((await sql`select count(*)::int n from public.tasks t join public.task_plans p on p.id = t.plan_id
  where t.plan_id = ${plan} and t.workspace_id is distinct from p.workspace_id`)[0].n);

Deno.test("parent: no application writer moves a plan to another workspace or changes its id", opts, async () => {
  const w = await world();
  const svc = await as("service_role");
  const moved = await svc.from("task_plans").update({ workspace_id: w.other }).eq("id", w.plan).select("id");
  assertEquals(moved.error?.code, "42501", JSON.stringify(moved));
  const renamed = await svc.from("task_plans").update({ id: uuid() }).eq("id", w.plan).select("id");
  assertEquals(renamed.error?.code, "42501", JSON.stringify(renamed));
  const both = await svc.from("task_plans").update({ workspace_id: w.other, status: "done" }).eq("id", w.plan).select("id");
  assertEquals(both.error?.code, "42501", "a status change does not carry a move with it");
  assertEquals((await planRow(w.plan)).workspace_id, w.ws);
  assertEquals((await planRow(w.plan)).status, "running");
  assertEquals(await mismatched(w.plan), 0);
});

Deno.test("parent: a moved-away plan is refused even with no task under it (no window to race a task insert)", opts, async () => {
  const ws = await seedWorkspace(), other = await seedWorkspace(), plan = uuid();
  await sql`insert into public.task_plans (id, workspace_id, user_instruction, status) values (${plan}, ${ws}, 'empty', 'running')`;
  const r = await (await as("service_role")).from("task_plans").update({ workspace_id: other }).eq("id", plan).select("id");
  assertEquals(r.error?.code, "42501");
  assertEquals((await planRow(plan)).workspace_id, ws);
});

Deno.test("parent: a deleted plan's id cannot be re-created in another workspace while tasks still point at it", opts, async () => {
  const ws = await seedWorkspace(), other = await seedWorkspace(), plan = uuid(), member = uuid();
  await sql`insert into auth.users (id, email) values (${member}, ${`pp-${member.slice(0, 8)}@contract.test`})`;
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${member}, 'owner')`;
  await sql`insert into public.task_plans (id, workspace_id, user_instruction, status) values (${plan}, ${ws}, 'gone', 'running')`;
  await sql`insert into public.tasks (workspace_id, user_id, plan_id, status, agent_slug, payload) values (${ws}, ${member}, ${plan}, 'complete', 'scout', '{}')`;
  await sql`delete from public.task_plans where id = ${plan}`; // tasks.plan_id has no foreign key: it outlives the plan
  const svc = await as("service_role");
  const foreign = await svc.from("task_plans").insert({ id: plan, workspace_id: other, user_instruction: "hijack", status: "running" }).select("id");
  assertEquals(foreign.error?.code, "23503", JSON.stringify(foreign));
  assertEquals(await planRow(plan), null);
  const same = await svc.from("task_plans").insert({ id: plan, workspace_id: ws, user_instruction: "restored", status: "running" }).select("id");
  assertEquals(same.error, null, "re-creating it in its own workspace is still allowed");
});

Deno.test("parent positive controls: status writes, new plans and administrative SQL are unchanged", opts, async () => {
  const w = await world();
  const svc = await as("service_role");
  const status = await svc.from("task_plans").update({ status: "complete", completed_at: new Date().toISOString() }).eq("id", w.plan).select("id");
  assertEquals([status.error, status.data?.length], [null, 1], "every application plan write is a status write");
  const fresh = await svc.from("task_plans").insert({ workspace_id: w.ws, user_id: w.member, user_instruction: "new", status: "running" }).select("id");
  assertEquals([fresh.error, fresh.data?.length], [null, 1]);
  // Operators and migrations run as postgres: not an application writer.
  await sql`update public.task_plans set workspace_id = ${w.other} where id = ${(fresh.data![0] as { id: string }).id}`;
  assertEquals((await planRow((fresh.data![0] as { id: string }).id)).workspace_id, w.other);
});
