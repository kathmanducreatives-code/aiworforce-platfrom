// THE SAME BATCH, BOUGHT TWICE, SIXTY-SIX SECONDS APART.
//
// Task 40800420 → 084fb495, 2026-08-29:
//
//   10:32:38  CHECKPOINT written  ("50 companies found, 10 shortlisted")
//   10:32:47  Ssq58eSYr56xIEQWa  [storm4, intelletec-ltd, odiin]  4 rows  $0.018
//   10:33:14  4LfrXM2viPf7imV8O  [pursuit-sales-solutions]        pending
//             ── isolate killed, no further checkpoint ──
//   10:33:53  fBw22Fhca4Bp4ZeXj  [storm4, intelletec-ltd, odiin]  5 rows  $0.021
//   10:34:24  dmg4fA80ZifpNeypw  [pursuit, hirefeedd, talentoma]  pending
//
// Both checkpoints carry `completed_operations: 0` for all three companies, and
// `snapshot.hiring_assessment: 0 of 50`. Two separate defects:
//
// ── 1. AN ANSWER WAS NOT DURABLE UNTIL THE STAGE ENDED ─────────────────────
//
// Verdicts were computed after EVERY batch and published once at the end. A
// slice killed between the two lost the verdicts AND the operation keys — so
// the continuation had nothing to skip on and re-bought an answered question.
// `expiredForDurableStart` already applies "persist before you can lose it" to
// the POST; the response had no counterpart.
//
// ── 2. A RE-COMPOSED BATCH CANNOT ADOPT ────────────────────────────────────
//
// Adoption matches the fingerprint of the whole compiled input. Resolve one
// more identity and every group shifts, so a finished paid run is passed over.
// `hiringOperationKey` already reasons this way from the other side — keyed per
// company because "batch composition changes between slices".
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recoverPendingRuns } from "../../../supabase/functions/_shared/pendingRunRecovery.ts";
import {
  newExecutionState, runCapabilityPlan, restoreWorkingSet,
  type CapabilityEngineDeps, type CheckpointSnapshot,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { missionHash, type LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import type { CompanyResumeRecord } from "../../../supabase/functions/_shared/leadResumeState.ts";
import { stubMissionEvaluator } from "./missionEvaluatorFixture.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";
import {
  RUN_02EA3AED_COMPANIES, RUN_02EA3AED_STATE,
} from "../../fixtures/run02ea3aedCheckpoint.ts";
import {
  RUN_A76C7B4C_MISSION,
} from "../../fixtures/runA76c7b4cResumeState.ts";

const ENGINE = Deno.readTextFileSync(
  new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));

/** The hiring stage's batch loop, as source. */
const batchLoop = (): string => {
  const i = ENGINE.indexOf("for (let i = 0; i < batches.length; i++)");
  assert(i > 0, "the hiring stage must batch its calls");
  return ENGINE.slice(i, ENGINE.indexOf("for (const c of targets) {", i));
};

// ── 1. the answer is written down before the next call can kill it ─────────

Deno.test("1. REGRESSION: a batch is decided and checkpointed before the next starts", () => {
  const block = batchLoop();
  const assessAt = block.indexOf("for (const g of group) assessOne(g.c);");
  const publishAt = block.indexOf('await publish("hiring_verified");');
  assert(assessAt > 0,
    "each batch must be decided where it is answered, not after every batch");
  assert(publishAt > assessAt,
    "and checkpointed AFTER the verdicts exist, or the write saves nothing new");

  // The operation keys must already be recorded when that checkpoint is taken —
  // they are what stops the next slice re-buying the question.
  const opsAt = block.indexOf("g.c.completed_operations.push(g.opKey)");
  assert(opsAt > 0 && opsAt < publishAt,
    "the purchase ledger must be inside the same durable point as the verdict");
});

Deno.test("2. and a company already decided is never decided twice", () => {
  assert(ENGINE.includes("if (assessed.has(c.key)) return;"),
    "the per-batch pass and the final sweep must not both write a verdict");
  assert(ENGINE.includes("assessed.add(c.key);"));
});

// ── 3. the batch that is in flight is re-formed exactly ────────────────────

Deno.test("3. REGRESSION: a pending run's batch is re-formed before anything else", () => {
  const i = ENGINE.indexOf("const inFlightGroups");
  assert(i > 0, "in-flight batches must be re-formed");
  const block = ENGINE.slice(i, ENGINE.indexOf("for (let i = 0; i < batches.length; i++)", i));
  assert(block.includes('r.provider !== "apify_linkedin_job_search"'),
    "scoped to the provider whose batches move");
  assert(block.includes("const batches"), "and the loop runs over the prepared list");
  assert(block.includes("if (reformed.some((x) => !x)) continue;"),
    "EVERY company must still be waiting, or this is a different question and " +
    "adopting its answer would attribute one batch's rows to another");
});

Deno.test("4. the run records who it asked about, so it can be re-formed", () => {
  assert(ENGINE.includes("company_keys: [...group]"),
    "a pending entry must carry its batch composition");
  assert(ENGINE.includes("undefined, group.map((g) => g.c.key)"),
    "and the hiring call must pass it");
});

// ── 5. and a run recovered from the ledger is re-formable too ──────────────

Deno.test("5. REGRESSION: recovery reads the batch out of the input it was started with", () => {
  // The exact ledger row task 40800420 left behind.
  const recovered = recoverPendingRuns([{
    capability: "apify_linkedin_job_search",
    provider_run_id: "4LfrXM2viPf7imV8O",
    dataset_id: "S3FRrK0BzYY0f9DQ6",
    status: "started",
    started_at: "2026-08-29T10:33:14.528+00:00",
    request_input: {
      input: {
        company: ["https://www.linkedin.com/company/pursuit-sales-solutions"],
        maxItems: 10, jobTitles: ["sdr", "account executive"],
      },
    },
    // deno-lint-ignore no-explicit-any
  } as any]);

  assertEquals(recovered.length, 1);
  assertEquals(recovered[0].run_id, "4LfrXM2viPf7imV8O");
  assertEquals(recovered[0].company_keys,
    ["https://www.linkedin.com/company/pursuit-sales-solutions"],
    "without this the continuation batches [pursuit, hirefeedd, talentoma], " +
    "the fingerprint misses, and a paid run is left unread");
  assert(recovered[0].input_fingerprint, "the fingerprint is still what adoption matches");
});

Deno.test("6. a row with no company list still recovers, just not re-formable", () => {
  const recovered = recoverPendingRuns([{
    capability: "apify_linkedin_company_search",
    provider_run_id: "R1", dataset_id: "D1", status: "started",
    request_input: { input: { searchQuery: "acme" } },
    // deno-lint-ignore no-explicit-any
  } as any]);
  assertEquals(recovered.length, 1);
  assertEquals(recovered[0].company_keys, undefined,
    "absent rather than empty — an empty list would re-form an empty batch");
});

// ══════════════════ 7-9. THE SAME THING, PROVED THROUGH THE REAL ENGINE ══

const MISSION = RUN_A76C7B4C_MISSION as LeadMissionV1;

/** One harvestapi job row naming its company, in the Actor's own shape. */
const jobRow = (slug: string, title: string) => ({
  id: `${slug}-${title}`, title,
  linkedinUrl: `https://www.linkedin.com/jobs/view/${slug}`,
  location: { linkedinText: "United States" },
  company: { id: slug, name: slug,
    linkedinUrl: `https://www.linkedin.com/company/${slug}` },
  postedDate: "2026-08-25T00:00:00.000Z",
});

/**
 * Run the hiring stage from the frozen production pool.
 *
 * `records` is the checkpoint the slice starts from; `askedCompanies` collects
 * every company the provider is actually asked about, which is the number that
 * decides whether a question was bought twice.
 */
async function slice(records: readonly CompanyResumeRecord[], opts: {
  answer?: boolean;
  pendingRuns?: Array<Record<string, unknown>>;
} = {}) {
  const plan = buildCapabilityGraph(MISSION);
  const state = newExecutionState(plan, await missionHash(MISSION));
  state.completed_capabilities = ["general_company_discovery", "company_enrichment"];
  state.pending_capabilities = plan.steps.map((s) => s.capability)
    .filter((c) => !state.completed_capabilities.includes(c));
  // deno-lint-ignore no-explicit-any
  if (opts.pendingRuns) state.pending_runs = opts.pendingRuns as any;

  const asked: string[][] = [];
  const checkpoints: CheckpointSnapshot[] = [];
  const deps: CapabilityEngineDeps = {
    planDiscovery: stubDiscoverySelector(),
    evaluateMission: stubMissionEvaluator(),
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    onCheckpoint: (snap) => { checkpoints.push(snap); },
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey !== "apify_linkedin_job_search") return Promise.resolve([]);
      const companies = (call.input as { company?: string[] }).company ?? [];
      asked.push(companies);
      if (opts.answer === false) return Promise.resolve([]);
      return Promise.resolve(companies.flatMap((u) => {
        const slug = u.split("/company/")[1] ?? "";
        return [jobRow(slug, "Account Executive")];
      }));
    },
  };
  const run = await runCapabilityPlan(deps, {
    mission: MISSION, plan, state,
    resume: {
      workspace_id: "ws", lineage_root_task_id: "root",
      records: records as CompanyResumeRecord[],
    },
  });
  return { run, asked, checkpoints };
}

