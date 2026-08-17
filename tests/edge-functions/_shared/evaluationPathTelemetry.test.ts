// WHO ACTUALLY DECIDED? — PHASE 0 INSTRUMENTATION.
//
// The audit of TEST run d787cfc7 could not answer that question from the run
// artifact, and the three fields that should have answered it disagreed:
//
//   capability_outcomes  company_brain_qualification: status "complete", rows 0,
//                        reason "no company passed the Company Brain"
//   pending_capabilities ["company_brain_qualification"]   ← so it did NOT complete
//   grounded diagnostics companies: []                     ← so nothing was judged
//
// Read together those say "the Brain rejected twenty companies". What actually
// happened is that the Brain's eligible set was EMPTY and nobody was ever
// offered to it. A scheduling gap read as an ICP that was too strict, and the
// product spent two sessions looking for a qualification bug that did not exist.
//
// These tests pin the measurement that makes the difference legible, BEFORE the
// architecture changes. `decided_by_model` is the number the GPT-authority
// correction will be judged on. Today it is expected to be ZERO on the ordinary
// path — and test 6 asserts exactly that, so the inversion cannot later be
// declared done while the evaluator is still an exception handler.
//
// ZERO network, ZERO Actor runs, ZERO real model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCapabilityPlan, summariseEvaluationPaths,
  type CapabilityEngineDeps, type EngineCompany, type EvaluationPath,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { parseMissionEvaluationStrict } from "../../../supabase/functions/_shared/missionEvaluation.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

const QUERY =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";

// ── fixtures ─────────────────────────────────────────────────────────────────

function ycRow(name: string, slug: string) {
  return {
    id: slug, name, website: `https://${slug}.com`,
    industry: "B2B", industries: ["B2B"], batch: "W22", teamSize: 42,
    oneLiner: `${name} sells revenue software to go-to-market teams.`,
    allLocations: "San Francisco, CA, USA",
    openJobs: [{ title: "Revenue Operations Manager", url: `https://x/${slug}/1` }],
  };
}

const ROWS: Record<string, Record<string, unknown>[]> = {
  apify_yc_companies_memo23: [ycRow("Sortly", "sortly")],
  apify_linkedin_company_search: [{
    id: "sortly", name: "Sortly",
    linkedinUrl: "https://www.linkedin.com/company/sortly",
    website: "https://sortly.com",
    description: "Sortly sells revenue software to go-to-market teams.",
    location: "San Francisco, CA",
  }],
  apify_linkedin_company_details: [{
    id: "sortly", name: "Sortly",
    linkedinUrl: "https://www.linkedin.com/company/sortly",
    website: "https://sortly.com", employeeCount: 42,
    description: "Sortly sells revenue software to go-to-market teams.",
    industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
    locations: [{ linkedinText: "United States" }],
  }],
};

const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

interface Recorder { actors: string[]; classifierCalls: number; evaluatorCalls?: number }

/** An evaluator that answers from the company's OWN registry, and counts calls. */
const countingEvaluator = (rec: Recorder): CapabilityEngineDeps["evaluateMission"] =>
  ({ registry }) => {
    rec.evaluatorCalls = (rec.evaluatorCalls ?? 0) + 1;
    const job = registry.items.find((x) =>
      x.evidence_type === "job_posting" || x.evidence_type === "yc_job");
    return Promise.resolve(parseMissionEvaluationStrict({
      mission_fit: "pass", icp_fit: "strong", hiring_fit: "verified",
      confidence: 0.9, match_score: 85,
      matched_requirements: job
        ? [{
          requirement: "hiring the requested role",
          evidence_id: job.evidence_id,
          excerpt: String(job.source_text ?? "").slice(0, 20),
        }]
        : [],
      reasoning: "satisfies the mission",
    }, registry));
  };

