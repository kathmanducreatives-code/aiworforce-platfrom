// P5 RELEASE GATE — THE CANONICAL DECISION REACHES THE WORKBENCH THROUGH THE
// PATH THE BROWSER ACTUALLY TAKES.
//
// Canary 9b1b70a2 (task 967a739d, commit 383633cd). The backend's canonical view
// said: 1 qualified, 4 pending, 15 ineligible or screened out, 0 not reached.
// The Workbench said: Qualified 1 · In review 0 · Ruled out 16 · Not reached 4,
// with the one qualified lead and a verified FAIL under "Not reached — Not
// checked yet". Every reader test passed, because each was handed the full
// stored result. The browser never is: `fetchTasksForPlan` projects named keys
// through `TASK_LIST_COLUMNS`, and `workbench_mission_view` was not one of them.
//
// These tests take the REAL stored result of that run, apply the production
// column list the way PostgREST does, rebuild it with the production mapper,
// and read it with the production readers. No mocked result object.
//
// PURE.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  projectTaskListRow, TASK_LIST_COLUMNS, TASK_RESULT_FIELDS,
} from "../../src/lib/taskListProjection.ts";
import { canonicalSummary, readMissionView } from "../../src/lib/workbench/missionView.ts";
import { funnelCaption, readEvaluationRows, workbenchFunnelCounts } from "../../src/lib/workbench/evaluationRows.ts";
import { resultTabCounts } from "../../src/lib/workbench/leadTabs.ts";
import { readWorkbenchProgress } from "../../src/lib/workbench/workbenchProgress.ts";
import { readPortfolio } from "../../src/lib/workbench/portfolioView.ts";
import { buildRunSummary } from "../../src/lib/workbench/runSummary.ts";
import { taskQuotaUnmet, taskResultIsPartial } from "../../src/lib/chat/state.ts";

const FIXTURE = JSON.parse(Deno.readTextFileSync(
  new URL("../fixtures/lead-v2/canary-9b1b70a2-task-result.json", import.meta.url),
)) as { row: Record<string, unknown>; result: Record<string, unknown> };

/** What PostgREST returns for a `select`: plain columns, and `alias:result->a->b` JSON paths. */
function postgrestSelect(columns: string, row: Record<string, unknown>, result: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns.split(",")) {
    const m = /^(\w+):result->(.+)$/.exec(col);
    if (!m) { out[col] = row[col] ?? null; continue; }
    let v: unknown = result;
    for (const key of m[2].split("->")) v = v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
    out[m[1]] = v ?? null;
  }
  return out;
}

/** The task as the browser holds it after `fetchTasksForPlan`. */
function fetched(fields = TASK_LIST_COLUMNS) {
  return projectTaskListRow(postgrestSelect(fields, FIXTURE.row, FIXTURE.result)) as { result: Record<string, unknown> | null };
}

/** The four tab counts the Workbench renders. Qualified is the persisted lead rows. */
function tabs(result: unknown) {
  const persisted = Number((FIXTURE.result.lead_library_persistence as { persisted: number }).persisted);
  const t = resultTabCounts({ qualifiedLeads: persisted, inReviewLeads: 0, evaluationRows: readEvaluationRows(result) as never });
  return { qualified: t.qualified, inReview: t.inReview, rejected: t.rejected, notReached: t.notReached };
}

Deno.test("the canonical view survives the production fetch projection", () => {
  const r = fetched().result!;
  assert(readMissionView(r), "workbench_mission_view reaches the browser");
  assertEquals(readMissionView(r), readMissionView(FIXTURE.result), "unchanged by the projection");
  assertFalse("lead_resume_checkpoint" in r, "the engine's resume state is still never shipped");
  assert(TASK_RESULT_FIELDS.some((f) => f.path.join(".") === "workbench_mission_view"));
});

Deno.test("canary 9b1b70a2: the Workbench tabs equal the backend's canonical counts", () => {
  const c = canonicalSummary(readMissionView(FIXTURE.result)!.counts);
  const expected = {
    qualified: c.qualified,
    inReview: c.pending + (readMissionView(FIXTURE.result)!.counts.identity_unresolved),
    rejected: c.ineligible + c.screenedOut,
    notReached: readMissionView(FIXTURE.result)!.counts.investigating,
  };
  assertEquals(expected, { qualified: 1, inReview: 4, rejected: 15, notReached: 0 }, "what the backend decided");
  assertEquals(tabs(fetched().result), expected, "what the browser shows, through the real fetch path");
});

Deno.test("the old projection reproduces the canary's wrong tabs — the test can tell", () => {
  const old = TASK_LIST_COLUMNS.split(",").filter((c) => !c.includes("workbench_mission_view")).join(",");
  assertEquals(tabs(fetched(old).result), { qualified: 1, inReview: 0, rejected: 16, notReached: 4 });
});

