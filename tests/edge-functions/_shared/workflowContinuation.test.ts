// CONTINUING A TERMINAL WORKFLOW, SAFELY.
//
// TEST task 41342269 is terminal, so `decideResume` correctly refuses it. Its
// paid memo23 dataset — 50 structured companies, 177 embedded roles — is still
// there, and everything after discovery was never attempted. A continuation
// adopts that run instead of buying it again.
//
// The dangerous parts are not the feature, they are the request shape and the
// idempotency. A caller-supplied dataset id would read any Apify dataset in the
// account; a non-idempotent endpoint would buy a second set of identity searches
// on a double click.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  REFUSAL_STATUS, buildResumeState, continuationKey, decideContinuation,
  parseContinuationRequest, selectResumableRun, taskIsTerminal,
  wouldStartNewDiscoveryRun, type ContinuationInputs,
} from "../../../supabase/functions/_shared/workflowContinuation.ts";
import { decideWorkspaceAccess } from "../../../supabase/functions/_shared/workspaceAccessGuard.ts";

const TASK = "41342269-7664-4d23-960b-1e42ab0c25ee";
const PLAN = "d64fad1a-585e-44ce-84ee-176e408393b4";
const CONV = "d10afbdb-3b01-4d6f-9444-d448a2371ef9";
const WS   = "00000000-0000-0000-0000-000000000001";
const RUN  = "1ixtHU1MJaJOC7M3q";
const DS   = "qceyqIPYKbW4oIpRW";

const REQUEST = {
  original_task_id: TASK, original_plan_id: PLAN, conversation_id: CONV,
  continuation_reason: "resume_from_existing_company_dataset",
};

/** The original task's real tool call: memo23, succeeded, 25 rows recorded. */
const TOOL_CALLS = [{
  status: "succeeded",
  input_json: { selected_actor_key: "apify_yc_companies_memo23", actor_id: "memo23/y-combinator-scraper" },
  output_json: { run_id: RUN, dataset_id: DS, total: 25 },
}];

function inputs(over: Partial<ContinuationInputs> = {}): ContinuationInputs {
  return {
    request: REQUEST,
    task: { id: TASK, plan_id: PLAN, workspace_id: WS, status: "complete",
      result: { lead_mission: { original_user_query: "Find founders of SaaS startups…" } } },
    plan: { id: PLAN, workspace_id: WS, user_id: "u1", steps: [{ agent_slug: "scout" }],
      user_instruction: "Find founders of SaaS startups…" },
    conversation: { id: CONV, workspace_id: null, user_id: "u1" },
    conversationCarriesOriginalPlan: true,
    toolCalls: TOOL_CALLS,
    existing: null,
    ...over,
  };
}

// ══════════════════════ 1/2/3. authorization is unchanged ══

Deno.test("1/2/3. member creates; non-member 403; no JWT 401", () => {
  // The SAME guard every other path uses — untouched, and asserted here so a
  // future edit to the continuation cannot quietly relax it.
  assertEquals(decideWorkspaceAccess({
    bearerIsServiceRole: false, authenticatedUserId: "u1", isMember: true }).ok, true);

  const nonMember = decideWorkspaceAccess({
    bearerIsServiceRole: false, authenticatedUserId: "u2", isMember: false });
  assertEquals(nonMember.ok, false);
  assertEquals((nonMember as { status: number }).status, 403);

  const noJwt = decideWorkspaceAccess({
    bearerIsServiceRole: false, authenticatedUserId: null, isMember: false });
  assertEquals(noJwt.ok, false);
  assertEquals((noJwt as { status: number }).status, 401);

  // A member of ANOTHER workspace cannot graft onto this conversation.
  const crossWs = decideContinuation(inputs({
    conversation: { id: CONV, workspace_id: "other-ws" }, conversationCarriesOriginalPlan: true }));
  assertEquals(crossWs.ok, false);
  assertEquals((crossWs as { refusal: string }).refusal, "conversation_workspace_mismatch");
  assertEquals(REFUSAL_STATUS.conversation_workspace_mismatch, 403);
});

