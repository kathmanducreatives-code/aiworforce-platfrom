// IMMUTABLE TASK PINS (held 20261025170000; contract #174 §9.1) against real
// PostgREST + Postgres, on top of #176's client schema and Brain's own rule.
//
// A client task carries, once, the authorization it was created under; the
// database refuses pins that are inconsistent (structurally) or no longer
// valid AT COMMIT (Brain's client_brain_authorization, task intent), and never
// lets them change. Every refusal leaves no task. The concurrent case holds a
// revoke uncommitted and requires the insert to be SEEN waiting on its lock.
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
let svcClient: SupabaseClient | null = null;
async function svc(): Promise<SupabaseClient> {
  if (svcClient) return svcClient;
  const jwt = await mintJwt("service_role");
  svcClient = createClient(REST_URL, jwt, { auth: { persistSession: false }, global: { fetch: gatewayFetch } });
  return svcClient;
}
type User = { id: string; session: string };
async function member(ws: string, role: string): Promise<User> {
  const id = uuid(), session = uuid();
  await sql`insert into auth.users (id, email) values (${id}, ${`tp-${id.slice(0, 8)}@contract.test`})`;
  await sql`insert into auth.sessions (id, user_id) values (${session}, ${id})`;
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${id}, ${role})`;
  return { id, session };
}
type Pin = { grant_id: string; generation: number; permission_revision: string };
/** An agency with a client, and an editor granted it; the editor's pins, read through Brain's own API. */
async function world() {
  const ws = await seedWorkspace(), other = await seedWorkspace();
  const owner = await member(ws, "owner"), editor = await member(ws, "editor"), viewer = await member(ws, "viewer");
  const [c] = await sql`select * from public.client_account_create(${ws}, ${owner.id}, ${owner.session}, ${"Client " + uuid().slice(0, 6)})`;
  const client = c.client_id as string;
  for (const u of [editor, viewer]) {
    const [g] = await sql`select * from public.client_access_grant(${ws}, ${client}, ${u.id}, ${owner.id}, ${owner.session})`;
    assertEquals(g.outcome, "ok");
  }
  const pinOf = async (u: User): Promise<Pin> => {
    const [p] = await sql`select * from public.client_brain_pin(${ws}, ${client}, ${u.id}, ${u.session}, 'read')`;
    assertEquals(p.outcome, "ok");
    return p as unknown as Pin;
  };
  return { ws, other, owner, editor, viewer, client, pinOf };
}
type World = Awaited<ReturnType<typeof world>>;
const pinned = (w: World, u: User, p: Pin, over: Record<string, unknown> = {}) => ({
  workspace_id: w.ws, user_id: u.id, status: "running", agent_slug: "scout", payload: {},
  client_id: w.client, client_grant_id: p.grant_id, client_grant_generation: p.generation,
  permission_revision: p.permission_revision, origin_session_id: u.session, ...over,
});
const insert = async (row: Record<string, unknown>) => await (await svc()).from("tasks").insert(row).select("id");
const tasksOf = async (ws: string) => Number((await sql`select count(*)::int n from public.tasks where workspace_id = ${ws}`)[0].n);

Deno.test("pins: a task created with valid pins commits with all five; an unpinned task is unchanged", opts, async () => {
  const w = await world();
  const p = await w.pinOf(w.editor);
  const r = await insert(pinned(w, w.editor, p));
  assertEquals([r.error, r.data?.length], [null, 1], JSON.stringify(r.error));
  const [t] = await sql`select client_id, client_grant_id, client_grant_generation, permission_revision, origin_session_id
                          from public.tasks where id = ${(r.data![0] as { id: string }).id}`;
  assertEquals([t.client_id, t.client_grant_id, t.client_grant_generation, String(t.permission_revision), t.origin_session_id],
    [w.client, p.grant_id, p.generation, String(p.permission_revision), w.editor.session]);
  const plain = await insert({ workspace_id: w.ws, user_id: w.editor.id, status: "running", agent_slug: "scout", payload: {} });
  assertEquals(plain.error, null, "an agency task needs no pins");
});

Deno.test("pins: inconsistent pins are refused by the database itself", opts, async () => {
  const w = await world();
  const p = await w.pinOf(w.editor), pv = await w.pinOf(w.viewer);
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["some pins, not all", { origin_session_id: null }, "23514"],
    ["a client of another workspace", { workspace_id: w.other }, "23503"],
    ["another user's grant generation", { client_grant_generation: pv.generation + 99 }, "23503"],
    ["the grant id of another user's grant", { client_grant_id: pv.grant_id }, "23503"],
  ];
  for (const [why, over, code] of cases) assertEquals((await insert(pinned(w, w.editor, p, over))).error?.code, code, why);
  assertEquals(await tasksOf(w.ws), 0);
});

Deno.test("pins: pins no longer valid at commit are refused — revoke, demotion, logout, archive", opts, async () => {
  const w = await world();
  const stale: Array<[string, () => Promise<unknown>, User]> = [
    ["grant revoked", () => sql`select * from public.client_access_revoke(${w.ws}, ${w.client}, ${w.viewer.id}, ${w.owner.id}, ${w.owner.session})`, w.viewer],
    ["role changed", () => sql`update public.workspace_members set role = 'viewer' where workspace_id = ${w.ws} and user_id = ${w.editor.id}`, w.editor],
  ];
  for (const [why, change, u] of stale) {
    const p = await w.pinOf(u);
    await change();
    const r = await insert(pinned(w, u, p));
    assertEquals(r.error?.code, "42501", `${why}: ${JSON.stringify(r.error)}`);
  }
  const w2 = await world();
  const p2 = await w2.pinOf(w2.editor);
  await sql`delete from auth.sessions where id = ${w2.editor.session}`;
  assert(String((await insert(pinned(w2, w2.editor, p2))).error?.message).includes("session_invalid"), "logged out");
  const w3 = await world();
  const p3 = await w3.pinOf(w3.editor);
  await sql`select * from public.client_account_archive(${w3.ws}, ${w3.client}, ${w3.owner.id}, ${w3.owner.session})`;
  assertEquals((await insert(pinned(w3, w3.editor, p3))).error?.code, "42501", "archived");
  assertEquals((await tasksOf(w.ws)) + (await tasksOf(w2.ws)) + (await tasksOf(w3.ws)), 0);
});

Deno.test("pins race: a revoke in flight — the task insert waits on the grant, then is refused", opts, async () => {
  const w = await world();
  const p = await w.pinOf(w.editor);
  let revoked!: () => void, release!: () => void;
  const revokedP = new Promise<void>((r) => revoked = r), gate = new Promise<void>((r) => release = r);
  const tx = sql.begin(async (t) => {
    const [r] = await t`select * from public.client_access_revoke(${w.ws}, ${w.client}, ${w.editor.id}, ${w.owner.id}, ${w.owner.session})`;
    assertEquals(r.outcome, "ok");
    revoked();
    await gate;
  });
  await revokedP;
  const pending = insert(pinned(w, w.editor, p));
  let waited = false;
  for (const until = Date.now() + 10_000; Date.now() < until && !waited;) {
    const [x] = await sql`select count(*)::int n from pg_stat_activity where wait_event_type = 'Lock' and query like '%tasks%' and pid <> pg_backend_pid()`;
    waited = x.n > 0;
    if (!waited) await new Promise((r) => setTimeout(r, 50));
  }
  release();
  await tx;
  const r = await pending;
  assert(waited, "the insert waited on the grant row the revoke holds");
  assertEquals(r.error?.code, "42501", JSON.stringify(r));
  assertEquals(await tasksOf(w.ws), 0);
});

Deno.test("pins are immutable: no re-pin, no unpin, no move of a pinned task; status writes still settle", opts, async () => {
  const w = await world();
  const p = await w.pinOf(w.editor);
  const id = ((await insert(pinned(w, w.editor, p))).data![0] as { id: string }).id;
  const s = await svc();
  for (const [why, patch] of [
    ["re-pin the generation", { client_grant_generation: p.generation + 1 }],
    ["unpin", { client_id: null, client_grant_id: null, client_grant_generation: null, permission_revision: null, origin_session_id: null }],
    ["refresh the revision", { permission_revision: Number(p.permission_revision) + 1 }],
    ["hand the task to another member", { user_id: w.viewer.id }],
  ] as const) {
    assertEquals((await s.from("tasks").update(patch).eq("id", id).select("id")).error?.code, "42501", why);
  }
  const settle = await s.from("tasks").update({ status: "failed", result: { terminal_status: "cancelled" } }).eq("id", id).select("id");
  assertEquals(settle.error, null, "status and result are not pins");
  const [t] = await sql`select client_grant_generation, user_id, status from public.tasks where id = ${id}`;
  assertEquals([t.client_grant_generation, t.user_id, t.status], [p.generation, w.editor.id, "failed"]);
});
