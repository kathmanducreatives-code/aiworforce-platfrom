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
import { REST_URL, mintJwt } from "../db-contract/lib/harness.ts";
import { runBrainAcceptance } from "../../scripts/test-project/brain-test/acceptance.ts";

const [draftHandler, memoryHandler] = captured;
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
  for (const [fn, h] of [["generate-company-brain-draft", draftHandler], ["company-brain-memory", memoryHandler]] as const) {
    if (url.pathname.startsWith(`/functions/v1/${fn}`)) {
      const text = await req.text();
      const res = await h(new Request(req.url, { method: req.method, headers: req.headers, body: text || undefined }));
      try { calls.push(`${fn}:${JSON.parse(text).action}:${res.status}`); } catch { /* preflight */ }
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
  assert(calls.every((c) => !c.includes("pilot-chat")), "no model call: ORION chat is opt-in");
});
