// Phase 2 — compound-intent model tests.
//
// A person noun sets the final output ENTITY but must NEVER erase the company /
// hiring dimensions. "Founders of SaaS startups hiring Sales Operations" must
// become a COMPANY-FIRST request (verify the company + its hiring signal, then
// find the founder inside it) while still producing a person as the final output.
// Pure people lookups and job-seeker phrasing stay person-first with no company gate.

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadEntityIntent, compileActorPlan } from "./leadEntityIntent.ts";

const i = (q: string) => compileLeadEntityIntent(q);

const SAAS_COMPOUND = "Founders of SaaS startups hiring Sales Operations in the United States";

Deno.test("1. pure founder query stays person-first (no invented company gate)", () => {
  const x = i("Find founders in Austin");
  assertEquals(x.target_entity, "person");
  assertEquals(x.execution_mode, "person_first");
  assertFalse(x.company_gate_required);
  assertFalse(x.hiring_signal_required);
});

Deno.test("2. pure SaaS company query stays company-first, no person role", () => {
  const x = i("Find SaaS companies in the United States");
  assertEquals(x.target_entity, "company");
  assertEquals(x.execution_mode, "company_first");
  assert(x.company_gate_required);
  assertEquals(x.requested_person_role, null);
});

Deno.test("C. SaaS startups hiring Sales Operations (no person noun) → company-first + hiring", () => {
  const x = i("Find SaaS startups hiring Sales Operations");
  assertEquals(x.target_entity, "company");
  assertEquals(x.execution_mode, "company_first");
  assert(x.hiring_signal_required);
});

Deno.test("3. founder + SaaS + hiring → compound COMPANY-FIRST (person output preserved)", () => {
  const x = i(SAAS_COMPOUND);
  assertEquals(x.target_entity, "person");            // final output is still the founder
  assertEquals(x.execution_mode, "company_first");    // …but sourcing is company-first
  assert(x.company_gate_required);
  assert(x.hiring_signal_required);
  assertEquals(x.requested_person_role, "founder");
});

Deno.test("4. founder + industrial automation integrators → company-first (no hiring needed)", () => {
  const x = i("Founders of industrial automation integrators in the Midwest");
  assertEquals(x.target_entity, "person");
  assertEquals(x.execution_mode, "company_first");
  assert(x.company_gate_required);
  assertEquals(x.requested_person_role, "founder");
});

Deno.test("5. founder + small manufacturers + hiring → company-first", () => {
  const x = i("Founders of small manufacturers hiring their first sales rep");
  assertEquals(x.target_entity, "person");
  assertEquals(x.execution_mode, "company_first");
  assert(x.company_gate_required);
  assert(x.hiring_signal_required);
});

Deno.test("6. job-seeker phrasing is NOT a company-hiring request (Case F)", () => {
  const x = i("Sales Operations candidates looking for work");
  assertEquals(x.target_entity, "person");
  assertEquals(x.execution_mode, "person_first");
  assertFalse(x.company_gate_required);
  assertFalse(x.hiring_signal_required);
});

Deno.test("7. a person noun does not erase the company qualifier", () => {
  const x = i(SAAS_COMPOUND);
  // The company dimension survives as an explicit gate, not discarded.
  assert(x.company_gate_required);
  assert(x.execution_mode === "company_first");
});

Deno.test("8. a person noun does not erase the hiring signal", () => {
  const x = i(SAAS_COMPOUND);
  assert(x.signals.some((s) => s.type === "hiring"));
  assert(x.hiring_signal_required);
});

Deno.test("9. compound query details survive into the actor plan", () => {
  const plan = compileActorPlan(i(SAAS_COMPOUND));
  assertEquals(plan.execution_mode, "company_first");
  assertEquals(plan.company_first, true);
  // jobs runs as the company/evidence stage FIRST; people still yields the final person.
  assert(plan.evidence_actors.some((a) => a.actor_key === "apify_jobs"));
  assertEquals(plan.primary_identity_actor.actor_key, "apify_people_search");
  assertEquals(plan.final_artifact_type, "person_candidate");
});

Deno.test("regression: pure person plan is unchanged (people actor, person-first)", () => {
  const plan = compileActorPlan(i("find founders"));
  assertEquals(plan.primary_identity_actor.actor_key, "apify_people_search");
  assertEquals(plan.execution_mode, "person_first");
  assertEquals(plan.evidence_actors.length, 0);
});
