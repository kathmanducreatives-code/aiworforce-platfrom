// Canonical radar decision + people-attachment + draft-outreach gate + tag
// hygiene. PURE / Deno-testable. One decision vocabulary for every source.

export type CanonicalDecision = "contact" | "watch" | "needs_review" | "skip";

export interface DecisionInput {
  verified_company: boolean;
  brain_fit: boolean;
  has_meaningful_signal: boolean;
  evidence_url?: string | null;
  recent: boolean;               // relevant recency (or unknown=false)
  hard_disqualifier: boolean;
  why_now?: string | null;
  /** Present when an outreach action would be offered. */
  decision_maker_present?: boolean;
}

function isHttpUrl(u?: string | null): boolean { return /^https?:\/\/\S+/i.test((u ?? "").trim()); }

export function canonicalDecision(i: DecisionInput): { decision: CanonicalDecision; reasons: string[] } {
  const reasons: string[] = [];
  if (i.hard_disqualifier) return { decision: "skip", reasons: ["Hard disqualifier hit."] };
  if (!i.has_meaningful_signal) return { decision: "skip", reasons: ["No meaningful signal."] };

  const hasEvidence = isHttpUrl(i.evidence_url);
  // CONTACT bar is deliberately high.
  if (i.verified_company && i.brain_fit && hasEvidence && i.recent && !!(i.why_now ?? "").trim()) {
    return { decision: "contact", reasons: ["Verified company, ICP fit, evidence, recent, clear why-now."] };
  }
  // WATCH: good fit + real evidence, weaker timing/adjacency.
  if (i.verified_company && i.brain_fit && hasEvidence) {
    return { decision: "watch", reasons: ["Good fit with evidence, but weaker timing or adjacent signal."] };
  }
  // NEEDS_REVIEW: potentially useful but missing company/source/recency/person.
  if (!i.verified_company) reasons.push("Company not verified.");
  if (!hasEvidence) reasons.push("No evidence URL.");
  if (!i.recent) reasons.push("Recency unknown.");
  return { decision: "needs_review", reasons: reasons.length ? reasons : ["Missing evidence for a confident decision."] };
}

// ---------------------------------------------------------------------------
// People must attach to an account-level signal
// ---------------------------------------------------------------------------
export type AccountSignalKind = "hiring" | "funding" | "linkedin_post" | "linkedin_comment" | "competitor" | null;

export interface PersonAttachment {
  is_standalone_signal: boolean; // true = a person-only row, which is NOT a market signal
  attached_to: AccountSignalKind;
  note: string;
}

/** A person is only a valid signal when attached to a verified account event. */
export function classifyPerson(args: { attached_to?: AccountSignalKind; account_verified?: boolean }): PersonAttachment {
  const kind = args.attached_to ?? null;
  if (kind && args.account_verified) {
    return { is_standalone_signal: false, attached_to: kind, note: `Decision maker attached to a verified ${kind} signal.` };
  }
  return {
    is_standalone_signal: true,
    attached_to: null,
    note: "Person profile with no verified company-level signal — excluded from verified counts (legacy person row).",
  };
}

// ---------------------------------------------------------------------------
// Draft-outreach gate
// ---------------------------------------------------------------------------
export type RadarAction = "draft_outreach" | "verify_source" | "resolve_company" | "find_decision_maker" | "watch_company";

/** Outreach drafting is only allowed on a CONTACT-grade, verified, non-person-only
 * signal with evidence. Otherwise return the appropriate remediation action. */
export function allowedAction(args: {
  decision: CanonicalDecision; is_person_only: boolean; has_evidence_url: boolean;
  verified_company: boolean; decision_maker_present: boolean;
}): { can_draft_outreach: boolean; action: RadarAction; reason: string } {
  if (args.decision !== "contact" || args.is_person_only || !args.has_evidence_url) {
    let action: RadarAction = "watch_company";
    let reason = "Outreach is only available on verified contact-grade signals.";
    if (!args.has_evidence_url) { action = "verify_source"; reason = "Verify the source before drafting outreach."; }
    else if (!args.verified_company) { action = "resolve_company"; reason = "Resolve the company before drafting outreach."; }
    else if (args.decision === "needs_review") { action = "verify_source"; reason = "Needs review — not eligible for outreach."; }
    else if (!args.decision_maker_present) { action = "find_decision_maker"; reason = "Find a decision maker before outreach."; }
    return { can_draft_outreach: false, action, reason };
  }
  if (!args.decision_maker_present) {
    return { can_draft_outreach: false, action: "find_decision_maker", reason: "Find a decision maker before outreach." };
  }
  return { can_draft_outreach: true, action: "draft_outreach", reason: "Verified contact-grade signal with a decision maker." };
}

// ---------------------------------------------------------------------------
// Tag hygiene — remove duplicate labels like "Active hiring: Active hiring"
// ---------------------------------------------------------------------------
export function cleanLabel(label: string | null | undefined): string {
  const s = (label ?? "").trim();
  if (!s) return "";
  // Collapse "X: X" / "X - X" / "X — X" / "X X" duplicates (case-insensitive).
  const m = s.match(/^(.*?)\s*[:\-–—]\s*(.*)$/);
  if (m && m[1].trim().toLowerCase() === m[2].trim().toLowerCase()) return m[1].trim();
  const half = Math.floor(s.length / 2);
  if (s.length % 2 === 0 && s.slice(0, half).trim().toLowerCase() === s.slice(half).trim().toLowerCase()) return s.slice(0, half).trim();
  return s;
}

export function dedupeTags(tags: (string | null | undefined)[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const t of tags) {
    const c = cleanLabel(t);
    if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c); }
  }
  return out;
}
