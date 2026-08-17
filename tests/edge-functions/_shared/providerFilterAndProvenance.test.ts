// TWO DEFECTS THE FIRST SUCCESSFUL LIVE RUN EXPOSED (task dc87ffa1).
//
// 1. PROHIBITING A CAPABILITY DISARMED A SCHEDULED ONE. `allowed_providers`
//    subtracted any provider that also appeared under a prohibited capability.
//    Providers implement several capabilities, so `apify_linkedin_company_search`
//    — required by `general_company_discovery` (scheduled) — was removed because
//    `expansion_signal_discovery` (prohibited) also lists it. The entry
//    capability lost its own provider and the run was refused.
//
// 2. DIRECTIVES WERE MISTAKEN FOR MODEL COMPILATION. `compileLeadMission`
//    emits a directives object on the deterministic path too, so a mission the
//    model never touched looked canonical: directives present, hiring signal
//    present, confidence 0.6.
//
// ZERO network, provider, model or database access.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCapabilityGraph, CAPABILITY_REGISTRY,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  getLeadIntelligenceCapabilities,
} from "../../../supabase/functions/_shared/leadIntelligencePolicy.ts";
import {
  buildPaidExecutionPreflight, assertPaidExecutionAllowed,
} from "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts";
import {
  checkContractCompatibility, LEAD_INTELLIGENCE_CONTRACT_VERSION,
} from "../../../supabase/functions/_shared/leadRuntimeIdentity.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

const LIVE_QUERY =
  "Find 10 founders at B2B SaaS companies currently building or hiring their sales teams";
const MY = "00000000-0000-0000-0000-000000000001";
const BOTH = `${MY},11111111-2222-4333-8444-555555555555`;
const newArchEnv = (k: string) => ({
  GPT_LEAD_MISSION_COMPILER: "true", GPT_LEAD_MISSION_COMPILER_WORKSPACES: BOTH,
  GROUNDED_COMPANY_BRAIN: "true", GROUNDED_COMPANY_BRAIN_WORKSPACES: BOTH,
  GROUNDED_COMPANY_BRAIN_MODE: "enforce",
  FULL_POOL_GROUNDED_EVALUATION: "true", FULL_POOL_GROUNDED_EVALUATION_WORKSPACES: BOTH,
  GPT_POOL_RANKING: "true", GPT_POOL_RANKING_WORKSPACES: BOTH, GPT_POOL_RANKING_MODE: "shadow",
  MULTI_ROUND_SOURCING: "true", MULTI_ROUND_SOURCING_WORKSPACES: BOTH,
}[k]);

function missionWith(over: Partial<LeadMissionV1> = {}): LeadMissionV1 {
  const base = parseLeadMissionDeterministic(LIVE_QUERY, { requestedCount: 10 });
  return {
    ...base,
    directives: {
      preferred_signals: ["hiring"], adjacent_signals: [], excluded_signals: [],
      required_evidence: [], disallowed_broadening: [],
      allowed_broadening: {
        role_families: [], company_types: [], geographies: [],
        employee_range: { min: null, max: null },
      },
      evaluation_instructions: "", source_strategy: [],
      requested_contact_ready_count: null, founder_unlock_recommended: true,
    },
    lead_intelligence_contract_version: LEAD_INTELLIGENCE_CONTRACT_VERSION,
    ...over,
  } as LeadMissionV1;
}

// ══════════════════════════ 1. the provider filter ══

Deno.test("1. LIVE REGRESSION: a prohibited capability cannot disarm a scheduled one", () => {
  // The exact live shape: the provider is shared between two scheduled
  // capabilities and one prohibited one.
  const shared = "apify_linkedin_company_search";
  assert(CAPABILITY_REGISTRY.general_company_discovery.providers.includes(shared));
  assert(CAPABILITY_REGISTRY.company_identity_resolution.providers.includes(shared));
  assert(CAPABILITY_REGISTRY.expansion_signal_discovery.providers.includes(shared),
    "the prohibited capability really does share this provider");

  const graph = buildCapabilityGraph(missionWith());
  assert(graph.steps.some((s) => String(s.capability) === "general_company_discovery"));
  assert((graph.prohibited as readonly string[]).includes("expansion_signal_discovery"),
    "expansion_signal_discovery is prohibited, as it was live");

  // THE DEFECT: this was false, and the run was refused before spending.
  assert(graph.allowed_providers.includes(shared),
    "a provider required by a scheduled capability must stay allowed");

  // And the preflight that blocked task dc87ffa1 now passes on that point.
  const pf = buildPaidExecutionPreflight({
    mission: missionWith(), plan: graph,
    firstProvider: shared, firstProviderCompileOk: true,
  });
  assertFalse(pf.blocked.some((b) => b.code === "provider_not_in_plan"),
    "the live block code must not fire for a scheduled capability's own provider");
});

Deno.test("2. a provider only prohibited capabilities use never enters the plan", () => {
  const graph = buildCapabilityGraph(missionWith());
  const scheduled = new Set(graph.steps.flatMap((s) => s.providers));
  // Every allowed provider is required by some scheduled step — nothing leaks
  // in from a prohibited capability.
  for (const p of graph.allowed_providers) {
    assert(scheduled.has(p), `${p} is allowed but no scheduled step needs it`);
  }
  // People providers stay unreachable: their capabilities are not scheduled.
  for (const p of ["apify_linkedin_company_employees", "apify_people_search"]) {
    assertFalse(graph.allowed_providers.includes(p),
      `${p} must not be reachable — no scheduled step requires it`);
  }
});

