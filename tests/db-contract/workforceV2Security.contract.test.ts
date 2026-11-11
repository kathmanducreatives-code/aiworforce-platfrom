// WORKFORCE V2 SECURITY (held 20261113120000) against real Postgres + PostgREST.
//
// A member's browser session must be able to READ its workspace's signals and
// approvals and must NOT be able to write them: no forged "verified" signal,
// no viewer self-approval through PostgREST. The service role still writes.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

async function as(role: "service_role" | "authenticated", sub?: string): Promise<SupabaseClient> {
  const jwt = await mintJwt(role, sub);
  const f: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return fetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), init);
  };
  return createClient(REST_URL, jwt, { auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` }, fetch: f } });
}
async function member(ws: string, role: string): Promise<string> {
  const id = uuid();
  await sql`insert into auth.users (id, email) values (${id}, ${`sec-${id.slice(0, 8)}@contract.test`})`;
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${id}, ${role})`;
  return id;
}

Deno.test({ name: "approvals: a viewer reads but cannot approve through PostgREST; the service role can", ...opts, fn: async () => {
  const ws = await seedWorkspace();
  const viewer = await member(ws, "viewer");
  const [a] = await sql`insert into public.approvals (workspace_id, title, status, type) values (${ws}, 'Send outreach (fictional)', 'pending', 'send_email') returning id`;
  const v = await as("authenticated", viewer);
  const read = await v.from("approvals").select("id, status").eq("id", a.id);
  assertEquals(read.error, null);
  assertEquals(read.data?.length, 1, "members still read their approvals");
  const patch = await v.from("approvals").update({ status: "approved" }).eq("id", a.id).select();
  assert(patch.error, "a browser update is refused");
  assertEquals(patch.error?.code, "42501");
  const ins = await v.from("approvals").insert({ workspace_id: ws, title: "forged", status: "approved" });
  assertEquals(ins.error?.code, "42501");
  assertEquals((await sql`select status from public.approvals where id = ${a.id}`)[0].status, "pending");
  const svc = await (await as("service_role")).from("approvals").update({ status: "approved" }).eq("id", a.id);
  assertEquals(svc.error, null, "the server-side writer still works");
}});

Deno.test({ name: "signals: a member cannot insert, update or delete signal rows or the watchlist", ...opts, fn: async () => {
  const ws = await seedWorkspace();
  const editor = await member(ws, "owner");
  const c = await as("authenticated", editor);
  for (const t of ["signal_events", "signal_event_evidence", "monitoring_subjects"]) {
    const ins = await c.from(t).insert({ workspace_id: ws });
    assertEquals(ins.error?.code, "42501", `${t}: browser insert refused`);
    const upd = await c.from(t).update({ workspace_id: ws }).eq("workspace_id", ws);
    assertEquals(upd.error?.code, "42501", `${t}: browser update refused`);
    const del = await c.from(t).delete().eq("workspace_id", ws);
    assertEquals(del.error?.code, "42501", `${t}: browser delete refused`);
    const sel = await c.from(t).select("workspace_id").eq("workspace_id", ws);
    assertEquals(sel.error, null, `${t}: members still read`);
  }
}});

Deno.test({ name: "catalog: no write policy remains for browser roles on the four tables", ...opts, fn: async () => {
  const rows = await sql`select tablename, policyname, cmd from pg_policies where schemaname = 'public'
    and tablename in ('approvals', 'signal_events', 'signal_event_evidence', 'monitoring_subjects') and cmd <> 'SELECT'`;
  assertEquals(rows.length, 0, JSON.stringify(rows));
  const grants = await sql`select table_name, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
    and table_name in ('approvals', 'signal_events', 'signal_event_evidence', 'monitoring_subjects')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`;
  assertEquals(grants.length, 0, JSON.stringify(grants));
}});
