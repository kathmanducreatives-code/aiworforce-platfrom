// ORCHESTRATE ROUTES TO V2 ONLY WHEN BOTH GATES OPEN.
//
// The enqueue function and the worker were both built and tested, and NOTHING
// called either: `grep enqueue-lead-mission` across the repo matched only its
// own definition. V2 was unreachable except by hand. This is the route, and
// these are the properties that keep it from becoming a way to send the wrong
// work — or a customer's work — to a new runtime.
//
// ZERO network, ZERO providers, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveLeadExecutionEngine } from "../../../supabase/functions/_shared/leadExecutionEngine.ts";
import { validateV2KickoffBody } from "../../../supabase/functions/_shared/leadMissionV2Request.ts";

const SRC = await Deno.readTextFile(
  new URL("../../../supabase/functions/orchestrate/index.ts", import.meta.url),
);

Deno.test("THE ROUTE EXISTS — V2 is no longer unreachable", () => {
  assert(SRC.includes("enqueue-lead-mission"), "orchestrate must be able to reach the queue");
  assert(SRC.includes("resolveLeadExecutionEngine("), "it must consult the allowlist");
  assert(SRC.includes("validateV2KickoffBody("), "and it must confirm this is a lead mission");
});

Deno.test("BOTH gates are required, joined by AND", () => {
  // Either alone is a way to send the wrong thing somewhere new: the allowlist
  // alone would queue a Content step; the validator alone would queue a
  // customer's mission.
  // Tolerant of the nested arrow in the env reader — the property under test is
  // the AND, not the formatting.
  const decision = SRC.slice(SRC.indexOf("const v2Route ="), SRC.indexOf("const v2Route =") + 260);
  assert(decision.includes('=== "v2_worker"'), "the allowlist verdict must be compared");
  assert(decision.includes("&&"), "the two conditions must be ANDed, not ORed");
  assert(decision.includes("validateV2KickoffBody("), "the mission check must be part of it");
  assert(!decision.includes("||"), "an OR here would let either gate alone open V2");
});

Deno.test("V1 IS THE DEFAULT — the fallback is run-agent, unchanged", () => {
  assert(
    /url: v2Route\s*\n?\s*\?\s*`\$\{SUPABASE_URL\}\/functions\/v1\/enqueue-lead-mission`\s*\n?\s*:\s*`\$\{SUPABASE_URL\}\/functions\/v1\/run-agent`/
      .test(SRC),
    "the false branch must still be run-agent",
  );
  // Only the destination differs. If the bodies diverged, the worker would no
  // longer be replaying what the edge path would have sent.
  assert(
    /body: v2Route \? \{ request: kickoffBody \} : kickoffBody/.test(SRC),
    "the same kickoff object must go to both, wrapped only as the enqueue expects",
  );
});

Deno.test("an empty allowlist means V1 for every workspace", () => {
  const noEnv = () => undefined;
  for (const ws of [
    "e8af257d-4c42-4fc2-9d62-037cdfac27c4",
    "00000000-0000-0000-0000-000000000001",
    "",
  ]) {
    assertEquals(resolveLeadExecutionEngine(ws, noEnv), "v1_edge");
  }
});

Deno.test("a workspace NOT on the allowlist stays on V1 even when V2 is on", () => {
  const env = (k: string) =>
    k === "LEAD_V2_WORKER_WORKSPACES" ? "e8af257d-4c42-4fc2-9d62-037cdfac27c4" : undefined;
  assertEquals(
    resolveLeadExecutionEngine("e8af257d-4c42-4fc2-9d62-037cdfac27c4", env), "v2_worker",
    "the named workspace opts in",
  );
  assertEquals(
    resolveLeadExecutionEngine("00000000-0000-0000-0000-000000000001", env), "v1_edge",
    "every other workspace is untouched — there is no global switch",
  );
});

Deno.test("NON-LEAD WORK CANNOT REACH THE WORKER, allowlisted or not", () => {
  // The worker executes LeadMission steps. A Content, monitoring or outreach
  // step reaching it would run under an engine none of them were proven on.
  for (const body of [
    { workspace_id: "w", agent_slug: "scribe", instruction: "draft a founder post" },
    { workspace_id: "w", agent_slug: "hawk", instruction: "monitor competitors" },
    { workspace_id: "w", agent_slug: "penn", instruction: "draft outreach" },
    { workspace_id: "w", agent_slug: "scout", instruction: "find leads" }, // no mission
  ]) {
    assertEquals(
      validateV2KickoffBody(body).ok, false,
      `a step with no approved lead mission must be refused: ${JSON.stringify(body)}`,
    );
  }
});
