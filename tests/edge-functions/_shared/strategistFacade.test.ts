// FACADE + ADAPTER PARITY TESTS.
//
// The point of these tests is provider independence: the same model response
// must produce a byte-identical canonical answer whichever adapter carried it,
// and the runtime facade must never behave differently because of the transport.
// No network: every call goes through an injected fetch.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createQualifiedLeadStrategist } from "../../../supabase/functions/_shared/strategist.ts";
import { LovableAIStrategistProvider } from "../../../supabase/functions/_shared/adapters/lovableAi.ts";
import { OpenAIStrategistProvider } from "../../../supabase/functions/_shared/adapters/openai.ts";
import { allowedModels, resolveLeadStrategistConfig, DEFAULT_PRIMARY_MODEL } from "../../../supabase/functions/_shared/config.ts";
import { recordLooksSafe, type StrategistObservabilityRecord } from "../../../supabase/functions/_shared/observability.ts";
import type { LeadStrategyMission, LeadStrategyRoundContext } from "../../../supabase/functions/leadStrategyContract.ts";
import type { FeedbackObservationSignals } from "../../../supabase/functions/leadStrategyFeedbackOwner.ts";

const CONFIG = resolveLeadStrategistConfig(() => undefined);
const MODELS = allowedModels(CONFIG);

const MISSION: LeadStrategyMission = {
  original_query: "Find founders of B2B SaaS startups hiring Sales Operations in the United States",
  requested_lead_count: 5,
  requested_titles: ["Sales Operations", "Revenue Operations"],
  decision_maker_roles: ["Founder", "CEO"],
  geography: "United States",
  company_vertical: "B2B SaaS",
  company_size: { min: 10, max: 200 },
  maturity_stages: ["seed", "series_a"],
};

const CONTEXT: LeadStrategyRoundContext = {
  round: 1,
  bottleneck: null,
  last_funnel: null,
  attempted_query_packs: [],
  attempted_sources: [],
  remaining_quota: 5,
  remaining_budget_usd: 4,
  adjacent_titles_allowed: false,
};

const SIGNALS: FeedbackObservationSignals = {
  bottleneck: "poor_source_precision",
  offFamilyRate: 0.8,
  companyBrainFail: 0,
  evidencePending: 0,
  qualifiedCompaniesAwaitingPeople: 0,
  peopleNeedingContact: 0,
  unusedExactPacks: 2,
  unusedAdjacentPacks: 1,
  unusedSources: 2,
  remainingQuota: 5,
  contactReady: 0,
};

const PLAN = {
  role_family: "revenue_operations",
  title_queries: ["Sales Operations", "Revenue Operations"],
  excluded_titles: [],
  query_packs: [{ pack_id: "exact_titles", queries: ["Sales Operations"], rationale: "core" }],
  source_plan: [{ source_key: "yc_jobs", priority: 1, rationale: "startup first" }],
  next_action: "run_query_packs",
  stop_conditions: ["quota_reached"],
  rationale: "narrow first",
  confidence: 0.8,
};

function fetchStub(payload: unknown, seen: string[] = []) {
  return (url: string, init: RequestInit) => {
    seen.push(url);
    void init;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(payload) } }],
          usage: { total_tokens: 7 },
        }),
        { status: 200 },
      ),
    );
  };
}

function lovable(payload: unknown, seen: string[] = []) {
  return new LovableAIStrategistProvider({
    allowedModels: MODELS,
    apiKey: "test-lovable-key",
    fetchImpl: fetchStub(payload, seen),
  });
}

function openai(payload: unknown, seen: string[] = []) {
  return new OpenAIStrategistProvider({
    allowedModels: MODELS,
    apiKey: "test-openai-key",
    fetchImpl: fetchStub(payload, seen),
  });
}

/** Everything downstream is allowed to see. Must not vary by transport. */
function comparable(record: StrategistObservabilityRecord) {
  const { provider: _provider, latency_ms: _latency, usage: _usage, ...rest } = record;
  return rest;
}

Deno.test("initial strategy is identical across adapters", async () => {
  const a = await createQualifiedLeadStrategist({ config: CONFIG, provider: lovable(PLAN) })
    .createInitialStrategy({ mission: MISSION, context: CONTEXT });
  const b = await createQualifiedLeadStrategist({ config: CONFIG, provider: openai(PLAN) })
    .createInitialStrategy({ mission: MISSION, context: CONTEXT });

  assertEquals(a.plan, b.plan);
  assertEquals(a.dropped, b.dropped);
  assertEquals(comparable(a.observability), comparable(b.observability));
  assertEquals(a.observability.outcome, "model_primary_approved");
  assertEquals(a.observability.provider, "lovable_ai");
  assertEquals(b.observability.provider, "openai");
  assertEquals(a.observability.model, DEFAULT_PRIMARY_MODEL);
});

