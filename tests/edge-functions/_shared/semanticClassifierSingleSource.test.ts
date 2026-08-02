// ONE SEMANTIC CLASSIFIER, REACHED ONE WAY.
//
// Two classifier modules existed at once — `companySemanticClassification.ts`
// (wired through the pipeline) and `semanticCompanyClassification.ts` (zero
// callers). Their names differ by a single word transposition, so the orphan
// read as the real thing at a glance and would eventually have been edited or
// imported by mistake.
//
// The orphan is deleted. This guard exists so the situation cannot return
// quietly: it fails if a second classifier appears, if the wired path stops
// going through the canonical module, or if anything imports the deleted name.
//
// Source assertions, because the defect is structural — the orphan's own unit
// tests all passed while nothing called it.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hasProductBusinessMarkers,
  hasServiceBusinessMarkers,
  validateClassification,
  type CompanyEvidenceInput,
} from "../../../supabase/functions/_shared/companySemanticClassification.ts";

const sharedDir = new URL("../../../supabase/functions/_shared/", import.meta.url);
const read = (rel: string) => Deno.readTextFile(new URL(rel, import.meta.url));

/** Every .ts under _shared, recursively. */
async function sharedFiles(): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: URL, prefix: string) => {
    for await (const e of Deno.readDir(dir)) {
      if (e.isDirectory) await walk(new URL(`${e.name}/`, dir), `${prefix}${e.name}/`);
      else if (e.name.endsWith(".ts")) out.push(`${prefix}${e.name}`);
    }
  };
  await walk(sharedDir, "");
  return out;
}

// ================== 1. EXACTLY ONE CANONICAL CLASSIFIER =====================

Deno.test("1. the canonical classifier exists and the orphan is gone", async () => {
  const canonical = await read("../../../supabase/functions/_shared/companySemanticClassification.ts");
  assert(canonical.includes("export async function classifyCompany("),
    "the canonical module must own the classify entry point");
  assert(canonical.includes("export function validateClassification("),
    "and the deterministic validation");
  assert(canonical.includes("export function brainEvidenceFrom("),
    "and the Brain-facing projection");

  await assertRejects(
    () => Deno.stat(new URL("../../../supabase/functions/_shared/semanticCompanyClassification.ts", import.meta.url)),
    "the orphaned classifier module must not exist",
  );
  await assertRejects(
    () => Deno.stat(new URL("../../../supabase/functions/_shared/semanticCompanyClassification.test.ts", import.meta.url)),
    "nor its isolated tests",
  );
});

async function assertRejects(fn: () => Promise<unknown>, msg: string) {
  let existed = true;
  try { await fn(); } catch { existed = false; }
  assertFalse(existed, msg);
}

