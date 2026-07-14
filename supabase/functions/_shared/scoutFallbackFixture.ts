// Frozen fixture for the live Q1 Scout-fallback failure (plan c0f0d7eb, 2026-07-14).
//
// Source of truth: evals/find-leads/dual-apify/20260714T090339Z-q1-live/
//   - q1-failure-evidence.md
//   - scout-fallback-callgraph.md
//
// This data is a SANITIZED, deterministic copy of what the deployed run-agent
// produced live: Scout's `source_with_apify` step was never routed to the Apify
// path, so the generic LLM fabricated 10 founders with NO provider URLs and NO
// provenance, and they reached Aria. No provider/LLM is called here — the strings
// are frozen. Tests exercise the real production helpers against this data.

/** The exact request signals run-agent received for the failed Scout step. */
export const FROZEN_Q1_SIGNALS = {
  agent_slug: "scout",
  // orchestrate threads the step's tool as body.tool_needed (see index.ts:1211)…
  tool_needed: "source_with_apify",
  execution_mode: "source_and_qualify_only",
  // …but the AI-planned tool_input carries NO tool_name / selected_actor_key
  // (see index.ts:1214). This is the precise cause of shouldUseApify=false.
  tool_input: {
    execution_mode: "source_and_qualify_only",
    max_results: 5,
  } as Record<string, unknown>,
  instruction: "Using my ICP, find me 5 hot founders I should contact right now.",
} as const;

/** No Apify actor ran ⇒ zero accepted normalized provider items ⇒ empty index. */
export const FROZEN_ACCEPTED_PROVIDER_ITEMS: ReadonlyArray<Record<string, never>> = [];

/**
 * The generic-LLM Scout output that fabricated 10 founders (verbatim identities
 * from the live task 9ad3557f). No `url`/`profile_url`/`company_linkedin_url`/
 * `source_url` on ANY row — pure LLM invention.
 */
export const FROZEN_SCOUT_FABRICATED_OUTPUT = JSON.stringify({
  candidates: [
    { name: "Sarah Chen", title: "Co-Founder & CEO", company: "Vantage AI" },
    { name: "Marcus Thorne", title: "Founder", company: "RevOps Flow" },
    { name: "Elena Rodriguez", title: "Co-Founder & CTO", company: "Lumina Analytics" },
    { name: "David Park", title: "CEO & Co-Founder", company: "Syncroly" },
    { name: "Jessica Wu", title: "Co-Founder", company: "Cognitive Scale Up" },
    { name: "Julian Vane", title: "Founder & CEO", company: "Pipeline Hero" },
    { name: "Amara Okafor", title: "Co-Founder", company: "DeepLogic AI" },
    { name: "Thomas Miller", title: "CEO", company: "StackStream" },
    { name: "Chloe Dupont", title: "Co-Founder & Head of Product", company: "AutoPilot GTM" },
    { name: "Kevin Zhang", title: "Founder", company: "InsightBase" },
  ],
});

/** Count of fabricated identities in the frozen Scout output. */
export const FROZEN_FABRICATED_COUNT = 10;

/**
 * The observed live failure facts (from the frozen evidence). The hotfix must
 * flip `candidates_reaching_aria`, `aria_invoked` and `marked_complete`.
 */
export const FROZEN_LIVE_FAILURE_FACTS = {
  plan_id: "c0f0d7eb-12b6-40b7-90fd-b36b27168f52",
  scout_task_id: "9ad3557f-55ab-4221-94e5-1ac0c90d2923",
  aria_task_id: "6f57d9cd-1363-417e-abc4-53786485dd0b",
  provider_calls: 0,
  fabricated_scout_candidates: 10,
  candidates_reaching_aria: 10, // UNSAFE — the fix must make this 0
  aria_invoked: true, // UNSAFE — the fix must make this false
  marked_complete: true, // UNSAFE — the fix must finalize as no_results
  persisted_leads: 0,
  drafts: 0,
  approvals: 0,
} as const;
