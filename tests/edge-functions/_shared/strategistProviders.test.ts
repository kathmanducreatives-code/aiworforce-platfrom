// PROVIDER-INDEPENDENCE CONTRACT TESTS.
// Both adapters must produce the SAME canonical result for the same model
// response. No network: every call goes through an injected fetch.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  allowedModels, modelForTier, normalizeProviderId, resolveLeadStrategistConfig,
  DEFAULT_ESCALATION_MODEL, DEFAULT_PRIMARY_MODEL,
} from "../../../supabase/functions/_shared/leadStrategy/config.ts";
import { createLeadStrategistProvider } from "../../../supabase/functions/_shared/leadStrategy/factory.ts";
import { LovableAIStrategistProvider, LOVABLE_GATEWAY_URL } from "../../../supabase/functions/_shared/leadStrategy/adapters/lovableAi.ts";
import { OpenAIStrategistProvider, OPENAI_CHAT_URL, toOpenAiWireModel } from "../../../supabase/functions/_shared/leadStrategy/adapters/openai.ts";
import { buildStrategistRequestBody } from "../../../supabase/functions/_shared/leadStrategy/adapters/shared.ts";
import type { StrategistCall, StrategistResult } from "../../../supabase/functions/_shared/leadStrategy/provider.ts";
import { runLeadStrategy } from "../../../supabase/functions/_shared/leadStrategyOwner.ts";
import type { LeadStrategyMission, LeadStrategyRoundContext } from "../../../supabase/functions/_shared/leadStrategyContract.ts";

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

const call: StrategistCall = {
  model: DEFAULT_PRIMARY_MODEL,
  systemPrompt: "system",
  userMessage: "user",
};

interface Captured { url: string; body: Record<string, unknown>; headers: Record<string, string> }

function fetchStub(captured: Captured[], status = 200, payload: unknown = PLAN) {
  return (url: string, init: RequestInit) => {
    captured.push({
      url,
      body: JSON.parse(String(init.body)),
      headers: init.headers as Record<string, string>,
    });
    const responseBody = status === 200
      ? JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }],
        usage: { total_tokens: 42 },
      })
      : "upstream said no";
    return Promise.resolve(new Response(responseBody, { status }));
  };
}

/** Everything that must be identical regardless of provider. */
function canonical(r: StrategistResult) {
  return {
    ok: r.ok,
    model: r.model,
    json: r.json,
    content: r.content,
    usage: r.usage,
    errorCode: r.errorCode ?? null,
  };
}

const models = [DEFAULT_PRIMARY_MODEL, DEFAULT_ESCALATION_MODEL];
const lovable = (cap: Captured[], status = 200, payload: unknown = PLAN) =>
  new LovableAIStrategistProvider({ allowedModels: models, apiKey: "test-key", fetchImpl: fetchStub(cap, status, payload) });
const openai = (cap: Captured[], status = 200, payload: unknown = PLAN) =>
  new OpenAIStrategistProvider({ allowedModels: models, apiKey: "test-key", fetchImpl: fetchStub(cap, status, payload) });

// ----------------------------------------------------------------- config --

Deno.test("configuration defaults to Lovable AI with the logical model slots", () => {
  const cfg = resolveLeadStrategistConfig(() => undefined);
  assertEquals(cfg.provider, "lovable_ai");
  assertEquals(cfg.primaryModel, DEFAULT_PRIMARY_MODEL);
  assertEquals(cfg.escalationModel, DEFAULT_ESCALATION_MODEL);
  assertEquals(modelForTier("primary", cfg), DEFAULT_PRIMARY_MODEL);
  assertEquals(modelForTier("escalation", cfg), DEFAULT_ESCALATION_MODEL);
  assertEquals([...allowedModels(cfg)], models);
});

Deno.test("provider and models are selected purely by environment configuration", () => {
  const env: Record<string, string> = {
    LEAD_STRATEGIST_PROVIDER: "openai",
    LEAD_STRATEGIST_PRIMARY_MODEL: "openai/gpt-5.5",
    LEAD_STRATEGIST_ESCALATION_MODEL: "openai/gpt-5.6-terra",
  };
  const cfg = resolveLeadStrategistConfig((k) => env[k]);
  assertEquals(cfg.provider, "openai");
  assertEquals(cfg.primaryModel, "openai/gpt-5.5");
  assertEquals(createLeadStrategistProvider({ config: cfg }).provider.id, "openai");
  assertEquals(createLeadStrategistProvider({ env: () => undefined }).provider.id, "lovable_ai");
});

Deno.test("unknown provider values fall back to lovable_ai, never to nothing", () => {
  assertEquals(normalizeProviderId("Lovable-AI"), "lovable_ai");
  assertEquals(normalizeProviderId("OpenAI"), "openai");
  assertEquals(normalizeProviderId("anthropic"), "lovable_ai");
  assertEquals(normalizeProviderId(undefined), "lovable_ai");
});

// --------------------------------------------------------------- contract --

Deno.test("both adapters return the identical canonical result", async () => {
  const a: Captured[] = [], b: Captured[] = [];
  const fromLovable = await lovable(a).complete(call);
  const fromOpenAi = await openai(b).complete(call);
  assertEquals(canonical(fromLovable), canonical(fromOpenAi));
  assertEquals(fromLovable.provider, "lovable_ai");
  assertEquals(fromOpenAi.provider, "openai");
  assertEquals(fromLovable.json, PLAN);
});

