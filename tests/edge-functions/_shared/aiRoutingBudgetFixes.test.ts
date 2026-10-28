// Routing, budget and pricing corrections to PR #196 (failed self-review of
// da3c0b08): the mission-level escalation cap reaches the engine's real repair
// rounds; the compiler binding's v2 repair is bounded; gpt-6.1-sol's effort
// floor reaches the strategist; a body that cannot be built is a failed call,
// not a throw or a leaked timer; cache writes are priced where OpenAI charges
// them. Pure: no network, no model, no key.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_MISSION_ESCALATION_CAP, MISSION_ESCALATION_CAP_ENV, missionEscalationCap,
} from "../../../supabase/functions/_shared/modelEscalation.ts";
import { MODEL_FAMILY_ENV } from "../../../supabase/functions/_shared/gptModelRouter.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { mergeCompanyBrainIntoMission, parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { readinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { runCapabilityPlan } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { candidatePool, parseRunBudget } from "../../../supabase/functions/_shared/runBudget.ts";
import { emptyDiscoverySelector } from "./discoverySelectorFixture.ts";
import {
  buildMissionCompilerBinding, interpretationProblems,
} from "../../../supabase/functions/_shared/leadMissionCompilerBinding.ts";
import { baseProposal, INTERPRETATION_CORPUS, proposalFor } from "../../../scripts/model-routing-eval/interpretationCorpus.ts";
import {
  buildStrategistRequestBody, completeOpenAiCompatible,
} from "../../../supabase/functions/_shared/leadStrategy/adapters/shared.ts";
import { gptStructured } from "../../../supabase/functions/_shared/gptProvider.ts";
import { priceModelCall, readModelUsage } from "../../../supabase/functions/_shared/modelCostModel.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

// ── THE MISSION ESCALATION CAP ──────────────────────────────────────────────

const env = (o: Record<string, string>) => (k: string) => o[k];

Deno.test("missionEscalationCap: none on the default family; 3 under gpt-6; overridable; 0 disables", () => {
  assertEquals(missionEscalationCap("gpt-5.6", env({})), null);
  assertEquals(missionEscalationCap("gpt-5.6", env({ [MISSION_ESCALATION_CAP_ENV]: "1" })), null, "default family is untouched");
  assertEquals(missionEscalationCap("gpt-6", env({})), DEFAULT_MISSION_ESCALATION_CAP);
  assertEquals(missionEscalationCap("gpt-6", env({ [MISSION_ESCALATION_CAP_ENV]: "0" })), 0);
  assertEquals(missionEscalationCap("gpt-6", env({ [MISSION_ESCALATION_CAP_ENV]: "5" })), 5);
  assertEquals(missionEscalationCap("gpt-6", env({ [MISSION_ESCALATION_CAP_ENV]: "lots" })), DEFAULT_MISSION_ESCALATION_CAP);
  assertEquals(missionEscalationCap("gpt-6", env({ [MISSION_ESCALATION_CAP_ENV]: "-2" })), DEFAULT_MISSION_ESCALATION_CAP);
});

const PROBE = readinessPolicy({ mode: "provider_probe", probe_routes: ["apify_linkedin_company_search|general_company_discovery"] });
const CANARY = (() => {
  const m = parseLeadMissionDeterministic("Find 1 US company with 11-50 employees that raised funding in the last 6 months");
  const stated = {
    ...m, company_profile: { ...m.company_profile, employee_range: { min: 11, max: 50 } },
    field_provenance: { ...m.field_provenance, "company_profile.employee_range": "explicit_user_request" as const },
  };
  return mergeCompanyBrainIntoMission(stated, { industries: ["b2b saas", "fintech"] } as never).mission;
})();
const VALID = { reasoning: "ok", steps: [
  { capability: "general_company_discovery", actor_key: "apify_linkedin_company_search", purpose: "d",
    input: { locations: ["United States"], companySize: ["11-50"], maxItems: 2, scraperMode: "full" }, depends_on: [] },
  { capability: "company_enrichment", actor_key: "apify_linkedin_company_details", purpose: "e", input: { companies: ["{{url}}"] }, depends_on: [1] },
  { capability: "company_brain_qualification", actor_key: null, purpose: "q", input: {}, depends_on: [2] },
  { capability: "persistence", actor_key: null, purpose: "p", input: {}, depends_on: [3] },
] };

