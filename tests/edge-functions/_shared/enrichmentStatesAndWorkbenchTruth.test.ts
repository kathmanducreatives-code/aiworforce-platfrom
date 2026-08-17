// AN ABSENCE IS NOT AN ANSWER, AND AN UNJUDGED COMPANY IS NOT A REJECTED ONE.
//
// TWO DEFECTS, ONE PIPELINE APART, WITH THE SAME SHAPE: a distinction the
// architecture makes carefully everywhere else, thrown away at the last step.
//
// ── 1. ENRICHMENT COLLAPSED FOUR OUTCOMES INTO ONE `null` ────────────────────
//
// `c.enriched === null` meant, indistinguishably: the provider answered and had
// no record; the call failed; the call was never started because the checkpoint
// reserve was reached; the company never reached the stage. Only the first says
// anything about the company. The consequences were concrete and paid for:
//
//   * the capability reported `complete` while companies were still owed a
//     deferred call, so a resume skipped them permanently
//   * the resume record wrote `not_started` for an ANSWERED enrichment, so a
//     continuation re-bought the same silence
//
// ── 2. THE WORKBENCH CALLED ALL OF IT "NOT QUALIFIED" ───────────────────────
//
// Triage answers `uncertain` rather than excluding. The evaluator returns
// `insufficient_evidence` as a terminal state distinct from `not_qualified`.
// Qualification HOLDS a company whose enrichment produced nothing. The shortlist
// records `budget_exhausted` separately from `triage_irrelevant`. Every one of
// those careful distinctions survived to the projection — which flattened them
// into one list under a banner reading "evaluated but not qualified".
//
// These tests hold both lines: what the run did NOT establish is never reported
// as something it established.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  runCapabilityPlan, toResumeRecord, restoreWorkingSet,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  ENRICHMENT_OUTCOMES, ENRICHMENT_EXPLANATION, asEnrichmentOutcome,
  enrichmentIsEvidence, enrichmentIsTerminal, enrichmentWasAnswered,
  summariseEnrichmentOutcomes, type EnrichmentOutcome,
} from "../../../supabase/functions/_shared/leadEnrichmentState.ts";
import {
  nextStageFor, ENRICHMENT_RESUMABLE,
} from "../../../supabase/functions/_shared/leadResumeState.ts";
import {
  deriveLifecycle, projectEvaluationRows, lifecycleIsDecision,
  lifecycleIsResumable, notQualifiedRows, undecidedRows, resumableRows,
  explainShortlistExclusion, LIFECYCLE_EXPLANATION,
  type ProjectableCompany, type WorkbenchLifecycle,
} from "../../../supabase/functions/_shared/leadWorkbenchProjection.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

// ─────────────────────────────────────────────────────────────── the fixture ──

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

const ycRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Acme${i}`, website: `https://acme${i}.com`, teamSize: 40 + i,
    batch: "W20", industries: ["B2B"], id: `acme${i}`,
    openJobs: [{ title: "Backend Engineer" }],
  })) as unknown as Record<string, unknown>[];

/** One resolved LinkedIn identity per company, so enrichment is reached. */
const identityRow = (i: number) => ({
  companyName: `Acme${i}`,
  linkedinUrl: `https://www.linkedin.com/company/acme${i}`,
  website: `https://acme${i}.com`,
  employeeCount: 40 + i,
});

/**
 * The engine, with enrichment's behaviour under the caller's control.
 *
 * `onEnrich` decides what the batched company-details call does: return rows,
 * return nothing, or throw. Throwing is how a real provider failure reaches
 * `callProvider`, which is the path that must record `provider_error` rather
 * than let an empty array be read as evidence.
 */
