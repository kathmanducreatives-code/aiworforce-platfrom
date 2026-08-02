// SEMANTIC CLASSIFICATION — interpretation only, never qualification.
// ZERO network, ZERO model calls. Every classifier is a stub.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyCompany, validateClassification, classificationCacheKey, brainEvidenceFrom,
  unknownClassification, buildClassificationPayload, classificationIsSafe,
  MIN_SUPPORTED_CONFIDENCE,
  type BrainVocabulary, type ClassificationCache, type CompanyEvidenceInput,
} from "../../supabase/functions/_shared/companySemanticClassification.ts";

const VOCAB: BrainVocabulary = {
  positive_industries: ["b2b saas"], excluded_industries: ["staffing"],
  business_models: ["subscription software"], customer_types: ["b2b"],
};

function ev(o: Partial<CompanyEvidenceInput> = {}): CompanyEvidenceInput {
  return {
    company_key: "domain:gumloop.com", company_name: "Gumloop",
    provider_industry: "Software Development",
    company_description: "Cloud software platform for enterprise revenue teams",
    product_description: "AI automation platform sold to businesses",
    website: "https://gumloop.com", customer_type_evidence: "enterprise customers",
    company_type: "Privately Held", business_model_evidence: "subscription plans",
    software_evidence: "cloud platform", pricing_evidence: "monthly subscription tiers",
    source_refs: ["li_company", "li_description"], missing_fields: [],
    ...o,
  };
}

const answer = (o: Record<string, unknown> = {}) => ({
  canonical_industry: "b2b_saas", canonical_business_model: "subscription_software",
  customer_type: "b2b", confidence: 0.9,
  supporting_evidence: [{ evidence_ref: "li_description", claim: "cloud platform sold to enterprise revenue teams" }],
  contradictory_evidence: [], missing_evidence: [], classification_status: "supported",
  ...o,
});

const stub = (a: unknown) => () => Promise.resolve(a);

// ============================ 10, 11. SUPPORTED FIXTURES ====================

Deno.test("10. Gumloop-style: Software Development + cloud platform evidence → B2B SaaS", async () => {
  const r = await classifyCompany({ evidence: ev(), vocabulary: VOCAB, classify: stub(answer()) });
  assertEquals(r.classification.canonical_industry, "b2b_saas");
  assertEquals(r.classification.classification_status, "supported");
  assert(r.classification.supporting_evidence.length > 0, "a supported claim must cite evidence");
  assertEquals(r.classification.supporting_evidence[0].evidence_ref, "li_description");
});

Deno.test("11. Checkbox-style: explicit enterprise B2B SaaS description → supported", async () => {
  const r = await classifyCompany({
    evidence: ev({
      company_key: "domain:checkbox.ai", company_name: "Checkbox",
      company_description: "Enterprise B2B SaaS workflow platform",
      source_refs: ["li_description"],
    }),
    vocabulary: VOCAB,
    classify: stub(answer({
      supporting_evidence: [{ evidence_ref: "li_description", claim: "explicitly describes enterprise B2B SaaS" }],
    })),
  });
  assertEquals(r.classification.canonical_industry, "b2b_saas");
  assertEquals(r.classification.classification_status, "supported");
});

// ==================== 12–16. UNCERTAIN, SERVICES, CONTRADICTED ==============

Deno.test("12. broad Software Development label with a weak description → uncertain", async () => {
  const r = await classifyCompany({
    evidence: ev({ company_description: "Software company", product_description: null, pricing_evidence: null }),
    vocabulary: VOCAB,
    classify: stub(answer({
      canonical_industry: "unknown", confidence: 0.3,
      supporting_evidence: [], missing_evidence: ["product_description"],
      classification_status: "uncertain",
    })),
  });
  assertEquals(r.classification.classification_status, "uncertain");
  assertEquals(r.classification.canonical_industry, "unknown");
  // And it contributes NOTHING to the Brain.
  assertEquals(brainEvidenceFrom(r.classification).industry, null);
});

