// ADAPTIVE SOURCING STRATEGY — contract, taxonomy, packs, ordering, routing.
//
// OFFLINE ONLY. No Actor runs, no Firecrawl call, no model call, no database
// access, no environment mutation. Every capability card is injected, so these
// tests never depend on which providers happen to be enabled in the environment.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseRoleTaxonomy, validateRoleTaxonomy, eligibleFamilies, deferredFamilies,
  isRejectedOperationsTitle, isSecondaryExecutiveTitle, TAXONOMY_BOUNDS,
  type RoleTaxonomy,
} from "../../functions/_shared/leadRoleTaxonomy.ts";
import {
  parseQueryPacks, validateQueryPacks, selectPacksForCall, deferredPacks, PACK_BOUNDS,
  type QueryPack,
} from "../../functions/_shared/leadQueryPacks.ts";
import {
  adaptiveCapabilityCards, cardsCarryNoProviderIdentifiers, ADAPTIVE_DISCOVERY_CAPABILITIES,
  type AdaptiveCapabilityCard,
} from "../../functions/_shared/leadCapabilityCards.ts";
import {
  validateAdaptiveStrategy, recommendSourceOrder, looksLikeRawActorId, parseAdaptiveStrategy,
  MAX_RECENCY_DAYS, type AdaptiveStrategy, type MissionTruth,
} from "../../functions/_shared/leadSourceStrategy.ts";
import { routeAdaptiveLeadDecision, isAdaptiveLeadDecision } from "../../functions/_shared/leadAdaptiveRoute.ts";
import {
  buildAdaptivePlanningContext, contextCarriesNoSecrets,
  deterministicRevenueOpsTaxonomy, deterministicRevenueOpsPacks,
} from "../../functions/_shared/leadAdaptiveContext.ts";
import { isPlannerTask } from "../../providerRouting.ts"";

// ------------------------------------------------------------------ fixtures ----

const CANONICAL_QUERY =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";

const TRUTH: MissionTruth = {
  final_entity: "contact_ready_lead",
  requested_count: 5,
  hiring_role_seed: "Sales Operations",
  decision_maker_roles: ["Founder", "Co-Founder", "CEO"],
  company_constraints: {
    business_model: "B2B SaaS",
    company_stage: ["startup", "early-stage", "small team"],
    employee_count: { min: 1, max: 150 },
    country: "United States",
  },
  maximum_age_days: 60,
};

/** Cards mirroring the verified catalog traits, injected so tests are env-free. */
function card(
  capability: string,
  o: Partial<AdaptiveCapabilityCard> & {
    precision?: "low" | "medium" | "high"; recall?: "low" | "medium" | "high";
  } = {},
): AdaptiveCapabilityCard {
  return {
    capability: capability as AdaptiveCapabilityCard["capability"],
    description: `${capability} description`,
    purposes: ["job_discovery"],
    bestFor: o.bestFor ?? {},
    avoidFor: [],
    supportedSemanticFilters: {
      roleFamily: true, titleAliases: true, geography: true, postingWindow: true,
      remotePolicy: false, employmentType: true, companyIdentity: false,
      companyStage: false, companySize: false,
    },
    expectedEvidence: {
      companyName: true, companyDomain: true, linkedinCompanyUrl: true,
      jobTitle: true, jobLocation: true, postingDate: true, jobUrl: true,
    },
    sourceQuality: { precision: o.precision ?? "medium", recall: o.recall ?? "medium", authority: "discovery" },
    maximumResultsPerCall: 200, maximumCallsPerRound: 3, requiresKnownCompany: false,
    startup_relevance: o.startup_relevance ?? "low",
    recency_enforcement: o.recency_enforcement ?? "provider_filter",
    company_metadata_quality: o.company_metadata_quality ?? "high",
    cost_class: o.cost_class ?? "low",
    company_filter_support: o.company_filter_support ??
      { company_stage: false, company_size: false, requires_post_retrieval_qualification: true },
  };
}

const CARDS: AdaptiveCapabilityCard[] = [
  card("yc_job_discovery", {
    precision: "high", recall: "low", startup_relevance: "high",
    recency_enforcement: "post_normalization",
    bestFor: { industries: ["b2b saas"], companyStages: ["pre-seed", "seed", "series a"] },
  }),
  card("linkedin_job_discovery", { precision: "high", recall: "medium", cost_class: "medium" }),
  card("indeed_job_discovery", { precision: "medium", recall: "high" }),
  card("glassdoor_job_discovery", { precision: "low", recall: "high", company_metadata_quality: "medium" }),
];

