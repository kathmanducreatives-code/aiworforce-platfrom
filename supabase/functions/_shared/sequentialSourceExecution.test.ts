// SEQUENTIAL EXECUTION OF THE ORDERED SOURCE PLAN.
//
// The provider function is a FAKE in every test. NO Apify Actor is executed, no
// Firecrawl call is made, no model is called, no database is touched.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deterministicOrderedPlan, type LeadMissionSourceProfile,
  type OrderedHiringSourcePlan, type SourceStepObservation,
} from "./hiringSourcePlan.ts";
import {
  newSourceExecutionState, stateMatchesPlan, stepOf, jobDedupeKey, companyDedupeKeyFor,
  dedupeAgainstState, peopleSearchAlreadyRan, markPeopleSearched, isStepFinished,
  SOURCE_EXECUTION_KEY, type SourceExecutionState,
} from "./sourceExecutionState.ts";
import {
  sequentialJobsInvoker, selectExecutableStep, applyObservation, prepareStepCall,
  sourceIdempotencyKey, sourceExecutionDiagnostics, safeFailureCategory, actorKeyForCapability,
} from "./sequentialSourceRuntime.ts";
import { resolveActorForSourceType } from "./actorRegistry.ts";
import { SOURCING_STATE_KEY } from "./companyFirstSourcingState.ts";

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

async function setup(p = profile()) {
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

function job(i: number, o: Record<string, unknown> = {}) {
  return { id: `j${i}`, url: `https://example.com/job/${i}`, company: `Co ${i}`, title: "Revenue Operations", location: "United States", ...o };
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
      wrongRole: 2, wrongGeography: 1, companyBrainMismatch: 6, missingIdentity: 1,
      missingDecisionMaker: 1, employerMismatch: 1, missingContactMethod: 0,
    },
    incrementalContactReady: 2, totalContactReady: 2, remainingQuota: 3,
    remainingBudgetUsd: 4, sourceExhausted: false, broadeningActionsUsed: [],
    ...o,
  };
}

// ================================================== sequential activation ====

Deno.test("T1 only the INITIAL step executes first", async () => {
  const { plan, state } = await setup();
  const calls: string[] = [];
  const h = sequentialJobsInvoker({
    taskId: "t1", plan, state,
    invokeJobs: async (env) => { calls.push(String(env.selected_actor_key)); return [job(1)]; },
  });
  await h.invokeJobs({}, 25);
  assertEquals(calls.length, 1, "exactly one provider call");
  assertEquals(state.current_step_id, plan.steps[0].stepId);
  assertEquals(calls[0], actorKeyForCapability(plan.steps[0].capability));
});

Deno.test("T2 later steps stay INACTIVE until the plan advances", async () => {
  const { plan, state } = await setup();
  for (const s of state.steps.slice(1)) assertEquals(s.status, "pending");
  const h = sequentialJobsInvoker({ taskId: "t2", plan, state, invokeJobs: async () => [job(1)] });
  await h.invokeJobs({}, 25);
  assertEquals(state.steps[0].status, "active");
  for (const s of state.steps.slice(1)) {
    assertEquals(s.status, "pending", `${s.step_id} activated without being advanced to`);
    assertEquals(s.attempts, 0);
  }
});

Deno.test("T36/T37 execution cannot jump to an arbitrary source", async () => {
  const { plan, state } = await setup();
  // Point the state at the LAST step without ever advancing there.
  const decisionForFirst = selectExecutableStep(plan, state);
  assert(decisionForFirst.ok && decisionForFirst.step.stepId === plan.steps[0].stepId,
    "with no current step, only the initial step is executable");
  // The selector always returns the CURRENT step, never a free choice.
  state.current_step_id = plan.steps[2].stepId;
  const d = selectExecutableStep(plan, state);
  assert(d.ok);
  assertEquals(d.step.stepId, plan.steps[2].stepId, "the selector honours the recorded step only");
});

Deno.test("T38 the plan chain stays acyclic and terminates", async () => {
  const { plan } = await setup();
  const seen = new Set<string>();
  let cur = plan.steps[0];
  while (cur) {
    assertFalse(seen.has(cur.stepId), "cycle detected");
    seen.add(cur.stepId);
    const next = plan.steps.find((s) => s.stepId === cur.nextStepId);
    if (!next) break;
    cur = next;
  }
  assertEquals(seen.size, plan.steps.length);
});

