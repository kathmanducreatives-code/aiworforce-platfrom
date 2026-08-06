// THE GENERAL-COMPANY ROUTE ACTUALLY EXECUTES NOW.
//
// It was declared in the graph and never driven: a manufacturer, integrator or
// agency mission planned a sensible route and then recorded `skipped_no_input` —
// a correct answer to nothing. These tests drive the real engine over mocked
// Actors and prove the route reaches companies, keeps the mission's hard
// constraints, and never touches a person.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCapabilityPlan, compileCompanySearchConcepts,
  MAX_COMPANY_SEARCH_QUERIES, MAX_COMPANY_SEARCH_ROWS,
  type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  buildCompanyEvidence, groupJobsByEmployer, employerKeyFor, employerToCompany,
} from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { normalizeLinkedInJob } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

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
  assertEquals(plan.steps[0].providers, ["apify_linkedin_company_search"]);
});

Deno.test("10b. and it now EXECUTES instead of reporting skipped_no_input", async () => {
  const rec: Recorder = { calls: [], inputs: [] };
  const m = compile(AUTOMATION_QUERY, AUTOMATION_PROPOSAL).final_mission;
  const run = await runCapabilityPlan(mockDeps(AUTOMATION_ROWS, rec), {
    mission: m, plan: buildCapabilityGraph(m),
  });
  const discovery = run.capability_outcomes
    .find((o) => o.capability === "general_company_discovery");
  assert(discovery, "the capability must be attempted");
  assertEquals(discovery!.status, "complete",
    `expected complete, got ${discovery!.status}: ${discovery!.reason}`);
  assert(rec.calls.includes("apify_linkedin_company_search"),
    "the approved company-search Actor is the one that ran");
  assert(run.companies.length > 0, "the route must reach companies");
});

Deno.test("11. Germany stays a HARD geography, as a filter and not a query string", () => {
  const m = compile(AUTOMATION_QUERY, AUTOMATION_PROPOSAL).final_mission;
  assertEquals(m.company_profile.locations, ["Germany"]);
  const concepts = compileCompanySearchConcepts(m, 20);
  assertEquals(concepts.locations, ["Germany"]);
  // THE GEOGRAPHY IS NOT PASTED INTO THE CONCEPT. `searchQuery` is a name index;
  // a query carrying a country name returns nothing, which is how six live
  // searches returned zero rows.
  for (const q of concepts.queries) {
    assertFalse(/germany/i.test(q), `"${q}" must not carry the geography`);
  }
  assert(concepts.queries.length > 0);
});

Deno.test("12. an industrial query is not broadened into SaaS or YC", async () => {
  const rec: Recorder = { calls: [], inputs: [] };
  const m = compile(AUTOMATION_QUERY, AUTOMATION_PROPOSAL).final_mission;
  const plan = buildCapabilityGraph(m);
  await runCapabilityPlan(mockDeps(AUTOMATION_ROWS, rec), { mission: m, plan });

  for (const yc of ["apify_yc_companies_memo23", "apify_yc_companies_solidcode"]) {
    assertFalse(rec.calls.includes(yc), `${yc} must never run for an industrial query`);
    assertFalse(plan.allowed_providers.includes(yc));
  }
  const concepts = compileCompanySearchConcepts(m, 20);
  for (const q of concepts.queries) {
    assertFalse(/saas|software as a service|y combinator/i.test(q),
      `"${q}" must not broaden the mission`);
  }
});

Deno.test("13. an agency-partner query requires no job verification", async () => {
  const rec: Recorder = { calls: [], inputs: [] };
  const m = compile(PARTNER_QUERY, PARTNER_PROPOSAL).final_mission;
  const plan = buildCapabilityGraph(m);
  assertFalse(plan.steps.map((s) => s.capability).includes("hiring_verification"));
  await runCapabilityPlan(mockDeps({
    apify_linkedin_company_search: [searchRow("Growth Agency", "growth-agency")],
    apify_linkedin_company_details: [enrichRow("Growth Agency", "growth-agency")],
  }, rec), { mission: m, plan });
  assertFalse(rec.calls.includes("apify_linkedin_job_search"),
    "nothing about partner fit is proven by a job posting");
});

Deno.test("14. company results are normalized and deduplicated", async () => {
  const rec: Recorder = { calls: [], inputs: [] };
  const m = compile(AUTOMATION_QUERY, AUTOMATION_PROPOSAL).final_mission;
  const run = await runCapabilityPlan(mockDeps(AUTOMATION_ROWS, rec), {
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
  const m = compile(AUTOMATION_QUERY, AUTOMATION_PROPOSAL).final_mission;
  const seen: string[] = [];
  await runCapabilityPlan({
    ...mockDeps(AUTOMATION_ROWS, rec),
    classifyCompany: (input) => {
      seen.push(String(input.original_user_query ?? ""));
      return Promise.resolve(null);
    },
  } as CapabilityEngineDeps, { mission: m, plan: buildCapabilityGraph(m) });
  // Whatever the classifier was asked about, it was asked about THIS query.
  for (const q of seen) assertEquals(q, AUTOMATION_QUERY);
  assertEquals(m.directives?.disallowed_broadening, ["geography", "business_model"]);
});

Deno.test("16. no founder or contact Actor is scheduled on the general route", async () => {
  for (const [q, p] of [
    [AUTOMATION_QUERY, AUTOMATION_PROPOSAL], [PARTNER_QUERY, PARTNER_PROPOSAL],
  ] as const) {
    const rec: Recorder = { calls: [], inputs: [] };
    const m = compile(q, p).final_mission;
    const plan = buildCapabilityGraph(m);
    await runCapabilityPlan(mockDeps(AUTOMATION_ROWS, rec), { mission: m, plan });
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

Deno.test("C1. search concepts are bounded, and rejections are named", () => {
  const m = compile(AUTOMATION_QUERY, AUTOMATION_PROPOSAL).final_mission;
  const hostile = {
    ...m,
    company_profile: {
      ...m.company_profile,
      verticals: [
        "industrial automation",
        "https://evil.example.com/scrape",          // a URL
        "apify/linkedin-company-search",            // a provider
        "companies that might conceivably be interested in buying something", // a sentence
        "a", "b", "c", "d", "e", "f",               // beyond the cap
      ],
    },
  };
  const c = compileCompanySearchConcepts(hostile, 100);
  assert(c.queries.length <= MAX_COMPANY_SEARCH_QUERIES);
  assert(c.maxItemsPerQuery <= MAX_COMPANY_SEARCH_ROWS);
  for (const q of c.queries) {
    assertFalse(/https?:\/\//i.test(q), "no URLs reach the provider");
    assertFalse(/apify|harvestapi/i.test(q), "no provider names reach the provider");
  }
  const reasons = c.rejected.map((r) => r.reason).join(" ");
  assert(/URL|domain/i.test(reasons), "a URL rejection is named");
  assert(/provider|tool/i.test(reasons), "a provider rejection is named");
  assert(/cap/i.test(reasons), "the cap is named");
});

// ══════════════════════════════════ employer evidence from job rows ══

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
