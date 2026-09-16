// LEAD V2 P2 — THE PROVIDER CALL SPEC. WHAT IS COMPILED IS WHAT IS SENT.

import { assert, assertEquals, assertFalse, assertNotEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileProviderCallSpec, type SpecCompileInput } from "../../../supabase/functions/_shared/providerCallSpec.ts";
import { ACTOR_INPUT_CONTRACTS } from "../../../supabase/functions/_shared/actorInputContracts.ts";
import { FIELD_ROLES } from "../../../supabase/functions/_shared/actorFieldRoles.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import { DEFAULT_CEILINGS } from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { criteriaExecutionPolicy } from "../../../supabase/functions/_shared/criteriaExecutionPolicy.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { memo23MaxSizeCeiling } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";

globalThis.fetch = () => { throw new Error("P2 spec tests must not reach the network"); };

function proposal(over: Record<string, unknown> = {}) {
  return {
    requested_opportunity_count: 3, requested_contact_ready_count: null, company_types: [], geographies: [],
    employee_range: { min: null, max: null }, decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
    preferred_signals: [], adjacent_signals: [], excluded_signals: [],
    allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
    disallowed_broadening: [], required_evidence: [], required_capabilities: [], preferred_source_strategy: [],
    evaluation_instructions: "", founder_unlock_recommended: false, confidence: 0.8, unknowns: [], ...over,
  };
}
const mission = (q: string, over: Record<string, unknown> = {}, brain?: Record<string, unknown>) =>
  compileLeadMission({ originalUserQuery: q, proposal: proposal(over), ...(brain ? { companyBrain: brain } : {}) }).final_mission;

const US_SAAS = mission("Find 3 B2B SaaS startups in the US hiring software engineers.", {
  company_types: ["B2B SaaS"], geographies: ["United States"], geography_is_hard: true,
  preferred_signals: ["hiring software engineers"],
});
const US_SAAS_BRAIN_SIZE = mission("Find 3 B2B SaaS startups in the US hiring software engineers.", {
  company_types: ["B2B SaaS"], geographies: ["United States"], geography_is_hard: true,
  preferred_signals: ["hiring software engineers"],
}, { employee_min: 1, employee_max: 150 });
const HARD_SIZE = mission("Find 3 B2B SaaS startups in the US with 10 to 50 employees hiring software engineers.", {
  company_types: ["B2B SaaS"], geographies: ["United States"], geography_is_hard: true,
  employee_range: { min: 10, max: 50 }, preferred_signals: ["hiring software engineers"],
});

function input(actor: string, over: Partial<SpecCompileInput> & { mission?: typeof US_SAAS } = {}): SpecCompileInput {
  const card = hiringActorCard(actor);
  const m = over.mission ?? US_SAAS;
  return {
    actorKey: actor, capability: "startup_company_discovery", purpose: "discovery",
    proposed: {}, engine: {}, policy: criteriaExecutionPolicy(m),
    plan: { plan_id: "rp_test", version: 1, route_id: `startup_company_discovery:${actor}`, route_anchor: "company_profile", route_refused: null },
    scope: { workspace_id: "ws-1", lineage_id: "lin-1" }, mission_hash: "mh",
    ceilings: { ...DEFAULT_CEILINGS }, cost_model: card?.cost_model ?? null,
    contract_fields: ACTOR_INPUT_CONTRACTS[actor]?.fields ?? null,
    card_enums: card?.verified_enums, card_limits: card?.input_limits, size_ceiling: memo23MaxSizeCeiling,
    ...over,
  } as SpecCompileInput;
}
const change = (spec: ReturnType<typeof compileProviderCallSpec>, field: string) =>
  spec.provenance.find((p) => p.field === field)!;

Deno.test("every live contract field of every lead actor has a declared role", () => {
  for (const actor of Object.keys(FIELD_ROLES)) {
    const fields = ACTOR_INPUT_CONTRACTS[actor]?.fields ?? [];
    for (const f of fields) {
      if (/^exclude/i.test(f.name)) continue; // exclusion by prefix rule
      assert(FIELD_ROLES[actor][f.name], `${actor}.${f.name} has no role`);
    }
  }
});

