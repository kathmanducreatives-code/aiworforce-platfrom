// A CONTINUATION IS NOT A RETRY — canary 53784493 (production, 2026-10-03),
// replayed against the REAL queue SQL.
//
// The database is PGlite: PostgreSQL 16 compiled to WASM, in-process, nothing
// to install and nothing reachable. It runs the held V2 queue migration
// verbatim, then (for the fixed runs) 20261003120000, and the worker side is
// the production code: `workerTick` / `runClaimedMission` from the worker core
// and `releaseQueuedMission` from leadMissionTerminal.ts. Only the handler is
// simulated — and its continuation decisions come from the real `foldSlice` and
// `decideAutoContinuation`, fed the canary's own counters.
//
// What the canary did, slice by slice (worker logs, task 53784493):
//
//   slice 1  page 1 (10), verifiers started        barren 0  awaiting_provider_run   attempts 1
//   slice 2  Pvalyou adopted; claim_progress 37    barren 0  replenishment_required  attempts 2
//   slice 3  page 2 committed (19, 9 workable)     barren 0  awaiting_provider_run   attempts 3
//   slice 4  page-2 verifiers; claim_progress 74   barren 0  awaiting_provider_run   attempts 4
//   slice 5  adoption; claim_progress 76           barren 0  replenishment_required  attempts 5
//   ── release: `attempts >= 5` → failed / continuation_attempts_exhausted
//   slice 6  never claimed — page 3 never ran, discovery had 18 pages left
//
// Every one of those five claims ended cleanly. None was a retry.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import {
  type ClaimedMission, type MissionOutcome, runClaimedMission, type WorkerDeps, workerTick,
} from "../../supabase/functions/_shared/leadMissionWorkerCore.ts";
import {
  CONTINUATION_ATTEMPTS_EXHAUSTED, CONTINUATION_SLICES_EXHAUSTED, type QueueRpc, releaseQueuedMission,
  RETRY_BUDGET_EXHAUSTED, V2_MAX_ATTEMPTS, V2_MAX_CONTINUATION_SLICES,
} from "../../supabase/functions/_shared/leadMissionTerminal.ts";
import {
  decideAutoContinuation, DEFAULT_MAX_CONTINUATIONS, foldSlice, type LineageProgress, MAX_CONTINUATIONS_CAP,
  readLineageProgress, resolveMaxContinuations, resolveMaxLineageCostUnits,
} from "../../supabase/functions/_shared/leadAutoContinuation.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, ROOT));
const QUEUE_SQL = read("supabase/migrations-held/20260910140000_lead_mission_v2_claim.sql");
const FIX_NAME = "20261003120000_lead_mission_v2_continuations_not_retries";
const FIX_SQL = read(`supabase/migrations-held/${FIX_NAME}.sql`);
const DOWN_SQL = read(`supabase/migrations-held/rollback/${FIX_NAME}.down.sql`);

// The tables the queue functions read, reduced to the columns they touch.
const PRELUDE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create table public.workspaces (id uuid primary key);
  create table public.lead_lineages (
    lineage_id uuid primary key, workspace_id uuid not null, status text not null default 'active',
    lease_holder uuid, lease_expires_at timestamptz, updated_at timestamptz default now()
  );
  create table public.tasks (
    id uuid primary key, status text, updated_at timestamptz default now(),
    continuation_claim_id uuid, continuation_claim_expires_at timestamptz
  );
