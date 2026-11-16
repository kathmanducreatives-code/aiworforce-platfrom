// R1.2 · ROUTING REGRESSION — the owner's manual acceptance prompts (verbatim)
// and paraphrases, through the real Chat Brain parser (fake transport returning
// the readings a model can produce), `orionRoute`, the router and the binder.
import { assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { understandRequest } from "../../../../supabase/functions/_shared/chatBrain.ts";
import { routeRequest } from "../../../../supabase/functions/_shared/objectiveRouter.ts";
import { bindRoute } from "../../../../supabase/functions/_shared/chatBrainBinding.ts";
import { draftKindsFor, explainsWithoutActing, orionRoute } from "../../../../supabase/functions/_shared/orionIntelligence.ts";

const FX = JSON.parse(await Deno.readTextFile(new URL("../../../fixtures/orion-r12-acceptance.json", import.meta.url)));
type Part = Record<string, unknown>;
const part = (objective: string, entity: string, o: { shape?: string; count?: number | null; refs?: unknown[]; id?: string } = {}): Part => ({
  id: o.id ?? "p1", objective, subject: { entity, references: o.refs ?? [], filters: [] }, requirements: [],
  output: { shape: o.shape ?? "answer", count: o.count ?? null, completeness: "sample", medium: "text" }, depends_on: [],
});
const PRIOR = [{ kind: "prior_result", value: "these companies", cardinality: "all" }];

async function finalRoute(utterance: string, parts: Part[], delegationEnabled = false, ambiguity: unknown[] = []) {
  const fetch = (_u: string, _i: RequestInit) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ parts, ambiguity, confidence: 0.9 }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 } })) });
  const u = await understandRequest(utterance, { conversation: [] }, { fetch, readEnv: (k) => (k === "OPENAI_API_KEY" ? "test-placeholder" : undefined) });
  if (!u.ok) throw new Error(`not understood: ${utterance}`);
  const r = orionRoute(u.request, utterance, { evidenceEnabled: true, delegationEnabled });
  if (r.draft) return { label: "orion_draft", r };
  const route = routeRequest(r.request, { spendAllowed: true });
  const b = bindRoute(route);
  return { label: b.kind === "read" ? "read" : route.kind === "converse" ? "converse" : b.kind === "reply" ? "blocked" : route.kind, r };
}

// Readings a model plausibly produces for each prompt — including the one that failed live.
const READINGS: Record<string, Part[][]> = {
  "F1-brief": [[part("compose", "content", { shape: "artifact" })], [part("converse", "conversation")], [part("read", "company")]],
  "F1-report-ok": [[part("compose", "content", { shape: "artifact" })], [part("converse", "conversation")]],
  "F2-apify": [[part("source", "company", { shape: "records", count: 100 }), part("compose", "person", { shape: "artifact", id: "p2" })],
    [part("compose", "person", { shape: "artifact" })], [part("source", "company", { shape: "records", count: 100 })]],
  "F4-followup": [[part("read", "company", { shape: "records", refs: PRIOR })], [part("read", "company", { shape: "answer", refs: PRIOR })]],
  "F3-signals": [[part("read", "signal", { shape: "events", count: 37 })], [part("read", "signal", { shape: "records" })]],
  "F3-analyze": [[part("read", "signal", { shape: "events" })]],
  "F6-under30": [[part("read", "signal", { shape: "events" })], [part("read", "signal", { shape: "records" })]],
  "F5-brain-audit": [[part("read", "company", { shape: "answer" })], [part("converse", "conversation")]],
  "F5-content": [[part("compose", "content", { shape: "artifact" })]],
  "post-from-report": [[part("compose", "content", { shape: "artifact", refs: [{ kind: "prior_result", value: "that internal report", cardinality: "one" }] })],
    [part("compose", "content", { shape: "artifact" })]],
};

for (const f of FX.findings as Array<{ id: string; prompt: string; expected_route: string; recorded_route: string }>) {
  Deno.test(`R1.2 ${f.id}: → ${f.expected_route} (recorded: ${f.recorded_route})`, async () => {
    for (const parts of READINGS[f.id]) {
      const { label } = await finalRoute(f.prompt, parts);
      assertEquals(label, f.expected_route, JSON.stringify(parts.map((p) => [p.objective, (p.subject as Part).entity])));
    }
  });
}

