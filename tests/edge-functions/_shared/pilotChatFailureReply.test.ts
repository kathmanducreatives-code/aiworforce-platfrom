// A REFUSAL THE USER CANNOT SEE IS INDISTINGUISHABLE FROM A CRASH.
//
// TEST 2026-08-21. The OpenAI balance ran out, so the GPT mission compiler was
// refused twice and raised `MissionCompilationFailedError` — correctly. It
// declines to substitute a regex reading of the user's request for a mission it
// could not compile, which is the whole point of the compiled-mission
// architecture.
//
// `Deno.serve` had no catch around it. The correct refusal became an unhandled
// throw, Deno answered 500 with no body the UI could render, and the chat
// showed NOTHING AT ALL. Four messages were sent that afternoon; every one of
// them vanished. The report was "the software is not working" — exactly right,
// and useless for saying which of a hundred things it might be.
//
// Diagnosing it took a manual call to the OpenAI API.
//
// ── WHY THESE TESTS READ SOURCE ─────────────────────────────────────────────
//
// `pilot-chat/index.ts` calls `Deno.serve` at module scope, so importing it
// would start a server inside the test runner. Every existing test of an edge
// entrypoint in this repository reads the file instead — `gptMissionCompiler`
// and `executionLedgerWiring` both do. These follow that, and assert the
// STRUCTURE that was missing rather than prose.
//
// ZERO network, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const PILOT = await Deno.readTextFile(
  new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url),
);

/** The `Deno.serve(...)` call and everything inside it. */
function serveBlock(): string {
  const i = PILOT.lastIndexOf("Deno.serve(");
  assert(i !== -1, "pilot-chat must still serve");
  return PILOT.slice(i);
}

/**
 * Only the strings `failureMessageFor` actually returns.
 *
 * The comments around them explain what must not be said, so reading the whole
 * function would match the very words it forbids.
 */
