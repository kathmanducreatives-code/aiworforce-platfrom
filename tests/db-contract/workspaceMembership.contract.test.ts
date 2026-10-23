// Workspace membership against real PostgREST + real Postgres, as a browser
// with a user JWT: membership is the key to every workspace-scoped policy
// (has_workspace_access), so nobody may grant it to themselves.
//
// Before 20261022120000_close_workspace_self_join.sql, `members_self_insert`
// checked only `user_id = auth.uid()`: a signed-in outsider inserted themselves
// as 'owner' into any workspace whose id they knew, then read and rewrote its
// Company Brain. `workspaces_member_access` was FOR ALL, so any member could
// raise the workspace's quotas or delete it. tests/db-contract/mutation.sh
// builds the database without that migration and requires the first test to
// fail. Every attack is judged by what landed (direct SQL), not by its status.
//
// Positive controls: provisioning still creates the caller's workspace, and a
// member still reads their workspace, membership and own Brain,
// so "refused" cannot pass because the API is broken.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

// The harness's gateway rewrite (supabase-js → bare PostgREST), for a user JWT.
const gatewayFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return fetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), init);
};
async function browserAs(role: "authenticated" | "anon", sub?: string): Promise<SupabaseClient> {
  const jwt = await mintJwt(role, sub);
  return createClient(REST_URL, jwt, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` }, fetch: gatewayFetch },
  });
}
async function user(): Promise<string> {
  const id = uuid();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id.slice(0, 8)}@contract.test`})`;
  return id;
}
/** A workspace with one owner and a Brain holding something private. */
async function victim(): Promise<{ ws: string; owner: string }> {
  const ws = await seedWorkspace();
  const owner = await user();
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${owner}, 'owner')`;
  await sql`insert into public.company_brain (workspace_id, profile)
    values (${ws}, ${sql.json({ company: { name: "Victim Co" }, notes: "pricing floor 40k" } as never)})`;
  return { ws, owner };
}
const memberships = (ws: string, u: string) =>
  sql`select role from public.workspace_members where workspace_id = ${ws} and user_id = ${u}`;
const workspaceRow = async (ws: string) =>
  (await sql`select name, plan, daily_run_limit, tokens_used_today from public.workspaces where id = ${ws}`)[0];
const brainName = async (ws: string) =>
  (await sql`select profile->'company'->>'name' as name from public.company_brain where workspace_id = ${ws}`)[0]?.name;

Deno.test("a signed-in non-member cannot join another workspace, as owner or otherwise", opts, async () => {
  const { ws } = await victim();
  const outsider = await user();
  const browser = await browserAs("authenticated", outsider);

  for (const row of [
    { workspace_id: ws, user_id: outsider, role: "owner" },
    { workspace_id: ws, user_id: outsider, role: "member" },
    { workspace_id: ws, user_id: outsider },                    // role defaults to 'owner'
  ]) {
    const r = await browser.from("workspace_members").insert(row);
    assert(r.error, `the insert ${JSON.stringify(row)} must be refused`);
    assertEquals((await memberships(ws, outsider)).length, 0, `no membership landed for ${JSON.stringify(row)}`);
  }
  const up = await browser.from("workspace_members").upsert({ workspace_id: ws, user_id: outsider, role: "owner" });
  assert(up.error, "nor through an upsert");
  assertEquals((await memberships(ws, outsider)).length, 0);

  // Still an outsider, so the Brain stays closed.
  const read = await browser.from("company_brain").select("profile").eq("workspace_id", ws);
  assertEquals(read.data ?? [], [], "the outsider reads nothing of the victim's Brain");
  await browser.from("company_brain").update({ profile: { company: { name: "hijacked" } } }).eq("workspace_id", ws);
  assertEquals(await brainName(ws), "Victim Co", "and rewrites nothing");
});

