// THE WHOLE PIPELINE, IN ONE PASS, WITH EVERY STAGE OBSERVABLE.
//
// The individual stages are covered elsewhere. What no other test asserts is
// that they are CONNECTED — that a company entering discovery emerges at the
// Workbench having been triaged, ranked against a budget, identified, enriched,
// assembled into Brain context and judged by the evaluator, carrying an honest
// record of each step.
//
// This is the test that fails when a stage is quietly unwired. That is not
// hypothetical: `missionEvaluationBinding.ts` was built, tested and committed
// with ZERO references from `run-agent`, and every stage-level test passed the
// whole time because each one injected the dependency it was testing.
//
// THE FLOW, and the branch each stage must keep distinguishable:
//
//   DISCOVERY
//     → GPT MISSION INTELLIGENCE   relevant | uncertain | irrelevant
//     → SMART SHORTLIST + BUDGET   ranked, sliced, never silently dropped
//     → IDENTITY RESOLUTION        resolved | unresolved | provider_error | deferred
//     → ENRICHMENT                 success  | empty      | provider_error | deferred
//     → COMPANY BRAIN              assembles context; decides nothing
//     → GPT MISSION EVALUATOR      QUALIFIED | UNKNOWN   | REJECTED
//     → PERSISTENCE → WORKBENCH
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
import { parseMissionEvaluationStrict } from "../../../supabase/functions/_shared/missionEvaluation.ts";
import { projectEvaluationRows } from "../../../supabase/functions/_shared/leadWorkbenchProjection.ts";
import { identityIsActionable } from "../../../supabase/functions/_shared/companyIdentityResolution.ts";
import type { EvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

const CANONICAL =
  "Find founders of SaaS startups hiring software engineers in the United States. " +
  "Return 5 qualified leads.";

const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(CANONICAL);
  return {
    ...m,
    company_profile: { ...m.company_profile, employee_range: { min: 10, max: 500 } },
  };
};

const BRAIN = {
  employee_min: 10, employee_max: 500,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

/**
 * SIX COMPANIES, EACH SCRIPTED DOWN A DIFFERENT BRANCH.
 *
 * Every role title here is one the deterministic vocabulary does NOT contain
 * ("Founding Engineer", "Member of Technical Staff"), so any company that
 * reaches the evaluator proves GPT triage carried it there.
 */
const N = 6;
const ROWS = Array.from({ length: N }, (_, i) => ({
  name: `Acme${i}`,
  website: `https://acme${i}.com`,
  teamSize: 40 + i,
  batch: "W20",
  industries: ["B2B"],
  id: `acme${i}`,
  openJobs: [{ title: i % 2 === 0 ? "Founding Engineer" : "Member of Technical Staff" }],
})) as unknown as Record<string, unknown>[];

const hit = (i: number) => ({
  name: `Acme${i}`,
  linkedinUrl: `https://www.linkedin.com/company/acme${i}`,
  website: `https://acme${i}.com`,
  description: "B2B SaaS company",
  location: "San Francisco, CA, USA",
  employeeCount: 40 + i,
});

const idxOf = (input: Record<string, unknown>): number => {
  const q = JSON.stringify(input);
  for (let i = 0; i < N; i++) if (q.includes(`Acme${i}`)) return i;
  return -1;
};

/** A grounded PASS: cites a real evidence_id and quotes its source verbatim. */
const groundedPass = (registry: EvidenceRegistry) => {
  const item = registry.items.find((x) => x.source_text && x.source_text.length > 3);
  return {
    mission_fit: "pass", icp_fit: "strong", hiring_fit: "verified",
    confidence: 0.92, match_score: 90,
    matched_requirements: item
      ? [{
        requirement: "hiring software engineers",
        evidence_id: item.evidence_id,
        excerpt: item.source_text,
      }]
      : [],
    failed_requirements: [],
    reasoning: "the company is hiring engineering roles the mission asked for",
    rejection_reasons: [], evidence_quality: "strong", unknown_fields: [],
  };
};

const runFlow = async () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const seen = { triageBatches: 0, evaluated: 0 };

  const run = await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey === "apify_yc_companies_memo23") return Promise.resolve(ROWS);
      if (call.actorKey === "apify_linkedin_company_search") {
        const i = idxOf(call.input as Record<string, unknown>);
        // Acme5's identity is genuinely not found: the provider ANSWERED and
        // had no match. That is a company fact, and terminal.
        if (i === 5) return Promise.resolve([]);
        return Promise.resolve(i >= 0 ? [hit(i)] : []);
      }
      if (call.actorKey === "apify_linkedin_company_details") {
        // Acme4 is absent from the enrichment answer: EMPTY, not an error.
        const wanted = JSON.stringify(call.input);
        return Promise.resolve(
          Array.from({ length: N }, (_, i) => i)
            .filter((i) => i !== 4 && wanted.includes(`acme${i}`))
            .map((i) => hit(i)));
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),

    // STAGE 2 — every company relevant except Acme0, which GPT excludes.
    triageCompanies: ({ company_keys }) => {
      seen.triageBatches++;
      return Promise.resolve({
        verdicts: company_keys.map((k) => ({
          company_key: k,
          relevance: k.includes("acme0") ? "irrelevant" : "relevant",
          confidence: 0.9,
          signal_strength: 80,
          reasons: ["engineering hiring satisfies the mission"],
          matched_roles: ["engineer"],
        })),
      });
    },

    // STAGE 7 — the real strict parser over the real registry.
    evaluateMission: ({ registry }) => {
      seen.evaluated++;
      return Promise.resolve(
        parseMissionEvaluationStrict(groundedPass(registry), registry));
    },
  } as never, {
    mission: m, plan, brain: BRAIN, maxCandidates: 40,
    readEnv: () => undefined,
  } as never);

  return { run, seen };
};

