// A COMPANY P4 QUALIFIES MUST BE COUNTED BY THE ONE AUTHORITATIVE COUNT.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage e5d4fc14, 2026-09-05. P4 read Metaview's own pricing page, resolved
// the last open requirement, and persisted:
//
//   decision            : qualified
//   mission_fit         : pass
//   matched_requirements: 5, every one `verified`
//   unknown_fields      : 0
//   match_score         : 95
//
// The run reported ZERO qualified companies and delivered nothing.
//
// The write-back set `mission_evaluation` and stopped. `c.verdict` derives from
// `c.brain.outcome`; `state.qualified_company_keys` derives from `c.verdict`;
// and `qualifiedIn()` — quota logic, delivery, the final result, persistence —
// reads that array. None were touched, so a company the system had PROVED was a
// match could not be counted or returned.
//
// The invariant: if P4 persists `decision: qualified`, that company appears in
// the authoritative count. One truth source — the engine re-judges with the
// inputs it originally judged with, and rebuilds the array from the same
// expression the qualification loop uses.
//
// ZERO network, ZERO models, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  reapplyMissionEvaluation,
} from "../../supabase/functions/_shared/leadCapabilityEngine.ts";
import type { MissionEvaluation } from "../../supabase/functions/_shared/missionEvaluation.ts";

const evaluation = (over: Partial<MissionEvaluation> = {}): MissionEvaluation =>
  ({
    version: "mission-evaluation-v1",
    decision: "qualified",
    mission_fit: "pass",
    icp_fit: "strong",
    hiring_fit: "verified",
    confidence: 0.95,
    match_score: 95,
    matched_requirements: [
      { requirement: "20–200 employees", evidence_id: "e1", excerpt: "131 employees" },
      { requirement: "in the UK", evidence_id: "e2", excerpt: "London, United Kingdom" },
      { requirement: "hiring sales", evidence_id: "e3", excerpt: "Account Executive" },
    ],
    failed_requirements: [],
    reasoning: "meets every stated requirement",
    rejection_reasons: [],
    evidence_quality: "strong",
    unknown_fields: [],
    next_action: null,
    ...over,
  }) as unknown as MissionEvaluation;

/** A company as the engine leaves it: judged once, inputs captured. */
const company = (key: string, over: Record<string, unknown> = {}) =>
  ({
    key,
    company: { company_name: key },
    fit: { missing_evidence: [] },
    enrichment_outcome: "success",
    verdict: "unknown",
    decision_source: "insufficient_evidence",
    mission_evaluation: evaluation({ decision: "insufficient_evidence", mission_fit: "review" }),
    brain: { outcome: "REVIEW", reason: "one requirement open" },
    brain_inputs: {
      gates: { identity_status: "verified_match", active: true, geography: "United Kingdom",
        required_geography: null, employee_count: 131, employee_min: 20, employee_max: 200 },
      policy: {},
      hiring_verified: true,
      grounding: null,
      enrichment_planned: true,
    },
    ...over,
  }) as never;

const run = (companies: unknown[]) => ({
  companies: companies as never,
  state: {
    qualified_company_keys: [] as string[],
    unknown_company_keys: [] as string[],
  } as never,
});

Deno.test("THE RUN: a P4-qualified company enters the authoritative count", () => {
  const r = run([company("metaview")]);
  const out = reapplyMissionEvaluation(r as never, [
    { company_key: "metaview", evaluation: evaluation() },
  ]);

  assertEquals(out.reapplied, 1);
  assertEquals(
    (r.state as unknown as { qualified_company_keys: string[] }).qualified_company_keys,
    ["metaview"],
    "P4 proved this company qualified; qualifiedIn() reads this array, and an " +
      "empty array is how lineage e5d4fc14 delivered nothing",
  );
  assertEquals(out.qualified_added, ["metaview"]);
});

Deno.test("a first-pass qualified company stays counted", () => {
  // The pre-existing path must not regress: a company the engine already
  // qualified is still in the array after any reapply.
  const r = run([
    company("already", { verdict: "pass", decision_source: "gpt_evaluation" }),
    company("metaview"),
  ]);
  reapplyMissionEvaluation(r as never, [
    { company_key: "metaview", evaluation: evaluation() },
  ]);
  const keys = (r.state as unknown as { qualified_company_keys: string[] }).qualified_company_keys;
  assert(keys.includes("already"), "a first-pass qualification must survive");
  assert(keys.includes("metaview"), "and the P4 one must join it");
  assertEquals(keys.length, 2);
});

Deno.test("insufficient_evidence → P4 qualified → counted", () => {
  // The full transition, which is the whole point of P4.
  const c = company("metaview");
  const r = run([c]);
  assertEquals(
    (r.state as unknown as { qualified_company_keys: string[] }).qualified_company_keys.length,
    0,
    "starts uncounted",
  );
  reapplyMissionEvaluation(r as never, [
    { company_key: "metaview", evaluation: evaluation() },
  ]);
  assertEquals(
    (r.state as unknown as { qualified_company_keys: string[] }).qualified_company_keys,
    ["metaview"],
  );
  assertEquals((c as unknown as { verdict: string }).verdict, "pass");
});

Deno.test("P4 STILL insufficient → NOT counted", () => {
  // Counting must follow the evidence, not the fact that P4 ran. A second look
  // that settles nothing changes nothing.
  const r = run([company("pump")]);
  reapplyMissionEvaluation(r as never, [
    {
      company_key: "pump",
      evaluation: evaluation({
        decision: "insufficient_evidence",
        mission_fit: "review",
        unknown_fields: ["Whether Pump.co sells to businesses"],
      }),
    },
  ]);
  assertEquals(
    (r.state as unknown as { qualified_company_keys: string[] }).qualified_company_keys,
    [],
    "an unresolved requirement is not a qualification",
  );
});

Deno.test("duplicate reapplication counts the company ONCE", () => {
  // The array is rebuilt from scratch rather than appended to, so a resumed
  // slice that reapplies the same verdict cannot double-count.
  const r = run([company("metaview")]);
  for (let i = 0; i < 3; i++) {
    reapplyMissionEvaluation(r as never, [
      { company_key: "metaview", evaluation: evaluation() },
    ]);
  }
  assertEquals(
    (r.state as unknown as { qualified_company_keys: string[] }).qualified_company_keys,
    ["metaview"],
    "three reapplications, one company",
  );
});

Deno.test("the enrichment precondition still holds against P4", () => {
  // The first pass HOLDS a company whose planned enrichment produced no
  // evidence, however good the model's reading. P4 must not be a way around it.
  const r = run([company("noevidence", { enrichment_outcome: "empty" })]);
  reapplyMissionEvaluation(r as never, [
    { company_key: "noevidence", evaluation: evaluation() },
  ]);
  assertEquals(
    (r.state as unknown as { qualified_company_keys: string[] }).qualified_company_keys,
    [],
    "enrichment was planned and returned nothing — that is a hold, not a pass",
  );
});

Deno.test("a company never judged by the Brain is left alone, not invented", () => {
  // No captured inputs means this company was never judged in this run. Leaving
  // the verdict alone is the honest outcome — better uncounted than counted by
  // a rule we had to make up.
  const r = run([company("unjudged", { brain_inputs: null })]);
  const out = reapplyMissionEvaluation(r as never, [
    { company_key: "unjudged", evaluation: evaluation() },
  ]);
  assertEquals(out.reapplied, 1, "the evaluation is still recorded");
  assertEquals(
    (r.state as unknown as { qualified_company_keys: string[] }).qualified_company_keys,
    [],
    "but no verdict is invented for it",
  );
});