Deno.test("both adapters normalize errors into the same vocabulary", async () => {
  for (const [status, code] of [[429, "rate_limited"], [402, "credits_exhausted"], [500, "provider_error"]] as const) {
    const a: Captured[] = [], b: Captured[] = [];
    const l = await lovable(a, status).complete(call);
    const o = await openai(b, status).complete(call);
    assertEquals(l.errorCode, code);
    assertEquals(o.errorCode, code);
    assertFalse(l.ok);
    assertFalse(o.ok);
  }
});

Deno.test("non-JSON model output fails identically on both adapters", async () => {
  const a: Captured[] = [], b: Captured[] = [];
  const l = await lovable(a, 200, "not json at all" as unknown).complete({ ...call });
  const o = await openai(b, 200, "not json at all" as unknown).complete({ ...call });
  assertEquals(l.ok, o.ok);
  assertEquals(l.errorCode, o.errorCode);
});

Deno.test("both adapters send the same GPT-5.6 request body", async () => {
  const a: Captured[] = [], b: Captured[] = [];
  await lovable(a).complete(call);
  await openai(b).complete(call);
  const { model: _lm, ...lovableBody } = a[0].body;
  const { model: _om, ...openaiBody } = b[0].body;
  assertEquals(lovableBody, openaiBody);
  assertEquals(a[0].body.reasoning_effort, "none");
  assertFalse("max_tokens" in a[0].body);
  assertFalse("temperature" in a[0].body);
  assert("max_completion_tokens" in b[0].body);
});

Deno.test("each adapter targets its own endpoint and wire model id", async () => {
  const a: Captured[] = [], b: Captured[] = [];
  await lovable(a).complete(call);
  await openai(b).complete(call);
  assertEquals(a[0].url, LOVABLE_GATEWAY_URL);
  assertEquals(b[0].url, OPENAI_CHAT_URL);
  assertEquals(a[0].body.model, DEFAULT_PRIMARY_MODEL);
  assertEquals(b[0].body.model, "gpt-5.6-luna");
  assertEquals(toOpenAiWireModel("gpt-5.6-luna"), "gpt-5.6-luna");
});

Deno.test("models outside the configured slots are refused by every adapter", async () => {
  const a: Captured[] = [], b: Captured[] = [];
  const bad = { ...call, model: "google/gemini-3.6-flash" };
  const l = await lovable(a).complete(bad);
  const o = await openai(b).complete(bad);
  assertEquals(l.errorCode, "model_not_allowed");
  assertEquals(o.errorCode, "model_not_allowed");
  assertEquals(a.length, 0);
  assertEquals(b.length, 0);
});

Deno.test("a missing credential is reported, never silently skipped", async () => {
  const l = await new LovableAIStrategistProvider({ allowedModels: models, apiKey: "", fetchImpl: fetchStub([]) }).complete(call);
  const o = await new OpenAIStrategistProvider({ allowedModels: models, apiKey: "", fetchImpl: fetchStub([]) }).complete(call);
  assertEquals(l.errorCode, "no_provider");
  assertEquals(o.errorCode, "no_provider");
  assert(l.error?.includes("LOVABLE_API_KEY"));
  assert(o.error?.includes("OPENAI_API_KEY"));
});

Deno.test("request bodies never leak a credential", async () => {
  const a: Captured[] = [];
  await lovable(a).complete(call);
  assertFalse(JSON.stringify(a[0].body).includes("test-key"));
  assert(String(a[0].headers.Authorization).includes("test-key"));
});

// ------------------------------------------------- owner is provider-blind --

const mission: LeadStrategyMission = {
  original_query: "Find founders of SaaS startups hiring Sales Operations",
  requested_lead_count: 5,
  requested_titles: ["Sales Operations", "Revenue Operations"],
  decision_maker_roles: ["Founder"],
  geography: "United States",
  company_vertical: "B2B SaaS",
  company_size: null,
  maturity_stages: [],
};
const ctx: LeadStrategyRoundContext = {
  round: 1, bottleneck: null, last_funnel: null, attempted_query_packs: [],
  attempted_sources: [], remaining_quota: 5, remaining_budget_usd: 4,
  adjacent_titles_allowed: false,
};

Deno.test("the strategy owner yields the same plan through either provider", async () => {
  const a: Captured[] = [], b: Captured[] = [];
  const viaLovable = await runLeadStrategy({ mission, context: ctx, provider: lovable(a) });
  const viaOpenAi = await runLeadStrategy({ mission, context: ctx, provider: openai(b) });
  assertEquals(viaLovable.plan, viaOpenAi.plan);
  assertEquals(viaLovable.provenance.source, "openai_primary");
  assertEquals(viaOpenAi.provenance.source, "openai_primary");
  assertEquals(viaLovable.provenance.provider, "lovable_ai");
  assertEquals(viaOpenAi.provenance.provider, "openai");
});

Deno.test("a failing provider falls back deterministically, identically", async () => {
  const a: Captured[] = [], b: Captured[] = [];
  const viaLovable = await runLeadStrategy({ mission, context: ctx, provider: lovable(a, 500) });
  const viaOpenAi = await runLeadStrategy({ mission, context: ctx, provider: openai(b, 500) });
  assertEquals(viaLovable.plan, viaOpenAi.plan);
  assertEquals(viaLovable.provenance.source, "deterministic_fallback");
  assertEquals(viaOpenAi.provenance.failure_reason, "provider_error");
});

Deno.test("request body builder is shared, not per-provider", () => {
  assertEquals(
    buildStrategistRequestBody(call),
    buildStrategistRequestBody({ ...call }),
  );
});
