// 100 DISCOVERED, 10 INVESTIGATED, 2 QUALIFIED, 90 STRANDED FOREVER.
//
// THE DEFECT.
//
// The shortlist was a ONE-TIME PARTITION computed inside the discovery
// capability. A resumed run skips completed capabilities, so it was computed
// exactly once per lineage — a run that discovered 100 companies, investigated
// the 10 the budget allowed and qualified 2 could never look at the other 90.
// Not on a continuation. Not ever.
//
// And it did not fail quietly. Those 90 were checkpointed with
// `identity: "not_started"`, which `nextStageFor` reads as "still owes
// identity", so `buildCheckpoint` listed all 90 in `pending_company_keys` and
// set `continuation_required`. The product offered "Continue verification"
// forever, and every continuation restored the same frozen shortlist and did
// nothing for them.
//
// TWO CONCEPTS WERE ONE BOOLEAN. `shortlisted: false` meant both "GPT judged
// this irrelevant" (a decision, permanent) and "the budget stopped at ten" (a
// queue position, temporary). The first must close a company; the second must
// survive to the next pass.
//
// THE FIX, IN THREE PARTS, EACH PINNED BELOW:
//
//   1. `investigation_state` — pending / in_flight / investigated / excluded
//   2. selection is a per-pass SLICE over a persisted ranking, taken on every
//      pass and every continuation, not once inside discovery
//   3. a YIELD GATE — 2 of 10 with frontier remaining is not a finished run
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MAX_INVESTIGATION_PASSES, asInvestigationState, isFrontier,
  selectInvestigationSlice, shouldTakeAnotherSlice, wasInvestigated,
  type FrontierCandidate,
} from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  runCapabilityPlan, toResumeRecord, missionFunnelFor,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { funnelIsBalanced, unbalancedStages } from "../../../supabase/functions/_shared/leadMissionFunnel.ts";
import {
  createExecutionDeadline,
} from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import { stubMissionEvaluator } from "./missionEvaluatorFixture.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

// ═════════════════════════ 1. the frontier is a state, not a boolean ════════

Deno.test("1. only a DECISION closes a company; a budget position does not", () => {
  assert(isFrontier("pending_investigation"));
  assertFalse(isFrontier("excluded_permanently"),
    "GPT said irrelevant — that is a decision and it is final");
  assertFalse(isFrontier("investigated"));
  assertFalse(isFrontier("in_flight"));

  // `shortlisted` is the derived view: anything money was spent on.
  assert(wasInvestigated("in_flight"));
  assert(wasInvestigated("investigated"));
  assertFalse(wasInvestigated("pending_investigation"),
    "a company still waiting has had nothing spent on it");
});

Deno.test("1b. an unknown or absent state returns a company to the FRONTIER", () => {
  // BACKWARD COMPATIBILITY IN THE SAFE DIRECTION. A checkpoint written before
  // the frontier existed carries no state; reading that as `excluded` would
  // strand exactly the companies this change exists to recover.
  for (const bad of [null, undefined, "", "shortlisted", 42, {}]) {
    assertEquals(asInvestigationState(bad), "pending_investigation",
      `${JSON.stringify(bad)} must reopen, never close`);
  }
});

// ═══════════════════════ 2. selection is a slice, not a partition ═══════════

const frontier = (n: number, from = 0): FrontierCandidate[] =>
  Array.from({ length: n }, (_, i) => ({
    company_key: `c${from + i}`, state: "pending_investigation" as const,
    rank: from + i,
  }));

Deno.test("2. a slice takes the budget and LEAVES the rest on the frontier", () => {
  const d = selectInvestigationSlice(frontier(100), 10);
  assertEquals(d.selected.length, 10);
  assertEquals(d.remaining, 90, "the other ninety are still available");
  assertEquals(d.reason, "budget");
  // IN RANK ORDER. The ranking was decided once by GPT triage; selection is a
  // cursor over it and forms no second opinion.
  assertEquals(d.selected[0], "c0");
  assertEquals(d.selected[9], "c9");
});

Deno.test("2b. successive slices ADVANCE — this is what a continuation does", () => {
  const pool: FrontierCandidate[] = frontier(100);
  const takeSlice = (n: number) => {
    const d = selectInvestigationSlice(pool, n);
    for (const k of d.selected) {
      const c = pool.find((x) => x.company_key === k)!;
      c.state = "investigated";
    }
    return d;
  };
  const first = takeSlice(10);
  assertEquals(first.selected[0], "c0");
  const second = takeSlice(10);
  assertEquals(second.selected[0], "c10", "the cursor moved; it did not restart");
  assertEquals(second.remaining, 80);
  assertEquals(second.investigated, 10);
  // THE PROPERTY THE OLD CODE LACKED: no company is selected twice, and none is
  // unreachable.
  const seen = new Set([...first.selected, ...second.selected]);
  assertEquals(seen.size, 20);
});

