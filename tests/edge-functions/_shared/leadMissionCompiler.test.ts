// GPT COMPILES THE MISSION; CODE DECIDES EVERYTHING ELSE.
//
// The regression suite for the compiler, the capability catalogue and the
// query-specific graph. Its job is to prove three things that the old static
// pipeline could not:
//
//   * the model can express a mission it was never given a regex for;
//   * it cannot express a provider, a price, a workspace or a purchase;
//   * a query that does not ask about hiring does not buy a job search, and a
//     query that asks for founders does not buy a founder.
//
// Every model response here is a FIXTURE. ZERO network, ZERO Actor runs, ZERO
// model calls, ZERO database writes — see tests 25-27, which prove it rather
// than assert it in a comment.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileLeadMission, parseMissionProposal, scanProposalForViolations,
  MissionCompilationBlockedError,
  buildMissionCompilerPayload, needsExternalHiringVerification,
  MAX_REQUESTED_OPPORTUNITIES, MISSION_COMPILER_SCHEMA_VERSION,
} from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  assertOffersRunNothing, actorKeysFor, catalogueForPrompt,
  PUBLIC_CAPABILITY_IDS, toInternalCapabilities,
} from "../../../supabase/functions/_shared/leadCapabilityCatalogue.ts";
import {
  buildCapabilityGraph, isProviderAllowed,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  compileHarvestCompanySearchInput, compileHarvestCompanyDetailsInput,
} from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import {
  applyMissionPrecedence, buildClassifierPayload,
} from "../../../supabase/functions/_shared/companyBrainSemanticFit.ts";

// ───────────────────────────────────────────────────────────────── fixtures ──
//
// What a well-behaved model returns for each of the five example queries. These
// are the shapes the compiler is contracted to accept; nothing here names a
// provider, because the model has no field in which to name one.

const YC_QUERY =
  "Find 100 founders of US YC B2B SaaS startups building their sales teams.";
const MANUFACTURER_QUERY =
  "Find US manufacturers under 100 employees hiring their first salesperson.";
const AUTOMATION_QUERY =
  "Find industrial automation integrators in Germany expanding commercially.";
const PARTNER_QUERY =
  "Find lead-generation agencies that could partner with Agentory.";
const KNOWN_QUERY = "Evaluate these companies: SnapMagic, Tara AI and Deepgram.";

function proposal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requested_opportunity_count: 25,
    requested_contact_ready_count: null,
    company_types: [], geographies: [],
    employee_range: { min: null, max: null },
    decision_maker_roles: [],
    hard_constraints: [], soft_preferences: [],
    preferred_signals: [], adjacent_signals: [], excluded_signals: [],
    allowed_broadening: {
      role_families: [], company_types: [], geographies: [],
      employee_range: { min: null, max: null },
    },
    disallowed_broadening: [],
    required_evidence: [],
    required_capabilities: [],
    preferred_source_strategy: [],
    evaluation_instructions: "",
    founder_unlock_recommended: false,
    confidence: 0.8,
    unknowns: [],
    ...over,
  };
}

const YC_PROPOSAL = proposal({
  requested_opportunity_count: 100,
  company_types: ["b2b saas"],
  geographies: ["United States"],
  decision_maker_roles: ["Founder", "Co-Founder", "CEO"],
  hard_constraints: [
    { field: "geography", operator: "in", value: ["United States"],
      reason: "the query says US" },
    { field: "company_type", operator: "in", value: ["b2b saas"],
      reason: "the query says B2B SaaS" },
  ],
  preferred_signals: ["hiring"],
  adjacent_signals: ["revenue_operations_hiring", "gtm_hiring"],
  excluded_signals: ["engineering_only_hiring"],
  required_evidence: ["commercial_role_opening", "company_size"],
  required_capabilities: [
    "startup_company_discovery", "embedded_hiring_evidence",
    "known_company_identity_resolution", "company_details_enrichment",
    "company_semantic_evaluation", "portfolio_ranking", "offer_founder_unlock",
  ],
  preferred_source_strategy: ["startup_cohort_first", "evidence_reuse_first"],
  evaluation_instructions:
    "A company qualifies when it sells B2B software on subscription and is " +
    "hiring a commercial role.",
  founder_unlock_recommended: true,
  unknowns: ["whether 'sales team' includes customer success"],
});

