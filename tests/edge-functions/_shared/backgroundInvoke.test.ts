// THE STALL THIS FILE PINS.
//
// Three consecutive live runs (2026-08-17 10:21, 10:39, 10:49) created a plan,
// wrote `plan_created`, and then did nothing at all: no task row, no signal, no
// step event, `updated_at` never once moving off `created_at`. The plan sat in
// `executing` and the UI showed "Pilot is preparing the workflow…" forever.
//
// The cause was two bugs sharing three lines of `orchestrate`: a floating
// `fetch` the runtime may drop when the handler returns, and a `.catch()` that
// cannot observe an HTTP error status. Tests 1–2 cover the first, 3–5 the
// second — and 3 is the one that matters most, because a 500 from run-agent was
// as invisible as a request that was never sent.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  describeFailure,
  invokeInBackground,
  keepIsolateAlive,
  type InvokeFailure,
} from "../../../supabase/functions/_shared/backgroundInvoke.ts";

const okResponse = () => new Response("{}", { status: 200 });

Deno.test("1. the call is registered with the runtime, not left floating", async () => {
  // The whole point. A promise the runtime does not know about dies with the
  // isolate, and the user is left with a plan that never moves.
  const registered: Promise<unknown>[] = [];
  const runtime = { waitUntil: (p: Promise<unknown>) => void registered.push(p) };

  await invokeInBackground({
    url: "https://example.test/functions/v1/run-agent",
    token: "t",
    body: { plan_id: "p1" },
    onFailure: () => {},
    fetchImpl: () => Promise.resolve(okResponse()),
    runtime,
  });

  assertEquals(registered.length, 1, "the promise must be handed to waitUntil");
});

Deno.test("2. a runtime without waitUntil still runs the call", () => {
  // `deno test` has no EdgeRuntime, and a platform that drops the API must not
  // take down a request that would otherwise succeed. Degrade, never throw.
  assertEquals(keepIsolateAlive(Promise.resolve(), undefined), false);
  assertEquals(keepIsolateAlive(Promise.resolve(), {}), false);
  // A runtime whose waitUntil throws is still not allowed to break the caller.
  assertEquals(
    keepIsolateAlive(Promise.resolve(), {
      waitUntil: () => { throw new Error("refused"); },
    }),
    false,
    "a throwing waitUntil must be swallowed, not propagated",
  );
});

Deno.test("3. an HTTP error status is reported — the case .catch() never saw", async () => {
  // THE CENTRAL REGRESSION. `fetch(...).catch(...)` does not fire for a 500;
  // the promise RESOLVES. So a rejected handoff and a successful one were
  // indistinguishable, and the plan stayed `executing` either way.
  const seen: InvokeFailure[] = [];
  await invokeInBackground({
    url: "https://example.test/x",
    token: "t",
    body: {},
    onFailure: (f) => void seen.push(f),
    fetchImpl: () => Promise.resolve(new Response("boom", { status: 500 })),
    runtime: undefined,
  });

  assertEquals(seen.length, 1, "a 500 must reach onFailure");
  assertEquals(seen[0].code, "http_error");
  assert(seen[0].code === "http_error" && seen[0].status === 500);
  assert(
    seen[0].code === "http_error" && seen[0].detail.includes("boom"),
    "the response body is the only clue to WHY, so it must be carried through",
  );
});

Deno.test("4. a transport failure is reported too", async () => {
  const seen: InvokeFailure[] = [];
  await invokeInBackground({
    url: "https://example.test/x",
    token: "t",
    body: {},
    onFailure: (f) => void seen.push(f),
    fetchImpl: () => Promise.reject(new Error("dns")),
  });
  assertEquals(seen.length, 1);
  assertEquals(seen[0].code, "transport_error");
  assert(seen[0].detail.includes("dns"));
});

Deno.test("5. success calls nothing — a healthy run stays quiet", async () => {
  // The bookkeeping write must not fire on the happy path, or every successful
  // handoff would mark its own plan failed.
  let calls = 0;
  await invokeInBackground({
    url: "https://example.test/x",
    token: "t",
    body: {},
    onFailure: () => { calls++; },
    fetchImpl: () => Promise.resolve(okResponse()),
  });
  assertEquals(calls, 0);
});

Deno.test("6. a throwing failure handler cannot take the isolate down", async () => {
  // `onFailure` writes to the database, which can itself fail. An unhandled
  // rejection here would turn a recoverable stall into a dead isolate.
  let threw = false;
  try {
    await invokeInBackground({
      url: "https://example.test/x",
      token: "t",
      body: {},
      onFailure: () => { throw new Error("db down"); },
      fetchImpl: () => Promise.resolve(new Response("", { status: 503 })),
    });
  } catch {
    threw = true;
  }
  assertEquals(threw, false, "invokeInBackground must never reject");
});

Deno.test("7. the request carries the auth header and a JSON body", async () => {
  // The callee has verify_jwt enabled; a handoff without this header is a 401
  // that used to be silent.
  let init: RequestInit | undefined;
  await invokeInBackground({
    url: "https://example.test/x",
    token: "secret-token",
    body: { plan_id: "p1", step_index: 0 },
    onFailure: () => {},
    fetchImpl: (_u, i) => { init = i; return Promise.resolve(okResponse()); },
  });

  const headers = init?.headers as Record<string, string>;
  assertEquals(headers["Authorization"], "Bearer secret-token");
  assertEquals(headers["Content-Type"], "application/json");
  assertEquals(init?.method, "POST");
  assertEquals(JSON.parse(String(init?.body)).plan_id, "p1");
});

Deno.test("8. failures describe themselves in one readable line", () => {
  // This string is persisted on the activity row and is what the user reads
  // when a workflow refuses to start.
  assert(
    describeFailure({ code: "http_error", status: 401, detail: "Invalid JWT" })
      .includes("401"),
  );
  assert(
    describeFailure({ code: "transport_error", detail: "dns" })
      .includes("could not be sent"),
  );
});
