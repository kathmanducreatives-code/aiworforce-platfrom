// THE SOURCE-OBSERVATION LOOP, WIRED.
//
// Before PR #112 both `applyObservation` and `sourceFeedbackRuntime` were
// implemented, tested and unreachable from production: nothing ever built a
// `SourceStepObservation`, so `current_step_id` was set on the first provider call
// and never advanced. These tests cover the loop that closes that gap, and guard
// the call graph so it cannot silently come apart again.
//
// OFFLINE ONLY. No Apify Actor is executed, no Firecrawl call is made, no live
// model call occurs, no database is touched. The provider function and the model
// are injected in every test.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applySequentialSourceExecution, buildObservation, sequentialSourceDiagnostics,
} from "./sequentialSourceBridge.ts";
import {
  runCompanyFirstQuotaController,
  type RoundObservationInput,
} from "./companyFirstQuotaController.ts";
import { SOURCE_EXECUTION_KEY, stepOf } from "./sourceExecutionState.ts";
import { FUSION_STATE_KEY, newFusionState, type HiringEvidenceFusionState } from "./hiringEvidenceFusion.ts";
import {
  MAX_SOURCE_FEEDBACK_CALLS_PER_TASK, SOURCE_FEEDBACK_KEY, SOURCE_FEEDBACK_VERSION,
  type SourceFeedbackLedger,
} from "./sourceFeedbackContract.ts";
import { emptyFunnelSummary, type FunnelSummary } from "./sourcingBottleneck.ts";
import { compileLeadEntityIntent } from "./leadEntityIntent.ts";
import type { LeadMissionSourceProfile } from "./hiringSourcePlan.ts";
import type { EnvReader } from "./intelligence/intelligenceFlags.ts";
import type { GenerateOpts, GenerateResult } from "./aiProvider.ts";
import { isContinuable, projectStatus } from "./taskStatusContract.ts";

// ================================================================ fixtures ===

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

/** Sourcing ON for ws-1; feedback OFF unless a test opts in. */
const sourcingOnly: EnvReader = (k) =>
  k === "DYNAMIC_HIRING_SOURCE_PLANNING" ? "true"
    : k === "DYNAMIC_HIRING_SOURCE_PLANNING_WORKSPACES" ? "ws-1"
    : undefined;

/** Sourcing AND bounded feedback ON for ws-1, with a stand-in (non-)credential. */
const feedbackOn: EnvReader = (k) =>
  k === "CLAUDE_SOURCE_FEEDBACK" ? "true"
    : k === "CLAUDE_SOURCE_FEEDBACK_WORKSPACES" ? "ws-1"
    : k === "ANTHROPIC_API_KEY" ? "x"
    : sourcingOnly(k);

const allOff: EnvReader = () => undefined;

const funnel = (o: Partial<Record<string, number>> = {}): FunnelSummary => ({
  ...emptyFunnelSummary(),
  raw_jobs: 40, unique_jobs: 30, companies_qualified: 8, companies_rejected: 12,
  companies_missing_identity: 2, people_calls: 8, profiles_returned: 10,
  person_role_pass: 6, employer_verified: 5, contact: 2, watch: 1, reject: 3,
  ...o,
} as FunnelSummary);

const round = (o: Partial<RoundObservationInput> = {}): RoundObservationInput => ({
  round: 1,
  funnel: funnel(),
  rawRows: 40, newUniqueJobs: 30, newUniqueCompanies: 12, newEligibleLeads: 2,
  totalEligibleLeads: 2, remainingQuota: 3, remainingBudgetUsd: 4,
  providerCalls: 1, duplicatesRemoved: 0, sourceExhausted: false,
  ...o,
});

interface Mock { fn: (o: GenerateOpts) => Promise<GenerateResult>; calls: GenerateOpts[] }

function mockModel(strategy: unknown): Mock {
  const calls: GenerateOpts[] = [];
  return {
    calls,
    fn: (opts) => {
      calls.push(opts);
      return Promise.resolve({
        ok: true, content: JSON.stringify({ strategy }), json: { strategy },
        provider: "anthropic" as const, model: "claude-test", latencyMs: 4,
      });
    },
  };
}

/** A model that must never be reached. Fails the test loudly if it is. */
function forbiddenModel(): Mock {
  const calls: GenerateOpts[] = [];
  return {
    calls,
    fn: (opts) => {
      calls.push(opts);
      throw new Error("the model must not be called on this path");
    },
  };
}

function feedbackResponse(recommendation: unknown, o: Record<string, unknown> = {}) {
  return {
    version: SOURCE_FEEDBACK_VERSION,
    recommendation,
    reasonCode: "low_source_volume",
    conciseReason: "Unique company yield is low.",
    expectedEffect: { expectedToImprove: "unique_company_yield", confidence: "medium" },
    constraintsPreserved: true,
    ...o,
  };
}

async function bridge(o: Parameters<typeof applySequentialSourceExecution>[0] extends infer T ? Partial<T> : never = {}) {
  enableProviders();
  return await applySequentialSourceExecution({
    workspaceId: "ws-1", taskId: "task-1",
    invokeJobs: () => Promise.resolve([]),
    profile: profile(),
    readEnv: sourcingOnly,
    companyBrainPolicyHash: "policy-hash-1",
    ...o,
  } as Parameters<typeof applySequentialSourceExecution>[0]);
}

// ======================================================= the call graph ======

