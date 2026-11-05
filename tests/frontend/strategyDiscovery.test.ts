// The strategy discovery panel shows the BACKEND's run: its plan, spend, provider summary and
// each company's own qualification status. The run fixtures come from the real executor
// (scripts/dev/provider-comparison.ts: compiler v3 → planner → multi-provider executor →
// merge → shared qualification, offline recorded responses), shaped exactly as
// lead-pipeline's strategy_run response (service.ts).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { MODES, scenarioFor as scenario } from "../../scripts/dev/provider-comparison.ts";
import { runScenario } from "../../scripts/dev/discovery-benchmark.ts";
import { summarizeProviderRun } from "../../supabase/functions/_shared/leadPipeline/providerRunSummary.ts";
import { parseStrategyRequest } from "../../supabase/functions/_shared/leadPipeline/service.ts";
import {
  comparisonRow, overlapView, safeHref, planStrategy, readStrategyPlan, readStrategyRun, runStrategy, strategyDiscoveryUiEnabled,
  walkIdFor, worstCaseLine, type Invoke,
} from "../../src/lib/strategyDiscovery.ts";

/** A strategy_run response body built the way service.ts builds it. */
async function responseFor(strategy: string, fault?: string) {
  const m = MODES.find((x) => x.strategy === strategy)!;
  const r = await runScenario(scenario(m, "v3"), { walkId: `ui-${strategy}`, ...(fault ? { fault: fault as never } : {}) });
  const run = r.run!;
  return {
    status: run.status, reason: run.reason, strategy: run.strategy, steps: run.steps, spend: run.spend, limitations: run.limitations,
    evidenceRefused: run.evidenceRefused, queue: run.queue, review: run.review, excludedCount: run.excluded.length, written: run.queue.length + run.review.length,
    providerSummary: summarizeProviderRun(run),
  };
}

Deno.test("flag: off unless VITE_STRATEGY_DISCOVERY is exactly 'true'", () => {
  assertEquals(strategyDiscoveryUiEnabled({}), false);
  assertEquals(strategyDiscoveryUiEnabled({ VITE_STRATEGY_DISCOVERY: "1" }), false);
  assertEquals(strategyDiscoveryUiEnabled({ VITE_STRATEGY_DISCOVERY: "true" }), true);
});

Deno.test("requests: the panel's bodies pass the server's own parser (walk id, strategy, review-only)", async () => {
  const sent: Record<string, unknown>[] = [];
  const planBody = { status: "ready", plan: { status: "ready", strategy: "apify_only", steps: [], estimate: { apifyUsd: 0.06105, leadoceanRecords: 0 }, planHash: "h1", rationale: [] }, approval_token: "tok" };
  const invoke: Invoke = async <T,>(_n: string, b: unknown) => { sent.push(b as Record<string, unknown>); return { data: planBody as T, error: null }; };
  const req = { workspaceId: "ws", messageId: "Msg 42/abc", query: "Find US companies hiring AEs", choice: "leadocean_only" as const, requestedCount: 5 };
  const p = await planStrategy(invoke, req);
  assert(p.ok);
  await runStrategy(invoke, req, p.value);
  const [plan, run] = sent;
  assertEquals(walkIdFor("Msg 42/abc", "leadocean_only"), "ui-msg42abc-leadocean_only");
  const parsedPlan = parseStrategyRequest(plan)!, parsedRun = parseStrategyRequest(run)!;
  assert(parsedPlan && parsedRun, "the server accepts both bodies");
  assertEquals(parsedPlan.user, { strategy: "leadocean_only", excludeProviders: [], allowReviewOnly: true });
  // Same ceilings on plan and run (the plan hash binds them); the approval is the plan's worst case and token.
  assertEquals(parsedPlan.budget, parsedRun.budget);
  assertEquals(parsedRun.approval, { planHash: "h1", apifyUsd: 0.06105, leadoceanRecords: 0, token: "tok" });
  // Auto sends no strategy and does not allow review-only results.
  sent.length = 0;
  await planStrategy(invoke, { ...req, choice: "auto" });
  assertEquals(parseStrategyRequest(sent[0])!.user, { excludeProviders: [], allowReviewOnly: false });
});

Deno.test("plan: a blocked plan (409) is still shown with its reason; an unreadable answer is an error", async () => {
  const blocked = { status: "blocked", plan: { status: "blocked", blockedReason: "leadocean disabled (feature flag off)", strategy: null, steps: [], estimate: { apifyUsd: 0, leadoceanRecords: 0 }, planHash: "h0" } };
  const ctx = new Response(JSON.stringify(blocked), { status: 409 });
  const invoke: Invoke = async () => ({ data: null, error: Object.assign(new Error("409"), { context: ctx }) });
  const r = await planStrategy(invoke, { workspaceId: "ws", messageId: "m", query: "q", choice: "leadocean_only" });
  assert(r.ok);
  assertEquals([r.value.status, r.value.blockedReason], ["blocked", "leadocean disabled (feature flag off)"]);
  // A ready plan is never run without being ready; a missing plan is an error, not an empty plan.
  assertEquals(readStrategyPlan({ plan: { status: "ready", planHash: "h" } }), null);
  const denied: Invoke = async () => ({ data: null, error: Object.assign(new Error("403"), { context: new Response(JSON.stringify({ error: "workspace not allowed" }), { status: 403 }) }) });
  assertEquals(await planStrategy(denied, { workspaceId: "ws", messageId: "m", query: "q", choice: "auto" }), { ok: false, error: "workspace not allowed" });
  assertEquals((await runStrategy(denied, { workspaceId: "ws", messageId: "m", query: "q", choice: "auto" }, { ...r.value })).ok, false);
});