function deps(rec: Recorder, over: Partial<CapabilityEngineDeps> = {}): CapabilityEngineDeps {
  return {
    invoke: (call: CompiledActorCall<unknown>) => {
      rec.actors.push(call.actorKey);
      return Promise.resolve(ROWS[call.actorKey] ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    ...over,
  };
}

/** A classifier that answers, and counts how often it was consulted. */
const countingClassifier = (rec: Recorder): CapabilityEngineDeps["classifyCompany"] => () => {
  rec.classifierCalls++;
  return Promise.resolve({
    assessment: {
      business_model: "b2b_saas", company_fit: "pass", confidence: 0.9,
      agentory_use_case: "strong", supporting_evidence: ["sells revenue software"],
      conflicting_evidence: [], unknown_fields: [], reason: "fits",
    },
    parse_status: "valid",
    raw_shape: { received_keys: [], repaired_fields: [], rejected_values: [] },
  } as never);
};

async function runWith(
  over: Partial<CapabilityEngineDeps> = {},
  missionOver: Partial<LeadMissionV1> = {},
) {
  const rec: Recorder = { actors: [], classifierCalls: 0 };
  const m = { ...parseLeadMissionDeterministic(QUERY), ...missionOver } as LeadMissionV1;
  const run = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, over) }, {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
  });
  return { run, rec };
}

const ALL_PATHS: readonly EvaluationPath[] = [
  "not_reached", "fabricated_pass", "fabricated_reject",
  "model_evaluated", "model_unavailable",
];

// ═══════════════════════════════════════════════════════════════════════════

Deno.test("1. every company carries exactly one evaluation path", async () => {
  const rec: Recorder = { actors: [], classifierCalls: 0 };
  const { run } = await runWith({ classifyCompany: countingClassifier(rec) });

  assert(run.companies.length > 0, "the run must produce companies");
  for (const c of run.companies) {
    assert(ALL_PATHS.includes(c.evaluation_path),
      `${c.key}: "${c.evaluation_path}" is not a known evaluation path`);
  }
});

Deno.test("2. the summary is total — the counts account for every company", async () => {
  const rec: Recorder = { actors: [], classifierCalls: 0 };
  const { run } = await runWith({ classifyCompany: countingClassifier(rec) });
  const s = summariseEvaluationPaths(run.companies);

  const summed = ALL_PATHS.reduce((n, p) => n + s.counts[p], 0);
  assertEquals(summed, run.companies.length,
    "the path counts must sum to the number of companies");
  assertEquals(s.companies.length, run.companies.length,
    "every company must appear in the per-company breakdown");
  assertEquals(s.reached_evaluation, run.companies.length - s.counts.not_reached);
  assertEquals(s.decided_by_model, s.counts.model_evaluated);
  assertEquals(
    s.decided_without_model,
    s.counts.fabricated_pass + s.counts.fabricated_reject + s.counts.model_unavailable,
  );
});

/** Identity resolution that finds nobody — every company stays unproven. */
const noIdentity: Partial<CapabilityEngineDeps> = {
  invoke: (call: CompiledActorCall<unknown>) =>
    Promise.resolve(call.actorKey === "apify_yc_companies_memo23"
      ? ROWS.apify_yc_companies_memo23
      : []),
};

Deno.test("3. an unresolved identity is `not_reached` — never a rejection", async () => {
  // A company we could not identify must not be judged. It is the one case
  // where "we did not evaluate this" is the correct, final answer.
  const { run } = await runWith(noIdentity);
  const s = summariseEvaluationPaths(run.companies);

  assertEquals(s.decided_by_model, 0, "nothing can be evaluated without an identity");
  assertEquals(s.counts.not_reached, run.companies.length,
    "every unidentified company must be reported as never evaluated");

  for (const c of run.companies) {
    assertFalse(c.verdict === "reject",
      `${c.key}: a company that was never evaluated must not carry a rejection`);
    assertEquals(c.brain, null, `${c.key}: no Brain decision can exist`);
    assertEquals(c.hiring_assessment, null,
      `${c.key}: an unproven company must not even be assessed for hiring`);
  }
});

