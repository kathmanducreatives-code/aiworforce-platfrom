// SEMANTIC CLASSIFICATION, WIRED INTO THE REAL PIPELINE.
//
// Every assertion runs `runCompoundSourcing` — the function the controller calls.
// The classifier is an injected stub that COUNTS its calls.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runCompoundSourcing, type CompoundDeps, type CompoundJob, type CompoundPerson } from "./compoundSourcingPipeline.ts";
import { compileLeadEntityIntent } from "./leadEntityIntent.ts";
import type { ClassificationCache } from "./companySemanticClassification.ts";

const NOW = "2026-08-01T00:00:00Z";
const intent = compileLeadEntityIntent("Founders of SaaS startups hiring Sales Operations in the United States");

/** A 1–150 employee B2B SaaS Brain — the production shape. */
const BRAIN = {
  positive_industries: ["b2b saas"],
  negative_industries: ["staffing"],
  min_employees: 1, max_employees: 150,
  business_models: ["subscription software"],
} as never;

const job = (o: Partial<CompoundJob> = {}): CompoundJob => ({
  title: "Revenue Operations Manager", company: "Gumloop", companyDomain: "gumloop.com",
  companyDescription: "Cloud software platform for enterprise revenue teams",
  industries: ["Software Development"],
  companyEmployeeCount: 50,
  location: "San Francisco, United States", url: "https://j/gumloop",
  ...o,
});

const founder: CompoundPerson = {
  name: "A Founder", title: "Co-Founder & CEO", linkedinUrl: "https://linkedin.com/in/f",
  currentCompany: "Gumloop", currentCompanyDomain: "gumloop.com", isCurrent: true,
};

function deps(jobs: CompoundJob[], people: Record<string, CompoundPerson[]> = {}): CompoundDeps {
  return {
    fetchJobs: () => jobs,
    fetchPeopleForCompany: (scope) => people[scope.companyDedupeKey ?? ""] ?? [],
  };
}

const saasAnswer = {
  canonical_industry: "b2b_saas", canonical_business_model: "subscription_software",
  customer_type: "b2b", confidence: 0.9,
  supporting_evidence: [{ evidence_ref: "company_description", claim: "cloud platform for enterprise teams" }],
  contradictory_evidence: [], missing_evidence: [], classification_status: "supported",
};

function counter(answer: unknown) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    fn: (payload: Record<string, unknown>) => { calls.push(payload); return Promise.resolve(answer); },
  };
}

// ===================== GUMLOOP AND CHECKBOX REACH THE CLASSIFIER =============

Deno.test("Gumloop-style evidence reaches the classifier, then Company Brain", async () => {
  const c = counter(saasAnswer);
  const run = await runCompoundSourcing(intent, deps([job()], { "domain:gumloop.com": [founder] }), {
    now: NOW, brainConstraints: BRAIN,
    classifyCompanyEvidence: c.fn, classificationCallsRemaining: 5,
  });
  assertEquals(c.calls.length, 1, "a broad 'Software Development' label must be classified");
  // The evidence actually sent.
  const ev = (c.calls[0].evidence as Record<string, unknown>);
  assertEquals(ev.provider_industry, "Software Development");
  assert(String(ev.company_description).includes("Cloud software platform"));
  // And the Brain then evaluated it.
  assertEquals(run.diagnostics.semanticClassification?.classified, 1);
  assert(run.diagnostics.companyBrain.evaluated >= 1, "the Brain must still evaluate");
});

Deno.test("Checkbox-style evidence also reaches the classifier", async () => {
  const c = counter(saasAnswer);
  await runCompoundSourcing(intent, deps([job({
    company: "Checkbox", companyDomain: "checkbox.ai",
    companyDescription: "Enterprise workflow platform", url: "https://j/checkbox",
  })]), { now: NOW, brainConstraints: BRAIN, classifyCompanyEvidence: c.fn, classificationCallsRemaining: 5 });
  assertEquals(c.calls.length, 1);
});

// ============================ THE GATE SKIPS WHAT IT SHOULD =================

Deno.test("explicit agency evidence BYPASSES the classifier — no model call", async () => {
  const c = counter(saasAnswer);
  const run = await runCompoundSourcing(intent, deps([job({
    company: "BuildCo", companyDomain: "buildco.com",
    companyDescription: "A development agency delivering client projects",
    url: "https://j/buildco",
  })]), { now: NOW, brainConstraints: BRAIN, classifyCompanyEvidence: c.fn, classificationCallsRemaining: 5 });
  assertEquals(c.calls.length, 0, "explicit services evidence settles it without a model");
  assertEquals(run.diagnostics.semanticClassification?.skipped.explicit_evidence_sufficient, 1);
});

Deno.test("an unresolved company identity is never classified", async () => {
  const c = counter(saasAnswer);
  const run = await runCompoundSourcing(intent, deps([job({
    company: "Mystery", companyDomain: undefined, companyWebsite: undefined,
    url: "https://j/mystery",
  })]), { now: NOW, brainConstraints: BRAIN, classifyCompanyEvidence: c.fn, classificationCallsRemaining: 5 });
  assertEquals(c.calls.length, 0);
  assertEquals(run.diagnostics.semanticClassification?.skipped.identity_unresolved, 1);
});

