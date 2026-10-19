// A MISSION WHOSE FINAL LEASE LAPSED IS ENDED, NOT STRANDED — against real
// Postgres + PostgREST (held migration 20261019120000).
//
// The first test is Codex's A7 review characterization ("KNOWN DEFECT: a hard
// crash on claim five strands the queue and task running",
// tests/db-contract/discoveryReliability.contract.test.ts on #106), with its
// expectation inverted: the same five claims and lapsed leases, through the
// real RPC, now end the mission instead of stranding it.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sweepLapsedMissions, type LapsedSweepDb } from "../../supabase/functions/_shared/leadMissionCancellation.ts";
import { seedLineage, seedTask, seedWorkspace, serviceClient, sql, uuid } from "./lib/harness.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };

// ROW HYGIENE. This database is shared by every contract file, and some of them
// (offlineSmokeProgress) claim "the next mission" and assert it is their own.
// A row left `running` here becomes claimable once its 60 s lease lapses, so
// every queue row a test creates is ended when the test finishes, pass or fail.
const created: string[] = [];
async function endOwnRows() {
  const ids = created.splice(0);
  if (ids.length) {
    await sql`update public.lead_mission_queue set status = 'complete'
                where id = any(${ids}) and status in ('queued', 'running', 'resumable')`;
  }
}
const test = (name: string, fn: () => Promise<void>) =>
  Deno.test(name, opts, async () => { try { await fn(); } finally { await endOwnRows(); } });
const WORKER = await Deno.readTextFile(new URL("../../worker/main.ts", import.meta.url));

/** A bound V2 mission: workspace, plan, live lineage, running task and its queue row. */
async function mission(over: { attempts?: number; continuations?: number } = {}) {
  const ws = await seedWorkspace();
  const user = uuid(), plan = uuid();
  await sql`insert into auth.users (id, email) values (${user}, ${"lapsed-" + user + "@example.invalid"})`;
  await sql`insert into public.task_plans (id, workspace_id, user_id, user_instruction, status) values (${plan}, ${ws}, ${user}, 'lapsed lease', 'running')`;
  const lineage = await seedLineage(ws, { status: "active" });
  const task = await seedTask(ws, { lineage_id: lineage, status: "running" });
  const queueId = uuid();
  created.push(queueId);
  await sql`insert into public.lead_mission_queue (id, workspace_id, request, status, attempts, continuations, task_id, lineage_id)
            values (${queueId}, ${ws}, ${sql.json({ plan_id: plan })}, 'queued', ${over.attempts ?? 0}, ${over.continuations ?? 0}, ${task}, ${lineage})`;
  // Only this test's row is claimable.
  await sql`update public.lead_mission_queue set status = 'complete' where id <> ${queueId} and status in ('queued','resumable','running')`;
  return { ws, plan, lineage, task, queueId };
}
const claim = async (worker = uuid()) => {
  const db = await serviceClient();
  const { data, error } = await db.rpc("claim_next_lead_mission", { p_worker_id: worker, p_lease_seconds: 60 });
  assertEquals(error, null);
  return { worker, row: (Array.isArray(data) ? data[0] : data) as Record<string, unknown> };
};
const lapse = (queueId: string) => sql`update public.lead_mission_queue set lease_expires_at = now() - interval '1 second' where id = ${queueId}`;
const queueRow = async (id: string) =>
  (await sql`select status, attempts, continuations, claimed_by, lease_expires_at, last_outcome from public.lead_mission_queue where id = ${id}`)[0];

test("REGRESSION (was KNOWN DEFECT): a hard crash on claim five ends the mission failed, granting nothing", async () => {
  const m = await mission();
  let last = "";
  for (let n = 1; n <= 5; n++) {
    const c = await claim();
    assertEquals([c.row.claimed, c.row.queue_id, c.row.attempts], [true, m.queueId, n]);
    last = c.worker;
    await lapse(m.queueId);
  }
  await sql`update public.tasks set updated_at = now() - interval '10 minutes' where id = ${m.task}`;

  const sixth = await claim();
  assertEquals(sixth.row.claimed, false, "no sixth attempt is granted");
  const q = await queueRow(m.queueId);
  assertEquals([q.status, q.attempts, q.claimed_by, q.lease_expires_at], ["failed", 5, null, null],
    "ended, visibly; the attempt count is not refunded");
  assertEquals([q.last_outcome.reason, q.last_outcome.lease_lapsed, q.last_outcome.lapsed_claimed_by, q.last_outcome.ended_by],
    ["attempts_exhausted", true, last, "claim_next_lead_mission"]);

  // The stale holder, if it was only partitioned, now stops: its heartbeat and release are refused.
  const db = await serviceClient();
  const hb = await db.rpc("heartbeat_lead_mission", { p_queue_id: m.queueId, p_worker_id: last, p_lease_seconds: 60 });
  assertEquals(hb.error, null);
  const hbRow = (Array.isArray(hb.data) ? hb.data[0] : hb.data) as Record<string, unknown>;
  assertEquals(hbRow.ok, false, `the stale holder's heartbeat is refused: ${JSON.stringify(hbRow)}`);
  const rel = await db.rpc("release_lead_mission", { p_queue_id: m.queueId, p_worker_id: last, p_status: "complete", p_outcome: {} });
  assertEquals((Array.isArray(rel.data) ? rel.data[0] : rel.data).released, false, "a stale release cannot overwrite the end");
  assertEquals((await queueRow(m.queueId)).status, "failed");
  // Never claimed again.
  assertEquals((await claim()).row.claimed, false);
});

