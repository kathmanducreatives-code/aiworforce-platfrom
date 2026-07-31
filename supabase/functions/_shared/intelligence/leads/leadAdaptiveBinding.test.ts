// GATEWAY BINDING TESTS — the two model call sites, exercised through the REAL
// bridge (`applySequentialSourceExecution`), the real ordered-plan validator and
// the real `applyObservation`.
//
// OFFLINE ONLY. Every gateway is an injected stub that counts its calls. No Actor
// runs, no Firecrawl call, no real model call, no database access.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applySequentialSourceExecution } from "../../sequentialSourceBridge.ts";
import { emptyFunnelSummary } from "../../sourcingBottleneck.ts";
import type { RoundObservationInput } from "../../companyFirstQuotaController.ts";
import type { EnvReader } from "../intelligenceFlags.ts";
import type { LeadMissionSourceProfile } from "../../hiringSourcePlan.ts";
import { validateRoleTaxonomy } from "./leadRoleTaxonomy.ts";
import { validateQueryPacks, type QueryPack } from "./leadQueryPacks.ts";
import { deterministicRevenueOpsTaxonomy, deterministicRevenueOpsPacks } from "./leadAdaptiveContext.ts";
import { approvedToAdaptive, bindFeedbackAskClaude, resolveAdaptiveOrderedPlan } from "./leadAdaptiveRuntime.ts";

const APPROVED = ["yc_job_discovery", "linkedin_job_discovery", "indeed_job_discovery", "glassdoor_job_discovery"];

function packs(): QueryPack[] {
  const tax = validateRoleTaxonomy({
    taxonomy: deterministicRevenueOpsTaxonomy(), approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations",
  }).taxonomy!;
  return validateQueryPacks({ packs: deterministicRevenueOpsPacks(), taxonomy: tax, approvedCapabilities: APPROVED }).packs;
}

/** Sourcing on; BOTH Claude flags on and allow-listed for ws-1. */
const allClaudeOn: EnvReader = (k) =>
  k === "DYNAMIC_HIRING_SOURCE_PLANNING" ? "true"
    : k === "DYNAMIC_HIRING_SOURCE_PLANNING_WORKSPACES" ? "ws-1"
    : k === "CLAUDE_SOURCE_FEEDBACK" ? "true"
    : k === "CLAUDE_SOURCE_FEEDBACK_WORKSPACES" ? "ws-1"
    : k === "CLAUDE_FIRST_LEAD_PLANNING" ? "true"
    : k === "CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES" ? "ws-1"
    : k === "ANTHROPIC_API_KEY" ? "x"
    : undefined;

/** Sourcing on, every Claude flag OFF — the shipping state. */
const claudeOff: EnvReader = (k) =>
  k === "DYNAMIC_HIRING_SOURCE_PLANNING" ? "true"
    : k === "DYNAMIC_HIRING_SOURCE_PLANNING_WORKSPACES" ? "ws-1"
    : undefined;

function profile(): LeadMissionSourceProfile {
  return {
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
  } as unknown as LeadMissionSourceProfile;
}

const round = (o: Partial<RoundObservationInput> = {}): RoundObservationInput => ({
  round: 1,
  funnel: { ...emptyFunnelSummary(), raw_jobs: 25, unique_jobs: 25 },
  rawRows: 25, newUniqueJobs: 25, newUniqueCompanies: 25, newEligibleLeads: 0,
  totalEligibleLeads: 0, remainingQuota: 5, remainingBudgetUsd: 4,
  providerCalls: 1, duplicatesRemoved: 0, sourceExhausted: false,
  // The production pattern: relevant titles, companies resolved, all rejected.
  stages: {
    providerRows: 25, normalizedJobs: 25, titleMatches: 23, titleRejections: 2,
    geographyRejections: 0, companiesResolved: 25, companiesEvaluated: 25,
    companiesQualified: 0, companiesRejectedByBrain: 25,
    companyRejectionReasons: { employee_count: 18, business_model: 7 },
    peopleSearched: 0, employerVerified: 0, contactReady: 0,
  },
  ...o,
});

/** A valid strategy in the shape the converter consumes. */
function rawStrategy() {
  return {
    source_plan: [
      { step_id: "s1-yc", capability_key: "yc_job_discovery", purpose: "startup-precise discovery", query_pack_ids: ["sales_ops_leadership"], semantic_filters: { countries: ["United States"], maximum_age_days: 30 }, rationale: "targets startups" },
      { step_id: "s2-li", capability_key: "linkedin_job_discovery", purpose: "broader coverage", query_pack_ids: ["direct_ops_ic"], semantic_filters: { countries: ["United States"], maximum_age_days: 60 } },
    ],
    query_packs: packs(),
    recency_policy: { maximum_age_days: 60 },
    broadening_ladder: [],
  };
}

