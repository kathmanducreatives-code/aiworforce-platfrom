// The Company Brain against real PostgREST + real Postgres, as a browser with a
// user JWT: no role can write it from the browser; members still read it.
//
// Before 20261023120000_company_brain_server_writes_only.sql, the member insert
// and update policies checked membership only, so a VIEWER rewrote the whole
// Brain with one PATCH (Codex native surface audit, #166). Edits now go only
// through the authorized backend, which checks the caller's role
// (_shared/brainRole.ts). tests/db-contract/mutation.sh builds the database
// without the migration and requires the first test to fail. Every attack is
// judged by what landed (direct SQL), not by the HTTP status.
//
// Positive controls: members of every role still read their Brain, outsiders
// read nothing, and a service-role write (the backend path) still lands.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

const gatewayFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return fetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), init);
};
async function as(role: "authenticated" | "anon" | "service_role", sub?: string): Promise<SupabaseClient> {
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
const ROLES = ["owner", "admin", "editor", "viewer"] as const;
/** A workspace with one member per role and a Brain. */
async function workspace(): Promise<{ ws: string; members: Record<(typeof ROLES)[number], string> }> {
  const ws = await seedWorkspace();
  const members = {} as Record<(typeof ROLES)[number], string>;
  for (const role of ROLES) {
    members[role] = await user();
    await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${members[role]}, ${role})`;
  }
  await sql`insert into public.company_brain (workspace_id, profile)
    values (${ws}, ${sql.json({ company: { name: "Northwind" } } as never)})`;
  return { ws, members };
}
const brainName = async (ws: string) =>
  (await sql`select profile->'company'->>'name' as name from public.company_brain where workspace_id = ${ws}`)[0]?.name;
const brainRows = async (ws: string) => Number((await sql`select count(*)::int as n from public.company_brain where workspace_id = ${ws}`)[0].n);

Deno.test("no member — viewer, editor, admin or owner — writes the Brain from the browser", opts, async () => {
  const { ws, members } = await workspace();
  for (const role of ROLES) {
    const b = await as("authenticated", members[role]);
    await b.from("company_brain").update({ profile: { company: { name: `${role} rewrote` } } }).eq("workspace_id", ws);
    // An unfiltered PATCH skips the SELECT check on the new row; it must not land either.
    await b.from("company_brain").update({ profile: { company: { name: `${role} rewrote all` } } }).neq("workspace_id", "00000000-0000-0000-0000-000000000000");
    assertEquals(await brainName(ws), "Northwind", `${role}: nothing landed`);
    await b.from("company_brain").upsert({ workspace_id: ws, profile: { company: { name: `${role} upsert` } } });
    assertEquals(await brainName(ws), "Northwind", `${role}: upsert refused`);
    await b.from("company_brain").delete().eq("workspace_id", ws);
    assertEquals(await brainRows(ws), 1, `${role}: delete refused`);
  }
});

Deno.test("no one creates a Brain for a workspace from the browser — member, outsider or anon", opts, async () => {
  const ws = await seedWorkspace();
  const owner = await user();
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${owner}, 'owner')`;
  for (const client of [await as("authenticated", owner), await as("authenticated", await user()), await as("anon")]) {
    const r = await client.from("company_brain").insert({ workspace_id: ws, profile: { company: { name: "planted" } } });
    assert(r.error, "the insert is refused");
    assertEquals(await brainRows(ws), 0);
  }
});

Deno.test("reads are unchanged: every member role reads its Brain; an outsider and anon read nothing", opts, async () => {
  const { ws, members } = await workspace();
  for (const role of ROLES) {
    const r = await (await as("authenticated", members[role])).from("company_brain").select("profile").eq("workspace_id", ws);
    assertEquals(r.error, null, role);
    assertEquals((r.data ?? []).length, 1, `${role} reads the Brain`);
  }
  const out = await (await as("authenticated", await user())).from("company_brain").select("profile").eq("workspace_id", ws);
  assertEquals(out.data ?? [], []);
  const anon = await (await as("anon")).from("company_brain").select("profile").eq("workspace_id", ws);
  assertEquals(anon.data ?? [], []);
});

Deno.test("the backend path (service role) still writes, and provisioning still creates the Brain", opts, async () => {
  const { ws } = await workspace();
  const svc = await as("service_role");
  const w = await svc.from("company_brain").update({ profile: { company: { name: "Saved by the backend" } } }).eq("workspace_id", ws).select("workspace_id");
  assertEquals(w.error, null);
  assertEquals(await brainName(ws), "Saved by the backend");

  const newcomer = await user();
  const prov = await (await as("authenticated", newcomer)).rpc("provision_workspace_for_user", { _user_id: newcomer });
  assertEquals(prov.error, null, "provisioning works for the caller");
  assertEquals(await brainRows(String(prov.data)), 1, "and creates the Brain row");
});
