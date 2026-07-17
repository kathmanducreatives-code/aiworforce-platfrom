// Shared read models: Signals page · Content intelligence · Engagement loop.
//
// CONTRACTS ONLY — no UI, no content generation, no provider binding. These exist so
// the SAME evidence graph that qualifies a lead can later answer:
//
//   Find Leads  "who is worth contacting, and why now?"
//   Signals     "what changed among the people and companies I care about?"
//   Content     "what should I post to attract and educate this audience?"
//
// ONE EVIDENCE GRAPH → MULTIPLE WORKFLOWS. Every model here references SignalEvents
// and evidence, never a private copy of the data and never a raw provider payload.
//
// LAYERING RULE (enforced by contract + tests): a CONTENT INSIGHT is an
// AUDIENCE-level aggregate and can NEVER be candidate timing evidence by itself.
// "Several founders are hiring sales" is a content opportunity; it is not proof that
// THIS founder is hot. Only a SignalEvent attached to the entity can do that.

import type { EvidenceCategory } from "./evidenceContract.ts";
import type {
  SignalEvent, SignalCategory, SignalEvidenceRef, EngagementSignalType,
} from "./signalEvent.ts";
import { signalCategoryOf, isTimingCapableSignal } from "./signalEvent.ts";
import type { SignalStrength } from "./signalFreshness.ts";

// ------------------------------------------------------- Signals page ---------

/** Actions a signal may recommend. None of these ever sends outreach. */
export type SignalRecommendedAction =
  | "review_lead"
  | "research_further"
  | "add_to_watchlist"
  | "create_content_brief"
  | "prepare_outreach_angle"   // PREPARE only — approval still required to send
  | "dismiss";

/** Sanitized projection of a SignalEvent for the Signals page. */
export interface SignalCard {
  signal_id: string;
  title: string;
  /** Public entity label — a company name or a public person name. */
  entity_label: string;
  entity_kind: "person" | "company";
  signal_category: SignalCategory;
  /** Why this matters, in plain language. Sanitized, never raw payload. */
  why_it_matters: string;
  occurred_at: string;
  freshness: "fresh" | "aging" | "stale";
  confidence: "low" | "medium" | "high";
  icp_relevance: SignalStrength;
  strength: SignalStrength;
  /** How many qualified candidates this one signal touches. */
  related_candidate_count: number;
  /** Pointers back to source-backed proof. Public URLs only. */
  evidence_refs: SignalEvidenceRef[];
  recommended_action: SignalRecommendedAction;
}

/** Fields that must never appear on a card. Enforced by test. */
export const SIGNAL_CARD_FORBIDDEN_FIELDS: readonly string[] = [
  "raw", "raw_payload", "provider_payload", "payload", "email", "phone", "authorization", "token",
];

// -------------------------------------------------- Content intelligence ------

/** A cohort of candidates the founder might address with one piece of content. */
export interface AudienceSegment {
  segment_id: string;
  label: string;
  /** ICP filters that define the cohort. */
  icp_filters: {
    industries?: string[] | null;
    geographies?: string[] | null;
    company_size?: string | null;
    roles?: string[] | null;
  };
  candidate_ids: string[];
  company_ids: string[];
  /** Only members carrying these signal categories. */
  signal_filters?: SignalCategory[] | null;
  /** e.g. only people who engaged with us. */
  relationship_filters?: EngagementSignalType[] | null;
}

/**
 * A recurring, evidence-backed observation across a cohort.
 *
 * `unsupported_claims` is deliberate: the model records what the evidence does NOT
 * support, so downstream content generation cannot quietly assert it.
 */
export interface TopicInsight {
  topic_id: string;
  topic: string;
  supporting_signal_ids: string[];
  supporting_evidence_refs: SignalEvidenceRef[];
  matched_candidate_count: number;
  confidence: "low" | "medium" | "high";
  freshness: "fresh" | "aging" | "stale";
  /** The recurring problem the cohort demonstrably has. */
  recurring_problem?: string | null;
  /** Claims the aggregated evidence supports. */
  safe_claims: string[];
  /** Claims it does NOT support — must never be published as fact. */
  unsupported_claims: string[];
}

export type ContentFormat = "linkedin_post" | "linkedin_carousel" | "short_video" | "newsletter" | "case_study";
export type ContentOpportunityStatus = "proposed" | "accepted" | "dismissed" | "published";

export interface ContentOpportunity {
  opportunity_id: string;
  audience_segment: AudienceSegment;
  suggested_topic: string;
  /** Evidence-backed reason this is timely for the cohort. */
  why_now: string;
  supporting_signal_ids: string[];
  matched_audience_count: number;
  recommended_angle: string;
  suggested_format: ContentFormat;
  cta_options: string[];
  status: ContentOpportunityStatus;
}