`;

const WS = "e8af257d-4c42-4fc2-9d62-037cdfac27c4";
const TASK = "53784493-ef09-4cb5-9eea-8af2ceafa01e";

async function database(o: { fixed: boolean }): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(PRELUDE);
  await db.exec(QUEUE_SQL);
  if (o.fixed) await db.exec(FIX_SQL);
  await db.query(`insert into public.workspaces (id) values ($1)`, [WS]);
  return db;
}

/**
 * `db.rpc(fn, args)` as PostgREST performs it: named arguments, and an
 * argument the function does not have is `PGRST202`, not a Postgres error.
 */
function rpcOf(db: PGlite): QueueRpc {
  return async (fn, args) => {
    const keys = Object.keys(args);
    const vals = keys.map((k) => {
      const v = args[k];
      return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
    });
    const call = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
    try {
      const r = await db.query(`select * from public.${fn}(${call})`, vals);
      return { data: r.rows, error: null };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === "42883") {
        return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } };
      }
      return { data: null, error: { code: err.code, message: err.message } };
    }
  };
}

async function enqueue(db: PGlite): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.lead_mission_queue (workspace_id, request) values ($1, $2) returning id`,
    [WS, JSON.stringify({ plan_id: "30e881e5-929c-46a6-9062-1e3f6c1f78ff" })],
  );
  return r.rows[0].id;
}

interface QueueRow { status: string; attempts: number; continuations?: number; claimed_by: string | null }
async function row(db: PGlite, id: string): Promise<QueueRow> {
  return (await db.query<QueueRow>(`select * from public.lead_mission_queue where id = $1`, [id])).rows[0];
}
/** The 2-minute resumable backoff, elapsed. Test-only time travel. */
const backoffElapses = (db: PGlite) => db.exec(`update public.lead_mission_queue set not_before = null`);
/** A worker died holding the row: its lease lapses. */
const leaseLapses = (db: PGlite) =>
  db.exec(`update public.lead_mission_queue set lease_expires_at = now() - interval '1 second' where status = 'running'`);

type Handler = (m: ClaimedMission) => Promise<MissionOutcome>;

/** The production worker core, with the real release, over this database. */
function worker(db: PGlite, handler: Handler, o: { oldWorker?: boolean } = {}) {
  const rpc = rpcOf(db);
  const workerId = crypto.randomUUID();
  const releases: Array<{ finalStatus: string; reason: string | null; fallback: boolean }> = [];
  const deps: WorkerDeps = {
    workerId,
    config: { leaseSeconds: 180, heartbeatIntervalMs: 60_000, missionCeilingMs: 300_000, idlePollMs: 1, cancelSweepIntervalMs: 60_000 },
    claim: async (wid, lease) => {
      const { data, error } = await rpc("claim_next_lead_mission", { p_worker_id: wid, p_lease_seconds: lease });
      const r = (data as Array<Record<string, unknown>> | null)?.[0];
      if (error || !r || r.claimed !== true) return { claimed: false, reason: String(r?.reason ?? "error") };
      return {
        claimed: true,
        mission: {
          queueId: String(r.queue_id), workspaceId: String(r.workspace_id),
          request: (typeof r.request === "string" ? JSON.parse(r.request) : r.request) as Record<string, unknown>,
          taskId: (r.task_id as string | null) ?? null, lineageId: (r.lineage_id as string | null) ?? null,
          attempts: Number(r.attempts), isResume: !!r.task_id, heldUntil: null,
        },
      };
    },
    heartbeatFor: () => ({ start() {}, stop() {} }),
    runMission: (m) => handler(m),
    release: async (m, outcome) => {
      // The pre-fix worker never sent a slice count.
      const facts = o.oldWorker ? { ...outcome, lineageSlices: null } : outcome;
      const r = await releaseQueuedMission(rpc, {
        queueId: m.queueId, workerId, attempts: m.attempts, outcome: facts, outcomeDoc: { status: outcome.status },
      });
      releases.push({ finalStatus: r.finalStatus, reason: r.terminalReason, fallback: r.fallback });
    },
    sleep: async () => {},
  };
  return { deps, releases, tick: () => workerTick(deps) };
}

