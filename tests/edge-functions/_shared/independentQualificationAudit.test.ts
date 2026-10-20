// deno-lint-ignore-file no-import-prefix
// Follow the repository test import style; external stand-ins implement async contracts.
// Independent audit of exact PR #113. No model, provider or database transport.
// AUDIT_ASSERT_GAPS=1 turns observed defects into deterministic failing tests.
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mergeReevaluation,
  parseMissionEvaluationStrict,
} from "../../../supabase/functions/_shared/missionEvaluation.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { normalizeLinkedInCompanyEnriched } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import {
  entityHintFromCompany,
  type EvidenceItem,
  observationFromCompany,
  observationFromWebClaim,
} from "../../../supabase/functions/_shared/candidateObservation.ts";
import {
  buildCompanyEvidenceGraph,
  evidenceFromRegistry,
} from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import {
  buildWorkbenchMissionView,
  candidateDecision,
  type MissionCandidate,
} from "../../../supabase/functions/_shared/workbenchMissionView.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  deriveMissionCriteria,
  type MissionCriterion,
} from "../../../supabase/functions/_shared/missionCriteria.ts";

const NOW = new Date("2026-10-20T00:00:00Z");
const DESCRIPTION =
  "Example builds software for revenue teams at business customers.";
const source = {
  provider: "fixture",
  actor: "fixture",
  provider_call_id: null,
  url: "https://example.invalid",
  excerpt: DESCRIPTION,
};
const criterion = (
  dimension: MissionCriterion["dimension"],
  value: unknown,
  over: Partial<MissionCriterion> = {},
): MissionCriterion => ({
  id: `${dimension}:audit`,
  dimension,
  kind: "hard",
  value,
  label: String(value),
  source: "user_explicit",
  user_phrase: String(value),
  rationale: "customer mandatory requirement",
  status: "ok",
  ...over,
});
const fact = (
  dimension: EvidenceItem["dimension"],
  value: unknown,
  over: Partial<EvidenceItem> = {},
): EvidenceItem => ({
  evidence_id: `${dimension}:fact`,
  company_key: "co",
  dimension,
  value,
  status: "proven",
  source,
  method: "provider_field",
  observed_at: NOW.toISOString(),
  valid_until: null,
  confidence: "high",
  derived_from: [],
  mission_id: null,
  origin: "lead_mission",
  ...over,
});
const row = (country = "United States") => ({
  id: "co",
  name: "Example",
  description: DESCRIPTION,
  linkedinUrl: "https://www.linkedin.com/company/example",
  website: "https://example.invalid",
  employeeCountRange: { start: 11, end: 50 },
  locations: [{
    country,
    city: country === "Canada" ? "Toronto" : "Boston",
    isHeadquarter: true,
  }],
});
const company = normalizeLinkedInCompanyEnriched(row());
const evidence = buildCompanyEvidence({
  company_key: "co",
  company,
  source_capability: "company_enrichment",
  identity_state: "resolved",
});
function registry(
  over: Partial<Parameters<typeof buildEvidenceRegistry>[0]> = {},
) {
  return buildEvidenceRegistry({ evidence, now: NOW.getTime(), ...over });
}
const r = registry();
const description = r.items.find((x) =>
  x.evidence_type === "company_description"
)!;
const receipt = { evidence_id: description.evidence_id, excerpt: DESCRIPTION };
const business = criterion("business_model", "b2b_software");
const businessGraph = buildCompanyEvidenceGraph("co", [
  fact("business_model", "b2b_software"),
], { now: NOW });
function answer(c: MissionCriterion = business, rec = receipt) {
  return {
    mission_fit: "pass",
    hiring_fit: "verified",
    reasoning: "everything passes",
    unknown_fields: [],
    matched_requirements: [{ requirement: c.label, ...rec }],
    failed_requirements: [],
    criterion_verdicts: [{
      criterion_id: c.id,
      result: "pass",
      reason: "supported by source",
      evidence: [rec],
    }],
  };
}
function candidate(
  graph = businessGraph,
  verdicts = parseMissionEvaluationStrict(answer(), r, [business]).evaluation
    .criterion_verdicts,
): MissionCandidate {
  return {
    company_key: "co",
    name: "Example",
    domain: "example.invalid",
    linkedin_url: company.linkedin_company_url,
    found_by: [],
    screened_out: null,
    identity_resolved: true,
    investigated: true,
    graph,
    criterion_verdicts: verdicts,
  };
}
function outcome(
  criteria: MissionCriterion[],
  graph: ReturnType<typeof buildCompanyEvidenceGraph>,
  raw: unknown,
  reg = r,
) {
  const parsed = parseMissionEvaluationStrict(raw, reg, criteria);
  const canonical = evaluateEligibility(
    criteria,
    graph,
    parsed.evaluation.criterion_verdicts,
  );
  const c = candidate(graph, parsed.evaluation.criterion_verdicts);
  const decision = candidateDecision({ criteria, candidate: c, anchor: null });
  const view = buildWorkbenchMissionView({
    mission: { requested_count: 1, execution_limit: 1, anchor: null },
    criteria,
    candidates: [c],
    stage: "complete",
  });
  return { parsed, canonical, decision, view };
}
function held(x: ReturnType<typeof outcome>) {
  assertNotEquals(x.parsed.evaluation.decision, "qualified");
  assertNotEquals(x.canonical.eligibility, "eligible");
  assertEquals(x.decision.label, null);
  assertEquals(
    x.view.counts.exact_match + x.view.counts.strong_opportunity +
      x.view.counts.worth_considering + x.view.counts.low_priority,
    0,
  );
  // A plain checkpoint round trip must preserve the parser's veto.
  const restored = JSON.parse(JSON.stringify(x.parsed.evaluation));
  assertNotEquals(
    evaluateEligibility([business], businessGraph, restored.criterion_verdicts)
      .eligibility,
    "eligible",
  );
}
function record(id: string, x: unknown) {
  console.log("INDEPENDENT_AUDIT", JSON.stringify({ id, ...x as object }));
}
function gap(id: string, actual: unknown, expected: unknown) {
  record(id, {
    actual,
    expected,
    status: JSON.stringify(actual) === JSON.stringify(expected)
      ? "PASS"
      : "FAIL",
  });
  if (Deno.env.get("AUDIT_ASSERT_GAPS") === "1") assertEquals(actual, expected);
  else {assertNotEquals(
      actual,
      expected,
      "gap changed: review/update this audit observation",
    );}
}

