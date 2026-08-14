// GPT IS THE FINAL SEMANTIC AUTHORITY, AND ITS ANSWER MUST BE GROUNDED.
//
// Two questions this file exists to answer, both of which the architecture
// reset asks explicitly and neither of which a behavioural test elsewhere
// answers:
//
//   1. Can any DETERMINISTIC path override an evaluator QUALIFIED?
//      `decideCompanyBrain` still runs after the evaluator, and
//      `failedHardGates` can return REJECT. If any of those gates encodes a
//      judgement rather than a falsifiable fact, deterministic code is quietly
//      still the decider.
//
//   2. Can an evaluator fixture smuggle an UNGROUNDED PASS?
//      The engine consumes a `ParsedMissionEvaluation`, so a test double could
//      hand it a fabricated verdict. Production routes every response through
//      `parseMissionEvaluationStrict` against the company's own registry —
//      these tests run the SAME parser over the SAME registry the engine built.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { runCapabilityPlan } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  parseMissionEvaluationStrict,
} from "../../../supabase/functions/_shared/missionEvaluation.ts";
import {
  CEILING_TOLERANCE, failedHardGates,
} from "../../../supabase/functions/_shared/companyBrainSemanticFit.ts";
import type {
  EvidenceRegistry,
} from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

// ─────────────────────────────────────────────────────────────── the fixture ──

const CANONICAL =
  "Find founders of SaaS startups hiring software engineers in the United States. " +
  "Return 5 qualified leads.";

const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(CANONICAL);
  return {
    ...m,
    company_profile: { ...m.company_profile, employee_range: { min: 10, max: 150 } },
  };
};

// THE PRODUCTION BRAIN SHAPE, as `run-agent` actually builds it. `required_geography`
// is null there, which is load-bearing — see test 2b.
const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

const ROWS = Array.from({ length: 6 }, (_, i) => ({
  name: `Acme${i}`, website: `https://acme${i}.com`, teamSize: 30 + i,
  batch: "W20", industries: ["B2B"], id: `acme${i}`,
  openJobs: [{ title: "Senior Software Engineer" }],
})) as unknown as Record<string, unknown>[];

const hit = (i: number) => ({
  name: `Acme${i}`,
  linkedinUrl: `https://www.linkedin.com/company/acme${i}`,
  website: `https://acme${i}.com`,
  description: "B2B SaaS company",
  location: "San Francisco, CA, USA",
  employeeCount: 30 + i,
});

const idxOf = (input: Record<string, unknown>): number => {
  const q = JSON.stringify(input);
  for (let i = 0; i < 6; i++) if (q.includes(`Acme${i}`)) return i;
  return -1;
};

/**
 * Run the engine with an evaluator that produces `raw`, routed through the REAL
 * strict parser against the REAL registry — the production shape exactly.
 */
const runWithEvaluator = async (
  rawFor: (registry: EvidenceRegistry) => unknown,
) => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const seen: Array<{ registry: EvidenceRegistry; dropped: string[] }> = [];
  const run = await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey === "apify_yc_companies_memo23") return Promise.resolve(ROWS);
      if (call.actorKey === "apify_linkedin_company_search") {
        const i = idxOf(call.input as Record<string, unknown>);
        return Promise.resolve(i >= 0 ? [hit(i)] : []);
      }
      if (call.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve(ROWS.map((_, i) => hit(i)));
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    // THE PRODUCTION ADAPTER, reproduced: raw response → strict parser → engine.
    evaluateMission: ({ registry }) => {
      const parsed = parseMissionEvaluationStrict(rawFor(registry), registry);
      seen.push({ registry, dropped: parsed.raw_shape.dropped_citations });
      return Promise.resolve(parsed);
    },
  } as never, { mission: m, plan, brain: BRAIN, maxCandidates: 40 } as never);
  return { run, seen };
};