Deno.test("1./2. both authorities have a real non-test production caller", async () => {
  const bridgeSrc = await Deno.readTextFile(new URL("./sequentialSourceBridge.ts", import.meta.url));
  const runAgentSrc = await Deno.readTextFile(new URL("../run-agent/index.ts", import.meta.url));

  // The bridge reaches the feedback runtime, which is the only caller of
  // `applyObservation` outside tests.
  assert(bridgeSrc.includes('from "./sourceFeedbackRuntime.ts"'),
    "the bridge must import the feedback runtime");
  assert(bridgeSrc.includes("applyObservationWithFeedback("),
    "the bridge must call the composite observation entry point");

  const runtimeSrc = await Deno.readTextFile(new URL("./sourceFeedbackRuntime.ts", import.meta.url));
  assert(runtimeSrc.includes("applyObservation("), "the feedback runtime must call applyObservation");

  // run-agent reaches the bridge's observation hook through the controller.
  assert(runAgentSrc.includes("onRoundComplete: sequentialSources.onObservation"),
    "run-agent must pass the observation hook to the controller");

  const controllerSrc = await Deno.readTextFile(new URL("./companyFirstQuotaController.ts", import.meta.url));
  assert(controllerSrc.includes("deps.onRoundComplete("), "the controller must invoke the hook");
});

// ===================================================== the observation =======

Deno.test("3. a completed source attempt produces ONE observation", async () => {
  const b = await bridge();
  assert(b.enabled);
  const slices = await b.onObservation(round());
  assert(slices && slices.checkpointSlices, "the hook must return slices to checkpoint");
  // Exactly one checkpoint's worth of state moved.
  assertEquals(b.state?.total_contact_ready, 2);
  assertEquals(b.state?.remaining_quota, 3);
});

Deno.test("6./7. the observation carries the FULL funnel, not raw rows", () => {
  const fusion: HiringEvidenceFusionState = newFusionState();
  for (const [key, decision, strong] of [
    ["domain:a.com", "timing_sufficient", true],
    ["domain:b.com", "missing_timing_evidence", false],
    ["domain:c.com", "timing_sufficient", true],
  ] as const) {
    fusion.companies[key] = {
      companyKey: key, signalDedupeKeys: [], evidenceSourceTypes: [], evidenceHash: key,
      latestTimingDecision: decision, peopleSearchCompleted: false, strongIdentity: strong, conflicts: [],
    };
  }

  const obs = buildObservation({
    round: round({ rawRows: 400, newUniqueCompanies: 90 }),
    stepId: "s1-yc_job_discovery", step: "yc_job_discovery",
    record: { attempts: 2, broadening_used: ["increase_result_target"] },
    fusion,
  });

  assertEquals(obs.funnel.rawResults, 400);
  // FUSED companies win over the round's own count: 400 raw rows collapsing into
  // three canonical companies is not ninety findings.
  assertEquals(obs.funnel.uniqueCompanies, 3);
  assertEquals(obs.funnel.strongIdentity, 2);
  assertEquals(obs.funnel.evidencePending, 1);
  assertEquals(obs.funnel.companyBrainPass, 8);
  assertEquals(obs.funnel.companyBrainFail, 12);
  assertEquals(obs.funnel.employerVerified, 5);
  assertEquals(obs.funnel.contactReady, 2);
  assertEquals(obs.rejectionSummary.missingIdentity, 2);
  assertEquals(obs.rejectionSummary.missingDecisionMaker, 4);
  assertEquals(obs.attempt, 2);
  assertEquals(obs.broadeningActionsUsed, ["increase_result_target"]);
});

Deno.test("27./28. only CONTACT-ready people count toward the quota", () => {
  // 400 jobs, 90 companies, 60 signals — and one contactable founder.
  const obs = buildObservation({
    round: round({
      rawRows: 400, newUniqueJobs: 380, newUniqueCompanies: 90,
      newEligibleLeads: 1, totalEligibleLeads: 1, remainingQuota: 4,
      funnel: funnel({ companies_qualified: 60, contact: 1 }),
    }),
    stepId: "s1", step: "yc_job_discovery",
    record: { attempts: 1, broadening_used: [] },
    fusion: null,
  });
  assertEquals(obs.incrementalContactReady, 1);
  assertEquals(obs.totalContactReady, 1);
  assertEquals(obs.remainingQuota, 4);
});

// ================================================= state transitions =========

Deno.test("5. a low-yield round broadens the current source", async () => {
  const b = await bridge();
  const first = b.plan!.steps[0];
  await b.onObservation(round({ newEligibleLeads: 1, totalEligibleLeads: 1, remainingQuota: 4 }));

  assertEquals(b.state?.pending_next_action, "broaden_current_source");
  assertEquals(b.state?.current_step_id, first.stepId, "broadening PINS the current step");
  assert((stepOf(b.state!, first.stepId)?.broadening_used.length ?? 0) > 0);
});

Deno.test("6.B an exhausted source advances to its valid successor", async () => {
  const b = await bridge();
  const [first, second] = b.plan!.steps;
  await b.onObservation(round({ sourceExhausted: true }));

  assertEquals(b.state?.pending_next_action, "advance_to_next_source");
  assertEquals(b.state?.current_step_id, second.stepId);
  assertEquals(b.state?.current_attempt, 0);
  assertEquals(stepOf(b.state!, first.stepId)?.status, "exhausted");
});