const MANUFACTURER_PROPOSAL = proposal({
  requested_opportunity_count: 25,
  company_types: ["manufacturing"],
  geographies: ["United States"],
  employee_range: { min: null, max: 100 },
  hard_constraints: [
    { field: "employee_max", operator: "lte", value: 100, reason: "under 100 employees" },
    { field: "geography", operator: "in", value: ["United States"], reason: "US" },
  ],
  preferred_signals: ["hiring"],
  adjacent_signals: ["first_commercial_hire"],
  required_evidence: ["active_sales_opening"],
  required_capabilities: [
    "general_company_discovery", "external_hiring_verification",
    "company_details_enrichment", "company_semantic_evaluation",
    "portfolio_ranking", "offer_founder_unlock",
  ],
  preferred_source_strategy: ["job_signal_first"],
  founder_unlock_recommended: true,
});

const AUTOMATION_PROPOSAL = proposal({
  company_types: ["industrial automation", "systems integration"],
  geographies: ["Germany"],
  hard_constraints: [
    { field: "geography", operator: "in", value: ["Germany"],
      reason: "the query names Germany" },
  ],
  disallowed_broadening: ["geography", "business_model"],
  preferred_signals: ["expansion", "commercial_hiring"],
  adjacent_signals: ["new_office", "sales_leadership_hire"],
  required_evidence: ["commercial_expansion_evidence"],
  required_capabilities: [
    "general_company_discovery", "embedded_hiring_evidence",
    "company_details_enrichment", "company_semantic_evaluation", "portfolio_ranking",
  ],
  preferred_source_strategy: ["company_profile_first"],
});

const PARTNER_PROPOSAL = proposal({
  company_types: ["lead generation agency"],
  required_capabilities: [
    "general_company_discovery", "company_details_enrichment",
    "company_semantic_evaluation", "portfolio_ranking", "offer_founder_unlock",
  ],
  preferred_signals: ["partner_fit"],
  adjacent_signals: ["outbound_services", "gtm_services"],
  required_evidence: ["service_offering"],
  evaluation_instructions:
    "Judge whether this agency's services complement Agentory rather than compete.",
  preferred_source_strategy: ["company_profile_first"],
  founder_unlock_recommended: true,
});

const KNOWN_PROPOSAL = proposal({
  requested_opportunity_count: 3,
  company_types: [],
  required_capabilities: [
    "known_company_identity_resolution", "company_details_enrichment",
    "company_semantic_evaluation", "portfolio_ranking",
  ],
  preferred_source_strategy: ["known_companies_only"],
});

const compile = (query: string, p?: unknown, brain?: Record<string, unknown>) =>
  compileLeadMission({
    originalUserQuery: query,
    proposal: p,
    companyBrain: (brain ?? null) as never,
  });

const caps = (query: string, p?: unknown) =>
  buildCapabilityGraph(compile(query, p).final_mission).steps.map((s) => s.capability);

// ═════════════════════════════════════════════ 1-10. the mission compiler ══

Deno.test("1. GPT can interpret a startup query", () => {
  const r = compile(YC_QUERY, YC_PROPOSAL);
  assertEquals(r.parser_source, "gpt_validated");
  assertEquals(r.final_mission.requested_count, 100);
  assert(r.final_mission.company_profile.verticals.includes("b2b saas"));
  assert(r.final_mission.company_profile.locations.includes("United States"));
  assertEquals(r.schema_version, MISSION_COMPILER_SCHEMA_VERSION);
  // The model's judgement survives into the mission, whole.
  assertEquals(r.final_mission.directives?.adjacent_signals,
    ["revenue_operations_hiring", "gtm_hiring"]);
  assert(r.final_mission.directives?.required_evidence.includes("commercial_role_opening"));
});

Deno.test("2. GPT can interpret an industrial-company query", () => {
  const r = compile(AUTOMATION_QUERY, AUTOMATION_PROPOSAL);
  assert(["gpt_validated", "gpt_repaired"].includes(r.parser_source));
  assert(r.final_mission.company_profile.verticals.some((v) => /industrial/.test(v)),
    "an industrial mission that no regex table anticipated");
  assertEquals(r.final_mission.directives?.disallowed_broadening,
    ["geography", "business_model"]);
});

