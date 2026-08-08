// THE WHOLE ARCHITECTURE, OFFLINE, BEFORE ANY MONEY IS SPENT.
//
// The live query is run end-to-end with the REAL production facades and only
// `fetch` stubbed, so every claim below is about the code that will actually be
// deployed rather than about a mock of it:
//
//   LeadMission model call        reaches the model transport
//   mission_parser_source         gpt_validated | gpt_repaired
//   semantic classification       reaches the model transport
//   grounded brain                reaches the model transport
//   pool evaluation               reaches the model transport
//   multi-round                   reaches the model transport
//   required_signals              hiring
//   hiring_verification           scheduled
//   apify_linkedin_company_search allowed (the d589f07b provider-filter fix)
//   planner/executor contract     v1 ↔ v1, compatible
//   provider calls                0
//
// This is the gate the handoff defines: if any enabled model stage still comes
// back `model_not_allowed`, DO NOT DEPLOY.
//
// ZERO network, ZERO provider calls, ZERO model spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMissionCompilerBinding,
} from "../../../supabase/functions/_shared/leadMissionCompilerBinding.ts";
import {
  compileLeadMission,
} from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  buildCapabilityGraph,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  getLeadIntelligenceCapabilities,
} from "../../../supabase/functions/_shared/leadIntelligencePolicy.ts";
import {
  buildPaidExecutionPreflight, assertPaidExecutionAllowed,
} from "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts";
import {
  checkContractCompatibility, LEAD_INTELLIGENCE_CONTRACT_VERSION,
} from "../../../supabase/functions/_shared/leadRuntimeIdentity.ts";
import {
  DEFAULT_LEAD_INTELLIGENCE_MODEL,
} from "../../../supabase/functions/_shared/leadIntelligenceModel.ts";

const LIVE_QUERY =
  "Find 10 founders at B2B SaaS companies currently building or hiring their sales teams. " +
  "Save them to Signal Feed. Do not send outreach.";
const MY = "00000000-0000-0000-0000-000000000001";
const BOTH = `${MY},11111111-2222-4333-8444-555555555555`;

/** TEST's real flag configuration, as decoded from the secret digests. */
const TEST_ENV: Record<string, string> = {
  GPT_LEAD_MISSION_COMPILER: "true", GPT_LEAD_MISSION_COMPILER_WORKSPACES: BOTH,
  GROUNDED_COMPANY_BRAIN: "true", GROUNDED_COMPANY_BRAIN_WORKSPACES: BOTH,
  GROUNDED_COMPANY_BRAIN_MODE: "enforce",
  SEMANTIC_COMPANY_CLASSIFICATION: "true", SEMANTIC_COMPANY_CLASSIFICATION_WORKSPACES: BOTH,
  SEMANTIC_COMPANY_CLASSIFICATION_MAX_CALLS: "10",
  FULL_POOL_GROUNDED_EVALUATION: "true", FULL_POOL_GROUNDED_EVALUATION_WORKSPACES: BOTH,
  GPT_POOL_RANKING: "true", GPT_POOL_RANKING_WORKSPACES: BOTH, GPT_POOL_RANKING_MODE: "shadow",
  MULTI_ROUND_SOURCING: "true", MULTI_ROUND_SOURCING_WORKSPACES: BOTH,
};
const read = (k: string): string | undefined => TEST_ENV[k];

/** What a competent compiler returns for the live query. */
const MODEL_PROPOSAL = {
  requested_opportunity_count: 10,
  requested_contact_ready_count: null,
  company_types: ["B2B SaaS"],
  geographies: [],
  employee_range: { min: null, max: null },
  decision_maker_roles: ["Founder", "CEO", "Co-Founder"],
  hard_constraints: [],
  soft_preferences: [],
  preferred_signals: ["hiring"],
  adjacent_signals: [],
  excluded_signals: [],
  allowed_broadening: {
    role_families: [], company_types: [], geographies: [],
    employee_range: { min: null, max: null },
  },
  disallowed_broadening: [],
  required_evidence: ["current_hiring_activity"],
  required_capabilities: [
    "general_company_discovery",
    "known_company_identity_resolution",
    "company_details_enrichment",
    "external_hiring_verification",
    "company_semantic_evaluation",
    "portfolio_ranking",
  ],
  preferred_source_strategy: "company_first",
  evaluation_instructions:
    "Qualify a company only on evidence it is currently building or hiring a sales team.",
  founder_unlock_recommended: false,
  confidence: 0.9,
  unknowns: [],
};

interface WireCall { model: unknown }

/** Runs `fn` with `fetch` replaced by a stub that answers with `body`. */
async function offline(
  body: unknown, fn: () => Promise<unknown>,
): Promise<{ calls: WireCall[]; result: unknown }> {
  const realFetch = globalThis.fetch;
  const realKey = Deno.env.get("LOVABLE_API_KEY");
  Deno.env.set("LOVABLE_API_KEY", "test-key-not-a-credential");
  const calls: WireCall[] = [];

  globalThis.fetch = ((_u: string, init: RequestInit) => {
    calls.push({ model: JSON.parse(String(init.body)).model });
    return Promise.resolve(
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  }) as typeof fetch;

  try {
    return { calls, result: await fn() };
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) Deno.env.delete("LOVABLE_API_KEY");
    else Deno.env.set("LOVABLE_API_KEY", realKey);
  }
}

