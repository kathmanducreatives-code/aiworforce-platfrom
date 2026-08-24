// Canonical SignalEvent contract (Phase A) — provider-independent, pure.
//
// WHY THIS EXISTS
// The v85 controlled Q1 proved the system can verify identity and company fit, and
// correctly stages every candidate at `missing_timing_signal → signal_enrichment`.
// The one missing capability is TIMING: "why should this person be contacted now?"
//
// RECONCILED WITH THE EXISTING VOCABULARY — this module adds NO parallel taxonomy.
// The repository already has the canonical timing vocabulary and it stays canonical:
//
//   EvidenceCategory (evidenceContract.ts) — the SIX timing categories the evidence
//   contract, sufficiency gate and final-state reducer already understand:
//     job_signal · funding_signal · launch_signal · expansion_signal ·
//     founder_activity_signal · gtm_signal
//
//   LeadSignalType (leadEntityIntent.ts) — the user-intent vocabulary:
//     hiring · funding · product_launch · expansion · new_executive · recent_post
//
// A SignalEvent is the normalized EVENT layer that was missing between them. Every
// SignalType below MAPS ONTO one of the six canonical EvidenceCategories
// (`evidenceCategoryForSignalType`), so a verified signal becomes ordinary evidence
// that `evaluateEvidenceSufficiency` already knows how to satisfy. That is what keeps
// one evidence graph feeding Find Leads, Signals and Content — rather than a second
// parallel pipeline.
//
// LAYERING (kept deliberately separate):
//   EVIDENCE ARTIFACT  a source-backed fact ("a sales role was posted on 2026-07-02")
//   SIGNAL EVENT       a normalized, time-sensitive event derived from >=1 artifacts
//                      ("this company is building a sales function")
//   TIMING ASSESSMENT  a CANDIDATE-level "is there enough current evidence?" verdict
//   CONTENT INSIGHT    an AUDIENCE-level aggregate — never candidate timing evidence
//
// PRIVACY: a SignalEvent carries public, sanitized, source-backed facts only. Never
// raw provider payloads, credentials, private messages, emails or phone numbers.

import type { EvidenceCategory, EvidenceConfidence, EvidenceSourceType } from "./evidenceContract.ts";
import type { ListingStatus } from "./timingFreshnessPolicy.ts";

export type { ListingStatus };

// ------------------------------------------------------------- taxonomy -------

/** Growth: the company is getting bigger or entering new markets. */
export type GrowthSignalType =
  | "recent_funding"
  | "employee_growth"
  | "market_expansion"
  | "geographic_expansion";

/** GTM: the company is building or changing how it sells. */
export type GtmSignalType =
  | "sales_hiring"
  | "revops_hiring"
  | "growth_hiring"
  | "new_revenue_leader"
  | "outbound_initiative"
  | "positioning_change";

/** Product: the company shipped something. */
export type ProductSignalType =
  | "product_launch"
  | "major_release"
  | "new_integration"
  | "category_expansion";

/** Founder intent: the founder said something that reveals a live problem. */
export type FounderIntentSignalType =
  | "founder_pipeline_post"
  | "founder_outbound_post"
  | "founder_customer_acquisition_post"
  | "founder_hiring_post"
  | "founder_problem_statement";

/** Relationship: someone interacted with us. Only ever evidence when authorized. */
export type EngagementSignalType =
  | "linkedin_connection_accepted"
  | "linkedin_post_like"
  | "linkedin_post_comment"
  | "linkedin_post_reply"
  | "direct_reply"
  | "content_engagement";

/**
 * Market: what is happening AROUND the workspace's category.
 *
 * Never a claim about a prospect, which is why this is its own category rather
 * than more `gtm` types: a competitor's motion must not answer a query meaning
 * "this prospect is changing how it sells".
 *
 * Deliberately coarse. Radar establishes that a named competitor was publicly
 * active and that the problem space is being discussed; it does not classify
 * WHAT the competitor did, so `major_release` would assert more than was
 * observed. A later classifier can refine these into the product types.
 */
