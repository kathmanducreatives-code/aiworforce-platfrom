// END-TO-END PROOF FOR THE CANONICAL QUERY — against the REAL executor.
//
// These tests call `executeCompanyFirstRoute`, the same function run-agent
// calls. Only the provider boundary is mocked (the injected `invoke`), so the
// ordering, gating and hand-offs under test are the production ones. ZERO
// network, ZERO paid Actor runs.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { executeCompanyFirstRoute } from "../../functions/_shared/companyFirstRouteExecutor.ts";
import { newRouteExecutionRecord, validateHiringRoute } from "../../functions/_shared/hiringRouteContract.ts";
import { SALES_OPS_PACK } from "../../functions/_shared/hiringRolePackFilter.ts";

const CANONICAL =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
const LI = (s: string) => `https://www.linkedin.com/company/${s}`;

/** A recorder that captures the exact order of Actor calls. */
function harness(rows: Record<string, Record<string, unknown>[]>) {
  const calls: Array<{ actor: string; input: Record<string, unknown> }> = [];
  return {
    calls,
    invoke: (call: { actorKey: string; input: unknown }) => {
      calls.push({ actor: call.actorKey, input: call.input as Record<string, unknown> });
      return Promise.resolve(rows[call.actorKey] ?? []);
    },
    order: () => calls.map((c) => c.actor),
  };
}

const YC_COMPANY = (over: Record<string, unknown> = {}) => ({
  id: 901, name: "Trademo", slug: "trademo", website: "https://trademo.com",
  batch: "Winter 2020", teamSize: 1, industry: "B2B", isHiring: true,
  regions: ["United States of America"], allLocations: "San Francisco, CA, USA",
  longDescription: "Supply chain intelligence platform for enterprises.",
  status: "Active", scrapedAt: "2026-08-01T00:00:00Z",
  openJobs: [{ jobId: 1, title: "Applied AI Engineer", url: "https://x/1", location: "SF" }],
  ...over,
});

const ENRICHED = (over: Record<string, unknown> = {}) => ({
  id: "54149342", name: "Trademo", linkedinUrl: LI("trademo"),
  website: "https://trademo.com", description: "Supply chain intelligence platform.",
  employeeCount: 147, employeeCountRange: { start: 51, end: 200 },
  industries: [{ id: "4", name: "Software Development",
    hierarchy: "Technology > Software Development" }],
  companyType: "Privately Held", locations: [{ linkedinText: "San Francisco, CA" }],
  ...over,
});

const JOB = (over: Record<string, unknown> = {}) => ({
  id: "j1", title: "Sales Operations Manager", linkedinUrl: "https://li/job/1",
  company: { id: "54149342", name: "Trademo", linkedinUrl: LI("trademo"), website: "https://trademo.com" },
  location: { linkedinText: "United States" }, workplaceType: "remote",
  postedDate: "2026-07-30T00:00:00Z", descriptionText: "Own our revenue systems.",
  ...over,
});

const PERSON = (over: Record<string, unknown> = {}) => ({
  id: "PROFILE_1", linkedinUrl: "https://www.linkedin.com/in/PROFILE_1",
  firstName: "Ada", lastName: "Nakamura",
  currentPositions: [{ title: "Founder & CEO", companyName: "Trademo",
    companyLinkedinUrl: LI("trademo"), current: true, tenureAtCompany: { numYears: 6 } }],
  ...over,
});

function routeFor(userRequest = CANONICAL) {
  const v = validateHiringRoute({ route: "startup_company_first" }, { userRequest });
  assert(v.ok);
  if (!v.ok) throw new Error("route must validate");
  return { route: v, routeRecord: newRouteExecutionRecord(v, []) };
}

const verifyEmployerReal = (p: { current_employer_linkedin_url: string | null; current_employer_is_current: boolean | null }, url: string) => ({
  verified: !!p.current_employer_linkedin_url &&
    p.current_employer_linkedin_url.toLowerCase() === url.toLowerCase() &&
    p.current_employer_is_current === true,
  outcome: "verified_match",
});

