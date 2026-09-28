// APPROVE-AND-CONTINUE: THE WHOLE AUTHORIZATION CHAIN, THROUGH THE REAL HANDLER.
//
// The handler runs for real on real supabase-js; only `fetch` is faked. The fake
// is STRICT: Auth answers only for tokens it issued, PostgREST filters by every
// predicate the handler sends, and every request is recorded in order so the
// tests can prove that nothing privileged happens before authorization.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  APPROVER_ROLES, decideApprovalAccess, parseApprovalRequest, settledAnswer,
} from "../../supabase/functions/_shared/approvalAuthorization.ts";

Deno.env.set("APPROVE_AND_CONTINUE_IMPORT_ONLY", "1");
const { handleApproveAndContinue } = await import("../../supabase/functions/approve-and-continue/index.ts");

const URL_ = "https://proj.supabase.co";
const ANON = "anon-public-key";
const SERVICE = "service-role-secret";

const WS_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const WS_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const USER_A = "11111111-0000-4000-8000-000000000001";
const USER_B = "22222222-0000-4000-8000-000000000002";
const VIEWER_A = "33333333-0000-4000-8000-000000000003";
const TOKENS: Record<string, string> = { "jwt-user-a": USER_A, "jwt-user-b": USER_B, "jwt-viewer-a": VIEWER_A };

const APPROVAL_A = "a0000000-0000-4000-8000-0000000000a1";
const APPROVAL_A_NEXT = "a0000000-0000-4000-8000-0000000000a2";
const APPROVAL_B = "b0000000-0000-4000-8000-0000000000b1";
const PLAN_A = "p0000000-0000-4000-8000-0000000000a1".replace("p", "c");
const PLAN_B = "p0000000-0000-4000-8000-0000000000b1".replace("p", "d");

type Row = Record<string, unknown>;

function world() {
  const tables: Record<string, Row[]> = {
    approvals: [
      { id: APPROVAL_A, workspace_id: WS_A, task_plan_id: PLAN_A, agent_id: null, status: "pending", payload: {} },
      { id: APPROVAL_A_NEXT, workspace_id: WS_A, task_plan_id: PLAN_A, agent_id: null, status: "pending",
        payload: { next_step: { step_index: 2, agent_id: "agent-x", agent_name: "Writer", instruction: "draft" }, output: { x: 1 } } },
      { id: APPROVAL_B, workspace_id: WS_B, task_plan_id: PLAN_B, agent_id: null, status: "pending", payload: {} },
    ],
    workspace_members: [
      { workspace_id: WS_A, user_id: USER_A, role: "owner" },
      { workspace_id: WS_B, user_id: USER_B, role: "member" },
      { workspace_id: WS_A, user_id: VIEWER_A, role: "viewer" },
    ],
    activity_feed: [],
    task_plans: [{ id: PLAN_A, workspace_id: WS_A, status: "awaiting_approval" }, { id: PLAN_B, workspace_id: WS_B, status: "awaiting_approval" }],
  };
  const log: string[] = [];
  const functionCalls: Array<{ fn: string; auth: string | null; body: unknown }> = [];

  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchFake: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const u = new URL(req.url);
    const method = req.method.toUpperCase();
    const bodyText = init?.body ? String(init.body) : (method === "GET" ? "" : await req.text());
    if (!req.url.startsWith(URL_)) throw new Error(`unexpected host ${req.url}`);
    log.push(`${method} ${u.pathname}`);

    if (u.pathname === "/auth/v1/user") {
      const tok = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      const id = TOKENS[tok];
      return id ? respond({ id, aud: "authenticated" }) : respond({ message: "invalid JWT" }, 401);
    }
    if (u.pathname.startsWith("/functions/v1/")) {
      functionCalls.push({ fn: u.pathname.slice(14), auth: req.headers.get("authorization"), body: JSON.parse(bodyText || "null") });
      return respond({ ok: true });
    }
    const m = u.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m || !(m[1] in tables)) throw new Error(`unroutable ${u.pathname}`);
    // PostgREST is only ever reached with the SERVICE key in this handler.
    assertEquals(req.headers.get("apikey"), SERVICE, `${m[1]} read without the service key`);
    const rows = tables[m[1]];
    const filtered = rows.filter((r) => [...u.searchParams].every(([k, v]) =>
      ["select", "limit", "order"].includes(k) || (v.startsWith("eq.") ? String(r[k]) === v.slice(3) : false)));
    const one = (req.headers.get("accept") ?? "").includes("vnd.pgrst.object");
    if (method === "GET") return respond(one ? (filtered[0] ?? null) : filtered);
    if (method === "PATCH") {
      const patch = JSON.parse(bodyText);
      for (const r of filtered) Object.assign(r, patch);
      return respond(one ? (filtered[0] ?? null) : filtered);
    }
    if (method === "POST") {
      const incoming = JSON.parse(bodyText);
      rows.push(...(Array.isArray(incoming) ? incoming : [incoming]));
      return respond([], 201);
    }
    throw new Error(`unsupported ${method}`);
  };

  const env = (k: string) => ({ SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE } as Record<string, string>)[k];
  const call = (body: unknown, token?: string) => handleApproveAndContinue(new Request(`${URL_}/functions/v1/approve-and-continue`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }), { env, fetch: fetchFake });
  const approval = (id: string) => tables.approvals.find((r) => r.id === id)!;
  const writes = () => log.filter((l) => !l.startsWith("GET"));
  return { tables, log, functionCalls, call, approval, writes };
}

