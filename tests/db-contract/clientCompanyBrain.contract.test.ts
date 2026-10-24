// Company Brain Phase 3c: separate, isolated Brains per client (HELD schema).
//
// Real Postgres + PostgREST, called as the service role through the real
// server helper (_shared/clientBrain.ts), with every HTTP request it sends
// recorded. A refusal is judged by what is stored (direct SQL) — every denied
// operation must leave the agency's whole client/grant/Brain state, and its
// agency Brain, byte-for-byte unchanged — and, for an early refusal, by zero
// write requests. In-flight revocations are held UNCOMMITTED on a second
// connection; the writer must be seen WAITING on a lock in pg_stat_activity
// (an observed event with a bounded deadline, never a timeout taken as a pass),
// then refused once the revocation commits.
import { assert, assertEquals, assertNotEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.5";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";
import {
  clientBrainContextForScope, pinClientBrain, readClientBrain, resolveBrainScope, writeClientBrain,
  type ClientBrainPins,
} from "../../supabase/functions/_shared/clientBrain.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

// The lane's shim has no auth.sessions (real Supabase and the native lanes do);
// create the columns the rules read, only if missing.
await sql`create table if not exists auth.sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  not_after timestamptz
)`;

// ── Clients ──────────────────────────────────────────────────────────────────
type Req = { method: string; url: string };
const restHost = new URL(REST_URL).host;
async function as(role: "service_role" | "authenticated" | "anon", sub?: string, log?: Req[]): Promise<SupabaseClient> {
  const jwt = await mintJwt(role, sub);
  const f: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    log?.push({ method: (init?.method ?? "GET").toUpperCase(), url });
    return fetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), init);
  };
  return createClient(REST_URL, jwt, { auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` }, fetch: f } });
}
const writes = (log: Req[]) => log.filter((r) => r.method !== "GET" && r.method !== "HEAD").length;
const external = (log: Req[]) => log.filter((r) => new URL(r.url).host !== restHost).length;

// ── Fixture: one agency workspace, two clients with overlapping external ids ─
type User = { id: string; session: string };
async function user(): Promise<User> {
  const id = uuid(); const session = uuid();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id.slice(0, 8)}@contract.test`})`;
  await sql`insert into auth.sessions (id, user_id) values (${session}, ${id})`;
  return { id, session };
}
async function member(ws: string, role: string): Promise<User> {
  const u = await user();
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${u.id}, ${role})`;
  return u;
}
async function rpc1<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const svc = await as("service_role");
  const { data, error } = await svc.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return (Array.isArray(data) ? data[0] : data) as T;
}
const createClientAccount = (ws: string, a: User, name: string) =>
  rpc1<{ outcome: string; client_id: string }>("client_account_create", { p_workspace_id: ws, p_actor_id: a.id, p_session_id: a.session, p_name: name });
const grant = (ws: string, client: string, target: string, a: User) =>
  rpc1<{ outcome: string; grant_id: string; generation: number }>("client_access_grant",
    { p_workspace_id: ws, p_client_id: client, p_target_user_id: target, p_actor_id: a.id, p_session_id: a.session });
const revoke = (ws: string, client: string, target: string, a: User) =>
  rpc1<{ outcome: string; grant_id: string; generation: number }>("client_access_revoke",
    { p_workspace_id: ws, p_client_id: client, p_target_user_id: target, p_actor_id: a.id, p_session_id: a.session });
const archive = (ws: string, client: string, a: User) =>
  rpc1<{ outcome: string; revoked_grants: number }>("client_account_archive",
    { p_workspace_id: ws, p_client_id: client, p_actor_id: a.id, p_session_id: a.session });

// The owner bootstraps everything through the real writers: create both
// clients, self-grant (audited), write each client's first Brain, then the
// grants the test needs are added by the test.
async function agency() {
  const ws = await seedWorkspace();
  const owner = await member(ws, "owner");
  const admin = await member(ws, "admin");
  const editor = await member(ws, "editor");
  const viewer = await member(ws, "viewer");
  await sql`insert into public.company_brain (workspace_id, profile) values (${ws}, ${sql.json({ company: { name: "Agency" }, voice: "agency voice" } as never)})`;
  const A = (await createClientAccount(ws, owner, "Client A")).client_id;
  const B = (await createClientAccount(ws, owner, "Client B")).client_id;
  const svc = await as("service_role");
  for (const [c, label] of [[A, "A"], [B, "B"]] as const) {
    assertEquals((await grant(ws, c, owner.id, owner)).outcome, "ok");
    const w = await writeClientBrain(svc, { workspaceId: ws, clientId: c, actorId: owner.id, sessionId: owner.session,
      permission: "edit", mode: "insert",
      profile: { company: { name: `Client ${label}` }, icp: `${label} buyers`, voice: `${label} voice`, external: { apollo_org_id: "SHARED-1" } } });
    assertEquals(w.outcome, "ok");
    assertEquals((await revoke(ws, c, owner.id, owner)).outcome, "ok"); // owner holds no grant by default (P3-D3)
  }
  return { ws, owner, admin, editor, viewer, A, B };
}
type Agency = Awaited<ReturnType<typeof agency>>;

