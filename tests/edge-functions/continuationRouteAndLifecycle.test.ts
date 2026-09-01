// A CONTINUATION MUST RESUME THE SAME JOB, AND MUST NOT BE ENDED BY A BYSTANDER.
//
// ── THE RUNS THIS EXISTS FOR ───────────────────────────────────────────────
//
// Task a7a9371d (2026-08-31 16:40) and task 7e71d8bc (10:26) died the same way,
// three defects in series:
//
//   D1  `dispatchContinuation` forwarded `tool_input` and `lead_mission` but not
//       `tool_needed`. `resolvePlannedTool` saw no structured signal and
//       answered "generic"; `shouldUseApify`'s text fallback is disabled when
//       `tool_input` is present, so the successor ran the generic LLM path and
//       reported `no_execution_state_observed` with the mission and checkpoint
//       both sitting there unread.
//
//   D2  That generic path then stamped `status: "complete"` unconditionally,
//       over a row its own parent had correctly written as `ready` +
//       `continuation_required`.
//
//   D3  `resume-stalled-leads` selected `status = "ready"`, so the row it had
//       just been locked out of could never be recovered: 22 candidates
//       unexamined, quota 0 of 5, permanently.
//
// ZERO network, ZERO DB, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dispatchContinuation } from "../../supabase/functions/_shared/leadContinuationDispatch.ts";
import {
  eligibleForAutoResume, resumeRequestFor, CLAIMABLE_TERMINAL_STATUS,
  type StalledTaskRow,
} from "../../supabase/functions/_shared/stalledLeadResume.ts";
import {
  resolvePlannedTool, isProviderSourcingTool,
} from "../../supabase/functions/_shared/plannedToolResolver.ts";
import {
  holdsResumableWork, projectStatus, isResumableRowStatus,
} from "../../supabase/functions/_shared/taskStatusContract.ts";
import { RESUME_STATE_VERSION } from "../../supabase/functions/_shared/leadResumeState.ts";

// ---------------------------------------------------------------- D1 --------

/** Capture the body a dispatch would POST, without any network. */
async function dispatchedBody(
  extra: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> = {};
  await dispatchContinuation({
    resumeTaskId: "task-1", workspaceId: "ws-1", userId: "user-1",
    planId: "plan-1", agentSlug: "scout", stepIndex: 0,
    instruction: "Find me 5 B2B SaaS companies in the UK hiring sales roles.",
    toolInput: { lead_mission: { requested_count: 5 } },
    leadMission: { requested_count: 5 },
    continuationIndex: 1,
    toolNeeded: null, executionMode: null,
    ...extra,
  } as never, {
    fetch: ((_url: string, init: { body: string }) => {
      captured = JSON.parse(init.body);
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}") });
    }) as never,
    functionsBaseUrl: "https://example.test/functions/v1",
    serviceRoleKey: "sk_test",
  } as never);
  return captured;
}

Deno.test("D1: the dispatch carries the structured route", async () => {
  const body = await dispatchedBody({
    toolNeeded: "source_with_apify", executionMode: "company_first",
  });
  assertEquals(body.tool_needed, "source_with_apify");
  assertEquals(body.execution_mode, "company_first");
  // And the things that already worked still travel.
  assert(body.lead_mission, "the compiled mission must still be carried");
  assert(body.tool_input, "tool_input must still be carried");
});

Deno.test("D1: a successor of a sourcing parent resolves the sourcing path", async () => {
  const body = await dispatchedBody({
    toolNeeded: "source_with_apify", executionMode: "company_first",
  });
  // THE EXACT RESOLUTION `run-agent` PERFORMS on the received body.
  const resolved = resolvePlannedTool({
    tool_needed: body.tool_needed as string,
    tool_name: (body.tool_input as Record<string, unknown>)?.tool_name as string,
    selected_actor_key:
      (body.tool_input as Record<string, unknown>)?.selected_actor_key as string,
  });
  assertEquals(resolved.tool, "source_with_apify");
  assertEquals(resolved.matched_from, "tool_needed");
  assert(isProviderSourcingTool({ tool_needed: body.tool_needed as string }));
});

Deno.test("D1: without the route the successor would fall to generic", () => {
  // The pre-fix payload, asserted as the defect rather than described as one.
  const resolved = resolvePlannedTool({
    tool_needed: null, tool_name: null, selected_actor_key: null,
  });
  assertEquals(resolved.tool, "generic",
    "this is what produced no_execution_state_observed");
});

Deno.test("D1: a non-sourcing parent does not invent a route", async () => {
  const body = await dispatchedBody({ toolNeeded: null, executionMode: null });
  assertEquals(body.tool_needed, undefined,
    "a continuation must never claim a route its parent did not have");
  assertEquals(body.execution_mode, undefined);
});

// ---------------------------------------------------------------- D2 --------

Deno.test("D2: continuation_required is resumable work", () => {
  assert(holdsResumableWork({ terminal_status: "continuation_required" }));
  assert(holdsResumableWork({ auto_continuation: { continuing: true } }));
});

Deno.test("D2: genuine terminals are NOT resumable work", () => {
  for (const t of ["quota_met", "frontier_exhausted", "cancelled", "cost_ceiling",
    "continuation_ceiling", "no_progress", "provider_failure"]) {
    assertEquals(holdsResumableWork({ terminal_status: t }), false,
      `${t} must stay terminal and must not withhold the complete stamp`);
  }
});