// ═══ THE CANONICAL QUERY, END TO END ═══════════════════════════════════════
Deno.test("canonical query: memo23 first, then enrich, gate, verify hiring, then founders", async () => {
  const h = harness({
    apify_yc_companies_memo23: [YC_COMPANY()],
    apify_linkedin_company_details: [ENRICHED()],
    apify_linkedin_job_search: [JOB()],
    apify_linkedin_company_employees: [PERSON()],
  });
  const { route, routeRecord } = routeFor();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyEmployerReal as never },
    { route, routeRecord, requestedLeadCount: 5, taskId: "t1", workspaceId: "w1",
      brain: { employee_min: 1, employee_max: 200,
        positive_industries: ["software development"], excluded_industries: [] },
      rolePacks: [SALES_OPS_PACK] },
  );

  const order = h.order();

  // 1. THE PRIMARY YC ACTOR RUNS FIRST — not a job board.
  assertEquals(order[0], "apify_yc_companies_memo23");

  // 2. No broad job board executed at all on this route.
  for (const broad of ["apify_indeed_jobs", "apify_glassdoor_jobs",
    "apify_jobs", "apify_indeed_jobs_automation_lab", "apify_linkedin_jobs_crawlworks"]) {
    assertFalse(order.includes(broad), `${broad} must not run for a tight ICP`);
  }

  // 3. ENRICHMENT ran, and ran BEFORE any hiring verification.
  const enrichAt = order.indexOf("apify_linkedin_company_details");
  const jobsAt = order.indexOf("apify_linkedin_job_search");
  const foundersAt = order.indexOf("apify_linkedin_company_employees");
  assert(enrichAt > -1, "enrichment is mandatory");
  assert(jobsAt > enrichAt, "hiring verification must follow enrichment");
  assert(foundersAt > jobsAt, "founder search must follow hiring verification");

  // 4. Enriched evidence — not YC teamSize — reached Company Brain.
  assertEquals(res.diagnostics.company_brain.evidence_source.enriched_linkedin_company, 1);
  assertEquals(res.diagnostics.company_brain.pass, 1);
  assertEquals(res.diagnostics.enrichment.completed, 1);

  // 5. The funnel progressed all the way to a contact-ready record.
  assertEquals(res.funnel.company_fit_pass, 1);
  assertEquals(res.funnel.hiring_verified, 1);
  assertEquals(res.funnel.qualified_companies, 1);
  assertEquals(res.funnel.founder_verified, 1);

  // 6. The founder Actor received the CORRECT field and enum.
  const fCall = h.calls.find((c) => c.actor === "apify_linkedin_company_employees")!;
  assertEquals(fCall.input.profileScraperMode, "Short ($4 per 1k)");
  assertEquals(fCall.input.maxItemsPerCompany, 5);
  assertFalse(JSON.stringify(fCall.input).includes("email search"), "no email mode");

  // 7. The executed route matches the validated route.
  assertEquals(res.executed_source_order[0], "apify_yc_companies_memo23");
  assertEquals(res.diagnostics.route.executed, "startup_company_first");
  assertEquals(res.diagnostics.route.fallback_reason, null);
});

// ═══ THE GATES ACTUALLY STOP THINGS ════════════════════════════════════════
Deno.test("a company-fit reject never reaches job verification or founder search", async () => {
  const h = harness({
    apify_yc_companies_memo23: [YC_COMPANY()],
    // Enriched headcount 4642 — far outside the 1-200 ICP band.
    apify_linkedin_company_details: [ENRICHED({ employeeCount: 4642 })],
    apify_linkedin_job_search: [JOB()],
    apify_linkedin_company_employees: [PERSON()],
  });
  const { route, routeRecord } = routeFor();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyEmployerReal as never },
    { route, routeRecord, requestedLeadCount: 5, taskId: "t2", workspaceId: "w1",
      brain: { employee_min: 1, employee_max: 200 }, rolePacks: [SALES_OPS_PACK] },
  );
  assertEquals(res.diagnostics.company_brain.reject, 1);
  assertFalse(h.order().includes("apify_linkedin_job_search"),
    "a reject must not cost a job-search call");
  assertFalse(h.order().includes("apify_linkedin_company_employees"),
    "a reject must not cost a founder call");
  assertEquals(res.funnel.qualified_companies, 0);
  assert(res.diagnostics.company_brain.failed_gates.employee_count_above_max === 1);
});