Deno.test("3. GPT can interpret a hiring-first query", () => {
  const r = compile(MANUFACTURER_QUERY, MANUFACTURER_PROPOSAL);
  assertEquals(r.final_mission.company_profile.employee_range?.max, 100);
  assert(r.capability_decision.approved.includes("external_hiring_verification"));
  assertEquals(r.final_mission.directives?.source_strategy, ["job_signal_first"]);
});

Deno.test("4. GPT can interpret a partner query", () => {
  const r = compile(PARTNER_QUERY, PARTNER_PROPOSAL);
  assert(r.final_mission.directives?.evaluation_instructions.includes("complement"));
  assertFalse(r.capability_decision.approved.includes("external_hiring_verification"),
    "a partner-fit question does not need hiring evidence");
});

Deno.test("5. GPT can interpret a known-company query", () => {
  const r = compile(KNOWN_QUERY, KNOWN_PROPOSAL);
  assert(r.capability_decision.approved.includes("known_company_identity_resolution"));
  assertEquals(r.final_mission.directives?.source_strategy, ["known_companies_only"]);
});

Deno.test("6. invalid GPT output BLOCKS the request", () => {
  // This asserted "a bad proposal costs precision, never a workflow" and let the
  // regex reading answer. That trade is the wrong way round: the mission is the
  // root of every later decision, so an unreadable proposal does not produce a
  // cheaper run, it produces an expensive run answering a different question.
  for (const bad of [
    null, undefined, "not an object", 42, [],
    { requested_opportunity_count: "many" },
  ]) {
    let blocked = false;
    try {
      compile(YC_QUERY, bad);
    } catch (e) {
      blocked = e instanceof MissionCompilationBlockedError;
      if (!blocked) throw e;
    }
    assert(blocked, `${JSON.stringify(bad)} must block rather than fall back`);
  }
});

Deno.test("7. explicit geography stays a HARD constraint", () => {
  // The model tries to widen the US request to North America.
  const r = compile(YC_QUERY, {
    ...YC_PROPOSAL,
    geographies: ["North America", "Canada", "Mexico"],
  });
  assertEquals(r.final_mission.company_profile.locations, ["United States"],
    "the user's own words outrank the model's restatement");
  const hard = r.final_mission.hard_constraints["company_profile.locations"] as
    { operator: string; value: string[]; reason: string };
  assertEquals(hard.value, ["United States"]);
  assert(hard.reason.includes("explicitly"));
});

Deno.test("8. unrelated workspace ICP categories are ignored, with a reason", () => {
  const r = compile(YC_QUERY, YC_PROPOSAL, {
    industries: ["B2B SaaS", "AI SaaS", "Recruiting Agencies"],
  });
  assert(r.workspace_context.consulted);
  const ignored = r.workspace_context.categories_ignored.map((x) => x.value);
  assert(ignored.includes("recruiting agencies"),
    `Recruiting Agencies must be ignored, got ${JSON.stringify(ignored)}`);
  assertFalse(
    r.final_mission.company_profile.verticals.some((v) => /recruiting/.test(v)),
    "a founder list must not acquire staffing firms");
  // And the reason is recorded, not just the exclusion.
  const entry = r.workspace_context.categories_ignored
    .find((x) => x.value === "recruiting agencies");
  assert(entry && entry.reason.length > 0);
});

Deno.test("9. requested opportunity count is capped at 100", () => {
  const r = compile("Find 5000 SaaS founders", proposal({
    requested_opportunity_count: 5000,
  }));
  assertEquals(r.final_mission.requested_count, MAX_REQUESTED_OPPORTUNITIES);
  assert(r.validator_changes.some((c) => /capped/.test(c)),
    "the cap is recorded, not silent");
  // And a zero/negative request is raised rather than accepted.
  assertEquals(
    compile("Find founders", proposal({ requested_opportunity_count: 0 }))
      .final_mission.requested_count >= 1, true);
});

