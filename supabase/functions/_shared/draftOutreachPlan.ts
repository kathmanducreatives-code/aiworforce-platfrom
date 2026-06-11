// draftOutreachPlan: deterministic staged plan for memory-driven outreach
// follow-ups ("Draft outreach to the top 5", "message the top leads", "write
// DMs for these leads"). Pilot has already resolved the target leads from
// conversation memory, so orchestrate must NOT re-plan with the AI planner
// (which re-introduces a Scout/Apify sourcing step and a second Penn step).
//
// The plan is Penn-only, approval-gated, no Scout/Aria/Apify/research_web/
// Firecrawl, and no duplicate Penn steps.
//
// Pure / import-free so it is unit-testable in Deno without a running server
// (orchestrate/index.ts itself can't be imported in tests — it calls
// Deno.serve at module load).

export interface DraftOutreachStep {
  step_index: number;
  agent_slug: "penn";
  task_title: string;
  task_description: string;
  tool_needed: "draft_outreach";
  requires_approval: true;
  expected_output: string;
  success_criteria: string;
}

export interface DraftOutreachPlan {
  plan_summary: string;
  steps: DraftOutreachStep[];
  /** Top-N target leads carried through for draft↔lead linking. */
  lead_candidate_ids: string[];
  top_n: number;
}

export function buildDraftOutreachPlan(opts: {
  user_instruction: string;
  max_results?: number | null;
  lead_candidate_ids?: string[] | null;
}): DraftOutreachPlan {
  const ids = Array.isArray(opts.lead_candidate_ids)
    ? opts.lead_candidate_ids.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  // Default top 5; if explicit lead ids are present, cap N to that count so we
  // never ask Penn to draft for more leads than we actually remember.
  const requested = typeof opts.max_results === "number" && opts.max_results > 0
    ? Math.floor(opts.max_results)
    : 5;
  const n = Math.max(1, Math.min(50, ids.length > 0 ? Math.min(requested, ids.length) : requested));

  const step: DraftOutreachStep = {
    step_index: 0,
    agent_slug: "penn",
    task_title: `Draft outreach (top ${n})`,
    task_description: opts.user_instruction,
    tool_needed: "draft_outreach",
    requires_approval: true,
    expected_output: `Up to ${n} personalized drafts (one per remembered lead) ready for review.`,
    success_criteria:
      "Penn only; no new sourcing; no auto-send; one draft per provided lead, capped at N.",
  };

  return {
    plan_summary: `Draft outreach to top ${n} remembered leads`,
    steps: [step],
    lead_candidate_ids: ids.slice(0, n),
    top_n: n,
  };
}
