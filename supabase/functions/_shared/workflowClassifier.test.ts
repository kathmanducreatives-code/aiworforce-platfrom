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
    "Find people discussing GojiBerry and Clay.",
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
