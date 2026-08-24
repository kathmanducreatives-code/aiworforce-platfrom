// Signals V2 shared writer boundary — provider-free unit tests.
//
// A small stateful fake admin simulates the table's unique constraint so we can
// prove: written vs deduplicated (idempotency), sanitized rejection of raw
// payload/PII, workspace pinning, sanitized DB-failure classes, and the
// reconciling observability contract. No network, no real database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SIGNAL_ORIGINS } from "../../../supabase/functions/_shared/signalOrigin.ts";
import {
  isSanitizedNormalizedValue,
  newSignalsV2Observability,
  sanitizePublicUrl,
  signalsV2ObservabilityReconciles,
  writeEngagementEventV2,
  writeLeadEvidenceV2,
  writeSignalEventEvidenceV2,
  writeSignalEventV2,
  type SignalsV2AdminClient,
} from "../../../supabase/functions/_shared/signalsV2Writer.ts";

// ------------------------------------------------------ fake admin ------------

/** Fake supabase-js admin with a per-table unique constraint keyed on the columns
 * passed via onConflict. `failTables` injects a database rejection. `strict` proves
 * the flag-OFF path: any from() call throws (so a test can prove ZERO DB calls). */
function makeAdmin(o?: { failTables?: string[]; strict?: boolean }) {
  const store: Record<string, any[]> = {};
  const failTables = new Set(o?.failTables ?? []);
  let fromCalls = 0;

  const admin: SignalsV2AdminClient = {
    from(table: string) {
      fromCalls++;
      if (o?.strict) throw new Error("DB access while flag OFF");
      store[table] ??= [];
      return {
        upsert(row: any, opts: { onConflict: string; ignoreDuplicates?: boolean }) {
          return {
            select(_cols: string) {
              if (failTables.has(table)) {
                return Promise.resolve({ data: null, error: { message: "boom: internal db error 42P01" } });
              }
              const cols = String(opts.onConflict).split(",").map((s) => s.trim());
              const keyOf = (r: any) => cols.map((c) => String(r[c])).join("|");
              const key = keyOf(row);
              const existing = store[table].find((r) => keyOf(r) === key);
              if (existing && opts.ignoreDuplicates) {
                return Promise.resolve({ data: [], error: null }); // conflict → dedup
              }
              const id = crypto.randomUUID();
              store[table].push({ ...row, id });
              return Promise.resolve({ data: [{ id }], error: null });
            },
          };
        },
        select(_cols: string) {
          const filters: [string, any][] = [];
          const chain: any = {
            eq(k: string, v: any) { filters.push([k, v]); return chain; },
            maybeSingle() {
              const row = store[table].find((r) => filters.every(([k, v]) => String(r[k]) === String(v)));
              return Promise.resolve({ data: row ? { id: row.id } : null, error: null });
            },
          };
          return chain;
        },
      };
    },
  };
  return { admin, store, fromCalls: () => fromCalls };
}

const WS = "11111111-1111-4111-8111-111111111111";
const WS2 = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "44444444-4444-4444-8444-444444444444";

// ------------------------------------------------------ sanitization ----------

Deno.test("isSanitizedNormalizedValue rejects raw payload keys, email, phone", () => {
  assert(isSanitizedNormalizedValue({ role: "AE", count: 3 }));
  assert(isSanitizedNormalizedValue(null));
  assertEquals(isSanitizedNormalizedValue({ raw: { anything: 1 } }), false);
  assertEquals(isSanitizedNormalizedValue({ payload: 1 }), false);
  assertEquals(isSanitizedNormalizedValue({ email: "x" }), false);
  assertEquals(isSanitizedNormalizedValue({ note: "reach me at a@b.com" }), false);
  assertEquals(isSanitizedNormalizedValue({ note: "+1 415 555 1212 call" }), false);
});

Deno.test("sanitizePublicUrl strips creds/query and rejects non-http", () => {
  assertEquals(sanitizePublicUrl("https://x.com/a/?q=1#z"), "https://x.com/a");
  assertEquals(sanitizePublicUrl("https://user:pw@x.com/a"), null);
  assertEquals(sanitizePublicUrl("javascript:alert(1)"), null);
  assertEquals(sanitizePublicUrl("  "), null);
});

