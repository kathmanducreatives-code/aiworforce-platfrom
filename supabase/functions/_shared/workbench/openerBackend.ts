// Backend integration for the ICP-grounded personalized OPENER.
//
// RELATIONSHIP TO src/lib/outreachOpener.ts
//
//   That module is the authoritative pure contract, but it uses `@/` type-only
//   imports which Deno cannot resolve, so an edge function cannot import it.
//   The repo's established pattern for shared pure logic is a mirror (see
//   leadActionOutcome.ts, which exists in both trees).
//
//   Mirrored here are ONLY the security-critical parts — the constraints, the
//   prohibited phrases and the event-claim rules — because those must be
//   enforced server-side regardless of what any client does. A drift guard test
//   asserts these stay identical to the frontend source, so the two cannot
//   silently diverge.
//
//   Everything else in this file is genuinely backend-only: assembling the
//   personalization context from PERSISTED, workspace-scoped state.
//
// SAFETY
//   No raw scraped page, provider payload, email or phone number ever enters the
//   context or the prompt. The model boundary is injected, so tests never call a
//   model. Nothing is ever sent; approval is always required.

import type { WorkbenchAccountState } from "./accountState.ts";
import {
  resolveVerifiedDecisionMakerForOutreach,
  type DecisionMakerResolution,
} from "./decisionMakerResolver.ts";
import {
  buildSellerContext,
  buildSellerClaims,
  buildIcpContext,
  selectSellerOutcome,
  detectBrainContradictions,
  type SellerContext,
  type SellerClaim,
  type BrainContradiction,
} from "./sellerContext.ts";
import { selectBestCandidate } from "./openerCandidates.ts";
import { canonicalRecipient, type CanonicalRecipient } from "./outreachRecipient.ts";

// ---------------------------------------------------------------- output mode --

/**
 * Explicit request contract. Never inferred from component name, request origin,
 * UI text or message length.
 *
 * NOTE: the merged frontend contract (PR #70) names the legacy mode
 * `full_draft`, not `full_email`. We reuse that name rather than introduce a
 * second competing vocabulary.
 */
export type OutreachOutputMode = "personalized_opener" | "full_draft";

/**
 * Absent mode → the SAFEST backward-compatible behaviour: the pre-existing
 * full-draft path, exactly as every non-Workbench caller gets today.
 */
export const DEFAULT_OUTPUT_MODE: OutreachOutputMode = "full_draft";

export function resolveOutputMode(value: unknown): OutreachOutputMode {
  return value === "personalized_opener" ? "personalized_opener" : DEFAULT_OUTPUT_MODE;
}

// ------------------------------------------------------------------ context ----

export type PersonalizationDepth = "specific" | "company_level" | "generic_value_only";

export type EvidenceSourceType = "job_posting" | "company_site" | "linkedin" | "signal" | "sourcing";

export interface ContextEvidence {
  evidence_id: string;
  source_type: EvidenceSourceType;
  statement: string;
  source_domain?: string;
  fresh: boolean;
  allowed: boolean;
}

export interface BrainContext {
  positioning: string | null;
  product_summary: string | null;
  outcomes: string[];
  differentiators: string[];
  proof: string[];
  prohibited_claims: string[];
  tone: string | null;
  approved_ctas: string[];
  /** False when the workspace has no usable saved brain. */
  available: boolean;
}

export interface OpenerDecisionMaker {
  first_name: string | null;
  full_name: string;
  current_title: string | null;
  current_company_name: string | null;
  role_family: string | null;
  verification_status: string;
  verification_methods: string[];
}

export interface PersonalizationContext {
  lead_candidate_id: string;
  company: { name: string | null; summary: string | null; industry: string | null };
  decision_maker: OpenerDecisionMaker | null;
  brain: BrainContext;
  evidence: ContextEvidence[];
  icp_matched_criteria: string[];
  why_now: string | null;
  /**
   * The SELLER half — this workspace's own company, kept strictly apart from
   * `company` (the prospect). The prompt labels them as different companies so
   * the model cannot describe the seller using the prospect's business.
   */
  seller: SellerContext;
  /** The closed set of statements the model may make about the seller. */
  seller_claims: SellerClaim[];
  /** Chosen deterministically from the saved ICP — never echoed verbatim. */
  selected_seller_outcome: string | null;
  /** Which Company Brain produced the seller context above, for provenance. */
  company_brain_id: string | null;
  company_brain_updated_at: string | null;
  /**
   * How the person above was resolved, so eligibility can distinguish "nobody
   * exists" from "stored person data is malformed", and so observability can
   * report truthfully which storage location answered.
   */
  person_resolution: DecisionMakerResolution;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : [];
}

