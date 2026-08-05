// THE USER SAW "Edge Function returned a non-2xx status code".
//
// The first real "Continue verification" click returned 403 with an exact,
// actionable reason — `conversation_workspace_mismatch` — and none of it reached
// the screen. `supabase.functions.invoke` sets `data` to null and never reads
// the body on a non-2xx; its `error.message` is the generic string above.
//
// So the helper now recovers the body from the Response the client attaches, and
// maps status + backend code to something a user can act on. Nothing it renders
// contains a token, a SQL detail or a service value.
//
// Pure and structural — no DOM, no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { describeContinuationError } from "../../src/lib/workbench/continuationErrors.ts";

Deno.test("every status maps to a message the user can act on", () => {
  assertEquals(describeContinuationError(401),
    "Your session expired. Sign in again and retry.");
  assertEquals(describeContinuationError(403),
    "You do not have access to continue this workflow.");
  assertEquals(describeContinuationError(409),
    "This workflow already has a continuation or is no longer eligible.");
  assertEquals(describeContinuationError(500),
    "The continuation could not start. No paid work was launched.");
  assertEquals(describeContinuationError(502),
    "The continuation could not start. No paid work was launched.");

  // THE GENERIC STRING MUST NEVER BE WHAT THE USER READS.
  for (const s of [400, 401, 403, 404, 409, 500, 502, null, undefined]) {
    const m = describeContinuationError(s as number);
    assertFalse(m.includes("non-2xx"), `status ${s} still leaks the generic message`);
    assert(m.length > 10);
  }
});

Deno.test("the backend's own safe message is preferred when it sends one", () => {
  assertEquals(
    describeContinuationError(403, "conversation_workspace_mismatch",
      "That conversation belongs to a different workspace."),
    "That conversation belongs to a different workspace.",
    "the backend reason is more specific than the generic 403 copy");

  // A 401 never shows a backend message — session copy is the useful one.
  assertEquals(describeContinuationError(401, "unauthorized", "whatever"),
    "Your session expired. Sign in again and retry.");

  // Codes that carry their own meaning regardless of status.
  assertEquals(describeContinuationError(409, "already_continued"),
    "This workflow has already been continued.");
  assertEquals(describeContinuationError(409, "would_start_new_actor"),
    "The continuation could not start. No paid work was launched.");
});

Deno.test("no secret, token or SQL detail can reach the screen", () => {
  const leaky = "service_role eyJhbGciOiJIUzI1NiJ9.abc.def — duplicate key value violates constraint";
  // Only 4xx paths echo a backend message, and the backend never sends one of
  // these; the assertion is that our own copy contributes nothing sensitive.
  for (const s of [401, 500, 502]) {
    const m = describeContinuationError(s, null, leaky);
    assertFalse(m.includes("eyJ"), "a JWT must never be rendered");
    assertFalse(m.includes("service_role"));
    assertFalse(m.toLowerCase().includes("constraint"));
  }
  const fe = Deno.readTextFileSync(
    new URL("../../src/lib/workbench/continuationErrors.ts", import.meta.url));
  for (const forbidden of ["SERVICE_ROLE", "service_role", "SUPABASE_SERVICE"]) {
    assertFalse(fe.includes(forbidden), `${forbidden} must not appear in browser code`);
  }
});

Deno.test("the helper reads the body invoke leaves unread, and surfaces a ref", async () => {
  const src = await Deno.readTextFile(
    new URL("../../src/lib/workbench/continuationErrors.ts", import.meta.url));
  assert(src.includes("ctx instanceof Response"),
    "the real reason lives on error.context, not error.message");
  assert(src.includes("await ctx.clone().json()"));
  assert(src.includes("x-request-id"), "an invocation ref helps correlate with logs");
  assertFalse(src.includes("error.message"),
    "the generic invoke message must not be what we display");

  // …and the caller wires the two together.
  const caller = await Deno.readTextFile(
    new URL("../../src/lib/workbench/continueWorkflow.ts", import.meta.url));
  assert(caller.includes("await readErrorBody(error)"));
  assert(caller.includes("describeContinuationError(detail.status, detail.code, detail.message)"),
    "the displayed message must come from the mapper, not from invoke");

  const bar = await Deno.readTextFile(new URL(
    "../../src/components/chat/workspace/workbench/ContinueVerificationBar.tsx", import.meta.url));
  assert(bar.includes("r.request_id"), "the ref must be shown when present");
  assert(bar.includes("r.error !== 'continuation_failed'"),
    "a real backend code should be visible, a placeholder should not");
});
