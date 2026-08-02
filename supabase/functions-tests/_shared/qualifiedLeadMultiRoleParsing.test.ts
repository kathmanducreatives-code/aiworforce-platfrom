// MULTI-ROLE HIRING REQUIREMENTS AND ENTITY-AWARE QUOTAS.
//
// The canonical production query names three hiring disciplines and one lead
// quota. Before this change it produced NEITHER: the role list was rejected for
// containing seven words (one of them the conjunction), and the quota was read by
// a generic first-number rule that would happily have taken an employee range.
//
// PURE PARSING. No Actor, no Firecrawl, no model, no database, no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileJobSearchSpec, extractHiringRolePhrase, extractHiringRolePhrases,
  MAX_HIRING_ROLES,
} from "../../functions/_shared/jobSearchSpec.ts";
import { compileLeadEntityIntent, resolveRequestedCount } from "../../functions/_shared/leadEntityIntent.ts";
import { extractRequestedLeadCount, routeQualifiedLead } from "../../functions/_shared/qualifiedLeadRouting.ts";
import { isCompanyFirstRequest } from "../../functions/_shared/runAgentCompoundBridge.ts";
import { buildSourcingConstraints } from "../../functions/_shared/sourcingConstraints.ts";
import { compileHiringSourceInput } from "../../functions/_shared/actorInputPlanner.ts";

const CANONICAL =
  "Find 5 founders or CEOs of early-stage B2B SaaS companies in the United States "
  + "that are currently hiring for Sales Operations, Revenue Operations, or GTM Operations roles.";

const EXPECTED_HIRING_ROLES = ["Sales Operations", "Revenue Operations", "GTM Operations"];
const EXPECTED_DECISION_MAKERS = ["Founder", "Co-Founder", "CEO"];

// =========================================== the canonical mission, end to end ==

Deno.test("E2E canonical mission produces the full qualified-Lead contract", async () => {
  const route = routeQualifiedLead(CANONICAL);
  const intent = compileLeadEntityIntent(CANONICAL);
  const spec = intent.job_search_spec;

  // 19. routing is unchanged by this PR and still company-first.
  assertEquals(route.workflowKind, "qualified_lead_sourcing");
  assertEquals(route.executionMode, "company_first");
  assertEquals(route.countEntity, "contact_ready_lead");
  assertEquals(route.quotaPolicy, "contact_only");
  assertEquals(intent.execution_mode, "company_first");
  assert(isCompanyFirstRequest(intent));

  // 24. the CONTACT-only quota is five, read from the sentence that states it.
  assertEquals(intent.requested_count, 5);
  assertEquals(extractRequestedLeadCount(CANONICAL), 5);

  // 1./20. all three hiring roles, and the spec is no longer empty.
  assertEquals(spec.keyword_queries, EXPECTED_HIRING_ROLES);
  assertEquals(spec.job_families, ["sales_ops", "rev_ops", "gtm_ops"]);
  assertEquals(spec.compilation_status, "compiled");
  assertEquals(spec.insufficient_reason, null);

  // 2. the decision-makers are the people we will contact.
  assertEquals(spec.requested_person_roles, EXPECTED_DECISION_MAKERS);

  // 3. and the two sets never contaminate each other.
  const hiring = spec.keyword_queries.join(" ").toLowerCase();
  for (const dm of EXPECTED_DECISION_MAKERS) {
    assertFalse(hiring.includes(dm.toLowerCase()), `${dm} leaked into the job keywords`);
  }
  const people = spec.requested_person_roles.join(" ").toLowerCase();
  for (const role of EXPECTED_HIRING_ROLES) {
    assertFalse(people.includes(role.toLowerCase()), `${role} leaked into the decision-maker roles`);
  }

  // The exact failure signature this PR removes.
  assertFalse(spec.keyword_queries.length === 0);
  assertFalse(spec.job_families.length === 0);
  assert(spec.insufficient_reason !== "no_hiring_role_phrase");
});