export type MarketSignalType =
  | "competitor_activity"
  | "market_problem_discussion";

/** Risk: source-backed facts that WEAKEN or contradict timing. Never urgency. */
export type RiskSignalType =
  | "person_left_company"
  | "company_outside_icp"
  | "role_changed"
  | "company_inactive"
  | "signal_became_stale";

export type SignalType =
  | GrowthSignalType | GtmSignalType | ProductSignalType
  | FounderIntentSignalType | EngagementSignalType | RiskSignalType
  | MarketSignalType;

export type SignalCategory =
  | "growth" | "gtm" | "product" | "founder_intent" | "engagement" | "risk" | "market";

const CATEGORY_OF: Readonly<Record<SignalType, SignalCategory>> = {
  recent_funding: "growth", employee_growth: "growth", market_expansion: "growth", geographic_expansion: "growth",
  competitor_activity: "market", market_problem_discussion: "market",
  sales_hiring: "gtm", revops_hiring: "gtm", growth_hiring: "gtm", new_revenue_leader: "gtm",
  outbound_initiative: "gtm", positioning_change: "gtm",
  product_launch: "product", major_release: "product", new_integration: "product", category_expansion: "product",
  founder_pipeline_post: "founder_intent", founder_outbound_post: "founder_intent",
  founder_customer_acquisition_post: "founder_intent", founder_hiring_post: "founder_intent",
  founder_problem_statement: "founder_intent",
  linkedin_connection_accepted: "engagement", linkedin_post_like: "engagement",
  linkedin_post_comment: "engagement", linkedin_post_reply: "engagement",
  direct_reply: "engagement", content_engagement: "engagement",
  person_left_company: "risk", company_outside_icp: "risk", role_changed: "risk",
  company_inactive: "risk", signal_became_stale: "risk",
};

/**
 * Every canonical signal type, derived from the category map rather than
 * restated — a second hand-written list is a second thing to forget. Used to
 * pin this vocabulary against the database CHECK that has to accept it.
 */
export const SIGNAL_TYPES: readonly SignalType[] =
  Object.freeze(Object.keys(CATEGORY_OF) as SignalType[]);

export function signalCategoryOf(t: SignalType): SignalCategory {
  return CATEGORY_OF[t];
}

/**
 * Map a SignalType onto the CANONICAL EvidenceCategory it proves.
 *
 * This is the bridge that keeps one evidence graph: a verified signal becomes an
 * ordinary EvidenceItem in a category the existing contract/sufficiency gate already
 * requires. Risk signals map to `null` — they are contradictions, never proof of
 * timing, and must never satisfy a timing requirement.
 */
export function evidenceCategoryForSignalType(t: SignalType): EvidenceCategory | null {
  switch (t) {
    // growth
    case "recent_funding": return "funding_signal";
    case "employee_growth": case "market_expansion": case "geographic_expansion": return "expansion_signal";
    // gtm — hiring is proven by a job posting; the rest are go-to-market motion
    case "sales_hiring": case "revops_hiring": case "growth_hiring": return "job_signal";
    case "new_revenue_leader": case "outbound_initiative": case "positioning_change": return "gtm_signal";
    // product
    case "product_launch": case "major_release": case "new_integration": case "category_expansion":
      return "launch_signal";
    // founder intent — the founder's own public activity
    case "founder_pipeline_post": case "founder_outbound_post": case "founder_customer_acquisition_post":
    case "founder_hiring_post": case "founder_problem_statement":
      return "founder_activity_signal";
    // engagement — a relationship event with US is founder-activity-grade evidence
    case "linkedin_connection_accepted": case "linkedin_post_like": case "linkedin_post_comment":
    case "linkedin_post_reply": case "direct_reply": case "content_engagement":
      return "founder_activity_signal";
    // risk signals are contradictions, never timing proof
    case "person_left_company": case "company_outside_icp": case "role_changed":
    case "company_inactive": case "signal_became_stale":
      return null;
    // market — context about the category, never proof of a prospect's timing.
    // Returning an evidence category here would let competitor news satisfy an
    // evidence gate about a company it says nothing about.
    case "competitor_activity": case "market_problem_discussion":
      return null;
  }
}

