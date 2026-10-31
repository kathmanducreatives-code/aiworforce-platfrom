// The provider benchmark scorer: identical rules for every provider, holds
// respected, nothing counted as qualified that the shared engine did not
// qualify. Synthetic cohort only; the real cohort file is checked for shape.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  scoreProvider, sendable, companyIdentity, identityKeys, type Cohort, type ProviderBenchmarkResult,
} from "../../../../supabase/functions/_shared/discoveryProviders/benchmark.ts";
import type { ProviderCompany, ProviderPerson } from "../../../../supabase/functions/_shared/discoveryProviders/types.ts";
import type { VerifiedLead } from "../../../../supabase/functions/_shared/discoveryProviders/verify.ts";

const NO_HOLD = { existing_lead_id: null, outreach_hold: false, crm_relationship: null };
const COHORT: Cohort = {
  version: "test",
  known_companies: [
    { slot: "A01", status: "selected", name: "Alpha", domain: "alpha.example", linkedin_url: "https://www.linkedin.com/company/alpha", truth_hq_country: "United States", suppression: NO_HOLD },
    { slot: "A02", status: "selected", name: "Beta", domain: "beta.example", linkedin_url: null, truth_hq_country: "Canada", suppression: NO_HOLD },
    { slot: "A03", status: "selected", name: "Gamma", domain: "gamma.example", linkedin_url: null, truth_hq_country: null, suppression: NO_HOLD },
    { slot: "A04", status: "selected", name: "Held", domain: "held.example", suppression: { ...NO_HOLD, outreach_hold: true } },
    { slot: "A05", status: "unfilled", unfilled_reason: "none" },
  ],
  known_decision_makers: [
    { slot: "B01", status: "selected", full_name: "Pat Doe", linkedin_url: "https://linkedin.com/in/patdoe", employer_domain: "alpha.example", role: "VP Sales", suppression: NO_HOLD },
    { slot: "B02", status: "selected", full_name: "Sam Roe", linkedin_url: "https://linkedin.com/in/samroe", employer_domain: "beta.example", role: "CEO", suppression: NO_HOLD },
    { slot: "B03", status: "selected", full_name: "Lee Poe", linkedin_url: "https://linkedin.com/in/leepoe", employer_domain: "gamma.example", role: "CTO", suppression: { ...NO_HOLD, existing_lead_id: "lead-9" } },
  ],
  discovery: { mission_query: "q", requested_count: 3 },
};

const co = (provider: "apollo" | "leadocean", id: string, domain: string, over: Partial<ProviderCompany> = {}): ProviderCompany =>
  ({ provider, recordId: id, retrievedAt: "t", name: id, domain, ...over });
const person = (li: string, domain: string, title: string, over: Partial<ProviderPerson> = {}): ProviderPerson =>
  ({ provider: "leadocean", recordId: li, retrievedAt: "t", linkedinUrl: `https://www.linkedin.com/in/${li}`, title, company: co("leadocean", `c-${domain}`, domain), ...over });
const lead = (domain: string, status: VerifiedLead["status"], providerStatus: VerifiedLead["status"] = status, phone = false, updatedAt: string | null = null) => ({
  status, providerStatus,
  checks: [{ criterionId: "geo", key: "geography_hq", label: "HQ", outcome: providerStatus === "qualified" ? "matched" : "provider_filter", evidence: [], note: "" }],
  company: { domain: [{ value: domain }], linkedinUrl: [], sources: [{ provider: "leadocean", recordId: domain, retrievedAt: "t", providerUpdatedAt: updatedAt, assertedFilters: [], ignoredFilters: [] }] },
  contacts: phone ? [{ person: { hasPhone: [{ value: true }], contactPoints: [] } }] : [],
} as unknown as VerifiedLead);

function result(provider: "apollo" | "leadocean", over: Partial<ProviderBenchmarkResult> = {}): ProviderBenchmarkResult {
  return { provider, companyMatches: {}, personMatches: {}, discoveryRows: [], discoveryLeads: [], timings: [], unitsConsumed: 0, unit: provider === "apollo" ? "credits" : "records", costUsd: null, ...over };
}

Deno.test("benchmark: a held, CRM-linked or existing-Lead slot is never sendable; an unfilled slot is never sent", () => {
  assertEquals(COHORT.known_companies.map(sendable), [true, true, true, false, false]);
  assertEquals(COHORT.known_decision_makers.map(sendable), [true, true, false]);
});

Deno.test("benchmark: company matching is exact identity — right, wrong company and miss are told apart", () => {
  const s = scoreProvider(COHORT, result("leadocean", {
    companyMatches: {
      A01: co("leadocean", "1", "other.example", { linkedinUrl: "https://linkedin.com/company/alpha/", hqCountry: "US" }),
      A02: co("leadocean", "2", "not-beta.example"),
      A03: null,
      A04: co("leadocean", "4", "held.example"),
    },
  }));
  // A01: same LinkedIn page, another domain — conflicting, neither right nor wrong. A02: wrong domain. A03: missed.
  assertEquals([s.companyMatching.numerator, s.companyMatching.denominator, s.companyMatching.wrong, s.companyMatching.missed, s.companyMatching.conflicting], [0, 3, 1, 1, 1]);
  // HQ is scored only where a canonical record PROVED the truth, and only on confirmed matches.
  assertEquals([s.headquartersVerification.numerator, s.headquartersVerification.denominator], [0, 0]);
  assertEquals(s.skippedForSuppression, ["A04", "B03"]);
});

Deno.test("benchmark: HQ disagreement and absence are counted, not hidden", () => {
  const s = scoreProvider(COHORT, result("apollo", {
    companyMatches: { A01: co("apollo", "1", "alpha.example", { hqCountry: null }), A02: co("apollo", "2", "beta.example", { hqCountry: "United States" }) },
  }));
  assertEquals([s.headquartersVerification.disagree, s.headquartersVerification.absent, s.headquartersVerification.value], [1, 1, 0]);
});