// ══════════════════════════════════ the flow, stage by connected stage ══

Deno.test("the whole flow runs, and every stage records what it did", async () => {
  const { run, seen } = await runFlow();

  // 1 DISCOVERY
  assertEquals(run.companies.length, N, "every discovered company is in the working set");

  // 2 GPT MISSION INTELLIGENCE — reached, and it read the pool.
  assert(seen.triageBatches > 0, "triage actually ran");
  assertEquals(run.state.triage?.total, N);
  assertEquals(run.state.triage?.irrelevant, 1);
  assertEquals(run.state.triage?.relevant, N - 1);
  for (const c of run.companies) {
    assert(c.triage, `${c.key} carries a triage verdict`);
  }

  // 3 SMART SHORTLIST + BUDGET — only the irrelevant one is excluded outright.
  const excludedByTriage = run.companies.filter(
    (c) => c.shortlist_exclusion === "triage_irrelevant");
  assertEquals(excludedByTriage.length, 1);
  assert(run.state.shortlist_decision, "the budget decision is recorded");
  assertEquals(run.state.shortlist_decision!.budget.requested_count, 5,
    "requested count is RECORDED and never multiplied into the budget");

  // THE ROLE-BREADTH PROOF: none of these titles is in the vocabulary, and they
  // were investigated anyway.
  const investigated = run.companies.filter((c) => c.identity !== null);
  assert(investigated.length > 0,
    "Founding Engineer / Member of Technical Staff reached the paid stages");

  // 4 IDENTITY — resolved and genuinely-unresolved stay distinguishable.
  const resolved = run.companies.filter(
    (c) => c.identity && identityIsActionable(c.identity));
  assert(resolved.length > 0, "identities resolved");
  const acme5 = run.companies.find((c) => c.key.includes("acme5"));
  if (acme5?.identity) {
    assertFalse(identityIsActionable(acme5.identity),
      "the provider answered and had no match — a company fact, not a run fact");
  }

  // 5 ENRICHMENT — success and empty are different outcomes.
  const outcomes = new Set(run.companies.map((c) => c.enrichment_outcome));
  assert(outcomes.has("success"), "some companies were enriched");
  for (const c of run.companies) {
    assert(
      ["success", "empty", "provider_error", "deferred", "not_attempted"]
        .includes(String(c.enrichment_outcome)),
      `${c.key} carries an explicit enrichment outcome, not a blank`);
  }

  // 6 + 7 COMPANY BRAIN → GPT MISSION EVALUATOR
  assert(seen.evaluated > 0, "the evaluator was reached");
  const judged = run.companies.filter((c) => c.mission_evaluation !== null);
  assert(judged.length > 0, "companies carry the evaluator's structured answer");

  // 8 QUALIFIED — and it is GPT that qualified them.
  assert(run.state.qualified_company_keys.length > 0,
    "a grounded pass qualifies through the real parser");
  for (const c of run.companies.filter((x) => x.verdict === "pass")) {
    assertEquals(c.decision_source, "gpt_evaluation");
    assertEquals(c.evaluation_path, "model_evaluated");
    assert(c.mission_evaluation!.matched_requirements.length > 0,
      "qualified on cited evidence, never on an uncited claim");
  }
});

