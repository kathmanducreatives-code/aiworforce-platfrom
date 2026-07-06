// Personalization — assembles evidence-backed outreach drafts in Agentory's
// voice. Pure / import-free so it is fully unit-testable in Deno.
//
// Hard rules:
//   - Drafts are ALWAYS status "draft_needs_approval"; nothing is sent.
//   - If the recipient/company evidence is insufficient, it REFUSES to fake
//     personalization and returns status "insufficient_context" with the gaps.
//   - It only references facts that are present in the inputs (evidence_used);
//     it never invents funding, founders, headcount, or contact info.
//   - Agentory voice: premium, direct, founder-focused. Never "AI SDR",
//     "replace your team", or generic cold-email hype.

import type { CompanyEnrichment } from "./companyEnrichment.ts";
import type { DecisionMaker } from "./decisionMakers.ts";

export interface PersonalizationInput {
  companyName?: string | null;
  companyWebsite?: string | null;
  companyLinkedinUrl?: string | null;
  companyDescription?: string | null;
  jobTitle?: string | null;
  jobUrl?: string | null;
  jobDescription?: string | null;
  postedAt?: string | null;
  employeeCount?: number | null;
  industries?: string[] | null;
  whyNow?: string | null;
  icpFitSummary?: string | null;
  evidenceSummary?: string | null;
  missingEvidence?: string[] | null;
  gateDecision?: string | null;
  sourceProof?: unknown;
  sourceQuality?: string | null;
  enrichment?: CompanyEnrichment | null;
  decisionMaker?: DecisionMaker | null;
  brainVoice?: { tone?: string | null; positioning?: string | null } | null;
}

export interface OutreachDraft {
  status: "draft_needs_approval" | "insufficient_context";
  recipient_name: string | null;
  recipient_title: string | null;
  company_name: string;
  subject: string;
  body: string;
  personalization_variables_used: string[];
  evidence_used: string[];
  missing_context: string[];
  risk_notes: string[];
}

const AGENTORY_POSITIONING =
  "Agentory helps founders identify who is worth contacting, why now, and what message angle to use before hiring SDRs or VAs — pipeline before payroll.";

// Phrases Agentory never uses. Guardrail-checked on generated bodies.
const BANNED = [
  /\bAI\s*SDR\b/i,
  /replace your (team|sdrs?|reps?|sales team|staff)/i,
  /fire your (team|sdrs?|reps?)/i,
  /\bautomate your (?:entire )?(?:sales|outreach) (?:team|force)\b/i,
  /\bgame[- ]chang(?:er|ing)\b/i,
  /\bsynerg(?:y|ies)\b/i,
  /\brevolutioniz/i,
  /\bunlock (?:massive|unprecedented)\b/i,
];