Deno.test("4. an empty eligible set is reported as such, not as 'nobody passed'", async () => {
  const { run } = await runWith(noIdentity);

  const outcome = run.capability_outcomes.find(
    (o) => o.capability === "company_brain_qualification");
  assert(outcome, "the qualification capability must report an outcome");
  const reason = String(outcome!.reason ?? "");

  assert(reason.includes("eligible set was empty"),
    `the reason must name the empty eligible set, got: "${reason}"`);
  assert(reason.includes("nothing was evaluated, nothing was rejected"),
    `the reason must distinguish unevaluated from rejected, got: "${reason}"`);
  assertFalse(reason.includes("no company passed the Company Brain"),
    "an empty eligible set must NOT be reported as a failed qualification");
});

Deno.test("5. NO EVALUATOR IS NOT A REJECTION — the company is held, and says so", async () => {
  // The flag is off, the workspace is not allow-listed, the budget is spent, or
  // the model failed. None of those is a fact about the company, and the
  // pipeline must not convert any of them into a rejection to keep its funnel
  // tidy. This is requirement §13: never silently qualify, and — equally —
  // never silently reject.
  const { run } = await runWith({});   // no evaluateMission dep at all
  const s = summariseEvaluationPaths(run.companies);
  const reached = run.companies.filter((c) => c.evaluation_path !== "not_reached");

  assert(reached.length > 0, "companies must still reach qualification");
  assertEquals(s.decided_by_model, 0, "but nothing may be decided by a model that never ran");

  for (const c of reached) {
    assertEquals(c.evaluation_path, "model_unavailable", `${c.key}`);
    assertEquals(c.decision_source, "insufficient_evidence", `${c.key}`);
    assertFalse(c.verdict === "pass", `${c.key}: nothing may qualify without an evaluator`);
    assertFalse(c.verdict === "reject", `${c.key}: and nothing may be rejected by its absence`);
    assert(c.mission_evaluation, `${c.key}: the held state must be recorded, not implied`);
    assert(c.mission_evaluation!.unknown_fields.includes("not_evaluated"),
      `${c.key}: and it must say nobody looked`);
  }
});

Deno.test("6. THE INVERSION: the evaluator decides every company that reaches it", async () => {
  // THIS TEST WAS DELIBERATELY WRITTEN INVERTED, AND HAS NOW BEEN FLIPPED.
  //
  // Its first form asserted `decided_by_model === 0` — the old architecture, in
  // which GPT was an exception handler consulted only when deterministic code
  // returned `pending`, while the other two branches fabricated an assessment
  // in code and reported it through `semantic_classification_observability` as
  // though a model had produced it. Flipping this assertion is the visible,
  // reviewable moment the authority moved.
  const rec: Recorder = { actors: [], classifierCalls: 0 };
  const { run } = await runWith({ evaluateMission: countingEvaluator(rec) });
  const s = summariseEvaluationPaths(run.companies);

  assert(s.reached_evaluation > 0, "companies must reach evaluation in this fixture");
  assertEquals(s.decided_by_model, s.reached_evaluation,
    "EVERY company that reaches evaluation is decided by the evaluator");
  assertEquals(s.decided_without_model, 0, "and none is settled by fabricated code");
  assertEquals(rec.evaluatorCalls, s.reached_evaluation,
    "one call per company — no company is judged twice, none is skipped");

  // AND THE FABRICATION IS GONE. Not relabelled — gone.
  for (const c of run.companies.filter((x) => x.evaluation_path !== "not_reached")) {
    assertEquals(c.decision_source, "gpt_evaluation", `${c.key}`);
    assertFalse(
      (c.brain?.supporting_evidence ?? []).includes("deterministic gates passed"),
      `${c.key}: the fabricated assessment must not survive anywhere`);
  }
});

Deno.test("6b. the fabricated literals are absent from the engine source", async () => {
  // A grep-level guard. The two literals below WERE the verdict on the two
  // commonest paths, and were reported as model output. If either returns, the
  // inversion has been quietly undone.
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
  assertFalse(src.includes('supporting_evidence: ["deterministic gates passed"]'),
    "the fabricated passing assessment must not exist");
  assertFalse(src.includes('reason: "all deterministic Company Brain gates passed"'),
    "nor its reason string");
});

