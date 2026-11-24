// Provider capability contracts + LeadOcean v2 adapter (documented endpoints), offline only:
// every LeadOcean call goes to a mocked fetch; nothing reaches the network.
import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CAPABILITY_CARDS, capabilitiesFor, TEST_PILOT_POLICY } from "../../../supabase/functions/_shared/providerCapabilities.ts";
import { DISCOVERY_CAPABILITIES } from "../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { companyClaims, companyCountBody, companySearchBody, LeadOceanSchemaError, leadOceanV2, personClaims } from "../../../supabase/functions/_shared/discoveryProviders/adapters/leadoceanV2.ts";
import { ProviderError } from "../../../supabase/functions/_shared/discoveryProviders/types.ts";

Deno.test("cards: every executable card names a real pilot capability; a LeadOcean field is never verified proof", () => {
  for (const c of CAPABILITY_CARDS) if (c.executableAs) assert(DISCOVERY_CAPABILITIES[c.executableAs], c.id);
  for (const c of CAPABILITY_CARDS.filter((x) => x.provider === "leadocean")) assert(c.proves.every((p) => p.strength !== "verified"), c.id);
  assert(CAPABILITY_CARDS.find((c) => c.id === "leadocean.company_search")!.limits.some((l) => l.includes("no B2B")));
});

Deno.test("selection honours the provider policy: the TEST pilot sees Apify only, never contact enrichment", () => {
  assertEquals(capabilitiesFor("company_discovery", TEST_PILOT_POLICY), [], "LeadOcean is not allowed on TEST");
  assertEquals(capabilitiesFor("business_model_verification", TEST_PILOT_POLICY).map((c) => c.id), ["apify.website_business_model"]);
  assertEquals(capabilitiesFor("contact_enrichment", { ...TEST_PILOT_POLICY, allowedProviders: ["apify", "leadocean"], maxLeadoceanRecords: 50 }), [], "contact needs explicit authorization");
  const withLo = { allowedProviders: ["apify", "leadocean"] as const, maxApifyUsd: 1, maxLeadoceanRecords: 50, contactEnrichment: false };
  assertEquals(capabilitiesFor("company_discovery", withLo as never).map((c) => c.id), ["leadocean.company_search"]);
});

Deno.test("LeadOcean v2: a filter it does not document is refused before anything is sent", () => {
  assertThrows(() => companySearchBody({ businessModel: ["B2B"] } as never, { limit: 10 }), LeadOceanSchemaError, "unsupported company filter: businessModel");
  assertThrows(() => companySearchBody({ employeeRange: ["20-200"] }, { limit: 10 }), LeadOceanSchemaError, "not a documented band");
  assertThrows(() => companySearchBody({ hqCountry: ["USA"] }, { limit: 10 }), LeadOceanSchemaError, "ISO alpha-2");
  assertThrows(() => companySearchBody({}, { limit: 101 }), LeadOceanSchemaError, "1–100");
  assertEquals(companySearchBody({ hqCountry: ["US"], employeeRange: ["11-50", "51-200"] }, { limit: 25 }), { hqCountry: ["US"], employeeRange: ["11-50", "51-200"], limit: 25, order: "ranked" });
});

type Call = { url: string; body: unknown; headers: Record<string, string> };
function mock(responses: { status: number; json: unknown; headers?: Record<string, string> }[]) {
  const calls: Call[] = [];
  const fetch = (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null, headers: init.headers as Record<string, string> });
    const r = responses.shift()!;
    return Promise.resolve(new Response(JSON.stringify(r.json), { status: r.status, headers: r.headers ?? {} }));
  };
  return { fetch: fetch as never, calls };
}
const row = (id: string, domain: string) => ({ company_data: { company_id: id, company_name: `Co ${id}`, company_domain: domain, naics_primary: "541511", company_employees: { min: 51, max: 200 } }, company_metrics: { completion_score: 0.8 }, meta: { source_ids: { company_id: id } } });
const NOW = () => new Date("2026-11-08T00:00:00Z");