/** Read a nested object off the profile, tolerating a non-object value. */
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

/** First non-empty string from a list of candidates. */
function firstStr(...vals: unknown[]): string | null {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return null;
}

/** First non-empty string array from a list of candidates. */
function firstArr(...vals: unknown[]): string[] {
  for (const v of vals) {
    const a = strArray(v);
    if (a.length > 0) return a;
  }
  return [];
}

/**
 * Read the workspace's saved Company Brain. Workspace isolation is the caller's
 * responsibility (the row must already be scoped); this only shapes it.
 *
 * SCHEMA COMPATIBILITY
 *   This originally expected a FLAT profile — `positioning` and
 *   `product_summary` as plain strings, `target_outcomes` as an array. The
 *   Company Brain that onboarding actually persists is nested and uses
 *   different names: `positioning` is an OBJECT (`promise` / `offer` /
 *   `differentiators` / `proof_points` / `use_cases` / `avoid_positioning`),
 *   the summary lives in `company_summary` / `offer_summary` /
 *   `short_description`, and voice lives under `brand_voice`.
 *
 *   Result: a complete, onboarded Company Brain read as entirely absent, and
 *   the opener blocked with `blocked_missing_company_brain`. This reads BOTH
 *   shapes. The flat names still win when present, so nothing regresses.
 *
 *   Note `positioning` may also carry char-indexed keys ("0", "1", …) from a
 *   historical string-spread. Only NAMED keys are read, so that noise is
 *   ignored rather than concatenated back into prose.
 */
export function brainContextFromProfile(profile: unknown): BrainContext {
  const p = (profile ?? {}) as Record<string, unknown>;
  const pos = obj(p.positioning);
  const voice = obj(p.brand_voice);

  const positioning = firstStr(p.positioning, p.value_proposition, pos.promise, pos.offer);
  const product_summary = firstStr(
    p.product_summary,
    p.product,
    p.company_summary,
    p.offer_summary,
    p.short_description,
  );
  const outcomes = firstArr(p.target_outcomes, p.outcomes, pos.use_cases, p.pain_points);
  const available = !!(positioning || product_summary || outcomes.length > 0);

  return {
    positioning,
    product_summary,
    outcomes,
    differentiators: firstArr(p.differentiators, pos.differentiators),
    proof: firstArr(p.proof, pos.proof_points),
    // UNION, not first-wins. A prohibition recorded in any location must be
    // enforced — silently dropping one because another list was non-empty would
    // let a forbidden claim through.
    prohibited_claims: [...new Set([
      ...strArray(p.prohibited_claims),
      ...strArray(pos.avoid_positioning),
      ...strArray(voice.avoid),
      ...strArray(p.negative_examples),
    ])],
    tone: firstStr(p.voice, p.tone, voice.tone, p.outreach_style),
    approved_ctas: firstArr(p.approved_ctas, p.ctas),
    available,
  };
}

export interface BuildContextInput {
  lead_candidate_id: string;
  company_name: string | null;
  industry: string | null;
  /** Persisted Workbench stage state — the source of research + person truth. */
  account: WorkbenchAccountState;
  /**
   * Legacy `raw.decision_makers`, read ONLY as a compatibility fallback for
   * accounts whose decision-maker run predates the namespaced stage. See
   * decisionMakerResolver.ts — acceptance rules live there, not here.
   */
  legacy_decision_makers?: unknown;
  brain_profile: unknown;
  /** The workspace's saved ICP, used only to select the most relevant outcome. */
  saved_icp?: unknown;
  /** Identity of the Brain the seller context came from (workspace-scoped). */
  company_brain_id?: string | null;
  company_brain_updated_at?: string | null;
  icp_matched_criteria?: string[];
  /** Fresh timing statement, only when genuinely supported. */
  why_now?: string | null;
  job_posting?: { role: string | null; fresh: boolean; source_domain?: string } | null;
}

