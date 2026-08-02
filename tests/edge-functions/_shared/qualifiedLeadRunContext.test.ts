// PART 2 — the canonical run context is POPULATED, not merely present, and it
// survives every hop to the export.
//
// ZERO network, ZERO provider calls, ZERO model calls.

import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildQualifiedLeadRunContext, missingRunContextFields,
  REQUIRED_RUN_CONTEXT_FIELDS, RUN_CONTEXT_VERSION,
} from "../../../supabase/functions/_shared/qualifiedLeadRunContext.ts";
import { compileJobIntent } from "../../../supabase/functions/_shared/jobIntentTaxonomy.ts";
import { compileLeadEntityIntent } from "../../../supabase/functions/_shared/leadEntityIntent.ts";
import { executeRunAgentCompanyFirstSourcing } from "../../../supabase/functions/_shared/executeRunAgentCompanyFirstSourcing.ts";
import { resolveRequestedLeadCount } from "../../../supabase/functions/_shared/leadQuotaPolicy.ts";
import { extractRequestedLeadCount } from "../../../supabase/functions/_shared/qualifiedLeadRouting.ts";

const TARGET = "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";

/** Run the REAL company-first entry helper against mocked providers. */
async function realRun() {
  const intent = compileLeadEntityIntent(TARGET);
  const quota = resolveRequestedLeadCount({ explicit: extractRequestedLeadCount(TARGET), isLeadSourcingWorkflow: true });
  return await executeRunAgentCompanyFirstSourcing({
    intent, workspaceId: "ws", taskId: "task-runctx",
    requestedLeadCount: quota.requestedLeadCount, requestedCountSource: quota.source,
    now: "2026-07-26T12:00:00.000Z",
    invokeJobs: async () => [{
      title: "Revenue Operations Manager", companyName: "LAHZO", companyWebsite: "https://lahzo.example",
      companyLinkedinUrl: "https://linkedin.com/company/lahzo", location: "New York, United States",
      jobUrl: "https://j/lahzo/1", descriptionText: "US revenue operations",
      companyDescription: "B2B SaaS software platform", id: "j1",
    }],
    invokePeople: async () => [],
    persist: async () => ({ ok: true, accountId: "a", contactId: null, leadCandidateId: "l" }),
  });
}

Deno.test("PART 2: every required field is POPULATED from a real run", async () => {
  const cf = await realRun();
  const ctx = buildQualifiedLeadRunContext({
    result: cf,
    jobIntent: compileJobIntent(TARGET),
    requestedPersonRoles: ["Founder", "Co-Founder", "CEO"],
  });

  assertEquals(missingRunContextFields(ctx), [], "run context has empty fields");
  assertEquals(ctx.version, RUN_CONTEXT_VERSION);

  // Values, not just presence.
  assertEquals(ctx.original_user_query, TARGET);
  assertEquals(ctx.workflow_kind, "qualified_lead_sourcing");
  assertEquals(ctx.execution_mode, "company_first");
  assertEquals(ctx.job_family, "sales_operations");
  assertEquals(ctx.job_titles, ["Sales Operations", "Revenue Operations", "GTM Operations"]);
  assertEquals(ctx.provider_query_keywords, ["Sales Operations", "Revenue Operations", "GTM Operations"]);
  assertEquals(ctx.provider_query_location, "United States");
  assertEquals(ctx.company_vertical, "b2b_saas");
  assertEquals(ctx.company_stage, "startup_or_small_team");
  assertEquals(ctx.requested_person_roles, ["Founder", "Co-Founder", "CEO"]);
  assertEquals(ctx.requested_lead_count, 5);
  assertEquals(ctx.requested_leads, 5);
  assertEquals(ctx.eligible_leads, 0);
  assertEquals(ctx.remaining_leads, 5);
  assertEquals(ctx.count_entity, "contact_ready_lead");
  assertEquals(ctx.quota_policy, "contact_only");
  assertEquals(ctx.terminal_status, cf.status);
  assert((ctx.round_number ?? 0) >= 1);
  assert(ctx.planner_source && ctx.planner_source.length > 0, "planner_source must never be blank");
  assert(ctx.planner_status && ctx.planner_status.length > 0, "planner_status must never be blank");
  assertStringIncludes(ctx.parsed_intent_summary!, "hiring=sales_operations");
  assertStringIncludes(ctx.parsed_intent_summary!, "department=revenue");
  // THE PART 1 GUARANTEE, restated at the diagnostics boundary.
  assertEquals(ctx.hiring_seniority, [], "the founder CONTACT leaked into the hiring seniority");
  assertEquals(ctx.decision_maker_seniority, ["founder", "c_level"]);
});

