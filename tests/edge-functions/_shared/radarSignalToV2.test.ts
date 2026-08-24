// Fixtures are the FIVE ROWS Radar actually persisted on 2026-08-24, copied from
// `public.signals` rather than invented. A mapper proven against imagined input
// is how a dual-write ships that writes nothing.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  confidenceBand, mapRadarSignalToV2, occurredAtFrom, radarDedupeKey,
  resolveCompetitorKey, type RadarLegacyRow,
} from "../../../supabase/functions/_shared/radarSignalToV2.ts";
import { writeSignalEventV2 } from "../../../supabase/functions/_shared/signalsV2Writer.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const OBSERVED = "2026-08-24T08:40:39.351Z";

const competitorRow: RadarLegacyRow = {
  id: "ac3b2d0d-7c59-48d3-adf3-de017497ab8c",
  workspace_id: WS, signal_type: "competitor", source: "firecrawl_search",
  title: "Outreach February 2026 Product Release: AI That Executes",
  source_url: "https://www.outreach.ai/resources/blog/february-2026-product",
  confidence: 0.43,
  raw: {
    matched_tools_or_competitors: ["Outreach", "Unify"],
    matched_triggers: [], signal_quality: "needs_verification",
    scan_run_id: "edd3a217-0000-4000-8000-000000000000",
    source_details: { company: null, posted_at: null },
  },
};

const intentRow: RadarLegacyRow = {
  id: "94d6fd26-b4c4-4284-a355-77648d423f65",
  workspace_id: WS, signal_type: "linkedin_intent", source: "firecrawl_search",
  title: "Founder Time Wasters in Outreach | Julian Musson posted on ...",
  source_url: "https://www.linkedin.com/posts/julianmusson_b2bsales-founder",
  confidence: 0.44,
  raw: {
    matched_tools_or_competitors: ["Outreach"], matched_triggers: ["SDR"],
    signal_quality: "needs_verification",
    scan_run_id: "edd3a217-0000-4000-8000-000000000000",
    source_details: { company: null, posted_at: null },
  },
};

function ok(r: ReturnType<typeof mapRadarSignalToV2>) {
  assert(r.ok, `expected a mapping, got ${r.ok ? "" : r.reason}`);
  return r.input;
}

Deno.test("radar→v2: a real competitor row becomes market evidence about the competitor", () => {
  const input = ok(mapRadarSignalToV2(competitorRow, "competitor_monitor", OBSERVED));
  assertEquals(input.signal_type, "competitor_activity");
  assertEquals(input.signal_category, "market");
  assertEquals(input.subject_type, "competitor");
  // Two competitors matched; the page is on outreach.ai, so the host decides.
  assertEquals(input.subject_key, "outreach");
  assertEquals(input.origin, "competitor_monitor");
  assertEquals(input.legacy_signal_id, competitorRow.id);
  // No lead identity is invented.
  assertEquals(input.contact_id, undefined);
  assertEquals(input.account_id, undefined);
  assertEquals(input.lead_candidate_id, undefined);
  // Radar did not classify WHAT the competitor did.
  assert(!["product_launch", "major_release"].includes(input.signal_type));
});

Deno.test("radar→v2: a real intent row becomes market-problem evidence, not a prospect claim", () => {
  const input = ok(mapRadarSignalToV2(intentRow, "manual_scan", OBSERVED));
  assertEquals(input.signal_type, "market_problem_discussion");
  assertEquals(input.signal_category, "market");
  assertEquals(input.subject_type, "market");
  assertEquals(input.subject_key, "buyer-intent");
  assertEquals(input.origin, "manual_scan");
  assertEquals(input.evidence_category, null, "market context must never satisfy an evidence gate");
});

Deno.test("radar→v2: no source time is recorded as unknown, never as the scan time", () => {
  for (const row of [competitorRow, intentRow]) {
    const input = ok(mapRadarSignalToV2(row, "manual_scan", OBSERVED));
    assertEquals(input.occurred_at, null);
    assertEquals(input.occurred_at_basis, "unknown");
    assertEquals(input.freshness, null, "nothing to decay from");
    assert(JSON.stringify(input).indexOf(OBSERVED) === JSON.stringify(input).lastIndexOf(OBSERVED),
      "the scan time must appear only as observed_at");
  }
  // And when the source DOES report one, it is used.
  const dated = { ...intentRow, raw: { ...intentRow.raw, source_details: { posted_at: "2026-07-02T10:00:00Z" } } };
  const input = ok(mapRadarSignalToV2(dated, "manual_scan", OBSERVED));
  assertEquals(input.occurred_at, "2026-07-02T10:00:00.000Z");
  assertEquals(input.occurred_at_basis, "source_reported");
  // An unparseable date is unknown, not a guess.
  assertEquals(occurredAtFrom({ source_details: { posted_at: "last tuesday" } }).occurred_at_basis, "unknown");
});