const APPROVED = CARDS.map((c) => c.capability);

function strategy(over: Partial<AdaptiveStrategy> = {}): AdaptiveStrategy {
  return {
    mission: {
      interpreted_goal: "Find B2B SaaS startups hiring revenue-operations roles and reach their founders.",
      final_entity: "contact_ready_lead",
      requested_count: 5,
      decision_maker_roles: ["Founder", "Co-Founder", "CEO"],
    },
    company_constraints: TRUTH.company_constraints,
    recency_policy: { preferred_age_days: 30, maximum_age_days: 60 },
    role_taxonomy: deterministicRevenueOpsTaxonomy(),
    query_packs: deterministicRevenueOpsPacks(),
    source_plan: [
      { step_id: "s1", capability_key: "yc_job_discovery", purpose: "startup-precise discovery", query_pack_ids: ["sales_ops_leadership", "revenue_ops_leadership"], semantic_filters: {}, success_condition: {}, exhaustion_condition: {}, switch_condition: {}, rationale: "Preferred first because the mission targets startups." },
      { step_id: "s2", capability_key: "linkedin_job_discovery", purpose: "broader professional coverage", query_pack_ids: ["direct_ops_ic"], semantic_filters: {}, success_condition: {}, exhaustion_condition: {}, switch_condition: {} },
    ],
    broadening_ladder: ["increase_result_target"],
    people_search_condition: {},
    stop_conditions: {},
    ...over,
  };
}

// =============================================================== ROUTING (1,2) ==

Deno.test("1. qualified-lead sourcing uses the narrow Claude route when fully enabled", () => {
  const env = (k: string) => ({
    CLAUDE_FIRST_LEAD_PLANNING: "true",
    CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES: "ws-1",
  } as Record<string, string>)[k];

  const d = routeAdaptiveLeadDecision({
    workflow: "qualified_lead_sourcing", executionMode: "company_first",
    workspaceId: "ws-1", decision: "sourcing_strategy",
    strategyContractAvailable: true, read: env,
  });
  assert(d.useClaude);
  assertEquals(d.provider, "anthropic");
  assertEquals(d.reason, "enabled");
});

Deno.test("1b. every gate is load-bearing — each one alone turns the route off", () => {
  const on = (k: string) => ({
    CLAUDE_FIRST_LEAD_PLANNING: "true", CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES: "ws-1",
  } as Record<string, string>)[k];
  const base = {
    workflow: "qualified_lead_sourcing", executionMode: "company_first",
    workspaceId: "ws-1", decision: "sourcing_strategy" as const,
    strategyContractAvailable: true, read: on,
  };
  assertEquals(routeAdaptiveLeadDecision({ ...base, workflow: "content" }).reason, "wrong_workflow");
  assertEquals(routeAdaptiveLeadDecision({ ...base, executionMode: "lead_search" }).reason, "wrong_execution_mode");
  assertEquals(routeAdaptiveLeadDecision({ ...base, workspaceId: "ws-other" }).reason, "workspace_not_allowed");
  assertEquals(routeAdaptiveLeadDecision({ ...base, strategyContractAvailable: false }).reason, "strategy_contract_unavailable");
  // Flag off entirely.
  assertEquals(routeAdaptiveLeadDecision({ ...base, read: () => undefined }).reason, "flag_off");
});

Deno.test("1c. the two allow-list reasons stay distinct (substring matching collapses them)", () => {
  const flagOnNoList = (k: string) => (k === "CLAUDE_FIRST_LEAD_PLANNING" ? "true" : undefined);
  assertEquals(routeAdaptiveLeadDecision({
    workflow: "qualified_lead_sourcing", executionMode: "company_first", workspaceId: "ws-1",
    decision: "sourcing_strategy", strategyContractAvailable: true, read: flagOnNoList,
  }).reason, "no_workspace_allowlist");
});

Deno.test("2. unrelated chat, orchestration and helper routing are untouched", () => {
  // The pre-existing assertion that generic planning stays on the default chain.
  for (const t of ["pilot_chat", "orchestration_plan", "tool_input_planning", "helper"] as const) {
    assert(isPlannerTask(t), `${t} must remain a default-chain planner task`);
  }
  // And the adaptive route declines to claim them.
  assertFalse(isAdaptiveLeadDecision("pilot_chat", "company_first"));
  assertFalse(isAdaptiveLeadDecision("qualified_lead_sourcing", "lead_search"));
});

