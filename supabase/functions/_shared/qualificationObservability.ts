// Candidate-decision observability for Find Leads.
//
// Why it exists: the v80 controlled Q1 sourced 5 genuine provider people, staged
// all 5 (0 qualified), and persisted 0 — but the no_results payload exposed no
// candidate-level detail, so it was impossible to see WHY each candidate was held
// back (see evals/find-leads/dual-apify/20260715T103441Z-q1-postfix-test-release).
//
// This module builds a SANITIZED, deterministic diagnostic per candidate plus an
// aggregate funnel, so success / partial_results / no_results payloads can honestly
// explain the source→qualification→persistence path. It NEVER changes the
// qualification or persistence policy — it only reports it.
//
// Privacy: exposes public profile identity (name/title/company) and normalized
// public profile URLs only. Never emails, phones, raw provider payloads,
// credentials, tokens, headers, or prompts.
//
// Pure / import-light so it is fully unit-testable with no provider calls.

import type { ArtifactType, TargetEntity } from "./leadEntityIntent.ts";
import { isHardEvidenceBlocker } from "./qualificationPersistence.ts";
import type { NextAction, StageReason } from "./finalCandidateState.ts";

/** Max diagnostics ever emitted, regardless of requested limit (safety cap). */
export const MAX_DIAGNOSTICS = 25;
/** Max characters for any sanitized free-text field. */
export const MAX_FIELD_LEN = 200;
/** Max characters for a sanitized URL. */
export const MAX_URL_LEN = 300;

/** Machine-readable rejection classes (Section 4). */
export type RejectionClass =
  | "hard_source"             // A: unsupported identity / malformed / geo / provenance / artifact mismatch
  | "icp_mismatch"            // B: wrong role / category / size / geography after normalization
  | "missing_timing"          // C: identity proven but no recent funding/hiring/launch/why-now
  | "qualification_threshold" // D: evidence exists but score/tier below persistence policy
  | "missing_qualification"   // E: deterministic qualification produced no decision
  | "accepted";               // not rejected

/**
 * Canonical per-candidate decision. `stage_missing_evidence` is a FIRST-CLASS
 * terminal state, not a flavour of reject: a candidate whose evidence is merely
 * incomplete (no timing signal, company actor timed out, …) is unproven, never
 * contradicted. `missing` means qualification never evaluated the candidate.
 *
 * The historical vocabulary was `accept | reject | missing`, which forced every
 * staged candidate to be reported as a reject — the v84 defect this fixes.
 * `accept` remains an accepted alias for `qualify_now` so existing callers and
 * fixtures keep working.
 */
export type QualificationDecisionKind =
  | "qualify_now"
  | "accept"
  | "stage_missing_evidence"
  | "reject"
  | "missing";

/** True when the decision means "persist-worthy accepted". */
export function isAcceptedDecision(d: QualificationDecisionKind): boolean {
  return d === "accept" || d === "qualify_now";
}

export interface CandidateDecisionDiagnostic {
  candidate_id: string;
  person?: string;
  title?: string;
  company?: string;
  source_url?: string;

  provider_verified: boolean;
  actor_key?: string;
  actor_id?: string;
  artifact_type?: string;

  source_gate_decision: string;      // "accept" | "reject" | "needs_verification" | ...
  source_gate_reason?: string;

  deterministic_score?: number;
  tier?: string;

  qualification_decision: QualificationDecisionKind;
  qualification_reason?: string;     // canonical reason code from qualificationPersistenceDecision
  /** Only set when the decision is a genuine reject; absent for staged candidates. */
  rejection_class?: RejectionClass;
  reason_code: string;               // stable machine-readable code

  evidence_present: string[];
  evidence_missing: string[];
  evidence_violations: string[];

  staged_reason?: string;
  /** Cheapest stage that could close the gap (staged candidates only). */
  next_action?: NextAction;

  persisted: boolean;
  sent_to_downstream_aria: boolean;
}

