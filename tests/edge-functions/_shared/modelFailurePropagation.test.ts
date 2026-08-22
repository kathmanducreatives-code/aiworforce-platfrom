// THE REASON A MODEL CALL FAILED, ALL THE WAY UP.
//
// ── TWO ROOT CAUSES, BOTH SILENT ────────────────────────────────────────────
//
// On 2026-08-21 the OpenAI balance ran out. The chat stopped answering and the
// only diagnostic anywhere said:
//
//     [mission-compiler][attempt-failed]  code: "no_result", detail: null
//
// `insufficient_quota` was in the response body the whole time. It was lost
// twice, independently:
//
//   1. `gptProvider` DETECTED the quota case correctly — `bodyIsQuotaExhausted`
//      has always been right — and used the finding only for the `retryable`
//      flag and a log line. The CODE, the one field callers branch on, still
//      said `http_error`. So every layer above saw a generic HTTP fault.
//
//   2. `leadMissionCompilerBinding` read `r.code` and `r.detail`. NO PRODUCER
//      ON THAT BOUNDARY HAS EVER EMITTED THOSE NAMES — `gptMissionModel` and
//      the strategist both send `errorCode` and `error`. So `code` was always
//      undefined, always fell through to the literal `"no_result"`, and
//      `detail` was always null. Not intermittently. Always, for every failure
//      that path has ever had.
//
// The comment above that reader said it existed to stop dropping the reason. It
// dropped the reason anyway, and its log line was indistinguishable from the
// bug it was meant to have fixed.
//
// Diagnosing it took a manual call to the OpenAI API to learn a fact the code
// had already established and thrown away.
//
// ZERO network, ZERO models, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isUnrecoverableModelFailure, MODEL_FAILURE_FIELD_SPELLINGS,
  NO_RESULT_CODE, readModelFailure,
} from "../../../supabase/functions/_shared/modelFailureContract.ts";
import {
  MissionCompilationFailedError,
} from "../../../supabase/functions/_shared/leadMissionCompilerBinding.ts";
import {
  isProviderFailure, PROVIDER_FAILURE_CODES,
} from "../../../supabase/functions/_shared/gptProvider.ts";

// ═══ 1. ROOT CAUSE ONE: THE CODE IS NAMED ══════════════════════════════════

Deno.test("1. quota exhaustion is its own provider failure code", () => {
  assert((PROVIDER_FAILURE_CODES as readonly string[]).includes("quota_exhausted"));
  assert(isProviderFailure("quota_exhausted"),
    "it is the PROVIDER failing to answer, not the model answering badly");
});

Deno.test("2. and it is the one nothing can retry away", () => {
  assert(isUnrecoverableModelFailure("quota_exhausted"));
  assert(isUnrecoverableModelFailure("no_api_key"));
  assert(!isUnrecoverableModelFailure("http_error"),
    "a 503 is worth another attempt");
  assert(!isUnrecoverableModelFailure("unparseable_json"),
    "and a bad body is worth re-prompting");
});

// ═══ 2. ROOT CAUSE TWO: THE READER MATCHES THE PRODUCERS ═══════════════════

Deno.test("3. THE BUG: `errorCode` is read, which is what producers emit", () => {
  const f = readModelFailure({
    ok: false, errorCode: "quota_exhausted",
    error: "OpenAI returned HTTP 429: insufficient_quota",
  });
  assertEquals(f.code, "quota_exhausted");
  assert(f.detail?.includes("insufficient_quota"));
  assert(f.reported, "a producer named a reason and the reader found it");
});

Deno.test("4. `code`/`detail` still work — the reader accepts both", () => {
  const f = readModelFailure({ ok: false, code: "http_error", detail: "HTTP 503" });
  assertEquals(f.code, "http_error");
  assertEquals(f.detail, "HTTP 503");
  assert(f.reported);
});

Deno.test("5. `no_result` is REACHED, never fallen into", () => {
  // It is a real outcome — a producer can genuinely return nothing. What it must
  // not be is what a reader gets for looking in the wrong place.
  const f = readModelFailure({ ok: false });
  assertEquals(f.code, NO_RESULT_CODE);
  assertEquals(f.detail, null);
  assertEquals(f.reported, false,
    "`reported` is what distinguishes 'the model said nothing' from " +
    "'the reader could not find what it said' — the ambiguity that hid this bug");
});

Deno.test("6. junk in, no crash out", () => {
  for (const junk of [null, undefined, "a string", 42, []]) {
    const f = readModelFailure(junk);
    assertEquals(f.code, NO_RESULT_CODE);
    assertEquals(f.reported, false);
  }
});

Deno.test("7. `errorCode` wins over `code` when both are present", () => {
  // Precedence is stated in the contract rather than emergent: `errorCode` is
  // what both live producers emit.
  const f = readModelFailure({ errorCode: "quota_exhausted", code: "http_error" });
  assertEquals(f.code, "quota_exhausted");
});

Deno.test("8. the detail is bounded, because it is logged and persisted", () => {
  const f = readModelFailure({ errorCode: "http_error", error: "x".repeat(5_000) }, 300);
  assertEquals(f.detail?.length, 300,
    "a provider error body can echo request content");
});

Deno.test("9. blank strings are not a reported reason", () => {
  const f = readModelFailure({ errorCode: "   ", error: "" });
  assertEquals(f.code, NO_RESULT_CODE);
  assertEquals(f.reported, false);
});

// ═══ 3. THE PIN: PRODUCERS AND THE CONTRACT CANNOT DRIFT APART ═════════════