Deno.test("each adapter calls only its own endpoint", async () => {
  const lovableUrls: string[] = [];
  const openaiUrls: string[] = [];
  await createQualifiedLeadStrategist({ config: CONFIG, provider: lovable(PLAN, lovableUrls) })
    .createInitialStrategy({ mission: MISSION, context: CONTEXT });
  await createQualifiedLeadStrategist({ config: CONFIG, provider: openai(PLAN, openaiUrls) })
    .createInitialStrategy({ mission: MISSION, context: CONTEXT });

  assert(lovableUrls.every((u) => u.includes("ai.gateway.lovable.dev")));
  assert(openaiUrls.every((u) => u.includes("api.openai.com")));
});

Deno.test("next action is identical across adapters and is bounded", async () => {
  const payload = { action: "tighten_query_pack", reason: "too much noise", confidence: 0.7 };
  const req = { mission: MISSION, context: CONTEXT, signals: SIGNALS };

  const a = await createQualifiedLeadStrategist({ config: CONFIG, provider: lovable(payload) })
    .chooseNextAction(req);
  const b = await createQualifiedLeadStrategist({ config: CONFIG, provider: openai(payload) })
    .chooseNextAction(req);

  assertEquals(a.action, "tighten_query_pack");
  assertEquals(a.action, b.action);
  assertEquals(a.authority, "model_primary");
  assertEquals(comparable(a.observability), comparable(b.observability));
});

Deno.test("an action outside the allowed menu falls back to the deterministic reading", async () => {
  const rogue = { action: "delete_everything", reason: "trust me" };
  const res = await createQualifiedLeadStrategist({ config: CONFIG, provider: lovable(rogue) })
    .chooseNextAction({ mission: MISSION, context: CONTEXT, signals: SIGNALS });

  assertEquals(res.authority, "deterministic");
  assertEquals(res.action, "tighten_query_pack");
  assertEquals(res.observability.outcome, "deterministic_fallback");
  assert(String(res.observability.failure_reason).startsWith("rejected:action_not_allowed"));
  // Primary AND escalation were both given a chance, and both were rejected.
  assertEquals(res.observability.model_requests, 2);
});

Deno.test("a missing credential degrades to deterministic, never throws", async () => {
  const provider = new OpenAIStrategistProvider({ allowedModels: MODELS, apiKey: null });
  const strategist = createQualifiedLeadStrategist({ config: CONFIG, provider });

  const plan = await strategist.createInitialStrategy({ mission: MISSION, context: CONTEXT });
  assertEquals(plan.observability.outcome, "deterministic_fallback");
  assert(plan.plan.query_packs.length > 0);

  const next = await strategist.chooseNextAction({ mission: MISSION, context: CONTEXT, signals: SIGNALS });
  assertEquals(next.authority, "deterministic");
});

Deno.test("disabled makes zero model requests", async () => {
  const urls: string[] = [];
  const strategist = createQualifiedLeadStrategist({ config: CONFIG, provider: lovable(PLAN, urls) });
  const plan = await strategist.createInitialStrategy({ mission: MISSION, context: CONTEXT, enabled: false });
  const next = await strategist.chooseNextAction({
    mission: MISSION, context: CONTEXT, signals: SIGNALS, enabled: false,
  });

  assertEquals(urls.length, 0);
  assertEquals(plan.observability.model_requests, 0);
  assertEquals(next.observability.failure_reason, "disabled");
});

Deno.test("observability carries provenance, never prompts or credentials", async () => {
  const records: StrategistObservabilityRecord[] = [];
  const strategist = createQualifiedLeadStrategist({
    config: CONFIG,
    provider: openai(PLAN),
    observability: (r) => records.push(r),
  });
  await strategist.createInitialStrategy({
    mission: MISSION, context: CONTEXT, workspaceId: "ws-1", taskId: "task-1",
  });

  assertEquals(records.length, 1);
  const r = records[0];
  assertEquals(r.workspace_id, "ws-1");
  assertEquals(r.task_id, "task-1");
  assertEquals(r.round, 1);
  assert(r.prompt_hash.startsWith("ph_"));
  assert(recordLooksSafe(r));
  const serialized = JSON.stringify(r);
  assertFalse(serialized.includes("test-openai-key"));
  assertFalse(serialized.includes(MISSION.original_query));
});

Deno.test("the same prompt hashes the same way on both providers", async () => {
  const a = await createQualifiedLeadStrategist({ config: CONFIG, provider: lovable(PLAN) })
    .createInitialStrategy({ mission: MISSION, context: CONTEXT });
  const b = await createQualifiedLeadStrategist({ config: CONFIG, provider: openai(PLAN) })
    .createInitialStrategy({ mission: MISSION, context: CONTEXT });
  assertEquals(a.observability.prompt_hash, b.observability.prompt_hash);
});

Deno.test("an observability sink that throws cannot break a resolution", async () => {
  const strategist = createQualifiedLeadStrategist({
    config: CONFIG,
    provider: lovable(PLAN),
    observability: () => { throw new Error("sink down"); },
  });
  const res = await strategist.createInitialStrategy({ mission: MISSION, context: CONTEXT });
  assertEquals(res.observability.outcome, "model_primary_approved");
});