for (const p of FX.paraphrases as Array<{ prompt: string; expected_route: string; kinds?: string[] }>) {
  Deno.test(`R1.2 paraphrase → ${p.expected_route}: "${p.prompt.slice(0, 60)}…"`, async () => {
    const paid = /apify|scrape|send|message every|cold email to every/i.test(p.prompt);
    const back = /^for those/i.test(p.prompt);
    const readings: Part[][] = back ? [[part("read", "company", { shape: "records", refs: PRIOR })]]
      : paid ? [[part("source", "company", { shape: "records" }), part("compose", "person", { shape: "artifact", id: "p2" })], [part("compose", "person", { shape: "artifact" })]]
      : [[part("compose", "content", { shape: "artifact" })], [part("converse", "conversation")]];
    for (const parts of readings) {
      const { label, r } = await finalRoute(p.prompt, parts);
      // A converse reading of a drafting prompt still drafts (explicit "write a post").
      assertEquals(label, p.expected_route, JSON.stringify(parts.map((x) => [x.objective, (x.subject as Part).entity])));
      if (p.kinds && r.draft) assertEquals(r.draft.kinds, p.kinds);
    }
  });
}

Deno.test("negated formats are never requested formats", () => {
  assertEquals(draftKindsFor(FX.findings[0].prompt), []);
  assertEquals(draftKindsFor("Write a LinkedIn post, not an email."), ["linkedin_post"]);
  assertEquals(draftKindsFor("Draft a first LinkedIn message to the founder of Hyperbound. Do not send it."), ["linkedin_message"]);
});

Deno.test("an execution request is never advertised as a draft, with or without delegation guard wording", async () => {
  const f = FX.findings.find((x: { id: string }) => x.id === "F2-apify");
  for (const parts of READINGS["F2-apify"]) {
    const { r } = await finalRoute(f.prompt, parts);
    assertFalse(!!r.draft);
  }
});

Deno.test("delegation ON: compose keeps LYRA's route; nothing here changes it", async () => {
  const f = FX.findings.find((x: { id: string }) => x.id === "F5-content");
  const { r, label } = await finalRoute(f.prompt, READINGS["F5-content"][0], true);
  assertFalse(!!r.draft);
  assertEquals(label, "compose");
});

// ── LIVE TEST 2026-11-16 (R1.2 run, 12/14): tests 3 and 13 ──────────────────
// Test 3: the model read F2 as source + a BLOCKING ambiguity on the action;
// orionRoute rerouted to converse but kept the ambiguity → route "blocked".
// Test 13: "message every founder" was read as a back-reference; the referent
// check (before routing) found no prior results → "referent_unresolved".
// Both prompts ask ONLY for an explanation; asking "which action / which
// founders?" for work that will not run is the defect.
const ACTION_AMBIGUITY = [{ part_id: "p1", field: "action", question: "Which action should I take first?", blocking: true }];
const F2 = FX.findings.find((x: { id: string }) => x.id === "F2-apify").prompt as string;
const P3 = FX.paraphrases[2].prompt as string;

Deno.test("live test 3: an explain-only execution request is answered even with a blocking ambiguity about the action", async () => {
  for (const parts of READINGS["F2-apify"]) {
    const { label } = await finalRoute(F2, parts, false, ACTION_AMBIGUITY);
    assertEquals(label, "converse", JSON.stringify(parts.map((p) => p.objective)));
  }
});

Deno.test("live test 13: an explain-only execution request does not need its targets resolved", async () => {
  const back = [{ kind: "prior_result", value: "every founder", cardinality: "all" }];
  for (const parts of [[part("source", "company", { shape: "records", count: 200 }), part("compose", "person", { shape: "artifact", refs: back, id: "p2" })],
                       [part("compose", "person", { shape: "artifact", refs: back })]]) {
    const fetch = (_u: string, _i: RequestInit) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ parts, ambiguity: [], confidence: 0.9 }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 } })) });
    const u = await understandRequest(P3, { conversation: [] }, { fetch, readEnv: (k) => (k === "OPENAI_API_KEY" ? "test-placeholder" : undefined) });
    if (!u.ok) throw new Error("not understood");
    assertEquals(explainsWithoutActing(u.request, P3, { evidenceEnabled: true, delegationEnabled: false }), true);
    const { label } = await finalRoute(P3, parts);
    assertEquals(label, "converse");
  }
});

for (const utterance of [
  "Use Apify to pull 50 SaaS founders and email them now. If that's not enabled, just explain the limits and don't run anything.",
  "Enrich every founder in my leads and DM them on LinkedIn — or tell me exactly what's blocking it. Do not execute anything.",
  "Scrape 300 agencies and message each owner. If you can't, explain why and do nothing.",
]) {
  Deno.test(`explain-only paraphrase answers instead of asking: "${utterance.slice(0, 50)}…"`, async () => {
    const { label, r } = await finalRoute(utterance, [part("source", "company", { shape: "records" }), part("compose", "person", { shape: "artifact", id: "p2" })], false, ACTION_AMBIGUITY);
    assertEquals(label, "converse");
    assertFalse(!!r.draft);
  });
}