Deno.test("a staffing/aggregator company is rejected before any paid verification", async () => {
  const h = harness({
    apify_yc_companies_memo23: [YC_COMPANY({ name: "Swooped" })],
    apify_linkedin_company_details: [ENRICHED({
      name: "Swooped", employeeCount: 23,
      industries: [{ id: "104", name: "Staffing and Recruiting",
        hierarchy: "Administrative and Support Services > Staffing and Recruiting" }],
    })],
    apify_linkedin_job_search: [JOB()],
  });
  const { route, routeRecord } = routeFor();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyEmployerReal as never },
    { route, routeRecord, requestedLeadCount: 5, taskId: "t3", workspaceId: "w1",
      brain: { employee_min: 1, employee_max: 200 }, rolePacks: [SALES_OPS_PACK] },
  );
  assertEquals(res.diagnostics.company_brain.reject, 1);
  assert(res.diagnostics.company_brain.failed_gates.staffing_or_aggregator === 1);
  assertFalse(h.order().includes("apify_linkedin_job_search"));
});

// ═══ YC JOB EVIDENCE AVOIDS A PAID CALL ════════════════════════════════════
Deno.test("a matching YC open job proves hiring without paying for job-search", async () => {
  const h = harness({
    apify_yc_companies_memo23: [YC_COMPANY({
      openJobs: [{ jobId: 7, title: "Sales Operations Manager", url: "https://x/7", location: "SF" }],
    })],
    apify_linkedin_company_details: [ENRICHED()],
    apify_linkedin_company_employees: [PERSON()],
  });
  const { route, routeRecord } = routeFor();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyEmployerReal as never },
    { route, routeRecord, requestedLeadCount: 5, taskId: "t4", workspaceId: "w1",
      brain: { employee_min: 1, employee_max: 200 }, rolePacks: [SALES_OPS_PACK] },
  );
  assertEquals(res.diagnostics.hiring.yc_jobs_sufficient, 1);
  assertEquals(res.diagnostics.hiring.job_search_calls, 0,
    "already-paid YC evidence must not trigger a second paid call");
  assertEquals(res.funnel.qualified_companies, 1);
});

Deno.test("a non-matching YC job escalates to restricted job-search", async () => {
  const h = harness({
    apify_yc_companies_memo23: [YC_COMPANY()],   // Applied AI Engineer only
    apify_linkedin_company_details: [ENRICHED()],
    apify_linkedin_job_search: [JOB()],
    apify_linkedin_company_employees: [PERSON()],
  });
  const { route, routeRecord } = routeFor();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyEmployerReal as never },
    { route, routeRecord, requestedLeadCount: 5, taskId: "t5", workspaceId: "w1",
      brain: { employee_min: 1, employee_max: 200 }, rolePacks: [SALES_OPS_PACK] },
  );
  assertEquals(res.diagnostics.hiring.yc_jobs_sufficient, 0);
  assertEquals(res.diagnostics.hiring.job_search_calls, 1);
  const jc = h.calls.find((c) => c.actor === "apify_linkedin_job_search")!;
  assert((jc.input.company as string[]).length <= 10, "batch must never exceed 10 companies");
  assertEquals(jc.input.postedLimit, "month");
});

