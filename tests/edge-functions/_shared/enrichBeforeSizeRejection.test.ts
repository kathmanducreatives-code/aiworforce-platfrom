// A REPORTED HEADCOUNT RANKS; ENRICHMENT DECIDES. A SPENT ALLOWANCE PLANS NOTHING.
//
// Canary 87ecf153 (local, 2026-09-24): company search returned ByteByteGo (86)
// and Psychology Today (2,135) for an 11–50 mission. The pre-pass excluded both
// on those search-row counts — PLAUSIBLE evidence — so enrichment never ran and
// size was never actually decided. Then a second slice spent model calls
// planning discovery the candidate allowance could no longer buy.
//
// Replayed here through the real engine with rows shaped like the canary's:
//
//   company search → plausible headcount → ranked down, NOT excluded
//   → enrichment (one batched company-details read) → PROVEN exact count
//   → size FAIL → ineligible → no Atomus
//
// and with the allowance spent, no discovery planning — this slice or the next.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { missionCandidatesFrom, runCapabilityPlan } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { mergeCompanyBrainIntoMission, parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { readinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { candidatePool, parseRunBudget } from "../../../supabase/functions/_shared/runBudget.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { verificationTargets } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { emptyDiscoverySelector } from "./discoverySelectorFixture.ts";

globalThis.fetch = () => { throw new Error("replay tests must not reach the network"); };

const PROBE = readinessPolicy({ mode: "provider_probe", probe_routes: ["apify_linkedin_company_search|general_company_discovery"] });
const QUERY = "Find 1 US company with 11-50 employees that raised funding in the last 6 months";
const MISSION = (() => {
  const m = parseLeadMissionDeterministic(QUERY);
  const stated = {
    ...m, company_profile: { ...m.company_profile, employee_range: { min: 11, max: 50 } },
    field_provenance: { ...m.field_provenance, "company_profile.employee_range": "explicit_user_request" as const },
  };
  return mergeCompanyBrainIntoMission(stated, { industries: ["b2b saas", "fintech"] } as never).mission;
})();

/** Rows shaped like the canary's harvestapi company records (full mode). */
const row = (slug: string, name: string, employeeCount: number) => ({
  id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}/`, website: `https://${slug}.com`,
  description: `${name} does something.`, employeeCount, employeeCountRange: { start: 11, end: 50 },
  industries: [{ id: 4, name: "Software Development" }],
  locations: [{ parsed: { text: "San Francisco, CA, United States", countryFull: "United States" }, country: "US", headquarter: true }],
});
const CANARY_ROWS = [row("bytebytego", "ByteByteGo", 86), row("psychology-today", "Psychology Today", 2135)];

