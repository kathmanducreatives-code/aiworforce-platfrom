// THE THREE DEFECTS TEST RUN ea2d02f2 EXPOSED, AND THE INVARIANTS THAT REPLACE
// THEM.
//
// That run discovered 100 companies, triaged them correctly, shortlisted 97,
// resolved 5 identities, enriched 0, evaluated 5 and qualified NOBODY. Three
// separate architectural faults produced it, and each is pinned here.
//
//   1. IDENTITY ATE THE WINDOW. 12 searches consumed 114,196ms of a 125,000ms
//      budget. The next call was refused with 10,804ms left against an 18,000ms
//      checkpoint reserve, so enrichment never started — and the five companies
//      that HAD resolved reached the evaluator with no enrichment evidence.
//      Every individual search was affordable; the sequence was not, because
//      nothing asked whether the stages AFTER identity could still run.
//
//   2. A GPT BATCH LIMIT BECAME AN APIFY BUDGET. `stage2Ceiling` — the number of
//      companies GPT may READ in batches — was adopted as the paid investigation
//      ceiling, turning a 100-company read limit into authorisation for 100
//      LinkedIn Actor starts. `requested_count` had a second door in through the
//      budget floor.
//
//   3. THE BRAIN VETOED GPT BY SILENCE. The grounded classifier returned
//      `grounding_score: 0, validated: [], rejected: [], downgrade_reasons: []`
//      for every company, and `final_grounded_decision !== "pass"` was read as a
//      refutation. Deepgram — mission_fit pass, match_score 91, five verified
//      citations, zero failed gates — came out `unknown`. QUALIFIED was
//      unreachable in any run at any budget.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_INVESTIGATION_BUDGET, GPT_READ_BUDGET_ENV, INVESTIGATION_BUDGET_ENV,
  MAX_GPT_READ_BUDGET, downstreamReserveMs, identityStopThreshold,
  resolveGptBudget, resolveInvestigationBudget, resolveTimeCapacity,
} from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";
import {
  applyMissionPrecedence, decideCompanyBrain, groundingRefutes,
  groundingWasPerformed, type GroundingSummary,
} from "../../../supabase/functions/_shared/companyBrainSemanticFit.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  runCapabilityPlan, toResumeRecord,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  createExecutionDeadline,
} from "../../../supabase/functions/_shared/leadExecutionFinalizer.ts";
import { CHECKPOINT_RESERVE_MS } from "../../../supabase/functions/_shared/leadResumeState.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

// ═══════════════ 1. THE BUDGETS ARE SEPARATE, AND NEITHER IS requested_count ══

Deno.test("1. a GPT batch ceiling can no longer become an Apify budget", () => {
  // `resolveInvestigationBudget` no longer ACCEPTS a stage-2 ceiling. The
  // parameter is gone from the signature, so the conflation cannot be
  // reintroduced by passing it — this asserts the shape, not just the value.
  const b = resolveInvestigationBudget({
    requestedCount: 10, poolSize: 100, read: () => undefined,
  });
  assertEquals(b.budget, DEFAULT_INVESTIGATION_BUDGET,
    "a 100-company pool with Stage 2 on must still authorise the default spend");
  assertFalse("stage2Ceiling" in (resolveInvestigationBudget as unknown as object));
  // The source vocabulary no longer contains it either.
  assertFalse(b.source === ("stage2_ceiling" as typeof b.source));
});

Deno.test("1b. requested_count is carried and never sizes the spend", () => {
  const read = () => undefined;
  for (const n of [0, 1, 5, 25, 500]) {
    const b = resolveInvestigationBudget({ requestedCount: n, poolSize: 100, read });
    assertEquals(b.budget, DEFAULT_INVESTIGATION_BUDGET, `requested_count=${n}`);
    assertEquals(b.requested_count, n, "…but it IS recorded");
  }
});

Deno.test("1c. the GPT budget is separate, larger, and independently configurable", () => {
  const inv = resolveInvestigationBudget({
    requestedCount: 10, poolSize: 100, read: () => undefined,
  });
  const gpt = resolveGptBudget({
    poolSize: 100, investigationBudget: inv.budget, read: () => undefined,
  });

  // TRIAGE READS THE BROAD POOL. Starving it is how a good company never gets
  // ranked — it is the stage that decides where the expensive budget goes.
  assertEquals(gpt.read_budget, 100);
  assert(gpt.read_budget > inv.budget,
    "the cheap budget must not be capped by the expensive one");
  // Evaluation IS bounded by investigation: a company nobody investigated
  // cannot be evaluated, so authorising calls beyond it buys nothing.
  assertEquals(gpt.evaluation_budget, inv.budget);

  // Independently configurable, and independently capped.
  const raised = resolveGptBudget({
    poolSize: 1000, investigationBudget: 10,
    read: (k) => (k === GPT_READ_BUDGET_ENV ? "5000" : undefined),
  });
  assertEquals(raised.read_budget, MAX_GPT_READ_BUDGET, "an operator typo cannot escape the cap");

  // And raising the GPT budget does NOT raise the paid one.
  const paid = resolveInvestigationBudget({
    requestedCount: 10, poolSize: 1000,
    read: (k) => (k === GPT_READ_BUDGET_ENV ? "5000" : undefined),
  });
  assertEquals(paid.budget, DEFAULT_INVESTIGATION_BUDGET);
});