const runEngine = async (o: {
  companies?: number;
  onEnrich?: (batch: number) => Record<string, unknown>[];
}) => {
  const n = o.companies ?? 3;
  const m = mission();
  const plan = buildCapabilityGraph(m);
  let enrichBatch = 0;
  return await runCapabilityPlan({
      planDiscovery: stubDiscoverySelector(),
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey === "apify_yc_companies_memo23") {
        return Promise.resolve(ycRows(n));
      }
      if (call.actorKey === "apify_linkedin_company_details") {
        const batch = enrichBatch++;
        // THROWN, NOT RETURNED EMPTY. The distinction under test.
        const out = o.onEnrich
          ? o.onEnrich(batch)
          : Array.from({ length: n }, (_, i) => identityRow(i));
        return Promise.resolve(out as Record<string, unknown>[]);
      }
      // Identity resolution: one match per company, so every company is
      // actionable and enrichment is genuinely attempted for all of them.
      return Promise.resolve(
        Array.from({ length: n }, (_, i) => identityRow(i)) as Record<string, unknown>[],
      );
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
  } as never, {
    mission: m, plan, brain: BRAIN, maxCandidates: 60,
    readEnv: () => undefined,
  } as never);
};

// ════════════════════════════════ 1. the state vocabulary is closed and safe ══

Deno.test("1. every enrichment outcome is explained, and only `success` is evidence", () => {
  assertEquals(ENRICHMENT_OUTCOMES.length, 5);
  for (const o of ENRICHMENT_OUTCOMES) {
    assert(ENRICHMENT_EXPLANATION[o].length > 0, `${o} must be explainable to a user`);
  }
  // THE WHOLE POINT: four ways to have no evidence, exactly one way to have it.
  for (const o of ENRICHMENT_OUTCOMES) {
    assertEquals(enrichmentIsEvidence(o), o === "success", o);
  }
  // ANSWERED ≠ EVIDENCE. `empty` is a real answer that yields no evidence, and
  // conflating the two is what let a failed call look like a proven negative.
  assert(enrichmentWasAnswered("empty"));
  assertFalse(enrichmentIsEvidence("empty"));
  assertFalse(enrichmentWasAnswered("provider_error"));
  assertFalse(enrichmentWasAnswered("deferred"));
});

Deno.test("1b. deferred and provider_error are NOT terminal — a resume owes them", () => {
  assertFalse(enrichmentIsTerminal("deferred"));
  assertFalse(enrichmentIsTerminal("provider_error"));
  // `empty` IS terminal: asking again buys the same silence.
  assert(enrichmentIsTerminal("empty"));
  assert(enrichmentIsTerminal("success"));
  assert(enrichmentIsTerminal("not_attempted"));
});

Deno.test("1c. an unrecognised outcome degrades to not_attempted, never to success", () => {
  for (const bad of [null, undefined, "", "completed", "yes", 42, {}]) {
    assertEquals(asEnrichmentOutcome(bad), "not_attempted",
      `${JSON.stringify(bad)} must never be read as evidence`);
  }
  for (const o of ENRICHMENT_OUTCOMES) assertEquals(asEnrichmentOutcome(o), o);
});

Deno.test("1d. the summary counts every outcome, including the zeroes", () => {
  const s = summariseEnrichmentOutcomes(
    ["success", "success", "empty", "deferred"] as EnrichmentOutcome[]);
  assertEquals(s.total, 4);
  assertEquals(s.success, 2);
  assertEquals(s.empty, 1);
  assertEquals(s.deferred, 1);
  // A ZERO IS A MEASUREMENT. "no provider errors" and "we did not look" are
  // different claims and the shape must be able to make the first one.
  assertEquals(s.provider_error, 0);
});

// ══════════════════════════════ 2. the engine records what actually happened ══

Deno.test("2. enrichment that returns rows is SUCCESS", async () => {
  const run = await runEngine({});
  const enriched = run.companies.filter((c) => c.enriched !== null);
  assert(enriched.length > 0, "the fixture must actually enrich something");
  for (const c of enriched) {
    assertEquals(c.enrichment_outcome, "success", c.key);
    assertEquals(c.stage_block, null, "a success leaves no block behind");
  }
});

