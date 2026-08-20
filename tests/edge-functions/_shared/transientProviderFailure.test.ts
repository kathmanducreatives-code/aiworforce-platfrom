// A RATE LIMIT IS NOT A DECISION.
//
// THE RUN THESE TESTS EXIST TO PREVENT — TEST plan
// 9105aa67-7280-4188-9e81-b90dbe48e50d, 2026-08-20 16:54 UTC, build 2d4be2dc.
//
// The run qualified 2 of 10 and elected to continue: "2 of 10 qualified,
// looking for 8 more across 87 remaining companies." The continuation slice
// asked the execution planner for a plan and got
//
//   HTTP 429 … Rate limit reached for gpt-4.1 … tokens per min (TPM):
//   Limit 30000, Used 15706, Requested 16508. Please try again in 4.428s.
//
// The adapter returned null. `validateExecutionPlan` saw a non-array and
// answered `plan_not_a_list` — "the planner returned no list of steps", which
// describes the shape of an answer that never arrived. The engine then spent
// its one repair round re-sending the same ~16k-token payload 291ms later,
// against a stated 4.4-second wait, and blocked the run on the second 429.
//
// Total elapsed: 1607ms. Total provider work: none. A run that had already
// found two real leads died because nobody read the sentence telling it how
// long to wait.
//
// THREE THINGS ARE FIXED AND PINNED HERE:
//   1. a transient status is retried once, after the delay the PROVIDER named
//   2. a provider failure is distinguishable from a bad answer
//   3. the planner throws on the first rather than burning the repair round
//
// ZERO network. Every fetch and every sleep is injected.

import {
  assert, assertEquals, assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  gptStructured, retryDelayMs, isProviderFailure, MAX_TRANSIENT_RETRIES,
  MAX_RETRY_WAIT_MS, DEFAULT_RETRY_WAIT_MS,
} from "../../../supabase/functions/_shared/gptProvider.ts";
import {
  makeGptExecutionPlanner, GptPlannerUnavailableError,
} from "../../../supabase/functions/_shared/gptExecutionPlanner.ts";

/** The body OpenAI actually returned on the failing run, trimmed. */
const TPM_BODY = JSON.stringify({
  error: {
    message:
      "Rate limit reached for gpt-4.1 in organization org-Qddx on tokens per min " +
      "(TPM): Limit 30000, Used 15706, Requested 16508. Please try again in 4.428s. " +
      "Visit https://platform.openai.com/account/rate-limits to learn more.",
    type: "tokens",
  },
});

const OK_BODY = JSON.stringify({
  choices: [{ message: { content: JSON.stringify({ steps: [], reasoning: "fine" }) } }],
});

interface Attempt { status: number; body: string; headers?: Record<string, string> }

/** A fetch that replays a fixed script, recording how many times it was called. */
function scriptedFetch(script: Attempt[]) {
  const calls: number[] = [];
  const slept: number[] = [];
  const fn = (_url: string, _init: RequestInit) => {
    const a = script[Math.min(calls.length, script.length - 1)];
    calls.push(a.status);
    return Promise.resolve({
      ok: a.status >= 200 && a.status < 300,
      status: a.status,
      text: () => Promise.resolve(a.body),
      headers: { get: (n: string) => a.headers?.[n.toLowerCase()] ?? null },
    });
  };
  return {
    calls, slept,
    deps: {
      fetch: fn,
      readEnv: (k: string) => k === "OPENAI_API_KEY" ? "sk-test-key" : undefined,
      sleep: (ms: number) => { slept.push(ms); return Promise.resolve(); },
    },
  };
}

const REQUEST = { purpose: "execution_plan", system: "s", user: "u" };

// ═══ 1. THE DELAY COMES FROM THE PROVIDER, NOT FROM US ═════════════════════

Deno.test("retryDelayMs: the Retry-After header wins", () => {
  assertEquals(retryDelayMs({ get: () => "2" }, ""), 2000);
  assertEquals(retryDelayMs({ get: () => "0.5" }, ""), 500);
});

Deno.test("retryDelayMs: the failing run's own sentence is read", () => {
  assertEquals(retryDelayMs(undefined, TPM_BODY), 4428);
});

Deno.test("retryDelayMs: milliseconds are understood, and silence is silence", () => {
  assertEquals(retryDelayMs(undefined, "Please try again in 850ms."), 850);
  assertEquals(retryDelayMs(undefined, "something went wrong"), null);
  assertEquals(retryDelayMs({ get: () => null }, ""), null);
});

// ═══ 2. THE RETRY ITSELF ═══════════════════════════════════════════════════

Deno.test("429: retried once, after exactly the wait the provider named", async () => {
  const f = scriptedFetch([
    { status: 429, body: TPM_BODY },
    { status: 200, body: OK_BODY },
  ]);
  const r = await gptStructured(REQUEST, f.deps);

  assert(r.ok, `expected success on the second attempt: ${JSON.stringify(r)}`);
  assertEquals(f.calls, [429, 200]);
  assertEquals(f.slept, [4428], "the run waited 4.428s, because that is what it was told");
});

Deno.test("429: the Retry-After header is preferred over the body", async () => {
  const f = scriptedFetch([
    { status: 429, body: TPM_BODY, headers: { "retry-after": "1" } },
    { status: 200, body: OK_BODY },
  ]);
  await gptStructured(REQUEST, f.deps);
  assertEquals(f.slept, [1000]);
});

