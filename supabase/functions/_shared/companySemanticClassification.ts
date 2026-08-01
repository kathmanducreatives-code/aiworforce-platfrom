// SEMANTIC COMPANY CLASSIFICATION — interpretation, never qualification.
//
// ── WHY ──────────────────────────────────────────────────────────────────────
// The Company Brain compares literal provider labels. LinkedIn says
// "Software Development"; the workspace ICP says "B2B SaaS"; the strings differ,
// so the gate fails. Production task 15c31f55 rejected Gumloop — a 50-person
// cloud automation platform — partly on exactly that mismatch.
//
// This module adds ONE step BEFORE the Brain: map source-backed evidence onto a
// canonical vocabulary the Brain can compare against. It changes what the Brain
// is TOLD, never what the Brain DECIDES.
//
// ── THE AUTHORITY LINE, WHICH IS THE WHOLE POINT ─────────────────────────────
//   * This module returns a classification. It cannot pass, fail or qualify.
//   * `classification_status` is `supported` | `uncertain` | `contradicted`.
//     None of those is a verdict; all three are inputs to the Brain.
//   * A model failure returns `unknown` + `evidence_pending`, NEVER a rejection.
//     Failing a company because a model timed out would be the worst outcome
//     available — silent, expensive and wrong.
//   * Every `supported` classification must cite evidence refs that exist in the
//     input. `validateClassification` drops a claim that cites nothing, which is
//     what stops a fluent answer becoming fabricated provenance.
//
// The model call itself is INJECTED. Nothing here imports a provider, so the
// whole surface is unit-testable with no gateway.
//
// Pure. No provider, model, network or database access.

export const CLASSIFICATION_POLICY_VERSION = "company-semantic-classification-1.0.0";
export const CLASSIFICATION_SCHEMA_VERSION = "company-classification-result-1.0.0";

export type CanonicalIndustry =
  | "b2b_saas" | "b2c_saas" | "software_platform" | "software_enabled_service"
  | "software_agency" | "marketplace" | "ecommerce" | "professional_services"
  | "non_software" | "unknown";

export type CanonicalBusinessModel =
  | "subscription_software" | "usage_based_software" | "transaction_fee"
  | "services" | "project_based" | "marketplace" | "advertising" | "unknown";

export type CustomerType = "b2b" | "b2c" | "mixed" | "unknown";
export type ClassificationStatus = "supported" | "uncertain" | "contradicted";

export const CANONICAL_INDUSTRIES: readonly CanonicalIndustry[] = [
  "b2b_saas", "b2c_saas", "software_platform", "software_enabled_service",
  "software_agency", "marketplace", "ecommerce", "professional_services",
  "non_software", "unknown",
];
export const CANONICAL_BUSINESS_MODELS: readonly CanonicalBusinessModel[] = [
  "subscription_software", "usage_based_software", "transaction_fee",
  "services", "project_based", "marketplace", "advertising", "unknown",
];

export interface EvidenceClaim {
  evidence_ref: string;
  claim: string;
}

export interface CompanyClassification {
  canonical_industry: CanonicalIndustry;
  canonical_business_model: CanonicalBusinessModel;
  customer_type: CustomerType;
  confidence: number;
  supporting_evidence: EvidenceClaim[];
  contradictory_evidence: EvidenceClaim[];
  missing_evidence: string[];
  classification_status: ClassificationStatus;
}

/** Source-backed evidence only. No inferred fields, no provider identifiers. */
export interface CompanyEvidenceInput {
  company_key: string;
  company_name: string | null;
  provider_industry: string | null;
  company_description: string | null;
  product_description: string | null;
  website: string | null;
  customer_type_evidence: string | null;
  company_type: string | null;
  business_model_evidence: string | null;
  software_evidence: string | null;
  pricing_evidence: string | null;
  /** Refs a claim may cite. A claim citing anything else is dropped. */
  source_refs: string[];
  missing_fields: string[];
}

