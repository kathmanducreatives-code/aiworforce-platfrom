// Real queue/admission/credit RPCs; disposable localhost database only. No vendor fetches.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AdmissionDb,
  admitOperation,
  recordReceipt,
} from "../../supabase/functions/_shared/smokeAdmission.ts";
import { fencedTaskUpdate } from "../../supabase/functions/_shared/fencedTaskWrite.ts";
import { authorizeProviderCall } from "../../supabase/functions/_shared/creditAuthorization.ts";
import {
  mapTaskOutcome,
  queueStatusFor,
} from "../../supabase/functions/_shared/leadMissionV2Request.ts";
import { seedTask, serviceClient, sql, uuid } from "./lib/harness.ts";
import {
  authorizeSmoke,
  hex,
  JOBS,
  seedSmokeMission,
} from "./lib/smokeMission.ts";

const opts = { sanitizeResources: false, sanitizeOps: false };
const REASON = "continuation_attempts_exhausted";
async function fixture(paid = false, knownRun = true) {
  const m = await seedSmokeMission({ authorize: false });
  await sql`update public.lead_mission_queue set status='complete', claimed_by=null, lease_expires_at=null
    where id<>${m.queueId} and status in ('queued','resumable','running')`;
  const plan = uuid();
  await sql`insert into public.task_plans (id, workspace_id, user_instruction, status)
    values (${plan}, ${m.ws}, 'offline recovery fixture', 'executing')`;
  await sql`update public.tasks set plan_id=${plan}, result=${
    sql.json({
      terminal_status: "continuation_required",
      preserved: { run_id: "offline-existing" },
      auto_continuation: { continuing: true, keep: 7 },
    })
  } where id=${m.taskId}`;
  await sql`update public.lead_mission_queue set request=request || ${
    sql.json({ plan_id: plan })
  } where id=${m.queueId}`;
  if (paid) {
    m.authorizationId = await authorizeSmoke(m.queueId);
    await sql`insert into public.workspace_credit_balances (workspace_id,balance_credits) values (${m.ws},10)`;
    const db = await serviceClient();
    const credit = await authorizeProviderCall({
      db: db as never,
      workspace_id: m.ws,
      task_id: m.taskId,
      logical_call_key: `offline:${m.taskId}`,
      capability: JOBS,
      mode: "enforce",
    });
    assert(credit.allowed && credit.reserved);
    const admission = await admitOperation(db as unknown as AdmissionDb, {
      queueId: m.queueId,
      workerId: m.workerId,
      taskId: m.taskId,
      generation: m.generation,
      key: "offline-purchase",
      kind: "provider",
      actor: JOBS,
      templateId: "apify_jobs",
      payloadHash: hex("a"),
    });
    assertEquals(admission.decision, "admitted");
    if (admission.decision === "admitted" && knownRun) {
      assert(
        typeof admission.operation_key === "string" &&
          typeof admission.reservation_token === "string",
      );
      assert(
        await recordReceipt(db as unknown as AdmissionDb, {
          queueId: m.queueId,
          key: admission.operation_key,
          token: admission.reservation_token,
          runId: "offline-existing",
        }),
      );
    }
  }
  return { ...m, plan };
}
type Mission = Awaited<ReturnType<typeof fixture>>;
async function expire(m: Mission, attempts = 5) {
  await sql`update public.lead_mission_queue set attempts=${attempts}, lease_expires_at=clock_timestamp()-interval '1 second' where id=${m.queueId}`;
}
async function rows(m: Mission) {
  const [q] =
    await sql`select status, attempts, continuations, claimed_by, lease_expires_at, last_outcome from public.lead_mission_queue where id=${m.queueId}`;
  const [t] =
    await sql`select status, result, checkpoint_version, continuation_claim_id from public.tasks where id=${m.taskId}`;
  const [l] =
    await sql`select status, terminal_reason, lease_holder, lease_expires_at, state_version, current_state from public.lead_lineages where lineage_id=${m.taskId}`;
  const [p] =
    await sql`select status, completed_at from public.task_plans where id=${m.plan}`;
  return { q, t, l, p };
}
async function money(m: Mission) {
  return {
    auth:
      await sql`select * from public.discovery_smoke_authorizations where queue_id=${m.queueId}`,
    ops:
      await sql`select * from public.discovery_smoke_operations where authorization_id=${m.authorizationId}`,
    reconciliation:
      await sql`select * from public.discovery_smoke_reconciliations where authorization_id=${m.authorizationId}`,
    credits:
      await sql`select * from public.credit_transactions where workspace_id=${m.ws}`,
    balance:
      await sql`select * from public.workspace_credit_balances where workspace_id=${m.ws}`,
  };
}
async function claim() {
  const r = await (await serviceClient()).rpc("claim_next_lead_mission", {
    p_worker_id: uuid(),
    p_lease_seconds: 60,
  });
  assertEquals(r.error, null);
  return r.data[0];
}
async function sweep(limit = 10) {
  return await (await serviceClient()).rpc("recover_exhausted_lead_missions", {
    p_limit: limit,
  });
}

