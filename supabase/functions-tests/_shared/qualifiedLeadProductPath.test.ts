// PRODUCT-PATH PROOF: Start Workflow -> orchestrate -> run-agent -> company-first.
// The 2026-07-26 manual run proved an emitted contract is worthless if nothing
// consumes it, so these tests assert the REAL runtime dependency is selected and
// the REAL entry helper executes — not just that JSON was produced.
// ZERO network, ZERO model calls.

import { assertEquals, assert, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadEntityIntent } from "../../functions/_shared/leadEntityIntent.ts";
import { isCompanyFirstRequest } from "../../functions/_shared/runAgentCompoundBridge.ts";
import { routeQualifiedLead, extractRequestedLeadCount } from "../../functions/_shared/qualifiedLeadRouting.ts";
import { executeRunAgentCompanyFirstSourcing } from "../../functions/_shared/executeRunAgentCompanyFirstSourcing.ts";
import { resolveRequestedLeadCount } from "../../functions/_shared/leadQuotaPolicy.ts";
import { classifyRoleFamily } from "../../functions/_shared/roleFamilies.ts";

const TARGET = "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
const ACCOUNT_ONLY = "Find five SaaS companies with sales hiring signals.";

// ---- BOUNDARY 1: Pilot route ----------------------------------------------
Deno.test("B1 Pilot: the request routes qualified_lead_sourcing / company_first", () => {
  const r = routeQualifiedLead(TARGET);
  assertEquals(r.workflowKind, "qualified_lead_sourcing");
  assertEquals(r.executionMode, "company_first");
  assertEquals(r.quotaPolicy, "contact_only");
  assertEquals(r.countEntity, "contact_ready_lead");
  assertEquals(extractRequestedLeadCount(TARGET), 5);
  assertEquals(classifyRoleFamily("Sales Operations"), "sales_operations");
});

// ---- BOUNDARY 2: orchestrate forwards the quota, unpinned ------------------
Deno.test("B2 orchestrate: source forwards requested_lead_count and company_first", async () => {
  const src = await Deno.readTextFile(new URL("../orchestrate/index.ts", import.meta.url));
  assertStringIncludes(src, "routeQualifiedLead");
  assertStringIncludes(src, 'workflow_kind: "qualified_lead_sourcing"');
  assertStringIncludes(src, "requested_lead_count: qualifiedLeadCount");
  assertStringIncludes(src, 'quota_policy: "contact_only"');
  assertStringIncludes(src, 'execution_mode: qualifiedLead ? "company_first" : executionMode');
});

// ---- BOUNDARY 3: run-agent selects the company-first branch ----------------
Deno.test("B3 run-agent: the compiled intent selects the company-first branch", () => {
  const intent = compileLeadEntityIntent(TARGET);
  assertEquals(intent.execution_mode, "company_first");
  assert(isCompanyFirstRequest(intent), "run-agent's branch guard must be true");
  assertEquals(intent.job_search_spec.keyword_queries, ["Sales Operations", "Revenue Operations", "GTM Operations"]);
  assertEquals(intent.job_search_spec.location, "United States");
  assertEquals(intent.job_search_spec.company_vertical, "saas");
  assertEquals(intent.job_search_spec.requested_person_roles, ["Founder", "Co-Founder", "CEO"]);
  const hay = intent.job_search_spec.keyword_queries.join(" ").toLowerCase();
  for (const bad of ["sdr", "bdr", "account executive", "founding ae"]) assertFalse(hay.includes(bad));
});
Deno.test("B3b run-agent: the explicit quota survives resolution as EXPLICIT", () => {
  const q = resolveRequestedLeadCount({ explicit: extractRequestedLeadCount(TARGET), isLeadSourcingWorkflow: true });
  assertEquals(q.requestedLeadCount, 5);
  assertEquals(q.source, "explicit");
});
Deno.test("B3c run-agent: the company-first branch is wired to the entry helper", async () => {
  const src = await Deno.readTextFile(new URL("../run-agent/index.ts", import.meta.url));
  assertStringIncludes(src, "isCompanyFirstRequest(routingEntityIntent)");
  assertStringIncludes(src, "executeRunAgentCompanyFirstSourcing({");
  assertStringIncludes(src, "body.requested_lead_count");
});

