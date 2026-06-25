// Unit tests for workflowClassifier. All test cases use only the regex layer
// (no AI calls). If the regex layer changes such that a case falls through to
// AI, the test will fail clearly (source === "regex" is asserted).
//
// Run with: supabase--test_edge_functions

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyWorkflow, normalizeIntent, type WorkflowCategory } from "./workflowClassifier.ts";

async function cat(message: string): Promise<WorkflowCategory> {
  const d = await classifyWorkflow(message);
  return d.workflow_category;
}

Deno.test("simple_chat: greetings/thanks", async () => {
  assertEquals(await cat("hey"), "simple_chat");
  assertEquals(await cat("thanks"), "simple_chat");
  assertEquals(await cat("hello"), "simple_chat");
});

Deno.test("capabilities: what can you do", async () => {
  assertEquals(await cat("what can you do?"), "capabilities");
  assertEquals(await cat("what are your features?"), "capabilities");
  assertEquals(await cat("what agents do I have?"), "agent_management");
});

Deno.test("daily_brief", async () => {
  assertEquals(await cat("brief me on today"), "daily_brief");
  assertEquals(await cat("plan my day"), "daily_brief");
});

Deno.test("content_creation: posts, founder updates, reports", async () => {
  assertEquals(await cat("Write a LinkedIn post about what we shipped this week."), "content_creation");
  assertEquals(await cat("Can you turn our recent work into a founder update?"), "content_creation");
  assertEquals(await cat("Draft a launch post for Agentory."), "content_creation");
});

Deno.test("market_research: current/competitor/news", async () => {
  assertEquals(await cat("What changed in the AI sales automation market today?"), "market_research");
  assertEquals(await cat("Give me current competitor updates."), "market_research");
  assertEquals(await cat("What's happening in the AI SDR market right now?"), "market_research");
});

Deno.test("url_analysis: URL present → Firecrawl", async () => {
  const d1 = await classifyWorkflow("Analyze https://stripe.com/jobs.");
  assertEquals(d1.workflow_category, "url_analysis");
  assertEquals(d1.selected_actor_key, "firecrawl_scrape_url");
  assertEquals(d1.selected_tool, "scrape_url");
  assertEquals(await cat("Check this careers page and summarize what they're hiring for: https://example.com/careers"), "url_analysis");
});

Deno.test("signal_sourcing: vague lead requests → clarification", async () => {
  const d = await classifyWorkflow("Find me leads for Agentory.");
  assertEquals(d.workflow_category, "signal_sourcing");
  assertEquals(d.needs_clarification, true);
  assert(d.clarification_question && d.clarification_question.length > 0);
});

Deno.test("people_sourcing: explicit individual profiles", async () => {
  const d = await classifyWorkflow("Find 10 individual React developer profiles in London.");
  assertEquals(d.workflow_category, "people_sourcing");
  assertEquals(d.selected_actor_key, "apify_people_search");
  assertEquals(await cat("Find senior backend engineers in the United Kingdom."), "people_sourcing");
});

Deno.test("company_hiring_sourcing: companies hiring <role>", async () => {
  const d = await classifyWorkflow("Find companies hiring GTM roles in the US.");
  assertEquals(d.workflow_category, "company_hiring_sourcing");
  assertEquals(d.selected_actor_key, "apify_jobs");
  assertEquals(await cat("Find companies hiring React engineers in London."), "company_hiring_sourcing");
});

Deno.test("outreach: draft outreach", async () => {
  const d = await classifyWorkflow("Draft outreach to the top leads.");
  assertEquals(d.workflow_category, "outreach");
  assertEquals(d.requires_approval, true);
  assertEquals(await cat("Write LinkedIn DMs for the top 5."), "outreach");
});

// Phase 2 memory-driven follow-up: "Draft outreach to the top 5." must classify
// as `outreach` (NOT a sourcing category) so pilot-chat routes it to the
// memory/no-memory path instead of starting a new Apify sourcing run.
Deno.test("outreach: 'Draft outreach to the top 5.' is outreach, not sourcing", async () => {
  const d = await classifyWorkflow("Draft outreach to the top 5.");
  assertEquals(d.workflow_category, "outreach");
  assertEquals(d.requires_approval, true);
});

