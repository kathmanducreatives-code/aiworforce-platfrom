// MISSION → RESEARCH PLAYBOOK — the hardened contract Phase 3 will consume.
//
// Four layers, and each owns one thing:
//
//   MISSION      what the user asked for — the only semantic authority
//   PLAYBOOK     the research WORKFLOW that answers it
//   CAPABILITY   an implementation-level ability
//   PROVIDER     an Actor implementing a capability
//
// A playbook names capabilities, never actors, so this contract survives
// provider churn. These tests pin what it selects, what it refuses to
// substitute, what it reads to decide (Mission fields, never text) — and, most
// importantly, what "supported" is allowed to mean.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  selectResearchPlaybooks, RESEARCH_PLAYBOOKS, PLAYBOOK_STRATEGY_COVERAGE,
  FORBIDDEN_PLAYBOOK_VOCABULARY, playbookRequirements, playbookSupport,
  playbookSelectionSummary, isEngineDriven, ENGINE_DRIVEN_CAPABILITIES,
  SIGNAL_RESEARCH_ROLES, signalResearchRole, SOURCE_STRATEGY_IMPLIED_SHAPE,
  type ResearchPlaybookId,
} from "../../../supabase/functions/_shared/leadResearchPlaybooks.ts";
import {
  MISSION_STRATEGIES, LEAD_MISSION_VERSION, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  CAPABILITY_REGISTRY, CAPABILITY_IDS,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { ENGINE_DRIVEN_DISCOVERY }
  from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { SOURCE_STRATEGIES } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";

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

const selected = (s: ReturnType<typeof selectResearchPlaybooks>) =>
  s.playbooks.map((p) => p.playbook);

// ═══════════════════ 1. executability is not "an enum exists" ═══════════════

Deno.test("the engine-driven capability list matches the engine's own source", () => {
  // The whole support classification rests on this list, so it is re-derived
  // from `runCapabilityPlan` rather than trusted. The engine names the
  // capabilities it SKIPS in one guard; everything else it implements either
  // with `if (cap === "…")` or, for the capabilities that SHARE a stage, with
  // membership of a set it exports.
  const ENGINE = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  const implemented = new Set(
    [...ENGINE.matchAll(/if \(cap === "([a-z_]+)"\) \{/g)].map((m) => m[1]),
  );
  // ── THE DISCOVERY CAPABILITIES SHARE ONE BRANCH ─────────────────────────
  //
  // They used to have one `if (cap === "…")` each, and that duplication is
  // exactly what let `general_company_discovery` acquire a hardcoded provider
  // and skip the planner. Re-deriving from the exported set keeps this test
  // grounded in the engine's own source — the property it exists to protect —
  // without requiring the engine to spell each capability out in a condition.
  for (const c of ENGINE_DRIVEN_DISCOVERY) implemented.add(c);
  const skipGuard = ENGINE.slice(
    ENGINE.indexOf('if (cap === "known_company_resolution" ||'),
  ).slice(0, 400);
  const skipped = new Set(
    [...skipGuard.matchAll(/cap === "([a-z_]+)"/g)].map((m) => m[1]),
  );

  for (const c of CAPABILITY_IDS) {
    const driven = implemented.has(c) && !skipped.has(c);
    assertEquals(
      isEngineDriven(c), driven,
      `${c}: ENGINE_DRIVEN_CAPABILITIES says ${isEngineDriven(c)}, the engine says ${driven}`,
    );
  }
  // And the skip guard really does name the six the engine declines to drive.
  for (const c of [
    "known_company_resolution", "job_discovery", "funding_signal_discovery",
    "expansion_signal_discovery", "job_deduplication", "expansion_signal_verification",
  ]) {
    assert(skipped.has(c), `the engine must still skip ${c}`);
    assertFalse(isEngineDriven(c as never), `${c} must not be marked engine-driven`);
  }
  assertEquals(
    ENGINE_DRIVEN_CAPABILITIES.length, 10,
    "ten capabilities are engine-driven; a change here is a real architecture change",
  );
});

Deno.test("a capability with providers is NOT enough to call a playbook supported", () => {
  // This is the Phase 2 error, pinned so it cannot come back: `funding` and
  // `supplied_company` both name a capability that names providers, and the
  // engine skips both — so nothing was ever going to run.
  for (const id of ["funding", "supplied_company"] as const) {
    const spec = RESEARCH_PLAYBOOKS[id];
    const entry = spec.discovery_capabilities[0];
    assert(entry in CAPABILITY_REGISTRY, `${id} names a real capability`);
    assertFalse(isEngineDriven(entry), `${entry} is not engine-driven`);
    assertEquals(playbookSupport(id).status, "unsupported");
    assertEquals(playbookSupport(id).gaps, ["capability_not_engine_driven"]);
  }
});

// ═══════════════════════ 2. the support matrix, proven ═════════════════════

Deno.test("hiring is the only supported playbook today, and its whole path is real", () => {
  const s = playbookSupport("hiring");
  assertEquals(s.status, "supported");
  assertEquals(s.gaps, []);

  // Trace it: capability → engine-driven → approved provider.
  for (const r of playbookRequirements("hiring")) {
    assert(r.engine_driven, `${r.capability} must be engine-driven`);
    assertEquals(
      r.providers, CAPABILITY_REGISTRY[r.capability].providers,
      "providers are read from the registry, never restated",
    );
    assert(r.providers.length > 0, `${r.capability} must have an approved provider`);
  }
  // Both discovery entries, because the graph refines by company profile.
  assertEquals(
    RESEARCH_PLAYBOOKS.hiring.discovery_capabilities,
    ["startup_company_discovery", "general_company_discovery"],
  );
  assertEquals(RESEARCH_PLAYBOOKS.hiring.proving_capabilities, ["hiring_verification"]);
});

Deno.test("every other playbook is unsupported, each for a stated reason", () => {
  const expected: Record<string, string[]> = {
    funding: ["capability_not_engine_driven"],
    supplied_company: ["capability_not_engine_driven"],
    social: ["no_capability_defined"],
    news: ["no_capability_defined"],
  };
  for (const [id, gaps] of Object.entries(expected)) {
    const s = playbookSupport(id as ResearchPlaybookId);
    assertEquals(s.status, "unsupported", `${id} must not claim support`);
    assertEquals(s.gaps, gaps, `${id} gap`);
  }
});

Deno.test("an unsupported playbook still carries the facts the next phase needs", () => {
  assert(
    RESEARCH_PLAYBOOKS.social.unwired_actor_keys.includes("apify_linkedin_posts"),
    "registered-but-unbound actors must be named",
  );
  assert(
    RESEARCH_PLAYBOOKS.funding.notes.some((n) => /no funding field/.test(n)),
    "the funding provider's inability to express funding must be recorded",
  );
  assert(
    RESEARCH_PLAYBOOKS.supplied_company.notes.some((n) => /engine-driven/.test(n)),
    "supplied_company's downstream pipeline exists; only resolution does not",
  );
});

// ═════════════════════════ 3. expansion is a signal ════════════════════════

Deno.test("expansion is a QUALIFIER signal, not a research strategy", () => {
  // The architectural decision, pinned. `expansion` is something you PROVE about
  // companies you already found — the registry's own `expansion_signal_
  // verification` says so — not a way to enumerate them.
  assertEquals(signalResearchRole("expansion"), "qualifier");
  assertFalse(
    (MISSION_STRATEGIES as readonly string[]).includes("expansion"),
    "expansion must not become a strategy: every signal type would then need one",
  );
  assertFalse("expansion" in RESEARCH_PLAYBOOKS);

  const s = selectResearchPlaybooks(mission({ required_signals: [{ type: "expansion" }] }));
  assertEquals(selected(s), [], "a qualifier selects no research shape");
  assertEquals(s.qualifying_signals, ["expansion"]);
  assertFalse(s.ok, "a mission with only a qualifier has no way to discover anything");
  assert(/qualifier signals/.test(s.reason), s.reason);
});

Deno.test("a qualifier signal is never rounded up to the nearest shape", () => {
  for (const t of ["expansion", "leadership_change", "technology", "product_launch"]) {
    const s = selectResearchPlaybooks(mission({ required_signals: [{ type: t }] }));
    assertEquals(selected(s), [], `${t} must not select a playbook`);
    assertEquals(s.qualifying_signals, [t]);
  }
  // An unrecognised signal is a qualifier too — never a licence to invent a
  // discovery source for it.
  assertEquals(signalResearchRole("moon_phase"), "qualifier");
});

Deno.test("a qualifier alongside a discovery shape narrows nothing away", () => {
  const s = selectResearchPlaybooks(mission({
    required_signals: [{ type: "hiring" }, { type: "expansion" }],
  }));
  assertEquals(selected(s), ["hiring"], "the discovery shape still selects");
  assertEquals(s.qualifying_signals, ["expansion"], "and the qualifier is still reported");
  assert(s.ok);
});

Deno.test("only hiring and funding are discovery shapes", () => {
  const shapes = Object.entries(SIGNAL_RESEARCH_ROLES)
    .filter(([, role]) => role === "discovery_shape").map(([t]) => t);
  assertEquals(shapes.sort(), ["funding", "hiring"]);
});

// ══════════════ 4. two strategy vocabularies, one authority ════════════════

Deno.test("selection does not read directives.source_strategy to choose a shape", () => {
  // The hint says hiring; the Mission says funding. The Mission wins, and the
  // disagreement is recorded rather than resolved silently.
  const s = selectResearchPlaybooks({
    ...mission({ strategies: ["funding"] }),
    directives: { source_strategy: ["job_signal_first"] },
  });
  assertEquals(selected(s), ["funding"], "the source-strategy hint changed nothing");
  assertEquals(s.routing_conflicts.length, 1);
  assertEquals(s.routing_conflicts[0].source_strategy, "job_signal_first");
  assertEquals(s.routing_conflicts[0].implies_playbook, "hiring");
});

Deno.test("no conflict is reported when the hint agrees, or implies no shape", () => {
  const agrees = selectResearchPlaybooks({
    ...mission({ strategies: ["hiring"] }),
    directives: { source_strategy: ["job_signal_first"] },
  });
  assertEquals(agrees.routing_conflicts, []);

  const neutral = selectResearchPlaybooks({
    ...mission({ strategies: ["hiring"] }),
    directives: {
      source_strategy: ["startup_cohort_first", "company_profile_first", "evidence_reuse_first"],
    },
  });
  assertEquals(
    neutral.routing_conflicts, [],
    "a preference among sources for an already-chosen shape is not a conflict",
  );
});

Deno.test("every source_strategy value is classified — none is left ambiguous", () => {
  for (const v of SOURCE_STRATEGIES) {
    assert(v in SOURCE_STRATEGY_IMPLIED_SHAPE, `${v} has no classification`);
    const implied = SOURCE_STRATEGY_IMPLIED_SHAPE[v];
    if (implied !== null) {
      assert(implied in RESEARCH_PLAYBOOKS, `${v} implies unknown playbook ${implied}`);
    }
  }
  // Exactly two of the five are shape-bearing; the rest are execution hints.
  const shapeBearing = SOURCE_STRATEGIES.filter((v) => SOURCE_STRATEGY_IMPLIED_SHAPE[v] !== null);
  assertEquals([...shapeBearing].sort(), ["job_signal_first", "known_companies_only"]);
});

Deno.test("the two vocabularies do not overlap as values", () => {
  for (const v of SOURCE_STRATEGIES) {
    assertFalse(
      (MISSION_STRATEGIES as readonly string[]).includes(v),
      `${v} appears in both vocabularies — one name, two authorities`,
    );
  }
});

// ══════════════════════ 5. selection behaviour ═════════════════════════════

Deno.test("a hiring Mission selects the hiring playbook and it is runnable", () => {
  const s = selectResearchPlaybooks(mission({ strategies: ["hiring"] }));
  assertEquals(selected(s), ["hiring"]);
  assertEquals(s.runnable, ["hiring"]);
  assertEquals(s.blocked, []);
  assertEquals(s.combination, "single");
  assertEquals(s.strategy_source, "mission_strategies");
  assert(s.ok);
});

Deno.test("a funding Mission selects the funding playbook and reports it blocked", () => {
  const s = selectResearchPlaybooks(mission({ strategies: ["funding"] }));
  assertEquals(selected(s), ["funding"], "the shape asked for is still recorded");
  assertEquals(s.runnable, []);
  assertEquals(s.blocked[0].gaps, ["capability_not_engine_driven"]);
  assertFalse(s.ok);
});

Deno.test("a supplied-company Mission selects that shape and reports it blocked", () => {
  const s = selectResearchPlaybooks(mission({ strategies: ["supplied_company"] }));
  assertEquals(selected(s), ["supplied_company"]);
  assertEquals(s.runnable, []);
  assertEquals(s.blocked[0].gaps, ["capability_not_engine_driven"]);
  assertFalse(s.ok);
});

Deno.test("social and news report no capability at all", () => {
  for (const id of ["social", "news"] as const) {
    const s = selectResearchPlaybooks(mission({ strategies: [id] }));
    assertEquals(selected(s), [id]);
    assertEquals(s.blocked[0].gaps, ["no_capability_defined"]);
    assertFalse(s.ok);
  }
});

Deno.test("an unsupported shape never becomes hiring, discovery, or anything else", () => {
  for (const strategy of ["social", "news", "funding"] as const) {
    const s = selectResearchPlaybooks(mission({ strategies: [strategy] }));
    assertEquals(selected(s), [strategy], `${strategy} must stay itself`);
    assertEquals(s.runnable, [], "nothing runnable may be substituted in");
    assertFalse(
      selected(s).includes("hiring" as never),
      `${strategy} silently answered by hiring is the substitution this prevents`,
    );
  }
});

Deno.test("funding + hiring selects BOTH, not an arbitrary winner", () => {
  const s = selectResearchPlaybooks(mission({ strategies: ["funding", "hiring"] }));
  assertEquals(selected(s), ["funding", "hiring"]);
  assertEquals(s.runnable, ["hiring"]);
  assertEquals(s.blocked.map((b) => b.playbook), ["funding"]);
  assertEquals(s.combination, "any_may_satisfy");
  assert(s.ok, "one runnable route answers a disjunctive request");
});

Deno.test("multi_signal means the named shapes must hold TOGETHER", () => {
  const s = selectResearchPlaybooks(mission({
    strategies: ["multi_signal", "funding", "hiring"],
  }));
  assertEquals(selected(s), ["funding", "hiring"]);
  assertEquals(s.combination, "all_must_hold");
  assertFalse(
    selected(s).some((p) => (p as string) === "multi_signal"),
    "multi_signal is a combination rule, not a sixth playbook",
  );
  assertFalse(
    s.ok,
    "a conjunction is unsatisfiable while one of its shapes cannot run",
  );
});

Deno.test("a conjunction of two runnable shapes would be ok", () => {
  // Proves `ok` follows the RULE rather than the current support matrix: with
  // hiring twice (the only supported shape today) the conjunction is satisfied.
  const s = selectResearchPlaybooks(mission({ strategies: ["multi_signal", "hiring"] }));
  assertEquals(s.combination, "all_must_hold");
  assertEquals(s.blocked, []);
  assert(s.ok);
});

Deno.test("no declared strategy derives the shape from other decided fields", () => {
  const bySignal = selectResearchPlaybooks(mission({
    required_signals: [{ type: "hiring", role_families: ["rev_ops"] }],
  }));
  assertEquals(selected(bySignal), ["hiring"]);
  assertEquals(bySignal.strategy_source, "derived_from_mission_fields");
  assertEquals(bySignal.playbooks[0].selected_by, "required_signals");
  assert(bySignal.ok);

  const bySupplied = selectResearchPlaybooks(mission({
    company_profile: {
      business_models: [], verticals: [], stages: [], locations: [],
      known_companies: ["acme.com"],
    },
  }));
  assertEquals(selected(bySupplied), ["supplied_company"]);
  assertEquals(bySupplied.playbooks[0].selected_by, "known_companies");
});

Deno.test("a shapeless Mission says so rather than picking something", () => {
  const s = selectResearchPlaybooks(mission());
  assertEquals(selected(s), []);
  assertEquals(s.combination, "none");
  assertEquals(s.strategy_source, "none");
  assertFalse(s.ok);
});

Deno.test("a declared strategy outranks what the signals would have derived", () => {
  const s = selectResearchPlaybooks(mission({
    strategies: ["funding"], required_signals: [{ type: "hiring" }],
  }));
  assertEquals(selected(s), ["funding"], "the model's declared shape is the authority");
  assertEquals(s.strategy_source, "mission_strategies");
});

Deno.test("an unknown strategy is reported, never ignored", () => {
  const s = selectResearchPlaybooks(mission({
    strategies: ["hiring", "telepathy" as never],
  }));
  assertEquals(s.unknown_strategies, ["telepathy"]);
  assertEquals(selected(s), ["hiring"], "the recognised half still runs");
  assert(/unrecognised strategies: telepathy/.test(s.reason), s.reason);
});

// ═════════════════ 6. vocabulary and Workbench invariants ══════════════════

Deno.test("company_first / person_first / job_first cannot be strategies or playbooks", () => {
  for (const forbidden of FORBIDDEN_PLAYBOOK_VOCABULARY) {
    assertFalse((MISSION_STRATEGIES as readonly string[]).includes(forbidden));
    assertFalse(forbidden in RESEARCH_PLAYBOOKS);
  }
  const src = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadResearchPlaybooks.ts", import.meta.url),
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  for (const forbidden of ["company_first", "person_first", "job_first"]) {
    assertEquals(
      [...src.matchAll(new RegExp(forbidden, "g"))].length, 1,
      `${forbidden} appears in code beyond the prohibition list`,
    );
  }
});

Deno.test("the Workbench model is unchanged: people are offers, never playbooks", () => {
  for (const p of Object.values(RESEARCH_PLAYBOOKS)) {
    for (const c of [...p.discovery_capabilities, ...p.proving_capabilities]) {
      assertFalse(
        ["founder_discovery", "employer_verification", "contact_enrichment"].includes(c),
        `${p.id} schedules ${c}: people are unlock layers on a company result, ` +
        "not a research entry point",
      );
    }
  }
});

Deno.test("every mission strategy has exactly one semantic interpretation", () => {
  for (const s of MISSION_STRATEGIES) {
    const covered = PLAYBOOK_STRATEGY_COVERAGE[s];
    assert(covered, `${s} has no coverage entry`);
    if (s === "multi_signal") assertEquals(covered, "combination_rule");
    else {
      assertEquals(covered, `playbook:${s}`);
      assert(s in RESEARCH_PLAYBOOKS);
    }
  }
  for (const id of Object.keys(RESEARCH_PLAYBOOKS) as ResearchPlaybookId[]) {
    assert(
      (MISSION_STRATEGIES as readonly string[]).includes(id),
      `${id} is a playbook with no strategy — a vocabulary nobody can ask for`,
    );
  }
});

Deno.test("a playbook names capabilities, never actors", () => {
  for (const p of Object.values(RESEARCH_PLAYBOOKS)) {
    for (const c of [...p.discovery_capabilities, ...p.proving_capabilities]) {
      assert(c in CAPABILITY_REGISTRY, `${p.id} names unknown capability ${c}`);
      assertFalse(
        c.startsWith("apify_") || c.startsWith("firecrawl_"),
        `${p.id} names an actor as a capability`,
      );
    }
    // `unwired_actor_keys` is the ONE place actor keys appear, and it routes
    // nothing — it is a record of what exists but cannot be reached.
    for (const k of p.unwired_actor_keys) {
      assertFalse(
        [...p.discovery_capabilities, ...p.proving_capabilities].includes(k as never),
        `${p.id} uses an unwired actor key as a capability`,
      );
    }
  }
});

// ═══════════════ 7. the boundary reads the Mission, and runs nothing ═══════

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
  assertFalse(/RegExp\(|\.match\(/.test(SRC), "no pattern matching in the boundary");
});

Deno.test("selection consumes only the canonical Mission contract", () => {
  assert(
    /Pick<LeadMissionV1, "strategies" \| "required_signals" \| "company_profile">/.test(SRC),
    "the input type must name the fields it is allowed to see",
  );
  assert(
    /directives\?: \{ source_strategy\?: string\[\] \}/.test(SRC),
    "directives may be supplied for conflict DETECTION only",
  );
});

Deno.test("selection performs no execution", () => {
  for (const sideEffect of ["fetch(", "runTool", "await ", "supabase", "insert(", "upsert("]) {
    assertFalse(SRC.includes(sideEffect), `${sideEffect} must not appear: selection runs nothing`);
  }
});

Deno.test("the selection reaches execution ONLY through the authorization boundary", () => {
  // Phase 3a wired the supported hiring playbook in. The invariant is no longer
  // "nothing consumes the selection" — it is that the ONE thing that consumes it
  // is the boundary, and the boundary is what the paid gate reads.
  const RUN = Deno.readTextFileSync(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  assertEquals(
    [...RUN.matchAll(/selectResearchPlaybooks\(/g)].length, 1,
    "exactly one selection call site",
  );
  assertEquals(
    [...RUN.matchAll(/authorizePlaybookExecution\(/g)].length, 1,
    "exactly one authorization call site",
  );
  assert(
    /authorizePlaybookExecution\(playbookSelection, missionPlan, persistedMission\)/.test(RUN),
    "the boundary compares the SELECTION against the PLAN the graph built",
  );
  assert(
    /playbook: playbookAuthorization,/.test(RUN),
    "and its verdict is what the paid preflight reads",
  );
  // The selection itself still routes nothing directly: no branch reads a
  // playbook id out of it to pick a provider, capability or actor.
  assertFalse(
    /if \([^)]*playbookSelection\.(runnable|playbooks)/.test(RUN),
    "run-agent must not route on the selection directly — the boundary decides",
  );
});

Deno.test("the log summary carries the gaps, not just the wins", () => {
  const s = playbookSelectionSummary(selectResearchPlaybooks(mission({
    strategies: ["multi_signal", "funding", "social"],
  })));
  assertEquals(s.runnable, []);
  assertEquals(s.blocked, [
    "funding:capability_not_engine_driven", "social:no_capability_defined",
  ]);
  assertEquals(s.ok, false);
  assertEquals(s.combination, "all_must_hold");
});