/**
 * Assemble the personalization context from PERSISTED state only.
 *
 * Deliberately narrow: a summary, an industry, a verified person, a handful of
 * evidence statements. No raw pages, no provider payloads, no contact details.
 */
export function buildPersonalizationContext(input: BuildContextInput): PersonalizationContext {
  const research = input.account.company_research.last_success;

  // SELLER context, built from this workspace's own Company Brain and kept
  // strictly separate from the prospect facts below.
  const seller = buildSellerContext(input.brain_profile);

  // ONE resolver decides who (if anyone) we may write to. It reads the
  // namespaced stage first and falls back to the legacy projection only for
  // accounts the namespace never answered for. See decisionMakerResolver.ts.
  const person_resolution = resolveVerifiedDecisionMakerForOutreach({
    workbenchDecisionMakers: input.account.decision_makers,
    legacyDecisionMakers: input.legacy_decision_makers,
  });

  const evidence: ContextEvidence[] = [];

  // Company research sources become evidence — domain only, never page bodies.
  for (const [i, url] of (research?.evidence_urls ?? []).entries()) {
    let domain: string | undefined;
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch { /* a malformed source contributes no domain */ }
    evidence.push({
      evidence_id: `research_${i + 1}`,
      source_type: "company_site",
      statement: research?.summary ?? "Company research source",
      source_domain: domain,
      fresh: true,
      allowed: true,
    });
  }

  if (input.job_posting?.role) {
    evidence.push({
      evidence_id: "job_1",
      source_type: "job_posting",
      statement: `Hiring a ${input.job_posting.role}`,
      source_domain: input.job_posting.source_domain,
      fresh: input.job_posting.fresh,
      // A stale posting stays in the context but may NOT ground a claim.
      allowed: input.job_posting.fresh,
    });
  }

  const resolved = person_resolution.person;
  const decision_maker: OpenerDecisionMaker | null = resolved
    ? {
      first_name: resolved.first_name ?? null,
      full_name: resolved.full_name,
      // The legacy projection carries a real title; the namespaced projection
      // does not, and role_family stands in for it there.
      current_title: resolved.current_title ?? resolved.role_family ?? null,
      current_company_name: resolved.current_company_name ?? null,
      role_family: resolved.role_family ?? null,
      verification_status: "verified",
      verification_methods: resolved.verification_methods,
    }
    : null;

  return {
    lead_candidate_id: input.lead_candidate_id,
    company: {
      name: input.company_name,
      summary: research?.summary ?? null,
      industry: input.industry,
    },
    decision_maker,
    brain: brainContextFromProfile(input.brain_profile),
    evidence,
    icp_matched_criteria: input.icp_matched_criteria ?? [],
    why_now: input.why_now ?? null,
    seller,
    seller_claims: buildSellerClaims(seller),
    // Chosen deterministically. The ICP decides WHICH seller outcome is most
    // relevant; it never contributes a fact about the prospect, and its
    // vocabulary never reaches the message.
    selected_seller_outcome: selectSellerOutcome(seller, buildIcpContext(input.saved_icp)),
    company_brain_id: input.company_brain_id ?? null,
    company_brain_updated_at: input.company_brain_updated_at ?? null,
    person_resolution,
  };
}

// -------------------------------------------------------------- eligibility ----

export type OpenerReasonCode =
  | "ready"
  | "downgraded_company_level"
  | "blocked_missing_verified_person"
  | "blocked_person_contract_invalid"
  | "blocked_missing_company_brain"
  | "blocked_company_brain_conflict"
  | "blocked_missing_company_research"
  | "blocked_icp_disqualified";

/**
 * Sanitized diagnostics for a Company Brain that contradicts itself. Carries
 * IDENTIFIERS and normalized concepts only — never prompt text, never the full
 * claim bodies beyond the overlapping terms the user needs to find the clash.
 */
export interface BrainConflictDiagnostics {
  conflicting_claim_ids: string[];
  conflicting_prohibited: string[];
  overlapping_concepts: string[];
  company_brain_id: string | null;
  company_brain_updated_at: string | null;
}

