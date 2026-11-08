// OFFLINE END-TO-END ACCEPTANCE (mocked Apify, fake grounder, real planner / engine / persistence):
//
//   "Find 5 US B2B companies actively hiring Account Executives."
//
// interpretation → capability routes → plan + worst case → signed approval → Actor inputs →
// mocked runs → HQ / hiring / business-model checks → dedupe → persistRows → the Workbench's
// plan link (the run's task_plans row on every saved lead) → honest shortfall and spend.
// Nothing reaches a network; every company is a synthetic .example.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleStrategyRequest, parseStrategyRequest, type StrategyDeps } from "../../../../supabase/functions/_shared/leadPipeline/service.ts";
import { persistRows, type LeadStore } from "../../../../supabase/functions/_shared/leadPipeline/persistRows.ts";
import type { PipelineRow } from "../../../../supabase/functions/_shared/leadPipeline/projection.ts";
import { contractFromProposal } from "../../../../supabase/functions/_shared/missionContract/interpret.ts";
import { compileContract } from "../../../../supabase/functions/_shared/missionContract/compile.ts";
import { contractHash } from "../../../../supabase/functions/_shared/missionContract/contract.ts";
import { leadPlanOrFilter } from "../../../../src/lib/leads/leadPlanFilter.ts";
import { deps, WS } from "./mrleFixtures.ts";

const REQUEST = "Find 5 US B2B companies actively hiring Account Executives.";
const STRICT = "Find 5 US companies that must be B2B, actively hiring Account Executives.";
const PLAN_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const PLAN_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

/** The model's reading of the request (the interpreter itself is GPT; its validation is real). */
const answer = (b2bSpan: string) => ({
  understanding: {
    roles: [{ span: "Account Executives", title: "account_executive", family: null, relation: "required" }], role_match: "any",
    places: [{ span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }],
    industries: [{ span: b2bSpan, industry: "B2B", necessity: "required" }],
    signals: [{ span: "actively hiring Account Executives", kind: "hiring", necessity: "required" }],
    signal_logic: "all", ambiguities: [], unsupported: [],
  },
  signal_windows: [], deliverable: { entity: "company", count: 5, count_span: "5", person_roles: [] }, company_size: null, funding_stages: [], forbid_broadening: [],
});

/** The real persistRows against an in-memory store with the real unique keys; rows keep plan_id. */
function memoryStore() {
  type Row = Record<string, unknown> & { id: string; workspace_id: string };
  const accounts: Row[] = [], contacts: Row[] = [], leads: Row[] = [];
  let n = 0;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const ins = (t: Row[], r: Record<string, unknown>) => { const x = { id: id(), ...r } as Row; t.push(x); return Promise.resolve({ id: x.id }); };
  const store: LeadStore = {
    findAccountByDomain: (ws, d) => Promise.resolve((accounts.find((a) => a.workspace_id === ws && a.domain === d) ?? null) as never),
    findAccountByName: (ws, nm) => Promise.resolve((accounts.find((a) => a.workspace_id === ws && a.name === nm) ?? null) as never),
    insertAccount: (r) => accounts.some((a) => a.workspace_id === r.workspace_id && a.name === r.name) ? Promise.resolve({ conflict: true as const }) : ins(accounts, r),
    updateAccount: (i, p) => { Object.assign(accounts.find((a) => a.id === i)!, p); return Promise.resolve(); },
    findContactByLinkedin: (ws, u) => Promise.resolve((contacts.find((c) => c.workspace_id === ws && c.linkedin_url === u) ?? null) as never),
    insertContact: (r) => ins(contacts, r),
    updateContact: (i, p) => { Object.assign(contacts.find((c) => c.id === i)!, p); return Promise.resolve(); },
    findLeadById: (ws, i) => Promise.resolve((leads.find((l) => l.workspace_id === ws && l.id === i) ?? null) as never),
    findPipelineLeadForAccount: (ws, a, t) => Promise.resolve((leads.find((l) => l.workspace_id === ws && l.account_id === a && l.lead_type === t) ?? null) as never),
    insertLead: (r) => ins(leads, r),
    updateLead: (i, p) => { Object.assign(leads.find((l) => l.id === i)!, p); return Promise.resolve(); },
  };
  return { store, accounts, leads };
}

/** What the Workbench Leads table returns for a plan (useLeadResults + leadPlanOrFilter), under RLS. */
const workbenchView = (leads: Record<string, unknown>[], ws: string, planId: string) =>
  leads.filter((l) => l.workspace_id === ws && (l.plan_id === planId || ((l.raw as { agentory_pipeline?: { plan_id?: string } })?.agentory_pipeline?.plan_id === planId)));

