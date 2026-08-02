// THE CANONICAL STRATEGIST CONTEXT, ITS HASH, AND ITS LINEAGE RECORD.
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildStrategistContext, sealStrategistPayload, sealMatchesPayload, hashPayload,
  canonicalJson, assertNoSecrets, buildStrategistObservability, constraintsFromBrain,
  STRATEGIST_POLICY_VERSION, STRATEGIST_MAX_RECENCY_DAYS,
  type StrategistCapabilityCard, type StrategistCompanyConstraints,
} from "../../functions/_shared/leadStrategistContext.ts";
import { missionFromSpec } from "../../functions/_shared/leadStrategyBridge.ts";

const BRAIN = {
  positive_industries: ["b2b saas", "software"],
  negative_industries: ["staffing", "agency"],
  excluded_company_types: ["consultancy"],
  min_employees: 1, max_employees: 150,
  allowed_stages: ["seed", "series a"],
  business_models: ["B2B SaaS"],
};

const CONSTRAINTS: StrategistCompanyConstraints = constraintsFromBrain(BRAIN, {
  country: "United States", vertical: "saas",
});

const CARDS: StrategistCapabilityCard[] = [
  {
    capability_key: "yc_job_discovery", purpose: "job_discovery",
    supports_recency: false, supports_company_size: false, supports_company_stage: false,
    startup_relevance: "high", precision: "high", recall: "low",
    maximum_results_per_call: 200,
    limitations: ["no provider recency field", "cannot filter employee count"],
  },
  {
    capability_key: "linkedin_job_discovery", purpose: "job_discovery",
    supports_recency: true, supports_company_size: false, supports_company_stage: false,
    startup_relevance: "low", precision: "high", recall: "medium",
    maximum_results_per_call: 200, limitations: ["cannot filter employee count"],
  },
];

const MISSION = {
  original_query: "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.",
  requested_lead_count: 5,
  requested_titles: ["Sales Operations", "Revenue Operations"],
  decision_maker_roles: ["Founder", "Co-Founder", "CEO"],
  geography: "United States",
  company_vertical: "saas",
  company_size: { min: 1, max: 150 },
  maturity_stages: ["seed"],
};

const ctx = (purpose: "initial_strategy" | "source_feedback" = "initial_strategy") =>
  buildStrategistContext({
    purpose,
    originalUserRequest: MISSION.original_query,
    mission: MISSION,
    companyConstraints: CONSTRAINTS,
    recency: { preferred_age_days: 30, maximum_age_days: 60 },
    hiringRoleFamilies: ["sales_operations", "revenue_operations"],
    capabilityCards: CARDS,
    unusedQueryPacks: ["revenue_ops_leadership"],
    completedQueryPacks: ["sales_ops_leadership"],
    completedSources: ["indeed_job_discovery"],
    unusedSources: ["yc_job_discovery", "linkedin_job_discovery"],
    sourceObservations: [{
      capability_key: "indeed_job_discovery", query_pack_id: "sales_ops_leadership",
      provider_rows: 25, title_matches: 2, title_rejections: 23,
      companies_resolved: 1, companies_qualified: 0, duplicate_rate: 0.1,
    }],
    contactReady: 0, remainingActions: 9,
    allowedNextActions: ["run_unused_query_pack", "advance_source", "stop_partial"],
    responseSchema: { type: "object", required: ["source_plan"] },
  });

// ================================ 1. THE REAL CONTEXT REACHES THE MODEL ======

Deno.test("1. Company Brain and saved ICP reach the strategist", () => {
  const c = ctx();
  assertEquals(c.company_constraints.business_model, "B2B SaaS");
  assertEquals(c.company_constraints.positive_industries, ["b2b saas", "software"]);
  assertEquals(c.company_constraints.excluded_industries, ["staffing", "agency"]);
  assertEquals(c.company_constraints.excluded_company_types, ["consultancy"]);
  assertEquals(c.company_constraints.employee_count, { min: 1, max: 150 });
  assertEquals(c.company_constraints.company_stages, ["seed", "series a"]);
  assertEquals(c.company_constraints.country, "United States");
  assert(c.company_constraints.enforced);
});

