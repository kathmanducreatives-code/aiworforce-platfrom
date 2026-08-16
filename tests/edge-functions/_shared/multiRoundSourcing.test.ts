// STAGE 4 — ADAPTIVE MULTI-ROUND SOURCING.
//
// What these prove, in one sentence each:
//
//   * a request for 100 does not stop at 20, and does not invent 100 either;
//   * GPT chooses how to broaden and code chooses whether it may;
//   * geography, business model and exclusions cannot be crossed at any price;
//   * a company found three ways is one opportunity evaluated once;
//   * and no round, however broad, can ever reach a person.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assessConcept, conceptHash, countsOf, decideNextRound, isConceptExhausted,
  newMultiRoundState, recordRound, roundMetrics, strategyForRound,
  type MultiRoundState, type RoundLimits, type RoundRecord,
} from "../../../supabase/functions/_shared/multiRoundState.ts";
import {
  buildRoundPlannerPayload, parseRoundPlan, validateRoundPlan,
  ROUND_ELIGIBLE_CAPABILITIES,
  type RoundPlanProposal,
} from "../../../supabase/functions/_shared/roundPlanContract.ts";
import {
  addRoundCandidates, resolveIdentity, selectForEvaluation,
  type PooledCompany, type RoundCandidate,
} from "../../../supabase/functions/_shared/crossRoundDedupe.ts";
import {
  runMultiRoundSourcing, roundSummaryForWorkbench,
  type RoundExecution,
} from "../../../supabase/functions/_shared/multiRoundController.ts";
import { isMultiRoundEnabled } from "../../../supabase/functions/_shared/multiRoundBinding.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

const QUERY =
  "Find 100 US B2B SaaS companies actively building their sales teams.";

/** A mission WITH directives — the only kind that permits any broadening. */
function mission(over: Record<string, unknown> = {}): LeadMissionV1 {
  const base = parseLeadMissionDeterministic(QUERY);
  return {
    ...base,
    requested_count: 100,
    company_profile: {
      ...base.company_profile,
      business_models: ["b2b saas"],
      locations: ["United States"],
    },
    directives: {
      preferred_signals: ["hiring"],
      adjacent_signals: ["revenue operations"],
      excluded_signals: ["layoffs"],
      required_evidence: [],
      allowed_broadening: {
        role_families: ["revenue operations", "gtm operations", "sdr", "bdr"],
        company_types: ["vertical saas"],
        geographies: [],
        employee_range: { min: 5, max: 500 },
      },
      disallowed_broadening: ["consumer apps"],
      evaluation_instructions: "",
      source_strategy: [],
      requested_contact_ready_count: null,
      founder_unlock_recommended: true,
    },
    ...over,
  } as LeadMissionV1;
}

const LIMITS = (over: Partial<RoundLimits> = {}): RoundLimits => ({
  maxProviderCostUnits: 12, maxModelOperations: 24,
  deadlineReserveReached: false, ...over,
});

const PROPOSAL = (over: Partial<RoundPlanProposal> = {}): RoundPlanProposal => ({
  continue: true,
  reason: "adjacent commercial roles should surface more of the same profile",
  expected_incremental_value: "high",
  additional_capabilities: [],
  new_search_concepts: ["Revenue Operations"],
  signal_broadening: { add: ["revenue operations"], keep: [], exclude: [] },
  company_type_broadening: { add: [], reason: null },
  employee_range_adjustment: { min: null, max: null, reason: null },
  source_strategy_adjustment: [],
  stop_reason: null,
  ...over,
});

/** State as if `round` rounds have run delivering `delivered` in total. */
function stateAfter(round: number, delivered: number, over: Partial<MultiRoundState> = {}) {
  let s = newMultiRoundState({ requestedCount: 100 });
  for (let r = 1; r <= round; r++) {
    s = recordRound(s, {
      round: r, strategy_type: strategyForRound(r), capabilities: [],
      search_concepts: [], signal_families: [], company_types: [],
      employee_range: { min: null, max: null }, provider_operations: [],
      discovered: 50, new_companies: 25, hard_gated: 5, eligible: 20,
      new_evaluated_companies: 20, qualified: 10, review: 5, watch: 2,
      new_delivered_opportunities: delivered, provider_cost_units: 1,
      model_cost_units: 1,
    }, {
      unique_companies: 25 * r, eligible: 20, evaluated: 20,
      qualified: 10, review: 5, watch: 2, delivered,
    });
  }
  return { ...s, ...over };
}

// ══════════════════════════════════════════════ 1-10. round controller ══

Deno.test("1-3. shortfall continues, target stops, three rounds is the ceiling", () => {
  // 1. 20 of 100 delivered — the run is not finished.
  const short = decideNextRound(stateAfter(1, 20), LIMITS());
  assert(short.start, "a shortfall after round 1 must allow another round");

  // 2. Target reached stops immediately, and is the only `completed`.
  const met = decideNextRound(stateAfter(1, 100), LIMITS());
  assertFalse(met.start);
  assertEquals(met.terminal_reason, "completed");

  // 3. Three rounds is the ceiling.
  const capped = decideNextRound(stateAfter(3, 63), LIMITS());
  assertFalse(capped.start);
  assertEquals(capped.terminal_reason, "round_limit_reached");
  assert(capped.detail.includes("37 short"), "the shortfall is stated, not hidden");
});

Deno.test("4-6. round 1 is exact; later rounds broaden only what is permitted", () => {
  assertEquals(strategyForRound(1), "exact");
  assertEquals(strategyForRound(2), "adjacent");
  assertEquals(strategyForRound(3), "final_broadening");

  const m = mission();
  // Round 2 may add a permitted role family…
  const r2 = validateRoundPlan({
    proposal: PROPOSAL(), mission: m, state: stateAfter(1, 20),
  });
  assert(r2.ok);
  assertEquals(r2.plan.strategy_type, "adjacent");
  assertEquals(r2.plan.signal_families, ["revenue operations"]);

  // …but not one the mission never allowed.
  const bad = validateRoundPlan({
    proposal: PROPOSAL({ signal_broadening: { add: ["layoff recovery"], keep: [], exclude: [] } }),
    mission: m, state: stateAfter(1, 20),
  });
  assert(bad.ok, "the rest of the plan survives");
  assertEquals(bad.plan.signal_families, [], "the unpermitted family is dropped");
  assert(bad.plan.rejections.some((x) => x.reason === "disallowed_broadening_requested"));
});