// ============================================================== early stop ===

Deno.test("T3 quota completion prevents EVERY remaining source call", async () => {
  const { plan, state } = await setup();
  const r = applyObservation(plan, state, observation(plan.steps[0].stepId, {
    incrementalContactReady: 5, totalContactReady: 5, remainingQuota: 0,
  }));
  assertEquals(r.action.action, "stop_quota_reached");
  assert(r.stopped);
  assertEquals(state.early_stop_reason, "contact_ready_quota_met");

  for (const s of state.steps.slice(1)) {
    assertEquals(s.status, "inactive_quota_met");
    assertEquals(s.inactive_reason, "contact_quota_met");
  }

  let called = false;
  const h = sequentialJobsInvoker({
    taskId: "t3", plan, state,
    invokeJobs: async () => { called = true; return [job(1)]; },
  });
  const rows = await h.invokeJobs({}, 25);
  assertFalse(called, "a satisfied quota must never pay for another call");
  assertEquals(rows, []);
  assertEquals(h.lastOutcome()?.reason, "quota_met");
});

Deno.test("T7/T8 Indeed and LinkedIn never run when YC reaches quota", async () => {
  const { plan, state } = await setup();
  assertEquals(plan.steps[0].capability, "yc_job_discovery");
  applyObservation(plan, state, observation(plan.steps[0].stepId, {
    incrementalContactReady: 5, totalContactReady: 5, remainingQuota: 0,
  }));
  for (const cap of ["indeed_job_discovery", "linkedin_job_discovery", "glassdoor_job_discovery"]) {
    const rec = state.steps.find((s) => s.capability === cap);
    assertEquals(rec?.attempts, 0, `${cap} was attempted after quota was met`);
    assertEquals(rec?.status, "inactive_quota_met");
  }
});

// ============================================================== broadening ===

Deno.test("T4 a low-yield step broadens exactly once per approved rung", async () => {
  const { plan, state } = await setup();
  const r = applyObservation(plan, state, observation(plan.steps[0].stepId, {
    incrementalContactReady: 1, totalContactReady: 1, remainingQuota: 4,
  }));
  assertEquals(r.action.action, "broaden_current_source");
  assertFalse(r.stopped);
  assertEquals(stepOf(state, plan.steps[0].stepId)?.broadening_used.length, 1);
  assertEquals(state.current_step_id, plan.steps[0].stepId, "broadening stays on the SAME step");
});

Deno.test("T5 the same compiled input is never sent twice for a step", async () => {
  const { plan, state } = await setup();
  const first = await prepareStepCall({ taskId: "t5", step: plan.steps[0], state });
  assert(first.ok);
  stepOf(state, plan.steps[0].stepId)!.input_hashes.push(first.call.inputHash);

  const repeat = await prepareStepCall({ taskId: "t5", step: plan.steps[0], state });
  assertFalse(repeat.ok);
  if (!repeat.ok) assertEquals(repeat.status, "duplicate_input");
});

Deno.test("T29 the maximum broadening attempt count is enforced", async () => {
  const { plan, state } = await setup();
  const a = applyObservation(plan, state, observation(plan.steps[0].stepId, { attempt: 99 }));
  assertEquals(a.action.action, "advance_to_next_source", "the attempt cap forces advancement");
});

Deno.test("T6 an exhausted first step advances to the second", async () => {
  const { plan, state } = await setup();
  const r = applyObservation(plan, state, observation(plan.steps[0].stepId, { sourceExhausted: true }));
  assertEquals(r.action.action, "advance_to_next_source");
  assertEquals(state.current_step_id, plan.steps[1].stepId);
  assertEquals(state.current_attempt, 0, "the new step starts its own attempt count");
  assert(state.exhausted_step_ids.includes(plan.steps[0].stepId));
});

// ===================================================================== ATS ===

Deno.test("T10 ATS verification requires a resolved ATS identity", async () => {
  const { plan, state } = await setup();
  const ats = plan.steps.find((s) => s.capability === "ats_job_verification")!;
  state.current_step_id = ats.stepId;

  const without = selectExecutableStep(plan, state, { atsIdentitiesAvailable: 0, jobEvidenceUncertain: true });
  assertFalse(without.ok);
  if (!without.ok) assertEquals(without.reason, "verification_requires_company_identity");

  const with_ = selectExecutableStep(plan, state, { atsIdentitiesAvailable: 3, jobEvidenceUncertain: true });
  assert(with_.ok, "a resolved identity plus uncertain evidence permits verification");
});

