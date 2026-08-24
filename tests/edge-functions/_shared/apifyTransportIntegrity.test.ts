// THE ASSERTION IS ON THE HTTP BODY, NOT THE ENVELOPE.
//
// Runs rWikfnKgnp5DazDYr and eGzD7gzJNGFm4c4IZ both looked correct at every
// recorded layer — preflight, envelope and `tool_calls.input_json` were
// md5-identical to the intended Companies-mode payload — and both sent `{}` to
// Apify, which substituted its schema defaults and ran a Jobs-mode scrape.
//
// The cause was a two-sided contract validated on one side only: run-agent wrote
// `user_input`, `runTool` reads `i.input`, and `user_input` exists in that file
// only as a parameter name inside input_adapter callbacks. My earlier regression
// test asserted the SENDER's shape and never asserted the receiver reads that
// key, so it passed while the payload was being dropped.
//
// Every test below therefore mocks `fetch` and inspects the serialized request
// body actually handed to the Apify Actor-run endpoint.
//
// ZERO real network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runTool } from "../../../supabase/functions/_shared/toolRegistry.ts";
import { hashInput } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { compileFirstProviderCall } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";

// `runTool` reads the token INSIDE the call, so setting it here is enough and
// keeps these tests runnable under the suite's own flags. The value is a stub —
// every request is intercepted by the fetch mock and never leaves the process.
Deno.env.set("APIFY_API_TOKEN", "test-token-not-a-real-credential");

const CANONICAL =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";

/** The exact body this mission must put on the wire. */
const EXPECTED_BODY = {
  mode: "companies",
  queries: [],
  topCompany: false,
  isHiring: true,
  nonprofit: false,
  batch: ["All Batches"],
  industries: ["B2B"],
  regions: ["United States of America"],
  minEmployeeSize: "10+",
  maxEmployeeSize: "500",
  scrapeFounderDetails: false,
  scrapeOpenJobs: true,
  enrichEmails: false,
  maxItems: 50,
};

/** Order-independent structural comparison. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

interface Captured {
  url: string;
  method: string;
  contentType: string | null;
  rawBody: string | null;
  body: unknown;
}

/**
 * Install a fetch mock that records every Apify request and answers a completed
 * run. Returns the capture log and a restore function.
 */
