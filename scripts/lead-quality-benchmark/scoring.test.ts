// Tests 26–30: scoring rules (gates dominate; secondary can never override).

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeBenchmarkScore, computeSecondarySignals } from "./score.ts";
import { runHardGates } from "./hard-gates.ts";
import { normalizeCandidate } from "./normalize.ts";
import { evaluateFixture, FIXTURE_AS_OF, FIXTURES } from "./fixtures.ts";
import type { RankedEvaluation, RawCandidate } from "./types.ts";

function only(evals: RankedEvaluation[]) { return evals[0]; }
function scoreOf(key: keyof typeof FIXTURES, i = 0) {
  const n = normalizeCandidate(FIXTURES[key].raws[i], { asOf: FIXTURE_AS_OF });
  const g = runHardGates(n);
  return computeBenchmarkScore(g, computeSecondarySignals(n));
}
function raw(over: Partial<RawCandidate>): RawCandidate {
  return {
    provider: "apify", actorKey: "apify_jobs", actorId: "a", actorRunId: "r", rawItemIndex: 1,
    sourceUrl: null, companyName: "SaaSCo", companyDomain: "saasco.com", companyLinkedinUrl: null,
    jobTitle: "Sales Operations Manager", jobDescriptionExcerpt: "US SaaS revenue operations pipeline",
    jobLocation: "United States", jobPostingUrl: "https://boards.example.com/x/1", jobObservedDate: "2026-07-10",
    personName: null, personTitle: null, personLinkedinUrl: null, statedCurrentCompany: null, rawLocation: null, rawMeta: {}, ...over,
  };
}

Deno.test("26. a failed hard gate can never be CONTACT regardless of model score", () => {
  // F20 carries an Agentory score of 95 + decision 'contact', yet fails gates.
  const e = only(evaluateFixture(FIXTURES.F20_gate_fail_high_model_score));
  assertEquals(e.agentory?.score, 95);
  assertEquals(e.verdict, "REJECT");
  assert(e.inflationWarning);
});

Deno.test("27. employer match is required for CONTACT", () => {
  const e = only(evaluateFixture(FIXTURES.F10_founder_other_company));
  assert(e.verdict !== "CONTACT");
});

Deno.test("28. the hiring signal carries its full weight (25) only on pass", () => {
  const pass = scoreOf("F01_valid_us_saas_sales_ops");
  const fail = scoreOf("F03_generic_sales_role");
  assertEquals(pass.components.hiring_signal, 25);
  assertEquals(fail.components.hiring_signal, 0);
});

Deno.test("29. evidence quality affects the evidence component", () => {
  const strong = normalizeCandidate(raw({ jobPostingUrl: "https://boards.example.com/full/posting", jobObservedDate: "2026-07-10" }), { asOf: FIXTURE_AS_OF });
  const weak = normalizeCandidate(raw({ jobPostingUrl: "https://bit.ly/abc", jobObservedDate: null }), { asOf: FIXTURE_AS_OF });
  const sStrong = computeBenchmarkScore(runHardGates(strong), computeSecondarySignals(strong));
  const sWeak = computeBenchmarkScore(runHardGates(weak), computeSecondarySignals(weak));
  assert(sStrong.components.evidence > sWeak.components.evidence, `${sStrong.components.evidence} !> ${sWeak.components.evidence}`);
});

Deno.test("30. strong secondary ICP fit cannot override a failed hard gate", () => {
  // An agency with otherwise-attractive signals still REJECTs on company type.
  const e = only(evaluateFixture(FIXTURES.F17_agency_false_positive));
  assertEquals(e.verdict, "REJECT");
});
