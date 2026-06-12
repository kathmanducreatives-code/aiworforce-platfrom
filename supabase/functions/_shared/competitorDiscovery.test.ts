import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractInlineBusinessContext,
  mergeContext,
  hasEnoughContext,
  resolveDiscoveryMode,
  buildCompetitorHypotheses,
  buildLinkedInSearchQueryGroups,
  buildCompetitorDiscoveryPlan,
  classifyConversationType,
  buildCompetitorQueryPlan,
  normalizeCompetitorHypotheses,
  hasEnoughCompetitorContext,
  buildCompetitorSearchQueries,
  parseInferredCompetitors,
} from "./competitorDiscovery.ts";

Deno.test("extracts website + description from message", () => {
  const c = extractInlineBusinessContext("Find competitors for https://example.com and track LinkedIn conversations");
  assertEquals(c.website_url, "https://example.com");
  const d = extractInlineBusinessContext("We sell AI employees for GTM teams. Find competitor conversations");
  assert(d.description && d.description.toLowerCase().includes("ai employees"));
  assertEquals(d.website_url, null);
});

Deno.test("context detection + mode resolution", () => {
  assertEquals(hasEnoughContext({ website_url: null, linkedin_url: null, description: null, brain_summary: null }), false);
  assertEquals(resolveDiscoveryMode({ website_url: "https://x.com", linkedin_url: null, description: null, brain_summary: null }), "website");
  assertEquals(resolveDiscoveryMode({ website_url: null, linkedin_url: null, description: "AI employees for GTM teams", brain_summary: null }), "description");
  assertEquals(resolveDiscoveryMode({ website_url: null, linkedin_url: null, description: null, brain_summary: null }), "needs_context");
});

Deno.test("mergeContext prefers inline then stored", () => {
  const m = mergeContext(
    { website_url: null, linkedin_url: null, description: "inline desc", brain_summary: null },
    { website_url: "https://brain.com", description: "stored desc" },
  );
  assertEquals(m.website_url, "https://brain.com");
  assertEquals(m.description, "inline desc");
});

Deno.test("hypotheses: known seeds only, never invents when weak", () => {
  const known = buildCompetitorHypotheses({ website_url: null, linkedin_url: null, description: "we compete with Clay and Apollo on GTM data", brain_summary: null });
  assertEquals(known.source, "known");
  assert(known.hypotheses.includes("Clay") && known.hypotheses.includes("Apollo"));

  // Weak/no known competitor → empty, source "none" (LLM must infer, we don't invent)
  const weak = buildCompetitorHypotheses({ website_url: null, linkedin_url: null, description: "we make a productivity app for teachers", brain_summary: null });
  assertEquals(weak.hypotheses, []);
  assertEquals(weak.source, "none");
});

Deno.test("query groups: direct/comparisons/complaints/alternative/category", () => {
  const g = buildLinkedInSearchQueryGroups(["Clay", "GojiBerry"], { category: "gtm_data" });
  assert(g.direct_mentions.includes("Clay"));
  assert(g.comparisons.includes("Clay vs"));
  assert(g.complaints.includes("Clay problems"));
  assert(g.alternative_seeking.includes("alternative to Clay"));
  assert(g.category_discussions.length > 0);
});

Deno.test("discovery plan shapes", () => {
  const website = buildCompetitorDiscoveryPlan("website", { website_url: "https://x.com" });
  assertEquals(website.steps[0].agent_slug, "hawk");
  assertEquals(website.steps[0].tool_needed, "scrape_url"); // Firecrawl-first
  assert(website.steps.some((s) => s.agent_slug === "scout"));
  assert(website.steps.some((s) => s.agent_slug === "aria"));

  const desc = buildCompetitorDiscoveryPlan("description", { description: "AI employees for GTM" });
  assertEquals(desc.steps[0].agent_slug, "hawk"); // infer-first (no scrape_url)
  assertEquals(desc.steps[0].tool_needed, "extract_structured");

  const known = buildCompetitorDiscoveryPlan("known", {});
  assertEquals(known.steps[0].agent_slug, "scout"); // straight to search

  const withDrafts = buildCompetitorDiscoveryPlan("known", { needs_comment_drafts: true, needs_dm_drafts: true });
  assert(withDrafts.steps.some((s) => s.agent_slug === "scribe"));
  assert(withDrafts.steps.some((s) => s.agent_slug === "penn" && s.requires_approval));
});