Deno.test("7. geography cannot be silently broadened", () => {
  const m = mission(); // locations: United States, allowed geographies: []
  const r = validateRoundPlan({
    proposal: PROPOSAL({
      source_strategy_adjustment: ["extend discovery into Canada and the UK"],
    }),
    mission: m, state: stateAfter(1, 20),
  });
  assert(r.ok, "the permitted parts still run");
  const geo = r.plan.rejections.filter((x) => x.reason === "geography_broadening_not_permitted");
  assert(geo.length > 0, "adding Canada to a United States mission must be refused");

  // The mission's OWN geography is not a broadening and is not refused.
  const same = validateRoundPlan({
    proposal: PROPOSAL({ source_strategy_adjustment: ["more United States coverage"] }),
    mission: m, state: stateAfter(1, 20),
  });
  assert(same.ok);
  assertEquals(
    same.plan.rejections.filter((x) => x.reason === "geography_broadening_not_permitted").length,
    0);
});

Deno.test("8-9. business model is fixed, and exclusions survive every round", () => {
  const m = mission();
  const r = validateRoundPlan({
    proposal: PROPOSAL({
      company_type_broadening: { add: ["consumer apps", "agencies", "vertical saas"], reason: "more volume" },
      signal_broadening: { add: [], keep: ["layoffs"], exclude: [] },
    }),
    mission: m, state: stateAfter(1, 20),
  });
  assert(r.ok);
  // Only the explicitly permitted adjacent type survives.
  assertEquals(r.plan.company_types, ["vertical saas"]);
  assert(r.plan.rejections.some((x) =>
    x.reason === "company_type_broadening_not_permitted" && x.value === "agencies"));
  assert(r.plan.rejections.some((x) => x.reason === "disallowed_broadening_requested"));
  // 9. An excluded signal cannot be reinstated by "keeping" it.
  assertFalse(r.plan.signal_families.includes("layoffs"));
  assert(r.plan.rejections.some((x) => x.reason === "exclusion_removal_refused"));

  // A mission that fixes the business model entirely permits no adjacent type.
  const fixed = mission({
    directives: {
      ...mission().directives!,
      allowed_broadening: {
        role_families: [], company_types: [], geographies: [],
        employee_range: { min: null, max: null },
      },
    },
  });
  const none = validateRoundPlan({
    proposal: PROPOSAL({
      new_search_concepts: [], signal_broadening: { add: [], keep: [], exclude: [] },
      company_type_broadening: { add: ["vertical saas"], reason: null },
    }),
    mission: fixed, state: stateAfter(1, 20),
  });
  assertFalse(none.ok, "nothing permitted means no round");
});

Deno.test("10. founder and contact capabilities can never enter a round", () => {
  const m = mission();
  for (const cap of [
    "founder_discovery", "contact_enrichment", "employer_verification",
    "offer_founder_unlock", "offer_contact_unlock",
    "linkedin_company_employees", "people_search", "phone_enrichment",
  ]) {
    const r = validateRoundPlan({
      proposal: PROPOSAL({ additional_capabilities: [cap] }),
      mission: m, state: stateAfter(1, 20),
    });
    const rej = r.ok ? r.plan.rejections : r.rejections;
    assert(
      rej.some((x) => x.reason === "people_capability_refused" || x.reason === "unknown_capability"),
      `${cap} must be refused`);
    if (r.ok) {
      assertFalse(r.plan.capabilities.includes(cap), `${cap} must not survive`);
    }
  }
  // And no people stage is even in the vocabulary offered to the planner.
  for (const c of ROUND_ELIGIBLE_CAPABILITIES) {
    assertFalse(/founder|contact|employer/.test(c), `${c} must not be round-eligible`);
  }
});

Deno.test("10b. a validated plan changes the search WITHOUT moving the mission", async () => {
  const { applyRoundPlanToMission } = await import(
    "../../../supabase/functions/_shared/roundPlanContract.ts");
  const m = mission();
  const v = validateRoundPlan({
    proposal: PROPOSAL({
      additional_capabilities: ["general_company_discovery"],
      company_type_broadening: { add: ["vertical saas"], reason: "adjacent" },
      employee_range_adjustment: { min: 1, max: 5000, reason: "widen" },
    }),
    mission: m, state: stateAfter(1, 20),
  });
  assert(v.ok);
  const next = applyRoundPlanToMission(m, v.plan);

  // THE TWO THINGS THAT MAY NEVER MOVE.
  assertEquals(next.company_profile.locations, ["United States"]);
  assertEquals(next.company_profile.business_models, ["b2b saas"]);
  // The permitted broadening did take effect.
  assert(next.company_profile.verticals.includes("vertical saas"));
  // …clamped into the window the mission allowed, not the 1–5000 requested.
  assertEquals(next.company_profile.employee_range?.min, 5);
  assertEquals(next.company_profile.employee_range?.max, 500);
  // A public capability was translated into ids the graph can actually resolve.
  // (Some public names are also internal names — `general_company_discovery` is
  // both — so the property that matters is resolvability, not difference.)
  const { CAPABILITY_REGISTRY } = await import(
    "../../../supabase/functions/_shared/leadCapabilityGraph.ts");
  for (const c of next.required_capabilities) {
    assert(CAPABILITY_REGISTRY[c], `${c} must be a real internal capability`);
  }
  assert(next.required_capabilities.length >= m.required_capabilities.length);
  // And no people stage arrived by any route.
  for (const c of next.required_capabilities) {
    assertFalse(/founder|contact|employer/.test(String(c)), `${c} must not be scheduled`);
  }
});

// ═══════════════════════════════════════════ 11-17. the round planner ══