// ------------------------------------------------------ flag OFF --------------

Deno.test("flag OFF: writer makes ZERO db calls and reports flag_disabled", async () => {
  const { admin, fromCalls } = makeAdmin({ strict: true });
  const obs = newSignalsV2Observability(false);
  const r = await writeLeadEvidenceV2({ admin, enabled: false, obs }, {
    workspace_id: WS, evidence_kind: "person_identity", contact_id: CONTACT, dedupe_key: "k1",
  });
  assertEquals(r.attempted, false);
  assertEquals(r.error_class, "flag_disabled");
  assertEquals(fromCalls(), 0);
  assertEquals(obs.lead_evidence.considered, 1);
  assertEquals(obs.lead_evidence.skipped, 1);
  assertEquals(obs.lead_evidence.attempted, 0);
  assert(signalsV2ObservabilityReconciles(obs));
});

// ------------------------------------------------------ lead_evidence ---------

Deno.test("lead_evidence: valid write, then idempotent dedup on repeat", async () => {
  const { admin, store } = makeAdmin();
  const obs = newSignalsV2Observability(true);
  const input = {
    workspace_id: WS, evidence_kind: "person_identity", contact_id: CONTACT,
    dedupe_key: "person_identity:url:linkedin.com/in/jane", legacy_signal_id: ACCOUNT,
    normalized_value: { full_name: "Jane" }, verification_status: "provider_verified", confidence: "high",
  };
  const first = await writeLeadEvidenceV2({ admin, enabled: true, obs }, input as any);
  assertEquals(first.written, true);
  assertEquals(store.lead_evidence.length, 1);
  assertEquals(store.lead_evidence[0].legacy_signal_id, ACCOUNT);

  const second = await writeLeadEvidenceV2({ admin, enabled: true, obs }, input as any);
  assertEquals(second.deduplicated, true);
  assertEquals(second.written, false);
  assertEquals(store.lead_evidence.length, 1, "dedup must not insert a second row");
  assertEquals(obs.lead_evidence.written, 1);
  assertEquals(obs.lead_evidence.deduplicated, 1);
  assert(signalsV2ObservabilityReconciles(obs));
});

Deno.test("lead_evidence: requires an entity and a known evidence_kind", async () => {
  const { admin } = makeAdmin();
  const noEntity = await writeLeadEvidenceV2({ admin, enabled: true }, {
    workspace_id: WS, evidence_kind: "person_identity", dedupe_key: "k",
  });
  assertEquals(noEntity.error_class, "missing_entity");
  const badKind = await writeLeadEvidenceV2({ admin, enabled: true }, {
    workspace_id: WS, evidence_kind: "not_a_kind", contact_id: CONTACT, dedupe_key: "k",
  });
  assertEquals(badKind.error_class, "validation_failed");
});

Deno.test("lead_evidence: PII in normalized_value is rejected (sanitized policy)", async () => {
  const { admin, store } = makeAdmin();
  const r = await writeLeadEvidenceV2({ admin, enabled: true }, {
    workspace_id: WS, evidence_kind: "person_identity", contact_id: CONTACT, dedupe_key: "k",
    normalized_value: { email: "jane@acme.com" },
  });
  assertEquals(r.error_class, "sanitized_policy_rejected");
  assertEquals((store.lead_evidence ?? []).length, 0);
});

// ------------------------------------------------------ signal_events ---------

const baseEvent = {
  workspace_id: WS, origin: "lead_mission", account_id: ACCOUNT,
  signal_type: "sales_hiring", signal_category: "gtm",
  evidence_category: "job_signal", occurred_at: "2026-07-01T00:00:00.000Z",
  occurred_at_basis: "source_reported", dedupe_key: "ev1",
  verification_status: "provider_verified", confidence: "high", listing_status: "active",
  freshness: "strong", lifecycle_status: "active",
};

Deno.test("signal_events: valid sales/revops/growth events write", async () => {
  const { admin, store } = makeAdmin();
  for (const t of ["sales_hiring", "revops_hiring", "growth_hiring"]) {
    const r = await writeSignalEventV2({ admin, enabled: true }, { ...baseEvent, signal_type: t, dedupe_key: `ev-${t}` } as any);
    assertEquals(r.written, true, `${t} must write`);
  }
  assertEquals(store.signal_events.length, 3);
});