Deno.test("LeadOcean v2: documented paths, key in a header, claims with provenance, billing from meta.credits, depth cap reported", async () => {
  const m = mock([{ status: 200, json: { success: true, data: [row("c1", "acme.example"), row("c2", "beta.example")], meta: { credits: 2, nextCursor: "sig.abc", unsupportedFilters: ["investors"] } } },
    { status: 200, json: { success: true, data: [row("c3", "gamma.example")], meta: { credits: 1, depthCapped: true, nextCursor: "ignored" } } }]);
  const lo = leadOceanV2({ apiKey: "lo_test_key", fetch: m.fetch, now: NOW, sleep: () => Promise.resolve() });
  const p1 = await lo.searchCompanies({ hqCountry: ["US"] }, { limit: 2 });
  assertEquals(new URL(m.calls[0].url).pathname, "/v1/companies/search");
  assertEquals(m.calls[0].headers["x-api-key"], "lo_test_key");
  assert(!m.calls[0].url.includes("lo_test_key"), "the key is never in the URL");
  assertEquals([p1.rows.length, p1.billedRecords, p1.billedFrom, p1.nextCursor, p1.complete], [2, 2, "provider_meta", "sig.abc", true]);
  assertEquals(p1.unsupportedFilters, ["investors"], "an ignored filter is surfaced, never assumed applied");
  assert(p1.rows[0].claims.every((c) => c.strength === "claim" && c.provider === "leadocean" && c.recordId === "c1"));
  const p2 = await lo.searchCompanies({ hqCountry: ["US"] }, { limit: 2, cursor: p1.nextCursor });
  assertEquals((m.calls[0].body as { order: string }).order, "ranked");
  assertEquals((m.calls[1].body as { cursor: string; order: string }).order, "ranked", "a continued walk keeps ITS order (a mismatch is a 400 cursor_order_mismatch)");
  assertEquals([p2.complete, p2.truncatedReason, p2.nextCursor], [false, "depth_cap", null]);
});

Deno.test("LeadOcean v2: not held = null (free); quota spent (402) stops; a malformed answer is an error, never zero rows", async () => {
  const lo = (r: { status: number; json: unknown; headers?: Record<string, string> }[]) => leadOceanV2({ apiKey: "k", fetch: mock(r).fetch, now: NOW, sleep: () => Promise.resolve() });
  assertEquals(await lo([{ status: 404, json: { success: false, error: { message: "Not in our data" } } }]).getCompany({ domain: "nobody.example" }), null);
  const e = await assertRejects(() => lo([{ status: 402, json: { success: false, error: { message: "records spent" } } }]).searchCompanies({}, { limit: 5 }), ProviderError);
  assertEquals((e as ProviderError).kind, "allowance_exhausted");
  await assertRejects(() => lo([{ status: 200, json: { rows: [] } }]).searchCompanies({}, { limit: 5 }), LeadOceanSchemaError);
  const free = await lo([{ status: 200, json: { success: true, data: [], meta: { total: 4052, countOnly: true } } }]).countCompanies({ hqCountry: ["US"] });
  assertEquals([free.total, free.withheld], [4052, null]);
});

Deno.test("LeadOcean v2: a 5xx on a paid search is charge_uncertain and never retried; fair-use pacing is reported", async () => {
  const m = mock([{ status: 500, json: { success: false, error: { message: "boom" } } }, { status: 200, json: { success: true, data: [], meta: {} } }]);
  const lo = leadOceanV2({ apiKey: "k", fetch: m.fetch, now: NOW, sleep: () => Promise.resolve() });
  const e = await assertRejects(() => lo.searchCompanies({}, { limit: 5 }), ProviderError);
  assertEquals([(e as ProviderError).kind, m.calls.length], ["charge_uncertain", 1]);
  const paced = mock([{ status: 200, json: { success: true, data: [row("c1", "a.example")], meta: { credits: 1 } }, headers: { "x-quota-state": "paced" } }]);
  const p = await leadOceanV2({ apiKey: "k", fetch: paced.fetch, now: NOW }).searchCompanies({}, { limit: 1 });
  assertEquals(p.paced, true);
});

// ── Contract re-check 2026-11-08 (openapi.json + llms-full.txt): each defect it found ─────────

Deno.test("LeadOcean v2 contract: the count body carries filters only (the endpoint refuses limit / order / cursor)", async () => {
  assertEquals(companyCountBody({ hqCountry: ["US"], employeeRange: ["11-50"] }), { hqCountry: ["US"], employeeRange: ["11-50"] });
  assertThrows(() => companyCountBody({ businessModel: ["B2B"] } as never), LeadOceanSchemaError, "unsupported company filter");
  const m = mock([{ status: 200, json: { success: true, data: { total: 12, totalIsExact: true }, meta: {} } }]);
  const r = await leadOceanV2({ apiKey: "k", fetch: m.fetch, now: NOW }).countCompanies({ hqCountry: ["US"] });
  assertEquals(new URL(m.calls[0].url).pathname, "/v1/companies/count");
  assertEquals(m.calls[0].body, { hqCountry: ["US"] });
  assertEquals([r.total, r.exact], [12, true]);
});