/** True when the signal type can only ever weaken/contradict, never prove timing. */
export function isRiskSignal(t: SignalType): boolean {
  return signalCategoryOf(t) === "risk";
}

// -------------------------------------------------------- signal event --------

export type SignalVerification =
  | "provider_verified"   // a permitted provider returned it, source URL retained
  | "self_reported"       // the entity said it about itself (e.g. their own post)
  | "unverified";         // never satisfies a timing requirement

export type SignalStatus = "active" | "superseded" | "stale" | "retracted";

/** A pointer back to the source-backed evidence a signal was derived from. */
export interface SignalEvidenceRef {
  category: EvidenceCategory;
  sourceType: EvidenceSourceType;
  /** Public, sanitized URL. Never carries credentials/userinfo. */
  sourceUrl?: string;
  actorKey?: string;
  actorId?: string;
  observedAt?: string;
  confidence: EvidenceConfidence;
}

export interface SignalProvenance {
  provider?: string;      // e.g. "apify" — a capability adapter supplies this
  actorKey?: string;
  actorId?: string;
  workflowRunId?: string;
  taskId?: string;
}

/**
 * A normalized, time-sensitive event derived from source-backed evidence.
 *
 * `occurred_at` vs `observed_at` is the load-bearing distinction: timing freshness
 * MUST be judged on when the event HAPPENED, not when we noticed it. A funding round
 * announced 8 months ago but scraped today is stale, not hot. (The existing
 * `isEvidenceFresh` keys on observedAt, which is correct for firmographics but wrong
 * for timing — see signalFreshness.ts.)
 */
export interface SignalEvent {
  signal_id: string;
  workspace_id: string;
  signal_type: SignalType;
  signal_category: SignalCategory;

  /** At least one of these must be present — a signal must attach to an entity. */
  person_ref?: string | null;
  company_ref?: string | null;

  /** The source-backed evidence this signal was derived from. Never empty. */
  evidence_refs: SignalEvidenceRef[];

  source_provider?: string | null;
  actor_key?: string | null;
  actor_id?: string | null;
  source_url?: string | null;

  /** When the event actually happened. Drives freshness. */
  occurred_at: string;
  /** When we observed it. Audit only — never the freshness basis. */
  observed_at: string;
  /** Optional explicit expiry; otherwise the freshness policy decides. */
  expires_at?: string | null;

  confidence: EvidenceConfidence;
  verification: SignalVerification;

  /** Sanitized, structured value (e.g. {role: "AE", count: 3}). Never raw payload. */
  normalized_value?: Record<string, unknown> | null;

  /**
   * Job listings only — the normalized, SOURCE-BACKED status of the posting.
   *
   * A closed or expired listing is stale immediately: a role filled last week is not
   * a reason to reach out, however recently it was posted. `unknown` is the honest
   * default — the ABSENCE of a closing date is not evidence that a listing is open,
   * so `active` must be positively verified, never inferred.
   */
  listing_status?: ListingStatus | null;

  /** Deterministic identity for reconciling the same event from many sources. */
  dedupe_key: string;
  status: SignalStatus;
  provenance?: SignalProvenance;
  /** Records that the value passed sanitization (no PII/secrets/raw payload). */
  sanitized: boolean;
}

// ------------------------------------------------------- validation -----------

export type SignalRejectionReason =
  | "no_entity_reference"
  | "no_supporting_evidence"
  | "unverified_inference"
  | "missing_occurred_at"
  | "raw_payload_present"
  | "sensitive_value_present";