function harness(o: { query: string; b2bSpan: string; planIds?: string[]; failPlan?: boolean }) {
  const x = deps();
  const mem = memoryStore();
  const planCalls: Record<string, unknown>[] = [];
  const ids = [...(o.planIds ?? [PLAN_A])];
  const d: StrategyDeps = {
    ...x.d,
    interpret: async (query) => {
      const { contract } = contractFromProposal(query, answer(o.b2bSpan) as never);
      const hash = await contractHash(contract);
      return { mission: await compileContract(contract), contract, brain: { status: "absent", fields: [], applied: [], rejected: [] },
        replay: { proposal: { contract, contractHash: hash }, brain: { status: "absent", fields: [], context: null } } } as never;
    },
    persist: (rows: PipelineRow[]) => persistRows(mem.store, rows),
    recordRunPlan: (p) => { planCalls.push(p); return o.failPlan ? Promise.reject(new Error("db down")) : Promise.resolve(ids.shift() ?? null); },
  };
  const req = (b: Record<string, unknown>, walk = "acc-walk") => parseStrategyRequest({ workspace_id: WS, walk_id: walk, query: o.query, requested_count: 5, ...b })!;
  const planAndRun = async (walk = "acc-walk") => {
    const planned = await handleStrategyRequest(req({ action: "strategy_plan" }, walk), d);
    const plan = planned.body.plan as { status: string; planHash: string; estimate: { apifyUsd: number; leadoceanRecords: number }; steps: { capability: string; maxItems: number }[];
      requirementRoutes: { label: string; route: string; checkedBy: string[] }[] };
    const ran = await handleStrategyRequest(req({ action: "strategy_run", approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: planned.body.approval_token } }, walk), d);
    return { planned, plan, ran, body: ran.body as Record<string, any> };
  };
  return { x, mem, planCalls, planAndRun };
}

Deno.test("acceptance: the exact request plans an Apify-only run under the $0.25 TEST ceiling, with valid Actor inputs", async () => {
  const h = harness({ query: REQUEST, b2bSpan: "B2B" });
  const { planned, plan, ran } = await h.planAndRun();
  assertEquals([planned.status, plan.status, ran.status], [200, "ready", 200]);
  assert(plan.estimate.apifyUsd <= 0.25 && plan.estimate.leadoceanRecords === 0, `worst case ${plan.estimate.apifyUsd}`);
  const routes = Object.fromEntries(plan.requirementRoutes.map((r) => [r.label, [r.route, r.checkedBy]]));
  assertEquals(routes["Headquarters: United States"], ["checked", ["apify.linkedin_company_record"]]);
  assertEquals(routes["Hiring: Account Executive"], ["checked", ["apify.linkedin_job_search"]]);
  // OWNER RULE M01 (missionContract/interpret.ts AUDIENCE_POLICY): "US B2B companies" DESCRIBES
  // an audience — B2B ranks and never gates, so no page is bought to check it. Recorded here so
  // a change to that rule is a deliberate, reviewed change.
  assertEquals(routes["Business model: B2B"], ["ranked_only", []]);
  assert(!plan.steps.some((s) => s.capability === "apify.website_business_model"));
  // Actor inputs: the approved allowlist only, the requested role and place, bounded items, keyed per mission.
  const [jobs, records] = h.x.ap.calls;
  assertEquals(jobs.actor, "apify_linkedin_job_search");
  assertEquals([jobs.input.jobTitles, jobs.input.locations, jobs.input.postedLimit], [["Account Executive"], ["United States"], "month"]);
  assert(jobs.maxItems >= 1 && jobs.maxItems <= 100);
  assertEquals(records.actor, "apify_linkedin_company_details");
  assertEquals(h.x.ap.calls.length, 2, "no other Actor runs");
  assert(new Set(h.x.ap.calls.map((c) => c.key)).size === 2 && h.x.ap.calls.every((c) => c.key.includes(plan.planHash)));
});