// ── THE CANARY'S HANDLER ────────────────────────────────────────────────────
//
// Observed: claim_progress 37 after slice 2, 74 after slice 4, 76 after slice
// 5; brain_decided 10 → 19; cost units 2 → 4; continuations_used 5. Slices 1
// and 3's claim progress were not persisted separately — any value strictly
// between its neighbours gives the same decisions; 22 and 58 are used.
const CANARY = [
  { label: "1: page 1",             investigated: 10, decided: 10, costUnits: 2, claimProgress: 22, pendingRuns: 1, page: 1 },
  { label: "2: verify page 1",      investigated: 10, decided: 10, costUnits: 2, claimProgress: 37, pendingRuns: 0, page: null },
  { label: "3: page 2",             investigated: 19, decided: 19, costUnits: 4, claimProgress: 58, pendingRuns: 1, page: 2 },
  { label: "4: verify page 2",      investigated: 19, decided: 19, costUnits: 4, claimProgress: 74, pendingRuns: 1, page: null },
  { label: "5: adopt",              investigated: 19, decided: 19, costUnits: 4, claimProgress: 76, pendingRuns: 0, page: null },
];

function canaryHandler() {
  let progress: LineageProgress = readLineageProgress({});
  let lastDecision: string | null = null;
  const log: Array<{ slice: number; decision: string; barren: number; page: number | null }> = [];
  const handler: Handler = async (m) => {
    const n = progress.continuations_used + 1;
    // Slice 6 is what the canary's slice 5 asked for: widen discovery.
    const page = n <= CANARY.length
      ? CANARY[n - 1].page
      : (lastDecision === "replenishment_required" ? 3 : null);
    const s = CANARY[Math.min(n, CANARY.length) - 1];
    progress = foldSlice(progress, {
      qualifiedInPool: 0, uniqueCompaniesInvestigatedInPool: s.investigated, authorisationsInPool: s.investigated,
      costUnitsInLineage: s.costUnits + (n > CANARY.length ? 1 : 0), brainDecidedInPool: s.decided,
      claimProgressInPool: s.claimProgress + (n > CANARY.length ? 9 : 0),
    });
    const d = decideAutoContinuation({
      cancelled: false, qualified: 0, requestedCount: 1, frontierRemaining: 0,
      continuationsUsed: progress.continuations_used, maxContinuations: resolveMaxContinuations(() => undefined),
      costUnitsUsed: progress.cost_units_used, maxCostUnits: resolveMaxLineageCostUnits(() => undefined),
      barrenSlices: progress.barren_slices, providerFailed: false,
      pendingRuns: n <= CANARY.length ? s.pendingRuns : 0, verificationRoutesRemain: 0,
      discoveryRoutesRemain: true, // 2 (then 3) of 20 pages taken
    } as never);
    lastDecision = String(d.reason);
    log.push({ slice: n, decision: lastDecision, barren: progress.barren_slices, page });
    return d.continue
      ? { status: "continuation_required", terminal: false, taskId: m.taskId ?? TASK, lineageSlices: progress.continuations_used }
      : { status: lastDecision, terminal: true, taskId: m.taskId ?? TASK, lineageSlices: progress.continuations_used };
  };
  return { handler, log };
}

async function replayCanary(o: { fixed: boolean; oldWorker?: boolean }) {
  const db = await database({ fixed: o.fixed });
  const id = await enqueue(db);
  const h = canaryHandler();
  const w = worker(db, h.handler, { oldWorker: o.oldWorker });
  const claims: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t = await w.tick();
    if (!t.claimed) break;
    claims.push(i + 1);
    await backoffElapses(db);
  }
  return { db, id, log: h.log, releases: w.releases, claims, final: await row(db, id) };
}

// ═══ THE REPLAY ═════════════════════════════════════════════════════════════

Deno.test("OLD CANARY REPLAY: five clean slices spend five attempts; slice 6 is never claimed; page 3 never runs", async () => {
  const r = await replayCanary({ fixed: false, oldWorker: true });
  assertEquals(r.log.map((x) => x.decision),
    ["awaiting_provider_run", "replenishment_required", "awaiting_provider_run", "awaiting_provider_run", "replenishment_required"],
    "the canary's own decisions");
  assertEquals(r.log.map((x) => x.barren), [0, 0, 0, 0, 0], "PR #15: every slice was progress");
  assertEquals(r.claims, [1, 2, 3, 4, 5], "no sixth claim");
  assertEquals(r.final.status, "failed");
  assertEquals(r.final.attempts, 5);
  assertEquals(r.releases.at(-1), { finalStatus: "failed", reason: CONTINUATION_ATTEMPTS_EXHAUSTED, fallback: false });
  assertFalse(r.log.some((x) => x.page === 3), "page 3 never executed");
  await r.db.close();
});

