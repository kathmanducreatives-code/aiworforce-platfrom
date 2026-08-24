// Signals Storage V2 — Phase 2 shared writer boundary (flagged dual-write).
//
// Every write into the four V2 tables (lead_evidence / signal_events /
// signal_event_evidence / engagement_events) goes through this module. Nothing
// else in the codebase may write them.
//
// INVARIANTS (mirrors the Phase-1 migration guarantees):
//   * LEGACY IS AUTHORITATIVE. These writers run only AFTER a confirmed legacy
//     write and are strictly best-effort: they classify failures into sanitized
//     error classes and NEVER throw into the legacy persistence path.
//   * Flag-gated: when SIGNALS_V2 is off a writer returns immediately with
//     `flag_disabled` and performs ZERO database calls.
//   * Sanitized only: normalized_value is validated against the same forbidden-key
//     and PII patterns as signalEvent.ts. A violation rejects the row
//     (`sanitized_policy_rejected`) — it is never stored partially.
//   * Idempotent: inserts are conflict-safe on the table's dedupe identity
//     (`workspace_id, dedupe_key` / the evidence fingerprint triple). A repeat
//     write classifies as `deduplicated` and leaves the original row untouched.
//   * No raw provider payload, no email/phone, no credentials — ever.

import { isSignalsV2Enabled } from "./signalsV2Flag.ts";
import { isSignalOrigin, type SignalOrigin } from "./signalOrigin.ts";

// ------------------------------------------------------------------ types -----

/** Sanitized, closed vocabulary of best-effort failure classes. */
export type SignalsV2ErrorClass =
  | "flag_disabled"
  | "validation_failed"
  | "missing_entity"
  | "unsupported_event"
  | "conflict_deduplicated"
  | "database_rejected"
  | "workspace_mismatch"
  | "sanitized_policy_rejected"
  | "unexpected_error";

export interface SignalsV2WriteResult {
  /** True when a database write was actually attempted. */
  attempted: boolean;
  /** Flag state at write time. */
  enabled: boolean;
  /** A new row was written. */
  written: boolean;
  /** The row already existed (conflict on the dedupe identity); original untouched. */
  deduplicated: boolean;
  /** Id of the written (or, when cheaply known, pre-existing) row. */
  record_id: string | null;
  /** Sanitized human-readable reason (never a raw DB error payload). */
  reason: string | null;
  error_class: SignalsV2ErrorClass | null;
}

export type SignalsV2Family =
  | "lead_evidence"
  | "signal_events"
  | "signal_event_evidence"
  | "engagement_events";

export interface SignalsV2FamilyCounters {
  considered: number;
  attempted: number;
  written: number;
  deduplicated: number;
  skipped: number;
  failed: number;
}

/** Sanitized run-level dual-write observability (counters only — no payloads,
 * no PII; record ids are never required here). */
export interface SignalsV2Observability {
  enabled: boolean;
  lead_evidence: SignalsV2FamilyCounters;
  signal_events: SignalsV2FamilyCounters;
  signal_event_evidence: SignalsV2FamilyCounters;
  engagement_events: SignalsV2FamilyCounters;
  /** Count of confirmed legacy writes observed alongside the dual-write. */
  legacy_writes_succeeded: number;
  /** Sanitized failure-class histogram across all families. */
  failure_classes: Record<string, number>;
}

const newCounters = (): SignalsV2FamilyCounters =>
  ({ considered: 0, attempted: 0, written: 0, deduplicated: 0, skipped: 0, failed: 0 });

export function newSignalsV2Observability(enabled: boolean): SignalsV2Observability {
  return {
    enabled,
    lead_evidence: newCounters(),
    signal_events: newCounters(),
    signal_event_evidence: newCounters(),
    engagement_events: newCounters(),
    legacy_writes_succeeded: 0,
    failure_classes: {},
  };
}

/** considered = attempted + skipped; attempted = written + deduplicated + failed. */
export function signalsV2CountersReconcile(c: SignalsV2FamilyCounters): boolean {
  return c.considered === c.attempted + c.skipped
    && c.attempted === c.written + c.deduplicated + c.failed;
}

export function signalsV2ObservabilityReconciles(obs: SignalsV2Observability): boolean {
  return (["lead_evidence", "signal_events", "signal_event_evidence", "engagement_events"] as const)
    .every((f) => signalsV2CountersReconcile(obs[f]));
}