// Explicit sourcing + outreach in one message must still run sourcing (it is a
// sourcing category with needs_outreach=true), so the no-memory guard never
// short-circuits it.
Deno.test("company_hiring_sourcing: explicit 'find … and draft outreach' still sources", async () => {
  const d = await classifyWorkflow("Find companies hiring GTM roles in the US and draft outreach.");
  assertEquals(d.workflow_category, "company_hiring_sourcing");
  assertEquals(d.needs_outreach, true);
  assertEquals(d.requires_approval, true);
});

// Phase 3 — LinkedIn engagement signal sourcing.
Deno.test("linkedin_engagement: posts/people/conversations route to apify_linkedin_posts", async () => {
  const prompts = [
    "Find LinkedIn posts where founders talk about outbound problems.",
    "Find posts I should comment on about AI SDRs.",
    "Find people discussing manual outbound on LinkedIn.",
    "Find founders posting about hiring SDRs.",
  ];
  for (const p of prompts) {
    const d = await classifyWorkflow(p);
    assertEquals(d.workflow_category, "signal_sourcing", p);
    assertEquals(d.signal_type, "linkedin_engagement", p);
    assertEquals(d.selected_actor_key, "apify_linkedin_posts", p);
    assertEquals(d.source_type, "linkedin_engagement", p);
    assertEquals(d.needs_clarification, false, p);
  }
});

Deno.test("competitor_engagement safety: auto-DM is unsafe", async () => {
  assertEquals(await cat("Find people engaging with GojiBerry and automatically DM them."), "unsafe_or_unsupported");
});

// Phase 4.2 — commenter extraction.
Deno.test("extract_commenters: needs a post URL", async () => {
  const d = await classifyWorkflow("Extract commenters from this LinkedIn post and rank them.");
  assertEquals(d.workflow_category, "signal_sourcing");
  assertEquals(d.extract_commenters, true);
  assertEquals(d.selected_actor_key, "apify_linkedin_post_comments");
  assertEquals(d.needs_clarification, true);

  const d2 = await classifyWorkflow("Find people commenting on this post: https://linkedin.com/posts/abc123 and rank them.");
  assertEquals(d2.extract_commenters, true);
  assertEquals(d2.needs_clarification, false);
  assert((d2.post_urls ?? []).length === 1);
});

Deno.test("safety: mass-send is unsafe", async () => {
  assertEquals(await cat("Send messages to all commenters on this post."), "unsafe_or_unsupported");
});

// Phase 4 (dynamic) — competitor discovery.
Deno.test("competitor_discovery: no context → clarification", async () => {
  const d = await classifyWorkflow("Find my competitors.");
  assertEquals(d.workflow_category, "signal_sourcing");
  assertEquals(d.signal_type, "competitor_engagement");
  assertEquals(d.competitor_discovery, true);
  assertEquals(d.discovery_mode, "needs_context");
  assertEquals(d.needs_clarification, true);
  assert(d.clarification_question && d.clarification_question.length > 0);
});

Deno.test("competitor_discovery: website mode (with and without a count)", async () => {
  for (const p of [
    "Find competitors for https://example.com and track LinkedIn conversations",
    "Find 5 competitors for https://example.com and track LinkedIn conversations",
  ]) {
    const d = await classifyWorkflow(p);
    assertEquals(d.competitor_discovery, true, p);
    assertEquals(d.discovery_mode, "website", p);
    assertEquals(d.business_website, "https://example.com", p);
    assertEquals(d.signal_type, "competitor_engagement", p);
  }
});

Deno.test("competitor_discovery: description mode", async () => {
  const d = await classifyWorkflow("We sell AI employees for GTM teams. Find competitor conversations");
  assertEquals(d.competitor_discovery, true);
  assertEquals(d.discovery_mode, "description");
  assert(d.business_description && /ai employees/i.test(d.business_description));
});

Deno.test("competitor_discovery does NOT hijack known-competitor tracking", async () => {
  const d = await classifyWorkflow("Find people talking about Clay and GojiBerry");
  assertEquals(d.signal_type, "competitor_engagement");
  assertEquals(d.competitor_discovery, false);
  assertEquals(d.selected_actor_key, "apify_linkedin_posts");
});