export interface OpenerEligibility {
  status: "ready" | "downgraded" | "blocked";
  reason_code: OpenerReasonCode;
  /** Present only when reason_code is blocked_company_brain_conflict. */
  brain_conflict?: BrainConflictDiagnostics;
  personalization_depth: PersonalizationDepth;
  allowed_evidence_ids: string[];
  missing_requirements: string[];
}

/**
 * Gate on WORKBENCH-established evidence, not the sourcing-era draft-gate
 * fields. Order matters: a hard ICP disqualifier overrides everything.
 */
export function assessOpenerEligibility(
  ctx: PersonalizationContext,
  icpExcluded: boolean,
): OpenerEligibility {
  const allowed = ctx.evidence.filter((e) => e.allowed).map((e) => e.evidence_id);

  if (icpExcluded) {
    return {
      status: "blocked",
      reason_code: "blocked_icp_disqualified",
      personalization_depth: "generic_value_only",
      allowed_evidence_ids: [],
      missing_requirements: ["icp_disqualified"],
    };
  }

  // A Company Brain that approves and forbids the same positioning cannot be
  // acted on: choosing a side would be guessing at what the tenant meant, and
  // the wrong guess ships messaging they explicitly banned. Block BEFORE the
  // model so a misconfigured Brain costs nothing.
  const brainConflicts: BrainContradiction[] = detectBrainContradictions(ctx.seller, ctx.seller_claims);
  if (brainConflicts.length > 0) {
    return {
      status: "blocked",
      reason_code: "blocked_company_brain_conflict",
      brain_conflict: {
        conflicting_claim_ids: [...new Set(brainConflicts.map((c) => c.claim_id))],
        conflicting_prohibited: [...new Set(brainConflicts.map((c) => c.prohibited))],
        overlapping_concepts: [...new Set(brainConflicts.flatMap((c) => c.overlap))],
        company_brain_id: ctx.company_brain_id,
        company_brain_updated_at: ctx.company_brain_updated_at,
      },
      personalization_depth: "none" as PersonalizationDepth,
      allowed_evidence_ids: allowed,
      missing_requirements: ["coherent_company_brain"],
    };
  }

  // Stored person data that claims a verification it cannot support is a
  // DIFFERENT failure from nobody having been found — reporting it as "find a
  // decision-maker" would send the user to re-run a search that already
  // succeeded.
  if (ctx.person_resolution.status === "contract_invalid") {
    return {
      status: "blocked",
      reason_code: "blocked_person_contract_invalid",
      personalization_depth: "none" as PersonalizationDepth,
      allowed_evidence_ids: allowed,
      missing_requirements: ["valid_decision_maker_record"],
    };
  }

  const personVerified = !!ctx.decision_maker && ctx.decision_maker.verification_status === "verified";
  if (!personVerified) {
    return {
      status: "blocked",
      reason_code: "blocked_missing_verified_person",
      personalization_depth: "none" as PersonalizationDepth,
      allowed_evidence_ids: allowed,
      missing_requirements: ["verified_decision_maker"],
    };
  }

  if (!ctx.brain.available) {
    return {
      status: "blocked",
      reason_code: "blocked_missing_company_brain",
      personalization_depth: "none" as PersonalizationDepth,
      allowed_evidence_ids: allowed,
      missing_requirements: ["company_brain"],
    };
  }

  const researchUsable = !!ctx.company.summary && ctx.evidence.length > 0;
  if (!researchUsable) {
    return {
      status: "blocked",
      reason_code: "blocked_missing_company_research",
      personalization_depth: "none" as PersonalizationDepth,
      allowed_evidence_ids: allowed,
      missing_requirements: ["company_research"],
    };
  }

  // A fresh, allowed timing signal is what earns "specific" personalization.
  const freshTiming = ctx.evidence.some((e) => e.allowed && e.fresh && (e.source_type === "job_posting" || e.source_type === "signal"));
  if (!freshTiming) {
    // No trigger is NOT a block — it downgrades depth and never invents a why-now.
    return {
      status: "downgraded",
      reason_code: "downgraded_company_level",
      personalization_depth: "company_level",
      allowed_evidence_ids: allowed,
      missing_requirements: ["fresh_timing_signal"],
    };
  }

  return {
    status: "ready",
    reason_code: "ready",
    personalization_depth: "specific",
    allowed_evidence_ids: allowed,
    missing_requirements: [],
  };
}