// Everything an agency has, in one fingerprint (client rows, every grant
// generation, every client Brain, the agency Brain).
async function state(ws: string): Promise<string> {
  const [r] = await sql`select md5(concat_ws('|',
    (select coalesce(string_agg(row(c.*)::text, ',' order by c.id), '') from public.client_accounts c where c.workspace_id = ${ws}),
    (select coalesce(string_agg(row(g.*)::text, ',' order by g.id), '') from public.client_access_grants g where g.workspace_id = ${ws}),
    (select coalesce(string_agg(row(b.*)::text, ',' order by b.client_id), '') from public.client_company_brain b where b.workspace_id = ${ws}),
    (select coalesce(string_agg(row(a.*)::text, ','), '') from public.company_brain a where a.workspace_id = ${ws}))) as h`;
  return r.h as string;
}
const clientName = async (ws: string, c: string) =>
  (await sql`select profile->'company'->>'name' as n from public.client_company_brain where workspace_id = ${ws} and client_id = ${c}`)[0]?.n;
const version = async (ws: string, c: string) =>
  Number((await sql`select version from public.client_company_brain where workspace_id = ${ws} and client_id = ${c}`)[0]?.version);
const agencyName = async (ws: string) =>
  (await sql`select profile->'company'->>'name' as n from public.company_brain where workspace_id = ${ws}`)[0]?.n;

async function readAs(ag: Agency, u: User, client: string | null, extra: { intent?: "task"; pins?: ClientBrainPins } = {}) {
  return readClientBrain(await as("service_role"), { workspaceId: ag.ws, clientId: client, actorId: u.id, sessionId: u.session, ...extra });
}
async function writeAs(ag: Agency, u: User, client: string | null, label: string,
  extra: { permission?: "edit" | "activate"; activate?: boolean; expectedVersion?: number; intent?: "task"; pins?: ClientBrainPins; log?: Req[] } = {}) {
  const expected = extra.expectedVersion ?? (client ? await version(ag.ws, client) : 1);
  return writeClientBrain(await as("service_role", undefined, extra.log), {
    workspaceId: ag.ws, clientId: client, actorId: u.id, sessionId: u.session, permission: extra.permission ?? "edit",
    mode: "cas", expectedVersion: expected, profile: { company: { name: label } }, activate: extra.activate,
    intent: extra.intent, pins: extra.pins,
  });
}
// A denied operation: refused with `expected`, nothing stored changed, and no
// write request reached the database (an early refusal by the GET pre-check).
async function denied(ag: Agency, run: (log: Req[]) => Promise<{ outcome: string }>, expected: string, why: string) {
  const before = await state(ag.ws);
  const log: Req[] = [];
  const r = await run(log);
  assertEquals(r.outcome, expected, why);
  assertEquals(await state(ag.ws), before, `${why}: state unchanged`);
  assertEquals(writes(log), 0, `${why}: no write request`);
  assertEquals(external(log), 0, `${why}: no request outside the local database`);
}

// ── 1. Two clients in one agency workspace ───────────────────────────────────
Deno.test("1. two clients in one workspace keep separate Brains, even with the same external ids", opts, async () => {
  const ag = await agency();
  await grant(ag.ws, ag.A, ag.editor.id, ag.owner);
  await grant(ag.ws, ag.B, ag.editor.id, ag.owner);
  const a = await readAs(ag, ag.editor, ag.A);
  const b = await readAs(ag, ag.editor, ag.B);
  assert(a.outcome === "ok" && b.outcome === "ok");
  assertEquals(a.brain.profile?.icp, "A buyers");
  assertEquals(b.brain.profile?.icp, "B buyers");
  assertEquals((a.brain.profile?.external as Record<string, string>).apollo_org_id, (b.brain.profile?.external as Record<string, string>).apollo_org_id);
  assertEquals((await writeAs(ag, ag.editor, ag.A, "A edited")).outcome, "ok");
  assertEquals(await clientName(ag.ws, ag.A), "A edited");
  assertEquals(await clientName(ag.ws, ag.B), "Client B", "editing A never touches B");
});