Deno.test("GPT's detailed actor-native input is kept when valid, and every field records its decision", () => {
  const people = mission("Find AI investors in the United States with 51-500 employee firms.", {
    geographies: ["United States"], geography_is_hard: true, employee_range: { min: 51, max: 500 },
  });
  const proposed = {
    profileScraperMode: "Full",
    searchQuery: '("artificial intelligence" OR "agentic AI" OR "enterprise AI" OR "AI SaaS") AND (startup OR founder OR SaaS)',
    currentJobTitles: ["Principal", "Venture Partner", "Investment Partner"],
    locations: ["United States"],
    companyHeadquarterLocations: ["United States"],
    companyHeadcount: ["B", "C", "D"],
    recentlyPostedOnLinkedIn: true,
    maxItems: 150,
  };
  const spec = compileProviderCallSpec(input("apify_people_search", {
    mission: people, purpose: "discovery", proposed, engine: {},
    ceilings: { ...DEFAULT_CEILINGS, per_route_usd: { company_profile: 5 }, per_call_usd: {} },
  } as never));
  assertEquals(spec.status, "intended");
  for (const k of ["profileScraperMode", "searchQuery", "currentJobTitles", "locations",
    "companyHeadquarterLocations", "companyHeadcount", "recentlyPostedOnLinkedIn"]) {
    assertEquals(spec.serialized_input[k], proposed[k as keyof typeof proposed], `${k} kept verbatim`);
  }
  for (const p of spec.provenance) {
    assert("proposed_value" in p && "final_value" in p && p.changed_by && p.reason, `${p.field} fully recorded`);
  }
});

Deno.test("credentials and external data sinks are never sent, whoever proposes them", () => {
  const spec = compileProviderCallSpec(input("apify_people_search", {
    proposed: { searchQuery: "founder", maxItems: 10, mongoDbConnectionString: "mongodb://attacker", postFilteringMongoDbQuery: "{}" },
  }));
  assertEquals(spec.serialized_input.mongoDbConnectionString, undefined);
  assertEquals(spec.serialized_input.postFilteringMongoDbQuery, undefined);
  const jobs = compileProviderCallSpec(input("apify_linkedin_job_search", {
    capability: "hiring_verification", purpose: "hiring_evidence",
    plan: { plan_id: "rp", version: 1, route_id: null, route_anchor: null, route_refused: null },
    proposed: { jobTitles: ["{{role}}"], cookie: "li_at=secret" },
    engine: { company: ["https://www.linkedin.com/company/mux"], jobTitles: ["Growth Marketer"], maxItems: 10 },
  }));
  assertEquals(jobs.serialized_input.cookie, undefined);
  assertEquals(jobs.provenance.find((p) => p.field === "cookie")?.changed_by, "provider_contract");
});

Deno.test("template binding: {{step_1.name}} becomes the candidate's name, recorded", () => {
  const spec = compileProviderCallSpec(input("apify_linkedin_company_search", {
    capability: "company_identity_resolution", purpose: "identity",
    plan: { plan_id: "rp", version: 1, route_id: null, route_anchor: null, route_refused: null },
    proposed: { searchQuery: "{{step_1.name}}", scraperMode: "full", maxItems: 5, locations: ["United States"] },
    engine: { searchQuery: "Mux", scraperMode: "full", maxItems: 15, locations: ["United States"], startPage: 1 },
    candidate_keys: ["mux"],
  }));
  assertEquals(spec.serialized_input.searchQuery, "Mux");
  assertEquals(change(spec, "searchQuery").changed_by, "template_binding");
  assertEquals(spec.serialized_input.maxItems, 5, "the planner's 5 stands — the engine's 15 is not applied");
  assertEquals(spec.serialized_input.scraperMode, "full");
});