Deno.test("every company arrives at the Workbench with a distinguishable reason", async () => {
  const { run } = await runFlow();

  const projection = projectEvaluationRows(run.companies.map((c) => ({
    key: c.key,
    shortlisted: c.shortlisted,
    companyName: (c.enriched ?? c.company).company_name ?? null,
    employeeCount: (c.enriched ?? c.company).employee_count ?? null,
    prequalified: c.prequalified,
    identityResolved: !!c.identity && identityIsActionable(c.identity),
    identityAttempted: c.identity !== null,
    enriched: c.enriched !== null,
    hiringVerified: c.hiring_jobs.length > 0,
    verdict: c.verdict,
    contactCount: c.contact_identities.length,
    decisionSource: c.decision_source,
    triage: c.triage,
    shortlistExclusion: c.shortlist_exclusion,
    investigationState: c.investigation_state,
    enrichmentOutcome: c.enrichment_outcome,
    stageBlock: c.stage_block,
    missionEvaluation: c.mission_evaluation,
  })) as never);

  assert(projection.rows.length > 0, "the Workbench receives rows");

  // ── NO CANDIDATE SILENTLY DISAPPEARS ──────────────────────────────────
  //
  // TWO COMPLEMENTARY PROJECTIONS, and the invariant is their SUM.
  // `projectEvaluationRows` deliberately skips a company once it qualifies —
  // qualified rows are real records and go to `lead_candidates` through
  // `leadMissionPersistenceProjection`. Asserting that evaluation rows alone
  // cover the pool would be asserting the wrong thing; asserting that the two
  // together cover it exactly is the property that actually matters, and the
  // one that breaks if either projection starts dropping companies.
  const qualifiedKeys = run.companies
    .filter((c) => c.verdict === "pass").map((c) => c.key);
  const rowKeys = projection.rows.map((r) => r.company_key);
  assertEquals(
    new Set([...rowKeys, ...qualifiedKeys]).size,
    new Set(run.companies.map((c) => c.key)).size,
    "evaluation rows + qualified rows account for every company the engine saw");
  assertEquals(
    rowKeys.filter((k) => qualifiedKeys.includes(k)).length, 0,
    "and the two projections never claim the same company twice");
  assert(qualifiedKeys.length > 0, "the qualified half of the invariant is exercised");

  // AND NONE OF THEM IS CAPTIONED AS A DECISION IT DID NOT RECEIVE.
  for (const row of projection.rows) {
    assert(row.status, `${row.company_key} has an explicit lifecycle`);
    if (row.status === "not_qualified") {
      assertEquals(row.decision_source, "gpt_evaluation",
        `${row.company_key} is captioned "not qualified" — only the evaluator ` +
        `may put a company there`);
    }
  }

  // THE TRIAGE-EXCLUDED COMPANY IS NOT RENDERED AS A REJECTION.
  const triaged = projection.rows.find((r) => r.shortlist_exclusion === "triage_irrelevant");
  if (triaged) {
    assertFalse(triaged.status === "not_qualified",
      "a company triage never paid to investigate was not 'evaluated and rejected'");
  }
});