Deno.test("signal_events: a write with no origin is refused", async () => {
  const { admin, store } = makeAdmin();
  const { origin: _dropped, ...noOrigin } = baseEvent;
  const r = await writeSignalEventV2({ admin, enabled: true }, noOrigin as any);
  assertEquals(r.error_class, "validation_failed");
  assertEquals((store.signal_events ?? []).length, 0, "an unattributable row must not reach the store");
});

Deno.test("signal_events: an origin outside the vocabulary is refused", async () => {
  const { admin, store } = makeAdmin();
  for (const bad of ["radar", "lead-mission", "LEAD_MISSION", "", "monitor"]) {
    const r = await writeSignalEventV2({ admin, enabled: true }, { ...baseEvent, origin: bad } as any);
    assertEquals(r.error_class, "validation_failed", `${bad} must not be accepted`);
  }
  assertEquals((store.signal_events ?? []).length, 0);
});

Deno.test("signal_events: the stored row carries the origin it was given", async () => {
  const { admin, store } = makeAdmin();
  // Every origin must survive the write unchanged — a row that silently became
  // lead_mission would be the exact misattribution this column exists to stop.
  let i = 0;
  for (const o of SIGNAL_ORIGINS) {
    const r = await writeSignalEventV2({ admin, enabled: true }, { ...baseEvent, origin: o, dedupe_key: `ev-o-${o}` } as any);
    assertEquals(r.written, true, `${o} must write`);
    assertEquals(store.signal_events[i].origin, o);
    i++;
  }
  assertEquals(store.signal_events.length, SIGNAL_ORIGINS.length);
});

Deno.test("signal_events: a market event writes with a subject and NO lead entity", async () => {
  const { admin, store } = makeAdmin();
  // The capability this whole change exists for. Competitor evidence is about a
  // competitor; there is no prospect to hang it on, and inventing one would
  // file competitor news under a company it says nothing about.
  const r = await writeSignalEventV2({ admin, enabled: true }, {
    workspace_id: WS, origin: "competitor_monitor",
    signal_type: "competitor_activity", signal_category: "market",
    subject_type: "competitor", subject_key: "outreach",
    occurred_at: null, occurred_at_basis: "unknown",
    dedupe_key: "comp-outreach-1", verification_status: "unverified",
  } as any);
  assertEquals(r.written, true);
  assertEquals(store.signal_events.length, 1);
  const row = store.signal_events[0];
  assertEquals(row.account_id, null);
  assertEquals(row.contact_id, null);
  assertEquals(row.lead_candidate_id, null);
  assertEquals(row.subject_type, "competitor");
  assertEquals(row.subject_key, "outreach");
  assertEquals(row.occurred_at, null);
  assertEquals(row.occurred_at_basis, "unknown");
});

Deno.test("signal_events: neither entity nor subject is still refused", async () => {
  const { admin, store } = makeAdmin();
  const r = await writeSignalEventV2({ admin, enabled: true }, {
    ...baseEvent, account_id: null, subject_type: null, subject_key: null,
  } as any);
  assertEquals(r.error_class, "missing_entity");
  assertEquals((store.signal_events ?? []).length, 0);
});

Deno.test("signal_events: half a subject is refused, in both directions", async () => {
  const { admin, store } = makeAdmin();
  const typeOnly = await writeSignalEventV2({ admin, enabled: true }, {
    ...baseEvent, account_id: null, subject_type: "competitor",
  } as any);
  assertEquals(typeOnly.error_class, "validation_failed");
  const keyOnly = await writeSignalEventV2({ admin, enabled: true }, {
    ...baseEvent, account_id: null, subject_key: "outreach",
  } as any);
  assertEquals(keyOnly.error_class, "validation_failed");
  assertEquals((store.signal_events ?? []).length, 0);
});

