// INTEGRATION PROOF — the REAL canonical persistPlan, with an isolated client.
//
// `createPersistPlan` is the same function run-agent builds and calls; only the
// Supabase client and the contact writer are doubles. Nothing here touches a
// network, a database or a paid Actor.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeCompanyFirstQuotaProgress, createPersistPlan, nextAdaptiveAction,
  type PersistedOutcome,
} from "../../../supabase/functions/_shared/qualifiedLeadPersistence.ts";
import { executeCompanyFirstRoute } from "../../../supabase/functions/_shared/companyFirstRouteExecutor.ts";
import { projectCompanyFirstPersistence } from "../../../supabase/functions/_shared/companyFirstPersistenceProjection.ts";
import { newRouteExecutionRecord, validateHiringRoute } from "../../../supabase/functions/_shared/hiringRouteContract.ts";
import { SALES_OPS_PACK } from "../../../supabase/functions/_shared/hiringRolePackFilter.ts";

const LI = (s: string) => `https://www.linkedin.com/company/${s}`;

/** An isolated client that records every write. No network, no SQL engine. */
function fakeDb(opts: { failLeadInsert?: boolean; existingAccountId?: string } = {}) {
  const writes: Array<{ table: string; row: Record<string, unknown> }> = [];
  const selects: Array<{ table: string; filters: Record<string, unknown> }> = [];
  let n = 0;
  return {
    writes, selects,
    rows: (t: string) => writes.filter((w) => w.table === t),
    client: {
      from(table: string) {
        return {
          select(_c: string) {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(c: string, v: unknown) { filters[c] = v; return chain; },
              maybeSingle() {
                selects.push({ table, filters });
                return Promise.resolve({
                  data: table === "accounts" && opts.existingAccountId
                    ? { id: opts.existingAccountId } : null,
                });
              },
            };
            return chain;
          },
          insert(row: Record<string, unknown>) {
            writes.push({ table, row });
            return {
              select: (_c: string) => ({
                maybeSingle: () => Promise.resolve({
                  data: table === "lead_candidates" && opts.failLeadInsert
                    ? null : { id: `${table}_${++n}` },
                }),
              }),
            };
          },
        };
      },
    },
  };
}

function contactWriterSpy() {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    fn: ((input: Record<string, unknown>) => {
      calls.push(input);
      return Promise.resolve({ ok: true });
    }) as never,
  };
}

// ── Build a real company-first result through the real executor ────────────
const YC = (over: Record<string, unknown> = {}) => ({
  id: 901, name: "Trademo", website: "https://trademo.com", batch: "W20",
  teamSize: 1, industry: "B2B", isHiring: true,
  regions: ["United States of America"], allLocations: "SF",
  longDescription: "Supply chain platform.", status: "Active",
  openJobs: [{ jobId: 7, title: "Sales Operations Manager", url: "https://x/7" }], ...over,
});
const ENR = (over: Record<string, unknown> = {}) => ({
  id: "54149342", name: "Trademo", linkedinUrl: LI("trademo"),
  website: "https://trademo.com", description: "Supply chain platform.",
  employeeCount: 147, employeeCountRange: { start: 51, end: 200 },
  industries: [{ id: "4", name: "Software Development", hierarchy: "T > Software Development" }],
  companyType: "Privately Held", locations: [{ linkedinText: "SF" }], ...over,
});
const FOUNDER = (over: Record<string, unknown> = {}) => ({
  id: "PROFILE_1", linkedinUrl: "https://www.linkedin.com/in/PROFILE_1",
  firstName: "Ada", lastName: "Nakamura",
  currentPositions: [{ title: "Founder & CEO", companyName: "Trademo",
    companyLinkedinUrl: LI("trademo"), current: true, tenureAtCompany: { numYears: 6 } }], ...over,
});

async function routeResult(rows: Record<string, Record<string, unknown>[]>) {
  const v = validateHiringRoute({ route: "startup_company_first" },
    { userRequest: "Find founders of SaaS startups hiring Sales Operations" });
  assert(v.ok);
  if (!v.ok) throw new Error("route");
  return await executeCompanyFirstRoute({
    invoke: ((c: { actorKey: string }) => Promise.resolve(rows[c.actorKey] ?? [])) as never,
    verifyEmployer: ((p: { current_employer_linkedin_url: string | null; current_employer_is_current: boolean | null }, url: string) => ({
      verified: p.current_employer_linkedin_url?.toLowerCase() === url.toLowerCase() &&
        p.current_employer_is_current === true,
      outcome: "verified_match",
    })) as never,
  }, {
    route: v, routeRecord: newRouteExecutionRecord(v, []),
    requestedLeadCount: 5, taskId: "t1", workspaceId: "w1",
    brain: { employee_min: 1, employee_max: 200,
      positive_industries: ["software development"], excluded_industries: [] },
    rolePacks: [SALES_OPS_PACK],
  });
}