Deno.test("11-13. the planner sees progress and history, and no provider at all", () => {
  const payload = buildRoundPlannerPayload({
    mission: mission(), state: stateAfter(1, 20),
    remainingBudgetClass: "ample", remainingDeadlineClass: "ample",
  });
  const p = payload as Record<string, Record<string, unknown>>;
  // 11. Shortfall and history are present.
  assertEquals(p.progress.shortfall, 80);
  assertEquals(p.progress.delivered, 20);
  assert(Array.isArray(payload.round_history) &&
    (payload.round_history as unknown[]).length === 1);

  // 12-13. Nothing vendor-shaped anywhere in the payload.
  const json = JSON.stringify(payload).toLowerCase();
  for (const banned of [
    "apify", "harvestapi", "memo23", "solidcode", "crawlworks", "actor_id",
    "api_key", "token", "bearer", "service_role", "linkedin.com/in/",
  ]) {
    assertFalse(json.includes(banned), `the planner must not see "${banned}"`);
  }
  // The capability vocabulary is abstract.
  assertEquals(payload.available_capabilities, ROUND_ELIGIBLE_CAPABILITIES);
});

Deno.test("14-15. unknown capabilities and unsafe concepts are rejected", () => {
  const m = mission();
  const r = validateRoundPlan({
    proposal: PROPOSAL({
      additional_capabilities: ["scrape_everything", "general_company_discovery"],
      new_search_concepts: [
        "Revenue Operations",
        "https://example.com/list",
        "use the apify linkedin scraper",
        "run actor memo23/y-combinator",
        "api_key=sk-live-123",
      ],
    }),
    mission: m, state: stateAfter(1, 20),
  });
  assert(r.ok);
  // 14. The invented capability is gone; the real one survives.
  assertEquals(r.plan.capabilities, ["general_company_discovery"]);
  assert(r.plan.rejections.some((x) => x.reason === "unknown_capability"));
  // 15. Only the clean concept survives.
  assertEquals(r.plan.search_concepts, ["Revenue Operations"]);
  assertEquals(
    r.plan.rejections.filter((x) => x.reason === "unsafe_search_concept").length, 4);
});

Deno.test("16-17. an honest stop and a malformed plan both fail safely", () => {
  // 16. The planner may decline, and that is not an error.
  const stop = validateRoundPlan({
    proposal: PROPOSAL({
      continue: false, expected_incremental_value: "low",
      stop_reason: "remaining candidates would not match the request",
    }),
    mission: mission(), state: stateAfter(1, 20),
  });
  assertFalse(stop.ok);
  assertEquals(stop.rejections.length, 0, "declining is not a rejection");
  assert(stop.stop_detail.includes("would not match"));

  // 17. Malformed input never becomes a guessed plan.
  for (const junk of [
    null, "nonsense", [], {}, { continue: "yes" }, { reason: "x" },
  ]) {
    assertEquals(parseRoundPlan(junk), null, `${JSON.stringify(junk)} must not parse`);
  }
  // A well-formed plan with junk fields keeps only what it understands.
  const parsed = parseRoundPlan({
    continue: true, reason: "x", expected_incremental_value: "nonsense",
    new_search_concepts: ["a", 42, null], additional_capabilities: "not-an-array",
  });
  assert(parsed);
  assertEquals(parsed.expected_incremental_value, "low", "an unknown value is the cautious one");
  assertEquals(parsed.new_search_concepts, ["a"]);
  assertEquals(parsed.additional_capabilities, []);
});

// ════════════════════════════════════════════════════ 18-22. dedupe ══

const CAND = (over: Partial<RoundCandidate> = {}): RoundCandidate => ({
  company_key: "co1", company_name: "Acme Inc", website: "https://acme.com",
  linkedin_company_url: "https://www.linkedin.com/company/acme",
  discovered_round: 1, ...over,
});

Deno.test("18-19. the same company across rounds and providers is one candidate", () => {
  let pool = new Map<string, PooledCompany>();

  // Round 1: from a startup cohort.
  let r = addRoundCandidates(pool, [CAND()]);
  pool = r.pool;
  assertEquals(r.newCompanies.length, 1);

  // 18. Round 2: same LinkedIn company, different key and a trailing slash.
  r = addRoundCandidates(pool, [CAND({
    company_key: "yc-acme", discovered_round: 2,
    linkedin_company_url: "https://linkedin.com/company/acme/",
  })]);
  pool = r.pool;
  assertEquals(pool.size, 1, "one LinkedIn identity is one company");
  assertEquals(r.newCompanies.length, 0);

  // 19. Round 3: no LinkedIn at all, but the same domain.
  r = addRoundCandidates(pool, [CAND({
    company_key: "other", linkedin_company_url: null,
    website: "http://www.acme.com/", discovered_round: 3,
  })]);
  pool = r.pool;
  assertEquals(pool.size, 1, "the same domain is the same company");

  const only = [...pool.values()][0];
  assertEquals(only.first_discovered_round, 1);
  assertEquals(only.all_discovered_rounds, [1, 2, 3]);
});

Deno.test("20-21. evidence merges and conflicts stay explicit", () => {
  let pool = new Map<string, PooledCompany>();
  pool = addRoundCandidates(pool, [CAND({
    description: "Sales software.", source_urls: ["https://a"],
    job_evidence: [{ title: "AE" }], employee_count: 40,
  })]).pool;

  const r = addRoundCandidates(pool, [CAND({
    discovered_round: 2, description: "Revenue platform for teams.",
    source_urls: ["https://b"], job_evidence: [{ title: "RevOps" }],
    // A DISAGREEMENT, not an update.
    employee_count: 90, search_concept: "Revenue Operations",
  })]);
  const c = [...r.pool.values()][0];

  // 20. Merged rather than discarded.
  assertEquals(c.descriptions.length, 2);
  assertEquals(c.source_urls, ["https://a", "https://b"]);
  assertEquals(c.job_evidence.length, 2);
  assertEquals(c.search_concepts, ["Revenue Operations"]);

  // 21. The conflict is recorded and the first value is NOT overwritten.
  assertEquals(c.employee_count, 40, "a later source fills, it does not overwrite");
  assert(c.conflicts.some((x) => x.field === "employee_count" &&
    x.existing === "40" && x.incoming === "90" && x.round === 2));

  // New evidence that could change a verdict bumps the revision.
  assert(c.evidence_revision > 1);
  assertEquals(r.materiallyChanged.length, 1);
});

