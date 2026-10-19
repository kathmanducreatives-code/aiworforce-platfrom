// A MISSION WHOSE FINAL LEASE LAPSED ENDS EVERY RECORD (held migration
// 20261019120000 + leadMissionCancellation.ts `sweepLapsedMissions`).
//
// The claim function ends the queue row; this sweep ends the task, lineage and
// plan with the same reconciliation a release uses. The SQL itself is exercised
// against real Postgres in tests/db-contract/leadMissionExhaustedLease.contract.test.ts.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CANCEL_SWEEP_LIMIT, LEASE_LAPSED_REASON, sweepLapsedMissions,
  type LapsedQueueRow, type LapsedSweepDb,
} from "../../../supabase/functions/_shared/leadMissionCancellation.ts";
import { terminalViolations } from "../../../supabase/functions/_shared/leadMissionTerminal.ts";

const NOW = "2026-10-19T08:00:00.000Z";
interface Row { status: string | null; result?: Record<string, unknown> | null }

/** The rows as a dead fifth claim left them, once the claim ended the queue row. */
function store(queue: LapsedQueueRow[] = [{ id: "q1", task_id: "t1", lineage_id: "t1", plan_id: "p1", reason: "attempts_exhausted" }]) {
  const tasks = new Map<string, Row>([["t1", { status: "running", result: { output: "keep me" } }]]);
  const lineages = new Map<string, Row>([["t1", { status: "active" }]]);
  const plans = new Map<string, Row>([["p1", { status: "running" }]]);
  const reads: string[] = [];
  const writes: Array<{ table: string; id: string; patch: Record<string, unknown> }> = [];
  const notices: Array<[string, string, string]> = [];
  const db: LapsedSweepDb = {
    readTask: (id) => { reads.push(`task:${id}`); return Promise.resolve((tasks.get(id) ?? null) as never); },
    readLineage: (id) => { reads.push(`lineage:${id}`); return Promise.resolve((lineages.get(id) ?? null) as never); },
    readPlan: (id) => { reads.push(`plan:${id}`); return Promise.resolve((plans.get(id) ?? null) as never); },
    writeTask: (id, patch) => { writes.push({ table: "tasks", id, patch }); tasks.set(id, { status: patch.status, result: patch.result }); return Promise.resolve(); },
    writeLineage: (id, patch) => { writes.push({ table: "lead_lineages", id, patch }); lineages.set(id, { status: patch.status }); return Promise.resolve(); },
    writePlan: (id, patch) => { writes.push({ table: "task_plans", id, patch }); plans.set(id, { status: patch.status }); return Promise.resolve(); },
    listLapsed: (limit) => { reads.push(`listLapsed:${limit}`); return Promise.resolve(queue.slice(0, limit)); },
    resolveNotices: (planId, status, reason) => { notices.push([planId, status, reason]); return Promise.resolve(); },
  };
  const rows = () => ({
    task: (tasks.get("t1") ?? null) as { status: string | null; result: Record<string, unknown> | null } | null,
    lineage: (lineages.get("t1") ?? null) as { status: string | null } | null,
    plan: (plans.get("p1") ?? null) as { status: string | null } | null,
  });
  return { db, tasks, lineages, plans, reads, writes, notices, rows };
}

Deno.test("lapsed lease: the sweep ends task, lineage and plan as failed, releases the lease and tells the chat", async () => {
  const s = store();
  assert(terminalViolations("failed", s.rows()).length > 0, "a stranded mission disagrees with its failed queue row");
  const r = await sweepLapsedMissions(s.db, NOW);
  assertEquals([r.scanned, r.reconciled], [1, 1]);
  assertEquals(r.details[0].written, ["task", "lineage", "plan"]);
  assertEquals(r.details[0].remaining, [], "nothing still disagrees");
  assertEquals(terminalViolations("failed", s.rows()), []);

  const task = s.tasks.get("t1")!;
  assertEquals(task.status, "failed");
  const result = task.result as Record<string, unknown>;
  assertEquals(result.terminal_status, "attempts_exhausted");
  assertEquals((result.v2_terminal as Record<string, unknown>).queue_status, "failed");
  assertEquals(result.output, "keep me", "the run's own result is preserved");
  assertEquals((result.auto_continuation as Record<string, unknown>).continuing, false, "nothing re-dispatches it");

  assertEquals(s.lineages.get("t1")!.status, "terminal");
  const lineageWrite = s.writes.find((w) => w.table === "lead_lineages")!.patch;
  assertEquals([lineageWrite.lease_holder, lineageWrite.lease_expires_at], [null, null], "the dead holder's lineage lease is released");
  assertEquals(lineageWrite.terminal_reason, "attempts_exhausted");
  assertEquals(s.plans.get("p1")!.status, "failed");
  assertEquals(s.notices, [["p1", "failed", "attempts_exhausted"]]);
});

Deno.test("lapsed lease: a second sweep writes nothing and announces nothing", async () => {
  const s = store();
  await sweepLapsedMissions(s.db, NOW);
  const [writes, notices] = [s.writes.length, s.notices.length];
  const again = await sweepLapsedMissions(s.db, "2026-10-19T08:01:00.000Z");
  assertEquals([again.scanned, again.reconciled], [1, 0]);
  assertEquals([s.writes.length, s.notices.length], [writes, notices]);
});

