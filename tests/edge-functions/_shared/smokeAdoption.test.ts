// The gate adopts a run a dead slice already bought only when every part of the
// evidence binds it to THIS start: the operation asked for, well-formed run and
// dataset ids, and the operation row read again — same Apify purchase, same
// task, an earlier or equal generation, the same run and dataset. Everything
// else keeps the 503 (uncertain, unsent). End to end, against real Postgres and
// PostgREST: tests/db-contract/killResumeAdoption.contract.test.ts.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  adoptedRunResponse, refusal, verifiedAdoption, type AdmissionDb, type AdoptionBinding,
} from "../../../supabase/functions/_shared/smokeAdmission.ts";

const KEY = `provider:apify:harvestapi~linkedin-job-search:${"a".repeat(64)}`;
const BIND: AdoptionBinding = {
  authorizationId: "auth-1", key: KEY, actor: "apify:harvestapi~linkedin-job-search",
  payloadHash: "a".repeat(64), taskId: "task-1", generation: 2,
};
const ROW = {
  operation_key: KEY, kind: "provider", actor: BIND.actor, payload_hash: BIND.payloadHash,
  task_id: "task-1", generation: 1, provider_run_id: "run-jobs", provider_dataset_id: "dataset-jobs",
};
const ADOPT = { decision: "adopt", operation_key: KEY, provider_run_id: "run-jobs", provider_dataset_id: "dataset-jobs" };

/** Answers the one row read; records the filters it was asked with. */
function rowDb(row: unknown, seen: Array<[string, unknown]> = []): AdmissionDb {
  const chain = {
    eq: (c: string, v: unknown) => { seen.push([c, v]); return chain; },
    maybeSingle: async () => row instanceof Error ? { data: null, error: { message: row.message } } : { data: row, error: null },
  };
  return {
    rpc: () => { throw new Error("verification never admits"); },
    from: (t: string) => { assertEquals(t, "discovery_smoke_operations"); return { select: () => chain }; },
  } as unknown as AdmissionDb;
}

Deno.test("adoption: verified when the answer and the operation row name the same purchase, task and run", async () => {
  const seen: Array<[string, unknown]> = [];
  const v = await verifiedAdoption(rowDb(ROW, seen), BIND, ADOPT);
  assertEquals(v, { ok: true, runId: "run-jobs", datasetId: "dataset-jobs" });
  assertEquals(seen, [["authorization_id", "auth-1"], ["operation_key", KEY]], "read by this authorization and this operation only");
});

Deno.test("adoption: repeated adoption is the same answer and reads, never writes or admits", async () => {
  const db = rowDb(ROW);
  const a = await verifiedAdoption(db, BIND, ADOPT);
  const b = await verifiedAdoption(db, BIND, ADOPT);
  assertEquals(a, b);
});

Deno.test("adoption: the answer itself must be complete and well-formed", async () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["an uncertain decision", { ...ADOPT, decision: "uncertain" }, "not_adopt"],
    ["another operation", { ...ADOPT, operation_key: "provider:apify:other:" + "b".repeat(64) }, "operation_key"],
    ["missing run id", { ...ADOPT, provider_run_id: null }, "run_id"],
    ["empty run id", { ...ADOPT, provider_run_id: "" }, "run_id"],
    ["run id with a path", { ...ADOPT, provider_run_id: "run-jobs/../x" }, "run_id"],
    ["run id with a query", { ...ADOPT, provider_run_id: "run?token=x" }, "run_id"],
    ["missing dataset id", { ...ADOPT, provider_dataset_id: null }, "dataset_id"],
    ["dataset id with a path", { ...ADOPT, provider_dataset_id: "../datasets/other" }, "dataset_id"],
    ["non-string run id", { ...ADOPT, provider_run_id: 7 }, "run_id"],
  ];
  for (const [why, d, reason] of cases) {
    assertEquals(await verifiedAdoption(rowDb(ROW), BIND, d), { ok: false, reason }, why);
  }
});

Deno.test("adoption: the operation row must be this start's purchase, of this task, bought no later than now", async () => {
  const cases: Array<[string, unknown, string]> = [
    ["unreadable row", new Error("boom"), "operation_unreadable"],
    ["no row", null, "operation_missing"],
    ["a poll, not a purchase", { ...ROW, kind: "poll" }, "operation_identity"],
    ["another actor", { ...ROW, actor: "apify:harvestapi~linkedin-company" }, "operation_identity"],
    ["another payload fingerprint", { ...ROW, payload_hash: "b".repeat(64) }, "operation_identity"],
    ["another task", { ...ROW, task_id: "task-2" }, "task"],
    ["a later generation", { ...ROW, generation: 3 }, "generation"],
    ["no generation", { ...ROW, generation: null }, "generation"],
    ["a conflicting run id", { ...ROW, provider_run_id: "run-other" }, "run_conflict"],
    ["a run id no longer recorded", { ...ROW, provider_run_id: null }, "run_conflict"],
    ["a wrong dataset id", { ...ROW, provider_dataset_id: "dataset-other" }, "dataset_conflict"],
  ];
  for (const [why, row, reason] of cases) {
    assertEquals(await verifiedAdoption(rowDb(row), BIND, ADOPT), { ok: false, reason }, why);
  }
  // The same generation (a replay within the slice that bought it) is still the same purchase.
  assert((await verifiedAdoption(rowDb({ ...ROW, generation: 2 }), BIND, ADOPT)).ok);
});

Deno.test("adoption: the response is Apify's own start shape, identity only, and marked adopted", async () => {
  const r = adoptedRunResponse("run-jobs", "dataset-jobs");
  assertEquals(r.status, 201);
  assert(r.ok, "a 2xx: the transport reads it as a run that exists");
  assertEquals(r.headers.get("x-agentory-admission"), "adopted");
  const body = await r.json();
  assertEquals(body, { data: { id: "run-jobs", defaultDatasetId: "dataset-jobs" } });
  assert(!("status" in body.data), "no status: the run's real status is read through an admitted poll");
  // Unverified adoption is still the uncertain refusal, unchanged.
  assertEquals(refusal("adopt").status, 503);
});
