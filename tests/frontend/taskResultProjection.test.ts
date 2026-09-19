// WHY THIS FILE EXISTS.
//
// The project transferred 15 GB against a 5 GB monthly egress allowance. Almost
// none of it was data anyone looked at: `fetchTasksForPlan` used `select('*')`,
// and `tasks.result` is mostly the engine's resume state —
// `lead_resume_checkpoint` alone was 626 kB of the 890 kB the five most recent
// tasks weighed on the wire.
//
// That read runs on mount, on every realtime event, and on a 4-second
// heartbeat. ~800 kB a read is ~700 MB per hour from ONE tab watching ONE
// unfinished plan, and `DepartmentRoom` called it for thirty plans at a time to
// read two scalars per task.
//
// These tests pin the projection: the keys the UI reads must be requested, the
// engine's resume state must not be, and the reassembled `result` must stay
// shaped the way every consuming module already expects.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { projectTaskListRow, TASK_LIST_COLUMNS } from "../../src/lib/taskListProjection.ts";

// The column list and the rebuild are ONE table (`taskListProjection.ts`), so
// these read the shipped values and run the shipped mapper rather than
// grepping source. `tests/frontend/workbenchFetchPath.test.ts` drives the same
// path with a real stored result.
const SOURCE = await Deno.readTextFile(
  new URL("../../src/lib/orchestration.ts", import.meta.url),
);
const COLUMNS = TASK_LIST_COLUMNS;

/** The body of `fetchTasksForPlan`. */
const FETCH_TASKS = (() => {
  const start = SOURCE.indexOf("export async function fetchTasksForPlan");
  assert(start > -1, "fetchTasksForPlan must exist");
  const end = SOURCE.indexOf("export async function fetchTaskResult", start);
  assert(end > -1, "fetchTaskResult must follow it");
  return SOURCE.slice(start, end);
})();

/** Every projected alias set to a marker, as PostgREST would return it. */
const ALL_ALIASES = Object.fromEntries(
  COLUMNS.split(",").filter((c) => c.includes(":result->")).map((c) => [c.split(":")[0], { marker: c }]),
);