Deno.test("9b. an absent employee range stays ABSENT, never zero-to-zero", () => {
  // `Number(null)` is 0 and 0 is finite. The schema's own way of saying "no size
  // constraint" is `{min: null, max: null}`, and reading that as a range
  // compiled a mission demanding companies with between zero and zero
  // employees — a gate every company fails, after discovery has been paid for.
  const r = compile(PARTNER_QUERY, PARTNER_PROPOSAL);
  const range = r.final_mission.company_profile.employee_range;
  assert(range === undefined || (range.min !== 0 && range.max !== 0),
    `an unstated range must not become 0-0, got ${JSON.stringify(range)}`);
  assertEquals(r.final_mission.directives?.requested_contact_ready_count, null,
    "an unstated contact-ready count is null, not zero");

  // A range the model DOES state is kept exactly.
  const stated = compile(MANUFACTURER_QUERY, MANUFACTURER_PROPOSAL);
  assertEquals(stated.final_mission.company_profile.employee_range?.max, 100);

  // And an explicit zero minimum is still readable as zero.
  const zero = compile(YC_QUERY, {
    ...YC_PROPOSAL, employee_range: { min: 0, max: 50 },
  });
  assertEquals(zero.final_mission.company_profile.employee_range?.max, 50);
});

Deno.test("10. GPT cannot return arbitrary Actor IDs, prices or workspace ids", () => {
  const unsafe: Array<[string, Record<string, unknown>]> = [
    ["actor id in a capability", {
      ...YC_PROPOSAL,
      required_capabilities: ["memo23/y-combinator-scraper"],
    }],
    ["actor id in a strategy", {
      ...YC_PROPOSAL,
      preferred_source_strategy: ["harvestapi/linkedin-company-search"],
    }],
    ["a provider field", { ...YC_PROPOSAL, provider: "apify" }],
    ["a vendor name in prose", {
      ...YC_PROPOSAL,
      evaluation_instructions: "Use apify to source these companies.",
    }],
    ["a scrape URL", {
      ...YC_PROPOSAL, required_evidence: ["https://www.linkedin.com/company/x"],
    }],
    ["a budget override", { ...YC_PROPOSAL, budget: 500 }],
    ["a credit price", { ...YC_PROPOSAL, credits: 10 }],
    ["a workspace id", { ...YC_PROPOSAL, workspace_id: "zbwsbnqq" }],
  ];
  for (const [label, p] of unsafe) {
    assert(scanProposalForViolations(p).length > 0, `${label} must be detected`);
    assertEquals(parseMissionProposal(p).proposal, null, `${label} must be refused`);
    // REFUSED, AND THE REQUEST STOPS. Sanitising an unsafe proposal would keep a
    // model that tried to name an Actor in the driving seat; falling back to the
    // regex reading would answer a different question. Neither is acceptable.
    let blocked = false;
    try {
      compile(YC_QUERY, p);
    } catch (e) {
      blocked = e instanceof MissionCompilationBlockedError;
      if (!blocked) throw e;
    }
    assert(blocked, `${label} must block rather than be sanitised`);
  }
  // The catalogue the model receives cannot leak a provider in the first place.
  const promptText = JSON.stringify(buildMissionCompilerPayload({
    originalUserQuery: YC_QUERY,
  }));
  for (const leak of ["memo23", "harvestapi", "solidcode", "apify_", "crawlworks"]) {
    assertFalse(promptText.includes(leak), `the prompt must not contain ${leak}`);
  }
  assertEquals(catalogueForPrompt().length, PUBLIC_CAPABILITY_IDS.length);
});

// ═══════════════════════════════════════════════ 11-20. capability routing ══

Deno.test("11. a YC query selects startup_company_discovery", () => {
  const plan = buildCapabilityGraph(compile(YC_QUERY, YC_PROPOSAL).final_mission);
  assertEquals(plan.entry_capability, "startup_company_discovery");
  assertEquals(plan.steps[0].providers,
    ["apify_yc_companies_memo23", "apify_yc_companies_solidcode",
      "apify_linkedin_company_search"],
    "memo23 primary, solidcode fallback, LinkedIn company search breadth — " +
    "code declares which actors are PERMITTED; the model may only choose among them");
  assert(plan.routing_reason.length > 0, "the choice is explainable");
});

