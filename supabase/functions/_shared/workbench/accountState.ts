// Canonical per-lead Workbench account state + a pure stage merger.
//
// THE PROBLEM THIS SOLVES
//
// Workbench actions each wrote their own island of data:
//   research_company        → raw.company_enrichment
//   find_decision_makers    → raw.decision_makers + contact_id
//
// while evaluateDraftGate read an entirely DISJOINT set that only the Find Leads
// sourcing pipeline populates:
//   canonical_final_decision · contact_ready · provider_provenance{verified,level}
//
// Production evidence (4 Workbench leads): company_enrichment 4/4,
// decision_makers 4/4, contact_id 3/4 — but canonical_final_decision 0/4,
// contact_ready 0/4, provider_provenance 0/4. The work was done; the gate was
// looking somewhere else, so outreach blocked with five reasons that had nothing
// to do with the actual state.
//
// The fix is NOT to weaken the gate. Its requirements are the right ones before
// contacting a human. The fix is to have each stage RECORD the evidence it
// genuinely established, in the form the gate reads.

export type StageStatus =
  | "not_started"
  | "running"
  | "succeeded"
  | "partial"
  | "missing_company_identity"
  | "needs_manual_review"
  | "no_match"
  | "unavailable"
  | "timed_out"
  | "failed";

/** Every stage keeps its last SUCCESS separately from its last ATTEMPT. */
export interface StageEnvelope<T> {
  status: StageStatus;
  reason_code: string | null;
  /** Last successful payload — never cleared by a later failed attempt. */
  last_success: T | null;
  attempted_at: string | null;
  succeeded_at: string | null;
  failure_reason: string | null;
}

export interface CompanyResearchState {
  summary: string | null;
  evidence_urls: string[];
  missing_evidence: string[];
  confidence: string | null;
  /** True when the research produced enough to ground a claim. */
  usable: boolean;
}

export interface DecisionMakerState {
  verified_count: number;
  manual_review_count: number;
  primary_full_name: string | null;
  primary_linkedin_url: string | null;
  primary_role_family: string | null;
  primary_company_name: string | null;
  primary_verification_methods: string[];
  contact_id: string | null;
}

/**
 * What a Find Contact Details unlock established about ONE person.
 *
 * ── `email_status` IS THE FIELD, NOT `email` ────────────────────────────────
 *
 * The paid provider event is "Profile details + email search" — a SEARCH that
 * bills whether or not an address comes back. So the outcome has three shapes,
 * not two, and collapsing them loses the one that matters most:
 *
 *   email_found   an address, quoted from the provider and never constructed
 *   not_found     the lookup ran, was paid for, and there is no address. An
 *                 ANSWER about this person — re-running buys the same nothing
 *                 at the same price, which is why the Workbench must show it
 *                 as "None found" rather than as an untouched offer.
 *   provider_error nothing was established; a retry is exactly right
 *
 * NO PHONE FIELD. Not "not yet" — no registered Actor returns one, and a field
 * here would be an invitation to populate it from somewhere that does not exist.
 */
export interface ContactEnrichmentState {
  email_status: "email_found" | "not_found" | "provider_error";
  /** The provider's own value. Null on every status but `email_found`. */
  business_email: string | null;
  /** Which Actor supplied it, so a claim can be traced. */
  email_source: string | null;
  /** The person this was bought for — a contact belongs to somebody. */
  person_full_name: string | null;
  person_linkedin_url: string | null;
  /** True when a profile identity was available to enrich at all. */
  linkedin_available: boolean;
  reason: string;
}

export interface OutreachState {
  eligibility?: string | null;
  personalization_depth?: string | null;
  approval_required: boolean;
  approval_status: string | null;
  /**
   * Personalized-opener fields. Present when the stage was produced in
   * `output_mode: "personalized_opener"`; absent for the legacy full-draft path.
   */
  output_mode?: "personalized_opener";
  status?: string;
  reason_code?: string;
  opener?: string | null;
  alternative_opener?: string | null;
  used_evidence_ids?: string[];
  omitted_claims?: string[];
  validation?: unknown;
  /** Nothing is ever sent from this state. */
  sent?: false;
  generated_at?: string;
}

export interface WorkbenchAccountState {
  lead_candidate_id: string;
  company_research: StageEnvelope<CompanyResearchState>;
  decision_makers: StageEnvelope<DecisionMakerState>;
  contact_enrichment: StageEnvelope<ContactEnrichmentState>;
  outreach: StageEnvelope<OutreachState>;
  updated_at: string | null;
}

function emptyStage<T>(): StageEnvelope<T> {
  return {
    status: "not_started",
    reason_code: null,
    last_success: null,
    attempted_at: null,
    succeeded_at: null,
    failure_reason: null,
  };
}

export function emptyAccountState(leadCandidateId: string): WorkbenchAccountState {
  return {
    lead_candidate_id: leadCandidateId,
    company_research: emptyStage<CompanyResearchState>(),
    decision_makers: emptyStage<DecisionMakerState>(),
    contact_enrichment: emptyStage<ContactEnrichmentState>(),
    outreach: emptyStage<OutreachState>(),
    updated_at: null,
  };
}

/** Namespaced key inside the existing lead_candidates.raw jsonb — no migration. */
export const WORKBENCH_STATE_KEY = "agentory_workbench";

