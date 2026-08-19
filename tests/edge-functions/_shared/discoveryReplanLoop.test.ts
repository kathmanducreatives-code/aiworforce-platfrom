// EXECUTE → INSPECT → REPLAN.
//
// Discovery used to be strictly one-shot: the planner chose, the engine ran the
// choice, and whatever came back was the pool every later stage had to live
// with. The Agentory briefing states the reason this matters in its first
// paragraph — NO LATER STAGE CAN REPAIR AN EARLIER ONE — and the engine had no
// step where that could be acted on.
//
// Run 25f3ff57 (2026-08-18): 100 rows carrying no hiring state at all, for a
// mission whose `required_evidence` was `embedded_hiring_evidence`. The engine
// knew that the moment discovery finished. It reported it 90 seconds later as
// `open_jobs_evaluated: 0`, beside `qualified: 0`.
//
// This file pins the loop that closes that gap, and — just as importantly — the
// four things that stop it becoming unbounded spend.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCapabilityPlan, summariseDiscoveryPool, DEFAULT_DISCOVERY_PASSES,
  discoveryAttemptFeedback,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import type { DiscoveryResultsSummary }
  from "../../../supabase/functions/_shared/agentoryBriefing.ts";
import {
  refusalMessageFor, DiscoveryStrategyBlockedError,
} from "../../../supabase/functions/_shared/leadDiscoveryStrategy.ts";

const COHORT = "apify_yc_companies_memo23";
const SECOND = "apify_yc_companies_solidcode";

const QUERY = "Find 10 AI startups in the United States hiring software engineers.";

const mission = () => compileLeadMission({
  originalUserQuery: QUERY,
  proposal: {
    requested_opportunity_count: 10,
    requested_contact_ready_count: null,
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
      "startup_company_discovery", "embedded_hiring_evidence",
      "company_semantic_evaluation", "portfolio_ranking",
    ],
    preferred_source_strategy: ["startup_cohort_first"],
    evaluation_instructions: "", founder_unlock_recommended: false,
    confidence: 1, unknowns: [], known_companies: [],
    required_signal_terms: ["software engineers"], geography_is_hard: true,
  },
}).final_mission;

/** A YC row. `jobs: 0` produces a company with no embedded hiring evidence. */
function row(i: number, jobs: number) {
  return {
    id: `acme${i}`, name: `Acme${i}`, slug: `acme${i}`,
    website: `https://acme${i}.com`, teamSize: 40, batch: "W20",
    industry: "B2B", tags: ["AI"], regions: ["United States of America"],
    isHiring: jobs > 0,
    openJobs: Array.from({ length: jobs }, () => ({ title: "Software Engineer" })),
  } as unknown as Record<string, unknown>;
}

interface Attempt {
  results?: DiscoveryResultsSummary | null;
  feedback?: Array<{ code: string }>;
}

/**
 * Run discovery with a planner that answers `plans[n]` on attempt n.
 *
 * `rows` maps actor key → what that actor returns, so a test can make the first
 * actor produce a pool that cannot answer the mission and the second produce one
 * that can.
 */