const okValidator = () => ({
  ok: true as const, reason: null, strategy: rawStrategy(), source: "claude" as const,
});
const badValidator = () => ({
  ok: false as const, reason: "employee_range_widened", strategy: null, source: "claude" as const,
});

function enableProviders() {
  for (const k of [
    "APIFY_ENABLE_INDEED_JOBS_AUTOMATION_LAB", "APIFY_ENABLE_LINKEDIN_JOBS_CRAWLWORKS",
    "APIFY_ENABLE_GLASSDOOR_JOBS", "APIFY_ENABLE_YC_JOBS", "APIFY_ENABLE_ATS_VERIFICATION",
  ]) Deno.env.set(k, "1");
}

async function bridge(o: Record<string, unknown> = {}) {
  enableProviders();
  return await applySequentialSourceExecution({
    workspaceId: "ws-1", taskId: "task-1",
    invokeJobs: () => Promise.resolve([]),
    profile: profile(),
    readEnv: allClaudeOn,
    companyBrainPolicyHash: "policy-hash-1",
    ...o,
  } as Parameters<typeof applySequentialSourceExecution>[0]);
}

// ============================== 1–4. INITIAL STRATEGY BINDING ==============

Deno.test("1. enabled + allow-listed initial planning calls the injected Claude planner exactly once", async () => {
  let calls = 0;
  const b = await bridge({
    planAdaptiveStrategy: () => { calls += 1; return Promise.resolve(rawStrategy()); },
    validateAdaptiveStrategy: okValidator,
    adaptivePacks: packs(),
  });
  assertEquals(calls, 1, "the strategy gateway must be called exactly once");
  assert(b.enabled);
});

Deno.test("2. disabled initial planning makes ZERO model calls and plans deterministically", async () => {
  let calls = 0;
  const b = await bridge({
    readEnv: claudeOff,
    planAdaptiveStrategy: () => { calls += 1; return Promise.resolve(rawStrategy()); },
    validateAdaptiveStrategy: okValidator,
  });
  assertEquals(calls, 0, "a disabled flag must not reach the gateway");
  assert(b.enabled, "dynamic sourcing itself is still on");
  // The deterministic plan is what runs.
  assert((b.plan?.steps.length ?? 0) > 0);
  assertFalse(b.plan?.steps.some((s) => s.stepId === "s1-yc"));
});

Deno.test("2b. no gateway supplied ⇒ no call, deterministic plan, exact reason", async () => {
  const outcome = await resolveAdaptiveOrderedPlan({
    routeEnabled: true, routeReason: "enabled",
    planStrategy: undefined, validate: okValidator, candidateTarget: 25,
  });
  assertEquals(outcome.modelCalled, false);
  assertEquals(outcome.strategySource, "deterministic_fallback");
  assertEquals(outcome.fallbackReason, "strategy_gateway_unavailable");
});

Deno.test("3. a valid Claude strategy becomes the authoritative plan", async () => {
  const b = await bridge({
    planAdaptiveStrategy: () => Promise.resolve(rawStrategy()),
    validateAdaptiveStrategy: okValidator,
    adaptivePacks: packs(),
  });
  // The plan the runtime will execute carries Claude's steps, in Claude's order,
  // having passed the EXISTING validateOrderedPlan.
  assertEquals(b.plan?.steps[0].stepId, "s1-yc");
  assertEquals(b.plan?.steps[0].capability, "yc_job_discovery");
  // And pack titles rode into the step intent, so they reach the real compiler.
  const aliases = b.plan?.steps[0].semanticIntent.approvedTitleAliases ?? [];
  assert(aliases.includes("VP of Sales Operations"));
});

