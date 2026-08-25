// PHASE 8 — ONE FACT, ONE EVENT, WHICHEVER SURFACE FOUND IT.
//
// ── TWO PLAN PREMISES THAT WERE NOT TRUE ────────────────────────────────────
//
// "Lead → Signals already works via `memoryWriter`." It does not. The writer
// has a `lead_mission` dual-write and it is unreachable: Phase 3F gave the
// legacy writer a guard — an engine that owns persistence publishes its own
// rows — and a LeadMissionV1 run spends under `capability_engine`, so the
// writer returns before the dispatch that would reach it. The store proved it:
// thirteen events, none of them `lead_mission`.
//
// And the dedupe key was namespaced by the SURFACE that wrote it — `radar|…`,
// `monitor|…` — so the same fact found twice produced two events. That prefix
// is routing logic inside an identity, and it is what these tests remove.
//
// PURE. No network, provider, model or database access.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  projectCanonicalEvents, canonicalDedupeKey, validSourceDate,
  CANONICAL_TYPE_FOR,
} from "../../../supabase/functions/_shared/canonicalSignalEvent.ts";
import { clusterSignalEvents } from "../../../supabase/functions/_shared/signalCluster.ts";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const hiring = {
  signal: "hiring/company", verdict: "verified",
  evidence_ids: ["job_posting:x"], occurred_at: daysAgo(5),
};

const forOrigin = (origin: string) =>
  projectCanonicalEvents({
    workspace_id: "w",
    origin,
    subject: { subject_type: "company", subject_key: "acme-com" },
    company_name: "Acme",
    assessments: [hiring],
  }, NOW);

// ── 1. ONE FACT, ONE IDENTITY ───────────────────────────────────────────────

Deno.test("1. the dedupe key is the QUESTION, not the asker", () => {
  const lead = forOrigin("lead_mission")[0];
  const monitor = forOrigin("scheduled_monitor")[0];

  assertEquals(
    lead.dedupe_key, monitor.dedupe_key,
    "the same fact found twice must be one event, not two",
  );
  assertEquals(lead.dedupe_key, "company|acme-com|sales_hiring");
  // NO SURFACE PREFIX ANYWHERE IN IT. This is the defect that made
  // cross-surface dedupe impossible by construction.
  for (const surface of ["monitor", "radar", "lead", "scheduled", "mission"]) {
    assertFalse(
      lead.dedupe_key.includes(surface),
      `the key carries the surface "${surface}"`,
    );
  }
});

Deno.test("2. origin is provenance — it reaches the row and never the identity", () => {
  const lead = forOrigin("lead_mission")[0];
  const monitor = forOrigin("scheduled_monitor")[0];
  assertEquals(lead.origin, "lead_mission");
  assertEquals(monitor.origin, "scheduled_monitor");
  // And it is readable in the payload, so a reader can still tell who found it.
  assertEquals((lead.normalized_value as Record<string, unknown>).found_by, "lead_mission");

  // EVERYTHING ELSE IS IDENTICAL. Same subject, same type, same date, same key.
  for (const f of [
    "signal_type", "signal_category", "subject_type", "subject_key",
    "occurred_at", "occurred_at_basis", "dedupe_key",
  ] as const) {
    assertEquals(lead[f], monitor[f], `${f} differs by origin`);
  }
});

Deno.test("3. the projection branches on nothing about the origin", async () => {
  // The rule the user set: no `if (origin === …) copy to X`. Checked against
  // the module's own source, because a single such branch would reintroduce
  // every problem this phase exists to remove.
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/canonicalSignalEvent.ts", import.meta.url));
  assertFalse(
    /origin\s*===|origin\s*==|origin\s*!==/.test(SRC),
    "the projection branches on origin",
  );
  assertFalse(
    /scheduled_monitor|lead_mission|manual_scan/.test(SRC),
    "the projection names a specific origin",
  );
});

// ── 4. CORRELATION AND RELEVANCE ARE ORIGIN-BLIND ───────────────────────────

