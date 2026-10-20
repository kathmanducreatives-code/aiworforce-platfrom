// deno-lint-ignore-file no-import-prefix no-explicit-any require-await
// Audit adapters inject EXTERNAL model/provider responses only. No DB or network.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
type Json = Record<string, any>;
const root = new URL(
  (Deno.env.get("ROUTING_AUDIT_SOURCE_ROOT") ??
    new URL("../../../", import.meta.url).pathname).replace(/\/?$/, "/"),
  "file:///",
);
const mod = (name: string): Promise<any> =>
  import(new URL(`supabase/functions/_shared/${name}.ts`, root).href);
const [
  compiler,
  criteriaApi,
  graphApi,
  executionApi,
  discoveryApi,
  readinessApi,
  _evidenceApi,
  executabilityApi,
  playbookApi,
  actorApi,
  supportApi,
  feasibilityApi,
  engineApi,
  evaluationApi,
  groundedApi,
  workbenchApi,
  persistApi,
  outcomeApi,
  terminalApi,
  normalizers,
] = await Promise.all([
  "leadMissionCompiler",
  "missionCriteria",
  "leadCapabilityGraph",
  "leadExecutionPlan",
  "leadDiscoveryStrategy",
  "routeReadiness",
  "leadEvidenceRegistry",
  "capabilityExecutability",
  "leadResearchPlaybooks",
  "hiringActorCatalog",
  "actorEvidenceCapability",
  "requestFeasibility",
  "leadCapabilityEngine",
  "missionEvaluation",
  "groundedClaims",
  "workbenchMissionView",
  "leadMissionPersistenceProjection",
  "runOutcome",
  "leadAutoContinuation",
  "hiringActorNormalizers",
].map(mod));
const [
  eligibilityApi,
  phaseApi,
  claimPlanApi,
  hiringVerifierApi,
  fundingVerifierApi,
  verifierApi,
  specApi,
  policyApi,
  runtimeApi,
  inputApi,
  contextApi,
  vocabularyApi,
  rolesApi,
] = await Promise.all([
  "candidateEligibility",
  "claimVerificationPhase",
  "claimPlan",
  "hiringClaimVerifier",
  "fundingStageVerifier",
  "claimVerifier",
  "verifierCallSpec",
  "criteriaExecutionPolicy",
  "leadMissionRuntime",
  "hiringActorInputs",
  "missionQualificationContext",
  "hiringSearchVocabulary",
  "roleFamilies",
].map(mod));
const testedCommit = Deno.env.get("ROUTING_AUDIT_COMMIT") ??
  "e0a5daefa6b9ddfdca43aaa0fdcceffe9f7d7f61";
const ago = (days: number) =>
  new Date(Date.now() - days * 86400000).toISOString();
