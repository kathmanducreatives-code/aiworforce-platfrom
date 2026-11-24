// R1.2 · REFERENCE POLICY — TABLE-DRIVEN INVARIANTS OVER MODEL READINGS.
//
// The understanding model is non-deterministic: the same prompt in the same
// position was read with different objectives, references and cardinalities in
// three live runs. So these tests do not pin one reading. They cross
//   prompts (incl. mixed "scrape and explain", "summarize, then send")
//   × plausible readings (objectives, incl. mixed parts)
//   × reference type (none, content, set, entity) × cardinality (one, all, unset)
//   × the model's blocking ambiguity (none, reference, action)
//   × company-set state (nothing on record, one company, several)
//   × delegation (off — the release setting — and on)
// and assert the safety and answer invariants for EVERY combination. Each case
// is parsed by the real Chat Brain parser and decided by the real policy and
// router; nothing is stubbed except the model's transport.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { understandRequest } from "../../../../supabase/functions/_shared/chatBrain.ts";
import { routeRequest } from "../../../../supabase/functions/_shared/objectiveRouter.ts";
import { bindRoute } from "../../../../supabase/functions/_shared/chatBrainBinding.ts";
import { planTurnRouting, referenceTarget, type TurnRouting } from "../../../../supabase/functions/_shared/orionReferencePolicy.ts";
import type { ReferentSource } from "../../../../supabase/functions/_shared/referentBinding.ts";
import type { RequestV1 } from "../../../../supabase/functions/_shared/requestV1.ts";

type Part = Record<string, unknown>;
const part = (id: string, objective: string, entity: string, refs: unknown[] = [], shape = "answer"): Part => ({
  id, objective, subject: { entity, references: refs, filters: [] }, requirements: [],
  output: { shape, count: null, completeness: "sample", medium: "text" }, depends_on: [],
});

const STATES: Record<string, ReferentSource | null> = {
  none: null,
  one: { message_id: "m1", entities: [{ label: "Hyperbound", domain: "hyperbound.ai" }] },
  many: { message_id: "m1", entities: [
    { label: "Hyperbound", domain: "hyperbound.ai" }, { label: "Laminar", domain: "laminar.run" },
    { label: "Epsilon3", domain: "epsilon3.io" }] },
};

// value, expected target type (independent of cardinality unless noted)
const REFS: Array<{ value: string | null; target: "content" | "set" | "entity" | null }> = [
  { value: null, target: null },
  { value: "those findings", target: "content" },
  { value: "the risks and decisions", target: "content" },
  { value: "your previous claims", target: "content" },
  { value: "that internal report", target: "content" },
  { value: "these companies", target: "set" },
  { value: "every founder", target: "set" },
  { value: "them", target: "set" },
  { value: "that one", target: "entity" },
  { value: "the second one", target: "entity" },
  { value: "Laminar", target: "entity" },
];
const CARDINALITIES: Array<"one" | "all" | undefined> = ["one", "all", undefined];
const AMBIGUITY: Record<string, unknown[]> = {
  none: [],
  reference: [{ part_id: "p1", field: "subject.references", question: "Which ones do you mean?", blocking: true }],
  action: [{ part_id: "p1", field: "action", question: "Which action should I take first?", blocking: true }],
};

// Prompt → plausible readings. Mixed requests included on purpose.
const PROMPTS: Array<{ u: string; readings: Array<(refs: unknown[]) => Part[]> }> = [
  { u: "Summarize the risks and decisions above for the founder.", readings: [
    (r) => [part("p1", "read", "company", r)], (r) => [part("p1", "converse", "conversation", r)],
    (r) => [part("p1", "compose", "content", r, "artifact")]] },
  { u: "Tell me which of your previous claims about these companies are inference only. Explain.", readings: [
    (r) => [part("p1", "read", "company", r, "records")], (r) => [part("p1", "converse", "conversation", r)]] },
  // "scrape and explain" — paid work plus an explanation. Must fail closed.
  { u: "Scrape 50 companies like those with Apify and explain what you found.", readings: [
    (r) => [part("p1", "source", "company", r, "records"), part("p2", "converse", "conversation")],
    (r) => [part("p1", "source", "company", r, "records")],
    (r) => [part("p1", "converse", "conversation"), part("p2", "source", "company", r, "records")]] },
  // "summarize, then send" — an answer plus outbound. Must fail closed when it would send.
  { u: "Summarize those findings, then send them to every lead.", readings: [
    (r) => [part("p1", "converse", "conversation", r), part("p2", "compose", "person", r, "artifact")],
    (r) => [part("p1", "compose", "person", r, "artifact")],
    (r) => [part("p1", "read", "company", r), part("p2", "compose", "person", [], "artifact")]] },
  { u: "Research the second one in depth.", readings: [(r) => [part("p1", "research", "company", r)]] },
  { u: "Watch them for hiring signals every week.", readings: [(r) => [part("p1", "monitor", "company", r)]] },
  { u: "Write a LinkedIn post based on that internal report. Draft only; do not publish.", readings: [
    (r) => [part("p1", "compose", "content", r, "artifact")]] },
  { u: "Scrape 200 companies with Apify and message every founder. If you can't, tell me why and do nothing.", readings: [
    (r) => [part("p1", "source", "company", r, "records"), part("p2", "compose", "person", r, "artifact")],
    (r) => [part("p1", "compose", "person", r, "artifact")]] },
];

