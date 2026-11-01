// Multi-provider lead discovery — mocked-provider regression suite.
//
// ZERO network: every provider response is a fixture served by `mockFetch`;
// the Apify invoker is a stub. The mission comes from the REAL compiler.

import { assert, assertEquals, assertFalse, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requirementsFromMission } from "../../../../supabase/functions/_shared/discoveryProviders/requirements.ts";
import { planDiscovery, type DiscoveryPlan } from "../../../../supabase/functions/_shared/discoveryProviders/routing.ts";
import { leadOceanAdapter, buildLeadOceanSearch, normalizeLeadOceanPage } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import { apolloAdapter, buildApolloSearch } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/apollo.ts";
import { apifyAdapter, type ActorInvoker } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/apify.ts";
import { callProvider } from "../../../../supabase/functions/_shared/discoveryProviders/http.ts";
import { memoryLedger, checkDiscoveryApproval, type DiscoveryApproval, type EnrichmentAuthorization } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { mergeRecords } from "../../../../supabase/functions/_shared/discoveryProviders/normalize.ts";
import { verifyLeads, titleMatchesRole } from "../../../../supabase/functions/_shared/discoveryProviders/verify.ts";
import { runDiscovery } from "../../../../supabase/functions/_shared/discoveryProviders/orchestrator.ts";
import { enrichContacts, attachIndependentEvidence } from "../../../../supabase/functions/_shared/discoveryProviders/enrich.ts";
import { projectLead } from "../../../../supabase/functions/_shared/discoveryProviders/leadProjection.ts";
import { PROVIDERS } from "../../../../supabase/functions/_shared/discoveryProviders/providers.ts";
import { ProviderError, type ProviderCompany, type ProviderPerson } from "../../../../supabase/functions/_shared/discoveryProviders/types.ts";
import {
  ALL_CONNECTED, FIXED_NOW, MARKET, apPerson, compileManufacturerMission, conn, loPage, loPerson, mockFetch, noSleep,
} from "./fixtures.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "22222222-2222-4222-8222-222222222222";
const MISSION = "mission-1";

const req = () => requirementsFromMission(compileManufacturerMission().final_mission as never);

function approve(plan: DiscoveryPlan, over: Partial<DiscoveryApproval> = {}): DiscoveryApproval {
  return { kind: "discovery", workspaceId: WS, missionId: MISSION, planHash: plan.planHash, maxCredits: { ...plan.estimatedCredits }, approvedBy: "user-owner", approvedAt: "2026-10-27T12:00:00Z", ...over };
}

const loAdapter = (f: ReturnType<typeof mockFetch>) => leadOceanAdapter({ apiKey: "lo_test_key_123456", fetch: f.fetch, sleep: noSleep, now: FIXED_NOW });
const apAdapter = (f: ReturnType<typeof mockFetch>) => apolloAdapter({ apiKey: "ap_test_key_123456", fetch: f.fetch, sleep: noSleep, now: FIXED_NOW });

// ── 1. Mission interpretation ───────────────────────────────────────────────

Deno.test("requirements: every hard criterion the compiler emits survives, none is invented", () => {
  const r = req();
  assertEquals(r.hard.map((h) => h.key).sort(), ["employee_range", "excluded_company_types", "geography_hq", "industry", "roles"]);
  assertEquals(r.hard.find((h) => h.key === "employee_range")!.values, { min: null, max: 100 });
  assertEquals(r.forbidBroadening.sort(), ["geography", "size"]);
  assertEquals(r.forbidBroadeningUnread, []);
  assertEquals(r.requestedCount, 5);
});

Deno.test("requirements: both compilers' broadening bans read the same (verbatim, or verbatim plus canonical)", () => {
  const read = (d: string[]) => {
    const m = structuredClone(compileManufacturerMission().final_mission) as unknown as { directives: { disallowed_broadening: string[] } };
    m.directives.disallowed_broadening = d;
    return requirementsFromMission(m as never);
  };
  // Older compiler: entries pass through as written.
  const older = read(["geography", "employee_range"]);
  // Newer compiler (canonicalDisallowedBroadening): each entry kept, its canonical name added beside it.
  const newer = read(["geography", "employee_range", "size"]);
  assertEquals(older.forbidBroadening.sort(), ["geography", "size"]);
  assertEquals(newer.forbidBroadening.sort(), older.forbidBroadening.sort());
  // Prose the model wrote and a dimension name with a typo: kept, never read as a ban or a permission.
  const prose = read(["Account Executive role", "geograhpy"]);
  assertEquals(prose.forbidBroadening, []);
  assertEquals(prose.forbidBroadeningUnread, ["Account Executive role", "geograhpy"]);
});

Deno.test("requirements: an unrepresentable hard criterion becomes unmappable and blocks every plan", () => {
  const r = req();
  r.hard.push({ criterionId: "x", key: "unmappable", values: [], label: "ISO 13485 certified", representable: false, detail: "unrepresentable" });
  const plan = planDiscovery({ requirements: r, connections: ALL_CONNECTED, selection: "auto" });
  assertEquals(plan.status, "blocked");
  assert(plan.blockedReason!.includes("ISO 13485"));
  assertEquals(plan.steps.length, 0);
  assertEquals(plan.unsupportedRequirements[0].criterionId, "x");
});

