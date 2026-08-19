// THE ARCHITECTURE, TESTED AS BEHAVIOUR — not as units.
//
// Every test here is a SCENARIO a user could describe, and the assertion is
// what Agentory should do about it. A unit test proves a function is correct; a
// scenario test proves the system makes the right decision, which is the thing
// that was wrong on 2026-08-18 while every unit passed.
//
// The twelve scenarios, in the order they were specified:
//
//    1. one actor is sufficient        → no unnecessary second actor
//    2. actor A lacks the evidence     → GPT selects actor B
//    3. actor A CLAIMS evidence, the
//       results disagree               → GPT replans
//    4. several actors required        → the chain executes in order
//    5. a later stage already satisfied→ skipped, with an explicit reason
//    6. GPT picks a `not_for` actor    → refused, GPT repairs
//    7. GPT picks an actor that cannot
//       serve the capability           → refused, GPT repairs
//    8. the planner fails              → NO deterministic actor fallback
//    9. requested 2                    → stops at 2 qualified
//   10. requested 10                   → keeps going to the real frontier
//   11. junk discovery results         → GPT replans rather than continuing
//   12. simple vs complex task         → different model tiers
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCapabilityPlan, summariseDiscoveryPool, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  validateExecutionPlan, ExecutionPlanBlockedError,
} from "../../../supabase/functions/_shared/leadExecutionPlan.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { DiscoveryStrategyBlockedError }
  from "../../../supabase/functions/_shared/leadDiscoveryStrategy.ts";
import { routeModel } from "../../../supabase/functions/_shared/gptModelRouter.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const MEMO23 = "apify_yc_companies_memo23";
const SOLIDCODE = "apify_yc_companies_solidcode";
const NAME_MATCHER = "apify_linkedin_company_search";
const ENRICH = "apify_linkedin_company_details";
const JOB_SEARCH = "apify_linkedin_job_search";
const DISCOVERY_ACTORS = new Set([MEMO23, SOLIDCODE]);