Deno.test("audit V00 valid receipts: parser, canonical and Workbench agree", () => {
  const x = outcome([business], businessGraph, answer());
  assertEquals(x.parsed.evaluation.decision, "qualified");
  assertEquals(x.canonical.eligibility, "eligible");
  assert(x.decision.label);
});
const variants: Array<[string, unknown]> = [
  ["V01 uncited PASS", {
    ...answer(),
    matched_requirements: [],
    criterion_verdicts: [{ ...answer().criterion_verdicts[0], evidence: [] }],
  }],
  ["V02 mandatory FAIL under overall PASS", {
    ...answer(),
    criterion_verdicts: [{ ...answer().criterion_verdicts[0], result: "fail" }],
  }],
  ["V03 mandatory UNKNOWN", {
    ...answer(),
    criterion_verdicts: [{
      ...answer().criterion_verdicts[0],
      result: "unknown",
    }],
  }],
  ["V04 omitted criterion", { ...answer(), criterion_verdicts: [] }],
  ["V05 contradictory criterion rows", {
    ...answer(),
    criterion_verdicts: [answer().criterion_verdicts[0], {
      ...answer().criterion_verdicts[0],
      result: "fail",
    }],
  }],
  [
    "V06 another company evidence ID",
    answer(business, {
      ...receipt,
      evidence_id: "company_description:linkedin:another_company",
    }),
  ],
  [
    "V07 fabricated quote",
    answer(business, {
      ...receipt,
      excerpt: "Example has raised 10 million dollars this week",
    }),
  ],
  ["V08 malformed JSON", "{broken"],
  ["V09 truncated JSON", JSON.stringify(answer()).slice(0, -15)],
  ["V10 partially valid response", {
    ...answer(),
    criterion_verdicts: [{
      ...answer().criterion_verdicts[0],
      evidence: [receipt, {
        evidence_id: "invented",
        excerpt: "invented excerpt",
      }],
    }],
  }],
  ["V11 absent evaluator after optimistic proof", null],
];
for (const [id, raw] of variants) {
  Deno.test(`audit ${id}`, () => {
    const x = outcome([business], businessGraph, raw);
    held(x);
    record(id, {
      status: "PASS",
      parser: x.parsed.evaluation.decision,
      canonical: x.canonical.eligibility,
      bucket: x.decision.bucket,
    });
  });
}
Deno.test("audit V12 failed preference does not veto mandatory pass", () => {
  const pref = criterion("business_model", "b2b_software", {
    id: "preference",
    kind: "target",
  });
  const raw = answer();
  raw.criterion_verdicts.push({
    ...raw.criterion_verdicts[0],
    criterion_id: pref.id,
    result: "fail",
  });
  assertEquals(
    outcome([business, pref], businessGraph, raw).canonical.eligibility,
    "eligible",
  );
});

