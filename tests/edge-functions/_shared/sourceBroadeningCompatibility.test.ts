// BROADENING COMPATIBILITY — can each approved source actually express each rung?
//
// PURE COMPILATION ONLY. No Apify Actor is executed, no Firecrawl call is made, no
// model is called, no database is touched. Every assertion is about the shape of a
// compiled Actor input, computed offline.
//
// The rule under test, in one line: a broadening rung is offered only when applying
// it CHANGES the compiled provider call. Anything else is a second paid request for
// the same rows, wearing the label of a strategy change.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyBroadeningToIntent, assessBroadeningCompatibility, compileHiringSourceInput,
  type BroadeningIntentChange, type HiringSourceIntent,
} from "../../../supabase/functions/_shared/actorInputPlanner.ts";
import {
  baseIntentForStep, decideNextAction, deterministicOrderedPlan, eligibleBroadening,
  validateOrderedPlan,
  type LeadMissionSourceProfile, type OrderedHiringSourcePlan, type SafeBroadeningAction,
  type SourceStepObservation,
} from "../../../supabase/functions/_shared/hiringSourcePlan.ts";
import { newSourceExecutionState, type SourceExecutionState } from "../../../supabase/functions/_shared/sourceExecutionState.ts";
import { actorKeyForCapability, prepareStepCall, runtimeStateFor } from "../../../supabase/functions/_shared/sequentialSourceRuntime.ts";
import { projectAvailableActions } from "../../../supabase/functions/_shared/sourceFeedbackContract.ts";
import { HIRING_SOURCE_CATALOG, type HiringSourceCapabilityId } from "../../../supabase/functions/_shared/hiringSourceCatalog.ts";

function enableProviders() {
  for (const k of [
    "APIFY_ENABLE_INDEED_JOBS_AUTOMATION_LAB", "APIFY_ENABLE_LINKEDIN_JOBS_CRAWLWORKS",
    "APIFY_ENABLE_GLASSDOOR_JOBS", "APIFY_ENABLE_YC_JOBS", "APIFY_ENABLE_ATS_VERIFICATION",
  ]) Deno.env.set(k, "1");
}

const profile = (o: Partial<LeadMissionSourceProfile> = {}): LeadMissionSourceProfile => ({
  industries: ["b2b saas"], stages: ["seed"], triggerRequirements: ["active_hiring"],
  hiring: {
    required: true, roleFamily: "revenue_operations",
    approvedAliases: ["Revenue Operations", "GTM Operations", "Sales Operations"],
    geography: "United States", maximumPostingAgeDays: 14,
  },
  decisionMakerRoles: ["Founder", "Co-Founder", "CEO"],
  currentEmployerRequired: true,
  requestedCount: 5, countEntity: "contact_ready_lead", quotaPolicy: "contact_only",
  requiredEvidence: ["active_hiring", "company_identity", "employer_verified"],
  ...o,
});

/** A compilable baseline intent for one capability. */
const intentFor = (
  capability: HiringSourceCapabilityId,
  o: Partial<HiringSourceIntent> = {},
): HiringSourceIntent => ({
  capability,
  titleAliases: ["Revenue Operations"],
  roleFamily: "sales",
  geography: "United States",
  postingWindowDays: 14,
  remotePolicy: null,
  candidateTarget: 20,
  ...(capability === "ats_job_verification" ? { companies: [{ ats: "greenhouse", slug: "acme" }] } : {}),
  ...o,
});

async function supported(capability: HiringSourceCapabilityId, rung: BroadeningIntentChange, o: Partial<HiringSourceIntent> = {}) {
  enableProviders();
  return await assessBroadeningCompatibility(intentFor(capability, o), rung);
}

async function compiledInput(intent: HiringSourceIntent): Promise<Record<string, unknown>> {
  const c = await compileHiringSourceInput(intent);
  assert(c.ok, `expected a compilable intent for ${intent.capability}`);
  return c.input;
}

const ALL_CAPABILITIES: HiringSourceCapabilityId[] = [
  "yc_job_discovery", "indeed_job_discovery", "linkedin_job_discovery",
  "glassdoor_job_discovery", "ats_job_verification",
];

// ==================================================================== YC =====