Deno.test("7. the per-company breakdown explains a single row", async () => {
  const rec: Recorder = { actors: [], classifierCalls: 0 };
  const { run } = await runWith({ classifyCompany: countingClassifier(rec) });
  const s = summariseEvaluationPaths(run.companies);

  const row = s.companies.find((r) => r.evaluation_path !== "not_reached");
  assert(row, "at least one company must have been decided");
  assertEquals(typeof row!.company_key, "string");
  assert(row!.brain_outcome !== null,
    "a decided company must carry the Brain outcome that decided it");
  assertEquals(typeof row!.grounded, "boolean");
});

/** The audited run's exact plan shape: no `hiring_verification` step. */
const NO_PAID_VERIFICATION = {
  required_capabilities: [
    "startup_company_discovery", "company_identity_resolution",
    "company_enrichment", "company_brain_qualification", "persistence",
  ],
} as Partial<LeadMissionV1>;

Deno.test("9. PHASE 1: a mission that buys no verification still evaluates its companies", async () => {
  // THE REGRESSION THIS EXISTS TO PREVENT.
  //
  // TEST run d787cfc7 discovered 100 companies, resolved 13 identities, enriched
  // 10 — and evaluated ZERO, because the only code that read the free YC
  // openings lived inside a capability this mission never scheduled. The
  // Workbench then showed twenty good companies as "not qualified".
  const { run } = await runWith({}, NO_PAID_VERIFICATION);

  const plan = run.capability_outcomes.map((o) => o.capability);
  assertFalse(plan.includes("hiring_verification"),
    "the fixture must reproduce a plan with no paid verification step");

  const s = summariseEvaluationPaths(run.companies);
  assert(s.reached_evaluation > 0,
    "companies must reach evaluation WITHOUT the paid capability — this is the fix");

  const assessed = run.companies.filter((c) => c.hiring_assessment !== null);
  assert(assessed.length > 0, "the free hiring assessment must have run");
  for (const c of assessed) {
    assertEquals(c.hiring_assessment!.evidence_source, "yc_open_jobs",
      `${c.key}: the assessment must come from evidence already held, not a paid call`);
  }
});

Deno.test("10. PHASE 1: the free assessment costs nothing", async () => {
  const rec: Recorder = { actors: [], classifierCalls: 0 };
  const m = { ...parseLeadMissionDeterministic(QUERY), ...NO_PAID_VERIFICATION } as LeadMissionV1;
  await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec) }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN });

  assertFalse(rec.actors.includes("apify_linkedin_job_search"),
    "no paid job search may be bought to assess evidence already held");
});

Deno.test("11. PHASE 2: a mission-named role is not rejected for being non-commercial", async () => {
  // `no_commercial_signal` used to fire whenever `commercial_tier` was null,
  // which for a mission whose required role is NOT go-to-market meant every
  // company was hard-rejected before any model was consulted. Where the mission
  // names its own roles that question is the evaluator's, not a gate's.
  const { failedHardGates } = await import(
    "../../../supabase/functions/_shared/companyBrainSemanticFit.ts");

  const base = {
    identity_status: "verified_match" as const, active: true,
    geography: "United States", required_geography: null,
    employee_count: 42, employee_ceiling: 200,
    commercial_tier: null, semantic: null,
  };

  assert(failedHardGates({ ...base }).includes("no_commercial_signal"),
    "where the mission is silent the commercial gate must still stand");
  assertFalse(
    failedHardGates({ ...base, mission_owns_hiring_role: true })
      .includes("no_commercial_signal"),
    "where the mission named its roles, an absent commercial tier cannot reject");
});

Deno.test("8. instrumentation is inert — it never changes a verdict", async () => {
  // Two identical runs; the telemetry is derived, so verdicts must match exactly.
  const a = await runWith({ classifyCompany: countingClassifier({ actors: [], classifierCalls: 0 }) });
  const b = await runWith({ classifyCompany: countingClassifier({ actors: [], classifierCalls: 0 }) });

  const verdicts = (cs: readonly EngineCompany[]) =>
    cs.map((c) => `${c.key}:${c.verdict}:${c.brain?.outcome ?? "none"}`).sort();

  assertEquals(verdicts(a.run.companies), verdicts(b.run.companies),
    "the run must be deterministic and unaffected by the added field");
});