Deno.test("2c. permanently excluded companies never re-enter a slice", () => {
  const pool = frontier(10);
  pool[0].state = "excluded_permanently";  // GPT said irrelevant
  pool[1].state = "excluded_permanently";  // mission size constraint
  const d = selectInvestigationSlice(pool, 10);
  assertFalse(d.selected.includes("c0"));
  assertFalse(d.selected.includes("c1"));
  assertEquals(d.selected.length, 8);
  assertEquals(d.excluded, 2);
  assertEquals(d.reason, "frontier_exhausted");
});

Deno.test("2d. a zero budget selects nobody and strands nobody", () => {
  const d = selectInvestigationSlice(frontier(50), 0);
  assertEquals(d.selected.length, 0);
  assertEquals(d.remaining, 50, "the frontier is untouched, not lost");
  assertEquals(d.reason, "no_capacity");
});

// ══════════════════════════ 3. the yield gate: 2 of 10 is not finished ══════

Deno.test("3. the run continues while the quota is unmet and the frontier holds", () => {
  const g = shouldTakeAnotherSlice({
    qualified: 2, requestedCount: 10, frontierRemaining: 90,
    passesTaken: 1, timeCapacity: 6,
  });
  assert(g.take, "2 of 10 with 90 waiting is not a finished run");
  assertEquals(g.reason, "quota_unmet_frontier_remains");
});

Deno.test("3b. every stopping condition is named, and none of them is silent", () => {
  const base = {
    qualified: 2, requestedCount: 10, frontierRemaining: 90,
    passesTaken: 1, timeCapacity: 6,
  };
  assertEquals(
    shouldTakeAnotherSlice({ ...base, qualified: 10 }).reason, "quota_met");
  assertEquals(
    shouldTakeAnotherSlice({ ...base, qualified: 12 }).reason, "quota_met");
  assertEquals(
    shouldTakeAnotherSlice({ ...base, frontierRemaining: 0 }).reason,
    "frontier_exhausted");
  assertEquals(
    shouldTakeAnotherSlice({ ...base, passesTaken: MAX_INVESTIGATION_PASSES }).reason,
    "pass_ceiling");
  // THE CLOCK IS THE BINDING GUARD, and stopping on it is not a failure — the
  // frontier survives in the checkpoint and the next invocation opens fresh.
  assertEquals(
    shouldTakeAnotherSlice({ ...base, timeCapacity: 0 }).reason,
    "no_time_for_another_slice");
  for (const over of [{ qualified: 10 }, { frontierRemaining: 0 }, { timeCapacity: 0 }]) {
    assertFalse(shouldTakeAnotherSlice({ ...base, ...over }).take);
  }
});

// ══════════════════════ 4. through the REAL engine, end to end ══════════════

const CANONICAL =
  "Find founders of AI startups in the United States hiring software engineers. " +
  "Return 10 qualified leads.";
const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(CANONICAL);
  return {
    ...m, requested_count: 10,
    company_profile: { ...m.company_profile, employee_range: { min: 10, max: 500 } },
  };
};
const BRAIN = {
  employee_min: 10, employee_max: 500,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};
// LARGER THAN `MAX_INVESTIGATION_PASSES × budget` (6 × 10 = 60) ON PURPOSE.
// A pool the yield loop can exhaust proves the loop runs but not that the
// frontier survives, and the surviving frontier is the whole point.
const POOL = Array.from({ length: 120 }, (_, i) => ({
  name: `Acme${i}`, website: `https://acme${i}.com`, teamSize: 40,
  batch: "W20", industries: ["B2B"], id: `acme${i}`,
  oneLiner: "B2B SaaS platform sold on subscription.",
  openJobs: [{ title: "Backend Engineer" }],
})) as unknown as Record<string, unknown>[];

const identityRow = (i: number) => ({
  companyName: `Acme${i}`,
  linkedinUrl: `https://www.linkedin.com/company/acme${i}`,
  website: `https://acme${i}.com`,
  employeeCount: 42,
  description: `Acme${i} is a B2B SaaS platform sold on subscription.`,
});