Deno.test("1. YC never offers recency broadening", async () => {
  const r = await supported("yc_job_discovery", { action: "extend_recency_window", postingWindowDays: 90 });
  assertFalse(r.supported);
  assertEquals(r.reason, "unsupported_by_source_schema");

  // The audited reason: the verified YC input has no posting-window field at all.
  const input = await compiledInput(intentFor("yc_job_discovery"));
  assertEquals(Object.keys(input).sort(), ["locationFilter", "maxResults", "roleFilter", "searchQuery"]);

  // And it is absent from a real plan's ladder, not merely rejected later.
  enableProviders();
  const plan = await deterministicOrderedPlan(profile());
  const yc = plan.steps.find((s) => s.capability === "yc_job_discovery");
  assert(yc, "the early-stage plan should reach YC");
  assertFalse(yc.broadeningLadder.some((b) => b.action === "extend_recency_window"));
});

Deno.test("1.B YC cannot express stage, company size or batch either", async () => {
  const input = await compiledInput(intentFor("yc_job_discovery"));
  for (const absent of ["stage", "batch", "teamSize", "companySize", "employees", "datePosted", "daysOld"]) {
    assertFalse(absent in input, `YC unexpectedly exposes ${absent}`);
  }
  // Those stay Company Brain constraints, applied downstream — never broadening.
  const r = await supported("yc_job_discovery", { action: "include_supported_remote_variants", remotePolicy: "remote" });
  assertFalse(r.supported, "YC has no remote field, so a remote rung changes nothing");
});

Deno.test("2. YC CAN broaden supported query aliases", async () => {
  const r = await supported("yc_job_discovery", {
    action: "add_approved_role_aliases", aliases: ["GTM Operations"],
  });
  assert(r.supported, r.reason ?? "");

  const before = await compiledInput(intentFor("yc_job_discovery"));
  const after = await compiledInput(applyBroadeningToIntent(intentFor("yc_job_discovery"), {
    action: "add_approved_role_aliases", aliases: ["GTM Operations"],
  }));
  assert(String(after.searchQuery).includes("GTM Operations"));
  assert(before.searchQuery !== after.searchQuery);
});

Deno.test("3. YC CAN increase a bounded maxResults", async () => {
  const r = await supported("yc_job_discovery", { action: "increase_result_target", candidateTarget: 40 });
  assert(r.supported, r.reason ?? "");

  const after = await compiledInput(applyBroadeningToIntent(intentFor("yc_job_discovery"), {
    action: "increase_result_target", candidateTarget: 40,
  }));
  assertEquals(after.maxResults, 40);

  // Bounded by the capability's own verified ceiling: a rung that only exceeds the
  // cap compiles to the cap, changes nothing, and is refused.
  const cap = HIRING_SOURCE_CATALOG["yc_job_discovery"].operatingPolicy.maximumResultsPerCall;
  const atCap = await supported("yc_job_discovery",
    { action: "increase_result_target", candidateTarget: cap * 10 },
    { candidateTarget: cap });
  assertFalse(atCap.supported, "raising a target already at the ceiling is not broadening");
});

// ================================================================ Indeed =====

Deno.test("4. Indeed recency broadening changes only across the 1/3/7/14 buckets", async () => {
  const crossing: Array<[number, number, string]> = [[1, 3, "3"], [3, 7, "7"], [7, 14, "14"]];
  for (const [from, to, bucket] of crossing) {
    const r = await supported("indeed_job_discovery",
      { action: "extend_recency_window", postingWindowDays: to }, { postingWindowDays: from });
    assert(r.supported, `${from}d -> ${to}d should cross a bucket (${r.reason})`);

    const after = await compiledInput(applyBroadeningToIntent(
      intentFor("indeed_job_discovery", { postingWindowDays: from }),
      { action: "extend_recency_window", postingWindowDays: to },
    ));
    assertEquals(after.datePosted, bucket);
  }
});