// ── 2. A user granted only one client ────────────────────────────────────────
Deno.test("2. a user granted only client A reads and edits A, and can neither read, write nor list B", opts, async () => {
  const ag = await agency();
  await grant(ag.ws, ag.A, ag.editor.id, ag.owner);
  assertEquals((await readAs(ag, ag.editor, ag.A)).outcome, "ok");
  await denied(ag, () => readAs(ag, ag.editor, ag.B), "no_grant", "read B");
  await denied(ag, (log) => writeAs(ag, ag.editor, ag.B, "B hijack", { log }), "no_grant", "write B");
  const svc = await as("service_role");
  const { data: mine } = await svc.rpc("client_accounts_for_actor", { p_workspace_id: ag.ws, p_actor_id: ag.editor.id, p_session_id: ag.editor.session });
  assertEquals((mine as { client_id: string }[]).map((r) => r.client_id), [ag.A], "the switcher lists only A");
  // Browser (RLS): only the granted client's id and name, never B's (O1).
  const browser = await as("authenticated", ag.editor.id);
  const { data: rows } = await browser.from("client_accounts").select("id,name");
  assertEquals((rows as { id: string }[]).map((r) => r.id), [ag.A]);
  const { data: brains, error } = await browser.from("client_company_brain").select("*");
  assert(error || (brains as unknown[]).length === 0, "no browser access to client Brains");
  // A viewer with a grant reads but never edits.
  await grant(ag.ws, ag.A, ag.viewer.id, ag.owner);
  assertEquals((await readAs(ag, ag.viewer, ag.A)).outcome, "ok");
  await denied(ag, (log) => writeAs(ag, ag.viewer, ag.A, "viewer edit", { log }), "forbidden_role", "viewer write");
});

// ── 3. Owners and admins without an explicit grant ───────────────────────────
Deno.test("3. owner and admin without a grant get no client data, only management; a self-grant is recorded", opts, async () => {
  const ag = await agency();
  for (const u of [ag.owner, ag.admin]) {
    await denied(ag, () => readAs(ag, u, ag.A), "no_grant", "ungranted read");
    await denied(ag, (log) => writeAs(ag, u, ag.A, "x", { log }), "no_grant", "ungranted write");
  }
  const list = await (await as("service_role")).rpc("client_account_manage_list", { p_workspace_id: ag.ws, p_actor_id: ag.admin.id, p_session_id: ag.admin.session });
  assertEquals((list.data as { name: string }[]).map((r) => r.name), ["Client A", "Client B"], "management listing: names, not data");
  const refused = await (await as("service_role")).rpc("client_account_manage_list", { p_workspace_id: ag.ws, p_actor_id: ag.editor.id, p_session_id: ag.editor.session });
  assertEquals((refused.data as { outcome: string; name: string | null }[]).map((r) => [r.outcome, r.name]), [["forbidden_role", null]]);
  const g = await grant(ag.ws, ag.A, ag.admin.id, ag.admin);
  assertEquals(g.outcome, "ok");
  const [row] = await sql`select granted_by, generation from public.client_access_grants where id = ${g.grant_id}`;
  assertEquals(row.granted_by, ag.admin.id, "self-grant audited with the actor");
  assertEquals((await readAs(ag, ag.admin, ag.A)).outcome, "ok");
  await denied(ag, () => readAs(ag, ag.admin, ag.B), "no_grant", "still no B");
  // Editors and viewers cannot manage.
  assertEquals((await grant(ag.ws, ag.B, ag.editor.id, ag.editor)).outcome, "forbidden_role");
  assertEquals((await createClientAccount(ag.ws, ag.editor, "C")).outcome, "forbidden_role");
  assertEquals((await archive(ag.ws, ag.A, ag.viewer)).outcome, "forbidden_role");
});

// ── Races: a revocation held uncommitted while the write is in flight ────────
const PG_URL = Deno.env.get("DB_CONTRACT_PG_URL")!;
// Wait until a backend running `fn` is blocked on a lock; bounded. Returns false
// if it never blocked (the test then fails: the write did not wait).
async function blockedOnLock(fn: string, ms = 10_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const [r] = await sql`select count(*)::int as n from pg_stat_activity
      where wait_event_type = 'Lock' and state = 'active' and query ilike ${"%" + fn + "%"} and pid <> pg_backend_pid()`;
    if (r.n > 0) return true;
    await new Promise((res) => setTimeout(res, 20));
  }
  return false;
}
async function race(ag: Agency, revocation: (tx: postgres.TransactionSql) => Promise<unknown>, op: () => Promise<{ outcome: string }>) {
  const blocker = postgres(PG_URL, { max: 1, onnotice: () => {} });
  let release!: () => void; const held = new Promise<void>((r) => release = r);
  let begun!: () => void; const started = new Promise<void>((r) => begun = r);
  const tx = blocker.begin(async (t) => { await revocation(t); begun(); await held; });
  await started;
  const before = await state(ag.ws);
  const running = op();
  const waited = await blockedOnLock("client_brain_authorized_write");
  release(); await tx; await blocker.end();
  const r = await running;
  return { waited, outcome: r.outcome, before };
}
const adminCall = (t: postgres.TransactionSql, fn: string, args: unknown[]) =>
  t.unsafe(`select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")})`, args as never[]);

