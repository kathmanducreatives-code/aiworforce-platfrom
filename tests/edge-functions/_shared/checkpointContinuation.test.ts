// CONTINUE REFUSED A CHECKPOINT THAT WAS COMPLETE.
//
// Task 43355471, 2026-08-29. The run saved a coherent checkpoint — 50 companies
// with snapshots, 10 shortlisted, discovery in `completed_capabilities`,
// `pending_runs: []`, next capability `company_identity_resolution` — and the
// Continue button answered:
//
//     no_resumable_provider_run
//     "That run has no stored company dataset to continue from."
//
// It had one. The discovery Actor run had SUCCEEDED (aox0htYw4mhCwb05c, dataset
// zcUtxYhdVdsticQQU, 50 rows, $0.153) and its rows were already in the
// checkpoint as company snapshots.
//
// ── THE PRECONDITION WAS WRONG, NOT THE DATA ───────────────────────────────
//
// Continuation was built for a run holding a paid DATASET and nothing else, so
// "continue" meant: re-enter discovery and ADOPT that run rather than buy a
// second one. Hence `selectResumableRun`, hence `buildResumeState` with an
// empty `completed_capabilities`, hence a hard requirement for a resumable
// provider run.
//
// The engine has since grown a real checkpoint and `restoreWorkingSet`. A run
// in that state needs no provider run adopted, because it will not call a
// provider for discovery at all — it skips the capability and restores the
// pool. Requiring one refused a run that had everything it needed.
//
// A provider run is now required only when there is genuinely nothing else to
// resume from.
//
// Pure. No network, no database, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  RUN_43355471_COMPANIES, RUN_43355471_RESULT, RUN_43355471_STATE,
  RUN_43355471_TOOL_CALLS,
} from "../../fixtures/run43355471Checkpoint.ts";
import {
  RESUMABLE_DISCOVERY_PROVIDERS, assessCheckpointResume, decideContinuation,
  selectResumableRun, wouldStartNewDiscoveryRun,
} from "../../../supabase/functions/_shared/workflowContinuation.ts";

const TASK_ID = "43355471-f0ca-4e12-aec4-f3dcf586ef90";
const PLAN_ID = "768257d7-17cc-4983-a22f-a5021ac2c3e0";
const CONV_ID = "a88584ea-1c98-4cd5-a8cb-5233d8e86278";
const WS = "0f8ab6f8-1d3f-4e6a-9a5b-000000000000";

const inputs = (over: Record<string, unknown> = {}) => ({
  request: {
    original_task_id: TASK_ID, original_plan_id: PLAN_ID, conversation_id: CONV_ID,
    continuation_reason: "resume_from_existing_company_dataset",
  },
  task: {
    id: TASK_ID, plan_id: PLAN_ID, workspace_id: WS, status: "ready",
    result: RUN_43355471_RESULT,
  },
  plan: {
    id: PLAN_ID, workspace_id: WS, user_id: "u1", steps: [{ agent_slug: "scout" }],
    user_instruction: "Find 5 recruiting or staffing companies…",
  },
  conversation: { id: CONV_ID, workspace_id: null },
  conversationCarriesOriginalPlan: true,
  toolCalls: RUN_43355471_TOOL_CALLS,
  existing: null,
  ...over,
  // deno-lint-ignore no-explicit-any
}) as any;

// ── 1. the shape, restated from production ─────────────────────────────────

Deno.test("1. the checkpoint really did carry the whole working set", () => {
  assertEquals(RUN_43355471_STATE.completed_capabilities, ["general_company_discovery"]);
  assertEquals(RUN_43355471_STATE.pending_runs, [], "nothing was in flight");
  assertEquals(RUN_43355471_COMPANIES.length, 50);
  assertEquals(
    RUN_43355471_COMPANIES.filter((c) => c.snapshot?.company).length, 50,
    "every company is restorable — `restoreWorkingSet` needs `snapshot.company`");
  assertEquals(
    RUN_43355471_COMPANIES.filter((c) => c.snapshot?.shortlisted === true).length, 10);
});

Deno.test("2. and the legacy path genuinely cannot see it", () => {
  assertEquals(selectResumableRun(RUN_43355471_TOOL_CALLS), null,
    "the discovery call succeeded with 50 rows, but its Actor is not in the allow-list");
  assert(!RESUMABLE_DISCOVERY_PROVIDERS.has("apify_linkedin_company_search"),
    "general company discovery moved to this Actor and the allow-list never learned");
});