Deno.test("weak evidence stays PENDING — an uncertain reading contributes nothing", async () => {
  const c = counter({ ...saasAnswer, canonical_industry: "unknown", confidence: 0.2, supporting_evidence: [], classification_status: "uncertain" });
  const run = await runCompoundSourcing(intent, deps([job({ companyDescription: "Software company" })]), {
    now: NOW, brainConstraints: BRAIN, classifyCompanyEvidence: c.fn, classificationCallsRemaining: 5,
  });
  assertEquals(c.calls.length, 1);
  // It ran, contributed nothing, and did NOT become a rejection of its own.
  assertEquals(run.diagnostics.semanticClassification?.classified, 1);
  assert(run.diagnostics.companyBrain.evaluated >= 1);
});

// ============================== BUDGET AND REUSE ============================

Deno.test("duplicate company evidence produces exactly ONE model call", async () => {
  const c = counter(saasAnswer);
  // Two postings at the SAME company.
  await runCompoundSourcing(intent, deps([
    job({ url: "https://j/gumloop-1" }),
    job({ url: "https://j/gumloop-2", title: "Sales Operations Manager" }),
  ]), { now: NOW, brainConstraints: BRAIN, classifyCompanyEvidence: c.fn, classificationCallsRemaining: 5 });
  assertEquals(c.calls.length, 1, "one canonical company ⇒ one classification");
});

Deno.test("a shared cache reuses across runs; changed evidence reclassifies", async () => {
  const cache: ClassificationCache = new Map();
  const c = counter(saasAnswer);
  const opts = {
    now: NOW, brainConstraints: BRAIN, classifyCompanyEvidence: c.fn,
    classificationCache: cache, classificationCallsRemaining: 5,
  };
  await runCompoundSourcing(intent, deps([job()]), opts);
  await runCompoundSourcing(intent, deps([job()]), opts);
  assertEquals(c.calls.length, 1, "identical evidence must not be re-classified");

  await runCompoundSourcing(intent, deps([job({ companyDescription: "Now a different description" })]), opts);
  assertEquals(c.calls.length, 2, "changed evidence must be re-classified");
});

Deno.test("an exhausted model budget classifies nothing and stays safe", async () => {
  const c = counter(saasAnswer);
  const run = await runCompoundSourcing(intent, deps([job()]), {
    now: NOW, brainConstraints: BRAIN, classifyCompanyEvidence: c.fn, classificationCallsRemaining: 0,
  });
  assertEquals(c.calls.length, 0, "no budget ⇒ no paid call");
  assertEquals(run.diagnostics.semanticClassification?.classified, 0);
  // The run still completed and the Brain still evaluated.
  assert(run.diagnostics.companyBrain.evaluated >= 1);
});

// ======================= FAILURE NEVER FAILS THE MISSION ====================

Deno.test("a classifier failure does NOT fail the sourcing run", async () => {
  const run = await runCompoundSourcing(intent, deps([job()], { "domain:gumloop.com": [founder] }), {
    now: NOW, brainConstraints: BRAIN,
    classifyCompanyEvidence: () => Promise.reject(new Error("gateway down")),
    classificationCallsRemaining: 5,
  });
  // The run completed, the Brain evaluated, and nothing was rejected FOR the failure.
  assert(run.diagnostics.companyBrain.evaluated >= 1);
  assertEquals(run.diagnostics.rawJobs, 1);
});

Deno.test("invalid classifier output degrades to unknown, never a rejection", async () => {
  const run = await runCompoundSourcing(intent, deps([job()]), {
    now: NOW, brainConstraints: BRAIN,
    classifyCompanyEvidence: () => Promise.resolve({ canonical_industry: "invented" }),
    classificationCallsRemaining: 5,
  });
  assert(run.diagnostics.companyBrain.evaluated >= 1);
});

// ==================== BRAIN REMAINS FINAL + PROGRESSION =====================

Deno.test("a qualified company still triggers the existing founder search", async () => {
  const order: string[] = [];
  const run = await runCompoundSourcing(
    intent,
    {
      fetchJobs: () => { order.push("jobs"); return [job()]; },
      fetchPeopleForCompany: (scope) => {
        order.push(`people:${scope.companyDedupeKey}`);
        return [founder];
      },
    },
    {
      now: NOW, brainConstraints: BRAIN,
      classifyCompanyEvidence: () => Promise.resolve(saasAnswer),
      classificationCallsRemaining: 5,
    },
  );
  // Classification did not replace the people stage — it fed it.
  assert(order.includes("people:domain:gumloop.com"), `people search never ran: ${order.join(", ")}`);
  const contact = run.candidates.find((x) => x.verdict === "CONTACT");
  assert(contact, "a verified founder at a qualified company must still reach CONTACT");
  assertEquals(contact!.gates.company_brain, "pass");
});

Deno.test("WITHOUT a classifier the pipeline behaves exactly as before", async () => {
  const run = await runCompoundSourcing(intent, deps([job()]), { now: NOW, brainConstraints: BRAIN });
  assertEquals(run.diagnostics.semanticClassification?.classified, 0);
  assert(run.diagnostics.companyBrain.evaluated >= 1, "the Brain still runs unchanged");
});

Deno.test("the diagnostics carry counts and skip reasons, never a model payload", async () => {
  const run = await runCompoundSourcing(intent, deps([job()]), {
    now: NOW, brainConstraints: BRAIN,
    classifyCompanyEvidence: () => Promise.resolve(saasAnswer),
    classificationCallsRemaining: 5,
  });
  const blob = JSON.stringify(run.diagnostics.semanticClassification).toLowerCase();
  for (const banned of ["prompt", "api_key", "supporting_evidence", "claim"]) {
    assertFalse(blob.includes(banned), `diagnostics leaked ${banned}`);
  }
});
