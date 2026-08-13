// THE EVALUATOR ANSWERS THE MISSION, AND PAYS FOR ITS ANSWER IN EVIDENCE.
//
// Three model calls already ran after evidence collection and not one was asked
// whether the company satisfied the user's request. This is the one that is.
// These tests pin the two properties that make it safe to put a model in the
// deciding seat:
//
//   1. it cannot pass a company without citing evidence that EXISTS and saying
//      words the source ACTUALLY CONTAINS;
//   2. it cannot reject a company for a workspace PREFERENCE.
//
// The second is the AfterQuery case: 220 employees, AI startup, United States,
// four current software-engineering openings, on a Mission that asked for
// exactly that, in a workspace that happens to prefer 10-150.
//
// ZERO network, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMissionEvaluationInput, parseMissionEvaluationStrict, notEvaluated,
  MISSION_EVALUATION_PROMPT, MISSION_EVALUATION_VERSION, FALLBACK_INSUFFICIENT,
} from "../../../supabase/functions/_shared/missionEvaluation.ts";
import {
  buildQualificationContext, resolveBrainAuthority,
} from "../../../supabase/functions/_shared/missionQualificationContext.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";

const QUERY = "Find 10 AI startups in the United States that are hiring software engineers";

/** The Mission as GPT actually compiled it on 2026-08-13 (task d787cfc7). */
function mission(over: Record<string, unknown> = {}): LeadMissionV1 {
  return {
    ...parseLeadMissionDeterministic(QUERY),
    original_user_query: QUERY,
    target_entity: "company",
    requested_count: 10,
    strategies: ["hiring"],
    geography_is_hard: true,
    company_profile: {
      verticals: ["AI startups"], stages: ["startup"],
      locations: ["united states"], business_models: [],
    },
    required_signals: [{ type: "hiring software engineers" }],
    required_signal_terms: ["hiring software engineers"],
    hard_constraints: {
      hiring: { value: "hiring software engineers", operator: "equals" },
      geography: { value: "United States", operator: "equals" },
    },
    soft_preferences: {},
    directives: {
      evaluation_instructions:
        "Discover AI startups in the United States, evaluate whether each is an " +
        "AI startup, confirm embedded evidence of hiring software engineers.",
      required_evidence: ["embedded hiring evidence for software engineer hiring"],
      preferred_signals: ["hiring software engineers"],
      excluded_signals: [],
    },
    ...over,
  } as unknown as LeadMissionV1;
}

/** The workspace Brain, as TEST holds it. */
const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["B2B SaaS", "AI SaaS", "Recruiting Agencies"],
  excluded_industries: ["Manufacturing", "Government"],
  disqualifier_keywords: ["plant operations"],
  business_models: ["SaaS"],
  buyer_roles: ["Founder", "CEO"],
  target_signals: ["hiring RevOps", "founder-led sales"],
  required_geography: "United States",
};

/** AfterQuery: satisfies the Mission, sits outside the preferred size. */
function registry(over: { employees?: number; description?: string; jobs?: string[] } = {}) {
  return buildEvidenceRegistry({
    evidence: buildCompanyEvidence({
      company_key: "afterquery.com",
      source_capability: "startup_company_discovery",
      source_query: QUERY,
      company: {
        company_key: "afterquery.com", company_name: "AfterQuery",
        canonical_domain: "afterquery.com", website: "https://afterquery.com",
        employee_count: over.employees ?? 220,
        description: over.description ?? "AfterQuery builds AI research infrastructure.",
        geography: "San Francisco, CA, USA",
        linkedin_company_url: "https://www.linkedin.com/company/afterquery",
        industry_ids: [], provider_industry: "Software Development",
      } as never,
      identity_state: "resolved",
      linkedin_company_url: "https://www.linkedin.com/company/afterquery",
    }),
    jobs: (over.jobs ?? ["Senior Software Engineer, Infrastructure"]).map((t, i) => ({
      job_id: `j${i}`, title: t, job_url: `https://x/aq/${i}`,
      location: "San Francisco, CA", posted_date: "2026-08-01",
      company_key: "afterquery.com", description: null,
    })) as never,
    yc_description: "AfterQuery builds AI research infrastructure.",
    provider_failures: [],
  });
}

