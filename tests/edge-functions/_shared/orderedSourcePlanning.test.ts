// ORDERED HIRING-SOURCE PLANNING — the decision graph.
//
// Ordering is the whole point: an unordered set of five sources is an instruction
// to spend five times the budget, and for most missions the first source alone
// fills the quota. These tests assert that one step is initially active, every
// later step names what would activate it, and the quota is what ends the plan.
//
// NO Actor is executed. NO provider, model, network or database access.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deterministicOrderedPlan, validateOrderedPlan, orderedPlanHash, orderedPlanDiagnostics,
  decideNextAction, isSafeBroadeningAction, isPlanAcyclic, IMMUTABLE_CONSTRAINTS,
  HIRING_SOURCE_PLAN_VERSION,
  type LeadMissionSourceProfile, type OrderedHiringSourcePlan, type OrderedSourceStep,
  type SourceStepObservation,
} from "../../../supabase/functions/_shared/hiringSourcePlan.ts";
import { ACTOR_REGISTRY, resolveActorForSourceType } from "../../../supabase/functions/_shared/actorRegistry.ts";

function enableProviders() {
  for (const k of [
    "APIFY_ENABLE_INDEED_JOBS_AUTOMATION_LAB", "APIFY_ENABLE_LINKEDIN_JOBS_CRAWLWORKS",
    "APIFY_ENABLE_GLASSDOOR_JOBS", "APIFY_ENABLE_YC_JOBS", "APIFY_ENABLE_ATS_VERIFICATION",
  ]) Deno.env.set(k, "1");
}

const profile = (o: Partial<LeadMissionSourceProfile> = {}): LeadMissionSourceProfile => ({
  industries: ["b2b saas"],
  stages: ["seed"],
  triggerRequirements: ["active_hiring"],
  hiring: {
    required: true, roleFamily: "revenue_operations",
    approvedAliases: ["Revenue Operations", "Revenue Strategy & Operations", "GTM Operations", "Sales Operations"],
    geography: "United States", maximumPostingAgeDays: 14,
  },
  decisionMakerRoles: ["Founder", "Co-Founder", "CEO"],
  currentEmployerRequired: true,
  requestedCount: 5,
  countEntity: "contact_ready_lead",
  quotaPolicy: "contact_only",
  requiredEvidence: ["active_hiring", "company_identity", "employer_verified"],
  ...o,
});

const caps = (p: OrderedHiringSourcePlan) => p.steps.map((s) => s.capability);

// =========================================================== ordering core ===

Deno.test("O1 a plan is ORDERED, contiguous and singly linked", async () => {
  const p = await deterministicOrderedPlan(profile());
  assertEquals(p.version, HIRING_SOURCE_PLAN_VERSION);
  assert(p.steps.length > 1);
  p.steps.forEach((s, i) => assertEquals(s.order, i + 1, `step ${i} out of order`));
  for (let i = 0; i < p.steps.length - 1; i++) {
    assertEquals(p.steps[i].nextStepId, p.steps[i + 1].stepId);
  }
  assertEquals(p.steps[p.steps.length - 1].nextStepId, undefined,
    "the last step must have no successor, or exhaustion is unreachable");
});

Deno.test("O2 exactly ONE step is initially active; every other names its activation", async () => {
  const p = await deterministicOrderedPlan(profile());
  const initial = p.steps.filter((s) => s.activationCondition === "initial");
  assertEquals(initial.length, 1, "five sources firing at once is the failure this contract prevents");
  assertEquals(initial[0].stepId, p.steps[0].stepId);
  for (const s of p.steps.slice(1)) {
    assert(s.activationCondition !== "initial", `${s.stepId} is a second initial step`);
    assert(s.activationCondition.length > 0);
  }
});

Deno.test("O3 every plan carries CONTACT-ready completion and valid exhaustion", async () => {
  const p = await deterministicOrderedPlan(profile());
  assertEquals(p.completionCondition.metric, "contact_ready_count");
  assertEquals(p.completionCondition.target, 5);
  assertEquals(p.validExhaustionCondition, { allApprovedStepsExhausted: true, noSafeBroadeningRemaining: true });
  assert(p.maximumProviderCalls > 0 && p.maximumEstimatedCostUsd > 0);
});

