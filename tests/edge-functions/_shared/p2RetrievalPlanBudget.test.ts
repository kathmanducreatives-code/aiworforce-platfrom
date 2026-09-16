// LEAD V2 P2 — VERSIONED PLANS, AMENDMENT RULES, CEILINGS, SETTLEMENT, TRACE.

import { assert, assertAlmostEquals, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  amendRetrievalPlan, buildRetrievalPlan, type BuildPlanInput,
} from "../../../supabase/functions/_shared/retrievalPlan.ts";
import {
  DEFAULT_CEILINGS, markExecuted, newSpendLedger, reserve, resolveCeilings, settlementPass, spendTotals,
} from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { appendTrace, MISSION_TRACE_CAP, newMissionTrace } from "../../../supabase/functions/_shared/missionTrace.ts";
import { criteriaExecutionPolicy } from "../../../supabase/functions/_shared/criteriaExecutionPolicy.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import type { ExecutionPlan } from "../../../supabase/functions/_shared/leadExecutionPlan.ts";

globalThis.fetch = () => { throw new Error("P2 plan tests must not reach the network"); };

const MISSION = compileLeadMission({
  originalUserQuery: "Find 3 B2B SaaS startups in the US hiring software engineers.",
  proposal: {
    requested_opportunity_count: 3, requested_contact_ready_count: null, company_types: ["B2B SaaS"],
    geographies: ["United States"], geography_is_hard: true, employee_range: { min: null, max: null },
    decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
    preferred_signals: ["hiring software engineers"], adjacent_signals: [], excluded_signals: [],
    allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
    disallowed_broadening: [], required_evidence: [], required_capabilities: [], preferred_source_strategy: [],
    evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.8, unknowns: [],
  },
}).final_mission;
const GRAPH = buildCapabilityGraph(MISSION, { executability: "enforce" });

const execPlan = (memo23Input: Record<string, unknown>, identityMax = 5): ExecutionPlan => ({
  version: "execution-plan-v1" as never, source: "model_validated", reasoning: "r", violations: [],
  steps: [
    { step: 1, capability: "startup_company_discovery", actor_key: "apify_yc_companies_memo23", purpose: "discover", input: memo23Input, depends_on: [] },
    { step: 2, capability: "company_identity_resolution", actor_key: "apify_linkedin_company_search", purpose: "identity",
      input: { searchQuery: "{{step_1.name}}", scraperMode: "full", maxItems: identityMax, locations: ["United States"] }, depends_on: [1] },
  ] as never,
});
const build = (ep: ExecutionPlan | null, extra?: BuildPlanInput["extra_routes"]): BuildPlanInput => ({
  mission: MISSION, mission_hash: "a".repeat(64), graph: GRAPH, execution_plan: ep,
  policy: criteriaExecutionPolicy(MISSION), ceilings: resolveCeilings(null), extra_routes: extra,
});
const Q1 = { mode: "companies", queries: ["B2B SaaS", "developer tools"], regions: ["United States of America"], isHiring: true, maxItems: 10 };

// ── plans ────────────────────────────────────────────────────────────────────

Deno.test("a plan has routes with the planner's input, stages, anchors and a stable content hash", () => {
  const a = buildRetrievalPlan(build(execPlan(Q1)));
  const b = buildRetrievalPlan(build(execPlan(Q1)));
  assertEquals(a.version, 1);
  assertEquals(a.routes.length, 1);
  assertEquals(a.routes[0].proposed_input, Q1);
  assertEquals(a.routes[0].query_families[0].terms, ["B2B SaaS", "developer tools"]);
  assertEquals(a.stages.map((s) => s.purpose), ["identity"]);
  assertEquals(a.anchors.primary, "company_profile");
  assertEquals(a.content_hash, b.content_hash);
  assertEquals(a.routes[0].route_ceiling_usd, 0.40);
});

Deno.test("an unfiltered sweep is refused at plan validation (1e52d43c attempt 4: queries [] and nothing else)", () => {
  const p = buildRetrievalPlan(build(execPlan({ mode: "companies" })));
  assert(p.routes[0].refused?.startsWith("non_narrowing_query"), String(p.routes[0].refused));
});

// ── amendments ──────────────────────────────────────────────────────────────