Deno.test("4. a Lead event and a monitor event about one company form ONE cluster", () => {
  const { clusters } = clusterSignalEvents([
    {
      id: "e-lead", workspace_id: "w", signal_type: "sales_hiring",
      signal_category: "gtm", origin: "lead_mission",
      subject_type: "company", subject_key: "acme-com", account_id: null,
      occurred_at: daysAgo(5), occurred_at_basis: "source_reported",
      observed_at: daysAgo(1), lifecycle_status: "active",
    },
    {
      id: "e-monitor", workspace_id: "w", signal_type: "recent_funding",
      signal_category: "growth", origin: "scheduled_monitor",
      subject_type: "company", subject_key: "acme-com", account_id: null,
      occurred_at: daysAgo(3), occurred_at_basis: "source_reported",
      observed_at: daysAgo(1), lifecycle_status: "active",
    },
  ], { now: NOW });

  assertEquals(clusters.length, 1, "two origins, one company, one situation");
  assertEquals(clusters[0].origins, { lead_mission: 1, scheduled_monitor: 1 });
  assertEquals(clusters[0].signal_types, ["recent_funding", "sales_hiring"]);
  // AND IT IS ELIGIBLE FOR RELEVANCE like any other cluster: it has ids to
  // cite and a dated event to be timely on.
  assert(clusters[0].events.every((e) => !!e.id));
  assertEquals(clusters[0].timing.occurred, 2);
});

// ── 5. WHAT THE PROJECTION REFUSES ──────────────────────────────────────────

Deno.test("5. an unevidenced verdict and an unmapped signal produce nothing", () => {
  const unevidenced = projectCanonicalEvents({
    workspace_id: "w", origin: "lead_mission",
    subject: { subject_type: "company", subject_key: "acme-com" },
    assessments: [{ ...hiring, verdict: "absent" }, { ...hiring, verdict: "not_investigated" }],
  }, NOW);
  assertEquals(unevidenced, []);

  // A signal with no canonical type is NOT mapped to an approximation.
  const unmapped = projectCanonicalEvents({
    workspace_id: "w", origin: "lead_mission",
    subject: { subject_type: "company", subject_key: "acme-com" },
    assessments: [{ signal: "technology/company", verdict: "verified", evidence_ids: ["e"] }],
  }, NOW);
  assertEquals(unmapped, []);
  assertFalse("technology" in CANONICAL_TYPE_FOR);
});

Deno.test("6. no subject key, no event — a name is never a subject", () => {
  assertEquals(
    projectCanonicalEvents({
      workspace_id: "w", origin: "lead_mission",
      subject: { subject_type: "company", subject_key: "" },
      assessments: [hiring],
    }, NOW),
    [],
  );
});

Deno.test("7. the source's date travels, and a future one is refused", () => {
  assertEquals(forOrigin("lead_mission")[0].occurred_at_basis, "source_reported");
  assertEquals(validSourceDate(new Date(NOW + 5 * 86_400_000).toISOString(), NOW), null);

  const undated = projectCanonicalEvents({
    workspace_id: "w", origin: "lead_mission",
    subject: { subject_type: "company", subject_key: "acme-com" },
    assessments: [{ ...hiring, occurred_at: null }],
  }, NOW);
  assertEquals(undated[0].occurred_at, null);
  assertEquals(undated[0].occurred_at_basis, "unknown");
});

// ── 8. WHAT A LEAD EVENT MAY CARRY THAT A MONITOR EVENT MAY NOT ─────────────

Deno.test("8. a Lead event may name its lead candidate; nothing invents one", () => {
  const linked = projectCanonicalEvents({
    workspace_id: "w", origin: "lead_mission",
    subject: {
      subject_type: "company", subject_key: "acme-com",
      account_id: "acct-1", lead_candidate_id: "lc-1",
    },
    assessments: [hiring],
  }, NOW);
  assertEquals(linked[0].account_id, "acct-1");
  assertEquals(linked[0].lead_candidate_id, "lc-1");

  // A monitoring write states NEITHER, explicitly — "this belongs to nobody"
  // rather than "the writer did not mention it".
  const monitored = forOrigin("scheduled_monitor")[0];
  assertEquals(monitored.account_id, null);
  assertEquals(monitored.lead_candidate_id, null);
});