async function run(
  plans: unknown[],
  rows: Record<string, Record<string, unknown>[]>,
  over: Record<string, unknown> = {},
) {
  const attempts: Attempt[] = [];
  const called: string[] = [];
  const m = mission();
  const r = await runCapabilityPlan({
    planDiscovery: (i: Attempt) => {
      attempts.push({ results: i.results ?? null, feedback: i.feedback });
      return Promise.resolve(plans[Math.min(attempts.length - 1, plans.length - 1)]);
    },
    invoke: (call: CompiledActorCall<unknown>) => {
      called.push(call.actorKey);
      return Promise.resolve(rows[call.actorKey] ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
  } as never, {
    mission: m, plan: buildCapabilityGraph(m), maxCandidates: 20,
    // solidcode fans out over team-size bands and is SKIPPED as
    // `not_configured` without them — a bandless call duplicates memo23 at
    // twice the price. Configured here so a second pass can actually run.
    solidcodeTeamSizes: ["11-50"],
    ...over,
  } as never);
  // `called` is every provider call the run made — identity resolution and
  // enrichment included. These tests are about the DISCOVERY calls, so the rest
  // are filtered out.
  //
  // `apify_linkedin_company_search` is deliberately NOT counted: it serves
  // `company_identity_resolution` as well as discovery, and a pool of 20
  // companies produces 20 identity lookups that have nothing to do with which
  // actor discovered them.
  const DISCOVERY = new Set([COHORT, SECOND]);
  return { run: r, attempts, called: called.filter((c) => DISCOVERY.has(c)), allCalls: called };
}

const propose = (actor_key: string) => [{
  actor_key, role: "primary",
  input: { mode: "companies", isHiring: true },
  rationale: "test proposal",
}];

// ══════════════════════════════ 1. the summary is facts, not a verdict ══

Deno.test("1. the pool summary states what is MISSING, in countable terms", () => {
  const m = mission();
  const summary = summariseDiscoveryPool("apify_linkedin_company_search", [
    // Two rows with an identity and no hiring evidence — the 25f3ff57 shape.
    { company: { canonical_domain: "a.com", linkedin_company_url: null },
      yc_open_jobs: [] },
    { company: { canonical_domain: null, linkedin_company_url: "https://li/b" },
      yc_open_jobs: [] },
    // One with neither, which nothing downstream could resolve.
    { company: { canonical_domain: null, linkedin_company_url: null },
      yc_open_jobs: [] },
  ] as never, m);

  assertEquals(summary.candidates_returned, 3);
  assertEquals(summary.likely_companies, 2);
  assertEquals(summary.irrelevant, 1);
  assert(summary.observed_problems.some((p) => /neither a domain nor a LinkedIn URL/.test(p)));
  // THE OBSERVATION THAT WAS MISSING IN PRODUCTION.
  assert(summary.observed_problems.some((p) => /NONE of the 3 rows carry an open role/.test(p)),
    `the hiring gap must be stated: ${summary.observed_problems.join(" | ")}`);
  // AND IT IS NOT A JUDGEMENT. Nothing here calls the pool bad, names a
  // category, or scores relevance — those are the evaluator's job, and a second
  // opinion encoded as a regex is what this architecture keeps deleting.
  for (const p of summary.observed_problems) {
    assertFalse(/newsletter|community|irrelevant pool|bad pool/i.test(p), p);
  }
});

// ═══════════════════════ 2. a pool that cannot answer is re-planned ══

Deno.test("2. a pool carrying none of the required evidence triggers a re-plan", async () => {
  const { attempts, called } = await run(
    [propose(COHORT), propose(SECOND)],
    {
      // First actor: companies, but NO open roles. The mission requires them.
      [COHORT]: [row(1, 0), row(2, 0)],
      [SECOND]: [row(3, 2), row(4, 3)],
    },
  );

  assertEquals(attempts.length, 2, "the engine looked at what it got and asked again");
  assertEquals(attempts[0].results, null, "the first pass has nothing to report yet");

  const seen = attempts[1].results!;
  assertEquals(seen.actor_key, COHORT, "the model is told WHICH actor produced this");
  assertEquals(seen.candidates_returned, 2);
  assert(seen.observed_problems.some((p) => /carry an open role/.test(p)),
    "and what the pool could not prove");

  assert(called.includes(SECOND), "the second actor ran");
  assertEquals(called.filter((c) => c === COHORT).length, 1,
    "and the first was not paid for twice");
});

// ══════════════════════════ 3. the guards that bound the loop ══

Deno.test("3. a pool that satisfies the mission is never re-planned", async () => {
  const { attempts, called } = await run(
    [propose(COHORT)],
    { [COHORT]: Array.from({ length: 20 }, (_, i) => row(i, 2)) },
  );
  assertEquals(attempts.length, 1,
    "the cheapest planning call is the one that does not happen");
  assertEquals(called.length, 1);
});

Deno.test("4. an actor already run is never proposed into a second pass", async () => {
  // The model answers with the SAME actor both times — a reasonable thing for it
  // to do, and re-running it would buy the identical pool at the identical price.
  const { called, attempts } = await run(
    [propose(COHORT), propose(COHORT)],
    { [COHORT]: [row(1, 0)] },
  );
  assertEquals(attempts.length, 2, "it was asked again");
  assertEquals(called.filter((c) => c === COHORT).length, 1,
    "but the repeat was dropped rather than re-paid for");
});

Deno.test("5. maxDiscoveryPasses bounds the loop, and 1 is the old behaviour", async () => {
  const oneShot = await run(
    [propose(COHORT), propose(SECOND)],
    { [COHORT]: [row(1, 0)], [SECOND]: [row(2, 2)] },
    { maxDiscoveryPasses: 1 },
  );
  assertEquals(oneShot.attempts.length, 1, "one pass means plan once, run once, stop");
  assertFalse(oneShot.called.includes(SECOND));

  // And the default is two — one look, one chance to change the mechanism.
  assertEquals(DEFAULT_DISCOVERY_PASSES, 2);
});

Deno.test("6. a re-plan that proposes nothing usable leaves the first pool standing", async () => {
  // The model is asked again and declines — it has nothing better. That is a
  // legitimate answer, not a failure, and the run keeps what it already found.
  const { run: r, called } = await run(
    [propose(COHORT), []],
    { [COHORT]: [row(1, 0), row(2, 0)] },
  );
  assertEquals(called.filter((c) => c === COHORT).length, 1);
  assertEquals(r.companies.length, 2, "the first pass's pool survives the decline");
});

Deno.test("7. a declined re-plan does NOT trigger a repair round", async () => {
  // The repair round teaches a model whose plan was REFUSED. A re-plan that
  // comes back empty was not refused — it was asked whether anything would
  // improve a working pool and said no, which needs no second call.
  const { attempts } = await run(
    [propose(COHORT), []],
    { [COHORT]: [row(1, 0)] },
  );
  assertEquals(attempts.length, 2, "asked twice, not three times");
  assertFalse(!!attempts[1].feedback?.length,
    "and the second ask carries results, not refusal feedback");
});

// ══════════════════════════ 4. a refusal reads like an answer ══

Deno.test("8. the refusal carries a sentence the user can act on", () => {
  const semantic = refusalMessageFor([{
    code: "actor_not_for_semantic_discovery",
    actor_key: "apify_linkedin_company_search",
    message: "declares not_for semantic/concept search",
    severity: "block",
  }]);
  // IT SAYS NOTHING WAS SPENT. A refusal the user reads as a failed run is not
  // the better answer this architecture chose — it is the same zero with worse
  // information.
  assert(/stopped before spending/i.test(semantic), semantic);
  // IT EXPLAINS THE MECHANISM, not the error code.
  assert(/NAMES, not what a company/i.test(semantic), semantic);
  // AND IT OFFERS A WAY FORWARD.
  assert(/name the companies/i.test(semantic), semantic);
  assertFalse(/actor_not_for_semantic_discovery/.test(semantic),
    "a violation code is not a sentence");

  const cohort = refusalMessageFor([{
    code: "actor_outside_mission_cohort",
    actor_key: "apify_yc_companies_memo23",
    message: "can only return companies from the Y Combinator company directory",
    severity: "block",
  }]);
  assert(/stopped before spending/i.test(cohort), cohort);
  assert(/Y Combinator company directory/.test(cohort),
    "and names the population it is limited to");
});

Deno.test("9. the thrown refusal carries that sentence with it", async () => {
  // The engine throws; run-agent writes `userMessage` onto the task. Without it
  // the honest refusal reaches the user as an unhandled error.
  let caught: DiscoveryStrategyBlockedError | null = null;
  try {
    await run([[{
      actor_key: "apify_linkedin_company_search", role: "primary",
      input: { searchQuery: "AI" }, rationale: "a name matcher on a concept",
    }], []], {});
  } catch (e) {
    if (e instanceof DiscoveryStrategyBlockedError) caught = e;
    else throw e;
  }
  assert(caught, "a concept mission with only a name matcher must refuse");
  assert(caught!.userMessage.length > 0);
  assert(/stopped before spending/i.test(caught!.userMessage), caught!.userMessage);
});

// ══════ 10-13. THE GENERAL RULE: a failed attempt becomes information ══
//
// Production run 53c99b8a (2026-08-19) is the case these pin. memo23 was asked
// for `industries: ["Engineering, Product and Design"]` and returned ZERO rows.
// The obvious recovery — ask memo23 again WITHOUT that filter — was structurally
// impossible, because the repeat guard keyed on the ACTOR. The capability
// exhausted and the user got nothing.
//
// Two changes, both general to every actor and every request:
//   * "already tried" means actor + INPUT, so a better question is reachable
//   * every attempt outcome (`empty`, `error`, `not_configured`) is fed back

Deno.test("10. a zero-row actor CAN be asked a better question", async () => {
  const h = { plans: [] as Array<Array<{ code: string }> | undefined> };
  const m = mission();
  let n = 0;
  const called: Array<Record<string, unknown>> = [];
  await runCapabilityPlan({
    planDiscovery: (i: { validation_feedback?: Array<{ code: string }> }) => {
      h.plans.push(i.validation_feedback);
      // Same actor both times. The FIRST input over-narrows; the second drops
      // the offending filter — exactly the 53c99b8a recovery.
      const input = n === 0
        ? { mode: "companies", isHiring: true, industries: ["Engineering, Product and Design"] }
        : { mode: "companies", isHiring: true };
      n++;
      return Promise.resolve([{
        actor_key: COHORT, role: "primary", input, rationale: "scenario",
      }]);
    },
    invoke: (call: CompiledActorCall<unknown>) => {
      const input = call.input as Record<string, unknown>;
      called.push(input);
      // The over-narrow question returns nothing; the widened one returns rows.
      const narrow = Array.isArray(input.industries) && input.industries.length > 0;
      return Promise.resolve(narrow ? [] : [row(1, 2), row(2, 3)]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
  } as never, {
    mission: m, plan: buildCapabilityGraph(m), maxCandidates: 20,
  } as never);

  // THE PROPERTY, not a call count. What matters is that the same actor was
  // reachable a second time with a DIFFERENT question — the recovery that was
  // structurally impossible before. How many passes the loop needs to get there
  // is a budget decision, pinned separately in test 5.
  assert(called.length >= 2, `the actor must be re-askable; ran ${called.length}x`);
  assert(called.some((i) => Array.isArray(i.industries) && i.industries.length > 0),
    "the narrow question was asked");
  assert(called.some((i) => !("industries" in i) || (i.industries as unknown[])?.length === 0),
    "and the widened one was too — which is the whole point");
});

Deno.test("11. but the IDENTICAL question is never bought twice", async () => {
  const called: Array<Record<string, unknown>> = [];
  const m = mission();
  await runCapabilityPlan({
    // The planner insists on the same input both times.
    planDiscovery: () => Promise.resolve([{
      actor_key: COHORT, role: "primary",
      input: { mode: "companies", isHiring: true, industries: ["B2B"] },
      rationale: "scenario",
    }]),
    invoke: (call: CompiledActorCall<unknown>) => {
      called.push(call.input as Record<string, unknown>);
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
  } as never, {
    mission: m, plan: buildCapabilityGraph(m), maxCandidates: 20,
  } as never).catch(() => {/* an empty pool may end the capability */});

  assertEquals(called.length, 1,
    "re-asking an identical question buys the identical nothing");
});

Deno.test("12. a zero-row result is TOLD to the planner, not just recorded", () => {
  const fb = discoveryAttemptFeedback([{
    capability: "startup_company_discovery", provider: COHORT, attempt: 1,
    outcome: "empty", rows: 0, cost_units: 1, reason: null,
  }] as never);
  assertEquals(fb.length, 1);
  assertEquals(fb[0].code, "actor_returned_no_rows");
  assertEquals(fb[0].actor_key, COHORT);
  assert(/too narrow/.test(fb[0].message), fb[0].message);
  assert(/Do not repeat the identical input/.test(fb[0].message),
    "and it says what NOT to do next");
});

Deno.test("13. a provider REJECTION is distinguished from an empty result", () => {
  // These need different responses and used to be indistinguishable to the
  // planner, because neither was reported at all. An empty result means the
  // question was wrong; a rejection means our catalog disagrees with the live
  // schema, and no retry of that input can ever succeed.
  const fb = discoveryAttemptFeedback([
    { capability: "startup_company_discovery", provider: SECOND, attempt: 1,
      outcome: "error", rows: 0, cost_units: 0,
      reason: "Error: apify_input_schema_error" },
    { capability: "startup_company_discovery", provider: SECOND, attempt: 2,
      outcome: "error", rows: 0, cost_units: 0,
      reason: "Error: apify_input_schema_error" },
  ] as never);

  assertEquals(fb.length, 1, "a repeated identical failure is stated once, not twice");
  assertEquals(fb[0].code, "actor_rejected_input");
  assert(/apify_input_schema_error/.test(fb[0].message), "the provider's own words");
  assert(/contract failure rather than an empty result/.test(fb[0].message),
    "and the distinction is spelled out, because the right response differs");
});
