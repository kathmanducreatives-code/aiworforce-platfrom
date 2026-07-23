// Tests 36–39: why-now grounding audit.

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { auditWhyNow } from "./why-now-audit.ts";
import { normalizeCandidate } from "./normalize.ts";
import { evaluateFixture, FIXTURE_AS_OF, FIXTURES } from "./fixtures.ts";
import { evaluationReasonCodes } from "./evaluate.ts";
import type { RankedEvaluation } from "./types.ts";

const bigid = normalizeCandidate(FIXTURES.F01_valid_us_saas_sales_ops.raws[0], { asOf: FIXTURE_AS_OF });
const only = (evals: RankedEvaluation[]) => evals[0];

Deno.test("36. an evidence-backed why-now statement passes", () => {
  const a = auditWhyNow("BigID is hiring a Sales Strategy and Operations lead for its US revenue team, suggesting it is formalizing GTM operations.", bigid);
  assert(a.supported);
  assert(a.namesSignal);
  assert(a.companySpecific);
  assertFalse(a.inventsFacts);
});

Deno.test("37. an unsupported expansion/urgency claim fails", () => {
  const a = auditWhyNow("They are scaling fast and probably need more pipeline.", bigid);
  assertFalse(a.supported);
  assert(a.inventsFacts);
  assert(a.unsupportedClauses.length > 0);
});

Deno.test("38. a stale source is labelled and downgrades the verdict", () => {
  const e = only(evaluateFixture(FIXTURES.F15_stale_posting));
  assertEquals(e.verdict, "WATCH"); // gates pass but the signal is stale → not CONTACT
  assert(evaluationReasonCodes(e).includes("stale_hiring_signal"));
});

Deno.test("39. fact and inference are distinguished", () => {
  const inferred = auditWhyNow("BigID posted a Sales Operations role, suggesting it is building GTM operations.", bigid);
  assert(inferred.distinguishesInference);
  const invented = auditWhyNow("BigID just raised a Series C.", bigid);
  assert(invented.inventsFacts);
});
