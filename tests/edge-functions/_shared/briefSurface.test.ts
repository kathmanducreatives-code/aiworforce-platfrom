// THE BRIEF IS A READ, NOT A PHRASE.
//
// ── WHAT THIS SURFACE USED TO BE ───────────────────────────────────────────
//
// A regex in `pilot-chat`, placed BEFORE Chat Brain:
//
//   /^\s*(brief me( on today)?|daily brief|today'?s (command )?brief|
//     give me today'?s (command )?brief|what should i know today\??|
//     what happened today\??|plan my day|what needs my attention\??)\s*[.!?]?\s*$/i
//
// Anchored at both ends, so nine exact phrasings were a brief and everything
// else was not — "how are things looking in my workspace right now?" was not,
// and neither was "brief me on the last few days". Worse, it ran ahead of the
// semantic layer: a regex decided what the user meant before the brain that
// exists to decide that was consulted.
//
// It is now derived from the request. `output.shape` already separates a list
// from prose, and the model already sets it: a read that wants prose about the
// workspace IS the brief. No phrase table, and the decision is Chat Brain's.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  planRead, executeRead, renderReadAnswer,
} from "../../../supabase/functions/_shared/readSurface.ts";
import {
  REQUEST_V1_VERSION, type RequestV1, type RequestEntity,
} from "../../../supabase/functions/_shared/requestV1.ts";
import { resolveCompanyIdentity } from "../../../supabase/functions/_shared/companyIdentity.ts";
import {
  REFERENT_BINDING_VERSION, type ResolvedReferentBinding,
} from "../../../supabase/functions/_shared/referentBinding.ts";

const read = (
  shape: "records" | "events" | "answer" | "artifact",
  entity: RequestEntity = "signal",
): RequestV1 => ({
  version: REQUEST_V1_VERSION, utterance: "u", objective: "read",
  parts: [{
    id: "p1", objective: "read",
    subject: { entity, references: [] },
    output: { shape, count: null },
  }],
  ambiguity: [],
  authority: { may_spend: false, max_cost_units: null, requires_confirmation: true },
  provenance: {}, confidence: 0.9,
});

// ══ 1. THE DERIVATION ══════════════════════════════════════════════════════

Deno.test("1. a read that asks for prose is the brief", () => {
  assertEquals(planRead(read("answer")).target, "brief");
  assertEquals(planRead(read("answer", "company")).target, "brief");
  assertEquals(planRead(read("answer", "conversation")).target, "brief");
});

Deno.test("2. a read that asks for a LIST is not the brief", () => {
  // The distinction the shape carries. "What leads do I have?" wants rows.
  assertEquals(planRead(read("records", "company")).target, "companies");
  assertEquals(planRead(read("records", "signal")).target, "signals");
  assertEquals(planRead(read("records", "conversation")).target, "runs");
  assertEquals(planRead(read("events", "signal")).target, "signals");
});

Deno.test("3. a SCOPED read stays scoped — one company is not a workspace", () => {
  // Once a referent has fixed a company, "how are they looking?" is a question
  // about that company. A brief would answer a wider question than was asked.
  const binding: ResolvedReferentBinding = {
    version: REFERENT_BINDING_VERSION, part_id: "p1", entity_type: "company",
    entity_key: "domain:linear.app", label: "Linear",
    identity: resolveCompanyIdentity({ name: "Linear", domain: "linear.app" }),
    source: { message_id: "m1", result_index: 0, kind: "prior_result" },
    status: "verified_match",
  };
  const req = read("answer", "company");
  req.parts[0].subject.references = [{ kind: "prior_result", value: "them" }];
  assertEquals(planRead(req, [binding]).target, "company_detail");
});

// ══ 2. IT REACHES NO PROVIDER, AND NO SECOND IMPLEMENTATION ════════════════

Deno.test("4. the brief runs no query of its own", async () => {
  // `daily-brief` already assembles it. A second assembly here would give the
  // chat and the dashboard two answers to one question, free to drift.
  const queried: string[] = [];
  const db = { from: (t: string) => { queried.push(t); throw new Error("must not query"); } };
  // deno-lint-ignore no-explicit-any
  const r = await executeRead(db as any, planRead(read("answer")), "w1");
  assertEquals(r, null, "the brief target returns no result set");
  assertEquals(queried, [], "and touches no table");
});

Deno.test("5. an unavailable brief says so — it does not report an empty workspace", () => {
  // "You have nothing" and "I could not look" are different answers and only
  // one of them is true. The fall-through must not claim the first.
  const answer = renderReadAnswer(planRead(read("answer")), null);
  assert(/couldn't pull|didn't come back/i.test(answer));
  assertFalse(/don't have any signals recorded/i.test(answer),
    "a failed brief must not be rendered as an empty workspace");
});

// ══ 3. THE REGEX GATE IS GONE ══════════════════════════════════════════════

Deno.test("6. no phrase table decides what a brief is", async () => {
  const pilot = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const code = pilot.split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  assertFalse(code.includes("DAILY_BRIEF_RE"),
    "the anchored nine-phrase gate must not survive");
  assertFalse(/brief me\( on today\)\?/.test(code),
    "nor any reconstruction of it");
});

Deno.test("7. the brief is served only from the understood read route", async () => {
  const pilot = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  // Exactly one call site, and it sits inside the Chat Brain block.
  const calls = [...pilot.matchAll(/functions\/v1\/daily-brief/g)];
  assertEquals(calls.length, 1, "one implementation, one call site");

  const brainAt = pilot.indexOf("══ START OF THE CHAT BRAIN BLOCK");
  const baselineAt = pilot.indexOf("══ END OF THE CHAT BRAIN BLOCK", brainAt);
  const callAt = calls[0].index!;
  assert(brainAt > 0 && callAt > brainAt && callAt < baselineAt,
    "the brief must be reached only after the request has been understood");
  assert(pilot.slice(brainAt, callAt).includes('plan.target === "brief"'),
    "and only through the read plan");
});
