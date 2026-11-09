// Audit probes — fictional data, zero network, zero DB, zero provider spend.
// Each test asserts the CURRENT behaviour the audit claims; a failure here
// means the audit claim is wrong.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
const R = new URL("../../../supabase/functions/_shared", import.meta.url).href;
const { collectExecutiveContext } = await import(`${R}/executiveBriefContext.ts`);
const { synthesizeExecutiveBrief } = await import(`${R}/executiveBrief.ts`);
const { projectCanonicalEvents, canonicalDedupeKey } = await import(`${R}/canonicalSignalEvent.ts`);
const { compileMonitoringMission } = await import(`${R}/monitoringMission.ts`);
const { buildCanonicalCompanyBrain } = await import(`${R}/getCompiledCompanyBrainForWorkspace.ts`);

type Row = Record<string, unknown>;
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const NOW = new Date("2026-11-07T08:00:00.000Z");
const day = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function fakeDb(tables: Record<string, Row[]>) {
  const touched: string[] = [];
  return {
    touched,
    db: {
      from(table: string) {
        touched.push(table);
        let rows = [...(tables[table] ?? [])];
        const q: any = {
          select() { return q; },
          eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
          in(c: string, vs: unknown[]) { rows = rows.filter((r) => vs.includes(r[c])); return q; },
          gte(c: string, v: string) { rows = rows.filter((r) => String(r[c] ?? "") >= v); return q; },
          order() { return q; },
          limit(n: number) { rows = rows.slice(0, n); return q; },
          maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
          then(res: any, rej?: any) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
        };
        return q;
      },
    },
  };
}

const brain = (ws: string, extra: Row = {}) => ({
  workspace_id: ws, onboarding_completed: true,
  profile: {
    company: { name: "Northwind Robotics", description: "Warehouse robots" },
    icp: { industries: ["Logistics"] },
    competitors: { known: ["Rivalco"] },
    goals: { gtm: "Win 10 logistics customers in Q1" },
    ...extra,
  },
});

// A monitoring-origin competitor funding event, exactly as projectCanonicalEvents builds it.
function monitorFundingRow(ws: string, id: string): Row {
  const [ev] = projectCanonicalEvents({
    workspace_id: ws, origin: "scheduled_monitor",
    subject: { subject_type: "competitor", subject_key: "rivalco-com", subject_identifier: "rivalco.com" },
    company_name: "Rivalco",
    assessments: [{ signal: "funding/company", verdict: "plausible", evidence_ids: ["e1"], occurred_at: day(1) }],
  }, NOW.getTime());
  return { id, ...ev, observed_at: day(1), created_at: day(1) };
}

Deno.test("B: monitoring competitor-funding row carries no source_url and is 'unverified'", () => {
  const r = monitorFundingRow(A, "x");
  assertEquals(r.verification_status, "unverified");
  assertEquals((r as any).source_url, undefined);
  assertEquals(r.account_id, null);
});

Deno.test("B: ORION ranks the competitor funding event and names it a tracked competitor", async () => {
  const { db } = fakeDb({ company_brain: [brain(A)], signal_events: [monitorFundingRow(A, "sig-1")] });
  const ctx = await collectExecutiveContext(db as any, A, { now: NOW });
  const sig = ctx.signals.find((s: any) => s.id === "sig-1");
  assert(sig, "event reached ORION");
  console.log("  ORION reasons:", sig.reasons, "score", sig.score);
  assert(sig.reasons.includes("a competitor you track"));
  const brief = synthesizeExecutiveBrief(ctx);
  console.log("  brief keys:", Object.keys(brief));
});

Deno.test("B': a competitor stored with a different spelling is NOT recognised (exact-name match only)", async () => {
  const row = monitorFundingRow(A, "sig-2");
  (row.normalized_value as Row).company_name = "Rivalco Inc.";
  const { db } = fakeDb({ company_brain: [brain(A)], signal_events: [row] });
  const ctx = await collectExecutiveContext(db as any, A, { now: NOW });
  const sig = ctx.signals.find((s: any) => s.id === "sig-2");
  assert(!sig.reasons.includes("a competitor you track"));
});

