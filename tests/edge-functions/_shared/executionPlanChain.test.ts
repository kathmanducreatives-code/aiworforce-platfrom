// CROSS-CAPABILITY CHAINING — GPT plans the whole job, not one stage of it.
//
// Before this, `buildCapabilityGraph` decided the stage list from mission fields
// BEFORE any Actor had been chosen, and each engine branch hardcoded the provider
// that served it. GPT chose actors inside discovery and nothing else.
//
// The decision that could not be made anywhere: a discovery Actor carrying
// embedded `openJobs` makes a paid hiring-verification step redundant; one that
// does not makes it essential. That is a judgement about what evidence exists —
// and the code making it could not know what the pool would contain.
//
// WHAT THIS FILE PROVES:
//   * a chain is validated against the mission's own graph, never widening it (1-5)
//   * a chain cannot smuggle in an actor a single-stage plan would be refused (6)
//   * people stages are never planned, only offered                          (7)
//   * the chain's discovery actors are what actually run                     (8)
//   * a chain can SKIP a paid stage its earlier step already proved          (9)
//   * and cannot skip a structural one                                       (10)
//   * no chain planner = the graph's order, unchanged                        (11)
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  validateExecutionPlan, buildExecutionPlannerPayload, capabilityIsPlanned,
  plannedActorsFor, MAX_PLAN_STEPS,
} from "../../../supabase/functions/_shared/leadExecutionPlan.ts";
import {
  runCapabilityPlan, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const MEMO23 = "apify_yc_companies_memo23";
const NAME_MATCHER = "apify_linkedin_company_search";
const ENRICH = "apify_linkedin_company_details";
const JOB_SEARCH = "apify_linkedin_job_search";

const QUERY = "Find 10 AI startups in the United States hiring software engineers.";

function mission(over: Record<string, unknown> = {}) {
  return compileLeadMission({
    originalUserQuery: QUERY,
    proposal: {
      requested_opportunity_count: 10, requested_contact_ready_count: null,
      company_types: ["AI"], geographies: ["United States"],
      employee_range: { min: null, max: null },
      decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
      preferred_signals: ["hiring"], adjacent_signals: [], excluded_signals: [],
      allowed_broadening: {
        role_families: [], company_types: [], geographies: [],
        employee_range: { min: null, max: null },
      },
      disallowed_broadening: [],
      required_evidence: ["embedded_hiring_evidence"],
      required_capabilities: [
        "startup_company_discovery", "external_hiring_verification",
        "company_details_enrichment", "company_semantic_evaluation",
        "portfolio_ranking",
      ],
      preferred_source_strategy: ["startup_cohort_first"],
      evaluation_instructions: "", founder_unlock_recommended: false,
      confidence: 1, unknowns: [], known_companies: [],
      required_signal_terms: ["software engineers"], geography_is_hard: true,
      ...over,
    },
  }).final_mission;
}

const graphFor = (m = mission()) => buildCapabilityGraph(m);

const step = (
  capability: string, actor_key: string | null, purpose = "test", depends_on: number[] = [],
) => ({ capability, actor_key, purpose, input: {}, depends_on });

// ═══════════════════════════════ 1-5. the chain stays inside the graph ══

Deno.test("1. a well-formed chain validates and is renumbered contiguously", () => {
  const m = mission();
  const v = validateExecutionPlan([
    step("startup_company_discovery", MEMO23, "cohort + embedded hiring evidence"),
    step("company_identity_resolution", NAME_MATCHER, "canonical identity", [1]),
    step("company_enrichment", ENRICH, "size and industry", [2]),
    step("company_brain_qualification", null, "judge against the mission", [3]),
  ], m, graphFor(m));

  assertEquals(v.source, "model_validated");
  assertEquals(v.steps.map((s) => s.step), [1, 2, 3, 4]);
  assertEquals(v.steps.map((s) => s.capability), [
    "startup_company_discovery", "company_identity_resolution",
    "company_enrichment", "company_brain_qualification",
  ]);
  assertEquals(v.steps[3].actor_key, null, "a stage that buys nothing names no actor");
});

Deno.test("2. a capability the MISSION did not authorise is refused", () => {
  const m = mission();
  const v = validateExecutionPlan([
    step("startup_company_discovery", MEMO23),
    // Never in this mission's graph — the model would be proposing spend the
    // user never approved.
    step("job_discovery", "apify_jobs", "search openings directly"),
  ], m, graphFor(m));

  assert(v.violations.some((x) => x.code === "capability_not_in_mission_plan"),
    v.violations.map((x) => x.code).join(", "));
  assertFalse(v.steps.some((s) => s.capability === "job_discovery"));
});

Deno.test("3. an actor the capability does not declare is refused", () => {
  const m = mission();
  const v = validateExecutionPlan([
    step("startup_company_discovery", MEMO23),
    // A real, carded actor — for a different capability.
    step("company_enrichment", JOB_SEARCH, "enrich with a job search", [1]),
  ], m, graphFor(m));

  assert(v.violations.some((x) => x.code === "actor_not_declared_by_capability"));
  assertFalse(v.steps.some((s) => s.actor_key === JOB_SEARCH));
});

Deno.test("4. a consumer planned before its producer is dropped, not executed", () => {
  const m = mission();
  const v = validateExecutionPlan([
    step("company_enrichment", ENRICH, "enrich what, exactly?"),
    step("startup_company_discovery", MEMO23, "find the companies"),
  ], m, graphFor(m));

  assert(v.violations.some((x) => x.code === "step_before_its_producer"));
  assertEquals(v.steps.map((s) => s.capability), ["startup_company_discovery"]);
  assertEquals(v.source, "model_repaired", "repaired, not blocked — the rest still runs");
});

Deno.test("5. the plan is bounded, and an empty one blocks rather than running nothing", () => {
  const m = mission();
  const long = Array.from({ length: MAX_PLAN_STEPS + 4 }, () =>
    step("company_brain_qualification", null, "filler"));
  // Duplicates collapse first, so pad with the real chain to exceed the cap.
  const v = validateExecutionPlan([
    step("startup_company_discovery", MEMO23),
    ...long,
  ], m, graphFor(m));
  assert(v.steps.length <= MAX_PLAN_STEPS);

  const empty = validateExecutionPlan([], m, graphFor(m));
  assertEquals(empty.source, "blocked");
  assert(empty.violations.some((x) => x.code === "no_valid_step"));

  const garbage = validateExecutionPlan("not a list", m, graphFor(m));
  assertEquals(garbage.source, "blocked");
  assert(garbage.violations.some((x) => x.code === "plan_not_a_list"));
});

// ══════════════════ 6-7. the chain carries the same refusals as one stage ══

Deno.test("6. a name matcher cannot reach a concept mission through a longer chain", () => {
  const m = mission();
  const v = validateExecutionPlan([
    // The 25f3ff57 actor, arriving inside a plausible-looking five-step chain.
    step("startup_company_discovery", NAME_MATCHER, "discover the AI cohort"),
    step("company_enrichment", ENRICH, "enrich them", [1]),
  ], m, graphFor(m));

  assert(v.violations.some((x) => x.code === "actor_not_for_semantic_discovery"),
    "not_for is enforced on chain steps too, or the chain is a way around it");
  assertFalse(v.steps.some((s) => s.actor_key === NAME_MATCHER));
});

Deno.test("7. people stages are OFFERED, never planned", () => {
  const m = mission();
  const v = validateExecutionPlan([
    step("startup_company_discovery", MEMO23),
    step("founder_discovery", "apify_people_search", "find the founder", [1]),
  ], m, graphFor(m));

  assert(v.violations.some((x) => x.code === "people_stage_never_automatic"));
  assertFalse(v.steps.some((s) => s.capability === "founder_discovery"),
    "this is the guard that spends money on a person nobody agreed to buy");
});

// ═══════════════════════════ 8-11. the chain drives the engine ══

interface Rec { calls: string[] }
function deps(rows: Record<string, Record<string, unknown>[]>, rec: Rec): CapabilityEngineDeps {
  return {
    invoke: (call: CompiledActorCall<unknown>) => {
      rec.calls.push(call.actorKey);
      return Promise.resolve(rows[call.actorKey] ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  };
}

function ycRow(i: number, jobs: number) {
  return {
    id: `c${i}`, name: `Co${i}`, slug: `c${i}`, website: `https://c${i}.com`,
    teamSize: 30, batch: "W25", industry: "B2B", tags: ["AI"],
    regions: ["United States of America"], isHiring: jobs > 0,
    openJobs: Array.from({ length: jobs }, () => ({ title: "Software Engineer" })),
  } as unknown as Record<string, unknown>;
}

const ROWS = {
  [MEMO23]: [ycRow(1, 3), ycRow(2, 2)],
  [NAME_MATCHER]: [
    { id: "c1", name: "Co1", linkedinUrl: "https://www.linkedin.com/company/c1",
      website: "https://c1.com" },
  ],
  [ENRICH]: [
    { id: "c1", name: "Co1", linkedinUrl: "https://www.linkedin.com/company/c1",
      website: "https://c1.com", employeeCount: 30 },
  ],
};

async function runChain(chainSteps: unknown[] | null, over: Record<string, unknown> = {}) {
  const rec: Rec = { calls: [] };
  const m = mission();
  const r = await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    ...(chainSteps
      ? { planExecution: () => Promise.resolve({ steps: chainSteps, reasoning: "test" }) }
      : {}),
    ...deps(ROWS, rec),
  } as never, { mission: m, plan: buildCapabilityGraph(m), maxCandidates: 20, ...over } as never);
  return { run: r, calls: rec.calls };
}

Deno.test("8. the chain's discovery actor is the one that runs", async () => {
  const { run, calls } = await runChain([
    step("startup_company_discovery", MEMO23, "cohort + embedded hiring evidence"),
    step("company_identity_resolution", NAME_MATCHER, "identity", [1]),
    step("company_enrichment", ENRICH, "details", [2]),
  ]);

  assert(calls.includes(MEMO23), `memo23 must run; calls were ${calls.join(", ")}`);
  const persisted = run.state.execution_plan as { steps: Array<{ capability: string }> } | null;
  assert(persisted, "the chain is persisted so a run can explain itself");
  assertEquals(persisted!.steps[0].capability, "startup_company_discovery");
});

Deno.test("9. a chain may SKIP a paid stage an earlier step already proved", async () => {
  // memo23 returns every company's open roles, so the mission's hiring
  // requirement is already satisfied. A paid job search would re-buy it.
  const { run, calls } = await runChain([
    step("startup_company_discovery", MEMO23, "carries openJobs — hiring is proven here"),
    step("company_identity_resolution", NAME_MATCHER, "identity", [1]),
    step("company_enrichment", ENRICH, "details", [2]),
    step("company_brain_qualification", null, "judge", [3]),
  ]);

  assertFalse(calls.includes(JOB_SEARCH),
    "the chain said hiring was already proven; buying it again is pure cost");
  const hiring = run.capability_outcomes.find((o) => o.capability === "hiring_verification");
  assert(hiring, "the stage is still REPORTED — a skip is a decision, not a silence");
  assertEquals(hiring!.status, "skipped_no_input");
  assert(/re-buy/.test(hiring!.reason ?? ""), hiring!.reason ?? "");
});

Deno.test("10. a chain cannot skip a STRUCTURAL stage", async () => {
  // The chain omits enrichment. That is not a preference — qualification runs on
  // enriched evidence, and a run without it cannot finish. The graph keeps it.
  const { run } = await runChain([
    step("startup_company_discovery", MEMO23, "discover"),
    step("company_identity_resolution", NAME_MATCHER, "identity", [1]),
  ]);
  const enrich = run.capability_outcomes.find((o) => o.capability === "company_enrichment");
  assert(enrich, "enrichment still ran — only hiring/expansion verification are optional");
  assertFalse(enrich!.status === "skipped_no_input" &&
    /re-buy/.test(enrich!.reason ?? ""),
    "it was not skipped BY THE CHAIN");
});

Deno.test("11. no chain planner leaves the graph's order exactly as it was", async () => {
  const withChain = await runChain(null);
  assertEquals(withChain.run.state.execution_plan ?? null, null,
    "absent planner records no chain rather than inventing one");
  // And the run still works, on the graph's own authorised sequence.
  assert(withChain.calls.includes(MEMO23));
});

// ══════════════════════════════════ 12. what the planner is shown ══

Deno.test("12. the payload shows only authorised capabilities and their own actors", () => {
  const m = mission();
  const g = graphFor(m);
  const payload = buildExecutionPlannerPayload(m, g) as {
    authorised_capabilities: Array<{
      capability: string; runs_an_actor: boolean;
      actors: Array<{ actor_key: string; not_for?: string[]; only_returns?: string }>;
    }>;
  };

  const caps = payload.authorised_capabilities.map((c) => c.capability);
  assertEquals(caps, g.steps.map((s) => s.capability),
    "exactly the mission's own plan — no more, no less");
  assertFalse(caps.includes("job_discovery"), "an unauthorised stage is not offered");

  const discovery = payload.authorised_capabilities
    .find((c) => c.capability === "startup_company_discovery")!;
  const nameMatcher = discovery.actors.find((a) => a.actor_key === NAME_MATCHER)!;
  assert((nameMatcher.not_for ?? []).some((n) => /semantic|concept/i.test(n)),
    "the model is shown what each actor cannot do");
  const memo = discovery.actors.find((a) => a.actor_key === MEMO23)!;
  assertEquals(memo.only_returns, "the Y Combinator company directory",
    "and the fixed population a cohort source is limited to");

  const qualification = payload.authorised_capabilities
    .find((c) => c.capability === "company_brain_qualification")!;
  assertEquals(qualification.runs_an_actor, false,
    "a stage that buys nothing is marked, so the model does not name an actor for it");
});

// ══════════════════════════════════════ 13. the accessors are honest ══

Deno.test("13. capabilityIsPlanned treats 'no plan' as 'the graph decides'", () => {
  assert(capabilityIsPlanned(null, "hiring_verification"),
    "absent chain must never be read as a deselection");
  const m = mission();
  const v = validateExecutionPlan([step("startup_company_discovery", MEMO23)], m, graphFor(m));
  assertFalse(capabilityIsPlanned(v, "hiring_verification"));
  assertEquals(plannedActorsFor(v, "startup_company_discovery").map((s) => s.actor_key),
    [MEMO23]);
  assertEquals(plannedActorsFor(null, "startup_company_discovery"), []);
});

// ═════════════ 14-15. "what do I still need?" — the chain is reconsidered ══

/**
 * Run with a chain planner that answers `plans[n]` on call n, recording the
 * pool summary it was shown each time.
 */
async function runAmendable(plans: unknown[][], rows: Record<string, Record<string, unknown>[]>) {
  const rec: Rec = { calls: [] };
  const shown: Array<{ observed: string[] } | null> = [];
  const m = mission();
  let n = 0;
  const r = await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    planExecution: (i: { results?: { observed_problems: string[] } | null }) => {
      shown.push(i.results ? { observed: i.results.observed_problems } : null);
      const steps = plans[Math.min(n, plans.length - 1)];
      n++;
      return Promise.resolve({ steps, reasoning: "test" });
    },
    ...deps(rows, rec),
  } as never, { mission: m, plan: buildCapabilityGraph(m), maxCandidates: 20 } as never);
  return { run: r, calls: rec.calls, shown };
}

