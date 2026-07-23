// Why-now grounding audit (section 10).
//
// Verifies a generated "why now" statement against the candidate's evidence:
// it must name the actual hiring/timing signal, must NOT invent funding, team
// size, expansion, urgency, or intent, must distinguish observed fact from
// inference, and must be specific to the company.

import type { NormalizedCandidate, WhyNowAudit } from "./types.ts";
import { classifyJobFamily } from "./normalize.ts";

// Claims that require independent evidence the jobs actor does not provide.
const INVENTION_RE = /\b(scaling (?:fast|rapidly)|growing (?:fast|rapidly)|rapidly growing|just raised|recently raised|series [a-c]\b|closed a round|expanding (?:rapidly|quickly|aggressively)|hyper[- ]?growth|probably needs?|must need|urgently|doubl(?:ing|ed)|tripl(?:ing|ed)|blowing up|on fire)\b/i;
const INFERENCE_MARKER_RE = /\b(suggest(?:s|ing)?|indicat(?:es|ing)|likely|may\b|might\b|appears?|seems?|could\b|point(?:s|ing) to)\b/i;
const SIGNAL_REF_RE = /\b(hir(?:e|ing)|role|position|opening|job|posted|sales operations|sales ops|revenue operations|rev ?ops|gtm|go[- ]to[- ]market)\b/i;

export function auditWhyNow(statement: string | null, n: NormalizedCandidate): WhyNowAudit {
  if (!statement || !statement.trim()) {
    return {
      statement,
      namesSignal: false,
      inventsFacts: false,
      distinguishesInference: false,
      companySpecific: false,
      unsupportedClauses: [],
      supported: false,
    };
  }
  const s = statement.trim();
  const fam = classifyJobFamily(n.raw.jobTitle, n.raw.jobDescriptionExcerpt);
  const namesSignal = SIGNAL_REF_RE.test(s) || (fam.matchedPhrase != null && s.toLowerCase().includes(fam.matchedPhrase.toLowerCase()));

  const companyName = (n.raw.companyName ?? "").trim();
  const companySpecific = companyName.length > 0 && s.toLowerCase().includes(companyName.toLowerCase().split(/\s+/)[0]);

  // Which invented-claim phrases lack supporting evidence?
  const unsupportedClauses: string[] = [];
  const hasFundingEvidence = Boolean(n.raw.rawMeta?.fundingProofUrl);
  const hasSizeEvidence = Number.isFinite(Number(n.raw.rawMeta?.employeeCount));
  let match: RegExpExecArray | null;
  const re = new RegExp(INVENTION_RE.source, "gi");
  while ((match = re.exec(s)) !== null) {
    const phrase = match[0];
    const isFunding = /raise|round|series/i.test(phrase);
    const isSize = /doubl|tripl|scal|grow/i.test(phrase);
    if (isFunding && hasFundingEvidence) continue;
    if (isSize && hasSizeEvidence) continue;
    unsupportedClauses.push(phrase);
  }

  const inventsFacts = unsupportedClauses.length > 0;
  const distinguishesInference = INFERENCE_MARKER_RE.test(s) || !inventsFacts;
  const supported = namesSignal && companySpecific && !inventsFacts;

  return {
    statement: s,
    namesSignal,
    inventsFacts,
    distinguishesInference,
    companySpecific,
    unsupportedClauses,
    supported,
  };
}
