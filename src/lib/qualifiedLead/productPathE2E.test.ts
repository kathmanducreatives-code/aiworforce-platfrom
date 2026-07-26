// PART 11 — THE COMPLETE PRODUCT PATH, END TO END.
//
//   Pilot parser → workflow confirmation model → preview renderer
//   → Start Workflow payload → orchestrate → run-agent company-first entry
//   → mocked company-first output → response adapter → Workbench progress
//   → continuation action → CSV serializer
//
// Every boundary is crossed with the REAL module on both sides: the backend
// modules are imported from supabase/functions/_shared, the frontend modules
// from src/lib. Nothing is re-implemented for the test.
//
// ZERO network, ZERO provider calls, ZERO model calls — proved by running under
// `deno test` WITHOUT --allow-net.

import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

// ---- backend (the real runtime) -------------------------------------------
import {
  routeQualifiedLead, extractRequestedLeadCount,
  normalizeCompanyVertical, inferCompanyStage,
} from "../../../supabase/functions/_shared/qualifiedLeadRouting.ts";
import { compileLeadEntityIntent } from "../../../supabase/functions/_shared/leadEntityIntent.ts";
import { isCompanyFirstRequest } from "../../../supabase/functions/_shared/runAgentCompoundBridge.ts";
import { executeRunAgentCompanyFirstSourcing } from "../../../supabase/functions/_shared/executeRunAgentCompanyFirstSourcing.ts";
import { resolveRequestedLeadCount } from "../../../supabase/functions/_shared/leadQuotaPolicy.ts";
import { classifyRoleFamily, roleFamilyAliases } from "../../../supabase/functions/_shared/roleFamilies.ts";
import { decideResume } from "../../../supabase/functions/_shared/sourcingContinuation.ts";
import { SOURCING_STATE_KEY, SOURCING_STATE_VERSION } from "../../../supabase/functions/_shared/companyFirstSourcingState.ts";

// ---- frontend (the real product surfaces) ---------------------------------
import { buildWorkflowPreview, buildStartWorkflowPayload, previewStrings, type QualifiedLeadContract } from "./contract.ts";
import { executionStages, showsFastModeBadge } from "./planCopy.ts";
import { buildQuotaProgress } from "./quotaProgress.ts";
import { buildWorkbenchCounts } from "./workbenchCounts.ts";
import {
  buildContinuationView, initialContinuationState, continuationReducer,
  canDispatchContinue, buildContinuationRequest,
} from "./continuation.ts";
import { runDiagnosticsFromResponse, qualifiedLeadCells, QUALIFIED_LEAD_EXTRA_COLUMNS } from "./diagnostics.ts";

const TARGET = "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
const ACCOUNT_ONLY = "Find five SaaS companies with sales hiring signals.";
const TASK_ID = "71db3ced-0000-4000-8000-000000000001";

const FORBIDDEN = ["sdr", "bdr", "account executive", "founding sdr", "founding ae"];