Deno.test("4. an invalid or failed Claude strategy uses the deterministic plan with its reason", async () => {
  // (a) validation rejects it
  const invalid = await resolveAdaptiveOrderedPlan({
    routeEnabled: true, routeReason: "enabled",
    planStrategy: () => Promise.resolve(rawStrategy()),
    validate: badValidator, candidateTarget: 25,
  });
  assertEquals(invalid.strategySource, "deterministic_fallback");
  assertEquals(invalid.fallbackReason, "employee_range_widened");
  assertEquals(invalid.modelCalled, true);

  // (b) the gateway throws
  const threw = await resolveAdaptiveOrderedPlan({
    routeEnabled: true, routeReason: "enabled",
    planStrategy: () => Promise.reject(new Error("timeout")),
    validate: okValidator, candidateTarget: 25,
  });
  assertEquals(threw.fallbackReason, "strategy_gateway_error");

  // (c) end to end through the real bridge: the deterministic plan still runs.
  const b = await bridge({
    planAdaptiveStrategy: () => Promise.reject(new Error("timeout")),
    validateAdaptiveStrategy: okValidator,
  });
  assert(b.enabled);
  assertFalse(b.plan?.steps.some((s) => s.stepId === "s1-yc"));
});

Deno.test("4b. the route gate is checked BEFORE the gateway is reached", async () => {
  let calls = 0;
  const outcome = await resolveAdaptiveOrderedPlan({
    routeEnabled: false, routeReason: "workspace_not_allowed",
    planStrategy: () => { calls += 1; return Promise.resolve(rawStrategy()); },
    validate: okValidator, candidateTarget: 25,
  });
  assertEquals(calls, 0);
  assertEquals(outcome.fallbackReason, "workspace_not_allowed");
});

// ============================== 5–9. SOURCE-FEEDBACK BINDING ===============

Deno.test("5. enabled + allow-listed feedback calls the injected gateway exactly once per observation", async () => {
  let calls = 0;
  const b = await bridge({
    adaptivePacks: packs(),
    generate: (o: unknown) => {
      calls += 1;
      void o;
      return Promise.resolve({
        ok: true, provider: "anthropic" as const, model: "claude-test", latencyMs: 3,
        content: "{}", json: {},
      });
    },
  });
  await b.onObservation(round());
  assertEquals(calls, 1, "exactly one model request per observation");
});

Deno.test("6. disabled feedback makes ZERO model calls", async () => {
  let calls = 0;
  const b = await bridge({
    readEnv: claudeOff,
    adaptivePacks: packs(),
    generate: () => { calls += 1; throw new Error("must not be reached"); },
  });
  await b.onObservation(round());
  assertEquals(calls, 0);
});

Deno.test("7. a valid feedback action reaches the existing applyObservation mutator", async () => {
  const b = await bridge({ adaptivePacks: packs() });
  const before = b.state?.pending_next_action ?? null;
  await b.onObservation(round());
  // `applyObservation` is what writes this field; a value proves it ran.
  assert(b.state?.pending_next_action, "the existing mutator did not run");
  assert(b.state?.pending_next_action !== before);
});

Deno.test("8. a thrown or invalid feedback response falls back deterministically", async () => {
  const b = await bridge({
    adaptivePacks: packs(),
    generate: () => Promise.reject(new Error("gateway down")),
  });
  const outcome = await b.onObservation(round());
  // Not a halt: a model failure is a fallback, not a control-plane failure.
  assertFalse(Boolean((outcome as { halt?: unknown } | undefined)?.halt));
  assert(b.state?.pending_next_action);
  const d = b.lastAdaptiveDecision();
  assert(d, "an adaptive decision should have been recorded");
  assertEquals(d!.chosen_source, "deterministic_fallback");
});

Deno.test("8b. bindFeedbackAskClaude never launders a deterministic answer into a Claude one", async () => {
  const binding = bindFeedbackAskClaude(
    () => Promise.resolve({
      action: { action: "advance_to_next_source", currentStepId: "a", nextStepId: "b" } as never,
      source: "deterministic" as const, modelCalled: false, skippedReason: "flag_off",
    }),
    { nextCapability: "yc_job_discovery" },
  );
  assertEquals(await binding.askClaude({} as never), null);
  assertEquals(binding.lastCall()?.source, "deterministic");

  // A genuine Claude answer IS translated.
  const claude = bindFeedbackAskClaude(
    () => Promise.resolve({
      action: { action: "advance_to_next_source", currentStepId: "a", nextStepId: "b" } as never,
      source: "claude" as const, modelCalled: true, skippedReason: null,
    }),
    { nextCapability: "yc_job_discovery" },
  );
  const a = await claude.askClaude({} as never);
  assertEquals(a?.action, "advance_source");
  assertEquals(a?.target_capability_key, "yc_job_discovery");
});

Deno.test("8c. a throwing gateway is caught inside the binding", async () => {
  const binding = bindFeedbackAskClaude(() => Promise.reject(new Error("boom")), {});
  assertEquals(await binding.askClaude({} as never), null);
  assertEquals(binding.lastCall()?.skippedReason, "gateway_error");
});