Deno.test("7.B quota completion stops every later source", async () => {
  const b = await bridge();
  await b.onObservation(round({ newEligibleLeads: 5, totalEligibleLeads: 5, remainingQuota: 0 }));

  assertEquals(b.state?.pending_next_action, "stop_quota_reached");
  assertEquals(b.state?.early_stop_reason, "contact_ready_quota_met");
  assertEquals(b.state?.current_step_id, null);
  for (const s of b.state!.steps.slice(1)) {
    assertEquals(s.status, "inactive_quota_met", `${s.step_id} stayed live after the quota was met`);
  }
});

Deno.test("8./10. execution no longer stalls on source 1", async () => {
  // THE DEFECT, reproduced end to end. Without the loop, round 2 recompiles the
  // identical input, the duplicate guard rejects it, and the batch is empty
  // forever. With the loop, round 2 runs a different step.
  const actors: string[] = [];
  const b = await bridge({
    invokeJobs: (env: Record<string, unknown>) => {
      actors.push(String(env.selected_actor_key));
      return Promise.resolve([{ id: `j${actors.length}`, company: `Co ${actors.length}`, title: "Revenue Operations" }]);
    },
  });

  await b.invokeJobs({}, 25);
  assertEquals(actors.length, 1);
  const firstActor = actors[0];

  // The round completes and the source is exhausted, so the plan advances.
  await b.onObservation(round({ sourceExhausted: true }));

  await b.invokeJobs({}, 25);
  assertEquals(actors.length, 2, "the second round produced no provider call at all");
  assert(actors[1] !== firstActor, "the second round repeated the first source");
});

Deno.test("9. an identical input is never compiled or paid for twice", async () => {
  const inputs: string[] = [];
  const b = await bridge({
    invokeJobs: (env: Record<string, unknown>) => {
      inputs.push(JSON.stringify(env.input));
      return Promise.resolve([]);
    },
  });

  await b.invokeJobs({}, 25);
  // No observation between the calls, so nothing advanced: the second attempt must
  // be refused rather than re-sent.
  await b.invokeJobs({}, 25);
  assertEquals(inputs.length, 1, "the same compiled input was sent twice");
  assertEquals(b.lastOutcome()?.reason, "duplicate_input:" + b.lastOutcome()?.reason?.split(":")[1]);
});

Deno.test("24./25. finished steps and no-op broadening stay unavailable", async () => {
  const b = await bridge();
  const [first, second] = b.plan!.steps;

  // Exhaust the first step, then the second.
  await b.onObservation(round({ sourceExhausted: true }));
  assertEquals(b.state?.current_step_id, second.stepId);
  await b.onObservation(round({ round: 2, sourceExhausted: true }));

  // Neither finished step can be current again.
  assert(b.state?.current_step_id !== first.stepId);
  assert(b.state?.current_step_id !== second.stepId);

  // And every rung still offered on the new step genuinely changes the call —
  // PR #111's filter is applied at plan construction, so no-ops never appear.
  const current = b.plan!.steps.find((s) => s.stepId === b.state?.current_step_id);
  if (current) {
    for (const rung of current.broadeningLadder) {
      assert(["add_approved_role_aliases", "increase_result_target", "extend_recency_window",
        "include_supported_remote_variants"].includes(rung.action), rung.action);
    }
  }
});

// ==================================================== bounded feedback =======

Deno.test("14. feature OFF produces no feedback call", async () => {
  const m = forbiddenModel();
  const b = await bridge({ readEnv: sourcingOnly, generate: m.fn });
  await b.onObservation(round());
  assertEquals(m.calls.length, 0);
  assertEquals(b.feedback?.callsUsed, 0);
  assertEquals(b.lastFeedback()?.skippedReason, "flag_off");
  // The round still advanced deterministically.
  assert(b.state?.pending_next_action);
});

Deno.test("15. a non-allow-listed workspace produces no feedback call", async () => {
  const m = forbiddenModel();
  const b = await bridge({ workspaceId: "ws-99", readEnv: () => undefined, generate: m.fn });
  // Sourcing itself is off for ws-99, so the bridge is inert.
  assertFalse(b.enabled);
  await b.onObservation(round());
  assertEquals(m.calls.length, 0);
});

Deno.test("16. one mandatory deterministic action skips feedback", async () => {
  const m = forbiddenModel();
  const b = await bridge({ readEnv: feedbackOn, generate: m.fn });
  // Quota met: nothing to choose between.
  await b.onObservation(round({ newEligibleLeads: 5, totalEligibleLeads: 5, remainingQuota: 0 }));
  assertEquals(m.calls.length, 0);
  assertEquals(b.lastFeedback()?.skippedReason, "mandatory:quota_reached");
  assertEquals(b.state?.pending_next_action, "stop_quota_reached");
});

