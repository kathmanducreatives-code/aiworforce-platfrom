// Radar action gating — pure, import-free, unit-testable. Given a signal's
// canonical decision + evidence/company/decision-maker state, returns the exact
// set of actions the UI may show. "Draft outreach" is NEVER offered unless the
// backend gate (can_draft_outreach) allows it AND the decision is contact.

export type CanonicalDecision = "contact" | "watch" | "needs_review" | "skip";
export type RadarActionKey =
  | "draft_outreach" | "open_evidence" | "save" | "watch_company"
  | "find_decision_maker" | "verify_source" | "resolve_company" | "skip" | "restore_for_review";

export const ACTION_LABEL: Record<RadarActionKey, string> = {
  draft_outreach: "Draft outreach",
  open_evidence: "Open evidence",
  save: "Save",
  watch_company: "Watch company",
  find_decision_maker: "Find decision maker",
  verify_source: "Verify source",
  resolve_company: "Resolve company",
  skip: "Skip",
  restore_for_review: "Restore for review",
};

export interface SignalActionState {
  decision: CanonicalDecision;
  can_draft_outreach: boolean;  // backend gate
  has_company: boolean;
  has_evidence: boolean;
  has_decision_maker: boolean;
  is_person_only: boolean;
}

/**
 * The allowed actions for a signal. Draft outreach is hidden whenever the backend
 * gate is false, the decision isn't contact, company/evidence/decision-maker is
 * missing, or the row is person-only.
 */
export function allowedRadarActions(s: SignalActionState): RadarActionKey[] {
  const canOutreach =
    s.decision === "contact" && s.can_draft_outreach && s.has_company && s.has_evidence &&
    s.has_decision_maker && !s.is_person_only;

  switch (s.decision) {
    case "contact":
      return [...(canOutreach ? ["draft_outreach" as const] : ["find_decision_maker" as const]), "open_evidence", "save", "watch_company"];
    case "watch":
      return ["watch_company", "find_decision_maker", "open_evidence", "save"];
    case "needs_review":
      return ["verify_source", "resolve_company", "find_decision_maker", "skip"];
    case "skip":
      return ["open_evidence", "restore_for_review"];
  }
}

/** True only when Draft outreach should render. */
export function canShowDraftOutreach(s: SignalActionState): boolean {
  return allowedRadarActions(s).includes("draft_outreach");
}
