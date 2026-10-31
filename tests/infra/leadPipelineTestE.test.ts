import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { approvalsFor, approvalString, ERefusal, loGuard, testEIcp } from "../../scripts/lead-pipeline-test-e.ts";
import { compileIcp } from "../../supabase/functions/_shared/leadPipeline/icp.ts";
import { planDiscovery } from "../../supabase/functions/_shared/discoveryProviders/routing.ts";
import { worstCase } from "../../supabase/functions/_shared/leadPipeline/pipeline.ts";
import { leadOceanAdapter } from "../../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";

const ok = () => Promise.resolve(new Response(JSON.stringify({ success: true, data: [], meta: { credits: 0, nextCursor: null } }), { status: 200 }));
const conns = [{ provider: "leadocean" as const, connected: true, enabled: true, commercialTermsConfirmed: true, remainingCredits: null, recentFailures: 0 }];

Deno.test("test E: worst case and approval string are exact", () => {
  const plan = planDiscovery({ requirements: compileIcp(testEIcp("a")).requirements, connections: conns, selection: ["leadocean"], limits: { overfetch: 1 } });
  const w = worstCase(plan, { ...approvalsFor(), discovery: null });
  assertEquals(approvalString(w), "leadocean=15,apify_usd=0.18");
});

Deno.test("test E: the search body is the ICP narrowing with hasPhone, 10 rows, no reveal", async () => {
  const bodies: Record<string, unknown>[] = [];
  const g = loGuard((u, i) => { bodies.push(JSON.parse(i.body ?? "{}")); return ok(); }, { maxPages: 1, pageSize: 10, lookups: 5 });
  const req = compileIcp(testEIcp("a")).requirements;
  const plan = planDiscovery({ requirements: req, connections: conns, selection: ["leadocean"], limits: { overfetch: 1 } });
  await leadOceanAdapter({ apiKey: "x", fetch: g.fetch }).search(plan.steps[0], req, null, 10);
  const b = bodies[0];
  assertEquals([b.limit, b.hasPhone, b.reveal_email ?? false], [10, true, false]);
  assertEquals(b.hqCountry, ["US"]);
  assert(Array.isArray(b.industry) && Array.isArray(b.seniority));
  // A second page is refused by the guard before it is sent (the adapter surfaces it as a provider error).
  await assertRejects(() => leadOceanAdapter({ apiKey: "x", fetch: g.fetch }).search(plan.steps[0], req, "c2", 10));
  assertEquals(bodies.length, 1);
  console.log(JSON.stringify(b));
});

Deno.test("test E guard: other paths, hosts, repeats and extra lookups are refused before sending", async () => {
  let sent = 0;
  const g = loGuard(() => { sent++; return ok(); }, { maxPages: 1, pageSize: 10, lookups: 1 });
  const post = (p: string, body: unknown) => g.fetch(`https://api.leadocean.io${p}`, { method: "POST", headers: {}, body: JSON.stringify(body) });
  await assertRejects(() => post("/v1/enrich", { person_id: "1" }), ERefusal);
  await assertRejects(() => post("/v1/export", {}), ERefusal);
  await assertRejects(() => g.fetch("https://evil.example/v1/search", { method: "POST", headers: {} }), ERefusal);
  await post("/v2/people/phone", { person_id: "1" });
  await assertRejects(() => post("/v2/people/phone", { person_id: "1" }), ERefusal, "already sent");
  await assertRejects(() => post("/v2/people/phone", { person_id: "2" }), ERefusal, "ceiling");
  await assertRejects(() => post("/v1/search", { limit: 11 }), ERefusal, "page size");
  await g.fetch("https://api.leadocean.io/v1/account", { method: "GET", headers: {} });
  assertEquals(sent, 2);
});
