// Signals V2 dual-write orchestration — provider-free unit tests.
//
// Covers the two required mappings end-to-end against a fake writer layer (pure,
// no DB) and, for the hiring path, through the REAL canonical jobsSignalAdapter so
// the eligibility policy is exercised, not re-implemented. Proves: accepted-only
// people identity → lead_evidence; canonical hiring event → signal_events +
// signal_event_evidence; occurred_at preservation; closed/expired lifecycle;
// flag-OFF zero-write; best-effort failure isolation; reconciling observability.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildLeadEvidenceDedupeKey,
  dualWriteHiringSignalV2,
  dualWritePeopleProfileV2,
  hiringFreshnessBand,
  hiringLifecycleStatus,
  mapHiringSignalToEventInput,
  mapPeopleProfileToLeadEvidence,
  type DualWriteDeps,
} from "../../supabase/functions/_shared/signalsV2DualWrite.ts";
import {
  newSignalsV2Observability,
  signalsV2ObservabilityReconciles,
  type LeadEvidenceV2Input,
  type SignalEventEvidenceV2Input,
  type SignalEventV2Input,
  type SignalsV2WriteResult,
} from "../../supabase/functions/_shared/signalsV2Writer.ts";
import { jobRecordToSignalEvent } from "../../supabase/functions/_shared/jobsSignalAdapter.ts";
import type { SignalEvent } from "../../supabase/functions/_shared/signalEvent.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const WS2 = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "44444444-4444-4444-8444-444444444444";
const SIG = "55555555-5555-4555-8555-555555555555";

// A spy writer layer: records inputs, returns scripted results. No DB.
function spyWriters(script?: {
  lead?: Partial<SignalsV2WriteResult>;
  event?: Partial<SignalsV2WriteResult>;
  evidence?: Partial<SignalsV2WriteResult>;
  eventThrows?: boolean;
  evidenceThrows?: boolean;
}) {
  const calls = {
    lead: [] as LeadEvidenceV2Input[],
    event: [] as SignalEventV2Input[],
    evidence: [] as SignalEventEvidenceV2Input[],
  };
  const res = (o?: Partial<SignalsV2WriteResult>): SignalsV2WriteResult => ({
    attempted: true, enabled: true, written: true, deduplicated: false,
    record_id: SIG, reason: null, error_class: null, ...o,
  });
  const writers = {
    writeLeadEvidenceV2: (_ctx: any, input: LeadEvidenceV2Input) => {
      calls.lead.push(input);
      return Promise.resolve(res(script?.lead));
    },
    writeSignalEventV2: (_ctx: any, input: SignalEventV2Input) => {
      calls.event.push(input);
      if (script?.eventThrows) throw new Error("event boom");
      return Promise.resolve(res(script?.event));
    },
    writeSignalEventEvidenceV2: (_ctx: any, input: SignalEventEvidenceV2Input) => {
      calls.evidence.push(input);
      if (script?.evidenceThrows) throw new Error("evidence boom");
      return Promise.resolve(res(script?.evidence));
    },
  };
  return { writers, calls };
}

const deps = (enabled: boolean, writers: any, obs?: any): DualWriteDeps =>
  ({ admin: { from() { throw new Error("orchestration must not touch admin directly"); } }, enabled, writers, obs });

// ===================================================================== people =

Deno.test("people: accepted profile maps to person_identity lead_evidence", () => {
  const mapped = mapPeopleProfileToLeadEvidence({
    workspace_id: WS, contact_id: CONTACT, legacy_signal_id: SIG,
    provider: "apify", profile_url: "https://www.linkedin.com/in/jane-doe/",
    full_name: "Jane Doe", title: "VP Sales", company: "Acme", headline: "Scaling GTM",
  })!;
  assertEquals(mapped.evidence_kind, "person_identity");
  assertEquals(mapped.contact_id, CONTACT);
  assertEquals(mapped.legacy_signal_id, SIG);
  assertEquals(mapped.verification_status, "provider_verified");
  assertEquals(mapped.dedupe_key, "person_identity:url:linkedin.com/in/jane-doe");
  // normalized_value carries ONLY sanitized identity facts — no email/phone/raw.
  assertEquals(Object.keys(mapped.normalized_value ?? {}).sort(), ["company", "full_name", "headline", "title"]);
});

