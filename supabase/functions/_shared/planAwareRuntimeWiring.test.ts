// THE PLAN-AWARE BUDGET, WIRED AT THE REAL run-agent CALL SITE.
//
// PR #133 added the controller seam; nothing supplied it, so the blind
// `maxRounds: 3 / maxJobsCalls: 3` still ended every run. These tests assert the
// production wiring exists AND that the controller follows the decision.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planAwareActionBudget, MAX_PLAN_AWARE_ACTIONS } from "./leadStrategyFeedbackOwner.ts";
import { HARD_PROVIDER_CALL_CEILING } from "./companyFirstQuotaController.ts";

const runAgentSrc = () => Deno.readTextFile(new URL("../run-agent/index.ts", import.meta.url));

// ================= 8. THE REAL CALL SITE SUPPLIES THE INPUTS ===============

Deno.test("8. run-agent supplies actionBudget to the company-first controller", async () => {
  const src = await runAgentSrc();
  const call = src.slice(src.indexOf("executeRunAgentCompanyFirstSourcing({"));
  assert(call.includes("actionBudget: () =>"), "the real call site must supply a budget");
  assert(call.includes("planAwareActionBudget({"), "it must use the existing budget authority");
});

Deno.test("8b. every budget input is read from REAL runtime state, not a constant", async () => {
  const src = await runAgentSrc();
  const block = src.slice(src.indexOf("actionBudget: () =>"), src.indexOf('log: (m, meta) => console.log("[run-agent][company-first]"'));
  // Packs and sources are counted by the bridge from the live ledger and plan.
  // run-agent asks rather than reading kernel state itself, because it is capped
  // at two kernel imports by intelligenceFlags test 32.E.
  assert(block.includes("sequentialSources.unusedWork()"),
    "unused packs and sources must come from live bridge state");
  // Quota and budget come from live counters.
  assert(block.includes("state.total_contact_ready"), "remaining quota must be live");
  assert(block.includes("state.cumulative_cost"), "remaining budget must be live");
  assert(block.includes("state.provider_calls"), "actions spent must be live");
  // Source quality is MEASURED from the last outcome, not assumed.
  assert(block.includes("sequentialSources.lastOutcome()"), "source quality must be measured");
  assert(block.includes("freshCount") && block.includes("rawCount"),
    "quality must derive from the observed duplicate/fresh rate");
});

Deno.test("8b1. the bridge counts unused work from the LIVE ledger and plan", async () => {
  const bridge = await Deno.readTextFile(new URL("./sequentialSourceBridge.ts", import.meta.url));
  const block = bridge.slice(bridge.indexOf("unusedWork: () => {"));
  assert(block.includes("adaptivePackState.completed_by_capability"), "consumed packs from the ledger");
  assert(block.includes("adaptivePackState.activated_pack_ids"), "activated packs from the ledger");
  assert(block.includes("state.completed_step_ids") && block.includes("state.exhausted_step_ids"),
    "unused sources from live execution state");
});

Deno.test("8b2. the executor forwards the budget verbatim — it does not decide one", async () => {
  const exec = await Deno.readTextFile(new URL("./executeRunAgentCompanyFirstSourcing.ts", import.meta.url));
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

  const ctrl = await Deno.readTextFile(new URL("./companyFirstQuotaController.ts", import.meta.url));
  assert(ctrl.includes("jobsCalls >= HARD_PROVIDER_CALL_CEILING"),
    "the ceiling must bind inside the loop regardless of the budget");
});

// ================ 9. THE STOP DECISION IS PERSISTED IN FULL ================

Deno.test("9. the stop decision records its exact inputs", async () => {
  const ctrl = await Deno.readTextFile(new URL("./companyFirstQuotaController.ts", import.meta.url));
  assert(ctrl.includes("planAwareStop"), "the decision must be captured");
  assert(ctrl.includes("plan_aware_stop: planAwareStop"), "and reach the result");
  assert(ctrl.includes("actions_spent: jobsCalls"), "with the actions actually spent");

  const src = await runAgentSrc();
  assert(src.includes('console.log("[run-agent][plan-aware-budget]"'), "and be observable");
  const block = src.slice(src.indexOf('"[run-agent][plan-aware-budget]"'));
  for (const field of ["unused_exact_packs", "unused_adjacent_packs", "unused_sources", "actions_spent"]) {
    assert(block.includes(field), `the diagnostic must carry ${field}`);
  }
});

Deno.test("9b. WITHOUT a budget the pre-existing fixed limits still decide", async () => {
  const ctrl = await Deno.readTextFile(new URL("./companyFirstQuotaController.ts", import.meta.url));
  assert(ctrl.includes("} else if (jobsCalls >= bounds.maxJobsCalls) {"),
    "the fixed ceiling must remain authoritative when no budget is supplied");
  assert(ctrl.includes("deps.actionBudget ? HARD_PROVIDER_CALL_CEILING : bounds.maxRounds"),
    "the loop must only widen when a budget is in force");
});
