// LISA V2 — PERSISTENCE: a LisaSignal → one lisa_record_signal call.
//
// The row is an ordinary signal_events row so every existing reader keeps
// working; the V2 fields ride under normalized_value.lisa. The RPC does the
// insert-or-find, the evidence rows and the verification RECOUNT over all
// stored evidence in ONE transaction, so the database — not this pass — is the
// authority on how well an event is corroborated.
//
// PURE except `rpcSignalStore`, which takes an injected rpc client.

import { evidenceFingerprint, FRESH_DAYS } from "./verify.ts";
import type { SignalStore, StoreOutcome } from "./pipeline.ts";
import type { LisaSignal } from "./types.ts";

export const LISA_SCHEMA_VERSION = "lisa-v2.1";

// ── NO PERSONAL CONTACT DATA ────────────────────────────────────────────────
// Source text (titles, excerpts) can quote a press contact's email or phone.
// It is REDACTED before storage. The shared signalsV2Writer sanitizer cannot be
// reused here as-is: its phone pattern also matches ISO dates
// ("2026-11-10T12:00"), which every LISA row carries, so it would refuse all of
// them. Dates are kept; anything else phone-shaped with ≥ 9 digits is removed.
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONEISH = /\+?\d[\d\s().-]{7,}\d/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?$/;
export function redactContactData(text: string): string {
  return text.replace(EMAIL, "[redacted]").replace(PHONEISH, (m) =>
    ISO_DATE.test(m) || m.replace(/\D/g, "").length < 9 ? m : "[redacted]");
}
const clean = (t: string | null | undefined) => (typeof t === "string" ? redactContactData(t) : t ?? null);
/** True when no email or non-date phone number survives anywhere in the value. */
export function containsContactData(v: unknown): boolean {
  const flat = JSON.stringify(v ?? null);
  return redactContactData(flat) !== flat;
}

const EVIDENCE_CATEGORY: Record<LisaSignal["category"], string> = {
  funding: "funding_signal", hiring: "job_signal", expansion: "expansion_signal", product_launch: "launch_signal",
};

/** Which signal_events.origin a LISA pass writes under (existing vocabulary). */
export function originFor(s: Pick<LisaSignal, "watch_origin" | "subject_type" | "collection_method">): string {
  if (s.subject_type === "competitor") return "competitor_monitor";
  if (s.watch_origin === "watchlist") return "tracked_company";
  return s.collection_method === "lisa_v2_on_demand" ? "manual_scan" : "scheduled_monitor";
}

/** The `normalized_value.lisa` block — everything a downstream agent needs. */
export function lisaBlock(s: LisaSignal): Record<string, unknown> {
  return {
    schema: LISA_SCHEMA_VERSION,
    category: s.category,
    company: { name: s.company_name, domain: s.company_domain },
    title: clean(s.title),
    description: clean(s.description),
    event_date: s.event_date,
    discovered_at: s.discovered_at,
    event_instance: s.event_instance,
    source_url: s.source_url,
    source_type: s.source_type,
    collection_method: s.collection_method,
    watch_origin: s.watch_origin,
    verification: s.verification,
    relevance: s.relevance,
  };
}

/** The p_event / p_evidence arguments for lisa_record_signal. */
export async function recordArgs(s: LisaSignal): Promise<{ p_workspace_id: string; p_event: Record<string, unknown>; p_evidence: Array<Record<string, unknown>> }> {
  const expires = s.event_date ? new Date(Date.parse(s.event_date) + FRESH_DAYS[s.category] * 86_400_000).toISOString() : null;
  const normalized_value = {
    // Feed payload keys the existing Signals feed already reads.
    title: clean(s.title), summary: clean(s.description), company_name: s.company_name, company_domain: s.company_domain,
    lisa: lisaBlock(s),
  };
  const p_evidence = await Promise.all(s.evidence.map(async (e) => ({
    fingerprint: await evidenceFingerprint(e.url),
    source_url: e.url,
    observed_at: e.observed_at,
    normalized_value: {
      domain: e.domain, source_type: e.source_type, excerpt: clean(e.excerpt.slice(0, 400)), negation: e.negation,
      attributes: e.attributes,
    },
  })));
  return {
    p_workspace_id: s.workspace_id,
    p_event: {
      origin: originFor(s), signal_type: s.signal_type, signal_category: s.signal_category,
      evidence_category: EVIDENCE_CATEGORY[s.category], subject_type: s.subject_type, subject_key: s.subject_key,
      occurred_at: s.event_date ? `${s.event_date}T00:00:00Z` : null,
      occurred_at_basis: s.event_date ? "source_reported" : "unknown",
      observed_at: s.discovered_at, expires_at: expires, dedupe_key: s.dedupe_key,
      provider: s.provider, source_url: s.source_url, normalized_value,
    },
    p_evidence,
  };
}

export type RpcClient = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };

/** The production store: one RPC per event. A refusal is a failure, never a success. */
export function rpcSignalStore(db: RpcClient): SignalStore {
  return {
    async record(s: LisaSignal): Promise<StoreOutcome> {
      const args = await recordArgs(s);
      // Text-bearing values only: fingerprints are hex and may hold long digit runs.
      if (containsContactData(args.p_event.normalized_value) || containsContactData(args.p_evidence.map((e) => e.normalized_value))) {
        return { status: "failed", event_id: null, error: "sanitization_rejected" };
      }
      try {
        const { data, error } = await db.rpc("lisa_record_signal", args);
        if (error) return { status: "failed", event_id: null, error: "database_rejected" };
        const d = (data ?? {}) as Record<string, unknown>;
        const status = d.status;
        if (status !== "new" && status !== "updated" && status !== "duplicate") {
          return { status: "failed", event_id: null, error: "unexpected_response" };
        }
        return { status, event_id: typeof d.event_id === "string" ? d.event_id : null,
          verification_level: (d.verification_level as string) ?? null, lifecycle_status: (d.lifecycle_status as string) ?? null };
      } catch {
        return { status: "failed", event_id: null, error: "store_threw" };
      }
    },
  };
}
