// CHANGESET 4 PROOF — one GPT owner for feedback, plan-aware execution limits.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  adaptiveActionFor, createStrategistGenerateJson, leadFeedbackOwnerApplies,
  planAwareActionBudget, MAX_PLAN_AWARE_ACTIONS, LEAD_FEEDBACK_ACTIONS,
  type FeedbackObservationSignals,
} from "../../../supabase/functions/_shared/leadStrategyFeedbackOwner.ts";
import type { StrategistCall, StrategistResult } from "../../../supabase/functions/_shared/leadStrategy/provider.ts";

const base: FeedbackObservationSignals = {
  bottleneck: null,
  offFamilyRate: 0,
  companyBrainFail: 0,
  evidencePending: 0,
  qualifiedCompaniesAwaitingPeople: 0,
  peopleNeedingContact: 0,
  unusedExactPacks: 0,
  unusedAdjacentPacks: 0,
  unusedSources: 0,
  remainingQuota: 5,
  contactReady: 0,
};
const sig = (o: Partial<FeedbackObservationSignals>) => ({ ...base, ...o });

// -------------------------------------------------------------------- gate ---

Deno.test("the feedback owner is gated to exactly one workflow + mode", () => {
  assert(leadFeedbackOwnerApplies({ workflow: "qualified_lead_sourcing", executionMode: "company_first" }));
  assert(!leadFeedbackOwnerApplies({ workflow: "qualified_lead_sourcing", executionMode: "fast" }));
  assert(!leadFeedbackOwnerApplies({ workflow: "account_signals", executionMode: "company_first" }));
  assert(!leadFeedbackOwnerApplies({}));
});

// ----------------------------------------------------------- adaptive rules ---

Deno.test("high irrelevant-title rate tightens the pack instead of resending it elsewhere", () => {
  const c = adaptiveActionFor(sig({ offFamilyRate: 0.8, unusedExactPacks: 2, unusedSources: 3 }));
  assertEquals(c.action, "tighten_query_pack");
  assert(c.reason.includes("precision"));
});

Deno.test("noise with no tighter pack advances the source rather than repeating", () => {
  const c = adaptiveActionFor(sig({ offFamilyRate: 0.9, unusedExactPacks: 0, unusedSources: 2 }));
  assertEquals(c.action, "advance_source");
});

Deno.test("relevant titles but wrong companies preserves title intent and changes source", () => {
  const c = adaptiveActionFor(sig({ offFamilyRate: 0.05, companyBrainFail: 9, unusedSources: 2 }));
  assertEquals(c.action, "advance_source");
  assert(c.reason.includes("preserve_title_intent"));
});

Deno.test("missing company evidence begins company enrichment", () => {
  assertEquals(adaptiveActionFor(sig({ evidencePending: 4 })).action, "begin_company_enrichment");
});

Deno.test("qualified companies begin people search", () => {
  assertEquals(
    adaptiveActionFor(sig({ qualifiedCompaniesAwaitingPeople: 3, evidencePending: 2 })).action,
    "begin_people_search",
  );
});

Deno.test("verified people lacking contacts run contact enrichment first", () => {
  assertEquals(
    adaptiveActionFor(sig({ peopleNeedingContact: 2, qualifiedCompaniesAwaitingPeople: 5, unusedSources: 4 })).action,
    "run_contact_enrichment",
  );
});

Deno.test("CONTACT quota stops all further actions", () => {
  const c = adaptiveActionFor(sig({
    remainingQuota: 0, unusedExactPacks: 4, unusedSources: 4,
    peopleNeedingContact: 3, evidencePending: 9,
  }));
  assertEquals(c.action, "stop_success");
});

Deno.test("exhaustion is honest rather than silent", () => {
  assertEquals(adaptiveActionFor(sig({})).action, "stop_partial");
});

Deno.test("every produced action belongs to the approved vocabulary", () => {
  const cases = [
    sig({ offFamilyRate: 0.9, unusedExactPacks: 1 }),
    sig({ unusedAdjacentPacks: 1 }),
    sig({ unusedExactPacks: 1 }),
    sig({ remainingQuota: 0 }),
    sig({}),
  ];
  for (const c of cases) {
    assert(
      (LEAD_FEEDBACK_ACTIONS as readonly string[]).includes(adaptiveActionFor(c).action),
      `unapproved action for ${JSON.stringify(c)}`,
    );
  }
});

// --------------------------------------------------------- plan-aware budget ---

Deno.test("the budget counts the plan, not a blind three rounds", () => {
  const rich = planAwareActionBudget({
    unusedExactPacks: 3, unusedAdjacentPacks: 1, unusedSources: 3,
    remainingQuota: 5, remainingBudgetUsd: 4, actionsSpent: 3,
  });
  assert(rich.allowed > 3, "a plan with unused packs and sources stopped at round three");
  assert(!rich.exhausted);
});

Deno.test("quota reached ends the budget immediately", () => {
  const b = planAwareActionBudget({
    unusedExactPacks: 5, unusedAdjacentPacks: 5, unusedSources: 5,
    remainingQuota: 0, remainingBudgetUsd: 10, actionsSpent: 1,
  });
  assert(b.exhausted);
  assertEquals(b.reason, "quota_reached");
});

