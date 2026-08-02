import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDraftOutreachPlan } from "../../supabase/functions/_shared/draftOutreachPlan.ts";

Deno.test("memory-driven draft outreach → Penn-only plan, approval-gated", () => {
  const plan = buildDraftOutreachPlan({
    user_instruction: "Draft outreach to the top 5.",
    max_results: 5,
    lead_candidate_ids: ["a", "b", "c", "d", "e"],
  });
  assertEquals(plan.steps.length, 1, "exactly one step (no Scout/Aria, no duplicate Penn)");
  const s = plan.steps[0];
  assertEquals(s.agent_slug, "penn");
  assertEquals(s.tool_needed, "draft_outreach");
  assertEquals(s.requires_approval, true);
  assertEquals(plan.top_n, 5);
  assertEquals(plan.lead_candidate_ids, ["a", "b", "c", "d", "e"]);
  // No sourcing/ranking/enrichment agents present anywhere.
  assert(!plan.steps.some((x) => ["scout", "aria", "hawk", "scribe"].includes(x.agent_slug)));
});

Deno.test("draft outreach defaults to top 5 when N unspecified", () => {
  const plan = buildDraftOutreachPlan({ user_instruction: "Message the top leads." });
  assertEquals(plan.top_n, 5);
  assertEquals(plan.steps.length, 1);
  assertEquals(plan.steps[0].agent_slug, "penn");
});

Deno.test("N is capped to the number of remembered leads", () => {
  // User asked for top 5 but only 3 leads are remembered.
  const plan = buildDraftOutreachPlan({
    user_instruction: "Draft outreach to the top 5.",
    max_results: 5,
    lead_candidate_ids: ["x", "y", "z"],
  });
  assertEquals(plan.top_n, 3);
  assertEquals(plan.lead_candidate_ids.length, 3);
});
