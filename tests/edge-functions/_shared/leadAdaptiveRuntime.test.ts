// RUNTIME INTEGRATION TESTS — the real controller, the real ordered-plan
// validator, the real `applyObservation`.
//
// OFFLINE ONLY. Claude and every provider are injected stubs. No Actor runs, no
// Firecrawl call, no model call, no database access.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runAdaptiveRound, mapAdaptiveActionToApproved, strategyToOrderedPlanSteps,
  buildAdaptiveObservation, newAdaptivePackState, readAdaptivePackState,
  adaptiveRuntimeDiagnostics, titlesForStep,
  ADAPTIVE_PACK_STATE_KEY, RUNTIME_MAX_RECENCY_DAYS,
  type AdaptivePackState, type BuildObservationInput, type RoundStageMetrics,
} from "../../../supabase/functions/_shared/intelligence/leads/leadAdaptiveRuntime.ts";
import { validateRoleTaxonomy } from "../../../supabase/functions/_shared/leadRoleTaxonomy.ts";
import { validateQueryPacks, type QueryPack } from "../../../supabase/functions/_shared/intelligence/leads/leadQueryPacks.ts";
import { deterministicRevenueOpsTaxonomy, deterministicRevenueOpsPacks } from "../../../supabase/functions/_shared/intelligence/leads/leadAdaptiveContext.ts";
import { validateOrderedPlan, orderedPlanHash, type OrderedHiringSourcePlan } from "../../../supabase/functions/_shared/hiringSourcePlan.ts";
import { applyObservation } from "../../../supabase/functions/_shared/sequentialSourceRuntime.ts";
import { newSourceExecutionState } from "../../../supabase/functions/_shared/sourceExecutionState.ts";
import type { AdaptiveNextAction } from "../../../supabase/functions/_shared/intelligence/leads/leadAdaptiveAction.ts";

const APPROVED = ["yc_job_discovery", "linkedin_job_discovery", "indeed_job_discovery", "glassdoor_job_discovery"];

function packs(): QueryPack[] {
  const tax = validateRoleTaxonomy({
    taxonomy: deterministicRevenueOpsTaxonomy(), approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations",
  }).taxonomy!;
  return validateQueryPacks({ packs: deterministicRevenueOpsPacks(), taxonomy: tax, approvedCapabilities: APPROVED }).packs;
}

/** The production shape: relevant titles, companies resolved, all Brain-rejected. */
function stages(over: Partial<RoundStageMetrics> = {}): RoundStageMetrics {
  return {
    providerRows: 25, normalizedJobs: 25,
    titleMatches: 23, titleRejections: 2, geographyRejections: 0,
    companiesResolved: 25, companiesEvaluated: 25, companiesQualified: 0,
    companiesRejectedByBrain: 25,
    companyRejectionReasons: { employee_count: 18, business_model: 7 },
    peopleSearched: 0, employerVerified: 0, contactReady: 0,
    ...over,
  };
}

function roundInput(over: Partial<BuildObservationInput> = {}): BuildObservationInput {
  return {
    stepId: "s1", capability: "linkedin_job_discovery", stages: stages(),
    packs: packs(), packState: newAdaptivePackState(),
    packIdsUsed: ["sales_ops_leadership"], titlesUsed: ["Director of Sales Operations"],
    requestedLeads: 5, totalContactReady: 0,
    remainingBudgetUsd: 4, providerCallsRemaining: 6,
    completedSources: ["linkedin_job_discovery"],
    remainingSources: ["yc_job_discovery", "indeed_job_discovery"],
    peopleSearchCompletedForQualified: false, peopleNeedingContact: 0,
    seniorityBroadeningAvailable: true, recencyBroadeningAvailable: true,
    ...over,
  };
}

function fullRound(over: Partial<Parameters<typeof runAdaptiveRound>[0]> = {}) {
  return {
    ...roundInput(),
    approvedCapabilities: APPROVED,
    maximumAgeDays: 30,
    nextStepId: "s2", nextCapability: "yc_job_discovery",
    peopleNeedingContactIds: [] as string[],
    companiesNeedingIdentityIds: [] as string[],
    ...over,
  };
}