// ═══ A. FULLY SUCCESSFUL RESULT ════════════════════════════════════════════
Deno.test("A. company-first CONTACT reaches accounts, lead_candidates and contact enrichment", async () => {
  const res = await routeResult({
    apify_yc_companies_memo23: [YC()],
    apify_linkedin_company_details: [ENR()],
    apify_linkedin_company_employees: [FOUNDER()],
  });
  const proj = projectCompanyFirstPersistence(res, "w1", "t1");
  const db = fakeDb();
  const spy = contactWriterSpy();
  const persistPlan = createPersistPlan({
    db: db.client as never, workspaceId: "w1", planId: "plan1", writeContact: spy.fn,
  });

  const outcomes: PersistedOutcome[] = [];
  for (const p of proj.plans) {
    if (!p.plan.persistable) continue;
    const r = await persistPlan(p.plan);
    outcomes.push({ identity: p.idempotencyKey, verdict: String(p.plan.verdict),
      quotaEligible: p.quotaEligible, result: r });
  }

  // CANONICAL DESTINATIONS — the same tables the legacy path writes.
  assertEquals(db.rows("accounts").length, 1);
  assertEquals(db.rows("accounts")[0].row.domain, "trademo.com");
  assertEquals(db.rows("accounts")[0].row.source, "compound_company_first");
  assertEquals(db.rows("lead_candidates").length, 1);
  const lc = db.rows("lead_candidates")[0].row;
  assertEquals(lc.lead_type, "person");
  assertEquals(lc.workspace_id, "w1");
  assertEquals(lc.plan_id, "plan1");
  assert(lc.account_id, "a CONTACT lead must carry a real account_id");
  assertEquals((lc.raw as Record<string, unknown>).contact_eligible, true);
  // Hiring evidence and both provenances survive into the persisted row.
  const raw = lc.raw as Record<string, unknown>;
  assert(Array.isArray(raw.hiring_evidence) && (raw.hiring_evidence as unknown[]).length === 1);
  assert(raw.discovery_evidence && raw.enrichment_evidence);

  // CONTACT ENRICHMENT was invoked through the existing writer.
  assertEquals(spy.calls.length, 1);
  const resolve = (spy.calls[0].resolve ?? {}) as Record<string, unknown>;
  assertEquals(resolve.companyScopedSearch, true, "the enrichment handoff must be company-scoped");
  assertEquals(resolve.workspaceId, "w1");
  assert(resolve.leadCandidateId);

  // QUOTA from PERSISTED outcomes.
  const prog = computeCompanyFirstQuotaProgress({
    persisted: outcomes, requestedQuota: 5,
    qualifiedCompany: res.funnel.qualified_companies,
  });
  assertEquals(prog.company_first_contact_credit, 1);
  assertEquals(prog.deduplicated_contact_credit, 1);
  assertEquals(prog.remaining_quota, 4);
});

// ═══ B. QUALIFIED COMPANY, FOUNDER PENDING ════════════════════════════════
Deno.test("B. a qualified company with no founder persists, stays visible, counts zero", async () => {
  const res = await routeResult({
    apify_yc_companies_memo23: [YC()],
    apify_linkedin_company_details: [ENR()],
    apify_linkedin_company_employees: [],       // no founder
  });
  const proj = projectCompanyFirstPersistence(res, "w1", "t2");
  const db = fakeDb();
  const spy = contactWriterSpy();
  const persistPlan = createPersistPlan({
    db: db.client as never, workspaceId: "w1", planId: null, writeContact: spy.fn });
  const outcomes: PersistedOutcome[] = [];
  for (const p of proj.plans) {
    if (!p.plan.persistable) continue;
    const r = await persistPlan(p.plan);
    outcomes.push({ identity: p.idempotencyKey, verdict: String(p.plan.verdict),
      quotaEligible: p.quotaEligible, result: r });
  }
  // The account-level record IS persisted — the work stays visible.
  assertEquals(db.rows("accounts").length, 1);
  assertEquals(db.rows("lead_candidates").length, 1);
  assertEquals(db.rows("lead_candidates")[0].row.lead_type, "account");
  assertEquals((db.rows("lead_candidates")[0].row.raw as Record<string, unknown>).contact_eligible, false);
  // Contact enrichment must NOT run prematurely.
  assertEquals(spy.calls.length, 0);
  const prog = computeCompanyFirstQuotaProgress({
    persisted: outcomes, requestedQuota: 5,
    qualifiedCompany: 1, founderPending: 1 });
  assertEquals(prog.company_first_contact_credit, 0);
  assertEquals(nextAdaptiveAction(prog).action, "await_pending_work");
});