Deno.test("22. a duplicate is not evaluated twice", () => {
  let pool = new Map<string, PooledCompany>();
  pool = addRoundCandidates(pool, [CAND()]).pool;
  const key = [...pool.keys()][0];
  const evaluatedAt = new Map([[key, pool.get(key)!.evidence_revision]]);

  // Re-sighted with nothing new: lineage only.
  const again = addRoundCandidates(pool, [CAND({ discovered_round: 2 })]);
  const sel = selectForEvaluation({ pool: again.pool, evaluatedAtRevision: evaluatedAt });
  assertEquals(sel.evaluate, [], "an unchanged duplicate is never re-evaluated");
  assertEquals(sel.restore, [key]);
});

// ══════════════════════════════════ 23-28. incremental evaluation ══

Deno.test("23-26. only new, changed or newly-evidenced companies are evaluated", () => {
  let pool = new Map<string, PooledCompany>();
  pool = addRoundCandidates(pool, [CAND()]).pool;
  const k1 = [...pool.keys()][0];
  const evaluatedAt = new Map([[k1, 1]]);

  // 23. A brand-new company is evaluated.
  const added = addRoundCandidates(pool, [CAND({
    company_key: "co2", company_name: "Beta Ltd",
    website: "https://beta.com",
    linkedin_company_url: "https://www.linkedin.com/company/beta",
    discovered_round: 2,
  })]);
  let sel = selectForEvaluation({ pool: added.pool, evaluatedAtRevision: evaluatedAt });
  assertEquals(sel.evaluate.length, 1);
  assertEquals(sel.restore, [k1], "24. the unchanged one restores");

  // 25. Materially changed evidence forces a re-evaluation.
  const changed = addRoundCandidates(added.pool, [CAND({
    discovered_round: 3, description: "Actually a vertical SaaS for clinics.",
  })]);
  sel = selectForEvaluation({
    pool: changed.pool,
    evaluatedAtRevision: new Map([[k1, 1], [[...added.newCompanies][0], 1]]),
  });
  assert(sel.evaluate.includes(k1), "changed evidence must be re-evaluated");

  // 26. A previously unresolved company re-evaluates once new evidence lands.
  const unresolved = selectForEvaluation({
    pool: changed.pool, evaluatedAtRevision: new Map([[k1, 1]]),
    unresolvedKeys: [k1],
  });
  assert(unresolved.evaluate.includes(k1));
});

Deno.test("27-28. ranking reruns on a changed pool and not otherwise", async () => {
  // Driven through the controller: round 2 that adds companies must re-rank,
  // and a round that adds none must not have been worth ranking again.
  const ranks: number[] = [];
  const exec = (round: number, candidates: RoundCandidate[], delivered: number): RoundExecution => ({
    candidates,
    groundedByKey: new Map(candidates.map((c) => [`li:${c.company_key}`, { ok: true }])),
    pool: {
      hard_gated: 0, eligible: candidates.length, evaluated: candidates.length,
      qualified: delivered, review: 0, watch: 0, delivered,
    },
    providerCostUnits: 1, modelCostUnits: 1,
  });

  const r = await runMultiRoundSourcing({
    runRound: ({ round }) => {
      ranks.push(round);
      return Promise.resolve(round === 1
        ? exec(1, [CAND({ linkedin_company_url: "https://www.linkedin.com/company/a" })], 10)
        // Round 2 discovers only what round 1 already had.
        : exec(2, [CAND({
          discovered_round: 2,
          linkedin_company_url: "https://www.linkedin.com/company/a",
        })], 10));
    },
    planNextRound: () => Promise.resolve(PROPOSAL()),
    limits: () => LIMITS(),
  }, { mission: mission(), requestedCount: 100 });

  assertEquals(ranks, [1, 2], "round 2 ran");
  // Round 2 added nothing unique, so no round 3 was attempted.
  assertEquals(r.state.round_number, 2);
  assertEquals(r.terminal_reason, "search_exhausted");
});

// ═════════════════════════════════════════ 29-32. provider reuse ══

Deno.test("29-30. paid verdicts are restored, and a missing one is not skipped", async () => {
  const evaluateCalls: string[][] = [];
  const r = await runMultiRoundSourcing({
    runRound: ({ round, evaluateKeys }) => {
      evaluateCalls.push(evaluateKeys);
      const c = round === 1
        ? [CAND({ linkedin_company_url: "https://www.linkedin.com/company/a" })]
        : [CAND({
          company_key: "co2", discovered_round: 2,
          website: "https://beta.com",
          linkedin_company_url: "https://www.linkedin.com/company/b",
        })];
      return Promise.resolve({
        candidates: c,
        groundedByKey: new Map(c.map((x) => [
          `li:${x.linkedin_company_url!.split("/company/")[1]}`, { verdict: "pass" },
        ])),
        pool: {
          hard_gated: 0, eligible: round, evaluated: round,
          qualified: round * 5, review: 0, watch: 0, delivered: round * 5,
        },
        providerCostUnits: 1, modelCostUnits: 1,
      } as RoundExecution);
    },
    planNextRound: () => Promise.resolve(PROPOSAL()),
    limits: () => LIMITS(),
  }, { mission: mission(), requestedCount: 100, maxRounds: 2 });

  // 29. Round 2 was told to evaluate nothing already paid for.
  assertEquals(evaluateCalls[0], [], "round 1 starts with an empty pool");
  assertFalse(evaluateCalls[1].includes("li:a"),
    "a company already evaluated must not be re-evaluated");
  // 30. The pool still contains both companies — restoring, not skipping.
  assertEquals(r.pool.size, 2);
});

