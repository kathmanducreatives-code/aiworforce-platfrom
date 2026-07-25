// Vertical-flexible company qualification.
//
// Agentory is NOT hardcoded to SaaS. This module qualifies a company against a
// requested vertical (saas / automation_integrator / manufacturer) deterministically.
// SaaS qualification REUSES the PR #92 recruiter/services guard + isSaasCompany so
// that behavior is preserved exactly (search/advisory over-rejection protection).
// Other verticals are keyword+exclusion configs so new verticals are additive.

import { detectRecruiterProxy, isSaasCompany, type CandidateForTier } from "./leadMatchTier.ts";

export type Vertical = "saas" | "automation_integrator" | "manufacturer";
export type VerticalOutcome = "pass" | "fail" | "needs_review";

export interface CompanyForVertical {
  name?: string | null;
  description?: string | null;
  industries?: string[] | null;
  website_text?: string | null;
  job_title?: string | null;
  job_description?: string | null;
  naics?: string | null;
}

export interface VerticalQualification {
  vertical: Vertical;
  outcome: VerticalOutcome;
  reason: string;
  matched: string | null;
}

function hay(c: CompanyForVertical): string {
  return [c.name, c.description, (c.industries ?? []).join(" "), c.website_text, c.job_description].filter(Boolean).join("  ");
}
function toTier(c: CompanyForVertical): CandidateForTier {
  return { company: c.name, industries: c.industries ?? null, company_description: c.description ?? c.website_text ?? null, job_title: c.job_title, job_description: c.job_description };
}
function first(re: RegExp, s: string): string | null { const m = re.exec(s); return m ? m[0] : null; }

// -- automation integrator --------------------------------------------------
const INTEGRATOR_RE = /\b(system(?:s)? integrat(?:or|ion)|controls? (?:engineering|integration)|plc|scada|hmi|robotic(?:s)? integrat(?:or|ion)|machine vision|packaging automation|palletiz(?:ing|er)|warehouse automation|mes (?:implementation|integration|systems?)|industrial iot|iiot|automation integrator|commission(?:ing)?|panel (?:shop|build)|automation (?:solutions?|engineering))\b/i;
const INTEGRATOR_EXCLUDE_RE = /\b(staffing|recruit(?:ing|ment)|job board|distributor|reseller|wholesaler)\b/i;

// -- manufacturer -----------------------------------------------------------
const MANUFACTURER_RE = /\b(manufactur(?:er|ing|es)|fabricat(?:ion|or|ing)|machin(?:ing|e shop)|cnc|injection molding|plastics? manufactur|contract manufactur|electronics manufactur|packaging manufactur|foundry|stamping|extrusion|production (?:facility|plant)|factory)\b/i;
const MANUFACTURER_NAICS_RE = /\b3[123]\d{2,4}\b/; // NAICS 31-33 family
const MANUFACTURER_EXCLUDE_RE = /\b(distributor|import(?:er|s)?(?:\s+of)?|wholesaler|reseller|staffing|recruit(?:ing|ment)|job board|marketing agency|consult(?:ancy|ing) (?:firm|group))\b/i;

// -- SaaS precision ---------------------------------------------------------
// The v96 run passed "Uber Freight" as SaaS. The gate accepted generic
// technology/platform language; a logistics network that USES software is not a
// company that SELLS software. These are evidence classes, not a company blocklist.

/** The company itself commercially sells a software product/platform. */
// A commercially sold software product. `api`/`sdk`/`hosted <x>` count: shipping a
// developer-facing API IS selling software, and excluding them regressed real
// developer-product fixtures (Algolia-shaped).
const SAAS_PRODUCT_RE = /\b(saas|software[- ]as[- ]a[- ]service|software (?:product|platform|company|suite)|subscription software|cloud (?:software|platform|application)|enterprise software|b2b software|developer (?:platform|tools?)|api|sdk|hosted (?:search|platform|software|service)|data (?:platform|warehouse|infrastructure)|security (?:platform|software)|compliance (?:platform|automation)|crm|erp|application software|open[- ]source (?:database|vector database)|vector database|database company|work management (?:platform|software))\b/i;
/** Words that merely describe using/being adjacent to technology. */
const SAAS_WEAK_RE = /\b(technology|tech[- ]enabled|platform|digital|ai[- ]powered|software[- ]powered|innovative|data[- ]driven|network|marketplace|app)\b/i;
/** Primary business is operating a service/network/marketplace, not selling software. */
const NON_SAAS_BUSINESS_RE = /\b(freight|logistics|trucking|shipping|carrier network|last[- ]mile|delivery (?:network|service)|3pl|supply[- ]chain (?:operator|services)|ride[- ]hailing|food delivery|marketplace for|brokerage|broker|staffing|recruit(?:ing|ment)|talent (?:agency|solutions)|consultanc(?:y|ies)|consulting (?:firm|group|services)|agency|managed services|outsourcing|bpo)\b/i;

export type SaasReasonCode =
  | "software_product_verified" | "technology_enabled_service" | "marketplace_not_saas"
  | "logistics_operator" | "insufficient_product_evidence" | "mixed_business_model";

