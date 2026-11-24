// Company Brain → ATLAS planning (brainContext.ts). Synthetic Brain only.
//
// The Brain is CONTEXT: the user's words outrank it, it fills open fields as
// targets (never a new hard filter, except the workspace's explicit size policy,
// as for every other mission), an unusable Brain is no context, and one
// workspace's Brain is never read for another.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brainPlanningContext, compileWithBrain, loadBrainPlanningContext } from "../../../../supabase/functions/_shared/leadPipeline/brainContext.ts";
import { specFromMission } from "../../../../supabase/functions/_shared/leadPipeline/strategy.ts";

const QUERY = "Find 5 US B2B companies actively hiring salespeople. Prefer 20–500 employees, but include strong opportunities outside that range and explain why.";
const proposal = (over: Record<string, unknown> = {}) => ({
  requested_opportunity_count: 5, requested_contact_ready_count: null, company_types: [], geographies: ["United States"], employee_range: { min: null, max: null },
  decision_maker_roles: [], hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "US" }],
  soft_preferences: [{ field: "employee_range", value: { min: 20, max: 500 }, reason: "preferred" }], preferred_signals: ["hiring"], adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } }, disallowed_broadening: [], required_evidence: [],
  required_capabilities: [], preferred_source_strategy: ["job_signal_first"], evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.85, unknowns: [],
  known_companies: [], signal_recency_days: 30, required_signal_terms: ["salespeople"], no_broadening_requested: false, geography_is_hard: true, prohibitions: [],
  output_intent: "companies", strategies: ["hiring"], ...over,
});
// A synthetic TEST Brain: an AI-automation agency selling to US B2B teams, with a size label (an enforced policy).
const BRAIN = {
  company: { name: "Synthetic Automation Co", description: "AI automation for B2B revenue teams." },
  icp: { industries: ["Software Development", "IT Services and IT Consulting"], geography: ["United States"], company_size: "11-200 employees" },
};
const usable = { profile: BRAIN, onboarding_completed: true };
const hardIds = (m: unknown) => ((m as { criteria: { kind: string; id: string }[] }).criteria).filter((c) => c.kind === "hard").map((c) => c.id).sort();

Deno.test("brain: missing, not onboarded or empty Brains are no context — planning is unchanged", () => {
  assertEquals(brainPlanningContext(null).status, "absent");
  assertEquals(brainPlanningContext({ profile: BRAIN, onboarding_completed: false }).status, "not_onboarded");
  assertEquals(brainPlanningContext({ profile: { icp: {} }, onboarding_completed: true }).status, "empty");
  const none = compileWithBrain({ query: QUERY, proposal: proposal(), requestedCount: 5, brain: brainPlanningContext(null) });
  assertEquals(none.brainApplied, []);
  const used = brainPlanningContext(usable);
  assertEquals([used.status, used.fields], ["used", ["industries", "locations", "size_policy"]]);
});

Deno.test("brain: the user's words win — the hedged 20–500 stays a preference and the Brain adds no hard filter", () => {
  const without = compileWithBrain({ query: QUERY, proposal: proposal(), requestedCount: 5, brain: brainPlanningContext(null) });
  const withBrain = compileWithBrain({ query: QUERY, proposal: proposal(), requestedCount: 5, brain: brainPlanningContext(usable) });
  assertEquals(hardIds(withBrain.mission), hardIds(without.mission), "same hard requirements with or without the Brain");
  const spec = specFromMission(withBrain.mission as never, { defaultCount: 5 });
  assertEquals(spec.employees, null, "the Brain's 11–200 policy does not override the user's stated (soft) size");
  assertEquals(spec.preferredEmployees, { min: 20, max: 500 });
  assertEquals(spec.industry, [], "the Brain's industries never become a hard industry");
  assert((withBrain.brainRejected as { reason: string }[]).some((x) => x.reason.includes("outranks the Company Brain's size rule")), "the override is reported, not silent");
});

Deno.test("brain: where the user left a field open, the Brain fills it — industries only as a target", () => {
  const q = "Find 5 US companies actively hiring Account Executives.";
  const r = compileWithBrain({ query: q, proposal: proposal({ soft_preferences: [], required_signal_terms: ["Account Executive"] }), requestedCount: 5, brain: brainPlanningContext(usable) });
  const crit = (r.mission as { criteria: { kind: string; dimension: string }[] }).criteria;
  assert(!crit.some((c) => c.kind === "hard" && c.dimension === "industry"), "a Brain industry is never a hard filter");
  // The Brain's explicit size policy applies when the user stated no size — as for every mission in the workspace.
  assert(crit.some((c) => c.dimension === "company_size"), JSON.stringify(crit.map((c) => [c.kind, c.dimension])));
});

Deno.test("brain: one workspace's Brain is read only for that workspace; a read failure is no context", async () => {
  const seen: string[] = [];
  const admin = (rows: Record<string, unknown>, fail = false) => ({
    from: (t: string) => ({ select: (_c: string) => ({ eq: (col: string, v: string) => ({ maybeSingle: () => {
      seen.push(`${t}.${col}=${v}`);
      return Promise.resolve(fail ? { data: null, error: { message: "boom" } } : { data: rows[v] ?? null, error: null });
    } }) }) }),
  });
  const A = "aaaaaaaa-0000-4000-8000-000000000001", B = "bbbbbbbb-0000-4000-8000-000000000002";
  const ctxA = await loadBrainPlanningContext(admin({ [A]: usable }), A);
  const ctxB = await loadBrainPlanningContext(admin({ [A]: usable }), B);
  assertEquals([ctxA.status, ctxB.status], ["used", "absent"], "B never sees A's Brain");
  assertEquals(seen, [`company_brain.workspace_id=${A}`, `company_brain.workspace_id=${B}`]);
  assertEquals((await loadBrainPlanningContext(admin({}, true), A)).status, "unreadable");
});