for (
  const [id, dimension, value, negativeQuote] of [
    ["C01 recruiting agencies expanding regions", "expansion", {
      region: "Germany",
    }, "Example has no plans to expand into Germany."],
    [
      "C02 B2B hiring sales leadership",
      "hiring",
      { role: "VP of Sales" },
      "Sales Development Representative",
    ],
    [
      "C03 manufacturing facility expansion",
      "expansion",
      { facility: true },
      "Example closed its factory and cancelled the expansion.",
    ],
    [
      "C04 software recent funding",
      "funding",
      { kind: "venture" },
      "Example has not raised funding; it declined a grant.",
    ],
    [
      "C05 service business new locations",
      "expansion",
      { new_locations: true },
      "Example closed all branch locations and will not reopen.",
    ],
  ] as const
) {
  Deno.test(`audit ${id}: mandatory UNKNOWN survives contextual customer value`, () => {
    const c = criterion(dimension, value);
    const graph = buildCompanyEvidenceGraph("co", [fact(dimension, true)], {
      now: NOW,
    });
    const raw = answer(c);
    raw.criterion_verdicts[0].result = "unknown";
    const x = outcome([c], graph, raw);
    held(x);
    record(id, {
      status: "PASS",
      criterion: c.value,
      canonical: x.canonical.eligibility,
    });
  });
  Deno.test(`audit ${id}: verbatim contradiction under model PASS (semantic limit)`, () => {
    const c = criterion(dimension, value);
    const reg = registry();
    const item = {
      ...description,
      evidence_type: dimension === "hiring"
        ? "job_posting" as const
        : "web_page" as const,
      source_text: negativeQuote,
      freshness: "current" as const,
    };
    reg.items = [item];
    const graph = buildCompanyEvidenceGraph("co", [fact(dimension, true)], {
      now: NOW,
    });
    const x = outcome(
      [c],
      graph,
      answer(c, { evidence_id: item.evidence_id, excerpt: negativeQuote }),
      reg,
    );
    // No arbitrary language entailment is claimed; record the remaining model boundary.
    record(`${id} semantic limit`, {
      parser: x.parsed.evaluation.decision,
      canonical: x.canonical.eligibility,
      quote: negativeQuote,
    });
    assertEquals(x.canonical.eligibility, "eligible");
  });
}