// --------------------------------------------------------------- constraints --
// MIRRORED from src/lib/outreachOpener.ts — kept in sync by a drift guard test.

export interface OpenerConstraints {
  preferred_min_words: number;
  preferred_max_words: number;
  hard_max_chars: number;
  max_sentences: number;
  max_questions: number;
}

/**
 * Violations that are ADVISORY: reported so the operator can see them, but not
 * grounds for rejection.
 *
 * `preferred_min_words` / `preferred_max_words` are named "preferred" and sit
 * alongside `hard_max_chars`, which is named "hard" — the distinction was
 * intended from the start but `ok` was computed as `violations.length === 0`,
 * making every preference fatal. A 36-word opener that respects the character,
 * sentence, question, structure and evidence rules is a good opener, and
 * rejecting it burns a model call for nothing.
 *
 * Nothing safety-related belongs in this set.
 */
const ADVISORY_VIOLATIONS: ReadonlySet<string> = new Set([
  "below_preferred_word_count",
  "above_preferred_word_count",
]);

export const DEFAULT_OPENER_CONSTRAINTS: OpenerConstraints = {
  preferred_min_words: 30,
  preferred_max_words: 85,
  hard_max_chars: 420,
  max_sentences: 3,
  max_questions: 1,
};

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

/** Claims asserting a real-world event REQUIRE fresh, allowed evidence. */
const EVENT_CLAIM_PATTERNS: Array<{ re: RegExp; requires: EvidenceSourceType[] }> = [
  { re: /\bhiring\b|\bhire\b/i, requires: ["job_posting"] },
  { re: /\bexpanding (?:the |its )?(?:team|revenue|sales)\b|\bteam is (?:growing|expanding)\b/i, requires: ["job_posting", "signal"] },
  { re: /\braised\b|\bfunding\b|\bseries [a-d]\b|\bseed round\b/i, requires: ["signal"] },
  { re: /\bproduct launch\b|\bjust launched\b|\bnew launch\b/i, requires: ["signal"] },
  { re: /\brevenue (?:of|is|grew)\b/i, requires: ["signal"] },
];

/** Structural markers of a full email — this path must never produce one. */
const EMAIL_STRUCTURE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /^subject\s*:/im, label: "subject_line" },
  { re: /\b(?:best regards|kind regards|sincerely|cheers,|regards,)\b/i, label: "signature" },
  { re: /\b[Dd]ear\s+[A-Z][a-z]/, label: "letter_greeting" },
  { re: /\[\s*(?:your name|signature|name)\s*\]/i, label: "signature_placeholder" },
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
  ok: boolean;
  violations: string[];
  word_count: number;
  char_count: number;
  sentence_count: number;
  question_count: number;
  unsupported_claims: string[];
}

/**
 * Validate a generated opener before it may be persisted or shown.
 *
 * Every factual event claim must map to fresh, ALLOWED evidence. A stale job
 * posting is present in the context but not allowed, so "they're hiring" fails
 * — which is the point: a stale signal must never be described as current.
 */