Deno.test("a member cannot promote themselves, add someone else, or remove another member", opts, async () => {
  const { ws, owner } = await victim();
  const member = await user();
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${member}, 'member')`;
  const friend = await user();
  const browser = await browserAs("authenticated", member);

  await browser.from("workspace_members").update({ role: "owner" }).eq("workspace_id", ws).eq("user_id", member);
  assertEquals((await memberships(ws, member))[0].role, "member", "the role is unchanged");
  const add = await browser.from("workspace_members").insert({ workspace_id: ws, user_id: friend, role: "owner" });
  assert(add.error, "a member cannot add another user");
  assertEquals((await memberships(ws, friend)).length, 0);
  await browser.from("workspace_members").delete().eq("workspace_id", ws).eq("user_id", owner);
  assertEquals((await memberships(ws, owner)).length, 1, "the owner is still a member");
});

Deno.test("a member cannot change the workspace's plan or quotas, rename it, delete it, or create one", opts, async () => {
  const { ws } = await victim();
  const member = await user();
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${member}, 'member')`;
  const before = await workspaceRow(ws);
  const browser = await browserAs("authenticated", member);

  for (const patch of [{ daily_run_limit: 999999 }, { plan: "enterprise" }, { tokens_used_today: 0 }, { name: "renamed" }]) {
    await browser.from("workspaces").update(patch).eq("id", ws);
    assertEquals(await workspaceRow(ws), before, `${JSON.stringify(patch)} changed nothing`);
  }
  await browser.from("workspaces").delete().eq("id", ws);
  assert(await workspaceRow(ws), "the workspace still exists");
  assertEquals((await memberships(ws, member)).length, 1, "and its memberships did not cascade away");

  const id = uuid();
  const create = await browser.from("workspaces").insert({ id, name: "made in the browser", created_by: member });
  assert(create.error, "workspaces are created by provisioning, not the browser");
  assertEquals((await sql`select 1 from public.workspaces where id = ${id}`).length, 0);

  const rpc = await browser.rpc("increment_tokens", { workspace_id_input: ws, amount: 5 });
  assert(rpc.error, "increment_tokens is not callable from the browser");
  assertEquals(await workspaceRow(ws), before);
});

Deno.test("the anonymous key writes neither table", opts, async () => {
  const { ws } = await victim();
  const anon = await browserAs("anon");
  const outsider = await user();
  const before = await workspaceRow(ws);

  assert((await anon.from("workspace_members").insert({ workspace_id: ws, user_id: outsider })).error);
  assert((await anon.from("workspaces").insert({ name: "anon" })).error);
  await anon.from("workspaces").update({ daily_run_limit: 1 }).eq("id", ws);
  await anon.from("workspaces").delete().eq("id", ws);
  assertEquals((await memberships(ws, outsider)).length, 0);
  assertEquals(await workspaceRow(ws), before);
});

Deno.test("positive control: provisioning and own-workspace, membership and Brain reads still work", opts, async () => {
  const newcomer = await user();
  const browser = await browserAs("authenticated", newcomer);

  const prov = await browser.rpc("provision_workspace_for_user", { _user_id: newcomer });
  assertEquals(prov.error, null, "a signed-in user still provisions their own workspace");
  const ws = prov.data as string;
  assert(ws, "and gets its id");
  assertEquals((await memberships(ws, newcomer))[0]?.role, "owner", "as its owner");

  const mine = await browser.from("workspace_members").select("workspace_id, role").eq("user_id", newcomer);
  assertEquals(mine.error, null);
  assertEquals(mine.data, [{ workspace_id: ws, role: "owner" }], "the member reads their own membership");
  const wsRead = await browser.from("workspaces").select("id, name").eq("id", ws);
  assertEquals(wsRead.error, null);
  assertEquals(wsRead.data?.length, 1, "and their own workspace");

  // The membership gate is proven by a READ: company_brain's select policy is
  // the same has_workspace_access check. (Browser WRITES to the Brain are
  // removed for every role by Company Brain Phase 3a; edits go through the
  // backend, so this control deliberately does not depend on them.)
  const brainRead = await browser.from("company_brain").select("workspace_id").eq("workspace_id", ws);
  assertEquals(brainRead.error, null);
  assertEquals(brainRead.data?.length, 1, "and reads their own Brain (membership gate intact)");

  const { ws: other } = await victim();
  const otherRead = await browser.from("workspaces").select("id").eq("id", other);
  assertEquals(otherRead.data ?? [], [], "but reads no other workspace");
});
