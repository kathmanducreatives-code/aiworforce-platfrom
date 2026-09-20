// EGRESS — A STATUS CHECK MAY NOT CARRY THE ENGINE'S STATE.
//
// Billing cycle to 2026-09-20: 27.39 GB of PostgREST egress against a 5 GB
// allowance, ~5.57 GB on 18 Sep alone and essentially all of it database
// responses. The cause was one shape repeated in three places — a poll that
// needs a handful of short strings and selects `tasks.result`, which carries
// the engine's resume state at 150-500 kB a row:
//
//   worker cancelled-mission sweep   every 5s, ≤5 rows, full result each
//   resume-stalled-leads cron        every 3m, ≤50 rows, full result each
//   browser plan heartbeat           every 4s per component, hidden tabs too
//
// These tests fail if any of them comes back. They read the SOURCE, because
// what matters is the column list a periodic caller sends, and they pin the
// behaviour that keeps the decisions identical: the projection decides only
// what it can decide, and the full result is still read wherever it is written.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  reconcileTerminalRows, sweepCancelledMissions, type CancelSweepDb,
} from "../../../supabase/functions/_shared/leadMissionCancellation.ts";
import {
  eligibleForAutoResume, resumeScanSkip, STALLED_SCAN_COLUMNS,
  AUTO_RESUME_SUPPRESSED_KEY, type StalledTaskRow,
} from "../../../supabase/functions/_shared/stalledLeadResume.ts";
import { DEFAULT_WORKER_CONFIG } from "../../../supabase/functions/_shared/leadMissionWorkerCore.ts";

const src = (p: string) => Deno.readTextFileSync(new URL(`../../../${p}`, import.meta.url));
const NOW = "2026-09-20T12:00:00.000Z";

// ── the source guards ───────────────────────────────────────────────────────