Deno.test("3. a provider shared by two scheduled capabilities appears once", () => {
  const graph = buildCapabilityGraph(missionWith());
  const counts = new Map<string, number>();
  for (const p of graph.allowed_providers) counts.set(p, (counts.get(p) ?? 0) + 1);
  for (const [p, n] of counts) assertEquals(n, 1, `${p} must be deduplicated`);
});

Deno.test("4. capability-level containment is unchanged", () => {
  // The subtraction was removed, so this is the property that must still hold:
  // a prohibited capability is still prohibited and still schedules nothing.
  const graph = buildCapabilityGraph(missionWith());
  for (const c of ["expansion_signal_discovery", "founder_discovery", "contact_enrichment"]) {
    assert((graph.prohibited as readonly string[]).includes(c), `${c} still prohibited`);
    assertFalse(graph.steps.some((s) => String(s.capability) === c),
      `${c} must not be scheduled`);
  }
});

// ═════════════════════ 5. compiler provenance ══

Deno.test("5. directives alone are NOT proof the model contributed", () => {
  const policy = getLeadIntelligenceCapabilities(MY, newArchEnv);
  assertEquals(policy.mode, "new_architecture");
  assert(policy.expects_compiled_mission);

  // THE LIVE SHAPE: directives present, hiring signal present, but the compiler
  // says the model never contributed.
  const deterministic = missionWith({
    mission_parser_source: "deterministic_fallback",
  } as Partial<LeadMissionV1>);
  assert(deterministic.directives, "directives ARE present — that was the trap");

  const graph = buildCapabilityGraph(deterministic);
  const pf = buildPaidExecutionPreflight({
    mission: deterministic, plan: graph,
    firstProvider: graph.allowed_providers[0] ?? null, firstProviderCompileOk: true,
    intelligence: policy,
    contract: checkContractCompatibility(LEAD_INTELLIGENCE_CONTRACT_VERSION),
  });
  assertFalse(pf.ok, "a deterministically-compiled mission must not spend here");
  assert(pf.blocked.some((b) => b.code === "mission_not_model_compiled"));

  let threw = false;
  try { assertPaidExecutionAllowed(pf); } catch { threw = true; }
  assert(threw, "provider calls must be zero");
});

Deno.test("6. a model-compiled mission proceeds", () => {
  const policy = getLeadIntelligenceCapabilities(MY, newArchEnv);
  for (const source of ["gpt_validated", "gpt_repaired"] as const) {
    const mission = missionWith({ mission_parser_source: source } as Partial<LeadMissionV1>);
    const graph = buildCapabilityGraph(mission);
    const pf = buildPaidExecutionPreflight({
      mission, plan: graph,
      firstProvider: graph.allowed_providers[0] ?? null, firstProviderCompileOk: true,
      intelligence: policy,
      contract: checkContractCompatibility(LEAD_INTELLIGENCE_CONTRACT_VERSION),
    });
    assertFalse(pf.blocked.some((b) => b.code === "mission_not_model_compiled"),
      `${source} means the model contributed`);
    assert(pf.ok, `${source} must proceed, blocked: ${JSON.stringify(pf.blocked)}`);
  }
});

// ── INVERTED 2026-08-17 ────────────────────────────────────────────────────
//
// This asserted that a workspace with the compiler flag off could spend against
// a `deterministic_fallback` mission, because "deterministic compilation is the
// designed behaviour". That is the behaviour being removed: the flag was never
// set on the live project, so this exemption covered EVERY run, and on
// 2026-08-17 it let a regex reading of "AI startups" be spent against as though
// a model had produced it.
//
// The rule the old comment called "blunt" — always require a compiled mission —
// is now the architecture. So the assertion flips.
Deno.test("7. a deterministic mission is refused in EVERY workspace", () => {
  const deterministicWs = getLeadIntelligenceCapabilities(MY, () => undefined);
  assertEquals(deterministicWs.mode, "new_architecture", "one mode, everywhere");

  const mission = missionWith({
    mission_parser_source: "deterministic_fallback",
  } as Partial<LeadMissionV1>);
  const graph = buildCapabilityGraph(mission);
  const pf = buildPaidExecutionPreflight({
    mission, plan: graph,
    firstProvider: graph.allowed_providers[0] ?? null, firstProviderCompileOk: true,
    intelligence: deterministicWs, contract: null,
  });
  assert(
    pf.blocked.some((b) => b.code === "mission_not_model_compiled"),
    "spending against a mission the model did not produce must be refused, " +
    "whatever the workspace's legacy flags say",
  );
});

Deno.test("8. a mission predating the field is not retroactively accused", () => {
  // `mission_parser_source` absent means the planner predates this marker. The
  // other guards (contract version, directives) already cover that case; adding
  // a second accusation would double-report one problem.
  const policy = getLeadIntelligenceCapabilities(MY, newArchEnv);
  const mission = missionWith();
  assertEquals(mission.mission_parser_source, undefined);
  const graph = buildCapabilityGraph(mission);
  const pf = buildPaidExecutionPreflight({
    mission, plan: graph,
    firstProvider: graph.allowed_providers[0] ?? null, firstProviderCompileOk: true,
    intelligence: policy,
    contract: checkContractCompatibility(LEAD_INTELLIGENCE_CONTRACT_VERSION),
  });
  assertFalse(pf.blocked.some((b) => b.code === "mission_not_model_compiled"));
});
