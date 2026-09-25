// LEAD V2 P2 — FIRECRAWL EVIDENCE PAGES ARE SPEC'D, RESERVED AND RECORDED.
//
// Canary cfc5c18f bought five pages outside the spine. These pin the fix.

import { assert, assertEquals, assertFalse, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { newSpendLedger, resolveCeilings, spendTotals } from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { newMissionTrace } from "../../../supabase/functions/_shared/missionTrace.ts";
import {
  compileWebEvidenceSpec, FIRECRAWL_BUDGET_USD_PER_CREDIT, specGovernedPageFetcher, webEvidenceCreditRate,
} from "../../../supabase/functions/_shared/webEvidenceSpec.ts";

const SCOPE = { workspace_id: "e8af257d-4c42-4fc2-9d62-037cdfac27c4", lineage_id: "cfc5c18f-0000-4000-8000-000000000000" };

function state(ceilings = resolveCeilings(null, false)) {
  return {
    spend_ledger: newSpendLedger(ceilings),
    mission_trace: newMissionTrace(),
    retrieval_plans: [{ plan_id: "rp_1", version: 2, mission_hash: "mh" }],
  };
}

Deno.test("a page spec is deterministic, keyed on workspace + lineage + input, and pinned to one /scrape page", () => {
  const s = state();
  const a = compileWebEvidenceSpec({ url: "https://fuseai.com/pricing", company_key: "fuse", request_id: "r1", scope: SCOPE,
    mission_hash: "mh", plan: { plan_id: "rp_1", version: 2 }, ledger: s.spend_ledger, usd_per_credit: 0.0064 });
  const b = compileWebEvidenceSpec({ url: "https://fuseai.com/pricing", company_key: "fuse", request_id: "r2", scope: SCOPE,
    mission_hash: "mh", plan: { plan_id: "rp_1", version: 2 }, ledger: s.spend_ledger, usd_per_credit: 0.0064 });
  assertEquals(a.idempotency_key, b.idempotency_key);
  assertEquals(a.serialized_input, { url: "https://fuseai.com/pricing", extraction_goal: "requirement evidence", max_pages: 1 });
  assertEquals([a.provider, a.actor, a.purpose, a.status], ["firecrawl", "firecrawl_scrape", "web_evidence", "intended"]);
  assert(Object.isFrozen(a.serialized_input));
  const other = compileWebEvidenceSpec({ url: "https://fuseai.com/pricing", company_key: "fuse", request_id: "r1",
    scope: { ...SCOPE, lineage_id: "other" }, mission_hash: "mh", plan: { plan_id: null, version: null }, ledger: s.spend_ledger, usd_per_credit: 0.0064 });
  assert(other.idempotency_key !== a.idempotency_key);
});

Deno.test("the budget rate is the account's configured rate, or a labelled assumption", () => {
  assertEquals(webEvidenceCreditRate(() => undefined), { usd_per_credit: FIRECRAWL_BUDGET_USD_PER_CREDIT, basis: "budget_assumption" });
  assertEquals(webEvidenceCreditRate((k) => k === "FIRECRAWL_USD_PER_CREDIT" ? "0.00083" : undefined), { usd_per_credit: 0.00083, basis: "account_rate" });
});

Deno.test("a governed fetch sends exactly the spec, reserves it, and records the published credit cost", async () => {
  const s = state();
  const sent: unknown[] = [];
  const fetch = specGovernedPageFetcher({ state: s, scope: SCOPE, usd_per_credit: 0.0064,
    send: (spec) => { sent.push(spec.serialized_input); return Promise.resolve({ ok: true, markdown: "# Pricing", status: "ok", status_code: 200 }); } });
  const r = await fetch({ url: "https://fuseai.com/pricing", request_id: "req", company_key: "fuse" });
  assertEquals(r.status, "ok");
  assertEquals(sent, [{ url: "https://fuseai.com/pricing", extraction_goal: "requirement evidence", max_pages: 1 }]);
  const res = s.spend_ledger.reservations;
  assertEquals(res.length, 1);
  assertEquals([res[0].status, res[0].purpose, res[0].provisional_usd, res[0].settled_usd, res[0].settlement_source, res[0].candidate_keys],
    ["settled", "web_evidence", 0.0064, 0.0064, "derived_floor", ["fuse"]]);
  assertEquals(s.mission_trace.events.map((e) => e.type), ["spec_compiled", "call_reserved", "call_executed", "call_settled"]);
  assertEquals(s.mission_trace.events[2].detail.credits, 1);
});

Deno.test("the same page in the same lineage is never bought twice", async () => {
  const s = state();
  let sends = 0;
  const fetch = specGovernedPageFetcher({ state: s, scope: SCOPE, usd_per_credit: 0.0064,
    send: () => { sends++; return Promise.resolve({ ok: true, markdown: "x", status: "ok" }); } });
  await fetch({ url: "https://a.com/p", request_id: "1", company_key: "a" });
  const again = await fetch({ url: "https://a.com/p", request_id: "2", company_key: "a" });
  assertEquals(sends, 1);
  assertEquals(again.status, "blocked");
  assert(s.mission_trace.events.some((e) => e.type === "call_idempotent_skip"));
  assertEquals(spendTotals(s.spend_ledger).mission_committed_usd, 0.0064);
});

Deno.test("a page the mission ceiling cannot afford is refused and not fetched", async () => {
  const s = state(resolveCeilings({ mission_provider_usd: 0.01 } as never, false));
  let sends = 0;
  const fetch = specGovernedPageFetcher({ state: s, scope: SCOPE, usd_per_credit: 0.0064,
    send: () => { sends++; return Promise.resolve({ ok: true, markdown: "x", status: "ok" }); } });
  await fetch({ url: "https://a.com/1", request_id: "1", company_key: "a" });
  const second = await fetch({ url: "https://a.com/2", request_id: "2", company_key: "a" });
  assertEquals(sends, 1);
  assertEquals(second.status, "blocked");
  const refused = s.mission_trace.events.find((e) => e.type === "call_refused_budget");
  assertEquals(refused?.detail.ceiling, "mission");
});

Deno.test("no P2 state means nothing is bought; a thrown fetch releases its reservation", async () => {
  let sends = 0;
  const bare = specGovernedPageFetcher({ state: {}, scope: SCOPE, usd_per_credit: 0.0064,
    send: () => { sends++; return Promise.resolve({ ok: true, markdown: "", status: "ok" }); } });
  assertEquals((await bare({ url: "https://a.com", request_id: "1", company_key: "a" })).status, "blocked");
  assertEquals(sends, 0);
  const s = state();
  const throwing = specGovernedPageFetcher({ state: s, scope: SCOPE, usd_per_credit: 0.0064, send: () => Promise.reject(new Error("net")) });
  await assertRejects(() => throwing({ url: "https://b.com", request_id: "1", company_key: "b" }));
  assertEquals(s.spend_ledger.reservations[0].status, "released");
  assertEquals(spendTotals(s.spend_ledger).mission_committed_usd, 0);
});

Deno.test("run-agent routes evidence pages through the governed fetcher under specs and persists them", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(/if \(p2Specs && capabilityRun\) \{\s*return specGovernedPageFetcher\(/.test(src));
  assert(/\.\.\.\(spec \? spec\.serialized_input : \{/.test(src));
  assert(src.includes("[run-agent][p2-spine][evidence]"));
});
