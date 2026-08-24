// Signals Storage V2 — Phase 2 dual-write orchestration (provider-free).
//
// This module is the ONLY place that maps a legacy-persisted domain object (an
// accepted people_profile, a canonical hiring SignalEvent) into the shared V2
// writer boundary. It owns the mapping and the sequencing; the writer boundary
// (signalsV2Writer.ts) owns the sanitized, idempotent database contract.
//
// INVARIANTS
//   * LEGACY IS AUTHORITATIVE. Every entry point here is called ONLY after the
//     corresponding legacy write has already succeeded, and is strictly
//     best-effort: it never throws into the caller and its result never changes
//     legacy success.
//   * FLAG-GATED. When SIGNALS_V2 is off, resolveEnabled() is false, every writer
//     returns `flag_disabled` immediately, and ZERO database calls are made. The
//     only bookkeeping is the sanitized skip recorded in observability.
//   * occurred_at is the SOURCE event time and is never replaced by observed_at.
//   * No raw provider payload, email, phone, or credential ever leaves this module
//     — the writer boundary re-checks and would reject a violation anyway.

import { isSignalsV2Enabled } from "./signalsV2Flag.ts";
import type { SignalOrigin } from "./signalOrigin.ts";
import {
  applyResultToObservability,
  writeLeadEvidenceV2,
  writeSignalEventEvidenceV2,
  writeSignalEventV2,
  type LeadEvidenceV2Input,
  type SignalEventEvidenceV2Input,
  type SignalEventV2Input,
  type SignalsV2AdminClient,
  type SignalsV2Observability,
  type SignalsV2WriteResult,
  type WriterCtx,
} from "./signalsV2Writer.ts";
import { evidenceCategoryForSignalType, type SignalEvent } from "./signalEvent.ts";
import {
  jobBandForAgeDays,
  listingStatusIsDead,
  HOURS_PER_DAY,
  type ListingStatus,
  type TimingFreshnessBand,
} from "./timingFreshnessPolicy.ts";

// -------------------------------------------------------------- deps ----------

/** Writer functions, injectable so orchestration can be unit-tested with a fake
 * (or entirely stubbed) writer layer — no fake database required. */
export interface DualWriteWriters {
  writeLeadEvidenceV2: typeof writeLeadEvidenceV2;
  writeSignalEventV2: typeof writeSignalEventV2;
  writeSignalEventEvidenceV2: typeof writeSignalEventEvidenceV2;
}

const DEFAULT_WRITERS: DualWriteWriters = {
  writeLeadEvidenceV2,
  writeSignalEventV2,
  writeSignalEventEvidenceV2,
};

export interface DualWriteDeps {
  admin: SignalsV2AdminClient;
  /** Resolved flag state. Defaults to reading the environment once. Tests inject. */
  enabled?: boolean;
  obs?: SignalsV2Observability | null;
  /** Injected writer layer (tests). Defaults to the real writer boundary. */
  writers?: Partial<DualWriteWriters>;
}

function resolveWriters(deps: DualWriteDeps): DualWriteWriters {
  return { ...DEFAULT_WRITERS, ...(deps.writers ?? {}) };
}

function resolveEnabled(deps: DualWriteDeps): boolean {
  return typeof deps.enabled === "boolean" ? deps.enabled : isSignalsV2Enabled();
}

function writerCtx(deps: DualWriteDeps, enabled: boolean): WriterCtx {
  return { admin: deps.admin, enabled, obs: deps.obs ?? null };
}

// ------------------------------------------------------- shared helpers -------

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Normalize a profile/source URL to a stable dedupe token (host + path, lowercased,
 * no scheme/query/trailing slash). Returns "" when not a usable http(s) URL. */
