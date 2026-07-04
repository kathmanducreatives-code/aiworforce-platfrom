// Lead-quality proof gate — candidate acceptance control (Phase 2 + 3).
//
// Phase 1 stopped losing source data. This module (a) defines the shared,
// source-agnostic NormalizedCompanyCandidate contract so downstream code no
// longer depends on Apify-specific field names, and (b) enforces PROOF GATES +
// SCORE CAPS so weak / proofless / off-ICP companies do not enter Workbench as
// strong opportunities. Scout casts a wide net; the gate rejects aggressively.
//
// Pure / import-free so it is fully unit-testable. Never invents data or URLs.

// ---------- Phase 2: normalized candidate contract ----------
export interface SourceProof {
  url: string;
  type: "job_posting" | "company_website" | "linkedin_company" | "funding" | "post" | "provider_profile";
  title?: string | null;
  snippet?: string | null;
  confidence: number;
}
export type SourceQuality = "verified" | "partial" | "incomplete";
export interface NormalizedCompanyCandidate {
  companyName: string;
  website: string | null;
  domain: string | null;
  linkedinUrl: string | null;
  sourceType: "hiring" | "company_search" | "post_search" | "funding" | "website" | "other";
  sourceProof: SourceProof[];
  sourceQuality: SourceQuality;
  signalType: "hiring" | "funding" | "post" | "competitor_mention" | "workflow_signal" | "company_search";
  signalSummary: string;
  exactHiringSignal: string | null;
  jobTitle: string | null;
  jobUrl: string | null;
  jobDescription: string | null;
  companyDescription: string | null;
  industryEvidence: string[];
  employeeCount: number | null;
  employeeRange: string | null;
  location: string | null;
  hq: string | null;
  posterContactHint?: { name: string | null; profileUrl: string | null; title: string | null };
  raw: Record<string, unknown>;
}

function s(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : (typeof v === "number" ? String(v) : null); }
function arr(v: unknown): string[] { return Array.isArray(v) ? v.map((x) => s(x)).filter((x): x is string => !!x) : (s(v) ? [s(v)!] : []); }
function num(v: unknown): number | null { if (typeof v === "number" && Number.isFinite(v)) return v; const m = String(v ?? "").replace(/[,\s]/g, "").match(/(\d+)/); return m ? Number(m[1]) : null; }

/**
 * Adapt a run-agent item + its raw payload into the normalized contract. Prefers
 * the clean Phase-1 fields, then legacy provider fields; missing → null/[]. No
 * invention. Keeps the raw payload for debugging.
 */
export function toNormalizedCandidate(item: { name?: unknown; company?: unknown; title?: unknown; source_url?: unknown; location?: unknown; raw?: unknown }, sourceType: NormalizedCompanyCandidate["sourceType"] = "hiring"): NormalizedCompanyCandidate {
  const r = (item?.raw && typeof item.raw === "object" ? item.raw : {}) as Record<string, unknown>;
  const proof = Array.isArray(r.source_proof) ? (r.source_proof as SourceProof[]) : [];
  const jobUrl = s(r.job_url) ?? s(item.source_url) ?? null;
  const website = s(r.company_website) ?? s(r.website) ?? null;
  const linkedinUrl = s(r.company_linkedin_url) ?? null;
  const jobTitle = s(r.job_title) ?? s(item.title) ?? null;
  const company = s(item.company) ?? s(item.name) ?? s(r.company) ?? "Unknown";
  const signalType: NormalizedCompanyCandidate["signalType"] = sourceType === "hiring" ? "hiring" : sourceType === "company_search" ? "company_search" : "company_search";
  return {
    companyName: company,
    website,
    domain: s(r.domain),
    linkedinUrl,
    sourceType,
    sourceProof: proof,
    sourceQuality: (s(r.source_quality) as SourceQuality) ?? (proof.length ? "partial" : "incomplete"),
    signalType,
    signalSummary: s(r.signal_summary) ?? "",
    exactHiringSignal: s(r.exact_hiring_signal),
    jobTitle,
    jobUrl,
    jobDescription: s(r.job_description),
    companyDescription: s(r.company_description),
    industryEvidence: arr(r.industries ?? r.industry ?? r.category),
    employeeCount: num(r.employee_count ?? r.companyEmployeesCount ?? r.team_size),
    employeeRange: s(r.employee_range ?? r.companySize),
    location: s(item.location) ?? s(r.location),
    hq: s(r.hq),
    posterContactHint: (r.poster_contact_hint && typeof r.poster_contact_hint === "object") ? r.poster_contact_hint as any : undefined,
    raw: r,
  };
}

// ---------- Phase 3: proof gate ----------
export interface WorkflowIntent {
  isHiring?: boolean;            // hiring/sourcing workflow
  roleQuery?: string;           // the role/query the user asked for (e.g. "RevOps")
  disqualifiers?: string[];     // Company Brain disqualifiers
}
export interface CandidateGateResult {
  decision: "accept" | "needs_verification" | "reject";
  reasons: string[];
  scoreCaps: { maxOverallFit?: number; maxConfidence?: "low" | "medium" };
  missingEvidence: string[];
  disqualifiersHit: string[];
}

