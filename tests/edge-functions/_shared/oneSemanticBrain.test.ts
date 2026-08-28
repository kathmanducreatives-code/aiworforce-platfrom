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
  const i = pilot.indexOf("══ START OF THE CHAT BRAIN BLOCK");
  const end = pilot.indexOf("══ END OF THE CHAT BRAIN BLOCK", i);
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

// ══ 5. NOTHING SEMANTIC RUNS BEFORE THE BRAIN ══════════════════════════════

Deno.test("10. no regex decides meaning before understandRequest", async () => {
  // The gates that used to sit here — the daily-brief phrase table and the
  // people/companies resolver — each decided what a message meant before the
  // layer that exists to decide that was consulted. A message must reach Chat
  // Brain unless something NON-semantic stops it: auth, membership, a malformed
  // body, or a failure to record the turn.
  const pilot = await read("pilot-chat/index.ts");
  const brainAt = pilot.indexOf("══ START OF THE CHAT BRAIN BLOCK");
  assert(brainAt > 0, "Chat Brain must be wired");

  // Only the request handler, not the helpers declared above it.
  const handlerAt = pilot.indexOf("async function handlePilotChat");
  assert(handlerAt > 0 && handlerAt < brainAt);
  const before = code(pilot.slice(handlerAt, brainAt));

  assertFalse(/_RE\s*=|new RegExp\(/.test(before),
    "no regex may be declared ahead of the semantic layer");
  assertFalse(/classifyWorkflow\(|classifyIntent\(/.test(before.replace(
    /const wf = await classifyWorkflow\(message\);[\s\S]*$/, "")),
    "no classifier may return before Chat Brain is consulted");
});

Deno.test("11. the pre-brain returns are non-semantic, or owner-scoped", async () => {
  // Each early return must be infrastructure (auth, membership, body, persistence)
  // or a resolver answering ITS OWN question. Nothing may claim an arbitrary
  // message on the strength of what it appears to say.
  const pilot = await read("pilot-chat/index.ts");
  const handlerAt = pilot.indexOf("async function handlePilotChat");
  const brainAt = pilot.indexOf("══ START OF THE CHAT BRAIN BLOCK");
  const before = pilot.slice(handlerAt, brainAt);

  // The one non-infrastructure gate left is the lead source selector, and it is
  // gated on ownership — it cannot read a question it did not ask.
  const clarificationReturns = [...before.matchAll(/clarification: true/g)].length;
  assert(clarificationReturns > 0, "the selector still resolves its own menu");
  assert(before.includes('clarificationOwnedBy(meta, "lead_source_selector")'),
    "and may only do so for clarifications it owns");
});

// ══ 6. THE CLASSIFIER STACK IS DELETED, NOT DORMANT ════════════════════════

Deno.test("12. no classifier module exists to be imported", async () => {
  // Deleted files, not disconnected ones. A dormant copy one import away from
  // the live path is how this architecture came back the first time.
  for (const f of [
    "_shared/workflowClassifier.ts",
    "_shared/capabilityValidator.ts",
    "_shared/intentRouter.ts",
  ]) {
    let exists = true;
    try { await Deno.stat(F(f)); } catch { exists = false; }
    assertFalse(exists, `${f} must not exist`);
  }
});

Deno.test("13. nothing in production names a deleted symbol", async () => {
  const files = [
    "pilot-chat/index.ts", "orchestrate/index.ts", "run-agent/index.ts",
    "_shared/toolInputPlanner.ts", "_shared/leadIntent.ts",
    "_shared/leadIntentModel.ts", "_shared/companyBrainGate.ts",
  ];
  const dead = [
    "classifyWorkflow", "classifyIntent", "validateAgainstCapabilities",
    "planToolInput", "extractLeadIntent", "separateIntent", "routeSource",
    "WorkflowDecision", "chatBrainEnabled",
  ];
  for (const f of files) {
    const src = code(await read(f));
    for (const sym of dead) {
      assertFalse(new RegExp(`\\b${sym}\\b`).test(src), `${f} still names ${sym}`);
    }
  }
});

Deno.test("14. pilot-chat holds no workflow_category decision at all", async () => {
  const src = code(await read("pilot-chat/index.ts"));
  assertFalse(/decision\.workflow_category/.test(src),
    "the category object is gone; routes carry their own payloads");
  assertFalse(/workflow_category\s*===/.test(src),
    "and nothing branches on a category string");
});

Deno.test("15. a model failure does not reach a second interpreter", async () => {
  // The one rule that makes the deletion permanent: if Chat Brain cannot read a
  // message, the answer is a stated failure and a conversational reply. A
  // fallback interpreter reached only when the primary fails is the same
  // architecture, hidden better.
  const src = await read("pilot-chat/index.ts");
  const i = src.indexOf("unreadable — no fallback interpreter");
  assert(i > 0, "the unreadable branch must say what it does");
  const after = code(src.slice(i, i + 1200));
  assertFalse(/classify|Classifier|parseIntent|fallbackParse/.test(after),
    "nothing may re-read the sentence after understanding failed");
});

Deno.test("16. the safety refusal survived the deletion, and runs first", async () => {
  // The one regex over a user's sentence that remains. It answers a yes/no about
  // PERMISSION and never selects a surface — and the approval gates downstream
  // are what actually hold, so this is defence in depth plus an honest answer.
  const guard = code(await read("_shared/unsafeRequestGuard.ts"));
  assert(guard.includes("asksForUnsafeAction"));
  assertFalse(/objective|route|surface|category/i.test(
    guard.replace(/UNSAFE_REQUEST_REPLY[\s\S]*/, "")),
    "the guard must not decide what a request IS");

  const pilot = await read("pilot-chat/index.ts");
  const start = pilot.indexOf("══ START OF THE CHAT BRAIN BLOCK");
  const guardAt = pilot.indexOf("asksForUnsafeAction(message)", start);
  const firstSurface = pilot.indexOf('brainRoute.kind === "signal_sourcing"', start);
  assert(guardAt > start && firstSurface > guardAt,
    "the refusal must run before any surface can be reached");
});

// ══ 7. NOTHING IN THE BLOCK MAY REACH FORWARD ══════════════════════════════

Deno.test("17. helpers the Chat Brain block calls are declared before it", async () => {
  // ── THE BUG THIS CATCHES, WHICH NOTHING ELSE COULD ──────────────────────
  //
  // `replyAndReturn` is a function declaration and hoists. The `const baseMeta`
  // it closed over did not, and sat 50 lines BELOW the block that called it. So
  // every refusal path inside the block — the whole of `converse`, the
  // market-research reply, outreach-without-leads, the signal-sourcing
  // clarifications, the onboarding gate and the unsafe-request refusal — threw
  // `ReferenceError: Cannot access 'baseMeta' before initialization`.
  //
  // The moment Pilot had something careful to say, it crashed. `hello`
  // reproduced it in production.
  //
  // `deno check` cannot see this: the reference is well-typed, and only the
  // execution ORDER is wrong. No unit test saw it either, because none of them
  // execute the handler. A declaration-order assertion is what is left.
  const src = await read("pilot-chat/index.ts");
  const blockStart = src.indexOf("══ START OF THE CHAT BRAIN BLOCK");
  const blockEnd = src.indexOf("══ END OF THE CHAT BRAIN BLOCK");
  assert(blockStart > 0 && blockEnd > blockStart);
  const block = src.slice(blockStart, blockEnd);

  // Every helper the block invokes must be declared above `blockStart`.
  for (const helper of ["replyAndReturn", "replyMeta", "showWorkflowConfirmation"]) {
    if (!new RegExp(`\\b${helper}\\(`).test(block)) continue;
    const decl = Math.max(
      src.indexOf(`const ${helper} =`),
      src.indexOf(`async function ${helper}`),
      src.indexOf(`function ${helper}`),
    );
    assert(decl > 0, `${helper} must be declared somewhere`);
    assert(decl < blockStart,
      `${helper} is called inside the Chat Brain block but declared after it — ` +
      `a const it closes over will be in the temporal dead zone at runtime`);
  }
});