Deno.test("T11 ATS is not a broad discovery step", async () => {
  const { plan } = await setup();
  const ats = plan.steps.find((s) => s.capability === "ats_job_verification")!;
  assertEquals(ats.role, "verification");
  assert(ats.activationCondition !== "initial", "verification can never be the initial step");
  assertEquals(ats.broadeningLadder, [], "a verification step must not broaden");
});

// ============================================================ deduplication ==

Deno.test("T19 duplicate JOBS are removed within the task", async () => {
  const { plan, state } = await setup();
  const h = sequentialJobsInvoker({
    taskId: "t19", plan, state,
    invokeJobs: async () => [job(1), job(1), job(2)],
  });
  const rows = await h.invokeJobs({}, 25);
  assertEquals(rows.length, 2, "the repeated posting must be dropped");
  assertEquals(h.lastOutcome()?.duplicateCount, 1);
});

Deno.test("T19b a job seen in an EARLIER step is not reprocessed", async () => {
  const { plan, state } = await setup();
  const h = sequentialJobsInvoker({ taskId: "t19b", plan, state, invokeJobs: async () => [job(1), job(2)] });
  await h.invokeJobs({}, 25);
  applyObservation(plan, state, observation(plan.steps[0].stepId, { sourceExhausted: true }));

  const h2 = sequentialJobsInvoker({ taskId: "t19b", plan, state, invokeJobs: async () => [job(2), job(3)] });
  const rows = await h2.invokeJobs({}, 25);
  assertEquals(rows.length, 1, "job 2 crossed sources and must be deduplicated");
});

Deno.test("T19c job identity precedence: id, then canonical url, then company+title+location", () => {
  assertEquals(jobDedupeKey({ providerJobId: "A1", jobUrl: "https://x/1" }), "job_id:a1");
  // Tracking parameters must not make one posting look like several.
  assertEquals(
    jobDedupeKey({ jobUrl: "https://x/jobs/9?utm_source=indeed#top" }),
    jobDedupeKey({ jobUrl: "https://x/jobs/9" }),
  );
  assertEquals(
    jobDedupeKey({ companyName: "Acme", title: "RevOps", location: "US" }),
    "job_cti:acme|revops|us",
  );
  assertEquals(jobDedupeKey({}), null, "an unidentifiable job yields no key");
});

Deno.test("T20 duplicate COMPANIES are removed using the existing identity precedence", () => {
  const a = companyDedupeKeyFor({ name: "Acme, Inc.", website: "https://acme.com" });
  const b = companyDedupeKeyFor({ name: "Acme", website: "http://www.acme.com/careers" });
  assertEquals(a.key, b.key, "the same company by domain must collapse");
  assertEquals(a.identity.dedupeKeyKind, "domain");

  const seen: string[] = [];
  const out = dedupeAgainstState(seen, [a.key!, b.key!, "domain:other.com"], (k) => k);
  assertEquals(out.fresh.length, 2);
  assertEquals(out.duplicates.length, 1);
});

Deno.test("T21 one canonical company receives exactly ONE decision-maker sequence", async () => {
  const { state } = await setup();
  const key = companyDedupeKeyFor({ name: "Acme", website: "acme.com" }).key!;
  assertFalse(peopleSearchAlreadyRan(state, key));
  markPeopleSearched(state, key);
  assert(peopleSearchAlreadyRan(state, key));
  markPeopleSearched(state, key);
  assertEquals(state.people_searched_company_keys.length, 1, "a repeat must not add a second sequence");

  // The same company reached through another source is still the same company.
  const viaLinkedIn = companyDedupeKeyFor({ name: "Acme, Inc.", website: "https://www.acme.com" }).key!;
  assert(peopleSearchAlreadyRan(state, viaLinkedIn));
});

// ========================================================== idempotency ======

Deno.test("T13 the existing durable ledger prevents a repeated paid call", async () => {
  const { plan, state } = await setup();
  let calls = 0;
  const h = sequentialJobsInvoker({
    taskId: "t13", plan, state,
    invokeJobs: async () => { calls += 1; return [job(1)]; },
    alreadyPaid: () => true,
  });
  const rows = await h.invokeJobs({}, 25);
  assertEquals(calls, 0, "a call already in the ledger must not be paid for again");
  assertEquals(rows, []);
  assertEquals(h.lastOutcome()?.reason, "already_paid");
});