export function validateOpener(
  text: string,
  ctx: PersonalizationContext,
  eligibility: OpenerEligibility,
  constraints: OpenerConstraints = DEFAULT_OPENER_CONSTRAINTS,
): OpenerValidation {
  const violations: string[] = [];
  const unsupported_claims: string[] = [];

  const char_count = text.length;
  const word_count = countWords(text);
  const sentence_count = countSentences(text);
  const question_count = countQuestions(text);

  // An empty opener is a hard failure in its own right. It used to be caught
  // only as a side effect of `below_preferred_word_count` being fatal; now that
  // word count is advisory, emptiness must be stated explicitly or whitespace
  // would validate.
  if (text.trim().length === 0) violations.push("empty_opener");

  if (char_count > constraints.hard_max_chars) violations.push("too_long_chars");
  if (sentence_count > constraints.max_sentences) violations.push("too_many_sentences");
  if (question_count > constraints.max_questions) violations.push("too_many_questions");
  // PREFERRED, not hard. Reported for observability, never fatal — see
  // ADVISORY_VIOLATIONS below.
  if (word_count < constraints.preferred_min_words) violations.push("below_preferred_word_count");
  if (word_count > constraints.preferred_max_words) violations.push("above_preferred_word_count");

  for (const { re, label } of EMAIL_STRUCTURE_PATTERNS) {
    if (re.test(text)) violations.push(`email_structure_${label}`);
  }

  const prohibited = findProhibitedPhrases(text, ctx.brain.prohibited_claims);
  for (const p of prohibited) violations.push(`prohibited:${p}`);

  // Event claims need fresh allowed evidence of the right kind.
  const allowedTypes = new Set(
    ctx.evidence.filter((e) => e.allowed && e.fresh).map((e) => e.source_type),
  );
  for (const { re, requires } of EVENT_CLAIM_PATTERNS) {
    if (!re.test(text)) continue;
    if (!requires.some((t) => allowedTypes.has(t))) {
      unsupported_claims.push(re.source);
      violations.push("unsupported_event_claim");
    }
  }

  // A downgraded/company-level opener may not assert a timing trigger at all.
  if (eligibility.personalization_depth !== "specific") {
    for (const { re } of EVENT_CLAIM_PATTERNS) {
      if (re.test(text) && !unsupported_claims.includes(re.source)) {
        unsupported_claims.push(re.source);
        violations.push("timing_claim_without_specific_depth");
      }
    }
  }

  return {
    // Advisory violations describe STYLE preference, not a safety, factual or
    // format limit, so they must not reject an otherwise valid opener. Every
    // hard constraint — character cap, sentence/question caps, email structure,
    // prohibited phrases, unsupported/stale event claims — still fails hard.
    ok: violations.every((v) => ADVISORY_VIOLATIONS.has(v)),
    violations,
    word_count,
    char_count,
    sentence_count,
    question_count,
    unsupported_claims,
  };
}

// ------------------------------------------------------------ model boundary --

export interface ModelOpenerRequest {
  personalization_context: PersonalizationContext;
  eligibility: OpenerEligibility;
  constraints: OpenerConstraints;
}

export interface ModelOpenerResponse {
  opener: string;
  alternative_opener?: string;
  used_evidence_ids?: string[];
  /** Which approved seller claims the model drew on. Backend-only. */
  used_seller_claim_ids?: string[];
}

/** Injected so tests never reach a model. */
export type ModelBoundary = (req: ModelOpenerRequest) => Promise<ModelOpenerResponse>;

export type OpenerStatus =
  | "succeeded"
  | "blocked"
  | "unavailable"
  | "timed_out"
  | "failed"
  | "failed_validation";

export interface OpenerResult {
  status: OpenerStatus;
  reason_code: string;
  opener?: string;
  alternative_opener?: string;
  personalization_depth: PersonalizationDepth;
  used_evidence_ids: string[];
  omitted_claims: string[];
  validation?: OpenerValidation;
  approval_required: true;
  approval_status: "draft";
  sent: false;
  provider_attempted: boolean;
  sanitized_error_code?: string;
  model_calls: number;
  /** The single recipient this opener was generated for. See outreachRecipient.ts. */
  recipient?: CanonicalRecipient;
}

/** Sanitized classification — a raw model/provider error never propagates. */
function classifyModelError(e: unknown): { status: OpenerStatus; code: string } {
  const raw = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();
  if (/timeout|timed out|deadline/.test(raw)) return { status: "timed_out", code: "provider_timed_out" };
  if (/not configured|unauthorized|forbidden|401|403|no api key/.test(raw)) {
    return { status: "unavailable", code: "provider_not_configured" };
  }
  return { status: "failed", code: "provider_failed" };
}

/**
 * Generate a validated opener.
 *
 * A blocked eligibility returns immediately with ZERO model calls — that is what
 * makes a blocked lead cost nothing. A validation failure returns
 * `failed_validation` and never persists a misleading draft.
 */