Deno.test("9. the key builder is the only place an identity is formed", () => {
  assertEquals(canonicalDedupeKey("competitor", "vercel", "sales_hiring"),
    "competitor|vercel|sales_hiring");
  // A competitor and a company with the same key are different subjects, so
  // their signals do not collapse into one another.
  assert(
    canonicalDedupeKey("competitor", "acme-com", "sales_hiring") !==
      canonicalDedupeKey("company", "acme-com", "sales_hiring"),
  );
});

// ── 10–15. SIGNALS → LEADS ──────────────────────────────────────────────────

import {
  openInLeads, investigateMissionFields, isSafeIdentifier, SITUATION_ACTIONS,
} from "../../../supabase/functions/_shared/signalsToLeads.ts";
import type { ExistingEvidence } from "../../../supabase/functions/_shared/monitoringPreflight.ts";

function clusterWith(over: Record<string, unknown> = {}, nv: Record<string, unknown> = {}) {
  const { clusters } = clusterSignalEvents([{
    id: "e1", workspace_id: "w", signal_type: "sales_hiring", signal_category: "gtm",
    origin: "scheduled_monitor", subject_type: "competitor",
    subject_key: "linkedin-com-company-vercel", account_id: null,
    occurred_at: daysAgo(5), occurred_at_basis: "source_reported",
    observed_at: daysAgo(1), lifecycle_status: "active",
    normalized_value: { subject_identifier: "https://www.linkedin.com/company/vercel", ...nv },
    ...over,
    // deno-lint-ignore no-explicit-any
  } as any], { now: NOW });
  return clusters[0];
}

Deno.test("10. a situation with a recorded identifier can be opened in Leads", () => {
  const d = openInLeads(clusterWith());
  assert(d.ok, d.reason);
  assertEquals(d.known_company, "https://www.linkedin.com/company/vercel");
  assertEquals(d.identifier_source, "event_payload");

  // AND IT PRODUCES A MISSION THAT NAMES THE COMPANY — the Phase 3 supplied-
  // company path, not a Signals-specific executor.
  const fields = investigateMissionFields(clusterWith(), d);
  assertEquals(fields!.known_companies, ["https://www.linkedin.com/company/vercel"]);
  // The MISSION signal, not the canonical type — the compiler speaks `hiring`.
  assertEquals(fields!.required_signals, ["hiring"]);
  assertEquals(fields!.reused, []);
  assertEquals(fields!.refusal, null);
});

Deno.test("11. a SLUG is never reversed into an identifier", () => {
  // `linkedin-com-company-vercel` looks reversible and is a guess. A wrong
  // guess opens an investigation into a different company and attaches its
  // people to this one.
  const noIdentifier = clusterWith({}, { subject_identifier: null });
  const d = openInLeads(noIdentifier);
  assertFalse(d.ok);
  assertEquals(d.refusal, "no_safe_identifier");
  assertEquals(d.known_company, null);
  // AND IT SAYS SO, rather than failing silently or guessing.
  assert(/slug and reversing one is a guess/.test(d.reason), d.reason);
});

Deno.test("12. a name is not an identifier", () => {
  for (const bad of ["Vercel", "Acme Inc", "", "   ", null, 42, "not a domain"]) {
    assertFalse(isSafeIdentifier(bad), `${JSON.stringify(bad)} was accepted`);
  }
  for (const good of ["acme.com", "https://www.linkedin.com/company/vercel", "sub.acme.co.uk"]) {
    assert(isSafeIdentifier(good), `${good} was refused`);
  }
  // A cluster whose only identifier is a NAME is refused.
  assertFalse(openInLeads(clusterWith({}, { subject_identifier: "Vercel" })).ok);
});

Deno.test("13. a market theme is refused honestly — there is no company", () => {
  const market = clusterWith({
    subject_type: "market", subject_key: "buyer-intent",
    signal_type: "market_problem_discussion", signal_category: "market",
  });
  const d = openInLeads(market);
  assertFalse(d.ok);
  assertEquals(d.refusal, "not_a_company_subject");
  assertEquals(investigateMissionFields(market, d), null);
});

