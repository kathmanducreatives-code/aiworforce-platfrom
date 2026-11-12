// ORION CHAT IS OPENAI-ONLY (2026-11-12).
//
// The decision: ORION's chat — understanding, follow-up interpretation, business
// answers with evidence, repair — runs on OpenAI and needs only OPENAI_API_KEY.
// Anthropic stays where other functions use it, but no ORION chat path may
// reach it, and an OpenAI failure is reported, never retried on Anthropic.
//
// Provider calls are mocked (fakeNetwork / a stubbed fetch). No paid inference.

import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { installFakeNetwork, type ModelReply, type Row } from "../../_helpers/fakeNetwork.ts";
import { sendTurn, modelRequest, SUPABASE_URL, WORKSPACE, CONVERSATION } from "../../_helpers/pilotTurn.ts";
import {
  TASK_MODELS, chatVendorScope, ORION_OPENAI_ONLY, effectiveTaskPolicy, orionChatModel,
  plannedAttempts, generateText, type TaskType,
} from "../../../../supabase/functions/_shared/aiProvider.ts";
import { understandRequest } from "../../../../supabase/functions/_shared/chatBrain.ts";
import { CONVERSE_UNAVAILABLE } from "../../../../supabase/functions/_shared/converseSurface.ts";

const LUNA = "gpt-5.6-luna";
const ALL_TASKS = Object.keys(TASK_MODELS) as TaskType[];

/** Run `fn` with these env values, restoring the previous ones afterwards. */
async function withEnv<T>(vals: Record<string, string | null>, fn: () => Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vals)) {
    prev[k] = Deno.env.get(k);
    if (v === null) Deno.env.delete(k); else Deno.env.set(k, v);
  }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v); }
  }
}