Deno.test("radar→v2: an unresolvable competitor is refused, not attributed to the first match", () => {
  const ambiguous: RadarLegacyRow = {
    ...competitorRow, source_url: "https://techcrunch.com/2026/08/sales-tools",
    raw: { ...competitorRow.raw, matched_tools_or_competitors: ["Outreach", "Unify"] },
  };
  const r = mapRadarSignalToV2(ambiguous, "competitor_monitor", OBSERVED);
  assertEquals(r.ok, false);
  assert(!r.ok && r.reason === "subject_unresolved");
  // One candidate and no host agreement is still unambiguous.
  const single = { ...ambiguous, raw: { ...ambiguous.raw, matched_tools_or_competitors: ["Unify"] } };
  assertEquals(ok(mapRadarSignalToV2(single, "competitor_monitor", OBSERVED)).subject_key, "unify");
  assertEquals(resolveCompetitorKey([], null), null);
});

Deno.test("radar→v2: company-bound Radar types are refused with a stated reason", () => {
  // Refusing is the honest answer: Radar resolves neither the company's identity
  // nor, for hiring, which role family the posting belongs to.
  for (const t of ["hiring", "funding", "manual"]) {
    const r = mapRadarSignalToV2({ ...competitorRow, signal_type: t }, "manual_scan", OBSERVED);
    assertEquals(r.ok, false, `${t} must not be mapped`);
    assert(!r.ok && r.reason === "unsupported_signal_type");
  }
});

Deno.test("radar→v2: the dedupe key is stable per subject+evidence", () => {
  const a = radarDedupeKey("competitor", "outreach", competitorRow);
  assertEquals(a, radarDedupeKey("competitor", "outreach", { ...competitorRow, confidence: 0.9 }));
  assert(a !== radarDedupeKey("competitor", "outreach", { ...competitorRow, source_url: "https://outreach.io/x" }));
  assert(a !== radarDedupeKey("market", "buyer-intent", competitorRow));
  // A row with no URL still gets a key rather than colliding with every other.
  const noUrl = radarDedupeKey("market", "buyer-intent", { ...intentRow, source_url: null });
  assert(noUrl.length > "radar|market:buyer-intent|".length);
});

Deno.test("radar→v2: confidence is banded, and a missing score stays missing", () => {
  assertEquals(confidenceBand(0.9), "high");
  assertEquals(confidenceBand(0.45), "medium");
  // Radar's real scores sit at 0.38-0.45. Most band LOW, and that is the honest
  // reading of a web-search hit — the thresholds are not moved to flatter it.
  assertEquals(confidenceBand(0.43), "low");
  assertEquals(confidenceBand(0.2), "low");
  // Number("") is 0 — an absent score must not band as "low".
  for (const v of [null, undefined, "", "abc", NaN]) assertEquals(confidenceBand(v as any), null);
});

// ───────────────────────────────────────────── the mapping actually writes ──

function fakeAdmin() {
  const store: Record<string, any[]> = {};
  return {
    store,
    admin: {
      from(table: string) {
        store[table] ??= [];
        return {
          upsert(row: any, _o: any) {
            return {
              select: (_c: string) => {
                const existing = store[table].find((r) =>
                  r.workspace_id === row.workspace_id && r.dedupe_key === row.dedupe_key);
                if (existing) return Promise.resolve({ data: [], error: null });
                const id = crypto.randomUUID();
                store[table].push({ ...row, id });
                return Promise.resolve({ data: [{ id }], error: null });
              },
            };
          },
          select(_c: string) {
            const chain: any = {
              eq() { return chain; },
              maybeSingle() {
                const hit = store[table][0];
                return Promise.resolve({ data: hit ? { id: hit.id } : null, error: null });
              },
            };
            return chain;
          },
        };
      },
    } as any,
  };
}

Deno.test("radar→v2: the mapped rows are ACCEPTED by the writer, with no lead identity", async () => {
  const { admin, store } = fakeAdmin();
  for (const row of [competitorRow, intentRow]) {
    const input = ok(mapRadarSignalToV2(row, "manual_scan", OBSERVED));
    const res = await writeSignalEventV2({ admin, enabled: true }, input);
    assertEquals(res.written, true, `${row.signal_type} must write: ${res.error_class ?? ""} ${res.detail ?? ""}`);
  }
  assertEquals(store.signal_events.length, 2);
  for (const r of store.signal_events) {
    assertEquals(r.account_id, null);
    assertEquals(r.contact_id, null);
    assertEquals(r.lead_candidate_id, null);
    assert(r.subject_type && r.subject_key, "every market row names its subject");
    assertEquals(r.origin, "manual_scan");
    assertEquals(r.occurred_at, null);
    assertEquals(r.occurred_at_basis, "unknown");
  }
});

Deno.test("radar→v2: re-scanning the same evidence does not duplicate it", async () => {
  const { admin, store } = fakeAdmin();
  const input = ok(mapRadarSignalToV2(competitorRow, "competitor_monitor", OBSERVED));
  const first = await writeSignalEventV2({ admin, enabled: true }, input);
  assertEquals(first.written, true);
  for (let i = 0; i < 3; i++) {
    const again = await writeSignalEventV2({ admin, enabled: true },
      ok(mapRadarSignalToV2(competitorRow, "competitor_monitor", "2026-09-01T00:00:00.000Z")));
    assertEquals(again.deduplicated, true, "a later scan of the same page is the same event");
  }
  assertEquals(store.signal_events.length, 1);
});
