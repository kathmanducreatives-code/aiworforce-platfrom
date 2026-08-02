// GENERAL ROUTE + CANONICAL PERSISTENCE + QUOTA — end to end, offline.
//
// These drive the REAL executor and the REAL projection that run-agent feeds to
// `persistPlan`. Only the provider boundary is mocked. ZERO paid Actor runs.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { executeCompanyFirstRoute } from "../../supabase/functions/_shared/companyFirstRouteExecutor.ts";
import {
  projectCompanyFirstPersistence, quotaCreditFromProjection,
} from "../../supabase/functions/_shared/companyFirstPersistenceProjection.ts";
import { newRouteExecutionRecord, validateHiringRoute } from "../../supabase/functions/_shared/hiringRouteContract.ts";
import { REVENUE_OPS_PACK, SALES_OPS_PACK } from "../../supabase/functions/_shared/hiringRolePackFilter.ts";

const LI = (s: string) => `https://www.linkedin.com/company/${s}`;
const GENERAL_QUERY =
  "Find founders of US cybersecurity companies with 11-200 employees hiring Revenue Operations.";

function harness(rows: Record<string, Record<string, unknown>[]>) {
  const calls: Array<{ actor: string; input: Record<string, unknown> }> = [];
  return {
    calls,
    invoke: (c: { actorKey: string; input: unknown }) => {
      calls.push({ actor: c.actorKey, input: c.input as Record<string, unknown> });
      return Promise.resolve(rows[c.actorKey] ?? []);
    },
    order: () => calls.map((c) => c.actor),
  };
}

const CANDIDATE = (over: Record<string, unknown> = {}) => ({
  id: "77", name: "Sentinel Systems", linkedinUrl: LI("sentinel-systems"),
  website: "https://sentinel.example", description: "Threat detection platform.",
  // short mode: employeeCount is null and the range is untrustworthy.
  employeeCount: null, employeeCountRange: { start: 11, end: 50 },
  industry: "Computer and Network Security", ...over,
});

const ENRICHED = (over: Record<string, unknown> = {}) => ({
  id: "77", name: "Sentinel Systems", linkedinUrl: LI("sentinel-systems"),
  website: "https://sentinel.example", description: "Threat detection platform for enterprises.",
  employeeCount: 120, employeeCountRange: { start: 11, end: 50 },
  industries: [{ id: "118", name: "Computer and Network Security",
    hierarchy: "Technology > Computer and Network Security" }],
  companyType: "Privately Held", locations: [{ linkedinText: "Austin, Texas" }], ...over,
});

const JOB = (over: Record<string, unknown> = {}) => ({
  id: "j9", title: "Revenue Operations Manager", linkedinUrl: "https://li/job/9",
  company: { id: "77", name: "Sentinel Systems", linkedinUrl: LI("sentinel-systems") },
  location: { linkedinText: "United States" }, postedDate: "2026-07-29T00:00:00Z",
  descriptionText: "Own our revenue systems and forecasting.", ...over,
});

const FOUNDER = (over: Record<string, unknown> = {}) => ({
  id: "PROFILE_9", linkedinUrl: "https://www.linkedin.com/in/PROFILE_9",
  firstName: "Bo", lastName: "Okafor",
  currentPositions: [{ title: "Co-Founder", companyName: "Sentinel Systems",
    companyLinkedinUrl: LI("sentinel-systems"), current: true,
    tenureAtCompany: { numYears: 4 } }], ...over,
});

const verifyReal = (p: { current_employer_linkedin_url: string | null; current_employer_is_current: boolean | null }, url: string) => ({
  verified: !!p.current_employer_linkedin_url &&
    p.current_employer_linkedin_url.toLowerCase() === url.toLowerCase() &&
    p.current_employer_is_current === true,
  outcome: "verified_match",
});

function generalRoute() {
  const v = validateHiringRoute({ route: "general_company_first" }, { userRequest: GENERAL_QUERY });
  assert(v.ok);
  if (!v.ok) throw new Error("route");
  return { route: v, routeRecord: newRouteExecutionRecord(v, []) };
}

const generalOpts = (over: Record<string, unknown> = {}) => ({
  requestedLeadCount: 5, taskId: "g1", workspaceId: "w1",
  brain: { employee_min: 11, employee_max: 200,
    positive_industries: ["computer and network security"], excluded_industries: [] },
  rolePacks: [REVENUE_OPS_PACK],
  generalLocations: ["United States"], generalIndustryIds: ["118"],
  generalCompanySizes: ["11-50", "51-200"], ...over,
});

