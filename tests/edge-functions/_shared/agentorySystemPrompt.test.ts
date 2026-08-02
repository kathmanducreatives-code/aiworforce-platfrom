// Tests for the Agentory capability map injection.
// Run: node --experimental-strip-types agentorySystemPrompt.test.ts
import { strict as assert } from "node:assert";
import { getAgentorySystemPrompt, AGENTORY_SYSTEM_PROMPT_VERSION } from "../../supabase/functions/_shared/agentorySystemPrompt.ts";

let pass = 0, fail = 0;
function test(name: string, fn: () => void) {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}\n       ${(e as Error).message}`); }
}

test("version bumped to v2", () => {
  assert.ok(AGENTORY_SYSTEM_PROMPT_VERSION.includes("v2"), AGENTORY_SYSTEM_PROMPT_VERSION);
});

test("identity: AI workforce OS + Slack-style + founders/small teams (all task types)", () => {
  const p = getAgentorySystemPrompt({ taskType: "agent_execution" });
  assert.match(p, /AI workforce operating system for founders and small/i);
  assert.match(p, /Slack-style command center/i);
  assert.match(p, /not need to write perfect commands/i);
});

test("product pillars present", () => {
  const p = getAgentorySystemPrompt({});
  for (const pillar of ["AI workforce OS", "Slack-style command center", "Pilot orchestrates", "Workbench displays outputs", "Company Brain personalizes"]) {
    assert.ok(p.includes(pillar), `missing pillar: ${pillar}`);
  }
});

test("all five agents named", () => {
  const p = getAgentorySystemPrompt({});
  for (const a of ["Scout", "Aria", "Penn", "Hawk", "Scribe"]) assert.ok(p.includes(a), `missing agent: ${a}`);
});

test("Claude/Anthropic premium-writing line present", () => {
  const p = getAgentorySystemPrompt({});
  assert.match(p, /Claude\/Anthropic.*premium writing/is);
});

test("content execution mode present", () => {
  const p = getAgentorySystemPrompt({});
  assert.match(p, /content\s+→\s+Scribe writes/i);
});

test("pilot_router gets the full workflow manual", () => {
  const p = getAgentorySystemPrompt({ taskType: "pilot_router" });
  assert.match(p, /SUPPORTED WORKFLOWS/);
  assert.match(p, /Hiring-intent leads/i);
  assert.match(p, /Individual people sourcing/i);
  assert.match(p, /Daily brief/i);
  assert.match(p, /CAPABILITY ANSWER/);
  assert.match(p, /agencies\/dev partners/i); // ambiguous-talent clarification
});

test("non-pilot task types do NOT carry the verbose manual (token budget)", () => {
  for (const t of ["planning", "tool_parameter_extraction", "agent_execution", "reporting"] as const) {
    const p = getAgentorySystemPrompt({ taskType: t });
    assert.ok(!p.includes("SUPPORTED WORKFLOWS"), `verbose manual leaked into ${t}`);
    assert.ok(!p.includes("CAPABILITY ANSWER"), `capability answer leaked into ${t}`);
  }
});

test("actor registry + company brain blocks still inject when provided", () => {
  const p = getAgentorySystemPrompt({
    taskType: "tool_parameter_extraction",
    actorRegistrySummary: "- apify_jobs [ENABLED] ...",
    companyBrain: { offer: "AI workforce OS" },
  });
  assert.match(p, /<actor_registry>/);
  assert.match(p, /<company_brain>/);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
