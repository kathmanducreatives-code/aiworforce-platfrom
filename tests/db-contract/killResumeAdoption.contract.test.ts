// A WORKER KILLED BETWEEN A PAID START AND ITS LEDGER RECORD.
//
// The narrow window #150 leaves: the vendor started (and billed) the job
// search, the admission gate recorded its receipt with the run and dataset ids,
// and the worker died at the execution ledger's PATCH that would have saved
// `lead_execution_calls.provider_run_id`. The next slice cannot adopt the run
// from the ledger (it names none), so it replays the start; the gate answers
// `adopt`. Before this fix that was a 503: the start was (correctly) never sent
// again, but the run was never read, the mission ended `budget_exhausted` next
// to a dataset it had paid for, and the credit stayed held until the reaper
// refunded it.
//
// Now the gate answers a VERIFIED adoption with the run itself
// (smokeAdmission.ts `verifiedAdoption` / `adoptedRunResponse`). Every case
// below that tampers with the evidence must keep the old, fail-closed outcome.
//
// The real runner, run-agent handler, SQL admission gate, credit RPCs and
// PostgREST; the kill is emulated in-process (lib/discoveryScenario.ts).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { serviceClient, sql, uuid } from "./lib/harness.ts";
import { boundsHeld, runScenario, type Run } from "./lib/discoveryScenario.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const reconciliation = Deno.readTextFileSync(new URL("../../scripts/test-project/smoke-reconciliation.sql", import.meta.url));
const unreconciled = (queueId: string) => sql.unsafe(reconciliation.replace(":'queue_id'", `'${queueId}'`));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const JOBS_ACTOR = "apify:harvestapi~linkedin-job-search";
const posts = (r: Run, actor: string) => r.vendorRequests.filter((v) => v.method === "POST" && v.path.includes(actor)).length;
const logged = (r: Run, message: string) => (r.trace.admissions as Json[]).filter((a) => a.message === message);
const jobsOp = { kind: "provider", actor: JOBS_ACTOR };

async function credits(ws: string) {
  const rows = await sql`select id, idempotency_key, status, actual_credits, refunded_credits, rearm_count from public.credit_transactions where workspace_id = ${ws}`;
  const [b] = await sql`select balance_credits, reserved_credits from public.workspace_credit_balances where workspace_id = ${ws}`;
  const jobs = rows.find((t) => String(t.idempotency_key).includes(":apify_linkedin_job_search:"));
  return { rows, jobs, balance: b.balance_credits as number, reserved: b.reserved_credits as number };
}
async function ledgerCalls(taskId: string) {
  return await sql`select attempt_number, status, provider_run_id, dataset_id from public.lead_execution_calls
    where task_id = ${taskId} and record_kind = 'provider_call' and logical_call_key like '%:apify_linkedin_job_search:%' order by attempt_number`;
}
/** The dead slice's first purchase, recorded by the gate before the kill. */
const tamperJobsOperation = (fields: string) => async ({ m }: { m: Json }) => {
  await sql.unsafe(`update public.discovery_smoke_operations set ${fields}
    where authorization_id = '${m.authorizationId}' and kind = '${jobsOp.kind}' and actor = '${jobsOp.actor}'`);
};
/** The pre-fix outcome: the replayed start is never sent, never adopted, never refunded. */
function failedClosed(r: Run, why: string) {
  assertEquals(r.trace.killed_at, "jobs_run_id_write");
  assertEquals(posts(r, "linkedin-job-search"), 1, `${why}: the start is never sent again`);
  assertEquals(logged(r, "[smoke-admission] adopted"), [], `${why}: nothing is adopted`);
  assertEquals(r.outcome.qualified, [], `${why}: nothing qualifies without a verified run`);
  assert(!Object.values(r.outcome.credits).includes("refunded"), `${why}: nothing refunded`);
  boundsHeld(r);
}

