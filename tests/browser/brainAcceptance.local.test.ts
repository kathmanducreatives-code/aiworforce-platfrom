// The hosted acceptance suite (scripts/test-project/brain-test/acceptance.ts),
// proven against a LOCAL stand-in for a Supabase project before anyone points it
// at a real one:
//
//   POSTGREST_BIN=… tests/db-contract/run-with-gotrue.sh tests/browser/brainAcceptance.local.test.ts
//
// Real GoTrue (admin user creation, password sign-in with real sessions), real
// PostgREST over the full schema (baseline + migrations + held Brain chain), and
// the ACTUAL generate-company-brain-draft and company-brain-memory handlers,
// behind one gateway that answers /auth/v1, /rest/v1 and /functions/v1 exactly
// as a Supabase project does. No model or provider is called. Fictional data.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { captured, restoreServe } from "../db-contract/lib/captureServe.ts";
import "../../supabase/functions/generate-company-brain-draft/index.ts";
import "../../supabase/functions/company-brain-memory/index.ts";
import "../../supabase/functions/pilot-chat/index.ts";
import { REST_URL, mintJwt } from "../db-contract/lib/harness.ts";
import { runBrainAcceptance } from "../../scripts/test-project/brain-test/acceptance.ts";

const [draftHandler, memoryHandler, chatHandler] = captured;
restoreServe();
const AUTH_URL = Deno.env.get("BRAIN_E2E_AUTH_URL");
if (!AUTH_URL) throw new Error("run through tests/db-contract/run-with-gotrue.sh (real GoTrue)");
const opts = { sanitizeResources: false, sanitizeOps: false };

const port = 20000 + Math.floor(Math.random() * 20000);
const GATEWAY = `http://127.0.0.1:${port}`;
const anonKey = await mintJwt("anon");
const serviceKey = await mintJwt("service_role");
Deno.env.set("SUPABASE_URL", GATEWAY);
Deno.env.set("SUPABASE_ANON_KEY", anonKey);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", serviceKey);
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "APIFY_API_TOKEN", "FIRECRAWL_API_KEY", "LOVABLE_API_KEY"]) Deno.env.delete(k);
const calls: string[] = [];
Deno.serve({ hostname: "127.0.0.1", port, onListen() {} }, async (req) => {
  const url = new URL(req.url);
  for (const [fn, h] of [["generate-company-brain-draft", draftHandler], ["company-brain-memory", memoryHandler], ["pilot-chat", chatHandler]] as const) {
    if (url.pathname.startsWith(`/functions/v1/${fn}`)) {
      const text = await req.text();
      const res = await h(new Request(req.url, { method: req.method, headers: req.headers, body: text || undefined }));
      try { calls.push(`${fn}:${JSON.parse(text).action ?? "chat"}:${res.status}`); } catch { /* preflight */ }
      return res;
    }
  }
  if (url.pathname.startsWith("/functions/v1/")) return new Response(JSON.stringify({ error: "not deployed here" }), { status: 404 });
  if (url.pathname.startsWith("/auth/v1/")) return fetch(new Request(AUTH_URL + url.pathname.slice("/auth/v1".length) + url.search, req));
  if (url.pathname.startsWith("/rest/v1/")) return fetch(new Request(REST_URL + url.pathname.slice("/rest/v1".length) + url.search, req));
  return new Response("not found", { status: 404 });
});

Deno.test("the hosted acceptance suite passes end to end against a real-auth, real-schema stand-in", opts, async () => {
  const lines: string[] = [];
  const report = await runBrainAcceptance({ url: GATEWAY, anonKey, serviceKey, log: (l) => lines.push(l) });
  console.log(lines.join("\n"));
  console.log(JSON.stringify({ notes: report.notes, calls }));
  assertEquals(report.checks.filter((c) => !c.ok).map((c) => `${c.id} ${c.detail}`), []);
  // Every area ran: none was silently skipped by a missing deployment.
  for (const area of ["profile completion", "ICP conflicts", "research suggestions", "provenance", "Teach Agentory", "ORION memory", "shared context", "isolation & roles"]) {
    assert(report.checks.some((c) => c.area === area), `area ran: ${area}`);
  }
  assert(report.passed >= 35, `${report.passed} checks passed`);
  assertEquals(report.notes.filter((n) => !n.startsWith("A6.9")), [], "no capability reported missing on the full local stack");
  assert(calls.every((c) => !c.startsWith("pilot-chat")), "no model call: ORION chat is opt-in");
});

// The opt-in real-chat path (A6.9–A6.13), proven WITHOUT a model: the actual
// pilot-chat handler runs behind the same gateway, and OpenAI is a scripted
// stand-in that answers every request with a priced, token-counted completion.
// It proves the two turns, the approval → new-conversation Brain context, and
// the ledger-based spend check, so the hosted run spends only what it must.
async function withScriptedModel<T>(body: (modelCalls: string[]) => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  const modelCalls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    if (u.hostname === "api.openai.com") {
      modelCalls.push(u.pathname);
      return new Response(JSON.stringify({
        id: "chatcmpl-scripted", object: "chat.completion", model: "gpt-4o-mini",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Understood. I will avoid crypto companies." } }],
        usage: { prompt_tokens: 400, completion_tokens: 20, total_tokens: 420 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") throw new Error(`forbidden call: ${u.hostname}`);
    return realFetch(input, init);
  }) as typeof fetch;
  const env = { OPENAI_API_KEY: "sk-scripted-not-a-key", MODEL_SPEND_CEILING_USD: "0.10", MODEL_SPEND_PERIOD_DAYS: "1", AGENTORY_DELEGATION_ENABLED: "false" };
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  try { return await body(modelCalls); } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(env)) Deno.env.delete(k);
  }
}

Deno.test("the spend check is real: a limit below what the run spent FAILS A6.13, and only A6.13", opts, async () => {
  const report = await withScriptedModel(() => runBrainAcceptance({ url: GATEWAY, anonKey, serviceKey, allowOrionChat: true, maxUsd: 0.00001, log: () => {} }));
  assertEquals(report.checks.filter((c) => !c.ok).map((c) => c.id), ["A6.13"]);
});

Deno.test("the opt-in ORION chat checks pass against the real pilot-chat with a scripted model, within the limit", opts, async () => {
  await withScriptedModel(async (modelCalls) => {
    const lines: string[] = [];
    const report = await runBrainAcceptance({ url: GATEWAY, anonKey, serviceKey, allowOrionChat: true, maxUsd: 0.10, log: (l) => lines.push(l) });
    console.log(lines.filter((l) => l.includes("A6.")).join("\n"));
    console.log(JSON.stringify({ notes: report.notes, modelCalls: modelCalls.length }));
    assertEquals(report.checks.filter((c) => !c.ok).map((c) => `${c.id} ${c.detail}`), []);
    for (const id of ["A6.9", "A6.10", "A6.11", "A6.12", "A6.13"]) assert(report.checks.some((c) => c.id === id && c.ok), `${id} ran and passed`);
    assertEquals(modelCalls.length, 2, "exactly two model calls: one per turn");
  });
});