Deno.test("OLD DATABASE, NEW WORKER: the 4-argument fallback keeps the old behaviour exactly — nothing is stranded in `running`", async () => {
  const r = await replayCanary({ fixed: false });
  assert(r.releases.every((x) => x.fallback), "every clean release fell back");
  assertEquals(r.claims, [1, 2, 3, 4, 5]);
  assertEquals([r.final.status, r.final.claimed_by], ["failed", null], "released, not left running");
  assertEquals(r.releases.at(-1)!.reason, CONTINUATION_ATTEMPTS_EXHAUSTED);
  await r.db.close();
});

Deno.test("FIXED CANARY REPLAY: clean slices refund their claim; slice 6 is claimed and runs page 3", async () => {
  const r = await replayCanary({ fixed: true });
  assertEquals(r.claims, [1, 2, 3, 4, 5, 6], "slice 6 claimed");
  assertEquals(r.log[4].decision, "replenishment_required", "slice 5, as in production");
  assertEquals(r.log[5].page, 3, "page 3 executed");
  assertEquals(r.final.status, "resumable");
  assertEquals(r.final.attempts, 0, "no retry was spent: none of the six runs faulted");
  assertEquals(r.final.continuations, 6, "six lineage slices seen");
  assert(r.releases.every((x) => !x.fallback && x.finalStatus === "resumable"));
  await r.db.close();
});

Deno.test("NEW DATABASE, OLD WORKER: no slice count, no refund — the old behaviour, so deploy order is free", async () => {
  const r = await replayCanary({ fixed: true, oldWorker: true });
  assertEquals(r.claims, [1, 2, 3, 4, 5]);
  assertEquals([r.final.status, r.final.attempts, r.final.continuations], ["failed", 5, 0]);
  await r.db.close();
});

// ═══ SAFETY ═════════════════════════════════════════════════════════════════

/** A lineage that makes real progress every slice and obeys its own ceilings. */
function honestHandler(opts: { maxContinuations?: number } = {}) {
  let progress = readLineageProgress({});
  const decisions: string[] = [];
  const handler: Handler = async (m) => {
    const k = progress.continuations_used + 1;
    progress = foldSlice(progress, {
      qualifiedInPool: 0, uniqueCompaniesInvestigatedInPool: 10 * k, authorisationsInPool: 10 * k,
      costUnitsInLineage: 2 * k, brainDecidedInPool: 10 * k, claimProgressInPool: 20 * k,
    });
    const d = decideAutoContinuation({
      cancelled: false, qualified: 0, requestedCount: 5, frontierRemaining: 5,
      continuationsUsed: progress.continuations_used,
      maxContinuations: opts.maxContinuations ?? resolveMaxContinuations(() => undefined),
      costUnitsUsed: progress.cost_units_used, maxCostUnits: resolveMaxLineageCostUnits(() => undefined),
      barrenSlices: progress.barren_slices, providerFailed: false, pendingRuns: 0, verificationRoutesRemain: 0,
      discoveryRoutesRemain: true,
    } as never);
    decisions.push(String(d.reason));
    return d.continue
      ? { status: "continuation_required", terminal: false, taskId: m.taskId ?? TASK, lineageSlices: progress.continuations_used }
      : { status: String(d.reason), terminal: true, taskId: m.taskId ?? TASK, lineageSlices: progress.continuations_used };
  };
  return { handler, decisions };
}