Deno.test("adoption: killed before the run id reached the execution ledger — the next worker adopts the paid run, reads it and finishes; one purchase, one charge", opts, async () => {
  const r = await runScenario({ label: "kill-at-run-id-write", interrupt: "jobs_run_id_write" });
  assertEquals(r.trace.killed_at, "jobs_run_id_write");
  assertEquals(r.trace.resumed_from.checkpointed, false, "killed before the first checkpoint");
  const task = r.trace.resumed_from.task_id as string;

  // Exactly one authorized purchase per logical provider call.
  assertEquals(posts(r, "linkedin-job-search"), 1, "the job search is bought once");
  assertEquals(posts(r, "linkedin-company"), 1, "the details are bought once");
  assertEquals(r.of("provider").filter((o) => o.actor === JOBS_ACTOR).map((o) => o.provider_run_id), ["run-jobs"]);
  const adopted = logged(r, "[smoke-admission] adopted");
  assertEquals(adopted.length, 1, "the replayed start was answered by verified adoption");
  assertEquals([adopted[0].data.run_id, adopted[0].data.dataset_id], ["run-jobs", "dataset-jobs"]);
  assert(!r.refused.includes("adopt") && !r.refused.includes("uncertain"), `no replay stayed uncertain: ${JSON.stringify(r.refused)}`);

  // The execution ledger now names the run: the dead attempt stays as it was, the adopting attempt records it.
  const calls = await ledgerCalls(task);
  assertEquals(calls.map((c) => [c.attempt_number, c.status, c.provider_run_id]), [[1, "started", null], [2, "succeeded", "run-jobs"]]);
  assertEquals(calls[1].dataset_id, "dataset-jobs");

  // Credits: every provider call charged exactly once, nothing refunded, nothing left held.
  const c = await credits(r.m.ws);
  assertEquals(c.rows.map((t) => [t.status, t.actual_credits]).sort(), [["charged", 1], ["charged", 1]]);
  assertEquals([c.balance, c.reserved], [8, 0], "10 granted, 2 purchases, 0 held");

  // The dead slice's purchase is USED: the mission qualifies from it and completes.
  assertEquals(r.outcome.terminal, ["completed"]);
  assertEquals(r.outcome.qualified.length, 1);
  const leads = r.leads.map((l) => l.raw?.company_name);
  assertEquals(leads.length, new Set(leads).size, "no duplicate persisted leads");
  assertEquals((await sql`select status, generation from public.lead_lineages where lineage_id = ${task}`)[0]?.generation, 2);

  // Liability: one open entry per purchase, for the operator to reconcile against the vendor.
  const open = (await unreconciled(r.m.queueId)) as Json[];
  assertEquals(open.filter((o) => o.actor === JOBS_ACTOR).length, 1, "one job-search liability, not two");
  boundsHeld(r);

  // DUPLICATE SETTLEMENT / DELAYED REAPER: aged past the window and reaped, nothing changes.
  await sql`update public.credit_transactions set created_at = now() - interval '2 hours' where workspace_id = ${r.m.ws}`;
  await sql`select public.credits_release_stale(interval '30 minutes')`;
  const after = await credits(r.m.ws);
  assertEquals(after.rows.map((t) => t.status).sort(), ["charged", "charged"]);
  assertEquals([after.balance, after.reserved], [8, 0]);
  const replay = await (await serviceClient()).rpc("credits_finalize", { p_transaction_id: c.jobs!.id, p_actual: 1, p_status: "charged" });
  assertEquals((replay.data as Json)?.replayed, true, "a second settle is a replay");
  assertEquals((await credits(r.m.ws)).balance, 8);
});