Deno.test("11./12./13./17./18./20. two safe choices invoke feedback, once, with everything it needs", async () => {
  const b = await bridge({ readEnv: feedbackOn });
  const [first, second] = b.plan!.steps;
  const m = mockModel(feedbackResponse({
    action: "advance_to_next_source", currentStepId: first.stepId, nextStepId: second.stepId,
  }));
  const wired = await bridge({ readEnv: feedbackOn, generate: m.fn });
  const [w1, w2] = wired.plan!.steps;

  await wired.onObservation(round());

  // 18. exactly one HTTP request.
  assertEquals(m.calls.length, 1);
  assertEquals(wired.feedback?.callsUsed, 1);
  assertEquals(wired.lastFeedback()?.diagnostics?.model_requests, 1);

  // 13. the prompt carries the required context — hashes, never raw identifiers.
  const prompt = String(m.calls[0].messages[0].content);
  assert(prompt.includes("policy-hash-1"), "the Company Brain policy hash must reach the request");
  assert(prompt.includes(wired.plan!.planHash), "the source-plan hash must reach the request");
  assertFalse(prompt.includes("task-1"), "the raw task id must NOT reach the prompt");
  assertFalse(prompt.includes("ws-1"), "the raw workspace id must NOT reach the prompt");

  // 12. fused yield, not raw volume.
  assert(prompt.includes("canonicalCompanies"));
  assert(prompt.includes("uniqueSignals"));

  // 20. the accepted action is what was folded in.
  assertEquals(wired.lastFeedback()?.source, "claude");
  assertEquals(wired.state?.pending_next_action, "advance_to_next_source");
  assertEquals(wired.state?.current_step_id, w2.stepId);
  assert(w1.stepId !== w2.stepId);
  assertEquals(b.enabled, true);
});

Deno.test("19. an invalid recommendation falls back deterministically", async () => {
  const m = mockModel(feedbackResponse({ action: "advance_to_next_source", currentStepId: "s9", nextStepId: "s8" }));
  const b = await bridge({ readEnv: feedbackOn, generate: m.fn });
  await b.onObservation(round());

  assertEquals(m.calls.length, 1, "a rejected recommendation must not be re-asked");
  assertEquals(b.lastFeedback()?.source, "deterministic");
  assertEquals(b.lastFeedback()?.feedback?.status, "rejected_by_validator");
  // The run still moved, using the deterministic answer.
  assert(b.state?.pending_next_action);
});

// ================================================== persistence + resume =====

Deno.test("21. the feedback ledger and every slice are returned for checkpoint", async () => {
  const m = mockModel(feedbackResponse({ action: "advance_to_next_source", currentStepId: "x", nextStepId: "y" }));
  const b = await bridge({ readEnv: feedbackOn, generate: m.fn });
  const outcome = await b.onObservation(round());

  const slices = (outcome as { checkpointSlices: Record<string, unknown> }).checkpointSlices;
  assertEquals(Object.keys(slices).sort(), [FUSION_STATE_KEY, SOURCE_EXECUTION_KEY, SOURCE_FEEDBACK_KEY].sort());
  const ledger = slices[SOURCE_FEEDBACK_KEY] as SourceFeedbackLedger;
  assertEquals(ledger.callsUsed, 1);
  assertEquals(ledger.checkpoints.length, 1);
  assert(ledger.checkpoints[0].requestKey.length > 0);
});

Deno.test("22./23. continuation repeats neither the feedback request nor the provider input", async () => {
  const m = mockModel(feedbackResponse({ action: "advance_to_next_source", currentStepId: "x", nextStepId: "y" }));
  const first = await bridge({ readEnv: feedbackOn, generate: m.fn });
  // The state as it stood BEFORE the fold. The ledger records its checkpoint
  // before `applyObservation` runs, so an isolate killed in between leaves exactly
  // this pairing: a ledger that already paid for the answer and a state that has
  // not yet moved. That is the case where a naive resume would pay twice.
  const preFoldState = JSON.parse(JSON.stringify(first.state));

  const outcome = await first.onObservation(round());
  const slices = (outcome as { checkpointSlices: Record<string, unknown> }).checkpointSlices;

  // A fresh isolate restores the slices from the checkpoint.
  const resumed = await bridge({
    readEnv: feedbackOn, generate: m.fn,
    restoredState: JSON.parse(JSON.stringify(slices[SOURCE_EXECUTION_KEY])),
    restoredFusion: JSON.parse(JSON.stringify(slices[FUSION_STATE_KEY])),
    restoredFeedback: JSON.parse(JSON.stringify(slices[SOURCE_FEEDBACK_KEY])),
  });

  // It did NOT restart from step 1, and the charge survived.
  assertEquals(resumed.state?.current_step_id, first.state?.current_step_id);
  assertEquals(resumed.feedback?.callsUsed, 1);

  // The kill-in-between case: same observation, same key, no second request.
  const killed = await bridge({
    readEnv: feedbackOn, generate: m.fn,
    restoredState: preFoldState,
    restoredFeedback: JSON.parse(JSON.stringify(slices[SOURCE_FEEDBACK_KEY])),
  });
  await killed.onObservation(round());
  assertEquals(m.calls.length, 1, "the resumed task re-asked the same observation");
  assertEquals(killed.lastFeedback()?.skippedReason, "continuation_reuse");
  // The action REPLAYED is the one the ledger recorded, not a fresh decision.
  // (Here that is the deterministic fallback: the mock names step ids the plan
  // does not contain, so the validator refuses it — which is the point.)
  const recorded = (slices[SOURCE_FEEDBACK_KEY] as SourceFeedbackLedger).checkpoints[0];
  assertEquals(recorded.status, "rejected_by_validator");
  assertEquals(killed.state?.pending_next_action, recorded.acceptedAction?.action,
    "the recorded action must be replayed rather than re-decided");

  // And a provider input that was actually PAID FOR is not re-sent. This needs a
  // real call first — the flow above only observed, so nothing had been bought.
  const paidInputs: string[] = [];
  const paid = await bridge({
    readEnv: feedbackOn, generate: m.fn,
    invokeJobs: (env: Record<string, unknown>) => { paidInputs.push(JSON.stringify(env.input)); return Promise.resolve([]); },
  });
  await paid.invokeJobs({}, 25);
  assertEquals(paidInputs.length, 1);

  const replayed = await bridge({
    readEnv: feedbackOn, generate: m.fn,
    restoredState: JSON.parse(JSON.stringify(paid.state)),
    invokeJobs: (env: Record<string, unknown>) => { paidInputs.push(JSON.stringify(env.input)); return Promise.resolve([]); },
  });
  await replayed.invokeJobs({}, 25);
  assertEquals(paidInputs.length, 1, "a resumed run re-sent a provider input it had already paid for");
  assertEquals(replayed.lastOutcome()?.ran, false);
});

