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

export function qualifyCompanyVertical(c: CompanyForVertical, vertical: Vertical): VerticalQualification {
  const text = hay(c);

  // Universal disqualifiers first: recruiter/staffing/services proxies are never a
  // target in ANY vertical (reuses the guarded PR #92 detector).
  const proxy = detectRecruiterProxy(toTier(c));
  if (proxy.isProxy) return { vertical, outcome: "fail", reason: proxy.reason ?? "Services/recruiter proxy — not a target company.", matched: "recruiter_proxy" };

  if (vertical === "saas") {
    if (isSaasCompany(toTier(c))) return { vertical, outcome: "pass", reason: "Software/SaaS product evidence present.", matched: "saas" };
    return { vertical, outcome: "needs_review", reason: "No clear software-product evidence — do not assume SaaS.", matched: null };
  }

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
  if (/\b(manufactur|fabricat|machining|factory|foundry|cnc|plastics|contract manufactur)\b/.test(t)) return "manufacturer";
  if (/\b(saas|software|b2b software|platform|app|cloud|api)\b/.test(t)) return "saas";
  return null;
}
