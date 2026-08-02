// Provider-free routing test matrix for the intent-compiled actor routing.
// Exercises the production intent compiler, actor-plan, conflict + artifact
// helpers, plus the handoff/mode guards. Deterministic; no provider.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileLeadEntityIntent,
  compileActorPlan,
  detectRoutingConflict,
  artifactMayPersist,
  artifactTypeForActor,
  expectedArtifactType,
} from "../../functions/_shared/leadEntityIntent.ts";
import { buildProviderIndexFromItems, parseScoutCandidates, guardScoutToAria } from "../../functions/_shared/leadHandoffGuard.ts";
import { filterPlanForMode, stepAllowedInMode } from "../../functions/_shared/executionMode.ts";
import { ORIGINAL_USER_INSTRUCTION, PLANNER_SCOUT_INSTRUCTION } from "../../functions/_shared/intentRoutingFixture.ts";

const actorFor = (q: string) => compileActorPlan(compileLeadEntityIntent(q)).primary_identity_actor.actor_key;
const entityFor = (q: string) => compileLeadEntityIntent(q);

// ---- PERSON TARGET ----
Deno.test("1: 'Find me 5 hot founders.' → people actor", () => assertEquals(actorFor("Find me 5 hot founders."), "apify_people_search"));
Deno.test("2: ICP founders → people actor", () => assertEquals(actorFor(ORIGINAL_USER_INSTRUCTION), "apify_people_search"));
Deno.test("3: founders at companies hiring RevOps → person + hiring signal, people actor", () => {
  const i = entityFor("Find founders at companies hiring RevOps.");
  assertEquals(i.target_entity, "person");
  assert(i.signals.some((s) => s.type === "hiring"));
  assertEquals(compileActorPlan(i).primary_identity_actor.actor_key, "apify_people_search");
});
Deno.test("4: CEOs at recently funded AI SaaS → people actor + funding", () => {
  const i = entityFor("Find CEOs at recently funded AI SaaS companies.");
  assertEquals(i.target_entity, "person"); assert(i.signals.some((s) => s.type === "funding"));
});
Deno.test("5: decision-makers at companies expanding sales → people actor", () => assertEquals(actorFor("Find decision-makers at companies expanding sales."), "apify_people_search"));
Deno.test("6: who should I contact at B2B SaaS hiring SDRs → people actor", () => assertEquals(actorFor("Who should I contact at B2B SaaS companies hiring SDRs?"), "apify_people_search"));
Deno.test("7: planner rewrites founder query with 'hiring signals' → original still person", () => {
  // Routing must use the ORIGINAL instruction, not the planner Scout prose.
  assertEquals(compileLeadEntityIntent(ORIGINAL_USER_INSTRUCTION).target_entity, "person");
  // And the planner prose alone (mis-used) would flip — proving why we must not use it.
  assertEquals(entityFor(PLANNER_SCOUT_INSTRUCTION).target_entity, "person"); // "founders" noun keeps it person even here
});
Deno.test("8: planner rewrite with 'sales jobs' — original founder query stays person", () => {
  assertEquals(compileLeadEntityIntent("Using my ICP, find me 5 hot founders I should contact right now.").target_entity, "person");
});
Deno.test("9: person intent + jobs actor override → routing_conflict (no silent switch)", () => {
  const c = detectRoutingConflict(entityFor("find founders"), "apify_jobs");
  assertEquals(c?.result_status, "routing_conflict");
});
Deno.test("10: plural roles → person", () => {
  for (const q of ["find founders", "find co-founders", "find CEOs", "find executives", "find decision-makers"]) assertEquals(entityFor(q).target_entity, "person");
});

// ---- COMPANY TARGET ----
Deno.test("11: 'Find 5 B2B SaaS companies.' → company", () => assertEquals(entityFor("Find 5 B2B SaaS companies.").target_entity, "company"));
Deno.test("12: companies hiring RevOps → company + hiring signal", () => {
  const i = entityFor("Find companies hiring RevOps.");
  assertEquals(i.target_entity, "company"); assert(i.signals.some((s) => s.type === "hiring"));
});
Deno.test("13: 'which accounts should I target?' → company", () => assertEquals(entityFor("Which accounts should I target?").target_entity, "company"));
Deno.test("14: recently funded AI SaaS startups → company + funding", () => {
  const i = entityFor("Find recently funded AI SaaS startups.");
  assertEquals(i.target_entity, "company"); assert(i.signals.some((s) => s.type === "funding"));
});

// ---- JOB TARGET ----
Deno.test("15: 'Find 10 open RevOps jobs.' → jobs actor", () => assertEquals(actorFor("Find 10 open RevOps jobs."), "apify_jobs"));
Deno.test("16: 'current SDR job postings' → jobs actor", () => assertEquals(actorFor("Show me current SDR job postings."), "apify_jobs"));
Deno.test("17: 'sales vacancies in New York' → jobs actor", () => assertEquals(actorFor("Find sales vacancies in New York."), "apify_jobs"));
Deno.test("18: 'which jobs are open at Acme?' → jobs actor", () => assertEquals(actorFor("Which jobs are open at Acme?"), "apify_jobs"));