Deno.test("acceptance: HQ and hiring are checked, the shortfall and the spend are honest, every saved lead is in the run's Workbench", async () => {
  const h = harness({ query: REQUEST, b2bSpan: "B2B" });
  const { plan, body } = await h.planAndRun();
  // Four synthetic US companies hiring AEs: all pass HQ + hiring (B2B only ranks, see above).
  assertEquals([body.outcome.requested, body.outcome.qualified, body.outcome.status, body.outcome.shortfall], [5, 4, "completed_with_shortfall", 1]);
  assertEquals(body.outcome.summary, "Only 4 companies qualified of 5 requested.");
  // Spend: the providers' own charges here; never more than the approved worst case, and labelled an estimate.
  assertEquals(body.spend, { leadoceanRecords: 0, apifyUsd: 0.021 });
  assertEquals(body.outcome.spend.basis, "estimate");
  assert(body.spend.apifyUsd <= plan.estimate.apifyUsd);
  // The Workbench link: one plan for the run, named in the response, carried by every new lead.
  assertEquals(h.planCalls.length, 1);
  assertEquals([h.planCalls[0].workspaceId, h.planCalls[0].userId, h.planCalls[0].query, h.planCalls[0].planHash, h.planCalls[0].status], [WS, "u-owner", REQUEST, plan.planHash, "completed"]);
  assertEquals(body.workbench, { planId: PLAN_A });
  assertEquals(h.mem.leads.length, 4);
  assert(h.mem.leads.every((l) => l.plan_id === PLAN_A && (l.raw as any).agentory_pipeline.plan_id === PLAN_A && l.status === "qualified"));
  assertEquals(workbenchView(h.mem.leads, WS, PLAN_A).length, 4);
  assertEquals(workbenchView(h.mem.leads, "33333333-3333-4333-8333-333333333333", PLAN_A).length, 0, "another workspace never sees them");
  // What the table shows per lead: the evidence the decision rests on.
  const q = (h.mem.leads[0].raw as any).agentory_pipeline.qualification;
  assertEquals(q.checks.map((c: any) => [c.dimension, c.result, c.actor]), [
    ["geography", "pass", "apify_linkedin_company_details"], ["hiring", "pass", "apify_linkedin_job_search"]]);
  assert(q.checks.every((c: any) => c.evidence.length >= 1 && c.evidence[0].evidence_id));
  assertEquals(q.checks[1].evidence[0].occurred_at, "2026-11-02", "the posting's own date");
});

Deno.test("acceptance: a second run finds the same companies — no duplicate lead; they appear in BOTH runs' Workbench views", async () => {
  const h = harness({ query: REQUEST, b2bSpan: "B2B", planIds: [PLAN_A, PLAN_B] });
  await h.planAndRun("walk-1");
  h.mem.leads[0].status = "contacted"; // the user moved one on
  const second = await h.planAndRun("walk-2");
  assertEquals(second.body.workbench, { planId: PLAN_B });
  assertEquals(second.body.persistence, { inserted: 0, updated: 4, failed: 0, failures: [] });
  assertEquals([h.mem.leads.length, h.mem.accounts.length], [4, 4], "one company, one lead, one account");
  assertEquals(h.mem.leads[0].status, "contacted", "an existing lead keeps its status");
  assert(h.mem.leads.every((l) => l.plan_id === PLAN_A), "the creating plan is kept");
  assertEquals([workbenchView(h.mem.leads, WS, PLAN_A).length, workbenchView(h.mem.leads, WS, PLAN_B).length], [4, 4]);
});

Deno.test("acceptance: when B2B is REQUIRED ('must be B2B') it is verified from first-party pages; only verified companies count", async () => {
  const h = harness({ query: STRICT, b2bSpan: "must be B2B" });
  const { plan, body } = await h.planAndRun();
  assertEquals(plan.status, "ready");
  assert(plan.steps.some((s) => s.capability === "apify.website_business_model"));
  assert(plan.estimate.apifyUsd <= 0.25, `worst case ${plan.estimate.apifyUsd}`);
  const by = Object.fromEntries([...body.queue, ...body.review].map((l: any) => [l.company.name, [l.statuses.qualification, l.businessModel?.status ?? null]]));
  assertEquals(by["Northwind Ledger"], ["eligible", "verified_b2b"]);
  assertEquals(by["Harbor Kids"], undefined, "a consumer business is excluded, never saved");
  assertEquals(by["Quartz Data"], ["pending", "unknown"]);
  assertEquals(body.outcome.qualified, 1);
  assertEquals(body.outcome.shortfall, 4);
  assert(body.outcome.needsVerification >= 1);
  // Saved: qualified + needs verification (with the run's plan); the rejected company is not.
  assert(!h.mem.accounts.some((a) => a.name === "Harbor Kids"));
  assert(h.mem.leads.every((l) => l.plan_id === PLAN_A));
  assertEquals(h.mem.leads.find((l) => (l.raw as any).agentory_pipeline.business_model?.status === "verified_b2b")?.status, "qualified");
});

Deno.test("acceptance: the leads are never lost when the Workbench plan cannot be recorded (and the response says so)", async () => {
  const h = harness({ query: REQUEST, b2bSpan: "B2B", failPlan: true });
  const { body } = await h.planAndRun();
  assertEquals(body.workbench, null);
  assertEquals(h.mem.leads.length, 4);
  assert(h.mem.leads.every((l) => !("plan_id" in l)));
});

Deno.test("Workbench filter: a plan's own leads OR pipeline leads it found again; only a UUID is ever interpolated", () => {
  assertEquals(leadPlanOrFilter(PLAN_A), `plan_id.eq.${PLAN_A},raw->agentory_pipeline->>plan_id.eq.${PLAN_A}`);
  assertEquals(leadPlanOrFilter(` ${PLAN_A} `), `plan_id.eq.${PLAN_A},raw->agentory_pipeline->>plan_id.eq.${PLAN_A}`);
  for (const bad of ["", "abc", `${PLAN_A},status.eq.x`, "plan_id.neq.0"]) assertEquals(leadPlanOrFilter(bad), null, bad);
});
