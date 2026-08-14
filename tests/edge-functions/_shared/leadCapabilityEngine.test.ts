// THE GRAPH DRIVES EXECUTION — integration proof, zero paid runs.
//
// Phase 1 proved the graph could FORBID. These tests prove it DRIVES: the
// capability order is the execution order, providers come only from the
// capability that asked for them, evidence gates hold, exhaustion is terminal,
// and a resume continues at the next incomplete capability without
// re-interpreting anything.
//
// Every Actor is a mock. ZERO network, ZERO Actor runs, ZERO model calls,
// ZERO database writes.

import { assert, assertEquals, assertFalse, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  CapabilityContainmentError, buildCapabilityGraph,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { stubMissionEvaluator } from "./missionEvaluatorFixture.ts";
import { guardedInvoker } from "../../../supabase/functions/_shared/leadMissionRuntime.ts";
import {
  newExecutionState, runCapabilityPlan, stateMatchesMission, toRouteResultShape,
  type CapabilityEngineDeps, type CapabilityExecutionState,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { parseSemanticFitStrict } from "../../../supabase/functions/_shared/companyBrainSemanticFit.ts";

const CANONICAL =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";

const mission = (): LeadMissionV1 => parseLeadMissionDeterministic(CANONICAL);

const BRAIN = {
  employee_min: 10,
  employee_max: 150,
  positive_industries: ["b2b saas"],
  excluded_industries: [] as string[],
  required_geography: null,
};

/**
 * One memo23 YC row, in the provider's real shape.
 *
 * THE FIELD NAMES ARE `teamSize` AND `openJobs`. This fixture used to say
 * `team_size` and `jobs`, which memo23 never emits — `normalizeMemo23Company`
 * reads `r.teamSize` and `normalizeMemo23OpenJobs` reads `r.openJobs`, so the
 * old fixture was silently exercising a company with no size and no jobs. It
 * passed only because nothing downstream had yet been made to depend on either.
 * Free prequalification depends on both.
 */
function ycRow(name: string, slug: string) {
  return {
    id: slug, name, website: `https://${slug}.com`,
    industry: "B2B", industries: ["B2B"], batch: "W22", teamSize: 42,
    oneLiner: `${name} is a B2B SaaS platform.`,
    allLocations: "San Francisco, CA, USA",
    openJobs: [{ title: "Revenue Operations Manager", url: `https://x/${slug}/1` }],
  };
}

/** One harvestapi/linkedin-company-search row — the IDENTITY provider. */
function searchRow(name: string, slug: string) {
  return {
    id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}`,
    website: `https://${slug}.com`,
    description: `${name} is a B2B SaaS platform sold on subscription.`,
    location: "San Francisco, CA",
  };
}

/** One harvestapi/linkedin-company enrichment row, in the provider's real shape. */
function enrichRow(name: string, slug: string) {
  return {
    id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}`,
    website: `https://${slug}.com`, employeeCount: 42,
    description: `${name} is a B2B SaaS platform sold on subscription.`,
    // `industries`, not `industry` — the enriched ids are what the gate reads.
    industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
    locations: [{ linkedinText: "United States" }],
  };
}

interface Recorder { calls: string[]; }

/**
 * Build engine deps whose invoker records every actor key and returns canned
 * rows per actor. Anything not in `rows` returns empty.
 */
