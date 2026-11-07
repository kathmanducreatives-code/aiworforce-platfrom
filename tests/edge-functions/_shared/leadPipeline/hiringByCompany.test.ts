// Job search BY COMPANY at LeadOcean's employers (opt-in, concurrent hiring missions only).
// Offline: the real compiler, planner, executor and shared engine on recorded responses.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compare, HIRING_CHECK_MODE, MISSION, TRUTH_QUALIFIED_WITH_HIRING_CHECK } from "../../../../scripts/dev/provider-comparison.ts";
import { runScenario, type Scenario } from "../../../../scripts/dev/discovery-benchmark.ts";
import { BY_COMPANY_MAX, chainFor, planStrategy, specFromMission } from "../../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { checkStrategyApproval } from "../../../../supabase/functions/_shared/leadPipeline/multiProvider.ts";
import { discoverHiringCompanies, jobByCompanyInput } from "../../../../supabase/functions/_shared/leadPipeline/apifyDiscovery.ts";
import { compileLeadMission } from "../../../../supabase/functions/_shared/leadMissionCompiler.ts";

const US = { geographies: ["United States"], hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "US" }] };
const PROPOSAL = { ...US, requested_opportunity_count: 5, preferred_signals: ["hiring Account Executives but not SDRs"], signal_recency_days: 30, strategies: ["hiring"] };
const spec = specFromMission(compileLeadMission({ originalUserQuery: MISSION, requestedCount: 5, proposal: PROPOSAL as never }).final_mission as never, { defaultCount: 5 });
const ctx = (verify?: boolean) => ({
  providers: { apify: { enabled: true, connected: true, authorized: true }, leadocean: { enabled: true, connected: true, authorized: true, remaining: 900 } },
  budget: { maxLeadoceanRecords: 20, maxApifyUsd: 0.25 },
  user: { strategy: "apify_leadocean_concurrent", ...(verify === undefined ? {} : { verifyHiringByCompany: verify }) },
}) as never;

Deno.test("off by default: no step, and every existing plan hash is unchanged (absent ≡ false)", () => {
  const a = planStrategy(spec, ctx()), b = planStrategy(spec, ctx(false));
  assertEquals(a.planHash, b.planHash);
  assert(!a.steps.some((s) => s.role === "verify_hiring"));
});

Deno.test("opt-in adds ONE scoped step, priced into the plan: an approval of the plan without it is refused", () => {
  const off = planStrategy(spec, ctx()), on = planStrategy(spec, ctx(true));
  const step = on.steps.find((s) => s.role === "verify_hiring")!;
  assertEquals(step.capability, "apify.job_search_by_company");
  assert(step.estimate.apifyUsd > 0 && on.estimate.apifyUsd > off.estimate.apifyUsd);
  assert(on.planHash !== off.planHash, "a different plan: it must be approved on its own");
  const stale = { planHash: off.planHash, leadoceanRecords: off.estimate.leadoceanRecords, apifyUsd: off.estimate.apifyUsd, approvedBy: "o", approvedAt: "t" };
  assertEquals(checkStrategyApproval(on, stale).ok, false);
  assertEquals(checkStrategyApproval(on, { ...stale, planHash: on.planHash, apifyUsd: off.estimate.apifyUsd }).ok, false, "the old amount does not cover the new step");
});

Deno.test("only concurrent hiring missions: every other strategy and a non-hiring mission keep their chain", () => {
  for (const s of ["apify_only", "leadocean_only", "leadocean_plus_apify", "apify_plus_leadocean"] as const) {
    assert(!chainFor(s, spec, { verifyHiringByCompany: true }).includes("apify.job_search_by_company"), s);
  }
  const plain = { ...spec, signals: [] };
  assert(!chainFor("apify_leadocean_concurrent", plain, { verifyHiringByCompany: true }).includes("apify.job_search_by_company"));
});

Deno.test("scoped input: at most 10 company pages, no location filter, total rows split across titles", () => {
  const urls = Array.from({ length: 14 }, (_, i) => `https://www.linkedin.com/company/c${i}`);
  const input = jobByCompanyInput(spec, ["Account Executive", "AE", "Sales Executive"], urls, 30);
  assertEquals((input.company as string[]).length, BY_COMPANY_MAX);
  assertEquals(input.locations, undefined);
  assertEquals(input.maxItems, 10);
});

Deno.test("cost controls: worst case over the budget → nothing is called; an empty scope → nothing is called", async () => {
  let calls = 0;
  const invoke = () => { calls++; return Promise.resolve({ items: [], runId: "r", chargedUsd: 0 }); };
  const o = { now: new Date("2026-11-01T00:00:00Z"), idPrefix: "t" };
  const tight = await discoverHiringCompanies(spec, ["Account Executive"], invoke, { ...o, maxItems: 30, maxUsd: 0.001, companyScope: ["https://www.linkedin.com/company/a"] });
  assertEquals(tight.stopped, "budget");
  const none = await discoverHiringCompanies(spec, ["Account Executive"], invoke, { ...o, maxItems: 30, maxUsd: 1, companyScope: ["not a page"] });
  assertEquals(none.stopped, "no company to check");
  assertEquals(calls, 0);
});

const [checked] = await compare("v3", [HIRING_CHECK_MODE]);

Deno.test("end to end: LeadOcean's AE-hiring company qualifies on a dated posting; the SDR-only one stays pending; no false qualification", () => {
  assertEquals(checked.companies.filter((c) => c.verdict === "qualified").map((c) => c.domain).sort(), TRUTH_QUALIFIED_WITH_HIRING_CHECK);
  assertEquals(checked.falseQualified, []);
  const pine = checked.companies.find((c) => c.domain === "pinecrest.example")!;
  assertEquals(pine.verdict, "review", "an excluded-role posting proves nothing; absence never rejects");
  assert(pine.gaps.includes("hiring"));
  const cobalt = checked.companies.find((c) => c.domain === "cobaltdesk.example")!;
  assertEquals(cobalt.sources, ["leadocean"], "a verification read never makes Apify a discovery source");
  const step = checked.summary!.providers.find((p) => p.provider === "apify")!;
  assert(step.spend.apifyUsd > 0);
});

Deno.test("leakage: a scoped run returning another employer's posting has it dropped, never credited", async () => {
  const r = await runScenario({
    id: "HBC-leak", group: "F", title: "leak", request: MISSION, count: 5, strategy: "apify_leadocean_concurrent", people: "comparison" as never,
    verifyHiringByCompany: true, budget: { maxLeadoceanRecords: 20, maxApifyUsd: 0.25 }, proposal: PROPOSAL,
    spec: {} as never, check: () => ({ pass: true, detail: "" }),
  } as Scenario, { fault: "scope_leak", walkId: "hbc-leak" });
  const step = r.run!.steps.find((s) => s.capability === "apify.job_search_by_company")!;
  assertEquals(step.status, "completed");
  assert(/outside_company_scope 1/.test(step.reason ?? ""), step.reason ?? "");
  assertEquals(r.companies.filter((c) => c.verdict === "qualified").map((c) => c.domain).sort(), TRUTH_QUALIFIED_WITH_HIRING_CHECK);
  // Every step, the new one included, stays inside the approved plan's worst case.
  assert(r.run!.spend.apifyUsd > 0 && r.run!.spend.apifyUsd <= r.costUsd.apify + 1e-9 && r.run!.spend.apifyUsd <= 0.25);
});