const FROZEN = RUN_02EA3AED_COMPANIES as unknown as CompanyResumeRecord[];

Deno.test("7. a batch's verdict and its receipt are BOTH in a checkpoint", async () => {
  const { checkpoints, asked } = await slice(FROZEN);
  assert(asked.length > 0, "the provider must have been asked something");

  // The companies the provider answered about, from the calls actually made.
  const answered = new Set(asked.flat().map(
    (u) => u.toLowerCase().replace(/\/$/, "")));
  assert(answered.size > 0);

  // EVERY checkpoint after the first answered batch must already carry both.
  const last = checkpoints[checkpoints.length - 1];
  assert(last, "the stage must checkpoint");
  const recs = last.resume_records.filter((r) => answered.has(r.company_key));
  assert(recs.length > 0, "the answered companies must be in the checkpoint");
  for (const r of recs) {
    assert(r.snapshot?.hiring_assessment,
      `${r.company_key}: the verdict must be durable, not held in memory`);
    assert(r.completed_operations.some((o) => o.includes("hiring_verification")),
      `${r.company_key}: the receipt must be durable, or the next slice re-buys`);
  }
});

Deno.test("8. REGRESSION: the next slice does not buy an answered question again", async () => {
  const first = await slice(FROZEN);
  const carried = first.checkpoints[first.checkpoints.length - 1].resume_records;
  const answered = new Set(first.asked.flat().map(
    (u) => u.toLowerCase().replace(/\/$/, "")));

  const second = await slice(carried);
  const askedAgain = second.asked.flat().map((u) => u.toLowerCase().replace(/\/$/, ""))
    .filter((u) => answered.has(u));
  assertEquals(askedAgain, [],
    "task 40800420 paid $0.018 for [storm4, intelletec-ltd, odiin] and its " +
    "continuation paid $0.021 for exactly the same three");
});

Deno.test("9. REGRESSION: an in-flight batch is re-formed, not re-composed", async () => {
  // A run pending for two companies that a fresh batching pass would split up.
  const first = await slice(FROZEN, { answer: false });
  const someKeys = first.asked.flat().slice(0, 2);
  assert(someKeys.length === 2, "need a two-company batch to reform");

  const { asked } = await slice(FROZEN, {
    pendingRuns: [{
      capability: null, provider: "apify_linkedin_job_search",
      run_id: "PENDING1", dataset_id: "DS1", actor_build_id: null,
      started_at: new Date(0).toISOString(),
      input_fingerprint: "whatever", company_keys: someKeys,
      recovered_from_ledger: true,
    }],
  });
  assertEquals(asked[0], someKeys,
    "the first call must ask the pending run's exact question, in its order — " +
    "that is what makes the fingerprint match and the run adoptable");
});
