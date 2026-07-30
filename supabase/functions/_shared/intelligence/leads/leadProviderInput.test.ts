// PROVIDER-INPUT SNAPSHOTS — what the existing adapters would actually receive.
//
// Claude returns SEMANTICS. This suite pins the neutral, provider-native-bound
// input the compiler derives from an accepted strategy, across a spread of roles,
// verticals and countries that the deterministic parser does NOT understand — which
// is the whole reason Phase 2 exists.
//
// The recorded `planHash` is the snapshot. A change to sorting, de-duplication,
// clamping or geography handling moves it, and this suite fails loudly rather than
// letting provider input drift silently underneath idempotency and cost forecasting.
//
// The planner is MOCKED. ZERO live model calls, ZERO provider calls (no Apify, no
// Firecrawl), ZERO database access, ZERO deployment.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildLeadMission, type LeadSourcingMission } from "./leadMission.ts";
import { planInitialLeadSourcing } from "./leadPlanner.ts";
import { parseLeadStrategy, type LeadInitialStrategy } from "./leadStrategy.ts";
import { compileDeterministicPlan } from "./leadStrategyCompiler.ts";
import { registryFallbackTitles } from "./leadStrategyValidation.ts";
import type { GenerateJsonFn } from "../plannerWrapper.ts";
import type { GenerateResult } from "../../aiProvider.ts";

function mission(instruction: string): LeadSourcingMission {
  return buildLeadMission({
    missionId: "m-snap", workspaceId: "ws-1",
    originalInstruction: instruction, environmentMode: "test", workflow: null,
  });
}

const mock = (json: unknown): GenerateJsonFn => async (): Promise<GenerateResult> => ({
  ok: true, content: JSON.stringify(json), json, provider: "anthropic", model: "claude-test", latencyMs: 3,
});