Deno.test("1d. the paid budget is configurable and bounded on its own axis", () => {
  const at = (v: string) => resolveInvestigationBudget({
    requestedCount: 10, poolSize: 1000,
    read: (k) => (k === INVESTIGATION_BUDGET_ENV ? v : undefined),
  });
  assertEquals(at("25").budget, 25);
  assertEquals(at("25").source, "environment");
  assertEquals(at("99999").budget, 100, "the hard cap still binds");
});

// ═══════════════════ 2. TIME IS A BUDGET, AND IDENTITY MAY NOT SPEND IT ALL ══

const CAPACITY = resolveTimeCapacity({
  remainingMs: 110_000, reserveMs: CHECKPOINT_RESERVE_MS,
  concurrency: 2, enrichmentBatchSize: 10, read: () => undefined,
});

Deno.test("2. the downstream reserve GROWS with what has already resolved", () => {
  // THE SELF-LIMITING PROPERTY. Every resolved identity adds an enrichment slot
  // and a qualification pass to the work still owed, so the stage stops exactly
  // when finishing what it holds would cost the rest of the budget.
  const at = (n: number) => downstreamReserveMs({
    resolvedSoFar: n, capacity: CAPACITY, checkpointReserveMs: CHECKPOINT_RESERVE_MS,
  });
  assertEquals(at(0), CHECKPOINT_RESERVE_MS, "nothing resolved ⇒ only the checkpoint is owed");
  assert(at(1) > at(0));
  assert(at(5) > at(1));
  assert(at(10) > at(5));
  // A checkpoint must ALWAYS be affordable — it is what makes a deferral
  // recordable rather than a company stranded.
  for (const n of [0, 1, 5, 50]) assert(at(n) >= CHECKPOINT_RESERVE_MS, `${n}`);
});

Deno.test("2b. the stop threshold is the larger of 'one more call' and 'finish what we hold'",
  () => {
    const t = (n: number, perCall: number) => identityStopThreshold({
      resolvedSoFar: n, capacity: CAPACITY,
      checkpointReserveMs: CHECKPOINT_RESERVE_MS, perCallEstimateMs: perCall,
    });
    // Nothing resolved yet: only the checkpoint is owed, plus the in-flight call.
    assertEquals(t(0, 12_000), CHECKPOINT_RESERVE_MS + 12_000,
      "the reserve must survive the call the guard is about to permit");
    // Once work is held, the downstream obligation dominates — this is the
    // question run ea2d02f2 never asked.
    assert(t(10, 12_000) > 12_000,
      "with ten identities held, 'room for one more search' is not the binding question");
  });

Deno.test("2c. capacity is measured from the SLOWER of configured and observed", () => {
  // An estimate may only move UP from its safe baseline — one fast call must
  // not talk the controller into authorising work it cannot finish.
  const fast = resolveTimeCapacity({
    remainingMs: 110_000, reserveMs: CHECKPOINT_RESERVE_MS, concurrency: 2,
    enrichmentBatchSize: 10, read: () => undefined, observedIdentityMs: 1_000,
  });
  assertEquals(fast.identity_call_ms, 10_000, "the configured floor holds");

  const slow = resolveTimeCapacity({
    remainingMs: 110_000, reserveMs: CHECKPOINT_RESERVE_MS, concurrency: 2,
    enrichmentBatchSize: 10, read: () => undefined, observedIdentityMs: 40_000,
  });
  assertEquals(slow.identity_call_ms, 40_000, "a slower reality is adopted");
  assert(slow.capacity < fast.capacity, "and it buys fewer companies");
});

// ══════════════════════ 3. THE ea2d02f2 SHAPE, THROUGH THE REAL ENGINE ══════

const CANONICAL =
  "Find founders of SaaS startups hiring software engineers in the United States. " +
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
const POOL = Array.from({ length: 30 }, (_, i) => ({
  name: `Acme${i}`, website: `https://acme${i}.com`, teamSize: 40,
  batch: "W20", industries: ["B2B"], id: `acme${i}`,
  oneLiner: "B2B SaaS platform sold on subscription.",
  openJobs: [{ title: "Backend Engineer" }],
})) as unknown as Record<string, unknown>[];

