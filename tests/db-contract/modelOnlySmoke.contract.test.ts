// THE FIRST REAL-GPT STEP, REHEARSED OFFLINE: a smoke whose actors are each
// allowed ZERO starts. Real GPT may compile and plan the mission; the gate
// refuses every Apify start before it is sent. This pins what that hosted step
// can and cannot spend, with the model scripted.
//
// (A model-template-only authorization does NOT work: with no approved actor
// the planner's prompt shows the whole actor playbook, exceeds the Luna
// template's 30 KB request bound, and is refused before it is sent.)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sql } from "./lib/harness.ts";
import { runScenario } from "./lib/discoveryScenario.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test("model-only smoke: real-model stages run, no provider request is ever sent, model spend stays inside $0.05, no credit is kept", opts, async () => {
  const r = await runScenario({ label: "model-only", modelOnly: true });
  const apify = r.trace.requests.filter((q: { host: string }) => q.host === "api.apify.com");
  assertEquals(apify, [], "no request reached Apify");
  assertEquals(r.of("provider"), [], "no provider operation was admitted");
  assertEquals(r.of("poll"), []);
  const models = r.of("model");
  assert(models.length >= 1 && models.length <= 4, `model attempts admitted: ${models.length}`);
  const modelMicro = models.reduce((a, o) => a + Number(o.committed_microusd), 0);
  assert(modelMicro <= 50_000, `model spend committed ${modelMicro} µUSD ≤ $0.05`);
  assert(r.refused.length > 0 && r.refused.every((d) => d === "actor_limit" || d === "usd_limit"),
    `every provider request refused before sending: ${JSON.stringify(r.refused)}`);
  // Credits: a refused start is a definite non-start, refunded whole; nothing stays held.
  const [b] = await sql`select balance_credits, reserved_credits from public.workspace_credit_balances where workspace_id = ${r.m.ws}`;
  assertEquals([b.balance_credits, b.reserved_credits], [10, 0]);
  assertEquals(r.outcome.qualified, [], "nothing qualifies without evidence");
  assertEquals(r.leads.length, 0, "nothing persisted");
  assert(r.outcome.terminal.length === 1, `one terminal verdict: ${JSON.stringify(r.outcome)}`);
});
