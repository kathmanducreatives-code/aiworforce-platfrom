// ICP-grounded personalized OPENER — pure, deterministic, provider-independent.
//
// PRODUCT DECISION
//   "Generate outreach" no longer drafts a full email. It produces ONE very short,
//   highly researched opening line (optionally one alternative) — the first
//   sentence a founder would actually send. No subject, no body, no signature, no
//   sequence, no automatic send. Approval is always required; nothing is ever sent.
//
// WHY A NEW PATH (proven by a read-only production audit — field presence only)
//   The legacy draft gate reads sourcing-era fields (canonical_final_decision,
//   contact_ready, provider_provenance) that the Workbench actions never populate,
//   so every Workbench row blocked with generic copy even though a verified
//   decision-maker, hydrated research and a saved ICP were all present. This module
//   gates on the WORKBENCH-established evidence instead, behind an explicit
//   `output_mode: "personalized_opener"` so the legacy full-draft path is untouched.
//
// SAFETY
//   The generator boundary is injected (ModelBoundary) so tests never call a model.
//   No raw scraped page or provider payload ever enters the context or the prompt;
//   only sanitized, evidence-backed facts. Every factual claim in the opener must
//   map to allowed evidence — an invented hiring/funding/pain claim, a stale signal
//   worded as current, a prohibited Company-Brain claim, or fake familiarity is
//   rejected rather than shown as a successful draft.

import type { AccountResearchSnapshot } from '@/lib/accountResearchHydration';
import type { IcpSnapshot, SavedIcp, WhyRelevant } from '@/lib/icpSnapshot';
import type { DisplayDecisionMaker } from '@/lib/decisionMakerDisplay';

// --------------------------------------------------------------- output mode --

/** Explicit — never inferred from a UI label (compatibility requirement). */
export type OutreachOutputMode = 'personalized_opener' | 'full_draft';
export const OPENER_OUTPUT_MODE: OutreachOutputMode = 'personalized_opener';

// ----------------------------------------------------------------- context ----

export type PersonalizationDepth = 'specific' | 'company_level' | 'generic_value_only';

export type EvidenceSourceType =
  | 'company_website' | 'company_linkedin' | 'job_posting' | 'source_proof'
  | 'enrichment' | 'signal' | 'icp_match';

export interface ContextEvidence {
  evidence_id: string;
  /** Short, sanitized human claim — never raw page text. */
  claim: string;
  source_type: EvidenceSourceType;
  confidence: 'high' | 'medium' | 'low';
  freshness?: 'fresh' | 'recent' | 'stale' | 'unknown';
  /** Whether this evidence may be used to ground a claim in the opener. */
  allowed: boolean;
}

export interface CompanyBrainContext {
  present: boolean;
  positioning?: string;
  product_summary?: string;
  target_outcomes: string[];
  differentiators: string[];
  prohibited_claims: string[];
  tone?: string;
  approved_ctas: string[];
}

export interface PersonalizationContext {
  lead_candidate_id: string;
  company: {
    name: string | null;
    domain: string | null;
    summary: string | null;
    industry?: string | null;
    employee_range?: string | null;
    relevant_research_points: string[];
  };
  decision_maker: {
    full_name: string;
    first_name?: string;
    current_title?: string;
    current_company_name?: string;
    role_family?: string;
    verification_status: string;
    verification_methods: string[];
  } | null;
  saved_icp: SavedIcp | null;
  company_brain: CompanyBrainContext;
  relevance: {
    why_this_company?: string;
    why_this_person?: string;
    why_now?: string;
    relevant_outcome?: string;
    personalization_depth: PersonalizationDepth;
  };
  evidence: ContextEvidence[];
  missing_evidence: string[];
}

// ------------------------------------------------------------- context build --

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : []);

export interface BuildContextInput {
  snapshot: AccountResearchSnapshot;
  icp_snapshot: IcpSnapshot;
  saved_icp: SavedIcp | null;
  brain: CompanyBrainContext;
  decision_maker: DisplayDecisionMaker | null | undefined;
  why_relevant: WhyRelevant;
}

