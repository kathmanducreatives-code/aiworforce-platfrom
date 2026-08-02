// OFFLINE PROOFS for the authoritative initial strategy + honest bottlenecks.
// Mocked model responses only. No network, no provider, no database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyLeadStrategyInitialPlanning, isGptLeadStrategyEnabled, planHash,
} from "../../functions/_shared/leadStrategyBridge.ts";
import type { LeadStrategyModelFn } from "../../functions/_shared/leadStrategyModels.ts";
import { classifyBottleneck, emptyFunnelSummary, remedyFor } from "../../functions/_shared/sourcingBottleneck.ts";

const WS = "ws-canary";
const env = (over: Record<string, string> = {}) => (k: string) =>
  ({ GPT_LEAD_STRATEGY: "true", GPT_LEAD_STRATEGY_WORKSPACES: WS, ...over })[k];

const SPEC = {
  keyword_queries: ["Sales Operations Manager"],
  requested_person_roles: ["Founder", "CEO"],
  location: "United States",
  country: "US",
  original_query: "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.",
};

/** A validated strategy with THREE separate packs and a startup-first order. */
function goodPlan() {
  return {
    role_family: "revenue_operations",
    title_queries: ["Sales Operations Manager", "Revenue Operations Manager", "GTM Operations Manager"],
    excluded_titles: ["Warehouse Operations", "Retail Operations"],
    query_packs: [
      { pack_id: "exact_titles", queries: ["Sales Operations Manager"], rationale: "exact" },
      { pack_id: "yc_early_stage", queries: ["Revenue Operations Manager"], rationale: "startup employers" },
    ],
    source_plan: [
      { source_key: "yc_jobs", priority: 1, rationale: "startup-heavy" },
      { source_key: "linkedin_jobs", priority: 2, rationale: "coverage" },
      { source_key: "indeed_jobs", priority: 3, rationale: "volume" },
      { source_key: "glassdoor_jobs", priority: 4, rationale: "backfill" },
    ],
    next_action: "run_query_packs",
    stop_conditions: ["quota reached"],
    rationale: "startup-first",
    confidence: 0.8,
  };
}

function mockModel(
  byModel: Record<string, unknown | "fail">,
  seen: string[],
): LeadStrategyModelFn {
  return (call) => {
    seen.push(call.model);
    const r = byModel[call.model];
    if (r === undefined || r === "fail") {
      return Promise.resolve({
        ok: false, model: call.model, content: "", latencyMs: 1, errorCode: "provider_error",
      });
    }
    return Promise.resolve({ ok: true, model: call.model, json: r, content: "", latencyMs: 5 });
  };
}

Deno.test("1. Luna creates the authoritative initial strategy", async () => {
  const seen: string[] = [];
  const res = await applyLeadStrategyInitialPlanning({
    workspaceId: WS, spec: { ...SPEC }, requestedLeadCount: 5, readEnv: env(),
    callModel: mockModel({ "openai/gpt-5.6-luna": goodPlan() }, seen),
  });
  assertEquals(seen, ["openai/gpt-5.6-luna"]);
  assert(res.specRewritten);
  assertEquals(res.diagnostics?.authority, "openai_primary");
  assertEquals(res.diagnostics?.planner_source, "openai_lead_strategy");
  // Proof: the canonical query no longer begins on the deterministic path.
  assert(res.diagnostics?.strategy_status !== "deterministic_only");
  assert(String(res.diagnostics?.plan_hash).length === 8);
});

Deno.test("2+3. no Gemini and no Claude model is reachable from this path", async () => {
  const seen: string[] = [];
  await applyLeadStrategyInitialPlanning({
    workspaceId: WS, spec: { ...SPEC }, requestedLeadCount: 5, readEnv: env(),
    callModel: mockModel({ "openai/gpt-5.6-luna": goodPlan() }, seen),
  });
  assert(seen.every((m) => m.startsWith("openai/")));
  assert(!seen.some((m) => /gemini|claude|anthropic/i.test(m)));
});

Deno.test("4. Terra is called at most once after invalid Luna output", async () => {
  const seen: string[] = [];
  const res = await applyLeadStrategyInitialPlanning({
    workspaceId: WS, spec: { ...SPEC }, requestedLeadCount: 5, readEnv: env(),
    callModel: mockModel(
      { "openai/gpt-5.6-luna": { nonsense: true }, "openai/gpt-5.6-terra": goodPlan() },
      seen,
    ),
  });
  assertEquals(seen, ["openai/gpt-5.6-luna", "openai/gpt-5.6-terra"]);
  assertEquals(seen.filter((m) => m.includes("terra")).length, 1);
  assertEquals(res.diagnostics?.escalated, true);
  assertEquals(res.diagnostics?.authority, "openai_escalation");
});

Deno.test("5. deterministic fallback is final and never rewrites the spec", async () => {
  const seen: string[] = [];
  const res = await applyLeadStrategyInitialPlanning({
    workspaceId: WS, spec: { ...SPEC }, requestedLeadCount: 5, readEnv: env(),
    callModel: mockModel({}, seen),
  });
  assertEquals(seen.length, 2);                        // primary + one escalation, then stop
  assertEquals(res.specRewritten, false);
  assertEquals(res.spec.keyword_queries, SPEC.keyword_queries);
  assertEquals(res.diagnostics?.validation, "rejected");
  assert(res.diagnostics?.fallback_reason !== null);
});

