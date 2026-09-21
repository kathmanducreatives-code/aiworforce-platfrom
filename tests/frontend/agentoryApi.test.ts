// ONE TRANSPORT — WHERE A CALL GOES, AND WHAT COMES BACK.
//
// Every call site was rewritten from `supabase.functions.invoke(name, {body})`
// to `invokeFunction(name, body)`. Two things must hold for that to be safe:
//
//   1. With the build unconfigured, nothing moved. A production bundle that
//      sets neither variable behaves exactly as it did.
//   2. The result shape is `functions.invoke`'s own — including `error.context`
//      as a real Response, which is what `readErrorBody` unwraps to turn a 403
//      into a sentence. A tidier shape would break that silently.
//
// `@/integrations/supabase/client` does not resolve under Deno, which is why
// `invokeFunction` imports it lazily: the Railway path never reaches it and is
// tested here in full, with an injected fetch.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  invokeFunction, RAILWAY_SERVED_FUNCTIONS, resolveDestination,
} from "../../src/lib/agentoryApi.ts";
import { readErrorBody } from "../../src/lib/workbench/continuationErrors.ts";

const API = "https://api.agentory.app";

// ── where it goes ───────────────────────────────────────────────────────────

Deno.test("UNCONFIGURED: every call still goes to Supabase", () => {
  for (const name of [...RAILWAY_SERVED_FUNCTIONS, "firecrawl-scrape"]) {
    assertEquals(resolveDestination(name, {}).transport, "supabase");
    assertEquals(resolveDestination(name, { baseUrl: API }).transport, "supabase",
      "a base URL alone moves nothing — the list is what moves a function");
    assertEquals(resolveDestination(name, { functions: "*" }).transport, "supabase",
      "and a list with nowhere to send it moves nothing either");
  }
});

Deno.test("ONE AT A TIME, and the path matches what the server mounts", () => {
  const cfg = { baseUrl: API, functions: "pilot-chat" };
  assertEquals(resolveDestination("pilot-chat", cfg), {
    transport: "railway", name: "pilot-chat", url: `${API}/api/pilot-chat`,
  });
  assertEquals(resolveDestination("orchestrate", cfg).transport, "supabase");
});

Deno.test("a function the API cannot serve is never sent there", () => {
  const cfg = { baseUrl: API, functions: "*" };
  for (const name of ["firecrawl-scrape", "daily-brief", "run-lead-action", "continue-workflow"]) {
    assertEquals(resolveDestination(name, cfg).transport, "supabase", name);
  }
  for (const name of RAILWAY_SERVED_FUNCTIONS) {
    assertEquals(resolveDestination(name, cfg).transport, "railway", name);
  }
});

Deno.test("the frontend list matches the server's — the two ends of one switch", async () => {
  const server = await import("../../supabase/functions/_shared/functionEndpoints.ts");
  assertEquals([...RAILWAY_SERVED_FUNCTIONS], [...server.RAILWAY_SERVED_FUNCTIONS]);
  for (const name of RAILWAY_SERVED_FUNCTIONS) {
    const d = resolveDestination(name, { baseUrl: API, functions: "*" });
    assert(d.transport === "railway");
    assertEquals(d.url, `${API}${server.apiPathFor(name)}`, "the browser and the router agree on the path");
  }
});

// ── what it sends ───────────────────────────────────────────────────────────

const railway = { baseUrl: API, functions: "*" };

function fakeFetch(res: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetchImpl: ((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Promise.resolve(res());
    }) as unknown as typeof fetch,
  };
}

Deno.test("THE USER'S TOKEN AND NOTHING ELSE", async () => {
  const f = fakeFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const r = await invokeFunction("pilot-chat", { message: "hi", workspace_id: "w1" }, {
    config: railway, accessToken: () => Promise.resolve("user-jwt"), fetchImpl: f.fetchImpl,
  });
  assertEquals(r, { data: { ok: true }, error: null });
  assertEquals(f.calls[0].url, `${API}/api/pilot-chat`);
  const headers = f.calls[0].init.headers as Record<string, string>;
  assertEquals(headers.Authorization, "Bearer user-jwt");
  // NO SERVICE CREDENTIAL IS IN THIS BUNDLE, and none is sent. The server
  // derives the workspace and the user from the token, never from the body.
  const sent = JSON.stringify(f.calls[0].init.body);
  assert(!/service_role|sb_secret_/.test(sent));
  assertEquals(JSON.parse(f.calls[0].init.body as string), { message: "hi", workspace_id: "w1" });
  assertEquals(f.calls[0].init.method, "POST");
});

Deno.test("no session: the request is still made and refused by the server, as it is today", async () => {
  const f = fakeFetch(() => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
  const r = await invokeFunction("run-agent", {}, {
    config: railway, accessToken: () => Promise.resolve(null), fetchImpl: f.fetchImpl,
  });
  assert(r.error, "a 401 is an error, not silent success");
  assertEquals(r.data, null);
  // The decision belongs to the server; the client does not pre-judge it.
  assertEquals(f.calls.length, 1);
});

// ── what comes back ─────────────────────────────────────────────────────────

Deno.test("A NON-2XX CARRIES ITS BODY THROUGH `error.context` — the shape readErrorBody needs", async () => {
  const f = fakeFetch(() => new Response(
    JSON.stringify({ error: "already_continued", message: "nope" }),
    { status: 409, headers: { "content-type": "application/json", "x-request-id": "req-7" } },
  ));
  const r = await invokeFunction("run-agent", {}, {
    config: railway, accessToken: () => Promise.resolve("t"), fetchImpl: f.fetchImpl,
  });
  assertEquals(r.data, null);
  assertEquals(r.error?.message, "Edge Function returned a non-2xx status code",
    "the same message functions.invoke produces, so a call site reading it is unchanged");
  assert(r.error?.context instanceof Response);
  // THE POINT OF ALL OF IT: the existing unwrapper works on this untouched.
  assertEquals(await readErrorBody(r.error), {
    status: 409, code: "already_continued", message: "nope", requestId: "req-7",
  });
});

Deno.test("a transport failure is an error with no context, as the Supabase client reports it", async () => {
  const r = await invokeFunction("pilot-chat", {}, {
    config: railway,
    accessToken: () => Promise.resolve("t"),
    fetchImpl: (() => Promise.reject(new Error("Failed to fetch"))) as unknown as typeof fetch,
  });
  assertEquals(r.data, null);
  assertEquals(r.error?.message, "Failed to fetch");
  assertEquals(r.error?.context, undefined);
  assertEquals(await readErrorBody(r.error), { status: null, code: null, message: null, requestId: null });
});

Deno.test("a 2xx with an unreadable body is an error, never `data: null` read as success", async () => {
  const f = fakeFetch(() => new Response("<html>gateway</html>", { status: 200 }));
  const r = await invokeFunction("orchestrate", {}, {
    config: railway, accessToken: () => Promise.resolve("t"), fetchImpl: f.fetchImpl,
  });
  assertEquals(r.data, null);
  assert(r.error);
});
