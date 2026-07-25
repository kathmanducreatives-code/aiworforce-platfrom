// Outreach-angle audit (section 11).
//
// Audits ONLY the suggested angle — never a full or sendable message, and this
// benchmark never generates or stores drafts. A good angle references the
// verified hiring signal, connects to Agentory's value, and avoids generic
// praise, invented facts, "replace your GTM team" positioning, or pretending
// the founder posted something.

import type { NormalizedCandidate, OutreachAngleAudit } from "./types.ts";

const SIGNAL_REF_RE = /\b(hir(?:e|ing)|sales operations|sales ops|revenue operations|rev ?ops|gtm|go[- ]to[- ]market|role|opening)\b/i;
const VALUE_RE = /\b(pipeline|build (?:pipeline|before)|before (?:you|they) hire|before payroll|outbound|book (?:meetings|demos)|fill the pipeline|source (?:leads|deals)|revenue engine)\b/i;

const GENERIC_PRAISE_RE = /\b(love what you(?:'re| are) (?:doing|building)|big fan|huge fan|amazing (?:work|product|company)|impressive growth|congrats on)\b/i;
const FAKE_POST_RE = /\b(saw your (?:recent )?post|your (?:recent )?(?:post|tweet|update)|you (?:posted|mentioned|said|wrote)|loved your (?:post|comment))\b/i;
const REPLACE_TEAM_RE = /\b(replace your (?:gtm|sales|revenue) team|fire your|don'?t (?:need|hire) (?:a )?(?:sales|gtm) (?:team|hire|rep))\b/i;
const INVENT_RE = /\b(just raised|recently raised|series [a-c]\b|scaling (?:fast|rapidly)|hyper[- ]?growth)\b/i;

export function auditOutreachAngle(angle: string | null, n: NormalizedCandidate): OutreachAngleAudit {
  if (!angle || !angle.trim()) {
    return { angle, referencesSignal: false, connectsToValue: false, violations: [], ok: false };
  }
  const s = angle.trim();
  const violations: string[] = [];

  const referencesSignal = SIGNAL_REF_RE.test(s);
  const connectsToValue = VALUE_RE.test(s);

  if (GENERIC_PRAISE_RE.test(s)) violations.push("generic_praise");
  if (FAKE_POST_RE.test(s)) violations.push("pretends_founder_posted");
  if (REPLACE_TEAM_RE.test(s)) violations.push("replace_gtm_team_positioning");
  const hasFundingEvidence = Boolean(n.raw.rawMeta?.fundingProofUrl);
  if (INVENT_RE.test(s) && !hasFundingEvidence) violations.push("claims_not_in_evidence");
  if (!referencesSignal) violations.push("does_not_reference_signal");

  return {
    angle: s,
    referencesSignal,
    connectsToValue,
    violations,
    ok: referencesSignal && connectsToValue && violations.length === 0,
  };
}
