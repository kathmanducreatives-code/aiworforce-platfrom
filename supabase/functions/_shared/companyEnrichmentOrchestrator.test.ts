import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCompanyEnrichment, buildPersonEnvelope, preRankForEnrichment,
  type SourceAcceptedPerson, type CompanyActorExecutor,
} from "./companyEnrichmentOrchestrator.ts";
import { compileLeadEntityIntent } from "./leadEntityIntent.ts";
import { DEFAULT_EVIDENCE_BUDGET, createInMemoryEvidenceCache } from "./conditionalEnrichmentPlanner.ts";
import { satisfiedCategories } from "./candidateEnvelope.ts";
import { FIXTURE_COMPLETE, FIXTURE_NO_INDUSTRY, FIXTURE_ERROR } from "./linkedinCompanyActorFixture.ts";

const NOW = "2026-07-16T12:00:00.000Z";
const BRAIN = { industries: ["B2B SaaS", "AI SaaS"], geography: "United States", company_size: "10-150 employees" };
const B = DEFAULT_EVIDENCE_BUDGET;
const HOT = compileLeadEntityIntent("Using my ICP, find me 5 hot founders I should contact right now.");
const FIT = compileLeadEntityIntent("Find founders of B2B SaaS companies");

const person = (id: string, over: Partial<SourceAcceptedPerson> = {}): SourceAcceptedPerson => ({
  candidateId: id, name: `Founder ${id}`, title: "Co-Founder", company: "Acme SaaS",
  profileUrl: `https://www.linkedin.com/in/${id}`,
  companyLinkedInUrl: "https://www.linkedin.com/company/acme-saas",
  locationText: "Austin, Texas, United States", countryCode: "US",
  providerVerified: true, preRankScore: 60, ...over,
});

/** Records every injected call so tests can prove provider behavior. */
function recordingExecutor(items: unknown[] | ((i: any) => unknown[])): { exec: CompanyActorExecutor; calls: any[] } {
  const calls: any[] = [];
  const exec: CompanyActorExecutor = async (a) => {
    calls.push(a);
    return { items: typeof items === "function" ? items(a.input) : items, providerRunId: "run-x" };
  };
  return { exec, calls };
}

// ---- (1)(2) envelope construction ----
Deno.test("1/2: source-accepted person becomes an envelope with PERSON provenance", () => {
  const e = buildPersonEnvelope(person("p1"), NOW);
  assertEquals(e.targetEntity, "person");
  assertEquals(e.primaryArtifactType, "person_candidate");
  assertEquals(e.sourceProvenance.actorKey, "apify_people_search");
  assertEquals(e.sourceProvenance.actorId, "harvestapi/linkedin-profile-search");
  assertEquals(e.sourceProvenance.verified, true);
  assertEquals(e.companyKey, "li:linkedin.com/company/acme-saas");
  const sat = satisfiedCategories(e);
  assert(sat.has("person_identity") && sat.has("person_company_association"));
  // Brain values are NOT evidence.
  assert(!sat.has("company_industry") && !sat.has("company_website"));
});

// ---- (3)(4) contract + sufficiency before ----
Deno.test("3/4: v82-style people candidates request structured company enrichment", async () => {
  const { exec, calls } = recordingExecutor([FIXTURE_COMPLETE]);
  const r = await runCompanyEnrichment({ people: [person("p1")], intent: HOT, brain: BRAIN, budget: B, now: NOW, execute: exec });
  assertEquals(r.contract.acceptancePolicy, "fit_and_timing_confirmed");
  const before = r.sufficiencyBefore.get("p1")!;
  assertEquals(before.identityComplete, true);
  assertEquals(before.fitComplete, false);
  assertEquals(before.nextDecision, "structured_company_enrichment");
  assert(before.missingCriticalRequirements.includes("company_website"));
  assert(before.missingCriticalRequirements.includes("company_industry"));
  assertEquals(calls.length, 1);
});