Deno.test("an identical proposal is not a new version", () => {
  const v1 = buildRetrievalPlan(build(execPlan(Q1)));
  const d = amendRetrievalPlan(v1, { build: build(execPlan(Q1)), trigger: "insufficient_candidates", component: "retrieval_controller", rationale: "", reserve_remaining_usd: 0.3 });
  assertFalse(d.accepted);
  assertEquals((d as { reason: string }).reason, "no_change");
});

Deno.test("a query change needs a semantic trigger and reserve, and produces version 2 with named changes", () => {
  const v1 = buildRetrievalPlan(build(execPlan(Q1)));
  const next = build(execPlan({ ...Q1, queries: [] }));
  const ok = amendRetrievalPlan(v1, { build: next, trigger: "insufficient_candidates", component: "retrieval_controller", rationale: "thin pool", reserve_remaining_usd: 0.3 });
  assert(ok.accepted);
  assertEquals(ok.plan.version, 2);
  assertEquals(ok.plan.amendment?.trigger, "insufficient_candidates");
  assert(ok.plan.amendment!.changes.some((c) => c.path.endsWith(".queries") && c.kind === "semantic"));

  const operational = amendRetrievalPlan(v1, { build: next, trigger: "provider_limit", component: "budget_policy", rationale: "", reserve_remaining_usd: 0.3 });
  assertFalse(operational.accepted);
  assertEquals((operational as { reason: string }).reason, "trigger_cannot_change_semantics");

  const noReserve = amendRetrievalPlan(v1, { build: next, trigger: "insufficient_candidates", component: "retrieval_controller", rationale: "", reserve_remaining_usd: 0 });
  assertFalse(noReserve.accepted);
  assertEquals((noReserve as { reason: string }).reason, "adaptive_reserve_exhausted");
});

Deno.test("an operational trigger may change only counts", () => {
  const v1 = buildRetrievalPlan(build(execPlan(Q1, 5)));
  const d = amendRetrievalPlan(v1, { build: build(execPlan(Q1, 3)), trigger: "provider_limit", component: "budget_policy", rationale: "", reserve_remaining_usd: 0 });
  assert(d.accepted, JSON.stringify(d));
  assert(d.plan.amendment!.changes.every((c) => c.kind === "operational"));
});

Deno.test("a replan's new route is an adjacent route in the next version", () => {
  const v1 = buildRetrievalPlan(build(execPlan(Q1)));
  const d = amendRetrievalPlan(v1, {
    build: build(execPlan(Q1), [{ capability: "startup_company_discovery", provider: "apify_yc_companies_memo23", input: { ...Q1, queries: ["SaaS platform"] }, purpose: "adjacent" }]),
    trigger: "insufficient_candidates", component: "retrieval_controller", rationale: "", reserve_remaining_usd: 0.3,
  });
  assert(d.accepted);
  assertEquals(d.plan.routes.length, 2);
  assertEquals(d.plan.routes[1].query_families[0].purpose, "adjacent");
});

// ── ceilings ────────────────────────────────────────────────────────────────

Deno.test("reserve refuses at the call, candidate, route and mission ceilings — before anything runs", () => {
  const l = newSpendLedger(resolveCeilings(null));
  const call = reserve(l, { idempotency_key: "k1", provider_call_id: "p1", purpose: "identity", route_id: null, estimate_usd: 0.061 });
  assertFalse(call.ok); assertEquals((call as { ceiling: string }).ceiling, "call");

  const l2 = newSpendLedger(resolveCeilings(null));
  assert(reserve(l2, { idempotency_key: "a", provider_call_id: "a", purpose: "identity", route_id: null, candidate_keys: ["mux"], estimate_usd: 0.03 }).ok);
  assert(reserve(l2, { idempotency_key: "b", provider_call_id: "b", purpose: "enrichment", route_id: null, candidate_keys: ["mux"], estimate_usd: 0.03 }).ok);
  const cand = reserve(l2, { idempotency_key: "c", provider_call_id: "c", purpose: "hiring_evidence", route_id: null, candidate_keys: ["mux"], estimate_usd: 0.01 });
  assertFalse(cand.ok); assertEquals((cand as { ceiling: string }).ceiling, "candidate");

  const l3 = newSpendLedger(resolveCeilings(null));
  assert(reserve(l3, { idempotency_key: "d1", provider_call_id: "d1", purpose: "discovery", route_id: "r", route_anchor: "company_profile", estimate_usd: 0.30 }).ok);
  const route = reserve(l3, { idempotency_key: "d2", provider_call_id: "d2", purpose: "discovery", route_id: "r", route_anchor: "company_profile", estimate_usd: 0.15 });
  assertFalse(route.ok); assertEquals((route as { ceiling: string }).ceiling, "route");

  const l4 = newSpendLedger(resolveCeilings({ mission_provider_usd: 0.05 }));
  const mission = reserve(l4, { idempotency_key: "m", provider_call_id: "m", purpose: "discovery", route_id: "r", route_anchor: "company_profile", estimate_usd: 0.06 });
  assertFalse(mission.ok);

  assertEquals(resolveCeilings(null, true).mission_provider_usd, 1.50, "canary ceiling");
  assertEquals(DEFAULT_CEILINGS.adaptive_reserve_usd, 0.30);
});