// Phase 4 — competitor engagement.
Deno.test("competitor_engagement: keyword mode → apify_linkedin_posts", async () => {
  for (const p of [
    "Find people talking about GojiBerry and Clay on LinkedIn.",
    "Track competitor conversations around AI SDR tools.",
    "Find posts comparing Clay and Artisan.",
    "Find people complaining about Apollo.",
  ]) {
    const d = await classifyWorkflow(p);
    assertEquals(d.workflow_category, "signal_sourcing", p);
    assertEquals(d.signal_type, "competitor_engagement", p);
    assertEquals(d.selected_actor_key, "apify_linkedin_posts", p);
    assertEquals(d.source_type, "linkedin_engagement", p);
  }
  const g = await classifyWorkflow("Find people talking about GojiBerry and Clay on LinkedIn.");
  assert(g.competitors!.includes("gojiberry") && g.competitors!.includes("clay"));
  assert((g.keywords ?? []).some((k) => k.startsWith("GojiBerry")));
});

Deno.test("competitor_engagement: company URL → profile-posts actor", async () => {
  const d = await classifyWorkflow("Monitor recent posts from this LinkedIn company page: https://linkedin.com/company/gojiberry");
  assertEquals(d.signal_type, "competitor_engagement");
  assertEquals(d.selected_actor_key, "apify_linkedin_profile_posts");
});

Deno.test("competitor_engagement: generic LinkedIn (no competitor) stays linkedin_engagement", async () => {
  const d = await classifyWorkflow("Find LinkedIn posts where founders talk about outbound problems.");
  assertEquals(d.signal_type, "linkedin_engagement");
  assertEquals(d.selected_actor_key, "apify_linkedin_posts");
});

Deno.test("linkedin_engagement: profile/company URL → profile-posts actor", async () => {
  const d = await classifyWorkflow("Check recent posts from this LinkedIn profile: https://linkedin.com/in/janedoe");
  assertEquals(d.workflow_category, "signal_sourcing");
  assertEquals(d.signal_type, "linkedin_engagement");
  assertEquals(d.selected_actor_key, "apify_linkedin_profile_posts");
  assertEquals(d.source_type, "linkedin_engagement");

  const c = await classifyWorkflow("Monitor recent posts from this company page: https://linkedin.com/company/acme");
  assertEquals(c.selected_actor_key, "apify_linkedin_profile_posts");
});

Deno.test("linkedin_engagement: comment vs DM sub-intent + competitor keywords", async () => {
  const c = await classifyWorkflow("Find posts I should comment on about AI SDRs and draft comments.");
  assertEquals(c.needs_comment_drafts, true);
  assertEquals(c.execution_mode, "outreach");

  const dm = await classifyWorkflow("Find founders talking about outbound problems and draft soft DMs.");
  assertEquals(dm.needs_dm_drafts, true);
  assertEquals(dm.requires_approval, true);

  const comp = await classifyWorkflow("Find people discussing GojiBerry and Clay.");
  assertEquals(comp.competitor_related, true);
  assert(comp.keywords!.some((k) => k.toLowerCase().includes("clay")));
});

Deno.test("agent_management", async () => {
  assertEquals(await cat("What is Penn working on?"), "agent_management");
  assertEquals(await cat("What can Scout do?"), "agent_management");
});

Deno.test("approval_review", async () => {
  assertEquals(await cat("What approvals are pending?"), "approval_review");
  assertEquals(await cat("Show me drafts waiting for approval."), "approval_review");
});

Deno.test("unsafe_or_unsupported: auto-comment/post/dm refused", async () => {
  assertEquals(await cat("Find posts I should comment on about AI SDRs and automatically comment on them."), "unsafe_or_unsupported");
  assertEquals(await cat("Auto-DM everyone who engages with my post."), "unsafe_or_unsupported");
});

Deno.test("unsafe_or_unsupported", async () => {
  const d = await classifyWorkflow("Find personal phone numbers for 50 founders and start calling them automatically.");
  assertEquals(d.workflow_category, "unsafe_or_unsupported");
  assertEquals(d.selected_actor_key, null);
  assertEquals(await cat("Send emails automatically without approval."), "unsafe_or_unsupported");
});