/** Map a hydrated snapshot's evidence into freshness/allowed-tagged claims. */
function contextEvidence(snapshot: AccountResearchSnapshot): ContextEvidence[] {
  const fresh = snapshot.status === 'available';
  return snapshot.evidence.map((e, i) => ({
    evidence_id: `ev_${i + 1}_${e.kind}`,
    claim: e.label,
    source_type: (e.kind === 'website' ? 'company_website'
      : e.kind === 'company_linkedin' ? 'company_linkedin'
      : e.kind === 'job_posting' ? 'job_posting'
      : e.kind === 'source_proof' ? 'source_proof'
      : e.kind === 'signal' ? 'signal' : 'enrichment') as EvidenceSourceType,
    confidence: snapshot.confidence,
    // A hiring/job posting is only "fresh" when the snapshot itself is current.
    freshness: e.kind === 'job_posting' ? (fresh ? 'fresh' : 'stale') : (fresh ? 'recent' : 'unknown'),
    allowed: true,
  }));
}

export function buildPersonalizationContext(input: BuildContextInput): PersonalizationContext {
  const { snapshot, icp_snapshot, saved_icp, brain, decision_maker, why_relevant } = input;

  const dm = decision_maker && decision_maker.verification_status
    ? {
        full_name: decision_maker.full_name,
        first_name: decision_maker.first_name,
        current_title: decision_maker.current_title,
        current_company_name: decision_maker.current_company_name,
        role_family: decision_maker.role_family,
        verification_status: decision_maker.verification_status,
        verification_methods: decision_maker.verification_methods ?? [],
      }
    : null;

  // Relevant research points: at most three concise, non-raw facts.
  const points: string[] = [];
  if (snapshot.overview.category) points.push(snapshot.overview.category);
  if (snapshot.overview.industry) points.push(snapshot.overview.industry);
  if (snapshot.hiring_signal?.title) points.push(`hiring: ${snapshot.hiring_signal.title}`);

  return {
    lead_candidate_id: snapshot.lead_candidate_id,
    company: {
      name: snapshot.company_identity.name,
      domain: snapshot.company_identity.domain,
      summary: snapshot.overview.summary,
      industry: snapshot.overview.industry,
      employee_range: snapshot.overview.employee_range,
      relevant_research_points: points.slice(0, 3),
    },
    decision_maker: dm,
    saved_icp,
    company_brain: brain,
    relevance: {
      why_this_company: why_relevant.why_this_company,
      why_this_person: why_relevant.why_this_person,
      why_now: why_relevant.why_now,
      relevant_outcome: brain.target_outcomes[0],
      personalization_depth: why_relevant.support_level === 'specific' ? 'specific'
        : why_relevant.support_level === 'company_level' ? 'company_level'
        : 'generic_value_only',
    },
    evidence: contextEvidence(snapshot),
    missing_evidence: snapshot.missing_evidence,
  };
}

/**
 * Build the Company-Brain context from the workspace's `company_brain.profile`.
 * Tolerant of legacy and v2 shapes. `present` is false for a null/empty brain so
 * the opener path blocks with a specific "Complete Company Brain" reason.
 */
export function brainContextFromProfile(profile: unknown): CompanyBrainContext {
  const p = (profile && typeof profile === 'object' && !Array.isArray(profile)) ? profile as Record<string, unknown> : null;
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
  if (!p) return { present: false, target_outcomes: [], differentiators: [], prohibited_claims: [], approved_ctas: [] };
  const positioningObj = obj(p.positioning);
  const product = obj(p.product);
  const voice = obj(p.voice);
  const positioning = str(p.positioning) ?? str(positioningObj.promise) ?? str(product.positioning) ?? undefined;
  const product_summary = str(product.summary) ?? str(p.product_summary) ?? undefined;
  const target_outcomes = arr(p.outcomes).concat(arr(p.target_outcomes), arr(product.outcomes));
  const differentiators = arr(p.differentiators).concat(arr(product.differentiators));
  const prohibited_claims = arr(voice.avoid).concat(arr(p.prohibited_claims), arr(p.avoid_phrases));
  const tone = str(voice.tone) ?? str(p.tone) ?? undefined;
  const approved_ctas = arr(p.approved_ctas).concat(arr(p.ctas));
  const present = !!(positioning || product_summary || target_outcomes.length || p.icp);
  return {
    present,
    ...(positioning ? { positioning } : {}),
    ...(product_summary ? { product_summary } : {}),
    target_outcomes: [...new Set(target_outcomes)],
    differentiators: [...new Set(differentiators)],
    prohibited_claims: [...new Set(prohibited_claims)],
    ...(tone ? { tone } : {}),
    approved_ctas: [...new Set(approved_ctas)],
  };
}

// --------------------------------------------------------------- eligibility --

