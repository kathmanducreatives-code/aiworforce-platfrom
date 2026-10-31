// Regression tests for adapter defects confirmed on 2026-10-30 against Apollo's
// API reference, LeadOcean's OpenAPI 1.0.0 and the live (free) behaviour of the
// configured Apollo key. Each test names the defect it pins. ZERO network.

import { assert, assertEquals, assertFalse, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { apolloAdapter, apolloQuery, buildApolloSearch, normalizeApolloPage, ALLOWED_PATHS } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/apollo.ts";
import { buildLeadOceanSearch, leadOceanAdapter } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import { callProvider, planRestricted } from "../../../../supabase/functions/_shared/discoveryProviders/http.ts";
import { handleConnections, memoryConnectionStore, verifierFrom } from "../../../../supabase/functions/_shared/discoveryProviders/connections.ts";
import { readFlags } from "../../../../supabase/functions/_shared/discoveryProviders/flags.ts";
import { mergeRecords } from "../../../../supabase/functions/_shared/discoveryProviders/normalize.ts";
import { planDiscovery, type PlanStep } from "../../../../supabase/functions/_shared/discoveryProviders/routing.ts";
import { requirementsFromMission } from "../../../../supabase/functions/_shared/discoveryProviders/requirements.ts";
import { isoCountry, leadOceanIndustry, translate, LEADOCEAN_VOCABULARY } from "../../../../supabase/functions/_shared/discoveryProviders/vocabulary.ts";
import { ProviderError, type DiscoveryRequirements, type HardRequirement } from "../../../../supabase/functions/_shared/discoveryProviders/types.ts";
import { ALL_CONNECTED, FIXED_NOW, apPerson, compileManufacturerMission, conn, mockFetch, noSleep } from "./fixtures.ts";

const req = () => requirementsFromMission(compileManufacturerMission().final_mission as never);
const hard = (key: HardRequirement["key"], values: HardRequirement["values"]): HardRequirement => ({ criterionId: key, key, values, label: key, representable: true });
const ap = (f: ReturnType<typeof mockFetch>) => apolloAdapter({ apiKey: "ap_test_key_123456", fetch: f.fetch, sleep: noSleep, now: FIXED_NOW });
const lo = (f: ReturnType<typeof mockFetch>) => leadOceanAdapter({ apiKey: "lo_test_key_123456", fetch: f.fetch, sleep: noSleep, now: FIXED_NOW });

/** Apollo's step for the fixture mission (Apify settles industry, which Apollo cannot filter exactly). */
function apolloStep(kind: PlanStep["kind"], pageSize = 10): PlanStep {
  const r = req();
  const plan = planDiscovery({ requirements: r, connections: [conn("apollo"), conn("apify")], selection: ["apollo", "apify"] });
  const step = plan.steps.find((s) => s.provider === "apollo")!;
  // A company search never owes the people's roles (routing.relevant).
  return { ...step, kind, pageSize, requirements: kind === "company_search" ? step.requirements.filter((x) => x.key !== "roles") : step.requirements };
}

// ── Apollo ──────────────────────────────────────────────────────────────────

Deno.test("A1 Apollo: filters travel as documented QUERY parameters (name[]), never a JSON body", async () => {
  const f = mockFetch({ "POST /api/v1/mixed_people/api_search": [{ body: { total_entries: 0, people: [] } }] });
  await ap(f).search(apolloStep("people_search"), req(), null, 10);
  const u = new URL(f.calls[0].url);
  assertEquals(f.calls[0].body, undefined);
  assertEquals(u.searchParams.getAll("person_titles[]"), ["Founder", "CEO"]);
  assertEquals(u.searchParams.get("include_similar_titles"), "false");
  assertEquals(u.searchParams.getAll("organization_locations[]"), ["United States"]);
  assertEquals(u.searchParams.getAll("organization_num_employees_ranges[]"), ["1,100"]);
  assertEquals(apolloQuery({ a: ["x", "y"], b: 1, c: null }), "a%5B%5D=x&a%5B%5D=y&b=1");
});

Deno.test("A2 Apollo: Organization Search rows come from BOTH organizations and accounts, deduplicated by organization id", () => {
  const page = normalizeApolloPage({
    pagination: { page: 1, per_page: 10, total_entries: 3 },
    organizations: [{ id: "o1", name: "One", primary_domain: "one.example" }, { id: "o2", name: "Two", primary_domain: "two.example" }],
    accounts: [{ id: "acct-9", organization_id: "o2", name: "Two", domain: "two.example" }, { id: "acct-7", organization_id: "o3", name: "Three", domain: "three.example" }],
  }, apolloStep("company_search"), 1, 10, "t");
  assertEquals(page.companies.map((c) => [c.recordId, c.domain]), [["o1", "one.example"], ["o2", "two.example"], ["o3", "three.example"]]);
  assertEquals(page.total, 3);
  assertEquals(page.creditsCharged, 1);
});

Deno.test("A3 Apollo: Organization Search rows carry no HQ, size or industry — nothing is invented from them", () => {
  const page = normalizeApolloPage({ organizations: [{ id: "o1", name: "One", primary_domain: "one.example", linkedin_url: "https://www.linkedin.com/company/one" }] }, apolloStep("company_search"), 1, 10, "t");
  const c = page.companies[0];
  assertEquals([c.hqCountry, c.employeeCount, c.industry], [null, null, null]);
});

Deno.test("A4 Apollo: a person's employer is a NAME only — never a domain, never merged with another provider's company", () => {
  const page = normalizeApolloPage({ total_entries: 2, people: [apPerson("p1", "A", "CEO", { name: "Acme" }), apPerson("p2", "B", "Founder", { name: "Acme" })] }, apolloStep("people_search"), 1, 10, "t");
  assertEquals(page.people.map((p) => [p.company?.recordId, p.company?.domain]), [["org-name:acme", null], ["org-name:acme", null]]);
  const m = mergeRecords([{ provider: "leadocean", recordId: "lo-1", retrievedAt: "t", name: "Acme", domain: "acme.example" }], page.people);
  assertEquals(m.companies.length, 2, "a shared name is not an identity");
});

Deno.test("A5 Apollo: per_page stays constant across a walk; a short last page is truncated, not re-requested smaller", async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: `o${i}`, name: `Co ${i}`, primary_domain: `co${i}.example` }));
  const f = mockFetch({ "POST /api/v1/mixed_companies/search": [{ body: { pagination: { total_entries: 40 }, organizations: rows } }] });
  const page = await ap(f).search(apolloStep("company_search", 10), req(), "2", 3);
  const u = new URL(f.calls[0].url);
  assertEquals([u.searchParams.get("page"), u.searchParams.get("per_page")], ["2", "10"]);
  assertEquals(page.companies.length, 3);
  assertEquals(page.nextCursor, "3");
});