/**
 * Content opportunities are COHORT-level: they must be backed by a pattern across
 * several candidates, never one post per scraped lead.
 */
export const MIN_AUDIENCE_FOR_CONTENT = 3;

export function isCohortLevelOpportunity(
  o: Pick<ContentOpportunity, "matched_audience_count">,
  minAudience = MIN_AUDIENCE_FOR_CONTENT,
): boolean {
  return o.matched_audience_count >= minAudience;
}

/**
 * THE LAYERING GUARD. A content insight is an audience aggregate; it can never be
 * promoted into candidate timing evidence. Always false, by contract — the function
 * exists so the rule is executable and testable rather than a comment.
 */
export function canTopicInsightProveCandidateTiming(_insight: TopicInsight): false {
  return false;
}

// ------------------------------------------------------ Engagement loop -------

export type EngagementKind = EngagementSignalType;

/**
 * Someone interacted with the founder's content or outreach.
 *
 * Future loop (NOT implemented here): content published → engagement observed →
 * EngagementEvent → timing refreshed → candidate requalified → Aria re-ranks →
 * Mira prepares a contextual message → FOUNDER APPROVAL REQUIRED before anything sends.
 */
export interface EngagementEvent {
  engagement_id: string;
  workspace_id: string;
  kind: EngagementKind;
  /** Must resolve to a KNOWN entity — an anonymous like is not timing evidence. */
  person_ref?: string | null;
  company_ref?: string | null;
  /** The content that was engaged with. */
  content_ref?: string | null;
  occurred_at: string;
  observed_at: string;
  /** Source-backed proof this engagement happened. */
  evidence_refs: SignalEvidenceRef[];
  confidence: "low" | "medium" | "high";
  /** The workspace is authorized to use this engagement as evidence. */
  authorized: boolean;
  source_url?: string | null;
}

export type EngagementRejectionReason =
  | "unknown_entity"
  | "no_supporting_evidence"
  | "not_authorized"
  | "missing_timestamp"
  | "low_confidence";

/**
 * An EngagementEvent may become timing evidence ONLY when it is linked to a known
 * entity, source-backed, authorized, timestamped and confident enough. Freshness is
 * applied separately by the freshness policy (engagement decays fastest).
 */
export function engagementAdmissibility(e: EngagementEvent): {
  admissible: boolean; reasons: EngagementRejectionReason[];
} {
  const reasons: EngagementRejectionReason[] = [];
  if (!e.person_ref && !e.company_ref) reasons.push("unknown_entity");
  if (!e.evidence_refs?.length) reasons.push("no_supporting_evidence");
  if (e.authorized !== true) reasons.push("not_authorized");
  if (!e.occurred_at || !isFinite(Date.parse(e.occurred_at))) reasons.push("missing_timestamp");
  if (e.confidence === "low") reasons.push("low_confidence");
  return { admissible: reasons.length === 0, reasons };
}

// ------------------------------------------------------- projections ----------

/** Bucket a signal's freshness for display. Uses the caller's already-computed age. */
export function freshnessBand(ratio: number): "fresh" | "aging" | "stale" {
  if (ratio <= 0) return "stale";
  return ratio >= 0.5 ? "fresh" : "aging";
}

/**
 * Project a SignalEvent into a sanitized SignalCard. Drops everything that is not a
 * public, source-backed fact: no raw payload, no PII, no credentials.
 */
export function toSignalCard(input: {
  signal: SignalEvent;
  title: string;
  entity_label: string;
  why_it_matters: string;
  strength: SignalStrength;
  icp_relevance: SignalStrength;
  freshness_ratio: number;
  related_candidate_count: number;
  recommended_action?: SignalRecommendedAction;
}): SignalCard {
  const s = input.signal;
  return {
    signal_id: s.signal_id,
    title: input.title,
    entity_label: input.entity_label,
    entity_kind: s.company_ref ? "company" : "person",
    signal_category: signalCategoryOf(s.signal_type),
    why_it_matters: input.why_it_matters,
    occurred_at: s.occurred_at,
    freshness: freshnessBand(input.freshness_ratio),
    confidence: s.confidence,
    icp_relevance: input.icp_relevance,
    strength: input.strength,
    related_candidate_count: input.related_candidate_count,
    // Evidence refs are already sanitized public pointers.
    evidence_refs: s.evidence_refs.map((r) => ({ ...r })),
    recommended_action: input.recommended_action
      ?? (isTimingCapableSignal(s) ? "review_lead" : "research_further"),
  };
}

/** Categories a signal card may claim to prove. Bridges to canonical evidence. */
export type SignalCardEvidenceCategory = EvidenceCategory;
