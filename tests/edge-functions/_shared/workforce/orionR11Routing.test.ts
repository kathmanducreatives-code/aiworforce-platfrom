// R1.1 · ORION ROUTING REGRESSION — the owner's 20 live capability tests.
//
// Each prompt is run through the REAL Chat Brain parser (fake OpenAI transport
// returning the reading the live model produced, as recorded in
// messages.metadata.chat_brain), then through `orionRoute` — the single routing
// step pilot-chat applies — and the real router/binder. No network, no model,
// no database.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { understandRequest } from "../../../../supabase/functions/_shared/chatBrain.ts";
import { routeRequest } from "../../../../supabase/functions/_shared/objectiveRouter.ts";
import { bindRoute } from "../../../../supabase/functions/_shared/chatBrainBinding.ts";
import { draftKindsFor, orionRoute, subQuestions } from "../../../../supabase/functions/_shared/orionIntelligence.ts";

const FIXTURES = JSON.parse(await Deno.readTextFile(new URL("../../../fixtures/orion-r1-capability-tests.json", import.meta.url)));
type Part = Record<string, unknown>;
const part = (objective: string, entity: string, o: { shape?: string; count?: number | null; refs?: unknown[]; filters?: unknown[]; medium?: string } = {}): Part => ({
  id: "p1", objective, subject: { entity, references: o.refs ?? [], filters: o.filters ?? [] }, requirements: [],
  output: { shape: o.shape ?? "answer", count: o.count ?? null, completeness: "sample", medium: o.medium ?? "text" }, depends_on: [],
});
const SAVED = [{ kind: "saved_set", value: "my leads", cardinality: "all" }];

async function understand(utterance: string, parts: Part[], ambiguity: unknown[] = []) {
  const fetch = (_u: string, _i: RequestInit) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ parts, ambiguity, confidence: 0.9 }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 } })) });
  const u = await understandRequest(utterance, { conversation: [] }, { fetch, readEnv: (k) => (k === "OPENAI_API_KEY" ? "test-placeholder" : undefined) });
  if (!u.ok) throw new Error(`not understood: ${utterance}`);
  return u.request;
}

/** What pilot-chat does with one turn, as a single label. */
async function finalRoute(utterance: string, parts: Part[], o: { delegationEnabled?: boolean; ambiguity?: unknown[] } = {}) {
  const request = await understand(utterance, parts, o.ambiguity ?? []);
  const r = orionRoute(request, utterance, { evidenceEnabled: true, delegationEnabled: o.delegationEnabled ?? false });
  if (r.draft) return { label: "orion_draft", r };
  const route = routeRequest(r.request, { spendAllowed: true });
  const binding = bindRoute(route);
  const label = binding.kind === "read" ? "read" : route.kind === "converse" ? "converse" : binding.kind === "reply" ? "blocked" : route.kind;
  return { label, r };
}

// The readings the live model produced (recorded route) — and a second plausible one,
// so a fix that only works for one exact parse does not pass.
const READINGS: Record<number, Part[][]> = {
  4: [[part("read", "company", { shape: "records" })], [part("read", "company", { shape: "answer" })]],
  7: [[part("read", "company", { shape: "records", count: 10 })], [part("read", "company", { shape: "records", count: 10, refs: SAVED })]],
  9: [[part("read", "company", { shape: "records" })], [part("read", "person", { shape: "records" })]],
  11: [[part("read", "signal", { shape: "events", count: 10 })], [part("read", "signal", { shape: "records", count: 10 })]],
  12: [[part("read", "signal", { shape: "events" })], [part("read", "signal", { shape: "records" })]],
  17: [[part("read", "company", { shape: "records", count: 3 })], [part("read", "company", { shape: "records", count: 3, refs: SAVED })]],
  14: [[part("compose", "content", { shape: "artifact" })]],
  15: [[part("compose", "person", { shape: "artifact" })]],
  16: [[part("compose", "company", { shape: "artifact", refs: SAVED })], [part("compose", "content", { shape: "artifact" })]],
};

