// A7 LIFECYCLE SCENARIOS not already pinned elsewhere (S29, S30, S32, S34).
// S26/S27 (crash after admission / after a run id), S28 and S35 (exhausted
// final lease, migration absent vs present) and S31 (fenced writes) are pinned
// by smokeAdmissionRuntime, discoveryReliability (#106),
// leadMissionExhaustedLease (#108) and fencedWrite contracts.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { seedLineage, seedTask, seedWorkspace, serviceClient, sql, uuid } from "./lib/harness.ts";
import { authorizeSmoke, seedSmokeMission } from "./lib/smokeMission.ts";
import { boundsHeld, company, job, runScenario } from "./lib/discoveryScenario.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const reconciliation = Deno.readTextFileSync(new URL("../../scripts/test-project/smoke-reconciliation.sql", import.meta.url));
const unreconciled = (queueId: string) => sql.unsafe(reconciliation.replace(":'queue_id'", `'${queueId}'`));

async function exhaustedLapsed() {
  const ws = await seedWorkspace();
  const lineage = await seedLineage(ws, { status: "active" });
  const task = await seedTask(ws, { lineage_id: lineage, status: "running" });
  const queueId = uuid();
  await sql`insert into public.lead_mission_queue (id, workspace_id, request, status, attempts, task_id, lineage_id, claimed_by, lease_expires_at)
            values (${queueId}, ${ws}, ${sql.json({ plan_id: null })}, 'running', 5, ${task}, ${lineage}, ${uuid()}, now() - interval '1 second')`;
  await sql`update public.lead_mission_queue set status = 'complete', claimed_by = null, lease_expires_at = null
              where id <> ${queueId} and status in ('queued','resumable','running')`;
  return { ws, queueId, task, lineage };
}

Deno.test("S29: two workers race to recover one exhausted mission — it is ended once, claimed by neither", opts, async () => {
  const m = await exhaustedLapsed();
  const db = await serviceClient();
  const [a, b] = await Promise.all([1, 2].map(() => db.rpc("claim_next_lead_mission", { p_worker_id: uuid(), p_lease_seconds: 60 })));
  for (const r of [a, b]) {
    assertEquals(r.error, null);
    assertEquals((Array.isArray(r.data) ? r.data[0] : r.data).claimed, false, "no sixth attempt for either worker");
  }
  const [q] = await sql`select status, attempts, claimed_by, last_outcome from public.lead_mission_queue where id = ${m.queueId}`;
  assertEquals([q.status, q.attempts, q.claimed_by, q.last_outcome.lease_lapsed], ["failed", 5, null, true]);
});

Deno.test("S32: a completed mission — a stale worker can neither heartbeat, release over it, nor have it claimed again", opts, async () => {
  const ws = await seedWorkspace();
  const lineage = await seedLineage(ws, { status: "terminal", terminal_reason: "complete" });
  const task = await seedTask(ws, { lineage_id: lineage, status: "completed" });
  const queueId = uuid(), stale = uuid();
  await sql`insert into public.lead_mission_queue (id, workspace_id, request, status, attempts, task_id, lineage_id, last_outcome)
            values (${queueId}, ${ws}, ${sql.json({ plan_id: null })}, 'complete', 1, ${task}, ${lineage}, ${sql.json({ by: "release" })})`;
  const db = await serviceClient();
  const hb = await db.rpc("heartbeat_lead_mission", { p_queue_id: queueId, p_worker_id: stale, p_lease_seconds: 60 });
  assertEquals((Array.isArray(hb.data) ? hb.data[0] : hb.data).ok, false);
  const rel = await db.rpc("release_lead_mission", { p_queue_id: queueId, p_worker_id: stale, p_status: "failed", p_outcome: { stale: true } });
  assertEquals((Array.isArray(rel.data) ? rel.data[0] : rel.data).released, false);
  const c = await db.rpc("claim_next_lead_mission", { p_worker_id: stale, p_lease_seconds: 60 });
  assert((Array.isArray(c.data) ? c.data[0] : c.data).queue_id !== queueId, "a completed mission is never claimed");
  const [q] = await sql`select status, last_outcome from public.lead_mission_queue where id = ${queueId}`;
  assertEquals([q.status, q.last_outcome], ["complete", { by: "release" }]);
});

Deno.test("S34: after a real mission, every purchase is open liability until a person reconciles it; no new smoke meanwhile", opts, async () => {
  const r = await runScenario({ label: "S34", jobs: [job("s34", company("s34", { name: "S34 Software" }))], model: "honest" });
  boundsHeld(r);
  const open = await unreconciled(r.m.queueId);
  assertEquals(open.map((o) => o.actor).sort(), ["apify:harvestapi~linkedin-company", "apify:harvestapi~linkedin-job-search"]);
  const next = await seedSmokeMission({ authorize: false });
  await assertRejects(() => authorizeSmoke(next.queueId, { keepPriorLiability: true }), Error, "unreconciled");
  // The internal credits were charged once each; the USD liability is separate and still open.
  assertEquals(Object.values(r.outcome.credits).sort(), ["charged", "charged"]);
});

Deno.test("S30: the mission's deadline passes after a lead was persisted — the lead stands, nothing more is admitted", opts, async () => {
  const r = await runScenario({ label: "S30", jobs: [job("s30", company("s30", { name: "S30 Software" }))], model: "honest" });
  assertEquals(r.outcome.qualified, ["S30 Software"]);
  // Move the authorization's deadline into the past, as the 300 s clock would.
  await sql`update public.discovery_smoke_authorizations set deadline_at = now() - interval '1 second', authorized_at = now() - interval '2 seconds'
              where id = ${r.m.authorizationId}`;
  const [d] = await sql`select public.admit_discovery_smoke(${r.m.queueId}, ${r.m.workerId}, ${r.m.taskId}, ${r.m.generation},
    ${"late-" + uuid()}, 'model', 'openai:gpt-5.6-luna', 'model', ${"a".repeat(64)}, null) as d`;
  assertEquals(d.d.decision, "stopped", `a late admission after the deadline: ${JSON.stringify(d.d)}`);
  const leads = await sql`select count(*)::int as n from public.lead_candidates where workspace_id = ${r.m.ws}`;
  assertEquals(leads[0].n, 1, "the persisted lead is not removed by the deadline");
});
