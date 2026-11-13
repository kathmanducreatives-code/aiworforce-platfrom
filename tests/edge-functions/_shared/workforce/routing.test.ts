// WORKFORCE V2 · ROUTING AND IDENTITY — the real Chat Brain (fake OpenAI
// transport, recorded answers), router, binding, read planner and the
// department rules. No network, no model, no database.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { understandRequest } from "../../../../supabase/functions/_shared/chatBrain.ts";
import { routeRequest } from "../../../../supabase/functions/_shared/objectiveRouter.ts";
import { bindRoute } from "../../../../supabase/functions/_shared/chatBrainBinding.ts";
import { planRead, signalVerificationLabel } from "../../../../supabase/functions/_shared/readSurface.ts";
import { classifyWorkspaceQuestion } from "../../../../supabase/functions/_shared/workspaceQuestions.ts";
import { departmentForRoute, isPronounReference, promoteExecutiveQuestion, resolvePronounCompany } from "../../../../supabase/functions/_shared/departmentRouting.ts";
import { DEPARTMENT_PROFILES, departmentOf, DEPARTMENTS } from "../../../../supabase/functions/_shared/departments.ts";
import { getAgentorySystemPrompt } from "../../../../supabase/functions/_shared/agentorySystemPrompt.ts";
import { converseSystemPrompt } from "../../../../supabase/functions/_shared/converseSurface.ts";

type Part = Record<string, unknown>;
const part = (objective: string, entity: string, o: { shape?: string; count?: number | null; refs?: unknown[]; filters?: unknown[] } = {}): Part => ({
  id: "p1", objective, subject: { entity, references: o.refs ?? [], filters: o.filters ?? [] }, requirements: [],
  output: { shape: o.shape ?? "answer", count: o.count ?? null, completeness: "sample", medium: "text" }, depends_on: [],
});
async function chat(utterance: string, p: Part) {
  const fetch = (_u: string, _i: RequestInit) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ parts: [p], ambiguity: [], confidence: 0.9 }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 } })) });
  const u = await understandRequest(utterance, { conversation: [] }, { fetch, readEnv: (k) => (k === "OPENAI_API_KEY" ? "test-placeholder" : undefined) });
  if (!u.ok) throw new Error("not understood");
  const promoted = promoteExecutiveQuestion(u.request, utterance);
  const route = routeRequest(promoted.request, { spendAllowed: true });
  return { request: promoted.request, promoted: promoted.promoted, route, binding: bindRoute(route), department: departmentForRoute(route.kind, promoted.request) };
}

Deno.test("'What should I prioritize this week?' → ORION's brief, even when the model reads it as conversation", async () => {
  for (const reading of [part("converse", "company"), part("converse", "conversation"), part("read", "company")]) {
    const r = await chat("What should I prioritize this week?", reading);
    assert(r.promoted);
    assertEquals(r.binding.kind, "read");
    assertEquals(planRead(r.request, []).target, "brief");
    assertEquals(r.department, "orion");
  }
});

Deno.test("a priority word never promotes a paid or scoped request", async () => {
  const r = await chat("Find 50 companies I should prioritize", part("source", "company", { shape: "records", count: 50 }));
  assertEquals(r.promoted, false);
  assertEquals(r.binding.kind, "lead_route");
});

Deno.test("'Find 50 US manufacturers.' → ATLAS", async () => {
  const r = await chat("Find 50 US manufacturers.", part("source", "company", { shape: "records", count: 50,
    filters: [{ field: "industry", op: "in", values: ["manufacturing"], range: null }] }));
  assertEquals([r.route.kind, r.binding.kind, r.department], ["lead_mission", "lead_route", "atlas"]);
});

Deno.test("'What's happening with our competitors?' → LISA (held signals, no provider)", async () => {
  const r = await chat("What's happening with our competitors?", part("read", "competitor", { shape: "events",
    refs: [{ kind: "saved_set", value: "our competitors", cardinality: "all" }] }));
  assertEquals([r.binding.kind, r.department], ["read", "lisa"]);
});

Deno.test("'Write a LinkedIn post about this signal.' → LYRA", async () => {
  const r = await chat("Write a LinkedIn post about this signal.", part("compose", "content", { shape: "artifact" }));
  assertEquals([r.binding.kind, r.department], ["compose", "lyra"]);
});

Deno.test("'Why did we reject this company?' resolves the pronoun against what was shown — never a company named 'this company'", () => {
  const q = classifyWorkspaceQuestion("Why did we reject this company?") ?? classifyWorkspaceQuestion("Why was this company rejected?");
  assert(q && q.kind === "why_company" && isPronounReference(q.company));
  const set = (names: string[]) => ({ version: "presented-referents-v1", kind: "companies", presented_at: "2026-11-10T00:00:00Z",
    entities: names.map((n, i) => ({ position: i + 1, entity_type: "company", label: n, name: n, domain: null })) }) as never;
  assertEquals(resolvePronounCompany([set(["Kestrel Fabrication"])]), { kind: "one", name: "Kestrel Fabrication", domain: null });
  assertEquals(resolvePronounCompany([null, set(["A Co", "B Co"])]).kind, "many");
  assertEquals(resolvePronounCompany([]).kind, "none");
  assert(!isPronounReference("Northstar Manufacturing"));
});