Deno.test("21./22. the ordered planner and provider compiler receive the roles", async () => {
  const intent = compileLeadEntityIntent(CANONICAL);
  const constraints = await buildSourcingConstraints(intent);

  // 21. the source planner's hard constraints carry all three families' titles.
  assertEquals(constraints.hard.jobFamilyKey, "sales_operations");
  assertEquals(constraints.hard.requestedTitles, EXPECTED_HIRING_ROLES);
  // 23. Company Brain-facing constraints are unchanged by this PR.
  assertEquals(constraints.hard.requestedPersonRoles, EXPECTED_DECISION_MAKERS);
  assertEquals(constraints.hard.geography, "United States");
  assertEquals(constraints.hard.companyVertical, "saas");
  assertEquals(constraints.hard.requireCurrentEmployerVerification, true);

  // 22. and the Actor input compiles to an approved, non-empty query.
  for (const k of [
    "APIFY_ENABLE_INDEED_JOBS_AUTOMATION_LAB", "APIFY_ENABLE_LINKEDIN_JOBS_CRAWLWORKS",
    "APIFY_ENABLE_GLASSDOOR_JOBS", "APIFY_ENABLE_YC_JOBS",
  ]) Deno.env.set(k, "1");

  const compiled = await compileHiringSourceInput({
    capability: "indeed_job_discovery",
    titleAliases: intent.job_search_spec.keyword_queries,
    roleFamily: "revenue_operations",
    geography: intent.job_search_spec.location,
    candidateTarget: 25,
  } as never);
  assert(compiled.ok, "the provider input must compile from the parsed roles");
  const query = String((compiled.input as Record<string, unknown>).query ?? "");
  for (const role of EXPECTED_HIRING_ROLES) assert(query.includes(role), `${role} missing from the query`);
});

// ================================================= hiring-role list shapes ====

Deno.test("4./5./6./7. bounded role lists parse in every separator shape", () => {
  const shapes: Array<[string, string[]]> = [
    ["companies hiring Sales Operations", ["Sales Operations"]],
    ["companies hiring Sales Operations or Revenue Operations", ["Sales Operations", "Revenue Operations"]],
    ["companies hiring for Sales Operations, Revenue Operations, or GTM Operations",
      ["Sales Operations", "Revenue Operations", "Gtm Operations"]],
    ["companies hiring for Sales Operations, Revenue Operations and GTM Operations",
      ["Sales Operations", "Revenue Operations", "Gtm Operations"]],
    ["companies hiring Revenue Operations / GTM Operations", ["Revenue Operations", "Gtm Operations"]],
    ["companies hiring Sales Operations and RevOps roles", ["Sales Operations", "Revops"]],
  ];
  for (const [text, expected] of shapes) {
    assertEquals(extractHiringRolePhrases(text), expected, text);
    // Every shape compiles to the curated, gate-approved Sales-Ops set.
    const spec = compileJobSearchSpec({ text, hiringSignalRequired: true, requestedPersonRole: "founder" });
    assertEquals(spec.keyword_queries, EXPECTED_HIRING_ROLES, text);
    assertEquals(spec.compilation_status, "compiled", text);
  }
});

Deno.test("4.B a non-ops role list still parses, and is not widened", () => {
  assertEquals(
    extractHiringRolePhrases("companies hiring for Account Executives and Sales Development Representatives"),
    ["Account Executive", "Sales Development Representative"],
  );
  const spec = compileJobSearchSpec({
    text: "companies hiring Software Engineers", hiringSignalRequired: true, requestedPersonRole: "founder",
  });
  assertEquals(spec.keyword_queries, ["Software Engineer"]);
});

Deno.test("8./9. narrative prose and unapproved phrases never become roles", () => {
  for (const text of [
    "companies hiring because they are growing fast and need more people to help with everything",
    "companies hiring for a really exciting once in a lifetime adventure position",
    "companies hiring right now",
  ]) {
    assertEquals(extractHiringRolePhrases(text), [], text);
    assertEquals(extractHiringRolePhrase(text), null, text);
    const spec = compileJobSearchSpec({ text, hiringSignalRequired: true, requestedPersonRole: "founder" });
    assertEquals(spec.compilation_status, "insufficient", text);
    assertEquals(spec.insufficient_reason, "no_hiring_role_phrase", text);
  }
});

Deno.test("10. the parser stays bounded", () => {
  // More roles than the ceiling: the list is truncated, never unbounded.
  const many = "companies hiring Sales Operations, Revenue Operations, GTM Operations, "
    + "Marketing Operations, Business Operations, Finance Operations";
  const roles = extractHiringRolePhrases(many);
  assertEquals(roles.length, MAX_HIRING_ROLES);

  // A single segment longer than a title is dropped rather than truncated.
  assertEquals(
    extractHiringRolePhrases("companies hiring a very senior global revenue operations transformation manager"),
    [],
  );

  // Duplicates collapse.
  assertEquals(
    extractHiringRolePhrases("companies hiring Sales Operations, Sales Operations, Sales Operations"),
    ["Sales Operations"],
  );
});