/** A well-formed evaluator response that PASSES, citing `evidence_id`/`excerpt`. */
const passCiting = (evidence_id: string, excerpt: string) => ({
  mission_fit: "pass", icp_fit: "strong", hiring_fit: "verified",
  confidence: 0.9, match_score: 88,
  matched_requirements: [
    { requirement: "hiring software engineers", evidence_id, excerpt },
  ],
  failed_requirements: [],
  reasoning: "the company is hiring the role the Mission named",
  rejection_reasons: [], evidence_quality: "strong", unknown_fields: [],
});

// ═══════════════════════════ 1. an ungrounded PASS cannot qualify a company ══

Deno.test("1. a PASS citing a FABRICATED evidence_id qualifies nobody", async () => {
  const { run, seen } = await runWithEvaluator(() =>
    passCiting("ev_does_not_exist", "we are hiring a Senior Software Engineer"));

  assert(seen.length > 0, "the evaluator really was consulted");
  assert(seen.every((s) => s.dropped.some((d) => d.startsWith("unknown_evidence_id:"))),
    "the invented citation is dropped by the parser");
  assertEquals(run.state.qualified_company_keys.length, 0,
    "an uncited pass is not a pass — nobody qualifies on invented evidence");
  assertFalse(run.companies.some((c) => c.verdict === "pass"));
  // HELD, NOT REJECTED. An ungrounded claim is missing evidence, not a fact
  // against the company.
  assertFalse(run.companies.some((c) => c.verdict === "reject"),
    "and it is not turned into a rejection either");
});

Deno.test("1b. a PASS quoting an excerpt that is NOT in the source qualifies nobody",
  async () => {
    const { run, seen } = await runWithEvaluator((registry) => {
      const item = registry.items.find((x) => x.source_text);
      return passCiting(item?.evidence_id ?? "ev_0", "a sentence nobody ever wrote");
    });

    assert(seen.some((s) => s.dropped.some((d) => d.startsWith("excerpt_not_in_source:"))),
      "a misquoted excerpt is dropped even when the evidence_id is real");
    assertEquals(run.state.qualified_company_keys.length, 0);
  });

Deno.test("1c. POSITIVE CONTROL: a PASS citing real evidence verbatim DOES qualify",
  async () => {
    // Without this the tests above would pass even if the evaluator were unable
    // to qualify anyone for an unrelated reason.
    const { run, seen } = await runWithEvaluator((registry) => {
      const item = registry.items.find((x) => x.source_text && x.source_text.length > 3);
      if (!item) return passCiting("ev_0", "x");
      return passCiting(item.evidence_id, item.source_text!);
    });

    assert(seen.every((s) => s.dropped.length === 0),
      "a properly grounded citation is not dropped");
    assert(run.state.qualified_company_keys.length > 0,
      "a grounded pass DOES qualify — the grounding tests above are meaningful");
    const passed = run.companies.find((c) => c.verdict === "pass")!;
    assertEquals(passed.decision_source, "gpt_evaluation");
    assertEquals(passed.evaluation_path, "model_evaluated");
    assert(passed.mission_evaluation!.matched_requirements.length > 0,
      "and it carries the evidence it was granted on");
  });

// ══════════════════ 2. no deterministic gate may veto an evaluator QUALIFIED ══

Deno.test("2. in the production configuration every hard gate is inert or falsifiable", () => {
  // THE GATE INPUT THE ENGINE ACTUALLY BUILDS for an evaluated company, and the
  // semantic payload the EVALUATOR branch supplies. If any gate fires here,
  // deterministic code is overruling GPT.
  const gates = {
    identity_status: "verified_match" as const,
    active: true,
    geography: "San Francisco, CA, USA",
    // `run-agent` passes null. This is the load-bearing value — see 2b.
    required_geography: null,
    employee_count: 220,
    employee_ceiling: 200,
    commercial_tier: null,
    mission_owns_hiring_role: true,
    semantic: {
      // Exactly what the evaluator branch passes.
      business_model: "unknown" as const,
      company_fit: "pass" as const,
      confidence: 0.9,
      agentory_use_case: "weak" as const,
      supporting_evidence: [], conflicting_evidence: [], unknown_fields: [],
      reason: "",
    },
  };

  assertEquals(failedHardGates(gates as never), [],
    "no hard gate may reject a company the evaluator qualified");

  // Why each dangerous one is inert, stated so a regression is legible:
  //   consumer_only        — the branch passes business_model "unknown", never "consumer"
  //   no_agentory_use_case — icp_fit maps weak→"weak", never "none"
  //   no_commercial_signal — demoted when the Mission owns the hiring role
  //   unsupported_geography— required_geography is null in production
  assertEquals(
    failedHardGates({ ...gates, mission_owns_hiring_role: false } as never),
    ["no_commercial_signal"],
    "the commercial gate stands only where the Mission named no role of its own");
});

