// WHAT AN UNDERSTOOD REQUEST IS ALLOWED TO CAUSE.
//
// GPT decided what the user meant. Everything asserted here is deterministic —
// which surface serves it, whether it may spend, and what happens when nothing
// can. The model is an input to these decisions and never an authority over
// them.
//
// Pure. No network, no model, no database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  routeRequest, OBJECTIVE_ROUTER_VERSION,
} from "../../../supabase/functions/_shared/objectiveRouter.ts";
import {
  REQUEST_V1_VERSION, type RequestV1, type RequestPart, type RequestObjective,
} from "../../../supabase/functions/_shared/requestV1.ts";

const part = (objective: RequestObjective, over: Partial<RequestPart> = {}): RequestPart => ({
  id: over.id ?? "p1", objective,
  subject: { entity: objective === "compose" ? "content" : "company", ...(over.subject ?? {}) },
  output: over.output ?? { shape: objective === "converse" || objective === "read"
    ? "answer" : "records", count: null },
  ...over,
});

const req = (parts: RequestPart[], over: Partial<RequestV1> = {}): RequestV1 => ({
  version: REQUEST_V1_VERSION, utterance: "u",
  objective: parts[0].objective, parts, ambiguity: [],
  authority: { may_spend: false, max_cost_units: null, requires_confirmation: true },
  provenance: {}, confidence: 0.9, ...over,
});

const ALLOW = { spendAllowed: true };
const DENY = { spendAllowed: false };

// ══ 1. READ CANNOT SPEND, BY CONSTRUCTION ══════════════════════════════════

Deno.test("prose about a specific thing is a conversation, not a table", () => {
  // "What is my current ICP" is a read wanting prose. It was answered with the
  // daily brief — byte-identical to the one "how are things looking" received —
  // because any prose-shaped read claimed that surface. A question about one
  // stored field has no row-shaped answer.
  const r = routeRequest(req([part("read", {
    subject: { entity: "company", references: [] },
    output: { shape: "answer", count: null },
  })]), ALLOW);
  assertEquals(r.kind, "converse");
  assertEquals(r.reason, "held_knowledge_as_prose");
  assertEquals(r.may_spend, false, "still zero-spend, whichever surface answers");
});

Deno.test("prose about the WORKSPACE is still the brief", () => {
  const r = routeRequest(req([part("read", {
    subject: { entity: "conversation", references: [] },
    output: { shape: "answer", count: null },
  })]), ALLOW);
  assertEquals(r.kind, "read", "the brief is served through the read route");
});

Deno.test("a read route carries no provider surface at all", () => {
  // Not "does not spend" — CANNOT. There is no mission attached, so there is
  // nothing downstream could invoke even by mistake. The absence IS the
  // guarantee, and it is stronger than a flag someone can forget to check.
  // A LIST read. The helper defaults `read` to prose, and prose about a
  // specific entity is now a grounded conversation rather than a table — see
  // the test below. The zero-spend guarantee holds for both.
  const r = routeRequest(req([part("read", {
    output: { shape: "records", count: null },
  })]), ALLOW);
  assertEquals(r.kind, "read");
  assertEquals(r.may_spend, false);
  assertEquals(r.lead, undefined, "a read must not carry a mission");
  assertEquals(r.requires_confirmation, false);
});

Deno.test("read stays free even when the workspace allows spending", () => {
  assertEquals(routeRequest(req([part("read")]), ALLOW).may_spend, false);
});

Deno.test("converse carries nothing and confirms nothing", () => {
  const r = routeRequest(req([part("converse")]), ALLOW);
  assertEquals(r.kind, "converse");
  assertEquals(r.may_spend, false);
  assertEquals(r.lead, undefined);
});

// ══ 2. SPEND NEEDS BOTH THE OBJECTIVE AND THE AUTHORITY ════════════════════

Deno.test("source may spend only when the caller allows it", () => {
  assertEquals(routeRequest(req([part("source")]), ALLOW).may_spend, true);
  assertEquals(routeRequest(req([part("source")]), DENY).may_spend, false,
    "workspace policy alone can withhold spend");
});

Deno.test("the model cannot grant spend by setting it on the request", () => {
  // `parseRequestStrict` already forces `may_spend: false`; this proves the
  // router does not read it either, so a hand-built request cannot bypass it.
  const forged = req([part("source")], {
    authority: { may_spend: true, max_cost_units: 999, requires_confirmation: false },
  });
  assertEquals(routeRequest(forged, DENY).may_spend, false);
});

Deno.test("research and source both reach the lead surface — research needs a name", () => {
  // They share a surface and differ by POPULATION. `research` therefore
  // requires an identity: without one it is indistinguishable from discovery,
  // and would buy a full discovery run to answer a question about one company.
  const sourced = routeRequest(req([part("source")]), ALLOW);
  assertEquals(sourced.kind, "lead_mission");
  assertEquals(sourced.lead!.refusal, null);

  const named = routeRequest(req([part("research", {
    subject: { entity: "company", references: [{ kind: "named", value: "Vercel" }] },
  })]), ALLOW);
  assertEquals(named.kind, "lead_mission");
  assertEquals(named.lead!.refusal, null);

  const nameless = routeRequest(req([part("research")]), ALLOW);
  assertEquals(nameless.kind, "clarify", "research naming nobody must not become discovery");
  assertEquals(nameless.may_spend, false);
});