const CHAIN_WITHOUT_HIRING = [
  step("startup_company_discovery", MEMO23, "carries openJobs — hiring proven here"),
  step("company_identity_resolution", NAME_MATCHER, "identity", [1]),
  step("company_enrichment", ENRICH, "details", [2]),
];
const CHAIN_WITH_HIRING = [
  ...CHAIN_WITHOUT_HIRING,
  step("hiring_verification", JOB_SEARCH, "the pool carried no roles after all", [3]),
];

Deno.test("14. the chain is re-asked once the pool is a fact, not a prediction", async () => {
  // The plan skipped hiring verification because memo23 "carries openJobs".
  // It did not — every row came back with zero. That prediction is now wrong,
  // and the run finds out HERE rather than at the final count.
  const { run, shown } = await runAmendable(
    [CHAIN_WITHOUT_HIRING, CHAIN_WITH_HIRING],
    { ...ROWS, [MEMO23]: [ycRow(1, 0), ycRow(2, 0)] },
  );

  assertEquals(shown.length, 2, "planned once before the run, asked again after discovery");
  assertEquals(shown[0], null, "the first plan had no pool to look at");
  assert(shown[1]!.observed.some((p) => /carry an open role/.test(p)),
    `the amendment is shown what the pool lacks: ${shown[1]!.observed.join(" | ")}`);

  // AND IT ACTED ON IT. The stage the first plan dropped is no longer skipped.
  //
  // Asserted on the STAGE, not on a job-search call: whether that stage then
  // spends is decided by the free hiring assessment inside it — a company with
  // no evidence at all does not reach the paid fallback, which is pre-existing
  // behaviour and not what the chain controls. What the chain controls is
  // whether the stage is considered at all, and the first plan had removed it.
  const hiring = run.capability_outcomes.find((o) => o.capability === "hiring_verification");
  assert(hiring, "the stage is reported either way");
  assertFalse(/re-buy/.test(hiring!.reason ?? ""),
    `the chain must no longer claim hiring is already proven: ${hiring!.reason}`);
});