Deno.test("A6 Apollo: a valid key on a plan without People API Search connects, with the limit reported (observed 2026-10-30)", async () => {
  const denied = { status: 403, body: { error: "not included in your Professional (Trial) plan", error_code: "API_INACCESSIBLE", error_details: { code: "AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED", message: "Your team is not permitted to call this endpoint." } } };
  const f = mockFetch({ "POST /api/v1/usage_stats/api_usage_stats": [{ body: {} }], "POST /api/v1/mixed_people/api_search": [denied] });
  const u = await ap(f).verifyKey();
  assertEquals(u.restrictions, ["people_search: not in this plan"]);
  // Both checks refused: nothing proves the key.
  const g = mockFetch({ "POST /api/v1/usage_stats/api_usage_stats": [{ status: 403, body: { error: "master key required" } }], "POST /api/v1/mixed_people/api_search": [denied] });
  await assertRejects(() => ap(g).verifyKey(), ProviderError);
  // A rejected key stays a rejected key.
  const h = mockFetch({ "POST /api/v1/usage_stats/api_usage_stats": [{ status: 401, body: { error: "Invalid access credentials." } }] });
  const e = await assertRejects(() => ap(h).verifyKey(), ProviderError);
  assertEquals((e as ProviderError).kind, "auth_failed");
});

