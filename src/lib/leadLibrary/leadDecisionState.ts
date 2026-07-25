// Canonical decision layer for the Lead Library.
//
// One deterministic, pure function derives every UI-facing status: the top
// metric counters, the row Decision/Next-action, the drawer summary card, and
// the default sort ordering all read from this object. This removes the
// contradictory statuses that came from each surface interpreting the same
// underlying data on its own.
//
// This is a READ-TIME layer. It never mutates persisted state, never
// regenerates outreach, never repairs recipients.

import type { LeadRow } from "./types";

export type LeadDecision = "contact" | "watch" | "skip" | "needs_review";

export type LeadLifecycle =
  | "discovered"
  | "research_needed"
  | "buyer_needed"
  | "qualified"
  | "draft_ready"
  | "awaiting_approval"
  | "contacted"
  | "replied"
  | "meeting";

export type FitBand = "strong" | "good" | "soft" | "poor" | "unknown";

export type BuyerState = "verified" | "needs_review" | "missing";

export type ResearchState =
  | "ready"
  | "stale"
  | "failed_with_previous_success"
  | "needed";

export type OutreachDecisionState =
  | "none"
  | "draft_ready"
  | "awaiting_approval"
  | "sent";

export type NextAction =
  | "research_company"
  | "find_decision_makers"
  | "review_evidence"
  | "review_opener"
  | "approve_draft"
  | "mark_contacted"
  | "monitor"
  | "none";

export interface LeadDecisionState {
  decision: LeadDecision;
  lifecycle: LeadLifecycle;
  fitBand: FitBand;
  buyerState: BuyerState;
  researchState: ResearchState;
  outreachState: OutreachDecisionState;
  nextAction: NextAction;
  priorityScore: number;
  priorityReason: string;
  whyNowSummary: string;
}

// ---------- derivations (pure) ----------

export function fitBandFromScore(score: number | null | undefined): FitBand {
  if (score == null) return "unknown";
  if (score >= 80) return "strong";
  if (score >= 60) return "good";
  if (score >= 40) return "soft";
  return "poor";
}

function deriveBuyerState(row: LeadRow): BuyerState {
  if (row.contactReadiness === "verified" && row.selectedRecipient?.verified) return "verified";
  if (row.contactReadiness === "needs_review" || (row.selectedRecipient && !row.selectedRecipient.verified))
    return "needs_review";
  if (row.selectedRecipient) return "needs_review";
  return "missing";
}

function deriveResearchState(row: LeadRow): ResearchState {
  const hasSource = !!row.strongestSource;
  if (!hasSource) return "needed";
  return "ready";
}

function deriveOutreachState(row: LeadRow): OutreachDecisionState {
  const o = row.opener;
  if (!o) return "none";
  if (o.status === "approved") return "awaiting_approval";
  if (o.status === "draft_ready" || o.status === "edited") return "draft_ready";
  return "none";
}

// Engagement progression overrides preparation stages.
function progressionLifecycle(row: LeadRow): LeadLifecycle | null {
  switch (row.engagementStatus) {
    case "meeting":
    case "opportunity":
    case "won":
      return "meeting";
    case "replied":
      return "replied";
    case "contacted":
      return "contacted";
    default:
      return null;
  }
}

/**
 * Qualification requires the account to have passed the canonical
 * qualification path (accountStatus === "qualified"). A verified buyer or a
 * generated draft alone is not enough — historical soft/poor accounts with
 * legacy drafts must not silently upgrade themselves.
 */
function isQualified(row: LeadRow): boolean {
  return row.accountStatus === "qualified";
}