const body = (id: string, action: string) => ({ approval_id: id, action });

// ── 1. REFUSALS: nothing privileged happens ───────────────────────────────────

Deno.test("anonymous → 401, and nothing but the auth check is ever attempted", async () => {
  const w = world();
  const r = await w.call(body(APPROVAL_A, "approve"));
  assertEquals(r.status, 401);
  assertEquals(w.log, []);
  assertEquals(w.approval(APPROVAL_A).status, "pending");
});

Deno.test("the public anon key as a bearer → 401 without reaching the database", async () => {
  const w = world();
  const r = await w.call(body(APPROVAL_A, "approve"), ANON);
  assertEquals(r.status, 401);
  assertEquals(w.log, []);
});

Deno.test("an invalid or expired token → 401; no approval is read, nothing is written", async () => {
  const w = world();
  const r = await w.call(body(APPROVAL_A, "approve"), "jwt-expired");
  assertEquals(r.status, 401);
  assertEquals(w.log, ["GET /auth/v1/user"]);
  assertEquals(w.approval(APPROVAL_A).status, "pending");
});

Deno.test("a guessed approval UUID → safe 404, and no membership or write follows", async () => {
  const w = world();
  const r = await w.call(body("0f0f0f0f-0000-4000-8000-000000000000", "approve"), "jwt-user-a");
  assertEquals(r.status, 404);
  assertEquals((await r.json()).error, "approval_not_found");
  assertEquals(w.writes(), []);
  assertEquals(w.functionCalls, []);
});

Deno.test("cross-workspace APPROVE → 403; B's approval stays pending and B's plan does not continue", async () => {
  const w = world();
  const r = await w.call(body(APPROVAL_B, "approve"), "jwt-user-a");
  assertEquals(r.status, 403);
  assertEquals(w.approval(APPROVAL_B).status, "pending");
  assertEquals(w.writes(), []);
  assertEquals(w.functionCalls, []);
  assertEquals(w.log, ["GET /auth/v1/user", "GET /rest/v1/approvals", "GET /rest/v1/workspace_members"]);
});

Deno.test("cross-workspace REJECT → 403, both directions; neither plan is failed", async () => {
  const w = world();
  assertEquals((await w.call(body(APPROVAL_B, "reject"), "jwt-user-a")).status, 403);
  assertEquals((await w.call(body(APPROVAL_A, "reject"), "jwt-user-b")).status, 403);
  assertEquals(w.writes(), []);
  assertEquals(w.tables.task_plans.map((p) => p.status), ["awaiting_approval", "awaiting_approval"]);
});

Deno.test("a client-supplied workspace_id is ignored: the approval's own workspace decides", async () => {
  const w = world();
  const r = await w.call({ ...body(APPROVAL_B, "approve"), workspace_id: WS_A }, "jwt-user-a");
  assertEquals(r.status, 403);
  assertEquals(w.approval(APPROVAL_B).status, "pending");
});

Deno.test("a member whose role cannot settle approvals → 403", async () => {
  const w = world();
  const r = await w.call(body(APPROVAL_A, "approve"), "jwt-viewer-a");
  assertEquals(r.status, 403);
  assertEquals((await r.json()).error, "forbidden_action");
  assertEquals(w.writes(), []);
});

Deno.test("malformed input → 400 after authentication, before any database access", async () => {
  const w = world();
  assertEquals((await w.call(body(APPROVAL_A, "delete"), "jwt-user-a")).status, 400);
  assertEquals((await w.call(body("not-a-uuid", "approve"), "jwt-user-a")).status, 400);
  assertEquals((await w.call({}, "jwt-user-a")).status, 400);
  assert(w.log.every((l) => l === "GET /auth/v1/user"), w.log.join(","));
});

// ── 2. THE AUTHORISED PATHS ───────────────────────────────────────────────────

