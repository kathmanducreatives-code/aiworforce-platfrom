// TEST acceptance step 2: the kickoff preparer's DRY RUN sends nothing.
// `--proposal` builds the compile gate with maxCalls 0, so even a Luna request
// inside every bound is refused before it leaves the process.
//
// Offline: no database, no provider, no network.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { lunaOnlyFetch } from "../../../scripts/test-project/real-gpt/prepareKickoff.ts";

Deno.test("dry run: the compile gate with maxCalls 0 refuses every request, Luna included", async () => {
  let sent = 0;
  const gate = lunaOnlyFetch(() => { sent++; return Promise.resolve(new Response("{}")); }, { maxCalls: 0 });
  const res = await gate.fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", body: JSON.stringify({ model: "gpt-5.6-luna", max_completion_tokens: 100, messages: [] }),
  });
  assertEquals([res.status, sent, gate.sent.length], [409, 0, 0]);
  assertEquals(gate.refused, ["call 1 refused (≤ 0)"]);
});

Deno.test("dry run: the CLI wires --proposal to a zero-call gate and needs no OpenAI key", () => {
  const cli = Deno.readTextFileSync(new URL("../../../scripts/test-project/real-gpt/prepare-real-gpt-kickoff.ts", import.meta.url));
  assertEquals(/lunaOnlyFetch\(globalThis\.fetch\.bind\(globalThis\), proposalFile \? \{ maxCalls: 0 \} : \{\}\)/.test(cli), true);
  assertEquals(/if \(!proposalFile && !Deno\.env\.get\("OPENAI_API_KEY"\)\)/.test(cli), true);
});
