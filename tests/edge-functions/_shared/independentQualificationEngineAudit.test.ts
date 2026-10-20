// deno-lint-ignore-file no-import-prefix require-await
// Follow the repository test import style; external stand-ins implement async contracts.
// Execute real capability engine; inject only external planner/provider/model answers.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalDecisions,
  canonicalQualifiedKeys,
  checkpointSnapshot,
  missionCandidatesFrom,
  restoreWorkingSet,
  runCapabilityPlan,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { parseMissionEvaluationStrict } from "../../../supabase/functions/_shared/missionEvaluation.ts";
import {
  parseGroundedResult,
  verifyGroundedResult,
} from "../../../supabase/functions/_shared/groundedClaims.ts";
import {
  buildWorkbenchMissionView,
  decisionSummary,
} from "../../../supabase/functions/_shared/workbenchMissionView.ts";
import {
  buildRunOutcome,
  readFactsFromResult,
  renderRunOutcome,
} from "../../../supabase/functions/_shared/runOutcome.ts";
import { settleV2Outcome } from "../../../supabase/functions/_shared/leadAutoContinuation.ts";
import { projectMissionCompanyRows } from "../../../supabase/functions/_shared/leadMissionPersistenceProjection.ts";
import { emptyDiscoverySelector } from "./discoverySelectorFixture.ts";

