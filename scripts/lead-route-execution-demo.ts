// OFFLINE END-TO-END EXECUTION — mocked Actors, real engine, zero runs.
//
// Drives `runCapabilityPlan` over fixture provider rows for the general-company
// route, so the output below is what the ENGINE actually did, not a description
// of what it would do. Every Actor is a function returning canned rows; there is
// no network permission and no provider client anywhere in the process.
//
//   deno run --allow-read scripts/lead-route-execution-demo.ts

import { runCapabilityPlan } from "../supabase/functions/_shared/leadCapabilityEngine.ts";
import { compileCompanySearchConcepts } from "../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../supabase/functions/_shared/leadCapabilityGraph.ts";
import { compileLeadMission } from "../supabase/functions/_shared/leadMissionCompiler.ts";
import { buildCompanyEvidence } from "../supabase/functions/_shared/leadCompanyEvidence.ts";
import type { CompiledActorCall } from "../supabase/functions/_shared/hiringActorInputs.ts";

function proposal(over: Record<string, unknown>): Record<string, unknown> {
  return {
    requested_opportunity_count: 10, requested_contact_ready_count: null,
    company_types: [], geographies: [],
    employee_range: { min: null, max: null }, decision_maker_roles: [],
    hard_constraints: [], soft_preferences: [],
    preferred_signals: [], adjacent_signals: [], excluded_signals: [],
    allowed_broadening: {
      role_families: [], company_types: [], geographies: [],
      employee_range: { min: null, max: null },
    },
    disallowed_broadening: [], required_evidence: [],
    required_capabilities: [], preferred_source_strategy: [],
    evaluation_instructions: "", founder_unlock_recommended: false,
    confidence: 0.85, unknowns: [],
    ...over,
  };
}

function searchRow(name: string, slug: string, country: string, desc: string) {
  return {
    id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}`,
    website: `https://${slug}.example`, description: desc, location: country,
  };
}
function enrichRow(name: string, slug: string, country: string, desc: string,
                   employees: number, industry: string) {
  return {
    id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}`,
    website: `https://${slug}.example`, employeeCount: employees, description: desc,
    industries: [{ id: "1", name: industry, hierarchy: "Root" }],
    locations: [{ linkedinText: country }],
  };
}

const CASES = [
  {
    label: "1 — US MANUFACTURERS HIRING THEIR FIRST SALESPERSON",
    query: "Find US manufacturers under 100 employees hiring their first salesperson.",
    proposal: proposal({
      company_types: ["manufacturing"], geographies: ["United States"],
      employee_range: { min: null, max: 100 },
      preferred_signals: ["hiring"],
      required_capabilities: [
        "general_company_discovery", "external_hiring_verification",
        "company_details_enrichment", "company_semantic_evaluation",
        "portfolio_ranking", "offer_founder_unlock",
      ],
      preferred_source_strategy: ["job_signal_first"],
      founder_unlock_recommended: true,
    }),
    rows: {
      apify_linkedin_company_search: [
        searchRow("Ridge Tool Works", "ridge-tool", "Ohio, United States",
          "Precision metal components manufacturer."),
        searchRow("Ridge Tool Works", "ridge-tool", "Ohio, United States", "dup"),
      ],
      apify_linkedin_company_details: [
        enrichRow("Ridge Tool Works", "ridge-tool", "United States",
          "Precision metal components manufacturer.", 80, "Machinery Manufacturing"),
      ],
      apify_linkedin_job_search: [{
        id: "j1", title: "Head of Sales", linkedinUrl: "https://x/j1",
        postedDate: "2026-08-01",
        company: { id: 1, name: "Ridge Tool Works",
          linkedinUrl: "https://www.linkedin.com/company/ridge-tool" },
      }],
    },
  },
  {
    label: "2 — INDUSTRIAL AUTOMATION INTEGRATORS IN GERMANY",
    query: "Find industrial automation integrators in Germany expanding commercially.",
    proposal: proposal({
      company_types: ["industrial automation", "systems integration"],
      geographies: ["Germany"],
      disallowed_broadening: ["geography", "business_model"],
      preferred_signals: ["expansion"],
      required_capabilities: [
        "general_company_discovery", "embedded_hiring_evidence",
        "company_details_enrichment", "company_semantic_evaluation", "portfolio_ranking",
      ],
      preferred_source_strategy: ["company_profile_first"],
    }),
    rows: {
      apify_linkedin_company_search: [
        searchRow("Kuhn Automation GmbH", "kuhn-automation", "Stuttgart, Germany",
          "Systems integrator for factory automation lines."),
      ],
      apify_linkedin_company_details: [
        enrichRow("Kuhn Automation GmbH", "kuhn-automation", "Germany",
          "Systems integrator for factory automation lines.", 140, "Industrial Automation"),
      ],
    },
  },
  {
    label: "3 — LEAD-GENERATION AGENCIES AS PARTNERS",
    query: "Find lead-generation agencies that could partner with Agentory.",
    proposal: proposal({
      company_types: ["lead generation agency"],
      preferred_signals: ["partner_fit"],
      evaluation_instructions:
        "Judge whether this agency's services complement Agentory rather than compete.",
      required_capabilities: [
        "general_company_discovery", "company_details_enrichment",
        "company_semantic_evaluation", "portfolio_ranking", "offer_founder_unlock",
      ],
      preferred_source_strategy: ["company_profile_first"],
      founder_unlock_recommended: true,
    }),
    rows: {
      apify_linkedin_company_search: [
        searchRow("Pipeline Partners", "pipeline-partners", "Austin, United States",
          "Outbound lead generation agency for B2B software."),
      ],
      apify_linkedin_company_details: [
        enrichRow("Pipeline Partners", "pipeline-partners", "United States",
          "Outbound lead generation agency for B2B software.", 30, "Marketing Services"),
      ],
    },
  },
];