// Safe default disqualifier buckets — used only when the Company Brain does not
// supply its own. Broad, obviously-off-ICP giants.
export const DEFAULT_DISQUALIFIERS = [
  "manufacturing", "plant operations", "refinery", "oil", "gas", "mining", "steel",
  "bank", "banking", "insurance", "university", "college", "school district",
  "government", "federal", "military", "defense", "construction", "hospital",
  "staffing agency", "recruiting agency",
];
// Generic operations titles that are NOT a RevOps/GTM/Growth-Ops signal.
const GENERIC_OPS_TITLE = /\b(operations manager|general manager|plant operations|production operations|office operations|facilities? (?:manager|operations)|branch operations|store operations|warehouse operations)\b/i;
// RevOps/GTM intent detector.
const GTM_INTENT_RE = /\b(revops|revenue operations|gtm|go-to-market|growth operations|sales operations|marketing operations)\b/i;
// Evidence a company is actually a software/GTM company.
const SAAS_GTM_EVIDENCE_RE = /\b(saas|software|b2b|platform|api|cloud|app|tech|ai|analytics|crm|marketing|sales tech|fintech|martech)\b/i;

function lc(v: unknown): string { return String(v ?? "").toLowerCase(); }

/** Evaluate a candidate's evidence and return gate decision + score caps. Pure. */
export function applyLeadQualityGate(candidate: NormalizedCompanyCandidate, workflowIntent: WorkflowIntent = {}): CandidateGateResult {
  const reasons: string[] = [];
  const missingEvidence: string[] = [];
  const disqualifiersHit: string[] = [];
  const caps: CandidateGateResult["scoreCaps"] = {};
  let decision: CandidateGateResult["decision"] = "accept";
  const escalate = (d: "needs_verification" | "reject") => {
    if (d === "reject" || decision === "accept") decision = d === "reject" ? "reject" : (decision === "reject" ? "reject" : "needs_verification");
  };
  const capFit = (n: number) => { caps.maxOverallFit = Math.min(caps.maxOverallFit ?? 100, n); };
  const capConf = (c: "low" | "medium") => { caps.maxConfidence = c === "low" ? "low" : (caps.maxConfidence === "low" ? "low" : "medium"); };

  const hay = lc(`${candidate.companyName} ${candidate.companyDescription ?? ""} ${candidate.industryEvidence.join(" ")} ${candidate.jobTitle ?? ""}`);

  // Rule 5 — hard disqualifier (Company Brain, else safe defaults). Reject wins.
  const disquals = (workflowIntent.disqualifiers && workflowIntent.disqualifiers.length ? workflowIntent.disqualifiers : DEFAULT_DISQUALIFIERS).map(lc).filter(Boolean);
  for (const d of disquals) if (d && hay.includes(d)) disqualifiersHit.push(d);
  if (disqualifiersHit.length) {
    decision = "reject"; capFit(0);
    reasons.push(`Rejected because company evidence indicates ${disqualifiersHit[0]}, which is disqualified by the Company Brain.`);
  }

  // Rule 1 — no source proof.
  if (!candidate.sourceProof || candidate.sourceProof.length === 0) {
    escalate("needs_verification"); capFit(30); capConf("medium");
    reasons.push("No verifiable source proof.");
    missingEvidence.push("source_proof");
  }

  // Rule 2 — no company identity.
  if (!candidate.website && !candidate.domain && !candidate.linkedinUrl && !candidate.jobUrl) {
    escalate("needs_verification"); capFit(45);
    reasons.push("No company website, LinkedIn URL, domain, or job source URL.");
    missingEvidence.push("company_identity");
  }

  // Rule 3 — hiring workflow without hiring proof.
  if (workflowIntent.isHiring && !candidate.jobTitle && !candidate.exactHiringSignal && !candidate.jobUrl) {
    escalate("needs_verification"); capFit(40);
    reasons.push("No verified hiring signal.");
    missingEvidence.push("hiring_signal");
  }

  // Rule 4 — missing ICP evidence (does not auto-reject; caps fit + confidence).
  const noIcp = candidate.industryEvidence.length === 0 && !candidate.companyDescription && candidate.employeeCount == null && !candidate.employeeRange;
  if (noIcp) {
    capFit(45); capConf("medium");
    reasons.push("Insufficient ICP evidence.");
    missingEvidence.push("icp_evidence");
  }

  // Rule 6 — generic Operations Manager is not RevOps/GTM.
  const gtmIntent = GTM_INTENT_RE.test(workflowIntent.roleQuery ?? "") || GTM_INTENT_RE.test(candidate.exactHiringSignal ?? "");
  if (gtmIntent && GENERIC_OPS_TITLE.test(candidate.jobTitle ?? "")) {
    const hasSaasEvidence = SAAS_GTM_EVIDENCE_RE.test(`${candidate.companyDescription ?? ""} ${candidate.industryEvidence.join(" ")}`);
    if (!hasSaasEvidence) {
      // No B2B/SaaS/GTM evidence → this generic ops role is not a GTM signal.
      escalate("needs_verification"); capFit(35); capConf("medium");
      reasons.push(`"${candidate.jobTitle}" is a generic operations role — not enough evidence it is a RevOps/GTM hire (company evidence isn't B2B SaaS / GTM).`);
      missingEvidence.push("gtm_role_context");
    }
  }

  if (disqualifiersHit.length) decision = "reject";
  return { decision, reasons, scoreCaps: caps, missingEvidence: [...new Set(missingEvidence)], disqualifiersHit: [...new Set(disqualifiersHit)] };
}