Deno.test("15. a pool that matched the prediction changes nothing", async () => {
  // Same opening chain, but memo23 really did return open roles. The skip was
  // correct, the amendment agrees, and nothing extra is bought.
  const { calls, run } = await runAmendable(
    [CHAIN_WITHOUT_HIRING, CHAIN_WITHOUT_HIRING],
    { ...ROWS, [MEMO23]: [ycRow(1, 3), ycRow(2, 2)] },
  );
  assertFalse(calls.includes(JOB_SEARCH), "no paid re-buy of evidence already in hand");

  // ── THE RECONSIDERATION IS STILL RECORDED, BUT NOT AS AN AMENDMENT ───────
  //
  // This asserted `amended_after_discovery: true` "even when it changes
  // nothing", which is how run 1af9b9ea came to report an amendment whose
  // before and after were identical. The fact worth keeping is that the
  // reconsideration happened; calling it an amendment made the trace claim a
  // decision that never occurred.
  const persisted = run.state.execution_plan as {
    amended_after_discovery?: boolean;
    amendment_considered_no_change?: boolean;
  };
  assertEquals(persisted.amended_after_discovery, false,
    "an identical plan is not an amendment");
  assertEquals(persisted.amendment_considered_no_change, true,
    "but the reconsideration must still be on the record");
});

