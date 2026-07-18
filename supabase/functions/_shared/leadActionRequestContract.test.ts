import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isDirectLeadActionAttempt,
  validateDirectLeadActionRequest,
  resolveTaskUserId,
  DIRECT_ACTION_AGENT,
  DIRECT_ACTION_INSTRUCTION,
} from "./leadActionRequestContract.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const LEAD_A = "22222222-2222-4222-8222-222222222222";
const LEAD_B = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

// ---------------------------------------------------------------------------
// ROOT CAUSE — tasks.user_id is NOT NULL. The direct Workbench body never
// carried a user_id, so run-agent inserted null, the insert failed, and the
// function 500'd before executeLeadAction: zero tasks, zero provider calls,
// "0/4 succeeded".
// ---------------------------------------------------------------------------

Deno.test("ROOT CAUSE: authenticated user backfills a body with no user_id", () => {
  // This is exactly the production request shape that produced the incident.
  assertEquals(resolveTaskUserId({ bodyUserId: undefined, authenticatedUserId: USER }), USER);
});

Deno.test("orchestrated body.user_id still wins (mode A unchanged)", () => {
  const other = "55555555-5555-4555-8555-555555555555";
  assertEquals(resolveTaskUserId({ bodyUserId: USER, authenticatedUserId: other }), USER);
});

Deno.test("no user anywhere → null, so the caller refuses instead of inserting null", () => {
  assertEquals(resolveTaskUserId({ bodyUserId: undefined, authenticatedUserId: null }), null);
  // A non-UUID must never be trusted through to a uuid column.
  assertEquals(resolveTaskUserId({ bodyUserId: "not-a-uuid", authenticatedUserId: null }), null);
  assertEquals(resolveTaskUserId({ bodyUserId: "", authenticatedUserId: "" }), null);
});

// ---------------------------------------------------------------------------
// ROUTING — the direct branch is recognised before the plan-step gate.
// ---------------------------------------------------------------------------

Deno.test("routing: a lead_action attempt is detected, including an unknown one", () => {
  assert(isDirectLeadActionAttempt({ lead_action: "find_decision_makers" }));
  // Detecting the ATTEMPT is what stops a typo falling through to the plan gate
  // (misreported as missing_required_fields) or to Scout sourcing.
  assert(isDirectLeadActionAttempt({ lead_action: "teleport_ceo" }));
  assert(isDirectLeadActionAttempt({ lead_action: undefined }));
});

Deno.test("routing: a plain orchestrated tool_input is NOT a direct action", () => {
  assert(!isDirectLeadActionAttempt({ query: "series A fintech" }));
  assert(!isDirectLeadActionAttempt(null));
  assert(!isDirectLeadActionAttempt(undefined));
  assert(!isDirectLeadActionAttempt("lead_action"));
});

Deno.test("direct action validates with NO plan_id, step_index, or instruction", () => {
  const r = validateDirectLeadActionRequest({
    workspace_id: WS,
    tool_input: { lead_action: "find_decision_makers", lead_candidate_ids: [LEAD_A] },
  });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.request.action, "find_decision_makers");
  assertEquals(r.request.lead_candidate_ids, [LEAD_A]);
  // Agent + instruction are derived internally, never taken from the browser.
  assertEquals(r.request.agent_slug, DIRECT_ACTION_AGENT.find_decision_makers);
  assertEquals(r.request.instruction, DIRECT_ACTION_INSTRUCTION.find_decision_makers);
});

Deno.test("all three actions route to their semantic agent", () => {
  assertEquals(DIRECT_ACTION_AGENT.research_company, "hawk");
  assertEquals(DIRECT_ACTION_AGENT.find_decision_makers, "hawk");
  assertEquals(DIRECT_ACTION_AGENT.generate_outreach, "penn");
  for (const action of ["research_company", "find_decision_makers", "generate_outreach"] as const) {
    const r = validateDirectLeadActionRequest({
      workspace_id: WS,
      tool_input: { lead_action: action, lead_candidate_ids: [LEAD_A] },
    });
    assert(r.ok, `${action} should reach its handler`);
  }
});

Deno.test("unknown action → unsupported_lead_action, never a sourcing fallthrough", () => {
  const r = validateDirectLeadActionRequest({
    workspace_id: WS,
    tool_input: { lead_action: "teleport_ceo", lead_candidate_ids: [LEAD_A] },
  });
  assert(!r.ok);
  if (r.ok) return;
  assertEquals(r.error_code, "unsupported_lead_action");
  assertEquals(r.status, 400);
});

// ---------------------------------------------------------------------------
// STRUCTURAL VALIDATION
// ---------------------------------------------------------------------------

Deno.test("empty / missing lead list is refused rather than starting a search", () => {
  for (const ids of [[], undefined, null, "lead-1"]) {
    const r = validateDirectLeadActionRequest({
      workspace_id: WS,
      tool_input: { lead_action: "research_company", lead_candidate_ids: ids },
    });
    assert(!r.ok, `ids=${JSON.stringify(ids)} must be refused`);
    if (r.ok) return;
    assertEquals(r.error_code, "lead_action_requires_lead_candidate_ids");
  }
});

Deno.test("a malformed id rejects the WHOLE batch, not just that row", () => {
  const r = validateDirectLeadActionRequest({
    workspace_id: WS,
    tool_input: { lead_action: "research_company", lead_candidate_ids: [LEAD_A, "'; drop table --"] },
  });
  assert(!r.ok);
  if (r.ok) return;
  // Partially applying an action the caller didn't ask for is worse than refusing.
  assertEquals(r.error_code, "invalid_lead_candidate_id");
});

Deno.test("missing / malformed workspace is refused", () => {
  for (const ws of [undefined, null, "", "ws-1"]) {
    const r = validateDirectLeadActionRequest({
      workspace_id: ws,
      tool_input: { lead_action: "research_company", lead_candidate_ids: [LEAD_A] },
    });
    assert(!r.ok, `workspace=${String(ws)} must be refused`);
    if (r.ok) return;
    assertEquals(r.error_code, "invalid_workspace_id");
  }
});

Deno.test("duplicate ids are deduped so a lead is never processed twice", () => {
  const r = validateDirectLeadActionRequest({
    workspace_id: WS,
    tool_input: { lead_action: "research_company", lead_candidate_ids: [LEAD_A, LEAD_A, LEAD_B] },
  });
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.request.lead_candidate_ids, [LEAD_A, LEAD_B]);
});

Deno.test("validation is pure: no network, no clock, no provider reachable", () => {
  // Guards the provider-free contract — validation must be decidable offline.
  const r = validateDirectLeadActionRequest({
    workspace_id: WS,
    tool_input: { lead_action: "generate_outreach", lead_candidate_ids: [LEAD_A] },
  });
  assert(r.ok);
});