// ═══ D. EMPLOYER MISMATCH ═════════════════════════════════════════════════
Deno.test("D. an employer mismatch never persists a contact and never counts", async () => {
  const res = await routeResult({
    apify_yc_companies_memo23: [YC()],
    apify_linkedin_company_details: [ENR()],
    apify_linkedin_company_employees: [FOUNDER({
      currentPositions: [{ title: "Founder", companyName: "Other",
        companyLinkedinUrl: LI("other"), current: true }],
    })],
  });
  const proj = projectCompanyFirstPersistence(res, "w1", "t3");
  const db = fakeDb();
  const spy = contactWriterSpy();
  const persistPlan = createPersistPlan({
    db: db.client as never, workspaceId: "w1", planId: null, writeContact: spy.fn });
  const outcomes: PersistedOutcome[] = [];
  for (const p of proj.plans) {
    if (!p.plan.persistable) continue;
    const r = await persistPlan(p.plan);
    outcomes.push({ identity: p.idempotencyKey, verdict: String(p.plan.verdict),
      quotaEligible: p.quotaEligible, result: r });
  }
  assertEquals(spy.calls.length, 0, "a mismatch must not reach contact enrichment");
  const prog = computeCompanyFirstQuotaProgress({ persisted: outcomes, requestedQuota: 5 });
  assertEquals(prog.company_first_contact_credit, 0);
});

// ═══ E. PERSISTENCE FAILURE ═══════════════════════════════════════════════
Deno.test("E. a projected CONTACT that fails to persist produces no quota credit", async () => {
  const res = await routeResult({
    apify_yc_companies_memo23: [YC()],
    apify_linkedin_company_details: [ENR()],
    apify_linkedin_company_employees: [FOUNDER()],
  });
  const proj = projectCompanyFirstPersistence(res, "w1", "t4");
  // The lead_candidates insert returns no row — the write did not land.
  const db = fakeDb({ failLeadInsert: true });
  const spy = contactWriterSpy();
  const persistPlan = createPersistPlan({
    db: db.client as never, workspaceId: "w1", planId: null, writeContact: spy.fn });
  const outcomes: PersistedOutcome[] = [];
  for (const p of proj.plans) {
    if (!p.plan.persistable) continue;
    const r = await persistPlan(p.plan);
    outcomes.push({ identity: p.idempotencyKey, verdict: String(p.plan.verdict),
      quotaEligible: p.quotaEligible, result: r });
  }
  assert(outcomes.some((o) => o.verdict === "CONTACT"), "it WAS projected as CONTACT");
  assertFalse(outcomes[0].result.ok);
  assertEquals(spy.calls.length, 0, "no lead_candidate id => no contact enrichment");
  const prog = computeCompanyFirstQuotaProgress({ persisted: outcomes, requestedQuota: 5 });
  assertEquals(prog.company_first_contact_credit, 0,
    "a projected CONTACT that did not persist is not a lead");
});

// ═══ QUOTA + ADAPTIVE CONTROLLER ══════════════════════════════════════════
const contact = (id: string): PersistedOutcome => ({
  identity: id, verdict: "CONTACT", quotaEligible: true,
  result: { ok: true, accountId: "a", contactId: null, leadCandidateId: `lc_${id}` },
});

