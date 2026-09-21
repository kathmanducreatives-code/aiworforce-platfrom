// THE ROUTER — WHAT THE EDGE GATEWAY DID, AND NOTHING MORE.
//
// The API's whole job is to hand a request to the function's own handler with
// the request intact. So these cases are mostly about what it must NOT do:
// must not read the body, must not touch the Authorization header, must not
// answer for the handler, must not let an unauthenticated caller through, and
// must not tell a stranger which routes exist.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { corsHeadersFor, createApiHandler, routeNameFor } from "../../../worker/api/server.ts";
import { IMPORT_ONLY_FLAGS, routesToMount, SERVABLE_ROUTES } from "../../../worker/api/routes.ts";
import { RAILWAY_SERVED_FUNCTIONS } from "../../../supabase/functions/_shared/functionEndpoints.ts";

const env = (m: Record<string, string> = {}) => (k: string) => m[k];
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";

/** A handler that records exactly what it was handed. */
function spy(res: () => Response) {
  const seen: { auth: string | null; body: string; method: string; url: string }[] = [];
  return {
    seen,
    handler: async (req: Request) => {
      seen.push({
        auth: req.headers.get("Authorization"),
        body: await req.text(),
        method: req.method,
        url: req.url,
      });
      return res();
    },
  };
}

const post = (path: string, init: RequestInit = {}) =>
  new Request(`https://api.test${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${JWT}`, "content-type": "application/json" },
    body: JSON.stringify({ workspace_id: "w1" }),
    ...init,
  });

Deno.test("only `/api/<name>` is an API path; the health paths are left alone", () => {
  assertEquals(routeNameFor("/api/pilot-chat"), "pilot-chat");
  assertEquals(routeNameFor("/api/pilot-chat/"), "pilot-chat");
  for (const p of ["/", "/health", "/healthz", "/api", "/api/", "/api/a/b", "/pilot-chat"]) {
    assertEquals(routeNameFor(p), null, p);
  }
});

Deno.test("a non-API path returns null so the health server still answers it", async () => {
  const api = createApiHandler({ handlers: new Map(), env: env() });
  for (const p of ["/health", "/", "/metrics"]) {
    assertEquals(await api(new Request(`https://api.test${p}`)), null, p);
  }
});

Deno.test("THE REQUEST REACHES THE HANDLER UNTOUCHED — header, body and method", async () => {
  const s = spy(() => new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "content-type": "application/json" },
  }));
  const api = createApiHandler({ handlers: new Map([["pilot-chat", s.handler]]), env: env() });
  const res = await api(post("/api/pilot-chat"));
  assertEquals(res?.status, 200);
  assertEquals(await res?.json(), { ok: true });
  assertEquals(s.seen.length, 1);
  // Verbatim: the handlers derive identity from this header, so rewriting it
  // here — even to normalise it — would move the trust boundary.
  assertEquals(s.seen[0].auth, `Bearer ${JWT}`);
  assertEquals(JSON.parse(s.seen[0].body), { workspace_id: "w1" });
  assertEquals(s.seen[0].method, "POST");
});

Deno.test("THE HANDLER'S OWN STATUS AND BODY ARE THE ANSWER — including its refusals", async () => {
  // A 403 from `decideWorkspaceAccess` must arrive as a 403 with its code, not
  // as a generic error: `readErrorBody` in the frontend turns exactly this into
  // a sentence the user can act on.
  const s = spy(() => new Response(JSON.stringify({ error: "forbidden_workspace" }), {
    status: 403, headers: { "content-type": "application/json" },
  }));
  const api = createApiHandler({ handlers: new Map([["run-agent", s.handler]]), env: env() });
  const res = await api(post("/api/run-agent"));
  assertEquals(res?.status, 403);
  assertEquals(await res?.json(), { error: "forbidden_workspace" });
  assertEquals(res?.headers.get("content-type"), "application/json");
});

Deno.test("THE GATE RUNS BEFORE THE HANDLER: no bearer, no call", async () => {
  const s = spy(() => new Response("{}"));
  const api = createApiHandler({ handlers: new Map([["pilot-chat", s.handler]]), env: env() });
  const res = await api(post("/api/pilot-chat", { headers: { "content-type": "application/json" } }));
  assertEquals(res?.status, 401);
  assertEquals(await res?.json(), { error: "missing_authorization" });
  assertEquals(s.seen.length, 0, "the handler was never entered, so no body was read and nothing was charged");
});

Deno.test("A FORGED TOKEN IS REFUSED WHEN THE SECRET IS CONFIGURED", async () => {
  const s = spy(() => new Response("{}"));
  const api = createApiHandler({
    handlers: new Map([["pilot-chat", s.handler]]),
    env: env({ SUPABASE_JWT_SECRET: "a-secret-that-this-token-was-not-signed-with" }),
  });
  const res = await api(post("/api/pilot-chat"));
  assertEquals(res?.status, 401);
  assertEquals(await res?.json(), { error: "invalid_token" });
  assertEquals(s.seen.length, 0);
});

