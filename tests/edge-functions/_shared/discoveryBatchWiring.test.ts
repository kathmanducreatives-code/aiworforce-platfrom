// THE BATCH AUTHORITY IS NOW CALLED, AND CARRIED BY THE RIGHT FIELD.
//
// `decideDiscoveryBatchSize` shipped in PR #121 with tests and no caller: a grep
// across supabase/functions matched only its own test file. The number that
// actually reached providers came from `validateOrderedPlan`, which defaults
// `candidateTarget` to a literal 25 and clamps only against the capability
// ceiling — remaining quota never entered the calculation.
//
// Production evidence: task 2425ec4f asked Indeed for `maxItems: 27` while owing
// 5 leads, and would have asked for the same with 1 left to find.
//
// OFFLINE ONLY. No provider, no model, no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { prepareStepCall, PROVIDER_LIMIT_FIELD, PROVIDER_LIMIT_SCOPE } from "../../supabase/functions/_shared/sequentialSourceRuntime.ts";
import { newSourceExecutionState, type SourceExecutionState } from "../../supabase/functions/_shared/sourceExecutionState.ts";
import { HIRING_SOURCE_CATALOG } from "../../supabase/functions/_shared/hiringSourceCatalog.ts";
import type { OrderedSourceStep } from "../../supabase/functions/_shared/hiringSourcePlan.ts";

const TASK = "2425ec4f-7d8c-4a05-8c93-597b051db10b";

/** The dynamic Actors are env-gated; the compiler refuses a disabled provider. */
for (const k of [
  "APIFY_ENABLE_INDEED_JOBS_AUTOMATION_LAB", "APIFY_ENABLE_LINKEDIN_JOBS_CRAWLWORKS",
  "APIFY_ENABLE_GLASSDOOR_JOBS", "APIFY_ENABLE_YC_JOBS", "APIFY_ENABLE_ATS_VERIFICATION",
]) Deno.env.set(k, "1");

function step(capability: string, stepId = `s1-${capability}`): OrderedSourceStep {
  return {
    stepId, order: 1, capability, role: capability === "ats_job_verification" ? "verification" : "primary_discovery",
    reason: "fixture", activationCondition: "initial",
    semanticIntent: {
      roleFamily: "sales_operations",
      approvedTitleAliases: ["Sales Operations", "Revenue Operations", "GTM Operations"],
      geography: "United States",
      postingWindowDays: 30,
      candidateTarget: 25,          // the plan's hardcoded default
      companies: capability === "ats_job_verification" ? [{ ats: "greenhouse", slug: "acme" }] : undefined,
    },
    successCondition: { contactReadyTarget: 5 },
    broadeningLadder: [], advanceConditions: [], stopConditions: [],
  } as unknown as OrderedSourceStep;
}

function state(over: Partial<SourceExecutionState> = {}): SourceExecutionState {
  const s = newSourceExecutionState({
    planHash: "6ec31619", requestedCount: 5, now: new Date().toISOString(),
    steps: [
      { stepId: "s1-indeed_job_discovery", capability: "indeed_job_discovery", order: 1, actorKey: "apify_indeed_jobs_automation_lab" },
      { stepId: "s1-linkedin_job_discovery", capability: "linkedin_job_discovery", order: 2, actorKey: "apify_linkedin_jobs_crawlworks" },
      { stepId: "s1-glassdoor_job_discovery", capability: "glassdoor_job_discovery", order: 3, actorKey: "apify_glassdoor_jobs" },
      { stepId: "s1-yc_job_discovery", capability: "yc_job_discovery", order: 4, actorKey: "apify_yc_jobs" },
      { stepId: "s1-ats_job_verification", capability: "ats_job_verification", order: 5, actorKey: "apify_ats_verification" },
    ],
  });
  return { ...s, ...over };
}

const ctx = (over: Record<string, unknown> = {}) => ({
  providerMaximum: 200, costPerCallUsd: 0.25, budgetCapUsd: 5, observedRowsPerLead: null, ...over,
});

// ================================== 1. the helper is actually called ========

Deno.test("1./7. the batch is derived from remaining quota, not the plan's 25", async () => {
  const full = await prepareStepCall({
    taskId: TASK, step: step("indeed_job_discovery"),
    state: state({ remaining_quota: 5, total_contact_ready: 0 }),
    batchContext: ctx(),
  });
  assert(full.ok);
  const five = full.call.batchDecision as Record<string, unknown>;
  assert(five, "a discovery step must record a batch decision");
  assertEquals(five.requested_leads, 5);
  assertEquals(five.remaining_leads, 5);

  // Owing ONE lead must not request as much as owing five.
  const nearlyDone = await prepareStepCall({
    taskId: TASK, step: step("indeed_job_discovery"),
    state: state({ remaining_quota: 1, total_contact_ready: 4 }),
    batchContext: ctx(),
  });
  assert(nearlyDone.ok);
  const one = nearlyDone.call.batchDecision as Record<string, unknown>;
  assert(
    (one.discovery_count as number) < (five.discovery_count as number),
    `batch did not shrink: ${one.discovery_count} vs ${five.discovery_count}`,
  );
});

// ============================ 2.-6. the right provider field ===============