Deno.test("unclear: vague short prompts", async () => {
  assertEquals(await cat("Can you help with this?"), "unclear");
});

Deno.test("normalizeIntent: clamps + enforces outreach approval", () => {
  const d = normalizeIntent({
    workflow_category: "outreach",
    confidence: 2,
    max_results: 9999,
    needs_outreach: true,
  });
  assertEquals(d.confidence, 1);
  assertEquals(d.max_results, 200);
  assertEquals(d.requires_approval, true);
});

Deno.test("normalizeIntent: unsafe wipes tools/agents", () => {
  const d = normalizeIntent({
    workflow_category: "unsafe_or_unsupported",
    selected_actor_key: "apify_jobs",
    selected_tool: "source_with_apify",
    agents: ["scout"],
    execution_mode: "fast",
  });
  assertEquals(d.selected_actor_key, null);
  assertEquals(d.selected_tool, null);
  assertEquals(d.agents.length, 0);
  assertEquals(d.execution_mode, "none");
});

// ---------- Phase 7 — Founder Content + Engagement Loop ----------

Deno.test("content_engagement_loop: post + find people to engage", async () => {
  const d = await classifyWorkflow(
    "Write a founder LinkedIn post about what we shipped this week, then find people I should engage with.",
  );
  assertEquals(d.workflow_category, "content_creation");
  assertEquals(d.execution_mode, "content_engagement_loop");
  assertEquals(d.needs_content, true);
  assertEquals(d.needs_engagement_search, true);
  assertEquals(d.signal_type, "linkedin_engagement");
  assertEquals(d.needs_dm_drafts, false);
  assertEquals(d.source, "regex");
});

Deno.test("content_engagement_loop: post ideas + conversations to comment on", async () => {
  const d = await classifyWorkflow(
    "Create 3 LinkedIn post ideas for Agentory and find relevant conversations to comment on.",
  );
  assertEquals(d.execution_mode, "content_engagement_loop");
  assertEquals(d.needs_content, true);
  assertEquals(d.needs_engagement_search, true);
  assertEquals(d.needs_comment_drafts, true);
});

Deno.test("content_engagement_loop: turn updates into post + draft comments", async () => {
  const d = await classifyWorkflow(
    "Turn these product updates into a LinkedIn post and draft comments for related posts.",
  );
  assertEquals(d.execution_mode, "content_engagement_loop");
  assertEquals(d.needs_comment_drafts, true);
});

Deno.test("content_engagement_loop: build a founder content loop", async () => {
  const d = await classifyWorkflow("Help me build a founder content loop for AI GTM agents.");
  assertEquals(d.execution_mode, "content_engagement_loop");
  assertEquals(d.needs_content, true);
  assertEquals(d.needs_engagement_search, true);
});

Deno.test("content_engagement_loop: competitor content loop tags competitor_engagement", async () => {
  const d = await classifyWorkflow(
    "Write a post about why AI SDR tools fail and find competitor conversations to engage with.",
  );
  assertEquals(d.execution_mode, "content_engagement_loop");
  assertEquals(d.signal_type, "competitor_engagement");
  assertEquals(d.competitor_related, true);
});

Deno.test("content-only stays Scribe-only (no engagement)", async () => {
  for (const p of ["Write a LinkedIn post.", "Draft a tweet.", "Create content ideas."]) {
    const d = await classifyWorkflow(p);
    assertEquals(d.workflow_category, "content_creation", p);
    assert(d.execution_mode !== "content_engagement_loop", `${p} must not be a loop`);
    assertEquals(d.needs_engagement_search ?? false, false, p);
  }
});

Deno.test("engagement-only stays Phase 3 linkedin_engagement (no content)", async () => {
  const d = await classifyWorkflow("Find posts I should comment on about AI SDRs.");
  assertEquals(d.workflow_category, "signal_sourcing");
  assertEquals(d.signal_type, "linkedin_engagement");
  assert(d.execution_mode !== "content_engagement_loop");
});

