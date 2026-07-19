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
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : [];
}

/**
 * Read the workspace's saved Company Brain. Workspace isolation is the caller's
 * responsibility (the row must already be scoped); this only shapes it.
 */
export function brainContextFromProfile(profile: unknown): BrainContext {
  const p = (profile ?? {}) as Record<string, unknown>;
  const positioning = str(p.positioning) ?? str(p.value_proposition);
  const product_summary = str(p.product_summary) ?? str(p.product);
  const outcomes = strArray(p.target_outcomes ?? p.outcomes);
  const available = !!(positioning || product_summary || outcomes.length > 0);

  return {
    positioning,
    product_summary,
    outcomes,
    differentiators: strArray(p.differentiators),
    proof: strArray(p.proof),
    prohibited_claims: strArray(p.prohibited_claims),
    tone: str(p.voice) ?? str(p.tone),
    approved_ctas: strArray(p.approved_ctas ?? p.ctas),
    available,
  };
}

export interface BuildContextInput {
  lead_candidate_id: string;
  company_name: string | null;
  industry: string | null;
  /** Persisted Workbench stage state — the source of research + person truth. */
  account: WorkbenchAccountState;
  brain_profile: unknown;
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
  const dm = input.account.decision_makers.last_success;

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

  const decision_maker: OpenerDecisionMaker | null = dm && dm.primary_full_name
    ? {
      first_name: dm.primary_full_name.split(/\s+/)[0] ?? null,
      full_name: dm.primary_full_name,
      current_title: dm.primary_role_family ? dm.primary_role_family : null,
      current_company_name: dm.primary_company_name,
      role_family: dm.primary_role_family,
      verification_status: dm.verified_count > 0 && dm.primary_verification_methods.length > 0
        ? "verified"
        : "unverified",
      verification_methods: dm.primary_verification_methods,
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
  };
}

// -------------------------------------------------------------- eligibility ----

export type OpenerReasonCode =
  | "ready"
  | "downgraded_company_level"
  | "blocked_missing_verified_person"
  | "blocked_missing_company_brain"
  | "blocked_missing_company_research"
  | "blocked_icp_disqualified";

export interface OpenerEligibility {
  status: "ready" | "downgraded" | "blocked";
  reason_code: OpenerReasonCode;
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

export const DEFAULT_OPENER_CONSTRAINTS: OpenerConstraints = {
  preferred_min_words: 18,
  preferred_max_words: 35,
  hard_max_chars: 240,
  max_sentences: 2,
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

  if (char_count > constraints.hard_max_chars) violations.push("too_long_chars");
  if (sentence_count > constraints.max_sentences) violations.push("too_many_sentences");
  if (question_count > constraints.max_questions) violations.push("too_many_questions");
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
    ok: violations.length === 0,
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

  const validation = validateOpener(opener, ctx, eligibility, constraints);
  if (!validation.ok) {
    return {
      ...base,
      status: "failed_validation",
      reason_code: "failed_validation",
      validation,
      omitted_claims: validation.unsupported_claims,
      provider_attempted: true,
      model_calls: 1,
    };
  }

  // Only evidence that actually exists AND is allowed may be credited.
  const allowed = new Set(eligibility.allowed_evidence_ids);
  const used = (resp.used_evidence_ids ?? []).filter((id) => allowed.has(id));

  const alt = str(resp.alternative_opener);
  const altValid = alt ? validateOpener(alt, ctx, eligibility, constraints).ok : false;

  return {
    ...base,
    status: "succeeded",
    reason_code: eligibility.reason_code,
    opener,
    ...(altValid && alt ? { alternative_opener: alt } : {}),
    used_evidence_ids: used,
    validation,
    provider_attempted: true,
    model_calls: 1,
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
  };
}
