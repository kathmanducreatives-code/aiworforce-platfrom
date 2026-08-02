// PLAN COMPLETENESS — the gate that runs AFTER filtering.
//
// Every test here describes a strategy that passes validation and compiles
// "successfully", but compiles down to something that cannot do the job. Before
// this gate existed each one was accepted and recorded as a Claude-planned run
// while the workflow silently executed the deterministic keywords instead.
//
// The planner is MOCKED throughout. ZERO live model calls, ZERO provider calls
// (no Apify, no Firecrawl), ZERO database access.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildLeadMission, type LeadSourcingMission } from "../../supabase/functions/_shared/leadMission.ts";
import { planInitialLeadSourcing } from "../../supabase/functions/_shared/leadPlanner.ts";
import type { LeadInitialStrategy } from "../../supabase/functions/_shared/leadStrategy.ts";
import { applyClaudeFirstLeadPlanning, bridgeDiagnostics } from "../../supabase/functions/_shared/leadPlanningBridge.ts";
import type { GenerateJsonFn } from "../../supabase/functions/plannerWrapper.ts";
import type { GenerateResult } from "../../aiProvider.ts";

const PRIMARY =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";

function mission(instruction = PRIMARY): LeadSourcingMission {
  return buildLeadMission({
    missionId: "m-1", workspaceId: "ws-1",
    originalInstruction: instruction, environmentMode: "test", workflow: null,
  });
}

const mock = (json: unknown): GenerateJsonFn => async (): Promise<GenerateResult> => ({
  ok: true, content: JSON.stringify(json), json, provider: "anthropic", model: "claude-test", latencyMs: 4,
});

const DM_SEARCH = {
  purpose: "find_decision_makers" as const, capability_key: "contact_enrichment",
  titles: ["Founder", "Co-Founder", "CEO"], locations: ["United States"],
  result_target: 10, rationale: "Resolve the founder at each verified company.",
};

function strategy(searches: LeadInitialStrategy["searches"]): LeadInitialStrategy {
  return {
    role_ontology: {
      canonical_concept: "sales operations", department: "revenue", function: "sales_operations",
      seniority: [], exact_titles: ["Sales Operations", "Revenue Operations"],
      safe_synonyms: [], adjacent_titles: [], excluded_titles: [],
    },
    company_interpretation: {
      verticals: ["b2b_saas"], company_types: ["SaaS"], positive_keywords: [], negative_keywords: [],
    },
    searches,
    exclusions: { titles: [], companies: [], industries: [] },
    expected_funnel: {
      raw_results: 25, relevant_jobs: 15, qualified_companies: 9, verified_people: 7, contact_ready_leads: 5,
    },
    confidence: 0.9,
  };
}

function envelope(s: LeadInitialStrategy) {
  return {
    interpretation: { summary: "s", assumptions: [], ambiguities: [], confidence: 0.9 },
    strategy: s, constraints_preserved: [], requested_approvals: [], risks: [],
  };
}

const plan = (s: LeadInitialStrategy) =>
  planInitialLeadSourcing({
    mission: mission(), environment: "test", enabled: true, generate: mock(envelope(s)), round: 1,
  });

// ================================================================= the gate ====

Deno.test("PC1 an EXCLUDED-only discovery search cannot leave a plan with no discovery", async () => {
  // "Sales Manager" is registry-EXCLUDED for sales_operations, so the discovery
  // search loses its only title and is dropped. What compiled was a plan that
  // qualifies and contacts, but never discovers anyone to qualify.
  const r = await plan(strategy([
    {
      purpose: "discover_hiring_companies", capability_key: "jobs_search",
      titles: ["Sales Manager"], locations: ["United States"], result_target: 25, rationale: "r",
    },
    {
      purpose: "qualify_companies", capability_key: "company_research",
      titles: ["Sales Operations"], locations: ["United States"], result_target: 10, rationale: "r",
    },
    DM_SEARCH,
  ]));

  assertEquals(r.source, "deterministic_registry");
  assertEquals(r.fallbackReason, "plan_incomplete:no_executable_discover_hiring_companies");
  assert(
    r.plan.searches.some((s) => s.purpose === "discover_hiring_companies" && s.titles.length > 0),
    "the deterministic fallback must still discover",
  );
});

Deno.test("PC2 a discovery search carrying keywords but NO titles is not a discovery search", async () => {
  const r = await plan(strategy([
    {
      purpose: "discover_hiring_companies", capability_key: "jobs_search",
      keywords: ["hiring sales ops"], locations: ["United States"], result_target: 25, rationale: "r",
    },
    DM_SEARCH,
  ]));
  assertEquals(r.source, "deterministic_registry");
  assertEquals(r.fallbackReason, "plan_incomplete:no_executable_discover_hiring_companies");
});