// ── 2. Routing ──────────────────────────────────────────────────────────────

Deno.test("routing: auto picks the provider that filters the most, keeps one fallback, and needs approval for paid rows", () => {
  const plan = planDiscovery({ requirements: req(), connections: ALL_CONNECTED, selection: "auto" });
  assertEquals(plan.status, "ready");
  assertEquals(plan.steps.map((s) => [s.provider, s.role]), [["leadocean", "primary"], ["apollo", "fallback"]]);
  assert(plan.steps[0].requirements.every((r) => r.handling === "native"));
  assertEquals(plan.estimatedCredits.leadocean, 15);
  assert(plan.requiresApproval);
});

Deno.test("routing: Apollo alone cannot check industry or exclusions — refused, never run with them dropped", () => {
  const plan = planDiscovery({ requirements: req(), connections: [conn("apollo")], selection: ["apollo"] });
  assertEquals(plan.status, "blocked");
  const refused = plan.refused.find((r) => r.provider === "apollo")!;
  assertEquals(refused.unsupported.map((u) => u.key).sort(), ["excluded_company_types", "industry"]);
  assertEquals(plan.unsupportedRequirements.length, 2);
});

Deno.test("routing: Apollo + Apify — Apify verifies what Apollo cannot filter; Apollo search itself is free", () => {
  const plan = planDiscovery({ requirements: req(), connections: [conn("apollo"), conn("apify")], selection: ["apollo", "apify"] });
  assertEquals(plan.status, "ready");
  const ap = plan.steps.find((s) => s.provider === "apollo")!;
  assertEquals(ap.estimatedCredits, 0);
  assertEquals(ap.requirements.filter((r) => r.handling === "verify_via").map((r) => r.key).sort(), ["excluded_company_types", "industry"]);
  assertEquals(plan.verification?.provider, "apify");
});

Deno.test("routing: an explicit selection is never silently switched to another provider", () => {
  const plan = planDiscovery({ requirements: req(), connections: ALL_CONNECTED, selection: ["apollo"] });
  assertEquals(plan.status, "blocked");
  assertFalse(plan.steps.some((s) => s.provider === "leadocean"));
});

Deno.test("routing: disconnected, disabled, unconfirmed terms and exhausted allowance are each refused with a reason", () => {
  const plan = planDiscovery({
    requirements: req(),
    connections: [conn("leadocean", { remainingCredits: 0 }), conn("apollo", { commercialTermsConfirmed: false }), conn("apify", { enabled: false })],
    selection: "auto",
  });
  assertEquals(plan.status, "blocked");
  assertEquals(Object.fromEntries(plan.refused.map((r) => [r.provider, r.reason])), {
    leadocean: "allowance exhausted", apollo: "commercial terms not confirmed", apify: "disabled",
  });
});

Deno.test("routing: a small allowance shrinks the step instead of overspending", () => {
  const plan = planDiscovery({ requirements: req(), connections: [conn("leadocean", { remainingCredits: 7 })], selection: ["leadocean"] });
  assertEquals(plan.steps[0].maxRecords, 7);
  assert(plan.steps[0].allowanceLimited);
  assertEquals(plan.estimatedCredits.leadocean, 7);
});

Deno.test("routing: recent failures move auto routing to the healthier provider", () => {
  const r = req();
  r.hard = r.hard.filter((h) => h.key !== "industry" && h.key !== "excluded_company_types");
  const plan = planDiscovery({ requirements: r, connections: [conn("leadocean", { recentFailures: 3 }), conn("apollo")], selection: "auto" });
  assertEquals(plan.steps[0].provider, "apollo");
});

Deno.test("routing: every native filter in the table is one the adapter actually sends", () => {
  const r = req();
  for (const p of ["leadocean", "apollo"] as const) {
    const plan = planDiscovery({ requirements: r, connections: [conn(p), conn("apify")], selection: [p, "apify"] });
    const step = plan.steps.find((s) => s.provider === p)!;
    const body = p === "leadocean" ? buildLeadOceanSearch(step, r, null, 10).body : buildApolloSearch(step, r, 1).params;
    const sent = JSON.stringify(body);
    for (const native of step.requirements.filter((x) => x.handling === "native")) {
      const marker = { roles: p === "leadocean" ? "title" : "person_titles", geography_hq: p === "leadocean" ? "hqCountry" : "organization_locations", employee_range: p === "leadocean" ? "maxEmployees" : "organization_num_employees_ranges", industry: "industry", excluded_company_types: "excludeIndustry" }[native.key as string];
      assert(marker && sent.includes(marker), `${p} must send ${native.key}`);
    }
    if (p === "apollo") assertEquals((body as Record<string, unknown>).include_similar_titles, false);
  }
});

// ── 3. Searches ─────────────────────────────────────────────────────────────