Deno.test("2b. flags are OFF by default — no env, no Claude", () => {
  const d = routeAdaptiveLeadDecision({
    workflow: "qualified_lead_sourcing", executionMode: "company_first",
    workspaceId: "ws-1", decision: "sourcing_strategy",
    strategyContractAvailable: true, read: () => undefined,
  });
  assertFalse(d.useClaude);
  assertEquals(d.provider, undefined);
});

// =========================================================== CONTEXT (3,4,5,6) ==

Deno.test("3/4/5. context carries the original query, Company Brain, ICP and capability cards", () => {
  const ctx = buildAdaptivePlanningContext({
    originalUserQuery: CANONICAL_QUERY, truth: TRUTH,
    remainingBudgetUsd: 5, remainingProviderCalls: 8, cards: CARDS,
  });
  assertEquals(ctx.original_user_query, CANONICAL_QUERY);          // verbatim, uninterpreted
  assertEquals(ctx.company_constraints.business_model, "B2B SaaS");
  assertEquals(ctx.company_constraints.employee_count?.max, 150);
  assertEquals(ctx.company_constraints.country, "United States");
  assertEquals(ctx.capability_cards.length, 4);
  assertEquals(ctx.requested_count, 5);
  assertEquals(ctx.final_entity, "contact_ready_lead");
});

Deno.test("3b. hiring role and decision-maker roles stay separate in the context", () => {
  const ctx = buildAdaptivePlanningContext({
    originalUserQuery: CANONICAL_QUERY, truth: TRUTH,
    remainingBudgetUsd: 5, remainingProviderCalls: 8, cards: CARDS,
  });
  assertEquals(ctx.hiring_role_seed, "Sales Operations");
  assertEquals(ctx.decision_maker_roles, ["Founder", "Co-Founder", "CEO"]);
  assertFalse(ctx.decision_maker_roles.includes("Sales Operations"));
});

Deno.test("6. the context carries no credential and no provider identifier", () => {
  const ctx = buildAdaptivePlanningContext({
    originalUserQuery: CANONICAL_QUERY, truth: TRUTH,
    remainingBudgetUsd: 5, remainingProviderCalls: 8, cards: CARDS,
  });
  assert(contextCarriesNoSecrets(ctx));
});

Deno.test("5b. capability cards expose no Actor identifier, and exclude ATS", () => {
  assert(cardsCarryNoProviderIdentifiers(CARDS));
  assertFalse((ADAPTIVE_DISCOVERY_CAPABILITIES as readonly string[]).includes("ats_job_verification"));
  // The real runtime projection obeys the same rules for whatever is enabled.
  const live = adaptiveCapabilityCards();
  assert(cardsCarryNoProviderIdentifiers(live));
  assertFalse(live.some((c) => c.capability === "ats_job_verification"));
});

// ================================================================ ACTOR IDS (7) ==

Deno.test("7. raw Actor IDs are recognised and reject the whole strategy", () => {
  assert(looksLikeRawActorId("crawlworks/linkedin-jobs-scraper"));
  assert(looksLikeRawActorId("parsebird/yc-jobs-scraper"));
  assert(looksLikeRawActorId("apify_indeed_jobs_automation_lab"));
  assert(looksLikeRawActorId("misceres~indeed-scraper"));
  assertFalse(looksLikeRawActorId("yc_job_discovery"));
  assertFalse(looksLikeRawActorId("linkedin_job_discovery"));

  const bad = strategy({
    source_plan: [{
      step_id: "s1", capability_key: "crawlworks/linkedin-jobs-scraper", purpose: "p",
      query_pack_ids: [], semantic_filters: {}, success_condition: {}, exhaustion_condition: {}, switch_condition: {},
    }],
  });
  const v = validateAdaptiveStrategy({ strategy: bad, truth: TRUTH, cards: CARDS });
  assertEquals(v.outcome, "rejected");
  assertEquals(v.strategy_source, "deterministic_fallback");
  assert(v.violations.some((x) => x.code === "raw_actor_id"));
});

// ======================================================= TAXONOMY (8,9,10,11,12,13) ==