Deno.test(
  "exhaustion: five real crashed claims end queue/task/lineage/plan without a sixth attempt",
  opts,
  async () => {
    const m = await fixture();
    await sql`update public.lead_mission_queue set status='queued',claimed_by=null,lease_expires_at=null where id=${m.queueId}`;
    for (let n = 1; n <= 5; n++) {
      const got = await claim();
      assertEquals(got.queue_id, m.queueId);
      assertEquals(got.attempts, n);
      await expire(m, n);
    }
    assertEquals((await claim()).claimed, false);
    const r = await rows(m);
    assertEquals(r.q.status, "failed");
    assertEquals(r.q.attempts, 5);
    assertEquals(r.q.claimed_by, null);
    assertEquals(r.q.lease_expires_at, null);
    assertEquals(r.t.status, "failed");
    assertEquals(r.t.result.terminal_status, REASON);
    assertEquals(r.t.result.preserved, { run_id: "offline-existing" });
    assertEquals(r.t.result.auto_continuation.continuing, false);
    assertEquals(r.t.result.auto_continuation.keep, 7);
    assertEquals(r.l.status, "terminal");
    assertEquals(r.l.terminal_reason, REASON);
    assertEquals(r.l.lease_holder, null);
    assertEquals(r.l.lease_expires_at, null);
    assertEquals(r.p.status, "failed");
    assert(r.p.completed_at);
  },
);

Deno.test(
  "exhaustion: concurrent cleanup is idempotent; stale release, heartbeat and writes are fenced; money is unchanged",
  opts,
  async () => {
    const m = await fixture(true);
    const beforeMoney = await money(m);
    await expire(m);
    const results = await Promise.all(Array.from({ length: 8 }, () => sweep()));
    assert(results.every((r) => r.error === null), JSON.stringify(results));
    assertEquals(results.reduce((sum, r) => sum + r.data, 0), 1);
    const after = await rows(m);
    assertEquals(after.t.checkpoint_version, m.generation + 1);
    const db = await serviceClient();
    const release = await db.rpc("release_lead_mission", {
      p_queue_id: m.queueId,
      p_worker_id: m.workerId,
      p_status: "complete",
      p_outcome: {},
      p_lineage_slices: null,
    });
    assertEquals(release.error, null);
    assertEquals(release.data[0].released, false);
    const hb = await db.rpc("heartbeat_lead_mission", {
      p_queue_id: m.queueId,
      p_worker_id: m.workerId,
      p_lease_seconds: 60,
    });
    assertEquals(hb.error, null);
    assertEquals(hb.data[0].ok, false);
    const write = await fencedTaskUpdate(
      db as never,
      m.taskId,
      { generation: m.generation },
      { requireOpen: true },
      { result: { stale: true } },
    );
    assertEquals(write.written, false);
    const lineage = await db.rpc("release_lineage_lease", {
      p_lineage_id: m.taskId,
      p_workspace_id: m.ws,
      p_holder_task_id: m.taskId,
      p_expected_version: 0,
      p_next_state: { stale: true },
      p_terminal_reason: null,
      p_made_progress: false,
    });
    assertEquals(lineage.error, null);
    assertEquals(lineage.data[0].released, false);
    assertEquals((await sweep()).data, 0);
    assertEquals(await rows(m), after);
    assertEquals(
      await money(m),
      beforeMoney,
      "no refunds, reconciliation, repricing or new operations",
    );
    const attempt = await admitOperation(db as unknown as AdmissionDb, {
      queueId: m.queueId,
      workerId: m.workerId,
      taskId: m.taskId,
      generation: m.generation,
      key: "after-recovery",
      kind: "provider",
      actor: JOBS,
      templateId: "apify_jobs",
      payloadHash: hex("b"),
    });
    assert(attempt.decision !== "admitted");
    assertEquals(await money(m), beforeMoney);
  },
);

