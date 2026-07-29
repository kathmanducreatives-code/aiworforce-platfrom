// SINGLE SOURCE OF TRUTH for job-family classification.
//
// Runtime sourcing/qualification, hard gates, benchmark normalization, and
// why-now generation must all agree on "is this role Sales/Revenue Operations?"
// vs a generic sales role (AE/AM/SDR/BDR). This module is pure + deterministic so
// the same title always yields the same family everywhere (spec §8 — no divergent
// classifiers). The benchmark re-exports these; the runtime imports them.

export type JobFamily =
  | "sales_ops"
  | "rev_ops"
  | "gtm_ops"
  | "commercial_ops"
  | "sales_enablement_ops"
  | "business_ops"
  | "marketing_ops"
  | "manufacturing_ops"
  | "finance_ops"
  | "people_ops"
  | "sales_generic"
  | "support"
  | "other";

const SALES_OPS_RE = /\b(sales operations|sales ops|sales strategy (?:and|&) operations|sales (?:strategy|planning) (?:and|&) operations|deal desk)\b/i;
const REV_OPS_RE = /\b(revenue operations|rev ops|revops|revenue strategy (?:and|&) operations)\b/i;
const GTM_OPS_RE = /\b(gtm operations|go[- ]to[- ]market operations|gtm ops)\b/i;
// "Growth Operations" is NOT an unconditional GTM-operations alias. It was one,
// and that is how a broadening round into "Growth Operations" filled the funnel
// with growth-marketing, user-growth and general strategy roles that carry no
// revenue remit at all. It follows the same rule as commercial/business ops:
// admissible only with explicit revenue, sales or GTM scope.
const GROWTH_OPS_RE = /\b(growth operations|growth ops)\b/i;
const COMMERCIAL_OPS_RE = /\b(commercial operations|commercial ops)\b/i;
const SALES_ENABLEMENT_OPS_RE = /\b(sales enablement operations|sales enablement (?:and|&) operations|revenue enablement operations)\b/i;
const BUSINESS_OPS_RE = /\b(business operations|biz ops|business ops)\b/i;
const MARKETING_OPS_RE = /\b(marketing operations|marketing ops|mops)\b/i;
const MANUFACTURING_OPS_RE = /\b(manufacturing operations|plant operations|production operations|warehouse operations|supply chain operations)\b/i;
const FINANCE_OPS_RE = /\b(finance operations|financial operations|accounting operations|fin ?ops)\b/i;
const PEOPLE_OPS_RE = /\b(people operations|hr operations|people ops)\b/i;
const SUPPORT_RE = /\b(customer support|customer success|support (?:agent|representative|specialist))\b/i;
const SALES_GENERIC_RE = /\b(account executive|sales representative|sales rep|sales development representative|business development representative|\bsdr\b|\bbdr\b|sales manager|account manager|inside sales)\b/i;
// A revenue/sales scope that lets an otherwise-ambiguous ops role (marketing ops,
// business ops, commercial ops) count as the Sales/Revenue-Operations family.
const REVENUE_SCOPE_RE = /\b(revenue|sales operations|pipeline|gtm|go[- ]to[- ]market|quota|forecast(?:ing)?|deal desk|revops|crm|territory|comp(?:ensation)? plan|sales process)\b/i;

export interface JobFamilyResult {
  family: JobFamily;
  /** The exact phrase that matched, for the evidence/audit trail. */
  matchedPhrase: string | null;
  /** True when this is a Sales/Revenue-Operations family the hiring gate accepts. */
  qualifiesAsSalesOps: boolean;
  /** 0..1 — high for direct matches, lower for scope-inferred matches. */
  confidence: number;
}

/** Classify a job title/description into a coarse family (deterministic). */
export function classifyJobFamily(title: string | null, description: string | null): JobFamilyResult {
  const hay = [title ?? "", description ?? ""].join("  ").trim();
  const first = (re: RegExp): string | null => {
    const m = re.exec(hay);
    return m ? m[0] : null;
  };
  const hasRevenueScope = REVENUE_SCOPE_RE.test(hay);

  let m: string | null;
  if ((m = first(SALES_OPS_RE))) return { family: "sales_ops", matchedPhrase: m, qualifiesAsSalesOps: true, confidence: 1 };
  if ((m = first(REV_OPS_RE))) return { family: "rev_ops", matchedPhrase: m, qualifiesAsSalesOps: true, confidence: 1 };
  if ((m = first(GTM_OPS_RE))) return { family: "gtm_ops", matchedPhrase: m, qualifiesAsSalesOps: true, confidence: 0.95 };
  if ((m = first(GROWTH_OPS_RE))) {
    // With revenue scope it is a GTM-operations role by another name; without it
    // this is a growth/marketing role and must not enter a RevOps funnel.
    return hasRevenueScope
      ? { family: "gtm_ops", matchedPhrase: m, qualifiesAsSalesOps: true, confidence: 0.75 }
      : { family: "other", matchedPhrase: m, qualifiesAsSalesOps: false, confidence: 0.3 };
  }
  if ((m = first(SALES_ENABLEMENT_OPS_RE))) return { family: "sales_enablement_ops", matchedPhrase: m, qualifiesAsSalesOps: true, confidence: 0.9 };
  if ((m = first(COMMERCIAL_OPS_RE))) {
    // Commercial ops qualifies only with explicit revenue/sales scope.
    return { family: "commercial_ops", matchedPhrase: m, qualifiesAsSalesOps: hasRevenueScope, confidence: hasRevenueScope ? 0.8 : 0.4 };
  }
  if ((m = first(BUSINESS_OPS_RE))) {
    // Business ops qualifies only when duties clearly cover sales/revenue.
    return { family: "business_ops", matchedPhrase: m, qualifiesAsSalesOps: hasRevenueScope, confidence: hasRevenueScope ? 0.7 : 0.3 };
  }
  if ((m = first(MARKETING_OPS_RE))) {
    return { family: "marketing_ops", matchedPhrase: m, qualifiesAsSalesOps: hasRevenueScope, confidence: hasRevenueScope ? 0.6 : 0.5 };
  }
  if ((m = first(MANUFACTURING_OPS_RE))) return { family: "manufacturing_ops", matchedPhrase: m, qualifiesAsSalesOps: false, confidence: 0.9 };
  if ((m = first(FINANCE_OPS_RE))) return { family: "finance_ops", matchedPhrase: m, qualifiesAsSalesOps: false, confidence: 0.9 };
  if ((m = first(PEOPLE_OPS_RE))) return { family: "people_ops", matchedPhrase: m, qualifiesAsSalesOps: false, confidence: 0.9 };
  if ((m = first(SUPPORT_RE))) return { family: "support", matchedPhrase: m, qualifiesAsSalesOps: false, confidence: 0.85 };
  if ((m = first(SALES_GENERIC_RE))) return { family: "sales_generic", matchedPhrase: m, qualifiesAsSalesOps: false, confidence: 0.9 };
  return { family: "other", matchedPhrase: null, qualifiesAsSalesOps: false, confidence: 0.2 };
}