Deno.test("4. the frontend needs no service-role secret", async () => {
  const fe = await Deno.readTextFile(
    new URL("../../../src/lib/workbench/continueWorkflow.ts", import.meta.url));
  for (const forbidden of ["SERVICE_ROLE", "service_role", "SUPABASE_SERVICE"]) {
    assertFalse(fe.includes(forbidden), `${forbidden} must never appear in browser code`);
  }
  assert(fe.includes("supabase.functions.invoke('continue-workflow'"),
    "the call must go through the authenticated client, which attaches the user's token");

  const be = await Deno.readTextFile(
    new URL("../../../supabase/functions/continue-workflow/index.ts", import.meta.url));
  assert(be.includes("bearer === SERVICE_ROLE"),
    "a service-role token presented by a browser must be refused, not honoured");
  assert(be.includes("service_role_not_accepted"));
  assert(be.includes("decideWorkspaceAccess({"), "membership is checked the normal way");
  assertFalse(be.includes("bearerIsServiceRole: true"), "the guard must not be short-circuited");
});

// ══════════════════════════ 5/6. exactly one continuation ══

Deno.test("5. a terminal task creates one continuation", () => {
  assert(taskIsTerminal("complete"));
  assert(taskIsTerminal("failed"));
  assertFalse(taskIsTerminal("running"), "a live run has nothing to continue");

  const d = decideContinuation(inputs());
  assert(d.ok && d.created, "a terminal task with a stored run may continue");
  const spec = (d as { spec: { lineage: Record<string, string> } }).spec;
  assertEquals(spec.lineage.continuation_of_task_id, TASK);
  assertEquals(spec.lineage.continuation_of_plan_id, PLAN);
  assertEquals(spec.lineage.parent_task_id, TASK);
  assertEquals(spec.lineage.conversation_id, CONV);

  const running = decideContinuation(inputs({
    task: { id: TASK, plan_id: PLAN, workspace_id: WS, status: "running", result: null } }));
  assertEquals((running as { refusal: string }).refusal, "task_not_terminal");
});

Deno.test("6. repeated requests return the SAME continuation", () => {
  const existing = { plan_id: "cont-plan", task_id: "cont-task" };
  const d = decideContinuation(inputs({ existing }));
  assert(d.ok && !d.created, "a second click must not create a second task");
  assertEquals((d as { existing: typeof existing }).existing, existing);

  // The key is deterministic and carries no clock — two clicks a second apart
  // MUST collide, or the second one buys another round of identity searches.
  const k1 = continuationKey(WS, TASK, REQUEST.continuation_reason);
  const k2 = continuationKey(WS, TASK, REQUEST.continuation_reason);
  assertEquals(k1, k2);
  assertFalse(k1 === continuationKey("other-ws", TASK, REQUEST.continuation_reason));
  assertFalse(k1 === continuationKey(WS, "other-task", REQUEST.continuation_reason));
});

// ══════════════ 7/8. run and dataset are DERIVED, never accepted ══

Deno.test("7. the run id and dataset id come from the server's own records", () => {
  const run = selectResumableRun(TOOL_CALLS)!;
  assertEquals(run.run_id, RUN);
  assertEquals(run.dataset_id, DS);
  assertEquals(run.provider, "apify_yc_companies_memo23");

  const d = decideContinuation(inputs());
  const spec = (d as { spec: { lineage: Record<string, string> } }).spec;
  assertEquals(spec.lineage.apify_run_id, RUN);
  assertEquals(spec.lineage.apify_dataset_id, DS);

  // Only a company DISCOVERY run may be adopted.
  assertEquals(selectResumableRun([{ status: "succeeded",
    input_json: { selected_actor_key: "apify_linkedin_company_search" },
    output_json: { run_id: "x", dataset_id: "y", total: 5 } }]), null);
  // A failed or empty run is not resumable evidence.
  assertEquals(selectResumableRun([{ status: "failed", input_json: TOOL_CALLS[0].input_json,
    output_json: TOOL_CALLS[0].output_json }]), null);
  assertEquals(selectResumableRun([{ status: "succeeded", input_json: TOOL_CALLS[0].input_json,
    output_json: { run_id: RUN, dataset_id: DS, total: 0 } }]), null);
  assertEquals((decideContinuation(inputs({ toolCalls: [] })) as { refusal: string }).refusal,
    "no_resumable_provider_run");
});

