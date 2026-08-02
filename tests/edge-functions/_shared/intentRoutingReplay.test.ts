// Frozen provider-free replay of the live failure (plan da79cba3): the user asked
// for founders; the planner injected "hiring signals for RevOps or Sales". With
// intent-compiled routing the request stays a PERSON request, the jobs actor can
// never become the final identity actor, and no JobSignal may persist.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileLeadEntityIntent,
  compileActorPlan,
  detectRoutingConflict,
  artifactMayPersist,
} from "../../../supabase/functions/_shared/leadEntityIntent.ts";
import { buildProviderIndexFromItems, parseScoutCandidates, guardScoutToAria } from "../../../supabase/functions/_shared/leadHandoffGuard.ts";
import { filterPlanForMode } from "../../../supabase/functions/_shared/executionMode.ts";
import { ORIGINAL_USER_INSTRUCTION, PLANNER_SCOUT_INSTRUCTION } from "../../../supabase/functions/_shared/intentRoutingFixture.ts";

Deno.test("replay: original founder query compiles to person / qualified_people / people actor", () => {
  const intent = compileLeadEntityIntent(ORIGINAL_USER_INSTRUCTION);
  assertEquals(intent.target_entity, "person");
  assertEquals(intent.output_type, "qualified_people");
  const plan = compileActorPlan(intent, "original_user_instruction");
  assertEquals(plan.primary_identity_actor.actor_key, "apify_people_search");
  assertEquals(plan.primary_identity_actor.actor_implementation, "harvestapi/linkedin-profile-search");
  assertEquals(plan.final_artifact_type, "person_candidate");
});

Deno.test("replay: the jobs actor can NEVER be the final identity actor for this request", () => {
  const intent = compileLeadEntityIntent(ORIGINAL_USER_INSTRUCTION);
  const conflict = detectRoutingConflict(intent, "apify_jobs");
  assertEquals(conflict?.result_status, "routing_conflict");
  assertEquals(conflict?.expected_output_type, "person_candidate");
  assertEquals(conflict?.selected_actor_output_type, "job_signal");
});

Deno.test("replay: no JobSignal may persist for the person request", () => {
  const intent = compileLeadEntityIntent(ORIGINAL_USER_INSTRUCTION);
  assertEquals(artifactMayPersist(intent, "job_signal"), false);        // the 4 live rows would be blocked
  assertEquals(artifactMayPersist(intent, "person_candidate"), true);
});

Deno.test("replay: provider-backed founder profiles reach Aria; a job row does not", () => {
  const idx = buildProviderIndexFromItems([{ company: "Acme SaaS", name: "Jane Founder", person_linkedin_url: "https://linkedin.com/in/jane-founder", source_url: "https://linkedin.com/in/jane-founder" }]);
  const person = guardScoutToAria(parseScoutCandidates(JSON.stringify({ candidates: [{ name: "Jane Founder", company: "Acme SaaS", source_url: "https://linkedin.com/in/jane-founder" }] }), null), idx);
  assertEquals(person.shouldStop, false); // provider-backed person may reach Aria
  const jobRow = guardScoutToAria(parseScoutCandidates(JSON.stringify({ candidates: [{ name: "Sales Rep", company: "Flagpoles Etc", source_url: "https://linkedin.com/jobs/view/sales-representative-4412229384" }] }), null), idx);
  assertEquals(jobRow.shouldStop, true); // the job row is not a provider-backed person → blocked
});

Deno.test("replay: source_and_qualify_only still strips Penn — no drafts/outreach", () => {
  const plan = [
    { agent_slug: "scout", tool_needed: "source_with_apify", step_index: 0 },
    { agent_slug: "aria", tool_needed: "extract_structured", step_index: 1 },
    { agent_slug: "penn", tool_needed: "draft_outreach", step_index: 2 },
  ];
  assertEquals(filterPlanForMode(plan, "source_and_qualify_only").steps.map((s) => s.agent_slug), ["scout", "aria"]);
});

Deno.test("replay: the planner Scout prose alone is NOT the routing authority", () => {
  // The original query is authoritative; the planner prose is descriptive context only.
  assert(PLANNER_SCOUT_INSTRUCTION.includes("hiring signals"));
  assertEquals(compileLeadEntityIntent(ORIGINAL_USER_INSTRUCTION).target_entity, "person");
});
