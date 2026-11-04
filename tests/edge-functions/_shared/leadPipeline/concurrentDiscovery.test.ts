// apify_leadocean_concurrent — both providers discover the SAME mission at once (offline,
// recorded responses; the real compiler, planner, executor, merge and shared engine).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compare, MISSION, MODES, overlap, TRUTH_QUALIFIED } from "../../../../scripts/dev/provider-comparison.ts";
import { runScenario, type Scenario } from "../../../../scripts/dev/discovery-benchmark.ts";
import { DISCOVERY_STRATEGIES, planStrategy, specFromMission, USER_SELECTED_ONLY } from "../../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { compileLeadMission } from "../../../../supabase/functions/_shared/leadMissionCompiler.ts";

const results = await compare("v3");
const by = (mode: string) => results.find((r) => r.mode === mode)!;
const concurrent = by("Concurrent");

Deno.test("concurrent: never chosen by score or model advice — only when the request names it", () => {
  assert(DISCOVERY_STRATEGIES.includes("apify_leadocean_concurrent") && USER_SELECTED_ONLY.has("apify_leadocean_concurrent"));
  const m = compileLeadMission({ originalUserQuery: MISSION, requestedCount: 5, proposal: {
    requested_opportunity_count: 5, geographies: ["United States"], preferred_signals: ["hiring Account Executives but not SDRs"], signal_recency_days: 30,
    hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "US" }],
  } as never }).final_mission;
  const spec = specFromMission(m as never, { defaultCount: 5 });
  const ctx = { providers: { apify: { enabled: true, connected: true, authorized: true }, leadocean: { enabled: true, connected: true, authorized: true, remaining: 900 } },
    budget: { maxLeadoceanRecords: 50, maxApifyUsd: 1 } } as never;
  assert(planStrategy(spec, ctx).strategy !== "apify_leadocean_concurrent", "deterministic choice");
  assert(planStrategy(spec, ctx, { proposed: "apify_leadocean_concurrent", rationale: "x", model: "m", error: null }).strategy !== "apify_leadocean_concurrent", "model advice refused");
  assertEquals(planStrategy(spec, { ...(ctx as object), user: { strategy: "apify_leadocean_concurrent" } } as never).strategy, "apify_leadocean_concurrent");
});

Deno.test("concurrent: both providers ran; the same company found by both is ONE company with BOTH sources", () => {
  assertEquals(concurrent.planStatus, "ready");
  for (const d of ["northwind.example", "quartzlabs.example"]) {
    const c = concurrent.companies.filter((x) => x.domain === d);
    assertEquals(c.length, 1, `${d}: deduplicated`);
    assertEquals(c[0].sources, ["apify", "leadocean"], `${d}: both sources kept`);
  }
  assertEquals(new Set(concurrent.companies.map((c) => c.domain)).size, concurrent.companies.length, "no company counted twice");
  const o = overlap(results);
  assertEquals(o.both, ["northwind.example", "quartzlabs.example"]);
  assert(o.leadoceanOnly.length > 0 && o.apifyOnly.length > 0, "genuinely unique companies from each provider are kept");
});

Deno.test("concurrent: qualification is never weaker — exactly the truth qualifies; LeadOcean-only companies stay pending on hiring", () => {
  assertEquals(concurrent.companies.filter((c) => c.verdict === "qualified").map((c) => c.domain).sort(), TRUTH_QUALIFIED);
  assertEquals(concurrent.falseQualified, []);
  for (const c of concurrent.companies.filter((x) => x.sources.join() === "leadocean")) {
    assertEquals(c.verdict, "review", `${c.domain}: a provider claim never qualifies`);
    assert(c.gaps.includes("hiring"), `${c.domain}: hiring is unknown without job evidence, so pending`);
  }
  // Verified: LeadOcean's employers got the company record too (only hiring is open).
  assert(concurrent.companies.some((c) => c.sources.join() === "leadocean" && !c.gaps.includes("geography")));
  // Contradiction: Maple's record says Toronto — rejected in every mode that saw it.
  for (const r of results) for (const c of r.companies.filter((x) => x.domain === "mapleledger.example")) assertEquals(c.verdict, "rejected", r.mode);
  // The excluded role: an SDR-only employer never becomes a qualified company.
  for (const r of results) assert(!r.companies.some((c) => c.domain === "glowcart.example" && c.verdict === "qualified"), r.mode);
});

Deno.test("LeadOcean only: candidates for review, never qualified companies, on a hiring mission", () => {
  const lo = by("LeadOcean only");
  assertEquals(lo.qualified, 0);
  assert(lo.companies.every((c) => c.verdict === "review" && c.gaps.includes("hiring")));
});

Deno.test("v1 and v3 contracts produce the same outcome for this mission in every mode", async () => {
  const v1 = await compare("v1");
  assertEquals(v1.map((r) => r.companies), results.map((r) => r.companies));
});