Deno.test("the header and run summary read the canonical decision, with nothing disagreeing", () => {
  const r = fetched().result!;
  const progress = readWorkbenchProgress(r)!;
  assertEquals([progress.accounts_found, progress.evaluated, progress.qualified_companies], [20, 6, 1]);
  const rows = readEvaluationRows(r);
  assertEquals(funnelCaption(workbenchFunnelCounts(rows, 1)),
    "20 discovered · 14 triaged out · 0 investigating · 0 identity unresolved · 6 verified · 1 qualified");
  const t = resultTabCounts({ qualifiedLeads: 1, inReviewLeads: 0, evaluationRows: rows as never });
  const summary = buildRunSummary({
    qualifiedLeads: 1, leadsInReview: 0, quota: null, portfolio: readPortfolio(r), progress,
    rows: { total: 1, qualified: 0, pending: 0 },
    canonical: { qualifiedCompanies: progress.qualified_companies, reviewed: progress.evaluated, pending: t.inReview },
  });
  assertEquals([summary.qualifiedCompanies.value, summary.reviewed.value, summary.pending.value, summary.notAFit.value], [1, 6, 4, 1]);
  assertFalse(summary.hasDisagreement, "the legacy portfolio (qualified 0) no longer outvotes the canonical decision");
});

Deno.test("legacy runs (no view) keep exactly their old projection and tabs", () => {
  const { workbench_mission_view: _v, ...legacyResult } = FIXTURE.result;
  const r = projectTaskListRow(postgrestSelect(TASK_LIST_COLUMNS, FIXTURE.row, legacyResult)) as { result: Record<string, unknown> };
  assertEquals(readMissionView(r.result), null);
  assertEquals(tabs(r.result), { qualified: 1, inReview: 0, rejected: 16, notReached: 4 }, "the legacy rows, as before");
});

Deno.test("a task with no result stays null; nested fields rebuild only when present", () => {
  const none = projectTaskListRow(postgrestSelect(TASK_LIST_COLUMNS, FIXTURE.row, null));
  assertEquals(none.result, null);
  const r = fetched().result!;
  assert((r.company_first_state as Record<string, unknown>).candidate_diagnostics !== undefined);
  assertFalse("terminal_status" in (r.company_first_state as Record<string, unknown>), "narrowed to the one field");
});

Deno.test("canary 9b1b70a2 AS STORED is the partial/quota-short run the user saw — the reason for the terminal fix", () => {
  // The stored result predates the fix: `partial`, contact quota 0 of 1. The
  // terminal tests (edge suite) prove the new outcome; this pins what was wrong.
  const r = fetched().result!;
  assert(taskResultIsPartial(r));
  assert(taskQuotaUnmet(r));
});

Deno.test("a satisfied V2 result, as run-agent now writes it, reads as satisfied in the browser", async () => {
  const { settleV2Outcome } = await import("../../supabase/functions/_shared/leadAutoContinuation.ts");
  const { projectStatus } = await import("../../supabase/functions/_shared/taskStatusContract.ts");
  const { deriveWorkflowUiState, isCheckpointedPartial } = await import("../../src/lib/chat/state.ts");
  const o = settleV2Outcome({
    continuing: false, stopReason: "quota_met", legacyStatus: "round_limit_reached",
    legacyQuota: { eligible_leads: 0, requested_leads: 1 }, canonicalQualified: 1, requestedCount: 1,
    companyIsDeliverable: true,
  });
  const s = projectStatus(o.terminal, null, o.quota);
  // The keys run-agent writes on this path (see the edge test that pins the wiring).
  const stored = {
    ...FIXTURE.result,
    task_status: s.taskStatus, terminal_status: s.terminalStatus,
    company_first: {
      ...(FIXTURE.result.company_first as Record<string, unknown>), status: o.terminal,
      quota: { quota_policy: "contact_only", eligible_leads: o.delivered, requested_leads: o.requested, remaining_leads: 0 },
    },
  };
  const task = { ...FIXTURE.row, status: s.rowStatus, ...projectTaskListRow(postgrestSelect(TASK_LIST_COLUMNS, { ...FIXTURE.row, status: s.rowStatus }, stored)) } as never;
  const r = (task as { result: unknown }).result;
  assertFalse(taskResultIsPartial(r), "not partial");
  assertFalse(taskQuotaUnmet(r), "1 of 1 delivered");
  const plan = { status: "complete", created_at: "2026-09-19T07:04:22Z", completed_at: "2026-09-19T07:09:01Z" };
  assertFalse(isCheckpointedPartial({ plan, tasks: [task] }), "no 'paused at a checkpoint'");
  assertEquals(deriveWorkflowUiState({ plan, tasks: [task], approvals: [] }), "complete");
});
