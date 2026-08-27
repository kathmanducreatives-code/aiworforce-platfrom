// ADOPTING A RUN IS A RE-READ, AND THE BOOKS MUST SAY SO.
//
// Run fafd9912's resumed slice adopted Apify run `ub2qunSMAKTNf5AKv` — a GET on
// a run POSTed and charged an hour earlier — and the persisted state recorded:
//
//   { outcome: "run_adopted", rows: 25, cost_units: 0 }
//   { outcome: "ok",          rows: 25, cost_units: 1 }   ← the same one call
//
// Two defects, both bookkeeping rather than money:
//
//   1. `accumulated_cost_units` counted a free read as spend. That number is
//      the lineage ceiling `decideAutoContinuation` stops on, so the run was
//      being billed budget it had not used. Credits were never affected —
//      `authorizeProviderCall` is keyed by `logical_call_key`, so no second
//      reservation was ever made — which is why it went unnoticed.
//
//   2. The `lead_execution_calls` row for the adopted run stayed `status:
//      "started"` for ever. Adoption cannot insert its own row: the resumed
//      call computes the SAME `logical_call_key`, the unique index rejects it,
//      and `withExecutionAudit` logs and drops the error by design. So a run
//      that had been read kept advertising itself to `recoverPendingRuns` as
//      outstanding paid work.
//
// THE FINGERPRINTS HERE ARE THE ENGINE'S OWN. The first pass is made to go
// pending, and the `pending_runs` entry it writes — real run id, real
// fingerprint — is fed straight back into the second pass. Nothing is
// hand-computed, so this cannot pass against a fingerprint rule it does not
// actually implement.
//
// Every Actor is a mock. ZERO network, ZERO Actor runs, ZERO model calls.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  runCapabilityPlan, type CapabilityEngineDeps, type CapabilityExecutionState,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubMissionEvaluator } from "./missionEvaluatorFixture.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

const CANONICAL =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
const mission = (): LeadMissionV1 => parseLeadMissionDeterministic(CANONICAL);
const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

const YC_ROW = {
  id: "sortly", name: "Sortly", website: "https://sortly.com",
  industry: "B2B", industries: ["B2B"], batch: "W22", teamSize: 42,
  oneLiner: "Sortly is a B2B SaaS platform.",
  allLocations: "San Francisco, CA, USA",
  openJobs: [{ title: "Revenue Operations Manager", url: "https://x/sortly/1" }],
};

/** The error shape a pending Apify run raises, and what reads it. */
const PENDING_RUN = {
  run_id: "ub2qunSMAKTNf5AKv",
  dataset_id: "TqElXPkmo7E5Fnu43",
  cost_units: 1,
};
class PendingError extends Error {}

const baseDeps = (over: Partial<CapabilityEngineDeps> = {}): CapabilityEngineDeps => ({
  invoke: (_c: CompiledActorCall<unknown>) => Promise.resolve([]),
  verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  evaluateMission: stubMissionEvaluator(),
  ...over,
});

/**
 * PASS ONE — the discovery call goes pending, exactly as a killed poll leaves it.
 * Returns the state the engine checkpointed, fingerprints and all.
 */
async function passOneLeavesPending(): Promise<CapabilityExecutionState> {
  const m = mission();
  const run = await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    ...baseDeps({
      invoke: (c: CompiledActorCall<unknown>) => {
        if (c.actorKey === "apify_yc_companies_memo23") {
          return Promise.reject(new PendingError("run started"));
        }
        return Promise.resolve([]);
      },
      readPendingRun: (e) => e instanceof PendingError ? PENDING_RUN : null,
    }),
  }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN });
  return run.state;
}

Deno.test("precondition: a killed poll checkpoints a real pending run", async () => {
  const state = await passOneLeavesPending();
  const p = state.pending_runs.find((r) => r.run_id === PENDING_RUN.run_id);
  assert(p, "the engine must checkpoint the run it started");
  assert(p!.input_fingerprint, "and the input that started it");
  // The pending attempt DID charge — the POST is real spend.
  const pending = state.provider_attempts.find((a) => a.outcome === "pending");
  assert(pending, "the started run is recorded as pending");
  assertEquals(pending!.cost_units, 1, "starting a run costs a unit");
  assertEquals(state.accumulated_cost_units, 1);
});

/** PASS TWO — the same question, resumed against that checkpoint. */
async function passTwoAdopts(over: Partial<CapabilityEngineDeps> = {}) {
  const priorState = await passOneLeavesPending();
  const m = mission();
  const adopted: Array<Record<string, unknown>> = [];
  const resumeIds: Array<string | undefined> = [];
  const run = await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    ...baseDeps({
      invoke: (c: CompiledActorCall<unknown>) => {
        resumeIds.push((c as unknown as { resumeRunId?: string }).resumeRunId);
        if (c.actorKey === "apify_yc_companies_memo23") return Promise.resolve([YC_ROW]);
        return Promise.resolve([]);
      },
      readPendingRun: () => null,
      onRunAdopted: (info) => { adopted.push({ ...info }); },
      ...over,
    }),
  }, {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
    state: { ...priorState, accumulated_cost_units: 0, provider_attempts: [] },
  });
  return { run, adopted, resumeIds, priorState };
}

// ══ 1. AN ADOPTED RUN ADDS NOTHING TO THE LINEAGE'S COST ═══════════════════