// ── 4. Grant revoked during a request ────────────────────────────────────────
Deno.test("4. race: grant revoked in flight → the write waits on the lock, then is refused; nothing written", opts, async () => {
  const ag = await agency();
  await grant(ag.ws, ag.A, ag.editor.id, ag.owner);
  const r = await race(ag, (t) => adminCall(t, "client_access_revoke", [ag.ws, ag.A, ag.editor.id, ag.owner.id, ag.owner.session]),
    () => writeAs(ag, ag.editor, ag.A, "after revoke"));
  assert(r.waited, "the writer was seen waiting on the locked membership/grant row");
  assertEquals(r.outcome, "no_grant");
  assertEquals(await clientName(ag.ws, ag.A), "Client A");
});

// ── 5. Revocation followed by re-grant ───────────────────────────────────────
Deno.test("5. revoke → regrant: a new generation; a task pinned to the old one is refused, read and write", opts, async () => {
  const ag = await agency();
  const g1 = await grant(ag.ws, ag.A, ag.editor.id, ag.owner);
  const p = await pinClientBrain(await as("service_role"), { workspaceId: ag.ws, clientId: ag.A, actorId: ag.editor.id, sessionId: ag.editor.session }, "edit");
  assert(p.outcome === "ok"); const oldPins = p.pins;
  assertEquals(oldPins.grantId, g1.grant_id); assertEquals(oldPins.generation, 1);
  assertEquals((await readAs(ag, ag.editor, ag.A, { intent: "task", pins: oldPins })).outcome, "ok", "pins hold before any change");
  await revoke(ag.ws, ag.A, ag.editor.id, ag.owner);
  await denied(ag, () => readAs(ag, ag.editor, ag.A, { intent: "task", pins: oldPins }), "grant_changed", "pinned read after revoke");
  const g2 = await grant(ag.ws, ag.A, ag.editor.id, ag.owner);
  assertEquals(g2.generation, 2); assertNotEquals(g2.grant_id, g1.grant_id);
  await denied(ag, () => readAs(ag, ag.editor, ag.A, { intent: "task", pins: oldPins }), "grant_changed", "old pin after regrant (read)");
  await denied(ag, (log) => writeAs(ag, ag.editor, ag.A, "old task", { intent: "task", pins: oldPins, log }), "grant_changed", "old pin after regrant (write)");
  assertEquals((await writeAs(ag, ag.editor, ag.A, "new interactive")).outcome, "ok", "the user's own new request works");
  // Revocation is terminal: the old generation can never be revived.
  await assertRejects(() => sql`update public.client_access_grants set revoked_at = null, revoked_by = null, revoke_reason = null where id = ${g1.grant_id}`);
  await assertRejects(() => sql`delete from public.client_access_grants where id = ${g1.grant_id}`);
  // A task cannot simply omit its pins, and an interactive call cannot carry them.
  const svc = await as("service_role");
  const { error: e1 } = await svc.rpc("client_brain_read", { p_workspace_id: ag.ws, p_client_id: ag.A, p_actor_id: ag.editor.id, p_session_id: ag.editor.session, p_intent: "task" }, { get: true });
  assert(e1, "task without pins refused");
  const { error: e2 } = await svc.rpc("client_brain_read", { p_workspace_id: ag.ws, p_client_id: ag.A, p_actor_id: ag.editor.id, p_session_id: ag.editor.session, p_intent: "interactive", p_pin_generation: 1 }, { get: true });
  assert(e2, "interactive with pins refused");
});