// ── 3. the assessment ──────────────────────────────────────────────────────

Deno.test("3. the checkpoint is resumable on its own terms", () => {
  const a = assessCheckpointResume(RUN_43355471_RESULT);
  assertEquals(a.resumable, true);
  assertEquals(a.refusal, null);
  assertEquals(a.restorable_companies, 50);
  assertEquals(a.restorable_shortlisted, 10);
  assertEquals(a.next_capability, "company_identity_resolution",
    "the continuation starts at the next unfinished capability");
  assertEquals(a.pending_runs, 0, "and it needs no provider run to do it");
});

Deno.test("4. a checkpoint with no restorable pool is still refused", () => {
  // The failure `checkpointSnapshot` exists to prevent: discovery claimed
  // complete with nothing to show for it. A resume would investigate nobody.
  const hollow = {
    ...RUN_43355471_RESULT,
    lead_resume_checkpoint: { ...RUN_43355471_RESULT.lead_resume_checkpoint, companies: [] },
  };
  const a = assessCheckpointResume(hollow);
  assertEquals(a.resumable, false);
  assertEquals(a.refusal, "no_restorable_companies");
});

Deno.test("5. and so is one whose records predate snapshots", () => {
  const noSnapshots = {
    ...RUN_43355471_RESULT,
    lead_resume_checkpoint: {
      ...RUN_43355471_RESULT.lead_resume_checkpoint,
      companies: RUN_43355471_COMPANIES.map(({ snapshot: _s, ...rest }) => rest),
    },
  };
  assertEquals(assessCheckpointResume(noSnapshots).refusal, "no_restorable_companies",
    "rows that restore as nothing must not be counted as a working set");
});

Deno.test("6. a run that never finished discovery cannot be continued", () => {
  const early = {
    ...RUN_43355471_RESULT,
    capability_execution_state: { ...RUN_43355471_STATE, completed_capabilities: [] },
  };
  assertEquals(assessCheckpointResume(early).refusal, "discovery_not_complete");
});

// ── 7. the decision ────────────────────────────────────────────────────────

Deno.test("7. REGRESSION: Continue creates a continuation from the checkpoint alone", () => {
  const d = decideContinuation(inputs());
  assert(d.ok, `refused: ${(d as { refusal?: string }).refusal}`);
  assert(d.ok && d.created, "a continuation must be created");
});

Deno.test("8. and it resumes without re-running discovery", () => {
  const d = decideContinuation(inputs());
  assert(d.ok && d.created);
  const state = d.spec.capability_execution_state as Record<string, unknown>;

  assertEquals(state.completed_capabilities, ["general_company_discovery"],
    "discovery stays COMPLETE, so the engine skips it — no second Actor start");
  assertEquals(state.mission_hash, RUN_43355471_STATE.mission_hash,
    "the parent's own hash, or `stateMatchesMission` discards the state and " +
    "the engine starts from scratch");
  assertEquals(
    (state.pending_capabilities as string[])[0], "company_identity_resolution",
    "execution begins at the next unfinished capability");

  assertEquals(d.spec.lead_resume_records.length, 50,
    "all 50 companies travel to the child");
  assertEquals(
    d.spec.lead_resume_records.filter(
      (r) => (r as unknown as { snapshot?: { shortlisted?: boolean } })
        .snapshot?.shortlisted === true).length,
    10, "and the shortlist with them");
});

Deno.test("9. and the fail-closed guard agrees no discovery run would start", () => {
  const d = decideContinuation(inputs());
  assert(d.ok && d.created);
  assertEquals(
    wouldStartNewDiscoveryRun(d.spec.capability_execution_state,
      { restorableCompanies: d.spec.lead_resume_records.length }),
    false,
    "this is the check `continue-workflow` fails closed on before spending",
  );
  // WITHOUT the restorable pool it must still refuse — that is the case the
  // guard was written for and it has not been weakened.
  assertEquals(
    wouldStartNewDiscoveryRun(d.spec.capability_execution_state, { restorableCompanies: 0 }),
    true,
    "discovery complete with nothing to restore is still unsafe",
  );
});

