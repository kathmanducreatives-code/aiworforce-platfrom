// Hard eligibility gates (section 6).
//
// A lead cannot be CONTACT when any hard gate FAILS. Gates are three-valued:
//   - pass          : the evidence affirmatively satisfies the gate.
//   - fail          : a disqualifier is present (agency, wrong role, off-company
//                     founder, non-US, missing evidence, …) → REJECT.
//   - needs_review  : a stage that would satisfy the gate simply has not run yet
//                     (e.g. no founder discovered), OR evidence is ambiguous.
//                     A needs_review gate blocks CONTACT but does NOT force
//                     REJECT — the lead is still worth WATCHing.
//
// Reuses Agentory's REAL company classifiers (isSaasCompany, detectRecruiterProxy)
// rather than a parallel implementation.

import { detectRecruiterProxy, isSaasCompany } from "../../supabase/functions/_shared/leadMatchTier.ts";
import { classifyJobFamily } from "./normalize.ts";
import type { GateReport, HardGateResult, NormalizedCandidate, ReasonCode } from "./types.ts";

// Explicit non-SaaS business types → hard REJECT on company type.
const NON_SAAS_RE = /\b(agency|consultancy|consulting|staffing|recruit(?:ing|ment)|manufactur(?:er|ing)|e-?commerce|retailer|retail store|restaurant|hospitality|law firm|accounting firm|media (?:company|outlet|publisher)|publishing house|marketing agency|design agency|dev shop)\b/i;

const FOUNDER_RE = /\b(co[- ]?founder|founder|founding (?:ceo|partner))\b/i;
const CEO_RE = /\bceo\b|chief executive officer/i;
const FORMER_RE = /\b(former|ex[- ]|previously|past|retired|stepped down)\b/i;
const NON_FOUNDER_ROLE_RE = /\b(advisor|advisory|investor|board member|consultant|angel|venture partner|mentor|freelance)\b/i;

const US_TEXT_RE = /\b(united states|u\.?s\.?a?\.?|us[- ]based|us remote|remote[- ]?us|usa|american market|new york|san francisco|boston|austin|chicago|seattle|denver|atlanta)\b/i;
const EXCLUDES_US_RE = /\b(excluding (?:the )?us|us not eligible|emea only|apac only|eu only|europe only|uk only|india only)\b/i;

/** Staleness threshold (days). Signals older than this are labelled stale. */
export const STALE_SIGNAL_DAYS = 120;

function gate(id: HardGateResult["id"], outcome: HardGateResult["outcome"], detail: string, reasonCode?: ReasonCode): HardGateResult {
  return reasonCode ? { id, outcome, detail, reasonCode } : { id, outcome, detail };
}

// -------------------------------------------------------- A. company type ----

export function gateCompanyType(n: NormalizedCandidate): HardGateResult {
  const c = {
    company: n.raw.companyName,
    industries: (n.raw.rawMeta?.industries as string[] | undefined) ?? null,
    company_description: (n.raw.rawMeta?.companyDescription as string | undefined) ?? n.raw.jobDescriptionExcerpt ?? null,
    job_title: n.raw.jobTitle,
    job_description: n.raw.jobDescriptionExcerpt,
    source_url: n.raw.sourceUrl,
    employee_count: (n.raw.rawMeta?.employeeCount as number | undefined) ?? null,
  };
  const proxy = detectRecruiterProxy(c);
  if (proxy.isProxy) return gate("company_type", "fail", proxy.reason ?? "Recruiter/staffing proxy.", "not_saas");

  const hay = [n.raw.companyName, c.company_description, (c.industries ?? []).join(" ")].filter(Boolean).join(" ");
  if (NON_SAAS_RE.test(hay)) {
    const m = NON_SAAS_RE.exec(hay);
    return gate("company_type", "fail", `Non-SaaS business type: "${m?.[0]}".`, "not_saas");
  }
  if (isSaasCompany(c)) return gate("company_type", "pass", "Credible software/SaaS evidence in company/role text.");
  return gate("company_type", "needs_review", "No clear SaaS/software evidence — do not assume SaaS.", "insufficient_company_evidence");
}

// ---------------------------------------------------- B. hiring signal role ----

export function gateHiringSignal(n: NormalizedCandidate): HardGateResult {
  if (!n.raw.jobTitle && !n.raw.jobDescriptionExcerpt) {
    return gate("hiring_signal", "needs_review", "No hiring-signal role text available yet.", "hiring_role_mismatch");
  }
  const fam = classifyJobFamily(n.raw.jobTitle, n.raw.jobDescriptionExcerpt);
  if (fam.qualifiesAsSalesOps) {
    return gate("hiring_signal", "pass", `Matched Sales/Revenue-Operations role: "${fam.matchedPhrase}" (${fam.family}).`);
  }
  if (fam.family === "other") {
    return gate("hiring_signal", "needs_review", "Role text present but no operations family detected.", "hiring_role_mismatch");
  }
  return gate("hiring_signal", "fail", `Role "${n.raw.jobTitle ?? fam.matchedPhrase}" is ${fam.family}, not Sales/Revenue Operations.`, "hiring_role_mismatch");
}

