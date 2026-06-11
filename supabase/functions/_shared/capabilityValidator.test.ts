// Unit tests for capabilityValidator. Uses the regex layer of workflowClassifier
// to produce decisions, then runs them through validateAgainstCapabilities.
//
// Note: APIFY_ENABLE_PEOPLE_SEARCH is set in production secrets and may also be
// available in the test env. The people_sourcing tests assert behaviour against
// whatever isActorRuntimeEnabled() reports.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateAgainstCapabilities } from "./capabilityValidator.ts";
import { classifyWorkflow, normalizeIntent } from "./workflowClassifier.ts";
import { getActorByKey, isActorRuntimeEnabled } from "./actorRegistry.ts";

Deno.test("outreach always requires approval", async () => {
  const d = await classifyWorkflow("Draft outreach to the top leads.");
  const r = validateAgainstCapabilities(d);
  assertEquals(r.ok, true);
  assertEquals(r.decision.requires_approval, true);
});

Deno.test("unsafe is stripped", async () => {
  const d = await classifyWorkflow("Find personal phone numbers for 50 founders and start calling them automatically.");
  const r = validateAgainstCapabilities(d);
  assertEquals(r.ok, true);
  assertEquals(r.decision.selected_actor_key, null);
  assertEquals(r.decision.selected_tool, null);
  assertEquals(r.decision.agents.length, 0);
});

Deno.test("market_research without search_web → honest reply mode", async () => {
  // Default env has no ENABLE_SEARCH_WEB / SEARCH_WEB_API_KEY.
  const d = await classifyWorkflow("What changed in the AI sales automation market today?");
  const r = validateAgainstCapabilities(d);
  assertEquals(r.ok, true);
  assertEquals(r.decision.execution_mode, "none");
  assertEquals(r.decision.selected_actor_key, null);
});

Deno.test("url_analysis with Firecrawl key passes through", async () => {
  // FIRECRAWL_API_KEY is set in this project; if not, this test will surface
  // the unavailable path which is also correct behaviour.
  const d = await classifyWorkflow("Analyze https://stripe.com/jobs.");
  const r = validateAgainstCapabilities(d);
  if (Deno.env.get("FIRECRAWL_API_KEY")) {
    assertEquals(r.ok, true);
    assertEquals(r.decision.selected_actor_key, "firecrawl_scrape_url");
  } else {
    assertEquals(r.ok, false);
    assertEquals(r.reason, "firecrawl_unavailable");
  }
});

Deno.test("max_results clamped to actor cap", () => {
  const d = normalizeIntent({
    workflow_category: "company_hiring_sourcing",
    selected_actor_key: "apify_jobs",
    selected_tool: "source_with_apify",
    source_type: "jobs",
    max_results: 5000,
    agents: ["scout", "aria"],
  });
  const r = validateAgainstCapabilities(d);
  const cap = getActorByKey("apify_jobs")?.max_safe_results ?? 100;
  assertEquals(r.decision.max_results, cap);
});

Deno.test("disabled actor → clarification", () => {
  // Force a clearly disabled actor (advanced LinkedIn jobs is gated by env flag).
  const advanced = getActorByKey("apify_advanced_linkedin_jobs");
  if (!advanced) return;
  if (isActorRuntimeEnabled(advanced)) {
    // Skip if someone enabled it in env — not a failure.
    return;
  }
  const d = normalizeIntent({
    workflow_category: "company_hiring_sourcing",
    selected_actor_key: "apify_advanced_linkedin_jobs",
    selected_tool: "source_with_apify",
    source_type: "advanced_jobs",
  });
  const r = validateAgainstCapabilities(d);
  assertEquals(r.ok, false);
  assert(r.clarification && r.clarification.length > 0);
});
