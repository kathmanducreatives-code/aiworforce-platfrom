import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { takeNewCompletions } from "../../src/lib/completionPulse.ts";
import { IDLE_VISUAL, VISUAL_AGENT_KEYS, type AgentVisualState, type VisualAgentKey } from "../../src/lib/agent3d/visualState.ts";

const idle = () => Object.fromEntries(VISUAL_AGENT_KEYS.map((k) => [k, IDLE_VISUAL])) as Record<VisualAgentKey, AgentVisualState>;
const done = (key: string, at: number, kind: "completed" | "failed" = "completed"): AgentVisualState => ({ ...IDLE_VISUAL, event: { kind, key, at } });

Deno.test("what was already finished at load is history: the first snapshot only seeds", () => {
  const s = { ...idle(), atlas: done("completed:t1", 1) };
  const first = takeNewCompletions(s, null);
  assertEquals(first.fresh, []);
  assertEquals(takeNewCompletions(s, first.seen).fresh, [], "the same event never fires twice");
});

Deno.test("a new completion fires once, for the agent that did the work", () => {
  const { seen } = takeNewCompletions(idle(), null);
  const next = { ...idle(), mira: done("completed:t9", 5) };
  assertEquals(takeNewCompletions(next, seen).fresh, [{ agent: "mira", key: "completed:t9" }]);
  assertEquals(takeNewCompletions(next, seen).fresh, []);
});

Deno.test("a failed or declined task is not celebrated", () => {
  const { seen } = takeNewCompletions(idle(), null);
  assertEquals(takeNewCompletions({ ...idle(), orion: done("failed:t2", 3, "failed") }, seen).fresh, []);
});

Deno.test("several at once: newest first", () => {
  const { seen } = takeNewCompletions(idle(), null);
  const both = { ...idle(), lyra: done("completed:a", 10), atlas: done("completed:b", 20) };
  assertEquals(takeNewCompletions(both, seen).fresh.map((f) => f.agent), ["atlas", "lyra"]);
});