Deno.test("T13b idempotency keys are deterministic and step/attempt scoped", () => {
  const k1 = sourceIdempotencyKey("task-1", "s1-yc", 1, "abcdef1234567890ff");
  const k2 = sourceIdempotencyKey("task-1", "s1-yc", 1, "abcdef1234567890ff");
  assertEquals(k1, k2);
  assert(k1 !== sourceIdempotencyKey("task-1", "s1-yc", 2, "abcdef1234567890ff"));
  assert(k1 !== sourceIdempotencyKey("task-2", "s1-yc", 1, "abcdef1234567890ff"));
});

// ============================================================ continuation ===

Deno.test("T14/T39 the SAME task id persists across source steps; no new task", async () => {
  const { plan, state } = await setup();
  const seenTasks = new Set<string>();
  const h = sequentialJobsInvoker({
    taskId: "task-fixed", plan, state,
    invokeJobs: async (env) => { seenTasks.add(String(env.idempotency_key).split(":")[0]); return [job(1)]; },
  });
  await h.invokeJobs({}, 25);
  applyObservation(plan, state, observation(plan.steps[0].stepId, { sourceExhausted: true }));
  const h2 = sequentialJobsInvoker({
    taskId: "task-fixed", plan, state,
    invokeJobs: async (env) => { seenTasks.add(String(env.idempotency_key).split(":")[0]); return [job(9)]; },
  });
  await h2.invokeJobs({}, 25);
  assertEquals([...seenTasks], ["task-fixed"], "a second source step must not create a second task");
});

Deno.test("T15/T16 cumulative cost and completed steps survive a resume", async () => {
  const { plan, state } = await setup();
  const h = sequentialJobsInvoker({
    taskId: "t16", plan, state, costPerCall: 0.5, invokeJobs: async () => [job(1)],
  });
  await h.invokeJobs({}, 25);
  applyObservation(plan, state, observation(plan.steps[0].stepId, { sourceExhausted: true }));

  // Round-trip through JSON, exactly as the checkpoint column stores it.
  const restored = JSON.parse(JSON.stringify(state)) as SourceExecutionState;
  assert(stateMatchesPlan(restored, plan.planHash));
  assertEquals(restored.cumulative_cost, 0.5);
  assertEquals(restored.provider_calls, 1);
  assert(restored.exhausted_step_ids.includes(plan.steps[0].stepId));
  assertEquals(restored.current_step_id, plan.steps[1].stepId, "resume continues at step two, not step one");
});

Deno.test("T17/T18 completed work is not repeated after a resume", async () => {
  const { plan, state } = await setup();
  const h = sequentialJobsInvoker({ taskId: "t17", plan, state, invokeJobs: async () => [job(1), job(2)] });
  await h.invokeJobs({}, 25);
  const key = companyDedupeKeyFor({ name: "Co 1", website: "co1.com" }).key!;
  markPeopleSearched(state, key);

  const restored = JSON.parse(JSON.stringify(state)) as SourceExecutionState;
  assertEquals(restored.seen_job_keys.length, 2, "seen jobs survive the resume");
  assert(peopleSearchAlreadyRan(restored, key), "a completed founder search must not run again");
});

Deno.test("T16b a checkpoint from a DIFFERENT plan is refused", async () => {
  const { plan, state } = await setup();
  assert(stateMatchesPlan(state, plan.planHash));
  assertFalse(stateMatchesPlan(state, "some-other-plan-hash"),
    "step ids mean different things under a different ordering");
});

// ============================================================ failures =======

Deno.test("T26 a provider failure does not fail the task and permits fallback", async () => {
  const { plan, state } = await setup();
  const h = sequentialJobsInvoker({
    taskId: "t26", plan, state, costPerCall: 0.25,
    invokeJobs: async () => { throw new Error("Actor run failed with 502 server error"); },
  });
  const rows = await h.invokeJobs({}, 25);
  assertEquals(rows, [], "a failure yields an empty batch, not a thrown task");
  const rec = stepOf(state, plan.steps[0].stepId)!;
  assertEquals(rec.status, "failed");
  assertEquals(rec.failure_category, "provider_server_error");
  assertEquals(state.cumulative_cost, 0.25, "cost already incurred is preserved");

  const advanced = applyObservation(plan, state, observation(plan.steps[0].stepId, { sourceExhausted: true }));
  assertEquals(advanced.action.action, "advance_to_next_source");
});