Deno.test("1b. the verbatim user request, roles, recency and geography are all present", () => {
  const c = ctx();
  assertEquals(c.original_user_request, MISSION.original_query);
  assertEquals(c.decision_maker_roles, ["Founder", "Co-Founder", "CEO"]);
  assertEquals(c.hiring_role_families, ["sales_operations", "revenue_operations"]);
  assertEquals(c.recency.maximum_age_days, 60);
  assertEquals(c.recency.preferred_age_days, 30);
});

Deno.test("1c. Actor capability cards AND their limitations reach the strategist", () => {
  const c = ctx();
  assertEquals(c.capability_cards.length, 2);
  const yc = c.capability_cards.find((x) => x.capability_key === "yc_job_discovery")!;
  assertEquals(yc.supports_recency, false);
  assertEquals(yc.startup_relevance, "high");
  assert(yc.limitations.includes("no provider recency field"));
});

Deno.test("1d. packs, sources, observations, quota, budget and allowed actions are present", () => {
  const c = ctx();
  assertEquals(c.completed_query_packs, ["sales_ops_leadership"]);
  assertEquals(c.unused_query_packs, ["revenue_ops_leadership"]);
  assertEquals(c.completed_sources, ["indeed_job_discovery"]);
  assertEquals(c.unused_sources, ["yc_job_discovery", "linkedin_job_discovery"]);
  assertEquals(c.source_observations[0].title_rejections, 23);
  assertEquals(c.quota, { requested: 5, contact_ready: 0, remaining: 5 });
  assertEquals(c.budget.remaining_actions, 9);
  assertEquals(c.allowed_next_actions, ["run_unused_query_pack", "advance_source", "stop_partial"]);
  assert(c.response_schema);
  assert(c.prohibitions.length > 0);
});

Deno.test("1e. the recency ceiling cannot be exceeded by a caller", () => {
  const c = buildStrategistContext({
    purpose: "initial_strategy", originalUserRequest: "x", mission: MISSION,
    companyConstraints: CONSTRAINTS, recency: { preferred_age_days: 400, maximum_age_days: 999 },
    responseSchema: {},
  });
  assertEquals(c.recency.maximum_age_days, STRATEGIST_MAX_RECENCY_DAYS);
  assert(c.recency.preferred_age_days <= STRATEGIST_MAX_RECENCY_DAYS);
});

Deno.test("1f. the Brain's employee band reaches the MISSION, not just the context", () => {
  // `missionFromSpec` hard-coded `company_size: null`. The band is mission truth.
  const m = missionFromSpec({
    workspaceId: "ws-1",
    spec: { keyword_queries: ["Sales Operations"], requested_person_roles: ["Founder"], location: "United States", country: "US", original_query: "q" },
    requestedLeadCount: 5,
    companyConstraints: CONSTRAINTS,
  } as never);
  assertEquals(m.company_size, { min: 1, max: 150 });
  assertEquals(m.maturity_stages, ["seed", "series a"]);
});

Deno.test("1g. without constraints the mission degrades honestly to null", () => {
  const m = missionFromSpec({
    workspaceId: "ws-1",
    spec: { keyword_queries: [], requested_person_roles: [], location: null, country: null, original_query: "q" },
    requestedLeadCount: 5,
  } as never);
  assertEquals(m.company_size, null);
});

// ================================== 2. ONE CANONICAL POLICY ==================

Deno.test("2. initial and feedback share ONE policy and ONE context version", () => {
  const a = ctx("initial_strategy");
  const b = ctx("source_feedback");
  assertEquals(a.policy_version, b.policy_version);
  assertEquals(a.policy_version, STRATEGIST_POLICY_VERSION);
  assertEquals(a.context_version, b.context_version);
  // Only the purpose (and its schema) differ.
  assertEquals(a.purpose, "initial_strategy");
  assertEquals(b.purpose, "source_feedback");
});