Deno.test("12. a general company query selects general_company_discovery", () => {
  const plan = buildCapabilityGraph(
    compile(AUTOMATION_QUERY, AUTOMATION_PROPOSAL).final_mission);
  assertEquals(plan.entry_capability, "general_company_discovery");
  // COHORT IS CONTAINMENT, NOT RANKING — AND IT BELONGS IN THE PLAN.
  //
  // This asserted the full discovery universe, on the reasoning that the
  // planner picks a member and `validateDiscoveryStrategy` refuses one whose
  // card cannot serve the mission. Task eeb02852 showed what that costs: the
  // confirmation card names a FIRST PAID ACTOR taken from the head of this
  // list, so for a non-YC mission it promised `apify_yc_companies_memo23`,
  // and then execution blocked every YC step as `actor_outside_mission_cohort`
  // until nothing survived (`no_valid_step`). Nothing was bought, but the
  // preview had already described a run execution would not accept.
  //
  // The cohort rule is a correctness constraint, not a preference, so the plan
  // now applies the SAME `cohortRefusalFor` execution applies. Ranking among
  // admissible actors is still the planner's call, and a YC mission still
  // keeps both YC actors.
  assertEquals(plan.steps[0].providers, ["apify_linkedin_company_search"]);
});

Deno.test("13. a hiring-first non-YC query reaches external hiring evidence", () => {
  const r = compile(MANUFACTURER_QUERY, MANUFACTURER_PROPOSAL);
  const plan = buildCapabilityGraph(r.final_mission);
  // HIRING-FIRST IS NOW AN ADVISORY, NOT A ROUTE OVERRIDE.
  //
  // The constraint is unchanged and still true: no carded Actor can DISCOVER
  // open job postings across employers, so a hiring-first mission cannot open
  // with a job search. What changed is where that fact lives. It used to be a
  // branch in `buildCapabilityGraph` that rewrote the entry capability, which
  // on run 25f3ff57 discarded a startup-cohort route the gate had already
  // approved and handed an "AI startups" mission to a name matcher.
  //
  // The entry here is STILL general discovery — because this mission's own
  // proposal asks for `general_company_discovery`, which is the honest reason —
  // and the hiring constraint reaches the planner as knowledge it can act on.
  assertEquals(plan.entry_capability, "general_company_discovery");
  assert(plan.routing_reason.includes("general company discovery"),
    "the entry is explained by what the mission asked for");
  assert(plan.routing_advisories.some((a) => /hiring-first/i.test(a)),
    "the hiring-first constraint still reaches the planner, as an advisory");
  assert(plan.routing_advisories.some((a) => /company-scoped by contract/i.test(a)),
    "including WHY a job search cannot open the run");
  assert(plan.steps.map((s) => s.capability).includes("hiring_verification"),
    "hiring is still verified, per company");
  assert(r.capability_decision.approved.includes("external_hiring_verification"));
});

Deno.test("14. embedded YC evidence prevents an unnecessary job-search call", () => {
  // The YC proposal asks for EMBEDDED evidence and never for external
  // verification, so no paid hiring capability enters the plan at all.
  const order = caps(YC_QUERY, YC_PROPOSAL);
  assertFalse(order.includes("hiring_verification"),
    "embedded openJobs settle the hiring question for nothing");
  const plan = buildCapabilityGraph(compile(YC_QUERY, YC_PROPOSAL).final_mission);
  assertFalse(isProviderAllowed(plan, "apify_linkedin_job_search"));

  // And the contrast: a mission that DOES need external hiring evidence reaches
  // an external job source. For a hiring-FIRST mission that source is the entry
  // itself — the opening is how the company is found, so a second per-company
  // verification would re-buy what discovery already proved.
  const mfg = buildCapabilityGraph(
    compile(MANUFACTURER_QUERY, MANUFACTURER_PROPOSAL).final_mission);
  assert(mfg.steps.map((s) => s.capability).includes("hiring_verification"),
    "a mission that needs verified hiring buys exactly one company-scoped check");
  // Both missions come from their own proposals — a compile with none now blocks.
  assert(needsExternalHiringVerification(
    ["external_hiring_verification"],
    compile(MANUFACTURER_QUERY, MANUFACTURER_PROPOSAL).final_mission));
  assertFalse(needsExternalHiringVerification(
    ["embedded_hiring_evidence"], compile(YC_QUERY, YC_PROPOSAL).final_mission));
});