Deno.test("5. Indeed does NOT offer a recency rung that stays in the same bucket", async () => {
  // 14 -> 28 both clamp to the 14-day bucket: a repaired no-op.
  const r = await supported("indeed_job_discovery",
    { action: "extend_recency_window", postingWindowDays: 28 }, { postingWindowDays: 14 });
  assertFalse(r.supported);
  assertEquals(r.reason, "unsupported_by_source_schema");

  // Within-bucket moves are refused too (4 and 7 both compile to "7").
  const within = await supported("indeed_job_discovery",
    { action: "extend_recency_window", postingWindowDays: 7 }, { postingWindowDays: 4 });
  assertFalse(within.supported);

  // The deterministic plan doubles a 14-day window to 28, so the rung is gone.
  enableProviders();
  const plan = await deterministicOrderedPlan(profile());
  const indeed = plan.steps.find((s) => s.capability === "indeed_job_discovery");
  assert(indeed);
  assertFalse(indeed.broadeningLadder.some((b) => b.action === "extend_recency_window"));
});

Deno.test("4.B Indeed query and result target remain broadenable", async () => {
  assert((await supported("indeed_job_discovery", { action: "add_approved_role_aliases", aliases: ["GTM Operations"] })).supported);
  assert((await supported("indeed_job_discovery", { action: "increase_result_target", candidateTarget: 60 })).supported);
  // Indeed has no remote field in the verified input.
  assertFalse((await supported("indeed_job_discovery", { action: "include_supported_remote_variants", remotePolicy: "remote" })).supported);
});

// ============================================================== LinkedIn =====

Deno.test("6. LinkedIn broadening must change a supported field", async () => {
  const input = await compiledInput(intentFor("linkedin_job_discovery"));
  for (const field of ["query", "location", "timePostedRange", "jobsToFetch", "onSite", "remote", "hybrid"]) {
    assert(field in input, `LinkedIn should expose ${field}`);
  }

  // Remote variants ARE expressible here, unlike every other source.
  const remote = await supported("linkedin_job_discovery", { action: "include_supported_remote_variants", remotePolicy: "remote" });
  assert(remote.supported, remote.reason ?? "");
  const after = await compiledInput(applyBroadeningToIntent(intentFor("linkedin_job_discovery"), {
    action: "include_supported_remote_variants", remotePolicy: "remote",
  }));
  assertEquals(after.remote, true);
  assertEquals(after.onSite, false);

  // Recency crosses only the 1/3/7/30 ranges the Actor accepts.
  assert((await supported("linkedin_job_discovery",
    { action: "extend_recency_window", postingWindowDays: 30 }, { postingWindowDays: 7 })).supported);
  assertFalse((await supported("linkedin_job_discovery",
    { action: "extend_recency_window", postingWindowDays: 28 }, { postingWindowDays: 14 })).supported);
});

// ============================================================= Glassdoor =====

Deno.test("7. Glassdoor broadening preserves required keywords and location", async () => {
  const base = intentFor("glassdoor_job_discovery");
  const before = await compiledInput(base);

  for (const rung of [
    { action: "add_approved_role_aliases", aliases: ["GTM Operations"] },
    { action: "increase_result_target", candidateTarget: 40 },
    { action: "extend_recency_window", postingWindowDays: 60 },
  ] as BroadeningIntentChange[]) {
    const after = await compiledInput(applyBroadeningToIntent(base, rung));
    assert(String(after.keywords ?? "").length > 0, `${rung.action} emptied the required keywords`);
    assertEquals(after.location, before.location, `${rung.action} moved the required location`);
  }

  // `daysOld` is a free 1-365 integer, so recency IS real broadening here.
  assert((await supported("glassdoor_job_discovery", { action: "extend_recency_window", postingWindowDays: 60 })).supported);

  // Employer size and radius have no representation, so neither can be broadened —
  // which is the outcome that keeps Company Brain's size constraint untouchable.
  for (const absent of ["employerSize", "companySize", "employees", "radius", "minRating"]) {
    assertFalse(absent in before, `Glassdoor unexpectedly exposes ${absent}`);
  }
});

// =================================================================== ATS =====