Deno.test("ORION: business goals are read but never influence signal ranking", async () => {
  const withGoal = fakeDb({ company_brain: [brain(A)], signal_events: [monitorFundingRow(A, "s")] });
  const noGoal = fakeDb({ company_brain: [brain(A, { goals: {} })], signal_events: [monitorFundingRow(A, "s")] });
  const a = await collectExecutiveContext(withGoal.db as any, A, { now: NOW });
  const b = await collectExecutiveContext(noGoal.db as any, A, { now: NOW });
  assertEquals(a.signals[0].score, b.signals[0].score);
});

Deno.test("A: ORION context never includes another workspace's rows", async () => {
  const { db } = fakeDb({
    company_brain: [brain(A), { ...brain(B), profile: { company: { name: "Tenant B" } } }],
    signal_events: [monitorFundingRow(A, "a"), monitorFundingRow(B, "b")],
  });
  const ctx = await collectExecutiveContext(db as any, A, { now: NOW });
  assertEquals(ctx.signals.map((s: any) => s.id), ["a"]);
  assertEquals(ctx.brain.company, "Northwind Robotics");
});

Deno.test("D: a dismissal (signal_reviews) is NOT read by ORION — dismissed-by-user signal still briefed", async () => {
  const { db, touched } = fakeDb({
    company_brain: [brain(A)],
    signal_events: [monitorFundingRow(A, "false-claim")],
    signal_reviews: [{ workspace_id: A, signal_id: "false-claim", status: "ignored" }],
  });
  const ctx = await collectExecutiveContext(db as any, A, { now: NOW });
  assert(!touched.includes("signal_reviews"));
  assert(ctx.signals.some((s: any) => s.id === "false-claim"));
});

Deno.test("D/dedupe: a NEW funding round for the same competitor gets the SAME dedupe key (would be dropped)", () => {
  const seriesA = canonicalDedupeKey("competitor", "rivalco-com", "recent_funding");
  const seriesB = canonicalDedupeKey("competitor", "rivalco-com", "recent_funding");
  assertEquals(seriesA, seriesB);
});

Deno.test("C: Brain is compiled per call — a changed ICP is visible immediately", () => {
  const before = buildCanonicalCompanyBrain(A, { target_customer: { industries: ["Logistics"] } });
  const after = buildCanonicalCompanyBrain(A, { target_customer: { industries: ["Healthcare"] } });
  console.log("  before:", before.target_customer.industries, "after:", after.target_customer.industries);
  assert(after.target_customer.industries.some((i: string) => /health/i.test(i)));
  assert(!after.target_customer.industries.some((i: string) => /logistic/i.test(i)));
});

Deno.test("E: no Brain → canonical Brain is empty and setup_required (no fabricated ICP)", () => {
  const b = buildCanonicalCompanyBrain(A, {});
  assertEquals(b.setup_required, true);
  assertEquals(b.target_customer.industries, []);
  assertEquals(b.competitors, []);
});

Deno.test("E: no Brain → ORION brief marks Brain unusable", async () => {
  const { db } = fakeDb({ signal_events: [monitorFundingRow(A, "s")] });
  const ctx = await collectExecutiveContext(db as any, A, { now: NOW });
  assertEquals(ctx.brain.usable, false);
  const brief = synthesizeExecutiveBrief(ctx);
  console.log("  no-brain brief confidence:", (brief as any).confidence, "| notes:", JSON.stringify((brief as any).notes ?? (brief as any).caveats ?? null).slice(0, 200));
});

Deno.test("E: monitoring an `icp` subject with an empty Brain", () => {
  const out = compileMonitoringMission({
    workspace_id: A,
    subjects: [{ kind: "icp", identifier: null, label: null, signals: [{ event: "funding", subject: "company" }], timeframe_days: 90 }],
    icp: { verticals: [], business_models: [], locations: [], stages: [], employee_range: null },
  } as any);
  console.log("  icp-with-empty-brain compile:", JSON.stringify(out).slice(0, 300));
});