function userFacingText(): string {
  const start = PILOT.indexOf("function failureMessageFor");
  const body = PILOT.slice(start, PILOT.indexOf("\nDeno.serve(", start));
  return (body.match(/"[^"]{20,}"/g) ?? []).join(" ");
}

// ═══ 1. THE HANDLER IS WRAPPED AT ALL ══════════════════════════════════════

Deno.test("1. the request handler runs inside a try/catch", () => {
  const serve = serveBlock();
  assert(/try\s*\{/.test(serve), "an unwrapped handler is how four messages vanished");
  assert(/catch\s*\(/.test(serve), "and the catch is the part that answers");
  assert(serve.includes("handlePilotChat"),
    "the handler is a named function so the wrapper can be read at a glance");
});

Deno.test("2. the handler itself is no longer the serve callback", () => {
  // If someone inlines it back, the wrapper goes with it.
  assert(PILOT.includes("async function handlePilotChat("),
    "the body must stay extracted");
  assertEquals(
    PILOT.split("Deno.serve(").length - 1, 1,
    "exactly one serve call — a second would have its own unguarded handler",
  );
});

// ═══ 2. THE FAILURE BECOMES A MESSAGE, NOT A STATUS CODE ═══════════════════

Deno.test("3. the catch writes an assistant message into the conversation", () => {
  const serve = serveBlock();
  assert(serve.includes('.from("messages")'), "the user must find it in the chat");
  assert(serve.includes('role: "assistant"'));
  assert(serve.includes('agent_slug: "pilot"'));
  // The metadata now comes from `failureMetadata`, which sets `type: "error"`
  // AND the structured category. It used to be an inline `{ type, kind }` that
  // discarded `String(e)` and the provider code already in scope — so a missing
  // capability, a provider outage and a ReferenceError were stored identically.
  assert(serve.includes("failureMetadata(e"),
    "the failure category must be preserved on the row, not just logged");
});

Deno.test("3b. the failure record carries a category and the message", async () => {
  const { failureMetadata } = await import(
    "../../../supabase/functions/_shared/outcomeContract.ts");

  const tdz = failureMetadata(
    new ReferenceError("Cannot access 'baseMeta' before initialization"));
  assertEquals(tdz.type, "error", "the UI still styles it without parsing prose");
  assertEquals(tdz.outcome.state, "FAILED");
  assertEquals(tdz.outcome.category, "internal_error",
    "a temporal dead zone is a defect, never a transient glitch worth retrying");
  assert(String(tdz.error_message).includes("before initialization"),
    "the reason must reach the row, not only console.error");

  const quota = failureMetadata(new Error("credits_exhausted for provider"));
  assertEquals(quota.outcome.category, "provider_failure");
});

Deno.test("4. it returns the SHAPE of a normal reply", () => {
  // A distinct error envelope would make the UI learn a second one, and the UI
  // was not the thing that broke.
  const serve = serveBlock();
  assert(/type:\s*"reply"/.test(serve));
  assert(serve.includes("conversation_id:"));
  assert(serve.includes("message: saved"));
});

Deno.test("5. the compilation refusal is named, and everything else is not guessed at", () => {
  assert(PILOT.includes("MissionCompilationFailedError"),
    "the one failure with a specific explanation");
  assert(PILOT.includes("mission_compilation_failed"),
    "recorded as a kind, so it is countable");
  // The message must NOT claim a cause the compiler cannot know. A refused
  // compilation looks identical whether the provider was out of credits, down,
  // or slow — `gpt_quota_exhausted` carries that, in the logs.
  //
  // Checked against the RETURNED STRINGS, not the function's source: the first
  // draft of this test read the whole body and matched its own comment
  // explaining why the word must not appear.
  assert(!/no credits|billing|quota/i.test(userFacingText()),
    `the user-facing text must not diagnose a cause this layer cannot see: ${userFacingText()}`);
});

// ═══ 3. WHAT IT PROMISES THE USER IS TRUE ══════════════════════════════════

Deno.test("6. the message says nothing was started or charged — and that is true", () => {
  const fn = PILOT.slice(PILOT.indexOf("function failureMessageFor"));
  assert(/nothing was started/i.test(fn));
  assert(/nothing was charged/i.test(fn));
  // It IS true: `MissionCompilationFailedError` is raised before any capability
  // plan exists, so no provider call and no credit reservation has happened.
  // If that ever stops being true, this promise becomes a lie and this test is
  // where someone should notice.
  assert(PILOT.indexOf("MissionCompilationFailedError") < PILOT.indexOf("delegateToOrchestrate"),
    "compilation is refused before anything is delegated, which is what makes the promise honest");
});

// ═══ 4. THE PATHS WHERE THERE IS NOWHERE TO WRITE ══════════════════════════

Deno.test("7. a failure before the conversation exists still answers", () => {
  const serve = serveBlock();
  assert(/if\s*\(!fail\.admin\s*\|\|\s*!fail\.conversationId\)/.test(serve),
    "auth and body failures happen before there is anywhere to put a message");
  assert(serve.includes('"pilot_chat_failed"'),
    "and then the status code is the whole answer, which is at least truthful");
});

Deno.test("8. a failing INSERT does not replace one silence with another", () => {
  const serve = serveBlock();
  const catchBlock = serve.slice(serve.indexOf("catch ("));
  assert(catchBlock.includes("save-failed"),
    "the database is the last thing between the user and silence; when it fails, say so");
  // Two try blocks inside the catch: the outer one guards the handler, the
  // inner one guards the write.
  assert((catchBlock.match(/try\s*\{/g) ?? []).length >= 1,
    "the insert is itself guarded");
});

// ═══ 5. THE THROW IS STILL LOUD WHERE IT SHOULD BE ═════════════════════════

Deno.test("9. the maintainer still gets the error, the user does not", () => {
  const serve = serveBlock();
  assert(serve.includes('console.error("[pilot-chat][unhandled]"'),
    "the stack is what a maintainer needs and the last thing a user does");
  assert(serve.includes("conversation_id:"),
    "logged with the conversation, so a report can be traced to a turn");
});

Deno.test("10. the context is handed over as soon as it exists, not at the end", () => {
  // The catch is reachable from anywhere in a 3,000-line handler. If these were
  // assigned late, every failure before that point would fall back to a bare
  // status code — which is the behaviour being replaced.
  const adminAt = PILOT.indexOf("fail.admin = admin;");
  const convAt = PILOT.indexOf("fail.conversationId = conversation_id;");
  assert(adminAt !== -1 && convAt !== -1);
  // The landmark was `workflow_confirmation_gate`, a category-list gate that has
  // since been deleted. The point of the assertion is unchanged: both must be
  // handed over before ANY path that can refuse or spend, and the earliest of
  // those is now the Chat Brain block itself.
  const brainAt = PILOT.indexOf("══ START OF THE CHAT BRAIN BLOCK");
  assert(brainAt > 0, "the understanding layer must be locatable");
  assert(adminAt < brainAt,
    "the admin client is handed over before anything can refuse");
  assert(convAt < brainAt,
    "and so is the conversation");
});
