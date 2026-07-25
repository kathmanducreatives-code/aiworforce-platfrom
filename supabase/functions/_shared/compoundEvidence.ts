// Evidence contract + why-now/opener grounding (Phase 7).
//
// Deterministic validation that every claim is traceable to real, same-account
// evidence. Never fabricates evidence to pass. A candidate with a missing/unknown
// evidence reference, a cross-company reference, or an unsupported why-now/opener
// claim cannot be treated as CONTACT-grounded.

import type { CompoundCandidate, EvidenceRef } from "./compoundSourcingPipeline.ts";

export interface EvidenceValidation {
  ok: boolean;
  failures: string[];
}

/** Every referenced id must EXIST on the candidate and belong to its account. */
export function validateEvidenceRefs(candidate: CompoundCandidate, referencedIds: string[]): EvidenceValidation {
  const known = new Set(candidate.evidence.map((e) => e.id));
  const accountKey = candidate.account.dedupeKey ?? "";
  const failures: string[] = [];
  for (const id of referencedIds) {
    if (!known.has(id)) { failures.push(`unknown_evidence_id:${id}`); continue; }
    // Evidence ids embed the account key — a ref to another account's evidence fails.
    if (accountKey && !id.includes(accountKey.replace(/[^a-z0-9_.:-]/gi, ""))) failures.push(`cross_company_evidence:${id}`);
  }
  return { ok: failures.length === 0, failures };
}

/** A required hiring claim needs a job-evidence ref WITH a url. */
export function hiringEvidenceValid(candidate: CompoundCandidate): boolean {
  return candidate.evidence.some((e: EvidenceRef) => e.kind === "job" && !!e.url);
}

// Claims that require independent evidence the jobs actor does NOT provide.
const INVENTION_RE = /\b(raised|funding|series [a-e]\b|struggling with pipeline|building (?:a|their|the) sales team|first sales hire|hasn'?t started|has not started|founder (?:is )?(?:personally )?run(?:s|ning) sales|scaling (?:fast|rapidly))\b/i;
const HIRING_REF_RE = /\b(hiring|is hiring|hire|role|position|opening)\b/i;

export interface WhyNowAudit { grounded: boolean; companySpecific: boolean; referencesHiring: boolean; violations: string[] }

export function auditCompoundWhyNow(text: string | null, candidate: CompoundCandidate): WhyNowAudit {
  const violations: string[] = [];
  if (!text || !text.trim()) return { grounded: false, companySpecific: false, referencesHiring: false, violations: ["empty"] };
  const s = text.trim();
  const companyName = (candidate.account.name ?? "").trim();
  const firstTok = companyName.toLowerCase().split(/\s+/)[0] ?? "";
  const companySpecific = firstTok.length > 0 && s.toLowerCase().includes(firstTok);
  const referencesHiring = HIRING_REF_RE.test(s);
  // Any invented claim without corresponding evidence on the candidate is unsupported
  // (the pipeline only produces hiring evidence, so invention is never supported).
  let m: RegExpExecArray | null;
  const re = new RegExp(INVENTION_RE.source, "gi");
  while ((m = re.exec(s)) !== null) violations.push(`unsupported_claim:${m[0]}`);
  // The verified job title, when cited, must match the attached job evidence.
  const verifiedTitle = (candidate.jobEvidence.title ?? "").toLowerCase();
  const grounded = companySpecific && referencesHiring && violations.length === 0 && (verifiedTitle ? s.toLowerCase().includes(verifiedTitle) : true);
  return { grounded, companySpecific, referencesHiring, violations };
}

/** An opener must not reference a company other than the candidate's account. */
export function auditCompoundOpener(text: string | null, candidate: CompoundCandidate): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  if (!text) return { ok: false, violations: ["empty"] };
  if (INVENTION_RE.test(text)) violations.push("unsupported_claim");
  const firstTok = (candidate.account.name ?? "").toLowerCase().split(/\s+/)[0] ?? "";
  if (firstTok && !text.toLowerCase().includes(firstTok)) violations.push("wrong_or_missing_company");
  return { ok: violations.length === 0, violations };
}