/** `qualifyEvery` = 1 qualifies all; 4 qualifies one in four. */
const runPool = async (
  o: { qualifyEvery: number; resume?: unknown[]; budgetMs?: number },
) => {
  let n = 0;
  const m = mission();
  // A CLOCK MAKES THE FRONTIER OBSERVABLE. Without one the yield loop correctly
  // runs until the quota or the pool is exhausted; with one it stops mid-pool
  // and leaves a frontier — which is the state a continuation must advance.
  let now = 0;
  const deadline = o.budgetMs
    ? createExecutionDeadline({
      budgetMs: o.budgetMs, now: () => now, assumedCallMs: 9_000,
    })
    : undefined;
  return await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey === "apify_yc_companies_memo23") {
        now += 5_000;
        return Promise.resolve(POOL);
      }
      now += 9_000;
      return Promise.resolve(
        POOL.map((_, i) => identityRow(i)) as Record<string, unknown>[],
      );
    },
    ...(deadline ? { deadline } : {}),
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    evaluateMission: (args) => {
      n++;
      return stubMissionEvaluator({
        mission_fit: n % o.qualifyEvery === 0 ? "pass" : "review",
      })(args);
    },
  } as never, {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, maxCandidates: 60,
    readEnv: () => undefined,
    ...(o.resume
      ? { resume: { workspace_id: "ws-1", lineage_root_task_id: "root", records: o.resume } }
      : {}),
  } as never);
};

Deno.test("4. THE DEFECT FIXED: a short yield takes another slice, in one run", async () => {
  // One in four qualifies. The first slice of 10 yields ~2 — the exact shape of
  // the reported run. The pipeline used to stop there and call itself complete.
  const run = await runPool({ qualifyEvery: 4 });

  const qualified = run.companies.filter((c) => c.verdict === "pass").length;
  const investigated = run.companies.filter(
    (c) => c.investigation_state === "investigated").length;

  assert(investigated > 10,
    `more than one slice must have been taken, got ${investigated} investigated`);
  assert(run.state.investigation_slices.length > 1,
    `the run must record each slice, got ${JSON.stringify(run.state.investigation_slices)}`);
  assert(qualified > 2,
    `a short yield must keep going, got ${qualified} qualified`);

  // AND IT STOPS FOR A NAMED REASON, never silently.
  const last = run.state.investigation_slices.at(-1)!;
  assert(typeof last.reason === "string" && last.reason.length > 0);
});

Deno.test("4b. it STOPS at the quota — the budget is not spent for its own sake", async () => {
  // Everything qualifies. The run must stop at 10, not investigate all 40.
  const run = await runPool({ qualifyEvery: 1 });
  const qualified = run.companies.filter((c) => c.verdict === "pass").length;
  const investigated = run.companies.filter(
    (c) => c.investigation_state === "investigated").length;

  assert(qualified >= 10, `the quota must be met, got ${qualified}`);
  assert(investigated < POOL.length,
    `the pool must NOT be exhausted once the quota is met, investigated ${investigated}`);
  // The rest is still available rather than consumed or closed.
  assert(run.companies.some((c) => isFrontier(c.investigation_state)),
    "companies beyond the quota stay on the frontier");
});

Deno.test("4c. the frontier SURVIVES the checkpoint and a continuation advances it",
  async () => {
    // THE ASSERTION THE OLD ARCHITECTURE COULD NOT PASS. A continuation used to
    // restore the same frozen shortlist and do nothing for the rest.
    const first = await runPool({ qualifyEvery: 4, budgetMs: 200_000 });
    const records = first.companies.map(toResumeRecord);
    const firstInvestigated = new Set(
      first.companies.filter((c) => c.investigation_state === "investigated")
        .map((c) => c.key));
    assert(firstInvestigated.size > 0);
    assert(first.companies.some((c) => isFrontier(c.investigation_state)),
      "the fixture must leave a frontier to resume");

    const second = await runPool({ qualifyEvery: 4, budgetMs: 200_000, resume: records });
    const secondInvestigated = new Set(
      second.companies.filter((c) => c.investigation_state === "investigated")
        .map((c) => c.key));

    // The continuation reached companies the first run never touched.
    const fresh = [...secondInvestigated].filter((k) => !firstInvestigated.has(k));
    assert(fresh.length > 0,
      "a continuation must advance the frontier, not replay the same slice");
  });

Deno.test("4d. the funnel reports the frontier as WITHHELD, never as excluded", async () => {
  const run = await runPool({ qualifyEvery: 4 });
  const f = missionFunnelFor(run.companies);
  assert(funnelIsBalanced(f), JSON.stringify(unbalancedStages(f)));

  const shortlist = f.stages.find((s) => s.stage === "smart_shortlist")!;
  assertEquals(shortlist.excluded, 0,
    "nothing was excluded by a decision in this fixture");
  assertEquals(shortlist.withheld, f.summary.awaiting_investigation,
    "the frontier is withheld — resumable, and not a judgement");
  assert(f.summary.awaiting_investigation >= 0);
});
