// The benchmark runner, rehearsed offline against documented response shapes.
//
// A SYNTHETIC cohort (.example companies) drives the mocked runs: provider rows
// about real companies would be invented facts. The REAL cohort is planned
// without any fetch, so the live worst case below is computed by the same code
// that enforces it.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { evaluateEligibility } from "../../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../../supabase/functions/_shared/evidenceGraph.ts";
import { observationFromCompany } from "../../../../supabase/functions/_shared/candidateObservation.ts";
import { apolloAdapter } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/apollo.ts";
import { leadOceanAdapter } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import { scoreProvider, type Cohort } from "../../../../supabase/functions/_shared/discoveryProviders/benchmark.ts";
import { runProviderBenchmark, type RunnerInput } from "../../../../supabase/functions/_shared/discoveryProviders/benchmarkRunner.ts";
import { memoryLedger } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { requirementsFromMission } from "../../../../supabase/functions/_shared/discoveryProviders/requirements.ts";
import { FIXED_NOW, conn, loPage, loPerson, mockFetch, noSleep, type Synthetic } from "./fixtures.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const ROOT = new URL("../../../../", import.meta.url);
const readJson = async (p: string) => JSON.parse(await Deno.readTextFile(new URL(p, ROOT)));

async function missionC() {
  const f = await readJson("benchmarks/provider-discovery/mission-c-proposal.json");
  return requirementsFromMission(compileLeadMission({ originalUserQuery: f.query, proposal: f.proposal, requestedCount: 10 }).final_mission as never);
}

const HOLD = { existing_lead_id: null, outreach_hold: false, crm_relationship: null };
const SYNTH: Cohort = {
  version: "synthetic-v1",
  known_companies: [
    { slot: "A01", status: "selected", name: "Alpha", domain: "alpha.example", linkedin_url: "https://www.linkedin.com/company/alpha", truth_hq_country: "United States", suppression: HOLD },
    { slot: "A02", status: "selected", name: "Beta", domain: null, linkedin_url: "https://www.linkedin.com/company/beta", truth_hq_country: null, suppression: HOLD },
    { slot: "A03", status: "selected", name: "Gamma", domain: "gamma.example", linkedin_url: null, truth_hq_country: null, suppression: { ...HOLD, existing_lead_id: "lead-1" } },
  ],
  known_decision_makers: [{ slot: "B01", status: "unfilled", unfilled_reason: "none" }],
  discovery: { mission_query: "c", requested_count: 10 },
};

const loCompanyRow = (domain: string, li: string | null, country = "United States") =>
  ({ company_data: { company_name: domain.split(".")[0], company_domain: domain, ...(li ? { company_linkedin_url: li } : {}), company_hq_country: country, company_employee_range: "51-200" }, meta: { source_ids: { company_id: `lo-c-${domain}` } } });
const DISCOVERED: Synthetic[] = Array.from({ length: 10 }, (_, i) => ({
  id: `lo-p${i}`, name: `Person ${i}`, title: "VP of Sales", company: `Co ${i}`, domain: `co${i % 8}.example`, employees: 120, phone: i % 2 ? "+1 555 0100" : undefined,
}));
const accountRead = (used: number) => ({ body: { success: true, data: { account: { plan: "free" }, key: { scopes: ["search", "enrich"] }, records: { ceiling: 1000, used, remaining: 1000 - used } } } });

function loInput(f: ReturnType<typeof mockFetch>, over: Partial<RunnerInput> = {}): Promise<RunnerInput> {
  return missionC().then((discovery) => ({
    provider: "leadocean", cohort: SYNTH, discovery, fetch: f.fetch as never, ledger: memoryLedger(), workspaceId: WS,
    makeAdapter: (fetch) => leadOceanAdapter({ apiKey: "lo_test_key_123456", fetch, sleep: noSleep, now: FIXED_NOW }),
    approvedUnits: 12, connection: conn("leadocean"), usdPerUnit: 0, now: FIXED_NOW, ...over,
  }));
}