Deno.test("3.B the singular extractor is the head of the plural one", () => {
  const text = "companies hiring for Sales Operations, Revenue Operations, or GTM Operations";
  assertEquals(extractHiringRolePhrase(text), extractHiringRolePhrases(text)[0]);
});

// ==================================================== entity-aware quotas =====

Deno.test("11./12. person-oriented quotas are recognised, digits and words", () => {
  assertEquals(extractRequestedLeadCount("Find 5 founders of SaaS companies."), 5);
  assertEquals(extractRequestedLeadCount("Find five CEOs of SaaS companies."), 5);
  assertEquals(extractRequestedLeadCount("Return 5 qualified leads"), 5);
  assertEquals(extractRequestedLeadCount("Give me 10 CONTACT-ready contacts"), 10);
  assertEquals(extractRequestedLeadCount("I need 5 decision-makers"), 5);
  assertEquals(extractRequestedLeadCount("Find founders of SaaS startups and return 5"), 5);
});

Deno.test("13./14./15./16. measurements never become the quota", () => {
  const cases: Array<[string, number | null]> = [
    // 13. the stated quota wins over an earlier employee range.
    ["Find founders at companies with 10-100 employees. Return 5 leads.", 5],
    ["Find CEOs at Series 2 startups and return 5 contacts.", 5],
    ["Find companies hiring within 30 days and return 5 founders.", 5],
    // 14./15./16. with NO stated quota, a measurement is not promoted to one.
    ["Find founders at companies with 10-100 employees.", null],
    ["Find founders at companies hiring within 30 days.", null],
    ["Find CEOs at Series 3 startups.", null],
    ["Find founders at companies with $5 million ARR.", null],
  ];
  for (const [text, expected] of cases) {
    assertEquals(compileLeadEntityIntent(text).requested_count, expected, text);
  }
});

Deno.test("11.B a person request does not count companies as people", () => {
  // "20 companies" is where to look, not how many people to return.
  assertEquals(compileLeadEntityIntent("Find founders at 20 companies.").requested_count, null);
  assertEquals(extractRequestedLeadCount("Find founders at 20 companies."), null);
  // But an explicit person quota alongside it is still read.
  assertEquals(compileLeadEntityIntent("Find 5 founders at 20 companies.").requested_count, 5);
});

Deno.test("17./18. account and job requests keep their own semantics", () => {
  // 17. a company request may still be counted in companies.
  const account = compileLeadEntityIntent("Find 20 companies hiring Sales Operations.");
  assertEquals(account.target_entity, "company");
  assertEquals(account.requested_count, 20);
  assertEquals(routeQualifiedLead("Show companies hiring Sales Operations.").workflowKind,
    "account_opportunity_sourcing");

  // 18. a job request stays job-first and is unaffected by the person rules.
  const jobs = compileLeadEntityIntent("Find recent Sales Operations job postings in Texas.");
  assertEquals(jobs.target_entity, "job");
  assertEquals(jobs.execution_mode, "job_first");
  assertEquals(routeQualifiedLead("Find recent Revenue Operations jobs.").workflowKind,
    "account_opportunity_sourcing");
});

Deno.test("11.C the generic fallback still serves an ordinary short ask", () => {
  // No entity noun directly after the number, no disqualifying unit: unchanged.
  assertEquals(compileLeadEntityIntent("Find 10 saas founders.").requested_count, 10);
  assertEquals(resolveRequestedCount("Find 10 saas founders.", "person"), 10);
});

// ============================================================== no I/O ========

Deno.test("25. no live model or provider call occurs", async () => {
  const originalFetch = globalThis.fetch;
  let attempted = 0;
  globalThis.fetch = ((..._a: unknown[]) => {
    attempted += 1;
    return Promise.reject(new Error("no network is permitted in this test"));
  }) as typeof fetch;
  try {
    const intent = compileLeadEntityIntent(CANONICAL);
    await buildSourcingConstraints(intent);
    extractHiringRolePhrases(CANONICAL);
    extractRequestedLeadCount(CANONICAL);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(attempted, 0);
});
