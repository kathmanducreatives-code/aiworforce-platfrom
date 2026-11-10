// AI MODEL / PROMPT / CONTEXT AUDIT — isolated verification (2026-11).
//
// What is REAL here: the repository's own routing, prompt-building, context-
// loading, validation and model-selection code. What is MOCKED: every model
// response (a fake OpenAI / Anthropic transport returns a recorded answer) and
// every database read (an in-memory table). No network, no paid model, no
// provider, no database. Fictional data only.
//
//   deno test --allow-read --allow-env docs/audits/agentory-ai-model-context-architecture-2026-11/
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateText, plannedAttempts, TASK_MODELS } from "../../../supabase/functions/_shared/aiProvider.ts";
import { GPT_STAGES, routeModel } from "../../../supabase/functions/_shared/gptModelRouter.ts";
import { DEFAULT_ESCALATION_MODEL, DEFAULT_PRIMARY_MODEL, resolveLeadStrategistConfig } from "../../../supabase/functions/_shared/leadStrategy/config.ts";
import { DEFAULT_IMAGE_MODEL } from "../../../supabase/functions/_shared/imageProvider.ts";
import { MODEL_PRICES } from "../../../supabase/functions/_shared/modelCostModel.ts";
import { resolveSpendEnforcement, resolveRunBudget } from "../../../supabase/functions/_shared/modelSpendCeiling.ts";
import { understandRequest } from "../../../supabase/functions/_shared/chatBrain.ts";
import { routeRequest } from "../../../supabase/functions/_shared/objectiveRouter.ts";
import { bindRoute } from "../../../supabase/functions/_shared/chatBrainBinding.ts";
import { classifyWorkspaceQuestion } from "../../../supabase/functions/_shared/workspaceQuestions.ts";
import { getAgentorySystemPrompt } from "../../../supabase/functions/_shared/agentorySystemPrompt.ts";
import { converseSystemPrompt } from "../../../supabase/functions/_shared/converseSurface.ts";
import { applyModelWording, MODEL_INSTRUCTIONS } from "../../../supabase/functions/_shared/executiveBrief.ts";
import { loadMissionContext, loadMissionContextWithMemory } from "../../../supabase/functions/_shared/intelligence/missionContext.ts";
import { loadCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainContextLoader.ts";
import { buildCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainContext.ts";
import { toBrainTurns } from "../../../supabase/functions/_shared/conversationTurns.ts";
import { verify } from "../../../supabase/functions/_shared/lisa/verify.ts";
import { normalizeAtlasResult, orionReads } from "../../../supabase/functions/_shared/collab/atlasToOrion.ts";

const ROOT = new URL("../../../", import.meta.url);
const src = (p: string) => Deno.readTextFileSync(new URL(p, ROOT));
const WS = "aaaaaaaa-0000-4000-8000-0000000000a1";
const USER = "11111111-0000-4000-8000-0000000000b2";

// ── fakes ──────────────────────────────────────────────────────────────────
type Part = Record<string, unknown>;
const part = (objective: string, entity: string, o: { shape?: string; count?: number | null; refs?: unknown[]; filters?: unknown[] } = {}): Part => ({
  id: "p1", objective, subject: { entity, references: o.refs ?? [], filters: o.filters ?? [] }, requirements: [],
  output: { shape: o.shape ?? "answer", count: o.count ?? null, completeness: "sample", medium: "text" }, depends_on: [],
});
/** A recorded OpenAI completion for Chat Brain. Captures the request body the code would have sent. */
function fakeOpenAI(p: Part) {
  const sent: Array<{ model: string; messages: Array<{ role: string; content: string }> }> = [];
  const fetch = (_u: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ parts: [p], ambiguity: [], confidence: 0.9 }) } }],
      usage: { prompt_tokens: 1800, completion_tokens: 250 },
    })) });
  };
  return { sent, deps: { fetch, readEnv: (k: string) => (k === "OPENAI_API_KEY" ? "test-placeholder-not-a-key" : undefined) } };
}
async function route(utterance: string, p: Part) {
  const f = fakeOpenAI(p);
  const u = await understandRequest(utterance, { conversation: [] }, f.deps);
  if (!u.ok) throw new Error(`not understood: ${u.reason}`);
  const r = routeRequest(u.request, { spendAllowed: true });
  return { model: f.sent[0].model, systemPrompt: f.sent[0].messages[0].content, route: r.kind, binding: bindRoute(r) };
}
type Row = Record<string, unknown>;
function db(tables: Record<string, Row[]>) {
  const make = (t: string) => {
    let rows = [...(tables[t] ?? [])];
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select() { return q; }, order() { return q; },
      eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
      in(c: string, vs: unknown[]) { rows = rows.filter((r) => vs.includes(r[c])); return q; },
      limit(n: number) { rows = rows.slice(0, n); return q; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null }); },
      then(res: (v: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(res); },
    };
    return q;
  };
  return { from: make };
}
const EVEREST_PROFILE = { schema_version: 2, company: { name: "Everest Industrial Automation (fictional)" },
  target_customer: { industries: ["Manufacturing"], geography: ["United States"] }, brand_voice: { tone: "Formal" } };
