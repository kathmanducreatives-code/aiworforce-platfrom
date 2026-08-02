import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildScoutJobsKeywords, computeQaLimit, applyQaResultLimit, type ScoutIcp } from "../../functions/_shared/scoutStrategy.ts";

// The intended Agentory TEST ICP (Part A). Kept here as the canonical fixture so
// tests and the TEST-workspace seed stay in sync. Not applied globally.
export const AGENTORY_TEST_ICP: ScoutIcp & Record<string, unknown> = {
  target_industries: ["B2B SaaS", "AI SaaS", "sales software", "revenue operations software", "workflow automation software", "data enrichment software"],
  industries: ["B2B SaaS", "AI SaaS", "sales software", "revenue operations software"],
  target_company_size: "10-150 employees",
  company_size: "10-150 employees",
  buyer_roles: ["Founder", "Co-Founder", "CEO", "Head of Growth", "Revenue Leader", "Sales Founder", "GTM Operator"],
  target_buyers: ["Founder", "Co-Founder", "CEO", "Head of Growth", "Revenue Leader", "GTM Operator"],
  target_signals: ["hiring RevOps", "hiring revenue operations", "hiring sales ops", "hiring first sales", "hiring growth", "hiring SDR/BDR manager", "expanding outbound", "using Clay/Apollo/Instantly/HubSpot/Salesforce", "recently funded", "founder-led sales"],
  negative_role_terms: ["operations manager", "general manager", "office manager", "plant manager", "production manager", "warehouse operations", "field operations", "facilities manager"],
  geography: "United States",
  disqualifiers: ["manufacturing", "construction", "retail", "restaurant", "hospitality", "university", "school", "hospital", "bank", "government", "logistics", "local services", "plant operations", "field operations"],
};

// ---- Part D Test 1: empty structured ICP → weak context flag, no fabrication ----
Deno.test("empty ICP → weakIcpContext true (does not invent an ICP)", () => {
  const q = buildScoutJobsKeywords({ roleKeywords: ["Revenue Operations"], query: "hiring RevOps", icp: {} });
  assert(q.weakIcpContext, "empty ICP must be reported as weak context");
  assert(!q.saasContextApplied);
});
Deno.test("null ICP → weakIcpContext true", () => {
  assert(buildScoutJobsKeywords({ query: "hiring", icp: null }).weakIcpContext);
});

// ---- Test 2: Agentory ICP → SaaS/revenue/growth-oriented query ----
Deno.test("Agentory ICP → SaaS + revenue/growth query, not weak", () => {
  const q = buildScoutJobsKeywords({ roleKeywords: ["Revenue Operations", "RevOps"], query: "hiring RevOps", icp: AGENTORY_TEST_ICP });
  assert(!q.weakIcpContext);
  assert(q.saasContextApplied, "B2B SaaS ICP adds SaaS context");
  assert(/saas|software|b2b/i.test(q.keywords));
  assert(/revops|revenue operations/i.test(q.keywords));
});

// ---- Test 3: generic Operations Manager is NOT the primary query for GTM intent ----
Deno.test("generic Operations Manager dropped for RevOps/GTM intent; RevOps seeded", () => {
  const q = buildScoutJobsKeywords({ roleKeywords: ["Operations Manager"], query: "hiring RevOps / GTM operations", icp: AGENTORY_TEST_ICP });
  assert(q.avoidedTerms.some((t) => /operations manager/i.test(t)), "generic ops recorded as avoided");
  assert(!/operations manager/i.test(q.keywords), "generic ops not in the query");
  assert(/revops|revenue operations|growth|sales/i.test(q.keywords), "revenue/growth terms used instead");
});
Deno.test("generic ops term kept as-is ONLY has no revops seeding when intent isn't GTM but is still dropped", () => {
  // Non-GTM intent, generic ops → still avoided (proof gate would reject anyway), falls back to query.
  const q = buildScoutJobsKeywords({ roleKeywords: ["Operations Manager"], query: "operations", icp: {} });
  assert(q.avoidedTerms.some((t) => /operations manager/i.test(t)));
});

// ---- Test 4/5/6: QA result limit reporting ----
Deno.test("Test 4: max_results 1 → processedCount 1 even when actor floors at 10; qaLimitApplied", () => {
  const r = computeQaLimit(1, 10, 10);
  assertEquals(r.requestedMaxResults, 1);
  assertEquals(r.actorCount, 10);
  assertEquals(r.processedCount, 1);
  assert(r.qaLimitApplied);
  assertEquals(applyQaResultLimit([1,2,3,4,5,6,7,8,9,10], 1).length, 1);
});
Deno.test("Test 5: max_results 3 → processedCount 3", () => {
  const r = computeQaLimit(3, 10, 10);
  assertEquals(r.processedCount, 3);
  assert(r.qaLimitApplied);
  assertEquals(applyQaResultLimit([1,2,3,4,5], 3).length, 3);
});
Deno.test("Test 6: actorCount vs processedCount visible; no limit when equal", () => {
  const r = computeQaLimit(10, 10, 10);
  assertEquals(r.actorCount, 10);
  assertEquals(r.processedCount, 10);
  assertEquals(r.qaLimitApplied, false);
});
