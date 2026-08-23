import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadEntityIntent } from "../../../supabase/functions/_shared/leadEntityIntent.ts";
import { compileEvidenceContract } from "../../../supabase/functions/_shared/evidenceContract.ts";
import { evaluateEvidenceSufficiency } from "../../../supabase/functions/_shared/evidenceSufficiency.ts";
import {
  planCandidateEnrichment, dedupeCompanyEnrichment, DEFAULT_EVIDENCE_BUDGET,
  emptyLedger, createInMemoryEvidenceCache,
  enforcesUnlockGatedWebResearch, FORBIDDEN_AUTOMATIC_ACTIONS,
} from "../../../supabase/functions/_shared/conditionalEnrichmentPlanner.ts";
import { appendEvidence, companyKeyFor, satisfiedCategories, type CandidateEnvelope, type EvidenceItem } from "../../../supabase/functions/_shared/candidateEnvelope.ts";
import { ACTOR_CAPABILITIES, isCallable, getActorCapability, unverifiedCapabilities } from "../../../supabase/functions/_shared/actorCapabilityRegistry.ts";

const NOW = "2026-07-16T12:00:00.000Z";
const RECENT = "2026-07-16T06:00:00.000Z";   // 6h ago
const STALE = "2026-05-01T00:00:00.000Z";    // ~2.5 months ago
const BRAIN = { industries: ["B2B SaaS", "AI SaaS"], geography: "United States", company_size: "10-150 employees" };

const ev = (category: any, over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  category, sourceType: "apify_actor", confidence: "medium", verified: true,
  observedAt: RECENT, actorKey: "apify_people_search", ...over,
});

function personEnvelope(evidence: EvidenceItem[], over: Partial<CandidateEnvelope> = {}): CandidateEnvelope {
  return {
    candidateId: "nc_person_1", targetEntity: "person", primaryArtifactType: "person_candidate",
    person: { fullName: "Jane Founder", title: "Founder", companyName: "Acme SaaS", profileUrl: "https://www.linkedin.com/in/jane" },
    evidence, companyKey: "dom:acme.com",
    sourceProvenance: { provider: "apify", actorKey: "apify_people_search", actorId: "harvestapi/linkedin-profile-search", verified: true },
    ...over,
  };
}

// ============ (3)(4)(5) contract compilation ============
Deno.test("3: person query compiles a person evidence contract", () => {
  const c = compileEvidenceContract(compileLeadEntityIntent("Find founders of B2B SaaS companies"), BRAIN);
  assertEquals(c.targetEntity, "person");
  assertEquals(c.freshness, "current_fit");
  assert(c.identityRequirements.some((r) => r.category === "person_identity" && r.required));
  assert(c.fitRequirements.some((r) => r.category === "company_industry" && r.required));
  assertEquals(c.timingRequirements.length, 0);       // timing optional for current_fit
  assertEquals(c.acceptancePolicy, "fit_confirmed");
});

Deno.test("4: company hiring query compiles company + job-signal evidence", () => {
  const c = compileEvidenceContract(compileLeadEntityIntent("Find B2B SaaS companies hiring engineers"), BRAIN);
  assertEquals(c.targetEntity, "company");
  assertEquals(c.freshness, "recent_signal");
  assert(c.identityRequirements.some((r) => r.category === "company_identity" && r.required));
  assert(c.timingRequirements.some((r) => r.category === "job_signal" && r.required));
  assertEquals(c.acceptancePolicy, "fit_and_timing_confirmed");
});

Deno.test("5: hot opportunity requires timing proof (any-of)", () => {
  const c = compileEvidenceContract(compileLeadEntityIntent("Using my ICP, find me 5 hot founders I should contact right now."), BRAIN);
  assertEquals(c.freshness, "hot_opportunity");
  assertEquals(c.acceptancePolicy, "fit_and_timing_confirmed");
  assert(c.timingRequirements.length > 0);
});

// ============ (28)(29) signals never change the entity ============
Deno.test("28/29: hiring/funding signals do not change a person target", () => {
  const a = compileLeadEntityIntent("Find founders at B2B SaaS companies hiring engineers");
  assertEquals(a.target_entity, "person");
  const b = compileLeadEntityIntent("Find recently funded B2B SaaS founders");
  assertEquals(b.target_entity, "person");
});