Deno.test("6+7. separate query packs stay separate; no universal OR query", async () => {
  const res = await applyLeadStrategyInitialPlanning({
    workspaceId: WS, spec: { ...SPEC }, requestedLeadCount: 5, readEnv: env(),
    callModel: mockModel({ "openai/gpt-5.6-luna": goodPlan() }, []),
  });
  const packs = res.resolution!.plan.query_packs;
  assert(packs.length >= 2, "packs must not be flattened");
  assertEquals(new Set(packs.map((p) => p.pack_id)).size, packs.length);
  for (const p of packs) {
    for (const q of p.queries) {
      assert(!/\bOR\b/i.test(q), `pack ${p.pack_id} carries a merged OR query: ${q}`);
    }
  }
  assertEquals(res.diagnostics?.query_pack_ids, packs.map((p) => p.pack_id));
});

Deno.test("8. the startup fixture can order YC first", async () => {
  const res = await applyLeadStrategyInitialPlanning({
    workspaceId: WS, spec: { ...SPEC }, requestedLeadCount: 5, readEnv: env(),
    callModel: mockModel({ "openai/gpt-5.6-luna": goodPlan() }, []),
  });
  const order = res.diagnostics?.source_order as string[];
  assertEquals(order[0], "yc_jobs");
  assert(!order.some((s) => /ats/i.test(s)), "ATS is a verification capability, never discovery");
});

Deno.test("gate: flag off, missing allow-list and foreign workspace all stay inert", async () => {
  assertEquals(isGptLeadStrategyEnabled(WS, env({ GPT_LEAD_STRATEGY: "false" })).reason, "flag_off");
  assertEquals(isGptLeadStrategyEnabled(WS, env({ GPT_LEAD_STRATEGY_WORKSPACES: "" })).reason, "no_workspace_allowlist");
  assertEquals(isGptLeadStrategyEnabled("other", env()).reason, "workspace_not_allowed");

  const seen: string[] = [];
  const res = await applyLeadStrategyInitialPlanning({
    workspaceId: "other", spec: SPEC, requestedLeadCount: 5, readEnv: env(),
    callModel: mockModel({ "openai/gpt-5.6-luna": goodPlan() }, seen),
  });
  assertEquals(seen.length, 0, "an ineligible workspace must make zero model requests");
  assertEquals(res.diagnostics, null);
  assert(res.spec === SPEC, "the caller's own object is returned by reference");
});

Deno.test("plan hash is stable and content-sensitive", () => {
  assertEquals(planHash({ a: 1 }), planHash({ a: 1 }));
  assert(planHash({ a: 1 }) !== planHash({ a: 2 }));
});

// ------------------------------------------------------------- bottlenecks --

const ctx = { remainingQuota: 5, budgetRemaining: 10, expansionAvailable: true };

Deno.test("12. Indeed warehouse/retail noise is poor source precision, not title coverage", () => {
  const f = { ...emptyFunnelSummary(), raw_jobs: 60, unique_jobs: 60, job_family_pass: 0, off_family_jobs: 48 };
  const b = classifyBottleneck(f, ctx);
  assertEquals(b.kind, "poor_source_precision");
  assertEquals(remedyFor(b.kind), "advance to a more ICP-relevant source");

  const mild = { ...emptyFunnelSummary(), raw_jobs: 40, unique_jobs: 40, job_family_pass: 0, off_family_jobs: 12 };
  assertEquals(classifyBottleneck(mild, ctx).kind, "excessive_title_noise");

  const clean = { ...emptyFunnelSummary(), raw_jobs: 40, unique_jobs: 40, job_family_pass: 0, off_family_jobs: 0 };
  assertEquals(classifyBottleneck(clean, ctx).kind, "insufficient_title_coverage");
});

Deno.test("company_brain_rejection only when companies were genuinely evaluated", () => {
  const pending = {
    ...emptyFunnelSummary(), raw_jobs: 20, unique_jobs: 20, job_family_pass: 12,
    companies_qualified: 0, companies_evidence_pending: 4,
  };
  assertEquals(classifyBottleneck(pending, ctx).kind, "company_evidence_missing");
  assertEquals(remedyFor("company_evidence_missing"), "run company enrichment and re-evaluate Company Brain");

  const evaluated = {
    ...emptyFunnelSummary(), raw_jobs: 20, unique_jobs: 20, job_family_pass: 12,
    companies_qualified: 0, companies_evaluated: 6, companies_rejected: 6,
  };
  assertEquals(classifyBottleneck(evaluated, ctx).kind, "company_brain_rejection");

  const unresolved = {
    ...emptyFunnelSummary(), raw_jobs: 20, unique_jobs: 20, job_family_pass: 12,
    companies_qualified: 0, companies_missing_identity: 9,
  };
  assertEquals(classifyBottleneck(unresolved, ctx).kind, "insufficient_company_resolution");
});

Deno.test("decision-maker and contact coverage are distinct bottlenecks", () => {
  const noPeople = {
    ...emptyFunnelSummary(), raw_jobs: 20, unique_jobs: 20, job_family_pass: 10,
    companies_qualified: 5,
  };
  assertEquals(classifyBottleneck(noPeople, ctx).kind, "insufficient_decision_maker_coverage");

  const noContact = {
    ...emptyFunnelSummary(), raw_jobs: 20, unique_jobs: 20, job_family_pass: 10,
    companies_qualified: 5, people_calls: 3, profiles_returned: 9, person_role_pass: 4,
    employer_verified: 4, contact: 0,
  };
  assertEquals(classifyBottleneck(noContact, ctx).kind, "insufficient_contact_coverage");
});