function mockDeps(
  rows: Record<string, Record<string, unknown>[]>,
  rec: Recorder,
  over: Partial<CapabilityEngineDeps> = {},
): CapabilityEngineDeps {
  return {
    invoke: (call: CompiledActorCall<unknown>) => {
      rec.calls.push(call.actorKey);
      return Promise.resolve(rows[call.actorKey] ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    // THE EVALUATOR IS NOW A REQUIRED DEPENDENCY OF A QUALIFYING RUN.
    //
    // Nothing in this file is about evaluator availability; these tests are
    // about capability ordering, provider choice, evidence gates and resume.
    // Before Phase 4 the engine could qualify a company from a deterministic
    // gate pass, so they needed no model dep. Now only the evaluator can decide
    // a Mission is satisfied — a run without one qualifies nobody, by design —
    // so omitting it here would silently turn every test below into a test of
    // the no-evaluator path. The stub answers from each company's OWN registry
    // and is still checked by `parseMissionEvaluationStrict`, so it cannot
    // smuggle an ungrounded pass.
    evaluateMission: stubMissionEvaluator(),
    ...over,
  };
}

const HAPPY_ROWS = {
  apify_yc_companies_memo23: [ycRow("Sortly", "sortly"), ycRow("Clay", "clay")],
  // Identity resolution now uses the SEARCH actor. `apify_linkedin_company_details`
  // is reached only by enrichment, which is the whole point of the change.
  apify_linkedin_company_search: [searchRow("Sortly", "sortly")],
  apify_linkedin_company_details: [enrichRow("Sortly", "sortly")],
  apify_linkedin_job_search: [{
    id: "j1", title: "Revenue Operations Manager",
    company: { name: "Sortly", linkedinUrl: "https://www.linkedin.com/company/sortly" },
    postedDate: "2026-07-20",
  }],
  apify_linkedin_company_employees: [{
    id: "p1", firstName: "Ada", lastName: "Founder",
    headline: "Co-Founder & CEO",
    linkedinUrl: "https://www.linkedin.com/in/ACwAAA",
    currentPositions: [{
      companyName: "Sortly", companyLinkedinUrl: "https://www.linkedin.com/company/sortly",
      isCurrent: true, title: "Co-Founder",
    }],
  }],
};

// ═══════════════════════════════════════════════ 1. the graph drives order ══

Deno.test("1. the capability graph IS the execution order", async () => {
  const rec: Recorder = { calls: [] };
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan(mockDeps(HAPPY_ROWS, rec), {
    mission: m, plan, brain: BRAIN,
  });

  const executed = run.capability_outcomes.map((o) => o.capability);
  assertEquals(executed, plan.steps.map((s) => s.capability),
    "every plan step is attempted, in plan order, and nothing else is");

  // The pipeline reached the end.
  assertEquals(run.state.pending_capabilities, []);
  assertEquals(run.state.terminal_reason, "capability_plan_complete");
});

Deno.test("2. memo23 is the FIRST provider called for the canonical query", async () => {
  const rec: Recorder = { calls: [] };
  const m = mission();
  await runCapabilityPlan(mockDeps(HAPPY_ROWS, rec), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
  });
  assertEquals(rec.calls[0], "apify_yc_companies_memo23");
  // solidcode does NOT run when the primary produced candidates.
  assertFalse(rec.calls.includes("apify_yc_companies_solidcode"));
});

Deno.test("3. enrichment happens BEFORE qualification, and qualification uses it", async () => {
  const rec: Recorder = { calls: [] };
  const m = mission();
  const run = await runCapabilityPlan(mockDeps(HAPPY_ROWS, rec), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
  });
  const order = run.capability_outcomes.map((o) => o.capability);
  assert(order.indexOf("company_enrichment") < order.indexOf("company_brain_qualification"));
  // And the enriched record is what the gate saw.
  const sortly = run.companies.find((c) => c.company.company_name === "Sortly");
  assert(sortly, "Sortly must be in the working set");
  assert(sortly!.enriched, "Sortly must carry enriched evidence");
  assertEquals(sortly!.enriched!.employee_count, 42);
});

Deno.test("4. founder discovery does not run automatically at all", async () => {
  const rec: Recorder = { calls: [] };
  const m = mission();
  const run = await runCapabilityPlan(mockDeps(HAPPY_ROWS, rec), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
  });
  // THE CONTRACT CHANGED, DELIBERATELY.
  //
  // This used to assert that the people Actor ran AFTER enrichment. It ran on
  // every qualified company, on every "find me founders of X" query — which is
  // most of them — before anyone had agreed to buy a single person. Ordering was
  // never the problem; the automatic purchase was.
  //
  // People are an OFFER now. The company pipeline still completes in full.
  assertFalse(rec.calls.includes("apify_linkedin_company_employees"),
    "the people Actor must not run automatically");
  assertFalse(rec.calls.includes("apify_people_search"),
    "nor its fallback");
  assert(rec.calls.includes("apify_linkedin_company_details"),
    "the company pipeline still runs in full");
  assert(run.state.qualified_company_keys.length > 0, "a company must have qualified");
  // And the qualified company carries the offer instead.
  assertEquals(buildCapabilityGraph(m).offered_capabilities,
    ["offer_founder_unlock", "offer_contact_unlock"]);
});