// ============ (6)(7) jobs query skip / enrich ============
function companyJobEnvelope(evidence: EvidenceItem[]): CandidateEnvelope {
  return {
    candidateId: "nc_co_1", targetEntity: "company", primaryArtifactType: "company_candidate",
    company: { name: "Acme SaaS", website: "https://acme.com", industry: "B2B SaaS" },
    evidence, companyKey: "dom:acme.com",
    sourceProvenance: { provider: "apify", actorKey: "apify_jobs", actorId: "curious_coder/linkedin-jobs-scraper", verified: true },
  };
}

Deno.test("6: jobs actor with complete company + job evidence SKIPS enrichment", () => {
  const intent = compileLeadEntityIntent("Find B2B SaaS companies hiring engineers");
  const contract = compileEvidenceContract(intent, BRAIN);
  const env = companyJobEnvelope([
    ev("company_identity", { confidence: "high" }), ev("company_industry"), ev("company_website"),
    ev("company_geography"), ev("company_size", { confidence: "low" }),
    ev("job_signal", { observedAt: RECENT }),
  ]);
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
  assertEquals(s.sufficient, true);
  assertEquals(s.nextDecision, "qualify_now");
  const p = planCandidateEnrichment({ envelope: env, sufficiency: s, budget: DEFAULT_EVIDENCE_BUDGET, ledger: emptyLedger(), now: NOW });
  assertEquals(p.action, "skip");
  assertEquals(p.reasonCode, "primary_source_sufficient");
  assertEquals(p.estimatedCostClass, "none");
});

Deno.test("7: jobs actor missing industry requests structured company enrichment (not Firecrawl)", () => {
  const contract = compileEvidenceContract(compileLeadEntityIntent("Find B2B SaaS companies hiring engineers"), BRAIN);
  const env = companyJobEnvelope([
    ev("company_identity", { confidence: "high" }), ev("company_website"),
    ev("company_geography"), ev("company_size", { confidence: "low" }), ev("job_signal"),
  ]);
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
  assertEquals(s.nextDecision, "structured_company_enrichment");
  assertEquals(s.reasonCode, "missing_firmographics");
  assert(s.missingCriticalRequirements.includes("company_industry"));
});

// ============ (8) people query missing firmographics — the live v82 shape ============
Deno.test("8: people result missing website/industry requests structured company enrichment", () => {
  const contract = compileEvidenceContract(compileLeadEntityIntent("Find founders of B2B SaaS companies"), BRAIN);
  const env = personEnvelope([
    ev("person_identity", { confidence: "high" }), ev("person_company_association"), ev("company_geography"),
  ]);
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
  assertEquals(s.identityComplete, true);
  assertEquals(s.fitComplete, false);
  assertEquals(s.nextDecision, "structured_company_enrichment");
  assert(s.missingCriticalRequirements.includes("company_website"));
  assert(s.missingCriticalRequirements.includes("company_industry"));
});

// ============ (9)(31) fit complete but no timing ============
Deno.test("9/31: complete fit but missing timing → signal enrichment; staging when unavailable", () => {
  const contract = compileEvidenceContract(compileLeadEntityIntent("Using my ICP, find me 5 hot founders I should contact right now."), BRAIN);
  const env = personEnvelope([
    ev("person_identity", { confidence: "high" }), ev("person_company_association"),
    ev("company_website"), ev("company_industry"), ev("company_geography"), ev("company_size", { confidence: "low" }),
  ]);
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
  assertEquals(s.identityComplete, true);
  assertEquals(s.fitComplete, true);
  assertEquals(s.timingComplete, false);
  assertEquals(s.nextDecision, "signal_enrichment");
  const p = planCandidateEnrichment({ envelope: env, sufficiency: s, budget: DEFAULT_EVIDENCE_BUDGET, ledger: emptyLedger(), now: NOW });
  // `|| p.action === "targeted_firecrawl"` used to be the other half of this
  // assertion. A missing timing signal now takes a verified structured source
  // or stages — it never falls back to crawling the company's website hoping a
  // date is on the homepage.
  assertEquals(p.action, "specialized_signal_source", p.action);
  assertEquals(p.reasonCode, "missing_timing_signal");
});