Deno.test(
  "exhaustion: transaction failure after task/lineage cleanup rolls everything back and retry completes",
  opts,
  async () => {
    const m = await fixture(true);
    await expire(m);
    const before = await rows(m), beforeMoney = await money(m);
    await sql.unsafe(
      `create function public.contract_fail_recovery() returns trigger language plpgsql as $$ begin
    if new.id='${m.plan}'::uuid then raise exception 'offline injected plan write failure'; end if; return new; end $$`,
    );
    await sql.unsafe(
      "create trigger contract_fail_recovery before update on public.task_plans for each row execute function public.contract_fail_recovery()",
    );
    try {
      const failed = await sweep();
      assert(failed.error, "injected failure must be visible");
      assertEquals(await rows(m), before);
      assertEquals(await money(m), beforeMoney);
    } finally {
      await sql.unsafe(
        "drop trigger contract_fail_recovery on public.task_plans; drop function public.contract_fail_recovery()",
      );
    }
    const retry = await sweep();
    assertEquals(retry.error, null);
    assertEquals(retry.data, 1);
    assertEquals((await rows(m)).q.status, "failed");
    assertEquals(await money(m), beforeMoney);
  },
);

Deno.test(
  "exhaustion: an unexpired fifth lease is untouched and an expired fourth claim is reclaimed normally",
  opts,
  async () => {
    const m = await fixture();
    await sql`update public.lead_mission_queue set attempts=5 where id=${m.queueId}`;
    const before = await rows(m);
    assertEquals((await sweep()).data, 0);
    assertEquals(await rows(m), before);
    await expire(m, 4);
    const next = await claim();
    assertEquals(next.claimed, true);
    assertEquals(next.attempts, 5);
    assertEquals(next.task_id, m.taskId);
    assertEquals((await rows(m)).t.status, "running");
  },
);

Deno.test(
  "exhaustion: a locked queue is skipped; a concurrent lease renewal wins before cleanup",
  opts,
  async () => {
    const m = await fixture();
    await expire(m);
    await sql.begin(async (tx) => {
      await tx`select id from public.lead_mission_queue where id=${m.queueId} for update`;
      assertEquals(
        (await sweep()).data,
        0,
        "SKIP LOCKED must not wait behind a live claimant",
      );
      await tx`update public.lead_mission_queue set lease_expires_at=clock_timestamp()+interval '1 minute' where id=${m.queueId}`;
    });
    assertEquals((await sweep()).data, 0);
    assertEquals((await rows(m)).q.status, "running");
  },
);