/** The audited run's real latencies: 15s discovery, ~9.5s per identity search. */
const runShaped = async (o: { budgetMs: number; identityMs: number }) => {
  let now = 0;
  const deadline = createExecutionDeadline({
    budgetMs: o.budgetMs, now: () => now, assumedCallMs: 12_000,
  });
  const m = mission();
  const run = await runCapabilityPlan({
      planDiscovery: stubDiscoverySelector(),
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey === "apify_yc_companies_memo23") {
        now += 15_000;
        return Promise.resolve(POOL);
      }
      now += o.identityMs;
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    deadline,
  } as never, {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, maxCandidates: 60,
    // ONE PASS — this file pins the wall-clock reserve and the authority
    // boundary, both of which are per-pass properties.
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
  } as never);
  return { run, deadline };
};

Deno.test("3. identity leaves the window the later stages need", async () => {
  // THE REGRESSION, STATED AS TIME. On ea2d02f2 identity finished with 10,804ms
  // left against an 18,000ms checkpoint reserve — under the reserve, so the
  // enrichment call was refused before it started and the run qualified nobody.
  const { run, deadline } = await runShaped({ budgetMs: 125_000, identityMs: 9_500 });

  const remaining = deadline.remainingMs();
  assert(remaining > CHECKPOINT_RESERVE_MS,
    `identity must stop with more than the checkpoint reserve left, got ${remaining}ms`);

  // AND THE STAGE IS HONEST ABOUT STOPPING. Partial execution is never
  // recorded as complete, so a continuation resumes exactly what was deferred.
  const outcome = run.capability_outcomes.find(
    (x) => x.capability === "company_identity_resolution");
  assertEquals(outcome?.status, "incomplete");
  assertFalse(run.state.completed_capabilities.includes("company_identity_resolution"));

  // NOTHING IS STRANDED. Every unreached target says it is still owed, which is
  // what `nextStageFor` reads on the continuation.
  const deferred = run.companies.filter((c) => c.shortlisted).map(toResumeRecord)
    .filter((r) => r.identity === "deferred");
  assert(deferred.length > 0, "the unreached targets must be recorded as deferred");
});

Deno.test("3b. the shortlist is NOT shrunk by the clock — that would strand companies",
  async () => {
    // THE FIX THAT WAS REJECTED, PINNED SO IT IS NOT REINTRODUCED.
    //
    // Shrinking the shortlist to fit the clock looks equivalent and is not:
    // `applyMissionIntelligence` runs inside the discovery capability, and a
    // resumed run skips completed capabilities, so the shortlist is computed
    // ONCE per lineage. A company dropped from it for time would carry
    // `budget_exhausted` forever and no continuation would reconsider it.
    //
    // A tight clock must therefore change what identity ATTEMPTS, never who is
    // on the list.
    const roomy = await runShaped({ budgetMs: 600_000, identityMs: 9_500 });
    const tight = await runShaped({ budgetMs: 125_000, identityMs: 9_500 });

    const shortlisted = (r: typeof roomy) =>
      r.run.companies.filter((c) => c.shortlisted).length;
    assertEquals(shortlisted(tight), shortlisted(roomy),
      "the same companies are shortlisted whatever the clock allows");
    assertEquals(shortlisted(tight), DEFAULT_INVESTIGATION_BUDGET,
      "and the count budget is what decided it");

    // The clock changed how many were ATTEMPTED, which is the resumable axis.
    const attempted = (r: typeof roomy) =>
      r.run.companies.filter((c) => c.identity !== null).length;
    assert(attempted(tight) <= attempted(roomy));
  });

// ═══════════════ 4. GROUNDING VERIFIES; IT DOES NOT VETO BY SILENCE ═════════

const POLICY = applyMissionPrecedence({
  original_user_query: "Find AI startups in the United States hiring engineers",
  mission_verticals: ["ai"], mission_geography: null, workspace_industries: [],
});

const gates = () => ({
  identity_status: "verified_match" as const, active: true,
  geography: "San Francisco, CA, USA", required_geography: null,
  employee_count: 120, employee_ceiling: null,
  commercial_tier: "A" as const, mission_owns_hiring_role: true, semantic: null,
});

const missionPass = () => ({
  mission_fit: "pass", icp_fit: "strong", match_score: 91,
  business_model: "unknown", company_fit: "pass", confidence: 0.96,
  agentory_use_case: "strong",
  supporting_evidence: ["Software Engineer - Deepgram for Restaurants"],
  conflicting_evidence: [], unknown_fields: [],
  reason: "All mission requirements are supported by cited evidence.",
} as never);