// ═══════════════════════════════════════════════════════ 5. containment ══

Deno.test("5. legacy job Actors cannot run for a non-job mission", async () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);

  // (a) THE GUARD THE ENGINE ACTUALLY USES rejects each forbidden Actor. This is
  // the same `guardedInvoker` instance type the engine wraps `deps.invoke` in.
  const guarded = guardedInvoker(plan, () => Promise.resolve([]));
  for (const forbidden of [
    "apify_jobs", "apify_linkedin_jobs_crawlworks", "apify_indeed_jobs_automation_lab",
    "apify_glassdoor_jobs",
  ]) {
    await assertRejects(
      () => guarded({ actorKey: forbidden } as CompiledActorCall<unknown>),
      CapabilityContainmentError,
      forbidden,
    );
  }

  // `apify_linkedin_company_search` left this list because it is now the CORRECT
  // provider for `company_identity_resolution`. The guarantee it used to carry
  // is not dropped — it is enforced per capability, which is strictly stronger:
  // the search Actor may not enrich, and the enrichment Actor may not search.
  // The second half of that is the exact defect being fixed: identity resolution
  // calling `apify_linkedin_company_details` with `{searches:[name]}`, sixteen
  // times, for zero rows.
  await assertRejects(
    () => guarded({
      actorKey: "apify_linkedin_company_details",
      capabilityId: "company_identity_resolution",
    } as unknown as CompiledActorCall<unknown>),
    CapabilityContainmentError,
    "company_identity_resolution",
  );
  await assertRejects(
    () => guarded({
      actorKey: "apify_linkedin_company_search",
      capabilityId: "company_enrichment",
    } as unknown as CompiledActorCall<unknown>),
    CapabilityContainmentError,
    "company_enrichment",
  );

  // (b) And on a REAL run the engine never reaches for one in the first place.
  const rec: Recorder = { calls: [] };
  await runCapabilityPlan(mockDeps(HAPPY_ROWS, rec), { mission: m, plan, brain: BRAIN });
  assert(rec.calls.length > 0, "the run must actually have called providers");
  for (const k of rec.calls) {
    assert(plan.allowed_providers.includes(k), `${k} is outside the mission graph`);
  }
});

Deno.test("6. zero YC results use ONLY the approved startup fallback", async () => {
  const rec: Recorder = { calls: [] };
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan(
    mockDeps({ apify_yc_companies_memo23: [] }, rec),
    { mission: m, plan, brain: BRAIN, solidcodeTeamSizes: ["2-10", "11-50"] },
  );

  // memo23 empty → solidcode tried. Nothing else.
  assertEquals([...new Set(rec.calls)],
    ["apify_yc_companies_memo23", "apify_yc_companies_solidcode"]);
  for (const forbidden of ["apify_jobs", "apify_indeed_jobs_automation_lab", "apify_glassdoor_jobs"]) {
    assertFalse(rec.calls.includes(forbidden), `${forbidden} must never run`);
  }

  // Both exhausted → terminal, and the run STOPS rather than falling through.
  const discovery = run.capability_outcomes.find((o) => o.capability === "startup_company_discovery");
  assertEquals(discovery?.status, "exhausted");
  assertEquals(run.state.fallback_reason, "approved_providers_exhausted");
  assert(run.state.terminal_reason?.includes("rather than sourcing outside its graph"));
  // Later capabilities were never attempted.
  assertFalse(run.capability_outcomes.some((o) => o.capability === "founder_discovery"));
  assert(run.state.pending_capabilities.includes("company_enrichment"));
});

Deno.test("7. a provider failure cannot escape the graph", async () => {
  const rec: Recorder = { calls: [] };
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan({
    invoke: (call) => {
      rec.calls.push(call.actorKey);
      if (call.actorKey === "apify_yc_companies_memo23") {
        return Promise.reject(new Error("provider 500"));
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: false, outcome: "no_match" }),
  }, { mission: m, plan, brain: BRAIN, solidcodeTeamSizes: ["2-10"] });

  // The error is RECORDED as an attempt, not swallowed and not escalated into
  // an off-graph retry.
  const err = run.state.provider_attempts.find((a) => a.outcome === "error");
  assert(err, "the failure must be recorded as a provider attempt");
  assertEquals(err!.provider, "apify_yc_companies_memo23");
  // Only graph providers were reached.
  for (const k of rec.calls) {
    assert(plan.allowed_providers.includes(k), `${k} is outside the graph`);
  }
});