Deno.test("1. the task list never asks for every column", () => {
  // The regression itself. `select('*')` on `tasks` is the 15 GB.
  assert(
    !/\.select\(\s*['"]\*['"]\s*\)/.test(FETCH_TASKS),
    "fetchTasksForPlan must not select('*') — tasks.result carries the engine's checkpoint",
  );
  assert(
    FETCH_TASKS.includes("TASK_LIST_COLUMNS"),
    "fetchTasksForPlan must use the explicit projection",
  );
  assert(FETCH_TASKS.includes("projectTaskListRow"), "and rebuild each row with the one mapper");
});

Deno.test("2. the engine's resume state is never shipped to the browser", () => {
  // Nothing in the browser resumes a run, so none of this can ever be read
  // there — and it is the overwhelming majority of the bytes.
  for (
    const key of [
      "lead_resume_checkpoint",
      "evaluation_paths",
      "pool_evaluation_checkpoint",
      "grounded_brain_diagnostics",
      "company_brain_observability",
      "workbench_grounded_explanations",
      "lead_mission",
    ]
  ) {
    assert(
      !COLUMNS.includes(key),
      `${key} is backend-only state and must not be projected`,
    );
  }
});

Deno.test("3. the two heavy blocks are narrowed to the field their reader touches", () => {
  // `hasStoredCompanyRun` reads provider_attempts; `readDiagnosticsFromResult`
  // reads candidate_diagnostics. Requesting the parents would pull back the
  // 269 kB execution state and the full company-first state with them.
  assert(
    COLUMNS.includes("result->capability_execution_state->provider_attempts"),
    "capability_execution_state must be narrowed to provider_attempts",
  );
  assert(
    !/capability_execution_state['",]/.test(COLUMNS),
    "the whole capability_execution_state must never be requested",
  );
  assert(
    COLUMNS.includes("result->company_first_state->candidate_diagnostics"),
    "company_first_state must be narrowed to candidate_diagnostics",
  );
});

Deno.test("4. every result key the UI reads is projected", () => {
  // Each of these is read by a named module; dropping one silently blanks a
  // part of the Workbench rather than failing, so they are pinned here.
  const required: Record<string, string> = {
    "result->task_status": "state.ts taskResultIsPartial",
    "result->terminal_status": "state.ts taskResultIsPartial",
    "result->quota": "state.ts taskQuotaUnmet",
    "result->company_first": "SummaryView, taskCompanyFirst, taskQuotaUnmet",
    "result->workbench_progress": "workbenchProgress.readWorkbenchProgress",
    "result->workbench_evaluation_rows": "evaluationRows.readEvaluationRows",
    "result->workbench_portfolio": "portfolioView.readPortfolio",
    // Canary 9b1b70a2: missing, and every Workbench number fell back to legacy.
    "result->workbench_mission_view": "missionView.readMissionView",
  };
  for (const [path, reader] of Object.entries(required)) {
    assert(COLUMNS.includes(path), `${path} is read by ${reader} and must be projected`);
  }
});

Deno.test("5. the reassembled result keeps the shape its readers expect", () => {
  // The projection returns flat aliases; the components read a nested object.
  const row = projectTaskListRow({ id: "t", status: "complete", ...ALL_ALIASES }) as { result: Record<string, any> };
  for (
    const key of [
      "task_status", "terminal_status", "quota", "company_first",
      "workbench_progress", "workbench_evaluation_rows", "workbench_portfolio", "workbench_mission_view",
    ]
  ) {
    assert(row.result[key]?.marker, `the rebuilt result must carry ${key}`);
  }
  assert(row.result.company_first_state.candidate_diagnostics.marker,
    "candidate_diagnostics must be rebuilt at the path readDiagnosticsFromResult expects");
  assert(row.result.capability_execution_state.provider_attempts.marker,
    "provider_attempts must be rebuilt at the path hasStoredCompanyRun expects");
  assertEquals(Object.keys(row.result.company_first_state), ["candidate_diagnostics"], "narrowed, not the parent");
  assert(!Object.keys(row).some((k) => k.startsWith("r_")), "no alias leaks onto the task");
});

Deno.test("6. a task with no result stays null, not an empty object", () => {
  // `taskResultIsPartial` and `taskQuotaUnmet` both return false for a
  // non-object. Handing them `{}` would make a task that never ran look like
  // one that ran and reported nothing — a different claim entirely.
  const nulls = Object.fromEntries(Object.keys(ALL_ALIASES).map((k) => [k, null]));
  assertEquals(projectTaskListRow({ id: "t", ...nulls }).result, null);
  assertEquals(projectTaskListRow({ id: "t" }).result, null);
});

Deno.test("7. the full result is still reachable on demand", () => {
  // Narrowing a list read is only safe if something can still fetch the whole
  // document when it is genuinely needed — the same contract as
  // `fetchToolCallOutput` for tool call payloads.
  assert(
    SOURCE.includes("export async function fetchTaskResult"),
    "a single-row escape hatch must exist",
  );
  const body = SOURCE.slice(SOURCE.indexOf("export async function fetchTaskResult"));
  assert(body.includes(".select('result')"), "it must read the whole result column");
  assert(body.includes(".eq('id', taskId)"), "for exactly one task");
});

Deno.test("8. the tool-call projection it mirrors is still in place", () => {
  // The same failure, fixed earlier on the other heavy table. If this ever
  // regresses the egress comes straight back, so it is pinned alongside.
  assert(SOURCE.includes("const TOOL_CALL_LIST_COLUMNS"), "tool call projection must remain");
  const start = SOURCE.indexOf("export async function fetchToolCallsForPlan");
  const body = SOURCE.slice(start, SOURCE.indexOf("export async function fetchToolCallOutput"));
  assert(
    !/\.select\(\s*['"]\*['"]\s*\)/.test(body),
    "fetchToolCallsForPlan must not select('*') — output_json reaches 1.4 MB a row",
  );
});