export function deriveLeadDecisionState(row: LeadRow): LeadDecisionState {
  const fitBand = fitBandFromScore(row.fitScore);
  const buyerState = deriveBuyerState(row);
  const researchState = deriveResearchState(row);
  const outreachState = deriveOutreachState(row);
  const progression = progressionLifecycle(row);

  // ---- lifecycle ----
  let lifecycle: LeadLifecycle;
  if (progression) {
    lifecycle = progression;
  } else if (researchState === "needed") {
    lifecycle = "research_needed";
  } else if (!isQualified(row)) {
    lifecycle = "discovered";
  } else if (buyerState !== "verified") {
    lifecycle = "buyer_needed";
  } else if (outreachState === "awaiting_approval") {
    lifecycle = "awaiting_approval";
  } else if (outreachState === "draft_ready") {
    lifecycle = "draft_ready";
  } else {
    lifecycle = "qualified";
  }

  // ---- decision ----
  let decision: LeadDecision;
  if (row.accountStatus === "archived" || row.accountStatus === "disqualified") {
    decision = "skip";
  } else if (progression) {
    decision = "contact"; // already engaged
  } else if (fitBand === "poor") {
    decision = "watch";
  } else if (!isQualified(row)) {
    // Might still be Contact if evidence is strong. Conservative default.
    decision =
      researchState === "needed" || fitBand === "unknown" ? "needs_review" : "watch";
  } else if (buyerState === "missing") {
    decision = "contact";
  } else if (buyerState === "needs_review") {
    decision = "needs_review";
  } else {
    decision = "contact";
  }

  // ---- next action ----
  let nextAction: NextAction;
  if (decision === "skip") nextAction = "monitor";
  else if (progression === "contacted") nextAction = "mark_contacted"; // follow-up cue lives in drawer
  else if (progression === "replied" || progression === "meeting") nextAction = "none";
  else if (researchState === "needed") nextAction = "research_company";
  else if (decision === "watch") nextAction = "review_evidence";
  else if (buyerState === "missing") nextAction = "find_decision_makers";
  else if (buyerState === "needs_review") nextAction = "review_evidence";
  else if (outreachState === "awaiting_approval") nextAction = "approve_draft";
  else if (outreachState === "draft_ready") nextAction = "review_opener";
  else if (decision === "needs_review") nextAction = "review_evidence";
  else nextAction = "monitor";

  // ---- why-now summary (human sentence, no raw enums) ----
  const src = row.strongestSource;
  let whyNowSummary = "Limited timing evidence";
  if (src?.headline) {
    whyNowSummary = src.headline;
  } else if (src?.sourceType) {
    whyNowSummary = humanizeSource(src.sourceType);
  }

  // ---- priority score ----
  const priorityScore = computePriorityScore({
    decision,
    lifecycle,
    fitBand,
    buyerState,
    row,
  });

  return {
    decision,
    lifecycle,
    fitBand,
    buyerState,
    researchState,
    outreachState,
    nextAction,
    priorityScore,
    priorityReason: priorityReasonFor(decision, fitBand, buyerState),
    whyNowSummary,
  };
}

function priorityReasonFor(d: LeadDecision, f: FitBand, b: BuyerState): string {
  if (d === "contact" && f === "strong" && b === "verified") return "Strong fit with a verified buyer";
  if (d === "contact" && b === "missing") return "Qualified account without a buyer";
  if (d === "needs_review") return "Evidence is incomplete";
  if (d === "watch") return "Below the qualification threshold";
  if (d === "skip") return "Archived or disqualified";
  if (d === "contact") return "Qualified — ready to engage";
  return "Awaiting review";
}

function computePriorityScore(input: {
  decision: LeadDecision;
  lifecycle: LeadLifecycle;
  fitBand: FitBand;
  buyerState: BuyerState;
  row: LeadRow;
}): number {
  const { decision, fitBand, buyerState, row } = input;
  let s = 0;
  // Decision tier
  if (decision === "contact") s += 1000;
  else if (decision === "needs_review") s += 400;
  else if (decision === "watch") s += 100;
  // Fit
  s += { strong: 300, good: 220, soft: 120, poor: 30, unknown: 0 }[fitBand];
  // Buyer
  s += { verified: 200, needs_review: 90, missing: 40 }[buyerState];
  // Recency tie-break
  const at = row.lastActivity?.at ?? row.updatedAt;
  const t = at ? new Date(at).getTime() : 0;
  s += Math.min(50, Math.floor((t / 1000 / 3600) % 1000));
  return s;
}

// ---------- copy / labels ----------

export function decisionLabel(d: LeadDecision): string {
  return { contact: "Contact", watch: "Watch", skip: "Skip", needs_review: "Needs review" }[d];
}

export function decisionTone(d: LeadDecision): "success" | "muted" | "warning" | "danger" {
  return { contact: "success", watch: "warning", needs_review: "muted", skip: "danger" }[d] as
    | "success"
    | "muted"
    | "warning"
    | "danger";
}

