// Tests 10–14: deterministic normalization (raw values preserved).

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canonicalLinkedinUrl, classifyJobFamily, normalizeCandidate } from "./normalize.ts";
import { FIXTURE_AS_OF, FIXTURES } from "./fixtures.ts";
import type { RawCandidate } from "./types.ts";

function raw(over: Partial<RawCandidate>): RawCandidate {
  return {
    provider: "apify", actorKey: "apify_jobs", actorId: "a", actorRunId: "r", rawItemIndex: 1,
    sourceUrl: null, companyName: null, companyDomain: null, companyLinkedinUrl: null, jobTitle: null,
    jobDescriptionExcerpt: null, jobLocation: null, jobPostingUrl: null, jobObservedDate: null,
    personName: null, personTitle: null, personLinkedinUrl: null, statedCurrentCompany: null,
    rawLocation: null, rawMeta: {}, ...over,
  };
}

Deno.test("10. domains are canonicalized", () => {
  const n = normalizeCandidate(raw({ companyDomain: "https://www.BigID.com/careers?x=1" }), { asOf: FIXTURE_AS_OF });
  assertEquals(n.canonicalDomain, "bigid.com");
});

Deno.test("11. LinkedIn URLs are canonicalized", () => {
  assertEquals(canonicalLinkedinUrl("https://www.linkedin.com/company/BigID/?trk=abc"), "linkedin.com/company/bigid");
  assertEquals(canonicalLinkedinUrl("http://LinkedIn.com/in/Jane-Doe/"), "linkedin.com/in/jane-doe");
  assertEquals(canonicalLinkedinUrl("https://example.com/x"), null);
});

Deno.test("12. job titles/families are normalized", () => {
  assertEquals(classifyJobFamily("Sales Strategy and Operations Lead", null).family, "sales_ops");
  assertEquals(classifyJobFamily("Revenue Operations Manager", null).family, "rev_ops");
  assert(classifyJobFamily("Account Executive", null).qualifiesAsSalesOps === false);
  const n = normalizeCandidate(raw({ jobTitle: "  Sales   OPERATIONS  Manager " }), { asOf: FIXTURE_AS_OF });
  assertEquals(n.normalizedJobTitle, "sales operations manager");
});

Deno.test("13. locations/countries are normalized", () => {
  const us = normalizeCandidate(raw({ jobLocation: "New York, United States" }), { asOf: FIXTURE_AS_OF });
  assertEquals(us.normalizedCountry, "US");
  const uk = normalizeCandidate(raw({ jobLocation: "London, United Kingdom" }), { asOf: FIXTURE_AS_OF });
  assert(uk.normalizedCountry !== "US");
});

Deno.test("14. raw values are preserved untouched", () => {
  const original = FIXTURES.F01_valid_us_saas_sales_ops.raws[0];
  const n = normalizeCandidate(original, { asOf: FIXTURE_AS_OF });
  // The raw object is carried through unchanged.
  assertEquals(n.raw.companyName, "BigID");
  assertEquals(n.raw.jobTitle, "Sales Strategy and Operations Lead");
  assertEquals(n.raw, original);
});
