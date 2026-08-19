// THE GENERAL-COMPANY ROUTE, AND WHAT IT HONESTLY CANNOT DO.
//
// This file used to prove the route "reaches companies". It did — by handing a
// concept cohort to `apify_linkedin_company_search`, whose own card declares
// `not_for: ["semantic/concept search"]`. Run 25f3ff57 (2026-08-18) is what that
// bought in production: "AI startups in the United States" compiled to
// `searchQuery: "AI"` and `searchQuery: "startup"`, returned 50 accelerators,
// newsletters and a podcast, and qualified nothing.
//
// The route now goes through the same planner and the same validator as every
// other discovery capability, so the refusal that was always correct is now the
// one that actually happens. A concept cohort with no capable Actor STOPS, with
// a stated reason and no spend — which is the honest answer and, per the
// architecture decision of 2026-08-19, the chosen one.
//
// WHAT THIS FILE NOW PROVES:
//   * a concept cohort refuses rather than name-matching        (10b)
//   * a cohort source is refused OUTSIDE its cohort             (12)
//   * a refusal spends NOTHING                                  (10b, 13, 16)
//   * the name matcher still serves the job it is good at       (14, 15)
//   * no person is ever reachable on this route                 (16)
//
// THREE TESTS WERE DELETED WITH THE CODE THEY TESTED. #11, #12b and C1 all
// exercised `compileCompanySearchConcepts` — the deterministic query compiler
// that authored `searchQuery: "AI"`. It has no production caller and is gone;
// keeping tests for it would keep it alive.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCapabilityPlan, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  buildCompanyEvidence, groupJobsByEmployer, employerKeyFor, employerToCompany,
} from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { normalizeLinkedInJob } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";
import { DiscoveryStrategyBlockedError }
  from "../../../supabase/functions/_shared/leadDiscoveryStrategy.ts";

/**
 * Run the plan, and return the refusal instead of throwing it.
 *
 * A blocked discovery strategy is a RESULT in this architecture, not an
 * accident: the planner proposed, the validator refused, and the run stopped
 * before spending. Tests that assert "nothing paid ran" need to see the calls
 * that were made, which means catching the refusal rather than letting it
 * escape the assertion.
 */
async function runOrRefusal(
  deps: CapabilityEngineDeps, opts: Parameters<typeof runCapabilityPlan>[1],
): Promise<{ refused: string[] | null }> {
  try {
    await runCapabilityPlan(deps, opts);
    return { refused: null };
  } catch (e) {
    if (e instanceof DiscoveryStrategyBlockedError) {
      return { refused: e.violations.map((v) => v.code) };
    }
    throw e;
  }
}

const AUTOMATION_QUERY =
  "Find industrial automation integrators in Germany expanding commercially.";
const PARTNER_QUERY =
  "Find lead-generation agencies that could partner with Agentory.";

function proposal(over: Record<string, unknown>): Record<string, unknown> {
  return {
    requested_opportunity_count: 10,
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
    disallowed_broadening: [], required_evidence: [],
    required_capabilities: [], preferred_source_strategy: [],
    evaluation_instructions: "", founder_unlock_recommended: false,
    confidence: 0.8, unknowns: [],
    ...over,
  };
}

const AUTOMATION_PROPOSAL = proposal({
  company_types: ["industrial automation", "systems integration"],
  geographies: ["Germany"],
  disallowed_broadening: ["geography", "business_model"],
  preferred_signals: ["expansion"],
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
  preferred_source_strategy: ["company_profile_first"],
  founder_unlock_recommended: true,
});

/** One harvestapi/linkedin-company-search row. */
function searchRow(name: string, slug: string, extra: Record<string, unknown> = {}) {
  return {
    id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}`,
    website: `https://${slug}.de`,
    description: `${name} integrates industrial automation systems for factories.`,
    location: "Munich, Germany",
    ...extra,
  };
}

function enrichRow(name: string, slug: string) {
  return {
    id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}`,
    website: `https://${slug}.de`, employeeCount: 80,
    description: `${name} integrates industrial automation systems for factories.`,
    industries: [{ id: "9", name: "Industrial Automation", hierarchy: "Manufacturing" }],
    locations: [{ linkedinText: "Germany" }],
  };
}