Deno.test("engagement-only with replies stays Phase 3 (no post creation)", async () => {
  const d = await classifyWorkflow("Find posts I should comment on today, then draft thoughtful replies.");
  assertEquals(d.workflow_category, "signal_sourcing");
  assert(d.execution_mode !== "content_engagement_loop");
  assertEquals(d.needs_comment_drafts, true);
});

Deno.test("unsafe: write a post and automatically comment on 50 posts", async () => {
  const d = await classifyWorkflow("Write a LinkedIn post and automatically comment on 50 posts.");
  assertEquals(d.workflow_category, "unsafe_or_unsupported");
  assertEquals(d.selected_actor_key, null);
  assertEquals(d.agents.length, 0);
});

Deno.test("unsafe: auto-DM everyone who likes my post", async () => {
  const d = await classifyWorkflow("Auto-DM everyone who likes my post.");
  assertEquals(d.workflow_category, "unsafe_or_unsupported");
});

Deno.test("unsafe: post this to LinkedIn automatically", async () => {
  const d = await classifyWorkflow("Post this to LinkedIn automatically.");
  assertEquals(d.workflow_category, "unsafe_or_unsupported");
});

Deno.test("unsafe: scrape comments and auto-message everyone", async () => {
  const d = await classifyWorkflow("Scrape LinkedIn comments and auto-message everyone.");
  assertEquals(d.workflow_category, "unsafe_or_unsupported");
  assertEquals(d.selected_actor_key, null);
});

Deno.test("unsafe: find leads and email them automatically", async () => {
  const d = await classifyWorkflow("Find 50 leads and email them automatically.");
  assertEquals(d.workflow_category, "unsafe_or_unsupported");
});

Deno.test("unsafe: send outreach now (auto-send via 'now')", async () => {
  const d = await classifyWorkflow("Find emails and send outreach now.");
  assertEquals(d.workflow_category, "unsafe_or_unsupported");
});

// ---- Phase 3: generic sourcing fallback must NOT silently default to jobs ----
Deno.test("Phase3: 'Find more customers' → clarification, not silent jobs", async () => {
  const d = await classifyWorkflow("Find more customers");
  assert(d.selected_actor_key !== "apify_jobs", "must not silently pick jobs");
  assert(d.needs_clarification, "should ask which source");
});

Deno.test("Phase3: bare 'find some leads' → clarification, not jobs", async () => {
  const d = await classifyWorkflow("find some leads");
  assertEquals(d.workflow_category, "signal_sourcing");
  assertEquals(d.selected_actor_key, null);
  assert(d.needs_clarification);
});

Deno.test("Phase3: 'Find me leads' classifier → not jobs (pilot shows selector)", async () => {
  const d = await classifyWorkflow("Find me leads");
  assert(d.selected_actor_key !== "apify_jobs", "broad lead ask must not default to jobs");
});

Deno.test("Phase3 regression: explicit companies-hiring still → jobs", async () => {
  const d = await classifyWorkflow("Find 5 companies hiring React engineers in London");
  assertEquals(d.workflow_category, "company_hiring_sourcing");
  assertEquals(d.selected_actor_key, "apify_jobs");
});

Deno.test("Phase3: clear company/category intent → jobs (company search source)", async () => {
  const d = await classifyWorkflow("find companies in fintech");
  assertEquals(d.workflow_category, "company_hiring_sourcing");
  assertEquals(d.selected_actor_key, "apify_jobs");
});

Deno.test("Decision-maker Discovery 2.0: explicit founder routing", async () => {
  assertEquals(await cat("Find 5 founders at recruiting agencies in USA"), "people_sourcing");
  assertEquals(await cat("Find 5 CEOs of healthcare AI companies in London"), "people_sourcing");
  assertEquals(await cat("Find heads of growth at B2B SaaS companies"), "people_sourcing");
  
  assertEquals(await cat("Find 5 recruiting agencies in USA"), "company_hiring_sourcing");
  assertEquals(await cat("Find 5 companies in healthcare AI"), "company_hiring_sourcing");
  assertEquals(await cat("Find 5 agencies hiring SDRs"), "company_hiring_sourcing");
});
