// R1.2 · ROUTING REGRESSION — the owner's manual acceptance prompts (verbatim)
// and paraphrases, through the real Chat Brain parser (fake transport returning
// the readings a model can produce), `orionRoute`, the router and the binder.
import { assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { understandRequest } from "../../../../supabase/functions/_shared/chatBrain.ts";
import { routeRequest } from "../../../../supabase/functions/_shared/objectiveRouter.ts";
import { bindRoute } from "../../../../supabase/functions/_shared/chatBrainBinding.ts";
import { draftKindsFor, orionRoute } from "../../../../supabase/functions/_shared/orionIntelligence.ts";

const FX = JSON.parse(await Deno.readTextFile(new URL("../../../fixtures/orion-r12-acceptance.json", import.meta.url)));
type Part = Record<string, unknown>;
const part = (objective: string, entity: string, o: { shape?: string; count?: number | null; refs?: unknown[]; id?: string } = {}): Part => ({
  id: o.id ?? "p1", objective, subject: { entity, references: o.refs ?? [], filters: [] }, requirements: [],
  output: { shape: o.shape ?? "answer", count: o.count ?? null, completeness: "sample", medium: "text" }, depends_on: [],
});
const PRIOR = [{ kind: "prior_result", value: "these companies", cardinality: "all" }];

async function finalRoute(utterance: string, parts: Part[], delegationEnabled = false) {
  const fetch = (_u: string, _i: RequestInit) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ parts, ambiguity: [], confidence: 0.9 }) } }],
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