// ═══ B. GENERAL COMPANY QUERY, END TO END ══════════════════════════════════
Deno.test("B. general route: company-search -> enrichment -> Brain -> jobs -> founder -> CONTACT", async () => {
  const h = harness({
    apify_linkedin_company_search: [CANDIDATE()],
    apify_linkedin_company_details: [ENRICHED()],
    apify_linkedin_job_search: [JOB()],
    apify_linkedin_company_employees: [FOUNDER()],
  });
  const { route, routeRecord } = generalRoute();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyReal as never },
    { route, routeRecord, ...generalOpts() } as never,
  );
  const order = h.order();

  // company-search runs, and runs FIRST — never a job board.
  assertEquals(order[0], "apify_linkedin_company_search");
  for (const broad of ["apify_indeed_jobs", "apify_glassdoor_jobs", "apify_jobs"]) {
    assertFalse(order.includes(broad));
  }
  // Enrichment before hiring verification, hiring before founders.
  const enr = order.indexOf("apify_linkedin_company_details");
  const job = order.indexOf("apify_linkedin_job_search");
  const fnd = order.indexOf("apify_linkedin_company_employees");
  assert(enr > -1 && job > enr && fnd > job);

  // ENRICHED evidence reached the Brain — not the candidate's null count.
  assertEquals(res.diagnostics.company_brain.evidence_source.enriched_linkedin_company, 1);
  assertEquals(res.diagnostics.company_brain.pass, 1);
  assertEquals(res.funnel.qualified_companies, 1);
  assertEquals(res.funnel.founder_verified, 1);

  // The job batch respected the verified limit and kept the pack separate.
  const jc = h.calls.find((c) => c.actor === "apify_linkedin_job_search")!;
  assert((jc.input.company as string[]).length <= 10);
  assertEquals((jc.input.jobTitles as string[])[0], REVENUE_OPS_PACK.titles[0]);

  // ── CANONICAL PERSISTENCE + QUOTA ──────────────────────────────────────
  const proj = projectCompanyFirstPersistence(res, "w1", "g1");
  assertEquals(proj.counts.people_projected, 1);
  assertEquals(proj.counts.contact_ready, 1);
  assertEquals(quotaCreditFromProjection(proj), 1, "one CONTACT counts once");
  const person = proj.plans.find((p) => p.plan.leadCandidate.lead_type === "person")!;
  assertEquals(person.plan.verdict, "CONTACT");
  assertEquals(person.plan.contactBlocked, false, "CONTACT must reach contact enrichment");
  assert(person.plan.persistable);
  assert(person.plan.leadCandidate.reason?.includes("Revenue Operations Manager"),
    "the reason-to-contact must be grounded in the observed job");
  // Both provenances survive persistence.
  const raw = person.plan.leadCandidate.raw as Record<string, unknown>;
  assert(raw.discovery_evidence && raw.enrichment_evidence);
});

Deno.test("B2. a candidate that cannot be enriched never passes the Brain on discovery evidence", async () => {
  const h = harness({
    apify_linkedin_company_search: [CANDIDATE()],
    apify_linkedin_company_details: [],       // enrichment returns nothing
    apify_linkedin_job_search: [JOB()],
  });
  const { route, routeRecord } = generalRoute();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyReal as never },
    { route, routeRecord, ...generalOpts() } as never,
  );
  // The candidate's own employeeCountRange 11-50 would have "satisfied" the
  // size band. Without enrichment it must NOT pass.
  assertEquals(res.diagnostics.company_brain.pass, 0);
  assertEquals(res.diagnostics.company_brain.pending, 1, "pending, not a false reject");
  assertFalse(h.order().includes("apify_linkedin_job_search"));
  assertEquals(quotaCreditFromProjection(
    projectCompanyFirstPersistence(res, "w1", "g2")), 0);
});

// ═══ QUOTA: PROGRESS IS NOT A LEAD ════════════════════════════════════════
Deno.test("a qualified company with no founder is persisted but never counts", async () => {
  const h = harness({
    apify_linkedin_company_search: [CANDIDATE()],
    apify_linkedin_company_details: [ENRICHED()],
    apify_linkedin_job_search: [JOB()],
    apify_linkedin_company_employees: [],     // no founder found
  });
  const { route, routeRecord } = generalRoute();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyReal as never },
    { route, routeRecord, ...generalOpts() } as never,
  );
  assertEquals(res.funnel.qualified_companies, 1);
  const proj = projectCompanyFirstPersistence(res, "w1", "g3");
  assertEquals(proj.counts.accounts_projected, 1, "the qualified company IS persisted");
  const acct = proj.plans[0];
  assert(acct.plan.persistable, "it must stay visible in the Workbench");
  assertEquals(acct.plan.verdict, "WATCH");
  assertEquals(acct.quotaEligible, false);
  assertEquals(quotaCreditFromProjection(proj), 0,
    "a qualified company is progress, not a lead");
});