export function fitBandLabel(f: FitBand): string {
  return { strong: "Strong fit", good: "Good fit", soft: "Soft fit", poor: "Poor fit", unknown: "Fit unknown" }[f];
}

export function buyerStateLabel(b: BuyerState): string {
  return { verified: "Verified buyer", needs_review: "Buyer needs review", missing: "Buyer needed" }[b];
}

export function lifecycleLabel(l: LeadLifecycle): string {
  return {
    discovered: "Discovered",
    research_needed: "Research needed",
    buyer_needed: "Buyer needed",
    qualified: "Qualified",
    draft_ready: "Draft ready",
    awaiting_approval: "Awaiting approval",
    contacted: "Contacted",
    replied: "Replied",
    meeting: "Meeting",
  }[l];
}

export function nextActionLabel(a: NextAction): string {
  return {
    research_company: "Research company",
    find_decision_makers: "Find decision-makers",
    review_evidence: "Review evidence",
    review_opener: "Review opener",
    approve_draft: "Approve draft",
    mark_contacted: "Mark contacted",
    monitor: "Monitor",
    none: "No action",
  }[a];
}

export function humanizeSource(raw: string | null | undefined): string {
  if (!raw) return "Signal";
  const s = raw.replace(/[_-]+/g, " ").trim().toLowerCase();
  if (/job|hiring|posting/.test(s)) return "Job posting";
  if (/fund|invest|series|raise/.test(s)) return "Funding update";
  if (/engage|reply|comment|like|profile/.test(s)) return "Engagement signal";
  if (/news|press|announcement/.test(s)) return "News mention";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- counters ----------

export type CounterKey =
  | "all"
  | "qualified"
  | "buyer_ready"
  | "draft_ready"
  | "awaiting_approval"
  | "contacted"
  | "replied"
  | "meetings";

export function countByKey(states: LeadDecisionState[], key: CounterKey): number {
  switch (key) {
    case "all": return states.length;
    case "qualified":
      return states.filter((s) =>
        ["qualified", "buyer_needed", "draft_ready", "awaiting_approval", "contacted", "replied", "meeting"].includes(s.lifecycle),
      ).length;
    case "buyer_ready":
      return states.filter((s) =>
        s.buyerState === "verified" &&
        ["qualified", "draft_ready", "awaiting_approval", "contacted", "replied", "meeting"].includes(s.lifecycle),
      ).length;
    case "draft_ready":
      return states.filter((s) =>
        s.outreachState === "draft_ready" &&
        ["draft_ready", "awaiting_approval"].includes(s.lifecycle),
      ).length;
    case "awaiting_approval":
      return states.filter((s) => s.lifecycle === "awaiting_approval").length;
    case "contacted":
      return states.filter((s) => s.lifecycle === "contacted").length;
    case "replied":
      return states.filter((s) => s.lifecycle === "replied").length;
    case "meetings":
      return states.filter((s) => s.lifecycle === "meeting").length;
  }
}

// ---------- sorting ----------

export type SortKey = "recommended" | "fit" | "latest_signal" | "updated";

export function sortRows(
  rows: LeadRow[],
  states: Map<string, LeadDecisionState>,
  key: SortKey,
): LeadRow[] {
  const arr = [...rows];
  const at = (r: LeadRow) => new Date(r.lastActivity?.at ?? r.updatedAt ?? 0).getTime();
  switch (key) {
    case "fit":
      return arr.sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1) || at(b) - at(a));
    case "latest_signal":
      return arr.sort((a, b) => {
        const ax = a.strongestSource?.observedAt ? new Date(a.strongestSource.observedAt).getTime() : 0;
        const bx = b.strongestSource?.observedAt ? new Date(b.strongestSource.observedAt).getTime() : 0;
        return bx - ax;
      });
    case "updated":
      return arr.sort((a, b) => at(b) - at(a));
    case "recommended":
    default:
      return arr.sort((a, b) => {
        const sa = states.get(a.id)?.priorityScore ?? 0;
        const sb = states.get(b.id)?.priorityScore ?? 0;
        if (sa !== sb) return sb - sa;
        return at(b) - at(a);
      });
  }
}
