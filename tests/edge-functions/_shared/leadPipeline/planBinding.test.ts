// Stage 2 (Option E): the strategy plan hash binds the plan's MEANING, not only its IDs.
//
// Architecture review finding C1: v1 hashed criterion IDs (`dimension:slug(value)`), so a
// US-headquarters plan and a US-presence plan for the same query hashed alike (dedf67a0),
// and an approval did not lock what was approved. v2 hashes every requirement's kind,
// scope, value, window and status, the signals, steps, ceilings, workspace, the user's
// provider choices and the interpretation contract.

import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { planStrategy, specFromMission, STRATEGY_PLANNER_VERSION, type StrategyContext } from "../../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { BLANK_PROPOSAL } from "../../../../scripts/dev/mission-semantics.ts";

const US_HARD = { field: "geography", operator: "in", value: ["United States"], reason: "US" };
const spec = (query: string, over: Record<string, unknown> = {}) => {
  const proposal = { ...BLANK_PROPOSAL, requested_opportunity_count: 3, required_signal_terms: ["Account Executives"], hard_constraints: [US_HARD], ...over };
  return specFromMission(compileLeadMission({ originalUserQuery: query, proposal: proposal as never, requestedCount: 3 }).final_mission as never, { defaultCount: 3 });
};
const CTX: StrategyContext = {
  providers: { apify: { enabled: true, connected: true, authorized: true }, leadocean: { enabled: false, connected: false, authorized: true }, apollo: { enabled: false, connected: false, authorized: true } },
  budget: { maxLeadoceanRecords: 0, maxApifyUsd: 0.04 },
  binding: { workspaceId: "ws-test", contractVersion: "v1" },
};
const Q = "Find 3 US companies actively hiring Account Executives. Prefer B2B companies with 20–500 employees, but include strong opportunities outside that range.";
const PAID = { company_types: ["B2B"], employee_range: { min: 20, max: 500 } };

Deno.test("the hash is SHA-256, deterministic, and versioned", () => {
  const a = planStrategy(spec(Q, PAID), CTX), b = planStrategy(spec(Q, PAID), CTX);
  assert(/^[0-9a-f]{64}$/.test(a.planHash), a.planHash);
  assertEquals(a.planHash, b.planHash);
  assertEquals(a.binding.version, STRATEGY_PLANNER_VERSION);
  assertEquals([a.binding.workspace, a.binding.contract, a.binding.ceilings], ["ws-test", "v1", CTX.budget]);
});

Deno.test("C1: US headquarters and US presence no longer share a plan hash", () => {
  const offices = "Find 3 companies with offices in the United States actively hiring Account Executives.";
  const hq = planStrategy(spec(offices, { geography_scope: "headquarters" }), CTX);
  const presence = planStrategy(spec(offices), CTX);
  assertEquals(hq.steps.map((s) => s.capability), presence.steps.map((s) => s.capability), "same providers and steps");
  assertNotEquals(hq.planHash, presence.planHash, "a different meaning is a different plan");
  assertNotEquals(hq.binding.semanticsFingerprint, presence.binding.semanticsFingerprint);
});

Deno.test("every bound part of the plan changes the hash", () => {
  const base = planStrategy(spec(Q, PAID), CTX).planHash;
  const variants: [string, () => string][] = [
    ["B2B required instead of preferred", () => planStrategy(spec("Find 3 US companies actively hiring Account Executives. Only include B2B companies with 20–500 employees.", PAID), CTX).planHash],
    ["size preference", () => planStrategy(spec(Q, { ...PAID, employee_range: { min: 20, max: 200 } }), CTX).planHash],
    ["hiring window", () => planStrategy(spec(Q, { ...PAID, signal_recency_days: 60 }), CTX).planHash],
    ["role", () => planStrategy(spec(Q.replace("Account Executives", "SDRs"), { ...PAID, required_signal_terms: ["SDRs"] }), CTX).planHash],
    ["workspace", () => planStrategy(spec(Q, PAID), { ...CTX, binding: { ...CTX.binding!, workspaceId: "ws-other" } }).planHash],
    ["contract", () => planStrategy(spec(Q, PAID), { ...CTX, binding: { ...CTX.binding!, contractVersion: "v2" } }).planHash],
    ["Apify ceiling", () => planStrategy(spec(Q, PAID), { ...CTX, budget: { ...CTX.budget, maxApifyUsd: 0.25 } }).planHash],
    ["LeadOcean ceiling", () => planStrategy(spec(Q, PAID), { ...CTX, budget: { ...CTX.budget, maxLeadoceanRecords: 50 } }).planHash],
    ["provider exclusion", () => planStrategy(spec(Q, PAID), { ...CTX, user: { excludeProviders: ["leadocean"] } }).planHash],
  ];
  for (const [name, f] of variants) assertNotEquals(f(), base, name);
});

Deno.test("cosmetic differences do not change the hash: model advice text and requirement display text", () => {
  const s = spec(Q, PAID);
  const plain = planStrategy(s, CTX);
  const advised = planStrategy(s, CTX, { proposed: plain.strategy, rationale: "any wording at all", model: "m", error: null });
  assertEquals(advised.strategy, plain.strategy);
  assertEquals(advised.planHash, plain.planHash, "the model's prose is not part of the plan");
  const relabelled = { ...s, requirements: { ...s.requirements, criteria: s.requirements.criteria.map((c) => ({ ...c, label: "x", rationale: "y", user_phrase: "" })) } };
  assertEquals(planStrategy(relabelled as never, CTX).planHash, plain.planHash);
});