for (
  const [taskStatus, terminalStatus, lineageStatus, lineageReason] of [
    ["complete", null, "running", null],
    ["completed", "quota_met", "terminal", "quota_met"],
    ["failed", "provider_error", "running", null],
    ["ready", "continuation_required", "cancelled", "cancelled"],
    ["ready", "continuation_required", "terminal", "search_exhausted"],
  ] as const
) {
  Deno.test(
    `exhaustion: persisted ${
      terminalStatus ?? taskStatus
    }/${lineageStatus} matches the worker's authoritative outcome`,
    opts,
    async () => {
      const m = await fixture();
      await expire(m);
      await sql`update public.tasks set status=${taskStatus}, result=${
        sql.json({ terminal_status: terminalStatus })
      } where id=${m.taskId}`;
      await sql`update public.lead_lineages set status=${lineageStatus}, terminal_reason=${lineageReason} where lineage_id=${m.taskId}`;
      const mapped = mapTaskOutcome({
        status: taskStatus,
        terminal_status: terminalStatus,
      }, {
        status: lineageStatus,
        terminal_reason: lineageReason,
        terminal_status: null,
      });
      const r = await sweep();
      assertEquals(r.error, null);
      assertEquals(r.data, 1);
      const after = await rows(m);
      assertEquals(after.q.status, queueStatusFor(mapped));
      assertEquals(
        after.p.status,
        queueStatusFor(mapped) === "complete" ? "complete" : "failed",
      );
      assertEquals(after.t.result.auto_continuation.continuing, false);
      assertEquals(after.l.lease_holder, null);
    },
  );
}

Deno.test(
  "exhaustion: missing bindings and malformed plan references do not prevent queue closure",
  opts,
  async () => {
    const m = await fixture();
    await expire(m);
    await sql`update public.lead_mission_queue set task_id=null,lineage_id=null,request=${
      sql.json({ plan_id: "invalid-uuid" })
    } where id=${m.queueId}`;
    const r = await sweep();
    assertEquals(r.error, null);
    assertEquals(r.data, 1);
    assertEquals((await rows(m)).q.status, "failed");
    assertEquals((await rows(m)).p.status, "executing");
  },
);

Deno.test("exhaustion: cleanup is service-only and bounded", opts, async () => {
  const [grants] = await sql`select
    has_function_privilege('service_role','public.recover_exhausted_lead_missions(integer)','execute') as service,
    has_function_privilege('anon','public.recover_exhausted_lead_missions(integer)','execute') as anon,
    has_function_privilege('authenticated','public.recover_exhausted_lead_missions(integer)','execute') as authenticated`;
  assertEquals(grants, { service: true, anon: false, authenticated: false });
  const m = await fixture();
  await expire(m);
  assertEquals((await sweep(0)).data, 0);
  assertEquals((await rows(m)).q.status, "running");
});

Deno.test(
  "exhaustion: a bounded pass leaves remaining rows for the next pass",
  opts,
  async () => {
    const m = await fixture();
    await expire(m);
    await sql`insert into public.lead_mission_queue (workspace_id,request,status,attempts,claimed_by,lease_expires_at)
    select ${m.ws},'{}'::jsonb,'running',5,${uuid()},clock_timestamp()-interval '1 second' from generate_series(1,2)`;
    assertEquals((await sweep(2)).data, 2);
    const [left] =
      await sql`select count(*)::int as n from public.lead_mission_queue where workspace_id=${m.ws} and status='running'`;
    assertEquals(left.n, 1);
    assertEquals((await sweep(2)).data, 1);
    assertEquals((await sweep(2)).data, 0);
  },
);

Deno.test(
  "exhaustion: foreign workspace bindings cannot terminalize another workspace",
  opts,
  async () => {
    const m = await fixture(), other = await fixture();
    const before = await rows(other);
    await sql`update public.lead_mission_queue set status='running',attempts=5,claimed_by=${m.workerId},lease_expires_at=clock_timestamp()-interval '1 second',
    task_id=${other.taskId},lineage_id=${other.taskId},request=${
      sql.json({ plan_id: other.plan })
    } where id=${m.queueId}`;
    const r = await sweep();
    assertEquals(r.error, null);
    assertEquals(r.data, 1);
    assertEquals(await rows(other), before);
    assertEquals((await rows(m)).q.status, "failed");
  },
);