/** A strategy that proposes exactly the titles the mission already authorises. */
function strategyFor(m: LeadSourcingMission, titles: string[]): LeadInitialStrategy {
  const locations = m.company_target.geography.explicit_raw_locations;
  const searches: LeadInitialStrategy["searches"] = [{
    purpose: "discover_hiring_companies", capability_key: "jobs_search",
    titles, locations, result_target: 25, rationale: "Companies hiring this role now.",
  }];
  if (m.decision_maker.roles.length > 0) {
    searches.push({
      purpose: "find_decision_makers", capability_key: "contact_enrichment",
      titles: m.decision_maker.roles, locations, result_target: 10,
      rationale: "Resolve the named decision maker.",
    });
  }
  return {
    role_ontology: {
      canonical_concept: m.hiring_role.function ?? "role", seniority: [],
      exact_titles: titles, safe_synonyms: [], adjacent_titles: [], excluded_titles: [],
    },
    company_interpretation: {
      verticals: m.company_target.verticals, company_types: [],
      positive_keywords: [], negative_keywords: [],
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

/** Registry keys the compiler may emit. Raw actor ids must never appear. */
const ADAPTER_KEYS = new Set([
  "apify_jobs", "apify_people_search", "apify_linkedin_company_details",
  "apify_linkedin_company_employees", "firecrawl_scrape_url",
]);

interface Scenario {
  name: string;
  query: string;
  /** Titles the planner proposes. Defaults to the registry's own resolution. */
  titles?: string[];
  expectLocations: string[];
  planHash: string;
}

// Recorded snapshots. Regenerate ONLY with a deliberate compiler change.
const SCENARIOS: Scenario[] = [
  {
    name: "1. Sales Operations in the United States",
    query: "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.",
    expectLocations: ["United States"],
    planHash: "1b5a04ff25ae253cd50556e7333ae434698a96166ebe61b445b782b4486ce769",
  },
  {
    name: "2. first salesperson in Germany",
    query: "Find manufacturers hiring their first salesperson in Germany. Return 5 qualified leads.",
    expectLocations: ["Germany"],
    planHash: "4f7fc8d7da52fef798d995cf818b97342491868fbe57ef07f99c20706353acfe",
  },
  {
    name: "3. MSSP sales leadership in the United Kingdom",
    query: "Find MSSPs hiring sales leadership in the United Kingdom. Return 5 qualified leads.",
    expectLocations: ["United Kingdom"],
    planHash: "518caaf349dc1c34d5d0abda71ca7ff422bac5472690a2c5353d7e64913b3584",
  },
  {
    name: "4. controls engineers in Texas",
    query: "Find automation integrators hiring controls engineers in Texas. Return 5 qualified leads.",
    titles: ["Controls Engineer", "Automation Engineer"],
    expectLocations: ["Texas"],
    planHash: "f670604ccf0b257fc17f7cc82a48f457181d23a76bbf596171b1447df4ffa00d",
  },
  {
    name: "5. clinical operations in France",
    query: "Find healthcare companies hiring clinical operations leaders in France. Return 5 qualified leads.",
    titles: ["Clinical Operations Manager", "Clinical Trial Manager"],
    expectLocations: ["France"],
    planHash: "f11c71c9cd38eab8b3da2b6aecc6e1f401c67b86f6c8f87c7753d4697014bc22",
  },
  {
    name: "6. grid engineers in India",
    query: "Find renewable energy companies hiring grid engineers in India. Return 5 qualified leads.",
    titles: ["Grid Engineer", "Power Systems Engineer"],
    expectLocations: ["India"],
    planHash: "daffb5c218eb524b24d7056c2a532c3ea3a73609b90217be94b5cfced9ed3c5d",
  },
  {
    name: "7. unknown niche technical role",
    query: "Find companies hiring a Quantum Photonics Integration Engineer in Eindhoven. Return 5 qualified leads.",
    titles: ["Quantum Photonics Integration Engineer"],
    expectLocations: ["Eindhoven"],
    planHash: "3d2639e898a0b269ec1c0373669cc1c56ee01f60ee6a241b4288ff9ad7f88381",
  },
];

for (const sc of SCENARIOS) {
  Deno.test(`SNAP ${sc.name}`, async () => {
    const m = mission(sc.query);
    const titles = sc.titles ?? registryFallbackTitles(m);
    assert(titles.length > 0, "precondition: the scenario must propose at least one title");

    const r = await planInitialLeadSourcing({
      mission: m, environment: "test", enabled: true, round: 1,
      generate: mock(envelope(strategyFor(m, titles))),
    });

    // The user's own geography survives compilation, whatever the parser knew.
    for (const s of r.plan.searches) {
      assertEquals(s.locations, sc.expectLocations, `${sc.name}: locations`);
      assert(ADAPTER_KEYS.has(s.actorKey), `${sc.name}: unknown adapter key ${s.actorKey}`);
      assert(s.limit > 0 && s.limit <= 25, `${sc.name}: limit ${s.limit} out of bounds`);
    }

    // No credential, actor implementation id or URL reaches provider input.
    const blob = JSON.stringify(r.plan);
    for (const marker of ["harvestapi/", "curious_coder/", "api_key", "Bearer", "https://", "http://"]) {
      assert(!blob.includes(marker), `${sc.name}: compiled plan leaked ${marker}`);
    }

    if (sc.planHash) assertEquals(r.plan.planHash, sc.planHash, `${sc.name}: provider input drifted`);
    else console.log(`RECORD ${sc.name} -> ${r.plan.planHash} (source=${r.source})`);
  });
}

Deno.test("SNAP 8. deterministic fallback", async () => {
  const q = "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
  const m = mission(q);
  const r = await planInitialLeadSourcing({ mission: m, environment: "test", enabled: false });
  assertEquals(r.source, "deterministic_registry");

  // Identical to compiling the registry plan directly — the fallback adds nothing.
  const direct = await compileDeterministicPlan(m, registryFallbackTitles(m), "test");
  assert(direct.ok);
  assertEquals(r.plan.planHash, direct.plan.planHash);
  console.log(`RECORD 8. deterministic fallback -> ${r.plan.planHash}`);
});

// ============================================ ordering and duplicate stability ===

Deno.test("SNAP determinism: emitted order and duplicates do not change provider input", async () => {
  const q = "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
  const m = mission(q);
  const titles = registryFallbackTitles(m);

  const a = await planInitialLeadSourcing({
    mission: m, environment: "test", enabled: true, generate: mock(envelope(strategyFor(m, titles))),
  });
  const shuffled = [...titles].reverse();
  const b = await planInitialLeadSourcing({
    mission: m, environment: "test", enabled: true,
    generate: mock(envelope(strategyFor(m, [...shuffled, ...shuffled]))),
  });

  assertEquals(a.source, "claude");
  assertEquals(b.source, "claude");
  assertEquals(b.plan.planHash, a.plan.planHash, "order/duplicates must not change the compiled plan");
  assertEquals(JSON.stringify(b.plan.searches), JSON.stringify(a.plan.searches));
});

// ==================================== the output contract Claude cannot express ===

Deno.test("SNAP the planner cannot change the count, output entity or quota policy", async () => {
  const q = "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
  const m = mission(q);
  assertEquals(m.output, { requested_count: 5, count_entity: "contact_ready_lead", quota_policy: "contact_only" });

  // A strategy that tries to restate the output contract. These fields have no home
  // in LeadInitialStrategy, so the parser drops them rather than carrying them
  // forward — the guarantee is structural, not a check that could be forgotten.
  const hostile = {
    ...strategyFor(m, registryFallbackTitles(m)),
    requested_count: 500,
    count_entity: "account",
    quota_policy: "contact_and_watch",
    output: { requested_count: 500, count_entity: "account", quota_policy: "contact_and_watch" },
  };
  const parsed = parseLeadStrategy(hostile);
  assert(parsed.ok);
  const blob = JSON.stringify(parsed.strategy);
  for (const leaked of ["requested_count", "count_entity", "quota_policy", "500"]) {
    assert(!blob.includes(leaked), `strategy retained ${leaked}`);
  }

  const r = await planInitialLeadSourcing({
    mission: m, environment: "test", enabled: true, generate: mock(envelope(hostile as LeadInitialStrategy)),
  });
  assertEquals(r.source, "claude", "the extra keys are dropped, not treated as an attack");
  assertEquals(m.output.requested_count, 5, "the mission's count is untouched");
  assertEquals(m.output.quota_policy, "contact_only");
});

Deno.test("SNAP a credential-bearing strategy is blocked and falls back", async () => {
  const q = "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
  const m = mission(q);
  const s = strategyFor(m, registryFallbackTitles(m));
  s.searches[0].rationale = "Use api_key sk-live-abcdef to reach the provider directly.";

  const r = await planInitialLeadSourcing({
    mission: m, environment: "test", enabled: true, generate: mock(envelope(s)),
  });
  assertEquals(r.source, "deterministic_registry");
  assert(
    String(r.fallbackReason).includes("credential"),
    `expected a credential block, got ${r.fallbackReason}`,
  );
  assert(!JSON.stringify(r.diagnostics).includes("sk-live-abcdef"), "diagnostics leaked the credential");
});