// ── 6. Role demotion during execution ────────────────────────────────────────
Deno.test("6. race: demoted to viewer in flight → waits, then forbidden_role; a pinned task is refused after demote→promote", opts, async () => {
  const ag = await agency();
  await grant(ag.ws, ag.A, ag.editor.id, ag.owner);
  const r = await race(ag, (t) => t`update public.workspace_members set role = 'viewer' where workspace_id = ${ag.ws} and user_id = ${ag.editor.id}`,
    () => writeAs(ag, ag.editor, ag.A, "after demote"));
  assert(r.waited); assertEquals(r.outcome, "forbidden_role");
  assertEquals(await clientName(ag.ws, ag.A), "Client A");
  // The grant survives a role change (O2); the live role still gates edit.
  assertEquals((await readAs(ag, ag.editor, ag.A)).outcome, "ok", "viewer with a grant still reads");
  const p = await pinClientBrain(await as("service_role"), { workspaceId: ag.ws, clientId: ag.A, actorId: ag.editor.id, sessionId: ag.editor.session }, "read");
  assert(p.outcome === "ok");
  await sql`update public.workspace_members set role = 'editor' where workspace_id = ${ag.ws} and user_id = ${ag.editor.id}`;
  await sql`update public.workspace_members set role = 'viewer' where workspace_id = ${ag.ws} and user_id = ${ag.editor.id}`;
  await denied(ag, () => readAs(ag, ag.editor, ag.A, { intent: "task", pins: p.pins }), "permission_changed", "demote→promote→… moves the revision");
  // A no-op update does not move it; nothing but a role change or a new membership does.
  const [{ r1 }] = await sql`select permission_revision::text as r1 from public.workspace_members where workspace_id = ${ag.ws} and user_id = ${ag.editor.id}`;
  await sql`update public.workspace_members set role = role, permission_revision = 1 where workspace_id = ${ag.ws} and user_id = ${ag.editor.id}`;
  const [{ r2 }] = await sql`select permission_revision::text as r2 from public.workspace_members where workspace_id = ${ag.ws} and user_id = ${ag.editor.id}`;
  assertEquals(r2, r1, "the revision cannot be set by hand");
});