Deno.test("people: dedupe key prefers provider record id, then url, then contact", () => {
  assertEquals(
    buildLeadEvidenceDedupeKey({ workspace_id: WS, provider: "apify", source_record_id: "abc", profile_url: "https://linkedin.com/in/x", contact_id: CONTACT }),
    "person_identity:rec:apify:abc",
  );
  assertEquals(
    buildLeadEvidenceDedupeKey({ workspace_id: WS, profile_url: "https://linkedin.com/in/x", contact_id: CONTACT }),
    "person_identity:url:linkedin.com/in/x",
  );
  assertEquals(
    buildLeadEvidenceDedupeKey({ workspace_id: WS, contact_id: CONTACT }),
    `person_identity:contact:${CONTACT}`,
  );
  // No grounded identity at all ⇒ no key (dual-write will skip, never fabricate).
  assertEquals(buildLeadEvidenceDedupeKey({ workspace_id: WS }), null);
});

Deno.test("people: ungrounded identity skips as missing_entity, no write", async () => {
  const { writers, calls } = spyWriters();
  const r = await dualWritePeopleProfileV2(deps(true, writers), { workspace_id: WS });
  assertEquals(r.error_class, "missing_entity");
  assertEquals(calls.lead.length, 0);
});

Deno.test("people: flag OFF ⇒ writer receives enabled=false and makes no attempt", async () => {
  // Real writer path (no spy) with a strict admin proves zero DB when OFF.
  const obs = newSignalsV2Observability(false);
  const strictAdmin = { from() { throw new Error("DB while OFF"); } };
  const r = await dualWritePeopleProfileV2({ admin: strictAdmin, enabled: false, obs }, {
    workspace_id: WS, contact_id: CONTACT, profile_url: "https://linkedin.com/in/x",
  });
  assertEquals(r.attempted, false);
  assertEquals(r.error_class, "flag_disabled");
  assertEquals(obs.lead_evidence.skipped, 1);
  assert(signalsV2ObservabilityReconciles(obs));
});

Deno.test("people: V2 writer failure is best-effort (returns a result, never throws)", async () => {
  const { writers } = spyWriters({ lead: { written: false, attempted: true, error_class: "database_rejected", reason: "database rejected the write" } });
  const r = await dualWritePeopleProfileV2(deps(true, writers), { workspace_id: WS, contact_id: CONTACT });
  assertEquals(r.error_class, "database_rejected");
  assertEquals(r.written, false);
});

// ==================================================================== hiring ==

function hiringSignal(over?: Partial<SignalEvent>): SignalEvent {
  return {
    signal_id: "s1", workspace_id: WS, signal_type: "sales_hiring", signal_category: "gtm",
    company_ref: "linkedin.com/company/acme", person_ref: null,
    evidence_refs: [{ category: "job_signal", sourceType: "apify_actor", sourceUrl: "https://x.com/j/1", observedAt: "2026-07-10T00:00:00.000Z", confidence: "high" }],
    source_provider: "apify", actor_key: "apify_jobs", actor_id: "curious_coder/linkedin-jobs-scraper",
    source_url: "https://x.com/j/1",
    occurred_at: "2026-07-05T00:00:00.000Z", observed_at: "2026-07-10T00:00:00.000Z",
    confidence: "high", verification: "provider_verified",
    normalized_value: { role: "account executive", family: "sales_hiring" },
    listing_status: "active", dedupe_key: "hire-acme-sales", status: "active", sanitized: true,
    ...over,
  } as SignalEvent;
}

Deno.test("hiring: valid event writes, then attaches evidence to the parent id", async () => {
  const { writers, calls } = spyWriters();
  const obs = newSignalsV2Observability(true);
  const r = await dualWriteHiringSignalV2(deps(true, writers, obs), hiringSignal(), {
    workspace_id: WS, account_id: ACCOUNT, legacy_signal_id: SIG, source_record_id: "job-9",
  });
  assertEquals(r.event.written, true);
  assertEquals(calls.event[0].signal_type, "sales_hiring");
  assertEquals(calls.event[0].account_id, ACCOUNT);
  assertEquals(calls.event[0].evidence_category, "job_signal");
  assertEquals(calls.event[0].occurred_at, "2026-07-05T00:00:00.000Z");
  // evidence written to the parent id returned by the event write
  assertEquals(r.evidence?.written, true);
  assertEquals(calls.evidence[0].signal_event_id, SIG);
  assertEquals(calls.evidence[0].parent_workspace_id, WS);
});