Deno.test("8. ATS broadening requires resolved company slugs", async () => {
  enableProviders();
  const withoutSlug = await assessBroadeningCompatibility(
    { ...intentFor("ats_job_verification"), companies: [] },
    { action: "add_approved_role_aliases", aliases: ["GTM Operations"] },
  );
  assertFalse(withoutSlug.supported);
  assertEquals(withoutSlug.reason, "uncompilable_before", "no slug means nothing to verify, let alone broaden");

  // Even WITH a slug, appending an alias leaves `titleKeyword` (the first title)
  // untouched, so it is not broadening either.
  const withSlug = await supported("ats_job_verification", { action: "add_approved_role_aliases", aliases: ["GTM Operations"] });
  assertFalse(withSlug.supported);
});

Deno.test("9. ATS is never offered as broad discovery", async () => {
  enableProviders();
  const plan = await deterministicOrderedPlan(profile());
  const ats = plan.steps.find((s) => s.capability === "ats_job_verification");
  assert(ats);
  assertEquals(ats.role, "verification");
  assertEquals(ats.broadeningLadder, [], "a verification step has no ladder at all");
  assert(ats.activationCondition !== "initial");

  // And a plan that proposes ATS as discovery is rejected, not repaired into one.
  const v = await validateOrderedPlan({
    ...plan,
    steps: [{ ...ats, role: "broad_discovery", order: 1, activationCondition: "initial", stepId: "x-ats" }],
  }, profile());
  assert(v.rejectedSteps.some((r) => r.reason === "requires_known_company_not_a_discovery_step"));
});

// ====================================================== the invariant ========

Deno.test("10. rungs with no schema representation never appear, for any capability", async () => {
  enableProviders();
  // Source-activation rungs are not input changes at all: reaching another source
  // is what the ordered chain and `advance_to_next_source` already do.
  for (const capability of ALL_CAPABILITIES) {
    for (const action of ["activate_broader_approved_source", "activate_fallback_source"]) {
      const r = await assessBroadeningCompatibility(intentFor(capability), { action, capability: "indeed_job_discovery" });
      assertFalse(r.supported, `${capability}/${action}`);
      assertEquals(r.reason, "not_an_input_change");
    }
    // Free-text wording has no approved registry behind it, so it is never compiled
    // and therefore never offered.
    const wording = await assessBroadeningCompatibility(intentFor(capability), {
      action: "use_equivalent_query_wording", wording: "anything at all",
    });
    assertFalse(wording.supported, `${capability}/use_equivalent_query_wording`);
  }
});

Deno.test("11. EVERY offered rung changes the compiled input hash", async () => {
  enableProviders();
  // Both plan shapes, across every mission the deterministic planner produces.
  for (const p of [profile(), profile({ industries: ["industrial manufacturing"], stages: [] })]) {
    const plan = await deterministicOrderedPlan(p);
    for (const step of plan.steps) {
      const base = baseIntentForStep(step, p);
      const before = await compileHiringSourceInput(base);
      for (const rung of step.broadeningLadder) {
        const after = await compileHiringSourceInput(applyBroadeningToIntent(base, rung as BroadeningIntentChange));
        assert(before.ok && after.ok, `${step.capability}/${rung.action} did not compile`);
        assert(before.inputHash !== after.inputHash,
          `${step.capability} offers ${rung.action} but the compiled call is identical`);
      }
    }
  }
});

async function planned(p = profile()): Promise<{ plan: OrderedHiringSourcePlan; state: SourceExecutionState }> {
  enableProviders();
  const plan = await deterministicOrderedPlan(p);
  const state = newSourceExecutionState({
    planHash: plan.planHash,
    steps: plan.steps.map((s) => ({
      stepId: s.stepId, capability: s.capability, order: s.order,
      actorKey: actorKeyForCapability(s.capability),
    })),
    requestedCount: p.requestedCount,
    now: "2026-07-27T00:00:00Z",
  });
  return { plan, state };
}

function observation(stepId: string, o: Partial<SourceStepObservation> = {}): SourceStepObservation {
  return {
    stepId, capability: "yc_job_discovery", attempt: 1,
    funnel: {
      rawResults: 20, normalizedJobs: 18, uniqueCompanies: 12, companyBrainPass: 6,
      companyBrainFail: 6, evidencePending: 0, strongIdentity: 6, peopleSearched: 6,
      employerVerified: 3, contactReady: 2,
    },
    rejectionSummary: {
      wrongRole: 0, wrongGeography: 0, companyBrainMismatch: 0, missingIdentity: 0,
      missingDecisionMaker: 0, employerMismatch: 0, missingContactMethod: 0,
    },
    incrementalContactReady: 2, totalContactReady: 2, remainingQuota: 3,
    remainingBudgetUsd: 4, sourceExhausted: false, broadeningActionsUsed: [],
    ...o,
  };
}