// ============================================== controller integration =======

/** The REAL compiled intent, so the controller runs its own constraint builder. */
const controllerIntent = compileLeadEntityIntent("Find companies hiring software engineers");

Deno.test("4. applyObservation runs EXACTLY once per completed round", async () => {
  const b = await bridge({ readEnv: feedbackOn, generate: mockModel(feedbackResponse({ action: "advance_to_next_source", currentStepId: "x", nextStepId: "y" })).fn });
  const before = b.state!.steps.map((s) => ({ ...s }));
  await b.onObservation(round({ sourceExhausted: true }));
  const afterOne = JSON.parse(JSON.stringify(b.state));

  // A second call with the SAME round would be a second fold. The loop calls the
  // hook once per round, and the state after one call is what the next round reads.
  assertEquals(afterOne.completed_step_ids.length + afterOne.exhausted_step_ids.length, 1);
  assert(before[0].status !== afterOne.steps[0].status);
});

Deno.test("29. the controller calls the hook once per round and stores its slices", async () => {
  const seen: number[] = [];
  const saved: Array<Record<string, unknown>> = [];

  // A minimal controller run: the jobs actor returns nothing, so no provider work
  // happens, but the round still completes and the hook must fire.
  await runCompanyFirstQuotaController(
    controllerIntent,
    {
      invokeJobs: () => Promise.resolve([]),
      invokePeople: () => Promise.resolve([]),
      persist: () => Promise.resolve({ ok: true, accountId: null, leadCandidateId: null }),
      onRoundComplete: (input: RoundObservationInput) => {
        seen.push(input.round);
        return Promise.resolve({ checkpointSlices: { probe: { round: input.round } } });
      },
      stateStore: {
        load: () => Promise.resolve(null),
        save: (_id: string, state: { slices?: Record<string, unknown> }) => {
          saved.push({ ...(state.slices ?? {}) });
          return Promise.resolve();
        },
      },
    } as never,
    { requestedLeadCount: 5, workspaceId: "ws-1", taskId: "task-1", bounds: { maxRounds: 1 } },
  );

  assertEquals(seen, [1], "the hook must fire exactly once for one round");
  assert(saved.length > 0, "the checkpoint must be written after the hook");
  assertEquals(saved[0].probe, { round: 1 }, "the hook's slices must reach the checkpoint");
});

Deno.test("26./29.B omitting the hook leaves the controller's behaviour unchanged", async () => {
  const run = (hook?: unknown) => runCompanyFirstQuotaController(
    controllerIntent,
    {
      invokeJobs: () => Promise.resolve([]),
      invokePeople: () => Promise.resolve([]),
      persist: () => Promise.resolve({ ok: true, accountId: null, leadCandidateId: null }),
      ...(hook ? { onRoundComplete: hook } : {}),
    } as never,
    { requestedLeadCount: 5, workspaceId: "ws-1", taskId: "task-1", bounds: { maxRounds: 1 } },
  );

  const without = await run();
  const with_ = await run(() => Promise.resolve());
  // The quota contract, terminal status and round accounting are identical.
  assertEquals(without.terminal_status, with_.terminal_status);
  assertEquals(without.eligible_leads, with_.eligible_leads);
  assertEquals(without.rounds_attempted, with_.rounds_attempted);
  assertEquals(without.provider_calls, with_.provider_calls);
});

Deno.test("29.C a throwing hook never costs the round its real work", async () => {
  const res = await runCompanyFirstQuotaController(
    controllerIntent,
    {
      invokeJobs: () => Promise.resolve([]),
      invokePeople: () => Promise.resolve([]),
      persist: () => Promise.resolve({ ok: true, accountId: null, leadCandidateId: null }),
      onRoundComplete: () => { throw new Error("observer exploded"); },
    } as never,
    { requestedLeadCount: 5, workspaceId: "ws-1", taskId: "task-1", bounds: { maxRounds: 1 } },
  );
  assert(res.terminal_status, "the run must still reach a terminal status");
  assertEquals(res.rounds_attempted, 1);
});

// ==================================================== diagnostics + safety ===