Deno.test("a named entity is reported as investigation, not discovery", () => {
  const named = routeRequest(req([part("research", {
    subject: { entity: "company", references: [{ kind: "named", value: "Vercel" }] },
  })]), ALLOW);
  assertEquals(named.reason, "named_entity_investigation");
  assertEquals(named.lead!.proposal.known_companies, ["Vercel"]);
  assertEquals(routeRequest(req([part("source")]), ALLOW).reason, "discovery");
});

// ══ 3. A BLOCKING AMBIGUITY STOPS EVERYTHING FIRST ═════════════════════════

Deno.test("blocking ambiguity refuses before a surface is even chosen", () => {
  // The cheapest refusal is the one taken before any commitment, and targeting
  // the wrong entity is the most expensive mistake available.
  const r = routeRequest(req([part("source")], {
    ambiguity: [{ part_id: "p1", field: "subject.references",
      question: "Which company did you mean?", blocking: true }],
  }), ALLOW);
  assertEquals(r.kind, "blocked");
  assertEquals(r.may_spend, false);
  assertEquals(r.lead, undefined, "nothing is projected for a blocked request");
  assertEquals(r.message, "Which company did you mean?");
});

Deno.test("non-blocking ambiguity does not stop the run", () => {
  const r = routeRequest(req([part("source")], {
    ambiguity: [{ part_id: "p1", field: "filters",
      question: "How fast is fast-growing?", blocking: false }],
  }), ALLOW);
  assertEquals(r.kind, "lead_mission");
});

// ══ 4. AN OBJECTIVE WITH NO SURFACE SAYS SO ════════════════════════════════

Deno.test("compose is SERVED — the refusal was the bug, not the guard", () => {
  // This asserted that compose clarified with "content generation isn't wired
  // up yet". The reasoning was sound and the premise was false: two surfaces
  // existed the whole time — Penn's approval-gated outreach drafts and Scribe's
  // content — and this refusal returned from the Chat Brain block before either
  // could be reached. Making Chat Brain authoritative silently disabled two
  // working features.
  //
  // The guard it was protecting still holds, one layer down: a compose request
  // is routed to a compose surface and NEVER to the nearest thing that happens
  // to be servable.
  const r = routeRequest(req([part("compose")]), ALLOW);
  assertEquals(r.kind, "compose");
  assertEquals(r.compose!.kind, "content", "no recipient means a post, not outreach");
  assertEquals(r.may_spend, false, "writing is never a provider purchase from here");
  assertEquals(r.lead, undefined, "and it must not become a sourcing run");
});

Deno.test("compose aimed at people is outreach, and requires confirmation", () => {
  // The distinction that carries the safety rule: a message to someone is
  // approval-gated, a blog post is not.
  const r = routeRequest(req([part("compose", {
    subject: { entity: "person", references: [{ kind: "saved_set", value: "my leads" }] },
    output: { shape: "artifact", count: 5 },
  })]), ALLOW);
  assertEquals(r.kind, "compose");
  assertEquals(r.compose!.kind, "outreach");
  assertEquals(r.compose!.targets_existing, true);
  assertEquals(r.compose!.count, 5);
  assertEquals(r.requires_confirmation, true);
  assertEquals(r.may_spend, false);
});

Deno.test("a request the lead pipeline cannot serve clarifies, not half-runs", () => {
  const r = routeRequest(req([part("source", {
    subject: { entity: "content" }, output: { shape: "artifact", count: null },
  })]), ALLOW);
  assertEquals(r.kind, "clarify");
  assert(r.reason.startsWith("lead_projection_refused"));
});

// ══ 5. MIXED REQUESTS ══════════════════════════════════════════════════════

Deno.test("read + source is a spending route, and names only the spending part", () => {
  // The whole request is committing, so it takes the authority check — but the
  // read part is not what spends, and `part_ids` says so.
  const r = routeRequest(req([
    part("read", { id: "a" }),
    part("source", { id: "b", depends_on: ["a"] }),
  ], { objective: "source" }), ALLOW);
  assertEquals(r.kind, "lead_mission");
  assertEquals(r.may_spend, true);
  assertEquals(r.part_ids, ["b"], "only the part that spends");
});

Deno.test("read + converse never becomes a spending route", () => {
  const r = routeRequest(req([
    part("read", { id: "a" }), part("converse", { id: "b" }),
  ]), ALLOW);
  assertEquals(r.kind, "read");
  assertEquals(r.may_spend, false);
});

Deno.test("monitor + read routes to monitoring", () => {
  const r = routeRequest(req([
    part("read", { id: "a" }), part("monitor", { id: "b" }),
  ], { objective: "monitor" }), ALLOW);
  assertEquals(r.kind, "monitor");
  assertEquals(r.part_ids, ["b"]);
});

// ══ 6. THE SEAM ════════════════════════════════════════════════════════════

Deno.test("only the lead route ever carries a mission", () => {
  // Structural proof of the read guarantee: every non-lead route has no
  // projection, so no provider is reachable from it.
  for (const o of ["converse", "read", "monitor", "compose"] as RequestObjective[]) {
    assertEquals(routeRequest(req([part(o)]), ALLOW).lead, undefined, o);
  }
});

Deno.test("the router reads nothing from the model's authority block", async () => {
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/objectiveRouter.ts", import.meta.url));
  const code = SRC.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  assertEquals(
    /request\s*\.\s*authority/.test(code), false,
    "spend authority comes from the caller's policy, never from the request",
  );
  assertEquals(OBJECTIVE_ROUTER_VERSION, "objective-router-v1");
});