/** Real execution state seeded from a real plan, via the existing constructor. */
function stateFor(plan: OrderedHiringSourcePlan) {
  const state = newSourceExecutionState({
    planHash: plan.planHash,
    steps: plan.steps.map((s) => ({
      stepId: s.stepId, capability: s.capability, actorKey: null, order: s.order,
    })),
    requestedCount: plan.completionCondition.target,
    now: "2026-07-30T00:00:00.000Z",
  });
  state.current_step_id = plan.steps[0].stepId;
  state.steps[0].status = "active";
  state.steps[0].attempts = 1;
  return state;
}

// ======================================= 6,7. ONE OBSERVATION FROM REAL STAGES ==

Deno.test("6/7. a completed round produces exactly one observation from stage metrics", async () => {
  const r = await runAdaptiveRound(fullRound());
  assertEquals(r.observation.provider_rows, 25);
  assertEquals(r.observation.title_matches, 23);
  assertEquals(r.observation.companies_resolved, 25);
  assertEquals(r.observation.companies_qualified, 0);
  assertEquals(r.observation.companies_rejected, 25);
  assertEquals(r.observation.company_rejection_reasons.employee_count, 18);
  assertEquals(r.observation.source_capability, "linkedin_job_discovery");
});

// ============================================ 8,9,10. HONEST CLASSIFICATION ==

Deno.test("10. resolved companies rejected by the Brain classify as company_brain_rejection", async () => {
  const r = await runAdaptiveRound(fullRound());
  assertEquals(r.observation.bottleneck, "company_brain_rejection");
});

Deno.test("9. titles matched but nothing resolved is insufficient_company_resolution", async () => {
  const r = await runAdaptiveRound(fullRound({
    stages: stages({ companiesResolved: 0, companiesEvaluated: 0, companiesRejectedByBrain: 0, companyRejectionReasons: {} }),
  }));
  assertEquals(r.observation.bottleneck, "insufficient_company_resolution");
  assert(r.observation.bottleneck !== "company_brain_rejection");
});

Deno.test("8. rows lost upstream (missing occurred_at) are NOT a Company Brain rejection", async () => {
  // Production task c30fbc6d round 3, exactly: 25 rows in, 21 dropped at
  // `missing_occurred_at`, 4 off-family, no company ever resolved and the Brain
  // never invoked. The old funnel reported 25 rejections here.
  const r = await runAdaptiveRound(fullRound({
    stages: stages({
      providerRows: 25, normalizedJobs: 4, titleMatches: 4, titleRejections: 21,
      companiesResolved: 0, companiesEvaluated: 0, companiesQualified: 0,
      companiesRejectedByBrain: 0, companyRejectionReasons: {},
    }),
  }));
  assertEquals(r.observation.companies_rejected, 0, "no company was evaluated, so none was rejected");
  assert(r.observation.bottleneck !== "company_brain_rejection");
  // 21 of 25 off-family is title noise, judged on titles alone.
  assertEquals(r.observation.bottleneck, "excessive_title_noise");
});

// ================================= 11. HIGH REJECTION → VALID SOURCE SWITCH ==

Deno.test("11. high Company Brain rejection produces a valid source-switch action", async () => {
  const claude: AdaptiveNextAction = {
    action: "advance_source",
    reason: "Titles matched but employers failed the SaaS startup constraints.",
    target_capability_key: "yc_job_discovery",
  };
  const r = await runAdaptiveRound(fullRound({ askClaude: () => Promise.resolve(claude) }));
  assertEquals(r.chosenSource, "claude");
  assertEquals(r.chosen.action, "advance_source");
  assertEquals(r.approved?.action, "advance_to_next_source");
  assertEquals(r.fallbackReason, null);
});

Deno.test("11b. it does NOT broaden into adjacent or generic roles under that pattern", async () => {
  const r = await runAdaptiveRound(fullRound());   // no Claude → deterministic
  assertEquals(r.chosen.action, "advance_source");
  assertFalse(r.chosen.action === "activate_direct_adjacent_pack");
  assertFalse(r.chosen.action === "activate_evidence_gated_pack");
  assertFalse(r.chosen.action === "broaden_direct_seniority");
});