async function runLeadOcean(rows: unknown[], meta: Record<string, unknown> = {}) {
  const f = mockFetch({ "POST /v1/search": [{ body: loPage(rows, meta) }] });
  const plan = planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] });
  const ledger = memoryLedger();
  const run = await runDiscovery({ workspaceId: WS, missionId: MISSION, requirements: req(), plan, approval: approve(plan), adapters: { leadocean: loAdapter(f) }, ledger, now: FIXED_NOW });
  return { run, f, ledger, plan };
}

Deno.test("search: LeadOcean people rows settle industry, size, exclusion and role from returned values; HQ rests on the filter alone; nothing qualifies", async () => {
  const { run, f } = await runLeadOcean(MARKET.map(loPerson));
  assertEquals(f.calls.length, 1);
  assertEquals(f.calls[0].headers["x-api-key"], "lo_test_key_123456");
  assertEquals(run.status, "completed");
  // A people row returns the employer's headcount but never its HQ (validation
  // test V), so HQ rests on LeadOcean's filter and no lead passes the provider checks.
  assertEquals(run.leads.filter((l) => l.providerStatus === "qualified").length, 0);
  const rejected = Object.fromEntries(run.leads.filter((l) => l.status === "rejected").map((l) => [l.company.name[0].value, l.checks.filter((c) => c.outcome === "contradicted").map((c) => c.key).join(",") || "contacts"]));
  assertEquals(rejected, {
    "Ward Industrial": "employee_range", "Patel Software": "industry",
    // A staffing firm is both outside the industry and of an excluded type.
    "Rivers Staffing": "industry,excluded_company_types", "Young Fasteners": "contacts",
  });
  // A German HQ is NOT visible in a people row: LeadOcean's filter is the only
  // thing standing between it and the list. It waits for verification.
  const byName = Object.fromEntries(run.leads.map((l) => [l.company.name[0].value, l]));
  assertEquals(byName["Hale Tooling GmbH"].status, "needs_verification");
  const five = ["Brooks Textile Mill", "Chen Precision Parts", "Lakeside Plastics", "Ortiz Metalworks", "Stonebridge Fabrication"];
  for (const n of five) {
    const c = Object.fromEntries(byName[n].checks.map((x) => [x.key, x.outcome]));
    assertEquals([c.industry, c.geography_hq, c.employee_range, c.excluded_company_types], ["matched", "provider_filter", "matched", "matched"], n);
  }
  // Provider-reported contradictions discard a lead; they do not disprove it.
  assert(run.leads.filter((l) => l.status === "rejected").every((l) => l.rejectionBasis === "provider_reported"));
  assertEquals(run.credits.leadocean, 10);
  // THE SHARED ENGINE DECIDES: a discovery row proves nothing, so none qualifies on it.
  assertEquals(run.counts.qualified, 0);
  const lead = byName["Stonebridge Fabrication"];
  assertEquals(lead.status, "needs_verification");
  assertEquals(lead.verification, null);
  assertEquals(lead.shared!.eligibility, "pending");
  assertEquals(lead.shared!.evidence_sources, { leadocean_discovery: lead.shared!.evidence_sources.leadocean_discovery });
  assertEquals(lead.shared!.hard_checks.geography, "unknown");
  assert(lead.reasons.some((r) => r.startsWith("geography: not established")));
  // Every value-backed check names its LeadOcean record and retrieval time.
  assert(lead.checks.filter((c) => c.outcome === "matched").every((c) => c.evidence.length > 0 && c.evidence.every((e) => e.provider === "leadocean" && e.retrievedAt === FIXED_NOW().toISOString())));
  // The title came from the CURRENT role's job_title; LeadOcean gives no data-update stamp.
  assertEquals(lead.contacts[0].person.title[0].value, "Founder & CEO");
  assertEquals(lead.company.sources[0].providerUpdatedAt, null);
});

Deno.test("search: empty results complete with zero leads and charge nothing", async () => {
  const { run } = await runLeadOcean([], { credits: 0 });
  assertEquals(run.status, "completed");
  assertEquals(run.leads.length, 0);
  assertEquals(run.credits.leadocean, 0);
});

Deno.test("search: a filter LeadOcean reports ignoring is never treated as applied", async () => {
  const rows = [loPerson({ ...MARKET[0], employees: undefined })];
  const { run } = await runLeadOcean(rows, { unsupportedFilters: ["maxEmployees"] });
  const lead = run.leads[0];
  const size = lead.checks.find((c) => c.key === "employee_range")!;
  assertEquals(size.outcome, "unknown");
  assert(size.note.includes("ignoring"));
  assertEquals(lead.status, "needs_verification");
  assertEquals(run.steps[0].ignoredFilters, ["employee_range"]);
});

Deno.test("search: a native filter with no value returned does NOT qualify a lead by default (fail closed)", async () => {
  const { run } = await runLeadOcean([loPerson({ ...MARKET[0], employees: undefined })]);
  const lead = run.leads[0];
  const size = lead.checks.find((c) => c.key === "employee_range")!;
  assertEquals(size.outcome, "provider_filter");
  assertEquals(size.trusted, false);
  assertEquals(lead.status, "needs_verification");
  assertEquals(lead.verification, null);
  assert(lead.reasons.some((r) => r.includes("not independently confirmed")));
});