Deno.test("2. no second module declares a rival classify entry point", async () => {
  const files = await sharedFiles();
  const offenders: string[] = [];
  for (const f of files) {
    if (f === "companySemanticClassification.ts" || f.endsWith(".test.ts")) continue;
    const src = await read(`../../../supabase/functions/_shared/${f}`);
    // A rival would export its own company-classification entry point rather
    // than calling the canonical one.
    if (/export\s+(async\s+)?function\s+classifyCompany\s*\(/.test(src)) offenders.push(f);
  }
  assertEquals(offenders, [], "only the canonical module may export a company classifier");
});

// ============ 3. NOTHING REFERENCES THE DELETED MODULE ANYWHERE =============

Deno.test("3. no file imports or names the deleted module", async () => {
  const files = await sharedFiles();
  const offenders: string[] = [];
  const self = "semanticClassifierSingleSource.test.ts";
  for (const f of files) {
    if (f === self) continue;   // this guard names the deleted module on purpose
    const src = await read(`../../../supabase/functions/_shared/${f}`);
    if (src.includes("semanticCompanyClassification")) offenders.push(`_shared/${f}`);
  }
  for (const rel of ["../../../supabase/functions/run-agent/index.ts", "../../../supabase/functions/_shared/compoundSourcingPipeline.ts"]) {
    if ((await read(rel)).includes("semanticCompanyClassification")) offenders.push(rel);
  }
  assertEquals(offenders, [], "the deleted module must not be referenced");
});

// ================= 4. THE PIPELINE USES THE CANONICAL MODULE ================

Deno.test("4. compoundSourcingPipeline classifies through the canonical module", async () => {
  const src = await read("../../../supabase/functions/_shared/compoundSourcingPipeline.ts");
  assert(src.includes('from "../../../supabase/functions/_shared/companySemanticClassification.ts"'),
    "the pipeline must import the canonical classifier");
  for (const symbol of ["classifyCompany", "shouldClassify", "brainEvidenceFrom"]) {
    assert(src.includes(symbol), `the pipeline must use ${symbol}`);
  }
  // The gate decides whether to spend a call; the projection decides what the
  // Brain is told. Losing either turns the classifier into an unbounded cost or
  // an unearned pass. Compared in the BODY — the import list names both in
  // whatever order it likes.
  const body = src.slice(src.lastIndexOf("\nimport "));
  assert(body.indexOf("shouldClassify({") < body.indexOf("await classifyCompany({"),
    "the gate must run before the model call");
});

// ========= 5. run-agent REACHES IT THROUGH THE BINDING, NOT DIRECTLY ========

Deno.test("5. run-agent reaches the classifier only via semanticClassificationBinding", async () => {
  const src = await read("../../../supabase/functions/run-agent/index.ts");
  assert(src.includes('from "../../../supabase/functions/_shared/semanticClassificationBinding.ts"'),
    "run-agent must import the binding");
  assert(src.includes("buildSemanticClassificationBinding("),
    "and build the binding at the call site");

  // The binding owns the flag, the pinned model and the allowance. Importing the
  // classifier directly would bypass all three.
  assertFalse(src.includes("companySemanticClassification.ts"),
    "run-agent must NOT import the classifier directly");
  assertFalse(src.includes("classifyCompany("),
    "run-agent must not call the classifier itself");
});

Deno.test("6. the binding is the only place that decides whether to classify", async () => {
  const binding = await read("../../../supabase/functions/_shared/semanticClassificationBinding.ts");
  for (const gate of [
    "SEMANTIC_COMPANY_CLASSIFICATION",
    "isSemanticClassificationEnabled",
    "DEFAULT_CLASSIFICATION_MODEL",
    "allowEscalation: false",
  ]) {
    assert(binding.includes(gate), `the binding must own ${gate}`);
  }
});

// ====== 7. THE MIGRATED BEHAVIOR: AGENCY EVIDENCE CONTRADICTS A SAAS READING =

const agencyEvidence = (over: Partial<CompanyEvidenceInput> = {}): CompanyEvidenceInput => ({
  company_key: "acme", company_name: "Acme", provider_industry: "Software Development",
  company_description: "We deliver software for enterprise clients",
  product_description: null, website: "acme.com", customer_type_evidence: null,
  company_type: "Privately Held",
  business_model_evidence: "retainer and statement of work engagements",
  software_evidence: null, pricing_evidence: null,
  source_refs: ["li_company"], missing_fields: [],
  ...over,
});

const saasAnswer = {
  canonical_industry: "b2b_saas",
  canonical_business_model: "subscription_software",
  customer_type: "b2b",
  confidence: 0.95,
  supporting_evidence: [{ evidence_ref: "li_company", claim: "sells software to businesses" }],
  contradictory_evidence: [],
  missing_evidence: [],
  classification_status: "supported",
};

Deno.test("7. a confident SaaS reading backed by agency evidence is contradicted", () => {
  const v = validateClassification(saasAnswer, agencyEvidence());
  assertEquals(v.classification.classification_status, "contradicted",
    "retainer/SOW evidence must stop a b2b_saas reading reaching the Brain as supported");
  assert(v.repairs.includes("status_downgraded_service_evidence"));
  assertFalse(v.ok);
});

Deno.test("7b. genuine product evidence protects a real SaaS company", () => {
  // "billable" appears in plenty of real product companies. The override must
  // not fire when the company also shows an owned product.
  const v = validateClassification(saasAnswer, agencyEvidence({
    product_description: "Our cloud platform with per-seat subscription pricing and a free trial",
  }));
  assertEquals(v.classification.classification_status, "supported",
    "a real product company must not be downgraded by one service-sounding word");
});

Deno.test("7c. the override only touches SaaS readings", () => {
  const v = validateClassification(
    { ...saasAnswer, canonical_industry: "software_agency", canonical_business_model: "project_based" },
    agencyEvidence(),
  );
  assertEquals(v.classification.classification_status, "supported",
    "an agency correctly read as an agency needs no repair");
});

Deno.test("7d. the markers read every evidence field, not just the description", () => {
  // This is the gap the deleted module covered: the gate sees industry and
  // description only, and this evidence lives elsewhere.
  assert(hasServiceBusinessMarkers(agencyEvidence({
    company_description: "Enterprise software", business_model_evidence: "billable hourly rate",
  })), "business-model evidence must be read");
  assert(hasServiceBusinessMarkers(agencyEvidence({
    company_description: "Enterprise software", business_model_evidence: null,
    pricing_evidence: "monthly retainer",
  })), "pricing evidence must be read");
  assertFalse(hasServiceBusinessMarkers(agencyEvidence({
    company_description: "Enterprise cloud software", business_model_evidence: null,
  })), "clean evidence must not trip the markers");
  assert(hasProductBusinessMarkers(agencyEvidence({ pricing_evidence: "per-seat pricing plans" })));
});
