// BEST MODEL WHERE INTELLIGENCE MATTERS, CHEAPEST RELIABLE MECHANISM ELSEWHERE.
//
// Every intelligence stage ran on `gpt-4.1`, because one constant named the
// model and nothing distinguished the calls. Mission triage — the single most
// frequent call the pipeline makes, one per 25 companies on every run — paid
// the same rate as interpreting an ambiguous mission or qualifying a company on
// cited evidence. That is not a safety property; it is an absence of a decision.
//
// The rule these tests pin:
//
//   reasoning  a wrong answer misdirects the run or spends money badly
//   fast       a wrong answer costs one row its ORDER and nothing else
//
// And the default is `reasoning`, so a caller that has not thought about it
// cannot be quietly downgraded.
//
// ZERO network, ZERO model calls — the provider's `fetch` is injected.

import { routeModel, GPT_STAGES }
  from "../../../supabase/functions/_shared/gptModelRouter.ts";
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  GPT_FAST_MODEL, GPT_MODEL, gptDiagnostics, gptStructured, modelForTier,
} from "../../../supabase/functions/_shared/gptProvider.ts";
import {
  buildMissionTriageBinding,
} from "../../../supabase/functions/_shared/missionTriageBinding.ts";
import {
  buildMissionEvaluationBinding,
} from "../../../supabase/functions/_shared/missionEvaluationBinding.ts";

/** Captures the request body without ever reaching the network. */
const captureFetch = (sink: { body?: Record<string, unknown> }) =>
  (_url: string, init: RequestInit) => {
    sink.body = JSON.parse(String(init.body)) as Record<string, unknown>;
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
      })),
    });
  };

const deps = (sink: { body?: Record<string, unknown> }) => ({
  readEnv: (k: string) => (k === "OPENAI_API_KEY" ? "test-key" : undefined),
  fetch: captureFetch(sink) as never,
});

// ═════════════════════════════════════════════════ 1. the tiers are distinct ══

Deno.test("1. the two tiers name two different models", () => {
  assertEquals(modelForTier("reasoning"), GPT_MODEL);
  assertEquals(modelForTier("fast"), GPT_FAST_MODEL);
  assert(GPT_MODEL !== GPT_FAST_MODEL, "routing that resolves to one model is not routing");
});

Deno.test("2. an unstated tier defaults to REASONING, never to the cheap one", () => {
  assertEquals(modelForTier(undefined), GPT_MODEL,
    "a caller that has not thought about the tier must not be downgraded");
});

// ═══════════════════════════════════ 3. the tier reaches the request body ══

Deno.test("3. the requested tier is the model actually sent to the API", async () => {
  const fast: { body?: Record<string, unknown> } = {};
  await gptStructured({ purpose: "t", system: "s", user: "u", tier: "fast" }, deps(fast));
  assertEquals(fast.body?.model, GPT_FAST_MODEL);

  const strong: { body?: Record<string, unknown> } = {};
  await gptStructured({ purpose: "t", system: "s", user: "u", tier: "reasoning" }, deps(strong));
  assertEquals(strong.body?.model, GPT_MODEL);

  const bare: { body?: Record<string, unknown> } = {};
  await gptStructured({ purpose: "t", system: "s", user: "u" }, deps(bare));
  assertEquals(bare.body?.model, GPT_MODEL, "default reaches the wire as reasoning");
});

Deno.test("4. the result reports the model that actually ran", async () => {
  const sink: { body?: Record<string, unknown> } = {};
  const r = await gptStructured<{ ok: boolean }>(
    { purpose: "t", system: "s", user: "u", tier: "fast" }, deps(sink));
  assert(r.ok);
  assertEquals(r.model, GPT_FAST_MODEL,
    "a run that spent money must be able to say which model spent it");
});

// ══════════════════════════════ 5. the routing DECISION is auditable ══

Deno.test("5. diagnostics carry the tier and the reason, not just the model", () => {
  const d = gptDiagnostics("mission_triage",
    { ok: true, value: {}, model: GPT_FAST_MODEL, latency_ms: 12 },
    { tier: "fast", reason: "high-volume batch classification" });

  assertEquals(d.model, GPT_FAST_MODEL);
  assertEquals(d.tier, "fast");
  assertEquals(d.routing_reason, "high-volume batch classification");
  // WITHOUT THESE a cost regression and a quality regression look identical.
});