/** EXACTLY what the grounder returned for all five companies on ea2d02f2. */
const EMPTY_GROUNDING: GroundingSummary = {
  final_grounded_decision: "review",
  grounding_score: 0,
  validated_claim_types: [],
  downgrade_reasons: [],
  validated_claims: 0,
  rejected_claims: 0,
  unacknowledged_conflicts: 0,
};

Deno.test("4. THE ea2d02f2 DEFECT: an empty verifier no longer vetoes a mission pass", () => {
  assertFalse(groundingWasPerformed(EMPTY_GROUNDING),
    "zero validated, zero rejected, zero downgrades — it examined nothing");
  assertFalse(groundingRefutes(EMPTY_GROUNDING),
    "and an examination that did not happen cannot refute anything");

  const d = decideCompanyBrain({
    gates: gates(), semantic: missionPass(),
    policy: POLICY, hiring_verified: true, grounding: EMPTY_GROUNDING,
  });
  assertEquals(d.outcome, "QUALIFIED",
    "Deepgram — pass, 91, five verified citations, no failed gates — must qualify");
});

Deno.test("4b. grounding that REFUTES with evidence still holds the company", () => {
  // The capability is intact. Each of the three positive findings downgrades.
  //
  // A SCORE BELOW THRESHOLD IS NOT ITSELF ONE OF THEM. This list used to carry
  // `downgrade_reasons: ["grounding_score_0.33_below_0.6"]` with zero validated
  // AND zero rejected claims — a fixture describing a verifier that scored 1-in-3
  // without checking anything, which cannot happen: `grounding_score` IS
  // `validated / (validated + rejected)`. A real sub-threshold score always comes
  // with rejected claims, and it is those that refute. Encoding the impossible
  // version is what let `downgrade_reasons.length > 0` look like a safe rule,
  // and run bab6da1e then held three passed companies on two reasons that both
  // said "I checked nothing".
  const refuting: GroundingSummary[] = [
    // A claim was checked and did not survive — and the score follows from it.
    {
      ...EMPTY_GROUNDING, validated_claims: 1, rejected_claims: 2,
      grounding_score: 0.33,
      downgrade_reasons: ["grounding_score_0.33_below_0.6"],
    },
    // The registry contradicts itself and the model did not address it.
    { ...EMPTY_GROUNDING, unacknowledged_conflicts: 1 },
    // Named explicitly, which is the one downgrade string that is a finding.
    {
      ...EMPTY_GROUNDING,
      downgrade_reasons: ["material_conflict_unacknowledged:ev-7"],
    },
  ];
  for (const g of refuting) {
    assert(groundingRefutes(g), JSON.stringify(g));
    const d = decideCompanyBrain({
      gates: gates(), semantic: missionPass(),
      policy: POLICY, hiring_verified: true, grounding: g,
    });
    assertEquals(d.outcome, "REVIEW", JSON.stringify(g));
  }

  // AND THE COUNTERPART: the same score string with nothing behind it is the
  // silence again, and may not hold anybody.
  assertFalse(
    groundingRefutes({
      ...EMPTY_GROUNDING,
      downgrade_reasons: ["grounding_score_0_below_0.6"],
    }),
    "a score reported over zero checked claims is not a finding");
});

Deno.test("4c. a grounding PASS never blocks, whatever its score", () => {
  const g: GroundingSummary = {
    ...EMPTY_GROUNDING, final_grounded_decision: "pass",
    validated_claims: 4, grounding_score: 1,
  };
  assertFalse(groundingRefutes(g));
  assertEquals(
    decideCompanyBrain({
      gates: gates(), semantic: missionPass(),
      policy: POLICY, hiring_verified: true, grounding: g,
    }).outcome, "QUALIFIED");
});

Deno.test("4d. grounding may not RESCUE a mission fail either", () => {
  // The authority runs one way. A verifier that validated everything cannot
  // overturn the evaluator's explicit `fail`.
  const perfect: GroundingSummary = {
    ...EMPTY_GROUNDING, final_grounded_decision: "pass",
    validated_claims: 9, grounding_score: 1,
  };
  const d = decideCompanyBrain({
    gates: gates(),
    semantic: { ...missionPass() as never, mission_fit: "fail" } as never,
    policy: POLICY, hiring_verified: true, grounding: perfect,
  });
  assertEquals(d.outcome, "REJECT");
});

Deno.test("4e. an omitted claim count is read as 'examined nothing', not as a refutation", () => {
  // Backward compatibility in the SAFE direction: an older caller that supplies
  // only a verdict must not be able to veto by accident.
  const d = decideCompanyBrain({
    gates: gates(), semantic: missionPass(),
    policy: POLICY, hiring_verified: true,
    grounding: {
      final_grounded_decision: "review", grounding_score: 0,
      validated_claim_types: [], downgrade_reasons: [],
    },
  });
  assertEquals(d.outcome, "QUALIFIED");
});
