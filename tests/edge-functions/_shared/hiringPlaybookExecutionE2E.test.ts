// LeadMissionV1 → PLAYBOOK SELECTION → HIRING PLAYBOOK → CAPABILITY EXECUTION.
//
// The whole chain, end to end, offline. Each link is exercised with the real
// module that owns it, and the last link is proven the only way that counts:
// the capability the plan enters at has an engine branch, its provider has a
// catalogue card with an Actor id, and a verified input compiler produces a
// valid payload for it.
//
// The other half of the phase is proven here too: an unsupported playbook is
// BLOCKED at the paid gate rather than quietly executing something else.
//
// Pure. No network, no provider, no model call — the compilers are pure and the
// preflight is a decision function.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  selectResearchPlaybooks, RESEARCH_PLAYBOOKS, isEngineDriven,
} from "../../../supabase/functions/_shared/leadResearchPlaybooks.ts";
import {
  authorizePlaybookExecution, playbookAuthorizationSummary,
} from "../../../supabase/functions/_shared/leadPlaybookExecution.ts";
import {
  buildCapabilityGraph, CAPABILITY_REGISTRY,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  buildPaidExecutionPreflight, assertPaidExecutionAllowed, PaidExecutionBlockedError,
} from "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts";
import {
  LEAD_MISSION_VERSION, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { compileFirstProviderCall } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  HIRING_ACTOR_CATALOG,
} from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import {
  compileMemo23YcInput, compileSolidcodeYcInput, compileHarvestCompanySearchInput,
  compileHarvestCompanyDetailsInput, compileHarvestJobSearchInput,
} from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const HIRING_QUERY =
  "Find B2B SaaS companies in the United States hiring Revenue Operations";

function mission(over: Partial<LeadMissionV1> = {}): LeadMissionV1 {
  return {
    version: LEAD_MISSION_VERSION,
    original_user_query: HIRING_QUERY,
    mission_type: "qualified_lead_sourcing",
    target_entity: "company",
    requested_output: "qualified_companies",
    requested_count: 5,
    company_profile: {
      business_models: [], verticals: ["b2b saas"], stages: [],
      locations: ["United States"],
    },
    required_signals: [{ type: "hiring", role_families: ["rev_ops"] }],
    required_signal_terms: ["RevOps"],
    decision_makers: { roles: [], current_employment_required: false },
    hard_constraints: {}, soft_preferences: {},
    required_capabilities: [], prohibited_capabilities: [],
    field_provenance: {}, confidence: 0.9,
    strategies: ["hiring"],
    ...over,
  } as LeadMissionV1;
}

/** The chain, run for real. */
function chain(m: LeadMissionV1) {
  const selection = selectResearchPlaybooks(m);
  const plan = buildCapabilityGraph(m);
  const authorization = authorizePlaybookExecution(selection, plan, m);
  const first = compileFirstProviderCall(plan);
  const preflight = buildPaidExecutionPreflight({
    mission: m, plan,
    firstProvider: first.provider,
    firstProviderInput: first.compiled?.ok ? first.compiled.input : null,
    firstProviderCompileOk: first.compiled ? first.compiled.ok : undefined,
    firstProviderErrors: first.compiled && !first.compiled.ok ? first.compiled.errors : [],
    playbook: authorization,
  });
  return { selection, plan, authorization, first, preflight };
}

// ═══════════ 1. the happy path, link by link ════════════════════════════════

Deno.test("E2E: a hiring Mission reaches authorised capability execution", () => {
  const m = mission();
  const { selection, plan, authorization, preflight } = chain(m);

  // LINK 1 — Mission → selection.
  assertEquals(selection.runnable, ["hiring"]);
  assertEquals(selection.blocked, []);
  assert(selection.ok);

  // LINK 2 — the graph's plan.
  assertEquals(plan.entry_capability, "general_company_discovery");

  // LINK 3 — the playbook authorises that plan.
  assert(authorization.applies, "a hiring-only selection is governed by the boundary");
  assertEquals(authorization.playbook, "hiring");
  assertEquals(authorization.entry_source, "playbook_discovery");
  assert(authorization.authorized, authorization.reason);
  assertEquals(authorization.violations, []);

  // LINK 4 — every authorised capability is one the engine drives.
  assert(authorization.authorized_capabilities.length > 0);
  for (const c of authorization.authorized_capabilities) {
    assert(c.engine_driven, `${c.capability} must be engine-driven`);
  }

  // LINK 5 — the paid gate lets it through.
  assert(preflight.ok, JSON.stringify(preflight.blocked));
  assertPaidExecutionAllowed(preflight);
});

Deno.test("E2E: a startup hiring Mission enters the YC cohort and compiles a real payload", () => {
  const m = mission({
    company_profile: {
      business_models: [], verticals: ["b2b saas"], stages: ["startup"],
      locations: ["United States"],
    },
  });
  const { plan, authorization, first, preflight } = chain(m);

  assertEquals(plan.entry_capability, "startup_company_discovery");
  assertEquals(
    authorization.entry_source, "playbook_discovery",
    "both discovery entries belong to the hiring playbook — the graph refines by profile",
  );
  assert(authorization.authorized, authorization.reason);

  // The provider call is COMPILED, not merely named.
  assertEquals(first.provider, "apify_yc_companies_memo23");
  assert(first.compiled?.ok, "the first provider input must compile");
  assert(preflight.ok, JSON.stringify(preflight.blocked));
  assertEquals(preflight.first_provider_input_valid, true);
});