Deno.test("8/9/10. a bounded taxonomy with seniority variants and aliases validates", () => {
  const t = deterministicRevenueOpsTaxonomy();
  const v = validateRoleTaxonomy({ taxonomy: t, approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations" });
  assert(v.outcome !== "rejected", v.rejection_reason ?? "");
  const kept = v.taxonomy!;
  assert(kept.families.length >= 4 && kept.families.length <= TAXONOMY_BOUNDS.maxFamilies);
  const salesOps = kept.families.find((f) => f.family_id === "sales_operations")!;
  // Seniority spread: VP / Head / Director / Manager / Analyst all present.
  for (const s of ["VP", "Head", "Director", "Manager", "Analyst"]) {
    assert(salesOps.titles.some((x) => x.includes(s)), `missing seniority variant ${s}`);
  }
  assert(salesOps.seniority_levels.length > 0);
  const revOps = kept.families.find((f) => f.family_id === "revenue_operations")!;
  assert(revOps.titles.some((x) => x.toLowerCase().startsWith("revops")), "missing the RevOps abbreviation form");
});

Deno.test("11. unrelated Operations families and generic Operations titles are rejected", () => {
  for (const t of [
    "Warehouse Operations Manager", "Store Operations Lead", "Retail Operations Manager",
    "Production Operations Manager", "Manufacturing Operations Manager", "People Operations Manager",
    "HR Operations Manager", "Clinical Operations Manager", "Restaurant Operations Manager",
    "Logistics Operations Manager",
  ]) assert(isRejectedOperationsTitle(t), `${t} should be rejected`);

  for (const t of ["Operations Manager", "Business Operations", "Growth Operations", "Strategy and Operations"]) {
    assert(isRejectedOperationsTitle(t), `${t} should be rejected as generic`);
  }
  // ...while the real thing survives.
  assertFalse(isRejectedOperationsTitle("Director of Sales Operations"));
  assertFalse(isRejectedOperationsTitle("Revenue Operations Manager"));

  const polluted: RoleTaxonomy = {
    families: [
      ...deterministicRevenueOpsTaxonomy().families,
      {
        family_id: "warehouse_ops", canonical_function: "Warehouse Operations", confidence_tier: "exact",
        titles: ["Warehouse Operations Manager"], aliases: [], abbreviations: [], seniority_levels: [],
        positive_description_evidence: [], negative_patterns: [], evidence_required: false,
        initially_eligible: true, broadening_level: 1, maximum_attempts: 1, recommended_capabilities: [],
      },
    ],
    negative_patterns: [],
  };
  const v = validateRoleTaxonomy({ taxonomy: polluted, approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations" });
  assertEquals(v.outcome, "repaired");
  assertFalse(v.taxonomy!.families.some((f) => f.family_id === "warehouse_ops"));
  assert(v.repairs.some((r) => r.code === "rejected_operations_family_removed"));
});

Deno.test("12. secondary executives are never exact hiring evidence", () => {
  for (const t of ["Chief Revenue Officer", "VP of Revenue", "Head of Revenue", "Chief Commercial Officer"]) {
    assert(isSecondaryExecutiveTitle(t));
  }
  const t = deterministicRevenueOpsTaxonomy();
  // Claude tries to promote the executive family to exact + round one.
  const exec = t.families.find((f) => f.family_id === "commercial_leadership")!;
  exec.confidence_tier = "exact";
  exec.initially_eligible = true;

  const v = validateRoleTaxonomy({ taxonomy: t, approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations" });
  const kept = v.taxonomy!.families.find((f) => f.family_id === "commercial_leadership")!;
  assertEquals(kept.confidence_tier, "secondary_signal");
  assertFalse(kept.initially_eligible);
  assert(kept.evidence_required);
  assert(v.repairs.some((r) => r.code === "secondary_executive_downgraded"));
});

Deno.test("13. evidence-gated roles require evidence and are deferred past round one", () => {
  const t = deterministicRevenueOpsTaxonomy();
  const gated = t.families.find((f) => f.family_id === "commercial_operations")!;
  gated.evidence_required = false;
  gated.positive_description_evidence = [];
  gated.initially_eligible = true;
  gated.broadening_level = 1;

  const v = validateRoleTaxonomy({ taxonomy: t, approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations" });
  const kept = v.taxonomy!.families.find((f) => f.family_id === "commercial_operations")!;
  assert(kept.evidence_required);
  assert(kept.positive_description_evidence.length > 0);
  assertFalse(kept.initially_eligible);
  assert(kept.broadening_level >= 2);
});

Deno.test("13b. a taxonomy with no eligible exact family is rejected, not repaired", () => {
  const t = deterministicRevenueOpsTaxonomy();
  for (const f of t.families) f.initially_eligible = false;
  const v = validateRoleTaxonomy({ taxonomy: t, approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations" });
  assertEquals(v.outcome, "rejected");
  assertEquals(v.strategy_source, "deterministic_fallback");
});

Deno.test("8b. taxonomy parsing bounds every array and drops unusable families", () => {
  const parsed = parseRoleTaxonomy({
    families: [
      { family_id: "ok", canonical_function: "Sales Operations", confidence_tier: "exact",
        titles: Array.from({ length: 50 }, (_, i) => `Sales Operations Title ${i}`) },
      { family_id: "", confidence_tier: "exact", titles: ["x"] },        // no id
      { family_id: "bad_tier", confidence_tier: "wishful", titles: ["x"] }, // unknown tier
    ],
    negative_patterns: ["warehouse"],
  })!;
  assertEquals(parsed.families.length, 1);
  assertEquals(parsed.families[0].titles.length, TAXONOMY_BOUNDS.maxTitlesPerFamily);
});

Deno.test("taxonomy eligibility ordering separates round one from broadening", () => {
  const v = validateRoleTaxonomy({
    taxonomy: deterministicRevenueOpsTaxonomy(), approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations",
  });
  const t = v.taxonomy!;
  assert(eligibleFamilies(t).every((f) => f.confidence_tier === "exact"));
  assert(deferredFamilies(t).every((f) => f.confidence_tier !== "exact"));
});

// ==================================================== QUERY PACKS (14,15,16,17) ==

Deno.test("14. multiple balanced packs validate, and exact packs lead", () => {
  const tax = validateRoleTaxonomy({
    taxonomy: deterministicRevenueOpsTaxonomy(), approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations",
  }).taxonomy!;
  const v = validateQueryPacks({ packs: deterministicRevenueOpsPacks(), taxonomy: tax, approvedCapabilities: APPROVED });
  assert(v.outcome !== "rejected", v.rejection_reason ?? "");
  assert(v.packs.length >= 5);
  for (const p of v.packs) assert(p.titles.length <= PACK_BOUNDS.maxTitlesPerPack);
  assertEquals(v.packs[0].confidence_tier, "exact");
});

Deno.test("15. one giant unbounded query pack is rejected", () => {
  const tax = validateRoleTaxonomy({
    taxonomy: deterministicRevenueOpsTaxonomy(), approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations",
  }).taxonomy!;
  const giant: QueryPack = {
    pack_id: "everything", label: "Everything", functional_family_ids: ["sales_operations"],
    confidence_tier: "exact",
    titles: [
      "VP of Sales Operations", "Head of Sales Operations", "Director of Sales Operations",
      "Sales Operations Manager", "Sales Operations Analyst", "Revenue Operations Manager",
      "RevOps Manager", "GTM Operations Manager", "Revenue Systems Manager", "Deal Desk Manager",
    ],
    aliases: [], negative_patterns: [], description_evidence: [], recommended_capabilities: [],
    priority: 1, broadening_level: 1, initially_eligible: true, maximum_attempts: 1,
    expected_precision: "high", expected_coverage: "high",
  };
  const v = validateQueryPacks({ packs: [giant], taxonomy: tax, approvedCapabilities: APPROVED });
  assertEquals(v.outcome, "rejected");
  assert((v.rejection_reason ?? "").includes("unbounded"));
});

Deno.test("16/17. exact packs are initially eligible; gated and secondary packs are not", () => {
  const tax = validateRoleTaxonomy({
    taxonomy: deterministicRevenueOpsTaxonomy(), approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations",
  }).taxonomy!;
  const v = validateQueryPacks({ packs: deterministicRevenueOpsPacks(), taxonomy: tax, approvedCapabilities: APPROVED });
  const byId = new Map(v.packs.map((p) => [p.pack_id, p]));
  assert(byId.get("sales_ops_leadership")!.initially_eligible);
  assert(byId.get("revenue_ops_leadership")!.initially_eligible);
  assert(byId.get("direct_ops_ic")!.initially_eligible);
  assertFalse(byId.get("commercial_ops_gated")!.initially_eligible);
  assertFalse(byId.get("commercial_leadership_signal")!.initially_eligible);
  assert(deferredPacks(v.packs).length >= 2);
});

Deno.test("17b. an evidence-gated pack marked eligible is deferred and given evidence", () => {
  const tax = validateRoleTaxonomy({
    taxonomy: deterministicRevenueOpsTaxonomy(), approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations",
  }).taxonomy!;
  const packs = deterministicRevenueOpsPacks();
  const gated = packs.find((p) => p.pack_id === "commercial_ops_gated")!;
  gated.initially_eligible = true;
  gated.description_evidence = [];
  gated.broadening_level = 1;

  const v = validateQueryPacks({ packs, taxonomy: tax, approvedCapabilities: APPROVED });
  const kept = v.packs.find((p) => p.pack_id === "commercial_ops_gated")!;
  assertFalse(kept.initially_eligible);
  assert(kept.description_evidence.length > 0);
  assert(kept.broadening_level >= 2);
});

Deno.test("pack selection never exceeds the per-call title ceiling or the batch budget", () => {
  const tax = validateRoleTaxonomy({
    taxonomy: deterministicRevenueOpsTaxonomy(), approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations",
  }).taxonomy!;
  const packs = validateQueryPacks({ packs: deterministicRevenueOpsPacks(), taxonomy: tax, approvedCapabilities: APPROVED }).packs;

  const sel = selectPacksForCall({
    packs, completedPackIds: [], capability: "yc_job_discovery",
    batch: {
      requestedLeads: 5, remainingLeads: 5, sourceMaximum: 200,
      costPerCallUsd: 0.25, remainingBudgetUsd: 5, completedSources: 0,
    },
  });
  assert(sel.selected.length >= 1);
  assert(sel.titles.length <= PACK_BOUNDS.hardTitleCeilingPerCall);
  assert(sel.batchDecision.count > 0);

  // Quota met ends sourcing — the existing sizer is the authority, not this module.
  const done = selectPacksForCall({
    packs, completedPackIds: [], capability: "yc_job_discovery",
    batch: {
      requestedLeads: 5, remainingLeads: 0, sourceMaximum: 200,
      costPerCallUsd: 0.25, remainingBudgetUsd: 5, completedSources: 0,
    },
  });
  assertEquals(done.selected.length, 0);
  assertEquals(done.skippedReason, "quota_met");
});

Deno.test("a pack already run is never selected again", () => {
  const tax = validateRoleTaxonomy({
    taxonomy: deterministicRevenueOpsTaxonomy(), approvedCapabilities: APPROVED, hiringRoleSeed: "Sales Operations",
  }).taxonomy!;
  const packs = validateQueryPacks({ packs: deterministicRevenueOpsPacks(), taxonomy: tax, approvedCapabilities: APPROVED }).packs;
  const eligible = packs.filter((p) => p.initially_eligible).map((p) => p.pack_id);
  const sel = selectPacksForCall({
    packs, completedPackIds: eligible, capability: "yc_job_discovery",
    batch: {
      requestedLeads: 5, remainingLeads: 5, sourceMaximum: 200,
      costPerCallUsd: 0.25, remainingBudgetUsd: 5, completedSources: 1,
    },
  });
  assertEquals(sel.selected.length, 0);
  assertEquals(sel.skippedReason, "no eligible unused query pack");
});

// ================================================== SOURCE ORDER (18,19,20) ==

Deno.test("19. a startup/SaaS mission can rank YC first", () => {
  const order = recommendSourceOrder(CARDS, {
    company_constraints: TRUTH.company_constraints, maximum_age_days: 60,
  });
  assertEquals(order[0].capability, "yc_job_discovery");
  assert(order[0].rationale.includes("early-stage"));
});

Deno.test("18/20. source order is derived from the query — it is not a global constant", () => {
  const startup = recommendSourceOrder(CARDS, {
    company_constraints: TRUTH.company_constraints, maximum_age_days: 60,
  }).map((s) => s.capability);

  // A large-enterprise, non-startup mission.
  const enterprise = recommendSourceOrder(CARDS, {
    company_constraints: {
      business_model: "enterprise services",
      company_stage: ["public", "enterprise"],
      employee_count: { min: 5000, max: 100000 },
      country: "United Kingdom",
    },
    maximum_age_days: 60,
  }).map((s) => s.capability);

  assertEquals(startup[0], "yc_job_discovery");
  assert(enterprise[0] !== "yc_job_discovery", "a non-startup mission must not open on the startup corpus");
  assert(JSON.stringify(startup) !== JSON.stringify(enterprise), "ordering did not vary with the mission");
});

// ============================================ STRATEGY VALIDATION (21,22,23,24) ==

Deno.test("canonical strategy validates and records its source", () => {
  const v = validateAdaptiveStrategy({ strategy: strategy(), truth: TRUTH, cards: CARDS });
  assert(v.outcome !== "rejected", v.rejection_reason ?? "");
  assert(v.strategy_source === "claude" || v.strategy_source === "claude_repaired");
  assertEquals(v.strategy!.source_plan[0].capability_key, "yc_job_discovery");
});

Deno.test("21. Company Brain cannot be weakened", () => {
  const widened = strategy({
    company_constraints: { ...TRUTH.company_constraints, employee_count: { min: 1, max: 5000 } },
  });
  const v = validateAdaptiveStrategy({ strategy: widened, truth: TRUTH, cards: CARDS });
  assertEquals(v.outcome, "rejected");
  assert(v.violations.some((x) => x.code === "employee_range_widened"));

  const moved = strategy({ company_constraints: { ...TRUTH.company_constraints, country: "Germany" } });
  const v2 = validateAdaptiveStrategy({ strategy: moved, truth: TRUTH, cards: CARDS });
  assertEquals(v2.outcome, "rejected");
  assert(v2.violations.some((x) => x.code === "geography_changed"));

  const remodelled = strategy({ company_constraints: { ...TRUTH.company_constraints, business_model: "B2C" } });
  const v3 = validateAdaptiveStrategy({ strategy: remodelled, truth: TRUTH, cards: CARDS });
  assertEquals(v3.outcome, "rejected");
  assert(v3.violations.some((x) => x.code === "company_constraints_weakened"));
});

Deno.test("22. the requested quota cannot change", () => {
  for (const n of [3, 25]) {
    const s = strategy();
    s.mission.requested_count = n;
    const v = validateAdaptiveStrategy({ strategy: s, truth: TRUTH, cards: CARDS });
    assertEquals(v.outcome, "rejected");
    assert(v.violations.some((x) => x.code === "requested_count_changed"));
  }
});

Deno.test("23. the final entity cannot change", () => {
  const s = strategy();
  s.mission.final_entity = "account";
  const v = validateAdaptiveStrategy({ strategy: s, truth: TRUTH, cards: CARDS });
  assertEquals(v.outcome, "rejected");
  assert(v.violations.some((x) => x.code === "final_entity_changed"));
});

Deno.test("24. recency can be tightened but never exceed 60 days", () => {
  const over = strategy({ recency_policy: { preferred_age_days: 30, maximum_age_days: 90 } });
  const v = validateAdaptiveStrategy({ strategy: over, truth: TRUTH, cards: CARDS });
  assertEquals(v.outcome, "rejected");
  assert(v.violations.some((x) => x.code === "recency_exceeded"));
  assertEquals(MAX_RECENCY_DAYS, 60);

  const tighter = strategy({ recency_policy: { preferred_age_days: 14, maximum_age_days: 21 } });
  const ok = validateAdaptiveStrategy({ strategy: tighter, truth: TRUTH, cards: CARDS });
  assert(ok.outcome !== "rejected");
  assertEquals(ok.strategy!.recency_policy.maximum_age_days, 21);
});

Deno.test("24b. a per-step recency above the ceiling is tightened, not accepted", () => {
  const s = strategy();
  s.source_plan[0].semantic_filters = { maximum_age_days: 120 };
  const v = validateAdaptiveStrategy({ strategy: s, truth: TRUTH, cards: CARDS });
  assert(v.outcome !== "rejected");
  assertEquals(v.strategy!.source_plan[0].semantic_filters.maximum_age_days, 60);
  assert(v.repairs.some((r) => r.code === "recency_tightened_to_ceiling"));
});

Deno.test("decision-maker roles may not be used as hiring-role search titles", () => {
  const s = strategy();
  s.query_packs = [
    ...deterministicRevenueOpsPacks(),
    {
      pack_id: "founders", label: "Founders", functional_family_ids: [], confidence_tier: "exact",
      titles: ["Founder", "CEO"], aliases: [], negative_patterns: [], description_evidence: [],
      recommended_capabilities: [], priority: 1, broadening_level: 1, initially_eligible: true,
      maximum_attempts: 1, expected_precision: "high", expected_coverage: "high",
    },
  ];
  const v = validateAdaptiveStrategy({ strategy: s, truth: TRUTH, cards: CARDS });
  assertEquals(v.outcome, "rejected");
  assert(v.violations.some((x) => x.code === "decision_maker_role_used_as_hiring_title"));
});

Deno.test("an unapproved capability is rejected", () => {
  const s = strategy({
    source_plan: [{
      step_id: "s1", capability_key: "ats_job_verification", purpose: "verify",
      query_pack_ids: [], semantic_filters: {}, success_condition: {}, exhaustion_condition: {}, switch_condition: {},
    }],
  });
  const v = validateAdaptiveStrategy({ strategy: s, truth: TRUTH, cards: CARDS });
  assertEquals(v.outcome, "rejected");
  assert(v.violations.some((x) => x.code === "unapproved_capability"));
});

Deno.test("10b. filters a source cannot express provider-side are recorded, never faked", () => {
  const v = validateAdaptiveStrategy({ strategy: strategy(), truth: TRUTH, cards: CARDS });
  assert(v.outcome !== "rejected");
  // Every card in this fixture reports companySize/companyStage false, and the
  // mission constrains both — so each chosen step must declare the gap.
  const yc = v.unenforceable_filters["yc_job_discovery"];
  assert(yc.includes("employee_count"));
  assert(yc.includes("company_stage"));
  // YC additionally cannot filter recency provider-side.
  assert(yc.includes("posting_window"));
  // LinkedIn can filter recency, so it must NOT claim that gap.
  assertFalse((v.unenforceable_filters["linkedin_job_discovery"] ?? []).includes("posting_window"));
});

Deno.test("strategy parsing rejects a payload with no requested_count", () => {
  assertEquals(parseAdaptiveStrategy({ mission: { final_entity: "contact_ready_lead" } }), null);
  assertEquals(parseAdaptiveStrategy(null), null);
  const ok = parseAdaptiveStrategy({
    mission: { interpreted_goal: "g", final_entity: "contact_ready_lead", requested_count: 5, decision_maker_roles: ["Founder"] },
    company_constraints: TRUTH.company_constraints,
    recency_policy: { maximum_age_days: 60 },
    source_plan: [{ step_id: "s1", capability_key: "yc_job_discovery", purpose: "p", query_pack_ids: ["a"] }],
  });
  assertEquals(ok!.mission.requested_count, 5);
  assertEquals(ok!.source_plan.length, 1);
});

// ================================================================ SCENARIO A ==

Deno.test("Scenario A — the canonical query yields a startup-aware, bounded strategy", () => {
  const ctx = buildAdaptivePlanningContext({
    originalUserQuery: CANONICAL_QUERY, truth: TRUTH,
    remainingBudgetUsd: 5, remainingProviderCalls: 8, cards: CARDS,
  });
  // 1. The mission reaches the strategist intact, with the two role kinds separate.
  assertEquals(ctx.hiring_role_seed, "Sales Operations");
  assertEquals(ctx.decision_maker_roles, ["Founder", "Co-Founder", "CEO"]);
  assert(contextCarriesNoSecrets(ctx));

  // 2. The proposed strategy survives validation.
  const v = validateAdaptiveStrategy({ strategy: strategy(), truth: TRUTH, cards: CARDS });
  assert(v.outcome !== "rejected", v.rejection_reason ?? "");
  const s = v.strategy!;

  // 3. Bounded role families, exact tier leading.
  assert(s.role_taxonomy.families.length >= 4);
  assert(s.role_taxonomy.families.some((f) => f.confidence_tier === "exact" && f.initially_eligible));

  // 4. Balanced packs — not one giant query.
  assert(s.query_packs.length >= 5);
  for (const p of s.query_packs) assert(p.titles.length <= PACK_BOUNDS.maxTitlesPerPack);

  // 5. YC before the broad generic sources, because the mission is startup-shaped.
  assertEquals(s.source_plan[0].capability_key, "yc_job_discovery");
  const preferred = recommendSourceOrder(CARDS, {
    company_constraints: TRUTH.company_constraints, maximum_age_days: 60,
  }).map((x) => x.capability);
  assertEquals(preferred[0], "yc_job_discovery");
  assert(preferred.indexOf("yc_job_discovery") < preferred.indexOf("indeed_job_discovery"));

  // 6. Founder/CEO never became a job-search title.
  const allTitles = s.query_packs.flatMap((p) => p.titles.map((t) => t.toLowerCase()));
  for (const r of ["founder", "co-founder", "ceo"]) assertFalse(allTitles.includes(r));

  // 7. Quota, entity and recency ceiling all survive unchanged.
  assertEquals(s.mission.requested_count, 5);
  assertEquals(s.mission.final_entity, "contact_ready_lead");
  assert(s.recency_policy.maximum_age_days <= MAX_RECENCY_DAYS);
});