// ══════════════════════════════════════════════════ 8. resume continuity ══

Deno.test("8. resume continues at the next incomplete capability", async () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);

  // First run: discovery + identity succeed, then enrichment is where we stop.
  const first: Recorder = { calls: [] };
  const run1 = await runCapabilityPlan(
    mockDeps({ apify_yc_companies_memo23: HAPPY_ROWS.apify_yc_companies_memo23 }, first),
    { mission: m, plan, brain: BRAIN },
  );
  assert(run1.state.completed_capabilities.includes("startup_company_discovery"));

  // Second run RESUMES from that state.
  const second: Recorder = { calls: [] };
  const run2 = await runCapabilityPlan(mockDeps(HAPPY_ROWS, second), {
    mission: m, plan, brain: BRAIN, state: run1.state,
  });

  // Discovery was NOT re-paid for.
  assertFalse(second.calls.includes("apify_yc_companies_memo23"),
    "a completed capability must never be re-invoked on resume");
  const resumed = run2.capability_outcomes.find((o) => o.capability === "startup_company_discovery");
  assertEquals(resumed?.status, "skipped_resumed");
  assertEquals(resumed?.reason, "completed in an earlier run");
});

Deno.test("8b. a state from a DIFFERENT mission is refused", async () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const alien = newExecutionState(plan, "some-other-mission-hash");
  alien.completed_capabilities = ["startup_company_discovery"];

  const rec: Recorder = { calls: [] };
  await runCapabilityPlan(mockDeps(HAPPY_ROWS, rec), {
    mission: m, plan, brain: BRAIN, state: alien,
  });
  // Discovery ran, because the alien state was discarded rather than trusted.
  assert(rec.calls.includes("apify_yc_companies_memo23"));
  assertFalse(stateMatchesMission(alien, "unrelated"));
});

Deno.test("8c. resume never re-interprets the query", async () => {
  // The engine takes a mission object and a plan. There is no code path that
  // reads a sentence, so a resume cannot re-derive intent.
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
  for (const forbidden of [
    "inferRouteFromRequest", "parseLeadMissionDeterministic", "validateHiringRoute",
    "user_request", "instruction",
  ]) {
    assertFalse(src.includes(forbidden),
      `the engine must not reference ${forbidden} — it executes a mission, it does not read one`);
  }
});

// ══════════════════════════════════════════ 9. UNKNOWN evidence resolution ══

Deno.test("9. UNKNOWN qualification is resolved, never auto-rejected", async () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  // Enrichment yields NO industry ids and no headcount → the gate cannot decide.
  const thin = {
    ...HAPPY_ROWS,
    apify_linkedin_company_details: [{
      name: "Sortly", linkedinUrl: "https://www.linkedin.com/company/sortly",
      website: "https://sortly.com", industry: "Software Development",
    }],
  };

  // (a) NO evaluator and NO classifier → held PENDING, never rejected.
  //
  // This branch is the whole point of the test, so it opts OUT of the shared
  // evaluator that `mockDeps` now supplies. Absence of a decider is not a fact
  // about the company.
  const recA: Recorder = { calls: [] };
  const runA = await runCapabilityPlan(
    mockDeps(thin, recA, { evaluateMission: undefined }), {
      mission: m, plan, brain: BRAIN,
    });
  assertEquals(runA.state.qualified_company_keys.length, 0);
  assert(runA.state.unknown_company_keys.length > 0,
    "an undecidable company must be UNKNOWN, not a rejection");
  // The VERDICT is the decision, not the stage. `advance` refuses backward moves
  // and this graph verifies hiring before it qualifies, so a fit stage would be
  // silently dropped — reading the verdict off the stage is what hid every
  // UNKNOWN before.
  const held = runA.companies.find((c) => c.verdict === "unknown");
  assert(held, "the company must be held as unknown");
  assertEquals(held!.classification?.source, "unresolved");
  assert(held!.fit?.stage === "company_fit_pending", "the gate itself returned pending");
  assertFalse(runA.companies.some((c) => c.verdict === "reject"),
    "nothing may be rejected for want of evidence");

  // ── (b) AND (c) DELETED WITH THE CLASSIFIER THEY EXERCISED ──────────────
  //
  // They supplied `classifyCompany` — a confirming one, then a contradicting
  // one — and asserted that neither could qualify or reject a company the
  // Mission evaluator had never seen. That property now holds STRUCTURALLY:
  // the engine has no classifier dependency to supply, so there is no second
  // decider to neutralise. `missionEvaluatorProductionWiring` D1 and
  // `structuredClassifierAndResume` 1 assert the absence directly.
  //
  // What remains is the branch that still matters: no evaluator ⇒ UNKNOWN.
  assertEquals(held!.decision_source, "insufficient_evidence",
    "the record must say nothing evaluated it");
  assert(held!.record.missing_evidence.includes("mission_evaluation"),
    "and name exactly what was missing");
  assertEquals(runA.companies.filter((c) => c.verdict === "pass").length, 0,
    "no path qualifies a company without the evaluator");
});