Deno.test("13. a software agency with project/client evidence → agency, not SaaS", async () => {
  const r = await classifyCompany({
    evidence: ev({ company_description: "We build custom software for clients on a project basis" }),
    vocabulary: VOCAB,
    classify: stub(answer({
      canonical_industry: "software_agency", canonical_business_model: "project_based",
      supporting_evidence: [{ evidence_ref: "li_description", claim: "custom client projects" }],
    })),
  });
  assertEquals(r.classification.canonical_industry, "software_agency");
  assertEquals(r.classification.canonical_business_model, "project_based");
  assertEquals(brainEvidenceFrom(r.classification).industry, "software agency");
});

Deno.test("14. a consultancy / implementation partner → professional services", async () => {
  const r = await classifyCompany({
    evidence: ev({ company_description: "Implementation partner and consultancy" }),
    vocabulary: VOCAB,
    classify: stub(answer({
      canonical_industry: "professional_services", canonical_business_model: "services",
      supporting_evidence: [{ evidence_ref: "li_description", claim: "implementation consultancy" }],
    })),
  });
  assertEquals(r.classification.canonical_industry, "professional_services");
  assertEquals(brainEvidenceFrom(r.classification).business_model, "services");
});

Deno.test("15. an explicit non-software company → non_software", async () => {
  const r = await classifyCompany({
    evidence: ev({ provider_industry: "Restaurants", company_description: "Regional restaurant group" }),
    vocabulary: VOCAB,
    classify: stub(answer({
      canonical_industry: "non_software", canonical_business_model: "services",
      supporting_evidence: [{ evidence_ref: "li_company", claim: "restaurant group" }],
    })),
  });
  assertEquals(r.classification.canonical_industry, "non_software");
});

Deno.test("16. conflicting SaaS and services evidence stays VISIBLE — no automatic pass", async () => {
  const r = await classifyCompany({
    evidence: ev(), vocabulary: VOCAB,
    classify: stub(answer({
      contradictory_evidence: [{ evidence_ref: "li_company", claim: "also sells implementation services" }],
    })),
  });
  // A supported answer carrying contradictions is downgraded, not accepted.
  assertEquals(r.classification.classification_status, "contradicted");
  assert(r.classification.contradictory_evidence.length === 1);
  assertEquals(brainEvidenceFrom(r.classification).industry, null, "a contradiction must not feed the gate");
  assert(r.provenance.repairs.includes("status_downgraded_contradictory_evidence"));
});

// ================================ 17. INVALID MODEL OUTPUT ==================

Deno.test("17. invalid model output is rejected deterministically and returns unknown", async () => {
  for (const bad of [null, "a string", 42, [], { canonical_industry: "invented_category" }]) {
    const r = await classifyCompany({ evidence: ev(), vocabulary: VOCAB, classify: stub(bad) });
    assertEquals(r.classification.canonical_industry, "unknown");
    assertFalse(r.classification.classification_status === "supported");
  }
});

Deno.test("17b. a claim citing a ref nobody supplied is DROPPED, not trusted", () => {
  const v = validateClassification(
    answer({ supporting_evidence: [{ evidence_ref: "invented_ref", claim: "sounds convincing" }] }),
    ev(),
  );
  assertEquals(v.classification.supporting_evidence.length, 0);
  assert(v.errors.some((e) => e.startsWith("supporting_ref_not_supplied:")));
  // With nothing cited it cannot remain "supported".
  assertEquals(v.classification.classification_status, "uncertain");
});

Deno.test("17c. low confidence cannot silently pass a hard gate", () => {
  const v = validateClassification(answer({ confidence: MIN_SUPPORTED_CONFIDENCE - 0.1 }), ev());
  assertEquals(v.classification.classification_status, "uncertain");
  assert(v.repairs.includes("status_downgraded_low_confidence"));
  assertEquals(brainEvidenceFrom(v.classification).industry, null);
});