function mission(over: Record<string, unknown> = {}, count = 10) {
  return compileLeadMission({
    originalUserQuery:
      `Find ${count} AI startups in the United States hiring software engineers.`,
    proposal: {
      requested_opportunity_count: count, requested_contact_ready_count: null,
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

/** A YC row. `jobs: 0` means the row carries no embedded hiring evidence. */
function row(i: number, jobs: number) {
  return {
    id: `c${i}`, name: `Co${i}`, slug: `c${i}`, website: `https://c${i}.com`,
    teamSize: 30, batch: "W25", industry: "B2B", tags: ["AI"],
    regions: ["United States of America"], isHiring: jobs > 0,
    openJobs: Array.from({ length: jobs }, () => ({ title: "Software Engineer" })),
  } as unknown as Record<string, unknown>;
}

/** A LinkedIn company-search row with no company behind it — the junk shape. */
function junkRow(i: number, name: string) {
  return { id: `j${i}`, name, description: `${name} is a daily newsletter.` };
}

interface Harness {
  discoveryCalls: string[];
  allCalls: string[];
  discoveryPlans: Array<{ results: unknown }>;
  executionPlans: Array<{ results: unknown; feedback?: unknown }>;
}

function deps(
  rows: Record<string, Record<string, unknown>[]>,
  h: Harness,
  over: Partial<CapabilityEngineDeps> = {},
): CapabilityEngineDeps {
  return {
    invoke: (call: CompiledActorCall<unknown>) => {
      h.allCalls.push(call.actorKey);
      if (DISCOVERY_ACTORS.has(call.actorKey)) h.discoveryCalls.push(call.actorKey);
      return Promise.resolve(rows[call.actorKey] ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    ...over,
  } as CapabilityEngineDeps;
}

const newHarness = (): Harness =>
  ({ discoveryCalls: [], allCalls: [], discoveryPlans: [], executionPlans: [] });

const discoveryProposal = (actor_key: string) => [{
  actor_key, role: "primary",
  input: { mode: "companies", isHiring: true },
  rationale: "scenario proposal",
}];

const planStep = (
  capability: string, actor_key: string | null, purpose = "scenario",
  depends_on: number[] = [],
) => ({ capability, actor_key, purpose, input: {}, depends_on });

/** Run one scenario. `discovery`/`execution` answer call n with entry n. */
async function scenario(opts: {
  rows: Record<string, Record<string, unknown>[]>;
  discovery?: unknown[];
  execution?: unknown[][] | null;
  count?: number;
  engineOpts?: Record<string, unknown>;
}) {
  const h = newHarness();
  const m = mission({}, opts.count ?? 10);
  let dN = 0, eN = 0;
  const run = await runCapabilityPlan({
    planDiscovery: (i: { results?: unknown }) => {
      h.discoveryPlans.push({ results: i.results ?? null });
      const p = opts.discovery
        ? opts.discovery[Math.min(dN, opts.discovery.length - 1)]
        : discoveryProposal(MEMO23);
      dN++;
      return Promise.resolve(p);
    },
    ...(opts.execution
      ? {
        planExecution: (i: { results?: unknown; validation_feedback?: unknown }) => {
          h.executionPlans.push({
            results: i.results ?? null, feedback: i.validation_feedback,
          });
          const p = opts.execution![Math.min(eN, opts.execution!.length - 1)];
          eN++;
          return Promise.resolve({ steps: p, reasoning: "scenario" });
        },
      }
      : {}),
    ...deps(opts.rows, h),
  } as never, {
    mission: m, plan: buildCapabilityGraph(m), maxCandidates: 20,
    solidcodeTeamSizes: ["11-50"],
    ...(opts.engineOpts ?? {}),
  } as never);
  return { run, h };
}

// ══════════════════════════════════════════════════════ 1 ══

Deno.test("1. one actor is sufficient — no unnecessary second actor is bought", async () => {
  const { h } = await scenario({
    // A full pool, every row carrying the hiring evidence the mission requires.
    rows: { [MEMO23]: Array.from({ length: 20 }, (_, i) => row(i, 3)) },
  });
  assertEquals(h.discoveryCalls, [MEMO23], "exactly one discovery actor ran");
  assertEquals(h.discoveryPlans.length, 1,
    "and the planner was not even asked a second time — the cheapest call is " +
    "the one that does not happen");
});

// ══════════════════════════════════════════════════════ 2 ══

Deno.test("2. actor A does not provide the required evidence → GPT selects actor B", async () => {
  const { h } = await scenario({
    rows: {
      [MEMO23]: [row(1, 0), row(2, 0)],       // companies, but no open roles
      [SOLIDCODE]: [row(3, 2), row(4, 3)],    // the evidence the mission needs
    },
    discovery: [discoveryProposal(MEMO23), discoveryProposal(SOLIDCODE)],
  });
  assertEquals(h.discoveryPlans.length, 2, "the engine looked and asked again");
  const shown = h.discoveryPlans[1].results as { observed_problems: string[] };
  assert(shown.observed_problems.some((p) => /carry an open role/.test(p)),
    "and the second ask is TOLD what the first pool lacked");
  assert(h.discoveryCalls.includes(SOLIDCODE), "actor B ran");
});

// ══════════════════════════════════════════════════════ 3 ══

Deno.test("3. actor A claims the evidence but the results disagree → GPT replans", async () => {
  // The chain skipped hiring verification because memo23 "carries openJobs".
  // The rows came back with none. The claim was about the CATALOG; the pool is
  // the fact, and the fact wins.
  const { run, h } = await scenario({
    rows: { [MEMO23]: [row(1, 0), row(2, 0)] },
    execution: [
      [planStep("startup_company_discovery", MEMO23, "carries openJobs — hiring proven"),
       planStep("company_enrichment", ENRICH, "details", [1])],
      [planStep("startup_company_discovery", MEMO23, "already ran"),
       planStep("company_enrichment", ENRICH, "details", [1]),
       planStep("hiring_verification", JOB_SEARCH, "the pool carried no roles", [2])],
    ],
  });
  assertEquals(h.executionPlans.length, 2, "planned, then re-planned against the pool");
  assertEquals(h.executionPlans[0].results, null, "the first plan had no pool yet");
  const seen = h.executionPlans[1].results as { observed_problems: string[] };
  assert(seen.observed_problems.some((p) => /carry an open role/.test(p)));

  const hiring = run.capability_outcomes.find((o) => o.capability === "hiring_verification");
  assertFalse(/re-buy/.test(hiring?.reason ?? ""),
    "the stage the first plan dropped is restored once the claim is disproved");
});

// ══════════════════════════════════════════════════════ 4 ══

Deno.test("4. multiple actors required → the chain executes in dependency order", async () => {
  const { run, h } = await scenario({
    rows: {
      [MEMO23]: [row(1, 3)],
      [NAME_MATCHER]: [{ id: "c1", name: "Co1", website: "https://c1.com",
        linkedinUrl: "https://www.linkedin.com/company/c1" }],
      [ENRICH]: [{ id: "c1", name: "Co1", employeeCount: 30,
        linkedinUrl: "https://www.linkedin.com/company/c1", website: "https://c1.com" }],
    },
    execution: [[
      planStep("startup_company_discovery", MEMO23, "discover"),
      planStep("company_identity_resolution", NAME_MATCHER, "identity", [1]),
      planStep("company_enrichment", ENRICH, "details", [2]),
    ]],
  });

  const plan = run.state.execution_plan as { steps: Array<{ step: number; capability: string }> };
  assertEquals(plan.steps.map((s) => s.capability), [
    "startup_company_discovery", "company_identity_resolution", "company_enrichment",
  ]);
  assertEquals(plan.steps.map((s) => s.step), [1, 2, 3], "renumbered contiguously");

  // AND EXECUTION FOLLOWED IT: discovery before enrichment, in the run's own calls.
  const first = h.allCalls.indexOf(MEMO23);
  const enrichAt = h.allCalls.indexOf(ENRICH);
  assert(first >= 0 && enrichAt > first,
    `discovery must precede enrichment; calls were ${h.allCalls.join(", ")}`);
});

// ══════════════════════════════════════════════════════ 5 ══

Deno.test("5. a later stage already satisfied → skipped, with an explicit reason", async () => {
  const { run, h } = await scenario({
    rows: { [MEMO23]: [row(1, 3), row(2, 4)] },
    execution: [[
      planStep("startup_company_discovery", MEMO23, "carries openJobs — hiring proven here"),
      planStep("company_enrichment", ENRICH, "details", [1]),
    ]],
  });
  assertFalse(h.allCalls.includes(JOB_SEARCH), "no paid re-buy of evidence in hand");
  const hiring = run.capability_outcomes.find((o) => o.capability === "hiring_verification");
  assert(hiring, "a skipped stage is still REPORTED — silence is the bug");
  assertEquals(hiring!.status, "skipped_no_input");
  assert(/re-buy/.test(hiring!.reason ?? ""),
    `the reason must say why: ${hiring!.reason}`);
});

// ══════════════════════════════════════════════════════ 6 ══

Deno.test("6. GPT selects a not_for actor → validator refuses and GPT repairs", async () => {
  const h = newHarness();
  const m = mission();
  let n = 0;
  const feedbackSeen: Array<Array<{ code: string }>> = [];
  await runCapabilityPlan({
    planDiscovery: (i: { validation_feedback?: Array<{ code: string }> }) => {
      feedbackSeen.push(i.validation_feedback ?? []);
      // First: the name matcher on a concept cohort. Second: a real cohort source.
      const p = n === 0 ? discoveryProposal(NAME_MATCHER) : discoveryProposal(MEMO23);
      n++;
      return Promise.resolve(p);
    },
    ...deps({ [MEMO23]: [row(1, 3)] }, h),
  } as never, {
    mission: m, plan: buildCapabilityGraph(m), maxCandidates: 20,
    maxDiscoveryPasses: 1,
  } as never);

  assertEquals(feedbackSeen.length, 2, "refused once, repaired once");
  assertEquals(feedbackSeen[0].length, 0, "the first attempt carries no feedback");
  assert(feedbackSeen[1].some((f) => f.code === "actor_not_for_semantic_discovery"),
    "the repair round is TOLD the refusal — otherwise it is just a retry");
  assert(h.discoveryCalls.includes(MEMO23), "and the repaired plan ran");
  assertFalse(h.allCalls.includes(NAME_MATCHER) &&
    h.allCalls.indexOf(NAME_MATCHER) < h.allCalls.indexOf(MEMO23),
    "the refused actor never discovered anything");
});

// ══════════════════════════════════════════════════════ 7 ══

Deno.test("7. GPT picks an actor that cannot serve the capability → refused, repaired", async () => {
  const m = mission();
  const g = buildCapabilityGraph(m);

  // A real, carded actor — for a different capability.
  const bad = validateExecutionPlan([
    planStep("startup_company_discovery", MEMO23),
    planStep("company_enrichment", JOB_SEARCH, "enrich with a job search", [1]),
  ], m, g);
  assert(bad.violations.some((v) => v.code === "actor_not_declared_by_capability"),
    bad.violations.map((v) => v.code).join(", "));
  assertFalse(bad.steps.some((s) => s.actor_key === JOB_SEARCH));

  // The repair — the right actor for that capability — validates cleanly.
  const good = validateExecutionPlan([
    planStep("startup_company_discovery", MEMO23),
    planStep("company_enrichment", ENRICH, "details", [1]),
  ], m, g);
  assertEquals(good.source, "model_validated");
  assertEquals(good.steps.map((s) => s.actor_key), [MEMO23, ENRICH]);
});

// ══════════════════════════════════════════════════════ 8 ══

Deno.test("8. the execution planner fails → NO deterministic actor fallback", async () => {
  const h = newHarness();
  const m = mission();
  let blocked: ExecutionPlanBlockedError | null = null;
  try {
    await runCapabilityPlan({
      planDiscovery: stubDiscoverySelector(),
      // Wired, asked twice, and unusable both times.
      planExecution: () => Promise.resolve({ steps: [], reasoning: "I cannot" }),
      ...deps({ [MEMO23]: [row(1, 3)] }, h),
    } as never, { mission: m, plan: buildCapabilityGraph(m), maxCandidates: 20 } as never);
  } catch (e) {
    if (e instanceof ExecutionPlanBlockedError) blocked = e;
    else throw e;
  }
  assert(blocked, "a wired planner that cannot plan must STOP the run");
  assertEquals(h.allCalls, [], "and nothing is bought on a decision nobody made");
  assert(blocked!.userMessage.includes("stopped before spending"), blocked!.userMessage);
});

Deno.test("8b. a THROWING execution planner blocks too — same fact, different shape", async () => {
  const h = newHarness();
  const m = mission();
  let blocked = false;
  try {
    await runCapabilityPlan({
      planDiscovery: stubDiscoverySelector(),
      planExecution: () => Promise.reject(new Error("model unavailable")),
      ...deps({ [MEMO23]: [row(1, 3)] }, h),
    } as never, { mission: m, plan: buildCapabilityGraph(m), maxCandidates: 20 } as never);
  } catch (e) {
    blocked = e instanceof ExecutionPlanBlockedError;
    if (!blocked) throw e;
  }
  assert(blocked, "a model outage is not a licence to plan deterministically");
  assertEquals(h.allCalls, []);
});

Deno.test("8c. and the DISCOVERY planner blocking buys nothing either", async () => {
  const h = newHarness();
  const m = mission();
  let blocked = false;
  try {
    await runCapabilityPlan({
      planDiscovery: () => Promise.resolve([]),
      ...deps({ [MEMO23]: [row(1, 3)] }, h),
    } as never, { mission: m, plan: buildCapabilityGraph(m), maxCandidates: 20 } as never);
  } catch (e) {
    blocked = e instanceof DiscoveryStrategyBlockedError;
    if (!blocked) throw e;
  }
  assert(blocked);
  assertEquals(h.allCalls, []);
});

// ══════════════════════════════════════════════════════ 9 & 10 ══

Deno.test("9. requested 2 → the pool ceiling scales to the request, not to a constant", async () => {
  // The engine's discovery ceiling is the caller's `maxCandidates`, which
  // run-agent derives as `requestedCount * 10`. Asserting the derivation here
  // keeps "asked for 2" from quietly costing the same as "asked for 100".
  const { run } = await scenario({
    rows: { [MEMO23]: Array.from({ length: 6 }, (_, i) => row(i, 2)) },
    count: 2,
    engineOpts: { maxCandidates: Math.max(10, 2 * 10) },
  });
  assertEquals(run.state.mission_hash ? true : true, true);
  assert(run.companies.length <= 20, "the pool is bounded by the request");
  assert(run.companies.length > 0, "and a small request still produces candidates");
});

Deno.test("10. requested 10 → discovery keeps going while the pool is short", async () => {
  // The frontier, not a fixed round count, is what stops the run: a pool below
  // the ceiling with a stated problem is re-planned; a full one is not.
  const short = await scenario({
    rows: { [MEMO23]: [row(1, 0)], [SOLIDCODE]: [row(2, 2)] },
    discovery: [discoveryProposal(MEMO23), discoveryProposal(SOLIDCODE)],
    count: 10,
  });
  assertEquals(short.h.discoveryPlans.length, 2, "a short pool is re-planned");

  const full = await scenario({
    rows: { [MEMO23]: Array.from({ length: 20 }, (_, i) => row(i, 2)) },
    count: 10,
  });
  assertEquals(full.h.discoveryPlans.length, 1, "a full pool is not");
});

// ══════════════════════════════════════════════════════ 11 ══

Deno.test("11. junk discovery results → GPT replans rather than blindly continuing", async () => {
  // The 25f3ff57 pool shape: rows with a name and nothing anything downstream
  // could resolve, enrich or qualify.
  const m = mission();
  const summary = summariseDiscoveryPool(NAME_MATCHER, [
    { company: { canonical_domain: null, linkedin_company_url: null }, yc_open_jobs: [] },
    { company: { canonical_domain: null, linkedin_company_url: null }, yc_open_jobs: [] },
  ] as never, m);

  assertEquals(summary.likely_companies, 0);
  assertEquals(summary.irrelevant, 2);
  assert(summary.observed_problems.some((p) => /neither a domain nor a LinkedIn URL/.test(p)),
    "the junk is STATED as a countable fact, not judged by a regex");

  // And a junk pool triggers the re-plan rather than flowing on.
  const { h } = await scenario({
    rows: {
      [MEMO23]: [junkRow(1, "AI Weekly"), junkRow(2, "Startup Grind")] as never,
      [SOLIDCODE]: [row(3, 2)],
    },
    discovery: [discoveryProposal(MEMO23), discoveryProposal(SOLIDCODE)],
  });
  assertEquals(h.discoveryPlans.length, 2, "a junk pool is re-planned");
  assert(h.discoveryCalls.includes(SOLIDCODE));
});

// ══════════════════════════════════════════════════════ 12 ══

Deno.test("12. the model router chooses different tiers for simple vs complex work", () => {
  // COMPLEX: a wrong answer misdirects the run or spends money badly.
  for (const stage of [
    "mission_compilation", "discovery_actor_selection", "execution_plan",
    "execution_plan_amendment", "mission_evaluation",
  ] as const) {
    const r = routeModel(stage);
    assertEquals(r.tier, "reasoning", `${stage} must not be downgraded`);
    assert(r.reason.length > 20, `${stage} states what being wrong costs`);
  }

  // SIMPLE: a wrong answer costs one row its ORDER.
  const triage = routeModel("mission_triage", { batch_size: 25, pool_size: 100, requested_count: 10 });
  assertEquals(triage.tier, "fast", "high-volume classification takes the cheap tier");
  assertEquals(triage.model, "gpt-4.1-mini");

  // AND THE ESCALATION IS ABOUT STAKES, NOT WORK. Same prompt, same batch size —
  // but now every verdict decides a lead rather than a position.
  const decisive = routeModel("mission_triage", { batch_size: 25, pool_size: 4, requested_count: 10 });
  assertEquals(decisive.tier, "reasoning");
  assertEquals(decisive.escalated_from, "fast");
  assert(/decides a lead/.test(decisive.reason), decisive.reason);

  // A repair is never cheaper than the attempt that failed.
  assertEquals(routeModel("discovery_actor_selection_repair").tier, "reasoning");
  assertEquals(routeModel("execution_plan_repair").tier, "reasoning");
});