async function drain(db: PGlite, w: ReturnType<typeof worker>, max = 100, between?: () => Promise<unknown>) {
  let claims = 0;
  for (let i = 0; i < max; i++) {
    const t = await w.tick();
    if (!t.claimed) break;
    claims++;
    await backoffElapses(db);
    if (between) await between();
  }
  return claims;
}

Deno.test("CONTINUATIONS REACH THE LINEAGE'S OWN LIMIT: 10 slices by default (1 + 9 continuations), then terminal", async () => {
  const db = await database({ fixed: true });
  const id = await enqueue(db);
  const h = honestHandler();
  const claims = await drain(db, worker(db, h.handler));
  assertEquals(DEFAULT_MAX_CONTINUATIONS, 10);
  assertEquals(claims, 10, "`continuations_used` counts the first slice too: 10 is the total");
  assertEquals(h.decisions.at(-1), "continuation_ceiling");
  const q = await row(db, id);
  assertEquals([q.status, q.attempts, q.continuations], ["complete", 1, 9],
    "the terminal slice's claim is not refunded; it ended the mission");
  await db.close();
});

Deno.test("A CONFIGURED BUDGET UP TO THE CAP IS HONOURED, AND THE BACKSTOP NEVER BINDS FIRST", async () => {
  const db = await database({ fixed: true });
  await enqueue(db);
  const h = honestHandler({ maxContinuations: MAX_CONTINUATIONS_CAP });
  assertEquals(await drain(db, worker(db, h.handler)), MAX_CONTINUATIONS_CAP);
  assertEquals(h.decisions.at(-1), "continuation_ceiling", "the lineage, not the queue, ended it");
  await db.close();
});

Deno.test("GENUINE FAILURES still stop after the retry limit: retry_budget_exhausted", async () => {
  const db = await database({ fixed: true });
  const id = await enqueue(db);
  const w = worker(db, async () => { throw new Error("provider transport failure"); });
  assertEquals(await drain(db, w), V2_MAX_ATTEMPTS);
  assertEquals((await row(db, id)).status, "failed");
  assertEquals(w.releases.at(-1)!.reason, RETRY_BUDGET_EXHAUSTED);
  await db.close();
});

Deno.test("NO-OP RUNS (409 on a held resume claim) are retries: the slice counter never moved, no refund", async () => {
  const db = await database({ fixed: true });
  const id = await enqueue(db);
  // The task already shows 3 slices; every run re-reads it and folds nothing.
  const w = worker(db, async (m) => ({ status: "continuation_required", terminal: false, taskId: m.taskId ?? TASK, lineageSlices: 3 }));
  assertEquals(await drain(db, w), 1 + V2_MAX_ATTEMPTS,
    "the first run's 3 is new to the queue (0 → 3) and refunded; then five no-ops, none refunded, reach the cap");
  const q = await row(db, id);
  assertEquals([q.status, q.attempts, q.continuations], ["failed", 5, 3]);
  assertEquals(w.releases.at(-1)!.reason, CONTINUATION_ATTEMPTS_EXHAUSTED);
  await db.close();
});

Deno.test("REPEATED WORKER CRASHES / LEASE EXPIRY stay bounded: the attempt a dead worker took is never refunded", async () => {
  const db = await database({ fixed: true });
  const id = await enqueue(db);
  const rpc = rpcOf(db);
  let claims = 0;
  for (let i = 0; i < 20; i++) {
    const { data } = await rpc("claim_next_lead_mission", { p_worker_id: crypto.randomUUID(), p_lease_seconds: 60 });
    if ((data as Array<{ claimed: boolean }>)[0].claimed !== true) break;
    claims++;
    await leaseLapses(db); // the worker died: no release ever comes
  }
  assertEquals(claims, V2_MAX_ATTEMPTS);
  assertEquals((await row(db, id)).attempts, V2_MAX_ATTEMPTS);
  await db.close();
});

