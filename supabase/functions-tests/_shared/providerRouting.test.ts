import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { preferredProviderForAgent, isPlannerTask, ANTHROPIC_WRITING_AGENTS } from "../../functions/_shared/providerRouting.ts";

Deno.test("Scribe prefers Anthropic (content + comment drafts)", () => {
  assertEquals(preferredProviderForAgent("scribe"), "anthropic");
  assertEquals(preferredProviderForAgent("Scribe"), "anthropic");
  assertEquals(preferredProviderForAgent(" SCRIBE "), "anthropic");
});

Deno.test("Penn prefers Anthropic (outreach/DM copy)", () => {
  assertEquals(preferredProviderForAgent("penn"), "anthropic");
});

Deno.test("Planner/controller agents stay on default Gemini provider", () => {
  for (const slug of ["pilot", "scout", "hawk", "aria"]) {
    assertEquals(preferredProviderForAgent(slug), undefined, `${slug} must not prefer anthropic`);
  }
  assertEquals(preferredProviderForAgent(null), undefined);
  assertEquals(preferredProviderForAgent(""), undefined);
  assertEquals(preferredProviderForAgent("unknown_agent"), undefined);
});

Deno.test("writing agent set is exactly scribe + penn", () => {
  assertEquals([...ANTHROPIC_WRITING_AGENTS].sort(), ["penn", "scribe"]);
});

Deno.test("planner task types include pilot/orchestration/classification, exclude agent_execution", () => {
  assert(isPlannerTask("pilot_chat"));
  assert(isPlannerTask("orchestration_plan"));
  assert(isPlannerTask("tool_input_planning"));
  assert(isPlannerTask("helper"));
  // agent_execution is where Scribe/Penn run — NOT a planner task.
  assert(!isPlannerTask("agent_execution"));
});
