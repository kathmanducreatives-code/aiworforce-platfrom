// LISA audit — OFFLINE probes against the real modules (fictional data, no
// network, no database). Each test asserts what the code DOES TODAY, including
// defects; a "DEFECT" test passing means the defect is still present.
//
//   deno test --allow-read --allow-env --no-check docs/audits/lisa-complete-audit-2026-11/lisaProbes.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- test fakes stand in for supabase-js builders */
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
const R = new URL("../../../supabase/functions/_shared/", import.meta.url).href;
const SRC = new URL("../../../src/lib/", import.meta.url).href;
const { projectCanonicalEvents, canonicalDedupeKey, CANONICAL_TYPE_FOR } = await import(`${R}canonicalSignalEvent.ts`);
const { signalCollectability } = await import(`${R}signalCollectability.ts`);
const { compileMonitoringMission } = await import(`${R}monitoringMission.ts`);
const { compileCompanyBrainContext } = await import(`${R}companyBrainCompiler.ts`);
const { collectExecutiveContext } = await import(`${R}executiveBriefContext.ts`);
const { synthesizeExecutiveBrief } = await import(`${R}executiveBrief.ts`);
const { openInLeads } = await import(`${R}signalsToLeads.ts`);
const { normalizeSignalEventRow } = await import(`${SRC}signalEventProjection.ts`);

const WS = "aaaaaaaa-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-10T08:00:00Z");
const day = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function monitorEvent(signal: string, verdict = "verified", occurred = day(2), subject = { subject_type: "competitor", subject_key: "rivalco-com", subject_identifier: "rivalco.com" }) {
  return projectCanonicalEvents({
    workspace_id: WS, origin: "scheduled_monitor", subject, company_name: "Rivalco",
    assessments: [{ signal, verdict, evidence_ids: ["ev-1"], occurred_at: occurred }],
  }, NOW.getTime());
}

// ── capability coverage (the engine's own answer) ───────────────────────────
Deno.test("coverage: a NAMED competitor can be monitored for hiring, expansion and launches — not funding", () => {
  const yes = (e: string) => signalCollectability(e, "competitor").collectible;
  assert(yes("hiring")); assert(yes("expansion")); assert(yes("product_launch"));
  assertFalse(yes("funding"), "DEFECT: funding is only discoverable across the ICP, never for a named competitor");
  assertFalse(yes("headcount_change"));
  for (const e of ["pricing_change", "website_change", "acquisition", "leadership_change", "partnership", "technology"]) {
    assertFalse(yes(e), `${e} has no canonical signal type`);
  }
  assert(signalCollectability("funding", "icp").collectible, "funding IS collectable across the ICP");
  assertEquals(Object.keys(CANONICAL_TYPE_FOR).sort(), ["expansion", "funding", "headcount_change", "hiring", "product_launch"]);
});

// ── scenario 2: repeated funding rounds ─────────────────────────────────────
Deno.test("scenario 2 DEFECT: Series A and a later Series B share one dedupe key", () => {
  const [a] = monitorEvent("funding/company", "verified", day(300));
  const [b] = monitorEvent("funding/company", "verified", day(2));
  assertEquals(a.dedupe_key, b.dedupe_key, "the writer ignores the second as a duplicate");
  assertEquals(a.dedupe_key, canonicalDedupeKey("competitor", "rivalco-com", "recent_funding"));
});

// ── scenario 3: pricing change ──────────────────────────────────────────────
Deno.test("scenario 3: a pricing change cannot become a signal (no canonical type)", () => {
  assertEquals(monitorEvent("pricing_change/company"), []);
  assertEquals(monitorEvent("website_change/company"), []);
});

// ── scenario 5: unsupported claims ──────────────────────────────────────────
Deno.test("scenario 5: an unsupported claim is dropped; a merely 'plausible' one is stored as active, unverified, with no source URL", () => {
  for (const v of ["unsupported", "insufficient_evidence", "contradicted", "rejected"]) assertEquals(monitorEvent("funding/company", v), [], v);
  const [p] = monitorEvent("funding/company", "plausible");
  assertEquals(p.lifecycle_status, "active");
  assertEquals(p.verification_status, "unverified");
  assertEquals((p as any).source_url, undefined, "monitoring events carry no source URL");
  assertEquals(p.normalized_value.evidence_ids, ["ev-1"], "only engine evidence ids, which live in transient run state");
});

