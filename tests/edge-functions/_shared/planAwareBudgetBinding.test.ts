// THE PLAN-AWARE ACTION BUDGET NOW HAS A PRODUCTION CALLER.
//
// `planAwareActionBudget` shipped tested and correct; the quota controller grew
// an `actionBudget?:` seam for it; and run-agent supplied nothing, so every
// production run still stopped on the blind three-round limit. These tests hold
// the whole chain — binding, bridge accessor, executor forwarding, run-agent
// wiring — and the four ways a run must still stop.
//
// ZERO network, ZERO model calls, ZERO spend.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createPlanAwareActionBudget, planAwareBudgetInputFrom, sourceQualityScore,
  unusedPackCounts, isExactPack, PLAN_BUDGET_PENDING_REASON,
  type PlanBudgetSnapshot,
} from "../../../supabase/functions/_shared/planAwareBudgetBinding.ts";
import { MAX_PLAN_AWARE_ACTIONS } from "../../../supabase/functions/_shared/leadStrategyFeedbackOwner.ts";
import { HARD_PROVIDER_CALL_CEILING } from "../../../supabase/functions/_shared/companyFirstQuotaController.ts";
import type { QueryPack } from "../../../supabase/functions/_shared/intelligence/leads/leadQueryPacks.ts";

function pack(id: string, opts: Partial<QueryPack> = {}): QueryPack {
  return {
    pack_id: id, label: id, functional_family_ids: [], confidence_tier: "exact",
    titles: ["Head of Sales Operations"], aliases: [], negative_patterns: [],
    description_evidence: [], recommended_capabilities: [], priority: 1,
    broadening_level: 0, initially_eligible: true, maximum_attempts: 2,
    expected_precision: "high", expected_coverage: "medium",
    ...opts,
  } as QueryPack;
}

const snapshot = (over: Partial<PlanBudgetSnapshot> = {}): PlanBudgetSnapshot => ({
  unusedExactPacks: 0, unusedAdjacentPacks: 0, unusedSources: 0,
  remainingQuota: 5, remainingBudgetUsd: 4, actionsSpent: 3, sourceQuality: {},
  ...over,
});

// ------------------------------------------------------------ pack ledger --

Deno.test("unused packs are counted from the ledger, split exact vs adjacent", () => {
  const packs = [
    pack("exact_titles"),
    pack("family_synonyms"),
    pack("adjacent_owners", { broadening_level: 2, initially_eligible: false }),
  ];
  const u = unusedPackCounts(packs, {
    version: "v", completed_by_capability: { indeed_job_discovery: ["exact_titles"] },
    activated_pack_ids: [], executed_signatures: [], feedback_requests: 0,
  });
  assertEquals(u.unusedExactPacks, 1);
  assertEquals(u.unusedAdjacentPacks, 1);
  assert(isExactPack(packs[0]));
  assertFalse(isExactPack(packs[2]));
});

Deno.test("with no ledger every pack is still unspent", () => {
  const u = unusedPackCounts([pack("a"), pack("b")], null);
  assertEquals(u.unusedExactPacks, 2);
});

// -------------------------------------------------------- source quality ---

Deno.test("source quality reads the funnel the controller already measures", () => {
  assertEquals(sourceQualityScore({ rawRows: 40, newUniqueCompanies: 8, companiesQualified: 3, newEligibleLeads: 2 }), 1);
  assertEquals(sourceQualityScore({ rawRows: 40, newUniqueCompanies: 8, companiesQualified: 3, newEligibleLeads: 0 }), 0.25);
  // Rows and companies but nothing qualified — the definition of noise.
  assert(sourceQualityScore({ rawRows: 40, newUniqueCompanies: 8, companiesQualified: 0, newEligibleLeads: 0 }) <= -0.5);
  // Empty is not evidence about the next source, so it is not damning.
  assert(sourceQualityScore({ rawRows: 0, newUniqueCompanies: 0, companiesQualified: 0, newEligibleLeads: 0 }) > -0.5);
});

// ---------------------------------------------------- the budget function ---

Deno.test("before the first round the budget never stops anything", () => {
  const b = createPlanAwareActionBudget(() => null)();
  assertFalse(b.exhausted);
  assertEquals(b.reason, PLAN_BUDGET_PENDING_REASON);
});

Deno.test("useful unused packs and sources continue BEYOND three rounds", () => {
  const b = createPlanAwareActionBudget(() => snapshot({ unusedExactPacks: 3, unusedSources: 2 }))();
  assertFalse(b.exhausted, "three spent actions with real work left is not a finished run");
  assert(b.allowed > 3, `expected more than the old blind limit, got ${b.allowed}`);
});

Deno.test("quota reached stops immediately, whatever remains unused", () => {
  const b = createPlanAwareActionBudget(() =>
    snapshot({ remainingQuota: 0, unusedExactPacks: 5, unusedSources: 4 }))();
  assert(b.exhausted);
  assertEquals(b.reason, "quota_reached");
});

Deno.test("budget exhausted stops immediately", () => {
  const b = createPlanAwareActionBudget(() =>
    snapshot({ remainingBudgetUsd: 0, unusedExactPacks: 5 }))();
  assert(b.exhausted);
  assertEquals(b.reason, "budget_exhausted");
});

Deno.test("repeated low-quality sources clamp the run rather than walk every source", () => {
  const b = createPlanAwareActionBudget(() => snapshot({
    unusedExactPacks: 4, unusedSources: 3,
    sourceQuality: { indeed_job_discovery: -0.9, glassdoor_job_discovery: -0.6 },
  }))();
  assert(b.allowed <= 4, `noise must clamp the budget, got allowed=${b.allowed}`);
});

Deno.test("the hard safety ceiling bounds every possible budget", () => {
  const b = createPlanAwareActionBudget(() => snapshot({
    unusedExactPacks: 50, unusedAdjacentPacks: 50, unusedSources: 50,
  }))();
  assertEquals(b.allowed, MAX_PLAN_AWARE_ACTIONS);
  assert(HARD_PROVIDER_CALL_CEILING <= MAX_PLAN_AWARE_ACTIONS);
});

Deno.test("negative inputs cannot widen the budget", () => {
  const input = planAwareBudgetInputFrom(snapshot({ unusedExactPacks: -5, actionsSpent: -2 }));
  assertEquals(input.unusedExactPacks, 0);
  assertEquals(input.actionsSpent, 0);
});

// ------------------------------------------------------- the wiring itself --

Deno.test("the bridge exposes a budget snapshot, null while disabled", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/sequentialSourceBridge.ts", import.meta.url));
  assert(src.includes("planBudgetSnapshot: () => PlanBudgetSnapshot | null;"),
    "the bridge result must carry the snapshot accessor");
  assert(src.includes("planBudgetSnapshot: () => null,"),
    "a disabled bridge must keep the pre-existing fixed limits in force");
  assert(src.includes("onObservation: onObservationWithBudget"),
    "the snapshot must be recorded from the observed round");
});

Deno.test("the executor forwards the budget to the quota controller", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/executeRunAgentCompanyFirstSourcing.ts", import.meta.url));
  assert(src.includes('actionBudget?: QuotaControllerDeps["actionBudget"];'));
  assert(src.includes("actionBudget: deps.actionBudget,"));
});

Deno.test("run-agent SUPPLIES the budget — the caller that was missing", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(src.includes("createPlanAwareActionBudget(sequentialSources.planBudgetSnapshot)"),
    "the company-first workflow must supply the plan-aware budget");
  assert(src.includes("sequentialSources.enabled"),
    "and only when the sequential bridge is actually running");
});