Deno.test("31-32. exhausted concepts are not repeated; a failure is not a company fact", () => {
  // 31. An equivalent rewording hashes the same and is filtered.
  const h = conceptHash("Revenue Operations");
  assertEquals(h, conceptHash("operations revenue"), "order and case do not matter");
  assert(isConceptExhausted("REVENUE  operations", [h]));

  const r = validateRoundPlan({
    proposal: PROPOSAL({ new_search_concepts: ["Revenue Operations", "GTM Operations"] }),
    mission: mission(),
    state: { ...stateAfter(1, 20), exhausted_search_concepts: [h] },
  });
  assert(r.ok);
  assertEquals(r.plan.search_concepts, ["GTM Operations"], "the exhausted one is dropped");

  // 32. A provider that returned nothing marks the CONCEPT exhausted; it makes
  // no claim about any company.
  const rec = assessConcept({
    concept: "Revenue Operations", round: 2, resultCount: 0,
    uniqueNew: 0, eligibleNew: 0, deliveredNew: 0,
  });
  assertEquals(rec.exhausted_reason, "no_results");
  assertEquals(Object.keys(rec).includes("company_key"), false,
    "a concept record carries no company verdict");
});

// ═════════════════════════════════════════ 33-38. stop conditions ══

Deno.test("33-38. every limit stops the loop with an honest reason", () => {
  const cases: Array<[string, ReturnType<typeof decideNextRound>, string]> = [
    ["budget", decideNextRound(
      { ...stateAfter(1, 20), provider_cost_units_used: 12 }, LIMITS()), "budget_exhausted"],
    ["model", decideNextRound(
      { ...stateAfter(1, 20), model_cost_units_used: 24 }, LIMITS()), "model_limit_reached"],
    ["deadline", decideNextRound(
      stateAfter(1, 20), LIMITS({ deadlineReserveReached: true })), "deadline_reached"],
    ["rounds", decideNextRound(stateAfter(3, 63), LIMITS()), "round_limit_reached"],
    ["cancelled", decideNextRound(
      stateAfter(1, 20), LIMITS({ cancelled: true })), "cancelled"],
    ["provider", decideNextRound(
      stateAfter(1, 20), LIMITS({ providerFailed: true })), "provider_failure"],
  ];
  for (const [name, d, expected] of cases) {
    assertFalse(d.start, `${name} must stop the loop`);
    assertEquals(d.terminal_reason, expected);
  }

  // 35/36. A round that found nothing new, and one whose finds were all gated.
  let s = stateAfter(1, 20);
  s = { ...s, round_history: [{ ...s.round_history[0], new_companies: 0 }] };
  assertEquals(decideNextRound(s, LIMITS()).terminal_reason, "search_exhausted");

  let g = stateAfter(1, 20);
  g = { ...g, round_history: [{ ...g.round_history[0], new_companies: 12, eligible: 0 }] };
  assertEquals(decideNextRound(g, LIMITS()).terminal_reason, "search_exhausted");

  // 38. A shortfall is never reported as `completed`.
  assertFalse(decideNextRound(stateAfter(3, 63), LIMITS()).terminal_reason === "completed");
});

// ═══════════════════════════════════════════════════ 39-42. counts ══

Deno.test("39-42. opportunities, qualification and unlocks are separate numbers", () => {
  const s = recordRound(newMultiRoundState({ requestedCount: 100 }), {
    round: 1, strategy_type: "exact", capabilities: [], search_concepts: [],
    signal_families: [], company_types: [], employee_range: { min: null, max: null },
    provider_operations: [], discovered: 120, new_companies: 120, hard_gated: 20,
    eligible: 100, new_evaluated_companies: 87, qualified: 42, review: 31,
    watch: 14, new_delivered_opportunities: 87, provider_cost_units: 3,
    model_cost_units: 4,
  }, {
    unique_companies: 120, eligible: 100, evaluated: 87,
    qualified: 42, review: 31, watch: 14, delivered: 87,
  });
  const c = countsOf(s);

  // 39. Delivered is not qualified.
  assertEquals(c.delivered_opportunity_count, 87);
  assertEquals(c.qualified_count, 42);
  assertEquals(c.review_count, 31);
  assertEquals(c.watch_count, 14);
  assertEquals(c.remaining_shortfall, 13);
  assert(c.delivered_opportunity_count !== c.qualified_count);

  // 40-41. Sourcing never unlocks anyone.
  assertEquals(c.founder_unlocked_count, 0);
  assertEquals(c.contact_unlocked_count, 0);
  assertEquals(c.contact_ready_count, 0);

  // 42. A request for 100 that found 87 reports 87.
  assertEquals(c.requested_opportunity_count, 100);
  assertFalse(c.delivered_opportunity_count === c.requested_opportunity_count);
});

// ═══════════════════════════════════════════ 43-53. regression ══

Deno.test("43-45. the existing routes are untouched by Stage 4", () => {
  for (const q of [
    "Find founders of US B2B SaaS startups hiring Sales Ops. Return 25 leads.",
    "Enrich these companies: stripe.com, notion.so",
    "Find US manufacturers hiring controls engineers. Return 20 leads.",
  ]) {
    const m = parseLeadMissionDeterministic(q);
    const plan = buildCapabilityGraph(m);
    assert(plan.steps.length > 0, `${q.slice(0, 30)} still produces a plan`);
    assert(plan.entry_capability, "an entry capability is still chosen");
  }
});