/** One engine run whose first execution plan is refused (empty), so a repair round is wanted. */
async function runWithRefusedFirstPlan(extraEnv: Record<string, string>, state?: Record<string, unknown>) {
  const logs: Array<[string, Record<string, unknown>]> = [];
  let asked = 0;
  const budget = parseRunBudget({ provider_usd: 0.04, max_candidates: 2 })!;
  let error: unknown = null;
  try {
    await runCapabilityPlan({
      log: (m: string, meta?: Record<string, unknown>) => logs.push([m, meta ?? {}]),
      planDiscovery: emptyDiscoverySelector(),
      planExecution: () => Promise.resolve(asked++ === 0 ? { reasoning: "nothing qualifies", steps: [] } : VALID),
      controlRoutes: () => Promise.resolve({ action: "continue" }),
      invoke: () => Promise.resolve([]),
      verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    } as never, {
      mission: CANARY, plan: buildCapabilityGraph(CANARY, { executability: "enforce", readiness: PROBE }),
      maxCandidates: candidatePool(1, budget), runBudget: budget, readiness: PROBE,
      readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : extraEnv[k]),
      specMode: "enforce", specScope: { workspace_id: "ws", lineage_id: "ln" },
      ...(state ? { state } : {}),
    } as never);
  } catch (e) { error = e; }
  return { logs, asked, error };
}

Deno.test("ENGINE: the default family repairs a refused plan exactly as before (no cap)", async () => {
  const r = await runWithRefusedFirstPlan({});
  assertEquals(r.asked, 2, "one repair round");
  assertFalse(r.logs.some(([m]) => m === "mission_escalation_budget_exhausted"));
});

Deno.test("ENGINE: under gpt-6 the repair spends the mission cap; at cap 0 the refusal stands and nothing more is asked", async () => {
  const spent = await runWithRefusedFirstPlan({ [MODEL_FAMILY_ENV]: "gpt-6", [MISSION_ESCALATION_CAP_ENV]: "1" });
  assertEquals(spent.asked, 2, "within the cap the repair runs");
  const blocked = await runWithRefusedFirstPlan({ [MODEL_FAMILY_ENV]: "gpt-6", [MISSION_ESCALATION_CAP_ENV]: "0" });
  assertEquals(blocked.asked, 1, "past the cap no escalation call is made");
  const exhausted = blocked.logs.find(([m]) => m === "mission_escalation_budget_exhausted");
  assert(exhausted, JSON.stringify(blocked.logs.map(([m]) => m)));
  assertEquals(exhausted![1].stage, "execution_plan_repair");
  assert(blocked.logs.some(([m, meta]) => m === "execution_plan_blocked" && meta.reason === "mission escalation budget exhausted"));
});

// ── THE COMPILER BINDING: ONE BOUNDED v2 REPAIR ─────────────────────────────

const T1 = INTERPRETATION_CORPUS[0];
const T1_GOOD = proposalFor(T1, T1.windows, "v2");
const A7 = INTERPRETATION_CORPUS[1];
const A7_BAD = proposalFor(A7, [], "v2");
const A7_GOOD = proposalFor(A7, A7.windows, "v2");

Deno.test("interpretationProblems: the compiler's own refusals, without the prefix; none for a good proposal", () => {
  assertEquals(interpretationProblems(A7.request, A7_BAD, 1), ["timeframe_unaccounted:within 30 days"]);
  assertEquals(interpretationProblems(A7.request, A7_GOOD, 1), []);
  assertEquals(interpretationProblems(T1.request, T1_GOOD, 5), []);
});

function fakeGenerate(answers: unknown[]) {
  const sent: string[] = [];
  const generate = (req: { messages: Array<{ content: string }> }) => {
    sent.push(req.messages[0].content);
    const json = answers[Math.min(sent.length - 1, answers.length - 1)];
    return Promise.resolve({ ok: true, json });
  };
  return { generate, sent };
}

Deno.test("BINDING v2: a proposal the compiler would refuse is asked again ONCE, with the exact problems", async () => {
  const f = fakeGenerate([A7_BAD, A7_GOOD]);
  const b = buildMissionCompilerBinding({ workspaceId: "ws", read: () => undefined, generate: f.generate as never });
  const out = await b.proposeMission!({ originalUserQuery: A7.request, requestedCount: 1, contract: "v2" } as never);
  assertEquals(f.sent.length, 2);
  assertEquals(out, A7_GOOD);
  const second = JSON.parse(f.sent[1]);
  assertEquals(second.repair_feedback.problems, ["timeframe_unaccounted:within 30 days"]);
  assertFalse("repair_feedback" in JSON.parse(f.sent[0]));
});

Deno.test("BINDING v2: never more than two calls — a still-bad answer is returned and the compile fails closed", async () => {
  const f = fakeGenerate([A7_BAD, A7_BAD, A7_BAD]);
  const b = buildMissionCompilerBinding({ workspaceId: "ws", read: () => undefined, generate: f.generate as never });
  const out = await b.proposeMission!({ originalUserQuery: A7.request, requestedCount: 1, contract: "v2" } as never);
  assertEquals(f.sent.length, 2);
  assertEquals(out, A7_BAD);
});

