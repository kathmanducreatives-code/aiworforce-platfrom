// The real-GPT preparer's compile gate: only Luna chat completions within the
// Luna template's bounds, at most two, ever leave the process.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { lunaOnlyFetch } from "../../../scripts/test-project/real-gpt/prepareKickoff.ts";

const OPENAI = "https://api.openai.com/v1/chat/completions";
const body = (o: Record<string, unknown>) => JSON.stringify({ model: "gpt-5.6-luna", max_tokens: 4000, messages: [], ...o });

Deno.test("compile gate: Luna within bounds is sent, at most twice; everything else is refused before sending", async () => {
  let reached = 0;
  const g = lunaOnlyFetch((() => { reached++; return Promise.resolve(new Response("{}")); }) as typeof fetch);
  const call = (u: string, b: string) => g.fetch(u, { method: "POST", body: b });
  assertEquals((await call(OPENAI, body({}))).status, 200);
  assertEquals((await call(OPENAI, body({ model: "gpt-5.6-terra" }))).status, 409, "an escalation to Terra is refused");
  assertEquals((await call(OPENAI, body({ max_tokens: 8000 }))).status, 409, "an output bound above 4,000 is refused");
  assertEquals((await call(OPENAI, body({ messages: [{ role: "user", content: "x".repeat(31_000) }] }))).status, 409, "an oversized request is refused");
  assertEquals((await call("https://api.anthropic.com/v1/messages", body({}))).status, 409, "another vendor is refused");
  assertEquals((await call(OPENAI, body({ max_completion_tokens: 3000, max_tokens: undefined }))).status, 200);
  assertEquals((await call(OPENAI, body({}))).status, 409, "a third request is refused");
  assertEquals(reached, 2, "exactly two requests left the process");
  assertEquals(g.sent.length, 2);
  assertEquals(g.refused.length, 5);
});

Deno.test("compile gate: only the audited text-only shape, one choice, a whole output bound — the per-call maximum holds", async () => {
  let reached = 0;
  const g = lunaOnlyFetch((() => { reached++; return Promise.resolve(new Response("{}")); }) as typeof fetch, { maxCalls: 10 });
  const call = (b: string) => g.fetch(OPENAI, { method: "POST", body: b });
  const msgs = [{ role: "system", content: "s" }, { role: "user", content: "u" }];
  // Extended (12 h) cache retention is billed at a dearer cache-write rate than the template prices.
  assertEquals((await call(body({ messages: msgs, prompt_cache_retention: "24h" }))).status, 409);
  assertEquals((await call(body({ messages: msgs, tools: [] }))).status, 409, "tools are refused");
  assertEquals((await call(body({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x" } }] }] }))).status, 409, "media is refused");
  assertEquals((await call(body({ messages: msgs, n: 2 }))).status, 409, "more than one choice is refused");
  assertEquals((await call(body({ messages: msgs, max_tokens: undefined }))).status, 409, "no output bound is refused");
  assertEquals((await call(body({ messages: msgs, max_tokens: 3999.5 }))).status, 409, "a fractional bound is refused");
  assertEquals((await call(body({ messages: msgs, max_tokens: 100, max_completion_tokens: 9000 }))).status, 409, "every bound must hold");
  assertEquals((await call("[]")).status, 409, "a non-object body is refused");
  assertEquals(reached, 0, "nothing left the process");
  assertEquals((await call(body({ messages: msgs, n: 1, response_format: { type: "json_object" }, reasoning_effort: "low" }))).status, 200,
    "the transport's own shape still passes");
  assertEquals(reached, 1);
});
