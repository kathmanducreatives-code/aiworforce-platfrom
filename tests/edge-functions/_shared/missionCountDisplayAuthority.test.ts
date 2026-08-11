// THE DISPLAYED / QUOTA COUNT COMES FROM THE MISSION TOO.
//
// `missionCountAuthority.test.ts` closed the COMPILATION injection: no regex
// count is handed to `compileLeadMission` any more. Four readers survived it,
// each re-reading the sentence for a number AFTER the Mission had recorded one:
//
//   pilot-chat  buildHiringConfirmation  the card's count, credits and contract
//   pilot-chat  Start (company_hiring)   the threaded requested_lead_count
//   orchestrate run-agent kickoff        the qualified-lead quota
//   run-agent   company-first quota      `cfIntent.requested_count`, which is
//                                        `resolveRequestedCount(text)`
//   leads/leadMission buildLeadMission   `extractRequestedLeadCount(instruction)`
//                                        ahead of the workflow's own count
//
// Any of them could disagree with `Mission.requested_count` on the same words,
// and the run would then execute to a number the Mission never recorded.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_REQUESTED_COUNT, effectiveRequestedCount,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  buildLeadMission, DEFAULT_REQUESTED_LEAD_COUNT,
} from "../../../supabase/functions/_shared/intelligence/leads/leadMission.ts";

const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const PILOT = code(Deno.readTextFileSync(
  new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url)));
const ORCH = code(Deno.readTextFileSync(
  new URL("../../../supabase/functions/orchestrate/index.ts", import.meta.url)));
const RUN = code(Deno.readTextFileSync(
  new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url)));

Deno.test("no lead path calls extractRequestedLeadCount any more", () => {
  for (const [name, src] of [["pilot-chat", PILOT], ["orchestrate", ORCH], ["run-agent", RUN]] as const) {
    assertEquals(
      [...src.matchAll(/extractRequestedLeadCount\(/g)].length, 0,
      `${name} still re-reads the sentence for a count`,
    );
  }
});

Deno.test("the count readers were replaced by the Mission, not by another number", () => {
  assert(
    PILOT.includes("effectiveRequestedCount("),
    "pilot-chat's card and Start paths must read the Mission's count",
  );
  assert(
    ORCH.includes("effectiveRequestedCount("),
    "orchestrate's kickoff quota must read the Mission's count",
  );
});

Deno.test("the card compiles its Mission with no count hint, then reads the count off it", () => {
  const card = PILOT.slice(PILOT.indexOf("function buildHiringConfirmation"));
  const body = card.slice(0, card.indexOf("\n}\n") + 3);
  assert(
    /buildMissionForPrompt\(prompt,\s*null,/.test(body),
    "the card must not feed a count back into compilation",
  );
  assert(
    /effectiveRequestedCount\(mission\)/.test(body),
    "and must take its displayed count from the compiled Mission",
  );
  assert(
    !/requestedLeadCount\s*=[^;]*intent\.count/.test(body),
    "the regex intent's count may not survive as a fallback for the displayed count",
  );
});

Deno.test("run-agent's company-first quota falls back to the Mission, never to a text scan", () => {
  const i = RUN.indexOf("const quota = resolveRequestedLeadCount({");
  assert(i > 0, "the quota resolution must still exist");
  const site = RUN.slice(i, i + 400);
  assert(
    !site.includes("cfIntent.requested_count"),
    "`cfIntent.requested_count` is resolveRequestedCount(text) — a regex scan of " +
    "the instruction, one layer below the threaded quota",
  );
  assert(
    site.includes("quotaMission?.requested_count"),
    "the last carrier must be the Mission's own nullable count",
  );
  assert(
    site.includes("isLeadSourcingWorkflow: true"),
    "and a null count must still land on the one lead-sourcing default",
  );
});

Deno.test("buildLeadMission takes the count it is given and never re-reads the instruction", () => {
  const loud = "Find 25 founders of B2B SaaS startups hiring RevOps. Return 25 leads.";

  const noConfig = buildLeadMission({
    missionId: "m1", workspaceId: "ws_A",
    originalInstruction: loud, environmentMode: "test", workflow: null,
  });
  assertEquals(
    noConfig.output.requested_count, DEFAULT_REQUESTED_LEAD_COUNT,
    "no configured count ⇒ the default, even though the sentence shouts 25",
  );

  const configured = buildLeadMission({
    missionId: "m1", workspaceId: "ws_A",
    originalInstruction: loud, environmentMode: "test",
    workflow: { requested_count: 7 },
  });
  assertEquals(
    configured.output.requested_count, 7,
    "the resolved count wins; the sentence is not consulted to overrule it",
  );
  assertEquals(configured.constraints.hard.requested_count, 7);
});

Deno.test("the two runtime defaults stay distinct and each stays single", () => {
  // The Mission's default (planning/display) and the lead-sourcing quota default
  // (execution) are separate helpers on purpose; nothing else may invent a third.
  assertEquals(effectiveRequestedCount({ requested_count: null }), DEFAULT_REQUESTED_COUNT);
  assertEquals(effectiveRequestedCount({ requested_count: 3 }), 3);
});