Deno.test("BINDING v1: unchanged — a readable proposal is returned on the first call, whatever it says", async () => {
  const f = fakeGenerate([{ ...baseProposal(), signal_windows: [] }, A7_GOOD]);
  const b = buildMissionCompilerBinding({ workspaceId: "ws", read: () => undefined, generate: f.generate as never });
  await b.proposeMission!({ originalUserQuery: A7.request, requestedCount: 1, contract: "v1" } as never);
  assertEquals(f.sent.length, 1);
});

// ── SOL'S EFFORT FLOOR, AND BODIES THAT CANNOT BE BUILT ─────────────────────

const call = { model: "gpt-5.6-luna", systemPrompt: "s", userMessage: "u" };

Deno.test("STRATEGIST: gpt-6.1-sol gets its effort floor instead of a refused 'none'; other models unchanged", () => {
  assertEquals(buildStrategistRequestBody({ ...call, model: "gpt-6.1-sol" }).reasoning_effort, "low");
  assertEquals(buildStrategistRequestBody(call), buildStrategistRequestBody(call), "deterministic");
  assertFalse(buildStrategistRequestBody(call).reasoning_effort === "low");
});

Deno.test("STRATEGIST: a body that cannot be built is a failed call, and its timer is released", async () => {
  const broken = { ...call, get systemPrompt(): string { throw new Error("boom"); } };
  let fetched = 0;
  const r = await completeOpenAiCompatible(broken as never, {
    provider: "openai" as never, endpoint: "https://example.invalid", headers: {},
    fetchImpl: (() => { fetched++; throw new Error("no"); }) as never,
  });
  assertFalse(r.ok);
  assertEquals((r as { errorCode?: string }).errorCode, "request_build_failed");
  assertEquals(fetched, 0);
  // Deno's op sanitizer fails this test if the abort timer were still pending.
});

Deno.test("GPT PROVIDER: Sol with effort 'none' is a request_build_failed result, never a throw or a request", async () => {
  let fetched = 0;
  const r = await gptStructured({ purpose: "t", system: "s", user: "u", model: "gpt-6.1-sol", reasoningEffort: "none" } as never, {
    readEnv: (k) => (k === "OPENAI_API_KEY" ? "sk-test" : undefined),
    fetch: () => { fetched++; return Promise.reject(new Error("no")); },
  });
  assertFalse(r.ok);
  assertEquals((r as { code: string }).code, "request_build_failed");
  assertEquals((r as { retryable: boolean }).retryable, false);
  assertEquals(fetched, 0);
});

// ── CACHE WRITES ARE PRICED WHERE THEY ARE CHARGED ──────────────────────────

Deno.test("PRICING: cache writes are read only when reported", () => {
  const plain = readModelUsage({ usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } } });
  assertFalse("cache_write_input_tokens" in plain);
  const w = readModelUsage({ usage: { prompt_tokens: 10, completion_tokens: 2,
    prompt_tokens_details: { cached_tokens: 4, cache_write_tokens: 6, cache_write_tokens_details: { ttl_12h_tokens: 2 } } } });
  assertEquals(w.cache_write_input_tokens, 6);
  assertEquals(w.cache_write_12h_tokens, 2);
});

Deno.test("PRICING: gpt-6 cache writes cost the write rate; gpt-5.6 pricing is byte-identical to Candidate C", () => {
  const base = { input_tokens: 10_000, cached_input_tokens: 2_000, output_tokens: 1_000 };
  const writes = { ...base, cache_write_input_tokens: 8_000 };
  const usd = (model: string, usage: typeof base) => priceModelCall({ model, usage }).estimated_usd!;
  // gpt-5.6: no write rate modelled (pre-existing, documented gap) — unchanged.
  assertEquals(usd("gpt-5.6-luna", writes), usd("gpt-5.6-luna", base));
  // gpt-6-luna: $0.10 in, $0.125 write per 1M → 8,000 writes add 8000 × (0.125 − 0.10) / 1e6.
  const delta = usd("gpt-6-luna", writes) - usd("gpt-6-luna", base);
  assert(Math.abs(delta - 8_000 * (0.125 - 0.10) / 1e6) < 1e-9, String(delta));
  const solDelta = usd("gpt-6.1-sol", writes) - usd("gpt-6.1-sol", base);
  assert(Math.abs(solDelta - 8_000 * (2.5 - 2) / 1e6) < 1e-9, String(solDelta));
  // An unknown model is never priced at $0.
  assertEquals(priceModelCall({ model: "gpt-7-x", usage: base }).source, "unknown");
});