// ============================================ 12. ONE FEEDBACK PER OBSERVATION ==

Deno.test("12. Claude feedback is requested at most once per observation", async () => {
  let calls = 0;
  const r = await runAdaptiveRound(fullRound({
    askClaude: () => { calls += 1; return Promise.resolve(null); },
  }));
  assertEquals(calls, 1);
  assertEquals(r.packState.feedback_requests, 1);

  // No hook supplied ⇒ no request at all.
  const none = await runAdaptiveRound(fullRound());
  assertEquals(none.packState.feedback_requests, 0);
  assertEquals(none.chosenSource, "deterministic_fallback");
});

Deno.test("12b. a throwing Claude hook falls back instead of halting the round", async () => {
  const r = await runAdaptiveRound(fullRound({
    askClaude: () => Promise.reject(new Error("gateway exploded")),
  }));
  assertEquals(r.chosenSource, "deterministic_fallback");
  assert(r.approved !== null);
});

// ============ 13,14. VALID / INVALID ACTION AGAINST THE REAL SOURCE STATE ==

Deno.test("13. a valid action updates the REAL sequential source state", async () => {
  const plan = await realPlan();
  const state = stateFor(plan);

  const r = await runAdaptiveRound(fullRound({
    stepId: plan.steps[0].stepId,
    nextStepId: plan.steps[1].stepId, nextCapability: plan.steps[1].capability,
    askClaude: () => Promise.resolve({
      action: "advance_source", reason: "corpus mismatch",
      target_capability_key: plan.steps[1].capability,
    } as AdaptiveNextAction),
  }));

  // The EXISTING mutator is what moves the state.
  const applied = applyObservation(plan, state, {
    stepId: plan.steps[0].stepId, capability: plan.steps[0].capability, attempt: 1,
    funnel: {
      rawResults: 25, normalizedJobs: 25, uniqueCompanies: 25, companyBrainPass: 0,
      companyBrainFail: 25, evidencePending: 0, strongIdentity: 0, peopleSearched: 0,
      employerVerified: 0, contactReady: 0,
    },
    rejectionSummary: {
      wrongRole: 2, wrongGeography: 0, companyBrainMismatch: 25, missingIdentity: 0,
      missingDecisionMaker: 0, employerMismatch: 0, missingContactMethod: 0,
    },
    incrementalContactReady: 0, totalContactReady: 0, remainingQuota: 5,
    remainingBudgetUsd: 4, sourceExhausted: false, broadeningActionsUsed: [],
  }, r.approved!);

  assertEquals(applied.action.action, "advance_to_next_source");
  assertEquals(state.current_step_id, plan.steps[1].stepId);
  assert(state.completed_step_ids.includes(plan.steps[0].stepId));
});

Deno.test("14. an invalid Claude action falls back and still yields an executable action", async () => {
  const r = await runAdaptiveRound(fullRound({
    askClaude: () => Promise.resolve({
      action: "advance_source", reason: "switch",
      target_capability_key: "crawlworks/linkedin-jobs-scraper",   // raw Actor ID
    } as AdaptiveNextAction),
  }));
  assertEquals(r.chosenSource, "deterministic_fallback");
  assert(r.violations.some((v) => v.code === "raw_actor_id"));
  assert(r.approved !== null);
});

// ==================================================== 15. DUPLICATE INPUTS ==

Deno.test("15. an input already executed cannot run again", async () => {
  const first = await runAdaptiveRound(fullRound({
    askClaude: () => Promise.resolve({
      action: "advance_source", reason: "switch", target_capability_key: "yc_job_discovery",
    } as AdaptiveNextAction),
  }));
  assertEquals(first.chosenSource, "claude");
  assert(first.packState.executed_signatures.length > 0);

  // Same action, same signature, on the carried state.
  const second = await runAdaptiveRound(fullRound({
    packState: first.packState,
    askClaude: () => Promise.resolve({
      action: "advance_source", reason: "switch", target_capability_key: "yc_job_discovery",
    } as AdaptiveNextAction),
  }));
  assertEquals(second.chosenSource, "deterministic_fallback");
  assert(second.violations.some((v) => v.code === "duplicate_input"));
});