// ============ (30) hot requires identity + fit + timing ============
Deno.test("30: hot candidate with identity + fit + fresh signal qualifies now", () => {
  const contract = compileEvidenceContract(compileLeadEntityIntent("Using my ICP, find me 5 hot founders I should contact right now."), BRAIN);
  const env = personEnvelope([
    ev("person_identity", { confidence: "high" }), ev("person_company_association"),
    ev("company_website"), ev("company_industry"), ev("company_geography"), ev("company_size", { confidence: "low" }),
    ev("funding_signal", { observedAt: RECENT }),
  ]);
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
  assertEquals(s.sufficient, true);
  assertEquals(s.nextDecision, "qualify_now");
});

// ============ (12)(20) Firecrawl skipped / no binding ============
Deno.test("12: Firecrawl is not chosen when structured evidence suffices", () => {
  const contract = compileEvidenceContract(compileLeadEntityIntent("Find founders of B2B SaaS companies"), BRAIN);
  const env = personEnvelope([
    ev("person_identity", { confidence: "high" }), ev("person_company_association"),
    ev("company_website"), ev("company_industry"), ev("company_geography"), ev("company_size", { confidence: "low" }),
  ]);
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
  const p = planCandidateEnrichment({ envelope: env, sufficiency: s, budget: DEFAULT_EVIDENCE_BUDGET, ledger: emptyLedger(), now: NOW });
  assertEquals(p.action, "skip");
});

Deno.test("20/34: verified binding routes to the canonical company actor (no invented id)", () => {
  const cap = getActorCapability("apify_linkedin_company_details");
  assertEquals(isCallable(cap), true);
  assertEquals(cap!.implementationId, "harvestapi/linkedin-company");
  const contract = compileEvidenceContract(compileLeadEntityIntent("Find founders of B2B SaaS companies"), BRAIN);
  const env = personEnvelope([ev("person_identity", { confidence: "high" }), ev("person_company_association"), ev("company_geography")]);
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
  const p = planCandidateEnrichment({ envelope: env, sufficiency: s, budget: DEFAULT_EVIDENCE_BUDGET, ledger: emptyLedger(), now: NOW });
  assertEquals(p.action, "structured_company_enrichment");
  assertEquals(p.actorKey, "apify_linkedin_company_details");
  assertEquals(p.actorId, "harvestapi/linkedin-company");
  assertEquals(p.reasonCode, "missing_firmographics");
  assertEquals(p.estimatedCostClass, "low");
  // Any capability still lacking a verified binding remains uncallable.
  for (const c of unverifiedCapabilities()) assertEquals(isCallable(c), false);
});

// ============ (18)(19) hard rejects before enrichment ============
Deno.test("18: invalid provenance rejects before enrichment", () => {
  const contract = compileEvidenceContract(compileLeadEntityIntent("Find founders of B2B SaaS companies"), BRAIN);
  const env = personEnvelope([ev("person_identity")], {
    sourceProvenance: { provider: "apify", actorKey: "apify_people_search", actorId: "harvestapi/linkedin-profile-search", verified: false },
  });
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
  assertEquals(s.nextDecision, "reject_source");
  assertEquals(s.reasonCode, "unverified_provenance");
  const p = planCandidateEnrichment({ envelope: env, sufficiency: s, budget: DEFAULT_EVIDENCE_BUDGET, ledger: emptyLedger(), now: NOW });
  assertEquals(p.action, "skip");
  assertEquals(p.reasonCode, "already_rejected");
});

Deno.test("19: explicit ICP contradiction rejects before enrichment", () => {
  const contract = compileEvidenceContract(compileLeadEntityIntent("Find founders of B2B SaaS companies"), BRAIN);
  const env = personEnvelope([ev("person_identity", { confidence: "high" })]);
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW, icpContradiction: true });
  assertEquals(s.nextDecision, "reject_source");
  assertEquals(s.reasonCode, "icp_contradiction");
});

Deno.test("23: artifact mismatch rejects (job_signal for a person target)", () => {
  const contract = compileEvidenceContract(compileLeadEntityIntent("Find founders of B2B SaaS companies"), BRAIN);
  const env = personEnvelope([ev("person_identity")], { primaryArtifactType: "job_signal" });
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
  assertEquals(s.reasonCode, "artifact_mismatch");
});