Deno.test("2b. enrichment that is ANSWERED with nothing is EMPTY, not an error", async () => {
  const run = await runEngine({ onEnrich: () => [] });
  const attempted = run.companies.filter(
    (c) => c.enrichment_outcome !== "not_attempted");
  assert(attempted.length > 0, "companies must reach the enrichment stage");
  for (const c of attempted) {
    assertEquals(c.enrichment_outcome, "empty", c.key);
    // AN ANSWER IS NOT A BLOCK. The run is not owed anything for this company.
    assertEquals(c.stage_block, null, `${c.key}: an answered call blocks nothing`);
  }
});

Deno.test("2c. a FAILED enrichment call is provider_error — and is never read as empty",
  async () => {
    const run = await runEngine({
      onEnrich: () => { throw new Error("actor exploded"); },
    });
    const attempted = run.companies.filter(
      (c) => c.enrichment_outcome !== "not_attempted");
    assert(attempted.length > 0);
    for (const c of attempted) {
      assertEquals(c.enrichment_outcome, "provider_error", c.key);
      // SCOPED TO THE CAPABILITY, so this can never be misread as an identity
      // outcome by anything downstream.
      assertEquals(c.stage_block?.capability, "company_enrichment", c.key);
      assertEquals(c.stage_block?.reason, "provider_error", c.key);
    }
    // AND THE STAGE DOES NOT CLAIM TO BE DONE. A capability holding companies
    // that never reached a terminal state must stay resumable — marking it
    // complete is what strands them permanently behind the resume guard.
    assertFalse(
      run.state.completed_capabilities.includes("company_enrichment"),
      "a stage owing provider-error retries may not report itself complete",
    );
  });

Deno.test("2d. a company that never reached the stage is not_attempted, not empty",
  async () => {
    // No identity ⇒ not actionable ⇒ enrichment is never attempted for it.
    const m = mission();
    const plan = buildCapabilityGraph(m);
    const run = await runCapabilityPlan({
      planDiscovery: stubDiscoverySelector(),
      invoke: (call: CompiledActorCall<unknown>) =>
        Promise.resolve(call.actorKey === "apify_yc_companies_memo23"
          ? ycRows(3)
          : []),
      verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    } as never, {
      mission: m, plan, brain: BRAIN, maxCandidates: 60, readEnv: () => undefined,
    } as never);
    for (const c of run.companies) {
      assertEquals(c.enrichment_outcome, "not_attempted", c.key);
    }
  });

Deno.test("2e. an unenriched company is HELD, never rejected — and the outcome is kept",
  async () => {
    // Qualification already held an unenriched company rather than rejecting it.
    // What it could not say was WHY — and `empty` (retrying buys nothing) versus
    // `provider_error` (a continuation should retry) are different instructions.
    //
    // The evaluator-gated form of this hold — `missing_evidence` naming
    // `company_enrichment:empty` when the Brain would otherwise have QUALIFIED
    // the company — needs an evaluator that returns a grounded pass, and is
    // asserted in `hiringWorkbenchE2E`. What this fixture proves is the property
    // that must hold on EVERY path: no company is rejected for an enrichment
    // that produced nothing, and the outcome is recorded either way.
    const run = await runEngine({ onEnrich: () => [] });
    const attempted = run.companies.filter(
      (c) => c.enrichment_outcome !== "not_attempted");
    assert(attempted.length > 0, "companies must reach the enrichment stage");
    for (const c of attempted) {
      assertFalse(c.verdict === "pass",
        `${c.key}: unenriched evidence may never qualify a company`);
      assertFalse(c.verdict === "reject",
        `${c.key}: a hold is not a rejection — an empty provider says nothing`);
      assertEquals(c.enrichment_outcome, "empty", c.key);
    }
    assert(
      run.companies.some((c) => c.verdict === "unknown"),
      "and the companies that reached qualification are held as unknown",
    );
  });

