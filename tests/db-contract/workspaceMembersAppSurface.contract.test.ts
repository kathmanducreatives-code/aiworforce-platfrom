// THE MEMBERSHIP WRITE BOUNDARY (held 20261025160000, Codex MEMBER-SURFACE)
// against real PostgREST + real Postgres: application roles change or delete a
// membership ONLY through #186's canonical writers.
//
// Codex's reproduction (tests/outpost-native/task-parent-membership-audit
// .test.ts: a raw service PATCH promoted a viewer to owner; a raw service
// DELETE removed the last owner) passes unchanged with this migration. These
// tests add the trigger's durability (the writes stay refused after a
// re-grant), TRUNCATE, the browser roles, and the writes that must keep
// working: provisioning inserts, the canonical writers, workspace deletion.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };
await sql`create table if not exists auth.sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  not_after timestamptz
)`;
const gatewayFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return fetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), init);
};
async function as(role: "service_role" | "authenticated", sub?: string): Promise<SupabaseClient> {
  const jwt = await mintJwt(role, sub);
  return createClient(REST_URL, jwt, { auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` }, fetch: gatewayFetch } });
}
type User = { id: string; session: string };
async function member(ws: string, role: string): Promise<User> {
  const id = uuid(), session = uuid();
  await sql`insert into auth.users (id, email) values (${id}, ${`ms-${id.slice(0, 8)}@contract.test`})`;
  await sql`insert into auth.sessions (id, user_id) values (${session}, ${id})`;
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${id}, ${role})`;
  return { id, session };
}
const roleOf = async (ws: string, u: User) =>
  (await sql`select role from public.workspace_members where workspace_id = ${ws} and user_id = ${u.id}`)[0]?.role ?? null;
const owners = async (ws: string) =>
  Number((await sql`select count(*)::int n from public.workspace_members where workspace_id = ${ws} and role = 'owner'`)[0].n);

Deno.test("surface: the service role cannot promote, demote or delete a membership directly", opts, async () => {
  const ws = await seedWorkspace();
  const owner = await member(ws, "owner"), viewer = await member(ws, "viewer");
  const svc = await as("service_role");
  const promote = await svc.from("workspace_members").update({ role: "owner" }).eq("workspace_id", ws).eq("user_id", viewer.id).select("role");
  assert(promote.error, `raw promotion refused: ${JSON.stringify(promote)}`);
  const demote = await svc.from("workspace_members").update({ role: "viewer" }).eq("workspace_id", ws).eq("user_id", owner.id).select("role");
  assert(demote.error, "raw demotion of the last owner refused");
  const lastOwner = await svc.from("workspace_members").delete().eq("workspace_id", ws).eq("user_id", owner.id).select("user_id");
  assert(lastOwner.error, "raw delete of the last owner refused");
  const other = await svc.from("workspace_members").delete().eq("workspace_id", ws).eq("user_id", viewer.id).select("user_id");
  assert(other.error, "every raw delete goes through the canonical writer, not only the last owner's");
  for (const r of [promote, demote, lastOwner, other]) {
    assertEquals(r.error?.code, "42501");
    assert(String(r.error?.message).includes("permission denied"), `refused by the grant itself: ${r.error?.message}`);
  }
  assertEquals([await roleOf(ws, owner), await roleOf(ws, viewer), await owners(ws)], ["owner", "viewer", 1]);
});

Deno.test("surface: the invariant holds even if the service role is re-granted the writes (the trigger, not just the grant)", opts, async () => {
  const ws = await seedWorkspace();
  const owner = await member(ws, "owner"), viewer = await member(ws, "viewer");
  await sql`grant update, delete on public.workspace_members to service_role`;
  try {
    const svc = await as("service_role");
    const promote = await svc.from("workspace_members").update({ role: "owner" }).eq("workspace_id", ws).eq("user_id", viewer.id).select("role");
    assertEquals(promote.error?.code, "42501", JSON.stringify(promote));
    assert(String(promote.error?.message).includes("workspace_member_set_role"), "names the canonical writer");
    const del = await svc.from("workspace_members").delete().eq("workspace_id", ws).eq("user_id", owner.id).select("user_id");
    assertEquals(del.error?.code, "42501");
    assert(String(del.error?.message).includes("workspace_member_remove"));
    // A non-role column is not a membership change: still allowed when granted.
    const touch = await svc.from("workspace_members").update({ created_at: new Date().toISOString() })
      .eq("workspace_id", ws).eq("user_id", viewer.id).select("user_id");
    assertEquals(touch.error, null);
  } finally {
    await sql`revoke update, delete on public.workspace_members from service_role`;
  }
  assertEquals([await roleOf(ws, owner), await roleOf(ws, viewer), await owners(ws)], ["owner", "viewer", 1]);
});

Deno.test("surface: TRUNCATE is refused for application roles, by grant and by trigger", opts, async () => {
  const ws = await seedWorkspace();
  await member(ws, "owner");
  const asRole = (grant: boolean) => sql.begin(async (t) => {
    if (grant) await t`grant truncate on public.workspace_members to service_role`;
    await t`set local role service_role`;
    await t`truncate public.workspace_members`;
  }).then(() => "truncated", (e) => `${(e as { code?: string }).code} ${(e as Error).message}`);
  const denied = await asRole(false), triggered = await asRole(true);
  assert(denied.startsWith("42501 permission denied"), `no grant: ${denied}`);
  assert(triggered.startsWith("42501") && triggered.includes("may not truncate"), `granted, the statement trigger refuses: ${triggered}`);
  assertEquals(await owners(ws), 1);
});

Deno.test("surface: a browser role cannot change or delete a membership either", opts, async () => {
  const ws = await seedWorkspace();
  const owner = await member(ws, "owner");
  const me = await as("authenticated", owner.id);
  const up = await me.from("workspace_members").update({ role: "viewer" }).eq("workspace_id", ws).eq("user_id", owner.id).select("role");
  const del = await me.from("workspace_members").delete().eq("workspace_id", ws).eq("user_id", owner.id).select("user_id");
  assert(up.error || (up.data ?? []).length === 0, JSON.stringify(up));
  assert(del.error || (del.data ?? []).length === 0, JSON.stringify(del));
  assertEquals([await roleOf(ws, owner), await owners(ws)], ["owner", 1]);
});

Deno.test("surface positive controls: provisioning inserts, the canonical writers and workspace deletion still work", opts, async () => {
  const ws = await seedWorkspace();
  const owner = await member(ws, "owner"), admin = await member(ws, "admin"), editor = await member(ws, "editor");
  const svc = await as("service_role");
  const fresh = uuid();
  await sql`insert into auth.users (id, email) values (${fresh}, ${`ms-${fresh.slice(0, 8)}@contract.test`})`;
  const ins = await svc.from("workspace_members").insert({ workspace_id: ws, user_id: fresh, role: "viewer" }).select("user_id");
  assertEquals([ins.error, ins.data?.length], [null, 1], "a provisioning insert by the service role is unchanged");
  const rpc = async (fn: string, args: Record<string, unknown>) => (await svc.rpc(fn, args)).data;
  assertEquals(await rpc("workspace_member_set_role", { p_workspace_id: ws, p_target_user_id: editor.id, p_role: "viewer",
    p_actor_id: owner.id, p_session_id: owner.session }), "ok", "the canonical role writer");
  assertEquals(await rpc("workspace_member_remove", { p_workspace_id: ws, p_target_user_id: admin.id,
    p_actor_id: owner.id, p_session_id: owner.session }), "ok", "the canonical removal writer");
  assertEquals([await roleOf(ws, editor), await roleOf(ws, admin)], ["viewer", null]);
  // Deleting the workspace cascades to its memberships (the cascade runs as the table owner).
  const gone = await svc.from("workspaces").delete().eq("id", ws).select("id");
  assertEquals(gone.error, null, JSON.stringify(gone));
  assertEquals(Number((await sql`select count(*)::int n from public.workspace_members where workspace_id = ${ws}`)[0].n), 0);
});