interface Recorder { calls: string[]; inputs: unknown[] }

function mockDeps(
  rows: Record<string, Record<string, unknown>[]>, rec: Recorder,
): CapabilityEngineDeps {
  return {
    invoke: (call: CompiledActorCall<unknown>) => {
      rec.calls.push(call.actorKey);
      rec.inputs.push(call.input);
      return Promise.resolve(rows[call.actorKey] ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  };
}

const AUTOMATION_ROWS: Record<string, Record<string, unknown>[]> = {
  apify_linkedin_company_search: [
    searchRow("Siemens Integrator GmbH", "siemens-integrator"),
    searchRow("Bosch Automation Partners", "bosch-automation"),
    // The SAME company under a second concept — must collapse to one row.
    searchRow("Siemens Integrator GmbH", "siemens-integrator"),
  ],
  apify_linkedin_company_details: [
    enrichRow("Siemens Integrator GmbH", "siemens-integrator"),
    enrichRow("Bosch Automation Partners", "bosch-automation"),
  ],
};

const compile = (q: string, p?: unknown) =>
  compileLeadMission({ originalUserQuery: q, proposal: p });

const PEOPLE_ACTORS = [
  "apify_linkedin_company_employees", "apify_people_search",
  "apify_linkedin_profile_search",
];

// ══════════════════════════════════ 10-16. the general company route ══

Deno.test("10. an industrial-automation query ENTERS general_company_discovery", () => {
  const plan = buildCapabilityGraph(
    compile(AUTOMATION_QUERY, AUTOMATION_PROPOSAL).final_mission);
  assertEquals(plan.entry_capability, "general_company_discovery");
  // CONTAINMENT, NOT RANKING. This asserted a single provider, which made the
  // capability a forced move rather than a choice — see the note on
  // `general_company_discovery.providers`. The set is now the discovery
  // universe; WHICH of them runs is the planner's decision, refused by
  // `validateDiscoveryStrategy` when the card says the actor cannot do it.
  assertEquals(plan.steps[0].providers,
    ["apify_yc_companies_memo23", "apify_yc_companies_solidcode",
      "apify_linkedin_company_search"]);
});

Deno.test("10b. a concept cohort with no capable Actor REFUSES, and spends nothing", async () => {
  const rec: Recorder = { calls: [], inputs: [] };
  const m = compile(AUTOMATION_QUERY, AUTOMATION_PROPOSAL).final_mission;
  // The planner names the only general-index Actor there is. Its card says
  // `not_for: ["semantic/concept search"]`, and "industrial automation
  // integrators" names no company — so this IS a concept cohort.
  const { refused } = await runOrRefusal(
    { planDiscovery: stubDiscoverySelector([{
        actor_key: "apify_linkedin_company_search",
        role: "primary",
        input: { searchQuery: "industrial automation" },
        rationale: "the only general company index available",
      }]), ...mockDeps(AUTOMATION_ROWS, rec) },
    { mission: m, plan: buildCapabilityGraph(m) });

  // The specific refusal, plus the run-level "nothing survived" that follows it.
  assert(refused?.includes("actor_not_for_semantic_discovery"),
    `a name matcher may not discover a concept cohort; got ${refused?.join(", ")}`);
  assert(refused?.includes("no_valid_selection"),
    "and with it refused, no strategy remains");
  // THE PART THAT MATTERS COMMERCIALLY: the refusal happens BEFORE the call.
  assertEquals(rec.calls, [], "a refused strategy costs nothing");
});

Deno.test("12. a cohort source is refused OUTSIDE its cohort, with the reason", async () => {
  const rec: Recorder = { calls: [], inputs: [] };
  const m = compile(AUTOMATION_QUERY, AUTOMATION_PROPOSAL).final_mission;
  const plan = buildCapabilityGraph(m);

  // `general_company_discovery` now PERMITS the YC sources — containment is the
  // discovery universe, so the planner has a real choice to make. This asserts
  // the safety net under that choice: memo23 reads the Y Combinator directory
  // and can return nothing else, so pointing it at German integrators is not a
  // worse search, it is the wrong population.
  const { refused } = await runOrRefusal(
    { planDiscovery: stubDiscoverySelector(), ...mockDeps(AUTOMATION_ROWS, rec) },
    { mission: m, plan });

  assert(refused?.includes("actor_outside_mission_cohort"),
    `expected a cohort refusal; got ${refused?.join(", ")}`);
  for (const yc of ["apify_yc_companies_memo23", "apify_yc_companies_solidcode"]) {
    assertFalse(rec.calls.includes(yc), `${yc} must never run for an industrial query`);
  }
});

Deno.test("13. an agency-partner query requires no job verification", async () => {
  const rec: Recorder = { calls: [], inputs: [] };
  const m = compile(PARTNER_QUERY, PARTNER_PROPOSAL).final_mission;
  const plan = buildCapabilityGraph(m);
  assertFalse(plan.steps.map((s) => s.capability).includes("hiring_verification"));
  // Whether discovery proceeds or refuses, the guarantee is the same: partner
  // fit is not proven by a job posting, so no job Actor may run either way.
  await runOrRefusal({ planDiscovery: stubDiscoverySelector(), ...mockDeps({
    apify_linkedin_company_search: [searchRow("Growth Agency", "growth-agency")],
    apify_linkedin_company_details: [enrichRow("Growth Agency", "growth-agency")],
  }, rec) }, { mission: m, plan });
  assertFalse(rec.calls.includes("apify_linkedin_job_search"),
    "nothing about partner fit is proven by a job posting");
});

// ── 14-15 RUN ON A MISSION THE NAME MATCHER IS ACTUALLY GOOD AT ────────────
//
// Their subject is normalization, dedupe and which query the Brain is asked
// about — none of which is about concept discovery. They used the automation
// mission only because it was the file's fixture, and that mission now refuses
// before reaching either stage.
//
// `NAMED_PROPOSAL` describes no vertical, business model or stage, so
// `missionNeedsSemanticDiscovery` is false and the LinkedIn company search is
// doing exactly its `best_for`: turning company names into identity URLs.
const NAMED_QUERY = "Research Siemens Integrator GmbH and Bosch Automation Partners.";
const NAMED_PROPOSAL = proposal({
  geographies: ["Germany"],
  required_capabilities: [
    "general_company_discovery", "company_details_enrichment",
    "company_semantic_evaluation", "portfolio_ranking",
  ],
  preferred_source_strategy: ["company_profile_first"],
});
const NAMED_SELECTOR = () => stubDiscoverySelector([{
  actor_key: "apify_linkedin_company_search",
  role: "primary",
  input: { searchQuery: "Siemens Integrator GmbH" },
  rationale: "the user named the companies; a name matcher is exactly right",
}]);

Deno.test("14. company results are normalized and deduplicated", async () => {
  const rec: Recorder = { calls: [], inputs: [] };
  const m = compile(NAMED_QUERY, NAMED_PROPOSAL).final_mission;
  const run = await runCapabilityPlan( { planDiscovery: NAMED_SELECTOR(), ...mockDeps(AUTOMATION_ROWS, rec) }, {
    mission: m, plan: buildCapabilityGraph(m),
  });
  // Three rows came back; two of them are the same company.
  const keys = run.companies.map((c) => c.key);
  assertEquals(keys.length, new Set(keys).size, "company keys are unique");
  assert(run.companies.length <= 2, `expected at most 2 unique companies, got ${keys.length}`);
  // And the rows are normalized, not raw provider shapes.
  for (const c of run.companies) {
    assert(typeof c.company.external_source_id === "string");
    assert(c.company.company_name, "every company carries a name");
  }
});

Deno.test("15. the Company Brain receives the accepted mission, not a new one", async () => {
  const rec: Recorder = { calls: [], inputs: [] };
  const m = compile(NAMED_QUERY, NAMED_PROPOSAL).final_mission;
  const seen: string[] = [];
  await runCapabilityPlan({
      planDiscovery: NAMED_SELECTOR(),
    ...mockDeps(AUTOMATION_ROWS, rec),
    classifyCompany: (input) => {
      seen.push(String(input.original_user_query ?? ""));
      return Promise.resolve(null);
    },
  } as CapabilityEngineDeps, { mission: m, plan: buildCapabilityGraph(m) });
  // Whatever the classifier was asked about, it was asked about THIS query.
  for (const q of seen) assertEquals(q, NAMED_QUERY);
  // The automation mission's own broadening rules are asserted where they are
  // compiled, on the mission itself.
  const automation = compile(AUTOMATION_QUERY, AUTOMATION_PROPOSAL).final_mission;
  assertEquals(automation.directives?.disallowed_broadening,
    ["geography", "business_model"]);
});

Deno.test("16. no founder or contact Actor is scheduled on the general route", async () => {
  for (const [q, p] of [
    [AUTOMATION_QUERY, AUTOMATION_PROPOSAL], [PARTNER_QUERY, PARTNER_PROPOSAL],
  ] as const) {
    const rec: Recorder = { calls: [], inputs: [] };
    const m = compile(q, p).final_mission;
    const plan = buildCapabilityGraph(m);
    await runOrRefusal(
      { planDiscovery: stubDiscoverySelector(), ...mockDeps(AUTOMATION_ROWS, rec) },
      { mission: m, plan });
    for (const actor of PEOPLE_ACTORS) {
      assertFalse(rec.calls.includes(actor), `${q}: ${actor} must not run`);
      assertFalse(plan.allowed_providers.includes(actor), `${q}: ${actor} must be unreachable`);
    }
    assertEquals(
      plan.steps.filter((s) =>
        ["founder_discovery", "employer_verification", "contact_enrichment"]
          .includes(s.capability)).length, 0);
  }
});

// ═══════════════════════════════ concept compilation is bounded ══

Deno.test("E1. job rows collapse onto employers, newest evidence first", () => {
  const rows = [
    { id: 1, title: "Head of Sales", linkedinUrl: "https://x/1", postedDate: "2026-07-01",
      company: { id: 9, name: "Acme, Inc.", linkedinUrl: "https://www.linkedin.com/company/acme" } },
    { id: 2, title: "Account Executive", linkedinUrl: "https://x/2", postedDate: "2026-08-01",
      company: { id: 9, name: "Acme Inc", linkedinUrl: "https://www.linkedin.com/company/acme" } },
    { id: 3, title: "Sales Manager", linkedinUrl: "https://x/3", postedDate: "2026-06-01",
      company: { name: "Beta GmbH" } },
  ].map(normalizeLinkedInJob);

  const groups = groupJobsByEmployer(rows);
  assertEquals(groups.length, 2, "two employers, three postings");
  const acme = groups.find((g) => g.linkedin_company_url?.includes("acme"))!;
  assertEquals(acme.jobs.length, 2);
  // STRONGEST CURRENT EVIDENCE = the most recent opening.
  assertEquals(acme.jobs[0].title, "Account Executive");

  // A name-only employer still groups, via a normalized name key.
  assert(employerKeyFor(rows[2])!.startsWith("name:"));
  // "Acme, Inc." and "Acme Inc" are ONE employer, not two identity purchases.
  assertEquals(
    employerKeyFor(rows[0]), employerKeyFor(rows[1]));

  // The employer row carries only what a posting can establish.
  const c = employerToCompany(acme);
  assertEquals(c.employee_count, null, "a posting does not prove headcount");
  assertEquals(c.hiring_status, true, "a posting does prove hiring");
  assert(c.missing_fields.includes("employee_count"));
});

Deno.test("E2. the evidence record names absences and reports conflicts", () => {
  const base = employerToCompany(groupJobsByEmployer([
    normalizeLinkedInJob({
      id: 1, title: "Head of Sales", linkedinUrl: "https://x/1",
      company: { id: 9, name: "Acme", linkedinUrl: "https://www.linkedin.com/company/acme" },
    }),
  ])[0]);

  const bare = buildCompanyEvidence({
    company_key: "acme", source_capability: "job_discovery", company: base,
  });
  assert(bare.missing_fields.includes("employee_count"));
  assert(bare.missing_fields.includes("commercial_job_evidence"));
  assertEquals(bare.identity_state, "not_attempted");

  // Two sources disagreeing by more than 2x is a DIFFERENT COMPANY, reported.
  const conflicted = buildCompanyEvidence({
    company_key: "acme", source_capability: "general_company_discovery",
    company: { ...base, employee_count: 40 },
    enriched: { ...base, employee_count: 400 },
  });
  assert(conflicted.conflicting_evidence.some((c) => /employee_count/.test(c)),
    "a 10x headcount gap is reported, never silently resolved");
});