Deno.test("reserving the same idempotency key twice commits once", () => {
  const l = newSpendLedger(resolveCeilings(null));
  reserve(l, { idempotency_key: "k", provider_call_id: "p", purpose: "identity", route_id: null, estimate_usd: 0.02 });
  reserve(l, { idempotency_key: "k", provider_call_id: "p", purpose: "identity", route_id: null, estimate_usd: 0.02 });
  assertEquals(spendTotals(l).mission_committed_usd, 0.02);
});

// ── settlement against the audited run's real receipts ─────────────────────

Deno.test("settlement from provider receipts reproduces 1e52d43c's real bill within 2% (the ledger did not)", async () => {
  const runs = JSON.parse(Deno.readTextFileSync(new URL("../../fixtures/lead-v2/run-1e52d43c/apify_runs.json", import.meta.url))) as Record<string, { run: { usageTotalUsd: number; status: string } }>;
  const ledgerRows = JSON.parse(Deno.readTextFileSync(new URL("../../fixtures/lead-v2/run-1e52d43c/lead_execution_calls.json", import.meta.url))) as Array<Record<string, unknown>>;
  const l = newSpendLedger(resolveCeilings({ mission_provider_usd: 100, per_call_usd: {}, per_route_usd: {} }));
  for (const [runId] of Object.entries(runs)) {
    const row = ledgerRows.find((r) => r.provider_run_id === runId);
    reserve(l, { idempotency_key: runId, provider_call_id: runId, purpose: "discovery", route_id: null, estimate_usd: 0.001 });
    markExecuted(l, runId, Number(row?.actual_cost_usd ?? 0));
  }
  const provisional = spendTotals(l).provisional_usd;
  assertAlmostEquals(provisional, 0.2463, 0.002, "what the old ledger recorded");
  const r = await settlementPass(l, (res) => Promise.resolve(runs[res.idempotency_key]?.run ?? null));
  assertEquals(r.unsettled, 0);
  const settled = spendTotals(l).settled_usd;
  const billed = Object.values(runs).reduce((n, x) => n + Number(x.run.usageTotalUsd), 0);
  assert(Math.abs(settled - billed) / billed <= 0.02, `settled ${settled} vs billed ${billed}`);
  assertAlmostEquals(billed, 0.5902, 5e-4);
  assert(l.reservations.every((x) => x.settlement_source === "provider_receipt" && x.variance_usd !== null));
});

// ── trace ───────────────────────────────────────────────────────────────────

Deno.test("the trace is append-only, ordered, frozen and never silently truncated", () => {
  const t = newMissionTrace();
  const e1 = appendTrace(t, "retrieval_plan_created", { a: 1 }, { plan_version: 1 });
  appendTrace(t, "spec_compiled", { b: 2 }, { provider_call_id: "pc_1" });
  assertEquals(t.events.map((e) => e.seq), [1, 2]);
  let threw = false;
  try { (e1 as { type: string }).type = "x"; } catch { threw = true; }
  assert(threw || e1.type === "retrieval_plan_created");
  for (let i = 0; i < MISSION_TRACE_CAP + 5; i++) appendTrace(t, "call_reserved", {});
  assertEquals(t.events.length, MISSION_TRACE_CAP);
  assertEquals(t.dropped, 7);
  assertEquals(t.events[0].seq, 8, "sequence numbers survive truncation");
});