Deno.test("signal_events: a non-canonical subject_key is refused", async () => {
  const { admin, store } = makeAdmin();
  // Uncanonical keys are how one subject becomes three across scans.
  for (const bad of ["Outreach", "outreach.io", " outreach", "outreach-", "out reach", ""]) {
    const r = await writeSignalEventV2({ admin, enabled: true }, {
      ...baseEvent, account_id: null, subject_type: "competitor", subject_key: bad,
    } as any);
    assertEquals(r.error_class, "validation_failed", `${JSON.stringify(bad)} must be refused`);
  }
  const badType = await writeSignalEventV2({ admin, enabled: true }, {
    ...baseEvent, account_id: null, subject_type: "vendor", subject_key: "outreach",
  } as any);
  assertEquals(badType.error_class, "validation_failed");
  assertEquals((store.signal_events ?? []).length, 0);
});

Deno.test("signal_events: an unknown occurred_at may not carry a timestamp", async () => {
  const { admin, store } = makeAdmin();
  // The whole point: there must be no way to write the scan time into a column
  // that means "when the source event happened".
  const invented = await writeSignalEventV2({ admin, enabled: true }, {
    ...baseEvent, occurred_at_basis: "unknown", occurred_at: "2026-08-24T00:00:00.000Z",
  } as any);
  assertEquals(invented.error_class, "validation_failed");

  const missingWhenClaimed = await writeSignalEventV2({ admin, enabled: true }, {
    ...baseEvent, occurred_at_basis: "source_reported", occurred_at: null,
  } as any);
  assertEquals(missingWhenClaimed.error_class, "validation_failed");

  for (const bad of ["scan_time", "estimated", "", null, undefined]) {
    const r = await writeSignalEventV2({ admin, enabled: true }, {
      ...baseEvent, occurred_at_basis: bad,
    } as any);
    assertEquals(r.error_class, "validation_failed", `basis ${JSON.stringify(bad)} must be refused`);
  }
  assertEquals((store.signal_events ?? []).length, 0);
});

Deno.test("signal_events: subject events dedupe on the same key, idempotently", async () => {
  const { admin, store } = makeAdmin();
  const ev = {
    workspace_id: WS, origin: "manual_scan" as const,
    signal_type: "market_problem_discussion", signal_category: "market",
    subject_type: "market", subject_key: "sdr-outreach-tooling",
    occurred_at: null, occurred_at_basis: "unknown" as const,
    dedupe_key: "mkt-sdr-1",
  };
  const first = await writeSignalEventV2({ admin, enabled: true }, ev as any);
  assertEquals(first.written, true);
  const again = await writeSignalEventV2({ admin, enabled: true }, ev as any);
  assertEquals(again.deduplicated, true);
  const third = await writeSignalEventV2({ admin, enabled: true }, { ...ev, confidence: "high" } as any);
  assertEquals(third.deduplicated, true);
  assertEquals(store.signal_events.length, 1, "one subject, one row, however many scans");
});

Deno.test("signal_events: missing/invalid occurred_at skips", async () => {
  const { admin } = makeAdmin();
  const missing = await writeSignalEventV2({ admin, enabled: true }, { ...baseEvent, occurred_at: "" } as any);
  assertEquals(missing.error_class, "validation_failed");
  const invalid = await writeSignalEventV2({ admin, enabled: true }, { ...baseEvent, occurred_at: "not-a-date" } as any);
  assertEquals(invalid.error_class, "validation_failed");
});

Deno.test("signal_events: ungrounded (no entity) skips as missing_entity", async () => {
  const { admin } = makeAdmin();
  const r = await writeSignalEventV2({ admin, enabled: true }, { ...baseEvent, account_id: null } as any);
  assertEquals(r.error_class, "missing_entity");
});

Deno.test("signal_events: dedup keeps the original row untouched (occurred_at preserved)", async () => {
  const { admin, store } = makeAdmin();
  await writeSignalEventV2({ admin, enabled: true }, baseEvent as any);
  const firstOccurred = store.signal_events[0].occurred_at;
  // A second observation with a DIFFERENT observed_at but the same dedupe_key.
  const r = await writeSignalEventV2({ admin, enabled: true }, { ...baseEvent, observed_at: "2030-01-01T00:00:00.000Z" } as any);
  assertEquals(r.deduplicated, true);
  assertEquals(store.signal_events.length, 1);
  assertEquals(store.signal_events[0].occurred_at, firstOccurred, "occurred_at must never be refreshed on re-observation");
});