// ══════════════════════════ 1. the mission is genuinely model-compiled ══

Deno.test("1. the LeadMission model call reaches transport and the mission is model-compiled", async () => {
  const binding = buildMissionCompilerBinding({ workspaceId: MY, read });
  assert(binding.proposeMission, "the compiler must be enabled for My Company");

  const { calls, result: proposal } = await offline(MODEL_PROPOSAL, () =>
    binding.proposeMission!({ originalUserQuery: LIVE_QUERY, requestedCount: 10 })
  );

  // The transport was reached with the canonical id — not refused beforehand.
  assertEquals(calls.length, 1, "exactly one compiler call must reach the transport");
  assertEquals(calls[0].model, DEFAULT_LEAD_INTELLIGENCE_MODEL);
  assert(proposal !== null, "a successful model call must yield a proposal");

  const compiled = compileLeadMission({
    originalUserQuery: LIVE_QUERY, requestedCount: 10, proposal,
  });

  // THE CLAIM THAT MATTERS. `deterministic_fallback` here would mean the model
  // contributed nothing, whatever else the mission looks like.
  assert(
    compiled.parser_source === "gpt_validated" || compiled.parser_source === "gpt_repaired",
    `parser_source was ${compiled.parser_source}; the model did not compile this mission`,
  );
});

// The negative control. Without it, test 1 could pass on a compiler that is
// wired to nothing — this proves the assertion is actually load-bearing.
Deno.test("2. with no proposal the same input is deterministic_fallback", () => {
  const compiled = compileLeadMission({
    originalUserQuery: LIVE_QUERY, requestedCount: 10, proposal: null,
  });
  assertEquals(compiled.parser_source, "deterministic_fallback");
});

// ══════════════════════════ 3. the mission the run will execute ══

Deno.test("3. required_signals carries hiring and hiring_verification is scheduled", async () => {
  const binding = buildMissionCompilerBinding({ workspaceId: MY, read });
  const { result: proposal } = await offline(MODEL_PROPOSAL, () =>
    binding.proposeMission!({ originalUserQuery: LIVE_QUERY, requestedCount: 10 })
  );
  const mission = compileLeadMission({
    originalUserQuery: LIVE_QUERY, requestedCount: 10, proposal,
  }).final_mission;

  assert(
    mission.required_signals.some((s) => s.type === "hiring"),
    `required_signals held ${JSON.stringify(mission.required_signals.map((s) => s.type))}`,
  );

  const graph = buildCapabilityGraph(mission);
  const scheduled = graph.steps.map((s) => s.capability);
  assert(
    scheduled.includes("hiring_verification"),
    `hiring_verification not scheduled; scheduled = ${JSON.stringify(scheduled)}`,
  );
});

// ══════════════════════════ 4. the provider-filter regression (d589f07b) ══

Deno.test("4. apify_linkedin_company_search stays allowed for its scheduled capabilities", async () => {
  const binding = buildMissionCompilerBinding({ workspaceId: MY, read });
  const { result: proposal } = await offline(MODEL_PROPOSAL, () =>
    binding.proposeMission!({ originalUserQuery: LIVE_QUERY, requestedCount: 10 })
  );
  const mission = compileLeadMission({
    originalUserQuery: LIVE_QUERY, requestedCount: 10, proposal,
  }).final_mission;

  const graph = buildCapabilityGraph(mission);
  assert(
    graph.allowed_providers.includes("apify_linkedin_company_search"),
    "the entry capability's own provider must not be removed because a " +
      "PROHIBITED capability also lists it — that was the live block",
  );
});

// ══════════════════════════ 5. architecture, contract and preflight ══

Deno.test("5. new_architecture, contract v1 ↔ v1, preflight ok, zero provider calls", async () => {
  const caps = getLeadIntelligenceCapabilities(MY, read);
  assertEquals(caps.mode, "new_architecture", `intelligence mode was ${caps.mode}`);

  const compat = checkContractCompatibility(LEAD_INTELLIGENCE_CONTRACT_VERSION);
  assertEquals(LEAD_INTELLIGENCE_CONTRACT_VERSION, "v1");
  assert(compat.ok, "planner and executor contracts must be compatible");
  assertEquals((compat as { executor_version: string }).executor_version, "v1");

  const binding = buildMissionCompilerBinding({ workspaceId: MY, read });
  const { result: proposal } = await offline(MODEL_PROPOSAL, () =>
    binding.proposeMission!({ originalUserQuery: LIVE_QUERY, requestedCount: 10 })
  );
  const compiled = compileLeadMission({
    originalUserQuery: LIVE_QUERY, requestedCount: 10, proposal,
  });

  // The mission as pilot-chat actually persists it: `mission_parser_source`
  // carried ON the mission, which is what the preflight reads.
  const mission = {
    ...compiled.final_mission,
    mission_parser_source: compiled.parser_source,
  };
  const graph = buildCapabilityGraph(mission);

  const preflight = buildPaidExecutionPreflight({
    mission, plan: graph,
    firstProvider: graph.allowed_providers[0] ?? null, firstProviderCompileOk: true,
    intelligence: caps,
    contract: compat,
  });
  assertPaidExecutionAllowed(preflight);
  assertEquals(preflight.blocked, [], "nothing may block paid execution");
});