// ═══════════════════════════════════════════════════════════ 10. telemetry ══

Deno.test("10. execution telemetry records attempts, outcomes and cost", async () => {
  const rec: Recorder = { calls: [] };
  const m = mission();
  const run = await runCapabilityPlan(mockDeps(HAPPY_ROWS, rec), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
  });
  const s = run.state;

  assertEquals(s.version, "capability-execution-state-v1");
  assertEquals(s.entry_capability, "startup_company_discovery");
  assert(s.provider_attempts.length > 0);
  for (const a of s.provider_attempts) {
    assert(a.capability, "every attempt names its capability");
    assert(a.provider, "every attempt names its provider");
    assert(["ok", "empty", "error", "skipped_idempotent", "compile_failed",
      "skipped_resume_reuse"].includes(a.outcome));
    assert(a.attempt >= 1);
  }
  assert(s.accumulated_cost_units > 0, "cost must accumulate");
  assert(s.company_keys.length > 0, "deduplicated companies are recorded");
  assertEquals(s.company_keys.length, new Set(s.company_keys).size, "company keys are deduplicated");
  // NO CONTACT IDENTITIES, and that is the point. People are offered, not
  // bought, so an automatic run reaches zero of them — while every company
  // counter above still fills.
  assertEquals(s.contact_identities.length, 0,
    "an automatic run buys nobody, so it records no contact identity");
});

Deno.test("10b. run-agent persists the execution state and consults classification", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  const start = src.indexOf("sequential_source_execution: sequentialSourceDiagnostics");
  const persisted = src.slice(start, src.indexOf('}).eq("id", task.id);', start));
  for (const key of [
    "capability_execution_state:", "capability_outcomes:",
    "unknown_companies_pending_evidence:", "semantic_classification_status:",
  ]) {
    assert(persisted.includes(key), `${key} must be persisted`);
  }
  // The engine is the authority for mission tasks: the legacy executor is
  // reachable only when the engine did NOT run.
  assert(src.includes("if (!resumeSatisfied && persistedMission && missionPlan)"),
    "the engine must own mission tasks");
  assert(src.includes("if (!resumeSatisfied && !capabilityRun && routeResolution.ok"),
    "the legacy executor must be gated on the engine not having run");
});

// ══════════════════════════════════════════════════ 11. persistence bridge ══

Deno.test("11. only VERIFIED people are offered for persistence", async () => {
  const rec: Recorder = { calls: [] };
  const m = mission();
  const run = await runCapabilityPlan(
    mockDeps(HAPPY_ROWS, rec, {
      verifyEmployer: () => ({ verified: false, outcome: "employer_mismatch" }),
    }),
    { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN },
  );
  const shaped = toRouteResultShape(run);
  assertEquals(shaped.companies.every((c) => c.founders.length === 0), true,
    "an unverified founder is a candidate, not a lead");
  assertEquals(run.state.contact_identities.length, 0);

  // And the shape the existing projection reads is intact.
  for (const c of shaped.companies) {
    assert(c.identity, "identity is never null in the projection shape");
    assert(c.record, "every row carries its stage record");
  }
  assert(shaped.executed_source_order.includes("apify_yc_companies_memo23"));
});
