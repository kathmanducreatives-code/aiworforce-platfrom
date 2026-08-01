// THE PRODUCTION PATH, OFFLINE: GPT packs must reach separate Actor calls.
//
// Reproduces tasks 4851efb0 / b59b422b without a single live call. Both ran the
// GPT strategy owner, both produced query packs, and both executed ONE merged
// Boolean per round. The cause was that `applySequentialSourceExecution` never
// received a binding for the GPT plan, so `activePacks` was empty and the merged
// `prepareStepCall` path was selected.
//
// These tests drive the REAL bridge with the REAL binding. ZERO network, ZERO
// model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applySequentialSourceExecution } from "./sequentialSourceBridge.ts";
import { gptAdaptiveStrategyBinding, adaptiveStrategyFromGptPlan } from "./leadStrategyAdaptiveBinding.ts";
import type { LeadStrategyPlan } from "./leadStrategyContract.ts";
import type { LeadMissionSourceProfile } from "./hiringSourcePlan.ts";
import type { MissionTruth } from "./intelligence/leads/leadSourceStrategy.ts";

function enableProviders() {
  for (
    const k of [
      "APIFY_ENABLE_INDEED_JOBS_AUTOMATION_LAB",
      "APIFY_ENABLE_LINKEDIN_JOBS_CRAWLWORKS",
      "APIFY_ENABLE_GLASSDOOR_JOBS",
      "APIFY_ENABLE_YC_JOBS",
    ]
  ) Deno.env.set(k, "1");
  Deno.env.set("DYNAMIC_HIRING_SOURCE_PLANNING", "true");
  Deno.env.set("DYNAMIC_HIRING_SOURCE_PLANNING_WORKSPACES", "ws-1");
}

const GPT_PLAN = {
  schema_version: "lead-strategy-1",
  role_family: "revenue_operations",
  title_queries: [
    "VP of Sales Operations", "Director of Sales Operations",
    "VP of Revenue Operations", "Director of Revenue Operations",
    "GTM Operations Manager",
  ],
  excluded_titles: ["Warehouse Operations Manager"],
  query_packs: [
    { pack_id: "sales_ops_leadership", queries: ["VP of Sales Operations", "Director of Sales Operations"], rationale: "core" },
    { pack_id: "revenue_ops_leadership", queries: ["VP of Revenue Operations", "Director of Revenue Operations"], rationale: "core" },
    { pack_id: "gtm_ops", queries: ["GTM Operations Manager"], rationale: "adjacent" },
  ],
  source_plan: [
    { source_key: "yc_jobs", priority: 1, rationale: "startup heavy" },
    { source_key: "linkedin_jobs", priority: 2, rationale: "coverage" },
    { source_key: "indeed_jobs", priority: 3, rationale: "coverage" },
  ],
  next_action: "run_query_packs",
  stop_conditions: ["quota_reached"],
  rationale: "openai lead strategy",
  confidence: 0.8,
} as unknown as LeadStrategyPlan;

const TRUTH: MissionTruth = {
  final_entity: "contact_ready_lead",
  requested_count: 5,
  hiring_role_seed: "Sales Operations",
  decision_maker_roles: ["Founder", "CEO"],
  company_constraints: { country: "United States", business_model: "b2b saas" },
  maximum_age_days: 60,
};

const PROFILE: LeadMissionSourceProfile = {
  industries: ["b2b saas"], stages: ["seed"], triggerRequirements: ["active_hiring"],
  hiring: {
    required: true,
    roleFamily: "revenue_operations",
    approvedAliases: GPT_PLAN.title_queries,
    geography: "United States",
    maximumPostingAgeDays: 30,
  },
  decisionMakerRoles: ["Founder", "CEO"],
  currentEmployerRequired: true,
  requestedCount: 5,
  countEntity: "contact_ready_lead",
  quotaPolicy: "contact_only",
  requiredEvidence: ["active_hiring"],
} as unknown as LeadMissionSourceProfile;

async function runProductionPath() {
  enableProviders();
  const sent: Array<Record<string, unknown>> = [];
  const bridge = await applySequentialSourceExecution({
    workspaceId: "ws-1",
    taskId: "task-1",
    invokeJobs: (env: Record<string, unknown>) => { sent.push(env); return Promise.resolve([]); },
    profile: PROFILE,
    ...gptAdaptiveStrategyBinding(GPT_PLAN, TRUTH),
    strategyRouteOverride: { enabled: true, reason: "gpt_lead_strategy" },
  } as never);
  await bridge.invokeJobs({}, 25);
  return { sent, bridge };
}

Deno.test("the GPT plan converts into a validated adaptive strategy with its own packs", () => {
  const r = adaptiveStrategyFromGptPlan({ plan: GPT_PLAN, truth: TRUTH });
  assert(r.ok, `conversion rejected: ${r.reason}`);
  assertEquals(r.packs.map((p) => p.pack_id), ["sales_ops_leadership", "revenue_ops_leadership", "gtm_ops"]);
});

Deno.test("the bridge is ENABLED by the GPT route override, not the Claude flags", async () => {
  const { bridge } = await runProductionPath();
  assert(bridge.enabled, `bridge stayed inert: ${bridge.reason}`);
  const prov = bridge.strategyProvenance();
  assert(prov, "no strategy provenance recorded");
  assertEquals(prov?.pack_ids, ["sales_ops_leadership", "revenue_ops_leadership", "gtm_ops"]);
});

Deno.test("production regression: separate pack calls, never one merged query", async () => {
  const { sent } = await runProductionPath();
  assert(sent.length >= 2, `expected one call per pack, got ${sent.length}`);
  const packIds = sent.map((e) => e.query_pack_id).filter(Boolean);
  assertEquals(packIds.length, sent.length, "every call must name its query pack");
  assertEquals(new Set(packIds).size, packIds.length, "pack ids must be distinct per call");
  for (const env of sent) {
    const input = env.input as Record<string, unknown>;
    const q = String(input?.query ?? input?.keywords ?? "");
    assertFalse(
      q.includes("Sales Operations OR Revenue Operations OR GTM Operations"),
      `the production merged query was re-sent: ${q}`,
    );
  }
});

Deno.test("production regression: pack identity, hash and idempotency survive", async () => {
  const { sent } = await runProductionPath();
  assertEquals(new Set(sent.map((e) => e.compiled_input_hash)).size, sent.length);
  assertEquals(new Set(sent.map((e) => e.idempotency_key)).size, sent.length);
});

Deno.test("production regression: recency uses the values the live Actors accept", async () => {
  const { sent } = await runProductionPath();
  const INDEED = ["", "1", "3", "7", "14"];
  for (const env of sent) {
    const input = env.input as Record<string, unknown>;
    if ("datePosted" in input) {
      assert(
        INDEED.includes(String(input.datePosted)),
        `Indeed rejected this in production: ${String(input.datePosted)}`,
      );
    }
    if ("timePostedRange" in input) {
      assert(String(input.timePostedRange).length > 0, "empty timePostedRange was the production defect");
    }
  }
});