// ======================================= 17,18,19. PEOPLE, QUOTA, PARTIAL ==

Deno.test("17. qualified-company coverage transitions to people search", async () => {
  const r = await runAdaptiveRound(fullRound({
    stages: stages({ companiesResolved: 14, companiesEvaluated: 14, companiesQualified: 11, companiesRejectedByBrain: 3 }),
    companiesNeedingIdentityIds: ["c1", "c2"],
  }));
  assertEquals(r.observation.bottleneck, "insufficient_decision_maker_coverage");
  assertEquals(r.chosen.action, "begin_people_search");
  // Mapped onto the EXISTING company-to-people pathway.
  assertEquals(r.approved?.action, "enrich_company_identity");
});

Deno.test("18. a met CONTACT quota stops every remaining action", async () => {
  const r = await runAdaptiveRound(fullRound({ totalContactReady: 5 }));
  assertEquals(r.observation.remaining_leads, 0);
  assertEquals(r.observation.valid_next_actions, ["stop_success"]);
  assertEquals(r.chosen.action, "stop_success");
  assertEquals(r.approved?.action, "stop_quota_reached");
});

Deno.test("18b. company rows and unverified people never count as CONTACT leads", async () => {
  const r = await runAdaptiveRound(fullRound({
    stages: stages({ companiesResolved: 30, companiesQualified: 25, employerVerified: 25 }),
    totalContactReady: 0,
  }));
  assertEquals(r.observation.remaining_leads, 5);
  assertFalse(r.observation.valid_next_actions.includes("stop_success"));
});

Deno.test("19. three of five with everything exhausted stays an honest Partial", async () => {
  const r = await runAdaptiveRound(fullRound({
    totalContactReady: 3,
    stages: stages({ companiesResolved: 20, companiesEvaluated: 20, companiesQualified: 12, companiesRejectedByBrain: 8, employerVerified: 8 }),
    packState: {
      ...newAdaptivePackState(),
      completed_by_capability: { linkedin_job_discovery: packs().map((p) => p.pack_id) },
      activated_pack_ids: packs().map((p) => p.pack_id),
    },
    remainingSources: [], completedSources: ["linkedin_job_discovery"],
    peopleSearchCompletedForQualified: true, peopleNeedingContact: 0,
    seniorityBroadeningAvailable: false, recencyBroadeningAvailable: false,
    nextStepId: null, nextCapability: null,
  }));
  assertEquals(r.observation.remaining_leads, 2);
  assertEquals(r.chosen.action, "stop_partial");
  assertEquals(r.approved?.action, "stop_valid_exhaustion");
});

// ============================== 1,2,3,4,5. STRATEGY → PLAN → COMPILER PATH ==

async function realPlan(): Promise<OrderedHiringSourcePlan> {
  const steps = strategyToOrderedPlanSteps({
    source_plan: [
      { step_id: "s1-yc", capability_key: "yc_job_discovery", purpose: "startup-precise discovery", query_pack_ids: ["sales_ops_leadership", "revenue_ops_leadership"], semantic_filters: { countries: ["United States"], maximum_age_days: 30 }, rationale: "Preferred first because the mission targets startups." },
      { step_id: "s2-li", capability_key: "linkedin_job_discovery", purpose: "broader coverage", query_pack_ids: ["direct_ops_ic"], semantic_filters: { countries: ["United States"], maximum_age_days: 60 } },
    ],
    query_packs: packs(),
    recency_policy: { maximum_age_days: 60 },
    broadening_ladder: [],
  }, { candidateTarget: 25 });

  const base = {
    version: "ordered-hiring-source-plan-v1" as const,
    missionProfile: {
      requestedCount: 5,
      hiring: { required: true, roleSeed: "Sales Operations" },
      geography: { country: "United States" },
    } as unknown as OrderedHiringSourcePlan["missionProfile"],
    steps,
    completionCondition: { metric: "contact_ready_count" as const, target: 5 },
    validExhaustionCondition: { allApprovedStepsExhausted: true as const, noSafeBroadeningRemaining: true as const },
    maximumSourceSteps: 5, maximumBroadeningAttempts: 2,
    maximumProviderCalls: 8, maximumEstimatedCostUsd: 5,
    capabilityGap: null,
  };
  return { ...base, planHash: await orderedPlanHash(base) };
}