Deno.test("AN UNMOUNTED ROUTE IS A 404 BEFORE THE GATE — a prober learns nothing", async () => {
  const api = createApiHandler({ handlers: new Map([["pilot-chat", async () => new Response("{}")]]), env: env() });
  // No credential at all, and the answer is still 404, not 401: a 401 here
  // would confirm to an unauthenticated caller which routes are mounted.
  const res = await api(new Request("https://api.test/api/orchestrate", { method: "POST" }));
  assertEquals(res?.status, 404);
  assertEquals(await res?.json(), { error: "not_found", route: "orchestrate" });
});

Deno.test("GET is not a way in", async () => {
  const s = spy(() => new Response("{}"));
  const api = createApiHandler({ handlers: new Map([["pilot-chat", s.handler]]), env: env() });
  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    const res = await api(new Request("https://api.test/api/pilot-chat", { method }));
    assertEquals(res?.status, 405, method);
  }
  assertEquals(s.seen.length, 0);
});

Deno.test("THE PREFLIGHT IS ANSWERED WITHOUT A CREDENTIAL — a browser sends none", async () => {
  const api = createApiHandler({ handlers: new Map([["pilot-chat", async () => new Response("{}")]]), env: env() });
  const res = await api(new Request("https://api.test/api/pilot-chat", { method: "OPTIONS" }));
  assertEquals(res?.status, 200);
  assertEquals(res?.headers.get("Access-Control-Allow-Origin"), "*");
  assert((res?.headers.get("Access-Control-Allow-Headers") ?? "").includes("authorization"));
});

Deno.test("CORS matches what the edge functions already send, and narrows only when told to", () => {
  assertEquals(corsHeadersFor("https://app.example", env())["Access-Control-Allow-Origin"], "*",
    "the default equals the edge functions' own cors object — the cutover must not change behaviour");
  const narrowed = env({ AGENTORY_API_ALLOWED_ORIGINS: "https://app.example,https://staging.example" });
  assertEquals(corsHeadersFor("https://app.example", narrowed)["Access-Control-Allow-Origin"], "https://app.example");
  assertEquals(corsHeadersFor("https://evil.example", narrowed)["Access-Control-Allow-Origin"], "https://app.example",
    "an unlisted origin is never echoed back");
  assertEquals(corsHeadersFor("https://app.example", narrowed).Vary, "Origin");
});

Deno.test("A HANDLER THAT THROWS IS A 500, and the stack never reaches the caller", async () => {
  const logged: unknown[] = [];
  const api = createApiHandler({
    handlers: new Map([["run-agent", () => Promise.reject(new Error("SUPABASE_SERVICE_ROLE_KEY=sk_live_secret"))]]),
    env: env(), log: (_m, meta) => logged.push(meta),
  });
  const res = await api(post("/api/run-agent"));
  assertEquals(res?.status, 500);
  const body = await res?.text() ?? "";
  assertEquals(JSON.parse(body), { error: "internal_error", route: "run-agent" });
  assert(!body.includes("sk_live_secret"), "the thrown message is not echoed to the caller");
  assertEquals(logged.length, 1, "it is logged instead");
});

// ── the route table ─────────────────────────────────────────────────────────

Deno.test("THE ROUTES AND THE CALLERS READ THE SAME LIST — they cannot drift", () => {
  assertEquals([...SERVABLE_ROUTES], [...RAILWAY_SERVED_FUNCTIONS],
    "a function callers can be pointed at is a function something here answers");
  // Every servable route has an opt-out flag, or importing it would open a
  // second listener that fights the API for PORT.
  for (const r of SERVABLE_ROUTES) assert(IMPORT_ONLY_FLAGS[r], `${r} has no IMPORT_ONLY flag`);
});

Deno.test("which routes a process mounts is its own switch, separate from where callers send work", () => {
  assertEquals(routesToMount(env()), [...SERVABLE_ROUTES], "unset means all of them");
  assertEquals(routesToMount(env({ AGENTORY_API_ROUTES: "*" })), [...SERVABLE_ROUTES]);
  assertEquals(routesToMount(env({ AGENTORY_API_ROUTES: "pilot-chat" })), ["pilot-chat"]);
  assertEquals(routesToMount(env({ AGENTORY_API_ROUTES: " pilot-chat , orchestrate " })),
    ["pilot-chat", "orchestrate"]);
  assertEquals(routesToMount(env({ AGENTORY_API_ROUTES: "daily-brief" })), [],
    "a route the API cannot serve is not mounted by asking for it");
});