Deno.test("PART 2: the summary describes the DIMENSIONS, not just a status word", async () => {
  const cf = await realRun();
  const ctx = buildQualifiedLeadRunContext({ result: cf, jobIntent: compileJobIntent(TARGET) });
  for (const dim of ["department=", "hiring_seniority=", "decision_maker=", "stage=", "vertical=", "geography="]) {
    assertStringIncludes(ctx.parsed_intent_summary!, dim);
  }
});

Deno.test("PART 2: a deterministic round still reports a planner source", async () => {
  const cf = await realRun();
  // Strip AI planner metadata: the fallback must still be honest, not blank.
  const ctx = buildQualifiedLeadRunContext({
    result: { ...cf, planner_metadata: [] },
    jobIntent: compileJobIntent(TARGET),
  });
  assert(ctx.planner_source, "planner_source went blank without AI metadata");
  assertEquals(ctx.planner_status, "deterministic");
  assertEquals(missingRunContextFields(ctx), []);
});

Deno.test("PART 2: the context never carries a provider payload, prompt or trace", async () => {
  const cf = await realRun();
  const blob = JSON.stringify(buildQualifiedLeadRunContext({ result: cf, jobIntent: compileJobIntent(TARGET) }));
  for (const k of ["apiKey", "token", "prompt", "system", "descriptionText", "raw"]) {
    assertFalse(blob.includes(k), `run context leaked "${k}"`);
  }
  // Exactly the declared field set, plus the version. Nothing extra rides along.
  const keys = Object.keys(JSON.parse(blob)).sort();
  assertEquals(keys, ["version", "hiring_seniority", "decision_maker_seniority", ...REQUIRED_RUN_CONTEXT_FIELDS].sort());
});

Deno.test("PART 2: missingRunContextFields actually detects an empty field", () => {
  const ctx = buildQualifiedLeadRunContext({
    result: {
      status: "completed", rounds_attempted: 1, plan_sources: [], planner_metadata: [],
      quota: { requested_leads: 5, eligible_leads: 5, remaining_leads: 0, quota_policy: "contact_only" },
      routing: {
        original_user_query: "", requested_person_role: null,
        job_search_spec: { keyword_queries: [], location: null, company_vertical: null, compilation_status: "" },
      },
    },
    jobIntent: null,
  });
  const missing = missingRunContextFields(ctx);
  for (const f of ["original_user_query", "job_titles", "provider_query_keywords", "provider_query_location", "planner_source"]) {
    assert(missing.includes(f as never), `${f} should have been reported missing`);
  }
});

// ---- flow proof -----------------------------------------------------------

Deno.test("PART 2 WIRING: run-agent emits the context to response, panel and task", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assertStringIncludes(src, "buildQualifiedLeadRunContext({");
  assertStringIncludes(src, "run_context: runContext,");
  assertStringIncludes(src, "qualified_lead_run: runContext,");          // ui_panel
  assertStringIncludes(src, "qualified_lead_run_context: runContext,");  // task result
  assertStringIncludes(src, 'kind: "lead_results"');
});

Deno.test("PART 2 WIRING: the frontend copies the context verbatim", async () => {
  const src = await Deno.readTextFile(new URL("../../../src/lib/qualifiedLead/diagnostics.ts", import.meta.url));
  assertStringIncludes(src, "res.run_context ?? res.qualified_lead_run_context");
  assertStringIncludes(src, "original_user_query: rc.original_user_query");
  assertStringIncludes(src, "provider_query_keywords: rc.provider_query_keywords");
  // The CSV threads the same object.
  const view = await Deno.readTextFile(new URL("../../../src/components/chat/workspace/workbench/LeadResultsView.tsx", import.meta.url));
  assertStringIncludes(view, "rowsToCsv(rows, meta.qualified_lead_run ?? null)");
});
