// THE PROGRESS WAS WRITTEN. NOTHING COULD READ IT.
//
// On TEST task 41342269-7664-4d23-960b-1e42ab0c25ee the capability engine wrote
// `workbench_progress { accounts_found: 25, evaluated: 25 }` to `tasks.result`,
// and the Workbench displayed "Accounts found: 0".
//
// `ChatView` auto-opened the panel from the message metadata and passed only
// `planId` and `conversationId`. With `taskId: null`, `useWorkbenchData` could
// not find the task row, so the progress reader was handed `null` — and a
// missing task looked exactly like a run that had found nothing.
//
// Second defect in the same data: that run finished holding seven pending
// capabilities, and the last published snapshot said `in_progress: true`. A
// finished workflow would have said "Sourcing in progress" forever.
//
// Pure and structural — no DOM, no network, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  progressLines, progressRowsAreActionable, readWorkbenchProgress, runActivity,
  type WorkbenchProgress,
} from "../../src/lib/workbench/workbenchProgress.ts";
import { workbenchQueryKey } from "../../src/lib/workbench/workbenchSession.ts";

const TASK = "41342269-7664-4d23-960b-1e42ab0c25ee";
const PLAN = "d64fad1a-585e-44ce-84ee-176e408393b4";
const CONV = "d10afbdb-3b01-4d6f-9444-d448a2371ef9";

/** The snapshot the engine actually persisted for that task. */
const REAL_PROGRESS = {
  stage: "decision_makers_verified",
  accounts_found: 25, evaluated: 25, eligible_opportunities: 0,
  exclusion_reasons: { insufficient_commercial: 25 },
  identity_resolved: 0, identity_unresolved: 0, companies_enriched: 0,
  hiring_verified: 0, qualified_companies: 0, decision_makers_verified: 0,
  open_jobs_evaluated: 0, shortlisted: 0,
  in_progress: true, awaiting_external_run: false,
};

// ═══════════ the auto-open path carries the current task ══

Deno.test("auto-opened Workbench carries the current taskId", async () => {
  const src = await Deno.readTextFile(
    new URL("../../src/components/chat/workspace/ChatView.tsx", import.meta.url));
  assert(src.includes("taskId: (meta?.task_id as string | undefined) ?? null"),
    "the auto-open path must pass the task id from the panel message metadata");
  // planId and conversationId were already there; all three must be.
  assert(src.includes("planId: panel.plan_id"));
  assert(src.includes("conversationId: m.conversation_id ?? conversationId"));
});

