// Analyst-style lead brief (Phase: analyst quality).
//
// Turns a processed candidate + the derived Company Brain ICP + Scout/gate/Aria
// signals into an evidence-backed lead brief — the "why this appeared / why now /
// what evidence / what's missing / what to do next" that makes Workbench feel
// like Scout & Aria prepared a case, not like Apify dumped a spreadsheet.
//
// Uses ONLY available evidence. Never invents funding, founder-led status,
// employee count, or ICP fit. Agentory positioning ("pipeline before payroll",
// customer acquisition, founder-led sales) is used naturally, not as filler.
//
// Pure / import-free so it is fully unit-testable.

import type { DerivedCompanyIcp } from "./companyBrainIcp.ts";

export type AnalystVerdict = "excellent" | "strong" | "needs_verification" | "weak" | "reject";
export interface LeadAnalystSummary {
  companySnapshot: string;
  signalSummary: string;
  whyThisLeadAppeared: string;
  whyNow: string;
  icpFitSummary: string;
  evidenceSummary: string;
  missingEvidence: string[];
  riskFlags: string[];
  disqualifierExplanation: string | null;
  recommendedNextAction: string;
  outreachAngle: string | null;
  analystVerdict: AnalystVerdict;
}

export interface AnalystInput {
  candidate: {
    company?: string | null; website?: string | null; domain?: string | null; linkedinUrl?: string | null;
    jobTitle?: string | null; jobUrl?: string | null; source_url?: string | null;
    industries?: string[] | string | null; companyDescription?: string | null; jobDescription?: string | null;
    employeeCount?: number | null;
    // A SEPARATE, verifiable funding source (e.g. TechCrunch/press). A funding
    // keyword appearing in the job/company text is NOT proof (Part 4).
    funding_proof_url?: string | null;
  };
  icp: DerivedCompanyIcp;
  gate?: { decision?: string; disqualifiersHit?: string[]; missingEvidence?: string[] } | null;
  aria?: { overall_fit?: number; confidence?: { level?: string } } | null;
  preRank?: { scoutPreRankScore?: number; weakPool?: boolean; scoutPenalties?: string[]; scoutRankReasons?: string[] } | null;
  sourceProof?: Array<{ url: string; type: string }> | null;
}

function lc(s: unknown): string { return String(s ?? "").toLowerCase(); }
function has(text: string, re: RegExp): boolean { return re.test(text); }
function indsStr(v: unknown): string { return Array.isArray(v) ? v.join(", ") : String(v ?? ""); }

const SAAS_RE = /\b(b2b|saas|software|ai|platform|api|cloud|analytics|crm|sales tech|martech|fintech)\b/i;
const REVENUE_ROLE_RE = /\b(revops|revenue operations|sales operations|sales ops|gtm operations|growth operations|head of growth|founding account executive|first sales|customer acquisition|founding ae)\b/i;
const BIZDEV_RE = /\b(business development|bizdev|partnerships?)\b/i;
const GENERIC_OPS_RE = /\b(operations manager|general manager|office manager|plant|production operations?|warehouse|field operations?|facilities)\b/i;
const FUNDING_RE = /\b(series [a-d]\b|seed round|raised|funding|newly funded|just raised|backed by)\b/i;