Deno.test("only CONTACT + quota_eligible counts; every other stage counts zero", () => {
  const nonCounting: PersistedOutcome[] = [
    { identity: "w", verdict: "WATCH", quotaEligible: false,
      result: { ok: true, accountId: "a", contactId: null, leadCandidateId: "1" } },
    { identity: "n", verdict: "NEEDS_REVIEW", quotaEligible: false,
      result: { ok: true, accountId: "a", contactId: null, leadCandidateId: "2" } },
    { identity: "r", verdict: "REJECT", quotaEligible: false,
      result: { ok: false, accountId: null, contactId: null, leadCandidateId: null } },
    { identity: "s", verdict: "SKIP", quotaEligible: false,
      result: { ok: false, accountId: null, contactId: null, leadCandidateId: null } },
    // CONTACT but NOT quota-eligible (no verified account).
    { identity: "c0", verdict: "CONTACT", quotaEligible: false,
      result: { ok: true, accountId: null, contactId: null, leadCandidateId: "3" } },
  ];
  const p = computeCompanyFirstQuotaProgress({ persisted: nonCounting, requestedQuota: 5 });
  assertEquals(p.company_first_contact_credit, 0);
  assertEquals(p.remaining_quota, 5);
  assertEquals(p.rejected, 2);
});

Deno.test("a lead found by BOTH paths counts once", () => {
  const p = computeCompanyFirstQuotaProgress({
    persisted: [contact("shared"), contact("cf-only")],
    legacyContactIdentities: ["shared", "legacy-only"],
    requestedQuota: 5,
  });
  assertEquals(p.company_first_contact_credit, 2);
  assertEquals(p.legacy_contact_credit, 2);
  assertEquals(p.deduplicated_contact_credit, 3, "shared must not be counted twice");
  assertEquals(p.remaining_quota, 2);
});

Deno.test("the controller stops when the quota is met, whatever else is pending", () => {
  const p = computeCompanyFirstQuotaProgress({
    persisted: [contact("1"), contact("2")], requestedQuota: 2,
    contactPending: 3, qualifiedCompany: 9, founderPending: 4,
  });
  assertEquals(p.remaining_quota, 0);
  const a = nextAdaptiveAction(p);
  assertEquals(a.action, "stop_quota_satisfied");
  assertEquals(a.reason, "requested_contact_quota_met");
});

Deno.test("pending contact work is not a source failure and does not trigger fallback", () => {
  const p = computeCompanyFirstQuotaProgress({
    persisted: [], requestedQuota: 5, contactPending: 3, qualifiedCompany: 3 });
  assertEquals(p.company_first_contact_credit, 0);
  assert(p.pending_work_exists);
  const a = nextAdaptiveAction(p);
  assertEquals(a.action, "await_pending_work",
    "a run with work in flight must not spend on solidcode or a job board");
  assertEquals(a.reason, "contact_enrichment_pending_not_a_source_failure");

  // With NOTHING pending and quota unmet, sourcing may continue.
  const empty = computeCompanyFirstQuotaProgress({ persisted: [], requestedQuota: 5 });
  assertEquals(nextAdaptiveAction(empty).action, "continue_sourcing");
});

Deno.test("resume does not grant a second quota credit for the same identity", () => {
  const first = computeCompanyFirstQuotaProgress({
    persisted: [contact("cf:person:t1:acme:P1")], requestedQuota: 5 });
  assertEquals(first.company_first_contact_credit, 1);
  // On resume the same identity is already known to the legacy/global set.
  const resumed = computeCompanyFirstQuotaProgress({
    persisted: [contact("cf:person:t1:acme:P1")],
    legacyContactIdentities: ["cf:person:t1:acme:P1"],
    requestedQuota: 5,
  });
  assertEquals(resumed.deduplicated_contact_credit, 1, "the same lead counts once across runs");
});

// ═══ THE QUOTA MUST BE CONSUMED, NOT JUST LOGGED ══════════════════════════
Deno.test("run-agent consumes persisted quota progress, not the projection", async () => {
  const src = await Deno.readTextFile(new URL("../run-agent/index.ts", import.meta.url));
  assert(src.includes("computeCompanyFirstQuotaProgress("),
    "the handler must compute progress from PERSISTED outcomes");
  assert(src.includes("nextAdaptiveAction("),
    "and derive the adaptive action from it");
  assert(src.includes("createPersistPlan("),
    "and use the extracted canonical persistence");
  // The pre-persistence projection must NOT be the quota source any more.
  assertFalse(src.includes("quotaCreditFromProjection("),
    "a projected verdict must not decide quota");
  assert(src.includes("quota_progress: companyFirstQuotaProgress"),
    "the controller inputs must be persisted for audit");
});