Deno.test("9. the authoritative action source and fallback reason are recorded", async () => {
  const b = await bridge({ adaptivePacks: packs() });
  await b.onObservation(round());
  const d = b.lastAdaptiveDecision()!;
  assert(["claude", "deterministic_fallback"].includes(String(d.chosen_source)));
  assert(typeof d.bottleneck === "string");
  assertEquals(d.bottleneck, "company_brain_rejection");
  assert("fallback_reason" in d);
  assert("approved_action" in d);
});

Deno.test("9b. diagnostics never carry a prompt, credential or provider record", async () => {
  const b = await bridge({ adaptivePacks: packs() });
  await b.onObservation(round());
  const blob = JSON.stringify(b.lastAdaptiveDecision()).toLowerCase();
  for (const banned of ["prompt", "api_key", "anthropic_api_key", "apify", "bearer", "sk-"]) {
    assertFalse(blob.includes(banned), `diagnostics leaked ${banned}`);
  }
});

// ============================== 10–12. GUARDS ==============================

Deno.test("10. no model call occurs after the CONTACT quota is reached", async () => {
  let calls = 0;
  const b = await bridge({
    adaptivePacks: packs(),
    generate: () => { calls += 1; throw new Error("must not be reached"); },
  });
  await b.onObservation(round({
    totalEligibleLeads: 5, remainingQuota: 0,
    stages: { ...round().stages!, contactReady: 5 },
  }));
  assertEquals(calls, 0, "a satisfied quota must not buy a model call");
});

Deno.test("11. no model call occurs when the only valid action is to stop", async () => {
  let calls = 0;
  const b = await bridge({
    adaptivePacks: packs(),
    generate: () => { calls += 1; throw new Error("must not be reached"); },
  });
  // No budget and no provider calls left ⇒ the menu is ["stop_partial"].
  await b.onObservation(round({ remainingBudgetUsd: 0 }));
  assertEquals(calls, 0);
});

Deno.test("12. with every Claude flag off, behaviour and persisted shape are unchanged", async () => {
  const b = await bridge({ readEnv: claudeOff, adaptivePacks: packs() });
  const outcome = await b.onObservation(round());
  const slices = (outcome as { checkpointSlices: Record<string, unknown> }).checkpointSlices;
  // The pre-existing three slices, and no new key.
  assertEquals(Object.keys(slices).sort(), ["hiring_evidence_fusion", "source_execution", "source_feedback"].sort());
  assertEquals(b.lastAdaptiveDecision(), null, "the adaptive path must not have engaged");
  assert(b.state?.pending_next_action, "the pre-existing loop still advanced the run");
});

Deno.test("12b. without validated packs the pre-existing feedback path runs verbatim", async () => {
  const b = await bridge({});   // no adaptivePacks
  await b.onObservation(round());
  assertEquals(b.lastAdaptiveDecision(), null);
  assert(b.lastFeedback(), "the existing feedback runtime still decided the round");
});

// ============================== inverse-map coverage =======================

Deno.test("approvedToAdaptive covers the union, and excludes ATS", () => {
  assertEquals(approvedToAdaptive({ action: "stop_quota_reached" }, {})?.action, "stop_success");
  assertEquals(approvedToAdaptive({ action: "stop_valid_exhaustion", reason: "x" }, {})?.action, "stop_partial");
  assertEquals(approvedToAdaptive({ action: "enrich_contacts", personIds: [] }, {})?.action, "run_contact_enrichment");
  assertEquals(approvedToAdaptive({ action: "enrich_company_identity", companyIds: [] }, {})?.action, "begin_people_search");
  assertEquals(
    approvedToAdaptive({ action: "broaden_current_source", stepId: "s", broadeningAction: { action: "extend_recency_window", postingWindowDays: 45 } }, {})?.action,
    "broaden_recency",
  );
  assertEquals(
    approvedToAdaptive({ action: "broaden_current_source", stepId: "s", broadeningAction: { action: "add_approved_role_aliases", aliases: ["X"] } }, {})?.action,
    "run_unused_query_pack",
  );
  // ATS has no adaptive equivalent.
  assertEquals(approvedToAdaptive({ action: "verify_selected_jobs", companyIds: [] }, {}), null);
  // A provider-shaped rung has no semantic equivalent either.
  assertEquals(
    approvedToAdaptive({ action: "broaden_current_source", stepId: "s", broadeningAction: { action: "increase_result_target", candidateTarget: 50 } }, {}),
    null,
  );
});