Deno.test("runner (LeadOcean): exact lookups + one discovery page inside the approved units, reconciled against /v1/account", async () => {
  const f = mockFetch({
    "GET /v1/account": [accountRead(0), accountRead(12)],
    "POST /v1/search/companies": [{ body: loPage([loCompanyRow("alpha.example", "https://www.linkedin.com/company/alpha")], { credits: 1 }) },
      { body: loPage([loCompanyRow("beta.example", "https://www.linkedin.com/company/beta", "Canada")], { credits: 1 }) }],
    "POST /v1/search": [{ body: loPage(DISCOVERED.map(loPerson), { credits: 10 }) }],
  });
  const rep = await runProviderBenchmark(await loInput(f));
  assertEquals(rep.refused, null);
  assertEquals(rep.worstCaseUnits, 12, "A01 + A02 one record each, discovery ten; A03 is held");
  assertEquals(rep.steps.find((s) => s.slot === "A03")!.skipped, "suppressed (hold, CRM or existing Lead)");
  assertEquals([rep.ledgerUnits, rep.providerReportedUnits, rep.reconciled], [12, 12, true]);
  // The lookups were exact: domain for A01, LinkedIn for A02, limit 1 each.
  const lookups = f.calls.filter((c) => c.url.endsWith("/v1/search/companies")).map((c) => c.body as Record<string, unknown>);
  assertEquals(lookups.map((b) => [b.domain ?? null, b.linkedin ?? null, b.limit]), [[["alpha.example"], null, 1], [null, ["https://www.linkedin.com/company/beta"], 1]]);
  // Discovery: the mission's filters, translated exactly, one page of ten.
  const d = f.calls.find((c) => c.url.endsWith("/v1/search"))!.body as Record<string, unknown>;
  assertEquals([d.hqCountry, d.minEmployees, d.maxEmployees, d.title, d.limit], [["US"], 51, 200, ["VP of Sales"], 10]);
  // Score it with the identical rules.
  const s = scoreProvider(SYNTH, rep.result, null, FIXED_NOW().toISOString());
  assertEquals([s.companyMatching.numerator, s.companyMatching.denominator], [2, 2]);
  assertEquals([s.headquartersVerification.numerator, s.headquartersVerification.denominator], [1, 1]);
  assertEquals(s.duplicateRate.denominator, 10);
  assertEquals(s.duplicateRate.numerator, 2, "ten rows over eight employers");
  assertEquals(s.uniqueQualified.qualified, 0, "no canonical evidence offline: nothing qualifies on a provider's word");
  assertEquals(s.costPerQualified.usd, null);
  assertEquals(s.latencyMs.count, 5, "two account reads, two lookups, one discovery page");
  // Thin people rows return neither HQ nor size: both checks on all eight employers rest on the filter alone.
  assertEquals(s.evidenceQuality, { returnedValue: 0, filterOnly: 16, nothing: 0, share: 0 });
  // meta.fetched_at is LeadOcean's freshness stamp: 2026-10-20, 7.5 days before the run (rounded), on all eight employers.
  assertEquals([s.freshnessDays.stamped, s.freshnessDays.median], [8, 8]);
  assertFalse(JSON.stringify(rep).includes("+1 555"), "no contact value anywhere in the report");
});

Deno.test("runner: a worst case above the approved units refuses the WHOLE run before any call", async () => {
  const f = mockFetch({});
  const rep = await runProviderBenchmark(await loInput(f, { approvedUnits: 11 }));
  assertEquals(rep.refused, "worst case 12 units exceeds the approved 11");
  assertEquals(f.calls.length, 0);
});

Deno.test("runner: an uncertain charge stops the provider — nothing after it is sent, and a re-run does not re-buy it", async () => {
  const replies = { "GET /v1/account": [accountRead(0)], "POST /v1/search/companies": ["network_error" as const], "POST /v1/search": [{ body: loPage([]) }] };
  const f = mockFetch(replies);
  const ledger = memoryLedger();
  const rep = await runProviderBenchmark(await loInput(f, { ledger }));
  assertEquals(rep.stoppedBy, "charge_uncertain");
  assertEquals(f.calls.filter((c) => c.method === "POST").length, 1, "one paid attempt, no retry, nothing after it");
  assert(rep.steps.filter((s) => s.skipped?.startsWith("not run")).length >= 2);
  const g = mockFetch(replies);
  const again = await runProviderBenchmark(await loInput(g, { ledger }));
  assertEquals(g.calls.filter((c) => c.url.endsWith("/v1/search/companies")).length, 0, "the uncertain page is never bought again");
  assertEquals(again.stoppedBy, "charge_uncertain");
});