Deno.test("FAULTS ACCUMULATE ACROSS A MISSION while clean slices are refunded around them", async () => {
  const db = await database({ fixed: true });
  const id = await enqueue(db);
  const h = honestHandler({ maxContinuations: MAX_CONTINUATIONS_CAP });
  let run = 0;
  // Every other run crashes the worker after it claimed.
  const w = worker(db, async (m) => {
    run++;
    if (run % 2 === 0) throw new Error("worker crashed");
    return h.handler(m);
  });
  const claims = await drain(db, w);
  const q = await row(db, id);
  assertEquals(q.status, "failed");
  assertEquals(q.attempts, V2_MAX_ATTEMPTS, "five faults, whatever the clean slices between them");
  assertEquals(claims, 10, "5 clean slices + 5 faults");
  assertEquals(w.releases.at(-1)!.reason, RETRY_BUDGET_EXHAUSTED);
  await db.close();
});

Deno.test("NO INFINITE CONTINUATION LOOP: a handler that ignores every ceiling is stopped by the queue backstop", async () => {
  const db = await database({ fixed: true });
  const id = await enqueue(db);
  let slices = 0;
  const w = worker(db, async (m) => ({
    status: "continuation_required", terminal: false, taskId: m.taskId ?? TASK, lineageSlices: ++slices,
  }));
  assertEquals(await drain(db, w, 1000), V2_MAX_CONTINUATION_SLICES);
  const q = await row(db, id);
  assertEquals([q.status, q.continuations], ["failed", V2_MAX_CONTINUATION_SLICES]);
  assertEquals(w.releases.at(-1)!.reason, CONTINUATION_SLICES_EXHAUSTED);
  await db.close();
});

Deno.test("A CANCELLATION mid-run is never overwritten by a clean continuation", async () => {
  const db = await database({ fixed: true });
  const id = await enqueue(db);
  const w = worker(db, async (m) => {
    await db.exec(`update public.lead_mission_queue set status = 'cancelled'`);
    return { status: "continuation_required", terminal: false, taskId: m.taskId ?? TASK, lineageSlices: 1 };
  });
  assertEquals(await drain(db, w), 1);
  assertEquals((await row(db, id)).status, "cancelled");
  await db.close();
});

// ═══ EXISTING ROWS ══════════════════════════════════════════════════════════

const SEED = `
  insert into public.lead_mission_queue (id, workspace_id, request, status, attempts, created_at, claimed_by, lease_expires_at) values
    ('00000000-0000-0000-0000-000000000001', '${WS}', '{}', 'complete',  3, now() - interval '9 min', null, null),
    ('00000000-0000-0000-0000-000000000002', '${WS}', '{}', 'failed',    5, now() - interval '8 min', null, null),
    ('00000000-0000-0000-0000-000000000003', '${WS}', '{}', 'cancelled', 2, now() - interval '7 min', null, null),
    ('00000000-0000-0000-0000-000000000004', '${WS}', '{}', 'resumable', 5, now() - interval '6 min', null, null),
    ('00000000-0000-0000-0000-000000000005', '${WS}', '{}', 'resumable', 4, now() - interval '5 min', null, null),
    ('00000000-0000-0000-0000-000000000006', '${WS}', '{}', 'running',   2, now() - interval '4 min', gen_random_uuid(), now() - interval '1 min'),
    ('00000000-0000-0000-0000-000000000007', '${WS}', '{}', 'running',   1, now() - interval '3 min', gen_random_uuid(), now() + interval '9 min'),
    ('00000000-0000-0000-0000-000000000008', '${WS}', '{}', 'queued',    0, now() - interval '2 min', null, null);
`;
const SNAPSHOT = `select id, status, attempts, claimed_by, lease_expires_at, not_before, task_id, last_outcome, created_at
                    from public.lead_mission_queue order by id`;

async function claimOrder(db: PGlite): Promise<string[]> {
  const out: string[] = [];
  for (;;) {
    const r = await db.query<{ claimed: boolean; queue_id: string }>(
      `select * from public.claim_next_lead_mission(gen_random_uuid(), 60)`);
    if (!r.rows[0].claimed) return out;
    out.push(r.rows[0].queue_id.slice(-1));
  }
}