Deno.test("the backend writes the task id the frontend reads", async () => {
  const src = await Deno.readTextFile(
    new URL("../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(src.includes("task_id: summary.taskId ?? null"),
    "without this, meta.task_id is absent and the frontend has nothing to read");
  assert(src.includes("taskId: task.id,"), "the call site must supply it");
});

// ═══════════ progress is readable, and scoped ══

Deno.test("progress for the current task is readable", () => {
  const p = readWorkbenchProgress({ workbench_progress: REAL_PROGRESS });
  assert(p, "the snapshot must parse");
  assertEquals(p!.accounts_found, 25);
  assertEquals(p!.evaluated, 25);
  assertEquals(p!.qualified_companies, 0);
});

Deno.test("a missing task must not silently read as zero", () => {
  // The exact production situation: task row absent because taskId was null.
  assertEquals(readWorkbenchProgress(null), null,
    "null means UNKNOWN, not zero — the caller must not render 0 from it");
  assertEquals(readWorkbenchProgress({}), null);
  assertEquals(readWorkbenchProgress({ workbench_progress: {} }), null,
    "a snapshot with no counts is not a snapshot");

  // And a genuine zero is distinguishable from an absent one.
  const real = readWorkbenchProgress({ workbench_progress: { ...REAL_PROGRESS, accounts_found: 0 } });
  assert(real !== null, "a measured zero DOES parse");
  assertEquals(real!.accounts_found, 0);
});

Deno.test("another conversation's task cannot supply this panel's progress", () => {
  const mine = workbenchQueryKey({ workspaceId: "ws", conversationId: CONV, taskId: TASK, planId: PLAN });
  const theirs = workbenchQueryKey({ workspaceId: "ws", conversationId: "conv-other", taskId: "task-other", planId: "plan-other" });
  assertFalse(mine.join("|") === theirs.join("|"));

  // Same plan, different task is still a different Workbench identity, so a
  // stale task's progress cannot be served for the current one.
  const sameplanOtherTask = workbenchQueryKey({ workspaceId: "ws", conversationId: CONV, taskId: "task-old", planId: PLAN });
  assertFalse(mine.join("|") === sameplanOtherTask.join("|"));
});

Deno.test("the panel remounts when task ownership changes", async () => {
  const panel = await Deno.readTextFile(
    new URL("../../src/components/chat/workspace/workbench/WorkbenchPanel.tsx", import.meta.url));
  assert(panel.includes("taskId: selectedOutput?.taskId ?? null"),
    "the remount key must include the task");
  assert(panel.includes("key={workbenchKey}"));
  assert(panel.includes("readWorkbenchProgress("),
    "the panel must read progress off the resolved task");
});

// ═══════════ a finished run is not a running one ══

Deno.test("pending capabilities are NOT activity once the run has ended", () => {
  // As published from inside the run.
  assertEquals(runActivity(REAL_PROGRESS as WorkbenchProgress), "running");

  // As corrected when the invocation returns — seven capabilities still pending,
  // and the workflow is nonetheless finished.
  const finished = { ...REAL_PROGRESS, in_progress: false } as WorkbenchProgress;
  assertEquals(runActivity(finished), "finished");
  assert(progressRowsAreActionable(finished));

  // A billed run still in flight is a THIRD state: not running here, not done.
  const awaiting = { ...REAL_PROGRESS, in_progress: false, awaiting_external_run: true } as WorkbenchProgress;
  assertEquals(runActivity(awaiting), "awaiting_provider");
  assertFalse(progressRowsAreActionable(awaiting),
    "a resumable run's rows are not actionable");
});

Deno.test("the engine publishes in_progress from inside the run and the caller corrects it", async () => {
  const engine = await Deno.readTextFile(
    new URL("../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
  assertFalse(engine.includes("in_progress: state.pending_capabilities.length > 0"),
    "deriving activity from pending capabilities is the defect");
  assert(engine.includes("export function finalizedProgress("),
    "one place decides that the run has stopped");

  const runAgent = await Deno.readTextFile(
    new URL("../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(runAgent.includes("finalizedProgress(capabilityRun.state)"),
    "the final snapshot must be written when the invocation ends");
});

// ═══════════ the counters say what they measure ══

Deno.test("unreached stages render as unknown, never as a measured zero", () => {
  const early = readWorkbenchProgress({
    workbench_progress: { ...REAL_PROGRESS, stage: "accounts_found" },
  })!;
  const byLabel = Object.fromEntries(progressLines(early).map((l) => [l.label, l]));
  assert(byLabel["Accounts found"].reached, "discovery has run");
  assertFalse(byLabel["Evaluated"].reached, "prequalification has not");
  assertFalse(byLabel["Qualified companies"].reached,
    "showing 0 qualified before the Brain runs is a claim about the run");

  const late = readWorkbenchProgress({ workbench_progress: REAL_PROGRESS })!;
  const lateByLabel = Object.fromEntries(progressLines(late).map((l) => [l.label, l]));
  assert(lateByLabel["Qualified companies"].reached);
  assertEquals(lateByLabel["Qualified companies"].value, 0, "a MEASURED zero");
  assert(lateByLabel["Open roles read"] !== undefined,
    "embedded YC roles are what this path actually reads");
});

Deno.test("the pilot summary reports capability counts, not the legacy jobs counter", async () => {
  const src = await Deno.readTextFile(
    new URL("../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(src.includes("embedded open ${m.open_jobs_evaluated === 1 ? \"role\" : \"roles\"}") ||
    src.includes("embedded open `"),
    "the message must describe what this path measured");
  assert(src.includes("...(m ? { mission_counts: m } : { raw_jobs_reviewed: summary.rawJobs })"),
    "the legacy rawJobs counter must not be emitted for a capability-engine run");
});