Deno.test("1/3. a validated strategy becomes an ordered plan that opens on the startup source", async () => {
  const plan = await realPlan();
  assertEquals(plan.steps[0].capability, "yc_job_discovery");
  assertEquals(plan.steps[0].activationCondition, "initial");
  assertEquals(plan.steps[0].order, 1);
  assertEquals(plan.steps[0].nextStepId, "s2-li");
  // Later steps only run while quota remains.
  assertEquals(plan.steps[1].activationCondition, "remaining_contact_quota");
});

Deno.test("1b. the EXISTING ordered-plan validator is the final authority on the converted plan", async () => {
  const plan = await realPlan();
  const v = await validateOrderedPlan(plan, plan.missionProfile);
  // Whatever the environment enables, the validator — not this layer — decides.
  assert(Array.isArray(v.approvedSteps ?? []));
  for (const s of v.approvedSteps ?? []) {
    assert(APPROVED.includes(s.capability), `validator approved an unexpected capability: ${s.capability}`);
  }
});

Deno.test("4/5. query packs reach the step intent, so pack titles reach the compiler", async () => {
  const plan = await realPlan();
  const aliases = plan.steps[0].semanticIntent.approvedTitleAliases ?? [];
  // The two exact leadership packs, and nothing from the gated tiers.
  assert(aliases.includes("VP of Sales Operations"));
  assert(aliases.includes("Director of Revenue Operations"));
  assertFalse(aliases.includes("Deal Desk Manager"));
  assertFalse(aliases.includes("Chief Revenue Officer"));

  // The same titles the selection helper reports for those packs.
  const expected = titlesForStep(["sales_ops_leadership", "revenue_ops_leadership"], packs());
  for (const t of expected) assert(aliases.includes(t));

  // Recency rides as SEMANTIC intent, never as a provider field, and is capped.
  assertEquals(plan.steps[0].semanticIntent.postingWindowDays, 30);
  assert((plan.steps[1].semanticIntent.postingWindowDays ?? 0) <= RUNTIME_MAX_RECENCY_DAYS);
  // No provider JSON anywhere in the plan.
  const blob = JSON.stringify(plan);
  assertFalse(blob.includes("datePosted"));
  assertFalse(blob.includes("apify"));
});

Deno.test("2. an unmappable action falls back rather than inventing a runtime effect", () => {
  // advance_source with no next step has no honest equivalent.
  const m = mapAdaptiveActionToApproved(
    { action: "advance_source", reason: "go" },
    {
      stepId: "s1", nextStepId: null, nextCapability: null, packs: packs(),
      packState: newAdaptivePackState(), quotaReached: false, maximumAgeDays: 30,
      peopleNeedingContact: [], companiesNeedingIdentity: [],
    },
  );
  assertEquals(m.approved, null);
  assertEquals(m.failure, "no_next_step");
});

Deno.test("2b. stop_success is refused unless the quota authority agrees", () => {
  const m = mapAdaptiveActionToApproved(
    { action: "stop_success", reason: "done" },
    {
      stepId: "s1", nextStepId: null, nextCapability: null, packs: packs(),
      packState: newAdaptivePackState(), quotaReached: false, maximumAgeDays: 30,
      peopleNeedingContact: [], companiesNeedingIdentity: [],
    },
  );
  assertEquals(m.approved, null);
});