Deno.test("classifyConversationType angles", () => {
  assertEquals(classifyConversationType("Clay vs Artisan, which is better?"), "comparison");
  assertEquals(classifyConversationType("looking for a good AI SDR tool"), "alternative_seeking");
  assertEquals(classifyConversationType("Apollo data quality is broken and annoying"), "complaint");
  assertEquals(classifyConversationType("lots of people commenting on this launch"), "audience_engagement");
  assertEquals(classifyConversationType("thoughts on AI sales agents"), "category_discussion");
});

Deno.test("buildCompetitorQueryPlan: known competitors → hypotheses + groups + budget", () => {
  const plan = buildCompetitorQueryPlan({ knownCompetitors: ["Clay", "GojiBerry"], productCategory: "AI SDR tools" });
  assert(plan.competitors.length >= 2);
  assert(plan.competitors.every((c) => c.confidence >= 0 && c.confidence <= 1));
  assert(plan.query_groups.direct_mentions.some((q) => q.startsWith("Clay")));
  assert(plan.query_groups.audience_engagement.length > 0);
  assertEquals(plan.search_budget.scrape_reactions, false);
  assert(plan.search_budget.max_queries <= 5);
});

Deno.test("buildCompetitorQueryPlan: weak description invents nothing", () => {
  const plan = buildCompetitorQueryPlan({ businessDescription: "a productivity app for teachers" });
  assertEquals(plan.competitors.length, 0);
  // still gives category discussion queries to search
  assert(plan.query_groups.category_discussion.length > 0);
});

Deno.test("normalizeCompetitorHypotheses: dedupe, clamp, drop noisy one-word", () => {
  const out = normalizeCompetitorHypotheses([
    { name: "Clay", category: "gtm_data", reason: "x", confidence: 1.5, source: "seed", keywords: ["a", "a"] },
    { name: "clay", category: "gtm_data", reason: "dup", confidence: 0.5, source: "seed", keywords: [] },
    { name: "synergy", category: "other", reason: "noise", confidence: 0.4, source: "ai_inferred", keywords: [] },
  ]);
  assertEquals(out.length, 1, "deduped + noisy dropped");
  assertEquals(out[0].confidence, 1, "clamped to 1");
  assertEquals(out[0].keywords.length, 1, "keywords deduped");
});

Deno.test("hasEnoughCompetitorContext + search queries", () => {
  assertEquals(hasEnoughCompetitorContext({}), false);
  assertEquals(hasEnoughCompetitorContext({ knownCompetitors: ["Clay"] }), true);
  assertEquals(hasEnoughCompetitorContext({ websiteUrl: "https://x.com" }), true);
  const q = buildCompetitorSearchQueries(buildCompetitorQueryPlan({ knownCompetitors: ["Clay"] }).competitors, "GTM");
  assert(q.length > 0);
});

// Phase 4.2 — actor registry for the new optional actors.
import { getActorByKey, isActorRuntimeEnabled } from "./actorRegistry.ts";
Deno.test("registry: phase 4.2 optional actors exist with caps + honest fallback", () => {
  for (const [key, actorId, cap] of [
    ["apify_linkedin_company_posts", "harvestapi/linkedin-company-posts", 20],
    ["apify_linkedin_post_comments", "api-empire/post-comments-engagements-scraper-linkedin", 50],
    ["apify_google_search", "scrapemesh/google-search-results-scraper", 20],
  ] as const) {
    const a = getActorByKey(key);
    assert(a, `${key} registered`);
    assertEquals(a!.actor_id, actorId);
    assertEquals(a!.max_safe_results, cap);
    assert(a!.missing_message && a!.missing_message.length > 0, `${key} has honest fallback`);
    // disabled by default in test env (no enable flag) → honest unavailable path
    if (!isActorRuntimeEnabled(a!)) assertEquals(isActorRuntimeEnabled(a!), false);
  }
});

Deno.test("parseInferredCompetitors: JSON block + seed fallback, never invents", () => {
  const fromJson = `Here are competitors:
\`\`\`json
{"competitors":[{"name":"Regie.ai","category":"ai_sdr","reason":"AI sales content","confidence":0.7}],"category":"ai_sdr","keywords":["AI SDR"]}
\`\`\``;
  const r = parseInferredCompetitors(fromJson);
  assert(r.competitors.some((c) => c.name === "Regie.ai" && c.source === "ai_inferred"));
  assertEquals(r.category, "ai_sdr");

  const fromText = parseInferredCompetitors("They likely compete with Clay and Apollo on outbound.");
  assert(fromText.competitors.some((c) => c.name === "Clay"));

  const nothing = parseInferredCompetitors("I'm not sure who the competitors are.");
  assertEquals(nothing.competitors.length, 0); // no invention
});