const ctxFor = (m: LeadMissionV1) => buildQualificationContext(m);

/** The first evidence id of a given type, for building valid citations. */
function idOf(reg: ReturnType<typeof registry>, type: string): string {
  const item = reg.items.find((x) => x.evidence_type === type);
  assert(item, `the registry must hold a ${type} item`);
  return item!.evidence_id;
}
function textOf(reg: ReturnType<typeof registry>, id: string): string {
  const item = reg.items.find((x) => x.evidence_id === id)!;
  return String(item.source_text ?? "");
}

// ═════════════════════════════════════════════════ 1-4. the input ══

Deno.test("1. the evaluator receives the Mission, the Brain and the evidence", () => {
  const m = mission();
  const ctx = ctxFor(m);
  const reg = registry();
  const input = buildMissionEvaluationInput({
    ctx, authority: resolveBrainAuthority(ctx, BRAIN), registry: reg,
  });

  // MISSION
  assertEquals(input.mission.original_user_query, QUERY);
  assertEquals(input.mission.verticals, ["ai startups"]);
  assertEquals(input.mission.locations, ["united states"]);
  assertEquals(input.mission.required_signal_terms, ["software engineer"]);

  // BRAIN, pre-split into what may reject and what may only score.
  assert(input.brain.hard_constraints, "rejecting constraints must be present");
  assert(input.brain.preferences, "preferences must be present");

  // EVIDENCE, with citable ids.
  const evidence = input.company.evidence as Array<Record<string, unknown>>;
  assert(evidence.length > 0, "the company must arrive with evidence");
  for (const e of evidence) assert(e.evidence_id, "every item must be citable");
  assert(input.company.established_facts, "hard facts must be given, not asked for");
});

Deno.test("2. the fields nothing has ever read are finally delivered", () => {
  const m = mission();
  const ctx = ctxFor(m);
  const input = buildMissionEvaluationInput({
    ctx, authority: resolveBrainAuthority(ctx, BRAIN), registry: registry(),
  });

  // `hard_constraints` is documented as absolute and was enforced nowhere.
  const hard = input.mission.hard_constraints as Record<string, unknown>;
  assert(hard.hiring, "the Mission's hiring hard constraint must reach the evaluator");
  assert(hard.geography, "and its geography hard constraint");

  // `evaluation_instructions` reached the old payload unread.
  assert(String(input.mission.evaluation_instructions).includes("AI startup"),
    "the Mission's own brief must reach the evaluator");
  assertEquals(
    (input.mission.required_evidence as string[])[0],
    "embedded hiring evidence for software engineer hiring");
});

Deno.test("3. the prompt tells the model a preference may not reject", () => {
  const p = MISSION_EVALUATION_PROMPT;
  assert(p.includes("Decide whether this company satisfies the user's Mission"),
    "the evaluator must be asked the Mission question");
  assert(p.includes("may ONLY move icp_fit and match_score"),
    "the prompt must forbid rejecting on a preference");
  assert(p.toUpperCase().includes("VERBATIM"), "the prompt must demand a verbatim excerpt");
  assert(p.toLowerCase().includes("absence of evidence"),
    "the prompt must forbid inferring absence");
  assert(p.toLowerCase().includes("never invent"), "and forbid inventing facts");
  // AND it must NOT carry the old prohibition.
  assertFalse(p.includes("You do NOT qualify"),
    "this evaluator DOES qualify — that is the architectural change");
});

Deno.test("4. mission-owned axes travel, so the Brain's silence is explicit", () => {
  const m = mission();
  const ctx = ctxFor(m);
  const input = buildMissionEvaluationInput({
    ctx, authority: resolveBrainAuthority(ctx, BRAIN), registry: registry(),
  });
  const owned = input.mission.mission_owned_axes as string[];
  assert(owned.includes("industry"), "the Mission named verticals");
  assert(owned.includes("geography"), "and locations");
  assert(owned.includes("hiring_role"), "and its own roles");
  assertFalse(owned.includes("employee_count"), "but stated no employee range");
});

