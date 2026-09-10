// THE PLAN-AWARE BUDGET, WIRED AT THE REAL run-agent CALL SITE.
//
// PR #133 added the controller seam; nothing supplied it, so the blind
// `maxRounds: 3 / maxJobsCalls: 3` still ended every run. These tests assert the
// production wiring exists AND that the controller follows the decision.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planAwareActionBudget, MAX_PLAN_AWARE_ACTIONS } from "../../../supabase/functions/_shared/leadStrategyFeedbackOwner.ts";
import { HARD_PROVIDER_CALL_CEILING } from "../../../supabase/functions/_shared/companyFirstQuotaController.ts";

const runAgentSrc = () => Deno.readTextFile(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));

// ================= 8. THE REAL CALL SITE SUPPLIES THE INPUTS ===============

Deno.test("8. run-agent supplies actionBudget to the company-first controller", async () => {
  const src = await runAgentSrc();
  const call = src.slice(src.indexOf("executeRunAgentCompanyFirstSourcing({"));
  assert(call.includes("actionBudget: createPlanAwareActionBudget("),
    "the real call site must supply a budget through the binding");
  assert(call.includes("sequentialSources.planBudgetSnapshot"),
    "and feed it the live measured snapshot");
  // ONE budget authority. A second hand-rolled computation at the call site is
  // exactly how the inputs drift apart from the ones the binding measures.
  assertFalse(call.includes("actionBudget: () =>"),
    "the call site must not build its own budget alongside the binding");
});

Deno.test("8a. the budget is supplied only when the bridge is actually enabled", async () => {
  const src = await runAgentSrc();
  const call = src.slice(src.indexOf("executeRunAgentCompanyFirstSourcing({"));
  assert(call.includes("sequentialSources.enabled"),
    "a disabled bridge must leave the pre-existing fixed limits in force");
});

Deno.test("8b. every budget input is MEASURED, not assumed", async () => {
  const bind = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/planAwareBudgetBinding.ts", import.meta.url));
  // The binding is the single place that turns live state into budget inputs.
  assert(bind.includes("planAwareActionBudget("), "it must use the existing budget authority");
  assert(bind.includes("export function unusedPackCounts("), "unused packs are counted, not guessed");
  assert(bind.includes("export function sourceQualityScore("), "quality is scored from the round");

  const bridge = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/sequentialSourceBridge.ts", import.meta.url));
  const snap = bridge.slice(bridge.indexOf("const recordBudgetSnapshot"));
  assert(snap.includes("unusedPackCounts("), "the snapshot must reuse the canonical pack counter");
  assert(snap.includes("remainingQuota: round.remainingQuota"), "remaining quota must be live");
  assert(snap.includes("remainingBudgetUsd: round.remainingBudgetUsd"), "remaining budget must be live");
  assert(snap.includes("state.provider_calls"), "actions spent must be live");
});

Deno.test("8b1. there is exactly ONE unused-work counter in the runtime", async () => {
  // A second counter on the bridge would drift from the one the binding uses,
  // and the budget would then be computed from two different truths.
  const bridge = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/sequentialSourceBridge.ts", import.meta.url));
  assertFalse(bridge.includes("unusedWork:"), "the bridge must not hand-roll a rival counter");

  const src = await runAgentSrc();
  assertFalse(src.includes("unusedWork()"), "run-agent must not read a rival counter");
});

Deno.test("8b2. the executor forwards the budget verbatim — it does not decide one", async () => {
  const exec = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/executeRunAgentCompanyFirstSourcing.ts", import.meta.url));
  assert(exec.includes("actionBudget: deps.actionBudget"), "the wrapper must forward, not compute");
  assertFalse(exec.includes("planAwareActionBudget("), "the wrapper must not build its own budget");
});

// ============ 1–7. THE DECISIONS THE CONTROLLER NOW FOLLOWS ================

const base = {
  unusedExactPacks: 0, unusedAdjacentPacks: 0, unusedSources: 0,
  remainingQuota: 5, remainingBudgetUsd: 4, actionsSpent: 3,
};

