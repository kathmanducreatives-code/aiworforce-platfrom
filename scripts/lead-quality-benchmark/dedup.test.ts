// Tests 23–25: deduplication (distinct-but-similar names preserved).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assignDuplicateStatus } from "./evaluate.ts";
import { normalizeCandidate } from "./normalize.ts";
import { FIXTURE_AS_OF, FIXTURES } from "./fixtures.ts";
import type { RawCandidate } from "./types.ts";

function raw(over: Partial<RawCandidate>): RawCandidate {
  return {
    provider: "apify", actorKey: "apify_jobs", actorId: "a", actorRunId: "r", rawItemIndex: 1,
    sourceUrl: null, companyName: null, companyDomain: null, companyLinkedinUrl: null, jobTitle: "Sales Operations Manager",
    jobDescriptionExcerpt: "US SaaS revenue operations", jobLocation: "United States", jobPostingUrl: "https://x/1", jobObservedDate: "2026-07-10",
    personName: null, personTitle: null, personLinkedinUrl: null, statedCurrentCompany: null, rawLocation: null, rawMeta: {}, ...over,
  };
}

function statuses(raws: RawCandidate[]) {
  const normalized = raws.map((r) => normalizeCandidate(r, { asOf: FIXTURE_AS_OF }));
  const map = assignDuplicateStatus(normalized);
  return normalized.map((n) => map.get(n.candidateId));
}

Deno.test("23. a duplicate company (same domain) is flagged", () => {
  const s = statuses(FIXTURES.F12_duplicate_company.raws);
  assertEquals(s[0], "unique");
  assertEquals(s[1], "duplicate_account");
});

Deno.test("24. a duplicate person (same LinkedIn) is flagged", () => {
  const s = statuses(FIXTURES.F13_duplicate_person.raws);
  assertEquals(s[0], "unique");
  assertEquals(s[1], "duplicate_person");
});

Deno.test("25. distinct companies with similar names are NOT collapsed", () => {
  const s = statuses([
    raw({ rawItemIndex: 1, companyName: "Acme Inc", companyDomain: "acme-one.com", companyLinkedinUrl: "https://linkedin.com/company/acme-one" }),
    raw({ rawItemIndex: 2, companyName: "Acme LLC", companyDomain: "acme-two.com", companyLinkedinUrl: "https://linkedin.com/company/acme-two" }),
  ]);
  assertEquals(s[0], "unique");
  assertEquals(s[1], "unique");
});