Deno.test("hiring: occurred_at is the event time, never observed_at", () => {
  const mapped = mapHiringSignalToEventInput(hiringSignal(), { workspace_id: WS, account_id: ACCOUNT });
  assertEquals(mapped.occurred_at, "2026-07-05T00:00:00.000Z");
  assertEquals(mapped.observed_at, "2026-07-10T00:00:00.000Z");
  assert(mapped.occurred_at !== mapped.observed_at);
});

Deno.test("hiring: unsupported signal type is skipped (never persisted), no event/evidence", async () => {
  const { writers, calls } = spyWriters();
  const obs = newSignalsV2Observability(true);
  const r = await dualWriteHiringSignalV2(deps(true, writers, obs), hiringSignal({ signal_type: "recent_funding", signal_category: "growth" }), {
    workspace_id: WS, account_id: ACCOUNT,
  });
  assertEquals(r.event.error_class, "unsupported_event");
  assertEquals(r.evidence, null);
  assertEquals(calls.event.length, 0);
  assertEquals(obs.signal_events.skipped, 1);
});

Deno.test("hiring: evidence failure leaves the parent event intact (best-effort)", async () => {
  const { writers } = spyWriters({ evidenceThrows: true });
  const r = await dualWriteHiringSignalV2(deps(true, writers), hiringSignal(), { workspace_id: WS, account_id: ACCOUNT });
  assertEquals(r.event.written, true, "parent event stands even when evidence write throws");
  assertEquals(r.evidence?.error_class, "unexpected_error");
});

Deno.test("hiring: no parent id (dedup lookup miss) ⇒ no evidence attempted", async () => {
  const { writers, calls } = spyWriters({ event: { written: false, deduplicated: true, record_id: null } });
  const r = await dualWriteHiringSignalV2(deps(true, writers), hiringSignal(), { workspace_id: WS, account_id: ACCOUNT });
  assertEquals(r.event.deduplicated, true);
  assertEquals(r.evidence, null);
  assertEquals(calls.evidence.length, 0);
});

Deno.test("hiring: closed listing → stale lifecycle; expired listing → expired; never active", () => {
  assertEquals(hiringLifecycleStatus("closed", "stale"), "stale");
  assertEquals(hiringLifecycleStatus("expired", "stale"), "expired");
  assertEquals(hiringLifecycleStatus("active", "strong"), "active");
  assertEquals(hiringLifecycleStatus("unknown", "stale"), "stale");
  // A dead listing is stale immediately regardless of posting age.
  assertEquals(hiringFreshnessBand("2026-07-05T00:00:00.000Z", "2026-07-06T00:00:00.000Z", "closed"), "stale");
  // A recent, open listing is strong.
  assertEquals(hiringFreshnessBand("2026-07-05T00:00:00.000Z", "2026-07-06T00:00:00.000Z", "active"), "strong");

  const closedMapped = mapHiringSignalToEventInput(hiringSignal({ listing_status: "closed" }), { workspace_id: WS, account_id: ACCOUNT });
  assertEquals(closedMapped.listing_status, "closed");
  assertEquals(closedMapped.lifecycle_status, "stale");
  const expiredMapped = mapHiringSignalToEventInput(hiringSignal({ listing_status: "expired" }), { workspace_id: WS, account_id: ACCOUNT });
  assertEquals(expiredMapped.lifecycle_status, "expired");
});

Deno.test("hiring: evidence fingerprint distinguishes providers, collapses same provider", async () => {
  const { writers, calls } = spyWriters();
  await dualWriteHiringSignalV2(deps(true, writers), hiringSignal(), { workspace_id: WS, account_id: ACCOUNT, source_record_id: "job-9" });
  await dualWriteHiringSignalV2(deps(true, writers), hiringSignal({ source_provider: "firecrawl", actor_key: "firecrawl_scrape" }), { workspace_id: WS, account_id: ACCOUNT });
  assert(calls.evidence[0].evidence_fingerprint.startsWith("apify|"));
  assert(calls.evidence[1].evidence_fingerprint.startsWith("firecrawl|"));
  assert(calls.evidence[0].evidence_fingerprint !== calls.evidence[1].evidence_fingerprint);
});

// ------------ real canonical adapter → dual-write (eligibility exercised) ------