Deno.test("46-49. Stage 2 and Stage 3 survive Stage 4 unchanged", async () => {
  // 48. Founder discovery is still absent from every sourcing plan.
  const m = parseLeadMissionDeterministic(
    "Find founders of US B2B SaaS startups hiring Sales Ops. Return 25 leads.");
  const plan = buildCapabilityGraph(m);
  for (const stage of ["founder_discovery", "employer_verification", "contact_enrichment"]) {
    assertFalse(plan.steps.some((s) => String(s.capability) === stage));
    assert((plan.prohibited as readonly string[]).includes(stage));
  }
  assert(plan.offered_capabilities.includes("offer_founder_unlock"),
    "it remains an OFFER, which runs nothing");

  // 47. Stage 2 ranking still exports its contract.
  const { validatePoolRanking, deterministicRanking } = await import(
    "../../../supabase/functions/_shared/poolRanking.ts");
  assert(typeof validatePoolRanking === "function");
  assert(typeof deterministicRanking === "function");

  // 49. Nothing in Stage 4 touches the credit ledger.
  for (const f of [
    "multiRoundState.ts", "roundPlanContract.ts", "crossRoundDedupe.ts",
    "multiRoundController.ts", "multiRoundBinding.ts",
  ]) {
    const src = await Deno.readTextFile(
      new URL(`../../../supabase/functions/_shared/${f}`, import.meta.url));
    for (const banned of [
      "credits_reserve", "credits_finalize", "credits_grant",
      "workspace_credit_balances", "credit_transactions", "unlock-founders",
    ]) {
      assertFalse(src.includes(banned), `${f} must not touch ${banned}`);
    }
  }
});

