// Independent supplemental native invariants, no owner implementation changes.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mintJwt,
  REST_URL,
  seedWorkspace,
  sql,
  uuid,
} from "../db-contract/lib/harness.ts";
const opts = { sanitizeResources: false, sanitizeOps: false };
async function request(
  role: string,
  path: string,
  method: string,
  body: unknown,
  actor?: string,
) {
  const token = await mintJwt(role as "service_role" | "authenticated", actor);
  const response = await fetch(`${REST_URL}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
}
async function world() {
  const ws = await seedWorkspace(),
    other = await seedWorkspace(),
    actor = uuid(),
    viewer = uuid();
  for (const id of [actor, viewer]) {
    await sql`insert into auth.users(id,email) values(${id},${`${id}@independent.example`})`;
  }
  await sql`insert into public.workspace_members(workspace_id,user_id,role) values(${ws},${actor},'owner'),(${ws},${viewer},'viewer')`;
  const plan = uuid();
  await sql`insert into public.task_plans(id,workspace_id,user_id,user_instruction,status) values(${plan},${ws},${actor},'synthetic','running')`;
  return { ws, other, actor, viewer, plan };
}
Deno.test(
  "PLAN-PARENT: service cannot move a referenced plan across workspaces",
  opts,
  async () => {
    const w = await world();
    const insert = await request("service_role", "tasks", "POST", {
      workspace_id: w.ws,
      user_id: w.actor,
      plan_id: w.plan,
      status: "running",
      payload: {},
    });
    assertEquals(insert.status, 201);
    const moved = await request(
      "service_role",
      `task_plans?id=eq.${w.plan}`,
      "PATCH",
      { workspace_id: w.other },
    );
    const rows =
      await sql`select t.id from public.tasks t join public.task_plans p on p.id=t.plan_id where t.plan_id=${w.plan} and t.workspace_id is distinct from p.workspace_id`;
    console.log(
      JSON.stringify({
        case: "plan_parent_move",
        status: moved.status,
        mismatched_tasks: rows.length,
      }),
    );
    assertEquals(
      rows.length,
      0,
      "parent relocation must not invalidate existing task workspace ownership",
    );
  },
);
Deno.test(
  "MEMBER-SURFACE: service raw role update cannot bypass promotion_unsupported",
  opts,
  async () => {
    const w = await world();
    const response = await request(
      "service_role",
      `workspace_members?workspace_id=eq.${w.ws}&user_id=eq.${w.viewer}`,
      "PATCH",
      { role: "owner" },
    );
    const [row] =
      await sql`select role from public.workspace_members where workspace_id=${w.ws} and user_id=${w.viewer}`;
    console.log(
      JSON.stringify({
        case: "raw_service_promotion",
        status: response.status,
        role: row.role,
      }),
    );
    assertEquals(
      row.role,
      "viewer",
      "promotion policy must fail closed outside the canonical writers too",
    );
  },
);
Deno.test(
  "MEMBER-SURFACE: service raw DELETE cannot remove the last owner",
  opts,
  async () => {
    const w = await world();
    const response = await request(
      "service_role",
      `workspace_members?workspace_id=eq.${w.ws}&user_id=eq.${w.actor}`,
      "DELETE",
      undefined,
    );
    const [row] =
      await sql`select count(*)::int n from public.workspace_members where workspace_id=${w.ws} and role='owner'`;
    console.log(
      JSON.stringify({
        case: "raw_service_last_owner",
        status: response.status,
        owners: row.n,
      }),
    );
    assertEquals(row.n, 1, "native role surface must preserve the last owner");
  },
);
Deno.test(
  "PLAN app roles: authenticated and service foreign plan_id/task_plan_id inserts fail; own-plan controls commit",
  opts,
  async () => {
    const w = await world(), foreign = uuid();
    await sql`insert into public.task_plans(id,workspace_id,user_id,user_instruction,status) values(${foreign},${w.other},${w.actor},'foreign','running')`;
    for (const role of ["authenticated", "service_role"]) {
      for (const col of ["plan_id", "task_plan_id"]) {
        const r = await request(role, "tasks", "POST", {
          workspace_id: w.ws,
          user_id: w.actor,
          [col]: foreign,
          status: "running",
          payload: {},
        }, w.actor);
        assert(r.status >= 400, `${role}/${col}: ${JSON.stringify(r)}`);
      }
      const ok = await request(role, "tasks", "POST", {
        workspace_id: w.ws,
        user_id: w.actor,
        plan_id: w.plan,
        status: "running",
        payload: {},
      }, w.actor);
      assertEquals(ok.status, 201, JSON.stringify(ok));
    }
  },
);