Deno.test("identity without a planner count: the engine's 15 is clamped by the $0.03 call ceiling, with the reason", () => {
  const spec = compileProviderCallSpec(input("apify_linkedin_company_search", {
    capability: "company_identity_resolution", purpose: "identity",
    plan: { plan_id: "rp", version: 1, route_id: null, route_anchor: null, route_refused: null },
    proposed: { searchQuery: "{{step_1.name}}", scraperMode: "full", locations: ["United States"] },
    engine: { searchQuery: "Every", scraperMode: "full", maxItems: 15, locations: ["United States"] },
  }));
  assertEquals(spec.serialized_input.maxItems, 7, "(0.03 - 0.001) / 0.004 full rows");
  assertEquals(change(spec, "maxItems").changed_by, "budget_policy");
  assert(spec.cost.estimate_usd <= 0.03);
});

Deno.test("an unregistered engine rewrite of a protected field is not applied, and is recorded", () => {
  const spec = compileProviderCallSpec(input("apify_yc_companies_memo23", {
    proposed: { mode: "companies", queries: ["B2B SaaS", "developer tools"], regions: ["United States of America"], isHiring: true, maxItems: 10 },
    engine: { mode: "companies", queries: [], regions: ["United States of America"], isHiring: true, maxItems: 10, enrichEmails: false },
  }));
  assertEquals(spec.serialized_input.queries, ["B2B SaaS", "developer tools"]);
  assertEquals(spec.engine_rewrites_rejected.map((r) => r.field), ["queries"]);
  assertEquals(spec.serialized_input.enrichEmails, false, "a registered platform policy applies");
  assertEquals(change(spec, "enrichEmails").changed_by, "people_policy");
});

Deno.test("a Company Brain size PREFERENCE never becomes a provider filter", () => {
  assert(US_SAAS_BRAIN_SIZE.criteria!.some((c) => c.dimension === "company_size" && c.source === "company_brain_preference"));
  const spec = compileProviderCallSpec(input("apify_yc_companies_memo23", {
    mission: US_SAAS_BRAIN_SIZE,
    proposed: { mode: "companies", queries: ["B2B SaaS"], regions: ["United States of America"], maxEmployeeSize: "50" },
    engine: { mode: "companies", queries: ["B2B SaaS"], regions: ["United States of America"], maxEmployeeSize: "250" },
  }));
  assertEquals(spec.serialized_input.maxEmployeeSize, undefined);
  const p = change(spec, "maxEmployeeSize");
  assertEquals(p.changed_by, "criteria_policy");
  assertEquals(p.proposed_value, "50");
  assertEquals(p.final_value, null);
  assert(p.reason.includes("never filter retrieval"));
});

Deno.test("a HARD size may filter: the enum band covering the stated maximum", () => {
  const spec = compileProviderCallSpec(input("apify_yc_companies_memo23", {
    mission: HARD_SIZE,
    proposed: { mode: "companies", queries: ["B2B SaaS"], regions: ["United States of America"], maxEmployeeSize: "500" },
    engine: {},
  }));
  assertEquals(spec.serialized_input.maxEmployeeSize, memo23MaxSizeCeiling(50));
  assertEquals(change(spec, "maxEmployeeSize").changed_by, "provider_contract");
});

Deno.test("hard geography corrects a contradicting value and fills an omitted one", () => {
  const wrong = compileProviderCallSpec(input("apify_linkedin_company_search", {
    capability: "general_company_discovery",
    proposed: { searchQuery: "B2B SaaS", locations: ["Germany"], scraperMode: "short", maxItems: 20 },
  }));
  assertEquals(wrong.serialized_input.locations, ["United States"]);
  assertEquals(change(wrong, "locations").changed_by, "mission_hard_constraint");
  const omitted = compileProviderCallSpec(input("apify_yc_companies_memo23", {
    proposed: { mode: "companies", queries: ["B2B SaaS"], isHiring: true },
  }));
  assertEquals(omitted.serialized_input.regions, ["United States of America"]);
});