Deno.test("10. discovery is not charged again — nothing is adopted and nothing is bought", () => {
  const d = decideContinuation(inputs());
  assert(d.ok && d.created);
  // The lineage records honestly that this continuation adopts no run: the
  // parent had none in flight.
  assertEquals(d.spec.lineage.apify_run_id, "");
  assertEquals(d.spec.lineage.provider, "checkpoint");
  // And the state it carries starts no discovery call.
  assertEquals((d.spec.capability_execution_state as Record<string, unknown>).pending_runs, []);
});

// ── 10b. the caller that holds the records rather than a stored row ────────

Deno.test("10b. the notice asks the question the way run-agent has to ask it", () => {
  // `run-agent` decides the wording for a checkpoint it is ABOUT TO WRITE, so
  // it holds `snap.resume_records` and has no `tasks.result` to read.
  //
  // Its first version synthesised one and omitted `version`, which
  // `readCheckpointCompanies` requires — so 50 restorable companies read back
  // as ZERO and the notice said "the companies it found were not saved with it"
  // while `continue-workflow` was successfully continuing the very same run.
  // Live, 09:40, three times.
  const viaRecords = assessCheckpointResume(
    { capability_execution_state: RUN_43355471_STATE }, RUN_43355471_COMPANIES);
  assertEquals(viaRecords.resumable, true,
    "a caller holding the records must get the same verdict as one reading them");
  assertEquals(viaRecords.restorable_companies, 50);
  assertEquals(viaRecords.restorable_shortlisted, 10);

  // And it agrees with the stored-row route, which is the whole point of one
  // function serving both callers.
  const viaResult = assessCheckpointResume(RUN_43355471_RESULT);
  assertEquals(viaRecords.resumable, viaResult.resumable);
  assertEquals(viaRecords.restorable_companies, viaResult.restorable_companies);
  assertEquals(viaRecords.next_capability, viaResult.next_capability);

  // THE TRAP ITSELF, pinned: a result whose checkpoint carries no `version` is
  // unreadable, so a caller must never hand-build one.
  const versionless = {
    capability_execution_state: RUN_43355471_STATE,
    lead_resume_checkpoint: { companies: RUN_43355471_COMPANIES },
  };
  assertEquals(assessCheckpointResume(versionless).restorable_companies, 0,
    "which is exactly why the records are passed directly instead");
});

// ── 11. the refusals that remain, and what they say ────────────────────────

Deno.test("11. a run with no checkpoint at all still gets the old refusal", () => {
  const d = decideContinuation(inputs({ task: {
    id: TASK_ID, plan_id: PLAN_ID, workspace_id: WS, status: "ready",
    result: { original_user_query: "x" },
  } }));
  assertEquals(d.ok, false);
  assertEquals((d as { refusal: string }).refusal, "no_resumable_provider_run",
    "no capability state means there is genuinely no data — the old message is true");
});

Deno.test("12. a checkpoint that exists but cannot be used says so distinctly", () => {
  const hollow = {
    ...RUN_43355471_RESULT,
    lead_resume_checkpoint: { ...RUN_43355471_RESULT.lead_resume_checkpoint, companies: [] },
  };
  const d = decideContinuation(inputs({ task: {
    id: TASK_ID, plan_id: PLAN_ID, workspace_id: WS, status: "ready", result: hollow,
  } }));
  assertEquals(d.ok, false);
  assertEquals((d as { refusal: string }).refusal, "checkpoint_not_resumable",
    "'there is no data' and 'the data cannot be used' are different facts");
});

Deno.test("13. the legacy adopt-a-run path is untouched", () => {
  const yc = [{
    status: "succeeded",
    input_json: { selected_actor_key: "apify_yc_companies_memo23" },
    output_json: { run_id: "RUN1", dataset_id: "DS1", total: 50 },
  }];
  const run = selectResumableRun(yc);
  assert(run, "a YC discovery run is still adoptable");
  assertEquals(run!.run_id, "RUN1");
  const d = decideContinuation(inputs({
    task: { id: TASK_ID, plan_id: PLAN_ID, workspace_id: WS, status: "ready",
      result: { original_user_query: "x" } },
    toolCalls: yc,
  }));
  assert(d.ok && d.created, "a terminal run holding an unread dataset still continues");
  assertEquals(d.spec.lineage.apify_run_id, "RUN1");
});