// ============ (16)(17) cache ============
Deno.test("16: fresh cached company evidence skips provider calls", () => {
  const contract = compileEvidenceContract(compileLeadEntityIntent("Find founders of B2B SaaS companies"), BRAIN);
  const env = personEnvelope([ev("person_identity", { confidence: "high" }), ev("person_company_association"), ev("company_geography")]);
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
  // The cache must cover EVERY critical gap (website + industry + size) to skip.
  const cache = createInMemoryEvidenceCache(new Map([["dom:acme.com", [
    ev("company_website", { observedAt: RECENT }), ev("company_industry", { observedAt: RECENT }),
    ev("company_size", { observedAt: RECENT }),
  ]]]));
  const p = planCandidateEnrichment({ envelope: env, sufficiency: s, budget: DEFAULT_EVIDENCE_BUDGET, ledger: emptyLedger(), cache, now: NOW });
  assertEquals(p.action, "skip");
  assertEquals(p.reasonCode, "fresh_cache_available");
});

Deno.test("17: stale cached evidence does NOT satisfy the gap", () => {
  const contract = compileEvidenceContract(compileLeadEntityIntent("Find founders of B2B SaaS companies"), BRAIN);
  const env = personEnvelope([ev("person_identity", { confidence: "high" }), ev("person_company_association"), ev("company_geography")]);
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
  const cache = createInMemoryEvidenceCache(new Map([["dom:acme.com", [
    ev("company_website", { observedAt: STALE }), ev("company_industry", { observedAt: STALE }),
  ]]]));
  const p = planCandidateEnrichment({ envelope: env, sufficiency: s, budget: DEFAULT_EVIDENCE_BUDGET, ledger: emptyLedger(), cache, now: NOW });
  assert(p.reasonCode !== "fresh_cache_available", p.reasonCode);
});

// ============ (14)(15) company dedupe ============
Deno.test("14/15: three founders at one company create ONE company enrichment action", () => {
  const contract = compileEvidenceContract(compileLeadEntityIntent("Find founders of B2B SaaS companies"), BRAIN);
  const mk = (id: string) => personEnvelope(
    [ev("person_identity", { confidence: "high" }), ev("person_company_association"), ev("company_geography")],
    { candidateId: id, companyKey: "dom:acme.com" },
  );
  // Force a callable route by using the Firecrawl (verified) path for this check.
  const plans = ["a", "b", "c"].map((id) => {
    const env = mk(id);
    const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
    const p = planCandidateEnrichment({ envelope: env, sufficiency: s, budget: DEFAULT_EVIDENCE_BUDGET, ledger: emptyLedger(), now: NOW });
    // Simulate a verified structured route to exercise dedupe deterministically.
    return { ...p, action: "structured_company_enrichment" as const, actorKey: "structured_company_enrichment" };
  });
  const { actions, fanOut } = dedupeCompanyEnrichment(plans);
  const companyActions = actions.filter((a) => a.action === "structured_company_enrichment");
  assertEquals(companyActions.length, 1);                 // ONE call, not three
  assertEquals(fanOut.get("dom:acme.com")!.length, 3);    // fanned back to all three
});

Deno.test("companyKeyFor prefers LinkedIn URL → domain → name+geo", () => {
  assertEquals(companyKeyFor({ companyLinkedinUrl: "https://www.linkedin.com/company/acme/" }), "li:linkedin.com/company/acme");
  assertEquals(companyKeyFor({ website: "https://www.acme.com/about?x=1" }), "dom:acme.com");
  assertEquals(companyKeyFor({ companyName: "Acme, Inc.", countryCode: "US" }), "name:acme|us");
  // Same company via different founders' records ⇒ identical key.
  assertEquals(companyKeyFor({ domain: "acme.com" }), companyKeyFor({ website: "https://acme.com" }));
});