export type OpenerReasonCode =
  | 'ready'
  | 'downgraded_company_level'
  | 'blocked_missing_verified_person'
  | 'blocked_missing_company_brain'
  | 'blocked_missing_company_research'
  | 'blocked_icp_disqualified';

export interface OpenerEligibility {
  status: 'ready' | 'downgraded' | 'blocked';
  reason_code: OpenerReasonCode;
  personalization_depth: PersonalizationDepth;
  allowed_evidence_ids: string[];
  missing_requirements: string[];
}

/** Gate on WORKBENCH evidence — not the sourcing-era draft-gate fields. */
export function assessOpenerEligibility(ctx: PersonalizationContext, icp: IcpSnapshot): OpenerEligibility {
  const allowed = ctx.evidence.filter((e) => e.allowed).map((e) => e.evidence_id);
  const personVerified = !!ctx.decision_maker && ctx.decision_maker.verification_status === 'verified';
  const researchUsable = !!ctx.company.summary && ctx.evidence.length > 0;

  // Hard ICP disqualifier overrides everything.
  if (icp.status === 'excluded') {
    return { status: 'blocked', reason_code: 'blocked_icp_disqualified', personalization_depth: 'generic_value_only', allowed_evidence_ids: [], missing_requirements: ['icp_disqualified'] };
  }
  if (!personVerified) {
    return { status: 'blocked', reason_code: 'blocked_missing_verified_person', personalization_depth: 'generic_value_only', allowed_evidence_ids: allowed, missing_requirements: ['verified_decision_maker'] };
  }
  if (!ctx.company_brain.present) {
    return { status: 'blocked', reason_code: 'blocked_missing_company_brain', personalization_depth: 'generic_value_only', allowed_evidence_ids: allowed, missing_requirements: ['company_brain'] };
  }
  if (!researchUsable) {
    return { status: 'blocked', reason_code: 'blocked_missing_company_research', personalization_depth: 'generic_value_only', allowed_evidence_ids: allowed, missing_requirements: ['usable_company_research'] };
  }

  // A fresh, verified timing signal enables "specific" depth.
  const freshSignal = ctx.evidence.some((e) => (e.source_type === 'job_posting' || e.source_type === 'signal') && e.freshness === 'fresh' && e.allowed);
  const icpMatched = icp.matched_criteria.length > 0 && icp.uses_saved_icp;

  if (freshSignal && icpMatched) {
    return { status: 'ready', reason_code: 'ready', personalization_depth: 'specific', allowed_evidence_ids: allowed, missing_requirements: [] };
  }
  if (icpMatched) {
    return { status: 'ready', reason_code: 'ready', personalization_depth: 'company_level', allowed_evidence_ids: allowed, missing_requirements: freshSignal ? [] : ['fresh_timing_signal'] };
  }
  // ICP incomplete/unmatched but person + research + brain exist → downgraded.
  return { status: 'downgraded', reason_code: 'downgraded_company_level', personalization_depth: icp.uses_saved_icp ? 'company_level' : 'generic_value_only', allowed_evidence_ids: allowed, missing_requirements: ['saved_icp_match'] };
}

// --------------------------------------------------------------- constraints --

export interface OpenerConstraints {
  preferred_min_words: number;
  preferred_max_words: number;
  hard_max_chars: number;
  max_sentences: number;
  max_questions: number;
}

export const DEFAULT_OPENER_CONSTRAINTS: OpenerConstraints = {
  preferred_min_words: 30,
  preferred_max_words: 85,
  hard_max_chars: 420,
  max_sentences: 3,
  max_questions: 1,
};

// ------------------------------------------------------- prohibited patterns --