Deno.test("adoption: a stale generation or another worker is never told to adopt", opts, async () => {
  const seen: Json[] = [];
  const r = await runScenario({
    label: "adopt-stale-generation", interrupt: "jobs_run_id_write",
    beforeResume: async ({ m, taskId }) => {
      const [op] = await sql`select operation_key, template_id, payload_hash, generation from public.discovery_smoke_operations
        where authorization_id = ${m.authorizationId} and actor = ${JOBS_ACTOR}`;
      // Straight to the database: the hook runs inside the mission's gated fetch.
      const ask = async (worker: string, generation: number) => {
        const [{ d }] = await sql`select public.admit_discovery_smoke(${m.queueId}::uuid, ${worker}::uuid, ${taskId}::uuid,
          ${generation}::integer, ${op.operation_key}, 'provider', ${JOBS_ACTOR}, ${op.template_id}, ${op.payload_hash}) as d`;
        return (d as Json)?.decision;
      };
      seen.push({ stale: await ask(m.workerId, op.generation - 1), stranger: await ask(uuid(), op.generation) });
    },
  });
  assertEquals(seen[0].stale, "stale_generation", "an older generation is refused before any replay lookup");
  assertEquals(seen[0].stranger, "lost_ownership", "a worker that does not hold the lease is refused");
  // The rightful next generation still adopts.
  assertEquals(logged(r, "[smoke-admission] adopted").length, 1);
  assertEquals(posts(r, "linkedin-job-search"), 1);
  boundsHeld(r);
});

Deno.test("adoption fails closed: the recorded run has no dataset id", opts, async () => {
  const r = await runScenario({ label: "adopt-no-dataset", interrupt: "jobs_run_id_write",
    beforeResume: tamperJobsOperation("provider_dataset_id = null") });
  failedClosed(r, "no dataset id");
  assertEquals(logged(r, "[smoke-admission] adoption not verified").map((a) => a.data.reason), ["dataset_id"]);
  assert(r.refused.includes("adopt"), "the replay is still the uncertain 503");
  assertEquals((await credits(r.m.ws)).jobs?.status, "reserved", "the uncertain purchase keeps its credit held (#88)");
});

Deno.test("adoption fails closed: no run id recorded — uncertain, never re-sent", opts, async () => {
  const r = await runScenario({ label: "adopt-no-run", interrupt: "jobs_run_id_write",
    beforeResume: tamperJobsOperation("provider_run_id = null, provider_dataset_id = null") });
  failedClosed(r, "no run id");
  assert(r.refused.includes("uncertain"), `the gate answers uncertain: ${JSON.stringify(r.refused)}`);
  assertEquals(logged(r, "[smoke-admission] adoption not verified"), [], "uncertain is never a candidate for adoption");
  assertEquals((await credits(r.m.ws)).jobs?.status, "reserved");
});

Deno.test("adoption fails closed: a malformed dataset id is never read or adopted", opts, async () => {
  const r = await runScenario({ label: "adopt-bad-dataset", interrupt: "jobs_run_id_write",
    beforeResume: tamperJobsOperation("provider_dataset_id = 'dataset-jobs/../other'") });
  failedClosed(r, "malformed dataset id");
  assertEquals(logged(r, "[smoke-admission] adoption not verified").map((a) => a.data.reason), ["dataset_id"]);
  assert(!r.vendorRequests.some((v) => v.path.includes("other")), "nothing outside the recorded purchase was requested");
});

Deno.test("adoption fails closed: the recorded purchase belongs to another task", opts, async () => {
  const r = await runScenario({ label: "adopt-other-task", interrupt: "jobs_run_id_write",
    beforeResume: tamperJobsOperation(`task_id = '${uuid()}'`) });
  failedClosed(r, "another task");
  assertEquals(logged(r, "[smoke-admission] adoption not verified").map((a) => a.data.reason), ["task"]);
});

Deno.test("adoption: a wrong but well-formed dataset id adopts the run, and the dataset the vendor names is never read without its purchase", opts, async () => {
  const r = await runScenario({ label: "adopt-wrong-dataset", interrupt: "jobs_run_id_write",
    beforeResume: tamperJobsOperation("provider_dataset_id = 'dataset-forged'") });
  // The run id is genuine, so the run is adopted, recorded and charged as bought...
  assertEquals(logged(r, "[smoke-admission] adopted").map((a) => a.data.dataset_id), ["dataset-forged"]);
  assertEquals(posts(r, "linkedin-job-search"), 1, "never bought again");
  assertEquals((await credits(r.m.ws)).jobs?.status, "charged", "the run exists and was bought");
  // ...but the status read names the run's real dataset, which no admitted purchase owns: refused, unread.
  assert(r.refused.includes("missing_parent"), `the unbound dataset read is refused: ${JSON.stringify(r.refused)}`);
  assert(!r.vendorRequests.some((v) => v.method === "GET" && v.path.includes("datasets/dataset-jobs")), "the unbound dataset was not read");
  assertEquals(r.outcome.qualified, [], "nothing qualifies from data it could not read");
  assert(!Object.values(r.outcome.credits).includes("refunded"));
  boundsHeld(r);
});

