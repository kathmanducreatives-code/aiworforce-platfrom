// END-TO-END Company Brain autosave, agency and client (Phase 2 + Phase 3c, held).
//
// The ACTUAL generate-company-brain-draft handler (its Deno.serve entry point
// captured in process) runs against real Postgres + PostgREST with the held
// client schema; the page side is the ACTUAL request builder and save-result
// logic the autosave hook uses (src/lib/brainProgressRequest.ts,
// onboardingAutosave.applyProgressSaveResult, brainScope). Every request the
// handler makes is recorded; anything that is not the local database is
// refused and counted.
//
// One stand-in, stated plainly: this lane has no GoTrue, so `/auth/v1/user`
// is answered locally — it verifies the token's HS256 signature with the
// lane's secret and, as GoTrue does, refuses a token whose session row is gone
// (session_not_found). Everything after that — membership, roles, grants,
// locks and writes — is the real database. Codex's native lane runs the same
// handler against real GoTrue.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { captured, restoreServe } from "./lib/captureServe.ts";
import "../../supabase/functions/generate-company-brain-draft/index.ts";
import { REST_URL, mintJwt, seedWorkspace, serviceClient, sql, uuid } from "./lib/harness.ts";
import { buildProgressSaveBody, readProgressSaveResponse } from "../../src/lib/brainProgressRequest.ts";
import { applyProgressSaveResult, readServerProgress, type Answers, type ProgressCopy } from "../../src/lib/onboardingAutosave.ts";
import { AGENCY_SCOPE, brainScopeKey, clientScope, nextBrainScope, sameBrainScope, type BrainScope } from "../../src/lib/brainScope.ts";
import { clientBrainContextForScope } from "../../supabase/functions/_shared/clientBrain.ts";

const handler = captured[0];
restoreServe();
assert(handler, "the actual handler module was imported and captured");
const opts = { sanitizeResources: false, sanitizeOps: false };

await sql`create table if not exists auth.sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  not_after timestamptz
)`;

// ── The gateway the handler talks to ────────────────────────────────────────
const GATEWAY = "http://supabase-gateway.test";
const SECRET = Deno.env.get("DB_CONTRACT_JWT_SECRET")!;
type Seen = { method: string; path: string };
let seen: Seen[] = [];
let external: string[] = [];
let onRest: ((s: Seen) => Promise<void>) | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  if (req.url.startsWith(GATEWAY + "/rest/v1/")) {
    const s = { method: req.method, path: req.url.slice((GATEWAY + "/rest/v1").length) };
    seen.push(s);
    if (onRest) await onRest(s);
    return realFetch(new Request(REST_URL + s.path, req));
  }
  if (req.url.startsWith(GATEWAY + "/auth/v1/user")) return goTrueUser(req);
  if (req.url.startsWith(REST_URL)) return realFetch(req);
  external.push(req.url);
  throw new Error(`external request refused: ${req.url}`);
};
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "APIFY_API_TOKEN", "FIRECRAWL_API_KEY", "LOVABLE_API_KEY"]) Deno.env.delete(k);
Deno.env.set("SUPABASE_URL", GATEWAY);
Deno.env.set("SUPABASE_ANON_KEY", await mintJwt("anon"));
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", await mintJwt("service_role"));
const clientsOn = (on: boolean) => on ? Deno.env.set("COMPANY_BRAIN_CLIENTS_ENABLED", "true") : Deno.env.delete("COMPANY_BRAIN_CLIENTS_ENABLED");

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hmacKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
async function userToken(u: User): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc({ sub: u.id, role: "authenticated", aud: "authenticated", session_id: u.session, iat: now, exp: now + 3600 });
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}
async function goTrueUser(req: Request): Promise<Response> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const [h, b, s] = token.split(".");
  const fromB64 = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(x.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
  const ok = h && b && s && await crypto.subtle.verify("HMAC", hmacKey, fromB64(s), new TextEncoder().encode(`${h}.${b}`));
  if (!ok) return Response.json({ code: 401, msg: "invalid JWT" }, { status: 401 });
  const claims = JSON.parse(new TextDecoder().decode(fromB64(b))) as { sub: string; session_id: string; exp: number };
  if (claims.exp < Date.now() / 1000) return Response.json({ code: 401, msg: "expired" }, { status: 401 });
  const live = await sql`select 1 from auth.sessions where id = ${claims.session_id} and user_id = ${claims.sub}
    and (not_after is null or not_after > now())`;
  if (live.length === 0) return Response.json({ code: 403, error_code: "session_not_found" }, { status: 403 });
  return Response.json({ id: claims.sub, aud: "authenticated", role: "authenticated", email: `${claims.sub.slice(0, 8)}@contract.test` });
}