async function parse(u: string, parts: Part[], ambiguity: unknown[]): Promise<RequestV1 | null> {
  const fetch = (_u: string, _i: RequestInit) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ parts, ambiguity, confidence: 0.9 }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 } })) });
  const r = await understandRequest(u, { conversation: [] }, { fetch, readEnv: (k) => (k === "OPENAI_API_KEY" ? "test-placeholder" : undefined) });
  return r.ok ? r.request : null;
}

const PAID = new Set(["source", "research", "monitor"]);
const labelsOf = (s: ReferentSource | null) => new Set((s?.entities ?? []).map((e) => e.label));

interface Case { u: string; request: RequestV1; t: TurnRouting; state: string; source: ReferentSource | null; delegation: boolean; amb: string; ref: typeof REFS[number] }
const CASES: Case[] = [];
let unparsed = 0;
for (const p of PROMPTS) {
  for (const reading of p.readings) {
    for (const ref of REFS) {
      for (const cardinality of ref.value === null ? [undefined] : CARDINALITIES) {
        const refs = ref.value === null ? [] : [{ kind: "prior_result", value: ref.value, ...(cardinality ? { cardinality } : {}) }];
        for (const [amb, ambiguity] of Object.entries(AMBIGUITY)) {
          const request = await parse(p.u, reading(refs), ambiguity);
          if (!request) { unparsed++; continue; }
          for (const [state, source] of Object.entries(STATES)) {
            for (const delegation of [false, true]) {
              const t = planTurnRouting({ request, message: p.u, source, evidenceEnabled: true, delegationEnabled: delegation });
              CASES.push({ u: p.u, request, t, state, source, delegation, amb, ref });
            }
          }
        }
      }
    }
  }
}
const who = (c: Case) => `${c.u.slice(0, 40)} | ${c.request.parts.map((p) => p.objective).join("+")} | ref=${c.ref.value} | amb=${c.amb} | set=${c.state} | deleg=${c.delegation} → ${c.t.decision}`;

Deno.test(`matrix is large and parsed: ${CASES.length} cases`, () => {
  assert(CASES.length > 3000, `only ${CASES.length} cases`);
  assert(unparsed < CASES.length / 50, `${unparsed} readings could not be parsed`);
});

Deno.test("reference type is a deterministic function of the words, not the model's cardinality", () => {
  for (const r of REFS) {
    if (r.value === null) continue;
    for (const c of CARDINALITIES) {
      // "Laminar" is an entity only when it was actually shown; otherwise it falls back on cardinality.
      const shown = r.value === "Laminar" ? ["Hyperbound", "Laminar"] : [];
      assertEquals(referenceTarget({ value: r.value, cardinality: c }, shown), r.target, `${r.value} / ${c}`);
    }
  }
});

Deno.test("INVARIANT 1 — fail closed: spend / outbound / mutation never proceeds past an unbound target", () => {
  for (const c of CASES) {
    if (c.t.consequence === "answer") continue;
    const unbound = c.t.references.filter((r) => !r.bound);
    if (unbound.length) assert(c.t.ask !== null, `must ask: ${who(c)}`);
  }
});

Deno.test("INVARIANT 2 — fail closed: spend / outbound / mutation keeps every blocking question for the router", () => {
  for (const c of CASES) {
    if (c.t.consequence === "answer" || c.t.ask) continue;
    const before = c.request.ambiguity.filter((a) => a.blocking).length;
    assertEquals(c.t.request.ambiguity.filter((a) => a.blocking).length, before, who(c));
    assertEquals(c.t.notes.length, 0, who(c));
    if (before > 0) {
      const route = routeRequest(c.t.orion.request, { spendAllowed: true, confirmationRequired: true, bindings: c.t.resolution.bindings });
      assertEquals(bindRoute(route).kind, "reply", `the router must ask: ${who(c)}`);
    }
  }
});

Deno.test("INVARIANT 3 — an unbound or ambiguous single company always asks, whatever the consequence", () => {
  for (const c of CASES) {
    if (c.t.references.some((r) => r.target === "entity" && !r.bound)) {
      assert(c.t.ask !== null, who(c));
      assertEquals(c.t.decision, "ask:entity_unbound", who(c));
    }
  }
  // And "that one" against several companies is never resolved by guessing.
  // (Only where the parsed request kept the reference: the parser drops references a part cannot carry.)
  const ambiguous = CASES.filter((c) => c.state === "many" && c.t.references.some((r) => r.value === "that one"));
  assert(ambiguous.length > 0);
  for (const c of ambiguous) assert(c.t.ask !== null, who(c) + JSON.stringify(c.t.references) + JSON.stringify(c.request.parts.map((p) => p.subject.references)));
});

