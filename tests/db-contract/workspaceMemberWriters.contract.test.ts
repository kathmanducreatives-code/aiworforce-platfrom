// THE CANONICAL MEMBERSHIP WRITERS (held 20261025140000; contract #174 §8 O3
// option A, §9.4) against real Postgres + PostgREST, called as the service
// role, on top of #176's held triggers.
//
// Every refusal must leave the workspace's memberships and every client grant
// byte-for-byte unchanged. The acceptance Brain suggested (§9.4): after a
// remove, every grant of that user is revoked 'membership_removed'; after a
// role change, permission_revision has moved and a pinned task gets
// 'permission_changed'. The concurrent cases hold one writer's transaction
// open on a second connection and require the other to be SEEN waiting on a
// lock (pg_stat_activity, bounded deadline), then to re-read the committed
// result. mutation.sh removes each guard and the owner-row lock.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

// The lane's shim has no auth.sessions (real Supabase does); same columns as #176's tests.
await sql`create table if not exists auth.sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  not_after timestamptz
)`;

async function as(role: "service_role" | "authenticated", sub?: string): Promise<SupabaseClient> {
  const jwt = await mintJwt(role, sub);
  const f: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return fetch(url.replace(`${REST_URL}/rest/v1`, REST_URL), init);
  };
  return createClient(REST_URL, jwt, { auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` }, fetch: f } });
}

type User = { id: string; session: string };
async function member(ws: string, role: string): Promise<User> {
  const id = uuid(), session = uuid();
  await sql`insert into auth.users (id, email) values (${id}, ${`mw-${id.slice(0, 8)}@contract.test`})`;
  await sql`insert into auth.sessions (id, user_id) values (${session}, ${id})`;
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${id}, ${role})`;
  return { id, session };
}
async function rpc(fn: string, args: Record<string, unknown>): Promise<string> {
  const { data, error } = await (await as("service_role")).rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as string;
}
const remove = (ws: string, target: User, actor: User) =>
  rpc("workspace_member_remove", { p_workspace_id: ws, p_target_user_id: target.id, p_actor_id: actor.id, p_session_id: actor.session });
const setRole = (ws: string, target: User, role: string, actor: User) =>
  rpc("workspace_member_set_role", { p_workspace_id: ws, p_target_user_id: target.id, p_role: role, p_actor_id: actor.id, p_session_id: actor.session });

async function team() {
  const ws = await seedWorkspace();
  const owner = await member(ws, "owner"), admin = await member(ws, "admin");
  const editor = await member(ws, "editor"), viewer = await member(ws, "viewer");
  return { ws, owner, admin, editor, viewer };
}
/** Memberships (role and revision) and every grant generation, as one fingerprint. */
async function state(ws: string): Promise<string> {
  const [r] = await sql`select md5(concat_ws('|',
    (select coalesce(string_agg(row(m.user_id, m.role, m.permission_revision)::text, ',' order by m.user_id), '') from public.workspace_members m where m.workspace_id = ${ws}),
    (select coalesce(string_agg(row(g.*)::text, ',' order by g.id), '') from public.client_access_grants g where g.workspace_id = ${ws}))) h`;
  return r.h;
}
const roleOf = async (ws: string, u: User) =>
  (await sql`select role from public.workspace_members where workspace_id = ${ws} and user_id = ${u.id}`)[0]?.role ?? null;
const owners = async (ws: string) =>
  Number((await sql`select count(*)::int n from public.workspace_members where workspace_id = ${ws} and role = 'owner'`)[0].n);

/** A client the owner creates, and a grant for `target`, through #176's real writers. */
async function grantedClient(ws: string, owner: User, target: User) {
  const [c] = await sql`select * from public.client_account_create(${ws}, ${owner.id}, ${owner.session}, ${"Client " + uuid().slice(0, 6)})`;
  assertEquals(c.outcome, "ok");
  const [g] = await sql`select * from public.client_access_grant(${ws}, ${c.client_id}, ${target.id}, ${owner.id}, ${owner.session})`;
  assertEquals(g.outcome, "ok");
  return { client: c.client_id as string, grant: g.grant_id as string };
}

// ── §9.4 acceptance ───────────────────────────────────────────────────────────

Deno.test("remove: the member is gone and every grant of theirs is revoked 'membership_removed' in the same transaction", opts, async () => {
  const t = await team();
  const a = await grantedClient(t.ws, t.owner, t.editor), b = await grantedClient(t.ws, t.owner, t.editor);
  const keep = await grantedClient(t.ws, t.owner, t.viewer);
  assertEquals(await remove(t.ws, t.editor, t.admin), "ok");
  assertEquals(await roleOf(t.ws, t.editor), null);
  const gs = await sql`select id, revoke_reason from public.client_access_grants where id in (${a.grant}, ${b.grant}, ${keep.grant}) order by id`;
  for (const g of gs) {
    assertEquals(g.revoke_reason, g.id === keep.grant ? null : "membership_removed", "only the removed user's grants");
  }
});

Deno.test("set_role: a demotion moves permission_revision and a pinned task gets 'permission_changed'", opts, async () => {
  const t = await team();
  const c = await grantedClient(t.ws, t.owner, t.editor);
  const [pin] = await sql`select * from public.client_brain_pin(${t.ws}, ${c.client}, ${t.editor.id}, ${t.editor.session}, 'read')`;
  assertEquals(pin.outcome, "ok");
  const resume = async () => (await sql`select public.client_brain_authorization(${t.ws}, ${c.client}, ${t.editor.id}, ${t.editor.session},
    'read', 'task', ${pin.grant_id}, ${pin.generation}, ${pin.permission_revision}) as r`)[0].r;
  assertEquals(await resume(), "ok", "control: the pinned task resumes before the change");
  assertEquals(await setRole(t.ws, t.editor, "viewer", t.owner), "ok");
  assertEquals(await roleOf(t.ws, t.editor), "viewer");
  const [m] = await sql`select permission_revision from public.workspace_members where workspace_id = ${t.ws} and user_id = ${t.editor.id}`;
  assert(BigInt(m.permission_revision) !== BigInt(pin.permission_revision), "the revision moved");
  assertEquals(await resume(), "permission_changed");
});

// ── The agreed policy: every refusal changes nothing ─────────────────────────

Deno.test("policy: who may remove and demote whom; each refusal leaves memberships and grants unchanged", opts, async () => {
  const t = await team();
  await grantedClient(t.ws, t.owner, t.editor);
  const legacy = await member(t.ws, "member");
  const stranger = { id: uuid(), session: uuid() };
  await sql`insert into auth.users (id, email) values (${stranger.id}, ${`mw-${stranger.id.slice(0, 8)}@contract.test`})`;
  await sql`insert into auth.sessions (id, user_id) values (${stranger.session}, ${stranger.id})`;
  const before = await state(t.ws);
  const refusals: Array<[string, () => Promise<string>, string]> = [
    ["a viewer removes an editor", () => remove(t.ws, t.editor, t.viewer), "forbidden_role"],
    ["an editor changes a viewer's role", () => setRole(t.ws, t.viewer, "viewer", t.editor), "forbidden_role"],
    ["an admin removes the owner", () => remove(t.ws, t.owner, t.admin), "owner_protected"],
    ["an admin demotes the owner", () => setRole(t.ws, t.owner, "admin", t.admin), "owner_protected"],
    ["the last owner removes themself", () => remove(t.ws, t.owner, t.owner), "last_owner"],
    ["the last owner demotes themself", () => setRole(t.ws, t.owner, "admin", t.owner), "last_owner"],
    ["a promotion (not decided)", () => setRole(t.ws, t.editor, "admin", t.owner), "promotion_unsupported"],
    ["a role outside the four", () => setRole(t.ws, t.editor, "superuser", t.owner), "invalid_role"],
    ["a stored legacy role", () => setRole(t.ws, legacy, "viewer", t.owner), "unknown_role"],
    ["an editor demotes themself", () => setRole(t.ws, t.editor, "viewer", t.editor), "forbidden_role"],
    ["the same role", () => setRole(t.ws, t.editor, "editor", t.owner), "unchanged"],
    ["a non-member actor", () => remove(t.ws, t.viewer, stranger), "not_member"],
    ["a non-member target", () => remove(t.ws, stranger, t.owner), "target_not_member"],
    ["another user's session", () => rpc("workspace_member_remove",
      { p_workspace_id: t.ws, p_target_user_id: t.viewer.id, p_actor_id: t.owner.id, p_session_id: t.admin.session }), "session_invalid"],
  ];
  for (const [why, call, want] of refusals) {
    assertEquals(await call(), want, why);
    assertEquals(await state(t.ws), before, `${why}: nothing changed`);
  }
  await sql`update auth.sessions set not_after = now() - interval '1 minute' where id = ${t.owner.session}`;
  assertEquals(await remove(t.ws, t.viewer, t.owner), "session_invalid", "an expired session");
  await sql`delete from auth.sessions where id = ${t.admin.session}`;
  assertEquals(await remove(t.ws, t.viewer, t.admin), "session_invalid", "after logout");
  assertEquals(await state(t.ws), before);
});

Deno.test("policy positives: owners and admins remove and demote; anyone leaves; a second owner can go", opts, async () => {
  const t = await team();
  const owner2 = await member(t.ws, "owner");
  assertEquals(await setRole(t.ws, t.editor, "viewer", t.admin), "ok", "an admin demotes an editor");
  assertEquals(await setRole(t.ws, t.admin, "editor", t.admin), "ok", "an admin demotes themself");
  assertEquals(await remove(t.ws, t.viewer, t.viewer), "ok", "a viewer leaves");
  assertEquals(await setRole(t.ws, owner2, "admin", t.owner), "ok", "an owner demotes another owner");
  assertEquals(await remove(t.ws, owner2, t.owner), "ok", "an owner removes an admin");
  assertEquals(await owners(t.ws), 1);
  assertEquals(await roleOf(t.ws, t.owner), "owner");
});

// ── The last owner under concurrency (Codex on #174) ─────────────────────────

/** Session 1 runs `first` and holds its transaction; `second` (PostgREST) must be seen waiting on a lock, then finishes after the commit. */
async function race(first: (t: typeof sql) => Promise<string>, second: () => Promise<string>) {
  let ran!: (v: string) => void, release!: () => void;
  const firstOutcome = new Promise<string>((r) => ran = r), gate = new Promise<void>((r) => release = r);
  const tx = sql.begin(async (t) => { ran(await first(t as unknown as typeof sql)); await gate; });
  const one = await firstOutcome;
  const pending = second();
  const until = Date.now() + 10_000;
  let waited = false;
  while (Date.now() < until && !waited) {
    const [w] = await sql`select count(*)::int n from pg_stat_activity
      where wait_event_type = 'Lock' and query like '%workspace_member_%' and pid <> pg_backend_pid()`;
    waited = w.n > 0;
    if (!waited) await new Promise((r) => setTimeout(r, 50));
  }
  release();
  await tx;
  return { one, two: await pending, waited };
}

Deno.test("race: the only two owners leave at once — one succeeds, the other is refused 'last_owner', one owner remains", opts, async () => {
  const ws = await seedWorkspace();
  const a = await member(ws, "owner"), b = await member(ws, "owner");
  const r = await race(
    async (t) => (await t`select public.workspace_member_remove(${ws}, ${a.id}, ${a.id}, ${a.session}) as o`)[0].o,
    () => remove(ws, b, b));
  assert(r.waited, "the second writer waited on the owner rows");
  assertEquals([r.one, r.two], ["ok", "last_owner"]);
  assertEquals(await owners(ws), 1);
});

Deno.test("race: two owners remove each other at once — the second actor is no longer a member", opts, async () => {
  const ws = await seedWorkspace();
  const a = await member(ws, "owner"), b = await member(ws, "owner");
  const r = await race(
    async (t) => (await t`select public.workspace_member_remove(${ws}, ${b.id}, ${a.id}, ${a.session}) as o`)[0].o,
    () => remove(ws, a, b));
  assert(r.waited);
  assertEquals([r.one, r.two], ["ok", "not_member"]);
  assertEquals(await owners(ws), 1);
});

Deno.test("race: one owner demotes themself while the other leaves — never zero owners", opts, async () => {
  const ws = await seedWorkspace();
  const a = await member(ws, "owner"), b = await member(ws, "owner");
  const r = await race(
    async (t) => (await t`select public.workspace_member_set_role(${ws}, ${a.id}, 'admin', ${a.id}, ${a.session}) as o`)[0].o,
    () => remove(ws, b, b));
  assert(r.waited);
  assertEquals([r.one, r.two], ["ok", "last_owner"]);
  assertEquals(await owners(ws), 1);
});

// ── Surface ──────────────────────────────────────────────────────────────────

Deno.test("surface: browsers cannot call the writers; the service role cannot call the internal check", opts, async () => {
  const t = await team();
  const browser = await as("authenticated", t.owner.id);
  for (const [fn, args] of [
    ["workspace_member_remove", { p_workspace_id: t.ws, p_target_user_id: t.viewer.id, p_actor_id: t.owner.id, p_session_id: t.owner.session }],
    ["workspace_member_set_role", { p_workspace_id: t.ws, p_target_user_id: t.viewer.id, p_role: "viewer", p_actor_id: t.owner.id, p_session_id: t.owner.session }],
  ] as const) {
    const { error } = await browser.rpc(fn, args);
    assert(error, `${fn} must refuse a browser`);
  }
  const { error } = await (await as("service_role")).rpc("workspace_member_change_check",
    { p_workspace_id: t.ws, p_target_user_id: t.viewer.id, p_actor_id: t.owner.id, p_session_id: t.owner.session, p_reduces_owner: true });
  assert(error, "the internal check is not an API");
  assertEquals(await roleOf(t.ws, t.viewer), "viewer");
});