Deno.test("A7 Apollo: only search and usage endpoints are reachable — no enrichment, prospects, contacts or job postings", () => {
  assertEquals([...ALLOWED_PATHS].sort(), ["/api/v1/mixed_companies/search", "/api/v1/mixed_people/api_search", "/api/v1/usage_stats/api_usage_stats"]);
  for (const p of ["/api/v1/mixed_people/add_to_my_prospects", "/api/v1/people/match", "/api/v1/contacts", "/api/v1/organizations/1/job_postings"]) assertFalse(ALLOWED_PATHS.has(p));
});

// ── HTTP / connections ──────────────────────────────────────────────────────

Deno.test("H1 a 403 that names the PLAN is plan_restricted; a scope 403 is forbidden_scope; neither invalidates the key", async () => {
  assert(planRestricted({ error_code: "API_INACCESSIBLE" }));
  assert(planRestricted({ error_details: { code: "AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED" } }));
  assertFalse(planRestricted({ success: false, error: { code: "forbidden", message: "key lacks the enrich scope" } }));
  const f = mockFetch({ "POST /x": [{ status: 403, body: { error_code: "API_INACCESSIBLE", error: "plan" } }], "POST /y": [{ status: 403, body: { error: { message: "scope" } } }] });
  const k1 = await assertRejects(() => callProvider(f.fetch as never, { provider: "apollo", url: "https://api.example/x", method: "POST", headers: {}, paid: true }, noSleep));
  const k2 = await assertRejects(() => callProvider(f.fetch as never, { provider: "leadocean", url: "https://api.example/y", method: "POST", headers: {}, paid: true }, noSleep));
  assertEquals([(k1 as ProviderError).kind, (k2 as ProviderError).kind], ["plan_restricted", "forbidden_scope"]);
  // A plan-limited Apollo key connects and is stored, with its limit shown.
  const store = memoryConnectionStore({ ws: { owner: "owner" } });
  const flags = readFlags((n) => ({ PROVIDER_DISCOVERY_ENABLED: "true", PROVIDER_DISCOVERY_WORKSPACES: "ws", PROVIDER_APOLLO_ENABLED: "true", APOLLO_COMMERCIAL_TERMS_CONFIRMED: "true" } as Record<string, string>)[n]);
  const g = mockFetch({ "POST /api/v1/usage_stats/api_usage_stats": [{ body: {} }], "POST /api/v1/mixed_people/api_search": [{ status: 403, body: { error_code: "API_INACCESSIBLE" } }] });
  const r = await handleConnections({ action: "connect", workspaceId: "ws", provider: "apollo", apiKey: "ap_valid_key_123456" }, {
    userId: "owner", flags, store, verify: verifierFrom(() => ap(g)), now: FIXED_NOW,
  });
  assertEquals(r.status, 200);
  const row = (await store.list("ws"))[0];
  assertEquals(row.status, "connected");
  assert(row.lastError!.includes("people_search: not in this plan"));
});

Deno.test("H2 Apollo's structured error_details message is read (error / error_code sunset 2027-02-16)", async () => {
  const f = mockFetch({ "POST /x": [{ status: 422, body: { error_details: { code: "VALIDATION", message: "person_titles too long" } } }] });
  const e = await assertRejects(() => callProvider(f.fetch as never, { provider: "apollo", url: "https://api.example/x", method: "POST", headers: {}, paid: false }, noSleep));
  assertEquals((e as ProviderError).message, "person_titles too long");
});

// ── LeadOcean ───────────────────────────────────────────────────────────────