// ============ (21)(22) budget ============
Deno.test("21: a gap only the web can close STAGES — it never orders a crawl", () => {
  // ── WHAT THIS TEST USED TO SAY ───────────────────────────────────────────
  //
  // It exhausted `ledger.firecrawlCompaniesUsed` against
  // `budget.firecrawlCompanies` and asserted `budget_exhausted` — which means
  // the pass-case it was guarding was a plan that DID order a crawl, and the
  // only thing standing between a candidate and a crawl was a counter reaching
  // five. Both the counter and the budget line are gone, so the branch is
  // asserted at its new floor instead: whatever the ledger says, the answer is
  // the unlock gate.
  const contract = compileEvidenceContract(compileLeadEntityIntent("Using my ICP, find me 5 hot founders I should contact right now."), BRAIN);
  const env = personEnvelope([
    ev("person_identity", { confidence: "high" }), ev("person_company_association"),
    ev("company_website"), ev("company_industry"), ev("company_geography"), ev("company_size", { confidence: "low" }),
  ]);
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
  const p = planCandidateEnrichment({
    envelope: env,
    sufficiency: { ...s, missingCriticalRequirements: ["company_business_model"], nextDecision: "targeted_web_verification" },
    budget: DEFAULT_EVIDENCE_BUDGET, ledger: emptyLedger(), now: NOW,
  });
  assertEquals(p.action, "stage");
  assertEquals(p.reasonCode, "web_research_is_unlock_gated");
  // AND IT NAMES NO ACTOR. A staged plan carrying `firecrawl_scrape_url` and
  // its implementation id is a call plan in everything but the verb.
  assertEquals(p.actorKey, undefined);
  assertEquals(p.estimatedCostClass, "none");
});

Deno.test("21b: NO sufficiency verdict can produce an automatic crawl", () => {
  // The branch above is one route. This walks EVERY `nextDecision` the
  // sufficiency evaluator can return, because the way an automatic crawl comes
  // back is not someone re-adding the branch that was deleted — it is a new
  // decision value being wired to the cheapest thing that answers it.
  const contract = compileEvidenceContract(compileLeadEntityIntent("Using my ICP, find me 5 hot founders I should contact right now."), BRAIN);
  const env = personEnvelope([
    ev("person_identity", { confidence: "high" }), ev("person_company_association"),
    ev("company_website"), ev("company_industry"), ev("company_geography"), ev("company_size", { confidence: "low" }),
  ]);
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });

  const decisions = [
    "structured_company_enrichment", "targeted_web_verification",
    "signal_enrichment", "qualify_now", "reject", "stage",
  ] as const;

  const plans = decisions.map((d) => planCandidateEnrichment({
    envelope: env,
    sufficiency: {
      ...s,
      missingCriticalRequirements: ["company_business_model", "job_signal"],
      nextDecision: d as typeof s.nextDecision,
    },
    budget: DEFAULT_EVIDENCE_BUDGET, ledger: emptyLedger(), now: NOW,
  }));

  assertEquals(enforcesUnlockGatedWebResearch(plans), []);
});

Deno.test("21c: the guard BITES — it catches a reintroduced crawl", () => {
  // A guard nobody has seen fail is a guard nobody knows works. This feeds it
  // exactly the plan the deleted branch used to return.
  const reintroduced = [{
    candidateId: "c1", companyKey: "dom:acme.com",
    action: "targeted_firecrawl" as unknown as "stage",
    actorKey: "firecrawl_scrape_url", actorId: "mendable/firecrawl",
    requiredEvidence: ["company_business_model" as const],
    reasonCode: "missing_official_proof" as const,
    estimatedCostClass: "high" as const,
  }];
  const violations = enforcesUnlockGatedWebResearch(reintroduced);
  assertEquals(violations.length, 3, violations.join(" | "));
  assert(violations.some((v) => /research_company unlock/.test(v)));
  assert(violations.some((v) => /firecrawl_scrape_url/.test(v)));
  assert(violations.some((v) => /cost class "high"/.test(v)));
});

Deno.test("22: requested accepted count stops further enrichment", () => {
  const contract = compileEvidenceContract(compileLeadEntityIntent("Find founders of B2B SaaS companies"), BRAIN);
  const env = personEnvelope([ev("person_identity", { confidence: "high" }), ev("person_company_association"), ev("company_geography")]);
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
  const ledger = { ...emptyLedger(), acceptedSoFar: DEFAULT_EVIDENCE_BUDGET.finalAcceptedTarget };
  const p = planCandidateEnrichment({ envelope: env, sufficiency: s, budget: DEFAULT_EVIDENCE_BUDGET, ledger, now: NOW });
  assertEquals(p.action, "stage");
  assertEquals(p.reasonCode, "requested_count_satisfied");
});