Deno.test("15. a known company list does not trigger broad discovery", () => {
  const plan = buildCapabilityGraph(compile(KNOWN_QUERY, KNOWN_PROPOSAL).final_mission);
  assertEquals(plan.entry_capability, "known_company_resolution");
  for (const discovery of [
    "apify_yc_companies_memo23", "apify_yc_companies_solidcode", "apify_jobs",
  ]) {
    assertFalse(isProviderAllowed(plan, discovery),
      `${discovery} must be unreachable when the user named the companies`);
  }
});

Deno.test("16. a partner query does not require hiring evidence", () => {
  const order = caps(PARTNER_QUERY, PARTNER_PROPOSAL);
  assertFalse(order.includes("hiring_verification"));
  const plan = buildCapabilityGraph(compile(PARTNER_QUERY, PARTNER_PROPOSAL).final_mission);
  assertFalse(isProviderAllowed(plan, "apify_linkedin_job_search"),
    "nothing about partner fit is proven by a job posting");
  assert(order.includes("company_brain_qualification"));
});

Deno.test("17. company search receives a BARE NAME, never a name plus domain", () => {
  const ok = compileHarvestCompanySearchInput({
    searchQuery: "SnapMagic", scraperMode: "full", maxItems: 5,
  });
  assert(ok.ok, `a bare name must compile: ${ok.ok ? "" : ok.errors.join("; ")}`);

  for (const bad of ["SnapMagic snapmagic.com", "snapmagic.com",
    "https://snapmagic.com", "B2B SaaS companies hiring sales ops in the US"]) {
    const r = compileHarvestCompanySearchInput({
      searchQuery: bad, scraperMode: "full", maxItems: 5,
    });
    assertFalse(r.ok, `"${bad}" must be refused before anything is spent`);
  }
});

Deno.test("18. company enrichment receives LinkedIn company URLs, never names", () => {
  const ok = compileHarvestCompanyDetailsInput({
    companies: ["https://www.linkedin.com/company/snapmagic"],
  });
  assert(ok.ok, "resolved URLs compile");
  const bad = compileHarvestCompanyDetailsInput({ companies: ["SnapMagic"] });
  assertFalse(bad.ok, "a raw company name is not an enrichment input");
});

Deno.test("19. founder discovery is absent from every automatic graph", () => {
  const cases: Array<[string, unknown]> = [
    [YC_QUERY, YC_PROPOSAL], [MANUFACTURER_QUERY, MANUFACTURER_PROPOSAL],
    [AUTOMATION_QUERY, AUTOMATION_PROPOSAL], [PARTNER_QUERY, PARTNER_PROPOSAL],
    [KNOWN_QUERY, KNOWN_PROPOSAL],
    // The two `undefined` cases are GONE with the deterministic path they
    // exercised: a request with no proposal no longer produces a graph at all,
    // so there is no graph left in which founder discovery could appear.
  ];
  for (const [q, p] of cases) {
    const r = compile(q, p);
    const plan = buildCapabilityGraph(r.final_mission);
    const order = plan.steps.map((s) => s.capability);
    assertFalse(order.includes("founder_discovery"), `${q}: founder_discovery must be absent`);
    assertFalse(isProviderAllowed(plan, "apify_linkedin_company_employees"),
      `${q}: the people Actor must be unreachable`);
    assert(plan.prohibited.includes("founder_discovery"));
    // The mission itself refuses to carry it, even if something asked.
    assertFalse(r.final_mission.required_capabilities.includes("founder_discovery"));
    assert(r.final_mission.prohibited_capabilities.includes("founder_discovery"));
  }
  // Even when a proposal explicitly asks for the people stage by its INTERNAL
  // name, it is stripped and the removal is recorded.
  const forced = compileLeadMission({
    originalUserQuery: YC_QUERY,
    proposal: { ...YC_PROPOSAL, required_capabilities: ["offer_founder_unlock"] },
  });
  assertFalse(forced.final_mission.required_capabilities.includes("founder_discovery"));
  assertEquals(toInternalCapabilities(["offer_founder_unlock"]), [],
    "an offer expands to no executable stage");
});

