// THE STALL, AND EVERY REASON NOT TO RESUME ONE.
//
// Run fafd9912, verbatim from production:
//
//   tasks.status                             "ready"
//   tasks.updated_at                          16:11:17   (slice 1)
//   lead_execution_calls ub2qunSMAKTNf5AKv    16:12:14   status "started"
//   result.auto_continuation.continuing        true
//   result.terminal_status         "execution_deadline_reached"   ← claim refuses
//
// Slice 2 enriched eleven companies, POSTed a job search and was killed
// mid-poll. Apify finished it — 150 rows, 533s — for nobody. Nothing on the
// machine would ever have looked at that task again.
//
// Pure. No network, no database, no clock.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AUTO_RESUME_SUPPRESSED_KEY, readAutoResumeSuppression,
  eligibleForAutoResume, resumeRequestFor, STALE_AFTER_MS, MAX_RESUMABLE_AGE_MS,
  type StalledTaskRow,
} from "../../../supabase/functions/_shared/stalledLeadResume.ts";
import {
  DEFAULT_MAX_CONTINUATIONS, DEFAULT_MAX_LINEAGE_COST_UNITS, LINEAGE_PROGRESS_KEY,
  MAX_BARREN_SLICES,
} from "../../../supabase/functions/_shared/leadAutoContinuation.ts";
import {
  assessCheckpointResume,
} from "../../../supabase/functions/_shared/workflowContinuation.ts";
import {
  mapTerminalRecordToRows,
} from "../../../supabase/functions/_shared/leadRunTerminalGuard.ts";