// ══════════════════════════ 6. every enabled model stage, in one run ══

// The summary line the handoff asks for. Each stage is driven through its REAL
// facade; a stage still answering `model_not_allowed` shows up as zero calls.
Deno.test("6. all five enabled model stages reach the transport", async () => {
  const { buildGroundedBrainBinding } = await import(
    "../../../supabase/functions/_shared/groundedBrainBinding.ts"
  );
  const { buildSemanticClassificationBinding } = await import(
    "../../../supabase/functions/_shared/semanticClassificationBinding.ts"
  );
  const { buildPoolBinding } = await import(
    "../../../supabase/functions/_shared/poolEvaluationBinding.ts"
  );
  const { buildMultiRoundBinding } = await import(
    "../../../supabase/functions/_shared/multiRoundBinding.ts"
  );
  const { buildEvidenceRegistry } = await import(
    "../../../supabase/functions/_shared/leadEvidenceRegistry.ts"
  );
  const { buildCompanyEvidence } = await import(
    "../../../supabase/functions/_shared/leadCompanyEvidence.ts"
  );
  const { normalizeLinkedInJob } = await import(
    "../../../supabase/functions/_shared/hiringActorNormalizers.ts"
  );
  const { newMultiRoundState } = await import(
    "../../../supabase/functions/_shared/multiRoundState.ts"
  );
  const { parseLeadMissionDeterministic } = await import(
    "../../../supabase/functions/_shared/leadMission.ts"
  );

  const registry = buildEvidenceRegistry({
    evidence: buildCompanyEvidence({
      company_key: "acme", source_capability: "startup_company_discovery",
      company: {
        external_source_id: "acme", company_name: "Acme", canonical_domain: "acme.com",
        linkedin_company_url: "https://www.linkedin.com/company/acme",
        website: "https://acme.com", description: "Acme sells design software.",
        provider_industry: "Software Development",
        industry_ids: [{ id: "4", name: "B2B SaaS", hierarchy: "Tech" }],
        employee_count: 60, employee_range_advisory: null, geography: "United States",
        company_type: null, startup_evidence: null, hiring_status: true,
        source_provenance: "harvestapi/linkedin-company", field_trust: {},
        missing_fields: [], raw_ref: { actor_key: "x", source_id: "x" },
      } as never,
      identity_state: "resolved" as never,
      linkedin_company_url: "https://www.linkedin.com/company/acme",
    }),
    jobs: [normalizeLinkedInJob({
      id: "1", title: "Head of Sales", linkedinUrl: "https://x/1",
      postedDate: "2026-08-01",
      company: { id: 1, name: "Acme", linkedinUrl: "https://www.linkedin.com/company/acme" },
    })],
    now: Date.parse("2026-08-08T00:00:00Z"),
  });

  const stages: Array<[string, () => Promise<unknown>]> = [
    ["mission compiler", () => {
      const b = buildMissionCompilerBinding({ workspaceId: MY, read });
      return b.proposeMission!({ originalUserQuery: LIVE_QUERY, requestedCount: 10 });
    }],
    ["semantic classification", () => {
      const b = buildSemanticClassificationBinding({
        workspaceId: MY, read, requestedLeadCount: 10, qualifiedCompanies: 0,
      } as never);
      return b.classifyCompanyEvidence!({ company_key: "acme" });
    }],
    ["grounded brain", () => {
      const b = buildGroundedBrainBinding({
        workspaceId: MY, read, originalUserQuery: LIVE_QUERY, callsRemaining: 5,
      } as never);
      return b.groundCompany!({ registry, requiresCommercialSignal: true });
    }],
    ["pool evaluation", () => {
      const b = buildPoolBinding({ workspaceId: MY, read, originalUserQuery: LIVE_QUERY });
      return b.rankPool!({
        summaries: [{ company_key: "acme", company_name: "Acme" } as never],
        requestedCount: 10, unevaluatedCount: 0,
      });
    }],
    ["multi-round", () => {
      const b = buildMultiRoundBinding({ workspaceId: MY, read });
      return b.planNextRound!({
        mission: parseLeadMissionDeterministic(LIVE_QUERY),
        state: newMultiRoundState({ requestedCount: 10 }),
        remainingBudgetClass: "ample", remainingDeadlineClass: "ample",
      } as never);
    }],
  ];

  const reached: string[] = [];
  for (const [name, drive] of stages) {
    const { calls } = await offline(MODEL_PROPOSAL, drive);
    assertEquals(calls.length, 1, `${name} did not reach the model transport`);
    assertEquals(calls[0].model, DEFAULT_LEAD_INTELLIGENCE_MODEL, `${name} sent a non-canonical id`);
    reached.push(name);
  }

  assertEquals(reached.length, 5, "all five enabled model stages must reach transport");
});