// ══════════════════════════════════════ 5-10. the fail-closed parser ══

Deno.test("5. a pass must cite evidence that exists", () => {
  const reg = registry();
  const p = parseMissionEvaluationStrict({
    mission_fit: "pass", icp_fit: "strong", hiring_fit: "verified",
    confidence: 0.9, match_score: 88,
    matched_requirements: [
      { requirement: "hiring software engineers", evidence_id: "job_posting:invented:deadbeef", excerpt: "Senior Software Engineer" },
    ],
    reasoning: "looks good",
  }, reg);

  assertEquals(p.evaluation.mission_fit, "review",
    "a pass citing a non-existent evidence id must be downgraded");
  assertEquals(p.evaluation.decision, "insufficient_evidence");
  assert(p.raw_shape.dropped_citations.some((d) => d.startsWith("unknown_evidence_id:")),
    "and the dropped citation must be named");
});

Deno.test("6. a pass must quote words the source actually contains", () => {
  const reg = registry();
  const id = idOf(reg, "job_posting");
  const p = parseMissionEvaluationStrict({
    mission_fit: "pass", icp_fit: "strong", hiring_fit: "verified",
    confidence: 0.95, match_score: 90,
    matched_requirements: [
      { requirement: "hiring software engineers", evidence_id: id, excerpt: "Head of Revenue Operations" },
    ],
    reasoning: "confident",
  }, reg);

  assertEquals(p.evaluation.mission_fit, "review",
    "a fabricated quote cannot support a pass");
  assert(p.raw_shape.dropped_citations.some((d) => d.startsWith("excerpt_not_in_source:")));
});

Deno.test("7. a properly cited pass is accepted, and becomes `qualified`", () => {
  const reg = registry();
  const id = idOf(reg, "job_posting");
  const excerpt = textOf(reg, id).slice(0, 20);
  const p = parseMissionEvaluationStrict({
    mission_fit: "pass", icp_fit: "weak", hiring_fit: "verified",
    confidence: 0.9, match_score: 72,
    matched_requirements: [
      { requirement: "hiring software engineers", evidence_id: id, excerpt },
    ],
    failed_requirements: [],
    reasoning: "AI startup in the US with a current software-engineering opening",
    evidence_quality: "strong",
  }, reg);

  assertEquals(p.evaluation.mission_fit, "pass");
  assertEquals(p.evaluation.decision, "qualified");
  assertEquals(p.evaluation.matched_requirements.length, 1);
  assertEquals(p.raw_shape.dropped_citations.length, 0);
  assertEquals(p.parse_status, "valid");
});

Deno.test("8. THE AFTERQUERY CASE: a weak icp_fit does not stop a qualified company", () => {
  const reg = registry({ employees: 220 });
  const id = idOf(reg, "job_posting");
  const p = parseMissionEvaluationStrict({
    // The Mission is satisfied; the workspace prefers 10-150 and this is 220.
    mission_fit: "pass", icp_fit: "weak", hiring_fit: "verified",
    confidence: 0.88, match_score: 72,
    matched_requirements: [
      { requirement: "hiring software engineers", evidence_id: id, excerpt: textOf(reg, id).slice(0, 18) },
    ],
    reasoning: "satisfies the Mission; above the workspace's preferred headcount",
  }, reg);

  assertEquals(p.evaluation.decision, "qualified",
    "a preference must never turn a Mission-satisfying company into a rejection");
  assertEquals(p.evaluation.icp_fit, "weak", "but it must be visible in the ranking");
  assert(p.evaluation.match_score < 100, "and it must cost score");
});

Deno.test("9. an unusable answer is insufficient_evidence — never a qualify, never a reject", () => {
  const reg = registry();
  for (const bad of [null, "not json", 42, {}, { unrelated: true }, []]) {
    const p = parseMissionEvaluationStrict(bad, reg);
    assertEquals(p.evaluation.decision, "insufficient_evidence", `for ${JSON.stringify(bad)}`);
    assertFalse(p.evaluation.mission_fit === "pass", "never a pass");
    assertFalse(p.evaluation.mission_fit === "fail", "and never a rejection");
  }
  assertEquals(FALLBACK_INSUFFICIENT.decision, "insufficient_evidence");
});

