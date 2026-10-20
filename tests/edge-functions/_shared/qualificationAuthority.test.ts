// Q1 — ONE QUALIFICATION AUTHORITY.
//
// The canonical decision (`evaluateEligibility` → `candidateDecision`) is the
// only thing that may label a company. These tests pin what Q1 adds to it:
//
//   - what other authorities already decided against qualifying (`holds`) can
//     stop an otherwise eligible company — never lift or reject one;
//   - a held company is never bought more evidence (its hold check is blocked);
//   - every caller passes the same verdicts and holds;
//   - the evaluator answers the SAME criteria the decision reads;
//   - a second look cannot quietly turn a cited FAIL into a PASS;
//   - a resumed slice holds what the previous slice held.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { EvidenceDimension, EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { canStillQualify, evidenceGapsFor } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { candidateDecision, decisionCounts, type MissionCandidate } from "../../../supabase/functions/_shared/workbenchMissionView.ts";
import { deriveMissionCriteria, type MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildQualificationContext } from "../../../supabase/functions/_shared/missionQualificationContext.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";
import {
  type CriterionVerdict, type MissionEvaluation, mergeCriterionVerdicts, notEvaluated,
} from "../../../supabase/functions/_shared/missionEvaluation.ts";
import { qualificationHoldsOf, restoredHolds } from "../../../supabase/functions/_shared/qualificationHold.ts";
import { buildCheckpoint, CHECKPOINT_RESULT_KEY, readCheckpointCompanies } from "../../../supabase/functions/_shared/leadResumeState.ts";
import { restoreWorkingSet, toResumeRecord } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";

const NOW = new Date("2026-10-20T12:00:00.000Z");
const MISSION = parseLeadMissionDeterministic("Find B2B SaaS companies in the United States");
const CRITERIA = deriveMissionCriteria(MISSION);
const HARD = CRITERIA.filter((c) => c.kind === "hard" && c.status === "ok");

let seq = 0;
const ev = (dimension: EvidenceDimension, value: unknown): EvidenceItem => ({
  evidence_id: `ev_${dimension}_${++seq}`, company_key: "c1", dimension, value, status: "proven",
  source: { provider: "apify", actor: "apify_linkedin_company_details", provider_call_id: "pc", url: "https://x.test", excerpt: null },
  method: "provider_field", observed_at: "2026-10-19T00:00:00.000Z", valid_until: null, confidence: "high",
  derived_from: [], mission_id: "q1", origin: "lead_mission",
  ...(dimension === "geography" ? { authority: { claim: "headquarters", level: "proven" } } : {}),
} as EvidenceItem);
const proven = () => buildCompanyEvidenceGraph("c1", [ev("geography", "Austin, TX, United States"), ev("business_model", "b2b saas")], { now: NOW });
const partial = () => buildCompanyEvidenceGraph("c1", [ev("business_model", "b2b saas")], { now: NOW });
const pass = (c: MissionCriterion): CriterionVerdict => ({ criterion_id: c.id, result: "pass", reason: "cited",
  evidence: [{ evidence_id: "reg_1", excerpt: "x" }], ...(c.dimension === "geography" ? { geography_scope: "headquarters" as const } : {}) });

const evaluation = (decision: MissionEvaluation["decision"], rows?: CriterionVerdict[]): MissionEvaluation => ({
  ...notEvaluated("x"), unknown_fields: [], decision, reasoning: `overall ${decision}`,
  mission_fit: decision === "qualified" ? "pass" : decision === "not_qualified" ? "fail" : "review",
  ...(rows ? { criterion_verdicts: rows } : {}),
});

// ═════════════════════════════════════════════════════════════════ holds ══

Deno.test("holds: a rejection always holds; a REVIEW only when it contradicts its own PASS rows", () => {
  const rows = HARD.map(pass);
  const codes = (e: MissionEvaluation | null, extra: Record<string, unknown> = {}) =>
    qualificationHoldsOf({ mission_evaluation: e, ...extra }).map((h) => h.code);
  assertEquals(codes(evaluation("not_qualified", rows)), ["evaluator_rejected"], "FAIL with every row PASS (G09)");
  assertEquals(codes(evaluation("not_qualified")), ["evaluator_rejected"], "a rejection from before per-criterion rows");
  assertEquals(codes(evaluation("insufficient_evidence", rows)), ["evaluator_review"], "REVIEW with every row PASS (G09)");
  assertEquals(codes(evaluation("insufficient_evidence", [...rows.slice(1), { ...rows[0], result: "unknown" }])), [],
    "a REVIEW with an open row is decided by that row");
  assertEquals(codes(evaluation("insufficient_evidence")), [],
    "a REVIEW without rows asked what claim verification answers — not frozen");
  assertEquals(codes(evaluation("qualified", rows)), []);
  assertEquals(codes(notEvaluated("no evaluator was available for this run")), [], "no evaluator configured: the graph decides");
  assertEquals(codes(null), []);
  assertEquals(codes(null, { decision_source: "hard_constraint_rejection", fit: { reason: "staffing_or_aggregator" } }),
    ["verified_fact_rejected"]);
  assertEquals(codes(null, { record: { stage_reason: "enrichment_evidence_missing:empty" } }), ["enrichment_evidence_missing"]);
});