Deno.test("1. three actions run but a valuable unused PACK remains → continue", () => {
  const b = planAwareActionBudget({ ...base, unusedExactPacks: 2 });
  assertFalse(b.exhausted);
  assert(b.remaining > 0);
  assert(b.allowed > 3, "the blind three-round limit must no longer decide this");
});

Deno.test("2. three actions run but a high-value unused SOURCE remains → continue", () => {
  const b = planAwareActionBudget({ ...base, unusedSources: 2 });
  assertFalse(b.exhausted);
  assert(b.allowed > 3);
});

Deno.test("3. repeated noisy sources with no improvement → stop", () => {
  const b = planAwareActionBudget({
    ...base, unusedExactPacks: 4, unusedSources: 3,
    sourceQuality: { indeed: -0.9, glassdoor: -0.8, linkedin: -0.7 },
  });
  assert(b.allowed <= base.actionsSpent + 1, "noise must clamp the budget to at most one more action");
});

Deno.test("4. CONTACT quota reached → stop immediately, whatever remains unused", () => {
  const b = planAwareActionBudget({ ...base, remainingQuota: 0, unusedExactPacks: 5, unusedSources: 5 });
  assert(b.exhausted);
  assertEquals(b.remaining, 0);
  assertEquals(b.reason, "quota_reached");
});

Deno.test("5. provider budget exhausted → stop", () => {
  const b = planAwareActionBudget({ ...base, remainingBudgetUsd: 0, unusedExactPacks: 5 });
  assert(b.exhausted);
  assertEquals(b.reason, "budget_exhausted");
});

Deno.test("6. no valid action remains → nothing left to allow", () => {
  const b = planAwareActionBudget({ ...base, actionsSpent: MAX_PLAN_AWARE_ACTIONS });
  assertEquals(b.remaining, 0);
});

Deno.test("7. the hard safety ceiling is always enforced", async () => {
  const huge = planAwareActionBudget({
    ...base, unusedExactPacks: 99, unusedAdjacentPacks: 99, unusedSources: 99,
  });
  assertEquals(huge.allowed, MAX_PLAN_AWARE_ACTIONS);
  assert(HARD_PROVIDER_CALL_CEILING <= MAX_PLAN_AWARE_ACTIONS);

  const ctrl = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/companyFirstQuotaController.ts", import.meta.url));
  assert(ctrl.includes("jobsCalls >= HARD_PROVIDER_CALL_CEILING"),
    "the ceiling must bind inside the loop regardless of the budget");
});

// ================ 9. THE STOP DECISION IS PERSISTED IN FULL ================

Deno.test("9. the stop decision records its exact inputs", async () => {
  const ctrl = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/companyFirstQuotaController.ts", import.meta.url));
  assert(ctrl.includes("planAwareStop"), "the decision must be captured");
  assert(ctrl.includes("plan_aware_stop: planAwareStop"), "and reach the result");
  assert(ctrl.includes("actions_spent: jobsCalls"), "with the actions actually spent");

  // The inputs the decision was made from are carried by the snapshot itself,
  // so the record stays complete without a second log line at the call site.
  const bind = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/planAwareBudgetBinding.ts", import.meta.url));
  for (const field of ["unusedExactPacks", "unusedAdjacentPacks", "unusedSources", "actionsSpent"]) {
    assert(bind.includes(field), `the budget input must carry ${field}`);
  }
  assert(bind.includes("PLAN_BUDGET_PENDING_REASON"),
    "a run with no completed round yet must say so rather than invent a budget");
});

Deno.test("9b. WITHOUT a budget the pre-existing fixed limits still decide", async () => {
  const ctrl = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/companyFirstQuotaController.ts", import.meta.url));
  assert(ctrl.includes("} else if (jobsCalls >= bounds.maxJobsCalls) {"),
    "the fixed ceiling must remain authoritative when no budget is supplied");
  assert(ctrl.includes("deps.actionBudget ? HARD_PROVIDER_CALL_CEILING : bounds.maxRounds"),
    "the loop must only widen when a budget is in force");
});
