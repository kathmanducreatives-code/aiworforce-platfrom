// LISA V2 — engine tests over recorded, fictional fixtures. No network, no database.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brainFrom, loadFixture, memoryStore, replay } from "./lisaFixtures.ts";
import { collectorFor, EXTENSION_CATEGORIES, EXTENSION_POINTS, planQueries } from "../../../../supabase/functions/_shared/lisa/collectors.ts";
import { extract } from "../../../../supabase/functions/_shared/lisa/extract.ts";
import { dedupeKeyFor, eventInstance, isStale, verify } from "../../../../supabase/functions/_shared/lisa/verify.ts";
import { evaluateRelevance, geographyMatch } from "../../../../supabase/functions/_shared/lisa/relevance.ts";
import { effectiveWatchlist, scheduledRunKey, watchKey } from "../../../../supabase/functions/_shared/lisa/orchestrator.ts";
import { recordArgs, originFor } from "../../../../supabase/functions/_shared/lisa/persistence.ts";
import { isElevatable, toAgentSignal, weeklyDigest, type StoredSignalRow } from "../../../../supabase/functions/_shared/lisa/weekly.ts";
import { firecrawlSource } from "../../../../supabase/functions/_shared/lisa/providers.ts";
import type { LisaSignal, Observation, WatchSubject } from "../../../../supabase/functions/_shared/lisa/types.ts";

const events = (s: unknown) => [...(s as { events: Map<string, LisaSignal> }).events.values()];

// ── Phase 2: collection / extraction / evidence / dedupe / verification ──

