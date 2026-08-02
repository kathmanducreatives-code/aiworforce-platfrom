import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractContentLoopInput,
  buildContentLoopQueries,
  buildContentLoopPlan,
  normalizeContentLoopDrafts,
  DEFAULT_TONE,
  MAX_ENGAGEMENT_QUERIES,
  MAX_RESULTS_PER_QUERY,
} from "./contentEngagementLoop.ts";

Deno.test("extractContentLoopInput: founder post + engagement", () => {
  const i = extractContentLoopInput(
    "Write a founder LinkedIn post about AI GTM agents, then find people I should engage with.",
  );
  assertEquals(i.topic, "AI GTM agents");
  assertEquals(i.contentFormat, "linkedin_post");
  assert(i.needsEngagementSearch);
  assertEquals(i.needsCommentDrafts, false);
  assertEquals(i.needsDmDrafts, false);
});

Deno.test("extractContentLoopInput: post ideas count + comment drafts", () => {
  const i = extractContentLoopInput(
    "Create 3 LinkedIn post ideas for Agentory and find relevant conversations to comment on.",
  );
  assertEquals(i.contentFormat, "post_ideas");
  assertEquals(i.maxPosts, 3);
  assert(i.needsEngagementSearch);
  assert(i.needsCommentDrafts);
});

Deno.test("extractContentLoopInput: does NOT invent a product update", () => {
  // bare reference, no inline content → productUpdate undefined
  const i = extractContentLoopInput("Turn these product updates into a LinkedIn post and draft comments for related posts.");
  assertEquals(i.productUpdate, undefined);
  assert(i.needsCommentDrafts);
  // inline content provided → captured
  const j = extractContentLoopInput("Turn these product updates into a post: shipped SSO, added webhooks, faster import.");
  assert((j.productUpdate ?? "").includes("SSO"));
});

Deno.test("extractContentLoopInput: competitor-related detection", () => {
  const i = extractContentLoopInput(
    "Write a post about why AI SDR tools fail and find competitor conversations to engage with.",
  );
  assert(i.competitorRelated);
  assert(i.needsEngagementSearch);
});

Deno.test("buildContentLoopQueries: builds from topic, capped, no empties", () => {
  const qs = buildContentLoopQueries({ topic: "AI GTM agents" });
  assert(qs.length > 0);
  assert(qs.length <= MAX_ENGAGEMENT_QUERIES);
  assertEquals(qs[0], "AI GTM agents");
  for (const q of qs) assert(q.trim().length > 0, "no empty query");
});

Deno.test("buildContentLoopQueries: uses company_brain audience when present", () => {
  const qs = buildContentLoopQueries({ topic: "cold email" }, { who_we_sell_to: "early-stage B2B founders" });
  assert(qs.some((q) => q.includes("early-stage B2B founders")), "audience-tailored query present");
});

Deno.test("buildContentLoopQueries: empty when no topic and no context", () => {
  assertEquals(buildContentLoopQueries({}), []);
});

Deno.test("buildContentLoopQueries: competitor-related yields competitor-style queries", () => {
  const qs = buildContentLoopQueries({ topic: "AI SDR tools", competitorRelated: true });
  assert(qs.length > 0 && qs.length <= MAX_ENGAGEMENT_QUERIES);
  const joined = qs.join(" | ").toLowerCase();
  assert(/alternative|switch|vs|problem|competitor/.test(joined), `competitor-style queries: ${joined}`);
});

Deno.test("buildContentLoopPlan: caps + reactions off + comments off (no people harvest)", () => {
  const plan = buildContentLoopPlan({ topic: "AI GTM agents", needsEngagementSearch: true });
  assert(plan.search_budget.max_queries <= MAX_ENGAGEMENT_QUERIES);
  assert(plan.search_budget.max_results_per_query <= MAX_RESULTS_PER_QUERY);
  assertEquals(plan.search_budget.scrape_reactions, false);
  assertEquals(plan.search_budget.scrape_comments, false);
  assertEquals(plan.post_brief.tone, DEFAULT_TONE);
  assert(plan.post_brief.topic.length > 0);
  assert(plan.engagement_queries.length > 0);
});

Deno.test("buildContentLoopPlan: default tone + brain audience + competitor angle", () => {
  const plan = buildContentLoopPlan(
    { topic: "AI SDR tools", competitorRelated: true, needsEngagementSearch: true },
    { icp: "seed-stage GTM founders" },
  );
  assertEquals(plan.post_brief.audience, "seed-stage GTM founders");
  assert(plan.post_brief.angle.toLowerCase().includes("augment"));
});

Deno.test("buildContentLoopPlan: no engagement queries when search disabled", () => {
  const plan = buildContentLoopPlan({ topic: "AI GTM agents", needsEngagementSearch: false });
  assertEquals(plan.engagement_queries.length, 0);
});

Deno.test("normalizeContentLoopDrafts: string + object shapes", () => {
  assertEquals(normalizeContentLoopDrafts("  hello post  ").post, "hello post");
  const o = normalizeContentLoopDrafts({ post: "p", post_ideas: ["a", "b"], comments: ["c1"] });
  assertEquals(o.post, "p");
  assertEquals(o.post_ideas, ["a", "b"]);
  assertEquals(o.comments, ["c1"]);
  assertEquals(normalizeContentLoopDrafts(null), { post: null, post_ideas: [], comments: [] });
});
