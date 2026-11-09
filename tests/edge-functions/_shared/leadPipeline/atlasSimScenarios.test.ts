// ATLAS SIMULATOR SCENARIOS — every fixture in tests/fixtures/atlas-sim/ through the REAL
// lead-pipeline service (scripts/dev/atlas-sim/harness.ts), offline. Each scenario's
// `expect` was reviewed against the owner's policy before it was frozen; a change here is a
// behaviour change, to be reviewed as one. Invariants below hold for EVERY scenario.
//
// Run just these: deno test --allow-read --allow-env --no-check tests/edge-functions/_shared/leadPipeline/atlasSimScenarios.test.ts
// Inspect one:    npm run dev:atlas -- <scenario>

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadScenarios, runScenario } from "../../../../scripts/dev/atlas-sim/harness.ts";

const DIR = new URL("../../../fixtures/atlas-sim/", import.meta.url);
type Obj = Record<string, unknown>;
type Company = { company: { name: string } };
type RunBody = { outcome?: { status?: string; spend?: { basis?: string } }; queue?: Company[]; review?: Company[]; excludedCount?: number; rejected?: { name: string }[];
  persistence?: { failed?: number }; spend?: { apifyUsd: number } };
const planOf = (b: Obj) => (b.plan ?? {}) as { status?: string; planHash?: string; estimate?: { apifyUsd: number } };
const scenarios = await loadScenarios(DIR);
globalThis.fetch = (() => { throw new Error("network disabled in ATLAS scenarios"); }) as typeof fetch;

const REQUIRED_COVERAGE = [
  "successful discovery", "empty discovery", "partial discovery", "duplicate companies", "different LinkedIn URLs for the same company", "pagination and result limits",
  "verified B2B", "likely B2B", "mixed B2B/B2C", "confirmed non-B2B", "missing website evidence", "missing or stale hiring signals", "wrong headquarters location",
  "employee-count preferences", "employee-count exclusions",
  "soft preferences", "negative requirements", "unsupported requirements", "review-only plans", "approval rejection", "contract-hash mismatch",
  "provider timeout", "invalid Actor input", "HTTP errors", "empty dataset", "duplicate delivery", "budget-limit rejection", "unknown actual spend",
  "existing company", "existing holds", "repeated run", "workspace isolation", "Workbench plan_id association", "database write failure",
];

Deno.test("every requested scenario category is covered by a fixture", () => {
  const covered = new Set(scenarios.flatMap((s) => s.covers));
  const missing = REQUIRED_COVERAGE.filter((c) => !covered.has(c));
  assertEquals(missing, [], `no fixture covers: ${missing.join(", ")}`);
  assert(scenarios.length >= 25);
});

for (const s of scenarios) {
  Deno.test(`scenario ${s.name}`, async () => {
    const r = await runScenario(s);
    const last = r.runs[r.runs.length - 1];
    const b = (last?.body ?? {}) as RunBody;
    const got: Record<string, unknown> = {
      planStatus: r.plan.status, planState: planOf(r.plan.body).status ?? r.plan.body.status ?? null,
      runStatuses: r.runs.map((x) => x.status), outcome: b.outcome?.status ?? null,
      qualified: (b.queue ?? []).map((c) => c.company.name).sort(),
      needsVerification: (b.review ?? []).map((c) => c.company.name).sort(),
      excluded: b.excludedCount ?? null, leadsSaved: r.db.leads.length, actorCalls: r.actorCalls.length, persistFailed: b.persistence?.failed ?? null,
      rejected: (b.rejected ?? []).map((x) => x.name).sort(),
    };
    for (const [k, v] of Object.entries(s.expect ?? {})) assertEquals(got[k], v, `${s.name}: ${k}`);

    // INVARIANTS (every scenario)
    if (b.excludedCount !== undefined) assertEquals((b.rejected ?? []).length, Math.min(50, b.excludedCount), `${s.name}: every excluded company is named`);
    const planHash = planOf(r.plan.body).planHash;
    for (const c of r.actorCalls) {
      assert(planHash && c.key.includes(planHash.slice(0, 16)) || r.runs.length > 1, `${s.name}: Actor key not bound to the plan (${c.key})`);
      assert(c.items <= c.maxItems, `${s.name}: ${c.actor} delivered more than maxItems`);
    }
    if (!r.runs.some((x) => x.status === 200)) {
      assertEquals(r.actorCalls.length, s.approval === "approve" || !s.approval ? r.actorCalls.length : 0, `${s.name}: an Actor ran without an approved run`);
      assertEquals(r.db.leads.length, 0, `${s.name}: a lead was saved without a successful run`);
    }
    for (const run of r.runs.filter((x) => x.status === 200)) {
      const rb = run.body as RunBody; const spend = rb.spend; const est = planOf(r.plan.body).estimate;
      assert(spend && est && spend.apifyUsd <= est.apifyUsd + 1e-9, `${s.name}: reported spend exceeds the approved worst case`);
      assertEquals(rb.outcome?.spend?.basis !== undefined, true, `${s.name}: spend must say its basis`);
    }
    const rejected = new Set(s.companies.map((c) => c.name).filter((n) => ![...(got.qualified as string[]), ...(got.needsVerification as string[])].includes(n)));
    for (const l of r.db.leads) {
      const acc = r.db.accounts.find((a) => a.id === l.account_id);
      assert(!acc || !rejected.has(String(acc.name)) || s.name === "b2b-preference-only", `${s.name}: a rejected company was saved (${acc?.name})`);
    }
  });
}