/** A stubbed fetch recording every model host called. */
function stubFetch(status = 200) {
  const real = globalThis.fetch;
  const calls: Array<{ host: string; model: string | null }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ host: new URL(href).host, model: body.model ?? null });
    if (status >= 400) return new Response(JSON.stringify({ error: { message: "down" } }), { status });
    if (href.includes("anthropic")) {
      return new Response(JSON.stringify({ content: [{ type: "text", text: "from anthropic" }], usage: { input_tokens: 1, output_tokens: 1 } }));
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "from openai" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const inScope = <T>(fn: () => Promise<T>) => chatVendorScope.run(ORION_OPENAI_ONLY, fn);
const opts = { taskType: "pilot_chat" as const, messages: [{ role: "user" as const, content: "hi" }], maxTokens: 50 };

// ══ 1. THE POLICY ══════════════════════════════════════════════════════════

Deno.test("policy: inside ORION's scope every task runs on OpenAI Luna with no fallback", () => {
  for (const t of ALL_TASKS) {
    const p = effectiveTaskPolicy(t, ORION_OPENAI_ONLY, () => undefined);
    assertEquals([p.vendor, p.model, p.fallback], ["openai", LUNA, null], t);
  }
  assertEquals(orionChatModel(() => undefined), LUNA);
});

Deno.test("policy: outside the scope nothing changes — other functions keep their declared models", () => {
  for (const t of ALL_TASKS) assertEquals(effectiveTaskPolicy(t, undefined), TASK_MODELS[t], t);
  assertEquals(TASK_MODELS.pilot_chat.vendor, "anthropic", "daily-brief & co. are not migrated by this change");
});

Deno.test("policy: with only an Anthropic key, ORION has no attempt at all (never a silent Anthropic run)", () => {
  const p = effectiveTaskPolicy("helper", ORION_OPENAI_ONLY, () => undefined);
  assertEquals(plannedAttempts("helper", (v) => v === "anthropic", p), []);
  assertEquals(plannedAttempts("helper", (v) => v === "openai", p), [{ vendor: "openai", model: LUNA, intended: true }]);
});

// ══ 2. THE PROVIDER CALL (stubbed fetch) ═══════════════════════════════════

Deno.test("provider: ORION answers on OpenAI with ANTHROPIC_API_KEY absent", async () => {
  const f = stubFetch();
  try {
    const r = await withEnv({ OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: null }, () => inScope(() => generateText(opts)));
    assert(r.ok); assertEquals([r.provider, r.model, r.content], ["openai", LUNA, "from openai"]);
    assertEquals(f.calls, [{ host: "api.openai.com", model: LUNA }]);
  } finally { f.restore(); }
});

Deno.test("provider: an OpenAI failure is returned as an error — Anthropic is never tried", async () => {
  const f = stubFetch(500);
  try {
    const r = await withEnv({ OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "a" }, () => inScope(() => generateText(opts)));
    assertFalse(r.ok);
    assertEquals(r.errorCode, "openai_500");
    assert(f.calls.every((c) => c.host === "api.openai.com"), "no Anthropic call");
    assertEquals(f.calls.length, 1);
  } finally { f.restore(); }
});

Deno.test("provider: missing OPENAI_API_KEY fails safely, names the key, and calls nothing", async () => {
  const f = stubFetch();
  try {
    const r = await withEnv({ OPENAI_API_KEY: null, ANTHROPIC_API_KEY: "a" }, () => inScope(() => generateText(opts)));
    assertFalse(r.ok);
    assertEquals(r.errorCode, "no_provider_for_task");
    assertStringIncludes(r.error ?? "", "OPENAI_API_KEY");
    assertEquals(f.calls, []);
  } finally { f.restore(); }
});

Deno.test("provider: outside ORION the declared Anthropic task still runs on Anthropic (unchanged elsewhere)", async () => {
  const f = stubFetch();
  try {
    const r = await withEnv({ OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "a" }, () => generateText(opts));
    assertEquals(r.provider, "anthropic");
    assertEquals(f.calls[0].host, "api.anthropic.com");
  } finally { f.restore(); }
});

Deno.test("understanding: Chat Brain reads the question on OpenAI Luna, needing no Anthropic key", async () => {
  const f = stubFetch(500);
  try {
    const env: Record<string, string> = { OPENAI_API_KEY: "k" };
    const out = await understandRequest("Why did we reject the second one?", { conversation: [] }, { readEnv: (k) => env[k] });
    assertFalse(out.ok);
    assertEquals(f.calls[0], { host: "api.openai.com", model: LUNA });
    assert(f.calls.every((c) => c.host === "api.openai.com"));
  } finally { f.restore(); }
});

// ══ 3. THE REAL HANDLER, END TO END (fake database + fake model hosts) ═════

const signal = (id: string, name: string, domain: string, title: string, level: string, daysAgo: number): Row => {
  const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return {
    id, workspace_id: WORKSPACE, signal_type: "expansion",
    lifecycle_status: level === "contradicted" ? "contradicted" : "active",
    verification_status: level === "corroborated" ? "provider_verified" : "unverified",
    confidence: "medium", occurred_at: at, observed_at: at, source_url: `https://news.example/${id}`, subject_key: domain,
    normalized_value: { lisa: { company: { name, domain }, title, verification: { level } } },
  };
};

function pilotTables(): Record<string, Row[]> {
  return {
    conversations: [{ id: CONVERSATION, workspace_id: WORKSPACE, user_id: "user-1", title: "New chat", created_at: "2026-11-12T09:00:00Z" }],
    messages: [],
    workspace_members: [{ id: "wm-1", workspace_id: WORKSPACE, user_id: "user-1", role: "owner" }],
    company_brain: [], // TEST has no Company Brain, by design
    lead_candidates: [
      { id: "l1", workspace_id: WORKSPACE, status: "qualified", fit_score: 86, priority: "high", reason: "second plant announced",
        created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(), account_id: "a1", accounts: { name: "Kestrel Fabrication", domain: "kestrel-fab.example" } },
      { id: "l2", workspace_id: WORKSPACE, status: "rejected", fit_score: 18, priority: "low", reason: "Software company — outside the manufacturing ICP",
        created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(), account_id: "a3", accounts: { name: "Cloudnova Software", domain: "cloudnova.example" } },
    ],
    signal_events: [
      signal("s1", "Kestrel Fabrication", "kestrel-fab.example", "opens a second plant in Dayton", "corroborated", 6),
      signal("s2", "Ridgeway Castings", "ridgeway.example", "expansion — denied by the company", "contradicted", 8),
    ],
    accounts: [], contacts: [], outreach_drafts: [], saved_outputs: [], monitoring_subjects: [],
    request_understanding_log: [], tasks: [], approvals: [],
  };
}

const QUESTION = "Which of our leads should I prioritize this week, and why?";
const isBrain = (system: string) => system.includes("REFERENCES");
const brainSays = (content: unknown): ModelReply => ({ when: (_u, s) => isBrain(s), content });
const converse = modelRequest([{ objective: "converse", entity: "conversation", shape: "answer" }], 0.95);

async function orionTurn(replies: ModelReply[], env: Record<string, string | null>) {
  const tables = pilotTables();
  const net = installFakeNetwork({ supabaseUrl: SUPABASE_URL, tables, modelReplies: replies });
  try {
    const out = await withEnv({
      MODEL_SPEND_ENFORCEMENT: "observe", AGENTORY_ORION_EVIDENCE_CONTEXT: "true",
      AGENTORY_ORION_EVIDENCE_WORKSPACES: WORKSPACE, ANTHROPIC_API_KEY: null, ...env,
    }, () => sendTurn(QUESTION, tables));
    return { out, net, tables };
  } finally { net.restore(); }
}

Deno.test("handler: an ORION business question is understood and answered on OpenAI only, with evidence", async () => {
  const answer = "Prioritize Kestrel Fabrication first [E1]: verified second plant. Ridgeway's expansion is contradicted.";
  const { out, net } = await orionTurn([brainSays(converse), { when: (_u, s) => !isBrain(s), content: answer }], {});
  assertEquals(out.status, 200);
  assertEquals(out.content, answer);
  assert(net.modelCalls.length >= 2, "understanding + answer");
  for (const c of net.modelCalls) assertEquals([c.host, c.model], ["api.openai.com", LUNA]);
  // Evidence still attached, and every cited ref is one the panel can show.
  const ev = out.metadata.orion_evidence as { cited_ids: string[]; items: Array<{ ref: string; subject: string; verification: string }> };
  assert(ev && ev.items.length > 0, "evidence panel data present");
  const refs = new Set(ev.items.map((i) => i.ref));
  assert(ev.cited_ids.length > 0);
  assert(ev.items.some((i) => i.subject.includes("Kestrel")));
  assert(ev.items.some((i) => /contradicted/i.test(i.verification)), "contradicted evidence keeps its label");
  for (const i of ev.items) assert(refs.has(i.ref));
  const answerCall = net.modelCalls.find((c) => !isBrain(c.system))!;
  assertStringIncludes(answerCall.system, "[E1]");
  // Follow-ups ("the second one", "why did we reject it?") resolve against what ORION cited.
  assert(out.metadata.presented_referents, "cited companies stay pointable for follow-ups");
  assertEquals(net.functionCalls.length, 0, "answered in this request — not handed to daily-brief");
});

Deno.test("handler: outside the evidence pilot workspace a priority question still goes to the brief (unchanged)", async () => {
  const tables = pilotTables();
  const net = installFakeNetwork({ supabaseUrl: SUPABASE_URL, tables, modelReplies: [brainSays(converse)],
    functionReplies: { "daily-brief": { ok: true } } });
  try {
    await withEnv({ MODEL_SPEND_ENFORCEMENT: "observe", AGENTORY_ORION_EVIDENCE_CONTEXT: "true",
      AGENTORY_ORION_EVIDENCE_WORKSPACES: "a71a0000-0000-4000-8000-0000000011a1", ANTHROPIC_API_KEY: null },
      () => sendTurn(QUESTION, tables));
    assertEquals(net.functionCalls.map((c) => c.fn), ["daily-brief"]);
  } finally { net.restore(); }
});

Deno.test("handler: when OpenAI fails on the answer, ORION says so — no Anthropic retry", async () => {
  const { out, net } = await orionTurn([brainSays(converse), { when: (_u, s) => !isBrain(s), content: "", status: 500 }], {});
  assertEquals(out.status, 200);
  assertEquals(out.content, CONVERSE_UNAVAILABLE);
  assertEquals((out.metadata.model_error as { code: string }).code, "openai_500");
  assert(net.modelCalls.every((c) => c.host === "api.openai.com"));
});

Deno.test("handler: when OpenAI fails on understanding, ORION says so — no Anthropic retry", async () => {
  const { out, net } = await orionTurn([{ when: () => true, content: "", status: 503 }], {});
  assertEquals(out.status, 200);
  assertStringIncludes(out.content, "understanding layer");
  assert(net.modelCalls.length > 0 && net.modelCalls.every((c) => c.host === "api.openai.com"));
});

Deno.test("handler: missing OPENAI_API_KEY → explicit 503 before any model call", async () => {
  const { out, net } = await orionTurn([brainSays(converse)], { OPENAI_API_KEY: null });
  assertEquals(out.status, 503);
  assertEquals(out.body.error, "orion_openai_not_configured");
  assertStringIncludes(String(out.body.message), "OPENAI_API_KEY");
  assertEquals(net.modelCalls.length, 0);
});

Deno.test("handler: workspace authorization still comes first (non-member → 403, nothing read or called)", async () => {
  const tables = pilotTables();
  tables.workspace_members = [];
  const net = installFakeNetwork({ supabaseUrl: SUPABASE_URL, tables, modelReplies: [brainSays(converse)] });
  try {
    const out = await withEnv({ MODEL_SPEND_ENFORCEMENT: "observe", ANTHROPIC_API_KEY: null, OPENAI_API_KEY: null },
      () => sendTurn(QUESTION, tables));
    assertEquals(out.status, 403);
    assertEquals(net.modelCalls.length, 0);
  } finally { net.restore(); }
});

// ══ 4. LIVE FINDINGS (TEST, 2026-11-12) ═══════════════════════════════════
//
// "What companies and signals are currently available in my workspace?
//  Summarize them using stored evidence." was understood as TWO read parts;
// the deterministic read surface served the first, answering "4 leads saved"
// with names only — no signals, no evidence. And the understanding call never
// reached the spend ledger (0 rows for the pilot workspace after the turn).

const LIVE_Q = "What companies and signals are currently available in my workspace? Summarize them using stored evidence.";
const twoReads = modelRequest([
  { objective: "read", entity: "company", shape: "records" },
  { objective: "read", entity: "signal", shape: "records" },
], 0.99);

async function liveTurn(say: string, brain: unknown, answer: string, envExtra: Record<string, string | null> = {}, served = false) {
  const tables = { ...pilotTables(), lead_execution_calls: [] as Row[] };
  const net = installFakeNetwork({ supabaseUrl: SUPABASE_URL, tables,
    modelReplies: [brainSays(brain), { when: (_u, s) => !isBrain(s), content: answer }] });
  try {
    const out = await withEnv({ MODEL_SPEND_ENFORCEMENT: "observe", AGENTORY_ORION_EVIDENCE_CONTEXT: "true",
      AGENTORY_ORION_EVIDENCE_WORKSPACES: WORKSPACE, ANTHROPIC_API_KEY: null, ...envExtra }, () => sendTurn(say, tables, undefined, { served }));
    return { out, net, tables };
  } finally { net.restore(); }
}

Deno.test("live: 'companies AND signals, with evidence' is answered by ORION from evidence — signals included", async () => {
  const answer = "Leads: Kestrel [E1] … Signals: Ridgeway expansion is contradicted [E2].";
  const { out, net } = await liveTurn(LIVE_Q, twoReads, answer);
  assertEquals(out.content, answer);
  const ev = out.metadata.orion_evidence as { items: Array<{ subject: string; verification: string; source_type?: string }> };
  assert(ev && ev.items.length > 0, "evidence attached");
  assert(ev.items.some((i) => i.subject.includes("Ridgeway")), "a signal-only company is in the evidence");
  assert(ev.items.some((i) => i.subject.includes("Kestrel")));
  assertEquals((out.metadata.chat_brain as { route: string }).route, "converse");
  assert(net.modelCalls.every((c) => c.host === "api.openai.com"));
});

Deno.test("live: a single list read keeps the deterministic read surface (no model answer)", async () => {
  const { out, net } = await liveTurn("Show my leads", modelRequest([{ objective: "read", entity: "company", shape: "records" }], 0.99), "unused");
  assertEquals((out.metadata.chat_brain as { route: string }).route, "read");
  assertEquals(net.modelCalls.filter((c) => !isBrain(c.system)).length, 0);
});

Deno.test("live: outside the evidence workspace a compound read is unchanged (deterministic read)", async () => {
  const { out } = await liveTurn(LIVE_Q, twoReads, "unused", { AGENTORY_ORION_EVIDENCE_WORKSPACES: "a71a0000-0000-4000-8000-0000000011a1" });
  assertEquals((out.metadata.chat_brain as { route: string }).route, "read");
});

Deno.test("live: the understanding call is recorded in the spend ledger with the answer", async () => {
  const { tables, net } = await liveTurn(LIVE_Q, twoReads, "An answer [E1].", {}, true);
  const rows = (tables.lead_execution_calls ?? []) as Row[];
  assertEquals(rows.length, net.modelCalls.length, "every model call this turn is a ledger row");
  assert(rows.length >= 2, "understanding + answer");
  assert(rows.every((r) => r.workspace_id === WORKSPACE));
});

Deno.test("live: a deterministic read still records its understanding call (the case that showed 0 rows on TEST)", async () => {
  const { tables, net } = await liveTurn("Show my leads", modelRequest([{ objective: "read", entity: "company", shape: "records" }], 0.99), "unused", {}, true);
  assertEquals(net.modelCalls.length, 1, "understanding only");
  assertEquals(((tables.lead_execution_calls ?? []) as Row[]).length, 1);
});