Deno.test("T26b failure categories are safe and never echo the provider message", () => {
  assertEquals(safeFailureCategory(new Error("Request timed out after 30s")), "timeout");
  assertEquals(safeFailureCategory(new Error("429 Too Many Requests")), "rate_limited");
  assertEquals(safeFailureCategory(new Error("402 payment required: credits exhausted")), "provider_quota_exhausted");
  assertEquals(safeFailureCategory(new Error("401 Unauthorized: token abc123secret")), "provider_auth_error");
  const cat = safeFailureCategory(new Error("boom token=SECRET_VALUE_123"));
  assertFalse(cat.includes("SECRET_VALUE_123"), "a category must never carry the raw message");
});

Deno.test("T31 valid exhaustion reports the remaining quota truthfully", async () => {
  const { plan, state } = await setup();
  const last = plan.steps[plan.steps.length - 1];
  state.current_step_id = last.stepId;
  const r = applyObservation(plan, state, observation(last.stepId, {
    sourceExhausted: true, totalContactReady: 2, remainingQuota: 3,
  }));
  assertEquals(r.action.action, "stop_valid_exhaustion");
  assert(r.stopped);
  assertEquals(state.remaining_quota, 3);
  assertEquals(state.total_contact_ready, 2);
  assertEquals(state.exhaustion_reason, "all_approved_steps_exhausted");
});

// ============================================================ limits ========

Deno.test("T28 the maximum provider-call limit is enforced", async () => {
  const { plan, state } = await setup();
  state.provider_calls = plan.maximumProviderCalls;
  const d = selectExecutableStep(plan, state);
  assertFalse(d.ok);
  if (!d.ok) assertEquals(d.reason, "provider_call_limit_reached");
});

Deno.test("T30 the cost ceiling is enforced", async () => {
  const { plan, state } = await setup();
  state.cumulative_cost = plan.maximumEstimatedCostUsd;
  const d = selectExecutableStep(plan, state);
  assertFalse(d.ok);
  if (!d.ok) assertEquals(d.reason, "budget_exhausted");
});

// ======================================================= reuse guarantees ====

Deno.test("T12/T40 provider calls go through the INJECTED executor, not a new one", async () => {
  const { plan, state } = await setup();
  let received: Record<string, unknown> | null = null;
  const h = sequentialJobsInvoker({
    taskId: "t12", plan, state,
    invokeJobs: async (env, max) => { received = { ...env, max }; return [job(1)]; },
  });
  await h.invokeJobs({ workspace_id: "ws-1", carried: "through" }, 25);

  assert(received, "the injected function must be the only provider path");
  assertEquals(received!.carried, "through", "the caller's envelope is preserved");
  assertEquals(received!.workspace_id, "ws-1");
  assertEquals(received!.max, 25);
  // The compiled Actor-native input is placed where the existing path expects it.
  assert(received!.input && typeof received!.input === "object");
  assert(typeof received!.selected_actor_key === "string");
});

Deno.test("T34/T35 legacy Indeed is untouched; dynamic Indeed uses Automation Lab", async () => {
  enableProviders();
  // Legacy source_type resolution still points at Curious Coder.
  assertEquals(resolveActorForSourceType("indeed_jobs")?.actor_id, "curious_coder/indeed-scraper");
  assertEquals(resolveActorForSourceType("jobs")?.actor_id, "curious_coder/linkedin-jobs-scraper");
  // The ordered plan reaches the approved variant only through the semantic key.
  assertEquals(actorKeyForCapability("indeed_job_discovery"), "apify_indeed_jobs_automation_lab");
});

Deno.test("T32 with no ordered plan wired in, nothing in this module runs", async () => {
  // The runtime is inert without a plan: it is only ever constructed by a caller
  // that has already resolved the feature flag and validated a plan.
  const { plan, state } = await setup();
  const empty: OrderedHiringSourcePlan = { ...plan, steps: [] };
  const d = selectExecutableStep(empty, state);
  assertFalse(d.ok);
  if (!d.ok) assertEquals(d.reason, "no_plan_steps");
});