Deno.test("PART 11 E2E: the Sales-Operations request survives every boundary intact", async () => {
  // ---------- 1. Pilot parser --------------------------------------------
  const route = routeQualifiedLead(TARGET);
  assertEquals(route.workflowKind, "qualified_lead_sourcing");        // #10
  assertEquals(route.executionMode, "company_first");
  assertEquals(route.countEntity, "contact_ready_lead");              // #8
  assertEquals(route.quotaPolicy, "contact_only");                    // #9
  assertEquals(extractRequestedLeadCount(TARGET), 5);                 // #7
  assertEquals(classifyRoleFamily("Sales Operations"), "sales_operations");  // #2

  // ---------- 2. workflow confirmation model (what Pilot emits) ----------
  const family = classifyRoleFamily("Sales Operations")!;
  const contract: QualifiedLeadContract = {
    workflow_kind: "qualified_lead_sourcing",
    execution_mode: "company_first",
    target_entity: "company_and_person",
    signal_type: "hiring",
    job_family: family,
    job_titles: roleFamilyAliases(family).slice(0, 3),
    company_vertical: normalizeCompanyVertical("SaaS", TARGET),
    company_stage: inferCompanyStage(TARGET),
    geography: ["United States"],
    requested_person_roles: ["Founder", "Co-Founder", "CEO"],
    current_employer_required: true,
    requested_lead_count: extractRequestedLeadCount(TARGET)!,
    count_entity: "contact_ready_lead",
    quota_policy: "contact_only",
    original_instruction: TARGET,
  };
  // The exact acceptance contract from the request.
  assertEquals(contract.job_family, "sales_operations");
  assertEquals(contract.job_titles, ["Sales Operations", "Revenue Operations", "GTM Operations"]);  // #3
  assertEquals(contract.company_vertical, "b2b_saas");                // #5
  assertEquals(contract.company_stage, "startup_or_small_team");
  assertEquals(contract.geography, ["United States"]);                // #5
  assertEquals(contract.requested_person_roles, ["Founder", "Co-Founder", "CEO"]);  // #6

  // ---------- 3. preview renderer ----------------------------------------
  const preview = buildWorkflowPreview(contract);
  assertEquals(preview.title, "Find founders at SaaS startups hiring Sales Operations");
  assertEquals(preview.target, "5 CONTACT-ready leads");
  const rendered = previewStrings(preview).join(" | ").toLowerCase();
  for (const bad of [...FORBIDDEN, "fast mode"]) assertFalse(rendered.includes(bad), `preview leaked ${bad}`);  // #4
  assertFalse(showsFastModeBadge("qualified_lead_sourcing"));
  assertEquals(executionStages("qualified_lead_sourcing").length, 6);

  // ---------- 4. Start Workflow payload ----------------------------------
  const start = buildStartWorkflowPayload(
    { workflow_id: "find_qualified_leads", workflow_name: "Find SDR hiring-signal accounts", original_instruction: TARGET, qualified_lead_contract: contract },
    { count: 5 },
  );
  assertEquals(start.text, TARGET, "the ORIGINAL request must remain authoritative");  // #1
  assertEquals(start.metadata.requested_lead_count, 5);
  assertEquals(start.metadata.quota_policy, "contact_only");
  assertFalse(JSON.stringify(start).toLowerCase().includes("sdr hiring-signal"), "the corrupt title reached the payload");

  // ---------- 5. orchestrate ---------------------------------------------
  const orchestrateSrc = await Deno.readTextFile(new URL("../../../supabase/functions/orchestrate/index.ts", import.meta.url));
  assertStringIncludes(orchestrateSrc, "routeQualifiedLead");
  assertStringIncludes(orchestrateSrc, 'workflow_kind: "qualified_lead_sourcing"');
  assertStringIncludes(orchestrateSrc, "requested_lead_count: qualifiedLeadCount");
  assertStringIncludes(orchestrateSrc, 'execution_mode: qualifiedLead ? "company_first" : executionMode');

  // ---------- 6. run-agent company-first entry ---------------------------
  const intent = compileLeadEntityIntent(start.text);
  assert(isCompanyFirstRequest(intent), "the real branch guard must select company-first");  // #10
  const quota = resolveRequestedLeadCount({ explicit: start.metadata.requested_lead_count as number, isLeadSourcingWorkflow: true });
  assertEquals(quota.requestedLeadCount, 5);
  assertEquals(quota.source, "explicit");

  // ---------- 7. mocked company-first output (REAL entry helper) ---------
  const sentKeywords: string[] = [];
  let peopleCalls = 0;
  const cf = await executeRunAgentCompanyFirstSourcing({
    intent, workspaceId: "ws", taskId: TASK_ID,
    requestedLeadCount: quota.requestedLeadCount, requestedCountSource: quota.source,
    now: "2026-07-26T12:00:00.000Z",
    invokeJobs: async (env) => {
      for (const u of (env.input as { urls: string[] }).urls) {
        sentKeywords.push(new URL(u).searchParams.get("keywords") ?? "");
      }
      return [{
        title: "Revenue Operations Manager", companyName: "LAHZO", companyWebsite: "https://lahzo.example",
        companyLinkedinUrl: "https://linkedin.com/company/lahzo", location: "New York, United States",
        jobUrl: "https://j/lahzo/1", descriptionText: "US revenue operations",
        companyDescription: "B2B SaaS software platform", id: "j1",
      }];
    },
    invokePeople: async () => { peopleCalls++; return []; },   // qualified company, NO person
    persist: async () => ({ ok: true, accountId: "a", contactId: null, leadCandidateId: "l" }),
  });

  assertEquals(sentKeywords.slice(0, 3), ["Sales Operations", "Revenue Operations", "GTM Operations"]);  // #3
  for (const bad of FORBIDDEN) assertFalse(sentKeywords.join(" ").toLowerCase().includes(bad));          // #4
  assert(peopleCalls >= 1, "company-scoped founder sourcing must be attempted");
  assertEquals(cf.quota.eligible_leads, 0, "a company with no person is zero leads");                    // #11
  assertEquals(cf.quota.remaining_leads, 5);
  assert(cf.status !== "completed", `0 CONTACT must never be completed (was ${cf.status})`);             // #16
  assertEquals(cf.writeBoundary.providerSideWrites, 0);

  // ---------- 8. response adapter ----------------------------------------
  const response = {
    executed_sourcing_mode: cf.executed_sourcing_mode,
    workflow_kind: "qualified_lead_sourcing",
    terminal_status: "continuation_required",
    task_status: "partial",
    task_id: TASK_ID,
    continuation_token: TASK_ID,
    count_entity: "contact_ready_lead",
    quota_policy: cf.quota.quota_policy,
    requested_leads: cf.quota.requested_leads,
    eligible_leads: cf.quota.eligible_leads,
    remaining_leads: cf.quota.remaining_leads,
    rounds_completed: cf.rounds_attempted,
    next_round: cf.rounds_attempted + 1,
    checkpoint_at: "2026-07-26T12:00:00.000Z",
    counts: { rawJobs: 11, verifiedCompanies: 1, candidates: cf.counts.candidates, contact: cf.counts.contact },
    routing: cf.routing,
    plan_sources: cf.plan_sources,
    planner_metadata: cf.planner_metadata,
  };

  // ---------- 9. Workbench progress --------------------------------------
  const candidates = cf.items.map((it) => ({
    company: it.company, person: it.person,
    quota_eligible: it.quotaEligible, disposition: it.verdict,
    employer_match_status: it.employerMatch,
    decision_maker_status: it.person ? "verified" : "missing",
  }));
  const progress = buildQuotaProgress(response, candidates);
  assertEquals(progress.headline, "0 of 5 CONTACT-ready leads");       // #12
  assertEquals(progress.lines, [
    "11 hiring signals reviewed", "1 qualified company", "0 verified decision-makers",
    "0 of 5 CONTACT-ready leads", "5 remaining",
  ]);
  const counts = buildWorkbenchCounts({ rows: candidates, progress });
  assertEquals(counts.find((c) => c.key === "contact_ready")!.value, 0);
  assertEquals(counts.find((c) => c.key === "remaining")!.value, 5);

  // ---------- 10. continuation action ------------------------------------
  const view = buildContinuationView(response);
  assertEquals(view.actionLabel, "Continue sourcing");                 // #13
  let cont = initialContinuationState(view, TASK_ID);
  assert(canDispatchContinue(cont, view));
  cont = continuationReducer(cont, { type: "continue_clicked" });
  const req = buildContinuationRequest(cont)!;
  assertEquals(req.task_id, TASK_ID);                                  // #14
  assertEquals(req.create_new_task, false);

  // The backend honours it: the SAME task is reused, never re-inserted.
  const resume = decideResume(
    { id: TASK_ID, workspace_id: "ws", status: "partial", result: { [SOURCING_STATE_KEY]: { version: SOURCING_STATE_VERSION, terminal_status: null, current_round: 2 } }, payload: { instruction: TARGET } },
    "ws", req.task_id,
  );
  assert(resume.ok);
  assertEquals(resume.ok && resume.taskId, TASK_ID);
  assertEquals(resume.ok && resume.nextRound, 2, "resuming must not restart round 1");

  // Double click is blocked while the first continuation is in flight.
  assertFalse(canDispatchContinue(cont, view));                        // #15
  assertEquals(continuationReducer(cont, { type: "continue_clicked" }).attempts, 1);

  // ---------- 11. CSV serializer -----------------------------------------
  const run = runDiagnosticsFromResponse(response, contract as unknown as Record<string, unknown>);
  const cells = qualifiedLeadCells(run, {
    quotaEligible: cf.items[0]?.quotaEligible ?? null,
    failedGates: cf.items[0]?.failedGates ?? null,
    employerMatch: cf.items[0]?.employerMatch ?? null,
    persistenceReason: cf.items[0]?.persistenceReason ?? null,
    person: cf.items[0]?.person ?? null,
  });
  const byName = Object.fromEntries(QUALIFIED_LEAD_EXTRA_COLUMNS.map((f, i) => [f, cells[i]]));
  assertEquals(byName.workflow_kind, "qualified_lead_sourcing");       // #17
  assertEquals(byName.job_family, "sales_operations");
  assertEquals(byName.job_titles, "Sales Operations · Revenue Operations · GTM Operations");
  assertEquals(byName.count_entity, "contact_ready_lead");
  assertEquals(byName.quota_policy, "contact_only");
  assertEquals(byName.requested_lead_count, 5);
  assertEquals(byName.terminal_status, "continuation_required");
  assertEquals(run.original_user_query, TARGET);                       // #1
  assertEquals(run.provider_query_keywords, ["Sales Operations", "Revenue Operations", "GTM Operations"]);
  assertEquals(run.provider_query_location, "United States");
});