Deno.test("8. a forged run id in the request is IGNORED", () => {
  // The parser accepts four fields and nothing else, so extra keys cannot reach
  // the decision. A request naming its own dataset would be a way to read any
  // Apify dataset in this account.
  const parsed = parseContinuationRequest({
    ...REQUEST,
    apify_run_id: "ATTACKER_RUN", dataset_id: "ATTACKER_DATASET",
    workspace_id: "other-ws", capability_execution_state: { pending_runs: [] },
  });
  assert(parsed.ok);
  const keys = Object.keys((parsed as { request: object }).request).sort();
  assertEquals(keys, ["continuation_reason", "conversation_id", "original_plan_id", "original_task_id"]);

  // …and the derived spec still points at the SERVER's run.
  const d = decideContinuation(inputs({ request: (parsed as { request: typeof REQUEST }).request }));
  const spec = (d as { spec: { lineage: Record<string, string> } }).spec;
  assertEquals(spec.lineage.apify_run_id, RUN);
  assertFalse(spec.lineage.apify_run_id === "ATTACKER_RUN");

  // Malformed ids are refused outright.
  for (const bad of [null, {}, { ...REQUEST, original_task_id: "not-a-uuid" },
    { ...REQUEST, continuation_reason: "do_whatever" }]) {
    assertFalse(parseContinuationRequest(bad).ok, `${JSON.stringify(bad)} must be refused`);
  }
});

// ══════════════════════ 9/10. resume, never restart ══

Deno.test("9/10. the continuation GETs the stored run and never POSTs a new one", () => {
  const state = buildResumeState(selectResumableRun(TOOL_CALLS)!);
  assertFalse(wouldStartNewDiscoveryRun(state), "this state must adopt the existing run");

  const pending = (state.pending_runs as Array<Record<string, unknown>>)[0];
  assertEquals(pending.capability, "startup_company_discovery");
  assertEquals(pending.run_id, RUN);
  assertEquals(pending.dataset_id, DS);
  // Discovery must NOT be pre-marked complete: the engine skips a completed
  // capability entirely and rebuilds its working set in memory, so the
  // continuation would proceed with zero companies.
  assertEquals(state.completed_capabilities, []);

  // The states that WOULD start a new Actor, all rejected.
  assert(wouldStartNewDiscoveryRun({ pending_runs: [] }));
  assert(wouldStartNewDiscoveryRun({}));
  assert(wouldStartNewDiscoveryRun({ pending_runs: [{ capability: "company_enrichment", run_id: "r" }] }));
  assert(wouldStartNewDiscoveryRun({
    pending_runs: [{ capability: "startup_company_discovery", run_id: RUN }],
    completed_capabilities: ["startup_company_discovery"],
  }), "a completed discovery neither runs nor resumes");

  // And the endpoint fails closed on it rather than discovering the answer later.
  return Deno.readTextFile(
    new URL("../../../supabase/functions/continue-workflow/index.ts", import.meta.url))
    .then((src) => {
      assert(src.includes("wouldStartNewDiscoveryRun(spec.capability_execution_state)"));
      assert(src.includes("would_start_new_actor"));
    });
});

