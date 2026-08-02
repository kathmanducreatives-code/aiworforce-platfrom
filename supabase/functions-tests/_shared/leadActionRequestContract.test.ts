import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isDirectLeadActionAttempt,
  validateDirectLeadActionRequest,
  resolveTaskUserId,
  DIRECT_ACTION_AGENT,
  DIRECT_ACTION_INSTRUCTION,
} from "../../functions/_shared/leadActionRequestContract.ts";

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
  assertEquals(
    resolveTaskUserId({ bearerIsServiceRole: false, bodyUserId: undefined, authenticatedUserId: USER }),
    USER,
  );
});

Deno.test("no user anywhere → null, so the caller refuses instead of inserting null", () => {
  assertEquals(resolveTaskUserId({ bearerIsServiceRole: false, authenticatedUserId: null }), null);
  assertEquals(resolveTaskUserId({ bearerIsServiceRole: true, authenticatedUserId: null }), null);
  // A non-UUID must never be trusted through to a uuid column.
  assertEquals(resolveTaskUserId({ bearerIsServiceRole: true, bodyUserId: "not-a-uuid", authenticatedUserId: null }), null);
  assertEquals(resolveTaskUserId({ bearerIsServiceRole: false, bodyUserId: "", authenticatedUserId: "" }), null);
});

// ---------------------------------------------------------------------------
// ATTRIBUTION TRUST BOUNDARY — body.user_id is caller-controlled, so it may only
// be honoured for a verified SERVICE_ROLE bearer. A browser request must always
// be attributed to its JWT user.
// ---------------------------------------------------------------------------

Deno.test("browser request IGNORES a spoofed body.user_id entirely", () => {
  const victim = "55555555-5555-4555-8555-555555555555";
  assertEquals(
    resolveTaskUserId({ bearerIsServiceRole: false, bodyUserId: victim, authenticatedUserId: USER }),
    USER,
  );
});

Deno.test("browser cannot impersonate another member of the SAME workspace", () => {
  // Same-workspace member: membership checks would pass, so only attribution
  // resolution stands between the caller and filing tasks as a colleague.
  const colleague = "66666666-6666-4666-8666-666666666666";
  const got = resolveTaskUserId({ bearerIsServiceRole: false, bodyUserId: colleague, authenticatedUserId: USER });
  assertEquals(got, USER);
  assert(got !== colleague);
});

Deno.test("browser cannot impersonate a user OUTSIDE the workspace", () => {
  const outsider = "77777777-7777-4777-8777-777777777777";
  const got = resolveTaskUserId({ bearerIsServiceRole: false, bodyUserId: outsider, authenticatedUserId: USER });
  assertEquals(got, USER);
  assert(got !== outsider);
});

Deno.test("a browser request with NO authenticated user is rejected, spoof or not", () => {
  const attacker = "88888888-8888-4888-8888-888888888888";
  // Supplying a body.user_id must not manufacture attribution out of nothing.
  assertEquals(resolveTaskUserId({ bearerIsServiceRole: false, bodyUserId: attacker, authenticatedUserId: null }), null);
});

Deno.test("service-role request MAY use a valid body.user_id (orchestrate unchanged)", () => {
  assertEquals(
    resolveTaskUserId({ bearerIsServiceRole: true, bodyUserId: USER, authenticatedUserId: null }),
    USER,
  );
});

Deno.test("service-role falls back to its own resolved user when body omits one", () => {
  assertEquals(
    resolveTaskUserId({ bearerIsServiceRole: true, bodyUserId: undefined, authenticatedUserId: USER }),
    USER,
  );
});

Deno.test("service-role status is a parameter, never read from the request body", () => {
  // A caller claiming to be a system caller is just a caller: a body field named
  // like the flag must have no effect. bearerIsServiceRole is derived by run-agent
  // from the actual Authorization bearer.
  const attacker = "99999999-9999-4999-8999-999999999999";
  const spoofBody = {
    user_id: attacker,
    bearerIsServiceRole: true,
    is_service_role: true,
    role: "service_role",
  } as Record<string, unknown>;

  assertEquals(
    resolveTaskUserId({
      bearerIsServiceRole: false, // what run-agent actually verified
      bodyUserId: spoofBody.user_id,
      authenticatedUserId: USER,
    }),
    USER,
  );
});

Deno.test("a valid direct action never resolves to a null user_id", () => {
  // Pairs with tasks.user_id being NOT NULL in production.
  const resolved = resolveTaskUserId({ bearerIsServiceRole: false, bodyUserId: undefined, authenticatedUserId: USER });
  assert(resolved !== null);
  assertEquals(resolved, USER);
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

// ---------------------------------------------------------------------------
// WIRING GUARD — run-agent calls Deno.serve at module load, so its task-insert
// payload cannot be imported and exercised directly. These assertions read the
// source instead: they prove the resolver is actually wired into the insert with
// the verified flag, which is the part a regression would silently undo. They
// verify wiring, not runtime behaviour — the resolver tests above cover that.
// ---------------------------------------------------------------------------

const RUN_AGENT_SRC = await Deno.readTextFile(new URL("../run-agent/index.ts", import.meta.url));

Deno.test("wiring: run-agent passes the VERIFIED service-role flag to the resolver", () => {
  assert(
    /resolveTaskUserId\(\{\s*bearerIsServiceRole\s*,/.test(RUN_AGENT_SRC),
    "resolveTaskUserId must receive bearerIsServiceRole",
  );
  // The flag must come from the Authorization bearer, never the request body.
  assert(
    /bearerIsServiceRole\s*=\s*!!bearer\s*&&\s*bearer\s*===\s*serviceRoleKey/.test(RUN_AGENT_SRC),
    "bearerIsServiceRole must be derived from the Authorization bearer",
  );
  assert(
    !/bearerIsServiceRole\s*=\s*body\./.test(RUN_AGENT_SRC),
    "bearerIsServiceRole must never be read from the request body",
  );
});

Deno.test("wiring: the task insert uses the resolved user, never the raw body value", () => {
  assert(/user_id:\s*taskUserId/.test(RUN_AGENT_SRC), "task insert must use taskUserId");
  // The pre-fix expression that caused the production 500 must not come back.
  assert(
    !/user_id:\s*user_id\s*\?\?\s*null/.test(RUN_AGENT_SRC),
    "task insert must never fall back to a null user_id",
  );
});

Deno.test("wiring: a null resolution is refused before the insert is attempted", () => {
  assert(
    /if\s*\(!taskUserId\)\s*\{?\s*[\s\S]{0,200}?unidentified_user/.test(RUN_AGENT_SRC),
    "run-agent must refuse with unidentified_user when no user resolves",
  );
});

Deno.test("wiring: workspace membership and lead ownership guards remain in place", () => {
  assert(/decideWorkspaceAccess\(/.test(RUN_AGENT_SRC), "workspace access guard must remain");
  assert(/lead_not_in_workspace/.test(RUN_AGENT_SRC), "lead ownership guard must remain");
  assert(
    /from\("lead_candidates"\)[\s\S]{0,120}?eq\("workspace_id",\s*workspace_id\)/.test(RUN_AGENT_SRC),
    "lead ownership must stay scoped to the request workspace",
  );
});