export interface QualificationFunnel {
  raw_count: number;
  normalized_count: number;
  source_gate_accepted: number;
  source_gate_rejected: number;
  hard_gate_rejected: number;
  qualification_accepted: number;
  /** Unproven candidates held for more evidence. Disjoint from qualification_rejected. */
  qualification_staged: number;
  /** Genuine contradictions only. Never a container for missing evidence. */
  qualification_rejected: number;
  /** Alias of qualification_staged, kept for existing payload readers. */
  staged_count: number;
  persisted_count: number;
  downstream_aria_count: number;
  /** True when ALL invariants hold:
   *  normalized_count == source_gate_accepted + source_gate_rejected,
   *  source_gate_accepted == hard_gate_rejected + accepted + staged + rejected, AND
   *  every final candidate lands in exactly one of accepted / staged / rejected. */
  reconciles: boolean;
}

/** Sanitized diagnostic for a candidate rejected at the SOURCE gate (before
 * qualification) — e.g. wrong geography, malformed profile, missing evidence. */
export interface SourceGateDiagnostic {
  candidate_id: string;
  person?: string;
  title?: string;
  company?: string;
  source_url?: string;
  provider_verified: boolean;
  actor_key?: string;
  actor_id?: string;
  artifact_type?: string;

  requested_geography_value?: string;
  requested_geography_type?: string;   // country | region | city | text
  requested_country_code?: string;

  candidate_location_text?: string;
  candidate_country?: string;
  candidate_country_code?: string;
  candidate_region?: string;
  candidate_city?: string;

  matcher_mode?: string;               // country | region | city | text_fallback

  source_gate_decision: string;        // always "reject" here
  source_gate_reason?: string;
  source_gate_reason_code?: string;

  normalized: boolean;
  reached_qualification: boolean;      // always false
  persisted: boolean;                  // always false
}

export interface QualificationObservability {
  funnel: QualificationFunnel;
  candidates: CandidateDecisionDiagnostic[];
  /** Source-gate rejected candidates (wrong geography / malformed / etc.). */
  source_gate_rejected: SourceGateDiagnostic[];
  /** Number of diagnostics omitted by the cap (qualification + source-gate). */
  truncated: number;
  target_entity?: TargetEntity;
  expected_artifact_type?: ArtifactType;
  /** Candidate ids that resolved to more than one final state. Always empty in a
   * correct run; non-empty makes the v84 staged-AND-rejected defect self-reporting. */
  duplicate_state_candidate_ids: string[];
}