const faulted = (fault: "lo_error" | "jobs_timeout") => runScenario({
  id: `PC-${fault}`, group: "F", title: fault, request: MISSION, count: 5, strategy: "apify_leadocean_concurrent", people: "comparison" as never,
  proposal: { geographies: ["United States"], hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "US" }],
    requested_opportunity_count: 5, preferred_signals: ["hiring Account Executives but not SDRs"], signal_recency_days: 30, strategies: ["hiring"] },
  spec: {} as never, check: () => ({ pass: true, detail: "" }),
} as Scenario, { fault, walkId: `pc-${fault}` });

Deno.test("independent failure: LeadOcean fails — Apify's results stand, the run is partial, nothing is retried", async () => {
  const r = await faulted("lo_error");
  assertEquals(r.run?.status, "partial");
  assertEquals(r.run?.steps.find((s) => s.provider === "leadocean")?.status, "failed");
  assertEquals(r.companies.filter((c) => c.verdict === "qualified").map((c) => c.domain).sort(), TRUTH_QUALIFIED);
});

Deno.test("independent failure: Apify discovery times out — LeadOcean's companies are still verified and judged, never blocked", async () => {
  const r = await faulted("jobs_timeout");
  assert(r.run?.status !== "blocked", r.run?.reason ?? "");
  assertEquals(r.run?.steps.find((s) => s.capability === "apify.linkedin_job_search")?.status, "failed");
  assert(r.companies.length > 0 && r.companies.every((c) => c.sources.includes("leadocean")));
  assertEquals(r.qualified, 0, "no job evidence: hiring stays unknown, so nothing qualifies");
});

Deno.test("modes are listed with their own strategy (comparison wiring)", () => {
  assertEquals(MODES.map((m) => m.strategy), ["apify_only", "leadocean_only", "apify_leadocean_concurrent"]);
});

Deno.test("provider summary (strategy_run's dashboard numbers): totals count each company once; contributions per provider", () => {
  const s = concurrent.summary!;
  assertEquals(s.totals.companies, concurrent.uniqueCompanies);
  assertEquals(s.totals.qualified, 2);
  assertEquals(s.totals.foundByMultiple, 2, "Northwind and Quartz");
  const apify = s.providers.find((p) => p.provider === "apify")!, lo = s.providers.find((p) => p.provider === "leadocean")!;
  assertEquals(apify.discovered + lo.discovered - s.totals.foundByMultiple, s.totals.companies, "no company counted twice");
  assertEquals(lo.qualified, 2, "LeadOcean also found both qualified companies (qualified on Apify's evidence)");
  assertEquals(lo.unique, concurrent.companies.filter((c) => c.sources.join() === "leadocean").length);
  assert(apify.spend.apifyUsd > 0 && lo.spend.leadoceanRecords > 0 && lo.spend.apifyUsd === 0, "cost tracked per provider");
});

Deno.test("B2B: 'US B2B companies' ranks by B2B (reviewed policy: a describing word, disclosed); 'ONLY B2B' is a gate no mode weakens", async () => {
  // As written: a disclosed preference in every mode (never silently dropped).
  for (const r of results) assert(!r.hardRequirements.some((h) => h.startsWith("business_model")), r.mode);
  // Stated as mandatory: hard everywhere, and nothing qualifies without proof of B2B.
  for (const m of MODES) {
    const r = await runScenario({
      id: `PC-only-b2b-${m.strategy}`, group: "X", title: "only B2B", count: 5, strategy: m.strategy, people: "comparison" as never, allowReviewOnly: m.allowReviewOnly,
      request: "Find only US B2B companies actively hiring Account Executives, excluding SDRs.",
      proposal: { geographies: ["United States"], hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "US" }],
        company_types: ["B2B"], requested_opportunity_count: 5, preferred_signals: ["hiring Account Executives but not SDRs"], signal_recency_days: 30, strategies: ["hiring"] },
      spec: {} as never, check: () => ({ pass: true, detail: "" }),
    } as Scenario, { walkId: `pc-only-b2b-${m.strategy}` });
    assert(r.hardRequirements.some((h) => h.startsWith("business_model")) || r.planStatus === "blocked", `${m.mode}: B2B is hard`);
    assertEquals(r.qualified, 0, `${m.mode}: no company is qualified without B2B evidence`);
  }
});

Deno.test("conflict: providers disagree on a field — both values are kept on the lead and counted, never resolved by a claim", async () => {
  const r = await runScenario({
    id: "PC-conflict", group: "X", title: "conflict", request: MISSION, count: 5, strategy: "apify_leadocean_concurrent", people: "comparison" as never,
    budget: { maxLeadoceanRecords: 20, maxApifyUsd: 0.25 },
    proposal: { geographies: ["United States"], hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "US" }],
      requested_opportunity_count: 5, preferred_signals: ["hiring Account Executives but not SDRs"], signal_recency_days: 30, strategies: ["hiring"] },
    spec: {} as never, check: () => ({ pass: true, detail: "" }),
  } as Scenario, { walkId: "pc-conflict" });
  const lead = [...r.run!.queue, ...r.run!.review].find((l) => l.company.domain === "northwind.example")!;
  const c = lead.provenance.conflicts?.find((x) => x.field === "industry");
  assert(c, "the industry disagreement is on the lead");
  assertEquals(new Set(c!.values.map((v) => v.provider)), new Set(["apify", "leadocean"]));
  assertEquals(concurrent.summary!.conflicts.industry, 1);
});