export async function generateOpener(
  ctx: PersonalizationContext,
  eligibility: OpenerEligibility,
  model: ModelBoundary,
  constraints: OpenerConstraints = DEFAULT_OPENER_CONSTRAINTS,
): Promise<OpenerResult> {
  const base = {
    personalization_depth: eligibility.personalization_depth,
    used_evidence_ids: [] as string[],
    omitted_claims: [] as string[],
    approval_required: true as const,
    approval_status: "draft" as const,
    sent: false as const,
  };

  if (eligibility.status === "blocked") {
    return {
      ...base,
      status: "blocked",
      reason_code: eligibility.reason_code,
      provider_attempted: false,
      model_calls: 0,
    };
  }

  let resp: ModelOpenerResponse;
  try {
    resp = await model({ personalization_context: ctx, eligibility, constraints });
  } catch (e) {
    const { status, code } = classifyModelError(e);
    return { ...base, status, reason_code: code, provider_attempted: true, sanitized_error_code: code, model_calls: 1 };
  }

  const opener = str(resp?.opener);
  if (!opener) {
    return {
      ...base,
      status: "failed",
      reason_code: "empty_model_output",
      provider_attempted: true,
      model_calls: 1,
    };
  }

  // Only ids that actually exist may be credited. An id the model invented is a
  // contract violation, not a detail to quietly drop — it means the message may
  // be grounded in something that does not exist.
  const allowedEvidence = new Set(eligibility.allowed_evidence_ids);
  const allowedClaims = new Set(ctx.seller_claims.map((c) => c.id));

  const claimedEvidence = resp.used_evidence_ids ?? [];
  const claimedSellerClaims = resp.used_seller_claim_ids ?? [];

  const unknownEvidence = claimedEvidence.filter((id) => !allowedEvidence.has(id));
  const unknownClaims = claimedSellerClaims.filter((id) => !allowedClaims.has(id));

  if (unknownEvidence.length > 0 || unknownClaims.length > 0) {
    return {
      ...base,
      status: "failed_validation",
      reason_code: "failed_validation",
      validation: {
        ...validateOpener(opener, ctx, eligibility, constraints),
        ok: false,
        violations: [
          ...(unknownEvidence.length > 0 ? ["unknown_evidence_id"] : []),
          ...(unknownClaims.length > 0 ? ["unknown_seller_claim_id"] : []),
        ],
      },
      provider_attempted: true,
      model_calls: 1,
    };
  }

  const usedEvidence = claimedEvidence.filter((id) => allowedEvidence.has(id));
  const usedClaims = claimedSellerClaims.filter((id) => allowedClaims.has(id));

  // A "specific" message that cites nothing is not specific. Depth is a promise
  // to the user about how the message was grounded.
  if (eligibility.personalization_depth === "specific" && usedEvidence.length === 0) {
    return {
      ...base,
      status: "failed_validation",
      reason_code: "failed_validation",
      validation: {
        ...validateOpener(opener, ctx, eligibility, constraints),
        ok: false,
        violations: ["specific_depth_without_evidence"],
      },
      provider_attempted: true,
      model_calls: 1,
    };
  }

  // Validate BOTH candidates from the single model call, then let the stronger
  // one win. Previously the primary was used whenever it validated, so a vague
  // primary beat a specific alternative — and a failing primary failed the whole
  // request even when the alternative was good.
  const alt = str(resp.alternative_opener);
  const primaryValidation = validateOpener(opener, ctx, eligibility, constraints);
  const altValidation = alt ? validateOpener(alt, ctx, eligibility, constraints) : null;

  const valid: Array<{ text: string; validation: OpenerValidation }> = [];
  if (primaryValidation.ok) valid.push({ text: opener, validation: primaryValidation });
  if (alt && altValidation?.ok) valid.push({ text: alt, validation: altValidation });

  if (valid.length === 0) {
    return {
      ...base,
      status: "failed_validation",
      reason_code: "failed_validation",
      validation: primaryValidation,
      omitted_claims: primaryValidation.unsupported_claims,
      provider_attempted: true,
      model_calls: 1,
    };
  }

  const best = selectBestCandidate(
    valid.map((v) => ({
      text: v.text,
      used_evidence_ids: usedEvidence,
      used_seller_claim_ids: usedClaims,
    })),
    {
      personalization_depth: eligibility.personalization_depth,
      company_name: ctx.company.name,
      recipient_first_name: ctx.decision_maker?.first_name ?? null,
    },
  );

  const chosen = valid.find((v) => v.text === best?.text) ?? valid[0];
  const runnerUp = valid.find((v) => v.text !== chosen.text);

  return {
    ...base,
    status: "succeeded",
    reason_code: eligibility.reason_code,
    opener: chosen.text,
    ...(runnerUp ? { alternative_opener: runnerUp.text } : {}),
    used_evidence_ids: usedEvidence,
    validation: chosen.validation,
    provider_attempted: true,
    model_calls: 1,
    // Record exactly who this opener was written for — the same person that
    // entered the prompt — so nothing downstream re-derives a different one.
    recipient: canonicalRecipient(ctx.decision_maker, ctx.person_resolution.person),
  };
}