Deno.test("audit G01 two equally authoritative HQ providers disagree", () => {
  const items = ["United States", "Canada"].flatMap((country, i) =>
    observationFromCompany(normalizeLinkedInCompanyEnriched(row(country)), {
      capability: "company_enrichment",
      actor_key: "apify_linkedin_company_details",
      provider: `provider-${i}`,
      route_id: null,
      plan_version: null,
      provider_call_id: `call-${i}`,
      mission_id: "audit",
      observed_at: NOW.toISOString(),
    }).evidence.map((e) => ({
      ...e,
      company_key: "co",
      evidence_id: `${i}:${e.evidence_id}`,
    }))
  );
  const graph = buildCompanyEvidenceGraph("co", items, { now: NOW });
  assert(graph.conflicts.includes("geography"));
  const c = criterion("geography", "United States", {
    geography_scope: "headquarters",
  });
  const loc = r.items.find((x) => x.evidence_type === "company_location")!;
  const raw = answer(c, {
    evidence_id: loc.evidence_id,
    excerpt: loc.source_text!,
  });
  Object.assign(raw.criterion_verdicts[0], { geography_scope: "headquarters" });
  const x = outcome([c], graph, raw);
  gap("G01", {
    eligibility: x.canonical.eligibility,
    surfaced: !!x.decision.label,
  }, { eligibility: "pending", surfaced: false });
});
Deno.test("audit G02 equally authoritative size providers disagree", () => {
  const graph = buildCompanyEvidenceGraph("co", [
    fact("company_size_band", { min: 11, max: 50 }),
    fact("company_size_band", { min: 201, max: 500 }, {
      evidence_id: "z-other-size",
      source: { ...source, actor: "other-provider" },
    }),
  ], { now: NOW });
  assert(graph.conflicts.includes("company_size_band"));
  const c = criterion("company_size", { min: 11, max: 50 });
  const size = r.items.find((x) => x.evidence_type === "company_size_band")!;
  const x = outcome(
    [c],
    graph,
    answer(c, { evidence_id: size.evidence_id, excerpt: size.source_text! }),
  );
  gap("G02", x.canonical.eligibility, "pending");
});
Deno.test("audit G03 foreign employer posting is relabelled to candidate", () => {
  const reg = registry({
    jobs: [{
      job_id: "foreign",
      job_url: "https://other.invalid/job",
      title: "VP of Sales",
      company_name: "Other Employer",
      company_linkedin_url: "https://www.linkedin.com/company/other-employer",
      company_source_id: "other",
      location: "US",
      workplace_mode: null,
      posted_date: NOW.toISOString(),
      description: "Other Employer hires leadership",
      source: "job_provider",
      retrieved_at: NOW.toISOString(),
      missing_fields: [],
    }],
  });
  const job = reg.items.find((x) => x.evidence_type === "job_posting")!;
  const c = criterion("hiring", "VP of Sales");
  const parsed = parseMissionEvaluationStrict(
    answer(c, { evidence_id: job.evidence_id, excerpt: "VP of Sales" }),
    reg,
    [c],
  );
  gap("G03", parsed.evaluation.criterion_verdicts![0].result, "unknown");
});
Deno.test("audit G04 graph takes proven fact from another company", () => {
  const graph = buildCompanyEvidenceGraph("co", [
    fact("business_model", "b2b_software", { company_key: "other" }),
  ], { now: NOW });
  gap("G04", evaluateEligibility([business], graph).eligibility, "pending");
});
for (
  const [id, fetched_at] of [["G05 stale page", "2020-01-01T00:00:00Z"], [
    "G06 missing timestamp",
    null,
  ], ["G07 invalid timestamp", "bad-date"]] as const
) {
  Deno.test(`audit ${id}: cached web timestamp cannot support a current requirement`, () => {
    const reg = registry({
      web_pages: [{
        source_url: "https://example.invalid/expansion",
        page_intent: "news",
        source_text: "We are opening our new Berlin facility this month.",
        fetched_at,
      }],
    });
    const page = reg.items.find((x) => x.evidence_type === "web_page")!;
    const c = criterion("expansion", true, {
      time_window: {
        days: 30,
        basis: "observed",
        source: "user_explicit",
        enforced: true,
      },
    });
    const parsed = parseMissionEvaluationStrict(
      answer(c, { evidence_id: page.evidence_id, excerpt: page.source_text! }),
      reg,
      [c],
    );
    record(id, {
      freshness: page.freshness,
      observed_at: page.observed_at,
      projected: evidenceFromRegistry(reg).find((x) =>
        x.dimension === "web_claim"
      )?.valid_until,
    });
    gap(id, parsed.evaluation.criterion_verdicts![0].result, "unknown");
  });
}
Deno.test("audit G08 unsupported mandatory criterion disappears", () => {
  const unsupported = criterion("expansion", "facility in Germany", {
    status: "unprovable_today",
  });
  const x = outcome([business, unsupported], businessGraph, answer());
  gap("G08", {
    eligibility: x.canonical.eligibility,
    surfaced: !!x.decision.label,
  }, { eligibility: "pending", surfaced: false });
});
Deno.test("audit G09 parsed aggregate FAIL overridden by canonical factual PASS", () => {
  const raw = {
    ...answer(),
    mission_fit: "fail",
    failed_requirements: [{
      requirement: "exclude sanctioned employers",
      evidence_id: description.evidence_id,
      why: "company is excluded",
    }],
  };
  const x = outcome([business], businessGraph, raw);
  assertEquals(x.parsed.evaluation.decision, "not_qualified");
  gap("G09", {
    eligibility: x.canonical.eligibility,
    surfaced: !!x.decision.label,
  }, { eligibility: "ineligible", surfaced: false });
});
Deno.test("audit G10 current registry item with foreign company_key is refused", () => {
  const reg = registry();
  reg.items = [{ ...description, company_key: "foreign" }];
  const x = outcome([business], businessGraph, answer(), reg);
  held(x);
});
Deno.test("audit G11 old active job cannot supply a mandatory hiring receipt", () => {
  const reg = registry({
    jobs: [{
      job_id: "old",
      job_url: "https://example.invalid/job",
      title: "VP of Sales",
      company_name: "Example",
      company_linkedin_url: company.linkedin_company_url,
      company_source_id: "co",
      location: "US",
      workplace_mode: null,
      posted_date: "2020-01-01T00:00:00Z",
      description: "Active opening",
      source: "job_provider",
      retrieved_at: NOW.toISOString(),
      missing_fields: [],
    }],
  });
  const j = reg.items.find((x) => x.evidence_type === "job_posting")!;
  const c = criterion("hiring", "VP of Sales");
  assertEquals(
    parseMissionEvaluationStrict(
      answer(c, { evidence_id: j.evidence_id, excerpt: "VP of Sales" }),
      reg,
      [c],
    ).evaluation.criterion_verdicts![0].result,
    "unknown",
  );
});
Deno.test("audit G12 re-evaluation preserves mandatory UNKNOWN despite new unrelated receipt", () => {
  const prior =
    parseMissionEvaluationStrict({ ...answer(), criterion_verdicts: [] }, r, [
      business,
    ]).evaluation;
  const next =
    parseMissionEvaluationStrict({ ...answer(), criterion_verdicts: [] }, r, [
      business,
    ]).evaluation;
  const merged = mergeReevaluation(prior, next, undefined, () => true);
  assertNotEquals(merged.decision, "qualified");
  assertNotEquals(
    evaluateEligibility([business], businessGraph, merged.criterion_verdicts)
      .eligibility,
    "eligible",
  );
});
Deno.test("audit G13 explicit mandatory exclusion is preserved but cannot be proven by model PASS", () => {
  const mission = compileLeadMission({
    originalUserQuery: "Find software companies excluding franchises",
    proposal: {
      requested_opportunity_count: 1,
      company_types: ["software"],
      geographies: [],
      employee_range: { min: null, max: null },
      hard_constraints: [{
        field: "ownership",
        operator: "exclude",
        value: "franchises",
        reason: "explicit customer exclusion",
      }],
    },
  }).final_mission;
  record("G13 compiled", {
    constraints: mission.hard_constraints,
    criteria: deriveMissionCriteria(mission),
  });
  const exclusion = criterion("exclusion", {
    field: "franchise",
    value: "franchise",
  });
  const x = outcome([business, exclusion], businessGraph, {
    ...answer(),
    criterion_verdicts: [...answer().criterion_verdicts, {
      ...answer().criterion_verdicts[0],
      criterion_id: exclusion.id,
    }],
  });
  assertEquals(x.canonical.eligibility, "pending");
});