// ═══════════════════════════════════ 3. the state survives the isolate dying ══

Deno.test("3. the outcome round-trips through the resume checkpoint", async () => {
  const run = await runEngine({ onEnrich: () => [] });
  const records = run.companies.map(toResumeRecord);
  const attempted = records.filter((r) => r.enrichment === "empty");
  assert(attempted.length > 0, "the checkpoint must record `empty` explicitly");

  const restored = restoreWorkingSet(records);
  for (const r of records) {
    const c = restored.find((x) => x.key === r.company_key);
    assert(c, `${r.company_key} must be restored`);
    // THE FACT SURVIVES. Without this a continuation reads a missing `enriched`
    // row and reports a provider failure or a deadline deferral as
    // "not attempted", losing exactly what the outcome exists to keep.
    assertEquals(c!.enrichment_outcome, "empty", r.company_key);
  }
});

Deno.test("3b. a resume RETRIES deferred and provider_error, and never retries empty", () => {
  assert(ENRICHMENT_RESUMABLE.has("deferred"));
  assert(ENRICHMENT_RESUMABLE.has("provider_error"));
  assert(ENRICHMENT_RESUMABLE.has("not_started"));
  // THE ONE THAT MUST NOT BE RETRIED. `empty` is an answer; buying it twice is
  // spending money to be told the same thing.
  assertFalse(ENRICHMENT_RESUMABLE.has("empty"),
    "an answered enrichment must not be re-bought");

  const rec = (enrichment: string) => ({
    company_key: "a.com", company_name: "A",
    identity: "resolved" as const, enrichment: enrichment as never,
    hiring: "not_started" as const, brain: "not_started" as const,
    founder: "not_started" as const,
    linkedin_company_url: null, completed_operations: [],
    updated_at: new Date(0).toISOString(),
  });
  assertEquals(nextStageFor(rec("deferred")), "enrichment");
  assertEquals(nextStageFor(rec("provider_error")), "enrichment");
  assertEquals(nextStageFor(rec("not_started")), "enrichment");
  assertEquals(nextStageFor(rec("empty")), "hiring", "answered ⇒ move on");
  assertEquals(nextStageFor(rec("completed")), "hiring");
});

Deno.test("3c. a checkpoint written before this field existed still restores", async () => {
  // BACKWARD COMPATIBILITY IS PART OF THE CONTRACT. An older record has no
  // `enrichment_outcome`; it must degrade to `not_attempted` rather than throw
  // — and where the evidence itself survived, that IS a success.
  const run = await runEngine({});
  const records = run.companies.map(toResumeRecord).map((r) => ({
    ...r,
    snapshot: r.snapshot
      ? { ...r.snapshot, enrichment_outcome: undefined }
      : r.snapshot,
  }));
  const restored = restoreWorkingSet(records as never);
  assert(restored.length > 0);
  for (const c of restored) {
    assertEquals(c.enrichment_outcome, c.enriched !== null ? "success" : "not_attempted",
      c.key);
  }
});

// ═══════════════════════ 4. NOT QUALIFIED REQUIRES A JUDGE — the invariant ══

/** A minimally-populated projectable company. */
const co = (o: Partial<ProjectableCompany> = {}): ProjectableCompany => ({
  key: o.key ?? "acme.com",
  shortlisted: false,
  prequalified: null,
  identityResolved: false,
  identityAttempted: false,
  enriched: false,
  hiringVerified: false,
  verdict: null,
  contactCount: 0,
  ...o,
});