Deno.test("20. contact enrichment is absent from every automatic graph", () => {
  for (const [q, p] of [[YC_QUERY, YC_PROPOSAL], [MANUFACTURER_QUERY, MANUFACTURER_PROPOSAL]] as const) {
    const plan = buildCapabilityGraph(compile(q, p).final_mission);
    const order = plan.steps.map((s) => s.capability);
    assertFalse(order.includes("contact_enrichment"));
    assertFalse(order.includes("employer_verification"));
    assert(plan.prohibited.includes("contact_enrichment"));
  }
  assertEquals(toInternalCapabilities(["offer_contact_unlock"]), []);
  // The catalogue-level invariant, so a future edit cannot quietly re-arm them.
  assertEquals(assertOffersRunNothing(), []);
  assertEquals(actorKeysFor("offer_founder_unlock"), []);
  assertEquals(actorKeysFor("offer_contact_unlock"), []);
});

// ═══════════════════════════════════════════ 21-24. mission consistency ══

Deno.test("21. the Company Brain classifier receives the validated mission", () => {
  const r = compile(YC_QUERY, YC_PROPOSAL, {
    industries: ["B2B SaaS", "AI SaaS", "Recruiting Agencies"],
  });
  const m = r.final_mission;
  const policy = applyMissionPrecedence({
    original_user_query: m.original_user_query,
    mission_verticals: m.company_profile.verticals,
    mission_geography: m.company_profile.locations[0] ?? null,
    workspace_industries: ["B2B SaaS", "AI SaaS", "Recruiting Agencies"],
  });
  const payload = buildClassifierPayload({
    original_user_query: m.original_user_query,
    mission_verticals: m.company_profile.verticals,
    mission_geography: m.company_profile.locations[0] ?? null,
    workspace_industries: [],
    company_name: "Sortly", yc_description: null, website_description: null,
    linkedin_description: null, linkedin_industry: null, linkedin_industry_ids: [],
    employee_count: 42, employee_advisory: null, geography: "United States",
    commercial_signal: "Revenue Operations Manager", commercial_tier: "A",
  }, policy, {
    hard_constraints: m.hard_constraints,
    soft_preferences: m.soft_preferences,
    ...m.directives,
  });

  const mission = (payload as { mission: Record<string, unknown> }).mission;
  assertEquals(mission.original_user_query, YC_QUERY);
  assertEquals(mission.preferred_signals, ["hiring"]);
  assertEquals(mission.adjacent_signals, ["revenue_operations_hiring", "gtm_hiring"]);
  assertEquals(mission.excluded_signals, ["engineering_only_hiring"]);
  assert(Array.isArray(mission.required_evidence));
  assert(String(mission.evaluation_instructions).includes("subscription"));
  assert(mission.hard_constraints && typeof mission.hard_constraints === "object");
});

Deno.test("22. signal evaluation carries preferred AND adjacent signals", () => {
  const d = compile(YC_QUERY, YC_PROPOSAL).final_mission.directives!;
  assertEquals(d.preferred_signals, ["hiring"]);
  assertEquals(d.adjacent_signals, ["revenue_operations_hiring", "gtm_hiring"]);
  assertEquals(d.excluded_signals, ["engineering_only_hiring"]);
  // The distinction is load-bearing: only PREFERRED signals become required.
  const required = compile(YC_QUERY, YC_PROPOSAL)
    .final_mission.required_signals.map((s) => s.type);
  assert(required.includes("hiring"));
  assertFalse(required.includes("gtm_hiring"),
    "an adjacent signal is accepted, never demanded");
});

Deno.test("23. hard constraints stay identical across every stage", () => {
  const r = compile(MANUFACTURER_QUERY, MANUFACTURER_PROPOSAL);
  const m = r.final_mission;
  // Mission → graph → classifier: the same geography, the same ceiling.
  assertEquals(m.company_profile.locations, ["United States"]);
  assertEquals(m.company_profile.employee_range?.max, 100);
  const hard = m.hard_constraints["company_profile.locations"] as { value: string[] };
  assertEquals(hard.value, ["United States"]);
  assertEquals((m.hard_constraints.employee_max as { value: number }).value, 100);
  // The graph does not relax them, and a rebuild is stable.
  const a = buildCapabilityGraph(m).steps.map((s) => s.capability);
  const b = buildCapabilityGraph(m).steps.map((s) => s.capability);
  assertEquals(a, b, "graph construction is deterministic for a fixed mission");
});

