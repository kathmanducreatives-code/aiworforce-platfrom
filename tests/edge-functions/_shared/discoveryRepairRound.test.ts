// A REFUSED PLAN IS FEEDBACK, NOT THE END OF THE RUN.
//
// ── THE FAILURE THIS FIXES ──────────────────────────────────────────────────
//
// `validateDiscoveryStrategy` was called once and its verdict was final. When
// it refused every proposed actor the strategy came back `blocked`, discovery
// ran nothing, and the run delivered ZERO qualified leads — with no record of
// why beyond a violation code nobody acted on.
//
// `not_for` enforcement made that reachable in a single move: an actor that
// matches company NAMES is now correctly refused for a CONCEPT mission like
// "AI startups". Correct refusal, catastrophic response — the guardrail became
// the strategist by being the last word.
//
// The rule now: refuse → tell the model exactly what was refused and why →
// let it choose again → validate again → only then block. Exactly one repair
// round, so this can never become an unbounded planning loop.
//
// ZERO network, ZERO Actor runs, ZERO model calls.

import {
  assert, assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { runCapabilityPlan } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  DiscoveryStrategyBlockedError,
} from "../../../supabase/functions/_shared/leadDiscoveryStrategy.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const mission = (): LeadMissionV1 =>
  parseLeadMissionDeterministic(
    "Find 2 qualified AI startups in the United States currently hiring software engineers.");

/** An actor the catalog refuses for concept discovery — a NAME matcher. */
const NAME_MATCHER = "apify_linkedin_company_search";
/** An actor that can legitimately discover a cohort. */
const COHORT_ACTOR = "apify_yc_companies_memo23";

const ROWS = Array.from({ length: 4 }, (_, i) => ({
  name: `Acme${i}`, website: `https://acme${i}.com`, teamSize: 40 + i,
  batch: "W20", industries: ["B2B"], id: `acme${i}`,
  openJobs: [{ title: "Senior Software Engineer" }],
})) as unknown as Record<string, unknown>[];

interface Attempt { feedback: Array<{ code: string; message: string; actor_key?: string }> }

/**
 * Run discovery with a planner that proposes `plans[n]` on attempt n, recording
 * what feedback it was given each time.
 *
 * ── ONE PASS, SO THE REPAIR ROUND IS WHAT IS BEING COUNTED ─────────────────
 *
 * `maxDiscoveryPasses: 1` disables the separate execute → inspect → replan
 * loop. Both mechanisms call the planner, and leaving both on would make these
 * assertions count a mixture of the two — a repair round (the plan was
 * REFUSED) and an inspect round (the plan ran and the pool fell short) are
 * different events that happen to share a dependency. The inspect loop has its
 * own file: `discoveryReplanLoop.test.ts`.
 */
const runWithPlans = async (plans: unknown[], passes = 1) => {
  const attempts: Attempt[] = [];
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan({
    planDiscovery: (i: { validation_feedback?: Attempt["feedback"] }) => {
      attempts.push({ feedback: i.validation_feedback ?? [] });
      return Promise.resolve(plans[Math.min(attempts.length - 1, plans.length - 1)]);
    },
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey === COHORT_ACTOR) return Promise.resolve(ROWS);
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
  } as never,
    { mission: m, plan, maxCandidates: 20, maxDiscoveryPasses: passes } as never);
  return { run, attempts };
};

const propose = (actor_key: string) => [{
  actor_key, role: "primary",
  input: { mode: "companies", isHiring: true },
  rationale: "test proposal",
}];

// ══════════════════════════════════════ 1. the refusal reaches the model ══

Deno.test("1. a refused plan triggers exactly ONE repair round, with the reasons",
  async () => {
    // First plan: a name matcher on a concept mission — refused by `not_for`.
    // Second plan: an actor that can actually discover a cohort.
    const { run, attempts } = await runWithPlans([
      propose(NAME_MATCHER),
      propose(COHORT_ACTOR),
    ]);

    assertEquals(attempts.length, 2, "refused once, re-planned once");
    assertEquals(attempts[0].feedback.length, 0, "the first attempt carries no feedback");
    assert(attempts[1].feedback.length > 0,
      "the repair round is TOLD what was refused — otherwise it is just a retry");
    assert(attempts[1].feedback.some((f) => f.actor_key === NAME_MATCHER),
      "and which actor was refused");
    assert(attempts[1].feedback.every((f) => f.code && f.message),
      "each refusal carries a code and a human-readable reason");

    // AND THE RUN RECOVERED.
    assert(run.companies.length > 0,
      "discovery ran on the repaired plan — the run is no longer dead");
  });

Deno.test("1b. the repaired strategy is MARKED as repaired, not passed off as clean",
  async () => {
    const { run } = await runWithPlans([propose(NAME_MATCHER), propose(COHORT_ACTOR)]);
    const strategy = run.state.discovery_strategy as
      { repaired_after?: string[] } | undefined;
    assert(strategy, "the resolved strategy is persisted on the run state");
    assert(
      Array.isArray(strategy!.repaired_after) && strategy!.repaired_after!.length > 0,
      "a run that needed a second attempt must be distinguishable in the trace " +
      "from one that got it right first time");
    assert(strategy!.repaired_after!.includes("actor_not_for_semantic_discovery"),
      "and the trace names what was refused the first time");
  });

// ═══════════════════════════════════ 2. a good plan is not disturbed ══

Deno.test("2. a plan that validates first time is never re-planned", async () => {
  const { run, attempts } = await runWithPlans([propose(COHORT_ACTOR)]);
  assertEquals(attempts.length, 1, "no repair round when none is needed");
  assertEquals(attempts[0].feedback.length, 0);
  assert(run.companies.length > 0);
});

// ═══════════════════════════ 3. the loop is bounded, and honest when it fails ══

Deno.test("3. two refusals BLOCK the run — the repair round is not a loop", async () => {
  // THE ENGINE THROWS. A blocked strategy is a hard stop, not a quiet empty
  // run: the alternative is a run that spends nothing, finds nothing and
  // reports success, which is the failure mode this whole guard exists for.
  let attemptCount = 0;
  const m = mission();
  const plan = buildCapabilityGraph(m);
  let caught: unknown = null;
  try {
    await runCapabilityPlan({
      planDiscovery: () => {
        attemptCount++;
        return Promise.resolve(propose(NAME_MATCHER));
      },
      invoke: () => Promise.resolve([]),
      verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    } as never, { mission: m, plan, maxCandidates: 20 } as never);
  } catch (e) {
    caught = e;
  }

  assert(caught instanceof DiscoveryStrategyBlockedError,
    "a strategy that cannot be repaired blocks the run explicitly");
  assertEquals(attemptCount, 2,
    "exactly two planning calls — never a third, whatever the model returns");
  assert(String(caught).includes("actor_not_for_semantic_discovery"),
    "and the block names the reason, so it is actionable rather than mysterious");
});

Deno.test("3b. an empty second proposal blocks rather than looping", async () => {
  let attemptCount = 0;
  const m = mission();
  const plan = buildCapabilityGraph(m);
  let caught: unknown = null;
  try {
    await runCapabilityPlan({
      planDiscovery: () => {
        attemptCount++;
        return Promise.resolve(attemptCount === 1 ? propose(NAME_MATCHER) : []);
      },
      invoke: () => Promise.resolve([]),
      verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    } as never, { mission: m, plan, maxCandidates: 20 } as never);
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof DiscoveryStrategyBlockedError);
  assertEquals(attemptCount, 2, "still exactly two");
});
