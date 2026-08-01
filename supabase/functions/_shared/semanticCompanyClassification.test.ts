// GPT SEMANTIC COMPANY CLASSIFICATION — fully mocked. ZERO network, ZERO spend.
//
// Four companies, each representing a reading the old single-label industry
// check got wrong:
//   Gumloop            SaaS platform behind a "Software Development" label
//   Checkbox           enterprise no-code platform behind the same label
//   unclear software   a label and nothing else  -> evidence_pending
//   software agency    services evidence         -> software_services, not SaaS

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyCompanySemantically, hasServiceBusinessMarkers, hasSufficientEvidence,
  semanticClassificationDiagnostics, CANONICAL_BUSINESS_MODELS,
  SEMANTIC_CLASSIFICATION_IS_ADVISORY,
  type CompanyEvidenceInput,
} from "./semanticCompanyClassification.ts";
import type { StrategistCallFn } from "./leadStrategy/provider.ts";

/** A model that answers with the given JSON, recording what it was asked. */
function mockModel(json: unknown, sink: { userMessage?: string } = {}): StrategistCallFn {
  return (call) => {
    sink.userMessage = call.userMessage;
    return Promise.resolve({
      ok: true, model: call.model, json, content: JSON.stringify(json), latencyMs: 1,
    });
  };
}

const GUMLOOP: CompanyEvidenceInput = {
  companyName: "Gumloop",
  providerIndustry: "Software Development",
  companyDescription: "Gumloop is an AI automation platform for building internal workflows.",
  productDescription: "A no-code cloud platform where teams build AI workflows with a visual dashboard.",
  websiteEvidence: ["Pricing plans per seat", "Start a free trial", "Product docs and API reference"],
  customerType: "businesses and enterprise teams",
  businessModelEvidence: ["subscription", "per-seat pricing", "self-serve signup"],
};

const CHECKBOX: CompanyEvidenceInput = {
  companyName: "Checkbox",
  providerIndustry: "Software Development",
  companyDescription: "Checkbox provides a no-code platform for legal and compliance teams.",
  productDescription: "Enterprise cloud platform for workflow automation used by in-house legal departments.",
  websiteEvidence: ["Enterprise cloud platform", "Request a demo", "SOC 2 compliant product"],
  customerType: "enterprise legal teams",
  businessModelEvidence: ["annual subscription contracts", "per seat licensing"],
};

const UNCLEAR: CompanyEvidenceInput = {
  companyName: "Northbridge Systems",
  providerIndustry: "Software Development",
  companyDescription: "Northbridge Systems builds software.",
};

const AGENCY: CompanyEvidenceInput = {
  companyName: "Pixelforge Studio",
  providerIndustry: "Software Development",
  companyDescription: "A digital product agency delivering custom software for clients.",
  productDescription: "We build software for startups and enterprises on a project basis.",
  websiteEvidence: ["Our client projects", "Work with our consulting team"],
  customerType: "startups and enterprises",
  businessModelEvidence: ["monthly retainer", "statement of work", "hourly rate engagements"],
};

Deno.test("Gumloop: software label + clear product evidence => b2b_saas", async () => {
  const c = await classifyCompanySemantically({
    evidence: GUMLOOP,
    call: mockModel({
      canonical_industry: "AI workflow automation software",
      canonical_business_model: "b2b_saas",
      confidence: 0.92,
      supporting_evidence: ["self-serve subscription platform", "per-seat pricing", "sold to business teams"],
      contradictory_evidence: [],
      unknown_evidence: [],
    }),
  });
  assertEquals(c.status, "classified");
  assertEquals(c.canonical_business_model, "b2b_saas");
  assert(c.confidence >= 0.9);
  assert(c.supporting_evidence.length >= 3);
  assertEquals(c.adjustments, []);
});

Deno.test("Checkbox: enterprise cloud platform evidence => b2b_saas", async () => {
  const c = await classifyCompanySemantically({
    evidence: CHECKBOX,
    call: mockModel({
      canonical_industry: "Legal and compliance workflow software",
      canonical_business_model: "b2b_saas",
      confidence: 0.88,
      supporting_evidence: ["enterprise cloud platform", "annual per-seat subscriptions"],
      contradictory_evidence: ["no public self-serve signup"],
      unknown_evidence: ["headcount"],
    }),
  });
  assertEquals(c.status, "classified");
  assertEquals(c.canonical_business_model, "b2b_saas");
  // Contradicting evidence is preserved, never dropped to make the reading tidy.
  assertEquals(c.contradictory_evidence, ["no public self-serve signup"]);
});

Deno.test("an unclear software company stays UNKNOWN / evidence_pending", async () => {
  const c = await classifyCompanySemantically({
    evidence: UNCLEAR,
    call: mockModel({
      canonical_industry: "Software",
      canonical_business_model: "unknown",
      confidence: 0.3,
      supporting_evidence: [],
      contradictory_evidence: [],
      unknown_evidence: ["what the product is", "who buys it"],
    }),
  });
  assertEquals(c.status, "evidence_pending");
  assertEquals(c.canonical_business_model, "unknown");
  // The missing fields are named, so the pipeline knows what to go and collect.
  assert(c.unknown_evidence.includes("website_evidence"));
  assert(c.unknown_evidence.includes("business_model_evidence"));
});