Deno.test("runner (Apollo, this account's plan): people search restricted → Organization Search; LinkedIn-only slots are not guessed by name", async () => {
  const f = mockFetch({
    "POST /api/v1/usage_stats/api_usage_stats": [{ body: {} }],
    "POST /api/v1/mixed_people/api_search": [{ status: 403, body: { error_code: "API_INACCESSIBLE" } }],
    "POST /api/v1/mixed_companies/search": [{ status: 403, body: { error_code: "API_INACCESSIBLE", error_details: { code: "AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED" } } }],
  });
  const rep = await runProviderBenchmark({
    ...(await loInput(f)), provider: "apollo", approvedUnits: 2,
    makeAdapter: (fetch) => apolloAdapter({ apiKey: "ap_test_key_123456", fetch, sleep: noSleep, now: FIXED_NOW }),
    connection: { ...conn("apollo"), restrictions: ["people_search: not in this plan"] },
  });
  assertEquals(rep.worstCaseUnits, 2, "A01 by domain (1 page) + discovery (1 page)");
  assertEquals(rep.steps.find((s) => s.slot === "A02")!.skipped, "Apollo filters companies by domain only; this slot has no domain");
  assertEquals(rep.steps.find((s) => s.id === "discovery")!.plan!.steps[0].kind, "company_search");
  // If Organization Search is also outside the plan, the first 403 (which bills nothing) stops Apollo.
  assertEquals(rep.stoppedBy, "plan_restricted");
  assertEquals(f.calls.filter((c) => c.url.includes("mixed_companies")).length, 1);
  assertEquals(rep.ledgerUnits, 0);
});

Deno.test("runner: the REAL cohort's live worst case, planned with no fetch", async () => {
  const cohort = await readJson("benchmarks/provider-discovery/cohort.json") as Cohort;
  const discovery = await missionC();
  const noFetch = (() => { throw new Error("planning must not fetch"); }) as never;
  const plan = async (provider: "apollo" | "leadocean", restrictions: string[] = []) => runProviderBenchmark({
    provider, cohort, discovery, fetch: noFetch, ledger: memoryLedger(), workspaceId: WS, approvedUnits: 0,
    makeAdapter: (fetch) => (provider === "apollo" ? apolloAdapter : leadOceanAdapter)({ apiKey: "k_planning_only_1", fetch, sleep: noSleep, now: FIXED_NOW }),
    connection: { ...conn(provider), restrictions }, usdPerUnit: null, now: FIXED_NOW,
  });
  const lo = await plan("leadocean");
  assertEquals([lo.worstCaseUnits, lo.refused !== null], [13, true], "3 exact lookups + 10 discovery records");
  const ap = await plan("apollo", ["people_search: not in this plan"]);
  // Baseten and Oscilar now carry domains from Agentory's own evidence: Apollo can look all three up.
  assertEquals([ap.worstCaseUnits, ap.refused !== null], [4, true], "three domain lookups + 1 Organization Search page");
  assertEquals(ap.steps.filter((s) => s.skipped?.startsWith("Apollo filters companies by domain only")).length, 0);
});

Deno.test("KNOWN ISSUE (shared engine, Apify-owned): a restated size constraint keeps every company pending — remove when fixed", async () => {
  const f = await readJson("benchmarks/provider-discovery/mission-c-proposal.json");
  const restated = { ...f.proposal, hard_constraints: [...f.proposal.hard_constraints,
    { field: "employee_min", operator: "gte", value: 51, reason: "51-200" }, { field: "employee_max", operator: "lte", value: 200, reason: "51-200" }] };
  const record = observationFromCompany({ external_source_id: "li_company:1", company_name: "A", canonical_domain: "a.example", linkedin_company_url: "https://www.linkedin.com/company/a", website: "https://a.example", description: null, provider_industry: null, industry_ids: [], linkedin_associated_member_count: null, company_size_band: { min: 51, max: 200, source: "linkedin_declared" }, employee_range_advisory: null, geography: "Austin, Texas, United States", location_entries: [{ text: "Austin, Texas, United States", is_headquarters: true, country: "United States" }], company_type: null, startup_evidence: null, hiring_status: null, source_provenance: "x", raw_ref: { source_id: "1" } } as never,
    { capability: "c", actor_key: "apify_linkedin_company_details", provider: "apify", route_id: null, plan_version: null, provider_call_id: "c", mission_id: null, observed_at: FIXED_NOW().toISOString() }).evidence;
  const judge = (proposal: unknown) => evaluateEligibility(compileLeadMission({ originalUserQuery: f.query, proposal: proposal as never, requestedCount: 10 }).final_mission.criteria as never, buildCompanyEvidenceGraph("k", record), undefined, []).eligibility;
  assertEquals(judge(f.proposal), "eligible", "the benchmark proposal states the size once: decidable");
  // When this assertion fails, the shared fix has landed: delete this test and the note in mission-c-proposal.json.
  assertEquals(judge(restated), "pending");
});
