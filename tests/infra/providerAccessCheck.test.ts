// The free access check can only send documented free operations, sends each
// once, keeps keys out of URLs and reports, and drops every row value.

import { assert, assertEquals, assertFalse, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FREE_OPERATIONS, RefusedOperation, checkApollo, checkLeadOcean, fingerprint, freeGate, type FetchLike,
} from "../../scripts/provider-access-check.ts";

const KEY = "test_key_do_not_print_123456";

function recorder(reply: (url: string) => { status: number; body: unknown }) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const f: FetchLike = (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const r = reply(url);
    return Promise.resolve({ status: r.status, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(r.body)) });
  };
  return { f, calls };
}

Deno.test("access check: every paid or unlisted operation is refused before anything is sent", async () => {
  const { f, calls } = recorder(() => ({ status: 200, body: {} }));
  const apollo = freeGate(f, "apollo", KEY);
  const lo = freeGate(f, "leadocean", KEY);
  for (const [call, method, path] of [
    [apollo, "POST", "/api/v1/mixed_companies/search"], // 1 credit per page
    [apollo, "POST", "/api/v1/people/match"], // enrichment
    [apollo, "GET", "/api/v1/auth/health"], // free, but carries no account detail (and behind a key-injecting proxy proves nothing)
    [lo, "POST", "/v1/search"], [lo, "POST", "/v1/search/companies"], [lo, "POST", "/v1/enrich"],
    [lo, "GET", "/v1/companies/enrich"], [lo, "POST", "/v1/exports"], [lo, "GET", "/v1/companies/count/../enrich"],
  ] as const) {
    await assertRejects(() => call(method, path), RefusedOperation);
  }
  assertEquals(calls.length, 0);
});

Deno.test("access check: one attempt per operation, key only in a header, never in a URL or the report", async () => {
  const { f, calls } = recorder((u) => ({ status: u.includes("usage_stats") ? 500 : 429, body: { error: "x" } }));
  const r = await checkApollo(f, KEY);
  assertEquals(calls.length, 2, "a failure is reported, never retried");
  assert(calls.every((c) => c.headers["x-api-key"] === KEY && !c.url.includes(KEY)));
  assertFalse(JSON.stringify(r).includes(KEY));
  assertEquals((await fingerprint(KEY)).length, 12);
});

Deno.test("access check: Apollo's one-row search keeps field NAMES and drops every value", async () => {
  const { f } = recorder((u) => u.includes("api_search")
    ? { status: 200, body: { total_entries: 5321, people: [{ id: "p1", first_name: "Jordan", title: "VP Sales", linkedin_url: "https://linkedin.com/in/jordan", organization: { name: "Acme", primary_domain: "acme.example" } }] } }
    : { status: 403, body: { error: "master key required" } });
  const [usage, search] = await checkApollo(f, KEY);
  assertEquals(usage.ok, false);
  assert(String(usage.summary.note).includes("master key"));
  assertEquals(search.summary.total_entries, 5321);
  assertEquals(search.summary.row_fields, ["first_name", "id", "linkedin_url", "organization", "title"]);
  const text = JSON.stringify(search);
  for (const v of ["Jordan", "linkedin.com/in/jordan", "Acme", "acme.example"]) assertFalse(text.includes(v), `${v} must not be reported`);
});

Deno.test("access check: LeadOcean reports plan and records, masks the email, and sizes the cohort by count only", async () => {
  const { f, calls } = recorder((u) => {
    if (u.endsWith("/v1/account")) return { status: 200, body: { success: true, data: { account: { id: "acc_1", email: "owner@example.com", plan: "free" }, key: { prefix: "lo_ab", scopes: ["search"] }, records: { ceiling: 1000, used: 0, remaining: 1000 } } } };
    if (u.includes("/v1/companies/count")) return { status: 200, body: { success: true, meta: { total: 1 } } };
    return { status: 200, body: { success: true, data: { used: 0 } } };
  });
  const r = await checkLeadOcean(f, KEY, [{ slot: "A01", domain: "alpha.example" }, { slot: "A02", linkedin_url: "https://www.linkedin.com/company/beta" }, { slot: "A03" }], { hqCountry: "United States" });
  const acc = r.find((x) => x.op === "account")!;
  assertEquals(acc.summary.email, "o***@example.com");
  assertEquals(acc.summary["records.remaining"], 1000);
  assertEquals(acc.summary["key.scopes"], ["search"]);
  assert(calls.every((c) => FREE_OPERATIONS.leadocean.some((o) => c.url.startsWith(`https://api.leadocean.io${o.path}`) && c.method === o.method)));
  // A slot with no identifier is not sent; the other two are counted by domain and by LinkedIn.
  assertEquals(r.filter((x) => x.op.startsWith("companies/count(A")).map((x) => x.summary.by), ["domain", "linkedin"]);
  assertFalse(JSON.stringify(r).includes("owner@example.com"));
});