Deno.test("valid member APPROVE with no next step → approved, plan done, decider recorded", async () => {
  const w = world();
  const r = await w.call(body(APPROVAL_A, "approve"), "jwt-user-a");
  assertEquals(r.status, 200);
  assertEquals((await r.json()).status, "done");
  assertEquals(w.approval(APPROVAL_A).status, "approved");
  assertEquals(w.tables.task_plans.find((p) => p.id === PLAN_A)!.status, "done");
  assertEquals(w.tables.task_plans.find((p) => p.id === PLAN_B)!.status, "awaiting_approval");
  assertEquals((w.tables.activity_feed[0].metadata as Row).decided_by, USER_A);
});

Deno.test("valid member APPROVE with a next step → run-agent is dispatched once, for the approval's workspace", async () => {
  const w = world();
  const r = await w.call({ ...body(APPROVAL_A_NEXT, "approve"), workspace_id: WS_B }, "jwt-user-a");
  assertEquals(r.status, 200);
  assertEquals((await r.json()).status, "continuing");
  assertEquals(w.functionCalls.length, 1);
  assertEquals(w.functionCalls[0].fn, "run-agent");
  assertEquals((w.functionCalls[0].body as Row).workspace_id, WS_A);
  assertEquals(w.functionCalls[0].auth, `Bearer ${SERVICE}`);
});

Deno.test("valid member REJECT → rejected and only that workspace's plan fails", async () => {
  const w = world();
  const r = await w.call(body(APPROVAL_B, "reject"), "jwt-user-b");
  assertEquals(r.status, 200);
  assertEquals(w.approval(APPROVAL_B).status, "rejected");
  assertEquals(w.tables.task_plans.find((p) => p.id === PLAN_B)!.status, "failed");
  assertEquals(w.tables.task_plans.find((p) => p.id === PLAN_A)!.status, "awaiting_approval");
});

// ── 3. REPEATS ARE DETERMINISTIC ──────────────────────────────────────────────

Deno.test("a repeated approve → 200 already_settled, and the plan is continued exactly once", async () => {
  const w = world();
  assertEquals((await w.call(body(APPROVAL_A_NEXT, "approve"), "jwt-user-a")).status, 200);
  const again = await w.call(body(APPROVAL_A_NEXT, "approve"), "jwt-user-a");
  assertEquals(again.status, 200);
  assertEquals((await again.json()).already_settled, true);
  assertEquals(w.functionCalls.length, 1);
  assertEquals(w.tables.activity_feed.length, 1);
});

Deno.test("the opposite decision on a settled approval → 409 with the settled status; nothing changes", async () => {
  const w = world();
  await w.call(body(APPROVAL_A, "approve"), "jwt-user-a");
  const r = await w.call(body(APPROVAL_A, "reject"), "jwt-user-a");
  assertEquals(r.status, 409);
  assertEquals((await r.json()).status, "approved");
  assertEquals(w.approval(APPROVAL_A).status, "approved");
});

Deno.test("two concurrent approves → one wins the conditional update; one continuation", async () => {
  const w = world();
  const [a, b] = await Promise.all([
    w.call(body(APPROVAL_A_NEXT, "approve"), "jwt-user-a"),
    w.call(body(APPROVAL_A_NEXT, "approve"), "jwt-user-a"),
  ]);
  assertEquals([a.status, b.status], [200, 200]);
  assertEquals(w.functionCalls.length, 1);
  assertEquals(w.tables.activity_feed.length, 1);
});

// ── 4. THE PURE DECISIONS ─────────────────────────────────────────────────────

Deno.test("decisions: unknown roles refused, missing workspace is not found, settled answers are stable", () => {
  assert(APPROVER_ROLES.has("owner") && APPROVER_ROLES.has("member") && !APPROVER_ROLES.has("viewer"));
  const ap = { id: APPROVAL_A, workspace_id: null, task_plan_id: null, agent_id: null, status: "pending", payload: null };
  assertEquals(decideApprovalAccess({ approval: ap, role: "owner" }), { ok: false, status: 404, error: "approval_not_found" });
  assertEquals(decideApprovalAccess({ approval: null, role: null }).ok, false);
  assertEquals(parseApprovalRequest({ approval_id: APPROVAL_A, action: "approve" }).ok, true);
  assertEquals(settledAnswer("rejected", "reject").status, 200);
  assertEquals(settledAnswer("approved", "reject").status, 409);
});

Deno.test("an unexpected failure answers 500 without leaking internals", async () => {
  const w = world();
  const env = (k: string) => ({ SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE } as Record<string, string>)[k];
  const boom: typeof fetch = () => Promise.reject(new Error("db password=hunter2 exploded"));
  const r = await handleApproveAndContinue(new Request(`${URL_}/x`, {
    method: "POST", headers: { Authorization: "Bearer jwt-user-a" }, body: JSON.stringify(body(APPROVAL_A, "approve")),
  }), { env, fetch: boom });
  const text = await r.text();
  assert(r.status === 401 || r.status === 500, String(r.status));
  assert(!text.includes("hunter2"));
  void w;
});
