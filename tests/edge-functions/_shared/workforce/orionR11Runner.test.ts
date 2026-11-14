// R1.1 · the TEST acceptance runner's judge: it catches every R1 failure mode.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { judge } from "../../../../scripts/orion-pilot/run-r11.ts";

const FIX = JSON.parse(await Deno.readTextFile(new URL("../../../fixtures/orion-r1-capability-tests.json", import.meta.url))).tests;
const route = (r: string, extra: Record<string, unknown> = {}) => ({ chat_brain: { route: r }, ...extra });

Deno.test("judge: each recorded R1 failure is flagged", () => {
  // test 4: list template
  assertEquals(judge(FIX[3], { http: 200, answer: FIX[3].recorded_response, metadata: route("read") }).length > 0, true);
  // test 14: delegation guard
  assertEquals(judge(FIX[13], { http: 200, answer: FIX[13].recorded_response, metadata: {} }).length > 0, true);
  // test 16: misleading copy
  assertEquals(judge(FIX[15], { http: 200, answer: FIX[15].recorded_response, metadata: route("compose") }).length > 0, true);
  // test 11: undated signals
  assertEquals(judge(FIX[10], { http: 200, answer: FIX[10].recorded_response, metadata: route("read") }).length > 0, true);
});
Deno.test("judge: correct R1.1 turns pass, including a draft gated by TEST's missing Brain", () => {
  assertEquals(judge(FIX[3], { http: 200, answer: "1. Leads: 61 …", metadata: route("converse") }), []);
  assertEquals(judge(FIX[13], { http: 200, answer: "Finish onboarding first…", metadata: route("orion_draft", { gated: "brain_not_ready" }) }), []);
  assertEquals(judge(FIX[13], { http: 200, answer: "Post…", metadata: route("orion_draft", { orion_draft: { sent: false, text_only: true } }) }), []);
});
