import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateWorkflowStatus, summarizeAttempts, shouldRetry } from "../../supabase/functions/_shared/adaptiveWorkflow.ts";

Deno.test("tool failure → failed (not complete)", () => {
  assertEquals(evaluateWorkflowStatus({ workflow_type: "lead_sourcing", requested: 5, produced: 0, tool_failed: true }).status, "failed");
});

Deno.test("zero results → failed (not complete)", () => {
  assertEquals(evaluateWorkflowStatus({ workflow_type: "lead_sourcing", requested: 5, produced: 0 }).status, "failed");
});

Deno.test("4/5 → partial; 5/5 → complete", () => {
  assertEquals(evaluateWorkflowStatus({ workflow_type: "lead_sourcing", requested: 5, produced: 4 }).status, "partial");
  assertEquals(evaluateWorkflowStatus({ workflow_type: "lead_sourcing", requested: 5, produced: 5 }).status, "complete");
  assertEquals(evaluateWorkflowStatus({ workflow_type: "lead_sourcing", requested: 5, produced: 7 }).status, "complete");
});

Deno.test("enrichment 3/5 → partial; all fail → failed", () => {
  assertEquals(evaluateWorkflowStatus({ workflow_type: "website_enrichment", requested: 5, produced: 3 }).status, "partial");
  assertEquals(evaluateWorkflowStatus({ workflow_type: "website_enrichment", requested: 5, produced: 0, tool_failed: true }).status, "failed");
});

Deno.test("outreach drafting: drafts awaiting approval → complete (nothing sent)", () => {
  const r = evaluateWorkflowStatus({ workflow_type: "outreach_drafting", requested: 5, produced: 5, awaiting_approval: true });
  assertEquals(r.status, "complete");
  assert(/approval|sent/i.test(r.reason));
});

Deno.test("outreach drafting: no leads/context → failed", () => {
  assertEquals(evaluateWorkflowStatus({ workflow_type: "outreach_drafting", requested: 5, produced: 0 }).status, "failed");
});

Deno.test("content: created with incomplete brain → complete; nothing → failed", () => {
  assertEquals(evaluateWorkflowStatus({ workflow_type: "content_creation", produced: 1, has_required_context: false }).status, "complete");
  assertEquals(evaluateWorkflowStatus({ workflow_type: "content_creation", produced: 0 }).status, "failed");
});

Deno.test("competitor tracking: no context + no brain → failed; needs user input → blocked", () => {
  assertEquals(evaluateWorkflowStatus({ workflow_type: "competitor_tracking", requested: 5, produced: 0, has_required_context: false }).status, "failed");
  assertEquals(evaluateWorkflowStatus({ workflow_type: "competitor_tracking", produced: 0, needs_user_input: true }).status, "blocked");
});

Deno.test("paid action needs confirmation → blocked", () => {
  assertEquals(evaluateWorkflowStatus({ workflow_type: "post_lead_action", needs_confirmation: true }).status, "blocked");
});

Deno.test("ranking: items ranked → complete; none → failed", () => {
  assertEquals(evaluateWorkflowStatus({ workflow_type: "lead_ranking", requested: 5, produced: 5 }).status, "complete");
  assertEquals(evaluateWorkflowStatus({ workflow_type: "lead_ranking", requested: 5, produced: 0 }).status, "failed");
});

Deno.test("summarizeAttempts renders the attempt log", () => {
  const log = summarizeAttempts([
    { n: 1, strategy: "Exact search — GTM hiring in B2B SaaS, USA", produced: 0 },
    { n: 2, strategy: "Broadened role aliases to sales/growth/SDR", produced: 3 },
    { n: 3, strategy: "Relaxed early-stage filter", produced: 5 },
  ]);
  assert(log.includes("Attempt 1:") && log.includes("0 found"));
  assert(log.includes("Attempt 3:") && log.includes("5 found"));
});

Deno.test("shouldRetry respects caps, target, and tool failure", () => {
  assert(shouldRetry({ attempt: 1, maxAttempts: 3, produced: 0, requested: 5 }));
  assert(shouldRetry({ attempt: 2, maxAttempts: 3, produced: 3, requested: 5 }));
  assert(!shouldRetry({ attempt: 3, maxAttempts: 3, produced: 3, requested: 5 }), "no attempts left");
  assert(!shouldRetry({ attempt: 1, maxAttempts: 3, produced: 5, requested: 5 }), "target met");
  assert(!shouldRetry({ attempt: 1, maxAttempts: 3, produced: 0, requested: 5, toolFailed: true }), "tool failed — don't hammer");
});