Deno.test("a brain-only geography is guidance: geography filters are removed", () => {
  const m = mission("Find 3 B2B SaaS startups hiring software engineers.", {
    company_types: ["B2B SaaS"], preferred_signals: ["hiring software engineers"],
  }, { locations: ["United States"] });
  const spec = compileProviderCallSpec(input("apify_yc_companies_memo23", {
    mission: m, proposed: { mode: "companies", queries: ["B2B SaaS"], regions: ["United States of America"] },
  }));
  assertEquals(spec.serialized_input.regions, undefined);
  assertEquals(change(spec, "regions").changed_by, "criteria_policy");
});

Deno.test("provider contract: unknown fields and illegal enum values are dropped, each recorded", () => {
  const spec = compileProviderCallSpec(input("apify_yc_companies_memo23", {
    proposed: { mode: "companies", queries: ["B2B SaaS"], regions: ["United States of America"], madeUpField: 1, minEmployeeSize: "7" },
  }));
  assertEquals(spec.serialized_input.madeUpField, undefined);
  assertEquals(change(spec, "madeUpField").changed_by, "provider_contract");
  assertFalse(Object.keys(spec.serialized_input).includes("minEmployeeSize"));
});

Deno.test("the discovery pool bound clamps GPT's 100 rows, named", () => {
  const spec = compileProviderCallSpec(input("apify_yc_companies_memo23", {
    proposed: { mode: "companies", queries: ["B2B SaaS"], regions: ["United States of America"], maxItems: 100 },
    count_bounds: [{ value: 10, changed_by: "budget_policy", reason: "discovery pool size for the requested count" }],
  }));
  assertEquals(spec.serialized_input.maxItems, 10);
  assertEquals(change(spec, "maxItems").proposed_value, 100);
  assertEquals(change(spec, "maxItems").reason, "discovery pool size for the requested count");
});

Deno.test("a call whose estimate exceeds its ceiling is refused before it exists", () => {
  const spec = compileProviderCallSpec(input("apify_linkedin_company_details", {
    capability: "company_enrichment", purpose: "enrichment",
    plan: { plan_id: "rp", version: 1, route_id: null, route_anchor: null, route_refused: null },
    proposed: null, engine: { companies: Array.from({ length: 30 }, (_, i) => `https://www.linkedin.com/company/c${i}`) },
  }));
  assertEquals(spec.status, "refused_budget");
  assertEquals(spec.refusal?.code, "call_ceiling");
});

Deno.test("a refused route refuses its calls", () => {
  const spec = compileProviderCallSpec(input("apify_yc_companies_memo23", {
    plan: { plan_id: "rp", version: 1, route_id: "r", route_anchor: "company_profile", route_refused: "non_narrowing_query: x" },
    proposed: { mode: "companies" },
  }));
  assertEquals(spec.status, "refused_policy");
});

Deno.test("the spec is frozen and its idempotency identity is stable and input-sensitive", () => {
  const a = compileProviderCallSpec(input("apify_yc_companies_memo23", { proposed: { mode: "companies", queries: ["B2B SaaS"] } }));
  const b = compileProviderCallSpec(input("apify_yc_companies_memo23", { proposed: { mode: "companies", queries: ["B2B SaaS"] } }));
  const c = compileProviderCallSpec(input("apify_yc_companies_memo23", { proposed: { mode: "companies", queries: ["AI SaaS"] } }));
  assertEquals(a.idempotency_key, b.idempotency_key);
  assertNotEquals(a.idempotency_key, c.idempotency_key);
  assertThrows(() => { (a.serialized_input as Record<string, unknown>).queries = ["x"]; });
  const otherLineage = compileProviderCallSpec(input("apify_yc_companies_memo23", {
    proposed: { mode: "companies", queries: ["B2B SaaS"] }, scope: { workspace_id: "ws-1", lineage_id: "lin-2" },
  }));
  assertNotEquals(a.idempotency_key, otherLineage.idempotency_key);
});