Deno.test("audit G08b real compiled exact-size mandatory criterion is skipped", () => {
  const mission = compileLeadMission({
    originalUserQuery: "Find B2B software companies with exactly 23 employees",
    proposal: {
      requested_opportunity_count: 1,
      company_types: ["B2B software"],
      geographies: [],
      employee_range: { min: 23, max: 23 },
    },
  }).final_mission;
  const criteria = deriveMissionCriteria(mission);
  const size = criteria.find((c) => c.dimension === "company_size")!;
  assertEquals([size.kind, size.status], ["hard", "unprovable_today"]);
  gap(
    "G08b",
    evaluateEligibility(criteria, businessGraph).eligibility,
    "pending",
  );
});
Deno.test("audit G14 customer 7-day expansion window ignored for 45-day-old proven signal", () => {
  const c = criterion("expansion", "new German facility", {
    time_window: {
      days: 7,
      basis: "observed",
      source: "user_explicit",
      enforced: true,
    },
  });
  const observed = observationFromWebClaim(entityHintFromCompany(company), {
    capability: "company_enrichment",
    actor_key: "fixture-public-news",
    provider: "fixture",
    route_id: null,
    plan_version: null,
    provider_call_id: "old-news",
    mission_id: "audit",
    observed_at: "2026-09-05T00:00:00Z",
  }, {
    dimension: "expansion",
    value: true,
    url: "https://example.invalid/news",
    excerpt: "Example opens German facility",
    method: "provider_field",
    confidence: "high",
  });
  const graph = buildCompanyEvidenceGraph("co", observed.evidence, {
    now: NOW,
  });
  const reg = registry({
    expansion_evidence: [{
      title: "Example opens German facility",
      url: "https://example.invalid/news",
      source: "publisher",
      published_at: "2026-09-05T00:00:00Z",
    }],
  });
  const item = reg.items.find((x) => x.evidence_type === "expansion_signal")!;
  assertEquals(item.freshness, "current"); // global 60-day freshness is weaker than this customer's seven days
  const x = outcome(
    [c],
    graph,
    answer(c, { evidence_id: item.evidence_id, excerpt: item.source_text! }),
    reg,
  );
  gap("G14", {
    receipt: x.parsed.evaluation.criterion_verdicts![0].result,
    eligibility: x.canonical.eligibility,
    surfaced: !!x.decision.label,
  }, { receipt: "unknown", eligibility: "pending", surfaced: false });
});