const key = "https://www.linkedin.com/company/routing-example";
const baseCompany = {
  id: "routing-example",
  name: "Routing Example",
  linkedinUrl: key,
  website: "https://routing.example",
  description:
    "We build sales software for revenue teams at mid-size companies.",
  employeeCount: 30,
  employeeCountRange: { start: 11, end: 50 },
  industries: ["Software Development"],
  locations: [{
    country: "United States",
    city: "Boston",
    isHeadquarter: true,
  }],
};
const probe = JSON.parse(
  Deno.readTextFileSync(
    new URL("tests/fixtures/lead-v2/p3-job-discovery-probe.json", root),
  ),
);
const vendorJobBase = probe.probes["harvestapi~linkedin-job-search"].items[0];
interface Scenario {
  id: string;
  request: string;
  signal?: string[];
  capabilities?: string[];
  strategies?: string[];
  variant?: string;
  expectedQualified?: number;
  expect?: string;
  first?: boolean;
  proposal?: Json;
  comment?: Json;
}
const comments = (
  text: string,
  headline = "Founder at Routing Example",
  date = ago(2),
) => ({
  type: "comment",
  id: "synthetic-comment",
  postId: "synthetic-parent",
  linkedinUrl: "https://www.linkedin.com/feed/update/comment/synthetic",
  commentary: text,
  createdAt: date,
  scrapedAt: ago(0),
  actor: {
    id: "synthetic-person",
    name: "Alex Fixture",
    linkedinUrl: "https://www.linkedin.com/in/alex-fixture",
    position: headline,
  },
  query: { post: "https://www.linkedin.com/posts/synthetic-parent" },
});
export const scenarios: Scenario[] = [
  {
    id: "L01",
    request:
      "Find founders commenting on LinkedIn about problems with outbound sales in the last 30 days.",
    signal: ["founders commenting about outbound sales problems"],
    capabilities: ["offer_founder_unlock"],
    comment: comments(
      "Our outbound emails receive no replies. We need help fixing our pipeline.",
    ),
  },
  {
    id: "L02",
    request:
      "Find founders explicitly searching for a CRM in LinkedIn comments within the last 30 days.",
    signal: ["founders commenting about searching for a CRM"],
    capabilities: ["offer_founder_unlock"],
    comment: comments("We are looking for a new CRM. Any recommendations?"),
  },
  {
    id: "L03",
    request:
      "Find founders discussing hiring agencies in LinkedIn comments within the last 30 days.",
    signal: ["founder comments about hiring agencies"],
    capabilities: ["offer_founder_unlock"],
    comment: comments(
      "Can anyone recommend an agency to hire our first sales rep?",
    ),
  },
  {
    id: "L04",
    request:
      "Find founders who must be looking for new sales tools in their LinkedIn comments.",
    signal: ["founder comments about sales tools"],
    capabilities: ["offer_founder_unlock"],
    comment: comments("We're not looking for new tools."),
  },
  {
    id: "L05",
    request:
      "Find companies whose founders must be asking for a CRM in LinkedIn comments.",
    signal: ["founder comments asking for CRM"],
    capabilities: ["general_company_discovery", "offer_founder_unlock"],
    comment: comments("We need a CRM", "Sales employee at Routing Example"),
  },
  {
    id: "L06",
    request:
      "Find founders who commented about outbound problems within the last 7 days.",
    signal: ["founder comments about outbound problems"],
    capabilities: ["offer_founder_unlock"],
    comment: comments(
      "Our outbound is broken",
      undefined,
      "2020-01-01T00:00:00Z",
    ),
  },
  {
    id: "L07",
    request:
      "Find founders commenting about outbound sales problems on LinkedIn.",
    signal: ["founder comments on outbound sales"],
    capabilities: ["offer_founder_unlock"],
    variant: "unavailable_social",
  },
  {
    id: "L08",
    request:
      "Find 1 B2B software company whose founder must have commented about outbound problems, and which must be hiring Account Executives.",
    signal: [
      "founder comments on outbound problems",
      "hiring Account Executives",
    ],
    capabilities: [
      "general_company_discovery",
      "embedded_hiring_evidence",
      "offer_founder_unlock",
    ],
    strategies: ["hiring", "multi_signal"],
    expectedQualified: 0,
  },
  {
    id: "L09",
    request:
      "Find 1 B2B software company whose founder must be posting about CRM buying on LinkedIn.",
    signal: ["founder posts about CRM buying"],
    capabilities: ["general_company_discovery", "offer_founder_unlock"],
    expectedQualified: 0,
  },
  {
    id: "H01",
    request:
      "Find 1 B2B software company hiring Account Executives within the last 30 days.",
    signal: ["hiring Account Executives"],
    expectedQualified: 1,
  },
  {
    id: "H02",
    request:
      "Find 1 B2B software company that must be hiring its first sales representative within the last 30 days.",
    signal: ["hiring first sales representative"],
    first: true,
    expectedQualified: 1,
  },
  {
    id: "H03",
    request:
      "Find 1 B2B software company that must be hiring its first sales representative within the last 30 days.",
    signal: ["hiring first sales representative"],
    variant: "ordinary_sales",
    expectedQualified: 0,
  },
  {
    id: "H04",
    request:
      "Find 1 B2B software company that must be rapidly expanding its sales team within the last 30 days.",
    signal: ["rapidly expanding sales team"],
    variant: "single_snapshot",
    expectedQualified: 0,
  },
  {
    id: "H05",
    request:
      "Find 1 recruiting agency hiring its own Account Executives within the last 30 days.",
    signal: ["hiring Account Executives"],
    variant: "agency_own",
    expectedQualified: 1,
  },
  {
    id: "H06",
    request:
      "Find 1 recruiting agency hiring its own Account Executives within the last 30 days.",
    signal: ["hiring Account Executives"],
    variant: "agency_client",
    expectedQualified: 0,
  },
  {
    id: "H07",
    request:
      "Find 1 B2B software company hiring Account Executives within the last 30 days.",
    signal: ["hiring Account Executives"],
    variant: "stale",
    expectedQualified: 0,
  },
  {
    id: "H08",
    request:
      "Find 1 B2B software company hiring Account Executives within the last 30 days.",
    signal: ["hiring Account Executives"],
    variant: "closed",
    expectedQualified: 0,
  },
  {
    id: "H09",
    request:
      "Find 1 B2B software company hiring Account Executives within the last 30 days.",
    signal: ["hiring Account Executives"],
    variant: "duplicate",
    expectedQualified: 1,
  },
  {
    id: "H10",
    request:
      "Find 1 B2B software company hiring only Account Executives within the last 30 days. Do not broaden the role.",
    signal: ["hiring Account Executives"],
    variant: "sdr",
    expectedQualified: 0,
    proposal: { disallowed_broadening: ["role"] },
  },
  {
    id: "C01",
    request:
      "Find 1 B2B software company that must be hiring Account Executives AND whose founder must have discussed outbound problems on LinkedIn.",
    signal: [
      "hiring Account Executives",
      "founder comments about outbound problems",
    ],
    capabilities: [
      "general_company_discovery",
      "embedded_hiring_evidence",
      "offer_founder_unlock",
    ],
    strategies: ["hiring", "multi_signal"],
    expectedQualified: 0,
  },
  {
    id: "C02",
    request:
      "Find 1 B2B software company hiring Account Executives OR having raised funding in the last 90 days.",
    signal: ["hiring Account Executives", "recent funding"],
    strategies: ["hiring", "funding"],
    expectedQualified: 1,
  },
  {
    id: "C03",
    request:
      "Find 1 B2B software company that must have opened a new office AND recently adopted Salesforce.",
    signal: ["opened a new office", "recently adopted Salesforce"],
    capabilities: [
      "general_company_discovery",
      "expansion_evidence",
      "technology_evidence",
    ],
    strategies: ["news", "multi_signal"],
    expectedQualified: 0,
  },
  {
    id: "C04",
    request:
      "Find 1 B2B software company hiring Account Executives in the last 7 days AND whose founder must have commented on outbound in the last 30 days.",
    signal: ["hiring Account Executives", "founder comments about outbound"],
    capabilities: [
      "general_company_discovery",
      "embedded_hiring_evidence",
      "offer_founder_unlock",
    ],
    strategies: ["hiring", "multi_signal"],
    expectedQualified: 0,
  },
  {
    id: "C05",
    request:
      "Find 1 US-headquartered B2B software company hiring Account Executives in the last 30 days.",
    signal: ["hiring Account Executives"],
    variant: "hq_conflict",
    expectedQualified: 0,
    proposal: {
      geographies: ["United States"],
      geography_is_hard: true,
      geography_scope: "headquarters",
    },
  },
  {
    id: "C06",
    request:
      "Find 1 B2B software company that must be hiring Account Executives within the last 30 days.",
    signal: ["hiring Account Executives"],
    variant: "no_jobs",
    expectedQualified: 0,
  },
  {
    id: "C07",
    request:
      "Find 1 B2B software company hiring Account Executives in the last 7 days AND having raised venture funding in the last 90 days.",
    signal: ["hiring Account Executives", "funding in the last 90 days"],
    strategies: ["hiring", "funding", "multi_signal"],
    expectedQualified: 0,
  },
  {
    id: "R01",
    request: "Find 1 B2B software company hiring Account Executives.",
    signal: ["hiring Account Executives"],
    variant: "wrong_actor",
    expectedQualified: 0,
  },
  {
    id: "R02",
    request: "Find 1 B2B software company hiring Account Executives.",
    signal: ["hiring Account Executives"],
    variant: "unsupported_step",
    expectedQualified: 0,
  },
  {
    id: "R03",
    request: "Find 1 B2B software company hiring Account Executives.",
    signal: ["hiring Account Executives"],
    variant: "overconfident",
    expectedQualified: 0,
  },
  {
    id: "R04",
    request: "Find 1 B2B software company hiring Account Executives.",
    signal: ["hiring Account Executives"],
    variant: "empty_details",
    expectedQualified: 0,
  },
  {
    id: "R05",
    request: "Find 1 B2B software company hiring Account Executives.",
    signal: ["hiring Account Executives"],
    variant: "wrong_employer",
    expectedQualified: 0,
  },
  {
    id: "R06",
    request: "Find 1 B2B software company hiring Account Executives.",
    signal: ["hiring Account Executives"],
    variant: "provider_timeout",
    expectedQualified: 0,
  },
  {
    id: "R07",
    request: "Find 1 B2B software company hiring Account Executives.",
    signal: ["hiring Account Executives"],
    variant: "provider_unavailable",
    expectedQualified: 0,
  },
  {
    id: "R08",
    request: "Find 1 B2B software company hiring Account Executives.",
    signal: ["hiring Account Executives"],
    variant: "evaluator_timeout",
    expectedQualified: 0,
  },
  {
    id: "R09",
    request: "Find 1 B2B software company hiring Account Executives.",
    signal: ["hiring Account Executives"],
    variant: "evaluator_fail",
    expectedQualified: 0,
  },
  {
    id: "R11",
    request: "Find 1 B2B software company hiring Account Executives.",
    signal: ["hiring Account Executives"],
    variant: "foreign_details",
    expectedQualified: 0,
  },
  {
    id: "R12",
    request: "Find 1 B2B software company hiring Account Executives.",
    signal: ["hiring Account Executives"],
    variant: "multiple_identities",
    expectedQualified: 1,
  },
  {
    id: "F01",
    request:
      "Find 1 B2B software company with a recent funding announcement within the last 90 days.",
    signal: ["funding in the last 90 days"],
    strategies: ["funding"],
    capabilities: ["funding_event_discovery", "company_semantic_evaluation"],
    expectedQualified: 0,
  },
  {
    id: "F02",
    request:
      "Find 1 B2B software company with a recent funding announcement within the last 90 days.",
    signal: ["funding in the last 90 days"],
    strategies: ["funding"],
    capabilities: ["funding_event_discovery", "company_semantic_evaluation"],
    variant: "funded",
  },
  {
    id: "R10",
    request: "Find 1 B2B software company hiring Account Executives.",
    signal: ["hiring Account Executives"],
    variant: "interrupted",
  },
];
const proposal = (s: Scenario) => ({
  requested_opportunity_count: 1,
  company_types: /recruiting agency/.test(s.request)
    ? ["recruiting agency"]
    : /B2B software company/.test(s.request)
    ? ["B2B software"]
    : [],
  geographies: [],
  employee_range: { min: null, max: null },
  output_intent: /Find founders/.test(s.request)
    ? "social_posts"
    : "qualified_companies",
  preferred_signals: s.signal ?? [],
  required_signal_terms: s.signal ?? [],
  required_capabilities: s.capabilities ??
    [
      "general_company_discovery",
      "embedded_hiring_evidence",
      "company_semantic_evaluation",
    ],
  strategies: s.strategies ??
    (/founder/i.test(s.request) && !/hiring Account Executives/i.test(s.request)
      ? ["social"]
      : s.signal?.some((x) => /hiring/i.test(x))
      ? ["hiring"]
      : []),
  confidence: 0.95,
  ...s.proposal,
});
const emit = (kind: string, event: Json) =>
  console.log(kind, JSON.stringify({ tested_commit: testedCommit, ...event }));