Deno.test("O4 quota reached stops immediately; later sources stay inactive", async () => {
  const p = await deterministicOrderedPlan(profile());
  const obs: SourceStepObservation = observation(p.steps[0].stepId, { totalContactReady: 5, remainingQuota: 0 });
  assertEquals(decideNextAction(p, obs), { action: "stop_quota_reached" });
});

// ================================================= mission-specific ordering ==

Deno.test("A early-stage B2B SaaS + RevOps: YC first, then Indeed, LinkedIn, Glassdoor, ATS", async () => {
  const p = await deterministicOrderedPlan(profile());
  assertEquals(caps(p), [
    "yc_job_discovery", "indeed_job_discovery", "linkedin_job_discovery",
    "glassdoor_job_discovery", "ats_job_verification",
  ]);
  assertEquals(p.steps[0].role, "precision_discovery");
  assert(p.steps[0].reason.toLowerCase().includes("precision"), "the first step must justify itself");
});

Deno.test("B manufacturing 10-100 + first BD hire: Indeed first, YC EXCLUDED", async () => {
  const p = await deterministicOrderedPlan(profile({
    industries: ["manufacturing"], stages: [], employeeRange: { min: 10, max: 100 },
    hiring: { required: true, roleFamily: "business_development", geography: "United States", maximumPostingAgeDays: 30 },
  }));
  assertEquals(caps(p), [
    "indeed_job_discovery", "linkedin_job_discovery", "glassdoor_job_discovery", "ats_job_verification",
  ]);
  assertFalse(caps(p).includes("yc_job_discovery"),
    "YC structurally cannot serve a manufacturer; proposing it would spend budget on a guaranteed miss");
});

Deno.test("C early-stage developer tooling + GTM Ops: YC, LinkedIn, Indeed, ATS, Glassdoor", async () => {
  const p = await deterministicOrderedPlan(profile({
    industries: ["developer tools"], companyCategory: ["developer tooling"], stages: ["seed"],
    hiring: { required: true, roleFamily: "gtm_operations", geography: "United States", maximumPostingAgeDays: 14 },
  }));
  assertEquals(caps(p), [
    "yc_job_discovery", "linkedin_job_discovery", "indeed_job_discovery",
    "ats_job_verification", "glassdoor_job_discovery",
  ]);
  // The devtool ordering differs from fixture A in BOTH tail positions.
  assert(p.steps[1].capability === "linkedin_job_discovery");
  assert(p.steps.findIndex((s) => s.capability === "ats_job_verification")
    < p.steps.findIndex((s) => s.capability === "glassdoor_job_discovery"));
});

Deno.test("D commercial security integrators in Texas: Indeed first, YC excluded", async () => {
  const p = await deterministicOrderedPlan(profile({
    industries: ["commercial security integration"], stages: [],
    hiring: { required: true, roleFamily: "sales", geography: "Texas", maximumPostingAgeDays: 30 },
  }));
  assertEquals(caps(p), [
    "indeed_job_discovery", "linkedin_job_discovery", "glassdoor_job_discovery", "ats_job_verification",
  ]);
  assertFalse(caps(p).includes("yc_job_discovery"));
});

Deno.test("E a non-hiring local-business mission reports an unsupported capability gap", async () => {
  const p = await deterministicOrderedPlan(profile({
    industries: ["dental clinics"], stages: [], triggerRequirements: ["local_presence"],
    hiring: { required: false }, requiredEvidence: ["company_identity"],
  }));
  assertEquals(p.steps, [], "no job scraper may be proposed for a mission that never asked about hiring");
  assertEquals(p.capabilityGap?.code, "unsupported_capability_gap");
  assert((p.capabilityGap?.reason ?? "").length > 0);
});

Deno.test("F different verticals produce different plans; the same profile is stable", async () => {
  const saas = await deterministicOrderedPlan(profile());
  const mfg = await deterministicOrderedPlan(profile({ industries: ["manufacturing"], stages: [] }));
  assert(saas.planHash !== mfg.planHash, "different orderings must not share a hash");
  const again = await deterministicOrderedPlan(profile());
  assertEquals(saas.planHash, again.planHash);
});