Deno.test("12. an unsupported rung is gone before Claude ever sees the menu", async () => {
  const { plan, state } = await planned();
  const step = plan.steps[0];
  const obs = observation(step.stepId);
  const available = projectAvailableActions({ plan, state, observation: obs, runtime: runtimeStateFor(state) });

  const broaden = available.find((a) => a.action === "broaden_current_source");
  assert(broaden && broaden.action === "broaden_current_source");
  assertFalse(broaden.broadeningActions.some((b) => b.action === "extend_recency_window"),
    "YC has no recency field, so that rung must not reach the model");
  for (const rung of broaden.broadeningActions) {
    const r = await assessBroadeningCompatibility(baseIntentForStep(step, plan.missionProfile), rung as BroadeningIntentChange);
    assert(r.supported, `${rung.action} was offered to the model but is ${r.reason}`);
  }
});

Deno.test("13. an unsupported rung is gone before deterministic selection", async () => {
  const { plan, state } = await planned();
  const step = plan.steps[0];
  const action = decideNextAction(plan, observation(step.stepId), runtimeStateFor(state));
  if (action.action === "broaden_current_source") {
    const r = await assessBroadeningCompatibility(
      baseIntentForStep(step, plan.missionProfile), action.broadeningAction as BroadeningIntentChange);
    assert(r.supported, `deterministic chose ${action.broadeningAction.action}, which is ${r.reason}`);
  }

  // The selected rung must also actually compile to a NEW call.
  if (action.action === "broaden_current_source") {
    const prepared = await prepareStepCall({ taskId: "t", step, state, broadening: action.broadeningAction as BroadeningIntentChange });
    assert(prepared.ok, "the deterministic rung must produce a runnable call");
    const plain = await prepareStepCall({ taskId: "t", step, state });
    assert(plain.ok && plain.call.inputHash !== prepared.call.inputHash,
      "the deterministic rung compiled to the unbroadened call");
  }
});

Deno.test("14. used broadening actions remain unavailable", async () => {
  const { plan, state } = await planned();
  const step = plan.steps[0];
  const used = step.broadeningLadder[0];
  assert(used, "the step should still have at least one real rung");

  const obs = observation(step.stepId, { broadeningActionsUsed: [used.action] });
  assertFalse(eligibleBroadening(step, obs).some((b) => b.action === used.action));

  const runtime = { ...runtimeStateFor(state), broadeningUsedByStep: { [step.stepId]: [used.action] } };
  assertFalse(eligibleBroadening(step, observation(step.stepId), runtime).some((b) => b.action === used.action));
});

Deno.test("15. hard Company Brain constraints cannot be broadened", async () => {
  enableProviders();
  const p = profile();
  const plan = await deterministicOrderedPlan(p);

  // No rung anywhere touches a Company Brain field, because the compiled inputs
  // have no field to touch: size, stage, industry and business model are absent
  // from every approved Actor's schema.
  for (const step of plan.steps) {
    const base = baseIntentForStep(step, p);
    const before = await compileHiringSourceInput(base);
    if (!before.ok) continue;
    for (const forbidden of ["companySize", "employerSize", "employees", "stage", "batch", "industry", "businessModel"]) {
      assertFalse(forbidden in before.input, `${step.capability} exposes ${forbidden}`);
    }
    for (const rung of step.broadeningLadder) {
      const after = await compileHiringSourceInput(applyBroadeningToIntent(base, rung as BroadeningIntentChange));
      assert(after.ok);
      for (const forbidden of ["companySize", "employerSize", "employees", "stage", "batch", "industry", "businessModel"]) {
        assertFalse(forbidden in after.input, `${step.capability}/${rung.action} introduced ${forbidden}`);
      }
    }
  }

  // The union has no shape for them either, so a planner cannot propose one.
  for (const forbidden of [
    { action: "raise_employee_maximum" }, { action: "broaden_stage" }, { action: "change_industry" },
  ]) {
    const r = await assessBroadeningCompatibility(intentFor("indeed_job_discovery"), forbidden as BroadeningIntentChange);
    assertFalse(r.supported, `${forbidden.action} must not be supported`);
  }
});