Deno.test("429 twice: TWO calls, never three, and the failure says it is retryable", async () => {
  const f = scriptedFetch([{ status: 429, body: TPM_BODY }]);
  const r = await gptStructured(REQUEST, f.deps);

  assertEquals(r.ok, false);
  assert(!r.ok);
  assertEquals(r.code, "http_error");
  assertEquals(r.retryable, true, "a rate limit is not a verdict");
  assertEquals(r.attempts, 2);
  assertEquals(f.calls.length, MAX_TRANSIENT_RETRIES + 1,
    "the bound is a constant; a third attempt in the same minute buys nothing");
  assert(r.detail.includes("429"));
});

Deno.test("5xx is transient too; a 400 is not", async () => {
  const server = scriptedFetch([{ status: 503, body: "upstream unavailable" }]);
  const s = await gptStructured(REQUEST, server.deps);
  assert(!s.ok);
  assertEquals(s.retryable, true);
  assertEquals(server.calls.length, 2);
  assertEquals(server.slept, [DEFAULT_RETRY_WAIT_MS], "no advice given, so the default");

  const bad = scriptedFetch([{ status: 400, body: "invalid schema" }]);
  const b = await gptStructured(REQUEST, bad.deps);
  assert(!b.ok);
  assertEquals(b.retryable, false);
  assertEquals(bad.calls.length, 1, "a rejected request is not retried; it is wrong");
  assertEquals(bad.slept, []);
});

Deno.test("a wait longer than the cap is refused honestly rather than slept through", async () => {
  const seconds = (MAX_RETRY_WAIT_MS / 1000) + 30;
  const f = scriptedFetch([
    { status: 429, body: `Please try again in ${seconds}s.` },
    { status: 200, body: OK_BODY },
  ]);
  const r = await gptStructured(REQUEST, f.deps);

  assert(!r.ok, "a minute-long rate limit is the caller's deadline to spend, not ours");
  assertEquals(r.retryable, true, "still true — the caller may decide it can wait");
  assertEquals(f.calls.length, 1);
  assertEquals(f.slept, []);
});

Deno.test("a transport throw is retried on the same terms", async () => {
  let n = 0;
  const slept: number[] = [];
  const r = await gptStructured(REQUEST, {
    fetch: () => {
      n++;
      if (n === 1) return Promise.reject(new Error("connection reset"));
      return Promise.resolve({
        ok: true, status: 200, text: () => Promise.resolve(OK_BODY),
      });
    },
    readEnv: (k: string) => k === "OPENAI_API_KEY" ? "sk-test-key" : undefined,
    sleep: (ms: number) => { slept.push(ms); return Promise.resolve(); },
  });
  assert(r.ok);
  assertEquals(n, 2);
  assertEquals(slept, [DEFAULT_RETRY_WAIT_MS]);
});

Deno.test("a bad ANSWER is not retried — there is nothing transient about it", async () => {
  const f = scriptedFetch([
    { status: 200, body: JSON.stringify({ choices: [{ message: { content: "" } }] }) },
  ]);
  const r = await gptStructured(REQUEST, f.deps);
  assert(!r.ok);
  assertEquals(r.code, "empty_response");
  assertEquals(r.retryable, false);
  assertEquals(f.calls.length, 1);
});

// ═══ 3. THE TWO KINDS OF FAILURE ARE TOLD APART ════════════════════════════

Deno.test("isProviderFailure: reaching the provider vs. what it said", () => {
  for (const code of ["no_api_key", "http_error", "transport_error"] as const) {
    assertEquals(isProviderFailure(code), true, code);
  }
  for (const code of ["empty_response", "unparseable_json", "schema_refused"] as const) {
    assertEquals(isProviderFailure(code), false, code);
  }
});

// ═══ 4. THE PLANNER STOPS INSTEAD OF SPENDING THE REPAIR ROUND ═════════════

const plannerInput = { payload: { a: 1 }, mission_hash: "h" };

Deno.test("planner: a 429 THROWS — the repair round is not spent on a rate limit", async () => {
  const f = scriptedFetch([{ status: 429, body: TPM_BODY }]);
  const plan = makeGptExecutionPlanner(f.deps);

  const err = await assertRejects(
    () => plan(plannerInput), GptPlannerUnavailableError);
  assertEquals((err as GptPlannerUnavailableError).code, "http_error");
  assertEquals((err as GptPlannerUnavailableError).retryable, true);
  assert(err.message.includes("429"),
    `the run must report the provider's own words, not "plan_not_a_list": ${err.message}`);
  assertEquals(f.calls.length, 2, "one retry inside the provider, and no repair round");
});

Deno.test("planner: a BAD ANSWER still returns null, so the repair round survives", async () => {
  const f = scriptedFetch([
    { status: 200, body: JSON.stringify({ choices: [{ message: { content: "" } }] }) },
  ]);
  const plan = makeGptExecutionPlanner(f.deps);
  assertEquals(await plan(plannerInput), null,
    "an empty answer is worth telling the model about; a rate limit is not");
});

Deno.test("planner: a missing key throws rather than reading as an empty plan", async () => {
  const plan = makeGptExecutionPlanner({
    readEnv: () => undefined,
    fetch: () => { throw new Error("must not be called"); },
  });
  await assertRejects(() => plan(plannerInput), GptPlannerUnavailableError);
});