// ═══════════════════════ 17-20. amendment authority and its cost ══
//
// Run 1af9b9ea spent ~6.1s of a reasoning model on an amendment whose before
// and after were identical, and finished ~2.4s short of the wall-clock reserve
// qualification needs. These four pin what that call may change, when it is
// worth making, and what happens when the model asks for something containment
// will not grant.

Deno.test("17. no amendable surface ⇒ the reasoning call is not made", async () => {
  // `executionPlan` has two consumers: `chainSkips`, which honours ONLY
  // OPTIONAL_BY_CHAIN, and `plannedActorsFor`, which is already spent by the
  // time this fires (a graph holds one discovery capability, and it has run).
  // With no optional stage in the graph, no answer could alter this run.
  const rec: Rec = { calls: [] };
  let planCalls = 0;
  // A funding mission: its graph carries no OPTIONAL_BY_CHAIN capability.
  // Same fixture, with hiring verification dropped from what the mission
  // AUTHORISES — so the graph carries no chain-optional stage at all.
  const m = mission({
    preferred_signals: [],
    required_evidence: [],
    required_capabilities: [
      "startup_company_discovery", "company_details_enrichment",
      "company_semantic_evaluation", "portfolio_ranking",
    ],
  });
  const graph = buildCapabilityGraph(m);
  assertEquals(
    graph.steps.some((s) => s.capability === "hiring_verification"), false,
    "premise: this mission's graph has no chain-optional stage",
  );

  await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    planExecution: () => {
      planCalls++;
      return Promise.resolve({ steps: CHAIN_WITHOUT_HIRING, reasoning: "test" });
    },
    ...deps(ROWS, rec),
  } as never, { mission: m, plan: graph, maxCandidates: 20 } as never);

  assertEquals(planCalls, 1, "planned once up front; NOT re-asked after discovery");
});