Deno.test("benchmark: a decision-maker counts only as the same person, at the same employer, in the role", () => {
  const s = scoreProvider(COHORT, result("leadocean", {
    personMatches: {
      B01: person("patdoe", "alpha.example", "Vice President, VP Sales"),
      B02: person("samroe", "moved.example", "CEO"),
    },
  }));
  assertEquals([s.decisionMakerAccuracy.numerator, s.decisionMakerAccuracy.denominator, s.decisionMakerAccuracy.wrongEmployer], [1, 2, 1]);
});

Deno.test("benchmark: only the shared engine's qualified count; known and other-provider companies are not unique", () => {
  const lo = result("leadocean", {
    discoveryRows: [co("leadocean", "x", "new1.example"), co("leadocean", "y", "new1.example"), co("leadocean", "z", "new2.example")],
    discoveryLeads: [lead("new1.example", "qualified"), lead("new2.example", "needs_verification", "qualified", true), lead("alpha.example", "qualified")],
    timings: [{ op: "search", ms: 300 }, { op: "search", ms: 100 }, { op: "search", ms: 200 }],
    unitsConsumed: 30, costUsd: 0.6,
  });
  const ap = result("apollo", { discoveryRows: [co("apollo", "a", "new1.example")], discoveryLeads: [lead("new1.example", "qualified")] });
  const s = scoreProvider(COHORT, lo, ap);
  assertEquals(s.uniqueQualified, { qualified: 2, uniqueToProvider: 0, alreadyKnown: 1, providerChecksOnly: 1 });
  assertEquals([s.duplicateRate.numerator, s.duplicateRate.denominator], [1, 3]);
  assertEquals(s.overlap, { with: "apollo", shared: 1, union: 2, jaccard: 0.5 });
  assertEquals([s.phoneCandidateCoverage.numerator, s.phoneCandidateCoverage.denominator], [1, 1]);
  assertEquals(s.verifiedDirectNumberCoverage.numerator, 0, "a provider-supplied phone is never independently verified");
  assertEquals([s.latencyMs.p50, s.latencyMs.p95, s.latencyMs.max], [200, 300, 300]);
  assertEquals(s.costPerQualified, { usd: 0.3, units: 15, unit: "records", qualified: 2 });
});

Deno.test("benchmark: one company known by LinkedIn and returned by domain (or the reverse) is still one company", () => {
  const both = { domain: "alpha.example", linkedinUrl: "https://www.linkedin.com/company/alpha" };
  assertEquals(identityKeys(both), ["li:alpha", "d:alpha.example"]);
  const lo = result("leadocean", {
    discoveryRows: [co("leadocean", "1", "alpha.example"), co("leadocean", "2", "", { domain: null, linkedinUrl: both.linkedinUrl }), co("leadocean", "3", "alpha.example", both)],
  });
  // Three rows: one by domain, one by LinkedIn, one bridging both → one company, two duplicates.
  assertEquals([scoreProvider(COHORT, lo).duplicateRate.numerator, scoreProvider(COHORT, lo).duplicateRate.denominator], [2, 3]);
});

Deno.test("benchmark: evidence quality counts returned values apart from filter-only answers; freshness reads the provider's stamp", () => {
  const s = scoreProvider(COHORT, result("leadocean", {
    discoveryLeads: [lead("a.example", "qualified", "qualified", false, "2026-10-20T00:00:00Z"), lead("b.example", "needs_verification", "needs_verification", false, "2026-07-02T00:00:00Z"), lead("c.example", "needs_verification")],
  }), null, "2026-10-30T00:00:00Z");
  assertEquals(s.evidenceQuality, { returnedValue: 1, filterOnly: 2, nothing: 0, share: 1 / 3 });
  assertEquals(s.freshnessDays, { stamped: 2, unstamped: 1, median: 10 });
});

Deno.test("benchmark: nothing qualified → cost per qualified result is null, never zero", () => {
  const s = scoreProvider(COHORT, result("apollo", { unitsConsumed: 5, costUsd: 1, discoveryLeads: [lead("n.example", "needs_verification", "qualified")] }));
  assertEquals(s.costPerQualified.usd, null);
  assertEquals(s.uniqueQualified.providerChecksOnly, 1);
});

Deno.test("benchmark: the committed cohort is 10/10/10, sourced read-only from TEST, and holds no contact values", async () => {
  const raw = await Deno.readTextFile(new URL("../../../../benchmarks/provider-discovery/cohort.json", import.meta.url));
  const c = JSON.parse(raw) as Cohort & { selection: { project: string } };
  assertEquals(c.known_companies.length, 10);
  assertEquals(c.known_decision_makers.length, 10);
  assertEquals(c.discovery.requested_count, 10);
  assert(c.selection.project.startsWith("tlvnfrxzjhsjgdofwehb"));
  assert(!/ohsdatpvfdjdemstoiuj/.test(raw), "never production");
  const noDates = raw.replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?/g, "");
  assert(!/@[a-z0-9-]+\.[a-z]/i.test(raw) && !/\+?\d[\d\s().-]{8,}\d/.test(noDates), "no email or phone values");
  for (const s of [...c.known_companies, ...c.known_decision_makers]) {
    assert(s.status === "unfilled" ? !!s.unfilled_reason : !!s.suppression, `${s.slot} states its suppression or why it is unfilled`);
  }
  assertEquals(new Set(c.known_companies.filter((s) => s.status === "selected").map((s) => companyIdentity(s))).size,
    c.known_companies.filter((s) => s.status === "selected").length, "no duplicate company in the cohort");
});