// ═══ FUZZY TITLES ARE POST-FILTERED IN THE REAL PATH ══════════════════════
Deno.test("a fuzzy Actor title does not become a hiring signal", async () => {
  const h = harness({
    apify_yc_companies_memo23: [YC_COMPANY()],
    apify_linkedin_company_details: [ENRICHED()],
    // The Actor's real fuzzy behaviour: an Account Manager for a Sales Ops query.
    apify_linkedin_job_search: [JOB({ title: "Enterprise Account Manager (Aviation)" })],
  });
  const { route, routeRecord } = routeFor();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyEmployerReal as never },
    { route, routeRecord, requestedLeadCount: 5, taskId: "t6", workspaceId: "w1",
      brain: { employee_min: 1, employee_max: 200 }, rolePacks: [SALES_OPS_PACK] },
  );
  assertEquals(res.funnel.hiring_verified, 0, "a fuzzy match must not verify hiring");
  assertEquals(res.funnel.qualified_companies, 0);
  assertFalse(h.order().includes("apify_linkedin_company_employees"),
    "no founder credit may be spent on an unverified company");
});

// ═══ IDENTITY ══════════════════════════════════════════════════════════════
Deno.test("an unresolvable YC identity becomes pending, never a silent reject", async () => {
  const h = harness({
    apify_yc_companies_memo23: [YC_COMPANY({ website: null })],
    apify_linkedin_company_details: [],   // lookup finds nothing
  });
  const { route, routeRecord } = routeFor();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyEmployerReal as never },
    { route, routeRecord, requestedLeadCount: 5, taskId: "t7", workspaceId: "w1",
      rolePacks: [SALES_OPS_PACK] },
  );
  assertEquals(res.diagnostics.identity.verified, 0);
  assertEquals(res.funnel.company_fit_pending, 1, "pending, not rejected");
  assertEquals(res.diagnostics.company_brain.reject, 0);
  assertEquals(res.diagnostics.enrichment.skipped_unresolved, 1,
    "an unresolved identity must not be enriched or searched");
});

// ═══ IDEMPOTENCY ══════════════════════════════════════════════════════════
Deno.test("a resumed task does not re-pay for completed calls", async () => {
  const done = new Set<string>();
  const mk = () => harness({
    apify_yc_companies_memo23: [YC_COMPANY()],
    apify_linkedin_company_details: [ENRICHED()],
    apify_linkedin_company_employees: [PERSON()],
  });
  const opts = () => {
    const { route, routeRecord } = routeFor();
    return { route, routeRecord, requestedLeadCount: 5, taskId: "t8", workspaceId: "w1",
      brain: { employee_min: 1, employee_max: 200 }, rolePacks: [SALES_OPS_PACK] };
  };
  const h1 = mk();
  await executeCompanyFirstRoute({
    invoke: h1.invoke as never, verifyEmployer: verifyEmployerReal as never,
    callCompleted: (k) => done.has(k), onCallComplete: (k) => done.add(k),
  }, opts());
  const firstCallCount = h1.calls.length;
  assert(firstCallCount > 0);

  const h2 = mk();
  const res2 = await executeCompanyFirstRoute({
    invoke: h2.invoke as never, verifyEmployer: verifyEmployerReal as never,
    callCompleted: (k) => done.has(k), onCallComplete: (k) => done.add(k),
  }, opts());
  assertEquals(h2.calls.length, 0, "a resume must not repeat completed paid calls");
  assert(res2.diagnostics.skipped_calls.length > 0, "skips must be observable");
});

// ═══ COST IS AN ESTIMATE, NOT BILLING ═════════════════════════════════════
Deno.test("cost is reported as a compiler estimate, never as account spend", async () => {
  const h = harness({ apify_yc_companies_memo23: [YC_COMPANY()],
    apify_linkedin_company_details: [ENRICHED()] });
  const { route, routeRecord } = routeFor();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyEmployerReal as never },
    { route, routeRecord, requestedLeadCount: 5, taskId: "t9", workspaceId: "w1",
      rolePacks: [SALES_OPS_PACK] },
  );
  assert(res.diagnostics.cost.estimated_max_usd > 0);
  assert(res.diagnostics.cost.note.includes("NOT authoritative account spend"));
});
