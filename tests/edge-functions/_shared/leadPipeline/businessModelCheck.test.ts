// MRLE Phase 1: REQUIRED B2B is verified from ≤3 first-party pages through the production
// grounded classifier — verified / likely / mixed / unknown / not B2B, never stronger than
// the evidence. Offline: mocked Apify (jobs, company records, website pages) and a fake model
// that quotes only text it finds on the pages; the REAL validation re-checks every quote.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { businessModelPages } from "../../../../supabase/functions/_shared/leadPipeline/businessModelCheck.ts";
import { handleStrategyRequest } from "../../../../supabase/functions/_shared/leadPipeline/service.ts";
import type { StrategyPlan } from "../../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { CO, deps, req, type Lead } from "./mrleFixtures.ts";

Deno.test("the page list is the company's own three pages, never a crawl", () => {
  assertEquals(businessModelPages("https://www.Northwind.example/about").map((p) => p.url), ["https://northwind.example/", "https://northwind.example/about", "https://northwind.example/customers"]);
});

Deno.test("REQUIRED B2B with the website check: the plan is READY, checks B2B on first-party pages, and stays within the $0.25 cap", async () => {
  const x = deps();
  const planned = await handleStrategyRequest(req({ action: "strategy_plan" }), x.d);
  assertEquals(planned.status, 200, JSON.stringify(planned.body).slice(0, 400));
  const plan = planned.body.plan as StrategyPlan;
  assertEquals(plan.steps.map((s) => s.capability), ["apify.linkedin_job_search", "apify.linkedin_company_record", "apify.website_business_model"]);
  const bm = plan.requirementRoutes.find((r) => r.dimension === "business_model")!;
  assertEquals([bm.route, bm.checkedBy], ["checked", ["apify.website_business_model"]]);
  assert(plan.estimate.apifyUsd <= 0.25, `${plan.estimate.apifyUsd}`);
  assertEquals(x.ap.calls.length, 0, "planning buys nothing");
});

Deno.test("without the grounding model the website check is unavailable: REQUIRED B2B is blocked with a question, nothing bought", async () => {
  const x = deps({ ground: false });
  const planned = await handleStrategyRequest(req({ action: "strategy_plan" }), x.d);
  assertEquals(planned.status, 409);
  assert(((planned.body.plan as StrategyPlan).questions ?? []).some((q) => /business model/i.test(q)));
  assertEquals(x.ap.calls.length, 0);
});

Deno.test("verified only from the company's own words: B2B qualifies, consumer is rejected, mixed and silent stay open — with quote and URL", async () => {
  const x = deps();
  const planned = await handleStrategyRequest(req({ action: "strategy_plan" }), x.d);
  const plan = planned.body.plan as StrategyPlan;
  const ran = await handleStrategyRequest(req({ action: "strategy_run", approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: planned.body.approval_token } }), x.d);
  assertEquals(ran.status, 200, JSON.stringify(ran.body).slice(0, 400));
  const all = [...(ran.body.queue as Lead[]), ...(ran.body.review as Lead[])];
  const by = Object.fromEntries(all.map((l) => [l.company.name, l]));
  assertEquals(by["Northwind Ledger"].statuses.qualification, "eligible");
  assertEquals(by["Northwind Ledger"].businessModel!.status, "verified_b2b");
  assert(by["Northwind Ledger"].businessModel!.quote!.includes("built for finance teams"));
  assertEquals(by["Northwind Ledger"].businessModel!.url, "https://northwind.example/");
  assertFalse((ran.body.queue as Lead[]).some((l) => l.company.name === "Harbor Kids"), "a consumer business is never qualified");
  assertEquals(by["Quartz Data"]?.statuses.qualification, "pending", "pages that say nothing leave it unverified");
  assertFalse((ran.body.queue as Lead[]).some((l) => l.company.name === "Maple Goods"), "a business that also sells to consumers is not verified B2B-only by a mixed page");
  assertEquals(by["Quartz Data"]?.businessModel?.status, "unknown");
  // One batched page run, ≤3 pages per company, and every company read once.
  const pageRuns = x.ap.calls.filter((c) => c.actor === "apify_website_content");
  assertEquals(pageRuns.length, 1);
  assert((pageRuns[0].input.startUrls as unknown[]).length <= 3 * CO.length);
  assertEquals(pageRuns[0].input.maxCrawlDepth, 0, "no link following");
  // Honest outcome: only qualified companies count toward the 5 requested.
  const outcome = ran.body.outcome as { status: string; qualified: number; shortfall: number; spend: { basis: string; apifyUsd: number } };
  assertEquals([outcome.status, outcome.qualified, outcome.shortfall], ["completed_with_shortfall", 1, 4]);
  assertEquals(outcome.spend.basis, "estimate");
  assert(outcome.spend.apifyUsd <= 0.25);
  // The verdict travels to the Leads row.
  const nw = x.written.find((w) => w.account.name === "Northwind Ledger")!;
  assertEquals((nw.lead_candidate.raw.agentory_pipeline as { business_model: { status: string } }).business_model.status, "verified_b2b");
});

Deno.test("a failed page run verifies nothing and is never retried: every company stays needs_verification", async () => {
  const x = deps({ failPages: true });
  const planned = await handleStrategyRequest(req({ action: "strategy_plan" }), x.d);
  const plan = planned.body.plan as StrategyPlan;
  const ran = await handleStrategyRequest(req({ action: "strategy_run", approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: planned.body.approval_token } }), x.d);
  assertEquals((ran.body.queue as Lead[]).length, 0);
  assertEquals(x.ap.calls.filter((c) => c.actor === "apify_website_content").length, 1, "one attempt, no retry");
  assertEquals((ran.body.outcome as { status: string }).status, "needs_verification");
  assertEquals(x.modelCalls.length, 0, "nothing to ground");
});