// ── the feed: monitoring output is hidden by default ────────────────────────
Deno.test("feed DEFECT: monitoring events are classified 'Legacy / Needs verification' and hidden by default", () => {
  for (const sig of ["funding/company", "product_launch/company", "expansion/company", "hiring/company"]) {
    const [e] = monitorEvent(sig);
    const row = { id: "x", observed_at: day(1), created_at: day(1), ...e };
    const f = normalizeSignalEventRow(row as any);
    assertEquals(f.show_by_default, false, `${sig} hidden unless "show unverified" is on`);
  }
  const [fund] = monitorEvent("funding/company");
  assertEquals(normalizeSignalEventRow({ id: "x", observed_at: day(1), created_at: day(1), ...fund } as any).signal_type, "recent_funding",
    "…and the page's Funding filter matches only 'funding' (src/pages/Signals.tsx matchesSecondary)");
});

// ── scenario 8: ICP change ──────────────────────────────────────────────────
Deno.test("scenario 8: the ICP is re-read on every scan (no stale targeting at collection time)", () => {
  const before = compileCompanyBrainContext({ workspace_id: WS, profile: { schema_version: 2, target_customer: { industries: ["Logistics"] } } });
  const after = compileCompanyBrainContext({ workspace_id: WS, profile: { schema_version: 2, target_customer: { industries: ["Healthcare"] } } });
  assert(before.icp.industries.some((i: string) => /logistic/i.test(i)));
  assert(after.icp.industries.some((i: string) => /health/i.test(i)));
});

// ── scenario 11: missing Company Brain ──────────────────────────────────────
Deno.test("scenario 11: an ICP subject with no Brain is refused before any spend; named subjects still run", () => {
  const icp = compileMonitoringMission({ workspace_id: WS, subjects: [{ kind: "icp", identifier: null, label: null, signals: [{ event: "funding", subject: "company" }], timeframe_days: 90 }],
    icp: { verticals: [], business_models: [], locations: [], stages: [], employee_range: null } } as any);
  assertEquals(icp.ok, false); assertEquals(icp.refusal, "no_usable_subjects");
  const named = compileMonitoringMission({ workspace_id: WS, subjects: [{ kind: "competitor", identifier: "rivalco.com", label: "Rivalco", signals: [{ event: "hiring", subject: "company" }], timeframe_days: 90 }],
    icp: { verticals: [], business_models: [], locations: [], stages: [], employee_range: null } } as any);
  assertEquals(named.ok, true, "a competitor is watched even without a Brain");
});

// ── ORION: relevance and source links ───────────────────────────────────────
function fakeDb(tables: Record<string, any[]>) {
  const touched: string[] = [];
  return { touched, db: { from(t: string) { touched.push(t); let rows = [...(tables[t] ?? [])]; const q: any = {
    select: () => q, eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return q; },
    in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return q; },
    gte: (c: string, v: string) => { rows = rows.filter((r) => String(r[c] ?? "") >= v); return q; },
    order: () => q, limit: (n: number) => { rows = rows.slice(0, n); return q; },
    then: (res: any, rej?: any) => Promise.resolve({ data: rows, error: null }).then(res, rej) }; return q; } } };
}
Deno.test("ORION DEFECT: LISA's relevance verdicts are never read; a 'none' verdict does not demote the signal", async () => {
  const [e] = monitorEvent("product_launch/company");
  const row = { id: "sig-1", observed_at: day(1), created_at: day(1), source_url: null, ...e };
  const { db, touched } = fakeDb({ company_brain: [{ workspace_id: WS, profile: { company: { name: "Northwind" } }, onboarding_completed: true }],
    signal_events: [row], signal_cluster_relevance: [{ workspace_id: WS, cluster_key: "competitor|rivalco-com", relevance: "none" }] });
  const ctx = await collectExecutiveContext(db as any, WS, { now: NOW });
  assertFalse(touched.includes("signal_cluster_relevance"));
  assertEquals(ctx.signals.map((s: any) => s.id), ["sig-1"]);
  const brief = synthesizeExecutiveBrief(ctx);
  const refs = JSON.stringify(brief.market_changes);
  assertFalse(refs.includes("http"), "ORION's brief carries no source links — only an in-app route");
  assertEquals(brief.market_changes[0].evidence[0].route, "/signals");
});

// ── ATLAS: the decision exists, nothing calls it ────────────────────────────
Deno.test("ATLAS: openInLeads can decide a safe handoff, but no product code calls it", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/signalsToLeads.ts", import.meta.url));
  assert(src.includes("export function openInLeads"));
  const cmd = new Deno.Command("grep", { args: ["-rln", "openInLeads", "src", "supabase/functions", "--include=*.ts", "--include=*.tsx"],
    cwd: new URL("../../../", import.meta.url).pathname, stdout: "piped" });
  const users = new TextDecoder().decode((await cmd.output()).stdout).split("\n").filter((l) => l && !l.includes(".test.") && !l.endsWith("signalsToLeads.ts"));
  assertEquals(users, [], "no caller outside its own module and tests");
  void openInLeads;
});