Deno.test("signal_events: database rejection is sanitized (no raw payload leaks)", async () => {
  const { admin } = makeAdmin({ failTables: ["signal_events"] });
  const obs = newSignalsV2Observability(true);
  const r = await writeSignalEventV2({ admin, enabled: true, obs }, baseEvent as any);
  assertEquals(r.attempted, true);
  assertEquals(r.written, false);
  assertEquals(r.error_class, "database_rejected");
  assert(!/42P01|boom/.test(r.reason ?? ""), "sanitized reason must not echo the raw db error");
  assertEquals(obs.signal_events.failed, 1);
  assert(signalsV2ObservabilityReconciles(obs));
});

// ------------------------------------------------ signal_event_evidence -------

const parentId = "55555555-5555-4555-8555-555555555555";

Deno.test("signal_event_evidence: workspace mismatch with parent is rejected", async () => {
  const { admin } = makeAdmin();
  const r = await writeSignalEventEvidenceV2({ admin, enabled: true }, {
    workspace_id: WS, signal_event_id: parentId, parent_workspace_id: WS2,
    evidence_fingerprint: "fp1", source_url: "https://x.com/j/1",
  });
  assertEquals(r.error_class, "workspace_mismatch");
});

Deno.test("signal_event_evidence: needs a source, dedups on fingerprint, distinct providers add rows", async () => {
  const { admin, store } = makeAdmin();
  const ungrounded = await writeSignalEventEvidenceV2({ admin, enabled: true }, {
    workspace_id: WS, signal_event_id: parentId, parent_workspace_id: WS, evidence_fingerprint: "fp",
  });
  assertEquals(ungrounded.error_class, "validation_failed");

  const base = {
    workspace_id: WS, signal_event_id: parentId, parent_workspace_id: WS,
    source_url: "https://x.com/j/1", provider: "apify",
  };
  const a1 = await writeSignalEventEvidenceV2({ admin, enabled: true }, { ...base, evidence_fingerprint: "apify|k|x.com/j/1" });
  assertEquals(a1.written, true);
  const a2 = await writeSignalEventEvidenceV2({ admin, enabled: true }, { ...base, evidence_fingerprint: "apify|k|x.com/j/1" });
  assertEquals(a2.deduplicated, true);
  const b1 = await writeSignalEventEvidenceV2({ admin, enabled: true }, { ...base, provider: "firecrawl", evidence_fingerprint: "firecrawl|k|x.com/j/1" });
  assertEquals(b1.written, true, "a different provider fingerprint is a separate observation");
  assertEquals(store.signal_event_evidence.length, 2);
});

Deno.test("signal_event_evidence: legacy_signal_id may be null", async () => {
  const { admin, store } = makeAdmin();
  const r = await writeSignalEventEvidenceV2({ admin, enabled: true }, {
    workspace_id: WS, signal_event_id: parentId, parent_workspace_id: WS,
    evidence_fingerprint: "fpX", source_record_id: "job-123", legacy_signal_id: null,
  });
  assertEquals(r.written, true);
  assertEquals(store.signal_event_evidence[0].legacy_signal_id, null);
});

// ------------------------------------------------------ engagement ------------

Deno.test("engagement_events: valid write requires known channel + type + occurred_at", async () => {
  const { admin } = makeAdmin();
  const ok = await writeEngagementEventV2({ admin, enabled: true }, {
    workspace_id: WS, contact_id: CONTACT, channel: "linkedin", event_type: "linkedin_post_comment",
    occurred_at: "2026-07-01T00:00:00.000Z", dedupe_key: "eng1",
  });
  assertEquals(ok.written, true);
  const badType = await writeEngagementEventV2({ admin, enabled: true }, {
    workspace_id: WS, contact_id: CONTACT, channel: "linkedin", event_type: "nope",
    occurred_at: "2026-07-01T00:00:00.000Z", dedupe_key: "eng2",
  });
  assertEquals(badType.error_class, "validation_failed");
});