Deno.test("18. an amendable surface ⇒ the call is still made", async () => {
  // The negative control. Skipping must key on the GRAPH, never on whether the
  // stage is currently selected — otherwise the call is skipped exactly when
  // the opening chain dropped an optional stage, which is the case the
  // amendment exists to reverse.
  const { shown } = await runAmendable(
    [CHAIN_WITHOUT_HIRING, CHAIN_WITH_HIRING],
    { ...ROWS, [MEMO23]: [ycRow(1, 0), ycRow(2, 0)] },
  );
  assertEquals(shown.length, 2, "a hiring mission keeps its amendment call");
});

Deno.test("19. a refused stage removal runs anyway, and says so", async () => {
  // `validateExecutionPlan` polices what a plan CONTAINS, never what it omits.
  // So an amendment dropping identity resolution was accepted into the plan
  // object, ignored by `chainSkips`, executed regardless, and recorded nowhere
  // — the df00b2cd mystery. The stage still runs; the refusal is now a fact.
  const DROPS_IDENTITY = [
    step("startup_company_discovery", MEMO23, "discovery"),
    step("company_enrichment", ENRICH, "details", [1]),
  ];
  const { run, calls } = await runAmendable(
    [CHAIN_WITHOUT_HIRING, DROPS_IDENTITY],
    { ...ROWS, [MEMO23]: [ycRow(1, 3), ycRow(2, 2)] },
  );

  const refusals = (run.state as {
    amendment_refusals?: Array<{ capability: string; reason: string }>;
  }).amendment_refusals ?? [];
  assert(
    refusals.some((r) => r.capability === "company_identity_resolution"),
    `the refused removal must be recorded: ${JSON.stringify(refusals)}`,
  );
  assertEquals(refusals[0].reason, "structural_requirement");
  // And the behaviour is unchanged — this was always correct.
  assert(calls.includes(NAME_MATCHER), "identity resolution still runs");
});