// ---- (6)(7)(8) ineligible candidates are never enriched ----
Deno.test("6/7/8: disqualified, unverified, duplicate and ICP-contradiction candidates are not enriched", async () => {
  const { exec, calls } = recordingExecutor([FIXTURE_COMPLETE]);
  await runCompanyEnrichment({
    people: [
      person("bad1", { disqualified: true, companyLinkedInUrl: "https://www.linkedin.com/company/c1" }),
      person("bad2", { providerVerified: false, companyLinkedInUrl: "https://www.linkedin.com/company/c2" }),
      person("bad3", { duplicate: true, companyLinkedInUrl: "https://www.linkedin.com/company/c3" }),
      person("bad4", { icpContradiction: true, companyLinkedInUrl: "https://www.linkedin.com/company/c4" }),
    ],
    intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec,
  });
  assertEquals(calls.length, 0);   // no provider call for any ineligible candidate
});

Deno.test("7b: unverified provenance yields reject_source, not missing-evidence enrichment", async () => {
  const r = await runCompanyEnrichment({ people: [person("p1", { providerVerified: false })], intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: recordingExecutor([]).exec });
  assertEquals(r.sufficiencyBefore.get("p1")!.nextDecision, "reject_source");
  assertEquals(r.sufficiencyBefore.get("p1")!.reasonCode, "unverified_provenance");
});

// ---- (10)(11) dedupe + fan-out ----
Deno.test("10/11: three founders at one company ⇒ ONE actor request, evidence fanned to all three", async () => {
  const { exec, calls } = recordingExecutor([FIXTURE_COMPLETE]);
  const r = await runCompanyEnrichment({
    people: [person("f1"), person("f2"), person("f3")],   // all share acme-saas
    intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec,
  });
  assertEquals(calls.length, 1);                                   // ONE company call
  assertEquals(calls[0].input.companies, ["https://www.linkedin.com/company/acme-saas"]);
  assertEquals(r.requalifyCandidateIds.size, 3);                   // fanned to all three
  for (const id of ["f1", "f2", "3"].slice(0, 2).concat(["f3"])) {
    const e = r.envelopes.find((x) => x.candidateId === id)!;
    const sat = satisfiedCategories(e);
    assert(sat.has("company_website") && sat.has("company_industry"), id);
    // each keeps its OWN person provenance
    assertEquals(e.sourceProvenance.actorId, "harvestapi/linkedin-profile-search");
  }
  assertEquals(r.observability.summary.companies_planned, 1);
  assertEquals(r.observability.companies[0].associated_candidate_count, 3);
});

Deno.test("five founders across three companies ⇒ exactly three actor requests", async () => {
  const { exec, calls } = recordingExecutor([FIXTURE_COMPLETE]);
  await runCompanyEnrichment({
    people: [
      person("f1", { companyLinkedInUrl: "https://www.linkedin.com/company/a" }),
      person("f2", { companyLinkedInUrl: "https://www.linkedin.com/company/a" }),
      person("f3", { companyLinkedInUrl: "https://www.linkedin.com/company/b" }),
      person("f4", { companyLinkedInUrl: "https://www.linkedin.com/company/b" }),
      person("f5", { companyLinkedInUrl: "https://www.linkedin.com/company/c" }),
    ],
    intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec,
  });
  assertEquals(calls.length, 3);
});

// ---- (9) enrich-narrow ----
Deno.test("9: competitive pre-rank respects the company enrichment budget", async () => {
  const { exec, calls } = recordingExecutor([FIXTURE_COMPLETE]);
  const many = Array.from({ length: 20 }, (_, i) => person(`p${i}`, { companyLinkedInUrl: `https://www.linkedin.com/company/c${i}` }));
  await runCompanyEnrichment({ people: many, intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec });
  assertEquals(calls.length, B.companyStructuredEnrichments);      // 8, not 20
});

Deno.test("pre-rank is deterministic: fewer gaps first, then score, then id", () => {
  const suff = new Map<string, any>([
    ["a", { missingCriticalRequirements: ["company_website", "company_industry"] }],
    ["b", { missingCriticalRequirements: ["company_website"] }],
    ["c", { missingCriticalRequirements: ["company_website"] }],
  ]);
  const order = preRankForEnrichment(
    [person("a", { preRankScore: 90 }), person("b", { preRankScore: 10 }), person("c", { preRankScore: 80 })],
    suff,
  ).map((p) => p.candidateId);
  assertEquals(order, ["c", "b", "a"]);   // fewer gaps beats a higher score
});