export function normalizeSourceUrlKey(u: string | null | undefined): string {
  const s = typeof u === "string" ? u.trim() : "";
  if (!s) return "";
  try {
    const url = new URL(s);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const host = url.host.replace(/^www\./i, "");
    return `${host}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return "";
  }
}

// =============================================================================
// People profile → lead_evidence (person_identity)
// =============================================================================

/** The already-legacy-persisted person this dual-write mirrors. Every field is a
 * sanitized identity fact — never email/phone/raw payload. */
export interface PeopleProfileDualWriteInput {
  workspace_id: string;
  /** Grounded entities from the legacy write; at least one must be a real uuid. */
  contact_id?: string | null;
  account_id?: string | null;
  lead_candidate_id?: string | null;
  /** The legacy public.signals.id created by the people_profile write. */
  legacy_signal_id?: string | null;

  provider?: string | null;
  actor_key?: string | null;
  actor_id?: string | null;
  /** Public LinkedIn / profile URL (source_url). */
  profile_url?: string | null;
  /** Stable provider record id when grounded. */
  source_record_id?: string | null;
  observed_at?: string | null;

  // Sanitized identity facts for normalized_value (NO email/phone/raw).
  full_name?: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  headline?: string | null;
}

/**
 * Deterministic dedupe key for identity evidence. Grounded identifiers only, in a
 * fixed preference order — NEVER a timestamp, random id, or mutable display value:
 *   1. provider + stable source record id
 *   2. normalized profile/source URL
 *   3. stable contact id
 * A repeat write of the same identity therefore resolves to the same key.
 */
export function buildLeadEvidenceDedupeKey(input: PeopleProfileDualWriteInput): string | null {
  if (input.provider && input.source_record_id) {
    return `person_identity:rec:${String(input.provider).toLowerCase()}:${input.source_record_id}`;
  }
  const urlKey = normalizeSourceUrlKey(input.profile_url);
  if (urlKey) return `person_identity:url:${urlKey}`;
  if (isUuid(input.contact_id)) return `person_identity:contact:${input.contact_id}`;
  return null;
}

/** Pure mapping: accepted people_profile → LeadEvidenceV2Input (or null when it
 * cannot be grounded into a deterministic dedupe key). */
export function mapPeopleProfileToLeadEvidence(
  input: PeopleProfileDualWriteInput,
): LeadEvidenceV2Input | null {
  const dedupe_key = buildLeadEvidenceDedupeKey(input);
  if (!dedupe_key) return null;

  // Provider-sourced profiles are source-backed → provider_verified; without a
  // profile URL the identity is unverified. verified_at only when verified.
  const hasSourceUrl = normalizeSourceUrlKey(input.profile_url) !== "";
  const verification_status = hasSourceUrl ? "provider_verified" : "unverified";

  const normalized_value: Record<string, unknown> = {};
  if (input.full_name) normalized_value.full_name = String(input.full_name).slice(0, 200);
  if (input.title) normalized_value.title = String(input.title).slice(0, 200);
  if (input.company) normalized_value.company = String(input.company).slice(0, 200);
  if (input.location) normalized_value.location = String(input.location).slice(0, 200);
  if (input.headline) normalized_value.headline = String(input.headline).slice(0, 300);

  return {
    workspace_id: input.workspace_id,
    evidence_kind: "person_identity",
    contact_id: input.contact_id ?? null,
    account_id: input.account_id ?? null,
    lead_candidate_id: input.lead_candidate_id ?? null,
    provider: input.provider ?? null,
    actor_key: input.actor_key ?? null,
    actor_id: input.actor_id ?? null,
    source_url: input.profile_url ?? null,
    source_record_id: input.source_record_id ?? null,
    observed_at: input.observed_at ?? null,
    verified_at: hasSourceUrl ? (input.observed_at ?? null) : null,
    verification_status,
    confidence: hasSourceUrl ? "high" : null,
    normalized_value,
    dedupe_key,
    lifecycle_status: "active",
    legacy_signal_id: input.legacy_signal_id ?? null,
  };
}

/**
 * Dual-write an accepted people_profile into lead_evidence. Best-effort; the
 * returned result is purely for observability. Never throws.
 */
export async function dualWritePeopleProfileV2(
  deps: DualWriteDeps,
  input: PeopleProfileDualWriteInput,
): Promise<SignalsV2WriteResult> {
  const enabled = resolveEnabled(deps);
  const writers = resolveWriters(deps);
  try {
    const mapped = mapPeopleProfileToLeadEvidence(input);
    if (!mapped) {
      return applyResultToObservability(deps.obs, "lead_evidence", {
        attempted: false, enabled, written: false, deduplicated: false, record_id: null,
        reason: "no grounded dedupe identity for identity evidence",
        error_class: "missing_entity",
      });
    }
    return await writers.writeLeadEvidenceV2(writerCtx(deps, enabled), mapped);
  } catch {
    return applyResultToObservability(deps.obs, "lead_evidence", {
      attempted: false, enabled, written: false, deduplicated: false, record_id: null,
      reason: "unexpected dual-write error", error_class: "unexpected_error",
    });
  }
}

// =============================================================================
// Canonical hiring SignalEvent → signal_events (+ signal_event_evidence)
// =============================================================================

/** GTM hiring types this phase persists. Anything else is out of scope for the
 * hiring dual-write and is skipped as `unsupported_event`. */
const SUPPORTED_HIRING_TYPES = new Set(["sales_hiring", "revops_hiring", "growth_hiring"]);

/** Grounded DB references + legacy anchor for a hiring dual-write. */
export interface HiringSignalRefs {
  workspace_id: string;
  /** Which workflow produced this. Threaded from the caller, never assumed. */
  origin: SignalOrigin;
  account_id?: string | null;
  contact_id?: string | null;
  lead_candidate_id?: string | null;
  /** The legacy public.signals.id — ONLY when a real legacy hiring row exists. */
  legacy_signal_id?: string | null;
  /** Stable provider job id for the observation. */
  source_record_id?: string | null;
}

const DAY_MS = HOURS_PER_DAY * 60 * 60 * 1000;

/** Truthful freshness band for a hiring event. A dead listing (closed/expired) is
 * stale immediately; otherwise age of the EVENT (occurred_at) drives the band. */
export function hiringFreshnessBand(
  occurred_at: string,
  observed_at: string,
  listing_status: ListingStatus | null | undefined,
): TimingFreshnessBand {
  if (listingStatusIsDead(listing_status)) return "stale";
  const occ = Date.parse(occurred_at);
  const obs = Date.parse(observed_at);
  if (!isFinite(occ) || !isFinite(obs)) return "stale";
  const ageDays = (obs - occ) / DAY_MS;
  return jobBandForAgeDays(ageDays);
}

/** Lifecycle status from source-backed listing status + freshness. A closed or
 * expired listing is NEVER active again; a merely-old active/unknown listing is
 * stale. See migration signal_events_lifecycle_valid. */
export function hiringLifecycleStatus(
  listing_status: ListingStatus | null | undefined,
  freshness: TimingFreshnessBand,
): string {
  if (listing_status === "expired") return "expired";
  if (listing_status === "closed") return "stale";
  return freshness === "stale" ? "stale" : "active";
}

/** Deterministic evidence fingerprint for one observation of a signal event. Keys on
 * provider identity + the source locator + the event time and type, so a repeat
 * observation from the same provider collapses while a different provider adds a row. */
export function buildSignalEventEvidenceFingerprint(signal: SignalEvent, source_record_id?: string | null): string {
  const provider = String(signal.source_provider ?? signal.provenance?.provider ?? "").toLowerCase();
  const actor = String(signal.actor_key ?? signal.provenance?.actorKey ?? "").toLowerCase();
  const locator = normalizeSourceUrlKey(signal.source_url) || String(source_record_id ?? "");
  return `${provider}|${actor}|${locator}|${signal.occurred_at}|${signal.signal_type}`;
}

/** Pure mapping: canonical hiring SignalEvent → SignalEventV2Input. */
export function mapHiringSignalToEventInput(
  signal: SignalEvent,
  refs: HiringSignalRefs,
): SignalEventV2Input {
  const listing_status = (signal.listing_status ?? null) as ListingStatus | null;
  const freshness = hiringFreshnessBand(signal.occurred_at, signal.observed_at, listing_status);
  return {
    workspace_id: refs.workspace_id,
    origin: refs.origin,
    contact_id: refs.contact_id ?? null,
    account_id: refs.account_id ?? null,
    lead_candidate_id: refs.lead_candidate_id ?? null,
    signal_type: signal.signal_type,
    signal_category: signal.signal_category,
    evidence_category: evidenceCategoryForSignalType(signal.signal_type),
    // occurred_at is the SOURCE event time — never observed_at.
    occurred_at: signal.occurred_at,
    observed_at: signal.observed_at,
    expires_at: signal.expires_at ?? null,
    freshness,
    listing_status,
    confidence: signal.confidence,
    verification_status: signal.verification,
    normalized_value: signal.normalized_value ?? {},
    dedupe_key: signal.dedupe_key,
    lifecycle_status: hiringLifecycleStatus(listing_status, freshness),
    provider: signal.source_provider ?? signal.provenance?.provider ?? null,
    actor_key: signal.actor_key ?? signal.provenance?.actorKey ?? null,
    actor_id: signal.actor_id ?? signal.provenance?.actorId ?? null,
    source_url: signal.source_url ?? null,
    legacy_signal_id: refs.legacy_signal_id ?? null,
  };
}

/** Pure mapping: canonical hiring SignalEvent → SignalEventEvidenceV2Input for a
 * written/deduplicated parent event id. */
export function mapHiringSignalToEvidenceInput(
  signal: SignalEvent,
  signal_event_id: string,
  refs: HiringSignalRefs,
): SignalEventEvidenceV2Input {
  return {
    workspace_id: refs.workspace_id,
    signal_event_id,
    parent_workspace_id: refs.workspace_id,
    provider: signal.source_provider ?? signal.provenance?.provider ?? null,
    actor_key: signal.actor_key ?? signal.provenance?.actorKey ?? null,
    actor_id: signal.actor_id ?? signal.provenance?.actorId ?? null,
    source_url: signal.source_url ?? null,
    source_record_id: refs.source_record_id ?? null,
    evidence_fingerprint: buildSignalEventEvidenceFingerprint(signal, refs.source_record_id),
    observed_at: signal.observed_at,
    verification_status: signal.verification,
    confidence: signal.confidence,
    normalized_value: signal.normalized_value ?? {},
    legacy_signal_id: refs.legacy_signal_id ?? null,
  };
}

export interface HiringDualWriteResult {
  event: SignalsV2WriteResult;
  evidence: SignalsV2WriteResult | null;
}

/**
 * Dual-write a canonical, VALIDATED hiring SignalEvent into signal_events, then
 * attach the source observation to signal_event_evidence. Best-effort throughout;
 * an evidence failure never invalidates the parent. Never throws.
 *
 * The caller supplies an already-canonical, validated SignalEvent (e.g. from
 * jobRecordToSignalEvent). Only the three GTM hiring families are in scope this
 * phase — any other type is skipped as `unsupported_event`.
 */
export async function dualWriteHiringSignalV2(
  deps: DualWriteDeps,
  signal: SignalEvent,
  refs: HiringSignalRefs,
): Promise<HiringDualWriteResult> {
  const enabled = resolveEnabled(deps);
  const writers = resolveWriters(deps);

  if (!SUPPORTED_HIRING_TYPES.has(signal.signal_type)) {
    const event = applyResultToObservability(deps.obs, "signal_events", {
      attempted: false, enabled, written: false, deduplicated: false, record_id: null,
      reason: "signal_type is not an in-scope hiring event", error_class: "unsupported_event",
    });
    return { event, evidence: null };
  }

  let event: SignalsV2WriteResult;
  try {
    event = await writers.writeSignalEventV2(writerCtx(deps, enabled), mapHiringSignalToEventInput(signal, refs));
  } catch {
    event = applyResultToObservability(deps.obs, "signal_events", {
      attempted: false, enabled, written: false, deduplicated: false, record_id: null,
      reason: "unexpected dual-write error", error_class: "unexpected_error",
    });
    return { event, evidence: null };
  }

  // Attach the observation only when we have a real parent id (written OR a
  // deduplicated row whose id was resolved). A missing parent id is a benign skip.
  if (!(event.written || event.deduplicated) || !isUuid(event.record_id)) {
    return { event, evidence: null };
  }

  let evidence: SignalsV2WriteResult;
  try {
    evidence = await writers.writeSignalEventEvidenceV2(
      writerCtx(deps, enabled),
      mapHiringSignalToEvidenceInput(signal, event.record_id, refs),
    );
  } catch {
    evidence = applyResultToObservability(deps.obs, "signal_event_evidence", {
      attempted: false, enabled, written: false, deduplicated: false, record_id: null,
      reason: "unexpected dual-write error", error_class: "unexpected_error",
    });
  }
  return { event, evidence };
}