Deno.test("EXISTING ROWS stay valid: no row rewritten, continuations 0, and exactly the same rows are claimable", async () => {
  const before = new PGlite();
  await before.exec(PRELUDE + QUEUE_SQL);
  await before.query(`insert into public.workspaces (id) values ($1)`, [WS]);
  await before.exec(SEED);
  const snapshot = (await before.query(SNAPSHOT)).rows;

  const after = new PGlite();
  await after.exec(PRELUDE + QUEUE_SQL);
  await after.query(`insert into public.workspaces (id) values ($1)`, [WS]);
  await after.exec(SEED);
  await after.exec(FIX_SQL);
  // The seed's `now()` differs per database; compare everything else.
  const strip = (rows: unknown[]) => JSON.stringify(rows.map((r) => ({ ...(r as object), created_at: 0, lease_expires_at: 0, claimed_by: 0 })));
  assertEquals(strip((await after.query(SNAPSHOT)).rows), strip(snapshot), "no historical row rewritten");
  const cont = (await after.query<{ c: number }>(`select distinct continuations c from public.lead_mission_queue`)).rows;
  assertEquals(cont, [{ c: 0 }]);

  assertEquals(await claimOrder(after), await claimOrder(before), "the same rows, in the same order");
  assertEquals(await claimOrder(await (async () => {
    const d = new PGlite(); await d.exec(PRELUDE + QUEUE_SQL); await d.query(`insert into public.workspaces (id) values ($1)`, [WS]);
    await d.exec(SEED); await d.exec(FIX_SQL); return d;
  })()), ["5", "6", "8"], "terminal rows, an exhausted row and a live lease are never claimed");
  await before.close(); await after.close();
});

// ═══ THE MIGRATION ITSELF ═══════════════════════════════════════════════════

async function definitions(db: PGlite) {
  return (await db.query<{ proname: string; args: string; def: string }>(`
    select p.proname, pg_get_function_identity_arguments(p.oid) args, pg_get_functiondef(p.oid) def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('claim_next_lead_mission', 'release_lead_mission')
     order by 1, 2`)).rows;
}

Deno.test("THE MIGRATION is idempotent, and its rollback restores the original functions exactly", async () => {
  const original = new PGlite();
  await original.exec(PRELUDE + QUEUE_SQL);
  const db = new PGlite();
  await db.exec(PRELUDE + QUEUE_SQL);
  await db.exec(FIX_SQL);
  await db.exec(FIX_SQL); // twice: no error, one release function
  const fixed = await definitions(db);
  assertEquals(fixed.map((d) => `${d.proname}(${d.args})`), [
    "claim_next_lead_mission(p_worker_id uuid, p_lease_seconds integer)",
    "release_lead_mission(p_queue_id uuid, p_worker_id uuid, p_status text, p_outcome jsonb, p_lineage_slices integer)",
  ], "one release function — PostgREST never sees two candidates");

  await db.exec(DOWN_SQL);
  assertEquals(await definitions(db), await definitions(original), "rolled back byte-for-byte");
  const cols = (await db.query(`select 1 from information_schema.columns where table_name = 'lead_mission_queue' and column_name = 'continuations'`)).rows;
  assertEquals(cols.length, 0);
  await db.exec(FIX_SQL); // and forward again
  assertEquals((await definitions(db)).length, 2);
  await db.close(); await original.close();
});

Deno.test("THE NEW FUNCTIONS are service-role only, like every V2 queue function", async () => {
  const db = await database({ fixed: true });
  const grants = (await db.query<{ proname: string; anon: boolean; authed: boolean; pub: boolean; svc: boolean }>(`
    select p.proname,
           has_function_privilege('anon', p.oid, 'execute') anon,
           has_function_privilege('authenticated', p.oid, 'execute') authed,
           exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') pub,
           has_function_privilege('service_role', p.oid, 'execute') svc
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('claim_next_lead_mission', 'release_lead_mission')`)).rows;
  assertEquals(grants.length, 2);
  for (const g of grants) assertEquals([g.anon, g.authed, g.pub, g.svc], [false, false, false, true], g.proname);
  await db.close();
});