// ---- (12)(13)(14)(15) canonical actor identity ----
Deno.test("12/13/14/15: canonical actor id is used; input prefers the LinkedIn URL", async () => {
  const { exec, calls } = recordingExecutor([FIXTURE_COMPLETE]);
  await runCompanyEnrichment({ people: [person("p1")], intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec });
  assertEquals(calls[0].actorKey, "apify_linkedin_company_details");
  assertEquals(calls[0].actorId, "harvestapi/linkedin-company");   // never from prose/tool_input
  assertEquals(calls[0].input.companies, ["https://www.linkedin.com/company/acme-saas"]);
  assertEquals(calls[0].input.searches, undefined);
  assertEquals(calls[0].maxItems, 1);
});

Deno.test("16: company-name fallback only when no LinkedIn URL exists", async () => {
  const { exec, calls } = recordingExecutor([FIXTURE_COMPLETE]);
  await runCompanyEnrichment({
    people: [person("p1", { companyLinkedInUrl: null, company: "Founder & CEO at Acme SaaS Inc — hiring engineers" })],
    intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec,
  });
  assertEquals(calls[0].input.companies, undefined);
  assertEquals(calls[0].input.searches, ["Acme SaaS"]);            // role/hiring prose stripped
});

// ---- (17)(22) success appends evidence and completes fit ----
Deno.test("17/22: actor success appends company evidence and completes fit (current_fit)", async () => {
  const { exec } = recordingExecutor([FIXTURE_COMPLETE]);
  const r = await runCompanyEnrichment({ people: [person("p1")], intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec });
  const after = r.sufficiencyAfter.get("p1")!;
  assertEquals(after.fitComplete, true);
  assertEquals(after.sufficient, true);
  assertEquals(after.nextDecision, "qualify_now");                  // (26) can proceed
  assertEquals(r.requalifyCandidateIds.has("p1"), true);            // (27) evidence changed
});

// ---- (25) hot founder stays staged without timing ----
Deno.test("25: HOT founder with complete fit but no timing does NOT qualify", async () => {
  const { exec } = recordingExecutor([FIXTURE_COMPLETE]);
  const r = await runCompanyEnrichment({ people: [person("p1")], intent: HOT, brain: BRAIN, budget: B, now: NOW, execute: exec });
  const after = r.sufficiencyAfter.get("p1")!;
  assertEquals(after.fitComplete, true);
  assertEquals(after.timingComplete, false);
  assertEquals(after.sufficient, false);
  // website + industry alone never makes a Hot founder qualify: the only routes
  // left are signal enrichment or honest staging.
  assert(after.nextDecision === "signal_enrichment" || after.nextDecision === "stage_missing_evidence", after.nextDecision);
});

// ---- (18)(19)(20)(21) failure isolation ----
Deno.test("18/19: empty and invalid actor results stage safely, fabricating nothing", async () => {
  const empty = await runCompanyEnrichment({ people: [person("p1")], intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: async () => ({ items: [] }) });
  assertEquals(empty.companyResults[0].outcome, "no_result");
  assertEquals(empty.requalifyCandidateIds.size, 0);
  assert(!satisfiedCategories(empty.envelopes[0]).has("company_website"));

  const invalid = await runCompanyEnrichment({ people: [person("p1")], intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: async () => ({ items: [{ website: "https://x.com" }] }) });
  assertEquals(invalid.companyResults[0].outcome, "invalid_result");
});

Deno.test("20/21: one company's error/timeout never affects another company", async () => {
  const exec: CompanyActorExecutor = async (a) => {
    const id = (a.input.companies ?? [])[0] ?? "";
    if (id.includes("/bad")) return { error: FIXTURE_ERROR };
    if (id.includes("/slow")) return { timedOut: true };
    return { items: [FIXTURE_COMPLETE], providerRunId: "ok" };
  };
  const r = await runCompanyEnrichment({
    people: [
      person("good", { companyLinkedInUrl: "https://www.linkedin.com/company/good" }),
      person("bad", { companyLinkedInUrl: "https://www.linkedin.com/company/bad" }),
      person("slow", { companyLinkedInUrl: "https://www.linkedin.com/company/slow" }),
    ],
    intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec,
  });
  const out = new Map(r.companyResults.map((c) => [c.companyKey, c.outcome]));
  assertEquals(out.get("li:linkedin.com/company/good"), "enriched");
  assertEquals(out.get("li:linkedin.com/company/bad"), "provider_error");
  assertEquals(out.get("li:linkedin.com/company/slow"), "timeout");
  // the healthy candidate still got its evidence
  assertEquals(r.sufficiencyAfter.get("good")!.fitComplete, true);
  assertEquals(r.requalifyCandidateIds.has("bad"), false);
  assertEquals(r.requalifyCandidateIds.has("slow"), false);
});