Deno.test(
  "exhaustion: a different lineage holder and its task remain untouched",
  opts,
  async () => {
    const m = await fixture();
    await expire(m);
    await sql`update public.tasks set status='ready' where id=${m.taskId}`;
    const rival = await seedTask(m.ws, {
      lineage_id: m.taskId,
      status: "running",
    });
    await sql`update public.lead_lineages set lease_holder=${rival} where lineage_id=${m.taskId}`;
    const before = (await rows(m)).l;
    const r = await sweep();
    assertEquals(r.error, null);
    assertEquals(r.data, 1);
    const after = await rows(m);
    assertEquals(after.q.status, "failed");
    assertEquals(after.t.status, "failed");
    assertEquals(after.l, before);
    const [t] = await sql`select status from public.tasks where id=${rival}`;
    assertEquals(t.status, "running");
  },
);

Deno.test(
  "exhaustion: held migration reapply and rollback preserve existing terminal records",
  opts,
  async () => {
    const up = await Deno.readTextFile(
      new URL(
        "../../supabase/migrations-held/20261019120000_lead_mission_exhausted_claim_recovery.sql",
        import.meta.url,
      ),
    );
    const down = await Deno.readTextFile(
      new URL(
        "../../supabase/migrations-held/rollback/20261019120000_lead_mission_exhausted_claim_recovery.down.sql",
        import.meta.url,
      ),
    );
    const m = await fixture(true);
    await expire(m);
    assertEquals((await sweep()).data, 1);
    const before = await rows(m), beforeMoney = await money(m);
    try {
      await sql.unsafe(down);
      const [helper] =
        await sql`select to_regprocedure('public.recover_exhausted_lead_missions(integer)') is null as absent`;
      assertEquals(helper.absent, true);
      assertEquals((await claim()).claimed, false);
      assertEquals(await rows(m), before);
    } finally {
      await sql.unsafe(up);
    }
    await sql.unsafe(up);
    assertEquals((await sweep()).data, 0);
    assertEquals(await rows(m), before);
    assertEquals(await money(m), beforeMoney);
  },
);

Deno.test(
  "exhaustion: an unknown purchase stays reserved and blocks the next authorization",
  opts,
  async () => {
    const m = await fixture(true, false);
    const before = await money(m);
    await expire(m);
    assertEquals(before.ops[0].provider_run_id, null);
    assertEquals((await sweep()).data, 1);
    assertEquals(await money(m), before);
    const next = await seedSmokeMission({ authorize: false });
    await assertRejects(
      () => authorizeSmoke(next.queueId, { keepPriorLiability: true }),
      Error,
      "unreconciled",
    );
  },
);

Deno.test(
  "exhaustion: concurrent claimers recover the expired row and claim ordinary work only once",
  opts,
  async () => {
    const expired = await fixture(), ordinary = await fixture();
    await sql`update public.lead_mission_queue set status='running',claimed_by=${expired.workerId},lease_expires_at=clock_timestamp()-interval '1 second',attempts=5 where id=${expired.queueId}`;
    await sql`update public.lead_mission_queue set status='queued',claimed_by=null,lease_expires_at=null where id=${ordinary.queueId}`;
    const claims = await Promise.all(Array.from({ length: 8 }, () => claim()));
    const claimed = claims.filter((r) => r.claimed);
    assertEquals(claimed.length, 1);
    assertEquals(claimed[0].queue_id, ordinary.queueId);
    assertEquals(claimed[0].attempts, 1);
    assertEquals((await rows(expired)).q.status, "failed");
    assertEquals(
      (await rows(ordinary)).t.checkpoint_version,
      ordinary.generation,
    );
  },
);

Deno.test(
  "exhaustion: live-lineage checkpoint labels cannot survive as the recovered terminal verdict",
  opts,
  async () => {
    const m = await fixture();
    await expire(m);
    await sql`update public.lead_lineages set terminal_reason='old_pending_label',current_state=${
      sql.json({ terminal_status: "pending_external_run", preserved: 9 })
    } where lineage_id=${m.taskId}`;
    assertEquals((await sweep()).data, 1);
    const after = await rows(m);
    assertEquals(after.l.terminal_reason, REASON);
    assertEquals(after.l.current_state.terminal_status, REASON);
    assertEquals(after.l.current_state.preserved, 9);
  },
);