Deno.test("decision: a hold stops an otherwise eligible company — pending, blocked, unlabelled", () => {
  const holds = qualificationHoldsOf({ mission_evaluation: evaluation("not_qualified", HARD.map(pass)) });
  assertEquals(evaluateEligibility(CRITERIA, proven()).eligibility, "eligible", "the evidence alone qualifies it");
  const e = evaluateEligibility(CRITERIA, proven(), undefined, holds);
  assertEquals(e.eligibility, "pending");
  assertEquals(e.held.map((h) => h.code), ["evaluator_rejected"]);
  const check = e.checks.find((c) => c.criterion_id === "qualification_hold:evaluator_rejected")!;
  assertEquals([check.kind, check.result, check.blocked], ["hard", "unknown", "hold:evaluator_rejected"]);
  assertEquals(e.hard_checks.qualification_hold, "unknown");
  assertEquals(e.gaps, [], "a hold is nothing a purchase can buy");
  // Nothing is bought for it: the hold is a blocked gap, so it cannot still qualify.
  const gaps = evidenceGapsFor(e.checks.filter((c) => c.kind === "hard"), proven());
  assertEquals(gaps.map((g) => [g.criterion_id, g.next]), [["qualification_hold:evaluator_rejected", "blocked"]]);
  assertFalse(canStillQualify(gaps));
});

Deno.test("decision: a hold never changes a pending or an ineligible company", () => {
  const holds = qualificationHoldsOf({ mission_evaluation: evaluation("not_qualified") });
  const pending = evaluateEligibility(CRITERIA, partial(), undefined, holds);
  assertEquals([pending.eligibility, pending.held.length], ["pending", 0]);
  // Its ordinary open question is still routable — the hold adds no blocked gap.
  assert(pending.checks.every((c) => !c.blocked));
  const outside = buildCompanyEvidenceGraph("c1", [ev("geography", "Berlin, Germany"), ev("business_model", "b2b saas")], { now: NOW });
  assertEquals(evaluateEligibility(CRITERIA, outside, undefined, holds).eligibility, "ineligible");
});

Deno.test("decision: every view agrees — candidateDecision and the counts read the holds", () => {
  const base: MissionCandidate = {
    company_key: "c1", name: "C1", domain: "c1.test", linkedin_url: null, found_by: [], screened_out: null,
    identity_resolved: true, investigated: true, graph: proven(), next_action: null,
  };
  const held: MissionCandidate = { ...base, company_key: "c2",
    criterion_verdicts: HARD.map(pass), holds: qualificationHoldsOf({ mission_evaluation: evaluation("not_qualified", HARD.map(pass)) }) };
  const ok: MissionCandidate = { ...base, criterion_verdicts: HARD.map(pass), holds: [] };
  const d = candidateDecision({ criteria: CRITERIA, candidate: held, anchor: null });
  assertEquals([d.bucket, d.label, d.held], ["pending", null, ["evaluator_rejected"]]);
  assert(candidateDecision({ criteria: CRITERIA, candidate: ok, anchor: null }).label, "the positive control is labelled");
  const counts = decisionCounts({ criteria: CRITERIA, candidates: [ok, held], anchor: null });
  assertEquals(counts.pending, 1);
  assertEquals(counts.exact_match + counts.strong_opportunity + counts.worth_considering + counts.low_priority, 1);
});

// ═══════════════════════════════════════════════════════ one criteria set ══