// ------------------------------------------------------------- stage payload --

export interface OpenerStagePayload {
  output_mode: "personalized_opener";
  status: OpenerStatus;
  reason_code: string;
  opener: string | null;
  alternative_opener: string | null;
  personalization_depth: PersonalizationDepth;
  used_evidence_ids: string[];
  omitted_claims: string[];
  validation: OpenerValidation | null;
  approval_required: true;
  approval_status: "draft";
  sent: false;
  generated_at: string;
  /**
   * The single recipient this opener was generated for. Persisted so the row,
   * Lead Detail, Review and CSV all read ONE recipient instead of each
   * re-deriving its own — the fix for "generated for Kenneth, displayed Amy".
   */
  selected_contact_id: string | null;
  selected_recipient_name: string | null;
  selected_recipient_first_name: string | null;
  selected_recipient_title: string | null;
  selected_recipient_role_family: string | null;
}

export function buildOpenerStagePayload(result: OpenerResult, now: string): OpenerStagePayload {
  return {
    output_mode: "personalized_opener",
    status: result.status,
    reason_code: result.reason_code,
    opener: result.opener ?? null,
    alternative_opener: result.alternative_opener ?? null,
    personalization_depth: result.personalization_depth,
    used_evidence_ids: result.used_evidence_ids,
    omitted_claims: result.omitted_claims,
    validation: result.validation ?? null,
    approval_required: true,
    approval_status: "draft",
    sent: false,
    generated_at: now,
    selected_contact_id: result.recipient?.selected_contact_id ?? null,
    selected_recipient_name: result.recipient?.selected_recipient_name ?? null,
    selected_recipient_first_name: result.recipient?.selected_recipient_first_name ?? null,
    selected_recipient_title: result.recipient?.selected_recipient_title ?? null,
    selected_recipient_role_family: result.recipient?.selected_recipient_role_family ?? null,
  };
}

/** Sanitized telemetry. Never a prompt, a model response or contact data. */
export interface OpenerObservability {
  lead_candidate_id: string;
  workspace_id: string;
  output_mode: "personalized_opener";
  eligibility: OpenerEligibility["status"];
  reason_code: string;
  personalization_depth: PersonalizationDepth;
  evidence_count: number;
  model_attempted: boolean;
  model_calls: number;
  validation_ok: boolean | null;
  persisted: boolean;
  approval_status: "draft";
  sent: false;
  /** Sanitized recipient provenance: id and role only, never a name or email. */
  selected_contact_id: string | null;
  selected_recipient_role_family: string | null;
}

export function buildOpenerObservability(input: {
  lead_candidate_id: string;
  workspace_id: string;
  ctx: PersonalizationContext;
  eligibility: OpenerEligibility;
  result: OpenerResult;
  persisted: boolean;
}): OpenerObservability {
  return {
    lead_candidate_id: input.lead_candidate_id,
    workspace_id: input.workspace_id,
    output_mode: "personalized_opener",
    eligibility: input.eligibility.status,
    reason_code: input.result.reason_code,
    personalization_depth: input.result.personalization_depth,
    evidence_count: input.ctx.evidence.length,
    model_attempted: input.result.provider_attempted,
    model_calls: input.result.model_calls,
    validation_ok: input.result.validation ? input.result.validation.ok : null,
    persisted: input.persisted,
    approval_status: "draft",
    sent: false,
    // Role + id only — enough to answer "who did we generate for" in diagnostics
    // without putting a name or contact detail into telemetry.
    selected_contact_id: input.result.recipient?.selected_contact_id ?? null,
    selected_recipient_role_family: input.result.recipient?.selected_recipient_role_family ?? null,
  };
}