Deno.test("4. THE INVARIANT: no lifecycle but a real decision may say not_qualified", () => {
  // Enumerated rather than sampled. Every state the projection can produce is
  // checked, so a state added later cannot quietly become a rejection.
  const ALL: WorkbenchLifecycle[] = [
    "discovered", "evaluated", "not_investigated", "shortlisted",
    "identity_unresolved", "verifying", "deferred", "held_for_evidence",
    "qualified", "not_qualified", "contact_ready",
  ];
  for (const s of ALL) {
    assertEquals(lifecycleIsDecision(s),
      s === "qualified" || s === "not_qualified" || s === "contact_ready",
      `${s} must not claim to be a decision`);
    assert(LIFECYCLE_EXPLANATION[s].length > 0, `${s} must be explainable`);
  }
  assert(lifecycleIsResumable("deferred"));
  assert(lifecycleIsResumable("held_for_evidence"));
  assertFalse(lifecycleIsResumable("not_qualified"));
});

Deno.test("4a. a REJECT with no judge is HELD, never rendered as not_qualified", () => {
  // Two independent bars. A bare `reject` verdict was previously enough on its
  // own, so any code path that set it without an evaluation produced an
  // unexplained rejection the user could not challenge.
  assertEquals(
    deriveLifecycle(co({ verdict: "reject", decisionSource: "gpt_evaluation" })),
    "not_qualified", "an evaluated rejection IS a rejection");
  assertEquals(
    deriveLifecycle(co({ verdict: "reject", decisionSource: "hard_constraint_rejection" })),
    "not_qualified", "a verified hard fact IS a rejection");

  for (const src of ["insufficient_evidence", "not_evaluated", "identity_failure"] as const) {
    assertEquals(deriveLifecycle(co({ verdict: "reject", decisionSource: src })),
      "held_for_evidence", `${src} is not a judgement about the company`);
  }
  // AND WITH NO DECISION SOURCE AT ALL — the default must be safe.
  assertEquals(deriveLifecycle(co({ verdict: "reject" })), "held_for_evidence");
});

Deno.test("4b. UNKNOWN is held, not rejected and not silently 'verifying'", () => {
  const held = co({
    verdict: "unknown", decisionSource: "insufficient_evidence",
    identityResolved: true, enriched: true,
  });
  assertEquals(deriveLifecycle(held), "held_for_evidence");
  assertFalse(deriveLifecycle(held) === "not_qualified");
  assertFalse(deriveLifecycle(held) === "qualified");
});

Deno.test("4c. a DEFERRED company reports the clock, not a verdict", () => {
  // The company the deadline stopped. Left to the stage ladder this reads as
  // `shortlisted` — which says the run chose it and stops there, hiding that
  // the run still owes it work.
  const deferred = co({
    shortlisted: true,
    stageBlock: { capability: "company_identity_resolution", reason: "deferred" },
  });
  assertEquals(deriveLifecycle(deferred), "deferred");
  assertFalse(lifecycleIsDecision(deriveLifecycle(deferred)));
  assert(lifecycleIsResumable(deriveLifecycle(deferred)));

  // Same for an enrichment the provider never answered.
  for (const o of ["deferred", "provider_error"] as const) {
    assertEquals(
      deriveLifecycle(co({ shortlisted: true, identityResolved: true, enrichmentOutcome: o })),
      "deferred", `enrichment ${o} is a fact about the run`);
  }
  // ...but an ANSWERED-empty enrichment is not a block; that company progressed.
  assertEquals(
    deriveLifecycle(co({ shortlisted: true, identityResolved: true, enrichmentOutcome: "empty" })),
    "verifying");
});

