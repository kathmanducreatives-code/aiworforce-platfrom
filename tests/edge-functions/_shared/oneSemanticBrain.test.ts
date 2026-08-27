// THERE IS ONE SEMANTIC BRAIN, AND NOTHING MAY RESCUE OR OVERRIDE IT.
//
// ── WHY THESE ARE IMPORT AND SYMBOL GUARDS, NOT BYTE WINDOWS ───────────────
//
// The architecture this file defends was broken by things a unit test cannot
// see: a category string that no consumer recognised, a reference kind resolved
// against the wrong corpus, a shared metadata flag five writers wrote and one
// reader claimed. Every module passed its own tests throughout.
//
// So these assert the SEAMS. An import that must not exist, a symbol that must
// not be reachable, a vocabulary that must stay one value wide. They fail when
// someone reconnects a deleted parser, which is the only way this regresses.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";

const F = (p: string) => new URL(`../../../supabase/functions/${p}`, import.meta.url);
const read = (p: string) => Deno.readTextFile(F(p));
/** Source with comments stripped — prose names removed symbols to explain them. */
const code = (src: string) =>
  src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");

// ══ 1. THE DELETED PARSERS ARE UNREACHABLE ═════════════════════════════════

Deno.test("1. the sentence-reading parsers no longer exist as exports", async () => {
  // Each of these read a user's sentence and decided what it meant, competing
  // with Chat Brain for the same job. Their mission-derived siblings survive in
  // the same files — which is why they were removed by CALLER analysis rather
  // than by filename.
  const leadIntent = await read("_shared/leadIntent.ts");
  assertFalse(/export function extractLeadIntent/.test(leadIntent),
    "extractLeadIntent parsed English into a lead intent");
  assertFalse(/export function routeSource\b/.test(leadIntent),
    "routeSource chose a provider surface by regex over a subject string");

  const model = await read("_shared/leadIntentModel.ts");
  assertFalse(/export function separateIntent\b/.test(model),
    "separateIntent chose account-first vs profile-first by persona regexes");

  // The execution contracts in those same files MUST still be there.
  assert(/export function leadIntentFromMission/.test(leadIntent),
    "the mission projection is an execution contract and must survive");
  assert(/export function separatedIntentFromMission/.test(model),
    "orchestrate reads the source strategy from the compiled mission");
});

Deno.test("2. no production module imports a deleted parser", async () => {
  const dirs = ["pilot-chat/index.ts", "orchestrate/index.ts", "run-agent/index.ts"];
  for (const d of dirs) {
    const src = code(await read(d));
    assertFalse(/\bextractLeadIntent\s*\(/.test(src), `${d} calls extractLeadIntent`);
    assertFalse(/\bseparateIntent\s*\(/.test(src), `${d} calls separateIntent`);
    assertFalse(/\brouteSource\s*\(/.test(src), `${d} calls routeSource`);
  }
});

// ══ 2. A REFERENCE IS RESOLVED AGAINST THE RIGHT CORPUS ════════════════════

Deno.test("3. only a conversational referent is resolved against chat referents", async () => {
  // `saved_set` means a DURABLE workspace collection — "my leads", "my ICP".
  // Resolving it against chat referents made every such question fail
  // `no_prior_results` and ask which company was meant, before the router ran.
  const binding = code(await read("_shared/referentBinding.ts"));
  const m = binding.match(/const pointsBack\s*=\s*\(kind: string\)\s*=>\s*([^;]+);/);
  assert(m, "pointsBack must exist and be the single decision");
  assertEquals(m![1].trim(), 'kind === "prior_result"',
    "a durable workspace reference is not a conversational back-reference");

  const persistence = code(await read("_shared/referentPersistence.ts"));
  assertFalse(/kind === "saved_set"/.test(persistence),
    "the lookup guard must not fire on a workspace collection either");
});

Deno.test("4. the model is told what the three reference kinds mean", async () => {
  // The enum was in the JSON schema and nowhere in the prompt, so the model was
  // choosing among three undefined words by their English meaning — and "my
  // leads" reasonably reads as a set that is saved.
  const brain = await read("_shared/chatBrain.ts");
  for (const kind of ["named", "saved_set", "prior_result"]) {
    assert(new RegExp(`^${kind}\\s`, "m").test(brain),
      `the prompt must define the reference kind "${kind}"`);
  }
});

// ══ 3. THE ROUTE CARRIES A PAYLOAD, NOT A CATEGORY STRING ══════════════════

Deno.test("5. no route is laundered through an invalid legacy category", async () => {
  const binding = code(await read("_shared/chatBrainBinding.ts"));
  assertFalse(binding.includes("qualified_lead_sourcing"),
    "that string is not a member of WorkflowCategory and matched no branch");

  // The surviving translation is exactly one value wide, enforced by a type.
  const decl = (await read("_shared/chatBrainBinding.ts"))
    .match(/export type BoundCategory\s*=\s*([^;]+);/);
  assert(decl, "BoundCategory must be declared");
  assertEquals(decl![1].trim(), '"simple_chat"');
});

Deno.test("6. a lead route compiles a mission and delegates it", async () => {
  const pilot = await read("pilot-chat/index.ts");
  const i = pilot.indexOf("if (chatBrainEnabled(readEnvSafe))");
  const end = pilot.indexOf("── PHASE 0 BASELINE", i);
  assert(i > 0 && end > i, "the Chat Brain block must be locatable");
  const block = pilot.slice(i, end);
  assert(block.includes("compileRequestMission("),
    "the projection Chat Brain produced must become the mission");
  assert(block.includes("delegateToOrchestrate("),
    "and be delegated, so orchestrate receives one");
});

Deno.test("7. the mission is compiled WITHOUT a second read of the sentence", async () => {
  // `compileCanonicalLeadMission` calls `proposeMission`, a fresh GPT read of the
  // same words. On the Chat Brain path that is a second brain: it can disagree
  // about what was asked, and whichever answer reaches the compiler last decides
  // what gets bought.
  const rtm = code(await read("_shared/requestToMission.ts"));
  assertFalse(/proposeMission|generateText|gptStructured/.test(rtm),
    "the request-to-mission path must not invoke a model");
  assert(rtm.includes("compileLeadMission("),
    "it hands the existing compiler the projection it already has");
});

// ══ 4. A CLARIFICATION IS OWNED ════════════════════════════════════════════

Deno.test("8. no bare pending_clarification flag survives", async () => {
  // Five sites wrote `pending_clarification: true`; one reader claimed all of
  // them. A Chat Brain question was answered by the lead people-vs-companies
  // menu, which then re-armed the flag and held the user there.
  const pilot = code(await read("pilot-chat/index.ts"));
  assertFalse(/pending_clarification:\s*true/.test(pilot),
    "every clarification must declare an owner");
  assert(pilot.includes('clarificationOwnedBy(meta, "lead_source_selector")'),
    "the legacy resolver may claim only its own questions");
});

Deno.test("9. an unowned clarification falls through to understanding", async () => {
  const { clarificationOwnedBy, pendingClarification } = await import(
    "../../../supabase/functions/_shared/clarificationContract.ts");

  const mine = pendingClarification("referent", "ambiguous_referent");
  assert(clarificationOwnedBy(mine, "referent"), "the owner may read its own");
  assertEquals(clarificationOwnedBy(mine, "lead_source_selector"), null,
    "and nobody else may");

  // A row written before the contract is history, not an instruction.
  assertEquals(clarificationOwnedBy({ pending_clarification: true }, "lead_source_selector"),
    null, "a legacy bare flag is claimed by no one");
});