function harness(rows: Record<string, unknown>[]) {
  const sent: Array<{ actor: string; input: Record<string, unknown> }> = [];
  const calls = { planDiscovery: 0, controlRoutes: 0 };
  const byUrl = (u: string) => rows.find((r) => String(r.linkedinUrl).replace(/\/$/, "") === u.replace(/\/$/, ""));
  const deps = {
    planDiscovery: (x: unknown) => { calls.planDiscovery++; return (emptyDiscoverySelector() as (y: unknown) => unknown)(x); },
    planExecution: () => Promise.resolve({ reasoning: "replay", steps: [
      { capability: "general_company_discovery", actor_key: "apify_linkedin_company_search", purpose: "profile discovery",
        input: { industryIds: ["4", "6", "43"], locations: ["United States"], companySize: ["11-50"], maxItems: 20, scraperMode: "full" }, depends_on: [] },
      { capability: "company_identity_resolution", actor_key: "apify_linkedin_company_search", purpose: "only without a page", input: { searchQuery: "{{name}}", maxItems: 5 }, depends_on: [1] },
      { capability: "company_enrichment", actor_key: "apify_linkedin_company_details", purpose: "details", input: { companies: ["{{url}}"] }, depends_on: [2] },
      { capability: "company_brain_qualification", actor_key: null, purpose: "qualify", input: {}, depends_on: [3] },
      { capability: "persistence", actor_key: null, purpose: "save", input: {}, depends_on: [4] },
    ] }),
    controlRoutes: () => { calls.controlRoutes++; return Promise.resolve({ action: "continue" }); },
    invoke: (call: { actorKey: string; input: Record<string, unknown>; onProviderRun?: (r: { run_id: string; dataset_id: null }) => void }) => {
      sent.push({ actor: call.actorKey, input: call.input });
      call.onProviderRun?.({ run_id: `run-${sent.length}`, dataset_id: null });
      if (call.actorKey === "apify_linkedin_company_search") {
        return Promise.resolve(call.input.searchQuery ? [] : rows.slice(0, Number(call.input.maxItems ?? 2)));
      }
      if (call.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve(((call.input.companies as string[]) ?? []).map(byUrl).filter(Boolean));
      }
      throw new Error(`unexpected provider call: ${call.actorKey}`);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  };
  const budget = parseRunBudget({ provider_usd: 0.04, max_candidates: 2 })!;
  const opts = {
    mission: MISSION, plan: buildCapabilityGraph(MISSION, { executability: "enforce", readiness: PROBE }),
    maxCandidates: candidatePool(1, budget), runBudget: budget, readiness: PROBE,
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
    specMode: "enforce", specScope: { workspace_id: "ws-replay", lineage_id: "ln-replay" },
  };
  return { deps, opts, sent, calls };
}
const CRITERIA = deriveMissionCriteria(MISSION, PROBE);
// deno-lint-ignore no-explicit-any
type Grounded = Record<string, any>;
const grounded = (result: unknown): Grounded[] => (missionCandidatesFrom(result as never, { missionId: "t" }) as Grounded[])
  .map((c): Grounded => {
    const e = evaluateEligibility(CRITERIA, c.graph);
    return { ...c, eligibility: e.eligibility, hard_checks: (e.checks ?? []).filter((x) => x.kind === "hard"), attempted_routes: c.attempted_routes ?? [] };
  });

Deno.test("CANARY 87ecf153 REPLAY: out-of-range search rows reach enrichment, fail on the PROVEN count, and buy no Atomus", async () => {
  const h = harness(CANARY_ROWS);
  const result = await runCapabilityPlan(h.deps as never, h.opts as never) as unknown as { state: Record<string, any> };

  // Discovery ranked them down; it did not exclude them.
  for (const p of result.state.prequalification.companies) {
    assertEquals([p.size_status, p.exclusion, p.eligible], ["above_max", null, true], p.name);
    assert(p.reasons.some((r: string) => /ranked down, not excluded/.test(r)), p.reasons.join(" | "));
  }
  // Both reached enrichment, in one batched read.
  const details = h.sent.filter((s) => s.actor === "apify_linkedin_company_details");
  assertEquals(details.length, 1);
  assertEquals((details[0].input.companies as string[]).length, 2);

  // Size is decided on the enriched, PROVEN count — and fails.
  const cands = grounded(result);
  for (const c of cands) {
    const size = c.hard_checks.find((x: Grounded) => x.dimension === "company_size")!;
    assertEquals(size.result, "fail", c.name);
    const item = c.graph.claims.find((x: any) => x.dimension === "headcount").current;
    assertEquals([item.source.actor, item.status, item.authority?.rule],
      ["apify_linkedin_company_details", "proven", "li_record_exact_headcount"], c.name);
    assertEquals(c.eligibility, "ineligible", c.name);
  }
  // A failed candidate is never handed to the funding verifier.
  const atomus = verificationTargets({ route_actor: "apify_funding_atomus", max_targets: 6 }, cands as never,
    (id) => CRITERIA.find((c) => c.id === id)?.value, undefined, PROBE);
  assertEquals(atomus, []);
  assert(!h.sent.some((s) => s.actor === "apify_funding_atomus"));
});

Deno.test("CANARY 87ecf153 REPLAY: an in-range candidate from the same search is viable and reaches Atomus", async () => {
  const h = harness([row("inrange", "InRange Co", 30), ...CANARY_ROWS]);
  const result = await runCapabilityPlan(h.deps as never, h.opts as never);
  const cands = grounded(result);
  const viable = cands.find((c) => c.name === "InRange Co")!;
  assertEquals(viable.hard_checks.map((x: any) => [x.dimension, x.result]),
    [["geography", "pass"], ["company_size", "pass"], ["funding", "unknown"]]);
  const atomus = verificationTargets({ route_actor: "apify_funding_atomus", max_targets: 6 }, cands as never,
    (id) => CRITERIA.find((c) => c.id === id)?.value, undefined, PROBE);
  assertEquals(atomus.map((t) => t.name), ["InRange Co"]);
});

Deno.test("SPENT ALLOWANCE: no discovery planning in this slice, and a forced replenishment slice plans and buys nothing", async () => {
  const h = harness(CANARY_ROWS);
  const first = await runCapabilityPlan(h.deps as never, h.opts as never) as unknown as { state: Record<string, any> };
  assertEquals(first.state.discovery_rows_bought, 2);
  assertEquals(first.state.discovery_source_state.stop_reason, "candidate_budget_spent");
  assertEquals(first.state.discovery_source_state.exhausted, true, "run-agent reads this as: no discovery route remains");
  assertEquals([h.calls.planDiscovery, h.calls.controlRoutes], [0, 0], "no model call plans a wave that cannot be bought");

  // The canary's worker scheduled a replenishment slice anyway; it must plan nothing.
  const before = h.sent.length;
  h.calls.planDiscovery = 0; h.calls.controlRoutes = 0;
  await runCapabilityPlan(h.deps as never, {
    ...h.opts, state: first.state,
    discoveryReplenishment: { reason: "replenishment_required", sources_attempted: ["apify_linkedin_company_search"], pages_taken: { apify_linkedin_company_search: 1 } },
  } as never);
  assertEquals(h.sent.length - before, 0, "no provider call");
  assertEquals([h.calls.planDiscovery, h.calls.controlRoutes], [0, 0], "no discovery-planning model call");
});