Deno.test("routing audit: complete declared capability/provider map", () => {
  const map = Object.entries(graphApi.CAPABILITY_REGISTRY).map(([id, raw]) => {
    const c = raw as Json;
    return {
      capability: id,
      declared: c,
      executable: executabilityApi.CAPABILITY_EXECUTABILITY[id],
      engine_driven: playbookApi.isEngineDriven(id),
      providers: c.providers.map((actor: string) => ({
        actor,
        catalogued: !!actorApi.hiringActorCard(actor),
        decision: readinessApi.PRODUCTION_READINESS.decide(actor, id),
        live_authorized: false,
      })),
    };
  });
  emit("ROUTING_CAPABILITY_MAP", {
    map,
    actor_evidence: supportApi.ACTOR_EVIDENCE,
  });
  assert(map.length > 10);
  emit("ROUTING_PROVIDER_ONLY", {
    post_search: actorApi.hiringActorCard("apify_linkedin_post_search"),
    social_readiness: readinessApi.PRODUCTION_READINESS.decide(
      "apify_linkedin_post_search",
      "social_discovery",
    ),
    proposed_a7_catalog: JSON.parse(
      Deno.readTextFileSync(
        new URL("docs/launch/proposals/smoke-catalog-two-actor.json", root),
      ),
    ),
    live_authorized: false,
  });
});
for (const scenario of scenarios) {
  Deno.test(`routing compile ${scenario.id}: ${scenario.request}`, () => {
    const compiled = compiler.compileLeadMission({
      originalUserQuery: scenario.request,
      proposal: proposal(scenario),
    });
    const mission = compiled.final_mission;
    const graph = graphApi.buildCapabilityGraph(mission, {
      executability: "enforce",
    });
    const criteria = criteriaApi.deriveMissionCriteria(mission);
    const feasibility = feasibilityApi.assessRequestFeasibility(
      mission,
      graph,
      { executability: "enforce" },
    );
    let deterministic: Json;
    try {
      deterministic = {
        mission: compiler.compileLeadMission({
          originalUserQuery: scenario.request,
          proposal: null,
        }).final_mission,
      };
    } catch (e) {
      deterministic = {
        status: "BLOCKED",
        error: String(e),
        no_fallback: true,
      };
    }
    const comment = scenario.comment
      ? normalizers.normalizeSocialComment(
        scenario.comment,
        "apify_linkedin_post_search",
      )
      : null;
    emit("ROUTING_COMPILE", {
      id: scenario.id,
      original_request: scenario.request,
      mock_proposal: proposal(scenario),
      no_model_proposal_control: deterministic,
      mission,
      compiled_criteria: criteria,
      graph,
      feasibility,
      playbooks: playbookApi.selectResearchPlaybooks(mission),
      proposed_comment_not_collected: comment,
      comment_transport:
        "NOT EXECUTED: normalizer-only fixture, not a comment retrieval route",
      diagnostic_only: true,
    });
    assert(Array.isArray(graph.steps));
  });
}

