// DETERMINISTIC REPAIR + THE PLAN-AWARE ACTION BUDGET.
//
// Two defects, each provable by reading the code replaced:
//
//   2. `validateLeadStrategy` returned `{ ok:false, problem:"query_packs_not_
//      separated" }` the moment two packs shared a title signature — discarding a
//      plan whose sources, titles and order were otherwise valid, and forcing an
//      escalation or the deterministic fallback over a duplicate.
//   4. `planAwareActionBudget` shipped tested with NO production caller. A
//      repo-wide grep for non-test callers returned nothing, so the blind
//      `maxRounds: 3 / maxJobsCalls: 3` still decided every run.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planAwareActionBudget, MAX_PLAN_AWARE_ACTIONS } from "../../../supabase/functions/_shared/leadStrategyFeedbackOwner.ts";
import { HARD_PROVIDER_CALL_CEILING } from "../../../supabase/functions/_shared/companyFirstQuotaController.ts";

// ============================ 2. DETERMINISTIC REPAIR =======================

Deno.test("2. an exact duplicate pack signature is REPAIRED, not fatal", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/leadStrategyValidator.ts", import.meta.url));
  // The fatal return for a duplicate signature is gone…
  assertFalse(
    /return \{ ok: false, problem: "query_packs_not_separated" \}/.test(src),
    "a duplicate signature must no longer discard the whole strategy",
  );
  // …replaced by a recorded repair.
  assert(src.includes("pack_duplicate_signature_repaired"));
});

Deno.test("2b. the repair keeps the NARROWER pack and records which was dropped", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/leadStrategyValidator.ts", import.meta.url));
  assert(src.includes("pack.queries.length < prior.queries.length"),
    "the narrower pack must win");
  assert(src.includes("dropped.push(`pack_duplicate_signature_repaired:"),
    "the repair must be persisted in `dropped`, not silent");
});

Deno.test("2c. an empty plan is still fatal — repair never invents a pack", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/leadStrategyValidator.ts", import.meta.url));
  assert(src.includes('return { ok: false, problem: "no_valid_query_packs" }'),
    "a strategy with nothing usable must still fail rather than be fabricated into validity");
});

// ==================== 4. THE BUDGET IS NO LONGER ORPHANED ===================

Deno.test("4. the controller now HAS a plan-aware budget seam", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/companyFirstQuotaController.ts", import.meta.url));
  assert(src.includes("actionBudget?:"), "the controller must accept a plan-aware budget");
  assert(src.includes("planAwareStop"), "the stop decision must be recorded");
  assert(src.includes("plan_aware_stop"), "the decision must reach the result");
});

Deno.test("4b. WITHOUT a budget the pre-existing fixed limits still decide", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/companyFirstQuotaController.ts", import.meta.url));
  assert(
    src.includes("} else if (jobsCalls >= bounds.maxJobsCalls) {"),
    "the fixed ceiling must remain the authority when no budget is supplied",
  );
  assert(src.includes("const loopBound = deps.actionBudget ? HARD_PROVIDER_CALL_CEILING : bounds.maxRounds;"),
    "the loop bound must only widen when a budget is in force");
});

Deno.test("4c. a hard safety ceiling binds regardless of what the plan claims", () => {
  assert(HARD_PROVIDER_CALL_CEILING > 3, "it must permit more than the old blind limit");
  assert(HARD_PROVIDER_CALL_CEILING <= MAX_PLAN_AWARE_ACTIONS,
    "and never exceed the strategist's own maximum");
});

// -------- the budget's own decisions, which the controller now honours ------

const base = {
  unusedExactPacks: 0, unusedAdjacentPacks: 0, unusedSources: 0,
  remainingQuota: 5, remainingBudgetUsd: 4, actionsSpent: 3,
};

Deno.test("4d. useful unused packs and sources allow work BEYOND three actions", () => {
  const b = planAwareActionBudget({ ...base, unusedExactPacks: 3, unusedSources: 2 });
  assertFalse(b.exhausted, "three spent actions must not end a run with real work left");
  assert(b.remaining > 0);
  assert(b.allowed > 3, `expected more than the old blind limit, got ${b.allowed}`);
});

Deno.test("4e. a CONTACT quota of zero stops immediately, whatever remains unused", () => {
  const b = planAwareActionBudget({
    ...base, remainingQuota: 0, unusedExactPacks: 5, unusedSources: 4,
  });
  assert(b.exhausted);
  assertEquals(b.remaining, 0);
  assertEquals(b.reason, "quota_reached");
});

Deno.test("4f. an exhausted budget stops immediately", () => {
  const b = planAwareActionBudget({ ...base, remainingBudgetUsd: 0, unusedExactPacks: 5 });
  assert(b.exhausted);
  assertEquals(b.reason, "budget_exhausted");
});

Deno.test("4g. repeated low-value actions stop safely rather than walking every source", () => {
  const noisy = planAwareActionBudget({
    ...base, unusedExactPacks: 4, unusedSources: 3,
    sourceQuality: { indeed_job_discovery: -0.9, glassdoor_job_discovery: -0.8 },
  });
  // Every observed source produced noise ⇒ at most one more action, not four.
  assert(noisy.allowed <= base.actionsSpent + 1,
    `noise must clamp the budget, got allowed=${noisy.allowed}`);
});

Deno.test("4h. the budget never exceeds its own maximum", () => {
  const huge = planAwareActionBudget({
    ...base, unusedExactPacks: 50, unusedAdjacentPacks: 50, unusedSources: 50,
  });
  assertEquals(huge.allowed, MAX_PLAN_AWARE_ACTIONS);
});

// ============ 5. NO SEPARATE CLAUDE/GEMINI FEEDBACK OWNER FOR THIS PATH =====

Deno.test("5. the GPT strategist owns this workflow's next action", async () => {
  const runAgent = await Deno.readTextFile(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  // The GPT plan is bound into the adaptive seam…
  assert(runAgent.includes("gptAdaptiveStrategyBinding(gptStrategy.resolution.plan"),
    "the validated GPT plan must reach the runtime binding");
  // …and the Claude bridge is explicitly skipped when GPT produced the strategy.
  assert(runAgent.includes("gptStrategy?.specRewritten\n          ? null"),
    "the Claude planner must not also run when GPT owns the strategy");
});

Deno.test("5b. the GPT plan's SOURCE ORDER survives into the adaptive plan", async () => {
  const binding = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/leadStrategyAdaptiveBinding.ts", import.meta.url));
  assert(binding.includes("plan.source_plan"), "the source order must come from the GPT plan");
  assert(binding.includes("capability_key: cap"), "each ordered step keeps its capability");
});