Deno.test("search: only a reviewed trust entry lets a provider filter stand in for a value — and only for that provider and key", async () => {
  const rows = [loPerson({ ...MARKET[0], employees: undefined })];
  const merged = mergeRecords([], normalizeLeadOceanPage(loPage(rows), planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] }).steps[0], "t").people);
  assertEquals(verifyLeads(req(), merged, [], { trustedFilters: { apollo: ["employee_range"] } })[0].status, "needs_verification", "another provider's trust does not count");
  assertEquals(verifyLeads(req(), merged, [], { trustedFilters: { leadocean: ["industry"] } })[0].status, "needs_verification", "another key's trust does not count");
  assertEquals(verifyLeads(req(), merged, [], { trustedFilters: { leadocean: ["employee_range"] } })[0].providerStatus, "needs_verification", "HQ is still filter-only and untrusted");
  const [ok] = verifyLeads(req(), merged, [], { trustedFilters: { leadocean: ["employee_range", "geography_hq"] } });
  assertEquals(ok.providerStatus, "qualified");
  // Trust in a provider's filter is a provider-check matter; the shared engine still decides.
  assertEquals(ok.status, "needs_verification");
});

Deno.test("search: a trusted filter the provider reported ignoring is unknown, never trusted", async () => {
  const rows = [loPerson({ ...MARKET[0], employees: undefined })];
  const step = planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] }).steps[0];
  const merged = mergeRecords([], normalizeLeadOceanPage(loPage(rows, { unsupportedFilters: ["maxEmployees"] }), step, "t").people);
  const [lead] = verifyLeads(req(), merged, [], { trustedFilters: { leadocean: ["employee_range"] } });
  assertEquals(lead.checks.find((c) => c.key === "employee_range")!.outcome, "unknown");
  assertEquals(lead.status, "needs_verification");
});

Deno.test("search: pagination is bounded by maxRecords — and with thin rows nothing passes, so the walk reads to the cap", async () => {
  const page1 = loPage(MARKET.slice(0, 3).map(loPerson), { nextCursor: "c2" });
  const page2 = loPage(MARKET.slice(3, 10).map(loPerson), { nextCursor: "c3" });
  const f = mockFetch({ "POST /v1/search": [{ body: page1 }, { body: page2 }, { body: loPage([loPerson({ ...MARKET[0], id: "never" })]) }] });
  const r = req();
  const plan = planDiscovery({ requirements: r, connections: [conn("leadocean")], selection: ["leadocean"], limits: { maxRecordsPerStep: 12 } });
  const run = await runDiscovery({ workspaceId: WS, missionId: MISSION, requirements: r, plan, approval: approve(plan), adapters: { leadocean: loAdapter(f) }, ledger: memoryLedger(), now: FIXED_NOW });
  // maxRecords 12 at 10 a page is two pages at most: the third cursor is never followed.
  assertEquals(f.calls.length, 2);
  assertEquals((f.calls[1].body as Record<string, unknown>).cursor, "c2");
  assert(run.steps[0].rows <= 12);
  // A multi-page walk uses stable order so the cursor stays consistent.
  assertEquals((f.calls[0].body as Record<string, unknown>).order, "stable");
  assertEquals(run.leads.filter((l) => l.providerStatus === "qualified").length, 0);
  assertEquals(run.counts.qualified, 0, "more pages cannot prove what only canonical evidence can");
});

// ── 4. Failures ─────────────────────────────────────────────────────────────

Deno.test("failure: auth failure on the primary fails over to the fallback; nothing is retried with the bad key", async () => {
  const f = mockFetch({
    "POST /v1/search": [{ status: 401, body: { success: false, error: { message: "invalid api key" } } }],
    "POST /api/v1/mixed_people/api_search": [{ body: { total_entries: 1, people: [apPerson("ap-1", "Avery", "Founder & CEO", { name: "Stonebridge Fabrication", primary_domain: "stonebridgefab.example" })] } }],
  });
  const r = req();
  const plan = planDiscovery({ requirements: r, connections: ALL_CONNECTED, selection: "auto" });
  const invoke: ActorInvoker = async () => ({ items: [{ text: "Stonebridge Fabrication — precision metal manufacturing in Ohio." }], runId: "run-1" });
  const run = await runDiscovery({
    workspaceId: WS, missionId: MISSION, requirements: r, plan, approval: approve(plan),
    adapters: { leadocean: loAdapter(f), apollo: apAdapter(f) }, verifier: apifyAdapter(invoke, { idempotencyPrefix: MISSION, now: FIXED_NOW }),
    ledger: memoryLedger(), now: FIXED_NOW,
  });
  assertEquals(f.calls.filter((c) => c.url.includes("leadocean")).length, 1);
  assertEquals(run.steps.map((s) => [s.provider, s.status, s.errorKind]), [["leadocean", "failed", "auth_failed"], ["apollo", "completed", null]]);
  assertEquals(run.status, "partial");
  const lead = run.leads[0];
  // A People API Search row names its employer and nothing else: no domain, so
  // no website check can be aimed at it and nothing here establishes the company.
  assertEquals(lead.company.domain, []);
  assertEquals(lead.company.name[0].value, "Stonebridge Fabrication");
  assertEquals(Object.fromEntries(lead.checks.map((c) => [c.key, c.outcome])), {
    industry: "unknown", geography_hq: "provider_filter", employee_range: "provider_filter", excluded_company_types: "unknown",
  });
  assertEquals(lead.status, "needs_verification");
  assertEquals(lead.verification, null);
  assertEquals(run.verification?.checked, 0, "no domain, no site read");
});