function plannedSteps(graph: Json, scenario: Scenario): Json[] {
  const entry = graph.entry_capability;
  const hiringTitle = scenario.first || scenario.variant === "ordinary_sales"
    ? "Sales Representative"
    : "Account Executive";
  const producer = entry === "job_discovery"
    ? {
      capability: entry,
      actor_key: scenario.variant === "wrong_actor"
        ? "apify_linkedin_post_search"
        : "apify_linkedin_job_search",
      purpose:
        "mock planner chooses employer discovery for the customer's open role",
      input: { jobTitles: [hiringTitle], maxItems: 3, postedLimit: "month" },
      depends_on: [],
    }
    : {
      capability: entry,
      actor_key: "apify_linkedin_company_search",
      purpose:
        "mock planner chooses structured software-company profile discovery; no unsupported signal is claimed proven",
      input: { industryIds: ["4"], scraperMode: "full", maxItems: 1 },
      depends_on: [],
    };
  if (scenario.variant === "unsupported_step") {
    return [{
      ...producer,
      capability: "linkedin_comment_discovery",
      actor_key: "apify_linkedin_post_search",
    }];
  }
  const steps: Json[] = [producer];
  for (
    const cap of [
      "job_deduplication",
      "company_identity_resolution",
      "company_enrichment",
      "hiring_verification",
      "expansion_signal_verification",
      "product_launch_verification",
      "company_post_verification",
      "technology_verification",
      "company_brain_qualification",
      "persistence",
    ]
  ) {
    const step = graph.steps.find((x: Json) => x.capability === cap);
    if (!step) continue;
    steps.push({
      capability: cap,
      actor_key: cap === "company_identity_resolution"
        ? "apify_linkedin_company_search"
        : cap === "company_enrichment"
        ? "apify_linkedin_company_details"
        : cap === "hiring_verification"
        ? "apify_linkedin_job_search"
        : cap.endsWith("signal_verification") ||
            cap === "product_launch_verification"
        ? "apify_google_news"
        : null,
      purpose: step.reason,
      input: cap === "company_enrichment" ? { companies: [key] } : {},
      depends_on: [steps.length],
    });
  }
  return steps;
}
function vendorRows(s: Scenario) {
  const co = { ...structuredClone(baseCompany) };
  if (/agency_/.test(s.variant ?? "")) {
    Object.assign(co, {
      name: "Routing Recruiting",
      industries: ["Staffing and Recruiting"],
      description:
        "We recruit staff for business customers and are hiring our own internal Account Executive.",
    });
  }
  const title = s.first || s.variant === "ordinary_sales"
    ? "Sales Representative"
    : s.variant === "sdr"
    ? "Sales Development Representative"
    : "Account Executive";
  const job = {
    ...structuredClone(vendorJobBase),
    id: "synthetic-job",
    title,
    company: co,
    jobState: "LISTED",
    closedAt: null,
    postedDate: ago(s.variant === "stale" ? 65 : 2),
    expireAt: ago(-30),
    linkedinUrl: "https://www.linkedin.com/jobs/view/synthetic-job",
    descriptionText: s.first
      ? "You will be our first sales hire, building the sales function from scratch."
      : `${co.name} is hiring an internal ${title} to sell our software to business teams.`,
  };
  if (s.variant === "closed") {
    Object.assign(job, { jobState: "CLOSED", closedAt: ago(1) });
  }
  if (s.variant === "agency_client") {
    job.descriptionText =
      "On behalf of our client we are hiring an Account Executive.";
  }
  if (s.variant === "wrong_employer") {
    Object.assign(job, {
      companyLinkedinUrl: "https://www.linkedin.com/company/foreign-employer",
      descriptionText:
        "Employer: Foreign Employer\nWe are hiring an Account Executive.",
    });
  }
  return {
    company: co,
    jobs: s.variant === "no_jobs"
      ? []
      : s.variant === "duplicate"
      ? [job, structuredClone(job), {
        ...job,
        id: "synthetic-job-2",
        linkedinUrl: "https://www.linkedin.com/jobs/view/synthetic-job-2",
      }]
      : [job],
  };
}
function evaluatorRaw(input: Json, registry: Json, s: Scenario) {
  const desc = registry.items.find((x: Json) =>
    x.evidence_type === "company_description"
  );
  const job = registry.items.find((x: Json) =>
    x.evidence_type === "job_posting"
  );
  const loc = registry.items.find((x: Json) =>
    x.evidence_type === "company_location"
  );
  const byDim = (dim: string) =>
    dim === "hiring"
      ? job
      : dim === "industry" || dim === "business_model"
      ? desc
      : dim === "geography"
      ? loc
      : null;
  const cite = (e: Json | undefined) =>
    e ? [{ evidence_id: e.evidence_id, excerpt: e.source_text }] : [];
  const criteria = input.mission.criteria ?? [];
  return {
    mission_fit: s.variant === "evaluator_fail" ? "fail" : "pass",
    hiring_fit: job ? "verified" : "absent",
    confidence: 0.99,
    match_score: 99,
    reasoning:
      "Synthetic evaluator: known receipts PASS; missing social/funding/technology proof UNKNOWN. Aggregate deliberately optimistic to test enforcement.",
    matched_requirements: desc
      ? [{ requirement: "B2B software", ...cite(desc)[0] }]
      : [],
    failed_requirements: s.variant === "evaluator_fail"
      ? [{
        requirement: "customer condition",
        evidence_id: desc?.evidence_id,
        why: "model says excluded",
      }]
      : [],
    unknown_fields: criteria.filter((c: Json) => !byDim(c.dimension)).map((
      c: Json,
    ) => c.id),
    criterion_verdicts: criteria.map((c: Json) => ({
      criterion_id: c.id,
      result: byDim(c.dimension) ? "pass" : "unknown",
      geography_scope: c.dimension === "geography" ? "headquarters" : undefined,
      reason: byDim(c.dimension)
        ? "mock model interprets the supplied source"
        : "required source not supplied",
      evidence: s.variant === "overconfident"
        ? [{ evidence_id: "invented-id", excerpt: "fabricated buying signal" }]
        : cite(byDim(c.dimension)),
    })),
  };
}
for (const s of scenarios) {
  Deno.test(`routing execution ${s.id}`, async () => {
    const mission = compiler.compileLeadMission({
      originalUserQuery: s.request,
      proposal: proposal(s),
    }).final_mission;
    const policy = s.variant === "provider_unavailable"
      ? readinessApi.readinessPolicy({
        unavailable: (actor: string) => actor === "apify_linkedin_job_search",
      })
      : readinessApi.PRODUCTION_READINESS;
    const graph = graphApi.buildCapabilityGraph(mission, {
      executability: "enforce",
      readiness: policy,
    });
    const criteria = criteriaApi.deriveMissionCriteria(mission, policy);
    const feasibility = feasibilityApi.assessRequestFeasibility(
      mission,
      graph,
      { executability: "enforce", readiness: policy },
    );
    const steps = plannedSteps(graph, s);
    const validation = executionApi.validateExecutionPlan(
      steps,
      mission,
      graph,
      { readiness: policy },
    );
    const discoverySelection = discoveryApi.validateDiscoveryStrategy([{
      actor_key: graph.entry_capability === "job_discovery"
        ? "apify_linkedin_job_search"
        : "apify_linkedin_company_search",
      role: "primary",
      input: steps[0]?.input ?? {},
      rationale:
        "synthetic external selector proposes the graph entry's provider",
    }], mission);
    const shell: Json = {
      id: s.id,
      original_request: s.request,
      compiled_criteria: criteria,
      mandatory_signals: criteria.filter((c: Json) => c.kind === "hard"),
      required_signals: mission.required_signals,
      graph,
      feasibility,
      selected_capability: graph.entry_capability,
      capability_reason: graph.routing_reason,
      mock_execution_proposal: steps,
      execution_validation: validation,
      discovery_selection_validation: discoverySelection,
      provider_approval: validation.steps.map((x: Json) => ({
        capability: x.capability,
        actor: x.actor_key,
        internal_route: policy.decide(x.actor_key, x.capability),
        live_authorized: false,
      })),
      expected: {
        qualified: s.expectedQualified ?? null,
        intent: s.expect ?? s.request,
      },
      collected_evidence: [],
      evaluator: [],
      canonical: [],
      customer_result: null,
      status: "NOT TESTED",
      runtime_network: "denied",
      database_writes: "not executed",
    };
    if (!feasibility.ok) {
      shell.status = s.variant === "provider_unavailable"
        ? "BLOCKED"
        : "NOT SUPPORTED";
      shell.actual = {
        reason: "real feasibility refusal; provider invocation not reached",
        refusals: feasibility.refusals,
      };
      shell.customer_result = {
        boundary: "real feasibility output; no executed final mission notice",
        declared_gaps: feasibility.declared_gaps,
        refusals: feasibility.refusals,
      };
      emit("ROUTING_TRACE", shell);
      return;
    }
    const vendor = vendorRows(s);
    const providerCalls: Json[] = [];
    const evaluations: Json[] = [];
    const logs: Json[] = [];
    let plannerCalls = 0;
    let batchCalls = 0;
    let evaluatorCalls = 0;
    let interruptOnce = s.variant === "interrupted";
    const deps: Json = {
      planDiscovery: async () => discoverySelection.selections,
      planExecution: async () => {
        plannerCalls++;
        return {
          reasoning: "mock external planner uses real graph-contained stages",
          steps,
        };
      },
      controlRoutes: async () => ({ action: "continue" }),
      invoke: async (call: Json) => {
        const event: Json = {
          actor: call.actorKey,
          input: call.input,
          source: "synthetic vendor",
          observed_at: ago(0),
          compiled_spec: call.providerCallSpec ?? null,
          response: null,
        };
        providerCalls.push(event);
        if (
          s.variant === "provider_timeout" &&
          call.actorKey === "apify_linkedin_job_search"
        ) {
          event.error = "synthetic TimeoutError";
          throw new DOMException("mock provider timeout", "TimeoutError");
        }
        if (
          interruptOnce && call.actorKey === "apify_linkedin_company_details"
        ) {
          interruptOnce = false;
          event.error = "synthetic interruption before details answer";
          throw new DOMException("mock slice interrupted", "AbortError");
        }
        call.onProviderRun?.({
          run_id: `offline-routing-${providerCalls.length}`,
          dataset_id: null,
        });
        if (call.actorKey === "apify_linkedin_job_search") {
          event.response = vendor.jobs;
        } else if (call.actorKey === "apify_linkedin_company_search") {
          event.response = [vendor.company];
        } else if (call.actorKey === "apify_linkedin_company_details") {
          event.response = s.variant === "empty_details"
            ? []
            : s.variant === "foreign_details"
            ? [{
              ...vendor.company,
              id: "foreign",
              linkedinUrl: "https://www.linkedin.com/company/foreign-employer",
              website: "https://foreign.example",
            }]
            : s.variant === "multiple_identities"
            ? [{
              ...vendor.company,
              id: "foreign",
              linkedinUrl: "https://www.linkedin.com/company/foreign-employer",
              website: "https://foreign.example",
            }, vendor.company]
            : s.variant === "hq_conflict"
            ? [{
              ...vendor.company,
              locations: [{
                country: "Canada",
                city: "Toronto",
                isHeadquarter: true,
              }],
            }]
            : [vendor.company];
        } else if (call.actorKey === "apify_funding_atomus") {
          event.response = [{
            input: key,
            status: "success",
            summary: {
              linkedin_url: key,
              domain: "routing.example",
              last_updated: ago(0),
            },
            company: {
              financial: {
                funding: {
                  num_funding_rounds: s.variant === "funded" ? 1 : 0,
                  rounds: s.variant === "funded"
                    ? [{
                      type: "Seed",
                      announced_at: ago(15).slice(0, 10),
                      raised_amount: 3000000,
                      investors: ["Synthetic Fund"],
                    }]
                    : [],
                },
              },
            },
          }];
        } else if (call.actorKey === "apify_funding_pvalyou") {
          event.response = s.variant === "funded"
            ? [{
              query: "routing.example",
              status: "active",
              domain: "routing.example",
              record_as_of: ago(0),
              record: {
                funding: {
                  rounds_count: 1,
                  rounds: [{
                    round_index: 1,
                    round_type: "Seed",
                    round_date: ago(15).slice(0, 10),
                    round_date_precision: "day",
                    round_amount_m_usd: 3,
                    is_non_equity: false,
                    source_urls: ["https://news.example/routing-seed"],
                    investors: [{ name: "Synthetic Fund" }],
                  }],
                },
              },
            }]
            : [];
        } else throw new Error(`AUDIT: unexpected provider ${call.actorKey}`);
        return event.response;
      },
      evaluateBatch: async (batch: Json[]) => {
        batchCalls++;
        return {
          version: "fixture",
          evaluated: batch.length,
          failed: 0,
          foreign_results: [],
          outcomes: batch.map((m: Json) => {
            const desc = m.registry.items.find((e: Json) =>
              e.evidence_type === "company_description"
            );
            const raw = {
              business_model: { value: "b2b_software", confidence: 0.95 },
              decision: "pass",
              confidence: 0.95,
              supporting_claims: desc
                ? [{
                  claim: "sells software to business teams",
                  claim_type: "business_model",
                  evidence_ids: [desc.evidence_id],
                  evidence_excerpts: [{
                    evidence_id: desc.evidence_id,
                    excerpt: desc.source_text,
                  }],
                }]
                : [],
            };
            const verification = groundedApi.verifyGroundedResult({
              registry: m.registry,
              result: groundedApi.parseGroundedResult(raw),
            });
            return {
              company_key: m.company_key,
              verification,
              failure: null,
              detail: null,
            };
          }),
        };
      },
      evaluateMission: async (i: Json) => {
        evaluatorCalls++;
        if (s.variant === "evaluator_timeout") {
          evaluations.push({
            company_key: i.company_key,
            raw: null,
            parsed: null,
            external_status:
              "synthetic evaluator timeout -> binding returns null",
          });
          return null;
        }
        const raw = evaluatorRaw(i.input, i.registry, s);
        const parsed = evaluationApi.parseMissionEvaluationStrict(
          raw,
          i.registry,
          criteria,
        );
        evaluations.push({
          company_key: i.company_key,
          input: { mission: i.input.mission, company_key: i.company_key },
          registry: i.registry,
          raw,
          parsed,
        });
        return parsed;
      },
      log: (event: string, data: Json) => logs.push({ event, data }),
    };
    const opts: Json = {
      mission,
      plan: graph,
      maxCandidates: 1,
      readEnv: (k: string) =>
        k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined,
      readiness: policy,
      specMode: "enforce",
      specScope: { workspace_id: "routing-audit", lineage_id: s.id },
      identity: { task_id: s.id, workspace_id: "routing-audit" },
      log: deps.log,
    };
    try {
      const run = await engineApi.runCapabilityPlan(deps, opts);
      const criteriaAfter = criteriaApi.deriveMissionCriteria(mission, policy);
      const hiringCriterion = criteriaAfter.find((c: Json) =>
        c.dimension === "hiring" && c.kind === "hard" && c.status === "ok"
      );
      const vocab = contextApi.buildQualificationContext(mission, {
        criteriaAuthority: true,
      }).role_vocabulary;
      const families = hiringCriterion?.value?.qualifier?.role_families ?? [];
      const hiringVerifier = hiringCriterion
        ? hiringVerifierApi.hiringClaimVerifier({
          titles: vocabularyApi.hiringSearchTitles(vocab),
          role_families: families,
          window_days: hiringCriterion.time_window?.days ?? null,
          matchesRole: (title: string) =>
            families.length
              ? families.some((f: string) =>
                rolesApi.roleMatchesFamily(title, f)
              )
              : vocab.required_titles.some((t: string) =>
                title.toLowerCase().includes(t.toLowerCase())
              ),
        })
        : null;
      // Mirrors run-agent's current caller contract: graph eligibility WITHOUT evaluator verdicts.
      // This is recorded, not patched; the canonical decision below still uses the real engine.
      const phaseCandidates = () =>
        engineApi.missionCandidatesFrom(run).map((c: Json) => {
          const e = eligibilityApi.evaluateEligibility(criteriaAfter, c.graph);
          return {
            ...c,
            eligibility: e.eligibility,
            hard_checks: e.checks.filter((x: Json) => x.kind === "hard"),
          };
        });
      const phaseReport = await phaseApi.runClaimVerificationPhase({
        mission_id: s.id,
        claim_plan: claimPlanApi.buildClaimPlan(
          criteriaAfter,
          graph.entry_capability,
          policy,
        ),
        requested_count: 1,
        candidates: phaseCandidates,
        qualified: () =>
          engineApi.canonicalQualifiedKeys(run.companies, opts).length,
        criteriaValue: (id: string) =>
          criteriaAfter.find((c: Json) => c.id === id)?.value,
        criteriaWindow: (id: string) =>
          criteriaAfter.find((c: Json) => c.id === id)?.time_window?.days ??
            null,
        verifiers: [
          fundingVerifierApi.fundingStageVerifier(),
          ...(hiringVerifier ? [hiringVerifier] : []),
        ],
        readiness: policy,
        pending: run.state.verifier_pending_runs ?? [],
        deps: {
          now: () => new Date().toISOString(),
          log: deps.log,
          call: verifierApi.ledgerBoundCall({
            ledger: run.state.spend_ledger,
            spec: specApi.verifierSpecCompiler({
              scope: opts.specScope,
              mission_hash: run.state.mission_hash ?? "routing-audit",
              policy: policyApi.criteriaExecutionPolicy(mission),
              ceilings: () => run.state.spend_ledger.ceilings,
              readiness: policy,
            }),
            actorIdFor: (actor: string) =>
              actorApi.hiringActorCard(actor)?.actor_id ?? null,
            invoke: runtimeApi.guardedInvoker(
              null,
              deps.invoke,
              undefined,
              policy,
            ),
            hash: inputApi.hashInput,
          }),
        },
        apply: (finding: Json, verifier: Json) => {
          const c = run.companies.find((c: Json) =>
            c.key === finding.company_key
          );
          return c
            ? engineApi.applyVerifierFinding(c, finding, verifier)
            : false;
        },
      });
      run.state.verifier_pending_runs = phaseReport.pending;
      shell.claim_verification_phase = phaseReport;
      shell.fact_only_eligibility_after_phase = phaseCandidates().map((
        c: Json,
      ) => ({
        company_key: c.company_key,
        eligibility: c.eligibility,
        hard_checks: c.hard_checks,
      }));
      const decisions = engineApi.canonicalDecisions(run.companies, opts);
      const keys = engineApi.canonicalQualifiedKeys(run.companies, opts);
      const candidates = engineApi.missionCandidatesFrom(run);
      const view = workbenchApi.buildWorkbenchMissionView({
        mission: {
          requested_count: 1,
          execution_limit: 1,
          anchor: graph.entry_capability === "job_discovery" ? "hiring" : null,
        },
        criteria,
        candidates,
        stage: "complete",
        unsupported: feasibility.declared_gaps,
      });
      const summary = workbenchApi.decisionSummary(view.counts);
      const persisted = persistApi.projectMissionCompanyRows(
        run.companies,
        "routing-audit",
        "company",
        decisions,
      );
      const snap = engineApi.checkpointSnapshot(run.state, run.companies);
      const beforeResume = {
        providers: providerCalls.length,
        planners: plannerCalls,
        batches: batchCalls,
        evaluators: evaluatorCalls,
      };
      const resumed = await engineApi.runCapabilityPlan({
        ...deps,
        restoredGroundedResults: new Map(
          run.companies.filter((c: Json) => c.grounded).map((
            c: Json,
          ) => [c.key, c.grounded]),
        ),
      }, {
        ...opts,
        state: JSON.parse(JSON.stringify(snap.state)),
        resume: {
          workspace_id: "routing-audit",
          lineage_root_task_id: s.id,
          records: JSON.parse(JSON.stringify(snap.resume_records)),
        },
      });
      const afterResumeKeys = engineApi.canonicalQualifiedKeys(
        resumed.companies,
        opts,
      );
      const facts = outcomeApi.readFactsFromResult({
        workbench_mission_view: view,
        lead_library_persistence: { persisted: 0 },
      }, 1);
      const outcome = outcomeApi.buildRunOutcome(facts);
      const terminal = terminalApi.settleV2Outcome({
        continuing: false,
        stopReason: summary.qualified ? "quota_met" : "frontier_exhausted",
        legacyStatus: "search_exhausted",
        legacyQuota: { eligible_leads: 0, requested_leads: 1 },
        canonicalQualified: summary.qualified,
        requestedCount: 1,
        companyIsDeliverable: true,
      });
      Object.assign(shell, {
        research_steps: providerCalls,
        collected_evidence: run.companies.map((c: Json) => ({
          company_key: c.key,
          observations: c.observations,
          registry: c.evidence_registry,
          identity: c.identity,
          hiring_assessment: c.hiring_assessment,
          first_in_function: c.first_in_function,
        })),
        evaluator: evaluations,
        canonical: [...decisions.values()],
        actual: {
          qualified: keys.length,
          keys,
          company_count: run.companies.length,
        },
        customer_result: {
          boundary:
            "real Workbench, persistence PLAN, notice and terminal reducers; no DB writer or hosted task",
          workbench: view,
          persistence_plans: persisted.rows,
          final_notice: outcomeApi.renderRunOutcome(outcome),
          outcome,
          terminal,
        },
        execution_state: {
          terminal_reason: run.state.terminal_reason,
          completed_capabilities: run.state.completed_capabilities,
          execution_plan: run.state.execution_plan,
          capability_outcomes: run.capability_outcomes,
        },
        resume: {
          coherent: snap.coherent,
          before: beforeResume,
          after: {
            providers: providerCalls.length,
            planners: plannerCalls,
            batches: batchCalls,
            evaluators: evaluatorCalls,
          },
          keys: afterResumeKeys,
          runtime_state: resumed.state.terminal_reason,
        },
        runtime_logs: logs,
        status: s.expectedQualified === undefined
          ? "NOT TESTED"
          : keys.length === s.expectedQualified
          ? "PASS"
          : "FAIL",
      });
      if (
        validation.source === "blocked" || s.variant === "provider_unavailable"
      ) shell.status = keys.length === 0 ? "BLOCKED" : "FAIL";
      if (["H01", "H02", "H09", "R12"].includes(s.id)) {
        assertEquals(keys.length, 1, `${s.id} positive control must work`);
      }
      if (
        ["H06", "H07", "H08", "C05", "C06", "R05", "R06"].includes(s.id)
      ) {
        assertEquals(keys.length, 0, `${s.id} negative control must hold`);
      }
      assertEquals(
        summary.qualified,
        keys.length,
        "Workbench/canonical counts must agree",
      );
      assertEquals(
        persisted.rows.length,
        keys.length,
        "real persistence plan must match canonical count",
      );
      assertEquals(
        outcome.qualification.qualified,
        keys.length,
        "notice qualification count must match canonical count",
      );
      assertEquals(
        terminal.delivered,
        keys.length,
        "terminal delivery count must match canonical count",
      );
      assert(
        !providerCalls.some((x) => /post|comment|builtwith/.test(x.actor)),
        "no fake execution of unimplemented social/technology route",
      );
      assert(
        plannerCalls <= 4 && evaluatorCalls <= 2 && providerCalls.length <= 8,
        "offline scenario must stay finite across two slices",
      );
      if (s.variant !== "interrupted") {
        assertEquals(
          afterResumeKeys,
          keys,
          "completed snapshot cannot promote/drop a result",
        );
      }
      if (
        Deno.env.get("ROUTING_ASSERT_EXPECTATIONS") === "1" &&
        s.expectedQualified !== undefined
      ) {
        assertEquals(
          keys.length,
          s.expectedQualified,
          `${s.id} customer semantics`,
        );
      }
    } catch (e) {
      shell.status = validation.source === "blocked" &&
          String(e).includes("ExecutionPlanBlockedError")
        ? "BLOCKED"
        : "FAIL";
      shell.error = String(e);
      if (shell.status === "BLOCKED") {
        shell.actual = {
          qualified: 0,
          reason:
            "execution validator refused the proposed plan; no substitute provider ran",
        };
        shell.customer_result = {
          boundary: "engine refusal, HTTP/UI presentation not executed",
          message: String(e),
        };
      }
      shell.research_steps = providerCalls;
      shell.evaluator = evaluations;
      shell.runtime_logs = logs;
      if (shell.status === "FAIL") throw e;
    } finally {
      emit("ROUTING_TRACE", shell);
    }
  });
}

