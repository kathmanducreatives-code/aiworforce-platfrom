// Company Brain V1 — END TO END through the REAL edge handlers.
//
//   POSTGREST_BIN=… tests/db-contract/run-with-gotrue.sh tests/db-contract/companyBrainMemoryEndToEnd.contract.test.ts
//   (also runs in the plain lane, with the shim's minted sessions)
//
// Real: the ACTUAL company-brain-memory and daily-brief (ORION) handlers,
// captured from Deno.serve; Postgres + PostgREST; with run-with-gotrue.sh, a
// real GoTrue — real sign-up, real access tokens, real logout. A gateway only
// routes (/rest/v1 → PostgREST, /auth/v1 → GoTrue) and can act between the
// handler's own role check and its write. EVERY other outbound request is
// refused and recorded, so no model or provider can be reached.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { captured, restoreServe } from "./lib/captureServe.ts";
import "../../supabase/functions/company-brain-memory/index.ts";
import "../../supabase/functions/daily-brief/index.ts";
import { REST_URL, mintJwt, seedWorkspace, serviceClient, sql, uuid } from "./lib/harness.ts";
import { competitorProposal, opts, sizePref } from "./lib/brainMemory.ts";

const [memoryHandler, briefHandler] = captured;
restoreServe();
assertEquals(captured.length, 2, "both real handlers were captured");

const AUTH_URL = Deno.env.get("BRAIN_E2E_AUTH_URL") ?? null;
if (AUTH_URL && new URL(AUTH_URL).hostname !== "127.0.0.1") throw new Error("real-session mode needs its own loopback GoTrue");

// ── gateway ──────────────────────────────────────────────────────────────────
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
  if (req.url.startsWith(GATEWAY + "/auth/v1/")) {
    if (AUTH_URL) return realFetch(new Request(AUTH_URL + req.url.slice((GATEWAY + "/auth/v1").length), req));
    if (req.url.startsWith(GATEWAY + "/auth/v1/user")) return shimUser(req);
  }
  if (AUTH_URL && req.url.startsWith(AUTH_URL)) return realFetch(req);
  if (req.url.startsWith(REST_URL)) return realFetch(req);
  external.push(req.url);
  throw new Error(`external request refused: ${req.url}`);
};
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "APIFY_API_TOKEN", "FIRECRAWL_API_KEY", "LOVABLE_API_KEY"]) Deno.env.delete(k);
Deno.env.set("SUPABASE_URL", GATEWAY);
Deno.env.set("SUPABASE_ANON_KEY", await mintJwt("anon"));
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", await mintJwt("service_role"));