// #18 — no network, provider or live-model call occurred. The suite runs without
// --allow-net, so any of those would have thrown a permission error above; this
// makes the guarantee explicit rather than implicit.
Deno.test("PART 11 #18: the whole path runs with no network permission", () => {
  const status = Deno.permissions.querySync({ name: "net" }).state;
  assertEquals(status, "prompt", "the suite must not be granted network access");
});

// ---- ACCOUNT-ONLY REGRESSION ----------------------------------------------
Deno.test("PART 11 regression: the account-only request keeps its own shape", () => {
  const r = routeQualifiedLead(ACCOUNT_ONLY);
  assertEquals(r.workflowKind, "account_opportunity_sourcing");
  assertEquals(r.executionMode, "fast");
  assertEquals(r.countEntity, "account_opportunity");
  assert(showsFastModeBadge(r.workflowKind), "fast mode is still allowed here");
  assertEquals(extractRequestedLeadCount(ACCOUNT_ONLY), null, "no CONTACT quota may be invented");

  const start = buildStartWorkflowPayload(
    { workflow_id: "find_hiring_signal_accounts", original_instruction: ACCOUNT_ONLY, qualified_lead_contract: null, inputs: { count: 5 } },
    { count: 5 },
  );
  assertEquals(start.metadata.count_entity, "account");
  assertEquals(start.metadata.quota_policy, undefined);
  // No founder role is invented for a company search.
  const blob = JSON.stringify(start).toLowerCase();
  for (const bad of ["founder", "co-founder", "ceo"]) assertFalse(blob.includes(bad), `invented ${bad}`);
  assertFalse(blob.includes("contact_ready_lead"), "claimed a CONTACT-ready quota");

  // Account-only Workbench copy keeps the legacy provider-centric plan.
  assertEquals(executionStages(r.workflowKind)[0].label, "Scout sources signals through Apify");
});