Deno.test("1. adopting a run charges ZERO new cost units", async () => {
  const { run } = await passTwoAdopts();
  const memo = run.state.provider_attempts
    .filter((a) => a.provider === "apify_yc_companies_memo23");
  const adoptedAttempt = memo.find((a) => a.outcome === "run_adopted");
  assert(adoptedAttempt, "the adoption must be recorded");
  assertEquals(adoptedAttempt!.cost_units, 0);

  // AND THE `ok` FOR THE SAME CALL. This is the one that was wrong: the engine
  // records both, and only the first had been zeroed.
  const okAttempt = memo.find((a) => a.outcome === "ok");
  assert(okAttempt, "the call still reports that it returned rows");
  assertEquals(okAttempt!.cost_units, 0, "a re-read of a paid run is not a purchase");

  assertEquals(
    memo.reduce((n, a) => n + a.cost_units, 0), 0,
    "no attempt for an adopted call may carry cost",
  );

  // AND THAT ZERO REACHES THE LINEAGE TOTAL. Downstream capabilities in this
  // run make real calls and are charged for them, so the total is not zero —
  // what must hold is that it is exactly the sum of the attempts, which are
  // individually zero for the adopted one. Asserting the total alone would
  // have passed before the fix too, when attempt and total agreed on 1.
  const attemptSum = run.state.provider_attempts
    .reduce((n, a) => n + a.cost_units, 0);
  assertEquals(run.state.accumulated_cost_units, attemptSum,
    "the running total and the attempts must describe the same spend");
});

Deno.test("2. a call that really POSTs is still charged", async () => {
  // The guard against fixing the overcount by simply never charging.
  const m = mission();
  const run = await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    ...baseDeps({
      invoke: (c: CompiledActorCall<unknown>) =>
        Promise.resolve(c.actorKey === "apify_yc_companies_memo23" ? [YC_ROW] : []),
    }),
  }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN });
  const memo = run.state.provider_attempts
    .find((a) => a.provider === "apify_yc_companies_memo23" && a.outcome === "ok");
  assert(memo, "a normal call must still be recorded");
  assertEquals(memo!.cost_units, 1, "a genuine POST costs a unit");
  assert(run.state.accumulated_cost_units >= 1);
});

// ══ 2. THE LEDGER ROW IS SETTLED ═══════════════════════════════════════════

Deno.test("3. adoption reports the run so its ledger row can be settled", async () => {
  const { adopted } = await passTwoAdopts();
  assertEquals(adopted.length, 1, "exactly once, for the run that was adopted");
  assertEquals(adopted[0].run_id, PENDING_RUN.run_id);
  assertEquals(adopted[0].dataset_id, PENDING_RUN.dataset_id);
  assertEquals(adopted[0].provider, "apify_yc_companies_memo23");
  assertEquals(adopted[0].rows, 1, "and how much was read, for raw_count");
});

Deno.test("4. a run is adopted by a GET, never a second POST", async () => {
  const { resumeIds } = await passTwoAdopts();
  assert(resumeIds.includes(PENDING_RUN.run_id),
    "the adopted run id must reach the provider as resumeRunId");
});

Deno.test("5. the adopted run leaves pending_runs", async () => {
  const { run } = await passTwoAdopts();
  assertEquals(
    run.state.pending_runs.some((r) => r.run_id === PENDING_RUN.run_id), false,
    "a resolved run must stop advertising itself as recoverable",
  );
});

Deno.test("6. no adoption, no hook and no free pass", async () => {
  // A first run with nothing checkpointed must behave exactly as before.
  const m = mission();
  const adopted: unknown[] = [];
  const run = await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    ...baseDeps({
      invoke: (c: CompiledActorCall<unknown>) =>
        Promise.resolve(c.actorKey === "apify_yc_companies_memo23" ? [YC_ROW] : []),
      onRunAdopted: (i) => { adopted.push(i); },
    }),
  }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN });
  assertEquals(adopted.length, 0);
  assert(run.state.accumulated_cost_units >= 1, "and the call is charged");
});

Deno.test("7. a caller that supplies no hook still adopts correctly", async () => {
  // `onRunAdopted` is optional; omitting it must not break adoption, because
  // every existing caller and test omits it.
  const { run } = await passTwoAdopts({ onRunAdopted: undefined });
  assert(
    run.state.provider_attempts.some((a) => a.outcome === "run_adopted"),
    "adoption is independent of the bookkeeping hook",
  );
  assertEquals(
    run.state.provider_attempts
      .filter((a) => a.provider === "apify_yc_companies_memo23")
      .reduce((n, a) => n + a.cost_units, 0),
    0,
    "and so is the zero charge",
  );
});

// ══ THE CALL SITE ══════════════════════════════════════════════════════════

Deno.test("run-agent settles only a genuinely open row, and only its own", async () => {
  const RUN = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  const i = RUN.indexOf("onRunAdopted: async (info) =>");
  assert(i > 0, "the settle must be wired");
  const block = RUN.slice(i, i + 1400);
  assert(block.includes('status: "succeeded"'), "the row stops saying started");
  assert(block.includes('reason: "resumed_run"'), "and says how it finished");
  assert(block.includes("raw_count: info.rows"));
  // SCOPE. A settle that could touch another workspace's row, another task's
  // row, or an already-settled row would be worse than the stale status.
  assert(block.includes('.eq("provider_run_id", info.run_id)'));
  assert(block.includes('.eq("task_id", task.id)'));
  assert(block.includes('.eq("workspace_id", workspace_id)'));
  assert(block.includes('.eq("status", "started")'),
    "it may only ever CLOSE an open row, never reopen or overwrite a settled one");
});