Deno.test("an employer mismatch never becomes CONTACT and never reaches enrichment", async () => {
  const h = harness({
    apify_linkedin_company_search: [CANDIDATE()],
    apify_linkedin_company_details: [ENRICHED()],
    apify_linkedin_job_search: [JOB()],
    // The person's current employer is a DIFFERENT company.
    apify_linkedin_company_employees: [FOUNDER({
      currentPositions: [{ title: "Co-Founder", companyName: "Other Co",
        companyLinkedinUrl: LI("other-co"), current: true }],
    })],
  });
  const { route, routeRecord } = generalRoute();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyReal as never },
    { route, routeRecord, ...generalOpts() } as never,
  );
  assertEquals(res.funnel.founder_mismatch, 1);
  assertEquals(res.funnel.founder_verified, 0);
  const proj = projectCompanyFirstPersistence(res, "w1", "g4");
  assertEquals(proj.counts.contact_ready, 0);
  assertEquals(quotaCreditFromProjection(proj), 0);
  for (const p of proj.plans) {
    assert(p.plan.contactBlocked, "a mismatch must never reach contact enrichment");
  }
});

// ═══ NEGATIVE GATES ON THE GENERAL ROUTE ══════════════════════════════════
Deno.test("a staffing company on the general route never reaches job verification", async () => {
  const h = harness({
    apify_linkedin_company_search: [CANDIDATE({ name: "Swooped" })],
    apify_linkedin_company_details: [ENRICHED({
      name: "Swooped", employeeCount: 23,
      industries: [{ id: "104", name: "Staffing and Recruiting",
        hierarchy: "Administrative and Support Services > Staffing and Recruiting" }],
    })],
    apify_linkedin_job_search: [JOB()],
  });
  const { route, routeRecord } = generalRoute();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyReal as never },
    { route, routeRecord, ...generalOpts({ brain: { employee_min: 11, employee_max: 200 } }) } as never,
  );
  assert(res.diagnostics.company_brain.failed_gates.staffing_or_aggregator === 1);
  assertFalse(h.order().includes("apify_linkedin_job_search"));
  assertEquals(quotaCreditFromProjection(
    projectCompanyFirstPersistence(res, "w1", "g5")), 0);
});

Deno.test("a fuzzy Account Manager result does not verify hiring on the general route", async () => {
  const h = harness({
    apify_linkedin_company_search: [CANDIDATE()],
    apify_linkedin_company_details: [ENRICHED()],
    apify_linkedin_job_search: [JOB({ title: "Enterprise Account Manager" })],
  });
  const { route, routeRecord } = generalRoute();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyReal as never },
    { route, routeRecord, ...generalOpts() } as never,
  );
  assertEquals(res.funnel.hiring_verified, 0);
  assertFalse(h.order().includes("apify_linkedin_company_employees"));
});

Deno.test("packs stay separate: a Sales Ops posting does not satisfy a Revenue Ops mission", async () => {
  const h = harness({
    apify_linkedin_company_search: [CANDIDATE()],
    apify_linkedin_company_details: [ENRICHED()],
    apify_linkedin_job_search: [JOB({ title: "Sales Operations Manager" })],
  });
  const { route, routeRecord } = generalRoute();
  const res = await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyReal as never },
    { route, routeRecord, ...generalOpts() } as never,   // RevOps pack only
  );
  assertEquals(res.funnel.hiring_verified, 0,
    "a different buying centre must not satisfy this mission");
});

// ═══ DISCOVERY DISCIPLINE ═════════════════════════════════════════════════
Deno.test("general discovery never sends a concept phrase as searchQuery", async () => {
  const h = harness({ apify_linkedin_company_search: [CANDIDATE()],
    apify_linkedin_company_details: [ENRICHED()] });
  const { route, routeRecord } = generalRoute();
  await executeCompanyFirstRoute(
    { invoke: h.invoke as never, verifyEmployer: verifyReal as never },
    { route, routeRecord, ...generalOpts() } as never,
  );
  const disc = h.calls.find((c) => c.actor === "apify_linkedin_company_search")!;
  assertEquals(disc.input.searchQuery, undefined,
    "no searchQuery unless a literal company name was requested");
  assertEquals(disc.input.industryIds, ["118"]);
  assertEquals(disc.input.scraperMode, "short");
});

// ═══ RESUME ═══════════════════════════════════════════════════════════════
Deno.test("resume repeats no provider call and grants no second quota credit", async () => {
  const done = new Set<string>();
  const rows = {
    apify_linkedin_company_search: [CANDIDATE()],
    apify_linkedin_company_details: [ENRICHED()],
    apify_linkedin_job_search: [JOB()],
    apify_linkedin_company_employees: [FOUNDER()],
  };
  const run = async () => {
    const h = harness(rows);
    const { route, routeRecord } = generalRoute();
    const res = await executeCompanyFirstRoute({
      invoke: h.invoke as never, verifyEmployer: verifyReal as never,
      callCompleted: (k) => done.has(k), onCallComplete: (k) => done.add(k),
    }, { route, routeRecord, ...generalOpts() } as never);
    return { h, credit: quotaCreditFromProjection(
      projectCompanyFirstPersistence(res, "w1", "g6")) };
  };
  const first = await run();
  assertEquals(first.credit, 1);
  assert(first.h.calls.length > 0);

  const second = await run();
  assertEquals(second.h.calls.length, 0, "a resume must repeat no paid call");
  assertEquals(second.credit, 0, "and must not grant the quota credit twice");
});
