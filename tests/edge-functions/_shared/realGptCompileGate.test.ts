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