Deno.test("G source ORDER alone changes the plan hash", async () => {
  const p = await deterministicOrderedPlan(profile());
  const swapped: OrderedHiringSourcePlan = {
    ...p,
    steps: [
      { ...p.steps[1], order: 1, activationCondition: "initial" },
      { ...p.steps[0], order: 2, activationCondition: "remaining_contact_quota" },
      ...p.steps.slice(2),
    ],
  };
  assert(await orderedPlanHash(swapped) !== await orderedPlanHash(p),
    "the same sources in a different sequence are a different strategy");
});

// ================================================================ validation ==

function planOf(steps: Partial<OrderedSourceStep>[], p = profile()): OrderedHiringSourcePlan {
  return {
    version: HIRING_SOURCE_PLAN_VERSION, planHash: "", missionProfile: p,
    steps: steps.map((s, i) => ({
      stepId: s.stepId ?? `x${i}`, order: s.order ?? i + 1,
      capability: s.capability ?? "indeed_job_discovery",
      role: s.role ?? "broad_discovery", reason: s.reason ?? "r",
      activationCondition: s.activationCondition ?? (i === 0 ? "initial" : "remaining_contact_quota"),
      semanticIntent: s.semanticIntent ?? { candidateTarget: 25 },
      successCondition: s.successCondition ?? {},
      broadeningLadder: s.broadeningLadder ?? [],
      advanceConditions: s.advanceConditions ?? [],
      stopConditions: s.stopConditions ?? [],
      ...(s.nextStepId ? { nextStepId: s.nextStepId } : {}),
    })),
    completionCondition: { metric: "contact_ready_count", target: p.requestedCount },
    validExhaustionCondition: { allApprovedStepsExhausted: true, noSafeBroadeningRemaining: true },
    maximumSourceSteps: 5, maximumBroadeningAttempts: 2,
    maximumProviderCalls: 8, maximumEstimatedCostUsd: 5, capabilityGap: null,
  };
}

Deno.test("V1 ALL-INITIAL steps are demoted to a single initial step", async () => {
  enableProviders();
  const v = await validateOrderedPlan(planOf([
    { capability: "indeed_job_discovery", activationCondition: "initial" },
    { capability: "linkedin_job_discovery", activationCondition: "initial" },
    { capability: "glassdoor_job_discovery", activationCondition: "initial" },
  ]), profile());
  assertEquals(v.plan.steps.filter((s) => s.activationCondition === "initial").length, 1);
  assert(v.violations.some((x) => x.code === "multiple_initial_steps"));
  assert(v.repairs.some((r) => r.startsWith("extra_initial_step_demoted")));
  assert(v.ok, "demotion is a repair, not a block");
});

Deno.test("V2 a CYCLE cannot survive validation", async () => {
  enableProviders();
  const p = planOf([
    { stepId: "a", capability: "indeed_job_discovery", nextStepId: "b" },
    { stepId: "b", capability: "linkedin_job_discovery", nextStepId: "a" },
  ]);
  const v = await validateOrderedPlan(p, profile());
  // The chain is rebuilt from the ordered survivors, so the cycle is removed.
  assertEquals(v.plan.steps.map((s) => s.nextStepId), ["b", undefined]);
  assertFalse(v.violations.some((x) => x.code === "cyclic_plan" && x.severity === "block"));
});

Deno.test("V3 ATS cannot be a discovery step, nor the initial step", async () => {
  enableProviders();
  const asDiscovery = await validateOrderedPlan(
    planOf([{ capability: "ats_job_verification", role: "broad_discovery" }]), profile());
  assertEquals(asDiscovery.rejectedSteps[0]?.reason, "requires_known_company_not_a_discovery_step");
  assertFalse(asDiscovery.ok, "a hiring mission with no surviving discovery step must block");

  const asInitial = await validateOrderedPlan(
    planOf([{ capability: "ats_job_verification", role: "verification", activationCondition: "initial" }]), profile());
  assertEquals(asInitial.rejectedSteps[0]?.reason, "verification_cannot_be_the_initial_step");
});