Deno.test("failure: an outage (503) is retried within bounds, then the step fails cleanly", async () => {
  const ok = mockFetch({ "POST /v1/search": [{ status: 503, body: { error: { message: "no_source" } } }, { body: loPage([loPerson(MARKET[0])]) }] });
  const page = await loAdapter(ok).search(planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] }).steps[0], req(), null, 10);
  assertEquals(ok.calls.length, 2);
  assertEquals(page.people.length, 1);

  const down = mockFetch({ "POST /v1/search": [{ status: 503 }] });
  const { run } = await (async () => {
    const plan = planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] });
    return { run: await runDiscovery({ workspaceId: WS, missionId: MISSION, requirements: req(), plan, approval: approve(plan), adapters: { leadocean: loAdapter(down) }, ledger: memoryLedger(), now: FIXED_NOW }) };
  })();
  assertEquals(down.calls.length, 3);
  assertEquals(run.status, "failed");
  assertEquals(run.steps[0].errorKind, "outage");
});

Deno.test("failure: 429 honours Retry-After, and a wait past the bound ends as rate_limited", async () => {
  const waits: number[] = [];
  const f = mockFetch({ "POST /x": [{ status: 429, headers: { "retry-after": "2" } }, { body: { ok: true } }] });
  const r = await callProvider(f.fetch, { provider: "leadocean", url: "https://api.leadocean.io/x", method: "POST", headers: {}, paid: true }, async (ms) => { waits.push(ms); });
  assertEquals(waits, [2000]);
  assertEquals(r.attempts, 2);

  const slow = mockFetch({ "POST /x": [{ status: 429, headers: { "retry-after": "3600" } }] });
  const e = await assertRejects(() => callProvider(slow.fetch, { provider: "leadocean", url: "https://api.leadocean.io/x", method: "POST", headers: {}, paid: true }, noSleep), ProviderError);
  assertEquals(e.kind, "rate_limited");
  assertEquals(slow.calls.length, 1);
});

Deno.test("failure: 402 / exhausted quota stops the provider without retrying", async () => {
  const f = mockFetch({ "POST /v1/search": [{ status: 402, body: { success: false, error: { message: "quota exceeded" } }, headers: { "x-quota-state": "exhausted" } }] });
  const plan = planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] });
  const run = await runDiscovery({ workspaceId: WS, missionId: MISSION, requirements: req(), plan, approval: approve(plan), adapters: { leadocean: loAdapter(f) }, ledger: memoryLedger(), now: FIXED_NOW });
  assertEquals(f.calls.length, 1);
  assertEquals(run.steps[0].errorKind, "allowance_exhausted");
});

Deno.test("failure: a paid request that fails in transit is charge_uncertain — never retried, and the re-run is blocked", async () => {
  const f = mockFetch({ "POST /v1/search": ["network_error", { body: loPage([loPerson(MARKET[0])]) }] });
  const plan = planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] });
  const ledger = memoryLedger();
  const args = { workspaceId: WS, missionId: MISSION, requirements: req(), plan, approval: approve(plan), adapters: { leadocean: loAdapter(f) }, ledger, now: FIXED_NOW };
  const first = await runDiscovery(args);
  assertEquals(first.steps[0].errorKind, "charge_uncertain");
  assertEquals(f.calls.length, 1);
  const again = await runDiscovery(args);
  assertEquals(again.steps[0].errorKind, "charge_uncertain");
  assertEquals(f.calls.length, 1, "the same page is not bought twice");
});

Deno.test("failure: a free request that fails in transit is retried", async () => {
  const f = mockFetch({ "GET /v1/account": ["network_error", { body: { success: true, data: { account: { plan: "solo" }, key: { scopes: ["search", "enrich"] }, records: { ceiling: 1000, used: 10, remaining: 990 } } } }] });
  const u = await loAdapter(f).verifyKey();
  assertEquals(f.calls.length, 2);
  assertEquals(u.remaining, 990);
});

// ── 5. Duplicates and provenance ────────────────────────────────────────────

