// The Company Brain writer re-authorizes IN the write's transaction (AUTH-06).
//
// public.company_brain_authorized_write locks the caller's live session and
// membership rows, checks the current role, then writes — one transaction. So a
// removal, demotion or logout either commits first (the write is refused and
// nothing changes) or waits for the write to commit. Real Postgres + PostgREST,
// called as the service role exactly as the Brain handlers call it. Judged by
// what landed (direct SQL), not by the HTTP status.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.5";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

// Real Supabase (and the native lanes, via GoTrue or their own fixture) has
// auth.sessions; this lane's minimal shim does not, so create the columns the
// writer reads, only if missing. Never altered when a real table exists.
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
async function as(role: "service_role" | "authenticated" | "anon", sub?: string) {
  const jwt = await mintJwt(role, sub);
  return createClient(REST_URL, jwt, { auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` }, fetch: gatewayFetch } });
}
async function user(): Promise<{ id: string; session: string }> {
  const id = uuid(); const session = uuid();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id.slice(0, 8)}@contract.test`})`;
  await sql`insert into auth.sessions (id, user_id) values (${session}, ${id})`;
  return { id, session };
}
async function workspaceWith(role: string) {
  const ws = await seedWorkspace();
  const u = await user();
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${u.id}, ${role})`;
  await sql`insert into public.company_brain (workspace_id, profile) values (${ws}, ${sql.json({ company: { name: "Before" } } as never)})`;
  // The exact stored value (a JS Date would drop the microseconds the CAS compares).
  const [{ v }] = await sql`select updated_at::text as v from public.company_brain where workspace_id = ${ws}`;
  return { ws, u, version: v as string };
}
const name = async (ws: string) => (await sql`select profile->'company'->>'name' as n from public.company_brain where workspace_id = ${ws}`)[0]?.n;
const activated = async (ws: string) => (await sql`select onboarding_completed from public.company_brain where workspace_id = ${ws}`)[0]?.onboarding_completed;
async function write(a: { ws: string; actor: string; session: string; permission?: string; mode?: string; version?: string | null; label?: string; activate?: boolean }) {
  const svc = await as("service_role");
  const { data, error } = await svc.rpc("company_brain_authorized_write", {
    p_workspace_id: a.ws, p_actor_id: a.actor, p_session_id: a.session, p_permission: a.permission ?? "edit",
    p_mode: a.mode ?? "cas", p_profile: { company: { name: a.label ?? "After" } },
    p_expected_updated_at: a.version ?? null, p_activate: a.activate === true,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data[0] : data) as { outcome: string; updated_at: string | null };
}

Deno.test("owner, admin and editor write; viewer, legacy roles and non-members are refused and change nothing", opts, async () => {
  for (const role of ["owner", "admin", "editor", " Editor "]) {
    const { ws, u, version } = await workspaceWith(role);
    const r = await write({ ws, actor: u.id, session: u.session, version, label: `by ${role}` });
    assertEquals(r.outcome, "ok", role); assertEquals(await name(ws), `by ${role}`);
  }
  for (const role of ["viewer", "member", "operator", ""]) {
    const { ws, u, version } = await workspaceWith(role);
    const r = await write({ ws, actor: u.id, session: u.session, version });
    assertEquals(r.outcome, "forbidden_role", role); assertEquals(await name(ws), "Before", role);
  }
  const { ws, version } = await workspaceWith("owner");
  const outsider = await user();
  assertEquals((await write({ ws, actor: outsider.id, session: outsider.session, version })).outcome, "not_member");
  assertEquals(await name(ws), "Before");
});

Deno.test("a logged-out, expired or someone else's session is refused", opts, async () => {
  const { ws, u, version } = await workspaceWith("owner");
  assertEquals((await write({ ws, actor: u.id, session: uuid(), version })).outcome, "session_invalid", "unknown session");
  const other = await user();
  assertEquals((await write({ ws, actor: u.id, session: other.session, version })).outcome, "session_invalid", "another user's session");
  await sql`update auth.sessions set not_after = now() - interval '1 minute' where id = ${u.session}`;
  assertEquals((await write({ ws, actor: u.id, session: u.session, version })).outcome, "session_invalid", "expired session");
  assertEquals(await name(ws), "Before");
});

Deno.test("content CAS still holds: a stale version is refused", opts, async () => {
  const { ws, u } = await workspaceWith("owner");
  assertEquals((await write({ ws, actor: u.id, session: u.session, version: "2000-01-01T00:00:00Z" })).outcome, "stale");
  assertEquals(await name(ws), "Before");
});

Deno.test("activation needs owner/admin and sets onboarding_completed in the same write", opts, async () => {
  const e = await workspaceWith("editor");
  assertEquals((await write({ ws: e.ws, actor: e.u.id, session: e.u.session, permission: "activate", version: e.version, activate: true })).outcome, "forbidden_role");
  assertEquals(await activated(e.ws), false);
  const o = await workspaceWith("owner");
  assertEquals((await write({ ws: o.ws, actor: o.u.id, session: o.u.session, permission: "activate", version: o.version, activate: true })).outcome, "ok");
  assertEquals(await activated(o.ws), true);
});

Deno.test("browser roles cannot call the writer at all", opts, async () => {
  const { ws, u, version } = await workspaceWith("owner");
  for (const c of [await as("authenticated", u.id), await as("anon")]) {
    const { error } = await c.rpc("company_brain_authorized_write", {
      p_workspace_id: ws, p_actor_id: u.id, p_session_id: u.session, p_permission: "edit", p_mode: "cas",
      p_profile: { company: { name: "browser" } }, p_expected_updated_at: version, p_activate: false });
    assert(error, "refused");
  }
  assertEquals(await name(ws), "Before");
});

// ── THE RACE: a revocation in flight is never overtaken by the write ─────────
// A second connection begins a revocation and holds it UNCOMMITTED. The write
// must wait on the locked row; when the revocation commits, the write sees it
// and is refused. (Without the locks the write would commit first or ignore it.)
async function raceWith(revoke: (tx: postgres.TransactionSql, ws: string, u: { id: string; session: string }) => Promise<unknown>, expected: string) {
  const { ws, u, version } = await workspaceWith("owner");
  const blocker = postgres(Deno.env.get("DB_CONTRACT_PG_URL")!, { max: 1, onnotice: () => {} });
  let release!: () => void;
  const held = new Promise<void>((r) => release = r);
  let revoked!: () => void;
  const begun = new Promise<void>((r) => revoked = r);
  const tx = blocker.begin(async (t) => { await revoke(t, ws, u); revoked(); await held; });
  await begun;
  const writing = write({ ws, actor: u.id, session: u.session, version });
  const settled = await Promise.race([writing.then(() => "finished"), new Promise((r) => setTimeout(() => r("waiting"), 700))]);
  release(); await tx; await blocker.end();
  const r = await writing;
  return { settled, outcome: r.outcome, name: await name(ws), expected };
}

Deno.test("race: membership removed in flight → the write waits, then is refused", opts, async () => {
  const r = await raceWith((t, ws, u) => t`delete from public.workspace_members where workspace_id = ${ws} and user_id = ${u.id}`, "not_member");
  assertEquals(r.settled, "waiting", "the write waited on the locked membership row");
  assertEquals(r.outcome, "not_member"); assertEquals(r.name, "Before");
});

Deno.test("race: demoted to viewer in flight → the write waits, then is refused", opts, async () => {
  const r = await raceWith((t, ws, u) => t`update public.workspace_members set role = 'viewer' where workspace_id = ${ws} and user_id = ${u.id}`, "forbidden_role");
  assertEquals(r.settled, "waiting");
  assertEquals(r.outcome, "forbidden_role"); assertEquals(r.name, "Before");
});

Deno.test("race: logged out in flight → the write waits, then is refused", opts, async () => {
  const r = await raceWith((t, _ws, u) => t`delete from auth.sessions where id = ${u.session}`, "session_invalid");
  assertEquals(r.settled, "waiting");
  assertEquals(r.outcome, "session_invalid"); assertEquals(r.name, "Before");
});

Deno.test("the read-only pre-check gives the writer's answer and is service-role only", opts, async () => {
  const svc = await as("service_role");
  const check = async (ws: string, actor: string, session: string, permission = "edit") => {
    const { data, error } = await svc.rpc("company_brain_write_authorization",
      { p_workspace_id: ws, p_actor_id: actor, p_session_id: session, p_permission: permission }, { get: true });
    if (error) throw new Error(error.message);
    return data as string;
  };
  const o = await workspaceWith("owner");
  assertEquals(await check(o.ws, o.u.id, o.u.session), "ok");
  assertEquals(await check(o.ws, o.u.id, o.u.session, "activate"), "ok");
  const e = await workspaceWith("editor");
  assertEquals(await check(e.ws, e.u.id, e.u.session, "activate"), "forbidden_role");
  const v = await workspaceWith("viewer");
  assertEquals(await check(v.ws, v.u.id, v.u.session), "forbidden_role");
  assertEquals(await check(o.ws, v.u.id, v.u.session), "not_member");
  assertEquals(await check(o.ws, o.u.id, uuid()), "session_invalid");
  for (const c of [await as("authenticated", o.u.id), await as("anon")]) {
    const { error } = await c.rpc("company_brain_write_authorization",
      { p_workspace_id: o.ws, p_actor_id: o.u.id, p_session_id: o.u.session, p_permission: "edit" }, { get: true });
    assert(error, "browser roles cannot probe another user's authorization");
  }
});