/** The Brain vocabulary the model is asked to map ONTO. Never a decision. */
export interface BrainVocabulary {
  positive_industries: string[];
  excluded_industries: string[];
  business_models: string[];
  customer_types: string[];
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const lower = (v: unknown): string => str(v).toLowerCase();

function strList(v: unknown, max = 12): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    const s = str(raw);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** The unknown result. Used for every failure path — never a rejection. */
export function unknownClassification(missing: string[] = []): CompanyClassification {
  return {
    canonical_industry: "unknown",
    canonical_business_model: "unknown",
    customer_type: "unknown",
    confidence: 0,
    supporting_evidence: [],
    contradictory_evidence: [],
    missing_evidence: missing.length > 0 ? missing : ["semantic_classification_unavailable"],
    classification_status: "uncertain",
  };
}

// ------------------------------------------------------------- validation ----

export interface ClassificationValidation {
  ok: boolean;
  classification: CompanyClassification;
  errors: string[];
  repairs: string[];
}

/** Confidence below which a `supported` claim is downgraded to `uncertain`. */
export const MIN_SUPPORTED_CONFIDENCE = 0.6;

/**
 * Deterministically validate a model answer.
 *
 * Every repair NARROWS: an unknown enum becomes `unknown`, an uncited claim is
 * dropped, an over-confident answer is downgraded. Nothing here can upgrade a
 * classification, which is what keeps a fluent-but-groundless answer from
 * becoming evidence.
 */
export function validateClassification(
  raw: unknown,
  evidence: CompanyEvidenceInput,
): ClassificationValidation {
  const errors: string[] = [];
  const repairs: string[] = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      classification: unknownClassification(["model_returned_no_object"]),
      errors: ["not_an_object"], repairs: [],
    };
  }
  const o = raw as Record<string, unknown>;

  let industry = lower(o.canonical_industry) as CanonicalIndustry;
  if (!CANONICAL_INDUSTRIES.includes(industry)) {
    errors.push(`unknown_industry:${lower(o.canonical_industry) || "missing"}`);
    industry = "unknown";
    repairs.push("industry_coerced_to_unknown");
  }

  let model = lower(o.canonical_business_model) as CanonicalBusinessModel;
  if (!CANONICAL_BUSINESS_MODELS.includes(model)) {
    errors.push(`unknown_business_model:${lower(o.canonical_business_model) || "missing"}`);
    model = "unknown";
    repairs.push("business_model_coerced_to_unknown");
  }

  let customer = lower(o.customer_type) as CustomerType;
  if (!["b2b", "b2c", "mixed", "unknown"].includes(customer)) {
    customer = "unknown";
    repairs.push("customer_type_coerced_to_unknown");
  }

  const conf = Number(o.confidence);
  const confidence = Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0;

  // EVERY CLAIM MUST CITE A REF THAT EXISTS. This is what makes "supported"
  // mean something: a claim citing a ref nobody supplied is not evidence.
  const refs = new Set(evidence.source_refs);
  const readClaims = (v: unknown, label: string): EvidenceClaim[] => {
    if (!Array.isArray(v)) return [];
    const out: EvidenceClaim[] = [];
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const c = item as Record<string, unknown>;
      const ref = str(c.evidence_ref);
      const claim = str(c.claim).slice(0, 240);
      if (!ref || !claim) continue;
      if (!refs.has(ref)) {
        errors.push(`${label}_ref_not_supplied:${ref}`);
        repairs.push(`dropped_uncited_${label}`);
        continue;
      }
      out.push({ evidence_ref: ref, claim });
      if (out.length >= 8) break;
    }
    return out;
  };

  const supporting = readClaims(o.supporting_evidence, "supporting");
  const contradictory = readClaims(o.contradictory_evidence, "contradictory");

  let status = lower(o.classification_status) as ClassificationStatus;
  if (!["supported", "uncertain", "contradicted"].includes(status)) {
    status = "uncertain";
    repairs.push("status_coerced_to_uncertain");
  }

  // A "supported" answer with no surviving citation is not supported.
  if (status === "supported" && supporting.length === 0) {
    status = "uncertain";
    errors.push("supported_without_evidence");
    repairs.push("status_downgraded_no_evidence");
  }
  // Nor is a low-confidence one. A weak answer must never silently pass a gate.
  if (status === "supported" && confidence < MIN_SUPPORTED_CONFIDENCE) {
    status = "uncertain";
    repairs.push("status_downgraded_low_confidence");
  }
  // Contradictory evidence stays VISIBLE: it cannot be a supported pass.
  if (status === "supported" && contradictory.length > 0) {
    status = "contradicted";
    repairs.push("status_downgraded_contradictory_evidence");
  }
  // An unknown industry cannot be a supported classification of anything.
  if (status === "supported" && industry === "unknown") {
    status = "uncertain";
    repairs.push("status_downgraded_unknown_industry");
  }

  return {
    ok: errors.length === 0,
    classification: {
      canonical_industry: industry,
      canonical_business_model: model,
      customer_type: customer,
      confidence,
      supporting_evidence: supporting,
      contradictory_evidence: contradictory,
      missing_evidence: strList(o.missing_evidence).concat(evidence.missing_fields).slice(0, 12),
      classification_status: status,
    },
    errors, repairs,
  };
}

