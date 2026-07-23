// Tests 15–22: hard eligibility gates.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runHardGates } from "./hard-gates.ts";
import { normalizeCandidate } from "./normalize.ts";
import { evaluateFixture, FIXTURE_AS_OF, FIXTURES } from "./fixtures.ts";
import type { HardGateId, RankedEvaluation } from "./types.ts";

function gatesFor(fixtureKey: keyof typeof FIXTURES, itemIndex = 0) {
  const f = FIXTURES[fixtureKey];
  const n = normalizeCandidate(f.raws[itemIndex], { asOf: FIXTURE_AS_OF });
  return runHardGates(n);
}
function outcome(fixtureKey: keyof typeof FIXTURES, id: HardGateId, itemIndex = 0) {
  return gatesFor(fixtureKey, itemIndex).gates.find((g) => g.id === id)!;
}
function only(evals: RankedEvaluation[]) {
  return evals[0];
}

Deno.test("15. a valid SaaS company passes the company-type gate", () => {
  assertEquals(outcome("F01_valid_us_saas_sales_ops", "company_type").outcome, "pass");
});

Deno.test("16. an agency/consultancy fails the company-type gate", () => {
  const g = outcome("F17_agency_false_positive", "company_type");
  assertEquals(g.outcome, "fail");
  assertEquals(g.reasonCode, "not_saas");
});

Deno.test("17. an irrelevant operations role fails the hiring gate", () => {
  assertEquals(outcome("F04_manufacturing_ops", "hiring_signal").outcome, "fail");
  assertEquals(outcome("F05_marketing_ops_no_revenue", "hiring_signal").reasonCode, "hiring_role_mismatch");
});

Deno.test("18. a non-US role fails the US gate", () => {
  assertEquals(outcome("F06_non_us_only", "us_relevance").outcome, "fail");
  assertEquals(outcome("F07_remote_excludes_us", "us_relevance").outcome, "fail");
});

Deno.test("19. a current founder passes founder + employer gates", () => {
  assertEquals(outcome("F08_valid_founder_current", "founder_role").outcome, "pass");
  assertEquals(outcome("F08_valid_founder_current", "employer_match").outcome, "pass");
});

Deno.test("20. a former founder fails the founder gate", () => {
  const g = outcome("F09_former_founder", "founder_role");
  assertEquals(g.outcome, "fail");
  assertEquals(g.reasonCode, "founder_role_invalid");
});

Deno.test("21. an off-company founder fails the employer gate", () => {
  const g = outcome("F10_founder_other_company", "employer_match");
  assertEquals(g.outcome, "fail");
  assertEquals(g.reasonCode, "current_employer_mismatch");
});

Deno.test("22. missing evidence cannot be CONTACT", () => {
  assertEquals(outcome("F14_missing_evidence", "evidence").outcome, "fail");
  const e = only(evaluateFixture(FIXTURES.F14_missing_evidence));
  assert(e.verdict !== "CONTACT");
});