Deno.test("14. a known account needs no identifier at all", () => {
  const d = openInLeads(clusterWith({ account_id: "acct-9" }));
  assert(d.ok);
  assertEquals(d.identifier_source, "account");
  assertEquals(d.account_id, "acct-9");
});

Deno.test("15. decision-maker work is its OWN action, never bundled", () => {
  // A signal being strong is not a decision to buy contacts. The person path is
  // unlock-gated, and investigating a company must not smuggle it in.
  assertEquals([...SITUATION_ACTIONS].sort(),
    ["find_decision_makers", "investigate_company", "track_company"]);

  const fields = investigateMissionFields(clusterWith(), openInLeads(clusterWith()))!;
  // The mission an "investigate" action produces asks for COMPANY signals only.
  assertFalse(
    JSON.stringify(fields).includes("decision_maker") ||
      JSON.stringify(fields).includes("contact") ||
      JSON.stringify(fields).includes("founder"),
    `investigate smuggled in person work: ${JSON.stringify(fields)}`,
  );
  assertEquals(Object.keys(fields).sort(),
    ["known_companies", "refusal", "required_signals", "reused"]);
});

Deno.test("16. deciding costs nothing — the module buys and writes nothing", async () => {
  // Opening a Signals situation must not create Lead rows or spend credits.
  // Checked against the module's own source: it has no client, no writer and
  // no provider.
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/signalsToLeads.ts", import.meta.url));
  for (const forbidden of [
    "createClient", "runTool", "supabase", "insert(", "upsert(",
    "lead_candidates", "credits_reserve", "gptStructured", "fetch(",
  ]) {
    assertFalse(SRC.includes(forbidden), `signalsToLeads reaches for ${forbidden}`);
  }
});

// ── 17-19. REUSE: DO NOT BUY WHAT IS ALREADY KNOWN ──────────────────────────

const heldHiring = (over: Partial<ExistingEvidence> = {}): ExistingEvidence => ({
  signal_type: "sales_hiring",
  occurred_at: daysAgo(3),
  occurred_at_basis: "source_reported",
  observed_at: daysAgo(1),
  origin: "scheduled_monitor",
  subject_type: "competitor",
  subject_key: "linkedin-com-company-vercel",
  lifecycle_status: "active",
  ...over,
});

Deno.test("17. fresh shared evidence prevents a duplicate purchase", () => {
  const c = clusterWith();
  const f = investigateMissionFields(c, openInLeads(c), [heldHiring()], NOW, 30)!;
  assertEquals(f.required_signals, [], "the mission must not re-ask a proved question");
  assertEquals(f.reused.length, 1);
  assertEquals(f.reused[0].signal, "hiring");
  // ORIGIN IS REPORTED, NEVER USED AS A FILTER — a monitor's evidence is reused
  // by a Lead mission exactly as a Lead's would be by a monitor.
  assertEquals(f.reused[0].origin, "scheduled_monitor");
  // NOTHING LEFT TO ASK IS NOT A MISSION.
  assertEquals(f.refusal, "everything_already_known");
});

Deno.test("18. stale or undated evidence still allows a new investigation", () => {
  const c = clusterWith();

  const stale = investigateMissionFields(
    c, openInLeads(c), [heldHiring({ occurred_at: daysAgo(200) })], NOW, 30)!;
  assertEquals(stale.required_signals, ["hiring"]);
  assertEquals(stale.reused, []);
  assertEquals(stale.refusal, null);

  // UNDATED cannot be shown to fall inside any window, so it proves no recency
  // and must not suppress the purchase.
  const undated = investigateMissionFields(
    c, openInLeads(c),
    [heldHiring({ occurred_at: null, occurred_at_basis: "unknown" })], NOW, 30)!;
  assertEquals(undated.required_signals, ["hiring"]);
});

Deno.test("19. evidence about a DIFFERENT company never suppresses this one", () => {
  const c = clusterWith();
  const f = investigateMissionFields(
    c, openInLeads(c), [heldHiring({ subject_key: "someone-else" })], NOW, 30)!;
  assertEquals(f.required_signals, ["hiring"]);
  assertEquals(f.reused, []);
});