// ------------------------------------------------------- C. US relevance ----

export function gateUsRelevance(n: NormalizedCandidate): HardGateResult {
  const hay = [n.raw.jobLocation, n.raw.rawLocation, n.raw.jobDescriptionExcerpt].filter(Boolean).join(" ");
  if (EXCLUDES_US_RE.test(hay)) {
    return gate("us_relevance", "fail", "Role explicitly excludes the United States.", "us_relevance_missing");
  }
  if (n.normalizedCountry === "US") {
    return gate("us_relevance", "pass", "Job country resolves to the United States.");
  }
  if (US_TEXT_RE.test(hay)) {
    return gate("us_relevance", "pass", "Credible US-market / US-remote evidence in location/description.");
  }
  if (n.normalizedCountry && n.normalizedCountry !== "US") {
    return gate("us_relevance", "fail", `Role country is ${n.normalizedCountry}, not the United States.`, "us_relevance_missing");
  }
  return gate("us_relevance", "fail", "Location missing with no credible US evidence.", "us_relevance_missing");
}

// ------------------------------------------------- D. current founder/CEO ----

export function gateFounderRole(n: NormalizedCandidate): HardGateResult {
  const title = n.raw.personTitle;
  if (!n.raw.personName && !title) {
    return gate("founder_role", "needs_review", "No founder/decision-maker discovered yet.", "insufficient_founder_evidence");
  }
  const t = String(title ?? "");
  if (FORMER_RE.test(t)) return gate("founder_role", "fail", `Person is a FORMER founder/leader: "${t}".`, "founder_role_invalid");
  if (NON_FOUNDER_ROLE_RE.test(t) && !FOUNDER_RE.test(t)) {
    return gate("founder_role", "fail", `Person is an advisor/investor/consultant, not a current founder: "${t}".`, "founder_role_invalid");
  }
  if (FOUNDER_RE.test(t)) return gate("founder_role", "pass", `Current founder title: "${t}".`);
  if (CEO_RE.test(t)) {
    // CEO counts only when founder status is supported.
    const supported = (n.raw.rawMeta?.founderSupported as boolean | undefined) === true || /\bfounder\b/i.test(String(n.raw.rawMeta?.personBio ?? ""));
    return supported
      ? gate("founder_role", "pass", `CEO with supported founder status: "${t}".`)
      : gate("founder_role", "needs_review", `CEO but founder status not established: "${t}".`, "insufficient_founder_evidence");
  }
  return gate("founder_role", "fail", `Title "${t}" is not a current founder/CEO role.`, "founder_role_invalid");
}

// -------------------------------------------------- E. current employer ----

export function gateEmployerMatch(n: NormalizedCandidate): HardGateResult {
  if (!n.raw.personName && !n.raw.personTitle) {
    return gate("employer_match", "needs_review", "No founder discovered — employer match not evaluable yet.", "insufficient_founder_evidence");
  }
  if (!n.raw.statedCurrentCompany) {
    return gate("employer_match", "needs_review", "Founder's current employer not yet verified.", "insufficient_founder_evidence");
  }
  if (n.currentEmployerMatch) {
    return gate("employer_match", "pass", `Founder's verified current employer matches "${n.raw.companyName}".`);
  }
  return gate("employer_match", "fail", `Founder's current employer "${n.raw.statedCurrentCompany}" does not match target "${n.raw.companyName}".`, "current_employer_mismatch");
}

// ------------------------------------------------------------ F. evidence ----

export function gateEvidence(n: NormalizedCandidate): HardGateResult {
  if (!n.evidenceUrl) {
    return gate("evidence", "fail", "No evidence URL for the hiring signal.", "evidence_missing");
  }
  const hasFounder = Boolean(n.raw.personName || n.raw.personTitle);
  if (hasFounder && !n.personLinkedinUrl && !n.raw.statedCurrentCompany) {
    return gate("evidence", "needs_review", "Hiring evidence present but founder-company relationship unsupported.", "insufficient_founder_evidence");
  }
  return gate("evidence", "pass", "Hiring evidence URL present" + (hasFounder ? " with founder relationship support." : "."));
}

// --------------------------------------------------------------- report ----

const ALL_GATES = [
  gateCompanyType,
  gateHiringSignal,
  gateUsRelevance,
  gateFounderRole,
  gateEmployerMatch,
  gateEvidence,
];

/** Run every hard gate and summarize. */
export function runHardGates(n: NormalizedCandidate): GateReport {
  const gates = ALL_GATES.map((g) => g(n));
  const failedCodes = gates
    .filter((g) => g.outcome === "fail" && g.reasonCode)
    .map((g) => g.reasonCode as ReasonCode);
  return {
    candidateId: n.candidateId,
    gates,
    allHardPass: gates.every((g) => g.outcome === "pass"),
    anyNeedsReview: gates.some((g) => g.outcome === "needs_review"),
    failedCodes,
  };
}