Deno.test("17d. a classifier THROW returns unknown, never a rejection", async () => {
  const r = await classifyCompany({
    evidence: ev(), vocabulary: VOCAB,
    classify: () => Promise.reject(new Error("gateway down")),
  });
  assertEquals(r.classification.canonical_industry, "unknown");
  assertEquals(r.provenance.fallback_reason, "classifier_error");
  assertFalse(r.classification.classification_status === "contradicted",
    "a model failure must not look like negative evidence");
});

Deno.test("17e. no classifier configured ⇒ unknown, mission continues", async () => {
  const r = await classifyCompany({ evidence: ev(), vocabulary: VOCAB });
  assertEquals(r.provenance.fallback_reason, "classifier_not_configured");
  assertEquals(r.classification.canonical_industry, "unknown");
});

// ============================== 18, 19. REUSE ===============================

Deno.test("18. equivalent evidence reuses the cached classification", async () => {
  const cache: ClassificationCache = new Map();
  let calls = 0;
  const classify = () => { calls += 1; return Promise.resolve(answer()); };
  await classifyCompany({ evidence: ev(), vocabulary: VOCAB, cache, classify });
  await classifyCompany({ evidence: ev(), vocabulary: VOCAB, cache, classify });
  assertEquals(calls, 1, "identical evidence must not be classified twice");
});

Deno.test("19. changed evidence invalidates the reuse key", async () => {
  const cache: ClassificationCache = new Map();
  let calls = 0;
  const classify = () => { calls += 1; return Promise.resolve(answer()); };
  await classifyCompany({ evidence: ev(), vocabulary: VOCAB, cache, classify });
  await classifyCompany({
    evidence: ev({ company_description: "Now something different" }),
    vocabulary: VOCAB, cache, classify,
  });
  assertEquals(calls, 2, "changed evidence must be re-classified");
  assert(classificationCacheKey(ev()) !== classificationCacheKey(ev({ company_description: "x" })));
});

// ====================== 20. COMPANY BRAIN REMAINS FINAL =====================

Deno.test("20. this module cannot qualify or reject — it only supplies evidence", async () => {
  const r = await classifyCompany({ evidence: ev(), vocabulary: VOCAB, classify: stub(answer()) });
  const keys = Object.keys(r.classification);
  for (const forbidden of ["qualified", "rejected", "pass", "fail", "verdict", "quota_eligible"]) {
    assertFalse(keys.includes(forbidden), `a classification must not carry "${forbidden}"`);
  }
  // Its ONLY contribution is comparable strings for the Brain to judge.
  const brain = brainEvidenceFrom(r.classification);
  assertEquals(brain.industry, "b2b saas");
  assertEquals(brain.business_model, "subscription software");
});

Deno.test("20b. only a SUPPORTED classification contributes anything to the Brain", () => {
  for (const status of ["uncertain", "contradicted"] as const) {
    const c = { ...unknownClassification(), classification_status: status, canonical_industry: "b2b_saas" as const };
    const brain = brainEvidenceFrom(c);
    assertEquals(brain.industry, null);
    assertEquals(brain.business_model, null);
  }
});

// ============================== payload + safety ============================

Deno.test("the classifier payload carries evidence and vocabulary, and no secrets", () => {
  const payload = buildClassificationPayload(ev(), VOCAB);
  assert(payload.evidence);
  assert(payload.brain_vocabulary);
  assert(Array.isArray(payload.rules));
  const blob = JSON.stringify(payload).toLowerCase();
  for (const banned of ["api_key", "bearer ", "secret", "apify"]) {
    assertFalse(blob.includes(banned), `payload leaked ${banned}`);
  }
});

Deno.test("a classification record carries no credential or contact detail", async () => {
  const r = await classifyCompany({ evidence: ev(), vocabulary: VOCAB, classify: stub(answer()) });
  assert(classificationIsSafe(r));
  assertEquals(r.provenance.policy_version, "company-semantic-classification-1.0.0");
  assert(r.provenance.evidence_hash.startsWith("domain:gumloop.com:"));
});