Deno.test("guard: a real sourcing request with a blocking ambiguity still asks first (nothing relaxed)", async () => {
  const { label } = await finalRoute("Find 50 US manufacturers for me", [part("source", "company", { shape: "records", count: 50 })], false, ACTION_AMBIGUITY);
  assertEquals(label, "blocked");
  const request = (await finalRoute("Find 50 US manufacturers for me", [part("source", "company", { shape: "records", count: 50 })])).r.request;
  assertEquals(explainsWithoutActing(request, "Find 50 US manufacturers for me", { evidenceEnabled: true, delegationEnabled: false }), false);
});

Deno.test("guard: a read with a blocking ambiguity that is not an execution request still asks", async () => {
  const { label } = await finalRoute("Show my leads", [part("read", "company", { shape: "records" })], false, ACTION_AMBIGUITY);
  assertEquals(label, "blocked");
});

// ── LIVE TEST 2026-11-16 (R1.2 run 2, 13/14): test 12 ────────────────────────
// "Give me a founder-only summary of risks and decisions. Not a campaign, not
// marketing copy." was read as `read` with a back-reference to the previous
// analysis; the referent check (before routing) found several companies on
// record and asked which one (referent:ambiguous_referent). The reference is
// to the CONVERSATION's analysis, not to a company. A single-entity reference
// ("that one", "that company") must still be asked about.
import { answersWithoutResolvingTargets } from "../../../../supabase/functions/_shared/orionIntelligence.ts";
const P2 = FX.paraphrases[1].prompt as string;
async function understood(u: string, parts: Part[]) {
  const fetch = (_u: string, _i: RequestInit) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ parts, ambiguity: [], confidence: 0.9 }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 } })) });
  const r = await understandRequest(u, { conversation: [] }, { fetch, readEnv: (k) => (k === "OPENAI_API_KEY" ? "test-placeholder" : undefined) });
  if (!r.ok) throw new Error(`not understood: ${u}`);
  return r.request;
}
const O = { evidenceEnabled: true, delegationEnabled: false };
const MANY = (value: string) => [{ kind: "prior_result", value, cardinality: "all" }];
const ONE = (value: string) => [{ kind: "prior_result", value, cardinality: "one" }];

Deno.test("live test 12: an internal summary of the conversation's analysis is answered, not questioned", async () => {
  for (const parts of [[part("read", "company", { shape: "answer", refs: MANY("risks and decisions") })],
                       [part("read", "conversation", { shape: "answer", refs: MANY("the risks and decisions") })],
                       [part("compose", "content", { shape: "artifact", refs: MANY("risks and decisions") })]]) {
    assertEquals(answersWithoutResolvingTargets(await understood(P2, parts), P2, O), true, JSON.stringify(parts.map((p) => p.objective)));
    const { label } = await finalRoute(P2, parts);
    assertEquals(label, "converse");
  }
});

for (const utterance of [
  "Summarize the risks and open decisions from that analysis for me — internal only, not a post.",
  "Turn those findings into a short internal brief for the founder. Not marketing.",
  "Recap the decisions we discussed above as a one-page internal report.",
]) {
  Deno.test(`internal analysis of earlier turns is answered: "${utterance.slice(0, 50)}…"`, async () => {
    const parts = [part("read", "conversation", { shape: "answer", refs: MANY("those findings") })];
    assertEquals(answersWithoutResolvingTargets(await understood(utterance, parts), utterance, O), true);
    assertEquals((await finalRoute(utterance, parts)).label, "converse");
  });
}

Deno.test("guard: a single-entity back-reference is still asked about ('that one', 'that company')", async () => {
  for (const [u, refs] of [["Why did we reject that one?", ONE("that one")],
                           ["Summarize the risks for that company.", ONE("that company")],
                           ["Tell me more about the second one.", ONE("the second one")]] as const) {
    assertEquals(answersWithoutResolvingTargets(await understood(u, [part("read", "company", { shape: "answer", refs })]), u, O), false, u);
  }
});

Deno.test("guard: a paid request pointing back is never exempted from resolving its targets", async () => {
  const u = "Find 20 more companies like those and summarize them.";
  assertEquals(answersWithoutResolvingTargets(await understood(u, [part("source", "company", { shape: "records", count: 20, refs: MANY("those") })]), u, O), false);
});

Deno.test("guard: an outbound draft pointing back is not an internal analysis", async () => {
  const u = "Write a LinkedIn post summarizing those findings.";
  assertEquals(answersWithoutResolvingTargets(await understood(u, [part("compose", "content", { shape: "artifact", refs: MANY("those findings") })]), u, O), false);
});