Deno.test("merge: the same company from two providers becomes one record with both sources and no value lost", () => {
  const lo: ProviderCompany = { provider: "leadocean", recordId: "lo-c-1", retrievedAt: "t1", name: "Stonebridge Fabrication", domain: "https://www.StonebridgeFab.example/about", employeeCount: 42, industry: ["Machinery Manufacturing"], hqCountry: "United States" };
  const ap: ProviderCompany = { provider: "apollo", recordId: "ap-o-1", retrievedAt: "t2", name: "Stonebridge Fab", domain: "stonebridgefab.example", employeeCount: 140 };
  const m = mergeRecords([lo, ap], []);
  assertEquals(m.companies.length, 1);
  const c = m.companies[0];
  assertEquals(c.sources.map((s) => s.provider), ["leadocean", "apollo"]);
  assertEquals(c.name.map((n) => n.value), ["Stonebridge Fabrication", "Stonebridge Fab"]);
  assertEquals(c.conflicts.map((x) => x.field), ["employeeCount"]);
  assertEquals(c.conflicts[0].values.map((v) => v.value), [42, 140]);
});

Deno.test("merge: contradictory headcounts make the size check conflicting — needs verification, not qualified", () => {
  const r = req();
  const lo: ProviderPerson = { provider: "leadocean", recordId: "p1", retrievedAt: "t", fullName: "Avery Stone", title: "CEO", linkedinUrl: "https://linkedin.com/in/avery-stone", company: { provider: "leadocean", recordId: "c1", retrievedAt: "t", name: "Stonebridge", domain: "stonebridgefab.example", employeeCount: 42, industry: ["Manufacturing"], hqCountry: "US" } };
  const ap: ProviderPerson = { provider: "apollo", recordId: "a1", retrievedAt: "t", firstName: "Avery", title: "Founder & CEO", linkedinUrl: "https://www.linkedin.com/in/avery-stone/", company: { provider: "apollo", recordId: "o1", retrievedAt: "t", name: "Stonebridge", domain: "stonebridgefab.example", employeeCount: 400 } };
  const m = mergeRecords([], [lo, ap]);
  assertEquals(m.people.length, 1);
  assertEquals(m.people[0].sources.length, 2);
  const [lead] = verifyLeads(r, m);
  assertEquals(lead.checks.find((c) => c.key === "employee_range")!.outcome, "conflicting");
  assertEquals(lead.status, "needs_verification");
});

Deno.test("merge: one LinkedIn page with two different domains is an identity conflict, not a merge", () => {
  const a: ProviderCompany = { provider: "leadocean", recordId: "1", retrievedAt: "t", name: "Acme", domain: "acme.example", linkedinUrl: "https://linkedin.com/company/acme" };
  const b: ProviderCompany = { provider: "apollo", recordId: "2", retrievedAt: "t", name: "Acme", domain: "acme-holdings.example", linkedinUrl: "https://linkedin.com/company/acme" };
  const m = mergeRecords([a, b], []);
  assertEquals(m.companies.length, 2);
  assertEquals(m.stats.identityConflicts, 1);
  const [lead] = verifyLeads(req(), m);
  assertFalse(lead.status === "qualified");
});

Deno.test("merge: duplicate people from one provider across pages collapse; no contact point duplicated", () => {
  const p = loPerson(MARKET[0]);
  const page = normalizeLeadOceanPage(loPage([p, p]), planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] }).steps[0], "t");
  const m = mergeRecords([], page.people);
  assertEquals(m.people.length, 1);
  assertEquals(m.people[0].contactPoints.length, 2);
});

// ── 6. Missing and wrong information ────────────────────────────────────────

Deno.test("verify: missing industry and size with no provider filter is unknown → needs verification", () => {
  const r = req();
  const m = mergeRecords([], [{ provider: "apify", recordId: "w1", retrievedAt: "t", fullName: "X", title: "CEO", company: { provider: "apify", recordId: "web:x.example", retrievedAt: "t", name: "X", domain: "x.example" } }]);
  const [lead] = verifyLeads(r, m);
  assertEquals(lead.status, "needs_verification");
  assert(lead.checks.filter((c) => c.outcome === "unknown").length >= 3);
});

Deno.test("verify: role matching is strict — VP is not President, co-founder is a founder", () => {
  assert(titleMatchesRole("Co-Founder & CTO", "Founder"));
  assert(titleMatchesRole("Chief Executive Officer", "CEO"));
  assertFalse(titleMatchesRole("Vice President of Sales", "President"));
  assertFalse(titleMatchesRole("Founder's Associate Program Manager", "CEO"));
  assertFalse(titleMatchesRole("Marketing Coordinator", "CEO"));
});

Deno.test("verify: a state or city requirement is contradicted by a non-US country", () => {
  const r = req();
  const geo = r.hard.find((h) => h.key === "geography_hq")!;
  geo.values = ["Ohio"];
  const m = mergeRecords([{ provider: "leadocean", recordId: "1", retrievedAt: "t", name: "Y", domain: "y.example", hqCountry: "Canada" }], []);
  const [lead] = verifyLeads({ ...r, targetEntity: "company" }, m);
  assertEquals(lead.checks.find((c) => c.key === "geography_hq")!.outcome, "contradicted");
});

// ── 7. Contacts and enrichment ──────────────────────────────────────────────