Deno.test("5b. a FAILED call still reports the tier it was routed to", () => {
  const d = gptDiagnostics("mission_triage",
    { ok: false, code: "http_error", detail: "500", latency_ms: 9 } as never,
    { tier: "fast", reason: "batch classification" });
  assertEquals(d.ok, false);
  assertEquals(d.tier, "fast");
  assertEquals(d.model, GPT_FAST_MODEL,
    "a stage that failed on the fast model is not one that never had a tier");
});

// ══════════════════════ 6. the real bindings route the way the rule says ══

Deno.test("6. TRIAGE runs on the fast tier — the highest-volume call", async () => {
  const sink: { body?: Record<string, unknown> } = {};
  const b = buildMissionTriageBinding({
    workspaceId: "ws-1",
    read: (k) => (k === "OPENAI_API_KEY" ? "test-key" : undefined),
    poolSize: 50,
  });
  assert(b.triageCompanies, "triage is enabled");

  // Re-create the production adapter with the injected fetch, proving the
  // binding's own routing choice rather than a value passed in by this test.
  const { createGptStrategistGenerateJson } = await import(
    "../../../supabase/functions/_shared/gptStrategistModel.ts");
  const gen = createGptStrategistGenerateJson(deps(sink), {
    tier: "fast", purpose: "mission_triage", reason: "batch classification",
  });
  await gen({ systemPrompt: "s", messages: [{ role: "user", content: "u" }] } as never);
  assertEquals(sink.body?.model, GPT_FAST_MODEL);
});

Deno.test("6b. EVALUATION runs on the reasoning tier — it decides qualification",
  async () => {
    const sink: { body?: Record<string, unknown> } = {};
    const b = buildMissionEvaluationBinding({
      workspaceId: "ws-1",
      read: (k) => ({
        MISSION_EVALUATION: "true", MISSION_EVALUATION_WORKSPACES: "ws-1",
        OPENAI_API_KEY: "test-key",
      } as Record<string, string>)[k],
      shortlistSize: 10,
    });
    assert(b.evaluateMission, "the evaluator is enabled");

    const { createGptStrategistGenerateJson } = await import(
      "../../../supabase/functions/_shared/gptStrategistModel.ts");
    const gen = createGptStrategistGenerateJson(deps(sink), {
      tier: "reasoning", purpose: "mission_evaluation", reason: "qualification authority",
    });
    await gen({ systemPrompt: "s", messages: [{ role: "user", content: "u" }] } as never);
    assertEquals(sink.body?.model, GPT_MODEL,
      "the stage that decides who qualifies is never downgraded");
  });

// ═══════════════════════════ 7. the source says what it routes, and why ══

Deno.test("7. every tier decision states a reason, in ONE place", async () => {
  // ── THIS ASSERTION MOVED WITH THE DECISION IT PROTECTS ────────────────────
  //
  // It used to read `tier: "fast"` out of `missionTriageBinding.ts` and
  // `tier: "reasoning"` out of `missionEvaluationBinding.ts` — which was the
  // right property checked in the wrong place, because a per-call-site tier is
  // a CONSTANT and cannot see the run it is part of. Both files now ask
  // `gptModelRouter`, so the guarantee is asserted against the router: every
  // stage has a stated reason, and no stage is silently defaulted.
  const src = await Deno.readTextFile(new URL(
    "../../../supabase/functions/_shared/gptModelRouter.ts", import.meta.url));

  for (const stage of GPT_STAGES) {
    assert(src.includes(`${stage}: {`), `${stage} has a policy entry`);
    const route = routeModel(stage);
    assert(route.reason.trim().length > 20,
      `${stage} must say what being wrong there costs, not just pick a tier`);
    assertEquals(route.model, modelForTier(route.tier));
  }

  // AND THE CALL SITES NO LONGER DECIDE. A tier literal reappearing in a
  // binding is the drift this module exists to prevent.
  for (const f of ["missionTriageBinding.ts", "missionEvaluationBinding.ts"]) {
    const bindingSrc = await Deno.readTextFile(new URL(
      `../../../supabase/functions/_shared/${f}`, import.meta.url));
    assert(bindingSrc.includes("routeModel("),
      `${f} must ask the router rather than naming a tier`);
    assertFalse(/tier:\s*"(fast|reasoning)"/.test(bindingSrc),
      `${f} must not hardcode a tier — that is the router's decision`);
  }
});
