// The validation-test-V wire guard admits exactly the two approved requests,
// once each, and nothing else. ZERO network.

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { APPROVED_V, V_REQUESTS, VRefusal, fieldCoverage, keyPaths, vGuard } from "../../scripts/leadocean-validation-v.ts";

const ok = () => Promise.resolve(new Response(JSON.stringify({ success: true, data: [], meta: { credits: 1 } }), { status: 200 }));
const B = "https://api.leadocean.io";
const v1 = () => [`${B}/v1/companies/enrich?domain=langchain.com`, { method: "GET", headers: {} }] as const;
const v2 = (body = V_REQUESTS[1].body!) => [`${B}/v1/search`, { method: "POST", headers: {}, body }] as const;

Deno.test("V approval: 2 records, $0; the planned worst case is exactly 2", () => {
  assertEquals(APPROVED_V, { test: "V", provider: "leadocean", maxRecords: 2, usd: 0 });
  assertEquals(V_REQUESTS.reduce((n, r) => n + r.maxRecords, 0), 2);
  assertEquals(JSON.parse(V_REQUESTS[1].body!), { domain: ["baseten.co"], limit: 1, order: "ranked", slim: false });
});

Deno.test("V guard: only the two approved requests, each once; account reads free and repeatable", async () => {
  let sent = 0;
  const g = vGuard(() => { sent++; return ok(); });
  await g.fetch(`${B}/v1/account`, { method: "GET", headers: {} });
  await g.fetch(...v1());
  await g.fetch(...v2());
  await g.fetch(`${B}/v1/account`, { method: "GET", headers: {} });
  await assertRejects(() => g.fetch(...v1()), VRefusal, "already sent");
  await assertRejects(() => g.fetch(...v2()), VRefusal, "already sent");
  assertEquals([sent, g.committed()], [4, 2]);
});

Deno.test("V guard: any change to an approved request is refused before sending", async () => {
  const g = vGuard(ok);
  for (const [url, init] of [
    [`${B}/v1/companies/enrich?domain=baseten.co`, { method: "GET", headers: {} }],
    [`${B}/v1/companies/enrich?domain=langchain.com&reveal=1`, { method: "GET", headers: {} }],
    v2(JSON.stringify({ domain: ["baseten.co"], limit: 2, order: "ranked", slim: false })),
    v2(JSON.stringify({ domain: ["baseten.co"], limit: 1, order: "ranked", slim: false, reveal_email: true })),
    [`${B}/v1/people/enrich`, { method: "POST", headers: {}, body: "{}" }],
    [`${B}/v1/exports`, { method: "POST", headers: {}, body: "{}" }],
    ["https://api.apollo.io/api/v1/mixed_companies/search", { method: "POST", headers: {}, body: "{}" }],
  ] as const) await assertRejects(() => g.fetch(url, init), VRefusal);
  assertEquals(g.committed(), 0);
});

Deno.test("key inventory lists paths and types, never values; coverage names the FIELDS path that matched", () => {
  const row = { profile_data: { profile_full_name: "X", profile_url: "u" }, contact_data: { contact_current_experiences: [{ job_title: "VP", company_domain: "a.example" }] }, meta: { fetched_at: "2026-10-20" } };
  const p = keyPaths(row);
  assertEquals(p["contact_data.contact_current_experiences.0.job_title"], "string");
  assertEquals(p["contact_data.contact_current_experiences"], "array(1)");
  const c = fieldCoverage(row, p);
  assertEquals(c.title, { path: "contact_data.contact_current_experiences.0.job_title", basis: "documented", type: "string" });
  assertEquals(c.hqCountry, null);
});