// ------------------------------------------------------------- sanitization --

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:(?:\+?\d[\d\s().-]{7,}\d))/g;
// Defense-in-depth: redact anything token/secret-shaped that could ride along in
// a free-text field (JWTs, provider keys, bearer/authorization values).
const SECRET_RES: RegExp[] = [
  // Phrase patterns first, so the keyword + value are redacted together.
  /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi,                        // bearer tokens
  /\b(?:authorization|api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, // key: value
  /\beyJ[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+){1,2}/g,            // JWT
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{6,}/gi,             // stripe-style keys
  /\b[A-Fa-f0-9]{32,}\b/g,                                      // long hex blobs
];

/** Strip control chars, collapse whitespace, redact emails/phones/secrets, cap. */
export function sanitizeText(v: unknown, maxLen = MAX_FIELD_LEN): string | undefined {
  if (v == null) return undefined;
  let s = String(v).replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  s = s.replace(EMAIL_RE, "[redacted-email]").replace(PHONE_RE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[redacted-phone]" : m));
  for (const re of SECRET_RES) s = s.replace(re, "[redacted-token]");
  if (s.length > maxLen) s = s.slice(0, maxLen - 1).trimEnd() + "…";
  return s || undefined;
}

/** Keep only a normalized PUBLIC http(s) URL with no userinfo/query/fragment. */
export function sanitizePublicUrl(v: unknown): string | undefined {
  if (v == null) return undefined;
  const raw = String(v).trim();
  if (!raw) return undefined;
  let u: URL;
  try { u = new URL(raw); } catch { return undefined; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  if (u.username || u.password) return undefined;          // never expose credentials in URLs
  const normalized = `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "");
  if (normalized.length > MAX_URL_LEN) return undefined;
  return normalized;
}

/** Stable, non-PII candidate id derived from the strongest identifier. */
export function candidateIdFor(input: { normalized_candidate_id?: unknown; source_url?: unknown; name?: unknown; company?: unknown }): string {
  const nc = input.normalized_candidate_id != null ? String(input.normalized_candidate_id).trim() : "";
  if (nc) return nc;
  const url = sanitizePublicUrl(input.source_url);
  if (url) return "nc_" + url.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 48);
  const key = `${sanitizeText(input.name) ?? ""}|${sanitizeText(input.company) ?? ""}`.toLowerCase().replace(/[^a-z0-9|]+/g, "");
  return "nc_" + (key || "unknown");
}

function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => sanitizeText(x, 80)).filter((x): x is string => !!x);
}

// ---------------------------------------------------------- classification --

const HARD_SOURCE_REASONS = new Set(["unverified_provenance", "missing_artifact_type", "artifact_mismatch"]);

/**
 * Classify a rejection using STRUCTURED fields (never by parsing narrative text).
 * `qualification_reason` is the canonical reason code from
 * qualificationPersistenceDecision; the remaining structured fields refine B/C/D.
 */
export function classifyRejection(input: {
  qualification_decision: QualificationDecisionKind;
  qualification_reason?: string | null;
  source_gate_decision?: string | null;
  tier?: string | null;
  deterministic_score?: number | null;
  matched_icp_count?: number;
  evidence_missing?: string[];
  evidence_violations?: string[];
}): { rejection_class: RejectionClass; reason_code: string } {
  const reason = (input.qualification_reason ?? "").toString();
  const violations = input.evidence_violations ?? [];
  const missing = (input.evidence_missing ?? []).map((m) => m.toLowerCase());

  if (isAcceptedDecision(input.qualification_decision)) {
    return { rejection_class: "accepted", reason_code: reason || "aria_accepted" };
  }
  // Hard source-gate rejection (dropped before qualification).
  if ((input.source_gate_decision ?? "").toString().toLowerCase() === "reject") {
    return { rejection_class: "hard_source", reason_code: "source_gate_reject" };
  }
  // Only HARD evidence blockers are hard-source — the same set the persistence
  // decision applies (Phase 0). A non-hard violation such as identity_only_signal
  // is an auditable limitation, NOT a rejection cause, so it must not mask the
  // real reason (tier/aria/ICP/timing) that persistence actually used.
  const hardViolation = violations.find((v) => isHardEvidenceBlocker(v));
  if (hardViolation) {
    return { rejection_class: "hard_source", reason_code: `evidence_violation:${hardViolation}` };
  }
  if (HARD_SOURCE_REASONS.has(reason)) {
    return { rejection_class: "hard_source", reason_code: reason };
  }
  // Missing qualification (never evaluated).
  if (reason === "no_qualification" || input.qualification_decision === "missing") {
    return { rejection_class: "missing_qualification", reason_code: "no_qualification" };
  }
  // ICP mismatch: nothing in the ICP matched.
  if ((input.matched_icp_count ?? 0) === 0) {
    return { rejection_class: "icp_mismatch", reason_code: reason || "icp_mismatch" };
  }
  // Missing timing/buying-signal evidence: identity proven, ICP partially matched,
  // but the missing evidence is a timing/buying signal.
  const timingMissing = missing.some((m) => /(funding|hiring|expansion|product[- ]?launch|buying signal|why[- ]?now|timing)/.test(m));
  if (timingMissing) {
    return { rejection_class: "missing_timing", reason_code: reason || "missing_timing_evidence" };
  }
  // Otherwise a threshold rejection: evidence exists but tier/score below policy.
  return { rejection_class: "qualification_threshold", reason_code: reason || "below_threshold" };
}

// --------------------------------------------------------------- builders --

/** Raw (pre-sanitization) inputs for one candidate diagnostic. */
export interface CandidateDiagnosticInput {
  normalized_candidate_id?: unknown;
  name?: unknown;
  title?: unknown;
  company?: unknown;
  source_url?: unknown;

  provider_verified: boolean;
  actor_key?: string | null;
  actor_id?: string | null;
  artifact_type?: string | null;

  source_gate_decision?: string | null;
  source_gate_reason?: string | null;

  deterministic_score?: number | null;
  tier?: string | null;

  qualification_decision: QualificationDecisionKind;
  qualification_reason?: string | null;

  matched_icp?: string[] | null;
  evidence_present?: unknown;
  evidence_missing?: unknown;
  evidence_violations?: unknown;

  /** Stage reason resolved by the canonical reducer (staged candidates only). */
  stage_reason?: StageReason | null;
  /** Cheapest stage that could close the gap (staged candidates only). */
  next_action?: NextAction;

  persisted: boolean;
  sent_to_downstream_aria: boolean;
}

export function buildCandidateDiagnostic(input: CandidateDiagnosticInput): CandidateDecisionDiagnostic {
  const evidence_missing = arr(input.evidence_missing);
  const evidence_violations = arr(input.evidence_violations);
  const isStaged = input.qualification_decision === "stage_missing_evidence";
  // A staged candidate is unproven, not contradicted: it carries a stage_reason +
  // next_action and NO rejection class. Only genuine rejects are classified.
  const { rejection_class, reason_code } = isStaged
    ? { rejection_class: undefined, reason_code: input.stage_reason ?? input.qualification_reason ?? "stage_missing_evidence" }
    : classifyRejection({
      qualification_decision: input.qualification_decision,
      qualification_reason: input.qualification_reason,
      source_gate_decision: input.source_gate_decision,
      tier: input.tier,
      deterministic_score: input.deterministic_score,
      matched_icp_count: Array.isArray(input.matched_icp) ? input.matched_icp.length : 0,
      evidence_missing,
      evidence_violations,
    });
  const staged = isStaged || (!input.persisted && !isAcceptedDecision(input.qualification_decision));
  return {
    candidate_id: candidateIdFor(input),
    person: sanitizeText(input.name),
    title: sanitizeText(input.title),
    company: sanitizeText(input.company),
    source_url: sanitizePublicUrl(input.source_url),
    provider_verified: input.provider_verified === true,
    actor_key: input.actor_key ? sanitizeText(input.actor_key, 80) : undefined,
    actor_id: input.actor_id ? sanitizeText(input.actor_id, 120) : undefined,
    artifact_type: input.artifact_type ? sanitizeText(input.artifact_type, 40) : undefined,
    source_gate_decision: sanitizeText(input.source_gate_decision, 40) ?? "unknown",
    source_gate_reason: sanitizeText(input.source_gate_reason, 120),
    deterministic_score: typeof input.deterministic_score === "number" && isFinite(input.deterministic_score) ? Math.round(input.deterministic_score) : undefined,
    tier: sanitizeText(input.tier, 40),
    qualification_decision: input.qualification_decision,
    qualification_reason: input.qualification_reason ? sanitizeText(input.qualification_reason, 80) : undefined,
    rejection_class,
    reason_code,
    evidence_present: arr(input.evidence_present),
    evidence_missing,
    evidence_violations,
    staged_reason: staged ? (reason_code || "staged") : undefined,
    next_action: isStaged ? (input.next_action ?? null) : undefined,
    persisted: input.persisted === true,
    sent_to_downstream_aria: input.sent_to_downstream_aria === true,
  };
}

export interface FunnelInput {
  raw_count: number;
  normalized_count: number;
  source_gate_accepted: number;
  source_gate_rejected: number;
  hard_gate_rejected: number;
  qualification_accepted: number;
  /** Unproven candidates held for more evidence (disjoint from rejected). */
  qualification_staged: number;
  qualification_rejected: number;
  persisted_count: number;
  downstream_aria_count: number;
}

export function buildQualificationFunnel(input: FunnelInput): QualificationFunnel {
  const n = (x: number) => (Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
  const normalized_count = n(input.normalized_count);
  const source_gate_accepted = n(input.source_gate_accepted);
  const source_gate_rejected = n(input.source_gate_rejected);
  const hard_gate_rejected = n(input.hard_gate_rejected);
  const qualification_accepted = n(input.qualification_accepted);
  const qualification_staged = n(input.qualification_staged);
  const qualification_rejected = n(input.qualification_rejected);
  // Staged and rejected are now DISJOINT terminal buckets, so the source-gate
  // identity must account for all three final states (the v84 funnel reported the
  // same five candidates as both staged and rejected).
  const reconciles =
    normalized_count === source_gate_accepted + source_gate_rejected &&
    source_gate_accepted === hard_gate_rejected + qualification_accepted + qualification_staged + qualification_rejected;
  return {
    raw_count: n(input.raw_count),
    normalized_count,
    source_gate_accepted,
    source_gate_rejected,
    hard_gate_rejected,
    qualification_accepted,
    qualification_staged,
    qualification_rejected,
    staged_count: qualification_staged,
    persisted_count: n(input.persisted_count),
    downstream_aria_count: n(input.downstream_aria_count),
    reconciles,
  };
}

export interface SourceGateDiagnosticInput {
  normalized_candidate_id?: unknown;
  name?: unknown;
  title?: unknown;
  company?: unknown;
  source_url?: unknown;
  provider_verified?: boolean;
  actor_key?: string | null;
  actor_id?: string | null;
  artifact_type?: string | null;

  requested_geography_value?: string | null;
  requested_geography_type?: string | null;
  requested_country_code?: string | null;

  candidate_location_text?: unknown;
  candidate_country?: unknown;
  candidate_country_code?: unknown;
  candidate_region?: unknown;
  candidate_city?: unknown;
  matcher_mode?: string | null;

  source_gate_reason?: string | null;
  source_gate_reason_code?: string | null;
}

export function buildSourceGateDiagnostic(input: SourceGateDiagnosticInput): SourceGateDiagnostic {
  return {
    candidate_id: candidateIdFor(input),
    person: sanitizeText(input.name),
    title: sanitizeText(input.title),
    company: sanitizeText(input.company),
    source_url: sanitizePublicUrl(input.source_url),
    provider_verified: input.provider_verified === true,
    actor_key: input.actor_key ? sanitizeText(input.actor_key, 80) : undefined,
    actor_id: input.actor_id ? sanitizeText(input.actor_id, 120) : undefined,
    artifact_type: input.artifact_type ? sanitizeText(input.artifact_type, 40) : undefined,
    requested_geography_value: sanitizeText(input.requested_geography_value, 120),
    requested_geography_type: sanitizeText(input.requested_geography_type, 20),
    requested_country_code: sanitizeText(input.requested_country_code, 8),
    candidate_location_text: sanitizeText(input.candidate_location_text, 120),
    candidate_country: sanitizeText(input.candidate_country, 80),
    candidate_country_code: sanitizeText(input.candidate_country_code, 8),
    candidate_region: sanitizeText(input.candidate_region, 80),
    candidate_city: sanitizeText(input.candidate_city, 80),
    matcher_mode: sanitizeText(input.matcher_mode, 20),
    source_gate_decision: "reject",
    source_gate_reason: sanitizeText(input.source_gate_reason, 120),
    source_gate_reason_code: sanitizeText(input.source_gate_reason_code, 60),
    normalized: true,
    reached_qualification: false,
    persisted: false,
  };
}

export function buildQualificationObservability(input: {
  funnel: FunnelInput;
  candidates: CandidateDiagnosticInput[];
  source_gate_rejected?: SourceGateDiagnosticInput[];
  requested_limit?: number | null;
  target_entity?: TargetEntity;
  expected_artifact_type?: ArtifactType;
}): QualificationObservability {
  const cap = Math.max(1, Math.min(MAX_DIAGNOSTICS, input.requested_limit && input.requested_limit > 0 ? input.requested_limit : MAX_DIAGNOSTICS));
  const all = input.candidates.map(buildCandidateDiagnostic);
  const kept = all.slice(0, cap);
  const allSg = (input.source_gate_rejected ?? []).map(buildSourceGateDiagnostic);
  const keptSg = allSg.slice(0, cap);
  // One candidate id must resolve to exactly one final state. Any id appearing with
  // two different states is the double-count defect and is surfaced, not hidden.
  const stateById = new Map<string, Set<string>>();
  for (const d of all) {
    const state = isAcceptedDecision(d.qualification_decision) ? "qualify_now"
      : d.qualification_decision === "stage_missing_evidence" ? "stage_missing_evidence"
      : d.qualification_decision === "missing" ? "stage_missing_evidence"
      : "reject";
    (stateById.get(d.candidate_id) ?? stateById.set(d.candidate_id, new Set()).get(d.candidate_id)!).add(state);
  }
  const duplicate_state_candidate_ids = [...stateById.entries()].filter(([, s]) => s.size > 1).map(([id]) => id);
  return {
    funnel: buildQualificationFunnel(input.funnel),
    candidates: kept,
    source_gate_rejected: keptSg,
    truncated: Math.max(0, all.length - kept.length) + Math.max(0, allSg.length - keptSg.length),
    target_entity: input.target_entity,
    expected_artifact_type: input.expected_artifact_type,
    duplicate_state_candidate_ids,
  };
}