export function readAccountState(
  raw: Record<string, unknown> | null | undefined,
  leadCandidateId: string,
): WorkbenchAccountState {
  const stored = (raw ?? {})[WORKBENCH_STATE_KEY];
  if (!stored || typeof stored !== "object") return emptyAccountState(leadCandidateId);
  const s = stored as Partial<WorkbenchAccountState>;
  const base = emptyAccountState(leadCandidateId);
  return {
    ...base,
    ...s,
    lead_candidate_id: leadCandidateId,
    company_research: { ...base.company_research, ...(s.company_research ?? {}) },
    decision_makers: { ...base.decision_makers, ...(s.decision_makers ?? {}) },
    outreach: { ...base.outreach, ...(s.outreach ?? {}) },
  };
}

/**
 * Merge ONE stage result. Other stages are untouched, and a failed attempt keeps
 * the previous `last_success` — running a later action must never erase earlier
 * completed intelligence.
 */
export function mergeStage<T>(
  prev: StageEnvelope<T>,
  update: { status: StageStatus; reason_code?: string | null; payload?: T | null },
  now: string,
): StageEnvelope<T> {
  const succeeded = update.status === "succeeded" || update.status === "partial";
  return {
    status: update.status,
    reason_code: update.reason_code ?? null,
    // A later failure NEVER clears an earlier success.
    last_success: succeeded && update.payload ? update.payload : prev.last_success,
    attempted_at: now,
    succeeded_at: succeeded ? now : prev.succeeded_at,
    failure_reason: succeeded ? null : (update.reason_code ?? update.status),
  };
}

export type StageName =
  | "company_research" | "decision_makers" | "contact_enrichment" | "outreach";

/** Apply one stage update to the whole account state, preserving every other stage. */
export function applyStageUpdate(
  state: WorkbenchAccountState,
  stage: StageName,
  update: { status: StageStatus; reason_code?: string | null; payload?: unknown },
  now: string,
): WorkbenchAccountState {
  const next: WorkbenchAccountState = { ...state, updated_at: now };
  if (stage === "company_research") {
    next.company_research = mergeStage(state.company_research, update as never, now);
  } else if (stage === "decision_makers") {
    next.decision_makers = mergeStage(state.decision_makers, update as never, now);
  } else if (stage === "contact_enrichment") {
    next.contact_enrichment = mergeStage(state.contact_enrichment, update as never, now);
  } else {
    next.outreach = mergeStage(state.outreach, update as never, now);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Outreach prerequisites — derived from what the stages ACTUALLY established.
// ---------------------------------------------------------------------------

/**
 * Provenance the draft gate reads, derived from Workbench stage evidence.
 *
 * This does not lower the bar. The gate wants provider-backed company identity,
 * a provider-backed/verified person, and a verified person↔company association.
 * A verified decision-maker IS exactly that: employerVerification only reaches
 * `verified` on a company LinkedIn URL or domain identifier match, and the
 * person came from a provider run. We simply record it where the gate looks.
 */
export interface DerivedGateFields {
  canonical_final_decision: string | null;
  contact_ready: boolean;
  provider_provenance: { verified: boolean; level: string } | null;
  company: string | null;
  evidence_url: string | null;
}

export function deriveGateFields(state: WorkbenchAccountState): DerivedGateFields {
  const research = state.company_research.last_success;
  const dm = state.decision_makers.last_success;

  const hasUsableResearch = !!research?.usable;
  // "verified" here means the employer-verification engine confirmed the person's
  // CURRENT employer by identifier — not a name guess.
  const hasVerifiedPerson = !!dm && dm.verified_count > 0 &&
    !!dm.primary_linkedin_url && !!dm.primary_full_name &&
    dm.primary_verification_methods.length > 0;

  if (!hasUsableResearch || !hasVerifiedPerson) {
    return {
      canonical_final_decision: null,
      contact_ready: false,
      provider_provenance: null,
      company: null,
      evidence_url: null,
    };
  }

  return {
    canonical_final_decision: "contact",
    // A reachable channel exists: the verified LinkedIn profile.
    contact_ready: true,
    provider_provenance: { verified: true, level: "person" },
    company: dm.primary_company_name,
    // The person's verified profile is the supporting evidence URL.
    evidence_url: dm.primary_linkedin_url,
  };
}

export type OutreachBlockReason =
  | "blocked_missing_company_evidence"
  | "blocked_missing_person"
  | "ready";

/**
 * The SPECIFIC missing prerequisite, so the UI never says only
 * "Complete the required previous step first".
 */
export function outreachPrerequisite(state: WorkbenchAccountState): {
  reason: OutreachBlockReason;
  message: string;
} {
  const research = state.company_research.last_success;
  const dm = state.decision_makers.last_success;

  if (!research?.usable) {
    return { reason: "blocked_missing_company_evidence", message: "Complete company research first" };
  }
  if (!dm || dm.verified_count === 0 || !dm.primary_linkedin_url) {
    return { reason: "blocked_missing_person", message: "Find a verified decision-maker first" };
  }
  return { reason: "ready", message: "Ready to draft" };
}

// ---------------------------------------------------------------------------
// Next best action
// ---------------------------------------------------------------------------

export type NextBestAction =
  | "research_company"
  | "find_decision_makers"
  | "generate_outreach"
  | "review_draft"
  | "resolve_missing_evidence"
  | "manual_review";

export function nextBestAction(state: WorkbenchAccountState): NextBestAction {
  if (!state.company_research.last_success?.usable) return "research_company";

  const dm = state.decision_makers.last_success;
  if (!dm || dm.verified_count === 0) {
    if (state.decision_makers.status === "needs_manual_review" || (dm?.manual_review_count ?? 0) > 0) {
      return "manual_review";
    }
    return "find_decision_makers";
  }
  if (state.outreach.last_success) return "review_draft";
  return "generate_outreach";
}