// -------------------------------------------------------------- admin type ----

/** Minimal supabase-js surface the writers use (test-fakeable). */
// deno-lint-ignore no-explicit-any
export type SignalsV2AdminClient = { from(table: string): any };

// ----------------------------------------------------------- sanitization -----

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/;
/** Keys that would smuggle a raw provider payload, PII or credentials. */
const FORBIDDEN_VALUE_KEYS = new Set([
  "raw", "raw_payload", "provider_payload", "payload", "items", "response",
  "email", "phone", "phone_number", "authorization", "token", "access_token",
  "api_key", "password", "secret", "credential",
]);

/** True when the object is safe to persist as normalized_value. */
export function isSanitizedNormalizedValue(v: Record<string, unknown> | null | undefined): boolean {
  if (v == null) return true;
  for (const k of Object.keys(v)) {
    if (FORBIDDEN_VALUE_KEYS.has(k.toLowerCase())) return false;
  }
  try {
    const flat = JSON.stringify(v);
    if (EMAIL_RE.test(flat) || PHONE_RE.test(flat)) return false;
  } catch {
    return false;
  }
  return true;
}

/** Public http(s) URL without credentials, or null. Never throws. */
export function sanitizePublicUrl(u: string | null | undefined): string | null {
  const s = typeof u === "string" ? u.trim() : "";
  if (!s) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

// ------------------------------------------------------- canonical vocab ------

const EVIDENCE_KINDS = new Set([
  "person_identity", "company_identity", "person_role", "person_geography",
  "company_geography", "company_fit", "provider_provenance",
]);
const VERIFICATIONS = new Set(["provider_verified", "self_reported", "unverified"]);
const CONFIDENCES = new Set(["low", "medium", "high"]);
const LIFECYCLES = new Set([
  "active", "stale", "expired", "contradicted", "superseded", "dismissed", "archived", "retracted",
]);
const SIGNAL_EVENT_TYPES = new Set([
  "recent_funding", "employee_growth", "market_expansion", "geographic_expansion",
  "sales_hiring", "revops_hiring", "growth_hiring", "new_revenue_leader",
  "outbound_initiative", "positioning_change",
  "product_launch", "major_release", "new_integration", "category_expansion",
  "founder_pipeline_post", "founder_outbound_post", "founder_customer_acquisition_post",
  "founder_hiring_post", "founder_problem_statement",
  "person_left_company", "company_outside_icp", "role_changed", "company_inactive",
  "signal_became_stale",
]);
const SIGNAL_CATEGORIES = new Set(["growth", "gtm", "product", "founder_intent", "risk"]);
const EVIDENCE_CATEGORIES = new Set([
  "job_signal", "funding_signal", "launch_signal", "expansion_signal",
  "founder_activity_signal", "gtm_signal",
]);
const FRESHNESS_BANDS = new Set(["strong", "medium", "weak_supporting", "stale"]);
const LISTING_STATUSES = new Set(["active", "closed", "expired", "unknown"]);
const ENGAGEMENT_CHANNELS = new Set(["linkedin", "email", "website", "other"]);
const ENGAGEMENT_TYPES = new Set([
  "linkedin_connection_accepted", "linkedin_post_like", "linkedin_post_comment",
  "linkedin_post_reply", "direct_reply", "content_engagement",
]);

// --------------------------------------------------------------- inputs -------

interface CommonV2Input {
  workspace_id: string;
  provider?: string | null;
  actor_key?: string | null;
  actor_id?: string | null;
  source_url?: string | null;
  observed_at?: string | null;
  verification_status?: string | null;
  confidence?: string | null;
  normalized_value?: Record<string, unknown> | null;
  legacy_signal_id?: string | null;
}

export interface LeadEvidenceV2Input extends CommonV2Input {
  evidence_kind: string;
  contact_id?: string | null;
  account_id?: string | null;
  lead_candidate_id?: string | null;
  source_record_id?: string | null;
  verified_at?: string | null;
  dedupe_key: string;
  lifecycle_status?: string | null;
}

export interface SignalEventV2Input extends CommonV2Input {
  /**
   * WHICH WORKFLOW PRODUCED THIS. Required, and deliberately not defaulted.
   *
   * A default would be a guess about provenance, and the guess would always be
   * `lead_mission` because that is the only writer today — which is exactly the
   * claim a monitoring row must not silently make. See `signalOrigin.ts`.
   */
  origin: SignalOrigin;
  contact_id?: string | null;
  account_id?: string | null;
  lead_candidate_id?: string | null;
  signal_type: string;
  signal_category: string;
  evidence_category?: string | null;
  occurred_at: string;
  expires_at?: string | null;
  freshness?: string | null;
  listing_status?: string | null;
  dedupe_key: string;
  lifecycle_status?: string | null;
}

export interface SignalEventEvidenceV2Input extends CommonV2Input {
  signal_event_id: string;
  /** Workspace of the PARENT event — must equal workspace_id (checked here AND by
   * the composite FK at the database boundary). */
  parent_workspace_id: string;
  source_record_id?: string | null;
  evidence_fingerprint: string;
}

export interface EngagementEventV2Input extends CommonV2Input {
  contact_id?: string | null;
  account_id?: string | null;
  lead_candidate_id?: string | null;
  channel: string;
  event_type: string;
  occurred_at: string;
  source_record_id?: string | null;
  dedupe_key: string;
  lifecycle_status?: string | null;
}

// --------------------------------------------------------------- results ------

export interface WriterCtx {
  admin: SignalsV2AdminClient;
  /** Explicit flag state (callers resolve once per run; tests inject). Defaults
   * to reading the environment. */
  enabled?: boolean;
  obs?: SignalsV2Observability | null;
}

function resolveEnabled(ctx: WriterCtx): boolean {
  return typeof ctx.enabled === "boolean" ? ctx.enabled : isSignalsV2Enabled();
}

/**
 * Fold one write result into the sanitized run-level observability. Exported so the
 * dual-write orchestration can record orchestration-level skips (e.g. an event type
 * that is not in scope for a given caller) against the same reconciling counters the
 * writers use — one accounting path, never two. A null obs is a no-op.
 */
export function applyResultToObservability(
  obs: SignalsV2Observability | null | undefined,
  family: SignalsV2Family,
  r: SignalsV2WriteResult,
): SignalsV2WriteResult {
  if (obs) {
    const c = obs[family];
    c.considered++;
    if (r.attempted) {
      c.attempted++;
      if (r.written) c.written++;
      else if (r.deduplicated) c.deduplicated++;
      else c.failed++;
    } else {
      c.skipped++;
    }
    if (r.error_class) obs.failure_classes[r.error_class] = (obs.failure_classes[r.error_class] ?? 0) + 1;
  }
  return r;
}

function recordResult(
  ctx: WriterCtx, family: SignalsV2Family, r: SignalsV2WriteResult,
): SignalsV2WriteResult {
  return applyResultToObservability(ctx.obs, family, r);
}

const skip = (enabled: boolean, error_class: SignalsV2ErrorClass, reason: string): SignalsV2WriteResult =>
  ({ attempted: false, enabled, written: false, deduplicated: false, record_id: null, reason, error_class });

// ---------------------------------------------------------- upsert helper -----

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const validTimestamp = (v: unknown): boolean => typeof v === "string" && isFinite(Date.parse(v));

/**
 * Conflict-safe insert on the table's dedupe identity. `ignoreDuplicates` keeps a
 * repeat write from touching the original row; an empty result set means the row
 * already existed → `deduplicated`.
 */
async function insertConflictSafe(
  ctx: WriterCtx, family: SignalsV2Family, row: Record<string, unknown>, conflictCols: string,
  dedupeLookup: Record<string, unknown>,
): Promise<SignalsV2WriteResult> {
  const enabled = true; // callers gate before reaching here
  try {
    const { data, error } = await ctx.admin
      .from(family)
      .upsert(row, { onConflict: conflictCols, ignoreDuplicates: true })
      .select("id");
    if (error) {
      return {
        attempted: true, enabled, written: false, deduplicated: false, record_id: null,
        reason: "database rejected the write", error_class: "database_rejected",
      };
    }
    const inserted = Array.isArray(data) ? data : (data ? [data] : []);
    if (inserted.length > 0) {
      return {
        attempted: true, enabled, written: true, deduplicated: false,
        record_id: (inserted[0] as { id?: string })?.id ?? null, reason: null, error_class: null,
      };
    }
    // Conflict — resolve the surviving row's id (best-effort; null is acceptable).
    let existingId: string | null = null;
    try {
      let q = ctx.admin.from(family).select("id");
      for (const [k, v] of Object.entries(dedupeLookup)) q = q.eq(k, v);
      const { data: existing } = await q.maybeSingle();
      existingId = (existing as { id?: string } | null)?.id ?? null;
    } catch { /* id lookup is optional */ }
    return {
      attempted: true, enabled, written: false, deduplicated: true, record_id: existingId,
      reason: "row already exists for this dedupe identity", error_class: "conflict_deduplicated",
    };
  } catch {
    return {
      attempted: true, enabled, written: false, deduplicated: false, record_id: null,
      reason: "unexpected writer error", error_class: "unexpected_error",
    };
  }
}

// ------------------------------------------------------------- writers --------

/** Shared pre-write validation for every family. Returns a skip result or null. */
function commonRejection(enabled: boolean, input: CommonV2Input): SignalsV2WriteResult | null {
  if (!enabled) return skip(false, "flag_disabled", "SIGNALS_V2 is disabled");
  if (!isUuid(input.workspace_id)) return skip(enabled, "validation_failed", "workspace_id must be a uuid");
  if (input.verification_status != null && !VERIFICATIONS.has(input.verification_status)) {
    return skip(enabled, "validation_failed", "verification_status outside canonical vocabulary");
  }
  if (input.confidence != null && !CONFIDENCES.has(input.confidence)) {
    return skip(enabled, "validation_failed", "confidence outside canonical vocabulary");
  }
  if (!isSanitizedNormalizedValue(input.normalized_value)) {
    return skip(enabled, "sanitized_policy_rejected", "normalized_value failed sanitization policy");
  }
  return null;
}

export async function writeLeadEvidenceV2(
  ctx: WriterCtx, input: LeadEvidenceV2Input,
): Promise<SignalsV2WriteResult> {
  const enabled = resolveEnabled(ctx);
  const done = (r: SignalsV2WriteResult) => recordResult(ctx, "lead_evidence", r);

  const common = commonRejection(enabled, input);
  if (common) return done(common);
  if (!EVIDENCE_KINDS.has(input.evidence_kind)) {
    return done(skip(enabled, "validation_failed", "evidence_kind outside canonical vocabulary"));
  }
  if (!input.dedupe_key?.trim()) return done(skip(enabled, "validation_failed", "dedupe_key required"));
  if (input.lifecycle_status != null && !LIFECYCLES.has(input.lifecycle_status)) {
    return done(skip(enabled, "validation_failed", "lifecycle_status outside canonical vocabulary"));
  }
  if (!isUuid(input.contact_id) && !isUuid(input.account_id) && !isUuid(input.lead_candidate_id)) {
    return done(skip(enabled, "missing_entity", "evidence must reference at least one entity"));
  }

  const row: Record<string, unknown> = {
    workspace_id: input.workspace_id,
    evidence_kind: input.evidence_kind,
    contact_id: isUuid(input.contact_id) ? input.contact_id : null,
    account_id: isUuid(input.account_id) ? input.account_id : null,
    lead_candidate_id: isUuid(input.lead_candidate_id) ? input.lead_candidate_id : null,
    provider: input.provider ?? null,
    actor_key: input.actor_key ?? null,
    actor_id: input.actor_id ?? null,
    source_url: sanitizePublicUrl(input.source_url),
    source_record_id: input.source_record_id ?? null,
    ...(validTimestamp(input.observed_at) ? { observed_at: input.observed_at } : {}),
    verified_at: validTimestamp(input.verified_at) ? input.verified_at : null,
    verification_status: input.verification_status ?? "unverified",
    confidence: input.confidence ?? null,
    normalized_value: input.normalized_value ?? {},
    dedupe_key: input.dedupe_key.trim(),
    lifecycle_status: input.lifecycle_status ?? "active",
    sanitized: true,
    legacy_signal_id: isUuid(input.legacy_signal_id) ? input.legacy_signal_id : null,
  };
  return done(await insertConflictSafe(ctx, "lead_evidence", row, "workspace_id,dedupe_key",
    { workspace_id: input.workspace_id, dedupe_key: row.dedupe_key }));
}

export async function writeSignalEventV2(
  ctx: WriterCtx, input: SignalEventV2Input,
): Promise<SignalsV2WriteResult> {
  const enabled = resolveEnabled(ctx);
  const done = (r: SignalsV2WriteResult) => recordResult(ctx, "signal_events", r);

  const common = commonRejection(enabled, input);
  if (common) return done(common);
  if (!SIGNAL_EVENT_TYPES.has(input.signal_type)) {
    return done(skip(enabled, "validation_failed", "signal_type outside canonical vocabulary"));
  }
  if (!SIGNAL_CATEGORIES.has(input.signal_category)) {
    return done(skip(enabled, "validation_failed", "signal_category outside canonical vocabulary"));
  }
  if (input.evidence_category != null && !EVIDENCE_CATEGORIES.has(input.evidence_category)) {
    return done(skip(enabled, "validation_failed", "evidence_category outside canonical vocabulary"));
  }
  // occurred_at is the SOURCE event time. It must be supplied and parseable —
  // observed_at can never stand in for it (freshness truthfulness).
  if (!validTimestamp(input.occurred_at)) {
    return done(skip(enabled, "validation_failed", "occurred_at missing or unparseable"));
  }
  if (input.freshness != null && !FRESHNESS_BANDS.has(input.freshness)) {
    return done(skip(enabled, "validation_failed", "freshness outside canonical vocabulary"));
  }
  if (input.listing_status != null && !LISTING_STATUSES.has(input.listing_status)) {
    return done(skip(enabled, "validation_failed", "listing_status outside canonical vocabulary"));
  }
  if (input.lifecycle_status != null && !LIFECYCLES.has(input.lifecycle_status)) {
    return done(skip(enabled, "validation_failed", "lifecycle_status outside canonical vocabulary"));
  }
  if (!isSignalOrigin(input.origin)) {
    return done(skip(enabled, "validation_failed", "origin outside canonical vocabulary"));
  }
  if (!input.dedupe_key?.trim()) return done(skip(enabled, "validation_failed", "dedupe_key required"));
  if (!isUuid(input.contact_id) && !isUuid(input.account_id) && !isUuid(input.lead_candidate_id)) {
    return done(skip(enabled, "missing_entity", "signal event must reference at least one entity"));
  }

  const row: Record<string, unknown> = {
    workspace_id: input.workspace_id,
    origin: input.origin,
    contact_id: isUuid(input.contact_id) ? input.contact_id : null,
    account_id: isUuid(input.account_id) ? input.account_id : null,
    lead_candidate_id: isUuid(input.lead_candidate_id) ? input.lead_candidate_id : null,
    signal_type: input.signal_type,
    signal_category: input.signal_category,
    evidence_category: input.evidence_category ?? null,
    occurred_at: input.occurred_at,
    ...(validTimestamp(input.observed_at) ? { observed_at: input.observed_at } : {}),
    expires_at: validTimestamp(input.expires_at) ? input.expires_at : null,
    freshness: input.freshness ?? null,
    confidence: input.confidence ?? null,
    verification_status: input.verification_status ?? "unverified",
    listing_status: input.listing_status ?? null,
    normalized_value: input.normalized_value ?? {},
    dedupe_key: input.dedupe_key.trim(),
    lifecycle_status: input.lifecycle_status ?? "active",
    sanitized: true,
    provider: input.provider ?? null,
    actor_key: input.actor_key ?? null,
    actor_id: input.actor_id ?? null,
    source_url: sanitizePublicUrl(input.source_url),
    legacy_signal_id: isUuid(input.legacy_signal_id) ? input.legacy_signal_id : null,
  };
  return done(await insertConflictSafe(ctx, "signal_events", row, "workspace_id,dedupe_key",
    { workspace_id: input.workspace_id, dedupe_key: row.dedupe_key }));
}

export async function writeSignalEventEvidenceV2(
  ctx: WriterCtx, input: SignalEventEvidenceV2Input,
): Promise<SignalsV2WriteResult> {
  const enabled = resolveEnabled(ctx);
  const done = (r: SignalsV2WriteResult) => recordResult(ctx, "signal_event_evidence", r);

  const common = commonRejection(enabled, input);
  if (common) return done(common);
  if (!isUuid(input.signal_event_id)) {
    return done(skip(enabled, "missing_entity", "signal_event_id required"));
  }
  // Workspace pinning: the composite FK enforces this at the database boundary;
  // rejecting here as well keeps the failure sanitized and classified.
  if (input.parent_workspace_id !== input.workspace_id) {
    return done(skip(enabled, "workspace_mismatch", "evidence workspace must match parent event workspace"));
  }
  if (!input.evidence_fingerprint?.trim()) {
    return done(skip(enabled, "validation_failed", "evidence_fingerprint required"));
  }
  const sourceUrl = sanitizePublicUrl(input.source_url);
  if (!sourceUrl && !input.source_record_id) {
    return done(skip(enabled, "validation_failed", "an observation needs source_url or source_record_id"));
  }

  const row: Record<string, unknown> = {
    workspace_id: input.workspace_id,
    signal_event_id: input.signal_event_id,
    provider: input.provider ?? null,
    actor_key: input.actor_key ?? null,
    actor_id: input.actor_id ?? null,
    source_url: sourceUrl,
    source_record_id: input.source_record_id ?? null,
    evidence_fingerprint: input.evidence_fingerprint.trim(),
    ...(validTimestamp(input.observed_at) ? { observed_at: input.observed_at } : {}),
    verification_status: input.verification_status ?? "unverified",
    confidence: input.confidence ?? null,
    normalized_value: input.normalized_value ?? {},
    sanitized: true,
    legacy_signal_id: isUuid(input.legacy_signal_id) ? input.legacy_signal_id : null,
  };
  return done(await insertConflictSafe(
    ctx, "signal_event_evidence", row, "workspace_id,signal_event_id,evidence_fingerprint",
    { workspace_id: input.workspace_id, signal_event_id: input.signal_event_id, evidence_fingerprint: row.evidence_fingerprint },
  ));
}

export async function writeEngagementEventV2(
  ctx: WriterCtx, input: EngagementEventV2Input,
): Promise<SignalsV2WriteResult> {
  const enabled = resolveEnabled(ctx);
  const done = (r: SignalsV2WriteResult) => recordResult(ctx, "engagement_events", r);

  const common = commonRejection(enabled, input);
  if (common) return done(common);
  if (!ENGAGEMENT_CHANNELS.has(input.channel)) {
    return done(skip(enabled, "validation_failed", "channel outside canonical vocabulary"));
  }
  if (!ENGAGEMENT_TYPES.has(input.event_type)) {
    return done(skip(enabled, "validation_failed", "event_type outside canonical vocabulary"));
  }
  if (!validTimestamp(input.occurred_at)) {
    return done(skip(enabled, "validation_failed", "occurred_at missing or unparseable"));
  }
  if (input.lifecycle_status != null && !LIFECYCLES.has(input.lifecycle_status)) {
    return done(skip(enabled, "validation_failed", "lifecycle_status outside canonical vocabulary"));
  }
  if (!input.dedupe_key?.trim()) return done(skip(enabled, "validation_failed", "dedupe_key required"));
  if (!isUuid(input.contact_id) && !isUuid(input.account_id) && !isUuid(input.lead_candidate_id)) {
    return done(skip(enabled, "missing_entity", "engagement event must reference at least one entity"));
  }

  const row: Record<string, unknown> = {
    workspace_id: input.workspace_id,
    contact_id: isUuid(input.contact_id) ? input.contact_id : null,
    account_id: isUuid(input.account_id) ? input.account_id : null,
    lead_candidate_id: isUuid(input.lead_candidate_id) ? input.lead_candidate_id : null,
    channel: input.channel,
    event_type: input.event_type,
    occurred_at: input.occurred_at,
    ...(validTimestamp(input.observed_at) ? { observed_at: input.observed_at } : {}),
    provider: input.provider ?? null,
    actor_key: input.actor_key ?? null,
    actor_id: input.actor_id ?? null,
    source_url: sanitizePublicUrl(input.source_url),
    source_record_id: input.source_record_id ?? null,
    verification_status: input.verification_status ?? "unverified",
    confidence: input.confidence ?? null,
    normalized_value: input.normalized_value ?? {},
    dedupe_key: input.dedupe_key.trim(),
    lifecycle_status: input.lifecycle_status ?? "active",
    sanitized: true,
    legacy_signal_id: isUuid(input.legacy_signal_id) ? input.legacy_signal_id : null,
  };
  return done(await insertConflictSafe(ctx, "engagement_events", row, "workspace_id,dedupe_key",
    { workspace_id: input.workspace_id, dedupe_key: row.dedupe_key }));
}