Deno.test("T2b the runtime state is a SLICE of the existing checkpoint, not a new store", () => {
  assertEquals(SOURCING_STATE_KEY, "company_first_state");
  assertEquals(SOURCE_EXECUTION_KEY, "source_execution");
  // Nesting one inside the other is what keeps continuation single-sourced.
  const container: Record<string, unknown> = { [SOURCING_STATE_KEY]: { [SOURCE_EXECUTION_KEY]: { version: "x" } } };
  const inner = (container[SOURCING_STATE_KEY] as Record<string, unknown>)[SOURCE_EXECUTION_KEY];
  assertEquals((inner as Record<string, unknown>).version, "x");
});

// =========================================================== diagnostics =====

Deno.test("T20b diagnostics carry the funnel and expose no secrets or raw input", async () => {
  const { plan, state } = await setup();
  const h = sequentialJobsInvoker({
    taskId: "t20b", plan, state, costPerCall: 0.4,
    invokeJobs: async () => [job(1), job(2)],
  });
  await h.invokeJobs({ apify_token: "SECRET_TOKEN_VALUE" }, 25);
  const d = sourceExecutionDiagnostics(plan, state, h.lastOutcome());

  assertEquals(d.ordered_plan_hash, plan.planHash);
  assertEquals(d.active_step_id, plan.steps[0].stepId);
  assertEquals(d.provider_calls, 1);
  assertEquals(d.cumulative_cost, 0.4);
  assertEquals(d.completion_target, 5);
  assertEquals(d.deduplicated_jobs, 2);

  const blob = JSON.stringify(d);
  for (const marker of [
    "SECRET_TOKEN_VALUE", "apify_token", "automation-lab/", "crawlworks/",
    "parsebird/", "valig/", "bovi/", "authorization", "Bearer",
  ]) assertFalse(blob.includes(marker), `diagnostics leaked ${marker}`);
  // Input hashes are truncated, never full, and raw input is absent entirely.
  for (const s of d.steps as Array<Record<string, unknown>>) {
    for (const hsh of s.input_hashes as string[]) assert(hsh.length <= 12);
  }
  assertFalse(blob.includes("\"input\""), "raw Actor input must never reach diagnostics");
});

Deno.test("T33 no Actor executes during these tests", async () => {
  // Every test supplies its own fake. The module has no provider import at all.
  const src = await Deno.readTextFile(new URL("sequentialSourceRuntime.ts", import.meta.url));
  for (const forbidden of ["apify.com", "fetch(", "APIFY_TOKEN", "firecrawl"]) {
    assertFalse(src.includes(forbidden), `the runtime reaches a provider directly via ${forbidden}`);
  }
});

// ======================================================= step bookkeeping ====

Deno.test("T22-T25 quota bookkeeping is CONTACT-ready only", async () => {
  const { plan, state } = await setup();
  // A source with plenty of raw volume but no contactable people is NOT success.
  applyObservation(plan, state, observation(plan.steps[0].stepId, {
    funnel: { ...observation("x").funnel, rawResults: 400, normalizedJobs: 380, contactReady: 0 },
    incrementalContactReady: 0, totalContactReady: 0, remainingQuota: 5,
  }));
  assertEquals(state.total_contact_ready, 0, "raw volume never counts toward quota");
  assertEquals(state.remaining_quota, 5);
  assertEquals(state.early_stop_reason, null, "a high-volume, zero-contact source must not stop the run");
});

Deno.test("T27 a finished step is never re-run", async () => {
  const { plan, state } = await setup();
  const rec = stepOf(state, plan.steps[0].stepId)!;
  for (const status of ["completed", "exhausted", "failed", "inactive_quota_met"] as const) {
    rec.status = status;
    assert(isStepFinished(rec));
    state.current_step_id = plan.steps[0].stepId;
    const d = selectExecutableStep(plan, state);
    assertFalse(d.ok, `${status} must not be executable`);
    if (!d.ok) assertEquals(d.reason, "step_already_finished");
  }
});