// ================================================ nothing else moved =========

Deno.test("16. existing source ORDER is unchanged", async () => {
  enableProviders();
  const early = await deterministicOrderedPlan(profile());
  assertEquals(early.steps.map((s) => s.capability), [
    "yc_job_discovery", "indeed_job_discovery", "linkedin_job_discovery",
    "glassdoor_job_discovery", "ats_job_verification",
  ]);
  assertEquals(early.steps.map((s) => s.order), [1, 2, 3, 4, 5]);
  assertEquals(early.steps[0].activationCondition, "initial");

  const general = await deterministicOrderedPlan(profile({ industries: ["industrial manufacturing"], stages: [] }));
  assertEquals(general.steps.map((s) => s.capability), [
    "indeed_job_discovery", "linkedin_job_discovery",
    "glassdoor_job_discovery", "ats_job_verification",
  ]);
  // The chain still links every step to its successor.
  for (let i = 0; i < general.steps.length - 1; i++) {
    assertEquals(general.steps[i].nextStepId, general.steps[i + 1].stepId);
  }
});

Deno.test("17./18. everything except the ladder is untouched by this change", async () => {
  enableProviders();
  const p = profile();
  const plan = await deterministicOrderedPlan(p);

  // Targets, activation conditions, success conditions, stop conditions and the
  // capability gap are all as before; only `broadeningLadder` was filtered.
  for (const step of plan.steps) {
    assert(step.semanticIntent.candidateTarget > 0);
    assertEquals(step.stopConditions, [
      "contact_ready_quota_reached", "budget_exhausted", "maximum_provider_calls_reached", "valid_exhaustion",
    ]);
  }
  assertEquals(plan.capabilityGap, null);
  assertEquals(plan.completionCondition, { metric: "contact_ready_count", target: 5 });
  assertEquals(plan.maximumProviderCalls, 8);
  assertEquals(plan.maximumBroadeningAttempts, 2);

  // A mission that needs no hiring evidence still reports the capability gap
  // rather than an empty plan.
  const gap = await deterministicOrderedPlan(profile({ hiring: { required: false } }));
  assertEquals(gap.capabilityGap?.code, "unsupported_capability_gap");
});

Deno.test("19. with the source-planning flag OFF nothing here runs at all", async () => {
  // Compatibility filtering happens inside plan construction, and plan construction
  // only happens for a workspace that opted in. The flag resolver is untouched by
  // this change, and its default is still OFF.
  const { isDynamicSourcePlanningEnabled } = await import("../../../supabase/functions/_shared/hiringSourcePlan.ts");
  assertEquals(isDynamicSourcePlanningEnabled("ws-1", () => undefined),
    { enabled: false, reason: "flag_off" });
  assertEquals(isDynamicSourcePlanningEnabled("ws-1", (k) => (k === "DYNAMIC_HIRING_SOURCE_PLANNING" ? "true" : undefined)),
    { enabled: false, reason: "no_workspace_allowlist" });
});

Deno.test("20. no Actor, provider or model call is reachable from this path", async () => {
  enableProviders();
  // `compileHiringSourceInput` and `assessBroadeningCompatibility` are pure: they
  // build an object and hash it. A fetch here would throw, since these tests run
  // without --allow-net granted to any host they would need.
  const originalFetch = globalThis.fetch;
  let attempted = 0;
  globalThis.fetch = ((..._args: unknown[]) => {
    attempted += 1;
    return Promise.reject(new Error("no network is permitted in this test"));
  }) as typeof fetch;
  try {
    const plan = await deterministicOrderedPlan(profile());
    for (const step of plan.steps) {
      const base = baseIntentForStep(step, plan.missionProfile);
      for (const rung of step.broadeningLadder) {
        await assessBroadeningCompatibility(base, rung as SafeBroadeningAction as BroadeningIntentChange);
      }
    }
    await validateOrderedPlan(plan, profile());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(attempted, 0, "something on this path tried to reach the network");
});