Deno.test("20. dropping a CHAIN-OPTIONAL stage is honoured, not refused", async () => {
  // The distinction the whole guard rests on: hiring verification is a
  // judgement the chain is allowed to make, identity resolution is not.
  const { run } = await runAmendable(
    [CHAIN_WITH_HIRING, CHAIN_WITHOUT_HIRING],
    { ...ROWS, [MEMO23]: [ycRow(1, 3), ycRow(2, 2)] },
  );
  const refusals = (run.state as {
    amendment_refusals?: Array<{ capability: string }>;
  }).amendment_refusals ?? [];
  assertEquals(
    refusals.some((r) => r.capability === "hiring_verification"), false,
    "an optional stage the chain deselects is a legitimate decision, not a refusal",
  );
});

// ═════════════ 21-25. A CONTINUATION DOES NOT RE-BUY THE PLAN ══════════════
//
// TEST plan 9105aa67's continuation slice asked the model to plan the whole
// chain again — a second ~16k-token call into a 30,000 TPM budget it had
// already half-spent — was rejected with HTTP 429, and the run died 1.6s in
// holding two real leads and 87 unexamined candidates.
//
// The plan was already made, already validated, and already written to the
// checkpoint. It was re-bought because the persisted copy dropped each step's
// `input`, which made it a description of a decision rather than the decision.

const REUSABLE_CHAIN = [
  step("startup_company_discovery", MEMO23, "cohort + embedded hiring evidence"),
  step("company_identity_resolution", NAME_MATCHER, "identity", [1]),
  step("company_enrichment", ENRICH, "details", [2]),
];

/**
 * Runs the engine with a planner that COUNTS how often it is asked to plan.
 *
 * `planned` counts the INITIAL plan only — the ~16k-token call this fix exists
 * to stop repeating. The post-discovery amendment reaches the same dependency
 * carrying `results`, and it is a different decision made against facts the
 * first call could not have; conflating the two would make this test pass or
 * fail for the wrong reason.
 */