const NOW = Date.parse("2026-08-26T16:20:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/** The live stalled task, with the terminal status the FIXED writer produces. */
const STALLED = (over: Partial<StalledTaskRow> = {}): StalledTaskRow => ({
  id: "fafd9912-7c4e-42c0-8534-dd455137a8b8",
  workspace_id: "ws-1", user_id: "user-1", plan_id: "plan-1",
  agent_slug: "pilot", step_index: 0, status: "ready",
  updated_at: ago(9 * 60_000), created_at: ago(11 * 60_000),
  continuation_claim_expires_at: ago(4 * 60_000),
  result: {
    terminal_status: "continuation_required",
    company_first_state: { next_action: "start_round" },
    lead_mission: { original_user_query:
      "Find 3 companies matching my ICP that are actively hiring sales roles." },
    auto_continuation: { continuing: true, decision: "quota_unmet_frontier_remains" },
    capability_execution_state: { pending_runs: [] },
    [LINEAGE_PROGRESS_KEY]: { continuations_used: 1, cost_units_used: 1 },
  },
  ...over,
});

Deno.test("the live stalled task is resumed on the evidence of its paid run", () => {
  const v = eligibleForAutoResume(STALLED(), NOW, { hasStartedProviderRun: true });
  assertEquals(v.eligible, true);
  assertEquals(v.evidence, "pending_provider_run");
});

Deno.test("a lost handoff is resumed even with no paid work outstanding", () => {
  // Slice 1 decided to continue and the dispatch never landed. The chain is
  // stalled for a reason that has nothing to do with a provider.
  const v = eligibleForAutoResume(STALLED(), NOW, { hasStartedProviderRun: false });
  assertEquals(v.eligible, true);
  assertEquals(v.evidence, "continuation_intended");
});

Deno.test("a checkpointed pending run counts without asking the ledger", () => {
  const row = STALLED();
  (row.result!.capability_execution_state as Record<string, unknown>).pending_runs =
    [{ run_id: "ub2qunSMAKTNf5AKv" }];
  assertEquals(eligibleForAutoResume(row, NOW, {}).evidence, "pending_provider_run");
});

// ── EVERY REFUSAL ─────────────────────────────────────────────────────────

Deno.test("a TERMINAL task is never restarted", () => {
  // The requirement, and the claim's own rule: anything that is not
  // `continuation_required` is `already_terminal` to the RPC, so nudging it
  // would 409 on every tick for ever.
  for (const t of ["completed", "search_exhausted", "budget_exhausted",
    "round_limit_reached", "provider_failure", "invalid_request",
    "execution_deadline_reached"]) {
    const row = STALLED();
    row.result!.terminal_status = t;
    // `skip`, not `terminate`: this row is not the sweeper's to end. Something
    // else already gave it a terminal status, and overwriting that would be the
    // sweeper asserting an outcome it did not observe.
    assertEquals(eligibleForAutoResume(row, NOW, { hasStartedProviderRun: true }),
      { eligible: false, reason: "already_terminal", disposition: "skip" }, t);
  }
});

Deno.test("a task that is not `ready` is left alone", () => {
  // `running` belongs to `tasks_sweep_stuck_runs`, which moves it to `ready`
  // first. Two sweepers, one subject at a time.
  //
  // `complete` LEFT THIS LIST when a stamped-over checkpoint became
  // recoverable — see `RECOVERABLE_STAMPED_ROW_STATUSES`. It is still refused
  // unless the row explicitly says `continuation_required`, which is asserted
  // directly below rather than by lumping it in here.
  for (const s of ["running", "failed", "skipped", "partial"]) {
    assertEquals(eligibleForAutoResume(STALLED({ status: s }), NOW, {}).reason,
      "not_ready", s);
  }
  // A `complete` row with no continuation claim is an ordinary finished step.
  const finished = STALLED({ status: "complete" });
  delete (finished.result as Record<string, unknown>).terminal_status;
  assertEquals(eligibleForAutoResume(finished, NOW, {}).reason, "not_ready",
    "a finished step must not be swept up");
});

Deno.test("a task another worker is holding is not touched", () => {
  // CONCURRENCY, first line. The claim is the real lock; this stops us
  // generating a pointless claim attempt against a live lease every tick.
  const held = STALLED({ continuation_claim_expires_at: new Date(NOW + 60_000).toISOString() });
  assertEquals(eligibleForAutoResume(held, NOW, { hasStartedProviderRun: true }).reason,
    "claim_held");
});

Deno.test("a task touched moments ago may still have a live successor", () => {
  // The in-process handoff resolves in 2s and a slice runs ~125s. Racing it
  // costs a duplicate claim on every tick; waiting costs nothing.
  const fresh = STALLED({ updated_at: ago(STALE_AFTER_MS - 1_000) });
  assertEquals(eligibleForAutoResume(fresh, NOW, { hasStartedProviderRun: true }).reason,
    "too_fresh");
  const justStale = STALLED({ updated_at: ago(STALE_AFTER_MS + 1_000) });
  assertEquals(eligibleForAutoResume(justStale, NOW, { hasStartedProviderRun: true }).eligible,
    true);
});

Deno.test("a task that has been SILENT too long is abandoned, and ENDED", () => {
  // Nobody is watching a Workbench for a request that has not moved in three
  // hours, and spending their credits on it unasked is worse than leaving it.
  //
  // MEASURED FROM THE LAST ACTIVITY, NOT FROM CREATION. This test used to set
  // only `created_at` and leave `updated_at` nine minutes old, which asserted
  // that a task touched nine minutes ago should be abandoned because it STARTED
  // long ago. That is wrong in both directions: a healthy lineage continuing on
  // the same row keeps its original `created_at` for ever and would be killed
  // mid-flight, while a dead one was judged by when it began.
  const silent = STALLED({
    created_at: ago(MAX_RESUMABLE_AGE_MS + 60_000),
    updated_at: ago(MAX_RESUMABLE_AGE_MS + 60_000),
  });
  const verdict = eligibleForAutoResume(silent, NOW, { hasStartedProviderRun: true });
  assertEquals(verdict.reason, "abandoned");
  // AND IT IS ENDED, not deferred. Refusing it every three minutes until it
  // aged out of the scan is how task 43355471 was forgotten.
  assertEquals(verdict.disposition, "terminate");
  assert(verdict.detail && verdict.detail.length > 0, "abandoning owes the user a reason");
});

Deno.test("a LONG-RUNNING but recently active task is NOT abandoned", () => {
  // The other half. A same-row continuation that has been working for hours
  // keeps its original `created_at`; only silence may end it.
  const busy = STALLED({
    created_at: ago(MAX_RESUMABLE_AGE_MS * 3),
    updated_at: ago(6 * 60_000),
  });
  assertEquals(eligibleForAutoResume(busy, NOW, { hasStartedProviderRun: true }).eligible, true);
});

Deno.test("the EXISTING ceilings bound the resume loop", () => {
  // No new spend authority and no new counter — the same two numbers
  // `decideAutoContinuation` stops on.
  const conts = STALLED();
  (conts.result![LINEAGE_PROGRESS_KEY] as Record<string, unknown>).continuations_used =
    DEFAULT_MAX_CONTINUATIONS;
  assertEquals(eligibleForAutoResume(conts, NOW, { hasStartedProviderRun: true }).reason,
    "continuation_ceiling");

  const cost = STALLED();
  (cost.result![LINEAGE_PROGRESS_KEY] as Record<string, unknown>).cost_units_used =
    DEFAULT_MAX_LINEAGE_COST_UNITS;
  assertEquals(eligibleForAutoResume(cost, NOW, { hasStartedProviderRun: true }).reason,
    "cost_ceiling");
});

Deno.test("a run that simply finished short is not retried", () => {
  // `continuing: false` and no paid work outstanding. The sweeper is a stall
  // recovery, not a second opinion on an honest shortfall.
  const done = STALLED();
  done.result!.auto_continuation = { continuing: false, decision: "frontier_exhausted" };
  assertEquals(eligibleForAutoResume(done, NOW, { hasStartedProviderRun: false }).reason,
    "nothing_to_resume");
});

Deno.test("a task with no checkpoint or no mission is refused", () => {
  // The claim answers `no_checkpoint`; `run-agent` answers 400 without a
  // mission. Asking anyway would be a guaranteed refusal every three minutes.
  const noCp = STALLED(); delete noCp.result!.company_first_state;
  assertEquals(eligibleForAutoResume(noCp, NOW, {}).reason, "no_checkpoint");
  const noMission = STALLED(); delete noMission.result!.lead_mission;
  assertEquals(eligibleForAutoResume(noMission, NOW, {}).reason, "no_mission");
});

// ── THE REQUEST IT BUILDS ─────────────────────────────────────────────────

Deno.test("the resume is attributed to the person who asked", () => {
  const r = resumeRequestFor(STALLED())!;
  assert(r);
  assertEquals(r.resumeTaskId, "fafd9912-7c4e-42c0-8534-dd455137a8b8");
  assertEquals(r.userId, "user-1", "never the service identity");
  assertEquals(r.workspaceId, "ws-1");
  assertEquals(r.continuationIndex, 2, "the next slice, from the lineage counter");
  assertEquals(
    r.instruction,
    "Find 3 companies matching my ICP that are actively hiring sales roles.",
    "the MISSION's own words, not a planner instruction",
  );
  assert(r.leadMission, "run-agent reads the mission from the request, not the checkpoint");
});

Deno.test("a row that cannot be attributed produces no request", () => {
  assertEquals(resumeRequestFor(STALLED({ user_id: null })), null);
  assertEquals(resumeRequestFor(STALLED({ workspace_id: null })), null);
});

// ══ THE WRITER THAT LOCKED THE CLAIM OUT ══════════════════════════════════

Deno.test("a RESUMABLE partial now speaks the claim's vocabulary", () => {
  // THE LAST GAP. `mapTerminalRecordToRows` wrote `terminal_status:
  // record.reason` for a partial run, and "execution_deadline_reached" is not
  // in TERMINAL_STATUSES — so `claim_sourcing_continuation` refused the task
  // as `already_terminal`. A run that checkpointed, declared itself resumable
  // and asked to continue wrote the one value guaranteed to lock its own
  // successor out.
  const rows = mapTerminalRecordToRows({
    version: "lead-execution-finalizer-v1",
    status: "partial", reason: "execution_deadline_reached", resumable: true,
    detail: "stopped after 103581ms with 5 capability(ies) pending",
    blocked_by: null, pending_runs: [], provider_attempts: 2,
    pending_capabilities: [], failed_capabilities: [], completed_capabilities: [],
    last_completed_capability: "persistence", accumulated_cost_units: 1,
    elapsed_ms: 103581,
  } as never);
  assertEquals(rows.task_status, "ready");
  assertEquals(rows.result_patch.terminal_status, "continuation_required");
  assertEquals(rows.result_patch.terminal_record, undefined === undefined
    ? rows.result_patch.terminal_record : null, "the record itself is still carried");
  assert(rows.result_patch.terminal_record, "the untranslated reason survives on the record");
});

Deno.test("a NON-resumable partial keeps its reason verbatim", () => {
  // There is nothing to continue, and dressing it as `continuation_required`
  // would invite a claim that must then be refused deeper in.
  const rows = mapTerminalRecordToRows({
    version: "lead-execution-finalizer-v1",
    status: "partial", reason: "execution_deadline_reached", resumable: false,
    detail: "", blocked_by: null, pending_runs: [], provider_attempts: 0,
    pending_capabilities: [], failed_capabilities: [], completed_capabilities: [],
    last_completed_capability: null, accumulated_cost_units: 0, elapsed_ms: 1,
  } as never);
  assertEquals(rows.result_patch.terminal_status, "execution_deadline_reached");
});

Deno.test("a pending external run is unchanged", () => {
  // It already spoke the vocabulary; this must not have moved.
  const rows = mapTerminalRecordToRows({
    version: "lead-execution-finalizer-v1",
    status: "pending_external_run", reason: "provider_run_pending", resumable: true,
    detail: "", blocked_by: null,
    pending_runs: [{ run_id: "r", dataset_id: null, provider: "p" }],
    provider_attempts: 1, pending_capabilities: [], failed_capabilities: [],
    completed_capabilities: [], last_completed_capability: null,
    accumulated_cost_units: 1, elapsed_ms: 1,
  } as never);
  assertEquals(rows.task_status, "ready");
  assertEquals(rows.result_patch.terminal_status, "continuation_required");
});

// ── THE SWEEPER OWNS NO EXECUTOR AND NO LOCK ──────────────────────────────

Deno.test("the sweeper dispatches through run-agent, and claims nothing itself", () => {
  const FN = Deno.readTextFileSync(
    new URL("../../../supabase/functions/resume-stalled-leads/index.ts", import.meta.url),
  );
  assert(FN.includes("dispatchContinuation("), "the existing continuation path");
  // The RPC is NAMED in the header comment, which is the point — it explains
  // whose lock this relies on. What must not exist is a CALL to it.
  assertEquals(/\.rpc\(\s*["']claim_sourcing_continuation/.test(FN), false,
    "mutual exclusion is run-agent's claim, not a second lock");
  assertEquals(/\bupdate\(\s*\{[^}]*continuation_claim/.test(FN), false,
    "and not a hand-rolled compare-and-swap either");
  assertEquals(/runCapabilityPlan|callProvider|apify/i.test(FN), false,
    "a scheduler entry point owns no engine and no provider");
  assert(FN.includes("token !== SERVICE_KEY"), "the scheduler is the only caller");
});

// ── PHASE 8: THE TWO LIVE FAILURES ──────────────────────────────────────────
//
// Both came out of a decision shape that had one answer for "no" — look again
// in three minutes — when one lineage needed to STOP and another needed to
// CONTINUE.

/**
 * Task 43355471, verbatim in the parts that decide.
 *
 * `pending_runs: []`, no `auto_continuation`, and 50 companies with snapshots
 * behind $0.153 of paid discovery. The old rule answered `nothing_to_resume`
 * and did so every three minutes for two hours, after which the row aged out of
 * the scan window and was never looked at again.
 */
const CHECKPOINTED = (over: Partial<StalledTaskRow> = {}): StalledTaskRow => {
  const companies = Array.from({ length: 50 }, (_, i) => ({
    company_key: `https://www.linkedin.com/company/c${i}`,
    company_name: `Company ${i}`,
    identity: i < 11 ? "resolved" : "deferred",
    enrichment: i < 11 ? "completed" : "not_required",
    hiring: "not_started", brain: "not_started", founder: "not_eligible",
    completed_operations: [],
    snapshot: { company: { company_name: `Company ${i}` }, shortlisted: i < 21 },
  }));
  return {
    id: "43355471-f0ca-4e12-aec4-f3dcf586ef90",
    workspace_id: "ws-1", user_id: "user-1", plan_id: "plan-1",
    agent_slug: "pilot", step_index: 0, status: "ready",
    updated_at: ago(9 * 60_000), created_at: ago(11 * 60_000),
    continuation_claim_expires_at: null,
    result: {
      terminal_status: "continuation_required",
      company_first_state: { next_action: "start_round" },
      lead_mission: { original_user_query: "Find 5 recruiting or staffing companies…" },
      capability_execution_state: {
        pending_runs: [],
        completed_capabilities: ["general_company_discovery"],
        pending_capabilities: ["company_identity_resolution", "persistence"],
      },
      lead_resume_checkpoint: { version: "lead-resume-state-v1", companies },
      [LINEAGE_PROGRESS_KEY]: { continuations_used: 0, cost_units_used: 3, barren_slices: 0 },
    },
    ...over,
  };
};

Deno.test("43355471 IS RESUMABLE — a coherent checkpoint is its own reason", () => {
  // No pending provider run, no declared intent, 50 restorable companies. The
  // question the old rule never asked: is there work left we already paid to
  // discover.
  const v = eligibleForAutoResume(CHECKPOINTED(), NOW, { hasStartedProviderRun: false });
  assertEquals(v.eligible, true);
  assertEquals(v.disposition, "resume");
  assertEquals(v.evidence, "restorable_checkpoint");
});

Deno.test("…and the SAME assessment `continue-workflow` uses answers it", () => {
  // The fix already existed in the sibling path, which names this exact task in
  // its comment. Two resume paths deciding resumability differently is how one
  // of them stayed broken; this pins that they share the function.
  assertEquals(
    assessCheckpointResume(CHECKPOINTED().result as Record<string, unknown>).resumable,
    true,
  );
});

Deno.test("a checkpoint whose companies cannot be RESTORED is not resumable", () => {
  // "Present" is not "restorable": `restoreWorkingSet` skips a record with no
  // `snapshot.company`, so counting those would promise a resume that comes
  // back holding nothing.
  const hollow = CHECKPOINTED();
  const cp = (hollow.result!.lead_resume_checkpoint as { companies: Array<Record<string, unknown>> });
  for (const c of cp.companies) c.snapshot = { shortlisted: true };
  const v = eligibleForAutoResume(hollow, NOW, { hasStartedProviderRun: false });
  assertEquals(v.eligible, false);
  assertEquals(v.disposition, "terminate");
  assertEquals(v.reason, "nothing_to_resume");
});

Deno.test("9da530ae IS STOPPED — barren slices end the lineage", () => {
  // Production: barren_slices 8→9 while the in-process controller had already
  // said `continuation_ceiling`. The sweeper re-dispatched at 09:09, 09:18 and
  // 09:27, each successor making zero provider calls.
  const barren = CHECKPOINTED();
  (barren.result![LINEAGE_PROGRESS_KEY] as Record<string, unknown>).barren_slices = 9;
  // ── NO RUN IN FLIGHT, WHICH IS WHAT THE INCIDENT ACTUALLY WAS ───────────
  //
  // This passed `hasStartedProviderRun: true`, incidentally — the incident's
  // own description is "each successor making zero provider calls". A paid run
  // mid-flight now outranks a barren verdict, because no finding about the pool
  // can be known while a call we have already paid for is still running
  // (lineage 744644ab: terminated `no_progress` while job search
  // xczA1HpLcL008EbU1 was succeeding, and its three job rows were discarded).
  //
  // The rule this test exists for is unchanged and still asserted: with nothing
  // in flight, a barren streak ends the lineage.
  const v = eligibleForAutoResume(barren, NOW, { hasStartedProviderRun: false });
  assertEquals(v.eligible, false);
  assertEquals(v.reason, "no_progress");
  assertEquals(v.disposition, "terminate");
  assert(v.detail?.includes("9"), "the terminal record names the streak");
});

Deno.test("the barren rule is the SAME number the in-process controller stops on", () => {
  // Not a second opinion with its own threshold — the same constant, so the two
  // deciders cannot disagree about what a stalled lineage looks like.
  const atLimit = CHECKPOINTED();
  (atLimit.result![LINEAGE_PROGRESS_KEY] as Record<string, unknown>).barren_slices =
    MAX_BARREN_SLICES;
  assertEquals(eligibleForAutoResume(atLimit, NOW, {}).reason, "no_progress");

  const below = CHECKPOINTED();
  (below.result![LINEAGE_PROGRESS_KEY] as Record<string, unknown>).barren_slices =
    MAX_BARREN_SLICES - 1;
  assertEquals(eligibleForAutoResume(below, NOW, {}).eligible, true,
    "one barren slice is ordinary and must not end a run");
});

Deno.test("a ceiling ENDS the lineage rather than being re-refused for ever", () => {
  // Counters only go up, so reaching a ceiling is final by definition. These
  // were `skip`, which meant the row was re-examined every three minutes.
  for (const [field, value] of [
    ["continuations_used", DEFAULT_MAX_CONTINUATIONS],
    ["cost_units_used", DEFAULT_MAX_LINEAGE_COST_UNITS],
  ] as const) {
    const row = CHECKPOINTED();
    (row.result![LINEAGE_PROGRESS_KEY] as Record<string, unknown>)[field] = value;
    const v = eligibleForAutoResume(row, NOW, { hasStartedProviderRun: true });
    assertEquals(v.disposition, "terminate", field);
    assert(v.detail?.includes(String(value)), "the record names the number it hit");
  }
});

Deno.test("EVERY refusal is either transient or final — none is silent", () => {
  // The property the old shape could not express. A `skip` must be something
  // that can genuinely change on the next tick; anything else owes the user an
  // outcome.
  const cases: Array<[string, StalledTaskRow, Record<string, unknown>]> = [
    ["too_fresh", CHECKPOINTED({ updated_at: ago(30_000) }), {}],
    ["claim_held", CHECKPOINTED({
      continuation_claim_expires_at: new Date(NOW + 60_000).toISOString() }), {}],
    ["not_ready", CHECKPOINTED({ status: "running" }), {}],
  ];
  for (const [name, row, opts] of cases) {
    const v = eligibleForAutoResume(row, NOW, opts);
    assertEquals(v.disposition, "skip", `${name} must be transient`);
  }
  for (const v of [
    eligibleForAutoResume(CHECKPOINTED({
      updated_at: ago(MAX_RESUMABLE_AGE_MS + 60_000) }), NOW, {}),
  ]) {
    assertEquals(v.disposition, "terminate");
    assert(v.detail, "a terminal disposition always carries a reason");
  }
});

// ── THE SWEEPER ACTS ON THE VERDICT ─────────────────────────────────────────

const SWEEPER = Deno.readTextFileSync(
  new URL("../../../supabase/functions/resume-stalled-leads/index.ts", import.meta.url));

Deno.test("the scan no longer hides rows it could have ended", () => {
  // `created_at >= now - MAX_RESUMABLE_AGE_MS` is what made task 43355471
  // disappear: the log went from `scanned: 1` to `scanned: 0` and nothing said
  // why. A row the sweeper cannot see is a row it cannot end.
  assert(
    !/gte\("created_at",\s*new Date\(now - MAX_RESUMABLE_AGE_MS\)/.test(SWEEPER),
    "the decision horizon must not double as a visibility filter",
  );
  assert(SWEEPER.includes("SCAN_HORIZON_MS"), "the scan bound is named and far wider");
});

Deno.test("a `terminate` verdict ends the row instead of deferring it", () => {
  assert(/verdict\.disposition === "terminate"/.test(SWEEPER),
    "the sweeper must branch on the disposition");
  assert(SWEEPER.includes("endLineage("), "and act on it");
});

Deno.test("ending a row is guarded on it still being `ready`", () => {
  // Between the scan and the write, `run-agent` may have claimed it. The update
  // narrows on status so the sweeper cannot end a run that has restarted.
  assert(/\.eq\("id", row\.id\)\.eq\("status", "ready"\)/.test(SWEEPER),
    "the terminal write must be conditional on the status it observed");
});

Deno.test("the stop notice claims nothing about spend or evaluation", () => {
  // The audit's standing finding: summaries that assert spend without reading
  // the ledger are how the product told users "No credits charged" while
  // credits were being charged. The sweeper has read neither ledger.
  const notices = SWEEPER.slice(SWEEPER.indexOf("const STOP_NOTICE"));
  const block = notices.slice(0, notices.indexOf("});") + 3);
  for (const claim of ["credits charged", "No credits", "evaluated", "qualified",
                       "none passed", "nothing was charged"]) {
    assert(!block.toLowerCase().includes(claim.toLowerCase()),
      `a scheduling notice must not claim "${claim}"`);
  }
  assert(block.includes("saved"), "it should say the work is kept");
});

Deno.test("a row with NO terminal status is not 'already terminal'", () => {
  // The eight stranded rows, verbatim in the part that decides: `status: ready`,
  // `terminal_status` absent, silent for between 71 and 294 hours. They were
  // skipped as `already_terminal` — a reason asserting somebody had finished
  // them, when nothing ever had.
  const never = CHECKPOINTED({
    updated_at: ago(MAX_RESUMABLE_AGE_MS + 60_000),
    created_at: ago(MAX_RESUMABLE_AGE_MS + 120_000),
  });
  delete never.result!.terminal_status;
  const v = eligibleForAutoResume(never, NOW, {});
  assert(v.reason !== "already_terminal", "absent is not the same as finished");
  assertEquals(v.reason, "abandoned");
  assertEquals(v.disposition, "terminate");
});

Deno.test("a row somebody ELSE finished is still left alone", () => {
  // The other side of that line. A real terminal status belongs to whoever
  // wrote it, and the sweeper must not overwrite an outcome it did not observe.
  const finished = CHECKPOINTED({ updated_at: ago(MAX_RESUMABLE_AGE_MS + 60_000) });
  finished.result!.terminal_status = "round_limit_reached";
  const v = eligibleForAutoResume(finished, NOW, {});
  assertEquals(v.reason, "already_terminal");
  assertEquals(v.disposition, "skip");
});

Deno.test("SILENCE IS JUDGED BEFORE SHAPE", () => {
  // After hours of quiet it no longer matters why a row cannot resume — a
  // missing checkpoint, a missing mission — only that nothing will pick it up.
  // Every stranded row failed a structural check and was skipped rather than
  // ended, which is how each of them survived for weeks.
  for (const missing of ["company_first_state", "lead_mission"]) {
    const row = CHECKPOINTED({ updated_at: ago(MAX_RESUMABLE_AGE_MS + 60_000) });
    delete row.result![missing];
    assertEquals(eligibleForAutoResume(row, NOW, {}).disposition, "terminate", missing);
  }
  // But a FRESH row missing the same things is still merely refused: it may
  // simply not have finished being written.
  for (const missing of ["company_first_state", "lead_mission"]) {
    const row = CHECKPOINTED({ updated_at: ago(9 * 60_000) });
    delete row.result![missing];
    assertEquals(eligibleForAutoResume(row, NOW, {}).disposition, "skip", missing);
  }
});

// ══ THE DURABLE SKIP MARKER ═══════════════════════════════════════════════
//
// `single_generation` suppresses run-agent's OWN self-dispatch and nothing else.
// The sweeper selects on `status = 'ready'` and adopts anything quiet for
// STALE_AFTER_MS, so on 2026-08-30 a run triggered exactly once produced
// generation 8 and then generation 9 unattended, and the acceptance run had to
// be stopped by marking its task terminal — which buys quiet by destroying
// resumability.

const suppressed = (at: string) => ({
  [AUTO_RESUME_SUPPRESSED_KEY]: {
    at, by: "run-agent:single_generation",
    reason: "single_generation requested by a service-role caller",
  },
});

Deno.test("A PARKED ROW IS SKIPPED, and the SAME row without the marker is not", () => {
  // The negative control is the point: it proves the marker is what changes the
  // answer, not some unrelated property of the fixture.
  const plain = CHECKPOINTED();
  assertEquals(eligibleForAutoResume(plain, NOW, { hasStartedProviderRun: true }).eligible,
    true, "the control row must genuinely be resumable");

  const parked = CHECKPOINTED();
  Object.assign(parked.result!, suppressed(ago(60_000)));
  assertEquals(eligibleForAutoResume(parked, NOW, { hasStartedProviderRun: true }),
    { eligible: false, reason: "auto_resume_suppressed", disposition: "skip" });
});

Deno.test("SKIP, NEVER TERMINATE — the work is parked, not finished", () => {
  // Terminating is what the acceptance run had to do by hand, and it ends the
  // lineage. This must not do that at any age.
  for (const age of [60_000, STALE_AFTER_MS + 60_000, MAX_RESUMABLE_AGE_MS + 60_000]) {
    const row = CHECKPOINTED({ updated_at: ago(age) });
    Object.assign(row.result!, suppressed(ago(age + 1_000)));
    const v = eligibleForAutoResume(row, NOW, { hasStartedProviderRun: true });
    assertEquals(v.disposition, "skip", `age ${age}`);
    assertEquals(v.reason, "auto_resume_suppressed", `age ${age}`);
  }
});

Deno.test("it is checked BEFORE silence, ceilings and shape", () => {
  // A row that would otherwise be abandoned, ceiling-stopped or terminated must
  // still report the marker — the answer is an instruction, not a judgement, and
  // an operator reading "abandoned" would not know the row had been parked.
  const abandoned = CHECKPOINTED({ updated_at: ago(MAX_RESUMABLE_AGE_MS + 60_000) });
  delete abandoned.result!.company_first_state;
  assertEquals(eligibleForAutoResume(abandoned, NOW, {}).disposition, "terminate",
    "control: this row is otherwise terminated");
  Object.assign(abandoned.result!, suppressed(ago(60_000)));
  assertEquals(eligibleForAutoResume(abandoned, NOW, {}).reason, "auto_resume_suppressed");
});

Deno.test("a stamped-over row reports the marker, not the row status", () => {
  // This used to assert `not_ready`, on the reading that row status outranks
  // the marker. That was right while `complete` was a dead end; now that a
  // stamped-over checkpoint is recoverable, "somebody parked this on purpose"
  // is the true answer and `not_ready` would be the second wrong one.
  const done = CHECKPOINTED({ status: "complete" });
  Object.assign(done.result!, suppressed(ago(60_000)));
  assertEquals(eligibleForAutoResume(done, NOW, {}).reason, "auto_resume_suppressed");
  // And a row status this sweeper does not own is still refused outright.
  const running = CHECKPOINTED({ status: "running" });
  Object.assign(running.result!, suppressed(ago(60_000)));
  assertEquals(eligibleForAutoResume(running, NOW, {}).reason, "not_ready");
});

Deno.test("A MALFORMED MARKER IS IGNORED, never trusted", () => {
  // `tasks.result` is JSON a previous deploy or a hand edit may have written.
  // A marker that cannot be read must not park a row by accident.
  for (const bad of [null, {}, "yes", { at: "whenever" }, { by: "x" }, []]) {
    const row = CHECKPOINTED();
    (row.result as Record<string, unknown>)[AUTO_RESUME_SUPPRESSED_KEY] = bad;
    assertEquals(eligibleForAutoResume(row, NOW, { hasStartedProviderRun: true }).eligible,
      true, `"${JSON.stringify(bad)}" must not park the row`);
    assertEquals(readAutoResumeSuppression(row.result), null);
  }
});

Deno.test("a well-formed marker reads back with its provenance", () => {
  const at = ago(60_000);
  const m = readAutoResumeSuppression(suppressed(at))!;
  assertEquals(m.at, at);
  assertEquals(m.by, "run-agent:single_generation");
  assert(m.reason.includes("single_generation"));
  // Missing optional fields degrade to a label, never to null — the marker's
  // presence is the instruction; who wrote it is documentation.
  const bare = readAutoResumeSuppression({ [AUTO_RESUME_SUPPRESSED_KEY]: { at } })!;
  assertEquals(bare.by, "unknown");
  assertEquals(bare.reason, "unspecified");
});

// ── THE WIRING ─────────────────────────────────────────────────────────────

const RUN_AGENT_SRC = Deno.readTextFileSync(new URL(
  "../../../supabase/functions/run-agent/index.ts", import.meta.url));
const runAgentCode = RUN_AGENT_SRC.split("\n").filter((l) => {
  const t = l.trim();
  return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
}).join("\n");

Deno.test("RUN-AGENT WRITES THE MARKER when single_generation is honoured", () => {
  assert(new RegExp(`\\[AUTO_RESUME_SUPPRESSED_KEY\\]: \\{`).test(runAgentCode),
    "the marker must be written to the row");
  const block = runAgentCode.slice(runAgentCode.indexOf("if (singleGeneration) {"));
  assert(block.slice(0, 1400).includes("AUTO_RESUME_SUPPRESSED_KEY"),
    "and written inside the single_generation branch, nowhere else");
});

Deno.test("a FAILED marker is reported as loudly as it deserves", () => {
  // A silently failed marker means the sweeper WILL continue the lineage — the
  // exact opposite of what the caller asked for.
  assert(runAgentCode.includes("single_generation marker FAILED"));
  assert(runAgentCode.includes("the sweeper may adopt this task"));
  assert(/auto_resume_suppressed: !markErr/.test(runAgentCode),
    "and the success log must state whether it actually landed");
});

Deno.test("the marker is never written on a normal run", () => {
  // Defaults matter more than the feature: production behaviour is unchanged.
  // Counts the WRITE, not every mention — the import is a reference.
  const writes = runAgentCode.split(/\[AUTO_RESUME_SUPPRESSED_KEY\]: \{/).length - 1;
  assertEquals(writes, 1, "exactly one place may write the marker");
  const before = runAgentCode.indexOf("const singleGenerationRequested");
  const writeAt = runAgentCode.search(/\[AUTO_RESUME_SUPPRESSED_KEY\]: \{/);
  assert(writeAt > before,
    "the only write must sit inside the single_generation branch, after the flag");
});