const fixture = JSON.parse(
  Deno.readTextFileSync(
    new URL(
      "../../fixtures/lead-v2/p3-job-discovery-probe.json",
      import.meta.url,
    ),
  ),
);
const base = fixture.probes["harvestapi~linkedin-job-search"].items[0];
for (
  const mode of [
    "pass",
    "fail",
    "unknown",
    "missing",
    "uncited",
    "fabricated",
    "foreign_id",
    "truncated",
    "timeout",
    "aggregate_fail",
    "aggregate_review",
    "agency",
    "employer_conflict",
    "multiple_identities",
    "contradictory",
    "malformed",
    "partially_valid",
    "stale_active",
    "undated_job",
  ] as const
) {
  Deno.test(`independent native engine ${mode}`, async () => {
    const agency = mode === "agency";
    const query = agency
      ? "Find 1 recruiting agency hiring its own VP of Sales within 30 days."
      : "Find 1 B2B software company hiring VP of Sales within 30 days.";
    const mission = compileLeadMission({
      originalUserQuery: query,
      proposal: {
        requested_opportunity_count: 1,
        company_types: [agency ? "recruiting agency" : "B2B software"],
        geographies: [],
        employee_range: { min: null, max: null },
        required_signal_terms: ["VP of Sales"],
        preferred_signals: ["hiring VP of Sales"],
        signal_recency_days: 30,
        required_capabilities: [
          "general_company_discovery",
          "embedded_hiring_evidence",
          "company_semantic_evaluation",
        ],
      },
    }).final_mission;
    const company = {
      ...structuredClone(base.company),
      id: "audit",
      name: agency ? "Example Recruiting" : "Example Software",
      linkedinUrl: "https://www.linkedin.com/company/audit-example",
      website: "https://example.invalid",
      description: agency
        ? "We recruit executives for business customers. We are hiring our own VP of Sales for our internal team."
        : "We build software for revenue teams at business customers.",
      industries: [agency ? "Staffing and Recruiting" : "Software Development"],
    };
    const job = {
      ...structuredClone(base),
      id: "audit-job",
      title: "VP of Sales",
      company,
      jobState: "LISTED",
      closedAt: null,
      postedDate: new Date(Date.now() - 86_400_000).toISOString(),
      expireAt: new Date(Date.now() + 86_400_000).toISOString(),
      descriptionText:
        `${company.name} is hiring its own VP of Sales to lead our internal sales team. This is not a client posting.`,
    };
    if (mode === "stale_active") {
      job.postedDate = new Date(Date.now() - 45 * 86_400_000).toISOString();
    }
    if (mode === "undated_job") job.postedDate = null;
    if (mode === "employer_conflict") {
      Object.assign(job, {
        companyLinkedinUrl: "https://www.linkedin.com/company/other-employer",
        descriptionText:
          "Employer: Other Employer\nWe are hiring a VP of Sales.",
      });
    }
    const calls: string[] = [];
    let modelCalls = 0;
    const deps = {
      smokeMinimalOrchestration: true,
      planDiscovery: emptyDiscoverySelector(),
      planExecution: async () => {
        modelCalls++;
        return {
          reasoning: "synthetic planner",
          steps: [
            {
              capability: "job_discovery",
              actor_key: "apify_linkedin_job_search",
              purpose: "candidate discovery",
              input: {
                jobTitles: ["VP of Sales"],
                maxItems: 1,
                postedLimit: "month",
              },
              depends_on: [],
            },
            {
              capability: "company_enrichment",
              actor_key: "apify_linkedin_company_details",
              purpose: "company evidence",
              input: { companies: [company.linkedinUrl] },
              depends_on: [1],
            },
            {
              capability: "company_brain_qualification",
              actor_key: null,
              purpose: "qualify",
              input: {},
              depends_on: [2],
            },
          ],
        };
      },
      invoke: async (
        call: {
          actorKey: string;
          onProviderRun?: (x: { run_id: string; dataset_id: null }) => void;
        },
      ) => {
        calls.push(call.actorKey);
        call.onProviderRun?.({
          run_id: `synthetic-${calls.length}`,
          dataset_id: null,
        });
        if (call.actorKey === "apify_linkedin_job_search") return [job];
        if (call.actorKey === "apify_linkedin_company_details") {
          return mode === "multiple_identities"
            ? [{
              ...company,
              id: "other",
              linkedinUrl: "https://www.linkedin.com/company/other-employer",
              website: "https://other.invalid",
              description: "A consumer shop",
            }, company]
            : [company];
        }
        throw new Error(`unexpected provider purchase ${call.actorKey}`);
      },
      evaluateBatch: async (
        batch: Array<
          {
            company_key: string;
            registry: Parameters<typeof verifyGroundedResult>[0]["registry"];
          }
        >,
      ) => {
        modelCalls++;
        return {
          version: "fixture",
          evaluated: batch.length,
          failed: 0,
          foreign_results: [],
          outcomes: batch.map((m) => {
            const desc = m.registry.items.find((x) =>
              x.evidence_type === "company_description"
            )!;
            const raw = {
              business_model: { value: "b2b_software", confidence: 0.9 },
              decision: "pass",
              confidence: 0.9,
              supporting_claims: [{
                claim: "sells software to businesses",
                claim_type: "business_model",
                evidence_ids: [desc.evidence_id],
                evidence_excerpts: [{
                  evidence_id: desc.evidence_id,
                  excerpt: desc.source_text,
                }],
              }],
            };
            return {
              company_key: m.company_key,
              verification: verifyGroundedResult({
                registry: m.registry,
                result: parseGroundedResult(raw),
              }),
              failure: null,
              detail: null,
            };
          }),
        };
      },
      evaluateMission: async (
        { input, registry }: {
          input: {
            mission: { criteria?: Array<{ id: string; dimension: string }> };
          };
          registry: Parameters<typeof parseMissionEvaluationStrict>[1];
        },
      ) => {
        modelCalls++;
        if (mode === "timeout") return null; // external binding's established timeout result
        const desc = registry.items.find((x) =>
          x.evidence_type === "company_description"
        )!;
        const jobItem = registry.items.find((x) =>
          x.evidence_type === "job_posting"
        )!;
        const citation = (e: typeof desc | undefined) => ({
          evidence_id: mode === "foreign_id"
            ? "foreign-company-evidence"
            : e?.evidence_id ?? "missing-evidence",
          excerpt: mode === "fabricated"
            ? "Completely fabricated receipt about another company"
            : e?.source_text ?? "missing evidence",
        });
        const raw = {
          mission_fit: mode === "aggregate_fail"
            ? "fail"
            : mode === "aggregate_review"
            ? "review"
            : "pass",
          hiring_fit: "verified",
          reasoning: "synthetic model",
          matched_requirements: mode === "uncited"
            ? []
            : [{ requirement: "B2B software", ...citation(desc) }],
          criterion_verdicts: (input.mission.criteria ?? []).filter((c) =>
            mode !== "missing" || c.dimension !== "hiring"
          ).map((c) => ({
            criterion_id: c.id,
            result:
              ["fail", "unknown"].includes(mode) && c.dimension === "hiring"
                ? mode
                : "pass",
            reason: "mock model interpretation",
            evidence: mode === "uncited"
              ? []
              : [citation(c.dimension === "hiring" ? jobItem : desc)],
          })),
          failed_requirements: mode === "aggregate_fail"
            ? [{
              requirement: "exclude existing customers",
              evidence_id: desc.evidence_id,
              why: "company excluded",
            }]
            : [],
        };
        if (mode === "contradictory") {
          const hiring = raw.criterion_verdicts.find((v) =>
            v.criterion_id.startsWith("hiring:")
          )!;
          raw.criterion_verdicts.push({ ...hiring, result: "fail" });
        }
        if (mode === "partially_valid") {
          for (const v of raw.criterion_verdicts) {
            if (v.criterion_id.startsWith("hiring:")) {
              v.evidence.push({
                evidence_id: "foreign-evidence",
                excerpt: "fabricated extra receipt",
              });
            }
          }
        }
        if (mode === "malformed") {
          return parseMissionEvaluationStrict(
            "not JSON",
            registry,
            deriveMissionCriteria(mission),
          );
        }
        return parseMissionEvaluationStrict(
          mode === "truncated" ? JSON.stringify(raw).slice(0, -20) : raw,
          registry,
          deriveMissionCriteria(mission),
        );
      },
    };
    const opts = {
      mission,
      plan: buildCapabilityGraph(mission, { executability: "enforce" }),
      maxCandidates: 1,
      readEnv: (k: string) =>
        k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined,
      specMode: "enforce",
      specScope: { workspace_id: "audit", lineage_id: "audit" },
      identity: { task_id: "audit", workspace_id: "audit" },
    };
    const run = await runCapabilityPlan(deps as never, opts as never);
    const decisions = canonicalDecisions(run.companies, opts);
    const qualified = canonicalQualifiedKeys(run.companies, opts);
    const rows = projectMissionCompanyRows(
      run.companies,
      "audit",
      "company",
      decisions,
    );
    const snapshot = checkpointSnapshot(run.state, run.companies);
    const restored = restoreWorkingSet(
      JSON.parse(JSON.stringify(snapshot.resume_records)),
    );
    assertEquals(
      canonicalQualifiedKeys(restored, opts),
      qualified,
      "checkpoint restore keeps qualified set",
    );
    const view = buildWorkbenchMissionView({
      mission: { requested_count: 1, execution_limit: 1, anchor: null },
      criteria: deriveMissionCriteria(mission),
      candidates: missionCandidatesFrom(run),
      stage: "complete",
    });
    const counts = decisionSummary(view.counts);
    assertEquals(counts.qualified, qualified.length);
    const terminal = settleV2Outcome({
      continuing: false,
      stopReason: counts.qualified ? "quota_met" : "frontier_exhausted",
      legacyStatus: "search_exhausted",
      legacyQuota: { eligible_leads: 0, requested_leads: 1 },
      canonicalQualified: counts.qualified,
      requestedCount: 1,
      companyIsDeliverable: true,
    });
    assertEquals(terminal.delivered, qualified.length);
    const beforeResume = { providers: calls.length, models: modelCalls };
    const resumed = await runCapabilityPlan(
      {
        ...deps,
        restoredGroundedResults: new Map(
          run.companies.filter((c) => c.grounded).map((
            c,
          ) => [c.key, c.grounded!]),
        ),
      } as never,
      {
        ...opts,
        state: JSON.parse(JSON.stringify(snapshot.state)),
        resume: {
          workspace_id: "audit",
          lineage_root_task_id: "audit",
          records: JSON.parse(JSON.stringify(snapshot.resume_records)),
        },
      } as never,
    );
    assertEquals(
      canonicalQualifiedKeys(resumed.companies, opts),
      qualified,
      "resume cannot promote rejected or unknown",
    );
    assertEquals(
      calls.length,
      beforeResume.providers,
      "complete snapshot must not repurchase providers",
    );
    assertEquals(
      modelCalls,
      beforeResume.models,
      "complete snapshot must not repeat evaluation",
    );
    const facts = readFactsFromResult({
      workbench_mission_view: view,
      lead_library_persistence: { persisted: 0 },
    }, 1);
    const outcome = buildRunOutcome(facts);
    assertEquals(outcome.qualification.qualified, qualified.length);
    const notice = renderRunOutcome(outcome);
    console.log(
      "INDEPENDENT_ENGINE",
      JSON.stringify({
        mode,
        companies: run.companies.length,
        qualified,
        persistencePlans: rows.rows.length,
        calls,
        modelCalls,
        decisions: [...decisions.values()],
        evaluator: run.companies.map((c) => c.mission_evaluation?.decision),
        coherent: snapshot.coherent,
        restoredQualified: canonicalQualifiedKeys(restored, opts),
        terminal,
        notice,
      }),
    );
    assert(modelCalls <= 4);
    assertEquals(
      calls.filter((x) => x === "apify_linkedin_job_search").length,
      1,
    );
    assert(
      calls.filter((x) => x === "apify_linkedin_company_details").length <= 1,
    );
    if (mode === "pass" || mode === "multiple_identities") {
      assertEquals(qualified.length, 1);
    } else if (mode === "aggregate_fail" || mode === "aggregate_review") {
      if (Deno.env.get("AUDIT_ASSERT_GAPS") === "1") {
        assertEquals(qualified.length, 0);
      } else assertEquals(qualified.length, 1);
    } else if (mode === "agency") {
      if (Deno.env.get("AUDIT_ASSERT_GAPS") === "1") {
        assertEquals(run.companies.length, 1);
      } else assertEquals(run.companies.length, 0);
    } else {
      assertEquals(qualified, []);
      assertEquals(rows.rows, []);
    }
    // All paths use production construction; no DB writer or qualification mock.
    assertEquals(missionCandidatesFrom(run).length, run.companies.length);
  });
}