for (
  const [name, company_type, required, exclusion, preference] of [
    [
      "recruiting expanding regions",
      "recruiting agencies",
      "expansion into Germany",
      "franchises",
      "founder-led",
    ],
    [
      "B2B hiring sales leadership",
      "B2B software",
      "VP of Sales",
      "staffing agencies",
      "remote-first",
    ],
    [
      "manufacturers expanding facilities",
      "manufacturers",
      "facility expansion",
      "distributors",
      "renewable energy",
    ],
    [
      "software recent funding",
      "software",
      "funding within 90 days",
      "grants",
      "seed stage",
    ],
    [
      "services opening locations",
      "service businesses",
      "new location",
      "franchises",
      "independently owned",
    ],
  ]
) {
  Deno.test(`audit compiler preserves customer contract: ${name}`, () => {
    const query =
      `Find ${company_type} with ${required}; exclude ${exclusion}; prefer ${preference}.`;
    const mission = compileLeadMission({
      originalUserQuery: query,
      proposal: {
        requested_opportunity_count: 1,
        company_types: [company_type],
        geographies: [],
        employee_range: { min: null, max: null },
        required_signal_terms: [required],
        excluded_signals: [exclusion],
        hard_constraints: [{
          field: "customer_exclusion",
          operator: "exclude",
          value: exclusion,
          reason: "customer stated",
        }],
        soft_preferences: [{
          field: "customer_preference",
          value: preference,
          reason: "customer prefers",
        }],
      },
    }).final_mission;
    assertEquals(
      (mission.hard_constraints.customer_exclusion as { value: string }).value,
      exclusion,
    );
    assertEquals(
      (mission.soft_preferences.customer_preference as { value: string }).value,
      preference,
    );
    assertEquals(mission.directives?.excluded_signals, [exclusion]);
    assertEquals(mission.required_signal_terms, [required]);
    const criteria = deriveMissionCriteria(mission);
    assert(
      criteria.some((c) => c.kind === "hard" && c.dimension === "exclusion"),
    );
    assert(criteria.some((c) =>
      c.kind === "target" &&
      (c.value as { value?: string })?.value === preference
    ));
    record(`compiler ${name}`, { status: "PASS", criteria });
  });
}