Deno.test("contacts: a provider phone is never verified; a provider-verified email says whose verification it is", async () => {
  const { run } = await runLeadOcean([loPerson(MARKET[0])]);
  const person = run.leads[0].contacts[0].person;
  const phone = person.contactPoints.find((c) => c.kind === "phone")!;
  const email = person.contactPoints.find((c) => c.kind === "email")!;
  assertEquals(phone.verification, "provider_supplied_unverified");
  assertEquals(email.verification, "provider_reported_verified");
  assertEquals(email.providerVerifiedAt, "2026-09-01");
  assertEquals(attachIndependentEvidence(phone, []).verification, "provider_supplied_unverified");
  assertEquals(attachIndependentEvidence(phone, [{ kind: "leadocean", ref: "self", at: "t" }]).verification, "provider_supplied_unverified", "the same provider is not independent");
  assertEquals(attachIndependentEvidence(phone, [{ kind: "call_outcome", ref: "call-1", at: "t" }]).verification, "independently_verified");
});

Deno.test("projection: discovery writes no contact values to the Leads tables, and rejected leads are not written", async () => {
  const { run } = await runLeadOcean(MARKET.map(loPerson));
  const rows = run.leads.map((l) => projectLead(l, { workspaceId: WS, missionId: MISSION, run })).filter((x) => x !== null);
  // Six wait for verification (incl. the one whose wrong HQ no people row shows); four are rejected.
  assertEquals(rows.length, 6);
  for (const r of rows) {
    assertEquals(r!.account.workspace_id, WS);
    assert(r!.account.source.startsWith("provider_discovery:"));
    for (const c of r!.contacts) { assertEquals(c.email, null); assertEquals(c.phone, null); }
    const json = JSON.stringify(r);
    assertFalse(json.includes("+1 555"), "no phone value anywhere in the projected rows");
    assertFalse(json.includes("@stonebridgefab.example"), "no email value anywhere in the projected rows");
  }
  const a = rows.find((r) => r!.account.name === "Stonebridge Fabrication")!;
  const att = a.account.raw.agentory_discovery as Record<string, unknown>;
  assertEquals(att.status, "needs_verification");
  assertEquals(att.provider_status, "needs_verification", "HQ and size are filter-only in a thin row");
  assertEquals((att.shared_qualification as { eligibility: string }).eligibility, "pending");
  assertEquals((att.providers as { provider: string }[])[0].provider, "leadocean");
  const avail = (a.contacts[0].raw.agentory_discovery as { availability: Record<string, unknown> }).availability;
  assertEquals(avail.phone, true);
  assertEquals(avail.phone_verification, "provider_supplied_unverified");
});

Deno.test("enrichment: refused without its own authorization — a discovery approval is not one", async () => {
  const { run, plan } = await runLeadOcean([loPerson(MARKET[0])]);
  let calls = 0;
  const people = run.leads[0].contacts.map((c) => c.person);
  const ledger = memoryLedger();
  const base = { workspaceId: WS, missionId: MISSION, people, deps: { apiKey: "k", fetch: () => { throw new Error("no"); } }, ledger, call: async () => { calls++; return { found: true, contactPoints: [], credits: 1 }; } };
  assertEquals((await enrichContacts({ ...base, authorization: null }))[0].status, "refused");
  assertEquals((await enrichContacts({ ...base, authorization: approve(plan) as never }))[0].reason, "a discovery approval does not authorize enrichment");
  const other: EnrichmentAuthorization = { kind: "enrichment", workspaceId: OTHER_WS, missionId: MISSION, personKeys: people.map((p) => p.key), revealEmail: true, phones: true, maxCredits: 5, approvedBy: "u", approvedAt: "t" };
  assertEquals((await enrichContacts({ ...base, authorization: other }))[0].reason, "authorization belongs to another workspace");
  const notNamed: EnrichmentAuthorization = { ...other, workspaceId: WS, personKeys: ["someone-else"] };
  assertEquals((await enrichContacts({ ...base, authorization: notNamed }))[0].reason, "person not named in the authorization");
  assertEquals(calls, 0);
});

Deno.test("enrichment: authorized calls are idempotent and phones stay unverified", async () => {
  const { run } = await runLeadOcean([loPerson(MARKET[0])]);
  const people = run.leads[0].contacts.map((c) => c.person);
  const f = mockFetch({ "POST /v1/enrich": [{ body: { found: true, data: loPerson(MARKET[0]), meta: { credits: 1 } } }] });
  const ledger = memoryLedger();
  const auth: EnrichmentAuthorization = { kind: "enrichment", workspaceId: WS, missionId: MISSION, personKeys: people.map((p) => p.key), revealEmail: false, phones: true, maxCredits: 1, approvedBy: "u", approvedAt: "t" };
  const args = { workspaceId: WS, missionId: MISSION, authorization: auth, people, deps: { apiKey: "lo_test_key_123456", fetch: f.fetch, sleep: noSleep, now: FIXED_NOW }, ledger };
  const [first] = await enrichContacts(args);
  assertEquals(first.status, "enriched");
  assertEquals(first.contactPoints.map((c) => [c.kind, c.verification]), [["phone", "provider_supplied_unverified"]], "email not revealed when not authorized");
  const [again] = await enrichContacts(args);
  assertEquals(again.status, "replayed");
  assertEquals(f.calls.length, 1);
  assertEquals(await ledger.spent(WS, MISSION, "leadocean"), 1);
});