Deno.test("2.-5. the batch lands on each provider's own limit field", async () => {
  for (const [capability, field] of [
    ["indeed_job_discovery", "maxItems"],
    ["linkedin_job_discovery", "jobsToFetch"],
    ["glassdoor_job_discovery", "limit"],
    ["yc_job_discovery", "maxResults"],
  ] as [string, string][]) {
    const r = await prepareStepCall({
      taskId: TASK, step: step(capability, `s1-${capability}`),
      state: state({ remaining_quota: 5 }),
      batchContext: ctx({ providerMaximum: HIRING_SOURCE_CATALOG[capability as never]?.operatingPolicy.maximumResultsPerCall ?? 200 }),
    });
    assert(r.ok, `${capability} did not compile`);
    const decision = r.call.batchDecision as Record<string, unknown>;
    assertEquals(decision.provider_limit_field, field, capability);
    // And the compiled payload actually carries that field with that value.
    assertEquals(r.call.input[field], decision.discovery_count, `${capability} ${field} mismatch`);
    assertEquals(PROVIDER_LIMIT_FIELD[capability], field);
  }
});

Deno.test("6. ATS is never given a discovery batch", async () => {
  const r = await prepareStepCall({
    taskId: TASK, step: step("ats_job_verification"),
    state: state({ remaining_quota: 5 }),
    batchContext: ctx(),
  });
  // TRUTHFUL CURRENT BEHAVIOUR, and a finding in its own right: `OrderedSourceStep`
  // carries no `companies` field, so the ATS branch of the compiler can never see a
  // slug and always defers. The capability is presently unreachable — recorded here
  // rather than papered over, because fixing it means deciding where company
  // identities enter the call, not forwarding one more field.
  assertFalse(r.ok);
  if (!r.ok) {
    assertEquals(r.status, "deferred");
    assertEquals(r.reason, "ats_verification_requires_resolved_company_slug");
    // Crucially it is NOT rejected for a zero batch — quota never drove it.
    assertFalse(r.reason.startsWith("discovery_batch_zero"));
  }
  // And ATS is excluded from the discovery set, so no batch would ever apply.
  assertFalse(PROVIDER_LIMIT_SCOPE.ats_job_verification === undefined);
  assertEquals(PROVIDER_LIMIT_FIELD.ats_job_verification, "maxJobsPerCompany");
});

// ============================== 8./9./12. the bounds hold ==================

Deno.test("8. the capability ceiling caps the batch", async () => {
  const r = await prepareStepCall({
    taskId: TASK, step: step("indeed_job_discovery"),
    state: state({ remaining_quota: 5 }),
    batchContext: ctx({ providerMaximum: 12 }),
  });
  assert(r.ok);
  const d = r.call.batchDecision as Record<string, unknown>;
  assertEquals(d.provider_limit, 12);
  assert((d.discovery_count as number) <= 12);
  assertEquals(d.clamping_reason, "capped_by_source_limit");
  assertEquals(r.call.input.maxItems, d.discovery_count);
});

Deno.test("9. an unaffordable round is refused before compilation", async () => {
  const r = await prepareStepCall({
    taskId: TASK, step: step("indeed_job_discovery"),
    state: state({ remaining_quota: 5, cumulative_cost: 4.95 }),
    batchContext: ctx({ budgetCapUsd: 5, costPerCallUsd: 0.25 }),
  });
  assertFalse(r.ok);
  if (!r.ok) {
    assertEquals(r.status, "rejected");
    assert(r.reason.startsWith("discovery_batch_zero:capped_by_budget"), r.reason);
  }
});

Deno.test("12. a met quota produces no call at all", async () => {
  const r = await prepareStepCall({
    taskId: TASK, step: step("indeed_job_discovery"),
    state: state({ remaining_quota: 0, total_contact_ready: 5 }),
    batchContext: ctx(),
  });
  assertFalse(r.ok, "a satisfied quota must not compile a discovery call");
  if (!r.ok) assert(r.reason.startsWith("discovery_batch_zero:quota_met"), r.reason);
});

// ---------------------------- backward compatibility -----------------------

Deno.test("without batchContext the planned target is used unchanged", async () => {
  // Every pre-existing caller omits it, and must behave exactly as before.
  const r = await prepareStepCall({
    taskId: TASK, step: step("indeed_job_discovery"), state: state({ remaining_quota: 5 }),
  });
  assert(r.ok);
  assertEquals(r.call.batchDecision ?? null, null);
  assertEquals(r.call.input.maxItems, 25, "the plan's own candidateTarget must survive");
});

Deno.test("11. per-query and per-run limit scopes are recorded, not assumed", () => {
  // Crawlworks applies its limit PER SEARCH URL; the others bound the run. Reading
  // jobsToFetch as a run cap is how three packs silently become 3x the rows.
  assertEquals(PROVIDER_LIMIT_SCOPE.linkedin_job_discovery, "per_query");
  assertEquals(PROVIDER_LIMIT_SCOPE.indeed_job_discovery, "per_run");
  assertEquals(PROVIDER_LIMIT_SCOPE.glassdoor_job_discovery, "per_run");
  assertEquals(PROVIDER_LIMIT_SCOPE.yc_job_discovery, "per_run");
});