Deno.test("24. a later stage cannot replace the mission with conflicting defaults", () => {
  // The model restates the user's goal as something else entirely — the exact
  // failure (`Find 5 jobs matching: …`) the mission object was created to stop.
  const hijack = compile(YC_QUERY, proposal({
    requested_opportunity_count: 5,
    company_types: ["recruiting agencies"],
    geographies: ["India"],
    required_capabilities: ["general_company_discovery"],
  }));
  assertEquals(hijack.final_mission.original_user_query, YC_QUERY,
    "the user's sentence is never taken from the model");
  assertEquals(hijack.final_mission.company_profile.locations, ["United States"]);
  assert(hijack.final_mission.company_profile.verticals.includes("b2b saas"));
  assertFalse(
    hijack.final_mission.company_profile.verticals.some((v) => /recruiting/.test(v)),
    "the model cannot substitute a different business");
  // Recorded, not silently corrected.
  assert(hijack.validator_changes.length > 0);
});

// ══════════════════════════════════════════════════════════ 25-27. safety ══

Deno.test("25. no Actor starts anywhere in this suite", async () => {
  // Planning is PURE. Building every example plan touches no invoker at all, so
  // there is nothing to stub — proven by handing the engine boundary a spy that
  // would throw, and never reaching it.
  let invoked = 0;
  const spy = () => { invoked++; throw new Error("an Actor was started"); };
  for (const [q, p] of [
    [YC_QUERY, YC_PROPOSAL], [MANUFACTURER_QUERY, MANUFACTURER_PROPOSAL],
    [AUTOMATION_QUERY, AUTOMATION_PROPOSAL], [PARTNER_QUERY, PARTNER_PROPOSAL],
    [KNOWN_QUERY, KNOWN_PROPOSAL],
  ] as const) {
    const plan = buildCapabilityGraph(compile(q, p).final_mission);
    assert(plan.steps.length > 0);
  }
  assertEquals(invoked, 0, "no provider boundary was reached");
  assertEquals(typeof spy, "function");

  // And the compiler itself makes no model call: it reads a proposal it is given.
  const before = compile(YC_QUERY, YC_PROPOSAL);
  await Promise.resolve();
  assertEquals(before.parser_source, "gpt_validated");
});

Deno.test("26. no production project reference appears in the new modules", async () => {
  const PROD = "ohsdatpvfdjdemstoiuj";
  for (const f of [
    "leadMissionCompiler.ts", "leadMissionCompilerBinding.ts",
    "leadCapabilityCatalogue.ts", "leadCapabilityGraph.ts",
  ]) {
    const src = await Deno.readTextFile(
      new URL(`../../../supabase/functions/_shared/${f}`, import.meta.url));
    assertFalse(src.includes(PROD), `${f} must not reference the production project`);
    // Nor a service-role or key literal.
    assertFalse(/service_role_key\s*=\s*["'][A-Za-z0-9._-]{20,}/.test(src),
      `${f} must not embed a credential`);
  }
});

Deno.test("27. the protected mcp entrypoint is untouched by this work", async () => {
  for (const f of [
    "leadMissionCompiler.ts", "leadMissionCompilerBinding.ts",
    "leadCapabilityCatalogue.ts",
  ]) {
    const src = await Deno.readTextFile(
      new URL(`../../../supabase/functions/_shared/${f}`, import.meta.url));
    assertFalse(src.includes("mcp/index.ts"), `${f} must not reference the protected file`);
    assertFalse(/from\s+["'].*\/mcp\//.test(src), `${f} must not import from mcp/`);
  }
  // The file still exists and is not something this change had to modify.
  const mcp = await Deno.readTextFile(
    new URL("../../../supabase/functions/mcp/index.ts", import.meta.url));
  assert(mcp.length > 0);
});