Deno.test("50-53. no provider, no production and no protected file is reachable", async () => {
  // The denylist itself is proven to work by test 14-15, which drives real
  // vendor names through `validateRoundPlan` and asserts every one is refused.
  for (const f of [
    "multiRoundState.ts", "roundPlanContract.ts", "crossRoundDedupe.ts",
    "multiRoundController.ts", "multiRoundBinding.ts",
  ]) {
    const src = await Deno.readTextFile(
      new URL(`../../../supabase/functions/_shared/${f}`, import.meta.url));
    // 50. NO ACTOR KEY IS NAMEABLE FROM A ROUND MODULE. `apify_*` is the form
    // an Actor is actually selected by, so its absence is what proves a round
    // cannot choose one.
    assertFalse(src.includes("apify_"), `${f} must not name an Actor key`);
    // Vendor brand names are absent too — EXCEPT in the concept denylist, whose
    // whole job is to recognise and refuse them. A denylist that may not name
    // what it denies cannot work.
    if (f !== "roundPlanContract.ts") {
      for (const banned of ["harvestapi", "memo23", "solidcode", "crawlworks"]) {
        assertFalse(src.includes(banned), `${f} must not name ${banned}`);
      }
    }
    // 52. Production is never referenced except in a comment.
    for (const line of src.split("\n")) {
      if (line.includes("ohsdatpvfdjdemstoiuj")) {
        assert(line.trim().startsWith("//"), `${f}: production ref only in a comment`);
      }
    }
    // 53. Nothing imports the protected file.
    assertFalse(/from\s+["'][^"']*\/mcp\//.test(src), `${f} must not import mcp`);
    // 51. No round module performs IO of its own.
    assertFalse(src.includes("fetch("), `${f} must not call fetch`);
  }
});

Deno.test("flag: off by default, and an empty allow-list enables nobody", () => {
  const QA = "11111111-2222-4333-8444-555555555555";
  const env = (o: Record<string, string>) => (k: string) => o[k];

  assertFalse(isMultiRoundEnabled(QA, env({})).enabled);
  assertEquals(isMultiRoundEnabled(QA, env({})).reason, "flag_off");
  assertEquals(
    isMultiRoundEnabled(QA, env({ MULTI_ROUND_SOURCING: "true" })).reason,
    "no_workspace_allowlist");
  assertEquals(
    isMultiRoundEnabled("other", env({
      MULTI_ROUND_SOURCING: "true", MULTI_ROUND_SOURCING_WORKSPACES: QA,
    })).reason, "workspace_not_allowed");

  const on = isMultiRoundEnabled(QA, env({
    MULTI_ROUND_SOURCING: "true", MULTI_ROUND_SOURCING_WORKSPACES: QA,
  }));
  assert(on.enabled);
  assertEquals(on.maxRounds, 3);

  // A misconfigured ceiling makes a run SMALLER, never unbounded.
  const huge = isMultiRoundEnabled(QA, env({
    MULTI_ROUND_SOURCING: "true", MULTI_ROUND_SOURCING_WORKSPACES: QA,
    MULTI_ROUND_SOURCING_MAX_ROUNDS: "99",
    MULTI_ROUND_SOURCING_MAX_COST_UNITS: "9999",
  }));
  assertEquals(huge.maxRounds, 3);
  assertEquals(huge.maxProviderCostUnits, 12);
});

// ═══════════════════════ PART 18 — the offline three-round demonstration ══

/** Builds `n` distinct companies for a round. */
const companies = (round: number, from: number, n: number): RoundCandidate[] =>
  Array.from({ length: n }, (_, i) => CAND({
    company_key: `co${from + i}`, company_name: `Co ${from + i}`,
    website: `https://co${from + i}.com`,
    linkedin_company_url: `https://www.linkedin.com/company/co${from + i}`,
    discovered_round: round,
  }));

Deno.test("DEMO. three rounds deliver 63 of 100 and say so", async () => {
  // Round 1: 50 discovered → 24 delivered. Round 2: 45 discovered of which 23
  // are new → 42 total. Round 3: 55 discovered of which 30 are new → 63 total.
  const plans: Array<number | null> = [];
  const result = await runMultiRoundSourcing({
    runRound: ({ round, plan }) => {
      plans.push(plan ? plan.round : null);
      const spec = {
        1: { cands: companies(1, 1, 50), delivered: 24 },
        2: { cands: [...companies(2, 1, 22), ...companies(2, 51, 23)], delivered: 42 },
        3: { cands: [...companies(3, 1, 25), ...companies(3, 74, 30)], delivered: 63 },
      }[round]!;
      return Promise.resolve({
        candidates: spec.cands,
        groundedByKey: new Map(),
        pool: {
          hard_gated: 4, eligible: spec.cands.length - 4,
          evaluated: spec.cands.length - 4,
          qualified: Math.round(spec.delivered * 0.5),
          review: Math.round(spec.delivered * 0.35),
          watch: Math.round(spec.delivered * 0.15),
          delivered: spec.delivered,
        },
        providerCostUnits: 2, modelCostUnits: 2,
      } as RoundExecution);
    },
    planNextRound: () => Promise.resolve(PROPOSAL()),
    limits: () => LIMITS(),
  }, { mission: mission(), requestedCount: 100 });

  // ROUND 1 IS EXACT — it received no plan.
  assertEquals(plans[0], null, "round 1 runs the mission as written");
  assertEquals(plans.length, 3, "three rounds ran");

  assertEquals(result.state.delivered_opportunity_count, 63);
  assertEquals(result.state.remaining_shortfall, 37);
  assertEquals(result.terminal_reason, "round_limit_reached");
  // IT RETURNS 63. It does not invent 100.
  assertFalse(result.state.delivered_opportunity_count === 100);

  // Per-round observability.
  const s = roundSummaryForWorkbench(result);
  assertEquals(s.requested, 100);
  assertEquals(s.delivered, 63);
  assertEquals(s.rounds_used, 3);
  assertEquals(s.rounds.map((r) => r.discovered), [50, 45, 55]);
  assertEquals(s.rounds.map((r) => r.new_unique), [50, 23, 30]);
  // Nothing was unlocked to close the gap.
  assertEquals(s.founder_unlocked, 0);
  assertEquals(s.contact_ready, 0);
  // Duplicates were merged, not counted.
  assertEquals(result.pool.size, 103);
});

Deno.test("DEMO. round 1 reaching the target stops immediately", async () => {
  let rounds = 0;
  const r = await runMultiRoundSourcing({
    runRound: () => {
      rounds++;
      return Promise.resolve({
        candidates: companies(1, 1, 120),
        pool: {
          hard_gated: 0, eligible: 120, evaluated: 120,
          qualified: 100, review: 0, watch: 0, delivered: 100,
        },
        providerCostUnits: 2, modelCostUnits: 2,
      } as RoundExecution);
    },
    planNextRound: () => { throw new Error("the planner must not be consulted"); },
    limits: () => LIMITS(),
  }, { mission: mission(), requestedCount: 100 });

  assertEquals(rounds, 1, "the target was met; no second round runs");
  assertEquals(r.terminal_reason, "completed");
  assertEquals(r.state.remaining_shortfall, 0);
});

Deno.test("DEMO. a round with zero new candidates stops the third", async () => {
  let rounds = 0;
  const r = await runMultiRoundSourcing({
    runRound: ({ round }) => {
      rounds++;
      return Promise.resolve({
        // Round 2 rediscovers exactly what round 1 found.
        candidates: companies(round, 1, 30),
        pool: {
          hard_gated: 0, eligible: 30, evaluated: 30,
          qualified: 12, review: 0, watch: 0, delivered: 12,
        },
        providerCostUnits: 2, modelCostUnits: 2,
      } as RoundExecution);
    },
    planNextRound: () => Promise.resolve(PROPOSAL()),
    limits: () => LIMITS(),
  }, { mission: mission(), requestedCount: 100 });

  assertEquals(rounds, 2, "round 3 must not run after a round that added nothing");
  assertEquals(r.terminal_reason, "search_exhausted");
});

Deno.test("DEMO. a deadline after round 1 checkpoints and a continuation resumes", async () => {
  const checkpoints: string[] = [];
  let reserveReached = true;

  // First invocation: round 1 runs, then the reserve stops the loop.
  const first = await runMultiRoundSourcing({
    runRound: () => Promise.resolve({
      candidates: companies(1, 1, 40),
      pool: {
        hard_gated: 0, eligible: 40, evaluated: 40,
        qualified: 15, review: 0, watch: 0, delivered: 15,
      },
      providerCostUnits: 2, modelCostUnits: 2,
    } as RoundExecution),
    planNextRound: () => Promise.resolve(PROPOSAL()),
    limits: () => LIMITS({ deadlineReserveReached: reserveReached }),
    onCheckpoint: (cp) => { checkpoints.push(`${cp.phase}:${cp.current_round}`); },
  }, { mission: mission(), requestedCount: 100 });

  assertEquals(first.terminal_reason, "deadline_reached");
  assertEquals(first.state.round_number, 1);
  assert(checkpoints.includes("round_complete:1"), "the round was checkpointed");

  // CONTINUATION: the restored state starts at round 2, not round 1.
  reserveReached = false;
  const roundsSeen: number[] = [];
  const second = await runMultiRoundSourcing({
    runRound: ({ round }) => {
      roundsSeen.push(round);
      return Promise.resolve({
        candidates: companies(round, 100, 40),
        pool: {
          hard_gated: 0, eligible: 80, evaluated: 80,
          qualified: 30, review: 0, watch: 0, delivered: 30,
        },
        providerCostUnits: 2, modelCostUnits: 2,
      } as RoundExecution);
    },
    planNextRound: () => Promise.resolve(PROPOSAL()),
    limits: () => LIMITS(),
  }, {
    mission: mission(), requestedCount: 100,
    resumeState: first.state, resumePool: first.pool,
  });

  assertEquals(roundsSeen[0], 2, "the continuation resumes at round 2");
  // Round 1's companies were not rediscovered or re-counted.
  assert(second.pool.size > first.pool.size);
  assertEquals(second.state.round_history.length, 3,
    "round 1's history survived the continuation");
});

// ══════════════════════ 33-37. a later round may not destroy an earlier one ══
//
// THE RUN THESE COME FROM: task cc556f5e. Round 1 discovered 100 companies,
// resolved 3 identities, enriched them, and the mission evaluator qualified
// `idler.ai` (92) and `godela.ai` (91). The controller then decided a round 2
// was worth it, spent the remaining clock on the planner call, and entered a
// round with nothing left: the identity stage attempted 0 of 13 calls and the
// Brain was reached by nobody. Round 2 reported qualified 0 — and that zero was
// ASSIGNED over round 1's two. Both companies persisted as `deferred`, and the
// run told the user it had qualified nobody.
//
// Two independent faults, so two independent guards.

/** A round that reached evaluation and proved `qualified` companies. */
const MEASURED = (qualified: number, candidates: RoundCandidate[]): RoundExecution => ({
  candidates,
  groundedByKey: new Map(candidates.map((c) => [`li:${c.company_key}`, { ok: true }])),
  pool: {
    hard_gated: 0, eligible: candidates.length, evaluated: candidates.length,
    qualified, review: 0, watch: 0, delivered: qualified,
  },
  providerCostUnits: 1, modelCostUnits: 1,
});

/** A round that never reached evaluation. Its zeros mean "we did not look". */
const UNMEASURED = (candidates: RoundCandidate[]): RoundExecution => ({
  candidates,
  groundedByKey: new Map(),
  pool: {
    hard_gated: 0, eligible: 0, evaluated: 0,
    qualified: 0, review: 0, watch: 0, delivered: 0,
  },
  providerCostUnits: 1, modelCostUnits: 0,
});

Deno.test("33. a round that evaluated NOBODY cannot zero the totals a round proved",
  async () => {
    const r = await runMultiRoundSourcing({
      runRound: ({ round }) =>
        Promise.resolve(round === 1
          // Round 1: two real qualified companies.
          ? MEASURED(2, [
            CAND({ company_key: "idler", linkedin_company_url: "https://www.linkedin.com/company/idler" }),
            CAND({ company_key: "godela", linkedin_company_url: "https://www.linkedin.com/company/godela" }),
          ])
          // Round 2: rediscovers the pool, reaches the Brain with nobody.
          : UNMEASURED([
            CAND({ company_key: "new1", discovered_round: 2, website: "https://n1.com",
              linkedin_company_url: "https://www.linkedin.com/company/n1" }),
          ])),
      planNextRound: () => Promise.resolve(PROPOSAL()),
      limits: () => LIMITS(),
    }, { mission: mission(), requestedCount: 100, maxRounds: 2 });

    assertEquals(r.state.round_number, 2, "round 2 did run");
    // THE ASSERTION THE OLD CODE FAILED: round 1's proof survives round 2.
    assertEquals(r.state.qualified_count, 2,
      "two companies were qualified and an unmeasured round may not un-qualify them");
    assertEquals(r.state.delivered_opportunity_count, 2);
    assertEquals(r.counts.qualified_count, 2, "and the Workbench summary agrees");
    assertEquals(r.counts.remaining_shortfall, 98,
      "the shortfall is measured against what was proved, not reset to the request");
  });

Deno.test("34. a round that DID evaluate is still authoritative, including downwards",
  async () => {
    // The guard must not become "counts only ever rise". A round that actually
    // re-evaluated the pool is entitled to restate it — that is the whole point
    // of pooling across rounds.
    const r = await runMultiRoundSourcing({
      runRound: ({ round }) =>
        Promise.resolve(round === 1
          ? MEASURED(9, [CAND({ linkedin_company_url: "https://www.linkedin.com/company/a" })])
          : MEASURED(4, [CAND({ company_key: "co2", discovered_round: 2,
            website: "https://beta.com",
            linkedin_company_url: "https://www.linkedin.com/company/b" })])),
      planNextRound: () => Promise.resolve(PROPOSAL()),
      limits: () => LIMITS(),
    }, { mission: mission(), requestedCount: 100, maxRounds: 2 });

    assertEquals(r.state.qualified_count, 4,
      "a round that evaluated the pool restates it, even when the number falls");
  });

Deno.test("35. a round is refused when the clock died AFTER it was decided", async () => {
  // The exact shape of the failure: limits are fine when round 1 ends, and the
  // reserve is reached by the time round 2 would start — the planner call is
  // what consumed it.
  const rounds: number[] = [];
  let clockDead = false;
  const r = await runMultiRoundSourcing({
    runRound: ({ round }) => {
      rounds.push(round);
      return Promise.resolve(MEASURED(2, [
        CAND({ linkedin_company_url: "https://www.linkedin.com/company/a" }),
      ]));
    },
    planNextRound: () => {
      // Planning is what burns the remaining time.
      clockDead = true;
      return Promise.resolve(PROPOSAL());
    },
    limits: () => LIMITS({ deadlineReserveReached: clockDead }),
  }, { mission: mission(), requestedCount: 100, maxRounds: 3 });

  assertEquals(rounds, [1], "round 2 must never start on a dead clock");
  assertEquals(r.state.terminal_reason, "deadline_reached");
  assertEquals(r.terminal_reason, "deadline_reached");
  // AND ROUND 1'S RESULT SHIPS. Refusing the round is not failing the run.
  assertEquals(r.state.qualified_count, 2);
});

Deno.test("36. round 1 is never refused by the entry guard", async () => {
  // Round 1 is the exact mission and, in the executor, is already complete and
  // merely handed back. Refusing it would discard finished work and return a
  // run with nothing in it.
  const rounds: number[] = [];
  const r = await runMultiRoundSourcing({
    runRound: ({ round }) => {
      rounds.push(round);
      return Promise.resolve(MEASURED(3, [
        CAND({ linkedin_company_url: "https://www.linkedin.com/company/a" }),
      ]));
    },
    planNextRound: () => Promise.resolve(PROPOSAL()),
    limits: () => LIMITS({ deadlineReserveReached: true }),
  }, { mission: mission(), requestedCount: 100, maxRounds: 3 });

  assertEquals(rounds, [1], "round 1 ran despite the reserve already being reached");
  assertEquals(r.state.qualified_count, 3, "and its result is kept");
});

Deno.test("37. a cancellation between rounds stops the next one before it spends",
  async () => {
    const rounds: number[] = [];
    let cancelled = false;
    const r = await runMultiRoundSourcing({
      runRound: ({ round }) => {
        rounds.push(round);
        return Promise.resolve(MEASURED(1, [
          CAND({ linkedin_company_url: "https://www.linkedin.com/company/a" }),
        ]));
      },
      planNextRound: () => {
        cancelled = true;
        return Promise.resolve(PROPOSAL());
      },
      limits: () => LIMITS({ cancelled }),
    }, { mission: mission(), requestedCount: 100, maxRounds: 3 });

    assertEquals(rounds, [1]);
    assertEquals(r.state.terminal_reason, "cancelled");
  });