// ═══════════ 2. the capability path is real, not declarative ═══════════════

Deno.test("every capability the hiring playbook needs has engine + card + compiler", () => {
  // The three things that must ALL hold for a capability to actually execute.
  const COMPILERS: Record<string, (i: never) => { ok: boolean }> = {
    apify_yc_companies_memo23: compileMemo23YcInput as never,
    apify_yc_companies_solidcode: compileSolidcodeYcInput as never,
    apify_linkedin_company_search: compileHarvestCompanySearchInput as never,
    apify_linkedin_company_details: compileHarvestCompanyDetailsInput as never,
    apify_linkedin_job_search: compileHarvestJobSearchInput as never,
  };

  const spec = RESEARCH_PLAYBOOKS.hiring;
  for (const capability of [...spec.discovery_capabilities, ...spec.proving_capabilities]) {
    assert(isEngineDriven(capability), `${capability}: no engine branch`);
    const providers = CAPABILITY_REGISTRY[capability].providers;
    assert(providers.length > 0, `${capability}: no approved provider`);
    for (const p of providers) {
      const card = HIRING_ACTOR_CATALOG[p];
      assert(card, `${p}: no catalogue card, so no Actor id can be resolved`);
      assert(card.actor_id.includes("/"), `${p}: card has no Actor id`);
      assert(COMPILERS[p], `${p}: no verified input compiler`);
    }
  }
});

Deno.test("the whole hiring pipeline the graph schedules is engine-driven", () => {
  const { plan } = chain(mission());
  for (const step of plan.steps) {
    assert(
      isEngineDriven(step.capability),
      `${step.capability} is scheduled for a hiring mission but the engine skips it`,
    );
  }
});

Deno.test("compiled hiring payloads are valid, not just present", () => {
  // Discovery.
  assert(compileHarvestCompanySearchInput({
    searchQuery: "b2b saas", scraperMode: "full", maxItems: 10,
    locations: ["United States"],
  }).ok);
  // Verification — company-scoped by contract.
  assert(compileHarvestJobSearchInput({
    company: ["https://www.linkedin.com/company/acme"],
    jobTitles: ["Revenue Operations"], maxItems: 10,
  }).ok);
  // And the contract really is company-scoped: no company, no call.
  assertFalse(compileHarvestJobSearchInput({
    company: [], jobTitles: ["Revenue Operations"], maxItems: 10,
  }).ok);
});

// ═══════════ 3. unsupported playbooks stay blocked ═════════════════════════

Deno.test("an unsupported shape is never authorised as hiring", () => {
  for (const strategy of ["funding", "social", "news"] as const) {
    const m = mission({ strategies: [strategy], required_signals: [] });
    const { selection, authorization } = chain(m);
    assertEquals(selection.runnable, [], `${strategy} must not be runnable`);
    assertFalse(
      authorization.applies,
      `${strategy}: the hiring boundary must not govern another shape`,
    );
    assertEquals(authorization.playbook, null);
    assert(
      /no supported hiring playbook was selected/.test(authorization.reason),
      authorization.reason,
    );
  }
});

Deno.test("an unsupported shape does not change execution in this phase", () => {
  // The promise made for funding/social/news/multi_signal: behaviour unchanged.
  // The boundary is inert for them, so the preflight verdict is whatever it was
  // before the boundary existed.
  for (const strategy of ["funding", "social", "news"] as const) {
    const m = mission({ strategies: [strategy], required_signals: [] });
    const { authorization, preflight } = chain(m);
    const without = buildPaidExecutionPreflight({
      mission: m, plan: buildCapabilityGraph(m),
      firstProvider: compileFirstProviderCall(buildCapabilityGraph(m)).provider,
    });
    assertFalse(authorization.applies);
    assertEquals(
      preflight.blocked.map((b) => b.code), without.blocked.map((b) => b.code),
      `${strategy}: the boundary must add no block`,
    );
  }
});

Deno.test("multi_signal is not governed either, and adds no block", () => {
  const m = mission({ strategies: ["multi_signal", "hiring", "funding"] });
  const { selection, authorization, preflight } = chain(m);
  assertEquals(selection.combination, "all_must_hold");
  assertFalse(selection.ok, "a conjunction with a blocked half is not answerable");
  assertFalse(
    authorization.applies,
    "a mixed selection is left to the existing route in this phase",
  );
  assertFalse(
    preflight.blocked.some((b) => b.code === "playbook_not_authorized"),
    "and the boundary adds no block to it",
  );
});

Deno.test("hiring alongside another shape is NOT governed — mixed selections wait", () => {
  const m = mission({ strategies: ["hiring", "social"] });
  const { selection, authorization } = chain(m);
  assertEquals(selection.runnable, ["hiring"]);
  assertEquals(selection.blocked.map((b) => b.playbook), ["social"]);
  assertFalse(authorization.applies);
  assert(/alongside other shapes/.test(authorization.reason), authorization.reason);
});