const tables = (extra: Record<string, Row[]> = {}) => ({
  workspace_members: [{ workspace_id: WS, user_id: USER }],
  company_brain: [{ workspace_id: WS, profile: EVEREST_PROFILE, updated_at: "2026-10-01T00:00:00Z", onboarding_completed: true }],
  ...extra,
});
const memoryItem = (o: Row): Row => ({ id: crypto.randomUUID(), workspace_id: WS, scope: "workspace", scope_ref: null, version: 1,
  source_type: "user_provided", verification_status: "user_confirmed", confidence: "high", lifecycle_status: "active",
  persistence: "permanent", approval_status: "approved", created_by_kind: "user", updated_at: "2026-10-05T00:00:00Z", ...o });

// ═══════════════════════ PART 1 — MODEL INVENTORY ═══════════════════════════
Deno.test("M1 aiProvider: every general task (chat, orchestration, agent execution, Brain) is Claude Haiku 4.5; only two may fall back to gpt-4.1-mini", () => {
  for (const [task, p] of Object.entries(TASK_MODELS)) {
    assertEquals(p.model, "claude-haiku-4-5-20251001", task);
    assertEquals(p.vendor, "anthropic", task);
  }
  const withFallback = Object.entries(TASK_MODELS).filter(([, p]) => p.fallback).map(([t, p]) => `${t}→${p.fallback!.model}`);
  assertEquals(withFallback.sort(), ["helper→gpt-4.1-mini", "tool_input_planning→gpt-4.1-mini"]);
  // No Anthropic key: chat has NO provider (fails loudly), helper silently moves to OpenAI.
  const noAnthropic = (v: string) => v === "openai";
  assertEquals(plannedAttempts("pilot_chat", noAnthropic), []);
  assertEquals(plannedAttempts("helper", noAnthropic).map((a) => a.model), ["gpt-4.1-mini"]);
});

Deno.test("M2 lead pipeline / Chat Brain / signal relevance: GPT-5.6 Luna primary, Terra only for repair, pool ranking deterministic", () => {
  const byModel: Record<string, string[]> = {};
  for (const s of GPT_STAGES) {
    let m: string;
    try { m = routeModel(s, {}).model ?? "none"; } catch { m = "none (deterministic)"; }
    (byModel[m] ??= []).push(s);
  }
  assert(byModel["gpt-5.6-luna"].includes("request_understanding"));
  assert(byModel["gpt-5.6-luna"].includes("mission_compilation"));
  assert(byModel["gpt-5.6-luna"].includes("signal_relevance"));
  assert(byModel["gpt-5.6-luna"].includes("company_qualification"));
  assertEquals((byModel["gpt-5.6-terra"] ?? []).sort(), ["discovery_actor_selection_repair", "execution_plan_repair", "request_understanding_repair", "signal_relevance_repair"]);
  assertFalse(Object.keys(byModel).includes("gpt-5.6-sol"), "Sol has no production route");
});

Deno.test("M3 strategist defaults to the Lovable gateway transport (openai/gpt-5.6-luna) unless LEAD_STRATEGIST_PROVIDER=openai; image default gpt-image-1", () => {
  const cfg = resolveLeadStrategistConfig(() => undefined);
  assertEquals(cfg.provider, "lovable_ai");
  assertEquals([DEFAULT_PRIMARY_MODEL, DEFAULT_ESCALATION_MODEL], ["openai/gpt-5.6-luna", "openai/gpt-5.6-terra"]);
  assertEquals(resolveLeadStrategistConfig((k) => (k === "LEAD_STRATEGIST_PROVIDER" ? "openai" : undefined)).provider, "openai");
  assertEquals(DEFAULT_IMAGE_MODEL, "gpt-image-1");
});