Deno.test("10. every real producer's spelling is covered by the contract", () => {
  // THE TEST THAT WOULD HAVE CAUGHT THE ORIGINAL BUG. It reads the actual
  // producer sources, so a third producer inventing a fourth name fails here
  // instead of silently reporting `no_result` for a month.
  const missionModel = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/gptMissionModel.ts", import.meta.url));
  const strategist = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/leadStrategy/provider.ts", import.meta.url));

  const codeSpellings = MODEL_FAILURE_FIELD_SPELLINGS.code as readonly string[];
  for (const [name, src] of [["gptMissionModel", missionModel], ["strategist", strategist]] as const) {
    const emitted = [...src.matchAll(/\b(errorCode|failure_code)\b\s*[?:]/g)].map((m) => m[1]);
    assert(emitted.length > 0, `${name} must still emit a failure code field`);
    for (const e of emitted) {
      assert(codeSpellings.includes(e),
        `${name} emits \`${e}\`, which the contract does not read — this is ` +
        "exactly the mismatch that made every failure read as `no_result`");
    }
  }
});

Deno.test("11. the binding reads the contract, not field names of its own", () => {
  const src = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/leadMissionCompilerBinding.ts", import.meta.url));
  assert(src.includes("readModelFailure("), "one reader for this boundary");
  assert(!/typeof\s+r\?\.code\s*===\s*"string"/.test(src),
    "the hand-rolled duck-typed read is what broke; it must not come back");
  assert(!/r\?\.detail/.test(src));
});

// ═══ 4. THE REASON SURVIVES TO THE TOP ═════════════════════════════════════

Deno.test("12. the compilation error carries the provider's code", () => {
  const e = new MissionCompilationFailedError("ws-1", "enabled", {
    code: "quota_exhausted",
    detail: "OpenAI returned HTTP 429: insufficient_quota",
    reported: true,
  });
  assertEquals(e.providerCode, "quota_exhausted");
  assert(e.providerDetail?.includes("insufficient_quota"));
  assert(e.message.includes("quota_exhausted"),
    "a maintainer reading only the message still learns the cause");
});

Deno.test("13. an unreported reason stays null, not `no_result`", () => {
  // The error must not manufacture a cause it was not given. `no_result` in
  // `providerCode` would read as a provider statement.
  const e = new MissionCompilationFailedError("ws-1", "enabled", {
    code: NO_RESULT_CODE, detail: null, reported: false,
  });
  assertEquals(e.providerCode, null);
  assert(!e.message.includes("no_result"));
});

Deno.test("14. and the two-argument form still works", () => {
  const e = new MissionCompilationFailedError("ws-1", "enabled");
  assertEquals(e.providerCode, null);
  assertEquals(e.providerDetail, null);
  assert(e.message.includes("No deterministic mission was substituted"),
    "the promise the user-facing message relies on is unchanged");
});

// ═══ 5. NO SECOND ATTEMPT AGAINST AN EMPTY BALANCE ═════════════════════════

Deno.test("15. the compiler stops retrying an unrecoverable failure", () => {
  const src = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/leadMissionCompilerBinding.ts", import.meta.url));
  assert(src.includes("isUnrecoverableModelFailure(failure.code)"),
    "a retry cannot clear a quota");
  const at = src.indexOf("isUnrecoverableModelFailure(failure.code)");
  assert(src.slice(at, at + 400).includes("break"),
    "and it must leave the loop, not merely log");
});

// ═══ 6. THE USER-FACING MESSAGE IS UNCHANGED ═══════════════════════════════

Deno.test("16. the friendly reply still diagnoses nothing to the user", () => {
  // The compiler CAN now tell a quota outage from a timeout. The message
  // deliberately still does not say so: it is an operational detail the end user
  // cannot act on, and it would be untrue for the other codes reaching this
  // branch. The cause belongs in the log, and that is where it now is.
  const pilot = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const start = pilot.indexOf("function failureMessageFor");
  const body = pilot.slice(start, pilot.indexOf("\nDeno.serve(", start));
  const returned = (body.match(/"[^"]{20,}"/g) ?? []).join(" ");

  assert(!/no credits|billing|quota/i.test(returned),
    `the user-facing text must not diagnose a cause: ${returned}`);
  assert(/nothing was started/i.test(returned) && /nothing was charged/i.test(returned),
    "and the promises it does make are unchanged");
});

Deno.test("17. but the maintainer's log now names it", () => {
  const pilot = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const at = pilot.indexOf('console.error("[pilot-chat][unhandled]"');
  assert(at !== -1);
  const block = pilot.slice(at, at + 700);
  assert(block.includes("provider_code:"),
    "`quota_exhausted` here is the difference between 'the chat is broken' " +
    "and 'top up the account'");
  assert(block.includes("e.providerCode"));
});

// ═══ 7. NO ROUTING MOVED ═══════════════════════════════════════════════════

Deno.test("18. the failure ladder and the MODEL ladder stay separate", () => {
  // This asserted "no model moved", which was true when the two propagation
  // fixes landed and is deliberately false now: the routing change that
  // followed moved the planning stages from gpt-4.1 to Luna. What must remain
  // true is the property these fixes were about — that a PROVIDER failure and
  // a MODEL-OUTPUT failure are different things, and only the second may reach
  // a second model.
  //
  // Terra shares the OpenAI account with Luna. Escalating a quota exhaustion
  // would call a second model that fails for the identical reason.
  const escalation = Deno.readTextFileSync(new URL(
    "../../../supabase/functions/_shared/modelEscalation.ts", import.meta.url));
  assert(escalation.includes("isProviderSideFailure("),
    "the ladder must ask whether the PROVIDER failed before escalating");
  assert(escalation.includes("provider_failure_no_escalation"),
    "and record that it deliberately did not");
});