test("lapsed lease: the worker's own sweep query finds the row, and the sweep ends task, lineage and plan", async () => {
  const m = await mission({ attempts: 4 });
  await claim();
  await lapse(m.queueId);
  await claim(); // ends it
  const db = await serviceClient();
  // The worker's listLapsed query, verbatim from worker/main.ts.
  const select = "id, task_id, lineage_id, plan_id:request->>plan_id, reason:last_outcome->>reason";
  assert(WORKER.includes(`.select("${select}")`) && WORKER.includes(`.eq("status", "failed").eq("last_outcome->>lease_lapsed", "true")`),
    "worker/main.ts no longer lists lapsed missions the way this test does");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rowsDb: LapsedSweepDb = {
    listLapsed: async (limit) => {
      const { data, error } = await db.from("lead_mission_queue").select(select)
        .eq("status", "failed").eq("last_outcome->>lease_lapsed", "true").gte("updated_at", since)
        .eq("id", m.queueId) // this test's row only
        .order("updated_at", { ascending: false }).limit(limit);
      assertEquals(error, null);
      return (data ?? []) as never;
    },
    readTask: async (id) => (await db.from("tasks").select("status, result").eq("id", id).maybeSingle()).data as never,
    readLineage: async (id) => (await db.from("lead_lineages").select("status").eq("lineage_id", id).maybeSingle()).data as never,
    readPlan: async (id) => (await db.from("task_plans").select("status").eq("id", id).maybeSingle()).data as never,
    writeTask: async (id, patch) => { assertEquals((await db.from("tasks").update(patch).eq("id", id)).error, null); },
    writeLineage: async (id, patch) => { assertEquals((await db.from("lead_lineages").update(patch).eq("lineage_id", id)).error, null); },
    writePlan: async (id, patch) => { assertEquals((await db.from("task_plans").update(patch).eq("id", id)).error, null); },
  };
  const r = await sweepLapsedMissions(rowsDb, new Date().toISOString());
  assertEquals([r.scanned, r.reconciled], [1, 1]);
  assertEquals(r.details[0].remaining, []);
  const [t] = await sql`select status, result->>'terminal_status' as ts from public.tasks where id = ${m.task}`;
  const [l] = await sql`select status, terminal_reason, lease_holder from public.lead_lineages where lineage_id = ${m.lineage}`;
  const [p] = await sql`select status from public.task_plans where id = ${m.plan}`;
  assertEquals([t.status, t.ts], ["failed", "attempts_exhausted"]);
  assertEquals([l.status, l.terminal_reason, l.lease_holder], ["terminal", "attempts_exhausted", null]);
  assertEquals(p.status, "failed");
  // Idempotent: a second sweep writes nothing.
  assertEquals((await sweepLapsedMissions(rowsDb, new Date().toISOString())).reconciled, 0);
});

test("lapsed lease WITH attempts left: reclaimed exactly as before, nothing ended", async () => {
  const m = await mission();
  await claim();
  await lapse(m.queueId);
  const again = await claim();
  assertEquals([again.row.claimed, again.row.queue_id, again.row.attempts], [true, m.queueId, 2]);
  const q = await queueRow(m.queueId);
  assertEquals([q.status, q.last_outcome], ["running", null]);
});

test("a LIVE final claim is never ended: only a lapsed lease is", async () => {
  const m = await mission({ attempts: 4 });
  const fifth = await claim();
  assertEquals(fifth.row.attempts, 5);
  assertEquals((await claim()).row.claimed, false);
  const q = await queueRow(m.queueId);
  assertEquals([q.status, q.claimed_by, q.last_outcome], ["running", fifth.worker, null], "the holder keeps it while its lease is live");
});

test("lapsed lease with no slice left: ended failed as slices_exhausted", async () => {
  const m = await mission({ attempts: 1 });
  await sql`update public.lead_mission_queue set status = 'running', claimed_by = ${uuid()}, continuations = 25,
              lease_expires_at = now() - interval '1 second' where id = ${m.queueId}`;
  assertEquals((await claim()).row.claimed, false);
  const q = await queueRow(m.queueId);
  assertEquals([q.status, q.attempts, q.last_outcome.reason, q.last_outcome.lease_lapsed], ["failed", 1, "slices_exhausted", true]);
});

test("an ended mission is never rewritten: complete, failed and cancelled rows are untouched", async () => {
  const m = await mission({ attempts: 5 });
  for (const status of ["complete", "failed", "cancelled"]) {
    // An ended row as a release leaves it: no holder, no lease.
    await sql`update public.lead_mission_queue set status = ${status}, claimed_by = null, lease_expires_at = null,
                last_outcome = ${sql.json({ by: "release" })} where id = ${m.queueId}`;
    await claim();
    const q = await queueRow(m.queueId);
    assertEquals([q.status, q.last_outcome], [status, { by: "release" }], status);
  }
});