Deno.test("V4 an unknown capability is rejected and an empty hiring plan blocks", async () => {
  enableProviders();
  const v = await validateOrderedPlan(planOf([{ capability: "made_up_source" as never }]), profile());
  assertEquals(v.approvedSteps.length, 0);
  assert(v.rejectedSteps[0].reason.startsWith("unknown_capability"));
  assert(v.violations.some((x) => x.code === "no_executable_hiring_source" && x.severity === "block"));
  assertFalse(v.ok);
});

Deno.test("V5 a job scraper on a non-hiring mission is rejected", async () => {
  enableProviders();
  const nonHiring = profile({ hiring: { required: false } });
  const v = await validateOrderedPlan(planOf([{ capability: "indeed_job_discovery" }], nonHiring), nonHiring);
  assertEquals(v.approvedSteps.length, 0);
  assertEquals(v.rejectedSteps[0].reason, "mission_does_not_require_hiring_evidence");
  assertEquals(v.plan.capabilityGap?.code, "unsupported_capability_gap");
});

Deno.test("V6 duplicate steps are deduplicated and targets capped to the verified ceiling", async () => {
  enableProviders();
  const v = await validateOrderedPlan(planOf([
    { capability: "indeed_job_discovery", semanticIntent: { candidateTarget: 99999 } },
    { capability: "indeed_job_discovery", semanticIntent: { candidateTarget: 20 } },
  ]), profile());
  assert(v.repairs.some((r) => r.includes("deduplicated_step")));
  assert(v.repairs.some((r) => r.includes("step_target_capped")));
  for (const s of v.plan.steps) assert(s.semanticIntent.candidateTarget <= 200);
});

Deno.test("V7 UNSAFE broadening rungs are dropped; the closed union has no shape for them", async () => {
  enableProviders();
  const v = await validateOrderedPlan(planOf([{
    capability: "indeed_job_discovery",
    // The step must already search SOMETHING for the alias rung to broaden it —
    // a step with no titles at all cannot compile, and its ladder is moot.
    semanticIntent: { candidateTarget: 25, approvedTitleAliases: ["Revenue Operations"] },
    broadeningLadder: [
      { action: "add_approved_role_aliases", aliases: ["GTM Operations"] },
      { action: "raise_employee_maximum", max: 5000 } as never,
      { action: "remove_current_employer_requirement" } as never,
    ],
  }]), profile());
  const kept = v.plan.steps[0].broadeningLadder.map((b) => b.action);
  assertEquals(kept, ["add_approved_role_aliases"]);
  assert(v.repairs.some((r) => r.startsWith("unsafe_broadening_dropped")));
});

Deno.test("V8 hard Company Brain constraints have no broadening representation at all", () => {
  for (const forbidden of [
    { action: "raise_employee_maximum" }, { action: "broaden_stage" }, { action: "change_industry" },
    { action: "change_business_model" }, { action: "remove_founder_led_requirement" },
    { action: "change_hard_geography" }, { action: "change_decision_maker_roles" },
    { action: "remove_current_employer_requirement" }, { action: "change_quota_policy" },
    { action: "exceed_budget" },
  ]) {
    assertFalse(isSafeBroadeningAction(forbidden), `${forbidden.action} must not be expressible`);
  }
  for (const allowed of [
    { action: "add_approved_role_aliases", aliases: [] },
    { action: "increase_result_target", candidateTarget: 50 },
    { action: "extend_recency_window", postingWindowDays: 14 },
    { action: "activate_fallback_source", capability: "glassdoor_job_discovery" },
  ]) assert(isSafeBroadeningAction(allowed));
});

Deno.test("V9 a plan may not exceed its own source-step cap", async () => {
  enableProviders();
  const p = planOf([
    { capability: "yc_job_discovery" }, { capability: "indeed_job_discovery" },
    { capability: "linkedin_job_discovery" }, { capability: "glassdoor_job_discovery" },
  ]);
  p.maximumSourceSteps = 2;
  const v = await validateOrderedPlan(p, profile());
  assertEquals(v.plan.steps.length, 2);
  assert(v.repairs.some((r) => r.startsWith("steps_truncated")));
  assertEquals(v.plan.steps[1].nextStepId, undefined);
});

