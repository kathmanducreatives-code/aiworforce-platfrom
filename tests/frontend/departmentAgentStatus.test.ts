// The department pages' agent badge says what the dashboard card says — from
// the same live source — and never a fixed claim like "On duty".
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { IDLE_VISUAL, statusWordOf, visualAgentKey } from "../../src/lib/agent3d/visualState.ts";

const read = (p: string) => Deno.readTextFile(new URL(`../../${p}`, import.meta.url));
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

Deno.test("one word per live state, shared by cards and department pages", () => {
  assertEquals(statusWordOf({ base: "working" }), "Working");
  assertEquals(statusWordOf({ base: "thinking" }), "Thinking");
  assertEquals(statusWordOf({ base: "awaiting" }), "Needs you");
  assertEquals(statusWordOf({ base: "blocked" }), "Blocked");
  assertEquals(statusWordOf(IDLE_VISUAL), "Ready");
  assertEquals(statusWordOf(null), "Ready");
});

Deno.test("each department reads its agent through the same identity map as task rows", () => {
  assertEquals(visualAgentKey("lyra"), "lyra");
  assertEquals(visualAgentKey("atlas"), "atlas");
  // Content drafts run as backend `scribe`; that is the key their live state lives under.
  assertEquals(visualAgentKey("scribe"), "orion");
});

Deno.test("no department surface hardcodes a status; all use useDepartmentAgentStatus", async () => {
  const surfaces = [
    "src/pages/Signals.tsx", "src/pages/LeadLibrary.tsx", "src/pages/Content.tsx",
    "src/components/layout/department/AgentStatus.tsx", "src/components/leads/library/AtlasStrip.tsx",
    "src/components/content/ScribePanel.tsx", "src/components/signals/workspace/ScoutCopilot.tsx",
    "src/components/layout/DepartmentWorkspaceShell.tsx",
  ];
  for (const f of surfaces) assertFalse(/On duty/i.test(code(await read(f))), `${f} must not claim a fixed status`);
  assert((await read("src/pages/Signals.tsx")).includes("useDepartmentAgentStatus(workspaceId, 'lyra')"));
  assert((await read("src/pages/LeadLibrary.tsx")).includes('useDepartmentAgentStatus(workspaceId, "atlas")'));
  assert((await read("src/pages/Content.tsx")).includes("useDepartmentAgentStatus(workspaceId, 'scribe')"));
  const card = await read("src/components/dashboard/WorkforceAgentCard.tsx");
  assert(card.includes("statusWordOf(visual)"), "the dashboard card uses the same words");
});