Deno.test("2b. both purposes receive the SAME constraint and capability envelope", () => {
  const a = ctx("initial_strategy");
  const b = ctx("source_feedback");
  assertEquals(canonicalJson(a.company_constraints), canonicalJson(b.company_constraints));
  assertEquals(canonicalJson(a.capability_cards), canonicalJson(b.capability_cards));
});

// ============================ 7. HASH DESCRIBES THE SENT PAYLOAD =============

Deno.test("7. the prompt hash is a hash OF THE SEALED PAYLOAD", () => {
  const sealed = sealStrategistPayload(ctx());
  assert(sealMatchesPayload(sealed), "the sealed hash must describe its own payload");
  assertEquals(sealed.prompt_hash, hashPayload(sealed.payload));
});

Deno.test("7b. changing ANY sent field changes the hash", () => {
  const a = sealStrategistPayload(ctx());
  const changed = { ...ctx(), quota: { requested: 5, contact_ready: 1, remaining: 4 } };
  assert(a.prompt_hash !== hashPayload(changed), "a different payload must hash differently");
});

Deno.test("7c. key order does not change the hash — same request, same identity", () => {
  // Rebuild the SAME object with every key inserted in reverse order, at depth.
  const reorderDeep = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(reorderDeep);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort().reverse()) out[k] = reorderDeep(o[k]);
      return out;
    }
    return v;
  };
  const c = ctx();
  const reordered = reorderDeep(c);
  // Different insertion order, identical content ⇒ identical identity.
  assert(JSON.stringify(c) !== JSON.stringify(reordered), "the fixture must actually differ in key order");
  assertEquals(hashPayload(c), hashPayload(reordered));
});

Deno.test("7d. observability carries lineage and NO secrets", () => {
  const sealed = sealStrategistPayload(ctx());
  const obs = buildStrategistObservability({
    sealed, provider: "openai", model: "gpt-test", modelTier: "primary",
    schemaVersion: "lead-strategy-1", validationErrors: ["duplicate_pack"],
    repairs: ["removed_duplicate_pack"], escalated: false, fallbackReason: null,
    selectedAction: "advance_source", latencyMs: 812, usage: { input_tokens: 100 },
  });
  assertEquals(obs.policy_version, STRATEGIST_POLICY_VERSION);
  assertEquals(obs.prompt_hash, sealed.prompt_hash);
  assertEquals(obs.validation_errors, ["duplicate_pack"]);
  assertEquals(obs.repairs, ["removed_duplicate_pack"]);
  assertEquals(obs.selected_action, "advance_source");
  assertEquals(obs.latency_ms, 812);
  // The sanitized input is a PROJECTION, never a prompt string.
  assert(obs.sanitized_input.company_constraints);
  assertFalse("response_schema" in obs.sanitized_input);
  assertFalse(JSON.stringify(obs).includes("prompt_text"));
  assert(assertNoSecrets(obs));
});

Deno.test("7e. a credential anywhere in the payload is caught structurally", () => {
  assert(assertNoSecrets(ctx()));
  assertFalse(assertNoSecrets({ ...ctx(), leaked: { api_key: "x" } }));
  assertFalse(assertNoSecrets({ ...ctx(), note: "authorization: Bearer abc" }));
  // A provider identifier is equally forbidden.
  assertFalse(assertNoSecrets({ ...ctx(), actor: "apify/indeed-scraper" }));
});

Deno.test("7f. the context itself never carries an Actor id or provider name", () => {
  const blob = canonicalJson(ctx()).toLowerCase();
  assertFalse(blob.includes("apify"));
  assertFalse(blob.includes("actor_id"));
  // Capability keys only.
  assert(blob.includes("yc_job_discovery"));
});