Deno.test("'Is this announcement verified?' → chat states the counted verification, date and source", () => {
  const row = (level: string | null, life = "active") => ({ lifecycle_status: life, verification_status: "provider_verified",
    normalized_value: level ? { lisa: { verification: { level, independent_sources: 2 } } } : {} });
  assertEquals(signalVerificationLabel(row("corroborated")), "verified by 2 independent sources");
  assertEquals(signalVerificationLabel(row("single_source")), "single source — not yet confirmed");
  assertEquals(signalVerificationLabel(row("corroborated", "retracted")), "retracted — not current");
  assertEquals(signalVerificationLabel(row(null)), "unverified", "a provider label alone is never 'verified'");
  const src = Deno.readTextFileSync(new URL("../../../../supabase/functions/_shared/readSurface.ts", import.meta.url));
  assertStringIncludes(src, "verification_status, lifecycle_status, normalized_value");
});

Deno.test("mixed or LISA questions are read part by part by Chat Brain, not forced onto one agent", () => {
  assertEquals(classifyWorkspaceQuestion("What did LISA discover, and what should ATLAS do?"), null);
  assertEquals(classifyWorkspaceQuestion("What has LISA been working on today?"), null);
  assertEquals(classifyWorkspaceQuestion("What has Atlas been working on today?")?.kind, "agent_activity_today");
});

Deno.test("identity: one department map, mirrored by the UI registry; prompts use it", () => {
  const reg = Deno.readTextFileSync(new URL("../../../../src/config/agentRegistry.ts", import.meta.url));
  for (const d of DEPARTMENTS) {
    assert(reg.includes(`id: '${d}'`), d);
    for (const slug of DEPARTMENT_PROFILES[d].legacySlugs) assert(reg.includes(`${slug}: '${d}',`), `${slug} → ${d}`);
  }
  assertEquals(departmentOf("scout"), "atlas");
  assertEquals(departmentOf("scribe"), "lyra");
  assertEquals(departmentOf("penn"), "lyra");
  assertEquals(departmentOf("pilot"), "orion");
  assertEquals(departmentOf("mira"), "lyra");
  const p = getAgentorySystemPrompt({ taskType: "pilot_router", currentAgent: "scribe" });
  for (const n of ["ORION", "ATLAS", "LISA", "LYRA"]) assertStringIncludes(p, n);
  assertStringIncludes(p, "<current_role>LYRA</current_role>");
  assertStringIncludes(converseSystemPrompt({ workspaceContext: null }), "You are ORION");
});

Deno.test("transcripts record the model that actually answered", () => {
  const chat = Deno.readTextFileSync(new URL("../../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  assertEquals((chat.match(/"google\/gemini-3-flash-preview"/g) ?? []).length, 1, "only the explanatory comment remains");
  assertStringIncludes(chat, "turnCollector.enterWith(chatModelCalls);");
  assertStringIncludes(chat, '.order("created_at", { ascending: false })\n    .limit(20);\n  const history = [...(historyNewestFirst ?? [])].reverse();');
});

import { orionAnswersCompoundRead } from "../../../../supabase/functions/_shared/departmentRouting.ts";
import {
  REQUEST_V1_VERSION, type RequestEntity, type RequestOutput, type RequestPart, type RequestReference, type RequestV1,
} from "../../../../supabase/functions/_shared/requestV1.ts";
Deno.test("compound read → ORION evidence answer; single list read and scoped reads unchanged", () => {
  const part = (id: string, entity: RequestEntity, shape: RequestOutput["shape"] = "records",
    refs: RequestReference[] = []): RequestPart => ({
    id, objective: "read", subject: { entity, references: refs, filters: [] }, requirements: [],
    output: { shape, count: null, completeness: "sample" }, depends_on: [] });
  const req = (...parts: RequestPart[]): RequestV1 => ({
    version: REQUEST_V1_VERSION, utterance: "", objective: parts[0]?.objective ?? "read", parts,
    ambiguity: [], authority: { may_spend: false, max_cost_units: null, requires_confirmation: true },
    provenance: {}, confidence: 0.9,
  });
  const two = orionAnswersCompoundRead(req(part("a", "company"), part("b", "signal")));
  assert(two.rerouted);
  assertEquals(two.request.parts.length, 1);
  assertEquals(two.request.parts[0].objective, "converse");
  assert(orionAnswersCompoundRead(req(part("a", "company", "answer"))).rerouted, "a prose read is a summary");
  assertEquals(orionAnswersCompoundRead(req(part("a", "company"))).rerouted, false);
  assertEquals(orionAnswersCompoundRead(req(part("a", "company"), part("b", "signal", "records", [{ kind: "named", value: "Kestrel" }]))).rerouted, false);
  assertEquals(orionAnswersCompoundRead(req(part("a", "company"), { ...part("b", "company"), objective: "source" })).rerouted, false);
});
