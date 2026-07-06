import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildLeadActionRequest, LEAD_ACTION_LOADING } from "./leadActionRequest.ts";

const base = { workspaceId: "ws-1", planId: "plan-1" };

Deno.test("Test 1: research_company sends lead_action + selected id", () => {
  const r = buildLeadActionRequest({ ...base, leadAction: "research_company", leadCandidateIds: ["lead-1"] });
  assert(r.valid);
  if (!r.valid) return;
  assertEquals(r.body.tool_input.lead_action, "research_company");
  assertEquals(r.body.tool_input.lead_candidate_ids, ["lead-1"]);
  assertEquals(r.body.agent_slug, "hawk");
  assertEquals(r.body.workspace_id, "ws-1");
  assertEquals(r.body.plan_id, "plan-1");
});

Deno.test("Test 2: find_decision_makers sends lead_action + selected id", () => {
  const r = buildLeadActionRequest({ ...base, leadAction: "find_decision_makers", leadCandidateIds: ["lead-2"] });
  assert(r.valid);
  if (!r.valid) return;
  assertEquals(r.body.tool_input.lead_action, "find_decision_makers");
  assertEquals(r.body.tool_input.lead_candidate_ids, ["lead-2"]);
});

Deno.test("Test 3: generate_outreach sends lead_action + selected id, on Penn", () => {
  const r = buildLeadActionRequest({ ...base, leadAction: "generate_outreach", leadCandidateIds: ["lead-3"] });
  assert(r.valid);
  if (!r.valid) return;
  assertEquals(r.body.tool_input.lead_action, "generate_outreach");
  assertEquals(r.body.agent_slug, "penn");
});

Deno.test("Test 4: no selected lead → safe error, nothing built", () => {
  const r = buildLeadActionRequest({ ...base, leadAction: "research_company", leadCandidateIds: [] });
  assert(!r.valid);
  if (r.valid) return;
  assertEquals(r.error, "no_lead_selected");
});

Deno.test("no workspace / no plan → typed guards", () => {
  const noWs = buildLeadActionRequest({ workspaceId: null, planId: "p", leadAction: "research_company", leadCandidateIds: ["a"] });
  assert(!noWs.valid && noWs.error === "no_workspace");
  const noPlan = buildLeadActionRequest({ workspaceId: "ws", planId: "", leadAction: "research_company", leadCandidateIds: ["a"] });
  assert(!noPlan.valid && noPlan.error === "no_plan");
});

Deno.test("dedupes selected ids; never a multi-company blob", () => {
  const r = buildLeadActionRequest({ ...base, leadAction: "find_decision_makers", leadCandidateIds: ["a", "a", "b"] });
  assert(r.valid);
  if (!r.valid) return;
  assertEquals(r.body.tool_input.lead_candidate_ids, ["a", "b"]);
  // ids are opaque candidate IDs, not company-name strings joined into one query
  assert(r.body.tool_input.lead_candidate_ids.every((id) => !id.includes(" ")));
});

Deno.test("loading copy exists for every action", () => {
  assertEquals(LEAD_ACTION_LOADING.research_company, "Researching company…");
  assertEquals(LEAD_ACTION_LOADING.find_decision_makers, "Finding decision-makers…");
  assertEquals(LEAD_ACTION_LOADING.generate_outreach, "Preparing draft…");
});