Deno.test("V10 order is normalized and the chain relinked from survivors", async () => {
  enableProviders();
  const v = await validateOrderedPlan(planOf([
    { capability: "linkedin_job_discovery", order: 9, activationCondition: "remaining_contact_quota" },
    { capability: "indeed_job_discovery", order: 3, activationCondition: "remaining_contact_quota" },
  ]), profile());
  assertEquals(v.plan.steps.map((s) => s.order), [1, 2]);
  assertEquals(v.plan.steps[0].capability, "indeed_job_discovery");
  assertEquals(v.plan.steps[0].activationCondition, "initial");
  assertEquals(v.plan.steps[0].nextStepId, v.plan.steps[1].stepId);
});

// ============================================================= next actions ===

function observation(stepId: string, o: Partial<SourceStepObservation> = {}): SourceStepObservation {
  return {
    stepId, capability: "indeed_job_discovery", attempt: 1,
    funnel: {
      rawResults: 40, normalizedJobs: 30, uniqueCompanies: 20, companyBrainPass: 8,
      companyBrainFail: 12, evidencePending: 0, strongIdentity: 8, peopleSearched: 8,
      employerVerified: 3, contactReady: 2,
    },
    rejectionSummary: {
      wrongRole: 4, wrongGeography: 2, companyBrainMismatch: 12, missingIdentity: 1,
      missingDecisionMaker: 2, employerMismatch: 1, missingContactMethod: 1,
    },
    incrementalContactReady: 2, totalContactReady: 2, remainingQuota: 3,
    remainingBudgetUsd: 4, sourceExhausted: false, broadeningActionsUsed: [],
    ...o,
  };
}

Deno.test("N1 broadening is preferred over paying a new vendor", async () => {
  const p = await deterministicOrderedPlan(profile());
  const a = decideNextAction(p, observation(p.steps[0].stepId));
  assertEquals(a.action, "broaden_current_source");
  if (a.action === "broaden_current_source") assert(isSafeBroadeningAction(a.broadeningAction));
});

Deno.test("N2 an exhausted source advances to the next ordered step", async () => {
  const p = await deterministicOrderedPlan(profile());
  const a = decideNextAction(p, observation(p.steps[0].stepId, { sourceExhausted: true }));
  assertEquals(a, {
    action: "advance_to_next_source",
    currentStepId: p.steps[0].stepId, nextStepId: p.steps[1].stepId,
  });
});

Deno.test("N3 the final exhausted step stops with valid exhaustion, never a loop", async () => {
  const p = await deterministicOrderedPlan(profile());
  const last = p.steps[p.steps.length - 1];
  const a = decideNextAction(p, observation(last.stepId, { sourceExhausted: true }));
  assertEquals(a, { action: "stop_valid_exhaustion", reason: "all_approved_steps_exhausted" });
});

Deno.test("N4 an exhausted BUDGET stops even with quota remaining", async () => {
  const p = await deterministicOrderedPlan(profile());
  const a = decideNextAction(p, observation(p.steps[0].stepId, { remainingBudgetUsd: 0 }));
  assertEquals(a, { action: "stop_valid_exhaustion", reason: "budget_exhausted" });
});

Deno.test("N5 broadening never repeats a rung already used", async () => {
  const p = await deterministicOrderedPlan(profile());
  const ladder = p.steps[0].broadeningLadder.map((b) => b.action);
  const a = decideNextAction(p, observation(p.steps[0].stepId, { broadeningActionsUsed: [ladder[0]] }));
  if (a.action === "broaden_current_source") {
    assert(a.broadeningAction.action !== ladder[0], "a used rung must not be offered again");
  }
});

Deno.test("N6 the broadening attempt cap forces advancement", async () => {
  const p = await deterministicOrderedPlan(profile());
  const a = decideNextAction(p, observation(p.steps[0].stepId, { attempt: 99 }));
  assertEquals(a.action, "advance_to_next_source");
});

// ============================================================== diagnostics ===