Deno.test("INVARIANT 4 — an answer about earlier content or an unmatched set never asks for a company", () => {
  let n = 0;
  for (const c of CASES) {
    if (c.t.consequence !== "answer") continue;
    if (c.t.references.some((r) => r.target === "entity")) continue;
    assertEquals(c.t.ask, null, who(c));
    n++;
  }
  assert(n > 500, `only ${n} answer cases`);
});

Deno.test("INVARIANT 5 — never invent or substitute a company set", () => {
  for (const c of CASES) {
    // Every binding is a company that was actually shown in this conversation.
    const shown = labelsOf(c.source);
    for (const b of c.t.resolution.bindings) assert(shown.has(b.label), `invented ${b.label}: ${who(c)}`);
    // An answer that pointed at an unmatched set is ORION's answer with an explicit
    // "do not guess" note — never a template read scoped to some other set.
    if (!c.t.ask && c.t.consequence === "answer" && c.t.references.some((r) => r.target === "set" && !r.bound)) {
      assert(c.t.notes.some((n) => /Do NOT guess or substitute companies/.test(n)), who(c));
      assert(c.t.orion.draft || c.t.orion.request.parts.every((p) => p.objective === "converse"), who(c));
      const leftover = c.t.request.parts.flatMap((p) => p.subject.references ?? []).filter((r) => r.kind === "prior_result");
      assertEquals(leftover.length, 0, `an unmatched reference must not reach a surface: ${who(c)}`);
    }
  }
});

Deno.test("INVARIANT 6 — an ANSWER can never spend: no paid part survives and the router may not spend", () => {
  for (const c of CASES) {
    if (c.t.ask || c.t.consequence !== "answer") continue;
    assertFalse(c.t.orion.request.parts.some((p) => PAID.has(p.objective)), who(c));
    if (c.t.orion.draft) continue; // ORION's text-only draft: no route is taken
    const route = routeRequest(c.t.orion.request, { spendAllowed: true, confirmationRequired: true, bindings: c.t.resolution.bindings });
    assertFalse(route.may_spend, who(c));
  }
});

Deno.test("INVARIANT 7 — a request that may spend is classified as spend unless ORION will only explain it", () => {
  for (const c of CASES) {
    const paid = c.request.parts.some((p) => p.objective === "source" || p.objective === "research");
    if (!paid) continue;
    if (c.t.consequence === "answer") {
      // Only an explicit no-execution instruction turns a paid reading into an explanation.
      assert(/do nothing|do not|don't/i.test(c.u), `paid request treated as an answer: ${who(c)}`);
    } else {
      assertEquals(c.t.consequence, "spend", who(c));
    }
  }
});

Deno.test("MIXED 'scrape and explain' — always spend; with an unbound target it asks; bound, it still needs Start", () => {
  const cases = CASES.filter((c) => c.u.startsWith("Scrape 50 companies like those"));
  assert(cases.length > 0);
  for (const c of cases) {
    assertEquals(c.t.consequence, "spend", who(c));
    if (c.t.ask) continue;
    const route = routeRequest(c.t.orion.request, { spendAllowed: true, confirmationRequired: true, bindings: c.t.resolution.bindings });
    const b = bindRoute(route);
    assert(b.kind === "reply" || route.requires_confirmation, `paid work must be confirmed or blocked: ${who(c)}`);
  }
});

Deno.test("MIXED 'summarize, then send' — never sends with delegation off; otherwise outbound only with every target bound", () => {
  const cases = CASES.filter((c) => c.u.startsWith("Summarize those findings, then send"));
  assert(cases.length > 0);
  for (const c of cases) {
    if (c.t.ask) continue;
    // Whatever the reading, either ORION only answers (no compose part survives,
    // so nothing can be sent) or the request is OUTBOUND, in which case every
    // reference is bound and the compose route's own confirmation applies.
    const answersOnly = c.t.consequence === "answer" &&
      !c.t.orion.request.parts.some((p) => p.objective === "compose");
    if (!answersOnly) {
      assertEquals(c.t.consequence, "outbound", who(c));
      assert(c.delegation, `outbound is only possible with delegation on: ${who(c)}`);
      assertFalse(c.t.references.some((r) => !r.bound), who(c));
    }
    if (!c.delegation) assertEquals(c.t.consequence, "answer", who(c));
  }
});

Deno.test("DETERMINISM — the same reading always gives the same decision", () => {
  for (const c of CASES.filter((_, i) => i % 37 === 0)) {
    const again = planTurnRouting({ request: c.request, message: c.u, source: c.source, evidenceEnabled: true, delegationEnabled: c.delegation });
    assertEquals(JSON.stringify(again), JSON.stringify(c.t), who(c));
  }
});