Deno.test("4d. a company the budget never reached is NOT_INVESTIGATED", () => {
  const pq = {
    name: "Acme", canonical_domain: "acme.com", team_size: 40,
    best_tier: "A" as const, score: 80, strongest_signal: "Backend Engineer",
    exclusion: null, eligible: true, jobs: [], reasons: [],
  };
  for (const reason of ["budget_exhausted", "triage_irrelevant", "prequalification_ineligible"]) {
    const c = co({ prequalified: pq, shortlistExclusion: reason });
    assertEquals(deriveLifecycle(c), "not_investigated", reason);
    assertFalse(lifecycleIsDecision(deriveLifecycle(c)),
      `${reason} must never read as a decision`);
  }
  // AND THE REASON IS A SENTENCE, not a code the user has to decipher.
  assert(explainShortlistExclusion("budget_exhausted")!.includes("never judged"));
  assert(explainShortlistExclusion("triage_irrelevant")!.length > 0);
  assertEquals(explainShortlistExclusion(null), null);
  // An unrecognised reason still explains itself rather than showing nothing.
  assert(explainShortlistExclusion("something_new")!.includes("something_new"));
});

// ══════════════════════ 5. the projection carries the WHY, not just the WHAT ══

Deno.test("5. triage, exclusion, evaluation and decision source reach the row", () => {
  const p = projectEvaluationRows([
    co({
      key: "judged.com",
      verdict: "reject",
      decisionSource: "gpt_evaluation",
      identityResolved: true,
      enriched: true,
      enrichmentOutcome: "success",
      triage: { relevance: "relevant", confidence: 0.9, signal_strength: 88, reasons: ["hiring"] },
      missionEvaluation: {
        decision: "not_qualified", match_score: 21, confidence: 0.8,
        reasoning: "no commercial hiring signal",
        rejection_reasons: ["wrong segment"],
        failed_requirements: [{ requirement: "hiring engineers", why: "none open" }],
      },
    }),
    co({
      key: "starved.com",
      shortlistExclusion: "budget_exhausted",
      triage: { relevance: "uncertain", confidence: 0, signal_strength: 0, reasons: ["thin data"] },
    }),
  ]);

  const judged = p.rows.find((r) => r.company_key === "judged.com")!;
  assertEquals(judged.status, "not_qualified");
  assert(judged.decided, "a real evaluation IS a decision");
  assertEquals(judged.decision_source, "gpt_evaluation");
  assertEquals(judged.mission_decision, "not_qualified");
  assertEquals(judged.mission_match_score, 21);
  assertEquals(judged.mission_reasoning, "no commercial hiring signal");
  assertEquals(judged.mission_failed_requirements, ["hiring engineers: none open"]);
  assertEquals(judged.triage_relevance, "relevant");
  assertEquals(judged.triage_signal_strength, 88);
  assertEquals(judged.enrichment_state, "success");

  const starved = p.rows.find((r) => r.company_key === "starved.com")!;
  assertEquals(starved.status, "not_investigated");
  assertFalse(starved.decided, "the budget running out is not a judgement");
  assertEquals(starved.decision_source, "not_evaluated");
  assertEquals(starved.shortlist_exclusion, "budget_exhausted");
  assert(starved.shortlist_exclusion_explanation!.includes("never judged"));
  assertEquals(starved.triage_relevance, "uncertain");
  // NO FABRICATED NEUTRAL. An evaluation that never happened is null, not a
  // zero a consumer could rank a company by.
  assertEquals(starved.mission_decision, null);
  assertEquals(starved.mission_match_score, null);
});

Deno.test("5b. the counts distinguish 'judged and failed' from 'never reached'", () => {
  const p = projectEvaluationRows([
    co({ key: "a", verdict: "reject", decisionSource: "gpt_evaluation" }),
    co({ key: "b", shortlistExclusion: "budget_exhausted" }),
    co({ key: "c", shortlisted: true, stageBlock: { capability: "company_enrichment", reason: "deferred" } }),
    co({ key: "d", verdict: "unknown", decisionSource: "insufficient_evidence" }),
  ]);
  // "0 QUALIFIED" IS ONLY EXPLAINABLE NEXT TO THESE.
  assertEquals(p.counts.not_qualified, 1);
  assertEquals(p.counts.not_investigated, 1);
  assertEquals(p.counts.deferred, 1);
  assertEquals(p.counts.held_for_evidence, 1);
  assertEquals(p.counts.qualified, 0);

  assertEquals(notQualifiedRows(p.rows).length, 1, "exactly one was judged");
  assertEquals(undecidedRows(p.rows).length, 3, "and three were not");
  assertEquals(resumableRows(p.rows).length, 2, "deferred + held are resumable");
  // THE HEADLINE INVARIANT, stated once as an assertion.
  for (const r of undecidedRows(p.rows)) {
    assertFalse(r.status === "not_qualified",
      `${r.company_key}: an unjudged company may never be shown as not qualified`);
    assertFalse(r.decided);
  }
});