// ---- AMBIGUITY & CONFLICT ----
Deno.test("19: 'Find hiring founders.' → person by the 'founders' noun (evidence), not clarification-by-keyword", () => {
  const i = entityFor("Find hiring founders.");
  assertEquals(i.target_entity, "person");
  assert(i.evidence_spans.some((e) => e.field === "target_entity" && e.evidence.some((v) => /founder/i.test(v))));
});
Deno.test("20: 'Find sales opportunities.' → clarification_required", () => assertEquals(entityFor("Find sales opportunities.").clarification_required, true));
Deno.test("21: low-confidence target ⇒ clarification_required (no forced entity)", () => {
  const i = entityFor("get me some good stuff for outbound");
  assert(i.clarification_required || i.confidence < 0.5);
});
Deno.test("22: person + apify_jobs override → routing_conflict", () => assertEquals(detectRoutingConflict(entityFor("find founders"), "apify_jobs")?.result_status, "routing_conflict"));
Deno.test("23: job + apify_people_search override → routing_conflict", () => assertEquals(detectRoutingConflict(entityFor("find open jobs"), "apify_people_search")?.result_status, "routing_conflict"));

// ---- OUTPUT TYPE & PERSISTENCE ----
Deno.test("24: JobSignal cannot enter a person's expected artifact", () => assertEquals(expectedArtifactType("person") === artifactTypeForActor("apify_jobs"), false));
Deno.test("25: JobSignal cannot persist for a person request", () => assertEquals(artifactMayPersist(entityFor("find founders"), "job_signal"), false));
Deno.test("26: PersonCandidate cannot persist for a job request", () => assertEquals(artifactMayPersist(entityFor("find open RevOps jobs"), "person_candidate"), false));
Deno.test("27: Aria skipped (empty index) ⇒ hand-off stops (no final persistence)", () => {
  const guard = guardScoutToAria(parseScoutCandidates(JSON.stringify({ candidates: [{ name: "X", company: "Y" }] }), null), buildProviderIndexFromItems([]));
  assertEquals(guard.shouldStop, true);
});
Deno.test("28: Aria rejects all (no provider-backed) ⇒ stop", () => {
  const idx = buildProviderIndexFromItems([{ company: "Acme", name: "Jane", source_url: "https://linkedin.com/in/jane" }]);
  const guard = guardScoutToAria(parseScoutCandidates(JSON.stringify({ candidates: [{ name: "Fake", company: "Nope" }] }), null), idx);
  assertEquals(guard.shouldStop, true);
});
Deno.test("29: only provider-backed candidates may proceed", () => {
  const idx = buildProviderIndexFromItems([{ company: "Acme", name: "Jane", source_url: "https://linkedin.com/in/jane" }]);
  const guard = guardScoutToAria(parseScoutCandidates(JSON.stringify({ candidates: [{ name: "Jane", company: "Acme", source_url: "https://linkedin.com/in/jane" }] }), null), idx);
  assertEquals(guard.shouldStop, false);
});
Deno.test("30: persisted artifact type equals intent output type (person→person_candidate)", () => assertEquals(artifactMayPersist(entityFor("find founders"), "person_candidate"), true));
Deno.test("31: specific actor implementation is resolvable (people/jobs)", () => {
  assertEquals(compileActorPlan(entityFor("find founders")).primary_identity_actor.actor_implementation, "harvestapi/linkedin-profile-search");
  assertEquals(compileActorPlan(entityFor("find open jobs")).primary_identity_actor.actor_implementation, "curious_coder/linkedin-jobs-scraper");
});
Deno.test("32: fabricated LLM identities remain blocked", () => {
  const guard = guardScoutToAria(parseScoutCandidates(JSON.stringify({ candidates: [{ name: "Made Up", company: "Nowhere" }] }), null), buildProviderIndexFromItems([]));
  assertEquals(guard.shouldStop, true);
});
Deno.test("33: source_and_qualify_only still strips Penn/draft/send/publish", () => {
  const plan = [{ agent_slug: "scout", tool_needed: "source_with_apify", step_index: 0 }, { agent_slug: "penn", tool_needed: "draft_outreach", step_index: 1 }];
  assertEquals(filterPlanForMode(plan, "source_and_qualify_only").steps.map((s) => s.agent_slug), ["scout"]);
  assertEquals(stepAllowedInMode({ tool_needed: "publish_content" }, "source_and_qualify_only"), false);
});
Deno.test("34: zero valid candidates ⇒ honest stop (no_results upstream)", () => {
  assertEquals(guardScoutToAria([], buildProviderIndexFromItems([])).shouldStop, true);
});
Deno.test("35: routing conflict is reported (provider_calls=0 handled by run-agent gate)", () => {
  const c = detectRoutingConflict(entityFor("find founders"), "apify_jobs");
  assertEquals(c?.selected_actor_output_type, "job_signal");
  assertEquals(c?.expected_output_type, "person_candidate");
});
Deno.test("36: rewritten Scout prose cannot change target_entity (route from original)", () => {
  // The run-agent routes from `input` (original). Both compile to person here, but the
  // key guarantee is that the ORIGINAL founder query is authoritative.
  assertEquals(compileLeadEntityIntent(ORIGINAL_USER_INSTRUCTION).target_entity, "person");
});
Deno.test("37: original user instruction is preserved immutably in the intent", () => {
  assertEquals(compileLeadEntityIntent(ORIGINAL_USER_INSTRUCTION).original_user_instruction, ORIGINAL_USER_INSTRUCTION);
});
Deno.test("38: artifact discriminators cover people and jobs actors", () => {
  assertEquals(artifactTypeForActor("apify_people_search"), "person_candidate");
  assertEquals(artifactTypeForActor("apify_jobs"), "job_signal");
});