// ------------------------------------------------------------------ reuse ----

/**
 * Reuse key: identity + evidence + policy + schema.
 *
 * Changing any evidence field must invalidate the key, or a stale classification
 * would outlive the facts it was derived from.
 */
export function classificationCacheKey(evidence: CompanyEvidenceInput): string {
  const material = [
    evidence.company_key,
    evidence.provider_industry, evidence.company_description, evidence.product_description,
    evidence.website, evidence.customer_type_evidence, evidence.company_type,
    evidence.business_model_evidence, evidence.software_evidence, evidence.pricing_evidence,
    CLASSIFICATION_POLICY_VERSION, CLASSIFICATION_SCHEMA_VERSION,
  ].map((v) => str(v)).join("");

  let h = 2166136261;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${evidence.company_key}:${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export interface ClassificationRecord {
  key: string;
  classification: CompanyClassification;
  provenance: {
    provider: string | null;
    model: string | null;
    policy_version: string;
    schema_version: string;
    evidence_hash: string;
    validation_errors: string[];
    repairs: string[];
    fallback_reason: string | null;
    latency_ms: number | null;
    usage: Record<string, unknown> | null;
  };
}

export type ClassificationCache = Map<string, ClassificationRecord>;

export interface ClassifyInput {
  evidence: CompanyEvidenceInput;
  vocabulary: BrainVocabulary;
  cache?: ClassificationCache;
  /**
   * The model call. INJECTED — this module holds no gateway.
   * Returning null (disabled, unavailable, malformed) is a normal outcome that
   * resolves to `unknown`, never to a rejection.
   */
  classify?: (payload: Record<string, unknown>) => Promise<unknown>;
  provider?: string | null;
  model?: string | null;
}

/**
 * Classify one company, reusing an identical prior result.
 *
 * A model failure is caught here and returned as `unknown` + a fallback reason:
 * the sourcing mission continues, and the Brain simply sees missing evidence
 * rather than a fabricated verdict.
 */
export async function classifyCompany(input: ClassifyInput): Promise<ClassificationRecord> {
  const key = classificationCacheKey(input.evidence);
  const cached = input.cache?.get(key);
  if (cached) return cached;

  const base = {
    policy_version: CLASSIFICATION_POLICY_VERSION,
    schema_version: CLASSIFICATION_SCHEMA_VERSION,
    evidence_hash: key,
    provider: input.provider ?? null,
    model: input.model ?? null,
  };

  const record = async (): Promise<ClassificationRecord> => {
    if (!input.classify) {
      return {
        key,
        classification: unknownClassification(["classifier_not_configured"]),
        provenance: { ...base, validation_errors: [], repairs: [], fallback_reason: "classifier_not_configured", latency_ms: null, usage: null },
      };
    }
    const started = Date.now();
    let raw: unknown;
    try {
      raw = await input.classify(buildClassificationPayload(input.evidence, input.vocabulary));
    } catch {
      // A classifier failure must NEVER reject a company.
      return {
        key,
        classification: unknownClassification(["classifier_error"]),
        provenance: { ...base, validation_errors: [], repairs: [], fallback_reason: "classifier_error", latency_ms: Date.now() - started, usage: null },
      };
    }
    const v = validateClassification(raw, input.evidence);
    return {
      key,
      classification: v.classification,
      provenance: {
        ...base,
        validation_errors: v.errors, repairs: v.repairs,
        fallback_reason: v.ok ? null : "validation_repaired",
        latency_ms: Date.now() - started, usage: null,
      },
    };
  };

  const out = await record();
  input.cache?.set(key, out);
  return out;
}

/** The sanitized payload sent to the classifier. Evidence and vocabulary only. */
export function buildClassificationPayload(
  evidence: CompanyEvidenceInput,
  vocabulary: BrainVocabulary,
): Record<string, unknown> {
  return {
    policy_version: CLASSIFICATION_POLICY_VERSION,
    schema_version: CLASSIFICATION_SCHEMA_VERSION,
    task: "Map source-backed company evidence onto the canonical vocabulary. You interpret evidence; you do not qualify or reject the company.",
    evidence: {
      company_name: evidence.company_name,
      provider_industry: evidence.provider_industry,
      company_description: evidence.company_description,
      product_description: evidence.product_description,
      website: evidence.website,
      customer_type_evidence: evidence.customer_type_evidence,
      company_type: evidence.company_type,
      business_model_evidence: evidence.business_model_evidence,
      software_evidence: evidence.software_evidence,
      pricing_evidence: evidence.pricing_evidence,
      source_refs: evidence.source_refs,
      missing_fields: evidence.missing_fields,
    },
    brain_vocabulary: vocabulary,
    rules: [
      "Cite an evidence_ref from source_refs for every claim.",
      "Do not infer SaaS from the word 'software' alone.",
      "Agency, consultancy, implementation or project-service evidence is services, not SaaS.",
      "A broad provider label without supporting evidence is unknown, not a guess.",
      "Report contradictory evidence rather than resolving it.",
    ],
    output_schema: {
      canonical_industry: CANONICAL_INDUSTRIES,
      canonical_business_model: CANONICAL_BUSINESS_MODELS,
      customer_type: ["b2b", "b2c", "mixed", "unknown"],
      confidence: "0.0-1.0",
      supporting_evidence: [{ evidence_ref: "string", claim: "string" }],
      contradictory_evidence: [{ evidence_ref: "string", claim: "string" }],
      missing_evidence: ["string"],
      classification_status: ["supported", "uncertain", "contradicted"],
    },
  };
}

// ------------------------------------------------- Brain-facing projection ----

/**
 * Project a classification into the industry/business-model strings the Brain
 * already compares — and ONLY when the classification is `supported`.
 *
 * An `uncertain` or `contradicted` classification contributes NOTHING, so the
 * Brain sees the same missing evidence it would have seen without this module.
 * That is what keeps a low-confidence interpretation from silently passing a
 * hard gate.
 */
export function brainEvidenceFrom(
  c: CompanyClassification,
): { industry: string | null; business_model: string | null; customer_type: string | null } {
  if (c.classification_status !== "supported") {
    return { industry: null, business_model: null, customer_type: null };
  }
  const industryText: Partial<Record<CanonicalIndustry, string>> = {
    b2b_saas: "b2b saas", b2c_saas: "b2c saas", software_platform: "software platform",
    software_enabled_service: "software enabled service", software_agency: "software agency",
    marketplace: "marketplace", ecommerce: "ecommerce",
    professional_services: "professional services", non_software: "non software",
  };
  const modelText: Partial<Record<CanonicalBusinessModel, string>> = {
    subscription_software: "subscription software", usage_based_software: "usage based software",
    transaction_fee: "transaction fee", services: "services", project_based: "project based",
    marketplace: "marketplace", advertising: "advertising",
  };
  return {
    industry: industryText[c.canonical_industry] ?? null,
    business_model: modelText[c.canonical_business_model] ?? null,
    customer_type: c.customer_type === "unknown" ? null : c.customer_type,
  };
}

/** Assert a classification record carries no credential or contact detail. */
export function classificationIsSafe(record: ClassificationRecord): boolean {
  const blob = JSON.stringify(record).toLowerCase();
  const banned = ["api_key", "apikey", "secret", "bearer ", "password", "@gmail", "@outlook", "sk-"];
  return !banned.some((b) => blob.includes(b));
}

// ---------------------------------------------------- when to classify ----

/** Provider labels too broad to decide an ICP on by themselves. */
export const BROAD_INDUSTRY_LABELS: readonly string[] = [
  "software development", "information technology", "it services",
  "computer software", "technology", "internet", "software",
  "information technology & services", "computer & network security",
];

/** Evidence that already settles the question without a model. */
export const EXPLICIT_SERVICE_MARKERS: readonly string[] = [
  "consultancy", "consulting firm", "staffing", "recruiting agency",
  "implementation partner", "systems integrator", "outsourcing",
  "digital agency", "development agency", "marketing agency",
];

export type ClassificationSkipReason =
  | "identity_unresolved"
  | "no_evidence_to_interpret"
  | "explicit_evidence_sufficient"
  | "budget_exhausted"
  | "already_classified";

export interface ClassificationGateInput {
  identityResolved: boolean;
  providerIndustry: string | null;
  companyDescription: string | null;
  /** Already-classified keys, so a repeat is a skip rather than a cache hit. */
  alreadyClassified: boolean;
  modelCallsRemaining: number;
}

export interface ClassificationGate {
  classify: boolean;
  reason: "broad_or_missing_industry" | "ambiguous_evidence" | ClassificationSkipReason;
}

/**
 * Should this company be sent to the semantic classifier?
 *
 * The gate is deliberately narrow. A model call is only worth paying for when a
 * literal comparison CANNOT settle the question — a broad label like "Software
 * Development", or no industry at all. Explicit evidence in either direction
 * already decides it, and interpretation could only muddy a clear answer.
 */
export function shouldClassify(input: ClassificationGateInput): ClassificationGate {
  if (!input.identityResolved) return { classify: false, reason: "identity_unresolved" };
  if (input.alreadyClassified) return { classify: false, reason: "already_classified" };
  if (input.modelCallsRemaining <= 0) return { classify: false, reason: "budget_exhausted" };

  const industry = lower(input.providerIndustry);
  const description = lower(input.companyDescription);
  if (!industry && !description) return { classify: false, reason: "no_evidence_to_interpret" };

  // Explicit services evidence settles it deterministically — no model needed.
  if (EXPLICIT_SERVICE_MARKERS.some((m) => description.includes(m) || industry.includes(m))) {
    return { classify: false, reason: "explicit_evidence_sufficient" };
  }

  // A broad or absent industry label is exactly the case a literal comparison
  // gets wrong: "Software Development" is neither a pass nor a rejection.
  if (!industry || BROAD_INDUSTRY_LABELS.includes(industry)) {
    return { classify: true, reason: "broad_or_missing_industry" };
  }
  // A specific label with a description that may contradict it.
  if (description) return { classify: true, reason: "ambiguous_evidence" };

  return { classify: false, reason: "explicit_evidence_sufficient" };
}