// ═══════════ 4. the boundary catches a real divergence ═════════════════════

Deno.test("a hiring Mission routed to a capability the engine skips is REFUSED", () => {
  // The divergence the boundary exists for: strategy says hiring, and the graph
  // — choosing from a mix of fields that predates the playbook vocabulary —
  // enters at `funding_signal_discovery`, which the engine skips. Before the
  // boundary this run reported success having discovered nothing.
  const m = mission({
    strategies: ["hiring"],
    required_signals: [{ type: "hiring" }, { type: "funding" }],
    company_profile: {
      business_models: [], verticals: ["b2b saas"], stages: [], locations: [],
    },
  });
  const { selection, plan, authorization, preflight } = chain(m);

  assertEquals(selection.runnable, ["hiring"], "the selected shape is hiring");
  assertEquals(
    plan.entry_capability, "funding_signal_discovery",
    "the graph nonetheless enters at a funding capability",
  );
  assertFalse(isEngineDriven("funding_signal_discovery"));

  assert(authorization.applies);
  assertFalse(authorization.authorized);
  assertEquals(authorization.entry_source, "unauthorized");
  assertEquals(authorization.violations[0].code, "entry_capability_not_in_playbook");

  // And the paid gate refuses rather than spending on a plan that answers a
  // different question than the one selected.
  assertFalse(preflight.ok);
  assert(preflight.blocked.some((b) => b.code === "playbook_not_authorized"));
  let threw = false;
  try { assertPaidExecutionAllowed(preflight); } catch (e) {
    threw = true;
    assert(e instanceof PaidExecutionBlockedError);
  }
  assert(threw, "the gate must throw before the first paid call");
});

// ═══════════ 5. mission-forced entries stay legitimate ═════════════════════

Deno.test("a hiring Mission that supplied its own companies is still authorised", () => {
  // `known_companies` forces `known_company_resolution`, which is NOT a hiring
  // discovery capability — but the mission itself demanded it, so it is a
  // refinement rather than a disagreement.
  const m = mission({
    company_profile: {
      business_models: [], verticals: ["b2b saas"], stages: [], locations: [],
      known_companies: ["acme.com"],
    },
  });
  const { plan, authorization } = chain(m);
  assertEquals(plan.entry_capability, "known_company_resolution");
  assertEquals(authorization.entry_source, "mission_forced");
  assert(authorization.authorized, authorization.reason);
  assert(/supplies its own companies/.test(authorization.reason));
});

Deno.test("a hiring Mission asking for job listings is still authorised", () => {
  const m = mission({
    requested_output: "job_listings", target_entity: "job", mission_type: "job_research",
  });
  const { plan, authorization } = chain(m);
  assertEquals(plan.entry_capability, "job_discovery");
  assertEquals(authorization.entry_source, "mission_forced");
  assert(authorization.authorized, authorization.reason);
});

// ═══════════ 6. the boundary reads no raw text ═════════════════════════════

const SRC = Deno.readTextFileSync(
  new URL("../../../supabase/functions/_shared/leadPlaybookExecution.ts", import.meta.url),
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

Deno.test("the execution boundary never reads the user's sentence", () => {
  // `message` here is the violation objects' own field, so the raw-text check
  // names the CARRIERS of the user's sentence rather than the word.
  assertFalse(
    /original_user_query|original_query|originalUserQuery|\binstruction\b|\bprompt\b/.test(SRC),
    "the boundary reads decided Mission fields and the plan — never text",
  );
  // And its input type names exactly the two decided fields it may see.
  assert(
    /Pick<LeadMissionV1, "company_profile" \| "requested_output">/.test(SRC),
    "the mission input must be narrowed to the fields the boundary is allowed to read",
  );
  for (const parser of [
    "extractLeadIntent", "separateIntent", "extractRequestedLeadCount",
    "routeQualifiedLead", "classifyWorkflow", "compileLeadEntityIntent",
    "parseLeadMissionDeterministic", "extractLeadSearchIntent",
  ]) {
    assertFalse(SRC.includes(parser), `${parser} must not be reachable from the boundary`);
  }
  assertFalse(/RegExp\(|\.match\(/.test(SRC), "no pattern matching in the boundary");
});

Deno.test("the boundary runs nothing", () => {
  for (const sideEffect of ["fetch(", "runTool", "await ", "supabase", "insert("]) {
    assertFalse(SRC.includes(sideEffect), `${sideEffect} must not appear`);
  }
});

Deno.test("the authorization summary names the capabilities and the verdict", () => {
  const s = playbookAuthorizationSummary(chain(mission()).authorization);
  assertEquals(s.applies, true);
  assertEquals(s.authorized, true);
  assertEquals(s.playbook, "hiring");
  assertEquals(s.entry_source, "playbook_discovery");
  assert(Array.isArray(s.capabilities) && (s.capabilities as string[]).length > 0);
  assert((s.capabilities as string[]).every((c) => c.endsWith(":driven")));
});