Deno.test("funding: two independent outlets → one corroborated recent_funding event keyed by the round", async () => {
  const r = await replay(loadFixture("funding"));
  assertEquals(r.status, "ok");
  const [e] = events(r.store);
  assertEquals(r.counts.events, 1);
  assertEquals(e.signal_type, "recent_funding");
  assertEquals(e.event_instance, "series-b");
  assertEquals(e.verification.level, "corroborated");
  assertEquals(e.verification.column_status, "provider_verified");
  assertEquals(e.verification.independent_sources, 2);
  assertEquals(e.evidence.length, 2);
  assert(e.evidence.every((x) => /^https:\/\//.test(x.url)), "every evidence row carries its real source URL");
});

Deno.test("second round: Series B and Series C are two events, not a duplicate", async () => {
  const r = await replay(loadFixture("second_round"));
  const inst = events(r.store).map((e) => e.event_instance).sort();
  assertEquals(inst, ["series-b", "series-c"]);
  assertNotEquals(events(r.store)[0].dedupe_key, events(r.store)[1].dedupe_key);
});

Deno.test("duplicate: one announcement on three sites → one event, three evidence rows, self + independent", async () => {
  const r = await replay(loadFixture("duplicate"));
  const all = events(r.store);
  assertEquals(all.length, 1);
  assertEquals(all[0].evidence.length, 3);
  assertEquals(all[0].verification.level, "corroborated");
  assertEquals(all[0].source_type, "company_site", "the company's own announcement is the primary source");
});

Deno.test("dedupe is stable across retries: a re-run of the same pass is all duplicates", async () => {
  const f = loadFixture("duplicate");
  const store = memoryStore();
  await replay(f, { store });
  const again = await replay(f, { store });
  assertEquals(again.counts.new, 0);
  assertEquals(again.counts.duplicate, 1);
  assertEquals(events(store)[0].evidence.length, 3);
});

Deno.test("hiring: a 120-role push is kept, one job ad is dropped below significance", async () => {
  const r = await replay(loadFixture("hiring"));
  assertEquals(r.counts.events, 1);
  assertEquals(r.counts.dropped.below_significance, 1);
  assertEquals(events(r.store)[0].event_instance, "engineering-austin-2026q4");
});

Deno.test("expansion: market watch attributes the plant to the company and counts its own site as self-reported", async () => {
  const r = await replay(loadFixture("expansion"));
  const [e] = events(r.store);
  assertEquals(e.company_name, "Brightforge Robotics");
  assertEquals(e.signal_type, "geographic_expansion");
  assertEquals(e.event_instance, "manufacturing-plant-columbus", "'Columbus, Ohio' and 'Columbus' are one plant");
  assertEquals(e.evidence.length, 3);
  assertEquals(e.verification.independent_sources, 2, "brightforge.example is NOT independent press");
  assertEquals(e.evidence.find((x) => x.domain === "brightforge.example")?.source_type, "company_site");
});

Deno.test("launch: an announcement is kept, a generic product page is not", async () => {
  const r = await replay(loadFixture("launch"));
  assertEquals(r.counts.events, 1);
  assertEquals(r.counts.dropped.generic_page, 1);
  assertEquals(events(r.store)[0].event_instance, "corvane-sense");
});

Deno.test("missing source: no URL / non-http URL → dropped, never a fabricated link", async () => {
  const r = await replay(loadFixture("missing_source"));
  assertEquals(r.counts.events, 0);
  assertEquals(r.counts.dropped.missing_source, 2);
  assertEquals(r.status, "empty");
});

Deno.test("contradictory: amounts disagree → contradicted, never verified, low relevance", async () => {
  const r = await replay(loadFixture("contradictory"));
  const [e] = events(r.store);
  assertEquals(e.verification.level, "contradicted");
  assertEquals(e.lifecycle_status, "contradicted");
  assertEquals(e.verification.column_status, "unverified");
  assert(e.verification.contradictions.some((c) => c.includes("disagree on the amount")));
  assertEquals(e.relevance?.band, "low");
});

Deno.test("stale: a 2024 seed round is dropped as stale", async () => {
  const r = await replay(loadFixture("stale"));
  assertEquals(r.counts.dropped.stale, 1);
  assertEquals(r.counts.events, 0);
  assert(isStale("funding", "2024-02-01", new Date("2026-11-10")));
  assert(!isStale("funding", null, new Date("2026-11-10")), "undated is not stale (but never 'fresh')");
});

Deno.test("retracted: a cancellation report marks the event retracted", async () => {
  const r = await replay(loadFixture("retracted"));
  const [e] = events(r.store);
  assertEquals(e.lifecycle_status, "retracted");
  assert(e.verification.retracted);
});

Deno.test("invalid response / timeout: counted provider errors, no signals, honest partial status", async () => {
  for (const n of ["invalid_response", "timeout"]) {
    const r = await replay(loadFixture(n));
    assertEquals(r.counts.events, 0, n);
    assertEquals(r.counts.provider_errors, 1, n);
    assertEquals(r.status, "partial", n);
    assert(r.errors.some((x) => /invalid_response|timeout/.test(x)), n);
  }
});

Deno.test("budget exhaustion: refused before any query is sent", async () => {
  const r = await replay(loadFixture("budget_exhaustion"));
  assertEquals(r.status, "budget_exhausted");
  assertEquals(r.counts.queries_sent, 0);
  assertEquals(r.counts.credits, 0);
});

Deno.test("failed persistence: the pass is failed, never ok (the legacy defect)", async () => {
  const r = await replay(loadFixture("failed_persistence"));
  assertEquals(r.status, "failed");
  assertEquals(r.counts.persist_failed, 1);
  assertEquals(r.signals.length, 0);
});

Deno.test("a provider that throws is a counted error, not a crash", async () => {
  const f = loadFixture("funding");
  f.responses.funding = "throw";
  const r = await replay(f);
  assertEquals(r.counts.provider_errors, 1);
  assertEquals(r.counts.events, 0);
});

Deno.test("verification never trusts a provider label: one outlet is single_source / unverified", () => {
  const o = { source_domain: "a.example", source_type: "news" as const, negation: null, attributes: {}, category: "funding" as const };
  const v = verify([o]);
  assertEquals(v.level, "single_source");
  assertEquals(v.column_status, "unverified");
  assertEquals(verify([o, { ...o, source_domain: "a.example" }]).level, "single_source", "same publisher twice is not corroboration");
});

Deno.test("event instance: funding without a round keys on amount + month; hiring per quarter", () => {
  const base: Observation = { category: "funding", company_name: "X", company_domain: "x.example", title: "", description: "",
    attributes: { round: null, amount_usd_m: 12 }, event_date: "2026-10-03", source_url: "https://n.example/a", source_domain: "n.example",
    source_type: "news", excerpt: "", negation: null };
  assertEquals(eventInstance(base, "2026-11-10"), "usd-12m-2026-10");
  assertEquals(dedupeKeyFor("competitor", "x-example", "recent_funding", "usd-12m-2026-10"), "competitor|x-example|recent_funding|usd-12m-2026-10");
});

Deno.test("extract: a named subject that the page never mentions is dropped (no_company)", () => {
  const w: WatchSubject = { kind: "competitor", domain: "corvane.example", name: "Corvane Systems", origin: "watchlist", categories: ["funding"], cadence_minutes: 60 };
  const ex = extract({ url: "https://n.example/x", title: "Other Co raises $5 million seed", description: "Other Co raised a seed." }, w, "funding");
  assertEquals(ex.dropped[0]?.reason, "no_company");
});

// ── Phase 3: collectors, orchestration ──

Deno.test("collectors: four categories implemented; six extension points declared and NOT implemented", () => {
  for (const c of ["hiring", "funding", "expansion", "product_launch"]) assert(collectorFor(c), c);
  for (const c of EXTENSION_CATEGORIES) {
    assertEquals(collectorFor(c), null, c);
    assertEquals(EXTENSION_POINTS[c].status, "not_implemented");
  }
  const w: WatchSubject = { kind: "competitor", domain: "corvane.example", name: "Corvane Systems", origin: "watchlist",
    categories: ["funding", "pricing" as never], cadence_minutes: 60 };
  const plan = planQueries(w, { industries: [], geographies: [], year: 2026 });
  assert(plan.every((p) => p.category === "funding"), "an extension category plans no query");
  assert(plan.length <= 2);
});

Deno.test("watchlist: Brain competitors + watchlist + ICP, minus exclusions, deterministic", () => {
  const brain = brainFrom({ competitors: [
    { name: "Corvane Systems", domain: "corvane.example", source: "profile" },
    { name: "Ostrava Metals", domain: "ostrava.example", source: "profile" },
  ] });
  const rows = [{ subject_kind: "tracked_company", identifier: "https://www.halden-tools.example", label: "Halden Tools", signals: [{ event: "funding" }], enabled: true, cadence_minutes: 1440 },
    { subject_kind: "competitor", identifier: "corvane.example", label: "Corvane Systems", signals: [{ event: "product_launch" }], enabled: true, cadence_minutes: null },
    { subject_kind: "tracked_company", identifier: "paused.example", label: "Paused", signals: [], enabled: false, cadence_minutes: null }];
  const { watches, skipped } = effectiveWatchlist(brain, rows);
  const keys = watches.map(watchKey);
  assert(keys.includes("company:halden-tools-example"));
  assert(keys.includes("competitor:corvane-example"));
  assert(keys.includes("market:icp-manufacturing"));
  assertEquals(keys.filter((k) => k === "competitor:corvane-example").length, 1, "merged, not duplicated");
  assert(skipped.some((s) => s.name === "Ostrava Metals" && s.reason.startsWith("excluded")));
  assert(!keys.some((k) => k.includes("paused")));
  assertEquals(effectiveWatchlist(brain, rows).watches.map(watchKey), keys, "deterministic");
  // No Brain: only explicit watchlist rows.
  assertEquals(effectiveWatchlist(null, rows).watches.map(watchKey).sort(), ["company:halden-tools-example", "competitor:corvane-example"]);
});

Deno.test("scheduled run key: two schedulers in one cadence slot compute the same key", () => {
  const w: WatchSubject = { kind: "competitor", domain: "corvane.example", name: "Corvane", origin: "watchlist", categories: ["funding"], cadence_minutes: 60 };
  assertEquals(scheduledRunKey(w, new Date("2026-11-10T12:05:00Z")), scheduledRunKey(w, new Date("2026-11-10T12:55:00Z")));
  assertNotEquals(scheduledRunKey(w, new Date("2026-11-10T12:05:00Z")), scheduledRunKey(w, new Date("2026-11-10T13:05:00Z")));
});

Deno.test("firecrawl adapter: reads data.web, reports non-200 and malformed bodies; never calls without a key", async () => {
  let called = 0;
  const f = (body: unknown, status = 200) => (() => { called++; return Promise.resolve(new Response(JSON.stringify(body), { status })); }) as unknown as typeof fetch;
  assertEquals((await firecrawlSource(undefined, f({})).search("q", { limit: 1 })).error, "not_configured");
  assertEquals(called, 0);
  const ok = await firecrawlSource("k", f({ success: true, data: { web: [{ url: "https://a.example", title: "t" }] }, creditsUsed: 1 })).search("q", { limit: 1 });
  assertEquals(ok.hits.length, 1);
  assertEquals((await firecrawlSource("k", f({}, 502)).search("q", { limit: 1 })).error, "http_502");
  assertEquals((await firecrawlSource("k", f({ data: "x" })).search("q", { limit: 1 })).error, "invalid_response");
});

// ── Phase 4: Company Brain relevance, downstream contract, weekly ──

Deno.test("relevance with a Brain: ICP industry + geography + competitor explain the score", async () => {
  const r = await replay(loadFixture("expansion"));
  const [e] = events(r.store);
  assertEquals(e.relevance?.band, "high");
  assert(e.relevance!.reasons.some((x) => x.startsWith("Matches your target industry")));
  assert(e.relevance!.reasons.some((x) => x.startsWith("In your target geography")));
  assertEquals(e.relevance!.brain_fingerprint, "fp-brain-v1");
  assert(e.relevance!.why_now.startsWith("Announced"));
  assert(/approval required/.test(e.relevance!.suggested_action), "the next step never acts on its own");
});

Deno.test("relevance without a Brain: says so, no ICP points", async () => {
  const r = await replay(loadFixture("expansion"), { brain: null });
  // A market watch needs ICP industries to plan queries at all → nothing is collected without a Brain.
  assertEquals(r.counts.queries_planned, 0);
  const f = await replay(loadFixture("funding"), { brain: null });
  const [e] = events(f.store);
  assert(e.relevance!.reasons.includes("No Company Brain: relevance to your business is not known"));
  assertEquals(e.relevance!.brain_fingerprint, null);
});

Deno.test("excluded competitor: exclusions run first and drop the event", async () => {
  const r = await replay(loadFixture("funding"), { brain: brainFrom({ excludeCompanies: ["Corvane Systems"] }) });
  assertEquals(r.counts.events, 0);
  assertEquals(r.counts.dropped.excluded, 1);
});

Deno.test("geography: US states and regions resolve", () => {
  assertEquals(geographyMatch("Columbus, Ohio", ["United States"]), "United States");
  assertEquals(geographyMatch("Oslo, Norway", ["Nordics"]), "Nordics");
  assertEquals(geographyMatch("Lyon, France", ["Nordics"]), null);
});

function storedRow(s: LisaSignal, id: string, over: Partial<StoredSignalRow> = {}): StoredSignalRow {
  return { id, workspace_id: s.workspace_id, signal_type: s.signal_type, lifecycle_status: s.lifecycle_status,
    verification_status: s.verification.column_status, confidence: s.verification.confidence,
    occurred_at: s.event_date ? `${s.event_date}T00:00:00Z` : null, observed_at: s.discovered_at, source_url: s.source_url,
    subject_type: s.subject_type, subject_key: s.subject_key,
    normalized_value: { lisa: { category: s.category, company: { name: s.company_name, domain: s.company_domain }, title: s.title,
      description: s.description, event_date: s.event_date, discovered_at: s.discovered_at, event_instance: s.event_instance,
      source_type: s.source_type, watch_origin: s.watch_origin, verification: s.verification, relevance: s.relevance } }, ...over };
}

Deno.test("changed ICP: stored relevance is recomputed when the Brain fingerprint changes", async () => {
  const r = await replay(loadFixture("changed_icp"));
  const [e] = events(r.store);
  assertEquals(e.relevance?.band, "high");
  const row = storedRow(e, "ev-1");
  const same = toAgentSignal(row, brainFrom(), new Date("2026-11-10T12:00:00Z"))!;
  assertEquals(same.relevance_recomputed, false);
  const changed = brainFrom({ fingerprint: "fp-brain-v2", industries: ["Healthcare"], geography: ["Germany"] });
  const after = toAgentSignal(row, changed, new Date("2026-11-10T12:00:00Z"))!;
  assertEquals(after.relevance_recomputed, true);
  assertEquals(after.relevance.brain_fingerprint, "fp-brain-v2");
  assert(after.relevance.score < same.relevance.score, `${after.relevance.score} < ${same.relevance.score}`);
  assertNotEquals(after.relevance.band, "high");
  assertEquals(toAgentSignal(row, null, new Date("2026-11-10T12:00:00Z"))!.relevance_outdated, true);
});

Deno.test("downstream contract: retracted / contradicted / single-source claims are never elevated", async () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const ok = toAgentSignal(storedRow(events((await replay(loadFixture("funding"))).store)[0], "a"), brainFrom(), now)!;
  assert(isElevatable(ok));
  for (const n of ["retracted", "contradictory"]) {
    const a = toAgentSignal(storedRow(events((await replay(loadFixture(n))).store)[0], n), brainFrom(), now)!;
    assert(!isElevatable(a), n);
    assertNotEquals(a.currency, "current", n);
  }
  const single = toAgentSignal(storedRow(events((await replay(loadFixture("launch"))).store)[0], "l"), brainFrom(), now)!;
  assertEquals(single.verification, "single_source");
  assert(!isElevatable(single));
  const dismissed = toAgentSignal({ ...storedRow(events((await replay(loadFixture("funding"))).store)[0], "d"), lifecycle_status: "dismissed" }, brainFrom(), now)!;
  assert(!isElevatable(dismissed));
});

Deno.test("weekly: at most five, verified + current + sourced + relevant, never padded", async () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const rows: StoredSignalRow[] = [];
  let i = 0;
  for (const n of ["funding", "second_round", "hiring", "expansion", "launch", "contradictory", "retracted"]) {
    for (const s of events((await replay(loadFixture(n))).store)) rows.push(storedRow(s, `ev-${n}-${i++}`));
  }
  const d = weeklyDigest("ws-fixture", rows, brainFrom(), now, (id) => [{ url: `https://evidence.example/${id}`, domain: "evidence.example" }]);
  assert(d.items.length <= 5);
  assert(d.items.length >= 1);
  for (const it of d.items) {
    assert(it.verification === "corroborated" || it.verification === "self_reported", it.signal);
    assert(/^https:\/\//.test(it.source_url));
    assert(it.relevance_score >= 45);
    assert(it.why_now && it.why_it_matters && it.suggested_action);
  }
  assert(!d.items.some((it) => /90 million|cancelled/.test(it.signal)), "no contradicted or retracted item");
  assert((d.excluded.not_current ?? 0) >= 2);
  assert((d.excluded.unverified ?? 0) >= 1);
  const sorted = [...d.items].sort((a, b) => b.relevance_score - a.relevance_score);
  assertEquals(d.items.map((x) => x.signal_id), sorted.map((x) => x.signal_id));
  assertEquals(weeklyDigest("ws-fixture", [], brainFrom(), now).items.length, 0);
});

Deno.test("persistence args: canonical columns + lisa block + one evidence row per URL; origin from the watch", async () => {
  const [e] = events((await replay(loadFixture("duplicate"))).store);
  const a = await recordArgs(e);
  assertEquals(a.p_event.origin, "competitor_monitor");
  assertEquals(a.p_event.evidence_category, "funding_signal");
  assertEquals(a.p_event.occurred_at_basis, "source_reported");
  assertEquals(a.p_evidence.length, 3);
  assertEquals(new Set(a.p_evidence.map((x) => x.fingerprint)).size, 3);
  assertEquals(originFor({ watch_origin: "icp", subject_type: "company", collection_method: "lisa_v2_on_demand" }), "manual_scan");
  const lisa = (a.p_event.normalized_value as { lisa: { verification: { level: string } } }).lisa;
  assertEquals(lisa.verification.level, "corroborated");
});

Deno.test("relevance is deterministic: same inputs, same verdict", async () => {
  const [e] = events((await replay(loadFixture("expansion"))).store);
  const w = { kind: "market" as const, origin: "icp" as const };
  const now = new Date("2026-11-10T12:00:00Z");
  assertEquals(evaluateRelevance(e, brainFrom(), w, now), evaluateRelevance(e, brainFrom(), w, now));
});

Deno.test("persistence: emails / phone numbers in source text are redacted; dates are kept", async () => {
  const { redactContactData, containsContactData } = await import("../../../../supabase/functions/_shared/lisa/persistence.ts");
  assertEquals(redactContactData("Press: jane@corvane.example or +1 (555) 010-2233 on 2026-11-03T12:00:00.000Z"),
    "Press: [redacted] or [redacted] on 2026-11-03T12:00:00.000Z");
  assertEquals(containsContactData({ d: "2026-11-10T12:00:00.000Z", amount: "$40 million" }), false);
  const [e] = events((await replay(loadFixture("funding"))).store);
  e.evidence[0].excerpt = "Contact press@corvane.example for details.";
  const a = await recordArgs(e);
  assert(!JSON.stringify(a).includes("press@corvane.example"));
  assertEquals(containsContactData(a.p_event.normalized_value), false);
});

Deno.test("rpcSignalStore: every fixture event reaches the RPC (no false contact-data refusal); a DB error is a failure", async () => {
  const { rpcSignalStore } = await import("../../../../supabase/functions/_shared/lisa/persistence.ts");
  const calls: string[] = [];
  const ok = rpcSignalStore({ rpc: (fn) => { calls.push(fn); return Promise.resolve({ data: { status: "new", event_id: "e" }, error: null }); } });
  for (const n of ["funding", "second_round", "duplicate", "hiring", "expansion", "launch", "contradictory", "retracted"]) {
    for (const s of events((await replay(loadFixture(n))).store)) assertEquals((await ok.record(s)).status, "new", n);
  }
  assert(calls.length >= 9);
  const bad = rpcSignalStore({ rpc: () => Promise.resolve({ data: null, error: { message: "fk" } }) });
  const [e] = events((await replay(loadFixture("funding"))).store);
  assertEquals((await bad.record(e)).status, "failed");
});
