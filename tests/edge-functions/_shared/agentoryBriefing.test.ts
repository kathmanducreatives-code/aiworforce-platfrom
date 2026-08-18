// IS THE BRIEFING ACTUALLY IN GPT'S CONTEXT?
//
// The acceptance question from the brain spec — "verify the actor playbook is
// actually included in GPT's context" — asked because a briefing that exists in
// the repo and never reaches a prompt is worth nothing. This codebase has
// already shipped one fully-tested, completely inert module; these tests are
// the difference between written and reaching the model.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildAgentoryBriefing, companyBrainSection, actorPlaybookSection,
  AGENTORY_ROLE, AGENTORY_WORKFLOW, DISCOVERY_MODES, resultsSection,
} from "../../../supabase/functions/_shared/agentoryBriefing.ts";
import { buildPrompt } from "../../../supabase/functions/_shared/gptDiscoveryPlanner.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";

const BRAIN = {
  positive_industries: ["b2b saas", "recruiting agencies"],
  excluded_industries: [], employee_min: 10, employee_max: 500,
  required_geography: null,
};

Deno.test("1. the playbook in the briefing is the LIVE catalog, not a copy", () => {
  const s = actorPlaybookSection();
  // Named actors prove it read the registry rather than restating knowledge —
  // a restatement is a second source of truth and drifts.
  assert(s.includes("apify_yc_companies_memo23"));
  assert(s.includes("apify_linkedin_company_search"));
  // And the fitness fields, which are the whole reason to show a playbook.
  assert(s.includes("best_for"), "best_for must reach the model");
  assert(s.includes("not_for"), "not_for must reach the model");
  assert(/semantic\/concept search/.test(s), "the exact claim that mattered on 2026-08-17");
});

Deno.test("2. it teaches the distinction the failed run turned on", () => {
  // Name search vs concept discovery. GPT choosing a name matcher for a concept
  // cohort is the defect; this is the knowledge that should prevent it BEFORE
  // the validator has to.
  assert(/NAME SEARCH/.test(DISCOVERY_MODES));
  assert(/CONCEPT DISCOVERY/.test(DISCOVERY_MODES));
  assert(
    /newsletters|communities/i.test(DISCOVERY_MODES),
    "it must name the actual failure mode, not describe it abstractly",
  );
});

Deno.test("3. the Company Brain is context, and says so in precedence terms", () => {
  const s = companyBrainSection(BRAIN);
  assert(s.includes("b2b saas"), "the ICP must be present");
  assert(/explicit request WINS/i.test(s));
  assert(/NEVER replaces/i.test(s), "the 2026-08-17 override must be ruled out in words");

  // No Brain is a safe state, not a missing one.
  assert(/none configured/i.test(companyBrainSection(null)));
});

Deno.test("4. the role states the boundary that makes free proposal safe", () => {
  assert(/intelligence engine of Agentory/i.test(AGENTORY_ROLE));
  assert(/not the .*safety validator/i.test(AGENTORY_ROLE));
  assert(/must not invent an actor/i.test(AGENTORY_ROLE),
    "propose-freely only works alongside do-not-invent");
});

Deno.test("5. the workflow explains why discovery is the consequential stage", () => {
  assert(/NO LATER STAGE CAN REPAIR AN EARLIER ONE/i.test(AGENTORY_WORKFLOW));
  assert(
    /honest .*no viable strategy.* is a CORRECT answer/is.test(AGENTORY_WORKFLOW),
    "blocking must be presented as a legitimate outcome, or the model will always guess",
  );
});

Deno.test("6. results feedback lets a failing strategy be recognised", () => {
  const s = resultsSection({
    actor_key: "apify_linkedin_company_search",
    candidates_returned: 20, likely_companies: 2, irrelevant: 18,
    observed_problems: ["newsletters", "communities", "big-co sub-pages"],
  });
  assert(s.includes("apify_linkedin_company_search"));
  assert(s.includes("18"));
  assert(/Change the mechanism/i.test(s),
    "the model must be told to change the MECHANISM, not retry the query");
  // Absent on a first attempt — no phantom history.
  assertEquals(resultsSection(null), "");
});

Deno.test("7. THE WIRING: the briefing reaches the discovery prompt", () => {
  // The acceptance question. A briefing nobody sends is not a briefing.
  const mission = parseLeadMissionDeterministic(
    "Find 2 qualified AI startups in the United States that are currently hiring software engineers.",
  );
  const { system } = buildPrompt({ mission, brain: BRAIN } as never);

  assert(/intelligence engine of Agentory/i.test(system), "the role must be in context");
  assert(system.includes("CONCEPT DISCOVERY"), "the discovery modes must be in context");
  assert(system.includes("apify_linkedin_company_search"), "the playbook must be in context");
  assert(system.includes("b2b saas"), "the Company Brain must be in context");
  assert(/explicit request WINS/i.test(system), "with its precedence rule");
  // The stage's own output contract survives alongside the general briefing.
  assert(/actor_key values listed in available_actors/i.test(system));
});

Deno.test("8. the LIVE planner path carries the briefing too", async () => {
  // `buildPrompt` is test-facing. `makeGptDiscoveryPlanner` is what a real run
  // calls, and it rebuilds the prompt itself — so it can drift from the helper
  // silently. It has before.
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/gptDiscoveryPlanner.ts", import.meta.url),
  );
  const live = SRC.slice(SRC.indexOf("makeGptDiscoveryPlanner"));
  assert(
    /system: systemPromptFor\(/.test(live),
    "the live planner must send the briefed prompt, not the bare stage rules",
  );
  assertEquals(
    /system:\s*STAGE_RULES\b/.test(live), false,
    "the unbriefed prompt must not be reachable from the live path",
  );
});

Deno.test("9. the briefing contains no routing rules", () => {
  // THE ARCHITECTURAL GUARD. The brief was explicit: knowledge, never
  // `if AI startup → actor X`. A rule engine here would rebuild exactly what
  // five commits removed, just phrased as English.
  const full = buildAgentoryBriefing({ brain: BRAIN });
  for (const rule of [
    /if\s+["`']?AI\s+startup/i,
    /if\s+["`']?SaaS/i,
    /always\s+use\s+apify_/i,
    /must\s+use\s+apify_yc/i,
  ]) {
    assertEquals(rule.test(full), false, `the briefing must not encode a routing rule: ${rule}`);
  }
});

Deno.test("10. the four agents are described by responsibility, not decoration", () => {
  const full = buildAgentoryBriefing({ brain: null });
  for (const [agent, duty] of [
    ["Nova", /discovery/i], ["Atlas", /ICP fit|evidence/i],
    ["Mira", /hook|angle/i], ["Orion", /pipeline|next action/i],
  ] as const) {
    assert(full.includes(agent), `${agent} must be described`);
    const line = full.split("\n").find((l) => l.includes(agent))!;
    assert(duty.test(line), `${agent} must be given a responsibility, not just a name`);
  }
});
