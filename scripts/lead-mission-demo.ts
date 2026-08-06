// OFFLINE DEMONSTRATION — five queries, five plans, zero Actors.
//
// Prints what the compiler and the capability graph produce for each of the
// example queries, using FIXTURE model proposals. Nothing here opens a socket,
// starts a run, reads a database or calls a model: `compileLeadMission` and
// `buildCapabilityGraph` are both pure, which is what makes this runnable at all.
//
//   deno run --allow-read scripts/lead-mission-demo.ts
//
// (`--allow-read` is only for Deno's module loading. The script itself reads
// nothing from disk and has no network permission, so a stray provider call
// would fail loudly rather than quietly cost money.)

import { compileLeadMission } from "../supabase/functions/_shared/leadMissionCompiler.ts";
import { buildCapabilityGraph } from "../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  actorKeysFor, PUBLIC_CAPABILITY_CATALOGUE,
} from "../supabase/functions/_shared/leadCapabilityCatalogue.ts";
import { CAPABILITY_REGISTRY } from "../supabase/functions/_shared/leadCapabilityGraph.ts";

function proposal(over: Record<string, unknown>): Record<string, unknown> {
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
    disallowed_broadening: [], required_evidence: [],
    required_capabilities: [], preferred_source_strategy: [],
    evaluation_instructions: "", founder_unlock_recommended: false,
    confidence: 0.8, unknowns: [],
    ...over,
  };
}