Deno.test("an exhausted money budget ends it too", () => {
  const b = planAwareActionBudget({
    unusedExactPacks: 5, unusedAdjacentPacks: 0, unusedSources: 5,
    remainingQuota: 5, remainingBudgetUsd: 0, actionsSpent: 1,
  });
  assert(b.exhausted);
  assertEquals(b.reason, "budget_exhausted");
});

Deno.test("uniformly noisy source history collapses the remaining allowance", () => {
  const b = planAwareActionBudget({
    unusedExactPacks: 4, unusedAdjacentPacks: 2, unusedSources: 4,
    remainingQuota: 5, remainingBudgetUsd: 5, actionsSpent: 2,
    sourceQuality: { indeed_jobs: -1, glassdoor_jobs: -0.8 },
  });
  assertEquals(b.remaining, 1, "a run producing only noise kept a full allowance");
});

Deno.test("a hard upper safety bound always applies", () => {
  const b = planAwareActionBudget({
    unusedExactPacks: 50, unusedAdjacentPacks: 50, unusedSources: 50,
    remainingQuota: 99, remainingBudgetUsd: 99, actionsSpent: 0,
  });
  assertEquals(b.allowed, MAX_PLAN_AWARE_ACTIONS);
});

Deno.test("the system does not merely run every source automatically", () => {
  const b = planAwareActionBudget({
    unusedExactPacks: 0, unusedAdjacentPacks: 0, unusedSources: 4,
    remainingQuota: 5, remainingBudgetUsd: 5, actionsSpent: 7,
  });
  assert(b.exhausted, "an over-budget run kept spending sources");
});

// ------------------------------------------------- provider-independent seam ---

function recorder(results: StrategistResult[]) {
  const calls: StrategistCall[] = [];
  let i = 0;
  return {
    calls,
    fn: (call: StrategistCall) => {
      calls.push(call);
      return Promise.resolve(results[Math.min(i++, results.length - 1)]);
    },
  };
}

const ok = (content: string, model = "primary-model"): StrategistResult => ({
  ok: true, model, provider: "lovable_ai", content, json: JSON.parse(content), latencyMs: 5,
});

Deno.test("the feedback seam calls the SAME strategist, and no Gemini or Claude client", async () => {
  const rec = recorder([ok('{"action":"advance_source"}')]);
  const generate = createStrategistGenerateJson({ callModel: rec.fn });
  const res = await generate({
    taskType: "orchestration_plan",
    systemPrompt: "policy",
    messages: [{ role: "user", content: "observation" }],
  });
  assertEquals(rec.calls.length, 1, "expected exactly one strategist request");
  assertEquals(rec.calls[0].systemPrompt, "policy");
  assertEquals(rec.calls[0].userMessage, "observation");
  assert(res.ok);
  assertEquals(res.json, { action: "advance_source" });
});

Deno.test("invalid output escalates exactly once; a rate limit never does", async () => {
  const invalid = recorder([
    { ok: false, model: "p", provider: "lovable_ai", content: "not json", latencyMs: 3, errorCode: "json_parse_failed" },
    ok('{"action":"stop_partial"}', "escalation-model"),
  ]);
  const g1 = createStrategistGenerateJson({ callModel: invalid.fn });
  const r1 = await g1({ taskType: "orchestration_plan", messages: [{ role: "user", content: "x" }] });
  assertEquals(invalid.calls.length, 2, "invalid output did not escalate");
  assert(r1.ok);

  const limited = recorder([
    { ok: false, model: "p", provider: "lovable_ai", content: "", latencyMs: 3, errorCode: "rate_limited" },
  ]);
  const g2 = createStrategistGenerateJson({ callModel: limited.fn });
  const r2 = await g2({ taskType: "orchestration_plan", messages: [{ role: "user", content: "x" }] });
  assertEquals(limited.calls.length, 1, "an outage was escalated to a bigger model");
  assert(!r2.ok);
});

Deno.test("escalation happens at most once per owner instance", async () => {
  const rec = recorder([
    { ok: false, model: "p", provider: "lovable_ai", content: "", latencyMs: 1, errorCode: "json_parse_failed" },
  ]);
  const generate = createStrategistGenerateJson({ callModel: rec.fn });
  await generate({ taskType: "orchestration_plan", messages: [{ role: "user", content: "a" }] });
  await generate({ taskType: "orchestration_plan", messages: [{ role: "user", content: "b" }] });
  assertEquals(rec.calls.length, 3, "the escalation allowance was spent more than once");
});

Deno.test("provider routing hints on the legacy seam are ignored", async () => {
  const rec = recorder([ok('{"action":"advance_source"}')]);
  const generate = createStrategistGenerateJson({ callModel: rec.fn });
  await generate({
    taskType: "orchestration_plan",
    preferredProvider: "anthropic",
    messages: [{ role: "system", content: "ignored" }, { role: "user", content: "observation" }],
  });
  assertEquals(rec.calls.length, 1);
  assertEquals(rec.calls[0].userMessage, "observation", "a system message leaked into the user turn");
});