Deno.test("M4 a real chat reply call goes to Anthropic with Haiku (fake transport captures it)", async () => {
  const prevA = Deno.env.get("ANTHROPIC_API_KEY"), prevO = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("ANTHROPIC_API_KEY", "test-placeholder-not-a-key"); Deno.env.delete("OPENAI_API_KEY");
  const realFetch = globalThis.fetch;
  const seen: Array<{ url: string; model: string; system: string }> = [];
  globalThis.fetch = ((url: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body));
    seen.push({ url, model: b.model, system: String(b.system ?? "") });
    return Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text: "Fictional reply." }], usage: { input_tokens: 900, output_tokens: 40 }, model: b.model }), { status: 200 }));
  }) as typeof fetch;
  try {
    const r = await generateText({ taskType: "pilot_chat", systemPrompt: converseSystemPrompt({ workspaceContext: null }), messages: [{ role: "user", content: "hello" }], maxTokens: 50 });
    assert(r.ok);
    assertEquals(seen.length, 1);
    assert(seen[0].url.startsWith("https://api.anthropic.com/"));
    assertEquals(seen[0].model, "claude-haiku-4-5-20251001");
  } finally {
    globalThis.fetch = realFetch;
    if (prevA === undefined) Deno.env.delete("ANTHROPIC_API_KEY"); else Deno.env.set("ANTHROPIC_API_KEY", prevA);
    if (prevO !== undefined) Deno.env.set("OPENAI_API_KEY", prevO);
  }
});