Deno.test("D2: the parent's own projection is unchanged", () => {
  // The guard protects this; it must not alter it.
  const p = projectStatus("continuation_required");
  assertEquals(p.rowStatus, "ready");
  assertEquals(p.taskStatus, "partial");
  // `completed` is the TERMINAL_STATUSES member for a met quota; `quota_met` is
  // `decideAutoContinuation`'s stop reason and a different vocabulary.
  assertEquals(projectStatus("completed", null, { contactReady: 5, requested: 5 })
    .rowStatus, "complete");
  assertEquals(projectStatus("search_exhausted", null, { contactReady: 0, requested: 5 })
    .rowStatus, "complete", "an exhausted search still ends the lifecycle");
});

// ---------------------------------------------------------------- D3 --------

const row = (o: Partial<StalledTaskRow> & { terminal?: string | null }): StalledTaskRow => {
  const { terminal, ...rest } = o;
  const old = new Date(Date.now() - 60 * 60_000).toISOString();
  return {
    id: "task-1", workspace_id: "ws-1", user_id: "user-1", plan_id: "plan-1",
    agent_slug: "scout", step_index: 0, status: "ready",
    updated_at: old, created_at: old,
    continuation_claim_expires_at: null,
    result: {
      ...(terminal === undefined ? { terminal_status: CLAIMABLE_TERMINAL_STATUS }
        : terminal === null ? {} : { terminal_status: terminal }),
      company_first_state: { next_action: "start_round" },
      lead_mission: { original_user_query: "Find me 5 B2B SaaS companies in the UK." },
      executed_sourcing_mode: "company_first",
      capability_execution_state: {
        completed_capabilities: ["general_company_discovery"],
        pending_capabilities: ["company_enrichment"],
        pending_runs: [],
      },
      lead_resume_checkpoint: {
        version: RESUME_STATE_VERSION,
        companies: [{
          company_key: "acme.com", company_name: "Acme",
          identity: "not_started", enrichment: "not_started",
          hiring: "not_started", brain: "not_started", founder: "not_started",
          snapshot: {
            company: { company_name: "Acme", canonical_domain: "acme.com" },
            yc_open_jobs: [], prequalified: null, prequal_key: null,
            shortlisted: true, investigation_state: "pending_investigation",
            enriched: null,
          },
        }],
      },
    },
    ...rest,
  } as StalledTaskRow;
};

Deno.test("D3: a legitimate continuation_required row is recoverable at complete", () => {
  const v = eligibleForAutoResume(row({ status: "complete" }), Date.now(), {});
  assert(v.eligible,
    `a stamped-over checkpoint must be recoverable (got ${v.reason ?? "-"})`);
});

Deno.test("D3: ready is still the normal case", () => {
  assert(eligibleForAutoResume(row({ status: "ready" }), Date.now(), {}).eligible);
});

Deno.test("D3: a genuine terminal is never resurrected", () => {
  for (const t of ["completed", "search_exhausted", "budget_exhausted",
    "provider_failure"]) {
    for (const st of ["complete", "ready"]) {
      const v = eligibleForAutoResume(
        row({ status: st, terminal: t }), Date.now(), {});
      assertEquals(v.eligible, false, `${t} at status=${st} must stay terminal`);
      assertEquals(v.reason, "already_terminal");
    }
  }
});

Deno.test("D3: running and partial still belong to the other sweeper", () => {
  // `tasks_sweep_stuck_runs` owns those and moves a stuck row to `ready` first.
  // Recovering them here would put two sweepers on one subject, so the widening
  // is `complete` only — even though `isResumableRowStatus` counts them legacy.
  for (const st of ["running", "partial", "failed", "skipped"]) {
    const v = eligibleForAutoResume(row({ status: st }), Date.now(), {});
    assertEquals(v.eligible, false, st);
    assertEquals(v.reason, "not_ready", st);
  }
});

Deno.test("D3: a finished generic step is not swept up", () => {
  // `complete` with NO continuation claim is exactly what an ordinary finished
  // step looks like. Absence is enough for `ready`; it must not be for others.
  const v = eligibleForAutoResume(row({ status: "complete", terminal: null }),
    Date.now(), {});
  assertEquals(v.eligible, false);
  assertEquals(v.reason, "not_ready");
});

Deno.test("D3: an unknown row status is still refused", () => {
  assertEquals(isResumableRowStatus("blocked"), false);
  const v = eligibleForAutoResume(row({ status: "blocked" }), Date.now(), {});
  assertEquals(v.eligible, false);
  assertEquals(v.reason, "not_ready");
});

Deno.test("D3: an actively claimed row is left alone — no second generation", () => {
  const v = eligibleForAutoResume(
    row({
      status: "complete",
      continuation_claim_expires_at: new Date(Date.now() + 120_000).toISOString(),
    }), Date.now(), {});
  assertEquals(v.eligible, false, "a live claim must block a second successor");
});

Deno.test("D3: two ticks over a claimed row dispatch at most one successor", () => {
  const now = Date.now();
  const claimed = row({
    status: "complete",
    continuation_claim_expires_at: new Date(now + 120_000).toISOString(),
  });
  assertEquals(eligibleForAutoResume(claimed, now, {}).eligible, false);
  assertEquals(eligibleForAutoResume(claimed, now + 1_000, {}).eligible, false);
});

Deno.test("both dispatchers agree on the lifecycle route", () => {
  // The sweeper states the route from the row's own structured state rather
  // than leaving `run-agent` to sniff the instruction text.
  const req = resumeRequestFor(row({ status: "complete" }));
  assert(req, "a complete-but-continuable row must still build a request");
  assertEquals(req!.toolNeeded, "source_with_apify");
  assertEquals(req!.executionMode, "company_first");
  assertEquals(
    resolvePlannedTool({ tool_needed: req!.toolNeeded }).tool,
    "source_with_apify",
    "the sweeper's successor must resolve the same path as an immediate handoff",
  );
});
