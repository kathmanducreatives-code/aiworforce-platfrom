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

Deno.test("the gate kind cannot be re-extracted: the re-reader is gone", () => {
  assert(!/extractLeadIntent\(/.test(CODE), "run-agent must not re-extract a lead intent");
  // Post-cutover this is stronger than "falls back to the Mission projection":
  // the legacy block that owned the fallback was deleted, so there is no
  // second reader left to disagree with the Mission at all.
  assert(!/missionWorkflowType/.test(CODE), "the legacy gate-kind fallback no longer exists");
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

Deno.test("no re-extracted intent survives anywhere in run-agent", () => {
  assert(!/reIntent/.test(CODE), "no re-extracted intent may survive anywhere");
  // `missionVerticals` lived in the deleted legacy block. Its absence is the
  // point: nothing downstream re-derives company-type terms any more.
  assert(!/missionVerticals/.test(CODE), "the legacy company-type projection is gone with its block");
});

// ═══════════════════════════════════════════════════════════════════════════
// A COMPILED MISSION MAY NOT BE ROUTED OUT OF ITS OWN ARCHITECTURE
// ═══════════════════════════════════════════════════════════════════════════
//
// THE RUN THIS EXISTS TO PREVENT — TEST plan 16952bd6-7d9d-4ce6-a09f-439a48568623,
// 2026-08-12T14:23Z, on build f836be51.
//
// pilot-chat compiled a real Mission for "Find 10 AI startups in the United
// States that are hiring software engineers." — mission_parser_source
// "gpt_validated", confidence 0.99, verticals ["AI startups"], geography hard.
// Its own deterministic classifier then pinned `source_type: "jobs"`,
// `selected_actor_key: "apify_jobs"` and `execution_mode: "fast"` onto the same
// tool_input.
//
// run-agent's routing gate asked only two questions — "did the body declare
// company_first?" and "was the actor left unpinned?" — and both answered no.
// `routingEntityIntent` stayed null, the company-first branch (which contains
// playbook selection, the capability graph, authorization and the paid
// preflight) was unreachable, and the run fell through to the legacy Claude
// planner + runAdaptiveSourcing + Brain-ICP qualification.
//
// The Mission was never consulted again. Its geography hard-constraint was
// relaxed, "AI startups" never reached the provider payload, and eight
// genuinely-matching companies were scored 28/100 against the workspace's
// generic sales ICP.
//
// The gate now asks a third question first: is there a Mission?

import { readPersistedLeadMission } from "../../../supabase/functions/_shared/leadMissionRuntime.ts";
import {
  applyMissionEntityAuthority, compileLeadEntityIntent,
} from "../../../supabase/functions/_shared/leadEntityIntent.ts";
import { isCompanyFirstRequest } from "../../../supabase/functions/_shared/runAgentCompoundBridge.ts";

/** The tool_input exactly as recorded on the failed run. */
const FAILED_RUN_TOOL_INPUT = {
  query: "Software Engineer OR Backend Engineer OR Frontend Engineer",
  intent: "source_companies_hiring",
  location: "united states",
  tool_name: "source_with_apify",
  source_type: "jobs",
  max_results: 10,
  execution_mode: "fast",
  selected_actor_key: "apify_jobs",
  lead_mission: {
    version: "lead-mission-v1",
    mission_parser_source: "gpt_validated",
    original_user_query:
      "Find 10 AI startups in the United States that are hiring software engineers.",
    target_entity: "company",
    requested_output: "qualified_companies",
    requested_count: 10,
    strategies: ["hiring"],
    company_profile: { verticals: ["AI startups"], stages: ["startup"], locations: ["united states"] },
    required_signals: [{ type: "hiring software engineers" }],
    required_signal_terms: ["hiring software engineers"],
    geography_is_hard: true,
    required_capabilities: [
      "startup_company_discovery", "company_identity_resolution",
      "company_enrichment", "company_brain_qualification", "persistence",
    ],
    prohibited_capabilities: [
      "general_company_discovery", "known_company_resolution", "job_discovery",
      "funding_signal_discovery", "expansion_signal_discovery", "hiring_verification",
      "expansion_signal_verification", "founder_discovery", "employer_verification",
      "contact_enrichment", "job_deduplication",
    ],
    lead_intelligence_contract_version: "v1",
  },
};

/** The gate predicate as run-agent now evaluates it. */
function entersNewArchitecture(toolInput: Record<string, unknown>, body: Record<string, unknown> = {}) {
  const rawSourceType = toolInput.source_type ?? null;
  const plannedActorKey = toolInput.selected_actor_key ?? null;
  const bodyDeclaresCompanyFirst =
    body.workflow_kind === "qualified_lead_sourcing" ||
    body.execution_mode === "company_first" ||
    toolInput.workflow_kind === "qualified_lead_sourcing" ||
    toolInput.execution_mode === "company_first";
  const routingMission = readPersistedLeadMission(toolInput, body.lead_mission);
  return {
    routingMission,
    entered: !!routingMission || bodyDeclaresCompanyFirst || (!rawSourceType && !plannedActorKey),
    bodyDeclaresCompanyFirst,
    actorWasPinned: !!rawSourceType && !!plannedActorKey,
  };
}

Deno.test("REGRESSION 16952bd6: a pinned actor no longer routes a Mission into the legacy path", () => {
  const g = entersNewArchitecture(FAILED_RUN_TOOL_INPUT as never);

  // The two conditions that existed before are both still false — this is the
  // exact shape that failed, not a softened version of it.
  assertEquals(g.bodyDeclaresCompanyFirst, false, "execution_mode was 'fast', not 'company_first'");
  assertEquals(g.actorWasPinned, true, "source_type and selected_actor_key were both pinned");

  // The Mission is read, and its presence alone routes the run.
  assert(g.routingMission !== null, "the recorded tool_input carries a readable LeadMissionV1");
  assertEquals(g.routingMission?.mission_parser_source, "gpt_validated");
  assert(g.entered, "a compiled Mission must enter the new execution architecture");
});

Deno.test("REGRESSION 16952bd6: the Mission's own entity decision reaches the company-first gate", () => {
  const { routingMission } = entersNewArchitecture(FAILED_RUN_TOOL_INPUT as never);
  const intent = applyMissionEntityAuthority(
    compileLeadEntityIntent(routingMission!.original_user_query as string),
    routingMission,
  );
  assertEquals(intent.target_entity, "company", "the Mission decided the entity");
  assertEquals(intent.clarification_required, false, "a decided Mission resolves ambiguity");
  assert(
    isCompanyFirstRequest(intent),
    "this request must satisfy the company-first gate that guards the capability engine",
  );
});

Deno.test("a missionless task is unaffected and still uses the pinned actor", () => {
  const { lead_mission: _omitted, ...missionless } = FAILED_RUN_TOOL_INPUT;
  const g = entersNewArchitecture(missionless as never);
  assertEquals(g.routingMission, null);
  assertEquals(g.entered, false, "without a Mission the pinned-actor path is unchanged");
});

// ---- the legacy block is GONE, not guarded --------------------------------
//
// f8680136 added a fail-closed 422 at the head of the legacy sourcing block.
// The cutover deleted the block, so the guard has nothing left to guard. What
// replaces it is a much smaller invariant: run-agent contains no legacy
// sourcing implementation at all, and an unaccepted sourcing request refuses
// rather than falling through to the generic LLM path.

Deno.test("run-agent contains no legacy sourcing implementation", () => {
  for (const gone of [
    "runAdaptiveSourcing",
    "actorInputPlanner",
    "ariaScoring",
    "scoutStrategy",
    "scoutSourcingPlan",
    "sourceGates",
    "leadAnalyst",
    "leadPreRank",
  ]) {
    assert(!new RegExp(gone).test(CODE), `${gone} must not be reachable from run-agent`);
  }
});

Deno.test("an unaccepted sourcing request refuses instead of falling through", () => {
  assert(
    /sourcing_requires_mission_architecture/.test(CODE),
    "there must be an explicit refusal for sourcing the mission path did not accept",
  );
  // Anchor on the log line that opens the refusal, so the whole branch — the
  // task update AND the response — is inside the window.
  const start = CODE.indexOf("sourcing-not-accepted");
  assert(start > 0, "the refusal branch must be identifiable");
  // Bound the window to the refusal's own `}, 422);` terminator so the
  // assertions cannot accidentally read code that follows the branch.
  const end = CODE.indexOf("}, 422);", start);
  assert(end > start, "the refusal must terminate with a 422 response");
  const refusal = CODE.slice(start, end);
  assert(/providers_called: 0/.test(refusal), "the refusal must state no provider ran");
  assert(/status: "failed"/.test(refusal), "the task must be recorded as failed");
  assert(!/runTool\(/.test(refusal), "no provider call may appear in the refusal path");
});

Deno.test("the legacy-block band-aid is gone because the block is gone", () => {
  assert(!/legacyBlockMission/.test(CODE), "the f8680136 guard is obsolete once the block is deleted");
  assert(!/mission_requires_new_architecture/.test(CODE), "its refusal code is obsolete too");
});