Deno.test("27: search-wide/enrich-narrow — non-competitive candidates are not enriched", () => {
  const contract = compileEvidenceContract(compileLeadEntityIntent("Find founders of B2B SaaS companies"), BRAIN);
  const env = personEnvelope([ev("person_identity", { confidence: "high" }), ev("person_company_association"), ev("company_geography")]);
  const s = evaluateEvidenceSufficiency({ contract, envelope: env, now: NOW });
  const p = planCandidateEnrichment({ envelope: env, sufficiency: s, budget: DEFAULT_EVIDENCE_BUDGET, ledger: emptyLedger(), now: NOW, competitive: false });
  assertEquals(p.action, "stage");
  assertEquals(p.reasonCode, "not_competitive");
});

// ============ (13) Firecrawl page cap ============
Deno.test("13: the workflow budget grants NO automatic Firecrawl allowance", () => {
  // The actor's own page cap is unchanged and still matters — the
  // `research_company` unlock runs through it.
  assertEquals(ACTOR_CAPABILITIES.firecrawl_scrape_url.defaultMaxItems, 3);

  // ── WHAT CHANGED, AND WHY IT IS THE POINT ────────────────────────────────
  //
  // This asserted `firecrawlPagesPerCompany === 3` and `firecrawlCompanies
  // === 5` — an allowance of fifteen pages that every caller taking
  // DEFAULT_EVIDENCE_BUDGET already held without ever naming Firecrawl. A
  // budget line IS permission. Zeroing it would have left the field there for
  // someone to raise, so the fields are deleted and their absence is asserted.
  const budget = DEFAULT_EVIDENCE_BUDGET as unknown as Record<string, unknown>;
  for (const gone of ["firecrawlCompanies", "firecrawlPagesPerCompany"]) {
    assertEquals(gone in budget, false,
      `${gone} is back in the workflow budget — that is a standing authorisation to crawl`);
  }
  // The ledger that counted the spend is gone with it.
  assertEquals("firecrawlCompaniesUsed" in (emptyLedger() as unknown as Record<string, unknown>), false);

  // And the forbidden set is non-empty, so the guard above can never pass
  // vacuously by having nothing to forbid.
  assert(FORBIDDEN_AUTOMATIC_ACTIONS.includes("targeted_firecrawl"));
});

// ============ (24)(25)(26) evidence integrity ============
Deno.test("24: LLM inference cannot become verified evidence", () => {
  const env = personEnvelope([]);
  // An unverified "public_web" claim is not counted as satisfying a requirement.
  const withGuess = appendEvidence(env, [{ category: "company_industry", sourceType: "public_web", confidence: "high", verified: false }]);
  assert(!satisfiedCategories(withGuess).has("company_industry"));
});

Deno.test("25: Company Brain fields are constraints, not candidate evidence", () => {
  const env = personEnvelope([]);
  const withBrain = appendEvidence(env, [{ category: "company_industry", sourceType: "company_brain", confidence: "high", verified: true }]);
  assertEquals(withBrain.evidence.length, 0);              // rejected at the door
  assert(!satisfiedCategories(withBrain).has("company_industry"));
});

Deno.test("26: enrichment evidence is append-only (never overwritten)", () => {
  const first = ev("company_industry", { value: "IT Services", observedAt: STALE });
  const env = personEnvelope([first]);
  const later = ev("company_industry", { value: "B2B SaaS", observedAt: RECENT });
  const after = appendEvidence(env, [later]);
  assertEquals(after.evidence.length, 2);                  // both observations retained
  assertEquals(after.evidence[0].value, "IT Services");    // original untouched
});

Deno.test("23b: envelope preserves artifact type + immutable provenance", () => {
  const env = personEnvelope([ev("person_identity")]);
  const after = appendEvidence(env, [ev("company_website")]);
  assertEquals(after.primaryArtifactType, "person_candidate");
  assertEquals(after.sourceProvenance.actorId, "harvestapi/linkedin-profile-search");
  assertEquals(after.sourceProvenance.verified, true);
});
