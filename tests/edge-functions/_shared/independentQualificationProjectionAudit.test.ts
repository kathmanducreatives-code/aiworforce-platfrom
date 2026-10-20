// deno-lint-ignore-file no-import-prefix
// Follow the repository test import style; external stand-ins implement async contracts.
// Real canonical engine and persistence-plan projection. No persistence writer/DB mock.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalDecisions,
  canonicalDecisionSummary,
  canonicalQualifiedKeys,
  type EngineCompany,
  missionCandidatesFrom,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { projectMissionCompanyRows } from "../../../supabase/functions/_shared/leadMissionPersistenceProjection.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { parseMissionEvaluationStrict } from "../../../supabase/functions/_shared/missionEvaluation.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { entityHintFromCompany } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { normalizeLinkedInCompanyEnriched } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import { buildWorkbenchMissionView } from "../../../supabase/functions/_shared/workbenchMissionView.ts";

const NOW = new Date().toISOString();
const key = "https://www.linkedin.com/company/example";
const description =
  "Example builds software for revenue teams at business customers.";
const company = normalizeLinkedInCompanyEnriched({
  id: "co",
  name: "Example",
  description,
  linkedinUrl: key,
  website: "https://example.invalid",
});
const mission = compileLeadMission({
  originalUserQuery: "Find 1 B2B software company",
  proposal: {
    requested_opportunity_count: 1,
    company_types: ["B2B software"],
    geographies: [],
    employee_range: { min: null, max: null },
  },
}).final_mission;
const criteria = deriveMissionCriteria(mission);
const registry = buildEvidenceRegistry({
  evidence: buildCompanyEvidence({
    company_key: key,
    company,
    source_capability: "company_enrichment",
    identity_state: "resolved",
  }),
});
const item = registry.items.find((x) =>
  x.evidence_type === "company_description"
)!;
function model(mission_fit = "pass", result = "pass") {
  const receipt = { evidence_id: item.evidence_id, excerpt: description };
  return {
    mission_fit,
    hiring_fit: "absent",
    reasoning: "fixture model verdict",
    matched_requirements: [{ requirement: "B2B software", ...receipt }],
    failed_requirements: mission_fit === "fail"
      ? [{
        requirement: "customer exclusion",
        evidence_id: item.evidence_id,
        why: "excluded company",
      }]
      : [],
    criterion_verdicts: criteria.map((c) => ({
      criterion_id: c.id,
      result,
      reason: "model interpretation",
      evidence: [receipt],
    })),
  };
}
function engineCompany(raw: unknown): EngineCompany {
  const evaluation =
    parseMissionEvaluationStrict(raw, registry, criteria).evaluation;
  return {
    key,
    company,
    enriched: company,
    evidence_registry: registry,
    mission_evaluation: evaluation,
    observations: [{
      version: "candidate-observation-v1",
      observation_id: "audit",
      capability: "company_enrichment",
      actor_key: "fixture",
      provider: "fixture",
      route_id: null,
      plan_version: null,
      provider_call_id: "fixture",
      source_record_id: "co",
      source_url: key,
      observed_at: NOW,
      entity_hint: entityHintFromCompany(company),
      evidence: [{
        evidence_id: "business-proof",
        company_key: key,
        dimension: "business_model",
        value: "b2b_software",
        status: "proven",
        source: {
          provider: "fixture",
          actor: "fixture",
          provider_call_id: null,
          url: key,
          excerpt: description,
        },
        method: "model_extraction",
        observed_at: NOW,
        valid_until: null,
        confidence: "high",
        derived_from: [item.evidence_id],
        mission_id: "audit",
        origin: "lead_mission",
      }],
    }],
    hiring_jobs: [],
    yc_open_jobs: [],
    hiring_assessment: null,
    first_in_function: null,
    identity: { status: "verified_match", linkedin_company_url: key },
    found_by: [],
    verdict: evaluation.decision === "not_qualified"
      ? "reject"
      : evaluation.decision === "qualified"
      ? "pass"
      : "unknown",
    brain: null,
    shortlisted: true,
    prequalified: null,
    prequal_key: null,
    shortlist_exclusion: null,
    triage: null,
    investigation_state: "investigated",
    investigation_rank: 1,
    enrichment_outcome: "success",
    completed_operations: [],
    identity_conflicts: [],
    grounded: null,
  } as unknown as EngineCompany;
}
const opts = {
  mission,
  plan: { entry_capability: "general_company_discovery" },
};
function project(c: EngineCompany) {
  const decisions = canonicalDecisions([c], opts);
  const qualified = canonicalQualifiedKeys([c], opts);
  const rows = projectMissionCompanyRows(
    [c],
    "audit-workspace",
    "company",
    decisions,
  );
  const candidates = missionCandidatesFrom({ companies: [c] });
  const view = buildWorkbenchMissionView({
    mission: { requested_count: 1, execution_limit: 1, anchor: null },
    criteria,
    candidates,
    stage: "complete",
  });
  const summary = canonicalDecisionSummary([c], opts);
  return { decisions, qualified, rows, view, summary };
}
for (const mode of ["pass", "fail", "unknown", "missing", "timeout"] as const) {
  Deno.test(`independent engine projection: mandatory ${mode}`, () => {
    const raw = model("pass", mode);
    if (mode === "missing") raw.criterion_verdicts = [];
    const c = engineCompany(mode === "timeout" ? null : raw);
    const x = project(c);
    const expected = mode === "pass" ? 1 : 0;
    assertEquals(x.qualified.length, expected);
    assertEquals(x.rows.rows.length, expected);
    assertEquals(x.summary.qualified, expected);
    const count = x.view.counts;
    assertEquals(
      count.exact_match + count.strong_opportunity + count.worth_considering +
        count.low_priority,
      expected,
    );
    console.log(
      "INDEPENDENT_PROJECTION",
      JSON.stringify({
        mode,
        evaluator: c.mission_evaluation?.decision,
        canonical: [...x.decisions.values()],
        rowCount: x.rows.rows.length,
        summary: x.summary,
        workbench: x.view.counts,
        rows: x.rows.rows,
      }),
    );
  });
}
Deno.test("independent engine projection G09: aggregate rejection reaches qualified persistence plan", () => {
  const c = engineCompany(model("fail", "pass"));
  assertEquals(c.verdict, "reject");
  assertEquals(c.mission_evaluation?.decision, "not_qualified");
  const x = project(c);
  const actual = {
    qualified: x.qualified.length,
    persistencePlans: x.rows.rows.length,
    summary: x.summary.qualified,
  };
  console.log(
    "INDEPENDENT_PROJECTION",
    JSON.stringify({
      id: "G09",
      actual,
      decision: [...x.decisions.values()],
      rows: x.rows.rows,
    }),
  );
  if (Deno.env.get("AUDIT_ASSERT_GAPS") === "1") {
    assertEquals(actual, { qualified: 0, persistencePlans: 0, summary: 0 });
  } else {assertEquals(actual, {
      qualified: 1,
      persistencePlans: 1,
      summary: 1,
    });}
});