export function assertAgentoryVoice(text: string): string[] {
  return BANNED.filter((re) => re.test(text)).map((re) => re.source);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function hasProof(input: PersonalizationInput): boolean {
  const arr = Array.isArray(input.sourceProof) ? input.sourceProof : [];
  const q = (input.sourceQuality ?? "").toLowerCase();
  return arr.length > 0 || q === "verified" || q === "partial";
}

export interface Readiness { ready: boolean; missing_context: string[]; }

/**
 * Decide whether we have enough evidence to write a real personalized draft.
 * Company must not be hard-rejected, must have proof, and must carry either a
 * decision-maker OR real company context (enrichment/description) plus a
 * why-now/role hook. Otherwise personalization is refused.
 */
export function checkPersonalizationReadiness(input: PersonalizationInput): Readiness {
  const missing: string[] = [];
  const gate = (input.gateDecision ?? "").toLowerCase();
  if (!str(input.companyName)) missing.push("company_name");
  if (gate === "reject" || gate === "rejected") missing.push("company_rejected");
  if (!hasProof(input)) missing.push("source_proof");

  const hasRecipient = !!str(input.decisionMaker?.name ?? null);
  const hasCompanyContext = !!(
    str(input.enrichment?.company_summary ?? null) ||
    (input.enrichment?.founders?.length ?? 0) > 0 ||
    str(input.companyDescription ?? null)
  );
  if (!hasRecipient && !hasCompanyContext) missing.push("recipient_or_company_context");
  if (!str(input.jobTitle ?? null) && !str(input.whyNow ?? null)) missing.push("why_now_or_role");

  return { ready: missing.length === 0, missing_context: missing };
}

/**
 * Build an approval-gated outreach draft. Returns insufficient_context (never a
 * fake-personalized email) when readiness fails.
 */
export function buildOutreachDraft(input: PersonalizationInput): OutreachDraft {
  const companyName = str(input.companyName) ?? "this company";
  const recipient = input.decisionMaker ?? null;
  const recipientName = str(recipient?.name ?? null);
  const recipientTitle = str(recipient?.title ?? null);

  const readiness = checkPersonalizationReadiness(input);
  const evidence_used: string[] = [];
  const vars_used: string[] = [];
  const risk_notes: string[] = [];

  // Collect the evidence we are actually allowed to reference.
  const jobUrl = str(input.jobUrl);
  if (jobUrl) evidence_used.push(jobUrl);
  if (recipient?.evidence_url) evidence_used.push(recipient.evidence_url);
  for (const u of input.enrichment?.evidence_urls ?? []) evidence_used.push(u);
  const proofArr = Array.isArray(input.sourceProof) ? input.sourceProof : [];
  for (const p of proofArr) {
    const u = (p && typeof p === "object" && "url" in (p as any)) ? str((p as any).url) : null;
    if (u) evidence_used.push(u);
  }

  if (!readiness.ready) {
    return {
      status: "insufficient_context",
      recipient_name: recipientName,
      recipient_title: recipientTitle,
      company_name: companyName,
      subject: "",
      body:
        `Not enough verified context to write an honest personalized message for ${companyName}. ` +
        `Missing: ${readiness.missing_context.join(", ")}. ` +
        `Run "Research company" and/or "Find decision-makers" first — Agentory won't send a fake-personalized email.`,
      personalization_variables_used: [],
      evidence_used: [...new Set(evidence_used)],
      missing_context: readiness.missing_context,
      risk_notes: ["Draft not generated — insufficient evidence."],
    };
  }

  // ---- Build the personalized draft (Agentory voice, evidence-only) ----
  const jobTitle = str(input.jobTitle);
  const whyNow = str(input.whyNow);
  const summary = str(input.enrichment?.company_summary ?? null) ?? str(input.companyDescription ?? null);
  const industry = (input.industries ?? [])[0] ?? null;

  vars_used.push("companyName");
  const greetingName = recipientName ? recipientName.split(/\s+/)[0] : null;
  if (greetingName) vars_used.push("decision_maker_name");
  if (recipientTitle) vars_used.push("decision_maker_title");

  const opener = jobTitle
    ? `Noticed ${companyName} is hiring a ${jobTitle}, which usually means the founder or revenue team is building pipeline before adding more payroll.`
    : `Noticed ${companyName} is investing in growth right now — usually a sign the founder or revenue team is building pipeline before adding more payroll.`;
  if (jobTitle) vars_used.push("jobTitle");

  const whyLine = whyNow ? ` ${whyNow}` : "";
  if (whyNow) vars_used.push("whyNow");

  const contextLine = summary ? ` From what I can see, ${summary.replace(/\.$/, "")}.` : "";
  if (summary) vars_used.push(input.enrichment?.company_summary ? "companySummary" : "companyDescription");
  if (industry) vars_used.push("industries");

  const greeting = greetingName ? `Hi ${greetingName},` : `Hi ${companyName} team,`;
  const body =
    `${greeting}\n\n` +
    `${opener}${whyLine}${contextLine}\n\n` +
    `${AGENTORY_POSITIONING}\n\n` +
    `If it's useful, I can share exactly who's worth contacting and the angle to use — no tools to adopt, no team to replace. Worth a quick look?`;

  const subject = jobTitle
    ? `${companyName}: pipeline before your next ${jobTitle}`
    : `${companyName}: pipeline before payroll`;

  // ---- Risk notes (honest caveats for the approver) ----
  if (recipient?.source === "job_poster" && recipient.confidence === "low") {
    risk_notes.push("Recipient is a low-confidence poster hint (likely recruiter/HR) — verify the real buyer before sending.");
  }
  if (recipient && !recipient.linkedinUrl && !recipient.email) {
    risk_notes.push("No direct contact channel yet — needs contact enrichment.");
  }
  if (!recipient) {
    risk_notes.push("Company-level draft — no specific decision-maker resolved yet.");
  }
  if (!input.enrichment || input.enrichment.status === "not_started") {
    risk_notes.push("Company not yet enriched — draft is signal-based only.");
  }
  if ((input.missingEvidence ?? []).length > 0) {
    risk_notes.push(`Unverified: ${(input.missingEvidence ?? []).join(", ")} — not asserted in the draft.`);
  }

  // Guardrail: never ship banned phrasing.
  const violations = assertAgentoryVoice(body + " " + subject);
  if (violations.length > 0) {
    risk_notes.push(`Voice guardrail tripped (${violations.join(", ")}) — draft withheld.`);
    return {
      status: "insufficient_context",
      recipient_name: recipientName, recipient_title: recipientTitle, company_name: companyName,
      subject: "", body: "Draft withheld: generated copy violated Agentory voice rules.",
      personalization_variables_used: vars_used, evidence_used: [...new Set(evidence_used)],
      missing_context: ["voice_guardrail"], risk_notes,
    };
  }

  return {
    status: "draft_needs_approval",
    recipient_name: recipientName,
    recipient_title: recipientTitle,
    company_name: companyName,
    subject,
    body,
    personalization_variables_used: vars_used,
    evidence_used: [...new Set(evidence_used)],
    missing_context: input.missingEvidence ?? [],
    risk_notes,
  };
}