// ── 8. Approval, limits, isolation ──────────────────────────────────────────

Deno.test("approval: no approval, another plan, another workspace or too small a cap — the paid search does not run", async () => {
  const f = mockFetch({ "POST /v1/search": [{ body: loPage([loPerson(MARKET[0])]) }] });
  const r = req();
  const plan = planDiscovery({ requirements: r, connections: [conn("leadocean")], selection: ["leadocean"] });
  const base = { workspaceId: WS, missionId: MISSION, requirements: r, plan, adapters: { leadocean: loAdapter(f) }, ledger: memoryLedger(), now: FIXED_NOW };
  for (const [approval, why] of [
    [null, "approval required"],
    [approve(plan, { planHash: "deadbeef" }), "plan changed"],
    [approve(plan, { workspaceId: OTHER_WS }), "another workspace"],
    [approve(plan, { missionId: "other" }), "another mission"],
    [approve(plan, { maxCredits: { leadocean: 3 } }), "does not cover leadocean"],
  ] as const) {
    const run = await runDiscovery({ ...base, approval });
    assertEquals(run.status, "blocked");
    assert(run.reason!.includes(why), `${run.reason} ⊅ ${why}`);
  }
  assertEquals(f.calls.length, 0);
});

Deno.test("approval: a free Apollo-only search needs none, and the plan says so", () => {
  const r = req();
  r.hard = r.hard.filter((h) => h.key !== "industry" && h.key !== "excluded_company_types");
  const plan = planDiscovery({ requirements: r, connections: [conn("apollo")], selection: ["apollo"] });
  assertEquals(plan.status, "ready");
  assertFalse(plan.requiresApproval);
  assertEquals(checkDiscoveryApproval(plan, null, { workspaceId: WS, missionId: MISSION }), { ok: true });
});

Deno.test("limits: the ledger's provider cap stops a provider that bills more than approved", async () => {
  // Ten rows that do not qualify (wrong country), billed at 15 instead of 10.
  const wrong = Array.from({ length: 10 }, (_, i) => loPerson({ ...MARKET[0], id: `p${i}`, domain: `d${i}.example`, name: `Person ${i}`, country: "Germany" }));
  const f = mockFetch({ "POST /v1/search": [{ body: loPage(wrong, { nextCursor: "c2", credits: 15 }) }, { body: loPage(wrong) }] });
  const r = { ...req(), requestedCount: 10 };
  const plan = planDiscovery({ requirements: r, connections: [conn("leadocean")], selection: ["leadocean"], limits: { maxRecordsPerStep: 20 } });
  assertEquals([plan.steps[0].pageSize, plan.steps[0].maxPages, plan.estimatedCredits.leadocean], [10, 2, 20]);
  const run = await runDiscovery({ workspaceId: WS, missionId: MISSION, requirements: r, plan, approval: approve(plan), adapters: { leadocean: loAdapter(f) }, ledger: memoryLedger(), now: FIXED_NOW });
  assertEquals(f.calls.length, 1, "page 2 would exceed the approved 20");
  assertEquals(run.steps[0].status, "stopped");
  assertEquals(run.steps[0].errorKind, "provider_cap");
  assertEquals(run.credits.leadocean, 15);
});

Deno.test("idempotency: re-running an approved plan replays its pages instead of buying them again", async () => {
  const f = mockFetch({ "POST /v1/search": [{ body: loPage(MARKET.map(loPerson)) }] });
  const r = req();
  const plan = planDiscovery({ requirements: r, connections: [conn("leadocean")], selection: ["leadocean"] });
  const ledger = memoryLedger();
  const args = { workspaceId: WS, missionId: MISSION, requirements: r, plan, approval: approve(plan), adapters: { leadocean: loAdapter(f) }, ledger, now: FIXED_NOW };
  const a = await runDiscovery(args);
  const b = await runDiscovery(args);
  assertEquals(f.calls.length, 1);
  assertEquals(b.steps[0].replayedPages, 1);
  assertEquals(b.counts, a.counts);
  assertEquals(await ledger.spent(WS, MISSION), 10);
});

Deno.test("isolation: one workspace's ledger entries never satisfy or block another's", async () => {
  const ledger = memoryLedger();
  const e = { missionId: MISSION, provider: "leadocean" as const, key: "same-key", credits: 5, providerCap: 5, missionCap: 5 };
  assertEquals(await ledger.reserve({ ...e, workspaceId: WS }), { ok: true, replay: false });
  await ledger.settle("same-key", 5, { rows: 1 });
  assertEquals(await ledger.reserve({ ...e, workspaceId: OTHER_WS }), { ok: true, replay: false });
  assertEquals(await ledger.spent(OTHER_WS, MISSION), 5);
});

Deno.test("descriptors: Apollo People Search is documented free and returns no contact values", () => {
  assertEquals(PROVIDERS.apollo.cost.people_search, { unit: "free", creditsPerUnit: 0 });
  assertFalse(PROVIDERS.apollo.searchReturnsContactValues);
  assert(PROVIDERS.leadocean.requiresCommercialTermsFlag);
});