Deno.test("10b. runTool resumes through GET — the other half of the guarantee", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/toolRegistry.ts", import.meta.url));
  assert(/resumeRunId\s*\n?\s*\?\s*await apifyFetch\(\s*`\/actor-runs\/\$\{resumeRunId\}/.test(src),
    "a resume must be a GET on the existing run, not a POST that starts another");
});

// ══════════════ 11/12/13/14. dataset, conversation, ownership ══

Deno.test("11. the stored dataset's 50 companies and 177 jobs are preserved", async () => {
  // The REAL export of dataset qceyqIPYKbW4oIpRW — the rows a continuation reads.
  const rows = JSON.parse(await Deno.readTextFile(
    new URL("./fixtures/yc50.json", import.meta.url))) as
    Array<{ openJobs?: unknown[]; teamSize?: number }>;
  assertEquals(rows.length, 50);
  assertEquals(rows.reduce((n, r) => n + (r.openJobs?.length ?? 0), 0), 177);
  assert(rows.every((r) => typeof r.teamSize === "number"), "top-level teamSize survives");
  assert(rows.every((r) => Array.isArray(r.openJobs)), "top-level openJobs survives");
});

Deno.test("12. the continuation stays in the ORIGINAL conversation", () => {
  const d = decideContinuation(inputs());
  const spec = (d as { spec: { conversation_id: string; lineage: Record<string, string> } }).spec;
  assertEquals(spec.conversation_id, CONV, "no new conversation is ever created");
  assertEquals(spec.lineage.conversation_id, CONV);
});

Deno.test("13. Workbench ownership switches to the continuation plan", async () => {
  const panel = await Deno.readTextFile(new URL(
    "../../../src/components/chat/workspace/workbench/ContinueVerificationBar.tsx", import.meta.url));
  assert(panel.includes("onContinued({"));
  assert(panel.includes("planId: r.plan_id"));
  assert(panel.includes("conversationId: r.conversation_id ?? conversationId"),
    "the conversation must be carried over, not replaced");
  assert(panel.includes("disabled={busy}"), "repeated clicks must be prevented while starting");

  const wb = await Deno.readTextFile(new URL(
    "../../../src/components/chat/workspace/workbench/WorkbenchPanel.tsx", import.meta.url));
  assert(wb.includes("openWorkbench({"), "ownership follows the continuation");
  assert(wb.includes("plan_id: planId"), "the panel meta must point at the continuation plan");
});

Deno.test("14. the four tracked companies survive prequalification of the stored rows", async () => {
  const { prequalifyYcCompanies, shortlistForLinkedInResolution, linkedInSearchQueryFor } =
    await import("../../../supabase/functions/_shared/leadCommercialPrequalification.ts");
  const yc = (name: string, website: string, teamSize: number, titles: string[]) =>
    ({ name, website, teamSize, batch: "W25", industries: ["B2B"],
       openJobs: titles.map((title) => ({ title })) });
  const rows = [
    yc("SnapMagic", "https://snapmagic.com", 23, ["Head of Operations", "Head of Sales"]),
    yc("Tara AI", "https://tara.ai", 13, ["Founding Account Executive"]),
    yc("AgentMail", "https://agentmail.to", 10, ["GTM Engineer", "Founding GTM Lead"]),
    yc("Bluejay", "https://getbluejay.ai", 10, ["Member of Technical Staff", "Founding Account Executive", "Founding SDR"]),
  ];
  const r = prequalifyYcCompanies(rows, { min: 10, max: 150 });
  assertEquals(r.eligible_companies, 4, "all four must remain commercially eligible");
  const names = shortlistForLinkedInResolution(r, 5).map((c) => c.name);
  for (const n of ["SnapMagic", "Tara AI", "AgentMail", "Bluejay"]) {
    assert(names.includes(n), `${n} must be shortlisted`);
  }
  // Bare names, as the search Actor requires.
  for (const c of shortlistForLinkedInResolution(r, 5)) {
    assertFalse(/\.(com|ai|to)\b/.test(linkedInSearchQueryFor(c)),
      `query "${linkedInSearchQueryFor(c)}" must not carry a domain`);
  }
});

// ═══════ REGRESSION: the 403 that killed the first real click ══
//
// `conversations.workspace_id` is NULL on 232 of 234 rows in TEST — the column
// exists and this application never populates it. The original check required it
// to EQUAL the task's workspace, so the first "Continue verification" click was
// refused with `conversation_workspace_mismatch` (403) after 1341ms, having
// created nothing. The user saw only "Edge Function returned a non-2xx status
// code".
//
// The check is not dropped; it is replaced with something stronger.

Deno.test("REGRESSION: a NULL conversation workspace no longer 403s", () => {
  const real = decideContinuation(inputs({
    conversation: { id: CONV, workspace_id: null, user_id: "u1" },
    conversationCarriesOriginalPlan: true,
  }));
  assert(real.ok && real.created,
    "the exact production shape — null workspace, provably the right conversation");
});

Deno.test("REGRESSION: linkage is REQUIRED, so the guarantee is not weakened", () => {
  // Null workspace AND no proof this conversation ran the plan → still refused.
  const unproven = decideContinuation(inputs({
    conversation: { id: CONV, workspace_id: null, user_id: "u1" },
    conversationCarriesOriginalPlan: false,
  }));
  assertEquals((unproven as { refusal: string }).refusal, "conversation_workspace_mismatch");

  // A conversation DECLARING another workspace is refused even with linkage —
  // an explicit foreign owner outranks circumstantial evidence.
  const foreign = decideContinuation(inputs({
    conversation: { id: CONV, workspace_id: "other-ws", user_id: "u1" },
    conversationCarriesOriginalPlan: true,
  }));
  assertEquals((foreign as { refusal: string }).refusal, "conversation_workspace_mismatch");

  // A matching declared workspace still works on its own.
  const declared = decideContinuation(inputs({
    conversation: { id: CONV, workspace_id: WS, user_id: "u1" },
    conversationCarriesOriginalPlan: false,
  }));
  assert(declared.ok && declared.created);

  // A different conversation id is always refused.
  const wrongConv = decideContinuation(inputs({
    conversation: { id: "11111111-1111-1111-1111-111111111111", workspace_id: WS },
    conversationCarriesOriginalPlan: true,
  }));
  assertEquals((wrongConv as { refusal: string }).refusal, "conversation_workspace_mismatch");
});

Deno.test("REGRESSION: the endpoint proves linkage from messages, server-side", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/continue-workflow/index.ts", import.meta.url));
  assert(src.includes('.eq("conversation_id", request.conversation_id)'));
  assert(src.includes('.filter("metadata->>plan_id", "eq", request.original_plan_id)'),
    "linkage must be proven against the ORIGINAL plan, not a caller-supplied value");
  assert(src.includes("conversationCarriesOriginalPlan"));
});

// ══════════════════════ 15/16. no phantoms, no spend ══

Deno.test("15. a failed continuation leaves no phantom plan or message", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/continue-workflow/index.ts", import.meta.url));
  assert(src.includes("const rollback = async"), "a failure path must clean up");
  for (const table of ["messages", "tasks", "task_plans"]) {
    assert(new RegExp(`from\\("${table}"\\)\\.delete\\(\\)`).test(src),
      `rollback must remove the ${table} row it created`);
  }
  assert(src.includes("await rollback(`run-agent ${invokeStatus}`)"),
    "a run-agent failure must roll back, not leave a plan describing work that never ran");
  assert(src.includes("await rollback(String(e))"), "so must a thrown invocation");
});

Deno.test("16. nothing here can start an Actor", async () => {
  const shared = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/workflowContinuation.ts", import.meta.url));
  for (const forbidden of ["fetch(", "apifyFetch", "createClient", "Deno.env"]) {
    assertFalse(shared.includes(forbidden), `${forbidden} must not appear — the contract is pure`);
  }
  // The endpoint's only outbound call is to run-agent, never to Apify.
  const fn = await Deno.readTextFile(
    new URL("../../../supabase/functions/continue-workflow/index.ts", import.meta.url));
  assertFalse(fn.includes("api.apify.com"), "this function never talks to Apify directly");
  assertEquals((fn.match(/await fetch\(/g) ?? []).length, 1, "exactly one outbound call: run-agent");
  assert(fn.includes("/functions/v1/run-agent"));
});