const CASES: Array<{
  label: string; query: string; proposal: Record<string, unknown>;
  brain?: Record<string, unknown>;
}> = [
  {
    label: "1 — YC STARTUPS",
    query: "Find 100 founders of US YC B2B SaaS startups building their sales teams.",
    brain: { industries: ["B2B SaaS", "AI SaaS", "Recruiting Agencies"] },
    proposal: proposal({
      requested_opportunity_count: 100,
      company_types: ["b2b saas"], geographies: ["United States"],
      decision_maker_roles: ["Founder", "Co-Founder", "CEO"],
      hard_constraints: [
        { field: "geography", operator: "in", value: ["United States"], reason: "the query says US" },
        { field: "company_type", operator: "in", value: ["b2b saas"], reason: "the query says B2B SaaS" },
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
        "A company qualifies when it sells B2B software on subscription and is hiring a commercial role.",
      founder_unlock_recommended: true,
      unknowns: ["whether 'sales team' includes customer success"],
    }),
  },
  {
    label: "2 — GENERAL MANUFACTURERS",
    query: "Find US manufacturers under 100 employees hiring their first salesperson.",
    proposal: proposal({
      company_types: ["manufacturing"], geographies: ["United States"],
      employee_range: { min: null, max: 100 },
      hard_constraints: [
        { field: "employee_max", operator: "lte", value: 100, reason: "under 100 employees" },
        { field: "geography", operator: "in", value: ["United States"], reason: "US" },
      ],
      preferred_signals: ["hiring"], adjacent_signals: ["first_commercial_hire"],
      required_evidence: ["active_sales_opening"],
      required_capabilities: [
        "general_company_discovery", "external_hiring_verification",
        "company_details_enrichment", "company_semantic_evaluation",
        "portfolio_ranking", "offer_founder_unlock",
      ],
      preferred_source_strategy: ["job_signal_first"],
      founder_unlock_recommended: true,
    }),
  },
  {
    label: "3 — INDUSTRIAL AUTOMATION",
    query: "Find industrial automation integrators in Germany expanding commercially.",
    proposal: proposal({
      company_types: ["industrial automation", "systems integration"],
      geographies: ["Germany"],
      hard_constraints: [
        { field: "geography", operator: "in", value: ["Germany"], reason: "the query names Germany" },
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
    }),
  },
  {
    label: "4 — AGENCY PARTNERS",
    query: "Find lead-generation agencies that could partner with Agentory.",
    proposal: proposal({
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
    }),
  },
  {
    label: "5 — KNOWN COMPANY LIST",
    query: "Evaluate these companies: SnapMagic, Tara AI and Deepgram.",
    proposal: proposal({
      requested_opportunity_count: 3,
      required_capabilities: [
        "known_company_identity_resolution", "company_details_enrichment",
        "company_semantic_evaluation", "portfolio_ranking",
      ],
      preferred_source_strategy: ["known_companies_only"],
    }),
  },
];

const line = (s = "") => console.log(s);
const rule = (c = "─") => line(c.repeat(78));

for (const c of CASES) {
  const r = compileLeadMission({
    originalUserQuery: c.query,
    proposal: c.proposal,
    companyBrain: (c.brain ?? null) as never,
  });
  const plan = buildCapabilityGraph(r.final_mission);
  const m = r.final_mission;

  rule("═");
  line(`EXAMPLE ${c.label}`);
  line(`"${c.query}"`);
  rule("═");

  line("\nGPT PROPOSAL (accepted fields)");
  line(`  requested_opportunity_count : ${r.gpt_proposal?.requested_opportunity_count}`);
  line(`  company_types               : ${JSON.stringify(r.gpt_proposal?.company_types)}`);
  line(`  geographies                 : ${JSON.stringify(r.gpt_proposal?.geographies)}`);
  line(`  preferred_signals           : ${JSON.stringify(r.gpt_proposal?.preferred_signals)}`);
  line(`  adjacent_signals            : ${JSON.stringify(r.gpt_proposal?.adjacent_signals)}`);
  line(`  required_capabilities       : ${JSON.stringify(r.gpt_proposal?.required_capabilities)}`);
  line(`  preferred_source_strategy   : ${JSON.stringify(r.gpt_proposal?.preferred_source_strategy)}`);
  line(`  confidence / unknowns       : ${r.confidence} / ${JSON.stringify(r.unknowns)}`);

  line(`\nPARSER SOURCE                 : ${r.parser_source}`);
  line("VALIDATOR CHANGES");
  if (r.validator_changes.length === 0) line("  (none — the proposal was accepted as given)");
  for (const ch of r.validator_changes) line(`  • ${ch}`);
  if (r.workspace_context.consulted) {
    line("WORKSPACE CONTEXT");
    line(`  applied : ${JSON.stringify(r.workspace_context.categories_applied)}`);
    for (const ig of r.workspace_context.categories_ignored) {
      line(`  ignored : ${ig.value}  — ${ig.reason}`);
    }
  }

  line("\nFINAL MISSION");
  line(`  requested_count  : ${m.requested_count}`);
  line(`  verticals        : ${JSON.stringify(m.company_profile.verticals)}`);
  line(`  locations        : ${JSON.stringify(m.company_profile.locations)}`);
  line(`  employee_range   : ${JSON.stringify(m.company_profile.employee_range ?? null)}`);
  line(`  required_signals : ${JSON.stringify(m.required_signals.map((s) => s.type))}`);
  line(`  hard_constraints : ${JSON.stringify(Object.keys(m.hard_constraints))}`);

  line("\nREQUIRED CAPABILITIES (public → internal)");
  for (const pub of r.capability_decision.approved) {
    const spec = PUBLIC_CAPABILITY_CATALOGUE[pub];
    const actors = actorKeysFor(pub);
    line(`  ${pub}`);
    line(`      kind=${spec.kind} paid=${spec.paid}`);
    line(`      internal : ${JSON.stringify(spec.internal)}`);
    line(`      actors   : ${actors.length ? JSON.stringify(actors) : "(none — runs nothing)"}`);
  }

  line(`\nAPPROVED ACTOR ROUTE  (entry: ${plan.entry_capability})`);
  line(`  routing reason: ${plan.routing_reason}`);
  for (const s of plan.steps) {
    const actors = s.providers.length ? s.providers.join(" → ") : "(no provider — pure code)";
    line(`  ${String(s.order).padStart(2)}. ${s.capability.padEnd(30)} ${actors}`);
  }

  const paidSteps = plan.steps.filter((s) => s.providers.length > 0);
  line("\nPAID PROVIDER CALLS THAT WOULD BE NEEDED");
  if (paidSteps.length === 0) line("  (none)");
  for (const s of paidSteps) {
    line(`  • ${s.capability} — up to ${s.max_attempts} attempt(s), ` +
      `${CAPABILITY_REGISTRY[s.capability].cost_units} cost unit(s) each`);
  }

  line("\nEXISTING EVIDENCE REUSED INSTEAD OF BOUGHT");
  const embedded = r.capability_decision.approved.includes("embedded_hiring_evidence");
  const external = r.capability_decision.approved.includes("external_hiring_verification");
  line(`  embedded hiring evidence : ${embedded ? "YES — openJobs / stored evidence" : "not requested"}`);
  line(`  external job search      : ${external ? "requested" : "NOT bought"}`);
  line(`  hiring_verification step : ${
    plan.steps.some((s) => s.capability === "hiring_verification") ? "present" : "ABSENT"}`);
  if (r.final_mission.directives?.source_strategy.includes("evidence_reuse_first")) {
    line("  resume ledger            : completed provider work is skipped on a continuation");
  }

  line("\nFOUNDER UNLOCK");
  line(`  recommended     : ${r.final_mission.directives?.founder_unlock_recommended}`);
  line(`  offered         : ${JSON.stringify(plan.offered_capabilities)}`);
  const autoPeople = plan.steps.some((s) =>
    ["founder_discovery", "employer_verification", "contact_enrichment"].includes(s.capability));
  line(`  founder_discovery in plan       : ${autoPeople ? "YES — BUG" : "NO"}`);
  line(`  people Actor reachable          : ${
    plan.allowed_providers.includes("apify_linkedin_company_employees") ? "YES — BUG" : "NO"}`);
  line(`  prohibited capabilities include : ${JSON.stringify(
    plan.prohibited.filter((p) =>
      ["founder_discovery", "employer_verification", "contact_enrichment"].includes(p)))}`);
  line();
}

rule("═");
line("SUMMARY — no Actor was started, no model was called, no database was read.");
rule("═");