Deno.test("criteria: the evaluator answers exactly the criteria the decision reads, under the same readiness", () => {
  const ctx = buildQualificationContext(MISSION, { readiness: PRODUCTION_READINESS });
  assertEquals(JSON.stringify(ctx.criteria), JSON.stringify(deriveMissionCriteria(MISSION, PRODUCTION_READINESS)));
  const engine = Deno.readTextFileSync(new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
  assert(engine.includes('{ criteriaAuthority: opts.specMode === "enforce", readiness: opts.readiness });'),
    "the engine builds the evaluator's criteria under the run's readiness");
  const runAgent = Deno.readTextFileSync(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  for (const site of ["deriveMissionCriteria(persistedMission!, leadReadiness)", "deriveMissionCriteria(persistedMission, leadReadiness)"]) {
    assert(runAgent.includes(site), site);
  }
  assertFalse(/deriveMissionCriteria\(persistedMission!?\)/.test(runAgent), "no run-agent decision site derives without readiness");
});

Deno.test("callers: every eligibility decision passes the verdicts and the holds", () => {
  const files = {
    "supabase/functions/run-agent/index.ts": 2, "supabase/functions/_shared/opportunityReasoningRun.ts": 1,
    "supabase/functions/_shared/workbenchMissionView.ts": 2, "supabase/functions/_shared/leadCapabilityEngine.ts": 1,
  } as const;
  for (const [f, n] of Object.entries(files)) {
    const src = Deno.readTextFileSync(new URL(`../../../${f}`, import.meta.url));
    const calls = [...src.matchAll(/evaluateEligibility\(([^)]*)\)/g)].map((m) => m[1]);
    assertEquals(calls.length, n, `${f}: ${calls.join(" | ")}`);
    for (const args of calls) assertEquals(args.split(",").length, 4, `${f}: evaluateEligibility(${args}) must pass verdicts and holds`);
  }
});

// ═══════════════════════════════════════════════════════════ second look ══

Deno.test("second look: a cited FAIL stands unless the new PASS cites NEW evidence", () => {
  const fail: CriterionVerdict = { criterion_id: "geo", result: "fail", reason: "Toronto HQ", evidence: [{ evidence_id: "reg_old", excerpt: "Toronto" }] };
  const reread: CriterionVerdict = { criterion_id: "geo", result: "pass", reason: "US", evidence: [{ evidence_id: "reg_old", excerpt: "US" }] };
  const fresh: CriterionVerdict = { ...reread, evidence: [{ evidence_id: "web_new", excerpt: "US" }] };
  const isNew = (id: string) => id.startsWith("web_");
  assertEquals(mergeCriterionVerdicts([fail], [reread], isNew)[0].result, "fail", "the same evidence read more generously");
  assertEquals(mergeCriterionVerdicts([fail], [fresh], isNew)[0].result, "pass", "new evidence may settle it");
  // A second look may always lower, and a row it does not repeat is kept.
  const other: CriterionVerdict = { criterion_id: "size", result: "pass", reason: "11-50", evidence: [{ evidence_id: "reg_s", excerpt: "11-50" }] };
  const merged = mergeCriterionVerdicts([other, fresh], [{ ...fresh, result: "unknown", evidence: [] }], isNew);
  assertEquals(merged.map((v) => [v.criterion_id, v.result]), [["geo", "unknown"], ["size", "pass"]]);
  // A re-evaluation without rows erases nothing.
  assertEquals(mergeCriterionVerdicts([fail], undefined, isNew), [fail]);
});

// ════════════════════════════════════════════════════════════════ resume ══

/** One company as the engine holds it after a slice decided it. */
function decided(over: Record<string, unknown> = {}) {
  return {
    key: "held.test", company: { company_name: "Held", domain: "held.test", website: "https://held.test" },
    yc_open_jobs: [], prequal_key: "held.test", prequalified: null, shortlisted: true, triage: null,
    investigation_state: "investigated", investigation_rank: 1, enriched: null, enrichment_outcome: null,
    identity: null, hiring_assessment: null, brain: null, fit: null, verdict: null, founders: [],
    verified_founders: [], contact_identities: [], completed_operations: [], mission_evaluation: null,
    ...over,
  } as never;
}
/** Writer → checkpoint → JSON (a jsonb column) → reader → restored working set. */
function resumed(companies: unknown[]) {
  const checkpoint = buildCheckpoint({
    now: 0, deadlineAt: 120_000, remainingMs: 10_000, lastCompletedCapability: "x", nextPendingCapability: "y",
    companies: (companies as never[]).map(toResumeRecord), reason: "execution_deadline_checkpoint",
  });
  return restoreWorkingSet(readCheckpointCompanies(JSON.parse(JSON.stringify({ [CHECKPOINT_RESULT_KEY]: checkpoint }))));
}

Deno.test("resume: the engine's own holds survive a checkpoint; the evaluator's are re-derived", () => {
  const before = [
    decided({ key: "fact.test", decision_source: "hard_constraint_rejection", fit: { reason: "staffing_or_aggregator" } }),
    decided({ key: "enrich.test", record: { stage_reason: "enrichment_evidence_missing:empty" } }),
    decided({ key: "eval.test", mission_evaluation: evaluation("not_qualified", HARD.map(pass)) }),
    decided({ key: "clear.test", mission_evaluation: evaluation("qualified", HARD.map(pass)) }),
  ];
  const codes = (cs: unknown[]): Record<string, string[]> => Object.fromEntries((cs as Array<{ key: string }>).map((c) =>
    [c.key, qualificationHoldsOf(c as never).map((h) => h.code as string)]));
  const want: Record<string, string[]> = { "fact.test": ["verified_fact_rejected"], "enrich.test": ["enrichment_evidence_missing"],
    "eval.test": ["evaluator_rejected"], "clear.test": [] };
  assertEquals(codes(before), want, "this slice's holds");
  // The fields the engine holds were read from are not in the checkpoint.
  const after = resumed(before);
  assertEquals(codes(after), want, "the resumed slice decides the same");
  // A slice that re-judges a company decides from what it derived itself.
  const rejudged = (after as unknown as Array<Record<string, unknown>>).map((c) => ({ ...c, evaluation_path: "model_evaluated" }));
  assertEquals(codes(rejudged)["fact.test"], [], "a fresh decision replaces a previous slice's engine hold");
  // An untrusted checkpoint cannot invent a hold code.
  assertEquals(restoredHolds([{ code: "evaluator_rejected_by_attacker", reason: "x" }, { code: "enrichment_evidence_missing", reason: 1 }]),
    [{ code: "enrichment_evidence_missing", reason: "1" }]);
});
