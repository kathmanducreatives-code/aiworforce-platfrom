// WHY THIS FILE EXISTS.
//
// The lead workflow spends money on what this module returns: which Actors run,
// what JSON they receive, whether evidence qualifies a company. So the
// properties that matter are not "does it call the API" but "what does it do
// when the API does something unexpected", and "can a key ever escape".
//
// `aiProvider` — the shared module this deliberately is not — answers a failure
// by trying a different model. That is right for a chat reply and wrong here: a
// silent switch changes paid decisions and leaves no trace in the result.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  GPT_MODEL, gptAvailable, gptDiagnostics, gptStructured,
} from "../../../supabase/functions/_shared/gptProvider.ts";

const SCHEMA = { name: "t", schema: { type: "object", properties: {} } };
const REQ = { purpose: "test", system: "s", user: "u", schema: SCHEMA };
const KEY = () => "sk-test-not-a-real-key";

/** An OpenAI-shaped response whose content is `body`. */
const reply = (body: unknown, extra: Record<string, unknown> = {}) => ({
  ok: true, status: 200,
  text: () => Promise.resolve(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(body), ...extra } }],
  })),
});

Deno.test("1. a structured answer comes back typed", async () => {
  const r = await gptStructured<{ n: number }>(REQ, {
    readEnv: KEY, fetch: () => Promise.resolve(reply({ n: 7 })),
  });
  assert(r.ok);
  assertEquals(r.value.n, 7);
  assertEquals(r.model, GPT_MODEL);
});

Deno.test("2. a missing key fails; it does not degrade to another model", async () => {
  // The whole reason this module exists. `aiProvider` would reach for Anthropic
  // here and the run would continue on a different model, with different
  // judgement, invisibly.
  let called = false;
  const r = await gptStructured(REQ, {
    readEnv: () => undefined,
    fetch: () => { called = true; return Promise.resolve(reply({})); },
  });
  assert(!r.ok);
  assertEquals(r.code, "no_api_key");
  assertEquals(called, false, "no call may be attempted without a key");
});

Deno.test("3. the API key never appears in any result", async () => {
  // An error path that echoes its own credential is how keys reach log
  // aggregators. Every failure string here is persisted into a task result.
  const secret = "sk-proj-SUPERSECRETVALUE";
  const cases = [
    () => Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve(`bad key ${secret}`) }),
    () => Promise.reject(new Error(`connect failed for ${secret}`)),
    () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("not json") }),
  ];
  for (const f of cases) {
    const r = await gptStructured(REQ, { readEnv: () => secret, fetch: f as never });
    const serialised = JSON.stringify(r) + JSON.stringify(gptDiagnostics("p", r));
    assertEquals(serialised.includes(secret), false, "the key leaked into a result");
  }
});

Deno.test("4. an HTTP error is a value, never a throw", async () => {
  // Callers are pipeline stages. An exception thrown through them abandons a
  // run that has already paid for discovery.
  const r = await gptStructured(REQ, {
    readEnv: KEY,
    fetch: () => Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve("rate limited") }),
  });
  assert(!r.ok);
  assertEquals(r.code, "http_error");
  assert(r.detail.includes("429"));
});

Deno.test("5. a transport failure is a value too", async () => {
  const r = await gptStructured(REQ, {
    readEnv: KEY, fetch: () => Promise.reject(new Error("dns")),
  });
  assert(!r.ok);
  assertEquals(r.code, "transport_error");
});

Deno.test("6. a refusal is distinguished from a failure", async () => {
  // The model declining and the model breaking are different outcomes. One is
  // worth retrying with a different prompt; the other is not.
  const r = await gptStructured(REQ, {
    readEnv: KEY,
    fetch: () => Promise.resolve({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({
        choices: [{ message: { content: null, refusal: "I can't help with that" } }],
      })),
    }),
  });
  assert(!r.ok);
  assertEquals(r.code, "schema_refused");
});

Deno.test("7. empty and unparseable content are separate codes", async () => {
  const empty = await gptStructured(REQ, {
    readEnv: KEY,
    fetch: () => Promise.resolve({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: "  " } }] })),
    }),
  });
  assert(!empty.ok); assertEquals(empty.code, "empty_response");

  const bad = await gptStructured(REQ, {
    readEnv: KEY,
    fetch: () => Promise.resolve({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: "{oops" } }] })),
    }),
  });
  assert(!bad.ok); assertEquals(bad.code, "unparseable_json");
});

Deno.test("8. the request asks for a strict schema and deterministic output", async () => {
  // `strict` is what removes "the model answered in prose today" as a failure
  // mode. Temperature 0 is what makes a paid decision reproducible.
  let body: Record<string, unknown> = {};
  await gptStructured(REQ, {
    readEnv: KEY,
    fetch: (_u, init) => {
      body = JSON.parse(String(init.body));
      return Promise.resolve(reply({}));
    },
  });
  assertEquals(body.temperature, 0);
  assertEquals(body.model, GPT_MODEL);
  const rf = body.response_format as { type: string; json_schema: { strict: boolean } };
  assertEquals(rf.type, "json_schema");
  assertEquals(rf.json_schema.strict, true);
});

Deno.test("9. the key is sent as a bearer header and nowhere else", async () => {
  let init: RequestInit = {};
  await gptStructured(REQ, {
    readEnv: () => "sk-abc", fetch: (_u, i) => { init = i; return Promise.resolve(reply({})); },
  });
  const headers = init.headers as Record<string, string>;
  assertEquals(headers.Authorization, "Bearer sk-abc");
  assertEquals(String(init.body).includes("sk-abc"), false, "the key must not be in the body");
});

Deno.test("10. availability is a preflight answer, not a routing decision", async () => {
  assertEquals(gptAvailable(() => "sk-x"), true);
  assertEquals(gptAvailable(() => undefined), false);
  assertEquals(gptAvailable(() => ""), false);
});

Deno.test("11. diagnostics record the outcome without the payload", async () => {
  const ok = await gptStructured<{ a: 1 }>(REQ, {
    readEnv: KEY, fetch: () => Promise.resolve(reply({ a: 1 })), now: () => 0,
  });
  const d = gptDiagnostics("discovery", ok);
  assertEquals(d.provider, "openai");
  assertEquals(d.ok, true);
  assertEquals("value" in d, false, "the model's answer must not ride into the record");

  const bad = await gptStructured(REQ, { readEnv: () => undefined });
  const db = gptDiagnostics("discovery", bad);
  assertEquals(db.ok, false);
  assertEquals(db.failure_code, "no_api_key");
});

Deno.test("12. no lead-path module reaches the shared multi-provider layer", async () => {
  // THE ARCHITECTURAL ASSERTION. `aiProvider` fans out across a Gemini gateway
  // and Anthropic with automatic fallback. If a lead module ever imports it, a
  // paid sourcing decision can silently change model mid-run — which is the
  // failure this whole module was created to make impossible.
  const base = new URL("../../../supabase/functions/_shared/", import.meta.url);
  for (const f of ["gptProvider.ts", "gptDiscoveryPlanner.ts"]) {
    const src = await Deno.readTextFile(new URL(f, base));
    assertEquals(
      /from "\.\/aiProvider\.ts"/.test(src), false,
      `${f} must not import aiProvider — GPT answers or the stage fails`,
    );
    assertEquals(/anthropic|lovable/i.test(src.replace(/\/\/.*$/gm, "")), false,
      `${f} must name no other provider outside comments`);
  }
});