Deno.test("10. enums and numbers are clamped, and a bad field never fails the company", () => {
  const reg = registry();
  const p = parseMissionEvaluationStrict({
    mission_fit: "definitely", icp_fit: "amazing", hiring_fit: "probably",
    confidence: 9, match_score: 5000, evidence_quality: "excellent",
    reasoning: "r",
  }, reg);

  assertEquals(p.evaluation.mission_fit, "review", "an unknown verdict is not a rejection");
  assertEquals(p.evaluation.icp_fit, "weak");
  assertEquals(p.evaluation.hiring_fit, "absent");
  assertEquals(p.evaluation.confidence, 1);
  assertEquals(p.evaluation.match_score, 100);
  assertEquals(p.evaluation.evidence_quality, "weak");
  assertEquals(p.parse_status, "repaired");
});

// ══════════════════════════════════ 11-14. the Mission matrix (§14) ══

/** Build a parsed verdict from a model answer, with valid citations. */
function verdict(o: Record<string, unknown>, reg = registry()) {
  return parseMissionEvaluationStrict(o, reg).evaluation;
}

Deno.test("11. AI startup + software-engineer hiring evidence → qualified", () => {
  const reg = registry();
  const id = idOf(reg, "job_posting");
  const v = verdict({
    mission_fit: "pass", icp_fit: "plausible", hiring_fit: "verified",
    confidence: 0.9, match_score: 85,
    matched_requirements: [
      { requirement: "AI startup", evidence_id: idOf(reg, "company_description"), excerpt: "AI research" },
      { requirement: "hiring software engineers", evidence_id: id, excerpt: textOf(reg, id).slice(0, 16) },
    ],
    reasoning: "ok",
  }, reg);
  assertEquals(v.decision, "qualified");
  assertEquals(v.hiring_fit, "verified");
});

Deno.test("12. AI startup + NO hiring evidence → insufficient_evidence, not a rejection", () => {
  const reg = registry({ jobs: [] });
  const v = verdict({
    mission_fit: "review", icp_fit: "plausible", hiring_fit: "absent",
    confidence: 0.4, match_score: 40,
    matched_requirements: [],
    unknown_fields: ["current_open_roles"],
    reasoning: "no opening evidence available",
  }, reg);

  assertEquals(v.decision, "insufficient_evidence",
    "missing evidence is not the same as failing the Mission");
  assertFalse(v.decision === "not_qualified");
});

Deno.test("13. clear evidence AGAINST a requirement → not_qualified", () => {
  const reg = registry();
  const v = verdict({
    mission_fit: "fail", icp_fit: "weak", hiring_fit: "absent",
    confidence: 0.9, match_score: 10,
    failed_requirements: [
      { requirement: "United States", evidence_id: null, why: "headquartered in Berlin" },
    ],
    rejection_reasons: ["outside the requested geography"],
    reasoning: "geography contradicted",
  }, reg);

  assertEquals(v.decision, "not_qualified");
  assertEquals(v.failed_requirements.length, 1);
  assertEquals(v.rejection_reasons[0], "outside the requested geography");
});

Deno.test("14. a failed requirement citing invented evidence keeps the failure, drops the id", () => {
  const reg = registry();
  const v = verdict({
    mission_fit: "fail", icp_fit: "weak", hiring_fit: "absent",
    confidence: 0.8, match_score: 5,
    failed_requirements: [
      { requirement: "United States", evidence_id: "company_location:nope:1234", why: "Berlin" },
    ],
    reasoning: "r",
  }, reg);

  assertEquals(v.failed_requirements.length, 1, "the failure may still be real");
  assertEquals(v.failed_requirements[0].evidence_id, null,
    "but an invented citation must not be presented as a source");
});

Deno.test("15. `notEvaluated` is distinguishable from every other outcome", () => {
  const n = notEvaluated("the evaluator was disabled for this workspace");
  assertEquals(n.decision, "insufficient_evidence");
  assert(n.unknown_fields.includes("not_evaluated"),
    "a company nobody looked at must say so");
  assertEquals(n.version, MISSION_EVALUATION_VERSION);
});