for (const t of FIXTURES.tests as Array<{ n: number; prompt: string; expected_route: string; recorded_route: string }>) {
  const readings = READINGS[t.n] ?? [[part("converse", "conversation")]];
  Deno.test(`R1 test ${t.n}: routes to ${t.expected_route} (recorded: ${t.recorded_route})`, async () => {
    for (const parts of readings) {
      const amb = t.n === 15 ? [{ part_id: "p1", field: "subject.references", question: "Which existing ATLAS company?", blocking: true }] : [];
      const { label } = await finalRoute(t.prompt, parts, { ambiguity: amb });
      assertEquals(label, t.expected_route, `reading ${JSON.stringify(parts.map((p) => [p.objective, (p.subject as Part).entity, (p.output as Part).shape]))}`);
    }
  });
}

// ── SIMPLE LISTING KEEPS THE FAST, $0 TEMPLATE ──────────────────────────────
for (const [utterance, entity, shape] of [
  ["List my leads", "company", "records"], ["Show my signals", "signal", "events"],
  ["How many leads do I have?", "company", "records"], ["show the full list", "company", "records"],
  ["What companies am I watching?", "company", "records"], ["show me my latest signals", "signal", "events"],
] as const) {
  Deno.test(`simple listing stays on the read template: "${utterance}"`, async () => {
    const { label, r } = await finalRoute(utterance, [part("read", entity, { shape })]);
    assertEquals(label, "read");
    assertEquals(r.reroute, null);
  });
}

// ── COMPOUND / MULTI-PART QUESTIONS KEEP EVERY PART ─────────────────────────
Deno.test("test 4's four counts and the follow-up ask are all preserved as sub-questions", () => {
  const q = subQuestions(FIXTURES.tests[3].prompt);
  assert(q.length >= 5, JSON.stringify(q));
  for (const w of ["leads", "qualified leads", "monitored companies", "stored signals", "strongest opportunities"]) {
    assert(q.some((x) => x.toLowerCase().includes(w)), `missing sub-question about ${w}: ${JSON.stringify(q)}`);
  }
});
Deno.test("a single question is one sub-question, not split on commas inside a list of fields", () => {
  assertEquals(subQuestions("List the latest ten stored company signals with company, signal type, source, observed date, and confidence.").length, 1);
});

// ── DRAFTING: TEXT ONLY, NEVER DELEGATED WHILE DELEGATION IS OFF ────────────
Deno.test("drafting kinds are recognised for every requested format", () => {
  assertEquals(draftKindsFor(FIXTURES.tests[13].prompt), ["linkedin_post"]);
  assertEquals(draftKindsFor(FIXTURES.tests[14].prompt), ["linkedin_message"]);
  const k16 = draftKindsFor(FIXTURES.tests[15].prompt);
  for (const k of ["campaign", "linkedin_post", "cold_email", "video_script"]) assert(k16.includes(k as never), JSON.stringify(k16));
  assert(draftKindsFor("Write a follow-up email to Hyperbound's founder").includes("follow_up"));
});
Deno.test("with delegation ENABLED, compose keeps its LYRA route (no behaviour change outside the release guard)", async () => {
  const { label, r } = await finalRoute(FIXTURES.tests[13].prompt, READINGS[14][0], { delegationEnabled: true });
  assertFalse(!!r.draft);
  assertEquals(label, "compose");
});
Deno.test("a paid sourcing request is never turned into a draft or a read", async () => {
  const { label, r } = await finalRoute("Find 50 US manufacturers hiring engineers", [part("source", "company", { shape: "records", count: 50 })]);
  assertFalse(!!r.draft);
  assertEquals(label, "lead_mission");
});
Deno.test("test 19 (scrape 500, do not execute) is answered by ORION, never routed to sourcing", async () => {
  const { label } = await finalRoute(FIXTURES.tests[18].prompt, [part("source", "company", { shape: "records", count: 500 })]);
  assertEquals(label, "converse");
});