Deno.test("LO1 LeadOcean: countries are sent as ISO alpha-2; a person country it cannot name refuses the provider", () => {
  assertEquals(isoCountry("United States"), "US");
  assertEquals(isoCountry("USA"), "US");
  assertEquals(isoCountry("uae"), "AE", "every alias geoLevel accepts must translate");
  assertEquals(isoCountry("United Kingdom"), "GB");
  assertEquals(isoCountry("de"), "DE");
  assertEquals(isoCountry("Atlantis"), null);
  // HQ: a country goes to hqCountry as ISO; a state or any other place is a narrowing keyword filter.
  assertEquals(translate("leadocean", "company_search", hard("geography_hq", ["United States", "California", "Austin"])),
    { ok: true, params: { hqCountry: ["US"], hqState: ["California"], hqCity: ["Austin"] } });
  // A person location must be an ISO country: free text refuses the provider instead of being dropped.
  const r = { ...req(), hard: [...req().hard, hard("geography_person", ["Atlantis"])] } as DiscoveryRequirements;
  const plan = planDiscovery({ requirements: r, connections: [conn("leadocean")], selection: ["leadocean"] });
  assertEquals(plan.steps.length, 0);
  assert(plan.refused[0].reason.includes("\"Atlantis\" is not a ISO country"), plan.refused[0].reason);
});

Deno.test("LO2 LeadOcean: industry must be an exact label from its closed enum — never free text, never a substring", () => {
  assertEquals(leadOceanIndustry("manufacturing"), "Manufacturing");
  assertEquals(leadOceanIndustry("Technology, Information and Internet"), "Technology; Information and Internet");
  assertEquals(leadOceanIndustry("manufacturers"), null);
  assertEquals(leadOceanIndustry("software"), null, "no substring guessing");
  assertEquals(LEADOCEAN_VOCABULARY.specVersion, "1.0.0");
  const body = buildLeadOceanSearch(planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] }).steps[0], req(), null, 5).body;
  assertEquals([body.industry, body.hqCountry], [["Manufacturing"], ["US"]]);
});

Deno.test("LO3 LeadOcean: a company-type exclusion on PEOPLE search needs an exact label (excludeKeywords there is the person's own text)", () => {
  assertEquals(translate("leadocean", "people_search", hard("excluded_company_types", ["staffing agencies"])).ok, false);
  assertEquals(translate("leadocean", "people_search", hard("excluded_company_types", ["Staffing and Recruiting"])),
    { ok: true, params: { excludeIndustry: ["Staffing and Recruiting"] } });
  assertEquals(translate("leadocean", "company_search", hard("excluded_company_types", ["staffing agencies"])),
    { ok: true, params: { excludeKeywords: ["staffing agencies"] } });
  // The old fixture's free-text exclusion now refuses LeadOcean's people search instead of widening it.
  const r = req();
  const freeText = { ...r, hard: r.hard.map((h) => h.key === "excluded_company_types" ? { ...h, values: ["staffing agencies"] } : h) };
  const plan = planDiscovery({ requirements: freeText, connections: ALL_CONNECTED, selection: "auto" });
  assertFalse(plan.steps.some((s) => s.provider === "leadocean"));
  assert(plan.refused.find((x) => x.provider === "leadocean")!.reason.includes("only by label"));
});

Deno.test("LO4 LeadOcean: exact identity by LinkedIn — companies use `linkedin`, people `companyLinkedin`; anything else refuses", () => {
  const ids = ["acme.example", "https://www.linkedin.com/company/acme"];
  assertEquals(translate("leadocean", "company_search", hard("known_companies", ids)), { ok: true, params: { domain: ["acme.example"], linkedin: ["https://www.linkedin.com/company/acme"] } });
  assertEquals(translate("leadocean", "people_search", hard("known_companies", ids)), { ok: true, params: { domain: ["acme.example"], companyLinkedin: ["https://www.linkedin.com/company/acme"] } });
  assertEquals(translate("leadocean", "company_search", hard("known_companies", ["Acme Inc"])).ok, false);
  assertEquals(translate("apollo", "company_search", hard("known_companies", ["https://www.linkedin.com/company/acme"])).ok, false, "Apollo filters companies by domain only");
});