Deno.test("LeadOcean v2 contract: a withheld count is a documented answer (null + the filter), not a schema error", async () => {
  const m = mock([{ status: 200, json: { success: true, data: { total: null, totalWithheld: { reason: "unsupported_filters", filters: ["technologies"] } }, meta: {} } }]);
  const r = await leadOceanV2({ apiKey: "k", fetch: m.fetch, now: NOW }).countCompanies({ keywords: ["crm"] });
  assertEquals(r, { total: null, exact: false, withheld: { reason: "unsupported_filters", filters: ["technologies"] } });
});

Deno.test("LeadOcean v2 contract: a stable walk sends stable on every page", async () => {
  const m = mock([{ status: 200, json: { success: true, data: [], meta: { nextCursor: "c1" } } }, { status: 200, json: { success: true, data: [], meta: {} } }]);
  const lo = leadOceanV2({ apiKey: "k", fetch: m.fetch, now: NOW });
  const p1 = await lo.searchPeople({ title: ["CEO"] }, { limit: 5, order: "stable" });
  await lo.searchPeople({ title: ["CEO"] }, { limit: 5, order: "stable", cursor: p1.nextCursor });
  assertEquals(m.calls.map((c) => (c.body as { order: string }).order), ["stable", "stable"]);
});

Deno.test("LeadOcean v2 contract: company fields are the documented leadocean.company.v1 names, kept whole where the shape is undocumented", () => {
  const c = companyClaims({
    company_data: { company_id: "42", company_name: "Acme", company_domain: "acme.example", company_type: "Privately Held", naics_primary: "541511",
      company_industries: ["Software Development"], company_employees: { min: 51, max: 200 }, company_primary_address: { country: "US", city: "Austin" },
      company_funding: { last_round: "Series A" }, company_social_links: { linkedin: "https://www.linkedin.com/company/acme", x: "https://x.com/acme" } },
    company_metrics: { completion_score: 0.9 }, meta: { source_ids: { company_id: "42" } },
  }, "2026-11-08T00:00:00.000Z");
  assertEquals([c.recordId, c.name, c.domain, c.linkedinUrl], ["42", "Acme", "acme.example", "https://www.linkedin.com/company/acme"]);
  assertEquals(c.claims.map((x) => x.field).sort(), ["company_type", "employees", "funding", "industries", "naics_primary", "primary_address"]);
  assertEquals(c.claims.find((x) => x.field === "primary_address")!.value, { country: "US", city: "Austin" }, "undocumented shape: kept whole, never parsed");
  assert(c.claims.every((x) => x.strength === "claim"));
  // A LinkedIn PERSON URL or another network is not the company page.
  assertEquals(companyClaims({ company_data: { company_social_links: ["https://www.linkedin.com/in/someone"] }, meta: { source_ids: { company_id: "1" } } }, "t").linkedinUrl, null);
});

Deno.test("LeadOcean v2 contract: person fields are job_title / profile_url; a thin row keeps only its top-level person_id", () => {
  const p = personClaims({
    profile_data: { profile_full_name: "Nia North", profile_url: "https://www.linkedin.com/in/nia", profile_address: { country: "US" } },
    contact_data: { contact_current_experiences: [{ job_title: "CEO", company_domain: "acme.example" }] },
    meta: { source_ids: { person_id: "p1", person_group_id: "g1" } },
  }, "t");
  assertEquals([p.recordId, p.personGroupId, p.name, p.title, p.linkedinUrl, p.employerDomain], ["p1", "g1", "Nia North", "CEO", "https://www.linkedin.com/in/nia", "acme.example"]);
  const thin = personClaims({ person_id: "p9", meta: { view: "thin" } }, "t");
  assertEquals([thin.recordId, thin.name, thin.title, thin.claims.length], ["p9", null, null, 0]);
});

Deno.test("LeadOcean v2 contract: over-limit throttling is reported; usage.plan is the documented object", async () => {
  const m = mock([{ status: 200, json: { success: true, data: [], meta: {} }, headers: { "x-quota-state": "over-limit" } },
    { status: 200, json: { success: true, data: { used: 120, period: "2026-11", plan: { name: "Solo", records: 10000 } } } }]);
  const lo = leadOceanV2({ apiKey: "k", fetch: m.fetch, now: NOW });
  const p = await lo.searchCompanies({}, { limit: 1 });
  assertEquals([p.quotaState, p.paced], ["over-limit", false]);
  assertEquals(await lo.usage(), { used: 120, period: "2026-11", plan: { name: "Solo", records: 10000 } });
});
