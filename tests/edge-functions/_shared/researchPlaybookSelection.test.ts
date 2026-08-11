// MISSION → RESEARCH PLAYBOOK.
//
// `LeadMissionV1.strategies` carries the research SHAPE the interpreting model
// proposed — hiring, funding, social, news, supplied_company, multi_signal — and
// until now it had one consumer in the whole codebase and nothing dispatched on
// it. The shape was re-derived instead, in `buildCapabilityGraph`, from a mix of
// capabilities, source-strategy directives, signals and company stages that has
// no way to express "research this through social posts" at all. A mission
// asking for one got a company-profile search and no record that its actual
// shape was never attempted.
//
// These tests pin the dispatch boundary: what it selects, what it refuses to
// substitute, and what it reads to decide — which is Mission fields, never text.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  selectResearchPlaybooks, RESEARCH_PLAYBOOKS, PLAYBOOK_STRATEGY_COVERAGE,
  FORBIDDEN_PLAYBOOK_VOCABULARY, playbookProviders, playbookSelectionSummary,
  type ResearchPlaybookId,
} from "../../../supabase/functions/_shared/leadResearchPlaybooks.ts";
import {
  MISSION_STRATEGIES, LEAD_MISSION_VERSION, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { CAPABILITY_REGISTRY } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";

/** A sentence that names every shape at once — and decides none of them. */
const LOUD_QUERY =
  "Find recently funded startups hiring RevOps that are posting on LinkedIn " +
  "and in the news, at acme.com and globex.com";

function mission(over: Partial<LeadMissionV1> = {}): LeadMissionV1 {
  return {
    version: LEAD_MISSION_VERSION,
    original_user_query: LOUD_QUERY,
    mission_type: "qualified_lead_sourcing",
    target_entity: "person",
    requested_output: "contact_ready_leads",
    requested_count: 5,
    company_profile: {
      business_models: [], verticals: ["b2b saas"], stages: [], locations: [],
    },
    required_signals: [],
    decision_makers: { roles: [], current_employment_required: false },
    hard_constraints: {}, soft_preferences: {},
    required_capabilities: [], prohibited_capabilities: [],
    field_provenance: {}, confidence: 0.9,
    ...over,
  } as LeadMissionV1;
}

const ids = (s: ReturnType<typeof selectResearchPlaybooks>) =>
  s.playbooks.map((p) => p.playbook);
const unsupportedIds = (s: ReturnType<typeof selectResearchPlaybooks>) =>
  s.unsupported.map((u) => u.playbook);

// ───────────────────────── one strategy → one playbook ──────────────────────

Deno.test("a hiring Mission selects the hiring playbook", () => {
  const s = selectResearchPlaybooks(mission({ strategies: ["hiring"] }));
  assertEquals(ids(s), ["hiring"]);
  assertEquals(s.combination, "single");
  assertEquals(s.strategy_source, "mission_strategies");
  assert(s.ok);
  // It reaches the graph's own stages, not a private copy of them.
  assertEquals(s.playbooks[0].entry_capability, "general_company_discovery");
  assertEquals(s.playbooks[0].proving_capabilities, ["hiring_verification"]);
  assertEquals(
    s.playbooks[0].providers,
    CAPABILITY_REGISTRY.general_company_discovery.providers,
  );
});

Deno.test("a funding Mission selects the funding playbook", () => {
  const s = selectResearchPlaybooks(mission({ strategies: ["funding"] }));
  assertEquals(ids(s), ["funding"]);
  assertEquals(s.playbooks[0].entry_capability, "funding_signal_discovery");
  assert(s.playbooks[0].providers.length > 0, "funding discovery has an approved provider");
  assert(s.ok);
});

Deno.test("a supplied-company Mission selects the supplied-company playbook", () => {
  const s = selectResearchPlaybooks(mission({ strategies: ["supplied_company"] }));
  assertEquals(ids(s), ["supplied_company"]);
  assertEquals(s.playbooks[0].entry_capability, "known_company_resolution");
  // No providers, and that is not a gap: resolving companies the user named is
  // deterministic work the registry prices at zero.
  assertEquals(s.playbooks[0].providers, []);
  assertEquals(CAPABILITY_REGISTRY.known_company_resolution.cost_units, 0);
  assert(s.ok);
});

// ───────────────────── unsupported shapes are reported ──────────────────────

Deno.test("a social Mission reports an unsupported shape — it is not rerouted", () => {
  const s = selectResearchPlaybooks(mission({ strategies: ["social"] }));
  assertEquals(ids(s), [], "nothing runnable was selected");
  assertEquals(unsupportedIds(s), ["social"]);
  assertEquals(s.unsupported[0].gap, "no_capability_defined");
  assertFalse(s.ok);
  // The facts the next phase starts from: registered actors nothing may reach.
  assert(
    s.unsupported[0].unwired_actor_keys.includes("apify_linkedin_posts"),
    "the registered-but-unbound actors must be named",
  );
});

Deno.test("a news Mission reports an unsupported shape", () => {
  const s = selectResearchPlaybooks(mission({ strategies: ["news"] }));
  assertEquals(ids(s), []);
  assertEquals(unsupportedIds(s), ["news"]);
  assertEquals(s.unsupported[0].gap, "no_capability_defined");
  assertFalse(s.ok);
});

Deno.test("an unsupported shape never becomes hiring, discovery, or anything else", () => {
  for (const strategy of ["social", "news"] as const) {
    const s = selectResearchPlaybooks(mission({ strategies: [strategy] }));
    assertEquals(
      s.playbooks, [],
      `${strategy} must not resolve to a playbook nobody asked for`,
    );
    assertFalse(
      JSON.stringify(s.playbooks).includes("hiring"),
      `${strategy} silently answered by hiring is the substitution this prevents`,
    );
  }
});

// ────────────────────────── multiple strategies ─────────────────────────────

Deno.test("funding + hiring selects BOTH playbooks, not an arbitrary winner", () => {
  const s = selectResearchPlaybooks(mission({ strategies: ["funding", "hiring"] }));
  assertEquals(ids(s), ["funding", "hiring"]);
  assertEquals(s.combination, "any_may_satisfy");
  assert(s.ok);
});

Deno.test("multi_signal means the named shapes must hold TOGETHER", () => {
  // The Mission's own contract: "multi_signal is not a catch-all: it means the
  // request requires two or more of the others to hold TOGETHER".
  const s = selectResearchPlaybooks(mission({
    strategies: ["multi_signal", "funding", "hiring"],
  }));
  assertEquals(ids(s), ["funding", "hiring"]);
  assertEquals(s.combination, "all_must_hold");
  assert(s.ok);
  assertFalse(
    ids(s).some((p) => (p as string) === "multi_signal"),
    "multi_signal is a combination rule, not a sixth playbook",
  );
});

Deno.test("a conjunctive request is NOT ok when one of its shapes cannot run", () => {
  // "Recently funded AND posting about outbound" is not answered by the funding
  // half. Delivering that half as though it were the answer is the silent
  // substitution this boundary exists to prevent.
  const s = selectResearchPlaybooks(mission({
    strategies: ["multi_signal", "funding", "social"],
  }));
  assertEquals(ids(s), ["funding"]);
  assertEquals(unsupportedIds(s), ["social"]);
  assertEquals(s.combination, "all_must_hold");
  assertFalse(s.ok, "one runnable half of a conjunction is not a satisfiable plan");

  // Whereas the same pair WITHOUT multi_signal is two routes to one answer, and
  // the runnable one is a legitimate plan.
  const alt = selectResearchPlaybooks(mission({ strategies: ["funding", "social"] }));
  assertEquals(alt.combination, "any_may_satisfy");
  assert(alt.ok);
});

// ───────────────────── derivation when no strategy is named ─────────────────

Deno.test("no declared strategy derives the shape from other decided fields", () => {
  const s = selectResearchPlaybooks(mission({
    required_signals: [{ type: "hiring", role_families: ["rev_ops"] }],
  }));
  assertEquals(ids(s), ["hiring"]);
  assertEquals(s.strategy_source, "derived_from_mission_fields");
  assert(s.ok);

  const supplied = selectResearchPlaybooks(mission({
    company_profile: {
      business_models: [], verticals: [], stages: [], locations: [],
      known_companies: ["acme.com"],
    },
  }));
  assertEquals(ids(supplied), ["supplied_company"]);
  assertEquals(supplied.strategy_source, "derived_from_mission_fields");
});

Deno.test("a shapeless Mission says so rather than picking something", () => {
  const s = selectResearchPlaybooks(mission());
  assertEquals(ids(s), []);
  assertEquals(s.combination, "none");
  assertEquals(s.strategy_source, "none");
  assertFalse(s.ok);
  assert(/no strategy/.test(s.reason), s.reason);
});

Deno.test("a declared strategy outranks what the signals would have derived", () => {
  const s = selectResearchPlaybooks(mission({
    strategies: ["funding"],
    required_signals: [{ type: "hiring" }],
  }));
  assertEquals(ids(s), ["funding"], "the model's declared shape is the authority");
  assertEquals(s.strategy_source, "mission_strategies");
});

// ────────────────────── unknown / unmappable vocabulary ─────────────────────

Deno.test("an unknown strategy is reported, never ignored", () => {
  const s = selectResearchPlaybooks(mission({
    strategies: ["hiring", "telepathy" as never],
  }));
  assertEquals(s.unknown_strategies, ["telepathy"]);
  assertEquals(ids(s), ["hiring"], "the recognised half still runs");
  assert(/unrecognised strategies: telepathy/.test(s.reason), s.reason);
});

Deno.test("a signal the strategy vocabulary cannot express is reported as a gap", () => {
  // `expansion` is a legitimate required_signals type — it even has its own
  // capability — and there is no MissionStrategy for it.
  const s = selectResearchPlaybooks(mission({
    required_signals: [{ type: "expansion" }],
  }));
  assertEquals(s.signals_without_strategy, ["expansion"]);
  assertEquals(ids(s), [], "and it is not rounded to the nearest shape");
  assertFalse(s.ok);
});

// ──────────────────────── the forbidden vocabulary ──────────────────────────

Deno.test("company_first / person_first / job_first cannot be strategies or playbooks", () => {
  for (const forbidden of FORBIDDEN_PLAYBOOK_VOCABULARY) {
    assertFalse(
      (MISSION_STRATEGIES as readonly string[]).includes(forbidden),
      `${forbidden} must not be a mission strategy`,
    );
    assertFalse(
      forbidden in RESEARCH_PLAYBOOKS,
      `${forbidden} must not be a playbook — it describes which entity a pipeline ` +
      "touches first, which is an execution detail, not a research shape",
    );
  }
  const src = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadResearchPlaybooks.ts", import.meta.url),
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  for (const forbidden of ["company_first", "person_first", "job_first"]) {
    // The only permitted occurrence is the prohibition list itself.
    const hits = [...src.matchAll(new RegExp(forbidden, "g"))].length;
    assertEquals(hits, 1, `${forbidden} appears in code beyond the prohibition list`);
  }
});

Deno.test("the Workbench model is unchanged: people are offers, never playbooks", () => {
  for (const p of Object.values(RESEARCH_PLAYBOOKS)) {
    for (const c of [p.entry_capability, ...p.proving_capabilities]) {
      assertFalse(
        ["founder_discovery", "employer_verification", "contact_enrichment"].includes(c ?? ""),
        `${p.id} schedules ${c}: people are unlock layers on a company result, ` +
        "not a research entry point",
      );
    }
  }
});

// ─────────────────────── the boundary reads the Mission ─────────────────────

const SRC = Deno.readTextFileSync(
  new URL("../../../supabase/functions/_shared/leadResearchPlaybooks.ts", import.meta.url),
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

Deno.test("selection never reads the user's sentence", () => {
  assertFalse(
    /original_user_query|original_query|originalUserQuery|instruction|message|prompt/.test(SRC),
    "playbook selection must not touch raw text — the Mission already read it",
  );
});

Deno.test("selection runs no parser and matches no pattern", () => {
  for (const parser of [
    "extractLeadIntent", "extractRequestedLeadCount", "separateIntent",
    "classifyWorkflow", "routeQualifiedLead", "compileLeadEntityIntent",
    "extractLeadSearchIntent", "parseLeadMissionDeterministic", "resolveJobIntent",
  ]) {
    assertFalse(SRC.includes(parser), `${parser} must not be reachable from selection`);
  }
  assertFalse(/RegExp\(|\.match\(|\.test\(/.test(SRC), "no pattern matching in the boundary");
});

Deno.test("selection reads structured Mission fields, and only those", () => {
  for (const field of ["strategies", "required_signals", "known_companies"]) {
    assert(SRC.includes(field), `the boundary must read mission.${field}`);
  }
  // The signature accepts exactly the three fields it uses, so a future edit
  // cannot quietly start reading a fourth.
  assert(
    /Pick<LeadMissionV1, "strategies" \| "required_signals" \| "company_profile">/.test(SRC),
    "the input type must name the fields it is allowed to see",
  );
});

Deno.test("selection performs no execution", () => {
  for (const sideEffect of ["fetch(", "runTool", "await ", "supabase", "insert(", "upsert("]) {
    assertFalse(SRC.includes(sideEffect), `${sideEffect} must not appear: selection runs nothing`);
  }
});

// ────────────────────────────── coverage ────────────────────────────────────

Deno.test("every mission strategy maps to a playbook or to the combination rule", () => {
  for (const s of MISSION_STRATEGIES) {
    const covered = PLAYBOOK_STRATEGY_COVERAGE[s];
    assert(covered, `${s} has no coverage entry`);
    if (s === "multi_signal") assertEquals(covered, "combination_rule");
    else {
      assertEquals(covered, `playbook:${s}`);
      assert(s in RESEARCH_PLAYBOOKS, `${s} must have a playbook spec`);
    }
  }
  // And no playbook exists that no strategy names.
  for (const id of Object.keys(RESEARCH_PLAYBOOKS) as ResearchPlaybookId[]) {
    assert(
      (MISSION_STRATEGIES as readonly string[]).includes(id),
      `${id} is a playbook with no strategy — a vocabulary nobody can ask for`,
    );
  }
});

Deno.test("every playbook capability exists in the capability graph's registry", () => {
  for (const p of Object.values(RESEARCH_PLAYBOOKS)) {
    for (const c of [p.entry_capability, ...p.proving_capabilities]) {
      if (c) assert(c in CAPABILITY_REGISTRY, `${p.id} names unknown capability ${c}`);
    }
    // Providers are READ from the registry, never restated here.
    if (p.entry_capability) {
      assertEquals(
        playbookProviders(p.id), CAPABILITY_REGISTRY[p.entry_capability].providers,
      );
    }
  }
});

Deno.test("the log summary carries the gaps, not just the wins", () => {
  const s = playbookSelectionSummary(selectResearchPlaybooks(mission({
    strategies: ["multi_signal", "funding", "social"],
  })));
  assertEquals(s.playbooks, ["funding"]);
  assertEquals(s.unsupported, ["social:no_capability_defined"]);
  assertEquals(s.ok, false);
  assertEquals(s.combination, "all_must_hold");
});