function captureApify(): { calls: Captured[]; restore: () => void } {
  const calls: Captured[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const rawBody = typeof init?.body === "string" ? init.body : null;
    const headers = new Headers(init?.headers ?? {});
    calls.push({
      url,
      method: String(init?.method ?? "GET"),
      contentType: headers.get("Content-Type"),
      rawBody,
      body: rawBody ? JSON.parse(rawBody) : null,
    });
    // Actor start -> a SUCCEEDED run with an empty dataset.
    if (url.includes("/runs")) {
      return Promise.resolve(new Response(JSON.stringify({
        data: { id: "MOCKRUN1", defaultDatasetId: "MOCKDS1", status: "SUCCEEDED" },
      }), { status: 201, headers: { "Content-Type": "application/json" } }));
    }
    if (url.includes("/actor-runs/")) {
      return Promise.resolve(new Response(JSON.stringify({
        data: { id: "MOCKRUN1", defaultDatasetId: "MOCKDS1", status: "SUCCEEDED" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response("[]", {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

/**
 * A minimal ToolContext that passes the agent gate.
 *
 * `admin` is a chainable no-op: `logToolCall` writes and re-reads rows, and
 * these tests assert on the HTTP boundary, not on persistence. Every builder
 * method returns the same thenable, so any call chain resolves harmlessly.
 */
function noopQuery(): unknown {
  const q: Record<string, unknown> = {};
  const ret = () => q;
  for (const m of [
    "select", "insert", "update", "upsert", "delete", "eq", "in", "is", "not",
    "order", "limit", "match", "filter", "single", "maybeSingle", "range",
  ]) q[m] = ret;
  (q as { then: unknown }).then = (res: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(res);
  return q;
}

const CTX = {
  workspace_id: "00000000-0000-0000-0000-000000000001",
  agent_slug: "scout",
  agent_id: null,
  admin: { from: () => noopQuery() },
} as never;

/** The envelope run-agent builds, with the CANONICAL key. */
function envelope(over: Record<string, unknown> = {}) {
  return {
    selected_actor_key: "apify_yc_companies_memo23",
    actor_id: "memo23/y-combinator-scraper",
    compiled_actor_input: true,
    capability_key: "apify_yc_companies_memo23",
    input: { ...EXPECTED_BODY },
    compiled_input_hash: hashInput(EXPECTED_BODY),
    ...over,
  };
}

const startCalls = (c: Captured[]) => c.filter((x) => x.method === "POST" && x.url.includes("/runs"));

// ═══════════════════ 1. the sender writes the key the receiver reads ══

Deno.test("1. run-agent writes `input` — the key toolRegistry actually reads", async () => {
  const runAgent = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  const registry = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/toolRegistry.ts", import.meta.url));

  assert(registry.includes("const userInput = (i.input && typeof i.input === \"object\")"),
    "the receiver reads i.input");
  // ── THE ENVELOPE MOVED; THE CONTRACT DID NOT ────────────────────────────
  //
  // This counted two inline copies in run-agent — one for the capability engine
  // and one for the company-first route, byte for byte identical. Both now call
  // the shared seam, so the assertion follows the code rather than pinning a
  // duplication that a third caller (monitoring) would have made a triplication.
  const seam = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/capabilityExecution.ts", import.meta.url));
  assert(seam.includes("input: call.input as Record<string, unknown>,"),
    "the seam must send the canonical `input` key");
  assert(seam.includes("compiled_input_hash: call.inputHash,"),
    "the seam must carry the integrity hash");
  assert(seam.includes("compiled_actor_input: true,"),
    "without this flag runTool never takes the passthrough branch at all");
  assertFalse(seam.includes("user_input: call.input"),
    "the user_input key is the defect and must not return");

  // AND run-agent MUST NOT have grown its own copy back. A re-inlined envelope
  // is how the two would drift apart again.
  assertEquals((runAgent.match(/compiled_actor_input: true,/g) ?? []).length, 0,
    "run-agent must build no envelope of its own — it calls the seam");
  assertEquals((runAgent.match(/invoke: capabilityInvoke,/g) ?? []).length, 2,
    "both engine call sites must use the shared invoker");
});

// ═══════════════════════ 2. the captured HTTP body is the compiled input ══

Deno.test("2. the captured HTTP body equals the preflight input, byte for byte", async () => {
  const cap = captureApify();
  try {
    // The SAME compiler the preflight uses.
    const plan = buildCapabilityGraph(parseLeadMissionDeterministic(CANONICAL));
    const { compiled } = compileFirstProviderCall(plan, { maxCandidates: 50 });
    assert(compiled?.ok);
    if (!compiled?.ok) return;

    await runTool("source_with_apify", envelope({
      input: compiled.input as Record<string, unknown>,
      compiled_input_hash: compiled.inputHash,
    }), CTX);

    const starts = startCalls(cap.calls);
    assertEquals(starts.length, 1, "exactly one Actor start");
    const req = starts[0];

    assertEquals(req.method, "POST");
    assert(req.url.startsWith("https://api.apify.com/v2/acts/memo23~y-combinator-scraper/runs"),
      `wrong endpoint: ${req.url}`);
    assertEquals(req.contentType, "application/json");

    // THE ASSERTION THAT MATTERS.
    assertEquals(canonical(req.body), canonical(EXPECTED_BODY));
    assertEquals(canonical(req.body), canonical(compiled.input));
    assertFalse(req.rawBody === "{}", "an empty body is what caused both bad runs");
    assertEquals((req.body as Record<string, unknown>).mode, "companies");
    assertEquals((req.body as Record<string, unknown>).regions, ["United States of America"]);
  } finally { cap.restore(); }
});

// ══════════════════════════════════ 3/4. fail closed before any fetch ══

Deno.test("3. a compiled invocation with NO input fails before fetch", async () => {
  const cap = captureApify();
  try {
    const env = envelope();
    delete (env as Record<string, unknown>).input;
    const r = await runTool("source_with_apify", env, CTX);

    assertFalse(r.ok);
    assertEquals(r.error, "compiled_input_missing");
    assertEquals(startCalls(cap.calls).length, 0, "no Actor may be started");
  } finally { cap.restore(); }
});

Deno.test("4. a compiled invocation with an EMPTY input fails before fetch", async () => {
  const cap = captureApify();
  try {
    // This is precisely what runs rWikfnKgnp5DazDYr and eGzD7gzJNGFm4c4IZ sent.
    const r = await runTool("source_with_apify", envelope({ input: {} }), CTX);

    assertFalse(r.ok);
    assertEquals(r.error, "compiled_input_missing");
    assertEquals(startCalls(cap.calls).length, 0,
      "Apify must never be given {} for a compiled invocation");
  } finally { cap.restore(); }
});

Deno.test("4b. the OLD defective envelope now fails instead of sending {}", async () => {
  const cap = captureApify();
  try {
    // Verbatim the shape that produced both bad runs: payload under user_input.
    const env = envelope();
    delete (env as Record<string, unknown>).input;
    (env as Record<string, unknown>).user_input = { ...EXPECTED_BODY };

    const r = await runTool("source_with_apify", env, CTX);
    assertFalse(r.ok, "the old envelope must no longer reach Apify");
    assertEquals(r.error, "compiled_input_missing");
    assertEquals(startCalls(cap.calls).length, 0);
  } finally { cap.restore(); }
});

// ═══════════════════════════════════════ 5. hash mismatch fails closed ══

Deno.test("5. a hash mismatch fails before fetch and records both hashes", async () => {
  const cap = captureApify();
  try {
    const r = await runTool("source_with_apify", envelope({
      compiled_input_hash: "deadbeef",      // not the hash of the payload
    }), CTX);

    assertFalse(r.ok);
    assertEquals(r.error, "compiled_input_hash_mismatch");
    const d = r.data as Record<string, unknown>;
    assertEquals(d.expected_hash, "deadbeef");
    assertEquals(d.outbound_hash, hashInput(EXPECTED_BODY));
    assertEquals(d.capability, "apify_yc_companies_memo23");
    assertEquals(startCalls(cap.calls).length, 0, "no provider call on a mismatch");
  } finally { cap.restore(); }
});

Deno.test("5b. a matching hash is accepted and the run proceeds", async () => {
  const cap = captureApify();
  try {
    const r = await runTool("source_with_apify", envelope(), CTX);
    assertEquals(startCalls(cap.calls).length, 1, "a proven payload is allowed through");
    assert(r.ok || r.error !== "compiled_input_hash_mismatch");
  } finally { cap.restore(); }
});

// ══════════════════════ 6. Actor defaults can never substitute ══

Deno.test("6. Actor schema defaults cannot stand in for a compiled input", async () => {
  const cap = captureApify();
  try {
    await runTool("source_with_apify", envelope(), CTX);
    const body = startCalls(cap.calls)[0].body as Record<string, unknown>;

    // The Jobs-mode default signature must be absent.
    assertFalse(body.mode === "jobs");
    assertFalse(JSON.stringify(body.regions) === JSON.stringify(["Anywhere"]));
    assertFalse(JSON.stringify(body.industries) === JSON.stringify(["All industries"]));
    assertEquals(body.isHiring, true);
    assertEquals(body.scrapeOpenJobs, true);
    assertEquals(body.maxItems, 50);
    // Fields the Actor injects itself must never come from us.
    for (const injected of ["monitoringMode", "maxConcurrency", "minConcurrency",
      "maxRequestRetries", "proxy", "startUrls", "role", "location"]) {
      assertFalse(injected in body, `${injected} is an Actor default, not our field`);
    }
  } finally { cap.restore(); }
});

// ══════════════════ 7/8. no results after a transport failure; resume ══

Deno.test("7. a transport-integrity failure returns no items to persist", async () => {
  const cap = captureApify();
  try {
    for (const bad of [{ input: {} }, { compiled_input_hash: "deadbeef" }]) {
      const r = await runTool("source_with_apify", envelope(bad), CTX);
      assertFalse(r.ok);
      const items = (r.data as { items?: unknown[] } | undefined)?.items;
      assert(items === undefined || (Array.isArray(items) && items.length === 0),
        "a blocked call must yield nothing that could be persisted or displayed");
    }
    assertEquals(startCalls(cap.calls).length, 0);
  } finally { cap.restore(); }
});

Deno.test("8. the resume path uses the same canonical contract and starts nothing", async () => {
  const cap = captureApify();
  try {
    await runTool("source_with_apify", envelope({ resume_run_id: "rWikfnKgnp5DazDYr" }), CTX);

    // A resume READS the run; it must never POST a new one.
    assertEquals(startCalls(cap.calls).length, 0, "resume must not start an Actor");
    const reads = cap.calls.filter((c) => c.url.includes("/actor-runs/rWikfnKgnp5DazDYr"));
    assert(reads.length > 0, "the existing run must be read by id");
    assertEquals(reads[0].method, "GET");

    // And the shared seam forwards the same canonical key on the resume site.
    // It moved out of run-agent, where it was written twice; both Lead routes
    // and monitoring now inherit one implementation.
    const seamSrc = await Deno.readTextFile(
      new URL("../../../supabase/functions/_shared/capabilityExecution.ts", import.meta.url));
    assert(seamSrc.includes("resume_run_id: resumeRunId"));
  } finally { cap.restore(); }
});