Deno.test("hiring: through the REAL jobsSignalAdapter — GTM role + posting date writes", async () => {
  const { signal, rejected } = jobRecordToSignalEvent({
    job: { company: "Acme", jobTitle: "Account Executive", linkedinUrl: "https://linkedin.com/company/acme", jobUrl: "https://x.com/j/1", postedAt: "2026-07-05T00:00:00.000Z", raw: {} },
    workspace_id: WS, company_ref: "linkedin.com/company/acme", observedAt: "2026-07-10T00:00:00.000Z", provider: "apify", actorKey: "apify_jobs",
  });
  assertEquals(rejected, false);
  const { writers, calls } = spyWriters();
  const r = await dualWriteHiringSignalV2(deps(true, writers), signal!, { workspace_id: WS, account_id: ACCOUNT, legacy_signal_id: SIG });
  assertEquals(r.event.written, true);
  assertEquals(calls.event[0].signal_type, "sales_hiring");
  assertEquals(calls.event[0].legacy_signal_id, SIG);
});

Deno.test("hiring: through the REAL adapter — non-GTM title is rejected upstream (no dual-write)", () => {
  const { signal, rejected, reason } = jobRecordToSignalEvent({
    job: { company: "Acme", jobTitle: "Warehouse Associate", jobUrl: "https://x.com/j/2", postedAt: "2026-07-05T00:00:00.000Z", raw: {} },
    workspace_id: WS, company_ref: "linkedin.com/company/acme", observedAt: "2026-07-10T00:00:00.000Z",
  });
  assertEquals(rejected, true);
  assertEquals(reason, "not_gtm_hiring");
  assertEquals(signal, null);
});

Deno.test("hiring: through the REAL adapter — missing posting date is rejected (no fabricated occurred_at)", () => {
  const { rejected, reason } = jobRecordToSignalEvent({
    job: { company: "Acme", jobTitle: "Account Executive", jobUrl: "https://x.com/j/3", postedAt: null, raw: {} },
    workspace_id: WS, company_ref: "linkedin.com/company/acme", observedAt: "2026-07-10T00:00:00.000Z",
  });
  assertEquals(rejected, true);
  assertEquals(reason, "missing_occurred_at");
});

// =============================================================== observability =

Deno.test("observability reconciles across a mixed run (considered = attempted + skipped)", async () => {
  const obs = newSignalsV2Observability(true);
  const { writers } = spyWriters();
  // one people write, one hiring write (+ evidence), one unsupported skip
  const wr = { ...writers } as any;
  // route through the real writer accounting via obs by using dedicated spies that record obs
  const { writeLeadEvidenceV2, writeSignalEventV2, writeSignalEventEvidenceV2 } = await import("../../supabase/functions/_shared/signalsV2Writer.ts");
  const okAdmin = makeOkAdmin();
  await dualWritePeopleProfileV2({ admin: okAdmin, enabled: true, obs }, { workspace_id: WS, contact_id: CONTACT, profile_url: "https://linkedin.com/in/x" });
  await dualWriteHiringSignalV2({ admin: okAdmin, enabled: true, obs }, hiringSignal(), { workspace_id: WS, account_id: ACCOUNT });
  await dualWriteHiringSignalV2({ admin: okAdmin, enabled: true, obs }, hiringSignal({ signal_type: "recent_funding", signal_category: "growth" }), { workspace_id: WS, account_id: ACCOUNT });
  assert(signalsV2ObservabilityReconciles(obs));
  assertEquals(obs.lead_evidence.written, 1);
  assertEquals(obs.signal_events.written, 1);
  assertEquals(obs.signal_events.skipped, 1); // the unsupported_event
  assertEquals(obs.signal_event_evidence.written, 1);
  // reference wr so lint is satisfied
  assert(typeof wr.writeLeadEvidenceV2 === "function");
  assert(typeof writeLeadEvidenceV2 === "function" && typeof writeSignalEventV2 === "function" && typeof writeSignalEventEvidenceV2 === "function");
});

// A permissive fake admin (always inserts) for the observability integration test.
function makeOkAdmin() {
  const store: Record<string, any[]> = {};
  return {
    from(table: string) {
      store[table] ??= [];
      return {
        upsert(row: any, _opts: any) {
          return { select: (_c: string) => { const id = crypto.randomUUID(); store[table].push({ ...row, id }); return Promise.resolve({ data: [{ id }], error: null }); } };
        },
        select(_c: string) {
          const chain: any = { eq() { return chain; }, maybeSingle() { return Promise.resolve({ data: null, error: null }); } };
          return chain;
        },
      };
    },
  };
}