Deno.test("T20c company identity accepts both field spellings and keeps the STRONGEST rung", () => {
  // `resolveCompanyIdentity` takes snake_case. Passing camelCase silently drops
  // the field and degrades every company to the weakest name+location rung — a
  // failure that still returns a key, so nothing looks wrong at the call site.
  const snake = companyDedupeKeyFor({ name: "Acme", website_url: "https://acme.com" });
  const camel = companyDedupeKeyFor({ name: "Acme", website: "https://acme.com" });
  assertEquals(snake.identity.dedupeKeyKind, "domain");
  assertEquals(camel.identity.dedupeKeyKind, "domain", "camelCase must not silently degrade the key");
  assertEquals(snake.key, camel.key);

  const liSnake = companyDedupeKeyFor({ name: "Acme", linkedin_url: "https://www.linkedin.com/company/acme/" });
  const liCamel = companyDedupeKeyFor({ name: "Acme", linkedinUrl: "https://www.linkedin.com/company/acme/" });
  assertEquals(liSnake.key, liCamel.key);
  assert(liSnake.identity.dedupeKeyKind !== "name_location", "a LinkedIn identity must beat name+location");
});

// ================================================================ bridge =====

Deno.test("T32b DISABLED returns the caller's OWN function, not an equivalent one", async () => {
  const { applySequentialSourceExecution, sequentialSourceDiagnostics } =
    await import("./sequentialSourceBridge.ts");
  const original: (e: Record<string, unknown>, m: number) => Promise<unknown[]> = async () => [job(1)];
  const r = await applySequentialSourceExecution({
    workspaceId: "ws-1", taskId: "t", invokeJobs: original,
    profile: profile(), readEnv: () => undefined,
  });
  assertEquals(r.invokeJobs, original, "the disabled path must not even wrap the function");
  assertFalse(r.enabled);
  assertEquals(r.reason, "flag_off");
  assertEquals(r.plan, null);
  assertEquals(sequentialSourceDiagnostics(r).sequential_source_execution, false);
});

Deno.test("T32c the flag ALONE cannot enable it — an allow-list is required", async () => {
  const { applySequentialSourceExecution } = await import("./sequentialSourceBridge.ts");
  const original: (e: Record<string, unknown>, m: number) => Promise<unknown[]> = async () => [];
  const r = await applySequentialSourceExecution({
    workspaceId: "ws-1", taskId: "t", invokeJobs: original, profile: profile(),
    readEnv: (k) => (k === "DYNAMIC_HIRING_SOURCE_PLANNING" ? "true" : undefined),
  });
  assertEquals(r.invokeJobs, original);
  assertEquals(r.reason, "no_workspace_allowlist");
});

Deno.test("T32d ENABLED for an allow-listed workspace wraps and runs step one only", async () => {
  enableProviders();
  const { applySequentialSourceExecution, sequentialSourceDiagnostics } =
    await import("./sequentialSourceBridge.ts");
  const seen: string[] = [];
  const r = await applySequentialSourceExecution({
    workspaceId: "ws-test", taskId: "t-seq",
    invokeJobs: async (env) => { seen.push(String(env.selected_actor_key)); return [job(1)]; },
    profile: profile(),
    readEnv: (k) =>
      k === "DYNAMIC_HIRING_SOURCE_PLANNING" ? "true"
      : k === "DYNAMIC_HIRING_SOURCE_PLANNING_WORKSPACES" ? "ws-test"
      : undefined,
  });
  assert(r.enabled);
  await r.invokeJobs({}, 25);
  assertEquals(seen.length, 1, "only the initial step may run");
  assertEquals(seen[0], actorKeyForCapability(r.plan!.steps[0].capability));
  const d = sequentialSourceDiagnostics(r);
  assertEquals(d.sequential_source_execution, true);
  assertEquals(d.provider_calls, 1);
});

Deno.test("T27b a mission with a capability gap stays on the deterministic path", async () => {
  const { applySequentialSourceExecution } = await import("./sequentialSourceBridge.ts");
  const original: (e: Record<string, unknown>, m: number) => Promise<unknown[]> = async () => [];
  const r = await applySequentialSourceExecution({
    workspaceId: "ws-test", taskId: "t", invokeJobs: original,
    profile: profile({ hiring: { required: false } }),
    readEnv: (k) =>
      k === "DYNAMIC_HIRING_SOURCE_PLANNING" ? "true"
      : k === "DYNAMIC_HIRING_SOURCE_PLANNING_WORKSPACES" ? "ws-test"
      : undefined,
  });
  assertEquals(r.invokeJobs, original);
  assert(r.reason.startsWith("capability_gap"));
});
