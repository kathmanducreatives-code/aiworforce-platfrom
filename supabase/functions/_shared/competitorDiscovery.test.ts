import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractInlineBusinessContext,
  mergeContext,
  hasEnoughContext,
  resolveDiscoveryMode,
  buildCompetitorHypotheses,
  buildLinkedInSearchQueryGroups,
  buildCompetitorDiscoveryPlan,
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