export interface SignalValidation {
  valid: boolean;
  reasons: SignalRejectionReason[];
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/;
/** Keys that would smuggle a raw provider payload or PII into a signal. */
const FORBIDDEN_VALUE_KEYS = new Set([
  "raw", "raw_payload", "provider_payload", "payload", "items", "response",
  "email", "phone", "phone_number", "authorization", "token", "api_key", "password", "secret",
]);

/** Evidence source types that constitute genuine external proof. Brain constraints
 * and LLM interpretation are deliberately excluded (mirrors candidateEnvelope). */
const PROVIDER_EVIDENCE_SOURCES: ReadonlySet<EvidenceSourceType> = new Set<EvidenceSourceType>([
  "apify_actor", "official_website", "public_web",
]);

/**
 * A SignalEvent is only admissible when it is traceable to source-backed evidence.
 *
 * Rejects: no entity, no evidence, evidence that is only a Brain constraint or an LLM
 * guess, a missing occurred_at, and any raw-payload/PII leakage in normalized_value.
 */
export function validateSignalEvent(s: SignalEvent): SignalValidation {
  const reasons: SignalRejectionReason[] = [];

  if (!s.person_ref && !s.company_ref) reasons.push("no_entity_reference");
  if (!s.evidence_refs?.length) reasons.push("no_supporting_evidence");

  // An LLM guess or a Brain constraint can never make a signal verified: at least one
  // supporting artifact must come from a real external source.
  const hasProviderBacking = (s.evidence_refs ?? []).some((e) => PROVIDER_EVIDENCE_SOURCES.has(e.sourceType));
  if (s.verification === "provider_verified" && !hasProviderBacking) reasons.push("unverified_inference");
  if (s.evidence_refs?.length && !hasProviderBacking && s.verification !== "unverified") {
    reasons.push("unverified_inference");
  }

  if (!s.occurred_at || !isFinite(Date.parse(s.occurred_at))) reasons.push("missing_occurred_at");

  const v = s.normalized_value ?? null;
  if (v) {
    for (const k of Object.keys(v)) {
      if (FORBIDDEN_VALUE_KEYS.has(k.toLowerCase())) { reasons.push("raw_payload_present"); break; }
    }
    const flat = JSON.stringify(v);
    if (EMAIL_RE.test(flat) || PHONE_RE.test(flat)) reasons.push("sensitive_value_present");
  }

  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/** True when a signal may be used as TIMING proof (as opposed to a contradiction). */
export function isTimingCapableSignal(s: SignalEvent): boolean {
  if (isRiskSignal(s.signal_type)) return false;
  if (s.status !== "active") return false;
  if (s.verification === "unverified") return false;
  return validateSignalEvent(s).valid;
}

// ------------------------------------------------------- dedupe key -----------

/** Bucket occurred_at so the "same" event from two sources collapses even when the
 * reported timestamps differ by hours. 24h is deliberate and documented, not magic. */
export const DEDUPE_WINDOW_HOURS = 24;

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Deterministic identity for an event, independent of which source found it.
 * Same entity + same signal type + same occurred_at bucket ⇒ same key, so the same
 * funding round found on LinkedIn and on the company website collapses to one signal.
 */
export function buildSignalDedupeKey(input: {
  workspace_id: string;
  signal_type: SignalType;
  person_ref?: string | null;
  company_ref?: string | null;
  occurred_at: string;
  /** Optional discriminator (e.g. the specific role) so two distinct roles at the
   * same company in the same window stay distinct. */
  event_identity?: string | null;
  dedupeWindowHours?: number;
}): string {
  const w = Math.max(1, input.dedupeWindowHours ?? DEDUPE_WINDOW_HOURS);
  const t = Date.parse(input.occurred_at);
  const bucket = isFinite(t) ? Math.floor(t / (w * 3600_000)) : 0;
  const entity = input.company_ref ? `c:${norm(input.company_ref)}` : `p:${norm(input.person_ref)}`;
  const ident = input.event_identity ? `:${norm(input.event_identity)}` : "";
  return `sig:${norm(input.workspace_id)}:${input.signal_type}:${entity}${ident}:${bucket}`;
}