// ---- BOUNDARY 4: the REAL entry helper executes ----------------------------
Deno.test("B4 PROOF: the target request reaches executeRunAgentCompanyFirstSourcing", async () => {
  const intent = compileLeadEntityIntent(TARGET);
  const quota = resolveRequestedLeadCount({ explicit: extractRequestedLeadCount(TARGET), isLeadSourcingWorkflow: true });
  const seenJobUrls: string[] = [];
  let peopleScoped = 0;

  const cf = await executeRunAgentCompanyFirstSourcing({
    intent, workspaceId: "ws", taskId: "task-proof",
    requestedLeadCount: quota.requestedLeadCount, requestedCountSource: quota.source,
    now: "2026-07-26T03:00:00Z",
    invokeJobs: async (env) => {
      const native = env.input as { urls: string[] };
      for (const u of native.urls) seenJobUrls.push(new URL(u).searchParams.get("keywords") ?? "");
      return [{
        title: "Revenue Operations Manager", companyName: "Acme SaaS", companyWebsite: "https://acmesaas.com",
        companyLinkedinUrl: "https://linkedin.com/company/acmesaas", location: "New York, United States",
        jobUrl: "https://j/acme/1", descriptionText: "US revenue operations",
        companyDescription: "B2B SaaS software platform", id: "j1",
      }];
    },
    invokePeople: async () => { peopleScoped++; return []; },   // no person found
    persist: async () => ({ ok: true, accountId: "a", contactId: null, leadCandidateId: "l" }),
  });

  // The REAL runtime ran the compiled Sales-Operations plan.
  assertEquals(cf.executed_sourcing_mode, "company_first");
  assertEquals(seenJobUrls.slice(0, 3), ["Sales Operations", "Revenue Operations", "GTM Operations"]);
  assertFalse(seenJobUrls.some((k) => /sdr|bdr|account executive/i.test(k)));
  assert(peopleScoped >= 1, "company-scoped founder sourcing must be attempted");

  // Quota contract is CONTACT-only and honest.
  assertEquals(cf.quota.requested_leads, 5);
  assertEquals(cf.quota.requested_count_source, "explicit");
  assertEquals(cf.quota.quota_policy, "contact_only");
  // A qualified COMPANY with no verified person earns ZERO quota credit.
  assertEquals(cf.quota.eligible_leads, 0);
  assertEquals(cf.quota.remaining_leads, 5);
  assert(cf.status !== "completed", `0 CONTACT must never be completed (was ${cf.status})`);

  // Diagnostics the export needs are populated by the runtime.
  assertEquals(cf.routing.original_user_query, TARGET);
  assertEquals(cf.routing.job_search_spec.company_vertical, "saas");
  assert(Array.isArray(cf.plan_sources) && Array.isArray(cf.bottlenecks));
  assertEquals(cf.writeBoundary.providerSideWrites, 0);
});

// ---- ACCOUNT-ONLY REGRESSION ----------------------------------------------
Deno.test("account-only request keeps fast account sourcing and invents no founder", () => {
  const r = routeQualifiedLead(ACCOUNT_ONLY);
  assertEquals(r.workflowKind, "account_opportunity_sourcing");
  assertEquals(r.executionMode, "fast");
  assertEquals(r.countEntity, "account_opportunity");
  assertEquals(extractRequestedLeadCount(ACCOUNT_ONLY), null);
  // NOTE: compileLeadEntityIntent independently reports company_first for a pure
  // COMPANY search (it still needs a company gate). That is a different concept
  // from the PRODUCT route, which is what orchestrate switches on — so the
  // account-only workflow is preserved by the route, not by the intent compiler.
  assertEquals(routeQualifiedLead(ACCOUNT_ONLY).quotaPolicy, "account_only");
});