Deno.test("2b. HAZARD, PINNED: a non-null required_geography would veto GPT on a substring", () => {
  // NOT CURRENTLY REACHABLE — `run-agent` passes `required_geography: null`.
  // Pinned because the gate is a naive substring test: a company in
  // "San Francisco, CA, USA" does not contain "united states", so switching this
  // on would silently reject US companies the evaluator had qualified.
  //
  // If someone makes this field live, this test fails and the gate must be
  // moved to the evaluator (where geography is already supplied as evidence)
  // rather than merely re-tuned.
  const failed = failedHardGates({
    identity_status: "verified_match", active: true,
    geography: "San Francisco, CA, USA",
    required_geography: "united states",
    employee_count: 100, employee_ceiling: 200,
    commercial_tier: null, mission_owns_hiring_role: true,
    semantic: {
      business_model: "unknown", company_fit: "pass", confidence: 0.9,
      agentory_use_case: "weak",
      supporting_evidence: [], conflicting_evidence: [], unknown_fields: [], reason: "",
    },
  } as never);
  assertEquals(failed, ["unsupported_geography"],
    "documented hazard: the match is textual, not geographic");
});

Deno.test("2c. the employee gate rejects only a grossly falsifiable count", () => {
  assertEquals(CEILING_TOLERANCE, 1.0,
    "the ceiling doubles before it rejects — a preference must not become a gate");
  const base = {
    identity_status: "verified_match" as const, active: true,
    geography: null, required_geography: null,
    commercial_tier: null, mission_owns_hiring_role: true,
    semantic: {
      business_model: "unknown" as const, company_fit: "pass" as const, confidence: 0.9,
      agentory_use_case: "weak" as const,
      supporting_evidence: [], conflicting_evidence: [], unknown_fields: [], reason: "",
    },
  };
  // AfterQuery, 220 employees, against a 10–150 workspace preference that
  // falls back to the generous 200 ceiling: MUST NOT be rejected.
  assertEquals(
    failedHardGates({ ...base, employee_count: 220, employee_ceiling: 200 } as never), []);
  // Twenty times the ceiling is a falsifiable contradiction, and still rejects.
  assertEquals(
    failedHardGates({ ...base, employee_count: 4000, employee_ceiling: 200 } as never),
    ["employee_count_far_above_ceiling"]);
});

// ══════════════════════════════ 3. absence of the evaluator is never a pass ══

Deno.test("3. with no evaluator at all, nobody qualifies and nobody is rejected", async () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey === "apify_yc_companies_memo23") return Promise.resolve(ROWS);
      if (call.actorKey === "apify_linkedin_company_search") {
        const i = idxOf(call.input as Record<string, unknown>);
        return Promise.resolve(i >= 0 ? [hit(i)] : []);
      }
      if (call.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve(ROWS.map((_, i) => hit(i)));
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    // No evaluator, and no classifier either.
  } as never, { mission: m, plan, brain: BRAIN, maxCandidates: 40 } as never);

  assertEquals(run.state.qualified_company_keys.length, 0,
    "silence is never a qualification");
  assertFalse(run.companies.some((c) => c.verdict === "reject"),
    "and silence is never a rejection");
  for (const c of run.companies.filter((x) => x.shortlisted)) {
    assertEquals(c.decision_source, "insufficient_evidence");
    assertEquals(c.evaluation_path, "model_unavailable");
    assertEquals(c.mission_evaluation?.decision, "insufficient_evidence");
  }
});