Deno.test("6b. race: membership removed in flight → not_member and every grant revoked; remove → rejoin → regrant refuses the old task", opts, async () => {
  const ag = await agency();
  await grant(ag.ws, ag.A, ag.editor.id, ag.owner);
  await grant(ag.ws, ag.B, ag.editor.id, ag.owner);
  const p = await pinClientBrain(await as("service_role"), { workspaceId: ag.ws, clientId: ag.A, actorId: ag.editor.id, sessionId: ag.editor.session }, "edit");
  assert(p.outcome === "ok");
  const r = await race(ag, (t) => t`delete from public.workspace_members where workspace_id = ${ag.ws} and user_id = ${ag.editor.id}`,
    () => writeAs(ag, ag.editor, ag.A, "after removal"));
  assert(r.waited); assertEquals(r.outcome, "not_member");
  const grants = await sql`select revoke_reason from public.client_access_grants where workspace_id = ${ag.ws} and user_id = ${ag.editor.id}`;
  assertEquals(grants.map((g) => g.revoke_reason).sort(), ["membership_removed", "membership_removed"], "removal revoked both grants in the same transaction");
  // Rejoin and regrant: a new membership revision AND a new generation.
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ag.ws}, ${ag.editor.id}, 'editor')`;
  await denied(ag, () => readAs(ag, ag.editor, ag.A), "no_grant", "rejoining restores nothing");
  await grant(ag.ws, ag.A, ag.editor.id, ag.owner);
  await denied(ag, (log) => writeAs(ag, ag.editor, ag.A, "revived task", { intent: "task", pins: p.pins, log }), "grant_changed", "old grant pin");
  const fresh = await pinClientBrain(await as("service_role"), { workspaceId: ag.ws, clientId: ag.A, actorId: ag.editor.id, sessionId: ag.editor.session }, "edit");
  assert(fresh.outcome === "ok");
  assertNotEquals(fresh.pins.permissionRevision, p.pins.permissionRevision, "a rejoin never repeats a revision");
  await denied(ag, () => readAs(ag, ag.editor, ag.A, { intent: "task", pins: { ...fresh.pins, permissionRevision: p.pins.permissionRevision } }), "permission_changed", "old revision pin");
});

Deno.test("6c. race: logged out in flight → session_invalid; nothing written", opts, async () => {
  const ag = await agency();
  await grant(ag.ws, ag.A, ag.editor.id, ag.owner);
  const r = await race(ag, (t) => t`delete from auth.sessions where id = ${ag.editor.session}`, () => writeAs(ag, ag.editor, ag.A, "after logout"));
  assert(r.waited); assertEquals(r.outcome, "session_invalid");
  assertEquals(await clientName(ag.ws, ag.A), "Client A");
});

// ── 7. Client archived during execution ──────────────────────────────────────
Deno.test("7. race: client archived in flight → waits, then client_archived; every grant revoked; archive is terminal", opts, async () => {
  const ag = await agency();
  await grant(ag.ws, ag.A, ag.editor.id, ag.owner);
  await grant(ag.ws, ag.A, ag.viewer.id, ag.owner);
  const r = await race(ag, (t) => adminCall(t, "client_account_archive", [ag.ws, ag.A, ag.owner.id, ag.owner.session]),
    () => writeAs(ag, ag.editor, ag.A, "after archive"));
  assert(r.waited); assertEquals(r.outcome, "client_archived");
  assertEquals(await clientName(ag.ws, ag.A), "Client A");
  const reasons = await sql`select revoke_reason from public.client_access_grants where workspace_id = ${ag.ws} and client_id = ${ag.A} and revoked_at is not null and revoke_reason = 'client_archived'`;
  assertEquals(reasons.length, 2);
  await denied(ag, () => readAs(ag, ag.viewer, ag.A), "client_archived", "read after archive");
  assertEquals((await grant(ag.ws, ag.A, ag.editor.id, ag.owner)).outcome, "client_archived", "no grant to an archived client");
  await assertRejects(() => sql`update public.client_accounts set status = 'active', archived_at = null, archived_by = null where id = ${ag.A}`);
  assertEquals((await readAs(ag, ag.owner, ag.B)).outcome, "no_grant", "B unaffected and still needs its own grant");
});

// ── 8. Missing client context ────────────────────────────────────────────────
Deno.test("8. a client request without a client is refused everywhere — never the agency Brain or a default client", opts, async () => {
  const ag = await agency();
  await grant(ag.ws, ag.A, ag.editor.id, ag.owner);
  await denied(ag, () => readAs(ag, ag.editor, null), "client_context_required", "helper read");
  await denied(ag, (log) => writeAs(ag, ag.editor, null, "nowhere", { log }), "client_context_required", "helper write");
  const svc = await as("service_role");
  // An explicit null client (a POST: a GET cannot carry a null).
  const { data } = await svc.rpc("client_brain_read", { p_workspace_id: ag.ws, p_client_id: null, p_actor_id: ag.editor.id, p_session_id: ag.editor.session });
  assertEquals((data as { outcome: string; profile: unknown }[])[0], { outcome: "client_context_required", profile: null, version: null, onboarding_completed: null, updated_at: null } as never);
  const before = await state(ag.ws);
  const { data: w } = await svc.rpc("client_brain_authorized_write", { p_workspace_id: ag.ws, p_client_id: null, p_actor_id: ag.editor.id,
    p_session_id: ag.editor.session, p_permission: "edit", p_intent: "interactive", p_mode: "insert", p_profile: { company: { name: "x" } } });
  assertEquals((w as { outcome: string }[])[0].outcome, "client_context_required");
  assertEquals(await state(ag.ws), before);
  assertEquals(resolveBrainScope({ scope: "client" }), { ok: false, outcome: "client_context_required" });
  assertEquals(resolveBrainScope({ scope: "client", client_id: null }), { ok: false, outcome: "client_context_required" });
  assertEquals(resolveBrainScope({ scope: "agency", client_id: ag.A }), { ok: false, outcome: "invalid_scope" });
  assertEquals(resolveBrainScope({ client_id: "not-a-uuid" }), { ok: false, outcome: "invalid_scope" });
  assertEquals(resolveBrainScope({}), { ok: true, scope: { kind: "agency" } }, "no client asked for: the agency Brain, as today");
});

// ── 9. Cross-client attempts ─────────────────────────────────────────────────
Deno.test("9. cross-client and cross-workspace ids are refused and indistinguishable from unknown ones", opts, async () => {
  const ag = await agency();
  const other = await agency();
  await grant(ag.ws, ag.A, ag.editor.id, ag.owner);
  await denied(ag, () => readAs(ag, ag.editor, other.A), "no_grant", "a client of another workspace");
  await denied(ag, () => readAs(ag, ag.editor, uuid()), "no_grant", "an unknown client");
  // A's version presented against B: still refused on authorization, not content.
  await denied(ag, (log) => writeAs(ag, ag.editor, ag.B, "B via A", { expectedVersion: 1, log }), "no_grant", "B with A's grant");
  // A grant can only name a client of its own workspace (composite FK).
  await assertRejects(() => sql`insert into public.client_access_grants (workspace_id, client_id, user_id, generation, granted_by)
    values (${ag.ws}, ${other.A}, ${ag.editor.id}, 9, ${ag.owner.id})`);
  assertEquals((await grant(ag.ws, other.A, ag.editor.id, ag.owner)).outcome, "client_not_found");
  assertEquals((await grant(ag.ws, ag.A, other.editor.id, ag.owner)).outcome, "target_not_member", "only a current member of this workspace");
  assertEquals(await state(other.ws), await state(other.ws));
});

// ── 10. Agency Brain versus client Brain ─────────────────────────────────────
Deno.test("10. the agency Brain and client Brains never cross: writes, reads and agent context stay in scope", opts, async () => {
  const ag = await agency();
  await grant(ag.ws, ag.A, ag.owner.id, ag.owner);
  const svc = await as("service_role");
  // Client write: the agency Brain is untouched.
  assertEquals((await writeAs(ag, ag.owner, ag.A, "A only")).outcome, "ok");
  assertEquals(await agencyName(ag.ws), "Agency");
  // Agency write (AUTH-06 writer): client Brains are untouched.
  const [{ v }] = await sql`select updated_at::text as v from public.company_brain where workspace_id = ${ag.ws}`;
  const { data: aw } = await svc.rpc("company_brain_authorized_write", { p_workspace_id: ag.ws, p_actor_id: ag.owner.id, p_session_id: ag.owner.session,
    p_permission: "edit", p_mode: "cas", p_profile: { company: { name: "Agency 2" } }, p_expected_updated_at: v, p_activate: false });
  assertEquals((aw as { outcome: string }[])[0].outcome, "ok");
  assertEquals(await clientName(ag.ws, ag.A), "A only"); assertEquals(await clientName(ag.ws, ag.B), "Client B");
  // A granted client with no Brain row yet reads as empty — never the agency's.
  const C = (await createClientAccount(ag.ws, ag.owner, "Client C")).client_id;
  await grant(ag.ws, C, ag.owner.id, ag.owner);
  const c = await readAs(ag, ag.owner, C);
  assert(c.outcome === "ok"); assertEquals(c.brain.profile, null); assertEquals(c.brain.version, null);
  // Agent context for a client scope comes only from that client.
  const ctx = await clientBrainContextForScope(svc, { kind: "client", clientId: ag.A }, { workspaceId: ag.ws, actorId: ag.owner.id, sessionId: ag.owner.session });
  assert(ctx.outcome === "ok"); assertEquals((ctx.profile.company as { name: string }).name, "A only");
  const ctxB = await clientBrainContextForScope(svc, { kind: "client", clientId: ag.B }, { workspaceId: ag.ws, actorId: ag.owner.id, sessionId: ag.owner.session });
  assertEquals(ctxB.outcome, "no_grant", "ungranted client context refused, not replaced by the agency Brain");
  assertEquals((await clientBrainContextForScope(svc, { kind: "agency" }, { workspaceId: ag.ws, actorId: ag.owner.id, sessionId: ag.owner.session })).outcome,
    "agency_scope", "the agency path is the existing reader, never this one");
});

// ── 11. Concurrent writes and version conflicts ──────────────────────────────
Deno.test("11. two writers on one version: exactly one wins, the other is stale; insert never overwrites", opts, async () => {
  const ag = await agency();
  await grant(ag.ws, ag.A, ag.editor.id, ag.owner);
  await grant(ag.ws, ag.A, ag.admin.id, ag.owner);
  const v0 = await version(ag.ws, ag.A);
  const [x, y] = await Promise.all([
    writeAs(ag, ag.editor, ag.A, "editor wins?", { expectedVersion: v0 }),
    writeAs(ag, ag.admin, ag.A, "admin wins?", { expectedVersion: v0 }),
  ]);
  assertEquals([x.outcome, y.outcome].sort(), ["ok", "stale"]);
  assertEquals(await version(ag.ws, ag.A), v0 + 1);
  const winner = x.outcome === "ok" ? "editor wins?" : "admin wins?";
  assertEquals(await clientName(ag.ws, ag.A), winner);
  const before = await state(ag.ws);
  const ins = await writeClientBrain(await as("service_role"), { workspaceId: ag.ws, clientId: ag.A, actorId: ag.editor.id,
    sessionId: ag.editor.session, permission: "edit", mode: "insert", profile: { company: { name: "clobber" } } });
  assertEquals(ins.outcome, "stale"); assertEquals(await state(ag.ws), before);
  // Activation needs owner/admin AND a grant, and sets onboarding in the same write.
  assertEquals((await writeAs(ag, ag.editor, ag.A, "e", { permission: "activate", activate: true })).outcome, "forbidden_role");
  assertEquals((await writeAs(ag, ag.admin, ag.A, "activated", { permission: "activate", activate: true })).outcome, "ok");
  const [{ done }] = await sql`select onboarding_completed as done from public.client_company_brain where workspace_id = ${ag.ws} and client_id = ${ag.A}`;
  assertEquals(done, true);
});

// ── 12. No unauthorized writes, browser access or external requests ─────────
Deno.test("12. browser roles and even the service role cannot write these tables; refusals make no write or external request", opts, async () => {
  const ag = await agency();
  await grant(ag.ws, ag.A, ag.editor.id, ag.owner);
  const before = await state(ag.ws);
  for (const c of [await as("authenticated", ag.owner.id), await as("anon"), await as("service_role")]) {
    const ins = await c.from("client_company_brain").insert({ workspace_id: ag.ws, client_id: ag.B, profile: {} });
    assert(ins.error, "no direct Brain insert");
    const upd = await c.from("client_access_grants").update({ revoked_at: null }).eq("workspace_id", ag.ws);
    assert(upd.error || (upd.data ?? []).length === 0, "no direct grant update");
    const acc = await c.from("client_accounts").insert({ workspace_id: ag.ws, name: "rogue", created_by: ag.owner.id });
    assert(acc.error, "no direct client insert");
  }
  for (const c of [await as("authenticated", ag.owner.id), await as("anon")]) {
    for (const [fn, args] of [
      ["client_access_grant", { p_workspace_id: ag.ws, p_client_id: ag.B, p_target_user_id: ag.owner.id, p_actor_id: ag.owner.id, p_session_id: ag.owner.session }],
      ["client_brain_read", { p_workspace_id: ag.ws, p_client_id: ag.A, p_actor_id: ag.editor.id, p_session_id: ag.editor.session }],
      ["client_brain_authorized_write", { p_workspace_id: ag.ws, p_client_id: ag.A, p_actor_id: ag.editor.id, p_session_id: ag.editor.session,
        p_permission: "edit", p_intent: "interactive", p_mode: "cas", p_profile: {}, p_expected_version: 1 }],
    ] as const) {
      const { error } = await c.rpc(fn, args);
      assert(error, `browser cannot call ${fn}`);
    }
  }
  assertEquals(await state(ag.ws), before);
  // Every early refusal: zero write requests, zero external requests.
  await denied(ag, (log) => writeAs(ag, { id: ag.editor.id, session: uuid() }, ag.A, "x", { log }), "session_invalid", "dead session");
  await denied(ag, () => readAs(ag, ag.viewer, ag.A), "no_grant", "no grant");
  await denied(ag, (log) => writeAs(ag, ag.viewer, ag.A, "x", { log }), "forbidden_role", "a viewer never edits, grant or not");
  const nobody = await user();
  await denied(ag, (log) => writeAs(ag, nobody, ag.A, "x", { log }), "not_member", "non-member");
});

// ── Grant writers: serialized, and deadlock-free under the lock order ────────
Deno.test("concurrent grants to one user allocate one generation; mixed grant/revoke/archive/remove/write traffic never deadlocks", opts, async () => {
  const ag = await agency();
  const results = await Promise.all([grant(ag.ws, ag.A, ag.editor.id, ag.owner), grant(ag.ws, ag.A, ag.editor.id, ag.admin)]);
  assertEquals(results.map((r) => r.outcome).sort(), ["already_granted", "ok"]);
  assertEquals(new Set(results.map((r) => r.grant_id)).size, 1, "one active generation");
  for (const u of [ag.admin, ag.viewer]) await grant(ag.ws, ag.B, u.id, ag.owner);
  await grant(ag.ws, ag.B, ag.editor.id, ag.owner);
  // Every writer at once, on overlapping rows, in both directions.
  const ops: Promise<unknown>[] = [];
  for (let i = 0; i < 6; i++) {
    ops.push(writeAs(ag, ag.editor, ag.B, `w${i}`).catch((e) => e));
    ops.push(revoke(ag.ws, ag.B, ag.viewer.id, ag.admin).catch((e) => e));
    ops.push(grant(ag.ws, ag.B, ag.viewer.id, ag.owner).catch((e) => e));
    ops.push(grant(ag.ws, ag.A, ag.admin.id, ag.admin).catch((e) => e));
  }
  ops.push(sql`delete from public.workspace_members where workspace_id = ${ag.ws} and user_id = ${ag.viewer.id}`.catch((e) => e));
  ops.push(archive(ag.ws, ag.B, ag.owner).catch((e) => e));
  const settled = await Promise.all(ops);
  const errors = settled.filter((x) => x instanceof Error).map((e) => String((e as Error).message));
  assertEquals(errors.filter((m) => /deadlock/i.test(m)), [], "no deadlock");
  assertEquals(errors, [], "no writer failed");
  const [{ n }] = await sql`select count(*)::int as n from public.client_access_grants where workspace_id = ${ag.ws} and client_id = ${ag.B} and revoked_at is null`;
  assertEquals(n, 0, "after archive no grant of B is active");
  const [{ dup }] = await sql`select count(*)::int as dup from (select client_id, user_id from public.client_access_grants
    where workspace_id = ${ag.ws} and revoked_at is null group by 1, 2 having count(*) > 1) d`;
  assertEquals(dup, 0);
});
