// The Test L wire guard: what leaves the process is bounded no matter what the
// code above it asks for. ZERO network.

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { APPROVED, WireRefusal, wireGuard } from "../../scripts/provider-benchmark-run.ts";
import type { FetchLike } from "../../supabase/functions/_shared/discoveryProviders/http.ts";

const ok: FetchLike = () => Promise.resolve(new Response(JSON.stringify({ success: true, meta: { credits: 1 } }), { status: 200 }));
const post = (path: string, body: unknown) => ["https://api.leadocean.io" + path, { method: "POST", headers: {}, body: JSON.stringify(body) }] as const;

Deno.test("Test L approval is exactly 13 records, $0", () => {
  assertEquals(APPROVED, { test: "L", provider: "leadocean", maxRecords: 13, usd: 0 });
});

Deno.test("wire guard: only the free account read and the two searches; never enrich, export, viewed, or another host", async () => {
  const g = wireGuard(ok, 13);
  await g.fetch("https://api.leadocean.io/v1/account", { method: "GET", headers: {} });
  for (const [url, init] of [
    post("/v1/enrich", { limit: 1 }), post("/v1/companies/enrich", { limit: 1 }), post("/v1/exports", { limit: 1 }),
    post("/v1/people/viewed", { limit: 1 }), ["https://api.apollo.io/api/v1/mixed_companies/search", { method: "POST", headers: {}, body: "{}" }] as const,
  ]) await assertRejects(() => g.fetch(url, init), WireRefusal);
  assertEquals(g.log.length, 1);
});

Deno.test("wire guard: paid limits can never total more than the approved records", async () => {
  const g = wireGuard(ok, 13);
  await g.fetch(...post("/v1/search/companies", { domain: ["a.example"], limit: 1 }));
  await g.fetch(...post("/v1/search/companies", { linkedin: ["x"], limit: 1 }));
  await g.fetch(...post("/v1/search/companies", { linkedin: ["y"], limit: 1 }));
  await g.fetch(...post("/v1/search", { title: ["VP of Sales"], limit: 10 }));
  assertEquals(g.committed(), 13);
  await assertRejects(() => g.fetch(...post("/v1/search", { title: ["other"], limit: 1 })), WireRefusal, "14 > 13");
  await assertRejects(() => g.fetch(...post("/v1/search", { title: ["no limit"] })), WireRefusal, "explicit limit");
});

Deno.test("wire guard: an identical paid request is refused before it leaves — no metered retry", async () => {
  let sent = 0;
  const g = wireGuard((u, i) => { sent++; return ok(u, i); }, 13);
  const req = post("/v1/search/companies", { domain: ["a.example"], limit: 1 });
  await g.fetch(...req);
  await assertRejects(() => g.fetch(...req), WireRefusal, "repeat");
  assertEquals(sent, 1);
});