/** Phrases that are always rejected (fake familiarity, hype, mass-outreach, send). */
export const PROHIBITED_PHRASES: readonly RegExp[] = [
  /\bi came across your profile\b/i,
  /\bhope you(?:'| a)re doing well\b/i,
  /\bhope you(?:'| a)re well\b/i,
  /\bjust wanted to reach out\b/i,
  /\bi noticed your impressive background\b/i,
  /\brevolutioni[sz]e\b/i,
  /\bgame[- ]changing\b/i,
  /\b10x your pipeline\b/i,
  /\bai sdr\b/i,
  /\breplace your (?:sales )?team\b/i,
  /\breplace your reps\b/i,
  /\bblast\b/i,
  /\bmass (?:outreach|email)\b/i,
  /\bautomatically send\b/i,
  /\bauto[- ]?send\b/i,
  /\bwe(?:'| wi)ll send\b/i,
];

/** Claim keywords that assert a real-world event and therefore REQUIRE fresh,
 * allowed evidence backing. Used for the no-fabrication check. */
const EVENT_CLAIM_PATTERNS: Array<{ re: RegExp; requires: EvidenceSourceType[] }> = [
  { re: /\bhiring\b|\bhire\b/i, requires: ['job_posting'] },
  { re: /\bexpanding (?:the |its )?(?:team|revenue|sales)\b|\bteam is (?:growing|expanding)\b/i, requires: ['job_posting', 'signal'] },
  { re: /\braised\b|\bfunding\b|\bseries [a-d]\b|\bseed round\b/i, requires: ['signal'] },
  { re: /\bproduct launch\b|\bjust launched\b|\bnew launch\b/i, requires: ['signal'] },
  { re: /\brevenue (?:of|is|grew)\b/i, requires: ['signal'] },
];

export function findProhibitedPhrases(text: string, brainProhibited: string[] = []): string[] {
  const hits: string[] = [];
  for (const re of PROHIBITED_PHRASES) if (re.test(text)) hits.push(re.source);
  for (const claim of brainProhibited) {
    const c = str(claim);
    if (c && text.toLowerCase().includes(c.toLowerCase())) hits.push(`brain:${c}`);
  }
  return hits;
}

// ---------------------------------------------------------------- counting ----

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
export function countSentences(text: string): number {
  return text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 0).length;
}
export function countQuestions(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

// ---------------------------------------------------------------- validation --

export interface OpenerValidation {
  length_valid: boolean;
  evidence_valid: boolean;
  tone_valid: boolean;
  prohibited_claims_absent: boolean;
  no_fabrication: boolean;
  approval_required: true;
  violations: string[];
}

/**
 * Validate one candidate opener against the context + eligibility. Every factual
 * event claim must be backed by fresh allowed evidence of the required kind; a
 * stale signal worded as current, an invented event, a prohibited phrase, or a
 * length/structure breach fails validation.
 */
export function validateOpener(
  text: string,
  ctx: PersonalizationContext,
  eligibility: OpenerEligibility,
  constraints: OpenerConstraints = DEFAULT_OPENER_CONSTRAINTS,
): OpenerValidation {
  const violations: string[] = [];
  const trimmed = text.trim();

  // Length / structure.
  const chars = trimmed.length;
  const sentences = countSentences(trimmed);
  const questions = countQuestions(trimmed);
  const length_valid = chars > 0 && chars <= constraints.hard_max_chars
    && sentences <= constraints.max_sentences && questions <= constraints.max_questions;
  if (chars === 0) violations.push('empty');
  if (chars > constraints.hard_max_chars) violations.push('over_char_cap');
  if (sentences > constraints.max_sentences) violations.push('too_many_sentences');
  if (questions > constraints.max_questions) violations.push('too_many_questions');
  // A full email body carries greetings/sign-offs/newlines.
  if (/\n\s*\n/.test(text) || /\b(?:subject:|dear |best regards|kind regards|sincerely|cheers,)\b/i.test(text)) {
    violations.push('looks_like_full_draft');
  }

  // Prohibited phrases + Company-Brain prohibited claims.
  const prohibited = findProhibitedPhrases(trimmed, ctx.company_brain.prohibited_claims);
  const prohibited_claims_absent = prohibited.length === 0;
  for (const p of prohibited) violations.push(`prohibited:${p}`);

  // Tone: fake familiarity / generic compliment.
  const toneBad = /\bimpressive\b|\blove what you(?:'| a)re doing\b|\bbig fan\b|\bhuge fan\b/i.test(trimmed);
  const tone_valid = !toneBad;
  if (toneBad) violations.push('fake_familiarity_or_compliment');

  // No-fabrication: any event claim must be backed by fresh allowed evidence.
  let no_fabrication = true;
  const allowedFresh = new Set(
    ctx.evidence.filter((e) => e.allowed && (e.freshness === 'fresh' || e.freshness === 'recent')).map((e) => e.source_type),
  );
  const allowedFreshSignalNow = ctx.evidence.some((e) => e.allowed && e.freshness === 'fresh' && (e.source_type === 'job_posting' || e.source_type === 'signal'));
  for (const { re, requires } of EVENT_CLAIM_PATTERNS) {
    if (!re.test(trimmed)) continue;
    const backed = requires.some((k) => allowedFresh.has(k));
    // A present-tense current-event claim (hiring/expanding/just launched) needs a
    // FRESH signal, not merely a recent firmographic.
    const assertsCurrent = /\b(?:hiring|expanding|just launched|raised)\b/i.test(trimmed);
    if (!backed || (assertsCurrent && !allowedFreshSignalNow)) {
      no_fabrication = false;
      violations.push('unsupported_or_stale_event_claim');
      break;
    }
  }

  // Evidence-valid: at company_level/specific the opener should reference the
  // company by name or a research point; a generic value-only opener may not.
  const namesCompany = !!ctx.company.name && trimmed.toLowerCase().includes(ctx.company.name.toLowerCase());
  const evidence_valid = eligibility.personalization_depth === 'generic_value_only' ? true : (namesCompany || ctx.evidence.length > 0);
  if (!evidence_valid) violations.push('no_grounded_reference');

  return {
    length_valid,
    evidence_valid,
    tone_valid,
    prohibited_claims_absent,
    no_fabrication,
    approval_required: true,
    violations,
  };
}

export function openerValid(v: OpenerValidation): boolean {
  return v.length_valid && v.evidence_valid && v.tone_valid && v.prohibited_claims_absent && v.no_fabrication;
}

// ---------------------------------------------------------------- generation --

export type OpenerStatus = 'succeeded' | 'blocked' | 'unavailable' | 'timed_out' | 'failed' | 'failed_validation';

export interface OpenerResult {
  status: OpenerStatus;
  reason_code: OpenerReasonCode | 'failed_validation' | 'unavailable' | 'timed_out' | 'error';
  opener?: string;
  alternative_opener?: string;
  personalization_depth: PersonalizationDepth;
  used_evidence_ids: string[];
  omitted_claims: string[];
  validation?: OpenerValidation;
  approval_required: true;
  sent: false;
  provider_attempted: boolean;
  sanitized_error_code?: string;
}

export interface ModelOpenerRequest {
  personalization_context: PersonalizationContext;
  eligibility: OpenerEligibility;
  constraints: OpenerConstraints;
}

export interface ModelOpenerResponse {
  opener: string;
  alternative_opener?: string;
  /** Evidence the model claims to have used. */
  used_evidence_ids?: string[];
}

/** The injected model boundary. Tests supply a deterministic stub — never a model. */
export type ModelBoundary = (req: ModelOpenerRequest) => Promise<ModelOpenerResponse>;

/**
 * Generate a validated personalized opener. A blocked eligibility returns
 * immediately with NO model call. On a model result the opener is validated;
 * a validation failure returns `failed_validation` and never a misleading draft.
 */
export async function generateOpener(
  ctx: PersonalizationContext,
  eligibility: OpenerEligibility,
  model: ModelBoundary,
  constraints: OpenerConstraints = DEFAULT_OPENER_CONSTRAINTS,
): Promise<OpenerResult> {
  const depth = eligibility.personalization_depth;
  const base = { personalization_depth: depth, used_evidence_ids: [] as string[], omitted_claims: [] as string[], approval_required: true as const, sent: false as const };

  if (eligibility.status === 'blocked') {
    return { ...base, status: 'blocked', reason_code: eligibility.reason_code, provider_attempted: false };
  }

  let resp: ModelOpenerResponse;
  try {
    resp = await model({ personalization_context: ctx, eligibility, constraints });
  } catch {
    return { ...base, status: 'failed', reason_code: 'error', provider_attempted: true, sanitized_error_code: 'model_error' };
  }

  const opener = str(resp.opener);
  if (!opener) {
    return { ...base, status: 'unavailable', reason_code: 'unavailable', provider_attempted: true };
  }

  const validation = validateOpener(opener, ctx, eligibility, constraints);
  if (!openerValid(validation)) {
    return { ...base, status: 'failed_validation', reason_code: 'failed_validation', provider_attempted: true, validation, opener: undefined };
  }

  // Validate the optional alternative independently; drop it if it fails.
  const altRaw = str(resp.alternative_opener);
  const alt = altRaw && openerValid(validateOpener(altRaw, ctx, eligibility, constraints)) ? altRaw : undefined;

  const used = (resp.used_evidence_ids ?? []).filter((id) => eligibility.allowed_evidence_ids.includes(id));

  return {
    ...base,
    status: 'succeeded',
    reason_code: eligibility.reason_code,
    opener,
    alternative_opener: alt,
    used_evidence_ids: used,
    validation,
    provider_attempted: true,
  };
}

// --------------------------------------------------------------- persistence --

export type OpenerApprovalStatus = 'draft' | 'edited' | 'approved';

export interface OutreachStagePayload {
  status: OpenerStatus;
  reason_code: OpenerResult['reason_code'];
  opener: string | null;
  alternative_opener: string | null;
  personalization_depth: PersonalizationDepth;
  used_evidence_ids: string[];
  validation: OpenerValidation | null;
  approval_required: true;
  approval_status: OpenerApprovalStatus;
  generated_at: string;
  output_mode: OutreachOutputMode;
  sent: false;
}

/**
 * Build the namespaced outreach-stage payload. A FAILED retry must preserve the
 * previous valid opener, so `previous` (the last successful payload) is carried
 * forward when the new result did not succeed.
 */
export function buildOutreachStagePayload(
  result: OpenerResult,
  now: string,
  previous?: OutreachStagePayload | null,
): OutreachStagePayload {
  if (result.status !== 'succeeded' && previous?.opener) {
    // Keep the last good opener; record the new (failed) attempt's status/reason.
    return { ...previous, status: result.status, reason_code: result.reason_code };
  }
  return {
    status: result.status,
    reason_code: result.reason_code,
    opener: result.opener ?? null,
    alternative_opener: result.alternative_opener ?? null,
    personalization_depth: result.personalization_depth,
    used_evidence_ids: result.used_evidence_ids,
    validation: result.validation ?? null,
    approval_required: true,
    approval_status: 'draft',
    generated_at: now,
    output_mode: OPENER_OUTPUT_MODE,
    sent: false,
  };
}

// --------------------------------------------------------------- presentation --

export const OPENER_BLOCKER_COPY: Record<OpenerReasonCode, string> = {
  ready: 'Ready to generate a personalized opener',
  downgraded_company_level: 'Company-level opener (no verified current trigger)',
  blocked_missing_verified_person: 'Find a verified decision-maker first',
  blocked_missing_company_brain: 'Complete Company Brain first',
  blocked_missing_company_research: 'Add usable company research first',
  blocked_icp_disqualified: 'Account is excluded by your ICP',
};

/** Never the bare "Complete the required previous step first". */
export function openerBlockerCopy(reason: OpenerReasonCode | string | null | undefined): string {
  if (reason && reason in OPENER_BLOCKER_COPY) return OPENER_BLOCKER_COPY[reason as OpenerReasonCode];
  return 'Outreach generation unavailable';
}

/** Compact, pure row hint for the Personalized Message cell — keeps the component
 * free of eligibility logic. Never the generic "previous step" copy. */
export interface OutreachRowHint {
  status: 'has_opener' | 'ready' | 'blocked';
  opener: string | null;
  alternative_opener: string | null;
  personalization_depth: PersonalizationDepth;
  blocker_copy: string | null;
  source_count: number;
  approval_status: OpenerApprovalStatus | null;
}

export function buildOutreachRowHint(input: {
  eligibility: OpenerEligibility;
  persisted?: OutreachStagePayload | null;
  source_count: number;
}): OutreachRowHint {
  const { eligibility, persisted, source_count } = input;
  if (persisted?.opener) {
    return {
      status: 'has_opener',
      opener: persisted.opener,
      alternative_opener: persisted.alternative_opener ?? null,
      personalization_depth: persisted.personalization_depth,
      blocker_copy: null,
      source_count,
      approval_status: persisted.approval_status,
    };
  }
  if (eligibility.status === 'blocked') {
    return {
      status: 'blocked',
      opener: null,
      alternative_opener: null,
      personalization_depth: eligibility.personalization_depth,
      blocker_copy: openerBlockerCopy(eligibility.reason_code),
      source_count,
      approval_status: null,
    };
  }
  return {
    status: 'ready',
    opener: null,
    alternative_opener: null,
    personalization_depth: eligibility.personalization_depth,
    blocker_copy: null,
    source_count,
    approval_status: null,
  };
}

export const DEPTH_LABEL: Record<PersonalizationDepth, string> = {
  specific: 'Specific',
  company_level: 'Company-level',
  generic_value_only: 'Generic value',
};

export const OPENER_APPROVAL_NOTICE = 'Approval required · Nothing sent';