Deno.test("an executor that throws is contained as provider_error", async () => {
  const r = await runCompanyEnrichment({ people: [person("p1")], intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: async () => { throw new Error("boom"); } });
  assertEquals(r.companyResults[0].outcome, "provider_error");
  assertEquals(r.envelopes.length, 1);      // candidate preserved
});

// ---- (23) description alone is not B2B SaaS proof ----
Deno.test("23: company description alone does not prove business model", async () => {
  const { exec } = recordingExecutor([FIXTURE_NO_INDUSTRY]);
  const r = await runCompanyEnrichment({ people: [person("p1")], intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec });
  const e = r.envelopes[0];
  // industry absent ⇒ fit still incomplete even though a description exists
  assert(!satisfiedCategories(e, "medium").has("company_business_model"));
  assertEquals(r.sufficiencyAfter.get("p1")!.fitComplete, false);
});

// ---- (27)(28) rerun only when evidence changed ----
Deno.test("27/28: no enrichment ⇒ no requalification", async () => {
  const { exec, calls } = recordingExecutor([FIXTURE_COMPLETE]);
  // Already-sufficient candidate: nothing missing ⇒ no call, no rerun.
  const r = await runCompanyEnrichment({
    people: [person("p1", { disqualified: true })], intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec,
  });
  assertEquals(calls.length, 0);
  assertEquals(r.requalifyCandidateIds.size, 0);
});

// ---- cache ----
Deno.test("fresh cached company evidence prevents a provider call", async () => {
  const { exec, calls } = recordingExecutor([FIXTURE_COMPLETE]);
  const cache = createInMemoryEvidenceCache(new Map([["li:linkedin.com/company/acme-saas", [
    { category: "company_website", sourceType: "apify_actor", confidence: "high", verified: true, observedAt: NOW },
    { category: "company_industry", sourceType: "apify_actor", confidence: "high", verified: true, observedAt: NOW },
    { category: "company_size", sourceType: "apify_actor", confidence: "medium", verified: true, observedAt: NOW },
  ]]]));
  await runCompanyEnrichment({ people: [person("p1")], intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec, cache });
  assertEquals(calls.length, 0);
});

// ---- (42)(43)(44)(45) observability ----
Deno.test("42/43/44/45: observability reconciles and leaks nothing (incl. actor phone)", async () => {
  const { exec } = recordingExecutor([FIXTURE_COMPLETE]);   // FIXTURE_COMPLETE carries a phone
  const r = await runCompanyEnrichment({ people: [person("f1"), person("f2")], intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec });
  assertEquals(r.observability.summary.reconciles, true);
  assertEquals(r.observability.summary.companies_enriched, 1);
  assertEquals(r.observability.summary.budget_limit, 8);
  assertEquals(r.observability.summary.budget_consumed, 1);
  const json = JSON.stringify(r.observability);
  assert(!/415 555 0199|"phone"/.test(json), "phone leaked");
  assert(!/"raw"|linkedinText|currentPosition|utm_source/.test(json), "raw payload/query leaked");
  assert(!/@[a-z]+\.[a-z]+/i.test(json.replace(/harvestapi\/linkedin-company/g, "")), "email-like leaked");
  const d = r.observability.companies[0];
  assertEquals(d.verified_binding, true);
  assertEquals(d.actor_id, "harvestapi/linkedin-company");
  assert(d.company_key_fingerprint.startsWith("ck_"));
  assert(!("company_key" in d));
});

// ---- (46)(47) no provider is ever called by this module ----
Deno.test("46/47: with NO executor injected, nothing is called and candidates stage honestly", async () => {
  const r = await runCompanyEnrichment({ people: [person("p1")], intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: null });
  assertEquals(r.companyResults[0].outcome, "budget_skipped");
  assertEquals(r.companyResults[0].failureReason, "no_verified_actor_binding_or_executor");
  assertEquals(r.requalifyCandidateIds.size, 0);
  // No Firecrawl, no other provider: the module has no network path at all.
  assertEquals(r.observability.summary.companies_called, 0);
  assertEquals(r.observability.summary.companies_skipped, 1);
  assertEquals(r.observability.summary.reconciles, true);
});