Deno.test("GUARD: no periodic caller selects the whole tasks.result", () => {
  const worker = src("worker/main.ts");
  // The sweep and the release outcome read projected keys…
  assert(worker.includes("const TASK_TERMINAL_COLUMNS ="), "the projection must exist");
  assert(worker.includes(".select(TASK_TERMINAL_COLUMNS)"), "the periodic reads use it");
  // …and the ONE remaining full read is the merge path, which rewrites `result`.
  const full = worker.split('.select("status, result")').length - 1;
  assertEquals(full, 1, "exactly one full-result read: the write/merge path");
  assert(/readTask: async \(taskId\) => \{[\s\S]{0,200}\.select\("status, result"\)/.test(worker),
    "and it is `readTask`, the reader `reconcileTerminalRows` uses only when it must write");

  const cron = src("supabase/functions/resume-stalled-leads/index.ts");
  assert(cron.includes(".select(STALLED_SCAN_COLUMNS)"), "the 3-minute scan is projected");
  assertFalse(/\.select\([^)]*continuation_claim_expires_at, result"/.test(cron),
    "the broad scan must not carry `result`");
  assertFalse(STALLED_SCAN_COLUMNS.includes(" result,") || STALLED_SCAN_COLUMNS.trim().endsWith("result"),
    "the scan column list names result KEYS, never the column");

  const orchestration = src("src/lib/orchestration.ts");
  assert(orchestration.includes(".select(TASK_LIST_COLUMNS)"), "the task list is projected");
  assertFalse(/from\('tasks' as any\)\.select\('\*'\)/.test(orchestration), "and never select('*')");
});

Deno.test("GUARD: the browser has ONE polling loop per plan, and it is quiet while hidden", () => {
  const hook = src("src/hooks/usePlanDetail.ts");
  assertFalse(/setInterval\(/.test(hook.replace(/setInterval: \(fn, ms\)[^,]*/, "")),
    "the hook owns no interval of its own — the shared store does");
  assert(hook.includes("planStores.acquire("), "every consumer acquires the shared store");
  assert(hook.includes("planStores.release("), "and releases it");

  const store = src("src/lib/chat/planStore.ts");
  assert(/if \(io\.isHidden\(\)\) return;/.test(store), "the heartbeat returns early on a hidden tab");
  assert(store.includes("io.subscribe(planId, load)"), "realtime remains the primary path");
});

Deno.test("GUARD: the cancelled-mission sweep is a safety net, not a 5-second poll", () => {
  assertEquals(DEFAULT_WORKER_CONFIG.cancelSweepIntervalMs, 60_000);
  assert(DEFAULT_WORKER_CONFIG.cancelSweepIntervalMs >= 12 * DEFAULT_WORKER_CONFIG.idlePollMs,
    "the sweep must be far rarer than the claim loop");
  const core = src("supabase/functions/_shared/leadMissionWorkerCore.ts");
  assert(core.includes("now() - lastSweptAt >= sweepEvery"), "the cadence is enforced in the loop");
});

// ── the behaviour that keeps the decisions identical ────────────────────────

interface Row { status: string | null; result: Record<string, unknown> | null }

function sweepDb(task: Row, over: Partial<CancelSweepDb> = {}) {
  const reads = { projected: 0, full: 0 };
  const writes: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const db: CancelSweepDb = {
    listCancelled: () => Promise.resolve([{ id: "q1", task_id: "t1", lineage_id: "t1", plan_id: "p1" }]),
    readTaskTerminalFields: (_id) => {
      reads.projected++;
      const r = task.result ?? {};
      const projected: Record<string, unknown> = {};
      // Exactly what `TASK_TERMINAL_COLUMNS` brings back.
      for (const k of ["terminal_status", "task_status"]) if (r[k] != null) projected[k] = r[k];
      return Promise.resolve({ status: task.status, result: projected });
    },
    readTask: (_id) => { reads.full++; return Promise.resolve(task); },
    readLineage: () => Promise.resolve({ status: "terminal" }),
    readPlan: () => Promise.resolve({ status: "failed" }),
    writeTask: (_id, patch) => { writes.push({ table: "task", patch }); return Promise.resolve(); },
    writeLineage: (_id, patch) => { writes.push({ table: "lineage", patch }); return Promise.resolve(); },
    writePlan: (_id, patch) => { writes.push({ table: "plan", patch }); return Promise.resolve(); },
    ...over,
  };
  return { db, reads, writes };
}

/** A settled cancelled mission: every row already agrees. */
const SETTLED: Row = { status: "failed", result: { terminal_status: "cancelled", task_status: "failed", lead_resume_checkpoint: { huge: "x".repeat(500) } } };
/** One that still says it can continue — the sweep must fix it. */
const STALE: Row = { status: "ready", result: { terminal_status: "continuation_required", lead_resume_checkpoint: { huge: "x".repeat(500) }, company_first: { status: "partial" } } };

Deno.test("SWEEP: a settled mission is decided from the projection — the result is never read", async () => {
  const { db, reads, writes } = sweepDb(SETTLED);
  const r = await reconcileTerminalRows(db, "cancelled", "cancelled", { taskId: "t1", lineageId: "t1", planId: "p1" }, NOW);
  assertEquals([r.violations, r.written], [[], []]);
  assertEquals([reads.projected, reads.full], [1, 0], "no full result for a row with nothing to fix");
  assertEquals(writes, []);
});

Deno.test("SWEEP: a row that must be written reads the full result, and writes what it always wrote", async () => {
  const projected = sweepDb(STALE);
  const r1 = await reconcileTerminalRows(projected.db, "cancelled", "cancelled", { taskId: "t1", lineageId: "t1", planId: "p1" }, NOW);
  assertEquals(projected.reads.full, 1, "the merge path needs the whole result");

  // The same row through a db with NO projection (the pre-fix path).
  const legacy = sweepDb(STALE);
  delete (legacy.db as { readTaskTerminalFields?: unknown }).readTaskTerminalFields;
  const r2 = await reconcileTerminalRows(legacy.db, "cancelled", "cancelled", { taskId: "t1", lineageId: "t1", planId: "p1" }, NOW);

  assertEquals(r1.violations, r2.violations, "same violations");
  assertEquals(r1.written, r2.written, "same rows written");
  assertEquals(projected.writes, legacy.writes, "byte-for-byte the same patches");
  // And the checkpoint it merged around survives untouched.
  const taskWrite = projected.writes.find((w) => w.table === "task")!;
  assertEquals((taskWrite.patch.result as Record<string, unknown>).lead_resume_checkpoint,
    (STALE.result as Record<string, unknown>).lead_resume_checkpoint);
});

Deno.test("SWEEP: the queue scan reads the plan id, not the whole request", async () => {
  const { db, writes } = sweepDb(SETTLED);
  const out = await sweepCancelledMissions(db, NOW, 5);
  assertEquals([out.scanned, out.reconciled], [1, 0]);
  assertEquals(writes, []);
  // A row that carries `request` instead (an older shape) still resolves its plan.
  const legacy = sweepDb(STALE, {
    listCancelled: () => Promise.resolve([{ id: "q1", task_id: "t1", lineage_id: "t1", request: { plan_id: "p1" } }]),
  });
  const out2 = await sweepCancelledMissions(legacy.db, NOW, 5);
  assertEquals(out2.reconciled, 1, "the plan named in `request` is still resolved and reconciled");
  assert(legacy.writes.some((w) => w.table === "task"), "the stale task is still fixed");
});

// ── the cron's cheap skip says exactly what the full decision would say ─────

const scanRow = (over: Record<string, unknown>) => ({
  id: "t1", workspace_id: "w", user_id: "u", plan_id: "p1", agent_slug: "scout", step_index: 0,
  status: "ready", updated_at: NOW, created_at: NOW, continuation_claim_expires_at: null, ...over,
});
const fullRow = (result: Record<string, unknown>, status = "ready"): StalledTaskRow =>
  scanRow({ status, result }) as unknown as StalledTaskRow;

Deno.test("CRON: the projected skip matches the full decision, reason for reason", () => {
  const now = Date.parse(NOW);
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["already terminal", { terminal_status: "quota_met" }, "already_terminal"],
    ["suppressed", { [AUTO_RESUME_SUPPRESSED_KEY]: { at: NOW, by: "operator", reason: "test" } }, "auto_resume_suppressed"],
  ];
  for (const [label, result, reason] of cases) {
    const cheap = resumeScanSkip(scanRow({
      r_terminal_status: result.terminal_status,
      r_suppressed: result[AUTO_RESUME_SUPPRESSED_KEY],
    }) as never);
    assertEquals(cheap, reason, label);
    // …and the full function, given the whole result, says the same.
    const full = eligibleForAutoResume(fullRow(result), now, {});
    assertEquals(full.reason, reason, `${label}: full decision`);
    assertEquals(full.disposition, "skip", `${label}: a skip writes nothing`);
  }
  // A row this cannot decide is NOT skipped: it gets its result read.
  assertEquals(resumeScanSkip(scanRow({ r_terminal_status: "continuation_required" }) as never), null);
  assertEquals(resumeScanSkip(scanRow({}) as never), null, "an absent terminal status is undecided, not terminal");
  assertEquals(resumeScanSkip(scanRow({ status: "running" }) as never), "not_ready");
});

Deno.test("CRON: eligibility itself is untouched — a resumable row still resumes", () => {
  const now = Date.parse(NOW);
  const resumable = fullRow({
    terminal_status: "continuation_required",
    company_first_state: { version: 1 },
    lead_mission: { version: "lead-mission-v1" },
    auto_continuation: { continuing: true },
  });
  // Stale enough to be swept at all (the sweeper only sees quiet rows).
  const v = eligibleForAutoResume({ ...resumable, updated_at: new Date(now - 20 * 60_000).toISOString() }, now, {});
  assertEquals([v.eligible, v.disposition, v.evidence], [true, "resume", "continuation_intended"]);
  // …and while it is still fresh it is skipped, exactly as before.
  assertEquals(eligibleForAutoResume(resumable, now, {}).reason, "too_fresh");
  assertEquals(resumeScanSkip(scanRow({ r_terminal_status: "continuation_required" }) as never), null,
    "and the scan does not skip it");
});