Deno.test("recency broadening never passes the 60-day ceiling", () => {
  const at = mapAdaptiveActionToApproved(
    { action: "broaden_recency", reason: "older" },
    {
      stepId: "s1", nextStepId: null, nextCapability: null, packs: packs(),
      packState: newAdaptivePackState(), quotaReached: false, maximumAgeDays: 60,
      peopleNeedingContact: [], companiesNeedingIdentity: [],
    },
  );
  assertEquals(at.failure, "recency_ceiling_reached");

  const below = mapAdaptiveActionToApproved(
    { action: "broaden_recency", reason: "older" },
    {
      stepId: "s1", nextStepId: null, nextCapability: null, packs: packs(),
      packState: newAdaptivePackState(), quotaReached: false, maximumAgeDays: 30,
      peopleNeedingContact: [], companiesNeedingIdentity: [],
    },
  );
  const b = below.approved as { broadeningAction: { postingWindowDays: number } };
  assert(b.broadeningAction.postingWindowDays <= RUNTIME_MAX_RECENCY_DAYS);
});

Deno.test("an evidence-gated pack cannot be activated in the runtime without evidence", () => {
  const stripped = packs().map((p) =>
    p.pack_id === "commercial_ops_gated" ? { ...p, description_evidence: [] } : p);
  const m = mapAdaptiveActionToApproved(
    { action: "activate_evidence_gated_pack", reason: "widen", query_pack_ids: ["commercial_ops_gated"] },
    {
      stepId: "s1", nextStepId: null, nextCapability: null, packs: stripped,
      packState: newAdaptivePackState(), quotaReached: false, maximumAgeDays: 30,
      peopleNeedingContact: [], companiesNeedingIdentity: [],
    },
  );
  assertEquals(m.approved, null);
  assertEquals(m.failure, "no_activatable_pack");
});

// ============================================= 16,20. EXISTING BEHAVIOUR ==

Deno.test("16. batch sizing is untouched — this layer never sizes a round", async () => {
  const r = await runAdaptiveRound(fullRound());
  const blob = JSON.stringify(r);
  assertFalse(blob.includes("sourceMaximum"));
  assertFalse(blob.includes("costPerCallUsd"));
});

Deno.test("20. with no Claude hook the runtime is purely deterministic", async () => {
  const a = await runAdaptiveRound(fullRound());
  const b = await runAdaptiveRound(fullRound());
  assertEquals(a.chosen.action, b.chosen.action);
  assertEquals(a.chosenSource, "deterministic_fallback");
  assertEquals(a.packState.feedback_requests, 0);
  assertEquals(a.approved?.action, b.approved?.action);
});

Deno.test("the pack ledger round-trips through a checkpoint slice", async () => {
  const r = await runAdaptiveRound(fullRound());
  const slices = { [ADAPTIVE_PACK_STATE_KEY]: r.packState } as Record<string, unknown>;
  const read: AdaptivePackState = readAdaptivePackState(slices);
  assertEquals(read.completed_by_capability["linkedin_job_discovery"], r.packState.completed_by_capability["linkedin_job_discovery"]);
  assertEquals(read.executed_signatures, r.packState.executed_signatures);
  // A missing or malformed slice is a fresh ledger, never a throw.
  assertEquals(readAdaptivePackState(undefined).feedback_requests, 0);
  assertEquals(readAdaptivePackState({ [ADAPTIVE_PACK_STATE_KEY]: "nonsense" }).activated_pack_ids, []);
});

Deno.test("diagnostics carry codes and counts, never prompts or provider records", async () => {
  const d = adaptiveRuntimeDiagnostics(await runAdaptiveRound(fullRound()));
  assertEquals(d.bottleneck, "company_brain_rejection");
  assertEquals(d.chosen_action, "advance_source");
  const blob = JSON.stringify(d).toLowerCase();
  for (const banned of ["prompt", "apify", "description", "email", "@"]) {
    assertFalse(blob.includes(banned), `diagnostics leaked ${banned}`);
  }
});

Deno.test("the observation handed to Claude stays bounded", async () => {
  const o = buildAdaptiveObservation(roundInput());
  assert(JSON.stringify(o).length < 8000);
  assertFalse(JSON.stringify(o).includes("provider_payload"));
});