const PEOPLE_ACTORS = [
  "apify_linkedin_company_employees", "apify_people_search",
  "apify_linkedin_profile_search",
];

const line = (s = "") => console.log(s);
const rule = (c = "─") => line(c.repeat(78));

for (const c of CASES) {
  const compiled = compileLeadMission({
    originalUserQuery: c.query, proposal: c.proposal,
  });
  const m = compiled.final_mission;
  const plan = buildCapabilityGraph(m);

  const calls: Array<{ actor: string; input: unknown }> = [];
  const run = await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      calls.push({ actor: call.actorKey, input: call.input });
      return Promise.resolve(
        (c.rows as Record<string, Record<string, unknown>[]>)[call.actorKey] ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  }, { mission: m, plan });

  rule("═");
  line(`CASE ${c.label}`);
  line(`"${c.query}"`);
  rule("═");

  line("\nACCEPTED MISSION");
  line(`  parser_source   : ${compiled.parser_source}`);
  line(`  requested_count : ${m.requested_count}`);
  line(`  verticals       : ${JSON.stringify(m.company_profile.verticals)}`);
  line(`  locations       : ${JSON.stringify(m.company_profile.locations)}`);
  line(`  employee_range  : ${JSON.stringify(m.company_profile.employee_range ?? null)}`);
  line(`  hard_constraints: ${JSON.stringify(Object.keys(m.hard_constraints))}`);

  line(`\nCAPABILITY GRAPH  (entry: ${plan.entry_capability})`);
  line(`  reason: ${plan.routing_reason}`);
  for (const s of plan.steps) {
    line(`   ${s.order}. ${s.capability.padEnd(30)} ${
      s.providers.length ? s.providers.join(" → ") : "(pure code)"}`);
  }

  line("\nAPPROVED PROVIDER CALLS ACTUALLY MADE");
  if (calls.length === 0) line("  (none)");
  for (const k of calls) {
    const inp = k.input as Record<string, unknown>;
    const shown = inp.searchQuery !== undefined
      ? `searchQuery=${JSON.stringify(inp.searchQuery)} locations=${JSON.stringify(inp.locations ?? null)} maxItems=${inp.maxItems}`
      : inp.companies !== undefined
      ? `companies=${JSON.stringify(inp.companies)}`
      : JSON.stringify(inp).slice(0, 120);
    line(`  • ${k.actor}`);
    line(`      ${shown}`);
  }

  line("\nNORMALIZED COMPANY EVIDENCE");
  for (const co of run.companies) {
    const ev = buildCompanyEvidence({
      company_key: co.key,
      source_capability: plan.entry_capability,
      source_query: c.query,
      company: co.company,
      enriched: co.enriched,
      identity_state: co.identity
        ? (co.identity.status === "verified_match" ? "resolved" : "unresolved")
        : "not_attempted",
      linkedin_company_url: co.identity?.linkedin_company_url ?? null,
      commercial_jobs: co.hiring_jobs.map((j) => ({
        title: j.title ?? "", url: j.job_url, location: j.location,
        posted_date: j.posted_date, tier: null,
      })),
    });
    line(`  ${ev.company_name ?? ev.company_key}`);
    line(`      identity  : ${ev.identity_state}  ${ev.linkedin_company_url ?? ""}`);
    line(`      geography : ${ev.geography_evidence ?? "(unknown)"}`);
    line(`      employees : ${ev.employee_evidence ?? "(unknown)"}`);
    line(`      industry  : ${JSON.stringify(ev.industry_evidence)}`);
    line(`      signal    : ${ev.strongest_signal ?? "(none)"}`);
    line(`      missing   : ${JSON.stringify(ev.missing_fields)}`);
    line(`      conflicts : ${JSON.stringify(ev.conflicting_evidence)}`);
  }

  line("\nCOMPANY BRAIN OUTCOMES");
  for (const co of run.companies) {
    line(`  ${co.company.company_name}: verdict=${co.verdict ?? "(none)"} ` +
      `brain=${co.brain?.outcome ?? "(not reached)"}`);
  }

  line("\nPORTFOLIO / FUNNEL");
  line(`  companies discovered : ${run.companies.length}`);
  line(`  qualified            : ${run.state.qualified_company_keys.length}`);
  line(`  unknown / review     : ${run.state.unknown_company_keys.length}`);
  line(`  cost units spent     : ${run.state.accumulated_cost_units}`);
  line(`  terminal reason      : ${run.state.terminal_reason}`);

  line("\nFOUNDER / CONTACT SAFETY");
  const peopleCalled = calls.filter((k) => PEOPLE_ACTORS.includes(k.actor));
  line(`  people Actors invoked : ${peopleCalled.length === 0 ? "NONE" : "BUG — " +
    peopleCalled.map((k) => k.actor).join(", ")}`);
  line(`  people Actors allowed : ${
    plan.allowed_providers.filter((p) => PEOPLE_ACTORS.includes(p)).join(", ") || "none"}`);
  line(`  offered               : ${JSON.stringify(plan.offered_capabilities)}`);
  line(`  recommended_action    : ${
    plan.offered_capabilities.includes("offer_founder_unlock")
      ? "offer_founder_unlock" : "(none)"}`);
  line();
}

rule("═");
line("No Actor was started. No model was called. No database was read.");
rule("═");