// Shim-mode users (no GoTrue): a signed JWT carrying a real auth.sessions id.
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(x.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const hmacKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
async function shimToken(id: string, session: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc({ sub: id, role: "authenticated", aud: "authenticated", session_id: session, iat: now, exp: now + 3600 });
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}
async function shimUser(req: Request): Promise<Response> {
  const [h, b, s] = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").split(".");
  const ok = h && b && s && await crypto.subtle.verify("HMAC", hmacKey, fromB64(s), new TextEncoder().encode(`${h}.${b}`));
  if (!ok) return Response.json({ code: 401 }, { status: 401 });
  const c = JSON.parse(new TextDecoder().decode(fromB64(b))) as { sub: string; session_id: string };
  const live = await sql`select 1 from auth.sessions where id = ${c.session_id} and user_id = ${c.sub} and (not_after is null or not_after > now())`;
  if (live.length === 0) return Response.json({ code: 403, error_code: "session_not_found" }, { status: 403 });
  return Response.json({ id: c.sub, aud: "authenticated", role: "authenticated" });
}
if (!AUTH_URL) await sql`create table if not exists auth.sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz default now(), not_after timestamptz)`;

type User = { id: string; session: string; token: string };
async function user(): Promise<User> {
  if (AUTH_URL) {
    const r = await realFetch(AUTH_URL + "/signup", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `memory-e2e-${uuid()}@synthetic.example`, password: "Synthetic-offline-only-58213!" }) });
    const body = await r.json() as { access_token?: string };
    assertEquals(r.status, 200, "local auto-confirmed signup");
    const c = JSON.parse(new TextDecoder().decode(fromB64(body.access_token!.split(".")[1]))) as { sub: string; session_id: string };
    return { id: c.sub, session: c.session_id, token: body.access_token! };
  }
  const id = uuid(); const session = uuid();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id.slice(0, 8)}@contract.test`})`;
  await sql`insert into auth.sessions (id, user_id) values (${session}, ${id})`;
  return { id, session, token: await shimToken(id, session) };
}
async function logout(u: User) {
  if (AUTH_URL) {
    const r = await realFetch(AUTH_URL + "/logout", { method: "POST", headers: { Authorization: `Bearer ${u.token}` } });
    assert(r.status === 204 || r.status === 200, `GoTrue logout: ${r.status}`);
  } else {
    await sql`delete from auth.sessions where id = ${u.session}`;
  }
}
async function team() {
  const ws = await seedWorkspace();
  const [owner, editor, viewer] = [await user(), await user(), await user()];
  for (const [u, role] of [[owner, "owner"], [editor, "editor"], [viewer, "viewer"]] as const) {
    await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${u.id}, ${role})`;
  }
  await sql`insert into public.company_brain (workspace_id, profile, onboarding_completed) values (${ws}, ${sql.json({
    schema_version: 2, company: { name: "Northwind Robotics", description: "Shelf-picking robots" },
    target_customer: { industries: ["Manufacturing"], company_size: { min: 10, max: 50 } }, competitors: ["Rivalco"],
    goals: { gtm: "Win 10 manufacturing customers this quarter" },
  } as never)}, true)`;
  return { ws, owner, editor, viewer };
}

type Reply = { status: number; body: Record<string, unknown> };
async function memory(u: User, body: Record<string, unknown>): Promise<Reply> {
  const res = await memoryHandler(new Request("http://edge.test/company-brain-memory", {
    method: "POST", headers: { Authorization: `Bearer ${u.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
const k = () => `e2e-${uuid()}`;
const writes = () => seen.filter((s) => s.method !== "GET" && s.method !== "HEAD");
function fresh() { seen = []; external = []; onRest = null; }
const items = async (ws: string) => await sql`select * from public.company_brain_memory where workspace_id = ${ws}`;

// ── tests ────────────────────────────────────────────────────────────────────
Deno.test("E1 an editor's preference lands through the real handler, attributed, versioned; a retry replays", opts, async () => {
  const t = await team(); fresh();
  const idem = k();
  const a = await memory(t.editor, { action: "write", workspace_id: t.ws, op: "set", payload: sizePref(10, 50), idempotency_key: idem });
  assertEquals(a.status, 200, JSON.stringify(a.body)); assertEquals(a.body.outcome, "ok");
  const b = await memory(t.editor, { action: "write", workspace_id: t.ws, op: "set", payload: sizePref(10, 50), idempotency_key: idem });
  assertEquals(b.status, 200); assertEquals(b.body.replayed, true);
  const rows = await items(t.ws);
  assertEquals(rows.length, 1); assertEquals(rows[0].created_by, t.editor.id); assertEquals(rows[0].source_type, "user_provided");
  const c = await memory(t.owner, { action: "write", workspace_id: t.ws, op: "correct", idempotency_key: k(),
    payload: sizePref(50, 200, { expected_version: 1, reason: "upmarket" }) });
  assertEquals(c.status, 200);
  const stale = await memory(t.editor, { action: "write", workspace_id: t.ws, op: "set", idempotency_key: k(), payload: sizePref(1, 2, { expected_version: 1 }) });
  assertEquals(stale.status, 409); assertEquals(stale.body.outcome, "stale");
  const h = await sql`select change_kind, actor_id, previous from public.company_brain_memory_history where memory_id = ${rows[0].id} order by created_at`;
  assertEquals(h.map((x) => x.change_kind), ["created", "corrected"]);
  assertEquals(h[1].actor_id, t.owner.id); assertEquals(h[1].previous.value, { min: 10, max: 50 });
  assertEquals(external, []);
});

Deno.test("E2 a viewer, an outsider, a forged provenance field and another workspace are refused with ZERO writes", opts, async () => {
  const t = await team(); const other = await team(); fresh();
  const viewer = await memory(t.viewer, { action: "write", workspace_id: t.ws, op: "set", payload: sizePref(1, 2), idempotency_key: k() });
  assertEquals(viewer.status, 403); assertEquals(viewer.body.error, "brain_role_forbidden");
  const outsider = await memory(other.owner, { action: "write", workspace_id: t.ws, op: "set", payload: sizePref(1, 2), idempotency_key: k() });
  assertEquals(outsider.status, 403);
  const forged = await memory(t.owner, { action: "write", workspace_id: t.ws, op: "set", idempotency_key: k(),
    payload: { ...sizePref(1, 2), verification_status: "corroborated" } });
  assertEquals(forged.status, 400);
  const readOther = await memory(t.owner, { action: "context", workspace_id: other.ws });
  assertEquals(readOther.status, 403, "context of another workspace is refused");
  assertEquals(writes(), [], "no request reached a write endpoint");
  assertEquals((await items(t.ws)).length, 0);
});

Deno.test("E3 logged out: the token no longer works and nothing is written", opts, async () => {
  const t = await team();
  await logout(t.editor); fresh();
  const r = await memory(t.editor, { action: "write", workspace_id: t.ws, op: "set", payload: sizePref(1, 2), idempotency_key: k() });
  assertEquals(r.status, 401, JSON.stringify(r.body));
  assertEquals(writes(), []); assertEquals((await items(t.ws)).length, 0);
});

Deno.test("E4 demoted AFTER the handler's role check, before its write → the locked writer refuses; zero rows", opts, async () => {
  const t = await team(); fresh();
  onRest = async (s) => {
    if (s.method === "POST" && s.path.startsWith("/rpc/company_brain_memory_write")) {
      onRest = null;
      await sql`update public.workspace_members set role = 'viewer' where workspace_id = ${t.ws} and user_id = ${t.editor.id}`;
    }
  };
  const r = await memory(t.editor, { action: "write", workspace_id: t.ws, op: "set", payload: sizePref(1, 2), idempotency_key: k() });
  assertEquals(r.status, 403); assertEquals(r.body.outcome, "forbidden_role");
  assertEquals((await items(t.ws)).length, 0);
});

Deno.test("E5 removed from the workspace mid-request → not_member at the write; zero rows", opts, async () => {
  const t = await team(); fresh();
  onRest = async (s) => {
    if (s.method === "POST" && s.path.startsWith("/rpc/company_brain_memory_write")) {
      onRest = null;
      await sql`delete from public.workspace_members where workspace_id = ${t.ws} and user_id = ${t.editor.id}`;
    }
  };
  const r = await memory(t.editor, { action: "write", workspace_id: t.ws, op: "decide", idempotency_key: k(),
    payload: { category: "lead_rejected", scope: "lead", scope_ref: "lead-1", value: { outcome: "rejected" } } });
  assertEquals(r.status, 403); assertEquals(r.body.outcome, "not_member");
  assertEquals((await items(t.ws)).length, 0);
});

Deno.test("E6 a LISA proposal: invisible to agents while pending; viewer cannot approve; editor approves; agents see it", opts, async () => {
  const t = await team();
  const svc = await serviceClient();
  const { data: sub } = await svc.rpc("company_brain_proposal_submit", { p_workspace_id: t.ws, p_agent: "lisa", p_payload: competitorProposal("fleetbot.io") });
  const pid = String((sub as Record<string, unknown>).proposal_id);
  let ctx = await memory(t.viewer, { action: "context", workspace_id: t.ws });
  assertEquals(ctx.status, 200, "a viewer may READ the context");
  assertEquals(ctx.body.pending_proposals, 1);
  assert(!String((ctx.body.agents as Record<string, string>).lisa).includes("fleetbot"));

  fresh();
  const v = await memory(t.viewer, { action: "review_proposal", workspace_id: t.ws, proposal_id: pid, decision: "approve", idempotency_key: k() });
  assertEquals(v.status, 403); assertEquals(writes(), []);
  const ok = await memory(t.editor, { action: "review_proposal", workspace_id: t.ws, proposal_id: pid, decision: "approve", idempotency_key: k() });
  assertEquals(ok.status, 200, JSON.stringify(ok.body)); assertEquals(ok.body.status, "approved");
  const again = await memory(t.owner, { action: "review_proposal", workspace_id: t.ws, proposal_id: pid, decision: "approve", idempotency_key: k() });
  assertEquals(again.status, 409); assertEquals(again.body.outcome, "not_pending");

  ctx = await memory(t.viewer, { action: "context", workspace_id: t.ws });
  assert(String((ctx.body.agents as Record<string, string>).lisa).includes("fleetbot (fleetbot.io)"));
  assertEquals(ctx.body.pending_proposals, 0);
  const [row] = await items(t.ws);
  assertEquals(row.created_by_agent, "lisa"); assertEquals(row.approved_by, t.editor.id); assertEquals(row.verification_status, "user_confirmed");
});

Deno.test("E7 LYRA: only an APPROVED content item of this workspace becomes a (pending) proposal", opts, async () => {
  const t = await team(); const other = await team();
  const mk = async (ws: string, status: string) => (await sql`insert into public.content_item (workspace_id, status, title, metadata)
    values (${ws}, ${status}, 'Pick rates stall at 2pm', ${sql.json({ content_strategy: { angle: "Picking speed beats headcount" } } as never)}) returning id`)[0].id as string;
  const approved = await mk(t.ws, "approved"); const draft = await mk(t.ws, "draft"); const foreign = await mk(other.ws, "approved");
  const a = await memory(t.editor, { action: "content_approved", workspace_id: t.ws, content_item_id: approved });
  assertEquals(a.status, 200, JSON.stringify(a.body)); assertEquals(a.body.outcome, "created");
  assertEquals((await memory(t.editor, { action: "content_approved", workspace_id: t.ws, content_item_id: draft })).body.outcome, "nothing_to_propose");
  assertEquals((await memory(t.editor, { action: "content_approved", workspace_id: t.ws, content_item_id: foreign })).status, 404,
    "another workspace's content cannot be used");
  const [p] = await sql`select proposed_by_agent, status, source_type, evidence from public.company_brain_memory_proposals where workspace_id = ${t.ws}`;
  assertEquals([p.proposed_by_agent, p.status, p.source_type], ["lyra", "pending", "agent_suggestion"]);
  assertEquals(p.evidence, [{ source_ref: `content_item:${approved}` }]);
  assertEquals((await items(t.ws)).length, 0, "nothing became memory without a person");
});

Deno.test("E8 redaction needs owner or admin; it blanks the value everywhere", opts, async () => {
  const t = await team();
  const w = await memory(t.editor, { action: "write", workspace_id: t.ws, op: "set", idempotency_key: k(),
    payload: { kind: "fact", category: "customers", fact_key: "customer.jane", value_type: "text", value: "Jane Doe private note" } });
  const id = String(w.body.memory_id);
  assertEquals((await memory(t.editor, { action: "redact", workspace_id: t.ws, target: "memory", id, reason: "erasure request" })).status, 403);
  const r = await memory(t.owner, { action: "redact", workspace_id: t.ws, target: "memory", id, reason: "erasure request" });
  assertEquals(r.status, 200, JSON.stringify(r.body));
  const dump = JSON.stringify(await sql`select * from public.company_brain_memory_history where memory_id = ${id}`) + JSON.stringify(await items(t.ws));
  assert(!dump.includes("Jane Doe"));
});

Deno.test("E9 ORION (real daily-brief handler): memory shapes the brief; nothing external is called", opts, async () => {
  const t = await team();
  const mkLead = async (name: string, industry: string) => {
    const [a] = await sql`insert into public.accounts (workspace_id, name, industry) values (${t.ws}, ${name}, ${industry}) returning id`;
    const [l] = await sql`insert into public.lead_candidates (workspace_id, account_id, status, fit_score, priority, reason)
      values (${t.ws}, ${a.id}, 'new', 0.8, 'high', 'Expanding warehouse floor') returning id`;
    return String(l.id);
  };
  const keep = await mkLead("Fjord Metals", "Manufacturing");
  const reject = await mkLead("Nordic Steelworks", "Manufacturing");
  const defense = await mkLead("Aegis Systems", "Defense");
  await memory(t.editor, { action: "write", workspace_id: t.ws, op: "decide", idempotency_key: k(),
    payload: { category: "lead_rejected", scope: "lead", scope_ref: reject, value: { outcome: "rejected", note: "already a Rivalco customer" } } });
  await memory(t.editor, { action: "write", workspace_id: t.ws, op: "set", idempotency_key: k(),
    payload: { kind: "preference", category: "exclusions", fact_key: "exclusion.industry:defense", value_type: "object", value: { type: "industry", value: "Defense" } } });
  fresh();
  const res = await briefHandler(new Request("http://edge.test/daily-brief", {
    method: "POST", headers: { Authorization: `Bearer ${t.viewer.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_id: t.ws, surface: "dashboard" }),
  }));
  const body = await res.json() as Record<string, unknown>;
  assertEquals(res.status, 200, JSON.stringify(body).slice(0, 400));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const brief = (body.brief ?? body) as Record<string, any>;
  const ids = (brief.opportunities as Array<{ evidence: Array<{ id: string }> }>).flatMap((o) => o.evidence.map((e) => e.id));
  assert(ids.includes(keep), "the kept lead is an opportunity");
  assert(!ids.includes(reject), "the rejected lead is left out");
  const influences = brief.brain.influences as Array<{ fact: string; effect: string }>;
  assert(influences.some((i) => i.fact === "You rejected this lead"));
  assert(influences.some((i) => i.fact.startsWith("Exclusion: industry Defense") && i.effect === "ranked lower"));
  assertEquals(brief.synthesis.mode, "deterministic", "no model key: the deterministic brief");
  assertEquals(external, [], `no external request: ${external.join(", ")}`);
  void defense;
});