Deno.test("lapsed lease: the reason is the one the claim recorded, with a safe default", async () => {
  const slices = store([{ id: "q1", task_id: "t1", lineage_id: null, request: { plan_id: "p1" }, reason: "slices_exhausted" }]);
  await sweepLapsedMissions(slices.db, NOW);
  assertEquals((slices.tasks.get("t1")!.result as Record<string, unknown>).terminal_status, "slices_exhausted");
  assertEquals(slices.lineages.get("t1")!.status, "terminal", "the lineage defaults to the task, as a release does");

  const unnamed = store([{ id: "q1", task_id: "t1", lineage_id: "t1", plan_id: "p1", reason: null }]);
  await sweepLapsedMissions(unnamed.db, NOW);
  assertEquals((unnamed.tasks.get("t1")!.result as Record<string, unknown>).terminal_status, LEASE_LAPSED_REASON);
});

Deno.test("lapsed lease: with nothing marked, nothing is read", async () => {
  const s = store([]);
  const r = await sweepLapsedMissions(s.db, NOW);
  assertEquals([r.scanned, r.reconciled], [0, 0]);
  assertEquals(s.reads, [`listLapsed:${CANCEL_SWEEP_LIMIT}`]);
  assertEquals(s.writes, []);
});

const SRC = Deno.readTextFileSync(new URL("../../../worker/main.ts", import.meta.url));
const MIGRATION = Deno.readTextFileSync(new URL(
  "../../../supabase/migrations-held/20261019120000_lead_mission_v2_exhausted_lease_terminal.sql", import.meta.url));
const ROLLBACK = Deno.readTextFileSync(new URL(
  "../../../supabase/migrations-held/rollback/20261019120000_lead_mission_v2_exhausted_lease_terminal.down.sql", import.meta.url));
const PRIOR = Deno.readTextFileSync(new URL(
  "../../../supabase/migrations-held/20261003120000_lead_mission_v2_continuations_not_retries.sql", import.meta.url));
/** One `create or replace function public.<name>` … `$function$;` block. */
const fn = (sql: string, name: string) => {
  const at = sql.indexOf(`create or replace function public.${name}(`);
  assert(at >= 0, `${name} not defined`);
  return sql.slice(at, sql.indexOf("$function$;", sql.indexOf("as $function$", at) + 13) + 11);
};

Deno.test("the worker lists only rows the claim ended after a lapsed lease, recently and bounded", () => {
  const q = SRC.slice(SRC.indexOf("listLapsed:"), SRC.indexOf("listCancelled:"));
  assert(/\.eq\("status", "failed"\)\.eq\("last_outcome->>lease_lapsed", "true"\)/.test(q),
    "failed AND marked: a mission a worker released as failed is never visited");
  assert(!/"complete"|"cancelled"/.test(q), "no complete or cancelled mission is visited");
  assert(/\.gte\("updated_at", since\)/.test(q) && /24 \* 60 \* 60 \* 1000/.test(q), "bounded to the last day");
  assert(/\.limit\(limit\)/.test(q), "bounded in count");
  const tick = SRC.slice(SRC.indexOf("sweepCancelled: async"));
  assert(tick.indexOf("sweepLapsedMissions(rowsDb") > 0, "the idle tick runs the lapsed sweep with the cancel sweep");
});

Deno.test("the migration is the prior claim plus one step, and the rollback is the prior claim verbatim", () => {
  const prior = fn(PRIOR, "claim_next_lead_mission");
  const next = fn(MIGRATION, "claim_next_lead_mission");
  assertEquals(fn(ROLLBACK, "claim_next_lead_mission"), prior, "rollback restores 20261003120000 byte for byte");
  // Remove the one added step: what is left is the prior function exactly.
  const step = next.slice(next.indexOf("  -- THE LAST LEASE LAPSED"), next.indexOf("  select q.* into v_q"));
  assertEquals(next.replace(step, ""), prior, "nothing else in the claim changed");
  assert(/x\.status = 'running'/.test(step) && /x\.lease_expires_at <= now\(\)/.test(step), "only running rows whose lease lapsed");
  assert(/x\.attempts >= 5 or x\.continuations >= 25/.test(step), "only rows with no retry or slice left");
  assert(/for update skip locked/.test(step), "a row another transaction holds is left for the next claim");
  assert(/status\s+= 'failed'/.test(step) && /'lease_lapsed', true/.test(step), "ended failed and marked");
  assert(!/attempts\s*=/.test(step.replace(/x\.attempts >= 5/, "")), "no attempt is granted or refunded");
  for (const sql of [MIGRATION, ROLLBACK]) {
    assert(/grant execute on function public\.claim_next_lead_mission\(uuid, integer\) to service_role;/.test(sql));
    assert(!/^\s*(begin|commit);/m.test(sql), "applied in a single transaction by the runner, like its siblings");
  }
});

Deno.test("both builders apply the migration after the rest of the queue chain", () => {
  for (const p of ["../../../tests/db-contract/bootstrap.sh", "../../../scripts/test-project/build-test-schema.sh"]) {
    const s = Deno.readTextFileSync(new URL(p, import.meta.url));
    const a = s.indexOf("20261011120000_lead_mission_v2_productive_continuation_no_backoff.sql");
    const b = s.indexOf("20261019120000_lead_mission_v2_exhausted_lease_terminal.sql");
    assert(a > 0 && b > a, `${p}: after 20261011120000`);
  }
});