Deno.test("PC3 every result target clamped to zero fetches nothing", async () => {
  const r = await plan(strategy([
    {
      purpose: "discover_hiring_companies", capability_key: "jobs_search",
      titles: ["Sales Operations"], locations: ["United States"], result_target: 0, rationale: "r",
    },
    { ...DM_SEARCH, result_target: 0 },
  ]));
  assertEquals(r.source, "deterministic_registry");
  assert(
    r.fallbackReason?.startsWith("plan_incomplete:"),
    `expected an incompleteness fallback, got ${r.fallbackReason}`,
  );
  assert(r.plan.forecast.maxResults > 0, "the deterministic fallback must fetch something");
});

Deno.test("PC4 a required decision-maker stage cannot be dropped to a title-less search", async () => {
  const r = await plan(strategy([
    {
      purpose: "discover_hiring_companies", capability_key: "jobs_search",
      titles: ["Sales Operations"], locations: ["United States"], result_target: 25, rationale: "r",
    },
    { ...DM_SEARCH, titles: [], result_target: 0 },
  ]));
  assertEquals(r.source, "deterministic_registry");
  assertEquals(r.fallbackReason, "plan_incomplete:no_executable_find_decision_makers");
});

// ================================================== the gate stays out of the way ==

Deno.test("PC5 a complete strategy is still accepted, unchanged", async () => {
  const r = await plan(strategy([
    {
      purpose: "discover_hiring_companies", capability_key: "jobs_search",
      titles: ["Sales Operations", "Revenue Operations"], locations: ["United States"],
      result_target: 25, rationale: "r",
    },
    DM_SEARCH,
  ]));
  assertEquals(r.source, "claude");
  assertEquals(r.fallbackReason, null);
  assert(r.plan.forecast.maxResults > 0);
});

Deno.test("PC6 a stage the deterministic baseline cannot execute is not required of the planner", async () => {
  // No decision-maker role is named, so the registry baseline plans no
  // decision-maker search either. A discovery-only Claude plan is PARITY with the
  // fallback, not a regression, and must not be rejected for a gap they share.
  const q = "Find SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
  const m = buildLeadMission({
    missionId: "m-2", workspaceId: "ws-1", originalInstruction: q, environmentMode: "test", workflow: null,
  });
  assertEquals(m.decision_maker.roles, [], "precondition: this request names no person to contact");

  const r = await planInitialLeadSourcing({
    mission: m, environment: "test", enabled: true, round: 1,
    generate: mock(envelope(strategy([
      {
        purpose: "discover_hiring_companies", capability_key: "jobs_search",
        titles: ["Sales Operations"], locations: ["United States"], result_target: 25, rationale: "r",
      },
    ]))),
  });
  assertEquals(r.source, "claude");
});

// ============================================== diagnostics stay internally consistent ==

Deno.test("PC7 an incomplete plan is never REPORTED as Claude-generated", async () => {
  // The failure this closes: the bridge left the deterministic keywords in place
  // (correctly), while the diagnostics recorded planner_source "claude", status
  // "ok" and no fallback reason — a run whose record disagreed with what it did.
  const s = strategy([
    {
      purpose: "discover_hiring_companies", capability_key: "jobs_search",
      keywords: ["hiring sales ops"], locations: ["United States"], result_target: 25, rationale: "r",
    },
    DM_SEARCH,
  ]);
  const spec = {
    keyword_queries: ["Sales Operations"], requested_person_roles: ["Founder"],
    location: null, country: null, original_query: PRIMARY,
  };
  const res = await applyClaudeFirstLeadPlanning({
    workspaceId: "ws-1", originalInstruction: PRIMARY, spec,
    missionId: "m-1", generate: mock(envelope(s)),
    readEnv: (k) =>
      k === "CLAUDE_FIRST_LEAD_PLANNING" ? "true"
        : k === "CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES" ? "ws-1"
        : k === "SUPABASE_URL" ? "https://zbwsbnqqpkvdhqwavjke.supabase.co"
        : undefined,
  });

  assertEquals(res.specRewritten, false, "the deterministic spec is what executes");

  const d = bridgeDiagnostics(res) as Record<string, unknown>;
  assert(d, "an eligible workspace must still produce diagnostics");
  assertEquals(d.planner_source, "deterministic_registry", "the record must match what ran");
  assert(String(d.fallback_reason ?? "").startsWith("plan_incomplete:"), `fallback_reason was ${d.fallback_reason}`);
  assertEquals(d.plan_hash, res.outcome?.plan.planHash, "the hash must be the executed plan's");
});