Deno.test("21.B diagnostics report the loop without leaking anything", async () => {
  const m = mockModel(feedbackResponse({ action: "advance_to_next_source", currentStepId: "x", nextStepId: "y" }));
  const b = await bridge({ readEnv: feedbackOn, generate: m.fn });
  await b.onObservation(round());

  const d = sequentialSourceDiagnostics(b) as Record<string, unknown>;
  const blob = JSON.stringify(d).toLowerCase();
  for (const forbidden of ["anthropic_api_key", "bearer", "<mission>", "retrieved_evidence", "concisereason", "http://", "https://"]) {
    assertFalse(blob.includes(forbidden), `"${forbidden}" leaked into diagnostics`);
  }
  assertEquals(d.sequential_source_execution, true);
  const fb = d.source_feedback as Record<string, unknown>;
  assertEquals(fb.calls_used, 1);
  assertEquals(fb.calls_remaining, MAX_SOURCE_FEEDBACK_CALLS_PER_TASK - 1);
  assertEquals((fb.history as unknown[]).length, 1);

  // DISABLED IS NOW FULLY REPORTED, not merely flagged.
  //
  // This previously asserted `{ sequential_source_execution: false,
  // enablement_reason }` and nothing else. That minimal shape is what made
  // production run c34c0cad unauditable — the runtime was inert and the task
  // result could not say whether the flag was off, the workspace unlisted, or a
  // plan built and rejected. The contract is deliberately wider now.
  const off = await bridge({ readEnv: allOff });
  const offD = sequentialSourceDiagnostics(off) as Record<string, unknown>;
  assertEquals(offD.sequential_source_execution, false);
  assertEquals(offD.enabled, false);
  assertEquals(offD.enablement_reason, "flag_off");
  assertEquals(offD.reason, "flag_off");
  assertEquals(offD.workspace_match, false);
  assertEquals(offD.ordered_plan_created, false);
  assertEquals(offD.capabilities_requested, []);
  assertEquals(offD.capabilities_accepted, []);
  assertEquals(offD.step_rejections, []);
  assertEquals(offD.current_step, null);
  assertEquals(offD.completed_steps, []);
  assertEquals(offD.observation_count, 0);
  assertEquals(offD.feedback_eligible, false);

  // The disabled payload is metadata only — same leak bar as the enabled one.
  const offBlob = JSON.stringify(offD).toLowerCase();
  for (const forbidden of ["anthropic_api_key", "bearer", "apify_api_token", "http://", "https://"]) {
    assertFalse(offBlob.includes(forbidden), `"${forbidden}" leaked into disabled diagnostics`);
  }
});