Deno.test("a provider label ALONE never reaches the model", async () => {
  let called = false;
  const c = await classifyCompanySemantically({
    evidence: { companyName: "Label Only Ltd", providerIndustry: "Software Development" },
    call: () => { called = true; throw new Error("must not be called"); },
  });
  assert(!called, "one industry string is not evidence and must not buy a model call");
  assertEquals(c.status, "evidence_pending");
  assert(c.adjustments.includes("insufficient_source_evidence"));
});

Deno.test("a software AGENCY is software_services, not SaaS", async () => {
  const c = await classifyCompanySemantically({
    evidence: AGENCY,
    call: mockModel({
      canonical_industry: "Custom software development services",
      canonical_business_model: "software_services",
      confidence: 0.9,
      supporting_evidence: ["retainer and statement-of-work engagements", "client project delivery"],
      contradictory_evidence: [],
      unknown_evidence: [],
    }),
  });
  assertEquals(c.status, "classified");
  assertEquals(c.canonical_business_model, "software_services");
});

Deno.test("agency evidence OVERRULES a model that answers b2b_saas", async () => {
  const c = await classifyCompanySemantically({
    evidence: AGENCY,
    call: mockModel({
      canonical_industry: "Software",
      canonical_business_model: "b2b_saas",
      confidence: 0.95,
      supporting_evidence: ["software company selling to businesses"],
      contradictory_evidence: [],
      unknown_evidence: [],
    }),
  });
  assertEquals(c.canonical_business_model, "software_services");
  assert(c.adjustments.includes("service_evidence_overrides_saas_reading"));
  assert(hasServiceBusinessMarkers(AGENCY));
});

Deno.test("a business model outside the vocabulary is refused, not adopted", async () => {
  const c = await classifyCompanySemantically({
    evidence: GUMLOOP,
    call: mockModel({
      canonical_industry: "Software",
      canonical_business_model: "b2b2c_ai_platform",
      confidence: 0.99,
      supporting_evidence: ["platform"],
      contradictory_evidence: [],
      unknown_evidence: [],
    }),
  });
  assertEquals(c.status, "evidence_pending");
  assertEquals(c.canonical_business_model, "unknown");
  assert(c.adjustments.some((a) => a.startsWith("business_model_outside_vocabulary")));
});

Deno.test("high confidence with NO cited evidence is not usable", async () => {
  const c = await classifyCompanySemantically({
    evidence: GUMLOOP,
    call: mockModel({
      canonical_industry: "Software",
      canonical_business_model: "b2b_saas",
      confidence: 1,
      supporting_evidence: [],
      contradictory_evidence: [],
      unknown_evidence: [],
    }),
  });
  assertEquals(c.status, "evidence_pending");
  assert(c.adjustments.includes("no_supporting_evidence_cited"));
});

Deno.test("low confidence is not usable however clean the reading looks", async () => {
  const c = await classifyCompanySemantically({
    evidence: CHECKBOX,
    call: mockModel({
      canonical_industry: "Software",
      canonical_business_model: "b2b_saas",
      confidence: 0.41,
      supporting_evidence: ["platform"],
      contradictory_evidence: [],
      unknown_evidence: [],
    }),
  });
  assertEquals(c.status, "evidence_pending");
  assert(c.adjustments.includes("confidence_below_usable_threshold"));
});

Deno.test("a model failure degrades to evidence_pending, never to a guess", async () => {
  const c = await classifyCompanySemantically({
    evidence: GUMLOOP,
    call: () => Promise.resolve({
      ok: false, model: "m", content: "", latencyMs: 1, errorCode: "timeout",
    }),
  });
  assertEquals(c.status, "evidence_pending");
  assertEquals(c.canonical_business_model, "unknown");
});

Deno.test("all six evidence kinds are sent, and nothing else is", async () => {
  const sink: { userMessage?: string } = {};
  await classifyCompanySemantically({
    evidence: GUMLOOP,
    call: mockModel({
      canonical_industry: "Software", canonical_business_model: "b2b_saas", confidence: 0.9,
      supporting_evidence: ["platform"], contradictory_evidence: [], unknown_evidence: [],
    }, sink),
  });
  const sent = JSON.parse(sink.userMessage ?? "{}");
  for (const k of [
    "provider_industry", "company_description", "product_description",
    "website_evidence", "customer_type", "business_model_evidence",
  ]) assert(k in sent, `${k} must reach the classifier`);
  assertEquals(sent.allowed_business_models, [...CANONICAL_BUSINESS_MODELS]);
});

Deno.test("the classifier is ADVISORY — it never emits a qualification verdict", async () => {
  const c = await classifyCompanySemantically({
    evidence: GUMLOOP,
    call: mockModel({
      canonical_industry: "Software", canonical_business_model: "b2b_saas", confidence: 0.9,
      supporting_evidence: ["platform"], contradictory_evidence: [], unknown_evidence: [],
    }),
  });
  for (const forbidden of ["verdict", "qualified", "gate", "accepted", "score", "contact"]) {
    assert(!(forbidden in (c as unknown as Record<string, unknown>)),
      `Company Brain remains the qualification authority; '${forbidden}' must not exist here`);
  }
  assert(SEMANTIC_CLASSIFICATION_IS_ADVISORY);
  assertEquals(semanticClassificationDiagnostics(c).advisory_only, true);
  assert(hasSufficientEvidence(GUMLOOP));
});