Deno.test("M5 cost: priced models and the per-workspace ceiling; the per-run unpriced-call budget is OFF unless configured", () => {
  for (const m of ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-4.1-mini", "claude-haiku-4-5-20251001"]) assert(MODEL_PRICES[m], m);
  assertEquals(resolveSpendEnforcement(() => undefined), "enforce", "fails closed: enforced unless exactly 'observe'");
  assertEquals(resolveRunBudget(() => undefined), null, "no MODEL_RUN_MAX_CALLS → no per-run bound on unpriced calls");
});

// ════════════════ PART 2/3 — ROUTING, PROMPTS, IDENTITY ══════════════════════
Deno.test("R1 routing is by OBJECTIVE, not by agent; Chat Brain is GPT-5.6 Luna; its prompt names no agent", async () => {
  const r = await route("Find 100 US manufacturing companies matching my ICP.", part("source", "company", { shape: "records", count: 100,
    filters: [{ field: "industry", op: "in", values: ["manufacturing"], range: null }] }));
  assertEquals(r.model, "gpt-5.6-luna");
  assertEquals(r.route, "lead_mission");
  assertEquals(r.binding.kind, "lead_route");
  for (const name of ["ORION", "ATLAS", "LYRA", "LISA", "Orion", "Atlas", "Lyra", "Lisa"]) assertFalse(r.systemPrompt.includes(name), name);
});

Deno.test("P1 the master system prompt names Pilot/Scout/Aria/Penn/Hawk/Scribe — not ORION/ATLAS/LYRA/LISA — and promises a silent Gemini fallback that no longer exists", () => {
  const p = getAgentorySystemPrompt({ taskType: "agent_execution" });
  for (const n of ["Pilot", "Scout", "Aria", "Penn", "Hawk", "Scribe"]) assertStringIncludes(p, n);
  for (const n of ["Orion", "Atlas", "Lyra", "Lisa"]) assertFalse(p.includes(n), n);
  assertStringIncludes(p, "fall back to\n                  Gemini/Lovable silently");
  assertFalse(Object.values(TASK_MODELS).some((t) => /gemini/i.test(t.model) || /gemini/i.test(t.fallback?.model ?? "")), "no Gemini route exists");
});

Deno.test("P2 ORION's wording call carries two identities: <current_role>scribe</current_role> and 'You are Orion'", () => {
  const daily = src("supabase/functions/daily-brief/index.ts");
  assertStringIncludes(daily, 'currentAgent: "scribe"');
  const sys = getAgentorySystemPrompt({ taskType: "reporting", currentAgent: "scribe", companyBrain: {} }) + "\n\n" + MODEL_INSTRUCTIONS;
  assertStringIncludes(sys, "<current_role>scribe</current_role>");
  assertStringIncludes(sys, "You are Orion");
});

Deno.test("P3 public naming in code differs from the intended product naming (display map, no LISA)", () => {
  const reg = src("src/config/agentRegistry.ts");
  assertStringIncludes(reg, "Lyra   — AI Signal Scout          (execution: scout)");
  assertStringIncludes(reg, "Orion  — Executive Intelligence   (execution: daily-brief executive brief; legacy slug scribe)");
  assertStringIncludes(reg, "Mira   — AI Message Strategist");
  assertFalse(/id: 'lisa'/.test(reg), "LISA is not an in-app agent identity");
});

Deno.test("P4 transcript model attribution is hard-coded to a model chat no longer uses", () => {
  const chat = src("supabase/functions/pilot-chat/index.ts");
  const labels = chat.match(/model_used: "google\/gemini-3-flash-preview"/g) ?? [];
  assert(labels.length >= 5, `found ${labels.length}`);
  assertStringIncludes(chat, 'const modelUsed = ai.model || "google/gemini-3-flash-preview";');
});

// ═══════════════════ PART 4 — CONTEXT AND MEMORY ════════════════════════════
Deno.test("C1 [FIXED in Workforce V2] chat reads the Brain through the shared loader; an approved tone reaches it", async () => {
  const chat = src("supabase/functions/pilot-chat/index.ts");
  assertStringIncludes(chat, "const chatBrain = await loadChatBrain(admin, workspaceId, userId);");
  assertFalse(/\.from\("company_brain"\)\s*\n?\s*\.select\("profile, onboarding_completed"\)/.test(chat), "no raw profile read left in the handler");
  const withTone = tables({ company_brain_memory: [memoryItem({ kind: "preference", category: "content", fact_key: "content.tone", value_type: "text", value: "Warm and plain" })] });
  const { loadChatBrain } = await import("../../../supabase/functions/_shared/chatBrainContext.ts");
  const c = await loadChatBrain(db(withTone), WS, USER);
  assertStringIncludes(JSON.stringify(c.row?.profile), "Warm and plain");
  void buildCompanyBrainContext; void loadCompanyBrainContext;
});

Deno.test("C2 [FIXED in Workforce V2] ATLAS's planner passes the authenticated user to the memory-aware loader", async () => {
  const orch = src("supabase/functions/_shared/intelligence/leads/leadPlanOrchestration.ts");
  assertStringIncludes(orch, "loadMissionContextWithMemory(input.admin as unknown as LoaderDb, input.workspaceId, { userId })");
  assertStringIncludes(src("supabase/functions/orchestrate/index.ts"), "workspaceId: workspace_id, userId, userInstruction");
  assertEquals((await loadMissionContext(db(tables()) as never, WS)).error, "forbidden", "the loader still refuses without a user");
  assert((await loadMissionContextWithMemory(db(tables()) as never, WS, { userId: USER })).ok);
});

Deno.test("C3 conversation memory: Chat Brain sees the last 8 turns in order; the legacy fallback query reads the FIRST 20", () => {
  const rowsNewestFirst = [{ role: "assistant", content: "3" }, { role: "user", content: "2" }, { role: "assistant", content: "1" }];
  assertEquals(toBrainTurns(rowsNewestFirst).map((t) => t.content), ["1", "2", "3"]);
  const chat = src("supabase/functions/pilot-chat/index.ts");
  const i = chat.indexOf("// 6. Load last 20 messages for context");
  const block = chat.slice(i, i + 400);
  assertStringIncludes(block, '.order("created_at", { ascending: true })');
  assertStringIncludes(block, ".limit(20)");
});

// ═══════════════════ PART 8 — THE TEN SCENARIOS ═════════════════════════════
Deno.test("S1 ORION 'What should I prioritize this week?' — not a recognised workspace question; Chat Brain decides; a converse reading never reaches ORION's brief", async () => {
  assertEquals(classifyWorkspaceQuestion("What should I prioritize this week?"), null);
  const asConverse = await route("What should I prioritize this week?", part("converse", "company"));
  assertEquals(asConverse.binding.kind, "category"); // Pilot's grounded conversational reply (Haiku)
  const asBrief = await route("What should I prioritize this week?", part("read", "conversation"));
  assertEquals(asBrief.binding.kind, "read"); // → readSurface target "brief" → daily-brief (deterministic + optional Haiku wording)
});

Deno.test("S1b ORION's model wording is accepted only when grounded; an invented number reverts to the deterministic brief", () => {
  const brief = { summary: "2 priorities.", priorities: [{ id: "P1", why: "Northstar expanded." }], recommended_actions: [],
    synthesis: { mode: "deterministic", model: null, rejected_reason: null } } as never;
  const facts = JSON.stringify({ priorities: [{ id: "P1" }], counts: { signals: 2 } });
  const ok = applyModelWording(brief, { summary: "You have 2 signals worth a look.", priorities: [{ id: "P1", why: "Northstar is expanding." }] }, facts, "claude-haiku-4-5-20251001");
  assertEquals((ok as { synthesis: { mode: string } }).synthesis.mode, "model");
  const bad = applyModelWording(brief, { summary: "You have 14 hot leads.", priorities: [] }, facts, "claude-haiku-4-5-20251001");
  assertEquals((bad as { synthesis: { rejected_reason: string } }).synthesis.rejected_reason, "summary_ungrounded_number");
});

Deno.test("S2 ATLAS 'Find companies matching my ICP' → lead mission (Luna understanding; mission/discovery/qualification on Luna)", async () => {
  const r = await route("Find companies matching my ICP.", part("source", "company", { shape: "records" }));
  assertEquals([r.route, r.binding.kind], ["lead_mission", "lead_route"]);
});

Deno.test("S3 LYRA 'Write a post about this verified signal' → compose → orchestrate + run-agent (Haiku agent_execution)", async () => {
  const r = await route("Write a post about this verified signal.", part("compose", "content", { shape: "artifact" }));
  assertEquals(r.binding.kind, "compose");
  assertEquals(TASK_MODELS.agent_execution.model, "claude-haiku-4-5-20251001");
  assertEquals(TASK_MODELS.orchestration_plan.model, "claude-haiku-4-5-20251001");
});

Deno.test("S4 LISA 'What changed among my competitors?' → read (held evidence, no provider); 'Monitor…' → monitor", async () => {
  assertEquals((await route("What changed among my competitors?", part("read", "competitor", { shape: "events",
    refs: [{ kind: "saved_set", value: "my competitors", cardinality: "all" }] }))).binding.kind, "read");
  assertEquals((await route("Monitor my competitors.", part("monitor", "competitor", { shape: "events",
    refs: [{ kind: "saved_set", value: "my competitors", cardinality: "all" }] }))).binding.kind, "monitor");
});

Deno.test("S5 ORION 'Why did you recommend this company?' → not recognised; Chat Brain → converse (Pilot) unless a referent resolves", async () => {
  assertEquals(classifyWorkspaceQuestion("Why did you recommend this company?"), null);
  assertEquals((await route("Why did you recommend this company?", part("converse", "company"))).binding.kind, "category");
});

Deno.test("S6 ATLAS 'Why was this lead rejected?' → the deterministic recogniser treats 'this lead' as a company NAME", () => {
  assertEquals(classifyWorkspaceQuestion("Why was this lead rejected?"), { kind: "why_company", company: "this lead", asked: "rejected" });
  // With a named company it is answered from stored evidence, no model.
  assertEquals(classifyWorkspaceQuestion("Why was Northstar Manufacturing rejected?")?.kind, "why_company");
  // The ATLAS result contract (Phase 5) explains a rejection honestly.
  const r = normalizeAtlasResult({ handoff_id: "h", company: { name: "Northstar Manufacturing", domain: null }, qualification: "rejected", persisted: true,
    reasons: ["12 employees, below your 50–500 range"], execution: { status: "completed", stages_completed: [], error: null } });
  assertStringIncludes(orionReads(r), "does not fit your ICP");
});

Deno.test("S7 LYRA 'Rewrite this in our brand voice' — the content path (run-agent) uses the shared loader; chat does not", () => {
  const agent = src("supabase/functions/run-agent/index.ts");
  assertStringIncludes(agent, 'renderBrainMemoryBlock(loaded.context, "lyra")');
  assertFalse(src("supabase/functions/pilot-chat/index.ts").includes("renderBrainMemoryBlock"));
});

Deno.test("S8 LISA 'Is this funding announcement verified?' — LISA V2 counts sources, but chat's read surface never selects verification", () => {
  const one = { source_domain: "a.example", source_type: "news" as const, negation: null, attributes: {}, category: "funding" as const };
  assertEquals(verify([one]).level, "single_source");
  assertEquals(verify([one, { ...one, source_domain: "b.example" }]).level, "corroborated");
  const read = src("supabase/functions/_shared/readSurface.ts");
  assertFalse(/verification_status|normalized_value/.test(read.slice(read.indexOf('db.from("signal_events")'), read.indexOf('db.from("signal_events")') + 300)));
});

Deno.test("S9 cross-agent 'What did LISA discover, and what should ATLAS do?' — the recogniser only knows ATLAS; LISA is not in its vocabulary", () => {
  assertEquals(classifyWorkspaceQuestion("What did LISA discover, and what should ATLAS do?"), { kind: "agent_activity_today", agent: "atlas" });
});

Deno.test("S10 missing Brain — prompts tell the model not to invent company facts; ATLAS-style loaders report 'missing'", async () => {
  assertStringIncludes(getAgentorySystemPrompt({ companyBrain: {} }), "do not invent company facts");
  assertStringIncludes(converseSystemPrompt({ workspaceContext: null }), "The Company Brain is not set up yet, so you do not know this business");
  const none = await loadCompanyBrainContext(db({ workspace_members: [{ workspace_id: WS, user_id: USER }] }) as never, WS, { userId: USER });
  assert(none.ok); assertEquals(none.context.status, "missing");
});