Deno.test("D1 diagnostics carry ordering and activation, and no provider internals", async () => {
  enableProviders();
  const v = await validateOrderedPlan(await deterministicOrderedPlan(profile()), profile());
  const d = orderedPlanDiagnostics(v);
  assertEquals(d.ordered_capabilities, caps(v.plan));
  assert(Array.isArray(d.step_activation));
  assertEquals(d.completion_target, 5);
  assert(String(d.plan_hash).length > 0);

  const blob = JSON.stringify(d).toLowerCase();
  for (const marker of [
    "automation-lab/", "crawlworks/", "valig/", "parsebird/", "bovi/",
    "api_key", "apikey", "token", "bearer", "authorization", "actor_id",
  ]) assertFalse(blob.includes(marker), `diagnostics leaked ${marker}`);
});

// ================================================= coexistence regression =====

Deno.test("R1 registering variants must NOT repoint legacy source_type resolution", () => {
  // The new variants deliberately share `source_type` with long-standing entries so
  // both normalize into the same canonical job signal. `resolveActorForSourceType`
  // returns the first declaration match, so without `dynamic_source_only` simply
  // declaring them above the legacy entries silently swaps the vendor behind a
  // live path.
  assertEquals(resolveActorForSourceType("indeed_jobs")?.key, "apify_indeed_jobs");
  assertEquals(resolveActorForSourceType("indeed_jobs")?.actor_id, "curious_coder/indeed-scraper");
  assertEquals(resolveActorForSourceType("jobs")?.key, "apify_jobs");
  assertEquals(resolveActorForSourceType("jobs")?.actor_id, "curious_coder/linkedin-jobs-scraper");
});

Deno.test("R2 every new variant is marked dynamic_source_only; no legacy entry is", () => {
  const variants = [
    "apify_indeed_jobs_automation_lab", "apify_linkedin_jobs_crawlworks",
    "apify_glassdoor_jobs", "apify_yc_jobs", "apify_ats_verification",
  ];
  for (const k of variants) {
    assertEquals(ACTOR_REGISTRY[k]?.dynamic_source_only, true, `${k} must be catalog-only`);
  }
  for (const [k, e] of Object.entries(ACTOR_REGISTRY)) {
    if (variants.includes(k)) continue;
    assertFalse(e.dynamic_source_only === true, `${k} must remain resolvable by source_type`);
  }
});

Deno.test("R3 a shared source_type still resolves the LEGACY entry for every collision", () => {
  const bySourceType = new Map<string, string[]>();
  for (const [k, e] of Object.entries(ACTOR_REGISTRY)) {
    if (!e.source_type) continue;
    bySourceType.set(e.source_type, [...(bySourceType.get(e.source_type) ?? []), k]);
  }
  for (const [st, keys] of bySourceType) {
    if (keys.length < 2) continue;
    const resolved = resolveActorForSourceType(st);
    assert(resolved, `${st} resolved to nothing`);
    assertFalse(resolved!.dynamic_source_only === true,
      `${st} resolved to catalog-only variant ${resolved!.key}`);
  }
});

Deno.test("V11 the executable chain is acyclic, and a self-link is caught", async () => {
  const p = await deterministicOrderedPlan(profile());
  assert(isPlanAcyclic(p));
  const selfLinked = { steps: [{ ...p.steps[0], nextStepId: p.steps[0].stepId }] };
  assertFalse(isPlanAcyclic(selfLinked as never), "a step pointing at itself must be rejected");
  const dangling = { steps: [{ ...p.steps[0], nextStepId: "does-not-exist" }] };
  assertFalse(isPlanAcyclic(dangling as never), "a link to a missing step must be rejected");
});

Deno.test("V12 every immutable constraint is named and none is expressible as broadening", () => {
  assert(IMMUTABLE_CONSTRAINTS.length >= 10);
  for (const c of IMMUTABLE_CONSTRAINTS) {
    // The constraint name must not appear as an approved broadening action.
    assertFalse(isSafeBroadeningAction({ action: c }), `${c} must not be a broadening rung`);
  }
  for (const required of [
    "employee_maximum", "company_stage", "industry", "business_model", "founder_led",
    "hard_geography", "decision_maker_roles", "current_employer_required",
    "contact_only_quota", "provider_budget",
  ]) {
    assert((IMMUTABLE_CONSTRAINTS as readonly string[]).includes(required), `${required} is unlisted`);
  }
});