// ── Calling the actual handler, as the page does ─────────────────────────────
type User = { id: string; session: string };
type Reply = { status: number; body: Record<string, unknown> };
async function call(u: User, body: Record<string, unknown>): Promise<Reply> {
  const res = await handler(new Request("http://edge.test/generate-company-brain-draft", {
    method: "POST",
    headers: { Authorization: `Bearer ${await userToken(u)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
const posts = (path: string) => seen.filter((s) => s.method !== "GET" && s.method !== "HEAD" && s.path.startsWith(path)).length;
const writes = () => seen.filter((s) => s.method !== "GET" && s.method !== "HEAD").length;
function freshLog() { seen = []; external = []; onRest = null; }

// The page's autosave state for one Brain: the version it builds on, the copy
// it last loaded or saved (base), and the user's current answers (mine).
interface Page { ws: string; scope: BrainScope; version: string | null; base: ProgressCopy }
const copy = (answers: Answers, step = 1): ProgressCopy => ({ step, answers, updated_at: new Date().toISOString() });
async function autosave(u: User, page: Page, mine: ProgressCopy) {
  const reply = await call(u, buildProgressSaveBody({ workspaceId: page.ws, step: mine.step, answers: mine.answers, expectedUpdatedAt: page.version, scope: page.scope }));
  const outcome = readProgressSaveResponse(reply.body);
  const next = applyProgressSaveResult({ version: page.version, base: page.base }, mine, outcome);
  return { reply, outcome, next, page: { ...page, version: next.version, base: next.base } };
}

// ── Fixture ──────────────────────────────────────────────────────────────────
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
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (await serviceClient()).rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return (Array.isArray(data) ? data[0] : data) as T;
}
async function agency() {
  const ws = await seedWorkspace();
  const owner = await member(ws, "owner");
  const editor = await member(ws, "editor");
  const editor2 = await member(ws, "editor");
  const viewer = await member(ws, "viewer");
  await sql`insert into public.company_brain (workspace_id, profile) values (${ws}, ${sql.json({ company: { name: "Agency Co" }, positioning: "AGENCY-ONLY positioning" } as never)})`;
  const mk = async (name: string) => (await rpc<{ client_id: string }>("client_account_create", { p_workspace_id: ws, p_actor_id: owner.id, p_session_id: owner.session, p_name: name })).client_id;
  const A = await mk("Client A"); const B = await mk("Client B");
  return { ws, owner, editor, editor2, viewer, A, B };
}
type Agency = Awaited<ReturnType<typeof agency>>;
const grant = (ag: Agency, client: string, u: User) =>
  rpc("client_access_grant", { p_workspace_id: ag.ws, p_client_id: client, p_target_user_id: u.id, p_actor_id: ag.owner.id, p_session_id: ag.owner.session });
// What the page loads when it opens a Brain.
async function openAgency(ws: string): Promise<Page> {
  const { data } = await (await serviceClient()).from("company_brain").select("profile, updated_at").eq("workspace_id", ws).single();
  const row = data as { profile: unknown; updated_at: string };
  return { ws, scope: AGENCY_SCOPE, version: row.updated_at, base: readServerProgress(row.profile) ?? copy({}, 0) };
}
async function openClient(u: User, ws: string, clientId: string): Promise<Page> {
  const r = await call(u, { action: "status", workspace_id: ws, scope: "client", client_id: clientId });
  assertEquals(r.status, 200, JSON.stringify(r.body));
  return { ws, scope: clientScope(clientId)!, version: r.body.version == null ? null : String(r.body.version), base: readServerProgress(r.body.profile) ?? copy({}, 0) };
}
async function state(ws: string): Promise<string> {
  const [r] = await sql`select md5(concat_ws('|',
    (select coalesce(string_agg(row(b.*)::text, ',' order by b.client_id), '') from public.client_company_brain b where b.workspace_id = ${ws}),
    (select coalesce(string_agg(row(g.*)::text, ',' order by g.id), '') from public.client_access_grants g where g.workspace_id = ${ws}),
    (select coalesce(string_agg(row(a.*)::text, ','), '') from public.company_brain a where a.workspace_id = ${ws}))) as h`;
  return r.h as string;
}
// Only the Brains (every client Brain and the agency Brain): a revocation
// itself changes grants or memberships, never a Brain.
async function brains(ws: string): Promise<string> {
  const [r] = await sql`select md5(concat_ws('|',
    (select coalesce(string_agg(row(b.*)::text, ',' order by b.client_id), '') from public.client_company_brain b where b.workspace_id = ${ws}),
    (select coalesce(string_agg(row(a.*)::text, ','), '') from public.company_brain a where a.workspace_id = ${ws}))) as h`;
  return r.h as string;
}
const clientProfile = async (ws: string, c: string) =>
  (await sql`select profile from public.client_company_brain where workspace_id = ${ws} and client_id = ${c}`)[0]?.profile as Record<string, unknown> | undefined;
const agencyProfile = async (ws: string) =>
  (await sql`select profile from public.company_brain where workspace_id = ${ws}`)[0]?.profile as Record<string, unknown>;
const answersIn = (p: Record<string, unknown> | undefined) => readServerProgress(p)?.answers ?? {};

// ── 1. Agency Brain ──────────────────────────────────────────────────────────
Deno.test("1. a user edits and autosaves the AGENCY Brain: versioned, through the authorized writer, and a manual edit after it", opts, async () => {
  clientsOn(true);
  const ag = await agency();
  let page = await openAgency(ag.ws);
  freshLog();
  const s1 = await autosave(ag.editor, page, copy({ company: { name: "Agency Co", description: "We run outbound for SaaS" } }));
  assertEquals(s1.reply.status, 200, JSON.stringify(s1.reply.body));
  assertEquals(s1.next.status, "saved");
  assertNotEquals(s1.page.version, page.version, "a new version");
  assertEquals(posts("/rpc/company_brain_authorized_write"), 1, "the AUTH-06 writer, once");
  assertEquals(posts("/company_brain"), 0, "never a direct table write");
  assertEquals(answersIn(await agencyProfile(ag.ws)).company?.description, "We run outbound for SaaS");
  page = s1.page;
  const s2 = await autosave(ag.editor, page, copy({ company: { name: "Agency Co", description: "We run outbound for SaaS and fintech" } }, 2));
  assertEquals(s2.reply.status, 200); page = s2.page;
  const m = await call(ag.editor, { action: "update", workspace_id: ag.ws, expected_updated_at: page.version, patch: { positioning: "AGENCY-ONLY edited" } });
  assertEquals(m.status, 200, JSON.stringify(m.body));
  assertEquals((await agencyProfile(ag.ws)).positioning, "AGENCY-ONLY edited");
  assertEquals(await sql`select 1 from public.client_company_brain where workspace_id = ${ag.ws}`.then((r) => r.length), 0, "no client Brain touched");
  assertEquals(external, []);
});

// ── 2. Authorized client Brain ───────────────────────────────────────────────
Deno.test("2. a user edits and autosaves an AUTHORIZED CLIENT Brain: first insert, then CAS on its version; the agency Brain is untouched", opts, async () => {
  clientsOn(true);
  const ag = await agency();
  await grant(ag, ag.A, ag.editor);
  const agencyBefore = JSON.stringify(await agencyProfile(ag.ws));
  let page = await openClient(ag.editor, ag.ws, ag.A);
  assertEquals(page.version, null, "no Brain yet");
  freshLog();
  const s1 = await autosave(ag.editor, page, copy({ company: { name: "Client A Inc", description: "A-SECRET: sells to hospitals" } }));
  assertEquals(s1.reply.status, 200, JSON.stringify(s1.reply.body));
  assertEquals(s1.page.version, "1");
  assertEquals(s1.reply.body.client_id, ag.A);
  assertEquals(posts("/rpc/client_brain_authorized_write"), 1);
  assertEquals(posts("/rpc/company_brain_authorized_write") + posts("/company_brain"), 0, "the agency writer is never called");
  page = s1.page;
  const s2 = await autosave(ag.editor, page, copy({ company: { name: "Client A Inc", description: "A-SECRET: sells to hospitals and clinics" } }, 2));
  assertEquals(s2.page.version, "2"); page = s2.page;
  const m = await call(ag.editor, { action: "update", workspace_id: ag.ws, scope: "client", client_id: ag.A, expected_version: 2, patch: { positioning: "A-SECRET positioning" } });
  assertEquals(m.status, 200, JSON.stringify(m.body)); assertEquals(m.body.version, 3);
  assertEquals((await clientProfile(ag.ws, ag.A))?.positioning, "A-SECRET positioning");
  assertEquals(JSON.stringify(await agencyProfile(ag.ws)), agencyBefore, "agency Brain byte-for-byte unchanged");
  assertEquals(await clientProfile(ag.ws, ag.B), undefined, "client B untouched");
  assertEquals(external, []);
});

// ── 3. A viewer attempts to edit ─────────────────────────────────────────────
Deno.test("3. a viewer's autosave is refused for the agency Brain and for a client it is granted; nothing is written", opts, async () => {
  clientsOn(true);
  const ag = await agency();
  await grant(ag, ag.A, ag.viewer);
  const before = await state(ag.ws);
  freshLog();
  const a = await autosave(ag.viewer, await openAgency(ag.ws), copy({ company: { name: "viewer edit" } }));
  assertEquals(a.reply.status, 403); assertEquals(a.reply.body.error, "brain_role_forbidden");
  assertEquals(a.next.status, "offline", "the page keeps the text and reports it unsaved");
  const c = await autosave(ag.viewer, await openClient(ag.viewer, ag.ws, ag.A), copy({ company: { name: "viewer edit" } }));
  assertEquals(c.reply.status, 403);
  assertEquals(writes(), 0, "no write request at all");
  assertEquals(await state(ag.ws), before);
  // The viewer can still read the client it is granted.
  assertEquals((await call(ag.viewer, { action: "status", workspace_id: ag.ws, scope: "client", client_id: ag.A })).status, 200);
});

// ── 4. Two users edit concurrently ───────────────────────────────────────────
for (const target of ["agency", "client"] as const) {
  Deno.test(`4. two users autosave the same ${target} Brain from one version: no edit is lost, both orderings`, opts, async () => {
    clientsOn(true);
    const ag = await agency();
    await grant(ag, ag.A, ag.editor); await grant(ag, ag.A, ag.editor2);
    const open = (u: User) => target === "agency" ? openAgency(ag.ws) : openClient(u, ag.ws, ag.A);
    const seedU = ag.owner;
    if (target === "client") await grant(ag, ag.A, ag.owner);
    const s0 = await autosave(seedU, await open(seedU), copy({ company: { name: "Shared", description: "base" } }));
    assertEquals(s0.reply.status, 200);
    // (a) one after the other: the second is stale (pre-check), merges, retries.
    let p1 = await open(ag.editor); let p2 = await open(ag.editor2);
    assertEquals(p1.version, p2.version);
    const one = await autosave(ag.editor, p1, copy({ company: { name: "Shared by ONE", description: "base" } }));
    assertEquals(one.reply.status, 200); p1 = one.page;
    const two = await autosave(ag.editor2, p2, copy({ company: { name: "Shared", description: "base, plus TWO's notes" } }));
    assertEquals(two.reply.status, 409); assertEquals(two.outcome.kind, "stale");
    assertEquals(two.next.restore?.answers.company, { name: "Shared by ONE", description: "base, plus TWO's notes" }, "merged: ONE's name and TWO's unsaved notes");
    assertEquals(two.next.conflicts, []);
    p2 = two.page;
    const retry = await autosave(ag.editor2, p2, two.next.restore!);
    assertEquals(retry.reply.status, 200, JSON.stringify(retry.reply.body)); p2 = retry.page;
    // (b) a true race lost at the locked write: ONE's write is held while TWO saves.
    p1 = await open(ag.editor);
    p2 = await open(ag.editor2);
    const writer = target === "agency" ? "/rpc/company_brain_authorized_write" : "/rpc/client_brain_authorized_write";
    let raced = false;
    onRest = async (s) => {
      if (raced || s.method !== "POST" || !s.path.startsWith(writer)) return;
      raced = true; onRest = null;
      const t = await autosave(ag.editor2, p2, copy({ company: { name: "Shared by ONE", description: "TWO raced in" } }));
      assertEquals(t.reply.status, 200);
    };
    const lost = await autosave(ag.editor, p1, copy({ company: { name: "ONE renamed it", description: "base, plus TWO's notes" } }));
    assert(raced, "the race happened");
    assertEquals(lost.reply.status, 409); assertEquals(lost.outcome.kind, "stale");
    // Nothing the user typed is lost in either shape of the answer.
    let p = lost.page; let mine = copy({ company: { name: "ONE renamed it", description: "base, plus TWO's notes" } });
    if (lost.next.restore) mine = lost.next.restore;
    for (let i = 0; i < 3; i++) {
      const r = await autosave(ag.editor, p, mine);
      p = r.page;
      if (r.reply.status === 200) break;
      assertEquals(r.reply.status, 409);
      mine = r.next.restore ?? mine;
    }
    const stored = target === "agency" ? answersIn(await agencyProfile(ag.ws)) : answersIn(await clientProfile(ag.ws, ag.A));
    assertEquals(stored.company, { name: "ONE renamed it", description: "TWO raced in" }, "ONE's rename and TWO's text both survive");
    assertEquals(external, []);
  });
}

// ── 5. Permission revoked during autosave ────────────────────────────────────
async function revokedMidSave(when: (s: Seen) => boolean, revoke: (ag: Agency) => Promise<unknown>, scope: "agency" | "client") {
  clientsOn(true);
  const ag = await agency();
  await grant(ag, ag.A, ag.editor);
  const page = scope === "agency" ? await openAgency(ag.ws) : await openClient(ag.editor, ag.ws, ag.A);
  const before = await brains(ag.ws);
  freshLog();
  let fired = false;
  onRest = async (s) => { if (!fired && when(s)) { fired = true; await revoke(ag); } };
  const mine = copy({ company: { name: "typed before the revocation" } });
  const r = await autosave(ag.editor, page, mine);
  assert(fired, "the revocation committed while the request was in flight");
  return { ag, r, before, after: await brains(ag.ws), page, mine };
}
const grantRevoke = (ag: Agency) => rpc("client_access_revoke", { p_workspace_id: ag.ws, p_client_id: ag.A, p_target_user_id: ag.editor.id, p_actor_id: ag.owner.id, p_session_id: ag.owner.session });
for (const c of [
  { name: "client grant revoked between the handler's check and its read → refused, zero write requests", scope: "client" as const,
    when: (s: Seen) => s.method === "GET" && s.path.startsWith("/rpc/client_brain_read"), revoke: grantRevoke, status: 403, reason: "no_grant", attempts: 0 },
  { name: "client grant revoked at the write → refused by the locked writer: one attempt, zero rows", scope: "client" as const,
    when: (s: Seen) => s.method === "POST" && s.path.startsWith("/rpc/client_brain_authorized_write"), revoke: grantRevoke, status: 403, reason: "no_grant", attempts: 1 },
  { name: "demoted to viewer at the client write → forbidden_role", scope: "client" as const,
    when: (s: Seen) => s.method === "POST" && s.path.startsWith("/rpc/client_brain_authorized_write"),
    revoke: (ag: Agency) => sql`update public.workspace_members set role = 'viewer' where workspace_id = ${ag.ws} and user_id = ${ag.editor.id}`, status: 403, reason: "role", attempts: 1 },
  { name: "client archived at the write → client_archived", scope: "client" as const,
    when: (s: Seen) => s.method === "POST" && s.path.startsWith("/rpc/client_brain_authorized_write"),
    revoke: (ag: Agency) => rpc("client_account_archive", { p_workspace_id: ag.ws, p_client_id: ag.A, p_actor_id: ag.owner.id, p_session_id: ag.owner.session }), status: 403, reason: "client_archived", attempts: 1 },
  { name: "membership removed during an AGENCY autosave (after the Brain read) → not_member, zero write requests", scope: "agency" as const,
    when: (s: Seen) => s.method === "GET" && s.path.startsWith("/company_brain?"),
    revoke: (ag: Agency) => sql`delete from public.workspace_members where workspace_id = ${ag.ws} and user_id = ${ag.editor.id}`, status: 403, reason: "not_member", attempts: 0 },
  { name: "logged out at the client write → session_invalid", scope: "client" as const,
    when: (s: Seen) => s.method === "POST" && s.path.startsWith("/rpc/client_brain_authorized_write"),
    revoke: (ag: Agency) => sql`delete from auth.sessions where id = ${ag.editor.session}`, status: 401, reason: "session_invalid", attempts: 1 },
]) {
  Deno.test(`5. ${c.name}; the page keeps the unsaved text`, opts, async () => {
    const { r, before, after, page, mine } = await revokedMidSave(c.when, c.revoke, c.scope);
    assertEquals(r.reply.status, c.status, JSON.stringify(r.reply.body));
    assertEquals(r.reply.body.reason, c.reason);
    assertEquals(after, before, "no Brain changed");
    assertEquals(writes(), c.attempts, "write requests");
    assertEquals(external, []);
    // The page: still the same version and base, nothing restored over the
    // user's answers — the next pass would retry exactly what was typed.
    assertEquals(r.next.status, "offline");
    assertEquals(r.next.version, page.version);
    assertEquals(r.next.base, page.base);
    assertEquals(r.next.restore, null);
    assertEquals(mine.answers.company.name, "typed before the revocation");
  });
}

// ── 6. Stale version: rejected, nothing typed is lost ────────────────────────
Deno.test("6. a stale autosave is rejected without a write and without losing the user's unsaved text", opts, async () => {
  clientsOn(true);
  const ag = await agency();
  await grant(ag, ag.A, ag.editor); await grant(ag, ag.A, ag.editor2);
  const first = await autosave(ag.editor, await openClient(ag.editor, ag.ws, ag.A), copy({ company: { name: "A", description: "draft" }, founder: { name: "Dana" } }));
  assertEquals(first.reply.status, 200);
  const mineBase = await openClient(ag.editor, ag.ws, ag.A);
  // Someone else saves first: changes the description and the founder's role.
  const other = await autosave(ag.editor2, await openClient(ag.editor2, ag.ws, ag.A), copy({ company: { name: "A", description: "THEIR description" }, founder: { name: "Dana", role: "CEO" } }));
  assertEquals(other.reply.status, 200);
  const stored = await state(ag.ws);
  freshLog();
  const mine = copy({ company: { name: "A, renamed by me", description: "MY UNSAVED description" }, founder: { name: "Dana" } });
  const r = await autosave(ag.editor, mineBase, mine);
  assertEquals(r.reply.status, 409); assertEquals(r.reply.body.rejected_reason, "stale");
  assertEquals(writes(), 0, "a stale save writes nothing"); assertEquals(await state(ag.ws), stored);
  const merged = r.next.restore!;
  assertEquals(merged.answers.company.name, "A, renamed by me", "my change the other side did not touch is kept");
  assertEquals(merged.answers.founder.role, "CEO", "their change I did not touch is taken");
  assertEquals(r.next.conflicts, [{ form: "company", field: "description", mine: "MY UNSAVED description", theirs: "THEIR description" }],
    "a field both changed is offered back with my text, never dropped silently");
});

// ── 7. Switching between clients ─────────────────────────────────────────────
Deno.test("7. switching clients: each Brain has its own version and buffer; an answer or version never crosses to another client", opts, async () => {
  clientsOn(true);
  const ag = await agency();
  await grant(ag, ag.A, ag.editor); await grant(ag, ag.B, ag.editor);
  const listed = ((await (await serviceClient()).rpc("client_accounts_for_actor", { p_workspace_id: ag.ws, p_actor_id: ag.editor.id, p_session_id: ag.editor.session })).data as { client_id: string }[]).map((r) => r.client_id);
  assertEquals(listed.sort(), [ag.A, ag.B].sort());
  let sel = { workspaceId: ag.ws, scope: AGENCY_SCOPE as BrainScope };
  sel = nextBrainScope(sel, { pickClient: ag.A, listed });
  assertEquals(sel.scope, { kind: "client", clientId: ag.A });
  const pA = await openClient(ag.editor, ag.ws, ag.A);
  const a1 = await autosave(ag.editor, pA, copy({ company: { name: "A-ONLY name" } }));
  assertEquals(a1.reply.status, 200);
  sel = nextBrainScope(sel, { pickClient: ag.B, listed });
  assertEquals(sel.scope, { kind: "client", clientId: ag.B });
  assertNotEquals(brainScopeKey(ag.ws, clientScope(ag.A)!), brainScopeKey(ag.ws, sel.scope), "separate unsaved-text buffers");
  assertNotEquals(brainScopeKey(ag.ws, AGENCY_SCOPE), brainScopeKey(ag.ws, sel.scope));
  const pB = await openClient(ag.editor, ag.ws, ag.B);
  assertEquals(pB.version, null, "B starts from B's own state, not A's");
  // A stale buffer carrying A's version must not land on B.
  const before = await state(ag.ws);
  freshLog();
  const crossed = await autosave(ag.editor, { ...pB, version: a1.page.version }, copy({ company: { name: "A-ONLY name" } }));
  assertEquals(crossed.reply.status, 409, "A's version against B is stale, not a write");
  assertEquals(writes(), 0); assertEquals(await state(ag.ws), before);
  assertEquals(crossed.reply.body.client_id, ag.B);
  const b1 = await autosave(ag.editor, pB, copy({ company: { name: "B-ONLY name" } }));
  assertEquals(b1.reply.status, 200);
  assertEquals(answersIn(await clientProfile(ag.ws, ag.A)).company?.name, "A-ONLY name");
  assertEquals(answersIn(await clientProfile(ag.ws, ag.B)).company?.name, "B-ONLY name");
  // A response that arrives after the user switched away is not applied to the new Brain.
  assert(!sameBrainScope(clientScope(ag.A)!, sel.scope));
  // Picking an unlisted client changes nothing; switching workspace returns to that workspace's agency Brain.
  assertEquals(nextBrainScope(sel, { pickClient: uuid(), listed }), sel);
  assertEquals(nextBrainScope(sel, { workspaceId: uuid() }).scope, AGENCY_SCOPE);
  // A client id from another workspace is refused, never resolved to anything.
  const other = await agency();
  assertEquals((await call(ag.editor, { action: "status", workspace_id: ag.ws, scope: "client", client_id: other.A })).body.reason, "no_grant");
});

// ── 8. No client data in another context ─────────────────────────────────────
Deno.test("8. no client's data reaches another client's, the agency's, or an ungranted user's context", opts, async () => {
  clientsOn(true);
  const ag = await agency();
  await grant(ag, ag.A, ag.editor); await grant(ag, ag.B, ag.editor2);
  for (const [u, c, tag] of [[ag.editor, ag.A, "ALPHA-7731"], [ag.editor2, ag.B, "BRAVO-4410"]] as const) {
    const p = await openClient(u, ag.ws, c);
    assertEquals((await autosave(u, p, copy({ company: { name: `${tag} Corp`, description: `${tag} confidential ICP` } }))).reply.status, 200);
  }
  const text = (x: unknown) => JSON.stringify(x);
  const readA = await call(ag.editor, { action: "status", workspace_id: ag.ws, scope: "client", client_id: ag.A });
  const readB = await call(ag.editor2, { action: "status", workspace_id: ag.ws, scope: "client", client_id: ag.B });
  assert(text(readA.body).includes("ALPHA-7731") && !text(readA.body).includes("BRAVO-4410"));
  assert(text(readB.body).includes("BRAVO-4410") && !text(readB.body).includes("ALPHA-7731"));
  assert(!text(readA.body).includes("AGENCY-ONLY") && !text(readB.body).includes("AGENCY-ONLY"), "no agency data in a client read");
  const agencyRow = text(await agencyProfile(ag.ws));
  assert(!agencyRow.includes("ALPHA-7731") && !agencyRow.includes("BRAVO-4410"), "no client data in the agency Brain");
  // Ungranted: refused with a body that carries none of the client's data.
  const cross = await call(ag.editor, { action: "status", workspace_id: ag.ws, scope: "client", client_id: ag.B });
  assertEquals(cross.status, 403); assert(!text(cross.body).includes("BRAVO"));
  const crossSave = await autosave(ag.editor, { ws: ag.ws, scope: clientScope(ag.B)!, version: "1", base: copy({}, 0) }, copy({ company: { name: "x" } }));
  assertEquals(crossSave.reply.status, 403); assert(!text(crossSave.reply.body).includes("BRAVO"), "even a stale-shaped request gets no copy");
  // Agent context for a client scope: that client only.
  const svc = await serviceClient();
  const ctx = await clientBrainContextForScope(svc, { kind: "client", clientId: ag.A }, { workspaceId: ag.ws, actorId: ag.editor.id, sessionId: ag.editor.session });
  assert(ctx.outcome === "ok" && text(ctx.profile).includes("ALPHA-7731") && !text(ctx.profile).includes("BRAVO") && !text(ctx.profile).includes("AGENCY-ONLY"));
  const ctxB = await clientBrainContextForScope(svc, { kind: "client", clientId: ag.B }, { workspaceId: ag.ws, actorId: ag.editor.id, sessionId: ag.editor.session });
  assertEquals(ctxB.outcome, "no_grant");
});

// ── Guards: switched off, missing client, unsupported action ─────────────────
Deno.test("switched off: a client request is refused before any Brain access — never served from the agency Brain", opts, async () => {
  clientsOn(false);
  const ag = await agency();
  await grant(ag, ag.A, ag.editor);
  const before = await state(ag.ws);
  freshLog();
  const r = await call(ag.editor, buildProgressSaveBody({ workspaceId: ag.ws, step: 1, answers: { company: { name: "x" } }, expectedUpdatedAt: null, scope: clientScope(ag.A)! }));
  assertEquals(r.status, 409); assertEquals(r.body.error, "client_brains_disabled");
  assertEquals(seen.filter((s) => !s.path.startsWith("/workspace_members?")), [], "only the membership gate ran");
  assertEquals(await state(ag.ws), before);
  // The agency autosave is unaffected by the switch.
  assertEquals((await autosave(ag.editor, await openAgency(ag.ws), copy({ company: { name: "agency still saves" } }))).reply.status, 200);
});

Deno.test("a client request without a client, or for an action clients do not support, is refused before any model, provider or Brain access", opts, async () => {
  clientsOn(true);
  const ag = await agency();
  await grant(ag, ag.A, ag.editor);
  const before = await state(ag.ws);
  freshLog();
  const missing = await call(ag.editor, { action: "save_draft", workspace_id: ag.ws, scope: "client", patch: {}, setup: { step: 1, answers: {} } });
  assertEquals(missing.status, 400); assertEquals(missing.body.error, "client_context_required");
  const drafting = await call(ag.editor, { action: "draft", workspace_id: ag.ws, scope: "client", client_id: ag.A, website_url: "https://example.com" });
  assertEquals(drafting.status, 400); assertEquals(drafting.body.error, "client_scope_not_supported");
  const research = await call(ag.editor, { action: "research_company", workspace_id: ag.ws, scope: "client", client_id: ag.A, website_url: "https://example.com" });
  assertEquals(research.status, 400);
  assertEquals(external, [], "no provider or model request");
  assertEquals(writes(), 0); assertEquals(await state(ag.ws), before);
});
