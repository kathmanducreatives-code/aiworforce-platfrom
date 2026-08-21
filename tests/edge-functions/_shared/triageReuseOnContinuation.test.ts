// TRIAGE IS BOUGHT ONCE PER POOL, NOT ONCE PER SLICE.
//
// THE RUN THIS FILE EXISTS FOR — TEST plan b7a9e112, 2026-08-21, build
// c654895b. The run reached 9 of 10 qualified and spent 123 provider cost units
// doing it, with 74 of its 98 eligible companies never touched.
//
// `ensureMissionIntelligence` guards on `missionIntelligenceApplied`, a local of
// the current invocation. Its own comment says "idempotent, so a branch that
// already ran it pays nothing to ask again" — true WITHIN an invocation, and
// false across a checkpoint. So every continuation re-triaged the entire
// restored pool:
//
//     working_set_restored_from_checkpoint  restored: 100, snapshots_missing: 0
//     mission_intelligence_deferred_apply   companies: 100
//     triage_batch_complete   x4
//     triage_and_ranking_complete           ← 63 SECONDS LATER
//     identity_resolution_complete          targets: 23, attempted: 6, unattempted: 17
//
// Seven triage passes over the same hundred companies, six of them redundant:
// 24 model calls, costing 19 to 63 seconds of ~107-second slices. Identity
// resolution — which resolves 62% of what it actually attempts, with zero
// provider errors — inherited 11 to 17 seconds and reached 6 of 23 targets.
// That is the whole of the "identity bottleneck": the stage was starved, not
// slow.
//
// AND THE VERDICTS WERE NOT STABLE. Successive passes over one unchanged pool
// returned relevant 74, 74, 76, 76, 74, 76 — so `investigation_rank`, the
// cursor the frontier slice reads, moved underneath itself between slices.
//
// ZERO network, ZERO Actor runs, ZERO real model calls, ZERO database writes.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCapabilityPlan, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const MEMO23 = "apify_yc_companies_memo23";

const QUERY = "Find 10 qualified AI startups in the US currently hiring";
const mission = () => parseLeadMissionDeterministic(QUERY);

/** Thirty YC rows, so triage takes more than one batch of twenty-five. */
const ROWS = Array.from({ length: 30 }, (_, i) => ({
  name: `Acme${i}`, website: `https://acme${i}.com`, teamSize: 20 + i,
  batch: "W25", industries: ["B2B"], id: `acme${i}`,
  regions: ["United States of America"], isHiring: true,
  openJobs: [{ title: "Software Engineer" }],
})) as unknown as Record<string, unknown>[];

interface Rec { triageCalls: number; triagedKeys: string[] }

function deps(rec: Rec): CapabilityEngineDeps {
  return {
    planDiscovery: stubDiscoverySelector(),
    invoke: (call: CompiledActorCall<unknown>) =>
      Promise.resolve(call.actorKey === MEMO23 ? ROWS : []),
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    triageCompanies: ({ company_keys }: { company_keys: string[] }) => {
      rec.triageCalls++;
      rec.triagedKeys.push(...company_keys);
      return Promise.resolve({
        verdicts: company_keys.map((k) => ({
          company_key: k, relevance: "relevant", confidence: 0.9,
          signal_strength: 80, reasons: ["engineering hiring satisfies the mission"],
          matched_roles: ["engineer"],
        })),
      });
    },
  } as unknown as CapabilityEngineDeps;
}

/**
 * One invocation. Passing `prior` makes it a CONTINUATION — the state and the
 * per-company resume records together, which is what run-agent hands the engine
 * after reading the checkpoint back.
 */
async function run(prior?: {
  state: unknown;
  resume_records: readonly unknown[];
}) {
  const rec: Rec = { triageCalls: 0, triagedKeys: [] };
  const m = mission();
  const out = await runCapabilityPlan(deps(rec) as never, {
    mission: m, plan: buildCapabilityGraph(m), maxCandidates: 40,
    ...(prior
      ? {
        state: prior.state,
        resume: {
          workspace_id: "ws-test",
          lineage_root_task_id: "task-root",
          records: prior.resume_records,
        },
      }
      : {}),
    readEnv: (k: string) => k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined,
  } as never);
  return { out, ...rec };
}

/** The checkpoint as it really travels: through a jsonb column. */
const checkpointOf = (r: Awaited<ReturnType<typeof run>>) =>
  JSON.parse(JSON.stringify({
    state: r.out.state, resume_records: r.out.resume_records,
  })) as { state: unknown; resume_records: unknown[] };

// ═══ 1. THE FIRST PASS STILL BUYS IT ═══════════════════════════════════════

Deno.test("1. a fresh pool is triaged, in batches, exactly once", async () => {
  const first = await run();
  assert(first.triageCalls > 0, "triage must still happen on a pool nobody has judged");
  assertEquals(first.triagedKeys.length, 30, "every company is judged, once");
  assertEquals(new Set(first.triagedKeys).size, 30, "and no company twice");
});

// ═══ 2. THE CONTINUATION DOES NOT BUY IT AGAIN ═════════════════════════════

Deno.test("2. a continuation re-triages NOBODY — this is the 63 seconds", async () => {
  const first = await run();
  const second = await run(checkpointOf(first));

  assertEquals(second.triageCalls, 0,
    "every verdict came back in the checkpoint; re-buying them is what starved identity resolution");
  assertEquals(second.triagedKeys, []);
});

Deno.test("3. and the restored verdicts are still THERE, not wiped", async () => {
  const first = await run();
  const second = await run(checkpointOf(first));

  assertEquals(second.out.companies.length, 30,
    "the continuation restored the pool — without this the rest is vacuous");
  const judged = second.out.companies.filter((c) => c.triage !== null);
  assertEquals(judged.length, 30,
    "a company whose verdict was not re-fetched must keep the one it arrived with");
  assertEquals(second.out.state.triage?.relevant, 30,
    "the summary still describes the whole pool, not the empty set of new work");
});

Deno.test("4. the ranking a continuation reads is the SAME ranking", async () => {
  const first = await run();
  const second = await run(checkpointOf(first));

  const rankOf = (r: Awaited<ReturnType<typeof run>>) =>
    r.out.companies.map((c) => [c.key, c.investigation_rank] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));

  assertEquals(rankOf(second), rankOf(first),
    "re-triaging moved investigation_rank between slices — the frontier cursor's own order");
});

// ═══ 3. A PARTIALLY-TRIAGED POOL BUYS ONLY THE REST ════════════════════════

Deno.test("5. only the companies WITHOUT a verdict are batched", async () => {
  const first = await run();
  const prior = checkpointOf(first);

  // Ten records come back without a verdict — the shape of a checkpoint
  // written when the batch budget ran out mid-pass, or of a pool discovery has
  // since added to.
  const stripped = new Set<string>();
  for (const raw of prior.resume_records.slice(0, 10)) {
    const r = raw as { company_key: string; snapshot?: { triage?: unknown } | null };
    if (r.snapshot) { r.snapshot.triage = null; stripped.add(r.company_key); }
  }
  assertEquals(stripped.size, 10);

  const second = await run(prior);

  assert(second.triageCalls > 0, "the ten unjudged companies still need judging");
  assertEquals(new Set(second.triagedKeys), stripped,
    "exactly the unjudged ten were sent, and not one company that already had a verdict");
  assertEquals(second.out.companies.filter((c) => c.triage !== null).length, 30,
    "and the pool is fully judged again afterwards");
});