function qualifySaas(c: CompanyForVertical, text: string): VerticalQualification {
  const product = first(SAAS_PRODUCT_RE, text);
  const nonSaas = first(NON_SAAS_BUSINESS_RE, text);
  const weakOnly = !product && !!first(SAAS_WEAK_RE, text);

  // Operating business + genuine standalone software product → mixed, review it.
  if (product && nonSaas) {
    return { vertical: "saas", outcome: "needs_review", reason: `Mixed business model: software-product evidence ("${product}") alongside "${nonSaas}".`, matched: "mixed_business_model" };
  }
  // Clear software-product evidence, corroborated by the legacy detector.
  if (product) {
    return { vertical: "saas", outcome: "pass", reason: `Sells a software product: "${product}".`, matched: "software_product_verified" };
  }
  // Logistics/marketplace/services operator with no product evidence → fail.
  if (nonSaas) {
    const code: SaasReasonCode = /freight|logistics|trucking|shipping|carrier|3pl|last[- ]mile|delivery/i.test(nonSaas)
      ? "logistics_operator"
      : /marketplace|broker/i.test(nonSaas) ? "marketplace_not_saas" : "technology_enabled_service";
    return { vertical: "saas", outcome: "fail", reason: `Primary business is "${nonSaas}", not a software product.`, matched: code };
  }
  // Only buzzwords → never a confident pass.
  if (weakOnly) {
    return { vertical: "saas", outcome: "needs_review", reason: "Only generic technology/platform language — no evidence the company sells software.", matched: "technology_enabled_service" };
  }
  // Fall back to the legacy detector so existing passing fixtures do not regress.
  if (isSaasCompany(toTier(c))) {
    return { vertical: "saas", outcome: "pass", reason: "Software/SaaS product evidence present.", matched: "software_product_verified" };
  }
  return { vertical: "saas", outcome: "needs_review", reason: "No clear software-product evidence — do not assume SaaS.", matched: "insufficient_product_evidence" };
}

export function qualifyCompanyVertical(c: CompanyForVertical, vertical: Vertical): VerticalQualification {
  const text = hay(c);

  // Universal disqualifiers first: recruiter/staffing/services proxies are never a
  // target in ANY vertical (reuses the guarded PR #92 detector).
  const proxy = detectRecruiterProxy(toTier(c));
  if (proxy.isProxy) return { vertical, outcome: "fail", reason: proxy.reason ?? "Services/recruiter proxy — not a target company.", matched: "recruiter_proxy" };

  if (vertical === "saas") return qualifySaas(c, text);

  if (vertical === "automation_integrator") {
    const ex = first(INTEGRATOR_EXCLUDE_RE, text);
    const m = first(INTEGRATOR_RE, text);
    if (m && !ex) return { vertical, outcome: "pass", reason: `Automation-integration evidence: "${m}".`, matched: m };
    if (ex && !m) return { vertical, outcome: "fail", reason: `Excluded for integrator request: "${ex}" with no integration service.`, matched: ex };
    if (m && ex) return { vertical, outcome: "needs_review", reason: `Mixed integrator + "${ex}" signals — verify integration services.`, matched: m };
    // Software-only product company when an integrator was requested → not a match.
    if (isSaasCompany(toTier(c))) return { vertical, outcome: "fail", reason: "Software-only product company; no integration/engineering services.", matched: "software_only" };
    return { vertical, outcome: "needs_review", reason: "No clear integration/engineering-service evidence.", matched: null };
  }

  // manufacturer
  const mex = first(MANUFACTURER_EXCLUDE_RE, text);
  const mm = first(MANUFACTURER_RE, text) ?? (MANUFACTURER_NAICS_RE.test(c.naics ?? "") ? `NAICS ${c.naics}` : null);
  if (mm && !mex) return { vertical, outcome: "pass", reason: `Manufacturing evidence: "${mm}".`, matched: mm };
  if (mex && !mm) return { vertical, outcome: "fail", reason: `Excluded for manufacturer request: "${mex}" with no manufacturing.`, matched: mex };
  if (mm && mex) return { vertical, outcome: "needs_review", reason: `Mixed manufacturing + "${mex}" signals — verify.`, matched: mm };
  return { vertical, outcome: "needs_review", reason: "No clear manufacturing evidence.", matched: null };
}

/** Map a requested company_category / brain vertical string to a Vertical. Returns
 *  "saas" as the safe default only when the text clearly reads software; otherwise
 *  null so the caller can decide (never silently assume a vertical). */
export function inferRequestedVertical(text: string | null | undefined): Vertical | null {
  const t = (text ?? "").toLowerCase();
  if (/\b(integrator|integration|plc|scada|controls engineering|robotics|machine vision|automation)\b/.test(t)) return "automation_integrator";
  // Prefix stems need \w* — a bare \b after "manufactur" can never match
  // "manufacturer"/"manufacturing", so the vertical silently came back null.
  if (/\b(manufactur\w*|fabricat\w*|machining|factory|factories|foundry|cnc|plastics)\b/.test(t)) return "manufacturer";
  if (/\b(saas|software|b2b software|platform|app|cloud|api)\b/.test(t)) return "saas";
  return null;
}
