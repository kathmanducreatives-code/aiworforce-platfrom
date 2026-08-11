// RUN-AGENT MAY NOT RE-READ THE SENTENCE TO ROUTE OR TO GATE.
//
// Three readings of one query remained inside execution after cutover 2:
//   - `resolveProviderSource(instruction)` — an ambiguity fallback that guessed
//     a provider source from the raw text.
//   - `extractLeadIntent({message: instruction})` — re-extracted a workflow_type
//     that chose which EVIDENCE GATE applied to the run.
//   - `reIntent.competitors` / `reIntent.target_company_type` — semantic fields
//     read off that re-extraction and used to reject candidates.
//
// Each could disagree with the Mission compiled from the same sentence, and the
// gate one decided what counted as proof.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { workflowTypeFromMission } from "../../../supabase/functions/_shared/leadEntityIntent.ts";

const CODE = Deno.readTextFileSync(
  new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ---- gate kind ------------------------------------------------------------

Deno.test("the gate kind is projected from the Mission, never re-extracted", () => {
  assert(!/extractLeadIntent\(/.test(CODE), "run-agent must not re-extract a lead intent");
  assert(
    /workflow_type: threadedIntent\?\.workflow_type \?\? missionWorkflowType/.test(CODE),
    "the gate's workflow_type must fall back to the Mission projection, not a re-read",
  );
});

Deno.test("workflowTypeFromMission reads decided fields and parses nothing", () => {
  assertEquals(workflowTypeFromMission({ target_entity: "person" }), "people_sourcing");
  assertEquals(workflowTypeFromMission({ target_entity: "job" }), "company_hiring_sourcing");
  assertEquals(workflowTypeFromMission({ target_entity: "company" }), "company_icp_sourcing");
  assertEquals(
    workflowTypeFromMission({ target_entity: "company", required_signals: [{ type: "hiring" }] }),
    "company_hiring_sourcing",
    "a hiring signal makes a company request a hiring-sourcing workflow",
  );
  assertEquals(
    workflowTypeFromMission({ target_entity: "company", requested_output: "social_posts" }),
    "linkedin_intent_sourcing",
  );
});

Deno.test("no Mission yields null, so the legacy path keeps its own behaviour", () => {
  assertEquals(workflowTypeFromMission(null), null);
  assertEquals(workflowTypeFromMission(undefined), null);
  assertEquals(workflowTypeFromMission({}), null);
});

Deno.test("the projection contains no text parsing", () => {
  const src = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadEntityIntent.ts", import.meta.url),
  );
  const fn = src.slice(src.indexOf("export function workflowTypeFromMission"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 3).replace(/^[ \t]*\/\/.*$/gm, "");
  assert(!/match\(|RegExp|instruction|message|original_query/.test(body));
});

// ---- provider/source ambiguity -------------------------------------------

Deno.test("the raw-text ambiguity fallback cannot run when a Mission exists", () => {
  // Not a convention: ENTITY_SOURCE has an entry for all three Mission
  // target_entity values and applyMissionEntityAuthority clears
  // clarification_required, so the primary branch always wins. The guard makes
  // that a rule a future edit cannot quietly break.
  assert(
    /\} else if \(!routingMission\) \{[\s\S]{0,400}?resolveProviderSource\(/.test(CODE),
    "resolveProviderSource must sit behind an explicit !routingMission guard",
  );
});

Deno.test("the routing mission is read once and shared by both decisions", () => {
  assert(/const routingMission = readPersistedLeadMission\(/.test(CODE));
  assert(
    /applyMissionEntityAuthority\(\s*compileLeadEntityIntent\([^)]*\),\s*routingMission,/.test(CODE),
    "the entity overlay must use the same mission the routing guard uses",
  );
});

// ---- semantic fields formerly read off the re-extraction ------------------

Deno.test("candidate-rejection terms come from the Mission, not a re-read", () => {
  assert(!/reIntent/.test(CODE), "no re-extracted intent may survive anywhere");
  assert(
    /missionVerticals[\s\S]{0,200}?company_profile\?\.verticals/.test(CODE),
    "company-type terms must be projected from the Mission's decided verticals",
  );
  assert(
    /threadedIntent\?\.competitors \?\? \[\]/.test(CODE),
    "competitors must fall back to an empty list, never to a regex reading",
  );
});
