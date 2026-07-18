import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildLeadActionRequest, LEAD_ACTION_LOADING, workbenchActionToLeadKind } from "./leadActionRequest.ts";

// Routing (Issue 2): the 3 lead actions map to the structured lead_action path;
// sourcing/rank/export do NOT (they must not start a new Scout workflow).
Deno.test("routing: research/find/draft/enrich → structured lead_action kind", () => {
  assertEquals(workbenchActionToLeadKind("research_company"), "research_company");
  assertEquals(workbenchActionToLeadKind("enrich"), "research_company");
  assertEquals(workbenchActionToLeadKind("find_contacts"), "find_decision_makers");
  assertEquals(workbenchActionToLeadKind("draft_outreach"), "generate_outreach");
});
Deno.test("routing: rank/export/save/enrich_and_draft do NOT route to lead_action", () => {
  for (const a of ["rank", "export_csv", "save_to_signal_feed", "enrich_and_draft", "find_this_company_new"]) {
    assertEquals(workbenchActionToLeadKind(a), null, `${a} should not be a lead action`);
  }
});

const base = { workspaceId: "ws-1", planId: "plan-1" };

Deno.test("Test 1: research_company sends lead_action + selected id", () => {
  const r = buildLeadActionRequest({ ...base, leadAction: "research_company", leadCandidateIds: ["lead-1"] });
  assert(r.valid);
  if (!r.valid) return;
  assertEquals(r.body.tool_input.lead_action, "research_company");
  assertEquals(r.body.tool_input.lead_candidate_ids, ["lead-1"]);
  assertEquals(r.body.workspace_id, "ws-1");
  assertEquals(r.body.plan_id, "plan-1");
});

// The direct contract carries NO orchestration metadata: the backend derives the
// agent and instruction itself, so the browser never supplies prompt text and
// never fabricates a step_index to satisfy validation.
Deno.test("direct request omits step_index / agent_slug / instruction", () => {
  const r = buildLeadActionRequest({ ...base, leadAction: "research_company", leadCandidateIds: ["lead-1"] });
  assert(r.valid);
  if (!r.valid) return;
  const body = r.body as unknown as Record<string, unknown>;
  assertEquals(body.step_index, undefined);
  assertEquals(body.agent_slug, undefined);
  assertEquals(body.instruction, undefined);
});

Deno.test("Test 2: find_decision_makers sends lead_action + selected id", () => {
  const r = buildLeadActionRequest({ ...base, leadAction: "find_decision_makers", leadCandidateIds: ["lead-2"] });
  assert(r.valid);
  if (!r.valid) return;
  assertEquals(r.body.tool_input.lead_action, "find_decision_makers");
  assertEquals(r.body.tool_input.lead_candidate_ids, ["lead-2"]);
});

Deno.test("Test 3: generate_outreach sends lead_action + selected id", () => {
  const r = buildLeadActionRequest({ ...base, leadAction: "generate_outreach", leadCandidateIds: ["lead-3"] });
  assert(r.valid);
  if (!r.valid) return;
  assertEquals(r.body.tool_input.lead_action, "generate_outreach");
});

Deno.test("Test 4: no selected lead → safe error, nothing built", () => {
  const r = buildLeadActionRequest({ ...base, leadAction: "research_company", leadCandidateIds: [] });
  assert(!r.valid);
  if (r.valid) return;
  assertEquals(r.error, "no_lead_selected");
});

Deno.test("no workspace → typed guard", () => {
  const noWs = buildLeadActionRequest({ workspaceId: null, planId: "p", leadAction: "research_company", leadCandidateIds: ["a"] });
  assert(!noWs.valid && noWs.error === "no_workspace");
});

// A direct action is valid WITHOUT a plan — it operates on rows that already
// exist. Previously this returned `no_plan` and the button did nothing.
Deno.test("missing plan is valid; plan_id is omitted rather than faked", () => {
  for (const planId of [undefined, null, ""]) {
    const r = buildLeadActionRequest({
      workspaceId: "ws", planId, leadAction: "research_company", leadCandidateIds: ["a"],
    });
    assert(r.valid, `planId=${String(planId)} should still build a valid request`);
    if (!r.valid) return;
    assertEquals(r.body.plan_id, undefined);
    assertEquals(r.body.tool_input.lead_candidate_ids, ["a"]);
  }
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