for (const strategy of ["apify_only", "leadocean_only", "apify_leadocean_concurrent"]) {
  Deno.test(`run (${strategy}, real executor): every company's verdict and every total is the backend's`, async () => {
    const body = await responseFor(strategy);
    const v = readStrategyRun(body)!;
    assert(v, "the run is readable");
    const s = body.providerSummary;
    assertEquals(v.summary?.totals, s.totals);
    // The rows the panel lists are the run's own companies (queue + review), each counted once.
    assertEquals(v.companies.length, body.queue.length + body.review.length);
    assertEquals(new Set(v.companies.map((c) => c.key)).size, v.companies.length);
    // Per-company verdicts agree with the backend summary's counts (excluded rows are not returned).
    const n = (x: string) => v.companies.filter((c) => c.verdict === x).length;
    assertEquals(n("qualified"), s.totals.qualified);
    assertEquals(n("pending"), s.totals.pending);
    assertEquals(n("rejected") + body.excludedCount, s.totals.rejected);
    assertEquals(v.spend, body.spend);
    const row = comparisonRow(v)!;
    assertEquals([row.companies, row.qualified, row.pending, row.rejected], [s.totals.companies, s.totals.qualified, s.totals.pending, s.totals.rejected]);
  });
}

Deno.test("run (concurrent): overlap, provider provenance, hiring evidence with source links and kept conflicts", async () => {
  const v = readStrategyRun(await responseFor("apify_leadocean_concurrent"))!;
  const o = overlapView(v.summary)!;
  assertEquals(o.combinedUnique, v.summary!.totals.companies);
  assertEquals(o.overlap, v.companies.filter((c) => c.providers.length > 1).length);
  assertEquals(o.perProvider.map((p) => p.provider).sort(), ["apify", "leadocean"]);
  const by = (d: string) => v.companies.find((c) => c.domain === d)!;
  // Shared companies carry both providers; LeadOcean-only ones are pending (hiring unproven).
  assertEquals(by("northwind.example").providers.sort(), ["apify", "leadocean"]);
  assertEquals(by("northwind.example").verdict, "qualified");
  // Hiring is proven by a check citing the job-search actor (strategy runs buy no separate signals).
  assert(by("northwind.example").checks.some((k) => k.dimension === "hiring" && k.result === "pass" && /job_search/.test(k.reason)));
  assert(by("northwind.example").evidenceSources.includes("apify_linkedin_job_search"));
  assertEquals(by("cobaltdesk.example").providers, ["leadocean"]);
  assertEquals(by("cobaltdesk.example").verdict, "pending");
  assert(by("cobaltdesk.example").gaps.includes("hiring") || by("cobaltdesk.example").checks.some((k) => k.dimension === "hiring" && k.result !== "pass"), "LeadOcean-only: hiring stays unproven");
  // The industry disagreement is kept and shown with both values.
  const c = by("northwind.example").conflicts.find((x) => x.field === "industry");
  assert(c && c.values.length >= 2, "conflict kept with both providers' values");
});

Deno.test("run: one provider failing keeps the other's results and is surfaced, not hidden", async () => {
  const body = await responseFor("apify_leadocean_concurrent", "lo_error");
  const v = readStrategyRun(body)!;
  assert(v.summary);
  const lo = v.summary.providers.find((p) => p.provider === "leadocean");
  if (lo) assertEquals(lo.failed, true);
  assert(v.steps.some((s) => s.provider === "leadocean" && s.status === "failed"));
  assert(v.companies.some((c) => c.providers.includes("apify")), "Apify's companies survive LeadOcean's failure");
});

Deno.test("run: no summary → no totals (never zero-filled); not a run → null", () => {
  const v = readStrategyRun({ status: "completed", steps: [], spend: { apifyUsd: 0, leadoceanRecords: 0 }, queue: [], review: [] })!;
  assertEquals(v.summary, null);
  assertEquals(comparisonRow(v), null);
  assertEquals(overlapView(null), null);
  assertEquals(readStrategyRun({ error: "plan changed since it was approved" }), null);
  assertEquals(readStrategyRun({ status: "completed", steps: [], spend: { apifyUsd: -1, leadoceanRecords: 0 } }), null);
});

Deno.test("words: worst case in both units", () => {
  assertEquals(worstCaseLine({ apifyUsd: 0.06105, leadoceanRecords: 0 }), "up to $0.0611 Apify");
  assertEquals(worstCaseLine({ apifyUsd: 0.15, leadoceanRecords: 15 }), "up to $0.1500 Apify + up to 15 LeadOcean records");
  assertEquals(worstCaseLine({ apifyUsd: 0, leadoceanRecords: 0 }), "No provider spend");
});

Deno.test("links: only http(s) provider URLs are rendered", () => {
  assertEquals(safeHref("javascript:alert(1)"), null);
  assertEquals(safeHref("data:text/html,x"), null);
  assertEquals(safeHref("not a url"), null);
  assertEquals(safeHref("https://www.linkedin.com/company/x"), "https://www.linkedin.com/company/x");
  const v = readStrategyRun({ status: "completed", steps: [], spend: { apifyUsd: 0, leadoceanRecords: 0 }, review: [],
    queue: [{ company: { key: "k", name: "X", domain: "x.example\"><script>", linkedinUrl: "javascript:1" }, statuses: { qualification: "eligible" },
      signals: [{ type: "hiring", provider: "apify", sourceUrl: "javascript:2" }] }] })!;
  assertEquals([v.companies[0].website, v.companies[0].linkedinUrl, v.companies[0].signals[0].sourceUrl], [null, null, null]);
});