export function buildLeadAnalystSummary(input: AnalystInput): LeadAnalystSummary {
  const c = input.candidate;
  const icp = input.icp;
  const company = c.company ?? "This company";
  const role = c.jobTitle ?? null;
  const emp = typeof c.employeeCount === "number" ? c.employeeCount : null;
  const industries = indsStr(c.industries);
  const desc = `${c.companyDescription ?? ""} ${c.jobDescription ?? ""}`;
  const combined = lc(`${company} ${industries} ${desc} ${role ?? ""}`);

  const isSaas = has(combined, SAAS_RE);
  const isRevenueRole = has(lc(role ?? ""), REVENUE_ROLE_RE);
  const isBizDev = has(lc(role ?? ""), BIZDEV_RE) && !isRevenueRole;
  const isGenericOps = has(lc(role ?? ""), GENERIC_OPS_RE);
  // A funding keyword in the text is only a *mention*; recent-funding CLAIMS
  // require a separate funding_proof_url (Part 4). Never say "recently funded"
  // / "funding momentum" on the strength of a text match alone.
  const fundingMentioned = has(combined, FUNDING_RE);
  const hasFundingProof = !!(c.funding_proof_url && String(c.funding_proof_url).trim());
  const { max } = icp.targetCompanySize;
  const tooLarge = emp != null && max != null && emp > max;
  const disqHit = input.gate?.disqualifiersHit ?? [];

  // --- evidence + missing ---
  const evidence: string[] = [];
  if (c.jobUrl ?? c.source_url) evidence.push("a live job posting URL");
  if (c.website ?? c.domain) evidence.push("a company website");
  if (c.linkedinUrl) evidence.push("a LinkedIn company page");
  const evidenceSummary = evidence.length
    ? `Verified source proof: ${evidence.join(", ")}.`
    : "No verifiable source proof yet.";

  const missingEvidence: string[] = [];
  if (!hasFundingProof) missingEvidence.push("recent funding proof");
  if (emp == null) missingEvidence.push("employee count");
  if (!isSaas) missingEvidence.push("clear B2B SaaS / software evidence");
  if (!isRevenueRole) missingEvidence.push("a revenue/RevOps/first-sales/founder-led growth signal");
  for (const m of (input.gate?.missingEvidence ?? [])) if (!missingEvidence.includes(m)) missingEvidence.push(m);

  // --- risk flags ---
  const riskFlags: string[] = [];
  if (tooLarge) riskFlags.push(`company appears larger than the ${icp.targetCompanySize.label ?? "target"} ICP (${emp} employees)`);
  if (isBizDev) riskFlags.push("role is Business Development, not RevOps / first sales / founder-led growth");
  if (isGenericOps) riskFlags.push("role is generic operations, not a revenue/growth signal");
  if (icp.weakIcpContext) riskFlags.push("Company Brain ICP is weak / inferred — fit is lower-confidence");

  // --- verdict ---
  const gateReject = input.gate?.decision === "reject" || disqHit.length > 0;
  const fit = typeof input.aria?.overall_fit === "number" ? input.aria!.overall_fit! : null;
  let analystVerdict: AnalystVerdict;
  if (gateReject) analystVerdict = "reject";
  else if (evidence.length === 0) analystVerdict = "needs_verification";
  else if (fit != null && fit >= 80) analystVerdict = "excellent";
  else if (fit != null && fit >= 65 && isSaas && isRevenueRole && !tooLarge) analystVerdict = "strong";
  else if (fit != null && fit < 35) analystVerdict = "weak";
  else if (tooLarge || isBizDev || isGenericOps || !isSaas || missingEvidence.length >= 3) analystVerdict = tooLarge || isBizDev || isGenericOps ? "weak" : "needs_verification";
  else analystVerdict = "needs_verification";

  // --- narratives ---
  const disqualifierExplanation = disqHit.length
    ? `Rejected because the source evidence points to ${disqHit[0]}, which matches Agentory's disqualifiers and does not indicate B2B SaaS revenue-building intent.`
    : null;

  const companySnapshot = [
    company,
    isSaas ? "appears to be a B2B / software company" : "industry/software context is unclear from the evidence",
    emp != null ? `~${emp} employees` : "employee count unknown",
    industries ? `(${industries})` : "",
  ].filter(Boolean).join(" · ");

  const signalSummary = role
    ? `Scout found a hiring signal: ${role}${company !== "This company" ? ` at ${company}` : ""}.`
    : "No clear hiring signal in the current evidence.";

  const whyThisLeadAppeared = gateReject
    ? disqualifierExplanation!
    : isRevenueRole && isSaas && !tooLarge
      ? `Scout found a verified ${role} hiring signal at what appears to be a small B2B SaaS company — a strong match for Agentory's ICP of founders building revenue before adding sales headcount.`
      : `Scout found real proof for ${company} (${evidence.join(", ") || "limited proof"}). It is safe to review, but it is a ${analystVerdict === "weak" ? "weak" : "borderline"} Agentory lead${tooLarge ? ` because the company appears larger than the ${icp.targetCompanySize.label ?? "10–150 employee"} ICP` : ""}${isBizDev ? " and the role is BizDev rather than RevOps, first sales, or founder-led growth" : ""}${isGenericOps ? " and the role is generic operations, not a revenue signal" : ""}.`;

  // Only claim recent funding when there is a SEPARATE funding source URL.
  // A funding word in the post text is not proof — say the proof is missing.
  const whyNow = hasFundingProof
    ? `${company} has recent funding confirmed by a separate source (${c.funding_proof_url}) — a likely moment to build a customer-acquisition motion before adding sales payroll.`
    : isRevenueRole
      ? `The company is actively hiring for ${role}. Shows a GTM hiring signal, but recent funding proof is missing${fundingMentioned ? " (the post mentions funding, but there is no separate funding source to verify it)" : ""} — treat "why now" as the hiring signal, not funding.`
      : `No clear 'why now' signal. Shows a GTM hiring signal, but recent funding proof is missing${fundingMentioned ? " (funding is mentioned in the text but not separately verified)" : ""}.`;

  const sizePart = emp != null ? (tooLarge ? `larger than the ${icp.targetCompanySize.label ?? "target"} range` : "within the target size range") : "size unknown";
  const rolePart = isRevenueRole ? "a revenue/growth-building role" : isBizDev ? "a BizDev role (weaker than RevOps/first-sales)" : isGenericOps ? "a generic operations role (not a revenue signal)" : "an unclear role fit";
  const icpFitSummary = `ICP fit: industry ${isSaas ? "✓ B2B/SaaS" : "✗ unclear"}, size ${sizePart}, signal ${rolePart}${icp.weakIcpContext ? " (ICP context is weak/inferred)" : ""}.`;

  const recommendedNextAction = gateReject
    ? "Do not contact — outside ICP."
    : analystVerdict === "excellent" || analystVerdict === "strong"
      ? "Research the founder and prepare a pipeline-before-payroll outreach angle."
      : analystVerdict === "weak"
        ? "Deprioritize unless stronger growth or founder-led sales evidence is found."
        : "Verify company size, funding/growth, and buyer context before prioritizing.";

  const outreachAngle = (analystVerdict === "excellent" || analystVerdict === "strong")
    ? `Reach the founder with a pipeline-before-payroll angle: help build a repeatable customer-acquisition motion before scaling the ${role} function.`
    : null;

  const weakPoolNote = input.preRank?.weakPool ? " (this was the best available candidate from a weak pool)" : "";

  return {
    companySnapshot,
    signalSummary,
    whyThisLeadAppeared: whyThisLeadAppeared + weakPoolNote,
    whyNow,
    icpFitSummary,
    evidenceSummary,
    missingEvidence,
    riskFlags,
    disqualifierExplanation,
    recommendedNextAction,
    outreachAngle,
    analystVerdict,
  };
}