Deno.test("5c. triage counts are NULL when triage never ran, never all-zero", () => {
  // All-zero counts read as "triage found nothing relevant", which is a result.
  // The truth is that the stage was off, and the shape has to say so.
  const off = projectEvaluationRows([co({ key: "a" })]);
  assertEquals(off.triage_counts, null);

  const on = projectEvaluationRows([
    co({ key: "a", triage: { relevance: "irrelevant", confidence: 1, signal_strength: 0, reasons: [] } }),
  ]);
  assertEquals(on.triage_counts, { relevant: 0, uncertain: 0, irrelevant: 1 });
});

Deno.test("5d. enrichment counts are reported per outcome", () => {
  const p = projectEvaluationRows([
    co({ key: "a", enrichmentOutcome: "success", enriched: true }),
    co({ key: "b", enrichmentOutcome: "empty" }),
    co({ key: "c", enrichmentOutcome: "provider_error" }),
    co({ key: "d" }),
  ]);
  assertEquals(p.enrichment_counts.success, 1);
  assertEquals(p.enrichment_counts.empty, 1);
  assertEquals(p.enrichment_counts.provider_error, 1);
  assertEquals(p.enrichment_counts.not_attempted, 1);
});

Deno.test("5e. a progress row is STILL structurally unable to become a lead", () => {
  // The new fields must not have reopened the hole the projection exists to
  // keep closed. Actionability is not a rule someone remembers; it is the shape.
  const p = projectEvaluationRows([
    co({ key: "a", verdict: "reject", decisionSource: "gpt_evaluation" }),
    co({ key: "b", shortlistExclusion: "budget_exhausted" }),
  ]);
  for (const r of p.rows) {
    assertEquals(r.actionable, false);
    assertEquals(r.counts_as_qualified, false);
    assertFalse("lead_candidate_id" in (r as unknown as Record<string, unknown>));
  }
});

// ═══════════════════════════ 6. end to end, through the real engine ══════════

Deno.test("6. a provider failure produces a resumable row, never a rejection", async () => {
  const run = await runEngine({
    onEnrich: () => { throw new Error("actor exploded"); },
  });
  const p = projectEvaluationRows(run.companies.map((c) => ({
    key: c.key,
    shortlisted: c.shortlisted,
    prequalified: null,
    identityResolved: c.identity !== null,
    identityAttempted: c.identity !== null,
    enriched: c.enriched !== null,
    hiringVerified: c.hiring_jobs.length > 0,
    verdict: c.verdict,
    contactCount: c.contact_identities.length,
    decisionSource: c.decision_source,
    shortlistExclusion: c.shortlist_exclusion,
    enrichmentOutcome: c.enrichment_outcome,
    stageBlock: c.stage_block,
  })));

  assertEquals(p.counts.not_qualified, 0,
    "a provider that failed may not produce a single rejected company");
  assert(p.rows.length > 0, "and the work must still be visible");
  for (const r of p.rows) {
    assertFalse(r.decided, `${r.company_key}: nothing here was judged`);
    assertFalse(r.status === "not_qualified", r.company_key);
  }
  // THE COMPANIES ARE STILL RECOVERABLE — the run owes them, and says so.
  assert(resumableRows(p.rows).length > 0,
    "the rows must be marked resumable so the user is told to continue");
});
