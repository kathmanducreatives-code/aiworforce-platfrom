// A READ CUT OFF AT ITS OUTPUT LIMIT GETS ONE CONCISE RETRY — never a guess.
// TEST 2026-11-23, R1.2 F6: the request-understanding call stopped at its
// 1,500-token limit (`finish_reason: "length"` → `incomplete_response`) and the
// turn was answered unread. Fake transport; no network, no key.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  understandRequest, UNDERSTANDING_MAX_TOKENS, UNDERSTANDING_RETRY_MAX_TOKENS,
} from "../../../supabase/functions/_shared/chatBrain.ts";

const reading = {
  parts: [{ id: "p1", objective: "read", subject: { entity: "company", references: [], filters: [] }, requirements: [],
    output: { shape: "answer", count: null, completeness: "sample", medium: "text" }, depends_on: [] }],
  ambiguity: [], confidence: 0.9,
};
const env = (k: string) => (k === "OPENAI_API_KEY" ? "test-placeholder" : undefined);
type Reply = { finish: "stop" | "length"; content: string };

function transport(replies: Reply[]) {
  const sent: Array<{ max: unknown; system: string }> = [];
  const fetch = (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push({ max: body.max_completion_tokens ?? body.max_tokens ?? body.max_output_tokens, system: String(body.messages?.[0]?.content ?? "") });
    const r = replies[Math.min(sent.length - 1, replies.length - 1)];
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
      choices: [{ finish_reason: r.finish, message: { content: r.content } }],
      usage: { prompt_tokens: 3000, completion_tokens: r.finish === "length" ? UNDERSTANDING_MAX_TOKENS : 300 } })) });
  };
  return { fetch, sent };
}
const U = "Which of the stored signals are less than 30 days old as of November 15, 2026?";

Deno.test("a cut-off read is retried ONCE, concisely, with a larger limit — and then understood", async () => {
  const t = transport([{ finish: "length", content: '{"parts":[{"id":"p1"' }, { finish: "stop", content: JSON.stringify(reading) }]);
  const logs: string[] = [];
  const r = await understandRequest(U, { conversation: [], log: (m) => logs.push(m) }, { fetch: t.fetch, readEnv: env });
  assert(r.ok, "understood after the retry");
  assertEquals(r.ok && r.request.objective, "read");
  assertEquals(r.ok && r.repaired, true);
  assertEquals(t.sent.length, 2, "two calls at most");
  assertEquals(t.sent.map((s) => s.max), [UNDERSTANDING_MAX_TOKENS, UNDERSTANDING_RETRY_MAX_TOKENS]);
  assert(/cut off/.test(t.sent[1].system) && /concise/i.test(t.sent[1].system), "the retry is told why");
  assert(logs.includes("chat_brain_truncated"));
});

Deno.test("cut off twice → provider_failure after exactly two calls (still never a default objective)", async () => {
  const t = transport([{ finish: "length", content: "{" }, { finish: "length", content: "{" }]);
  const r = await understandRequest(U, { conversation: [] }, { fetch: t.fetch, readEnv: env });
  assertEquals(r.ok, false);
  assertEquals(!r.ok && r.reason, "provider_failure");
  assertEquals(t.sent.length, 2);
});

Deno.test("a complete first read is unchanged: one call at the normal limit", async () => {
  const t = transport([{ finish: "stop", content: JSON.stringify(reading) }]);
  const r = await understandRequest(U, { conversation: [] }, { fetch: t.fetch, readEnv: env });
  assert(r.ok && !r.repaired);
  assertEquals(t.sent.map((s) => s.max), [UNDERSTANDING_MAX_TOKENS]);
});

Deno.test("other provider failures are NOT retried by this path", async () => {
  let calls = 0;
  const fetch = () => { calls++; return Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('{"error":{"message":"bad request"}}') }); };
  const r = await understandRequest(U, { conversation: [] }, { fetch, readEnv: env });
  assertEquals(!r.ok && r.reason, "provider_failure");
  assertEquals(calls, 1);
});