for (const id of ["C01", "C04", "H04", "C02"]) {
  Deno.test(`routing semantic contract ${id} (opt-in red proof)`, () => {
    const check = (name: string, actual: unknown, expected: unknown) => {
      emit("ROUTING_SEMANTIC_ASSERTION", {
        id,
        name,
        actual,
        expected,
        status: JSON.stringify(actual) === JSON.stringify(expected)
          ? "PASS"
          : "FAIL",
      });
      if (Deno.env.get("ROUTING_ASSERT_EXPECTATIONS") === "1") {
        assertEquals(actual, expected, name);
      }
    };
    const s = scenarios.find((s) => s.id === id)!;
    const mission = compiler.compileLeadMission({
      originalUserQuery: s.request,
      proposal: proposal(s),
    }).final_mission;
    const criteria = criteriaApi.deriveMissionCriteria(mission);
    if (id === "C01") {
      check(
        "mandatory founder discussion",
        criteria.find((c: Json) => c.dimension === "social_activity")?.kind,
        "hard",
      );
    }
    if (id === "C04") {
      check("separate 7-day hiring / 30-day social windows", [
        criteria.find((c: Json) => c.dimension === "hiring")?.time_window?.days,
        criteria.find((c: Json) => c.dimension === "social_activity")
          ?.time_window?.days,
      ], [7, 30]);
    }
    if (id === "H04") {
      check(
        "sales-team growth is not geographic expansion",
        mission.required_signals.some((x: Json) =>
          x.type === "headcount_change" || x.type === "headcount_growth"
        ),
        true,
      );
    }
    if (id === "C02") {
      check(
        "cross-signal OR represented as alternatives",
        criteria.filter((c: Json) =>
          ["hiring", "funding"].includes(c.dimension)
        ).some((c: Json) => c.any_of?.length > 1),
        true,
      );
    }
  });
}