Deno.test("30. no live provider or model call is reachable from this path", async () => {
  const originalFetch = globalThis.fetch;
  let attempted = 0;
  globalThis.fetch = ((..._a: unknown[]) => {
    attempted += 1;
    return Promise.reject(new Error("no network is permitted in this test"));
  }) as typeof fetch;
  try {
    // Feedback ON but no credential: the runtime refuses before any network path.
    const noCredential: EnvReader = (k) =>
      k === "ANTHROPIC_API_KEY" || k === "LOVABLE_API_KEY" ? undefined : feedbackOn(k);
    const b = await bridge({ readEnv: noCredential });
    await b.onObservation(round());
    assertEquals(b.lastFeedback()?.skippedReason, "model_gateway_unavailable");
    assertEquals(b.feedback?.callsUsed, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(attempted, 0, "something on this path tried to reach the network");
});

// =========================================== THE ERROR BOUNDARY ==============
//
// The observer owns source progression — broadening, advancement, quota stopping,
// exhaustion, ledger and accepted-action persistence. A swallowed failure there is
// not a missing log line: it leaves the run pointed at a source it already
// exhausted, where duplicate-input protection returns empty batches while the
// diagnostics claim everything is fine.
//
// Two categories, deliberately different. A MODEL failure resolves to the
// deterministic action and the round continues. A CONTROL-PLANE failure stops the
// task visibly.

/** A bridge whose fold is forced to throw, without touching production code. */
async function brokenFold(phase: "observation" | "state") {
  const b = await bridge({ readEnv: feedbackOn });
  if (phase === "observation") {
    // No resolvable step: the plan is running and we cannot say where.
    b.state!.current_step_id = "s99-not-in-this-plan";
    b.state!.steps.length = 0;
  } else {
    // A step record the fold cannot use.
    b.state!.steps[0].step_id = "renamed-out-from-under-the-plan";
    b.state!.current_step_id = null;
  }
  return b;
}

Deno.test("1./2. model failures fall back deterministically and the round continues", async () => {
  for (const [label, gen] of [
    ["unavailable", () => Promise.resolve({ ok: false, content: "", provider: "none" as const, model: "", error: "x", errorCode: "provider_exception", latencyMs: 1 })],
    ["timeout", () => Promise.resolve({ ok: false, content: "", provider: "none" as const, model: "", error: "t", errorCode: "timeout", latencyMs: 1 })],
    ["invalid output", () => Promise.resolve({ ok: true, content: "", json: "not an object", provider: "anthropic" as const, model: "m", latencyMs: 1 })],
  ] as const) {
    const b = await bridge({ readEnv: feedbackOn, generate: gen as never });
    const outcome = await b.onObservation(round());

    assertEquals((outcome as { halt?: unknown } | void as { halt?: unknown })?.halt, undefined,
      `${label} must not halt the run`);
    assertEquals(b.lastTransitionFailure(), null, label);
    assertEquals(b.lastFeedback()?.source, "deterministic", label);
    // The round still progressed.
    assert(b.state?.pending_next_action, label);
  }
});

Deno.test("3./5. an observation-construction failure is NOT swallowed", async () => {
  const b = await brokenFold("observation");
  const outcome = await b.onObservation(round());
  const halt = (outcome as { halt?: { code: string; reason: string; diagnostics?: Record<string, unknown> } })?.halt;

  assert(halt, "the failure was swallowed");
  assertEquals(halt.code, "source_observation_transition_failed");

  const d = b.lastTransitionFailure()!;
  assertEquals(d.phase, "observation_construction");
  assertEquals(d.planHash, b.plan!.planHash);
  assertEquals(d.providerCallCompleted, true);
  assert("attempt" in d && "stepId" in d && "evidenceFusionCompleted" in d);
});

Deno.test("4./6./7./8. a transition failure stops the run without inventing an outcome", async () => {
  const halts: unknown[] = [];
  const rounds: number[] = [];

  const res = await runCompanyFirstQuotaController(controllerIntent, {
    invokeJobs: () => Promise.resolve([]),
    invokePeople: () => Promise.resolve([]),
    persist: () => Promise.resolve({ ok: true, accountId: null, leadCandidateId: null }),
    onRoundComplete: (input: RoundObservationInput) => {
      rounds.push(input.round);
      const halt = { code: "source_observation_transition_failed", reason: "state_transition_failed", diagnostics: { phase: "state_transition" } };
      halts.push(halt);
      return Promise.resolve({ halt });
    },
  } as never, { requestedLeadCount: 5, workspaceId: "ws-1", taskId: "task-1", bounds: { maxRounds: 3 } });

  // 6. no further source rounds.
  assertEquals(rounds, [1], "a halted run started another round");
  assertEquals(res.rounds_attempted, 1);

  // 4./5. the failure is terminal and named.
  assertEquals(res.terminal_status, "source_transition_failed");
  assertEquals(res.terminal_reason, "state_transition_failed");
  assertEquals(res.source_transition_failure?.code, "source_observation_transition_failed");
  assertEquals(res.source_transition_failure?.round, 1);

  // 7./8. neither exhaustion nor quota completion is claimed.
  assert(res.terminal_status !== "search_exhausted");
  assert(res.terminal_status !== "completed");
  assertEquals(res.eligible_leads, 0);
  assertFalse(res.continuation.required, "a run that lost its state must not advertise continuation");
});

Deno.test("4.B a THROWN observer error is a halt, not a shrug", async () => {
  const res = await runCompanyFirstQuotaController(controllerIntent, {
    invokeJobs: () => Promise.resolve([]),
    invokePeople: () => Promise.resolve([]),
    persist: () => Promise.resolve({ ok: true, accountId: null, leadCandidateId: null }),
    onRoundComplete: () => { throw new Error("observation could not be built"); },
  } as never, { requestedLeadCount: 5, workspaceId: "ws-1", taskId: "task-1", bounds: { maxRounds: 3 } });

  assertEquals(res.terminal_status, "source_transition_failed");
  assertEquals(res.rounds_attempted, 1);
  assertEquals(res.source_transition_failure?.reason, "observation_construction_failed");
  // The raw message never survives.
  assertFalse(JSON.stringify(res.source_transition_failure).includes("could not be built"));
});

Deno.test("5.B the failure projects onto a truthful FAILED task status", () => {
  const p = projectStatus("source_transition_failed");
  assertEquals(p, { rowStatus: "failed", taskStatus: "failed", terminalStatus: "source_transition_failed" });
  // Not a provider fault: the paid call worked.
  assert(p.terminalStatus !== "provider_failure");
  // And no automatic continuation is offered for it.
  assertFalse(isContinuable("source_transition_failed"));
});

Deno.test("9./10. a completed paid provider call survives an observer failure", async () => {
  const saved: Array<{ completed_calls: unknown[]; terminal_status: string | null }> = [];

  await runCompanyFirstQuotaController(controllerIntent, {
    invokeJobs: () => Promise.resolve([]),
    invokePeople: () => Promise.resolve([]),
    persist: () => Promise.resolve({ ok: true, accountId: null, leadCandidateId: null }),
    onRoundComplete: () => Promise.resolve({
      halt: { code: "source_observation_transition_failed", reason: "state_transition_failed" },
    }),
    stateStore: {
      load: () => Promise.resolve(null),
      save: (_id: string, state: { completed_calls: unknown[]; terminal_status: string | null }) => {
        saved.push({ completed_calls: [...state.completed_calls], terminal_status: state.terminal_status });
        return Promise.resolve();
      },
    },
  } as never, { requestedLeadCount: 5, workspaceId: "ws-1", taskId: "task-1", bounds: { maxRounds: 1 } });

  assert(saved.length > 0, "the checkpoint must still be written on a halt");
  const last = saved[saved.length - 1];
  assert(last.completed_calls.length > 0,
    "the completed provider call must be preserved so continuation cannot re-pay for it");
  assertEquals(last.terminal_status, "source_transition_failed");
});

Deno.test("11./12./13. continuation replays a recorded action and never guesses without one", async () => {
  const m = mockModel(feedbackResponse({ action: "advance_to_next_source", currentStepId: "x", nextStepId: "y" }));
  const healthy = await bridge({ readEnv: feedbackOn, generate: m.fn });
  const preFold = JSON.parse(JSON.stringify(healthy.state));
  const out = await healthy.onObservation(round());
  const slices = (out as { checkpointSlices: Record<string, unknown> }).checkpointSlices;
  const ledger = slices[SOURCE_FEEDBACK_KEY] as SourceFeedbackLedger;

  // 11./12. an already-recorded answer is replayed, not re-bought.
  const resumed = await bridge({
    readEnv: feedbackOn, generate: m.fn,
    restoredState: preFold,
    restoredFeedback: JSON.parse(JSON.stringify(ledger)),
  });
  await resumed.onObservation(round());
  assertEquals(m.calls.length, 1, "the resumed run bought the same answer twice");
  assertEquals(resumed.lastFeedback()?.skippedReason, "continuation_reuse");
  assertEquals(resumed.state?.pending_next_action, ledger.checkpoints[0].acceptedAction?.action);

  // 13. with NO recorded action, a resumed run does not invent one — and it does
  // not silently restart at step 1 either.
  const empty = await bridge({ readEnv: feedbackOn, generate: m.fn, restoredState: preFold });
  assertEquals(empty.feedback?.checkpoints.length, 0);
  assertEquals(empty.state?.current_step_id, preFold.current_step_id);
  assertEquals(empty.state?.pending_next_action, preFold.pending_next_action);
});

Deno.test("14. a failed observer cannot produce repeated empty rounds", async () => {
  const providerCalls: string[] = [];
  let observations = 0;

  const res = await runCompanyFirstQuotaController(controllerIntent, {
    invokeJobs: () => { providerCalls.push("jobs"); return Promise.resolve([]); },
    invokePeople: () => Promise.resolve([]),
    persist: () => Promise.resolve({ ok: true, accountId: null, leadCandidateId: null }),
    onRoundComplete: () => {
      observations += 1;
      return Promise.resolve({ halt: { code: "source_observation_transition_failed", reason: "state_transition_failed" } });
    },
  } as never, { requestedLeadCount: 5, workspaceId: "ws-1", taskId: "task-1", bounds: { maxRounds: 3 } });

  // The old behaviour would have run all three rounds, each returning nothing.
  assertEquals(observations, 1);
  assertEquals(res.rounds_attempted, 1);
  assertEquals(providerCalls.length, 1, "a broken run kept paying for rounds it could not use");
});

Deno.test("15./16./17. healthy behaviour is unchanged", async () => {
  // 15./16. one successful observation, one fold, no halt.
  const b = await bridge({ readEnv: feedbackOn, generate: mockModel(feedbackResponse({ action: "advance_to_next_source", currentStepId: "x", nextStepId: "y" })).fn });
  const out = await b.onObservation(round({ sourceExhausted: true }));
  assertEquals((out as { halt?: unknown })?.halt, undefined);
  assertEquals(b.lastTransitionFailure(), null);
  assertEquals(b.state?.current_step_id, b.plan!.steps[1].stepId);
  assertEquals(b.state!.exhausted_step_ids.length + b.state!.completed_step_ids.length, 1);

  // 17. feature OFF: no observer work at all, and no halt.
  const off = await bridge({ readEnv: allOff });
  assertFalse(off.enabled);
  assertEquals(await off.onObservation(round()), undefined);
  assertEquals(off.lastTransitionFailure(), null);
});

Deno.test("18./20. quota policy and the single authorities are untouched", async () => {
  // 18. a halted round still counts only CONTACT-ready people — nothing about the
  // failure path invents quota progress.
  const res = await runCompanyFirstQuotaController(controllerIntent, {
    invokeJobs: () => Promise.resolve([]),
    invokePeople: () => Promise.resolve([]),
    persist: () => Promise.resolve({ ok: true, accountId: null, leadCandidateId: null }),
    onRoundComplete: () => Promise.resolve({ halt: { code: "source_observation_transition_failed", reason: "state_transition_failed" } }),
  } as never, { requestedLeadCount: 5, workspaceId: "ws-1", taskId: "task-1", bounds: { maxRounds: 2 } });
  assertEquals(res.eligible_leads, 0);
  assertEquals(res.remaining_leads, 5);

  // 20. the halt uses the EXISTING status vocabulary and the EXISTING checkpoint;
  // no parallel status list, ledger or continuation store was introduced.
  const contractSrc = await Deno.readTextFile(new URL("./taskStatusContract.ts", import.meta.url));
  assert(contractSrc.includes('"source_transition_failed"'),
    "the new outcome must live in the one status vocabulary");
  const controllerSrc = await Deno.readTextFile(new URL("./companyFirstQuotaController.ts", import.meta.url));
  assertFalse(/newIdempotencyLedger\s*\(\s*\)[\s\S]{0,80}halt/.test(controllerSrc),
    "the halt path must not create a second idempotency ledger");
  assert(controllerSrc.includes("recordCompletedCall("), "provider idempotency stays the existing ledger");
});

Deno.test("19.B no live provider or model call occurs on the failure path", async () => {
  const originalFetch = globalThis.fetch;
  let attempted = 0;
  globalThis.fetch = ((..._a: unknown[]) => {
    attempted += 1;
    return Promise.reject(new Error("no network is permitted in this test"));
  }) as typeof fetch;
  try {
    const b = await brokenFold("observation");
    await b.onObservation(round());
    assert(b.lastTransitionFailure());
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(attempted, 0);
});

Deno.test("safe diagnostics never carry an exception payload or a secret", async () => {
  const b = await brokenFold("observation");
  await b.onObservation(round());
  const d = sequentialSourceDiagnostics(b) as Record<string, unknown>;
  const blob = JSON.stringify(d).toLowerCase();

  assert(d.source_transition_failure, "the failure must be visible in diagnostics");
  for (const forbidden of ["anthropic_api_key", "bearer", "stack", "at object", "<mission>", "http://", "https://"]) {
    assertFalse(blob.includes(forbidden), `"${forbidden}" leaked into diagnostics`);
  }
});