// ═══ ONE POLICY, STATED ONCE ════════════════════════════════════════════════

/** The newest definition of a function across both migration folders, by version. */
function newest(name: string): string {
  const files: string[] = [];
  for (const dir of ["supabase/migrations/", "supabase/migrations-held/"]) {
    for (const e of Deno.readDirSync(new URL(dir, ROOT))) if (e.isFile && e.name.endsWith(".sql")) files.push(dir + e.name);
  }
  files.sort((a, b) => a.split("/").at(-1)!.localeCompare(b.split("/").at(-1)!));
  let found = "";
  for (const f of files) {
    const sql = read(f);
    const at = sql.search(new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${name}\(`, "i"));
    if (at >= 0) found = sql.slice(at, sql.indexOf("$function$;", at));
  }
  assert(found, `${name} is defined somewhere`);
  return found;
}

Deno.test("SQL, TS and the lineage budget cannot drift apart", () => {
  const claim = newest("claim_next_lead_mission");
  const release = newest("release_lead_mission");
  assert(claim.includes(`q.attempts < ${V2_MAX_ATTEMPTS}`), "claim: retry cap");
  assert(claim.includes(`q.continuations < ${V2_MAX_CONTINUATION_SLICES}`), "claim: slice backstop");
  assert(release.includes(`v_attempts >= ${V2_MAX_ATTEMPTS}`), "release: retry cap");
  assert(release.includes(`v_cont >= ${V2_MAX_CONTINUATION_SLICES}`), "release: slice backstop");
  assert(/p_lineage_slices\s*>\s*v_q\.continuations/.test(release), "a refund needs a NEW slice");
  // The backstop is the most the lineage can be configured to — never less,
  // or the queue would cut off a configured budget.
  assertEquals(V2_MAX_CONTINUATION_SLICES, MAX_CONTINUATIONS_CAP);
  assert(DEFAULT_MAX_CONTINUATIONS < V2_MAX_CONTINUATION_SLICES);
});

Deno.test("the newest queue functions keep every invariant the original had", () => {
  const claim = newest("claim_next_lead_mission");
  assert(/for\s+update\s+skip\s+locked/i.test(claim));
  assert(/l\.status\s+in\s+\('cancelled',\s*'terminal'\)/i.test(claim), "a terminal lineage is never claimed");
  assert(/not_before/i.test(claim), "the resumable backoff");
  assert(/lease_expires_at\s*<=\s*now\(\)/i.test(claim), "a dead worker's row is reclaimable");
  const release = newest("release_lead_mission");
  assert(/claimed_by\s+is\s+distinct\s+from\s+p_worker_id/i.test(release), "only the owner releases");
  assert(/when\s+v_q\.status\s*=\s*'cancelled'\s+then\s+'cancelled'/i.test(release), "cancellation wins");
  assert(/interval\s+'2 minutes'/i.test(release), "backoff unchanged");
});

Deno.test("LEAD V1 is untouched: only the V2 worker path calls the queue release, and V1's sweeper reads no counter", () => {
  const callers: string[] = [];
  const walk = (rel: string) => {
    for (const e of Deno.readDirSync(new URL(rel, ROOT))) {
      const p = rel + e.name;
      if (e.isDirectory) walk(p + "/");
      else if (e.name.endsWith(".ts") && read(p).includes(`"release_lead_mission"`)) callers.push(p);
    }
  };
  walk("supabase/functions/");
  walk("worker/");
  assertEquals(callers, ["supabase/functions/_shared/leadMissionTerminal.ts"]);
  const sweep = read("supabase/migrations-held/20260915120000_sweep_skips_v2_queue_tasks.sql");
  assertFalse(/attempts|continuations/.test(sweep), "the V1 sweeper reads queue status only");
});