Deno.test("LO5 LeadOcean: the key check reads /v1/account (free) — plan, scopes and records left; a missing scope is reported", async () => {
  const f = mockFetch({ "GET /v1/account": [{ body: { success: true, data: { account: { plan: "free", suspended: false }, key: { scopes: ["search"] }, records: { ceiling: 1000, used: 23, remaining: 977, resetsAt: null }, subscription: null } } }] });
  const u = await lo(f).verifyKey();
  assertEquals([u.plan, u.limit, u.used, u.remaining], ["free", 1000, 23, 977]);
  assertEquals(u.scopes, ["search"]);
  assertEquals(u.restrictions, ["enrich: key lacks the enrich scope"]);
});

Deno.test("LO6 LeadOcean: slim is OFF on every search (V read the full row; slim's dropped parts are undocumented)", () => {
  const r = req();
  const people = planDiscovery({ requirements: r, connections: [conn("leadocean")], selection: ["leadocean"] }).steps[0];
  assertEquals(buildLeadOceanSearch(people, r, null, 5).body.slim, false);
  const companies = { ...people, kind: "company_search" as const, requirements: people.requirements.filter((x) => x.key !== "roles") };
  assertEquals(buildLeadOceanSearch(companies, r, null, 5).body.slim, false);
});

// ── Capabilities ────────────────────────────────────────────────────────────

Deno.test("C1 LeadOcean funding stage: exact rounds only — Series E-J is wider than Series E, and 'startup' is no round", () => {
  assertEquals(translate("leadocean", "company_search", hard("company_stage", ["seed", "series_a"])),
    { ok: true, params: { fundingType: ["Seed", "Series A"] } });
  assertEquals(translate("leadocean", "company_search", hard("company_stage", ["pre-seed"])), { ok: true, params: { fundingType: ["Pre seed"] } });
  assertEquals(translate("leadocean", "company_search", hard("company_stage", ["series_e"])).ok, false);
  assertEquals(translate("leadocean", "company_search", hard("company_stage", ["startup"])).ok, false);
  assertEquals(translate("apollo", "company_search", hard("company_stage", ["seed"])).ok, false, "Apollo has no exact stage filter");
});

Deno.test("C2 a plan restriction found by the free key check refuses that search kind at PLAN time", () => {
  const r = req();
  const restricted = { ...conn("apollo"), restrictions: ["people_search: not in this plan"] };
  // A PERSON mission has no fallback: refused when planned.
  assertEquals(r.targetEntity, "person", "the fixture asks for founders/CEOs: a person mission");
  const people = r;
  const plan = planDiscovery({ requirements: people, connections: [restricted, conn("apify")], selection: ["apollo", "apify"] });
  assertFalse(plan.steps.some((s) => s.provider === "apollo"));
  assertEquals(plan.refused.find((x) => x.provider === "apollo")!.reason, "people search unavailable — not in this plan");
  // A COMPANY mission falls back to Organization Search: companies, no contacts, nothing dropped.
  const companies = planDiscovery({ requirements: { ...r, targetEntity: "company" }, connections: [restricted, conn("apify")], selection: ["apollo", "apify"] });
  const step = companies.steps.find((s) => s.provider === "apollo")!;
  assertEquals(step.kind, "company_search");
  assertFalse(step.requirements.some((x) => x.key === "roles"));
  // Auto still finds the provider that can run the mission.
  const auto = planDiscovery({ requirements: r, connections: [restricted, conn("leadocean"), conn("apify")], selection: "auto" });
  assertEquals(auto.steps[0].provider, "leadocean");
});