Deno.test("adoption fails closed: the authorization expired before the next worker", opts, async () => {
  const r = await runScenario({ label: "adopt-expired", interrupt: "jobs_run_id_write",
    beforeResume: async ({ m }) => {
      await sql`update public.discovery_smoke_authorizations set authorized_at = now() - interval '4 minutes',
                 deadline_at = now() - interval '1 second' where id = ${m.authorizationId}`;
    } });
  assertEquals(posts(r, "linkedin-job-search"), 1);
  assertEquals(logged(r, "[smoke-admission] adopted"), [], "an expired authorization adopts nothing");
  assertEquals(r.outcome.qualified, []);
  assert(!Object.values(r.outcome.credits).includes("refunded"));
  boundsHeld(r);
});

Deno.test("adoption: the reaper ran before the next worker — the adopted run is re-armed and charged once", opts, async () => {
  const r = await runScenario({ label: "adopt-after-reaper", interrupt: "jobs_run_id_write",
    beforeResume: async ({ m }) => {
      await sql`update public.credit_transactions set created_at = now() - interval '31 minutes' where workspace_id = ${m.ws}`;
      await sql`select public.credits_release_stale(interval '30 minutes')`;
      const [t] = await sql`select status from public.credit_transactions where workspace_id = ${m.ws} and idempotency_key like '%:apify_linkedin_job_search:%'`;
      assertEquals(t.status, "released", "no run id in the execution ledger: the reaper had no proof of purchase");
    } });
  assertEquals(logged(r, "[smoke-admission] adopted").length, 1);
  assertEquals(posts(r, "linkedin-job-search"), 1);
  const c = await credits(r.m.ws);
  assertEquals([c.jobs?.status, c.jobs?.actual_credits, c.jobs?.rearm_count], ["charged", 1, 1], "re-armed (held fix) and charged");
  assertEquals([c.balance, c.reserved], [8, 0], "two purchases, two credits, none refunded in the end");
  assertEquals(r.outcome.qualified.length, 1);
  boundsHeld(r);
});

Deno.test("adoption: the adopted run FAILED at the vendor — no second purchase, charged as started, nothing qualifies", opts, async () => {
  const r = await runScenario({ label: "adopt-run-failed", interrupt: "jobs_run_id_write", jobsStatus: "failed" });
  assertEquals(logged(r, "[smoke-admission] adopted").length, 1);
  assertEquals(posts(r, "linkedin-job-search"), 1, "a failed run is not bought again");
  assertEquals((await ledgerCalls(r.trace.resumed_from.task_id)).at(-1)?.provider_run_id, "run-jobs");
  assertEquals((await credits(r.m.ws)).jobs?.status, "charged", "a run that started is charged, as the live settle rules");
  assertEquals(r.outcome.qualified, []);
  boundsHeld(r);
});

Deno.test("adoption: the adopted run's status is unreadable — it stays pending, never re-bought, never refunded", opts, async () => {
  const r = await runScenario({ label: "adopt-status-unreadable", interrupt: "jobs_run_id_write", jobsStatus: "unreadable" });
  assertEquals(logged(r, "[smoke-admission] adopted").length, 1);
  assertEquals(posts(r, "linkedin-job-search"), 1);
  assertEquals((await ledgerCalls(r.trace.resumed_from.task_id)).at(-1)?.provider_run_id, "run-jobs", "the run id is recorded even so");
  assert(!Object.values(r.outcome.credits).includes("refunded"));
  assert(["charged", "reserved"].includes((await credits(r.m.ws)).jobs?.status), "never refunded");
  boundsHeld(r);
});