async function runCounting(
  over: Record<string, unknown> = {}, chain: unknown[] = REUSABLE_CHAIN,
) {
  const rec: Rec = { calls: [] };
  let planned = 0;
  let amended = 0;
  const m = mission();
  const run = await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    planExecution: (i: { results?: unknown }) => {
      if (i?.results) amended++;
      else planned++;
      return Promise.resolve({ steps: chain, reasoning: "test" });
    },
    ...deps(ROWS, rec),
  } as never, {
    mission: m, plan: buildCapabilityGraph(m), maxCandidates: 20, ...over,
  } as never);
  return { run, planned, amended, calls: rec.calls };
}

Deno.test("21. the persisted plan carries each step's INPUT", async () => {
  const { run } = await runCounting();
  const persisted = run.state.execution_plan as
    { steps: Array<{ capability: string; input?: unknown }> } | null;
  assert(persisted, "the chain is persisted");
  for (const s of persisted!.steps) {
    assert(s.input !== undefined,
      `step ${s.capability} lost its input; a continuation cannot resume from half a decision`);
  }
});

Deno.test("22. a second slice REUSES the checkpointed plan — the model is not asked again", async () => {
  const first = await runCounting();
  assertEquals(first.planned, 1, "the first slice plans");

  const second = await runCounting({ state: first.run.state });
  assertEquals(second.planned, 0,
    "the plan was already bought, validated and stored; re-buying it is what hit the TPM limit");

  const reused = second.run.state.execution_plan as
    { steps: Array<{ capability: string }> } | null;
  assertEquals(
    reused!.steps.map((s) => s.capability),
    (first.run.state.execution_plan as { steps: Array<{ capability: string }> })
      .steps.map((s) => s.capability),
    "and it is the SAME chain, not a lookalike",
  );
});

Deno.test("23. a stored plan is RE-VALIDATED, never merely trusted", async () => {
  const first = await runCounting();
  // The stored plan now names an actor for a capability that does not declare
  // it — the shape a graph or registry change would leave behind.
  const tampered = structuredClone(first.run.state) as unknown as {
    execution_plan: { steps: Array<{ actor_key: string | null; capability: string }> };
  };
  tampered.execution_plan.steps[2].actor_key = JOB_SEARCH;

  const second = await runCounting({ state: tampered });
  assertEquals(second.planned, 1,
    "containment is not a property of where a plan came from; a refused chain is re-planned");
});

Deno.test("23b. a stored plan that merely SHRINKS on revalidation is not reused either", async () => {
  const first = await runCounting();
  // A step for a capability this mission never authorised. Validation drops it
  // and keeps the rest — leaving a plan that is shorter than the one the
  // checkpoint recorded, and therefore not the plan it claims to be.
  const drifted = structuredClone(first.run.state) as unknown as {
    execution_plan: { steps: Array<Record<string, unknown>> };
  };
  drifted.execution_plan.steps.push({
    step: 4, capability: "job_discovery", actor_key: "apify_jobs",
    purpose: "drift", depends_on: [1], input: {},
  });

  const second = await runCounting({ state: drifted });
  assertEquals(second.planned, 1,
    "reusing a silently shortened chain is how a run stops doing what it recorded");
});

Deno.test("24. a checkpoint written BEFORE inputs were persisted is not reused", async () => {
  const first = await runCounting();
  const legacy = structuredClone(first.run.state) as unknown as {
    execution_plan: { steps: Array<Record<string, unknown>> };
  };
  for (const s of legacy.execution_plan.steps) delete s.input;

  const second = await runCounting({ state: legacy });
  assertEquals(second.planned, 1,
    "reusing it would run every actor with no filters at all — silently");
});

Deno.test("25. a state for a DIFFERENT mission is never reused", async () => {
  const first = await runCounting();
  const foreign = structuredClone(first.run.state) as unknown as { mission_hash: string };
  foreign.mission_hash = "a-different-question-entirely";

  const second = await runCounting({ state: foreign });
  assertEquals(second.planned, 1);
});
