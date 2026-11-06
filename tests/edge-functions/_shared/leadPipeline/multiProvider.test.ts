// Multi-provider discovery: the planner chooses LeadOcean, Apify or both from
// what the request needs; the executor runs only an approved plan; the shared
// engine stays the only qualifier.
//
// Offline. globalThis.fetch throws during every run; every provider is a mock
// that records its calls. The "GPT interpretation" is a recorded model proposal
// passed through the REAL mission compiler (compileLeadMission), exactly as
// production feeds it. The strategy advisor is a recorded model answer.
// Synthetic companies and people only (.example domains).

import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { leadOceanAdapter } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import type { ActorInvoker } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/apify.ts";
import { memoryLedger } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import type { GenerateJsonFn } from "../../../../supabase/functions/_shared/intelligence/plannerWrapper.ts";
import { memoryCheckpointStore } from "../../../../supabase/functions/_shared/leadPipeline/checkpoint.ts";
import { ExclusionIndex } from "../../../../supabase/functions/_shared/leadPipeline/exclusions.ts";
import { runDiscoveryStrategy, type StrategyApproval, type StrategyRun } from "../../../../supabase/functions/_shared/leadPipeline/multiProvider.ts";
import { projectPipelineLead } from "../../../../supabase/functions/_shared/leadPipeline/projection.ts";
import {
  adviseStrategy, APOLLO_ACCESS_VALIDATED, DISCOVERY_CAPABILITIES, planStrategy, specFromMission,
  type DiscoverySpec, type StrategyContext, type StrategyPlan,
} from "../../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { conn, loPage, loPerson, mockFetch, noSleep, type Synthetic } from "../discoveryProviders/fixtures.ts";
import { companyRecord, NOW, WS } from "./fixtures.ts";
import { memoryEvidenceCache, type EvidenceCache } from "../../../../supabase/functions/_shared/leadPipeline/evidenceCache.ts";
import { ApifyRefusal, ledgeredInvoker, PIPELINE_ACTORS, pipelineApifyInvoker } from "../../../../supabase/functions/_shared/leadPipeline/apifyInvoker.ts";
import { companiesFromPostRows, companyEmployeesInput, peopleFromEmployeeRows } from "../../../../supabase/functions/_shared/leadPipeline/apifyDiscovery.ts";
import { checkFounders } from "../../../../supabase/functions/_shared/leadPipeline/founderCheck.ts";
import { planChecks } from "../../../../scripts/deploy/test-functions-smoke.ts";
import { planSigner, type PlanReplay } from "../../../../supabase/functions/_shared/leadPipeline/planToken.ts";
import { contractFromProposal } from "../../../../supabase/functions/_shared/missionContract/interpret.ts";
import { compileContract } from "../../../../supabase/functions/_shared/missionContract/compile.ts";
import { contractHash, type MissionContract } from "../../../../supabase/functions/_shared/missionContract/contract.ts";

/** One test signer (planToken.ts); the real function derives its key from the service-role key. */
const SIGNER = await planSigner("offline-test-secret-0123456789abcdef");
/** An interpretation compiled from a fixed model proposal, carrying what a signed run rebuilds. */
const fromProposal = (proposal: unknown) => (query: string, _ws: string, n: number | null) => Promise.resolve({
  mission: compileLeadMission({ originalUserQuery: query, proposal: proposal as never, requestedCount: n }).final_mission,
  brain: { status: "absent", fields: [], applied: [], rejected: [] },
  replay: { proposal, brain: { status: "absent", fields: [], context: null } },
});
const recompileFromReplay = (query: string, n: number | null, replay: PlanReplay) => Promise.resolve({
  mission: compileLeadMission({ originalUserQuery: query, proposal: replay.proposal as never, requestedCount: n }).final_mission,
});
import { checkStrategyApproval } from "../../../../supabase/functions/_shared/leadPipeline/multiProvider.ts";
import { chainFor, discoveryJobTitles, hiringTitles, sizePreferenceDistance } from "../../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { readFlags } from "../../../../supabase/functions/_shared/discoveryProviders/flags.ts";
import { handleStrategyRequest, parseStrategyRequest, readPipelineFlags, type StrategyDeps } from "../../../../supabase/functions/_shared/leadPipeline/service.ts";
import type { PipelineRow } from "../../../../supabase/functions/_shared/leadPipeline/projection.ts";

// ── Interpreted requests (recorded model proposals → the real compiler) ─────

const BLANK = {
  requested_opportunity_count: null, requested_contact_ready_count: null, company_types: [], geographies: [], employee_range: { min: null, max: null },
  decision_maker_roles: [], hard_constraints: [], soft_preferences: [], preferred_signals: [], adjacent_signals: [], excluded_signals: [],
  allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } }, disallowed_broadening: [],
  required_evidence: [], required_capabilities: [], preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false,
  confidence: 0.85, unknowns: [], known_companies: [], signal_recency_days: null, required_signal_terms: [], no_broadening_requested: false,
  geography_is_hard: true, prohibitions: [], output_intent: null, strategies: [],
};
const US = { geographies: ["United States"], hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "US" }] };

function interpret(query: string, proposal: Record<string, unknown>, count?: number): DiscoverySpec {
  const m = compileLeadMission({ originalUserQuery: query, proposal: { ...BLANK, ...proposal }, requestedCount: count ?? null }).final_mission;
  return specFromMission(m as never, { defaultCount: count ?? 25 });
}

const Q = {
  // A: a structured founder query (SaaS as a preference: no exact provider label exists for it).
  founders: (n = 100) => interpret("Find 100 US SaaS founders with 10–100 employees.", {
    ...US, requested_opportunity_count: n, employee_range: { min: 10, max: 100 }, decision_maker_roles: ["Founder"],
    soft_preferences: [{ field: "company_type", value: "SaaS", reason: "SaaS preferred" }], output_intent: "contacts",
  }, n),
  // A, worded as ICP A is (only what is gated on: HQ, size, role).
  foundersIcpA: (n = 4) => interpret("Find US-headquartered companies with 11-200 employees and their founder or CEO.", {
    ...US, requested_opportunity_count: n, employee_range: { min: 11, max: 200 }, decision_maker_roles: ["Founder", "CEO"], output_intent: "contacts",
  }, n),
  // B: defined by a hiring signal, companies only.
  hiringAE: (n = 5) => interpret("Find US companies currently hiring Account Executives.", {
    ...US, requested_opportunity_count: n, preferred_signals: ["hiring"], required_signal_terms: ["Account Executive"], signal_recency_days: 30,
    preferred_source_strategy: ["job_signal_first"], strategies: ["hiring"], output_intent: "companies",
  }, n),
  // C: founders at companies that recently hired salespeople.
  foundersAtHiring: (n = 5) => interpret("Find founders at US companies that are hiring Account Executives.", {
    ...US, requested_opportunity_count: n, decision_maker_roles: ["Founder"], preferred_signals: ["hiring"], required_signal_terms: ["Account Executive"],
    signal_recency_days: 30, strategies: ["hiring"], output_intent: "contacts",
  }, n),
  // D: post-driven.
  agenciesPosting: () => interpret("Find marketing agencies posting about AI automation.", {
    company_types: ["marketing agency"], preferred_signals: ["social_activity"], required_signal_terms: ["AI automation"], strategies: ["social"], geography_is_hard: false,
  }, 25),
  // E: recently funded.
  fundedFounders: () => interpret("Find founders of recently funded companies.", {
    decision_maker_roles: ["Founder"], preferred_signals: ["funding"], signal_recency_days: 180, strategies: ["funding"], output_intent: "contacts", geography_is_hard: false,
  }, 25),
};

const ACCESS: StrategyContext["providers"] = {
  leadocean: { enabled: true, connected: true, authorized: true, remaining: 955 },
  apify: { enabled: true, connected: true, authorized: true },
  // Flag on, connected, authorized — and still never chosen: access is not validated.
  apollo: { enabled: true, connected: true, authorized: true },
};
const CTX: StrategyContext = { providers: ACCESS, budget: { maxLeadoceanRecords: 50, maxApifyUsd: 0.5 } };
const CONNECTIONS = [conn("leadocean"), conn("apify")];

// ── Provider fixtures ───────────────────────────────────────────────────────

/** harvestapi/linkedin-job-search row (fields as catalogued in hiringActorCatalog: verified live 2026-09-16). */
function job(id: string, title: string, posted: string, co: { slug: string; name: string; website: string; industry?: string; hq?: string; band?: [number, number | null] }, extra: Record<string, unknown> = {}) {
  return {
    id, title, linkedinUrl: `https://www.linkedin.com/jobs/view/${id}`, jobState: "LISTED", postedDate: posted,
    company: {
      id: `c-${co.slug}`, universalName: co.slug, name: co.name, linkedinUrl: `https://www.linkedin.com/company/${co.slug}`, website: co.website,
      employeeCount: 80, employeeCountRange: { start: co.band?.[0] ?? 51, ...(co.band ? (co.band[1] == null ? {} : { end: co.band[1] }) : { end: 200 }) }, industries: [{ name: co.industry ?? "Software Development" }],
      locations: [{ headquarter: true, parsed: { text: co.hq ?? "Austin, Texas, United States" } }],
    },
    location: { linkedinText: "Austin, TX" }, descriptionText: `${co.name} is hiring.`, ...extra,
  };
}
const NORTHWIND = { slug: "northwind", name: "Northwind Ledger", website: "https://northwind.example" };
const MAPLE = { slug: "mapleledger", name: "Maple Ledger", website: "https://mapleledger.example", hq: "Toronto, Ontario, Canada" };
const QUARTZ = { slug: "quartzlabs", name: "Quartz Labs", website: "https://quartzlabs.example" };
const HARBOR = { slug: "harbor", name: "Harbor Metrics", website: "https://harbor.example" };
const APEX = { slug: "apextalent", name: "Apex Talent Recruiting", website: "https://apextalent.example", industry: "Staffing and Recruiting" };
const SHOPCO = { slug: "shopco", name: "Shopco", website: "https://shopco.example", industry: "Retail" };
const OLDCO = { slug: "oldco", name: "Oldco", website: "https://oldco.example" };

const JOBS = [
  job("j1", "Account Executive", "2026-10-20", NORTHWIND),
  job("j2", "Senior Account Executive", "2026-10-22", NORTHWIND), // same employer: one company
  job("j3", "Account Executive", "2026-10-18", MAPLE), // record: HQ Toronto → disproven
  job("j4", "Account Executive", "2026-10-21", APEX), // staffing agency: dropped
  job("j5", "Retail Key Holder", "2026-10-21", SHOPCO), // fuzzy title: dropped
  job("j6", "Account Executive", "2026-08-01", OLDCO), // outside 30 days: dropped
  job("j7", "Account Executive", "2026-10-25", QUARTZ), // record names another company's website
  job("j8", "Account Executive", "2026-10-26", HARBOR), // no company record: pending
];

const RECORDS: Record<string, unknown> = {
  northwind: companyRecord("northwind", { name: "Northwind Ledger", website: "https://northwind.example", hqCountry: "US", city: "Austin", band: [51, 200] }),
  mapleledger: companyRecord("mapleledger", { name: "Maple Ledger", website: "https://mapleledger.example", hqCountry: "CA", city: "Toronto", band: [51, 200] }),
  // The LinkedIn slug matches, but the record's website is a DIFFERENT company's domain.
  quartzlabs: companyRecord("quartzlabs", { name: "Quartz Labs", website: "https://quartz-mining.example", hqCountry: "US", city: "Denver", band: [11, 50] }),
};

type Call = { actor: string; input: Record<string, unknown>; key: string };
function apifyMock(o: { failJobs?: boolean; jobs?: unknown[] } = {}) {
  const calls: Call[] = [];
  const invoke: ActorInvoker = (actor, input, opts) => {
    calls.push({ actor, input, key: opts.idempotencyKey });
    if (actor === "apify_linkedin_job_search") {
      if (o.failJobs) return Promise.reject(new Error("actor run failed"));
      const items = (o.jobs ?? JOBS).slice(0, opts.maxItems);
      return Promise.resolve({ items, runId: "run-jobs", chargedUsd: 0.001 + 0.001 * items.length });
    }
    if (actor === "apify_linkedin_company_details") {
      const items = (input.companies as string[]).map((u) => RECORDS[/company\/([^/]+)/.exec(u)![1]]).filter(Boolean);
      return Promise.resolve({ items, runId: "run-company", chargedUsd: 0.00005 + 0.004 * items.length });
    }
    return Promise.reject(new Error(`unexpected actor ${actor}`));
  };
  return { invoke, calls };
}

const SW = "Software Development";
const FOUNDERS: Synthetic[] = [
  { id: "3001", name: "Nia North", title: "Founder & CEO", company: "Northwind Ledger", domain: "northwind.example", industry: SW, employees: 80, phone: "+1 512 555 3001" },
  { id: "3002", name: "Hugo Hart", title: "Co-Founder", company: "Harbor Metrics", domain: "harbor.example", industry: SW, employees: 40 },
  { id: "3003", name: "Ari Ash", title: "Founder", company: "Acme Saas", domain: "acmesaas.example", industry: SW, employees: 60, phone: "+1 512 555 3003" },
  { id: "3004", name: "Di Fenn", title: "Founder", company: "Delta Flow", domain: "deltaflow.example", industry: SW, employees: 30 },
];
function leadOcean(people: Synthetic[], o: { status?: number } = {}) {
  const f = mockFetch({ "POST /v1/search": [o.status ? { status: o.status, body: { error: { message: "upstream failure" } } } : { body: loPage(people.map(loPerson)) }] });
  return { adapter: leadOceanAdapter({ apiKey: "offline-test-key", fetch: f.fetch, sleep: noSleep, now: NOW }), calls: f.calls };
}
const LO_RECORDS: Record<string, unknown> = {
  acmesaas: companyRecord("acmesaas", { name: "Acme Saas", website: "https://acmesaas.example", hqCountry: "US", city: "Austin", band: [51, 200] }),
  deltaflow: companyRecord("deltaflow", { name: "Delta Flow", website: "https://deltaflow.example", hqCountry: "US", city: "Denver", band: [11, 50] }),
};

const approve = (plan: StrategyPlan): StrategyApproval => ({ planHash: plan.planHash, leadoceanRecords: plan.estimate.leadoceanRecords, apifyUsd: plan.estimate.apifyUsd, approvedBy: "test-owner", approvedAt: NOW().toISOString() });

async function execute(spec: DiscoverySpec, plan: StrategyPlan, o: { approval?: StrategyApproval | null; lo?: ReturnType<typeof leadOcean>; ap?: ReturnType<typeof apifyMock>; existing?: ExclusionIndex; ledger?: ReturnType<typeof memoryLedger>; cache?: EvidenceCache | null; workspaceId?: string } = {}) {
  const lo = o.lo ?? leadOcean(FOUNDERS);
  const ap = o.ap ?? apifyMock();
  const ledger = o.ledger ?? memoryLedger();
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("no network in offline tests"); };
  try {
    const r = await runDiscoveryStrategy({
      workspaceId: o.workspaceId ?? WS, walkId: "walk-mp", spec, plan, approval: o.approval === undefined ? approve(plan) : o.approval, evidenceCache: o.cache ?? null,
      leadocean: lo.adapter, apify: ap.invoke, connections: CONNECTIONS, ledger, checkpoints: memoryCheckpointStore(),
      existing: o.existing ?? new ExclusionIndex([], NOW), now: NOW,
    });
    return { r, lo, ap, ledger };
  } finally { globalThis.fetch = realFetch; }
}
const all = (r: StrategyRun) => [...r.queue, ...r.review, ...r.excluded];
const byDomain = (r: StrategyRun) => Object.fromEntries(all(r).map((l) => [l.company.domain, l]));
const recorded = (strategy: string, rationale = "recorded model answer"): GenerateJsonFn => () =>
  Promise.resolve({ ok: true, content: JSON.stringify({ strategy, rationale }), json: { strategy, rationale }, provider: "openai", model: "recorded-model", latencyMs: 1 } as never);

// ── 1 Apify-only discovery, no LeadOcean call ───────────────────────────────

Deno.test("strategy: a hiring query runs Apify-only discovery and never calls LeadOcean", async () => {
  const spec = Q.hiringAE();
  const plan = planStrategy(spec, CTX);
  assertEquals([plan.status, plan.strategy, plan.selectedBy], ["ready", "apify_only", "deterministic"]);
  const { r, lo, ap } = await execute(spec, plan);
  assertEquals(lo.calls.length, 0, "LeadOcean is never called");
  assertEquals(ap.calls.map((c) => c.actor), ["apify_linkedin_job_search", "apify_linkedin_company_details"]);
  assertEquals(ap.calls[0].input.jobTitles, ["account executives"]);
  assertEquals(ap.calls[0].input.postedLimit, "month");
  const by = byDomain(r);
  assertEquals(Object.keys(by).sort(), ["harbor.example", "mapleledger.example", "northwind.example", "quartzlabs.example"], "agency, fuzzy-title and stale postings dropped");
  assertEquals(by["northwind.example"].statuses.qualification, "eligible", "US HQ (company record) + a dated AE posting");
  assertEquals(by["northwind.example"].company.hq.source, "apify_linkedin_company_details");
  assertEquals(by["mapleledger.example"].statuses.qualification, "ineligible", "Toronto HQ disproves the US requirement");
  assertEquals(by["harbor.example"].statuses.qualification, "pending", "no company record: needs verification, never eligible");
  assertEquals(r.spend.leadoceanRecords, 0);
  assert(r.spend.apifyUsd <= plan.estimate.apifyUsd);
});

// ── 2 LeadOcean-only is independently selectable ────────────────────────────

Deno.test("strategy: LeadOcean-only is selectable and runs without Apify — every lead stays needs_verification", async () => {
  const spec = Q.founders(4);
  const plan = planStrategy(spec, { ...CTX, user: { strategy: "leadocean_only", allowReviewOnly: true } });
  assertEquals([plan.status, plan.strategy, plan.selectedBy], ["ready", "leadocean_only", "user"]);
  assert(plan.limitations.some((l) => l.code === "unverified_claim" && l.detail.includes("no Apify company record")));
  const { r, lo, ap } = await execute(spec, plan);
  assertEquals(ap.calls.length, 0, "Apify is never called");
  assertEquals(lo.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), ["POST /v1/search"]);
  assert(all(r).length > 0);
  for (const l of all(r)) assertFalse(l.statuses.qualification === "eligible", `${l.company.domain}: a LeadOcean claim alone never qualifies`);
  // Without allowReviewOnly the same request refuses LeadOcean-only: nothing bought could become eligible.
  const strict = planStrategy(spec, { ...CTX, user: { strategy: "leadocean_only" } });
  assertEquals(strict.status, "blocked");
  assertStringIncludes(strict.blockedReason!, "no lead could become eligible");
});

// ── 3 combined discovery ────────────────────────────────────────────────────

Deno.test("strategy: combined — Apify finds hiring companies, LeadOcean finds their founders, Apify verifies", async () => {
  const spec = Q.foundersAtHiring();
  const plan = planStrategy(spec, CTX);
  assertEquals([plan.status, plan.strategy], ["ready", "apify_plus_leadocean"]);
  assertEquals(plan.steps.map((s) => s.capability), ["apify.linkedin_job_search", "apify.linkedin_company_record", "leadocean.people_by_domain"]);
  const { r, lo, ap } = await execute(spec, plan);
  assertEquals(ap.calls.map((c) => c.actor), ["apify_linkedin_job_search", "apify_linkedin_company_details"]);
  assertEquals(lo.calls.length, 1);
  const searched = lo.calls[0].body as Record<string, unknown>;
  assertEquals((searched.domain as string[]).sort(), ["harbor.example", "northwind.example", "quartzlabs.example"], "people bought only at companies not disproven (Maple excluded)");
  const by = byDomain(r);
  assertEquals(by["northwind.example"].statuses.qualification, "eligible");
  assertEquals(by["northwind.example"].person?.name, "Nia North");
  assertEquals(by["northwind.example"].provenance.providers.sort(), ["apify", "leadocean"]);
  assertEquals(r.status, "completed");
});

Deno.test("strategy: combined — LeadOcean discovers founders, Apify company records decide HQ and size", async () => {
  const spec = Q.foundersIcpA(4);
  const plan = planStrategy(spec, CTX);
  assertEquals([plan.status, plan.strategy], ["ready", "leadocean_plus_apify"]);
  const ap = apifyMock();
  const invoke: ActorInvoker = (actor, input, opts) => actor === "apify_linkedin_company_details"
    ? (ap.calls.push({ actor, input, key: opts.idempotencyKey }), Promise.resolve({ items: (input.companies as string[]).map((u) => ({ ...RECORDS, ...LO_RECORDS })[/company\/([^/]+)/.exec(u)![1]]).filter(Boolean), runId: "run-c", chargedUsd: 0.01 }))
    : ap.invoke(actor, input, opts);
  const { r, lo } = await execute(spec, plan, { ap: { invoke, calls: ap.calls } });
  assertEquals(lo.calls.length, 1);
  assertEquals(ap.calls.map((c) => c.actor), ["apify_linkedin_company_details"], "one batched record read; no signal or phone purchase");
  const by = byDomain(r);
  assertEquals(by["acmesaas.example"].statuses.qualification, "eligible");
  assertEquals(by["harbor.example"].statuses.qualification, "pending", "no record: needs verification");
  assertEquals(by["acmesaas.example"].company.hq.source, "apify_linkedin_company_details");
});

Deno.test("strategy: Query A as worded — the plan states that SaaS and a 10–100 size need more than a band, and the run keeps them pending", async () => {
  const spec = Q.founders(4);
  const plan = planStrategy(spec, CTX);
  assertEquals(plan.strategy, "leadocean_plus_apify");
  assert(plan.limitations.some((l) => l.detail.startsWith('industry "saas"')), JSON.stringify(plan.limitations));
  const invoke: ActorInvoker = (_a, input) => Promise.resolve({ items: (input.companies as string[]).map((u) => ({ ...RECORDS, ...LO_RECORDS })[/company\/([^/]+)/.exec(u)![1]]).filter(Boolean), runId: "run-c", chargedUsd: 0.01 });
  const { r } = await execute(spec, plan, { ap: { invoke, calls: [] } });
  const acme = byDomain(r)["acmesaas.example"];
  assertEquals(acme.statuses.qualification, "pending");
  assertEquals(acme.qualification!.gaps.sort(), ["company_size_band", "industry"], "51–200 cannot settle 10–100; no source proves 'saas'");
  assertEquals(acme.qualification!.checks.find((c) => c.dimension === "geography")!.result, "pass");
});

// ── 4 / 5 model choice, validated ───────────────────────────────────────────

Deno.test("strategy: GPT picks Apify job-search discovery for a hiring query, and the pick is validated", async () => {
  const spec = Q.hiringAE();
  const base = planStrategy(spec, CTX);
  const advice = await adviseStrategy(spec, base.candidates, recorded("apify_only", "the request is defined by open AE roles"));
  const plan = planStrategy(spec, CTX, advice);
  assertEquals([plan.strategy, plan.selectedBy, plan.modelAdvice?.accepted], ["apify_only", "model", true]);
  assertStringIncludes(plan.rationale[0], "open AE roles");
  // A model pick the checks refuse is recorded and not followed.
  const bad = planStrategy(spec, CTX, await adviseStrategy(spec, base.candidates, recorded("leadocean_only")));
  assertEquals([bad.strategy, bad.selectedBy, bad.modelAdvice?.accepted], ["apify_only", "deterministic", false]);
  // The model cannot name a provider, actor or budget outside the closed vocabulary.
  const junk = planStrategy(spec, CTX, await adviseStrategy(spec, base.candidates, recorded("harvestapi/linkedin-job-search")));
  assertEquals([junk.strategy, junk.selectedBy], ["apify_only", "deterministic"]);
  assertStringIncludes(junk.modelAdvice!.reason, "unrecognised strategy");
});

Deno.test("strategy: GPT picks LeadOcean + Apify for a structured founder query; Apify-only is refused for people", async () => {
  const spec = Q.founders();
  const base = planStrategy(spec, CTX);
  assertEquals(base.strategy, "leadocean_plus_apify");
  const plan = planStrategy(spec, CTX, await adviseStrategy(spec, base.candidates, recorded("leadocean_plus_apify")));
  assertEquals([plan.strategy, plan.selectedBy], ["leadocean_plus_apify", "model"]);
  const apifyOnly = plan.candidates.find((c) => c.strategy === "apify_only")!;
  assertFalse(apifyOnly.feasible);
  assert(apifyOnly.refusals.some((x) => x.includes("apify.people_search is not approved")), JSON.stringify(apifyOnly.refusals));
  // 100 requested; the LeadOcean ceiling is 50 records: stated, not hidden.
  assert(plan.limitations.some((l) => l.code === "budget_limited"));
  assertEquals(plan.estimate.leadoceanRecords, 50);
});

// ── 6 user requirements override the default preference ────────────────────

Deno.test("strategy: a stated hiring requirement moves a founder query from LeadOcean-first to Apify-first", () => {
  assertEquals(planStrategy(Q.founders(5), CTX).strategy, "leadocean_plus_apify");
  assertEquals(planStrategy(Q.foundersAtHiring(5), CTX).strategy, "apify_plus_leadocean", "the hiring signal is what defines the request");
  // The user excludes a provider: honoured when feasible…
  assertEquals(planStrategy(Q.hiringAE(), { ...CTX, user: { excludeProviders: ["leadocean"] } }).strategy, "apify_only");
  // …and refused — never silently switched — when it cannot be.
  const p = planStrategy(Q.foundersAtHiring(), { ...CTX, user: { strategy: "apify_only" } });
  assertEquals(p.status, "blocked");
  assertStringIncludes(p.blockedReason!, "apify.company_employees is not approved");
});

Deno.test("strategy: 'recently hired salespeople' — no title survives compilation, the user's words still pick Apify-first", () => {
  const spec = interpret("Find founders at companies that recently hired salespeople.", {
    decision_maker_roles: ["Founder"], preferred_signals: ["hiring"], required_signal_terms: ["sales"], signal_recency_days: 60, strategies: ["hiring"], output_intent: "contacts", geography_is_hard: false,
  }, 25);
  assertEquals(spec.signals[0].roleFamilies, ["gtm_sales"], "read from the phrase by the shared role-family library");
  const plan = planStrategy(spec, CTX);
  assertEquals(plan.strategy, "apify_plus_leadocean");
  // The LeadOcean-first alternative is not hidden: it says it would ignore the defining signal.
  const lo = plan.candidates.find((c) => c.strategy === "leadocean_plus_apify")!;
  assert(lo.limitations.some((l) => l.code === "signal_not_discoverable" && l.detail.includes("hiring")));
});

// ── 7 unsupported capabilities fail safely ──────────────────────────────────

Deno.test("strategy: unsupported capabilities are explicit limitations or refusals, never silent", () => {
  // D: post-driven discovery has no approved actor. Agencies can still be found; posts only rank.
  const d = planStrategy(Q.agenciesPosting(), CTX);
  assertEquals(DISCOVERY_CAPABILITIES["apify.linkedin_post_search"].status, "not_approved");
  assert(d.limitations.some((l) => l.code === "capability_not_approved" && l.detail.includes("linkedin-post-search")), JSON.stringify(d.limitations));
  assertEquals(d.candidates.find((c) => c.strategy === "apify_only")!.feasible, false);
  // E: recent funding cannot be corroborated in this pipeline — refused, with the reason and the route.
  const e = planStrategy(Q.fundedFounders(), CTX);
  assertEquals(e.status, "blocked");
  assertStringIncludes(e.blockedReason!, "funding signal");
  assert(e.candidates.find((c) => c.strategy === "leadocean_plus_apify")!.limitations.some((l) => l.detail.includes("Contract 3")));
  // …unless the user asks for candidates for manual review: then LeadOcean + Apify, with the limitation on the plan.
  const review = planStrategy(Q.fundedFounders(), { ...CTX, user: { allowReviewOnly: true } });
  assertEquals([review.status, review.strategy], ["ready", "leadocean_plus_apify"]);
  assert(review.limitations.some((l) => l.code === "unverifiable_requirement" && l.detail.startsWith("funding")));
  // No provider connected: blocked, nothing to run.
  const none = planStrategy(Q.hiringAE(), { ...CTX, providers: {} });
  assertEquals(none.status, "blocked");
});

// ── 8 a provider failure does not corrupt completed results ────────────────

Deno.test("strategy: a LeadOcean failure after Apify verification keeps every company verdict intact", async () => {
  const spec = Q.foundersAtHiring();
  const plan = planStrategy(spec, CTX);
  const { r, ledger } = await execute(spec, plan, { lo: leadOcean(FOUNDERS, { status: 500 }) });
  assertEquals(r.status, "partial");
  const step = r.steps.find((s) => s.capability === "leadocean.people_by_domain")!;
  assertEquals(step.status, "failed");
  const by = byDomain(r);
  assertEquals(by["northwind.example"].qualification?.checks.find((c) => c.dimension === "geography")?.result, "pass", "the company record's verdict survives");
  assertEquals(by["mapleledger.example"].statuses.qualification, "ineligible");
  assertEquals(by["northwind.example"].statuses.qualification, "eligible", "the company's own verdict is unchanged");
  assertEquals(by["northwind.example"].person, null, "no person was invented");
  assertEquals(by["northwind.example"].statuses.outreachReadiness, "not_ready", "no contact: nothing to review for outreach");
  const apifyRows = [...ledger.entries.values()].filter((x) => x.provider === "apify");
  assert(apifyRows.length >= 2 && apifyRows.every((x) => x.state === "settled"), "completed Apify purchases stay settled");
});

Deno.test("strategy: an Apify discovery failure stops the walk before anything else is bought", async () => {
  const spec = Q.foundersAtHiring();
  const { r, lo, ap } = await execute(spec, planStrategy(spec, CTX), { ap: apifyMock({ failJobs: true }) });
  assertEquals(r.status, "blocked");
  assertEquals(lo.calls.length, 0);
  assertEquals(ap.calls.length, 1, "never retried");
  assert(r.spend.apifyUsd > 0, "a failed run is counted at its worst case");
});

// ── 9 cross-provider duplicates merge ───────────────────────────────────────

Deno.test("strategy: the same company from Apify and LeadOcean is one lead; two postings are one company", async () => {
  const spec = Q.foundersAtHiring();
  const { r } = await execute(spec, planStrategy(spec, CTX));
  const north = all(r).filter((l) => l.company.domain === "northwind.example");
  assertEquals(north.length, 1);
  assert(north[0].company.providerCompanyIds.some((x) => x.startsWith("apify:")) && north[0].company.providerCompanyIds.some((x) => x.startsWith("leadocean:")));
  assertEquals(new Set(all(r).map((l) => l.leadKey)).size, all(r).length);
});

// ── 10 budget exhaustion preserves unresolved leads ────────────────────────

Deno.test("strategy: when the Apify ceiling runs out, unverified companies stay as needs_verification", async () => {
  // One company asked for: the plan budgets 4 postings and 2 company records (2 postings per employer).
  // The search returns 4 postings from 4 DIFFERENT employers — more companies than the records budgeted.
  const spec = Q.hiringAE(1);
  const plan = planStrategy(spec, CTX);
  assertEquals(plan.steps.map((s) => s.maxItems), [4, 2]);
  const four = [job("k1", "Account Executive", "2026-10-20", NORTHWIND), job("k2", "Account Executive", "2026-10-20", HARBOR),
    job("k3", "Account Executive", "2026-10-20", QUARTZ), job("k4", "Account Executive", "2026-10-20", MAPLE)];
  const { r, ap } = await execute(spec, plan, { ap: apifyMock({ jobs: four }) });
  const recordRun = ap.calls.find((c) => c.actor === "apify_linkedin_company_details")!;
  assertEquals((recordRun.input.companies as string[]).length, 2, "only what the approved ceiling covers is bought");
  const skipped = all(r).filter((l) => l.canonicalRecord === "skipped_budget");
  assertEquals(skipped.length, 2);
  for (const l of skipped) {
    assertEquals(l.statuses.qualification, "pending", `${l.company.domain}: kept for review, never dropped, never eligible`);
    assertEquals(l.rank.lane, "review");
  }
  assertEquals(r.status, "partial");
  assertStringIncludes(r.steps.find((x) => x.capability === "apify.linkedin_company_record")!.reason!, "2 companies left unverified");
  assert(r.spend.apifyUsd <= plan.estimate.apifyUsd + 1e-9, `spent ${r.spend.apifyUsd} within ${plan.estimate.apifyUsd}`);
});

Deno.test("strategy: a plan over the ceiling shrinks discovery to fit and says so; nothing fitting is refused", () => {
  const spec = Q.hiringAE(25);
  const full = planStrategy(spec, CTX);
  assertEquals(full.estimate.apifyUsd, 0.30105);
  const tight = planStrategy(spec, { ...CTX, budget: { ...CTX.budget, maxApifyUsd: 0.25 } });
  assertEquals([tight.status, tight.strategy], ["ready", "apify_only"]);
  assert(tight.estimate.apifyUsd <= 0.25, `${tight.estimate.apifyUsd}`);
  assert(tight.limitations.some((l) => l.code === "budget_limited"), JSON.stringify(tight.limitations));
  const broke = planStrategy(spec, { ...CTX, budget: { ...CTX.budget, maxApifyUsd: 0.001 } });
  assertEquals(broke.status, "blocked");
  assertStringIncludes(broke.blockedReason!, "not even one company fits");
});

// ── 11 evidence from the wrong company is rejected ──────────────────────────

Deno.test("strategy: a company record naming another company's website lends no facts", async () => {
  const spec = Q.hiringAE();
  const { r } = await execute(spec, planStrategy(spec, CTX));
  const q = byDomain(r)["quartzlabs.example"];
  assertEquals(q.statuses.qualification, "pending", "hiring is proven by its own posting, HQ is not");
  assertEquals(q.company.hq.source, null, "the conflicting record's HQ is not shown as this company's");
  assert(r.evidenceRefused.some((x) => x.companyKey === q.leadKey && x.source === "apify_linkedin_company_details" && x.reason.startsWith("identity conflict")));
  assertFalse(Object.keys(q.qualification!.evidence_sources).includes("apify_linkedin_company_details"));
});

// ── 12 no automatic phone enrichment ────────────────────────────────────────

Deno.test("strategy: discovery never looks up a phone number, whatever the strategy", async () => {
  for (const spec of [Q.foundersAtHiring(), Q.founders(4)]) {
    const { r, lo } = await execute(spec, planStrategy(spec, CTX));
    assertEquals(lo.calls.filter((c) => c.url.includes("/phone")).length, 0);
    assertEquals(r.contactValues.length, 0);
    for (const l of all(r)) {
      assertEquals(l.statuses.enrichment, "not_requested");
      assertEquals(l.phone, null);
      const row = projectPipelineLead(l, { workspaceId: WS, values: [] });
      assertEquals(row?.contact?.phone ?? null, null, "no number reaches a contact row");
    }
  }
});

// ── 13 Apollo stays disabled ────────────────────────────────────────────────

Deno.test("strategy: Apollo is never chosen, even flagged on and connected, and its plan cannot run", async () => {
  assertEquals(APOLLO_ACCESS_VALIDATED, false);
  assertEquals(DISCOVERY_CAPABILITIES["apollo.people_search"].status, "disabled_pending_validation");
  const spec = Q.founders(5);
  const auto = planStrategy(spec, CTX);
  const apollo = auto.candidates.find((c) => c.strategy === "apollo_plus_apify")!;
  assertFalse(apollo.feasible);
  assertStringIncludes(apollo.refusals[0], "disabled pending validation");
  const forced = planStrategy(spec, { ...CTX, user: { strategy: "apollo_plus_apify" } });
  assertEquals(forced.status, "blocked");
  const model = planStrategy(spec, CTX, await adviseStrategy(spec, auto.candidates, recorded("apollo_plus_apify")));
  assertFalse(model.strategy === "apollo_plus_apify");
  // A forged ready plan naming Apollo is refused by the executor before any call.
  const forged: StrategyPlan = { ...auto, strategy: "apollo_plus_apify" };
  const { r, lo, ap } = await execute(spec, forged, { approval: approve(forged) });
  assertEquals(r.status, "blocked");
  assertEquals(lo.calls.length + ap.calls.length, 0);
});

// ── 14 no provider call before authorization ───────────────────────────────

Deno.test("strategy: no provider is called without an approval naming this plan and covering its cost", async () => {
  const spec = Q.foundersAtHiring();
  const plan = planStrategy(spec, CTX);
  const cases: [string, StrategyApproval | null][] = [
    ["none", null],
    ["other plan", { ...approve(plan), planHash: "00000000" }],
    ["too few records", { ...approve(plan), leadoceanRecords: plan.estimate.leadoceanRecords - 1 }],
    ["too little Apify", { ...approve(plan), apifyUsd: plan.estimate.apifyUsd / 2 }],
  ];
  for (const [label, approval] of cases) {
    const { r, lo, ap, ledger } = await execute(spec, plan, { approval });
    assertEquals(r.status, "blocked", label);
    assertEquals(lo.calls.length + ap.calls.length, 0, `${label}: no provider call`);
    assertEquals(ledger.entries.size, 0, `${label}: nothing reserved`);
  }
  // A blocked plan is never runnable, approval or not.
  const blocked = planStrategy(Q.fundedFounders(), CTX);
  const { r, lo, ap } = await execute(Q.fundedFounders(), blocked, { approval: approve(blocked) });
  assertEquals([r.status, lo.calls.length + ap.calls.length], ["blocked", 0]);
});

// ── Plan integrity ──────────────────────────────────────────────────────────

Deno.test("strategy: the plan hash binds strategy, ceilings and limitations; the same request plans the same", () => {
  const a = planStrategy(Q.hiringAE(), CTX);
  assertEquals(a.planHash, planStrategy(Q.hiringAE(), CTX).planHash);
  assertFalse(a.planHash === planStrategy(Q.hiringAE(10), CTX).planHash, "a different count is a different plan");
  assertFalse(a.planHash === planStrategy(Q.hiringAE(), { ...CTX, user: { excludeProviders: ["leadocean"] }, cachedCompanyRecords: 3 }).planHash, "different ceilings are a different plan");
  for (const c of a.candidates) if (c.feasible) assert(c.estimate.apifyUsd <= CTX.budget.maxApifyUsd && c.estimate.leadoceanRecords <= CTX.budget.maxLeadoceanRecords);
});

// ── Service: strategy_plan / strategy_run ───────────────────────────────────

const SENV: Record<string, string> = { LEAD_PIPELINE_ENABLED: "true", LEAD_PIPELINE_WORKSPACES: WS, PROVIDER_DISCOVERY_ENABLED: "true",
  PROVIDER_LEADOCEAN_ENABLED: "true", LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED: "true", PROVIDER_APIFY_DISCOVERY_ENABLED: "true",
  // Apollo flagged on: it must still never be planned.
  PROVIDER_APOLLO_ENABLED: "true", APOLLO_COMMERCIAL_TERMS_CONFIRMED: "true" };
const HIRING_PROPOSAL = { ...BLANK, ...US, requested_opportunity_count: 5, preferred_signals: ["hiring"], required_signal_terms: ["Account Executive"], signal_recency_days: 30, strategies: ["hiring"], output_intent: "companies" };

function sdeps(over: Partial<StrategyDeps> = {}, env = SENV) {
  const lo = leadOcean(FOUNDERS);
  const ap = apifyMock();
  const written: PipelineRow[] = [];
  let interpretations = 0;
  const d: StrategyDeps = {
    userId: "u-owner", flags: readPipelineFlags((k) => env[k]), discoveryFlags: readFlags((k) => env[k]),
    store: {
      memberRole: (u: string, w: string) => Promise.resolve(w === WS ? (u === "u-owner" ? "owner" : u === "u-member" ? "member" : null) : null),
      list: () => Promise.resolve([{ provider: "leadocean", status: "connected", usage: { remaining: 955, restrictions: [] } }, { provider: "apollo", status: "connected", usage: null }]),
      secret: () => Promise.resolve("offline-key"),
    } as never,
    ledger: memoryLedger(), checkpoints: memoryCheckpointStore(), loadExisting: () => Promise.resolve([]),
    leadoceanFor: () => ({ adapter: lo.adapter, deps: null as never }), apify: ap.invoke,
    persist: (rows) => { written.push(...rows); return Promise.resolve(); }, now: NOW,
    interpret: (query, ws, n) => { interpretations++; return fromProposal(HIRING_PROPOSAL)(query, ws, n); },
    recompile: recompileFromReplay, signer: SIGNER,
    advisor: recorded("apify_only"),
    ...over,
  };
  return { d, lo, ap, written, interpretations: () => interpretations };
}
const sreq = (b: Record<string, unknown>) => parseStrategyRequest({ workspace_id: WS, walk_id: "walk-s", query: "Find US companies currently hiring Account Executives.", requested_count: 5, ...b })!;

Deno.test("service: strategy_plan is member-readable and calls no provider; strategy_run is owner/admin and hash-bound", async () => {
  assertEquals((await handleStrategyRequest(sreq({ action: "strategy_plan" }), sdeps({}, {}).d)).status, 404, "flags off");
  assertEquals((await handleStrategyRequest(sreq({ action: "strategy_plan" }), sdeps({ userId: "stranger" }).d)).status, 403);
  const m = sdeps({ userId: "u-member" });
  const planned = await handleStrategyRequest(sreq({ action: "strategy_plan" }), m.d);
  assertEquals(planned.status, 200);
  const plan = planned.body.plan as StrategyPlan;
  assertEquals([plan.strategy, plan.selectedBy], ["apify_only", "model"]);
  assertFalse(plan.candidates.find((c) => c.strategy === "apollo_plus_apify")!.feasible, "Apollo flagged on and connected — still never planned");
  assertEquals(m.lo.calls.length + m.ap.calls.length, 0, "planning calls no provider");
  const token = planned.body.approval_token as string;
  assert(typeof token === "string" && token.includes("."), "the plan carries a signed approval token");
  assertEquals((await handleStrategyRequest(sreq({ action: "strategy_run", approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token } }), m.d)).status, 403, "a member cannot approve spend");

  const o = sdeps();
  const stale = await handleStrategyRequest(sreq({ action: "strategy_run", approval: { plan_hash: "deadbeef", apify_usd: 1, token } }), o.d);
  assertEquals(stale.status, 409);
  assertEquals(o.lo.calls.length + o.ap.calls.length, 0, "a stale approval buys nothing");
  const ran = await handleStrategyRequest(sreq({ action: "strategy_run", approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token } }), o.d);
  assertEquals(ran.status, 200);
  assertEquals(ran.body.strategy, "apify_only");
  assertEquals(o.interpretations(), 0, "the run never re-interprets: it executes the signed plan");
  assertEquals(o.lo.calls.length, 0);
  assert(o.written.length >= 2, "eligible and pending companies reach the Leads tables");
  assert(o.written.every((r) => r.contact === null || r.contact.phone === null));
  assertEquals(o.written.filter((r) => r.lead_candidate.status === "qualified").length, 1, "only the proven company is qualified");
});

Deno.test("service: an uninterpretable request is refused, not guessed; bad inputs are rejected at parse", async () => {
  const { d, lo, ap } = sdeps({ interpret: () => Promise.resolve({ error: "quota_exhausted" }) });
  const r = await handleStrategyRequest(sreq({ action: "strategy_plan" }), d);
  assertEquals(r.status, 422);
  assertEquals(lo.calls.length + ap.calls.length, 0);
  assertEquals(parseStrategyRequest({ action: "strategy_plan", workspace_id: WS, walk_id: "w", query: "x", strategy: "apify_signals_plus_magic" }), null);
  assertEquals(parseStrategyRequest({ action: "strategy_plan", workspace_id: WS, walk_id: "w", query: "x", exclude_providers: ["clearbit"] }), null);
  assertEquals(parseStrategyRequest({ action: "strategy_plan", workspace_id: WS, walk_id: "w", query: "x", max_apify_usd: 50 }), null, "a client cannot raise the ceiling past $5");
});

Deno.test("service: a genuine ambiguity is a 422 question for the user, never a 500 (TEST smoke, 2026-11-05)", async () => {
  const questions = ["Should \"in the US\" mean headquartered in the United States, or any US presence?"];
  const { d, lo, ap } = sdeps({ interpret: () => Promise.resolve({ error: "needs_clarification", clarification: { questions, message: "Before I start, I need to check one thing" } }) });
  const r = await handleStrategyRequest(sreq({ action: "strategy_plan" }), d);
  assertEquals(r.status, 422);
  assertEquals(r.body, { status: "needs_clarification", questions, error: "Before I start, I need to check one thing" });
  assertEquals(lo.calls.length + ap.calls.length, 0, "nothing is bought while the user is asked");
});

// ── MISSION CONTRACT MODE (ADR-001): the approval binds the contract; the run replays it ──
const CQ = "Find US companies currently hiring Account Executives.";
const contractDeps = async () => {
  const { contract } = contractFromProposal(CQ, {
    understanding: { roles: [{ span: "Account Executives", title: "account_executive", family: null, relation: "required" }], role_match: "any",
      places: [{ span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }], industries: [],
      signals: [{ span: "currently hiring Account Executives", kind: "hiring", necessity: "required" }], signal_logic: "all", ambiguities: [], unsupported: [] },
    signal_windows: [], deliverable: { entity: "company", count: 5, count_span: null, person_roles: [] }, company_size: null, funding_stages: [], forbid_broadening: [],
  });
  const hash = await contractHash(contract);
  const o = sdeps({
    interpret: async () => ({ mission: await compileContract(contract), contract, replay: { proposal: { contract, contractHash: hash }, brain: { status: "not_applied", fields: [], context: null } } }),
    // What the lead-pipeline does in contract mode: compile the APPROVED contract the token replays.
    recompile: async (_q, _n, replay) => {
      const c = (replay.proposal as { contract: MissionContract }).contract;
      return { mission: await compileContract(c), contract: c };
    },
  });
  return { o, contract, hash };
};

Deno.test("service (contract mode): the plan hash binds the contract; the run returns one evidence-backed verdict per requirement", async () => {
  const { o, contract, hash } = await contractDeps();
  const planned = await handleStrategyRequest(sreq({ action: "strategy_plan", query: CQ }), o.d);
  assertEquals(planned.status, 200);
  const plan = planned.body.plan as StrategyPlan;
  assertEquals(plan.binding.contract, `mission-contract-v1:${hash}`, "the signed plan names one exact meaning");
  assertEquals((planned.body.interpretation as { missionContract: { hash: string } }).missionContract.hash, hash);
  const ran = await handleStrategyRequest(sreq({ action: "strategy_run", query: CQ, approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: planned.body.approval_token } }), o.d);
  assertEquals(ran.status, 200, JSON.stringify(ran.body).slice(0, 300));
  assertEquals(ran.body.missionContractHash, hash);
  assertEquals(ran.body.invariantViolations, undefined);
  const verdicts = ran.body.requirementVerdicts as { leadKey: string; verdicts: { requirementId: string; status: string; evidence: unknown[] }[] }[];
  assert(verdicts.length >= 1);
  const hard = contract.requirements.filter((r) => r.necessity === "required").map((r) => r.id).sort();
  for (const v of verdicts) {
    assertEquals(v.verdicts.filter((x) => hard.includes(x.requirementId)).map((x) => x.requirementId).sort(), hard);
    for (const x of v.verdicts) if (x.status === "verified") assert(x.evidence.length > 0, "verified always cites evidence");
  }
  assert(verdicts.some((v) => v.verdicts.some((x) => x.status === "verified")), "the offline world proves at least one requirement");
});

Deno.test("service (contract mode): a contract changed after approval never runs (I3), and nothing is bought", async () => {
  const { o, contract } = await contractDeps();
  const planned = await handleStrategyRequest(sreq({ action: "strategy_plan", query: CQ }), o.d);
  const plan = planned.body.plan as StrategyPlan;
  // A different meaning arrives at run time (a requirement dropped): refused before any provider call.
  const tampered = { ...contract, requirements: contract.requirements.filter((r) => r.dimension !== "geography"), assumptions: contract.assumptions };
  const o2 = sdeps({ recompile: async () => ({ mission: await compileContract(tampered), contract: tampered }) });
  const ran = await handleStrategyRequest(sreq({ action: "strategy_run", query: CQ, approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: planned.body.approval_token } }), o2.d);
  assertEquals(ran.status, 409);
  assertEquals(o2.lo.calls.length + o2.ap.calls.length, 0);
});

Deno.test("service (contract mode): an ambiguity is a question, never a run", async () => {
  const { contract } = contractFromProposal(CQ, {
    understanding: { roles: [], role_match: "any", places: [{ span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }], industries: [],
      signals: [{ span: "currently hiring Account Executives", kind: "hiring", necessity: "required" }], signal_logic: "all",
      ambiguities: [{ span: "US", question: "Headquartered in the US, or any US presence?" }], unsupported: [] },
    signal_windows: [], deliverable: { entity: "company", count: 5, count_span: null, person_roles: [] }, company_size: null, funding_stages: [], forbid_broadening: [],
  });
  const o = sdeps({ interpret: async () => ({ mission: await compileContract(contract), contract }) });
  const r = await handleStrategyRequest(sreq({ action: "strategy_plan", query: CQ }), o.d);
  assertEquals([r.status, r.body.status], [422, "needs_clarification"]);
});

// ── Consolidation with PR #198: one engine, its capabilities registered, allowlist unchanged ──

Deno.test("consolidation: the Apify allowlist and its 100-item cap are unchanged", async () => {
  assertEquals(Object.keys(PIPELINE_ACTORS).sort(), ["apify_linkedin_company_details", "apify_linkedin_company_posts", "apify_linkedin_job_search", "apify_linkedin_profile_posts"]);
  const inv = pipelineApifyInvoker({ token: "t", fetch: (() => Promise.resolve(new Response("[]"))) as never });
  let refused = "";
  await inv("apify_linkedin_job_search", {}, { maxItems: 101, idempotencyKey: "k" }).catch((e) => { refused = String(e.message); });
  assertStringIncludes(refused, "maxItems must be 1–100");
});

Deno.test("consolidation: PR #198's post search, profile search, company employees and founder check are registered, priced and NOT approved", () => {
  for (const id of ["apify.linkedin_post_search", "apify.people_search", "apify.company_employees", "apify.founder_check"]) {
    assertEquals(DISCOVERY_CAPABILITIES[id].status, "not_approved", id);
    assertStringIncludes(DISCOVERY_CAPABILITIES[id].note, "allowlist");
  }
  // The catalogued per-run floors are part of the worst case, so a plan can never under-quote them.
  assertEquals((DISCOVERY_CAPABILITIES["apify.company_employees"].cost as { minimumUsd: number }).minimumUsd, 0.05);
  assertEquals((DISCOVERY_CAPABILITIES["apify.people_search"].cost as { minimumUsd: number }).minimumUsd, 0.10);
});

Deno.test("consolidation: Apify-led chains discover by the defining signal — open roles → job search, posts → post search", () => {
  assertEquals(chainFor("apify_only", Q.hiringAE()), ["apify.linkedin_job_search", "apify.linkedin_company_record"]);
  assertEquals(chainFor("apify_only", Q.agenciesPosting())[0], "apify.linkedin_post_search");
  assertEquals(chainFor("apify_only", Q.foundersAtHiring()), ["apify.linkedin_job_search", "apify.linkedin_company_record", "apify.company_employees"]);
  assertEquals(chainFor("apify_only", Q.founders(5))[0], "apify.people_search");
  assertEquals(Q.agenciesPosting().signals[0].topics, ["AI automation"], "post topics are the user's own words");
  // Not approved → the post-driven query is served by LeadOcean + Apify, and says why.
  const d = planStrategy(Q.agenciesPosting(), CTX);
  assertEquals(d.strategy, "leadocean_plus_apify");
  assertStringIncludes(d.candidates.find((c) => c.strategy === "apify_only")!.refusals[0], "apify.linkedin_post_search is not approved");
});

Deno.test("consolidation: a plan naming an unapproved actor is refused before any call — and the invoker refuses it anyway", async () => {
  const spec = Q.hiringAE();
  const plan = planStrategy(spec, CTX);
  const forged: StrategyPlan = { ...plan, steps: [{ ...plan.steps[0], capability: "apify.linkedin_post_search" }, ...plan.steps.slice(1)] };
  const verdict = checkStrategyApproval(forged, approve(forged));
  assertFalse(verdict.ok);
  const { r, ap, lo } = await execute(spec, forged);
  assertEquals([r.status, ap.calls.length + lo.calls.length], ["blocked", 0]);
  // Second line: even a direct call through the ledgered invoker never reaches Apify.
  let reached = 0;
  const ledger = memoryLedger();
  const inv = ledgeredInvoker(() => { reached++; return Promise.resolve({ items: [] }); }, ledger, { workspaceId: WS, missionId: "m", maxUsd: 1 });
  for (const k of ["apify_linkedin_post_search", "apify_people_search", "apify_linkedin_company_employees"]) {
    let err: unknown = null;
    await inv(k, {}, { maxItems: 1, idempotencyKey: k }).catch((e) => { err = e; });
    assert(err instanceof ApifyRefusal, k);
  }
  assertEquals([reached, ledger.entries.size], [0, 0]);
});

Deno.test("consolidation: ported post-search parser keeps only company-page authors and dates each post", () => {
  const rows = [
    { type: "post", author: { type: "company", name: "Brightwave Agency", linkedinUrl: "https://www.linkedin.com/company/brightwave/" }, content: "How we use AI automation for clients", postedAt: { date: "2026-10-28T10:00:00Z" }, linkedinUrl: "https://www.linkedin.com/posts/p1" },
    { type: "post", author: { type: "company", name: "Brightwave Agency", linkedinUrl: "https://www.linkedin.com/company/brightwave" }, content: "AI automation, part 2", postedAt: { date: "2026-10-29T10:00:00Z" }, linkedinUrl: "https://www.linkedin.com/posts/p2" },
    // A person's post: their headline is not employment.
    { type: "post", author: { type: "profile", name: "Pat Poster", linkedinUrl: "https://www.linkedin.com/in/pat", info: "Founder at Somewhere" }, content: "AI automation!", linkedinUrl: "https://www.linkedin.com/posts/p3" },
  ];
  const out = companiesFromPostRows(rows, { now: NOW(), windowDays: 30, runId: "run-posts" });
  assertEquals(out.companies.map((c) => c.linkedinUrl), ["https://www.linkedin.com/company/brightwave"], "one company for two posts");
  assertEquals(out.dropped, { person_author_names_no_company: 1 });
  assertEquals(out.evidence.get("brightwave")![0].dimension, "identity");
  assert(out.signals.length >= 2, "each post is a ranking signal");
});

Deno.test("consolidation: ported company-employees parser trusts only a current position at a seed company; input pins the Short price", () => {
  const rows = [
    { id: "m1", fullName: "Nia North", linkedinUrl: "https://www.linkedin.com/in/ACwAAA1", currentPositions: [{ title: "Founder & CEO", companyLinkedinUrl: "https://www.linkedin.com/company/northwind", companyName: "Northwind Ledger", current: true }] },
    { id: "m2", fullName: "Old Hand", currentPositions: [{ title: "CEO", companyLinkedinUrl: "https://www.linkedin.com/company/northwind", current: false }] },
    { id: "m3", fullName: "Elsewhere", currentPositions: [{ title: "CEO", companyLinkedinUrl: "https://www.linkedin.com/company/other" }] },
  ];
  const people = peopleFromEmployeeRows(rows, new Set(["northwind"]), NOW().toISOString());
  assertEquals(people.map((p) => p.fullName), ["Nia North"]);
  assertEquals(people[0].company?.linkedinUrl, "https://www.linkedin.com/company/northwind");
  assertEquals(companyEmployeesInput(["u"], ["Founder"], 2).profileScraperMode, "Short ($4 per 1k)");
});

Deno.test("consolidation: ported founder check — confirmed / other decision-maker / budget floor (offline invoker)", async () => {
  const invoke: ActorInvoker = () => Promise.resolve({ items: [
    { fullName: "Nia North", currentPositions: [{ title: "Founder & CEO", companyLinkedinUrl: "https://www.linkedin.com/company/northwind" }] },
    { fullName: "Someone Else", currentPositions: [{ title: "CEO", companyLinkedinUrl: "https://www.linkedin.com/company/harbor" }] },
  ], chargedUsd: 0.05 });
  const r = await checkFounders([
    { companyKey: "a", companyLinkedinUrl: "https://www.linkedin.com/company/northwind", personName: "Nia North" },
    { companyKey: "b", companyLinkedinUrl: "https://www.linkedin.com/company/harbor", personName: "Hugo Hart" },
  ], invoke, { maxUsd: 0.1, perCompany: 2, jobTitles: ["Founder", "CEO"], idPrefix: "t" });
  assertEquals([r.checks.get("a")!.state, r.checks.get("b")!.state], ["confirmed", "other_decision_maker"]);
  const tight = await checkFounders([{ companyKey: "a", companyLinkedinUrl: "https://www.linkedin.com/company/northwind", personName: "Nia North" }], invoke, { maxUsd: 0.04, perCompany: 1, jobTitles: ["CEO"], idPrefix: "t2" });
  assertEquals([tight.stopped, tight.spentUsd], ["budget", 0], "the $0.05 run minimum is respected");
});

Deno.test("consolidation: the evidence cache reuses a fresh company record per workspace and never across workspaces", async () => {
  const spec = Q.hiringAE();
  const plan = planStrategy(spec, CTX);
  const cache = memoryEvidenceCache();
  const first = await execute(spec, plan, { cache });
  const boughtFirst = first.ap.calls.filter((c) => c.actor === "apify_linkedin_company_details").flatMap((c) => c.input.companies as string[]).length;
  assert(boughtFirst >= 2 && cache.rows.size >= 2);
  // A second walk in the same workspace (fresh ledger): no record is bought again, verdicts unchanged.
  const second = await execute(spec, plan, { cache });
  const rebought = second.ap.calls.filter((c) => c.actor === "apify_linkedin_company_details").flatMap((c) => (c.input.companies as string[]).map((u) => /company\/([^/]+)/.exec(u)![1]));
  assertEquals(rebought, ["harbor"], "every found record reused; only the company with no record is asked again (a miss is not cached)");
  assertEquals(byDomain(second.r)["northwind.example"].statuses.qualification, "eligible");
  assertEquals(byDomain(second.r)["mapleledger.example"].statuses.qualification, "ineligible");
  // The wrong-company record stays refused even when it comes from the cache.
  assert(second.r.evidenceRefused.some((x) => x.source === "apify_linkedin_company_details"));
  // Another workspace reads nothing from this one's purchases.
  const other = await execute(spec, plan, { cache, workspaceId: "33333333-3333-4333-8333-333333333333" });
  assert(other.ap.calls.some((c) => c.actor === "apify_linkedin_company_details"), "bought for the other workspace");
});

Deno.test("consolidation: a stale or unreadable cache entry is bought again, never trusted", async () => {
  const spec = Q.hiringAE();
  const plan = planStrategy(spec, CTX);
  const stale = memoryEvidenceCache();
  await stale.put({ workspaceId: WS, slug: "northwind", evidence: [], facts: null, observedAt: "2026-01-01T00:00:00Z" });
  const a = await execute(spec, plan, { cache: stale });
  assert(a.ap.calls.find((c) => c.actor === "apify_linkedin_company_details")!.input.companies.toString().includes("northwind"));
  const broken: EvidenceCache = { get: () => Promise.reject(new Error("table missing")), put: () => Promise.reject(new Error("table missing")) };
  const b = await execute(spec, plan, { cache: broken });
  assertEquals(byDomain(b.r)["northwind.example"].statuses.qualification, "eligible", "a broken cache costs a purchase, never a verdict");
  assertStringIncludes(b.r.steps.find((x) => x.capability === "apify.linkedin_company_record")!.reason ?? "", "cache read");
});

Deno.test("consolidation: the LeadOcean-led strategy shares the same evidence cache", async () => {
  const spec = Q.foundersIcpA(4);
  const plan = planStrategy(spec, CTX);
  const cache = memoryEvidenceCache();
  const invoke = (calls: { actor: string; slugs?: string[] }[]): ActorInvoker => (actor, input) => { calls.push({ actor, slugs: (input.companies as string[]).map((u) => /company\/([^/]+)/.exec(u)![1]) }); return Promise.resolve({ items: (input.companies as string[]).map((u) => ({ ...RECORDS, ...LO_RECORDS })[/company\/([^/]+)/.exec(u)![1]]).filter(Boolean), runId: "r", chargedUsd: 0.01 }); };
  const c1: { actor: string; slugs?: string[] }[] = [];
  await execute(spec, plan, { cache, ap: { invoke: invoke(c1), calls: [] } as never });
  assert(c1.length === 1 && cache.rows.has(`${WS}:acmesaas`));
  const c2: { actor: string; slugs?: string[] }[] = [];
  const again = await execute(spec, plan, { cache, ap: { invoke: invoke(c2), calls: [] } as never });
  assertFalse(c2.flatMap((c) => c.slugs ?? []).includes("acmesaas"), "a record already bought is not bought twice");
  assertEquals(byDomain(again.r)["acmesaas.example"].statuses.qualification, "eligible");
});

// ── Revised S2: decision-makers at hiring companies, a size PREFERENCE, measurable matching ──

const S2_ROLES = ["CEO", "Founder", "Co-Founder", "Head of Sales", "Chief Revenue Officer", "VP of Sales"];
const revisedS2 = (sentence = "Find the CEO, founder, head of sales, CRO or VP of Sales at 1 US company currently hiring Account Executives. Smaller companies preferred.", term = "Account Executive") =>
  interpret(sentence, { ...US, requested_opportunity_count: 1, decision_maker_roles: S2_ROLES, preferred_signals: ["hiring"], required_signal_terms: [term],
    signal_recency_days: 30, soft_preferences: [{ field: "employee_range", value: { min: 11, max: 200 }, reason: "smaller companies preferred" }], strategies: ["hiring"], output_intent: "contacts" }, 1);

Deno.test("revised S2: 'smaller companies preferred' is a preference, never a hard size; a number in the sentence would be hard", () => {
  const spec = revisedS2();
  assertEquals([spec.employees, spec.preferredEmployees], [null, { min: 11, max: 200 }]);
  assertEquals(spec.roles, S2_ROLES);
  assertEquals(spec.signals[0].roleTerms, ["account executives"]);
  // The preference biases the search input only; what qualifies is unchanged.
  assertEquals(discoveryJobTitles(spec), ["Founding account executive", "account executives"]);
  assertEquals(hiringTitles(spec), ["account executives"]);
  assertEquals(planStrategy(spec, CTX).strategy, "apify_plus_leadocean");
  // A range stated WITHOUT a hedge is a requirement; a hedged one ("ideally …") only ranks
  // (missionCriteria.sizeClauseHedged, TEST planning 2026-11-01).
  const hard = revisedS2("Find the CEO at 1 US company with 11-200 employees currently hiring Account Executives.");
  assertEquals(hard.employees, { min: 11, max: 200 });
  const soft = revisedS2("Find the CEO at 1 US company currently hiring Account Executives, ideally a smaller company of about 11-200 employees.");
  assertEquals([soft.employees, soft.preferredEmployees], [null, { min: 11, max: 200 }]);
  assertEquals(discoveryJobTitles(Q.hiringAE()), hiringTitles(Q.hiringAE()), "no preference: no bias");
});

Deno.test("revised S2: size preference distance orders, it never filters", () => {
  const pref = { min: 11, max: 200 };
  assertEquals(sizePreferenceDistance({ min: 51, max: 200 }, pref), 0);
  assertEquals(sizePreferenceDistance({ min: 1001, max: 5000 }, pref), 801);
  assertEquals(sizePreferenceDistance({ min: 2, max: 10 }, pref), 1);
  assert(sizePreferenceDistance(null, pref) > sizePreferenceDistance({ min: 10001, max: null }, pref), "an unknown band sorts last");
  assertEquals(sizePreferenceDistance({ min: 10001, max: null }, null), 0, "no preference: no ordering");
});

Deno.test("revised S2: the limited reads and people lookups go to the preferred-size companies; the rest stay pending, never dropped", async () => {
  const spec = revisedS2();
  const plan = planStrategy(spec, CTX);
  assertEquals(plan.steps.map((x) => [x.capability, x.maxItems]), [["apify.linkedin_job_search", 4], ["apify.linkedin_company_record", 2], ["leadocean.people_by_domain", 2]]);
  const BIG = { slug: "bigcorp", name: "BigCorp", website: "https://bigcorp.example", band: [10001, null] as [number, null] };
  const MID = { ...MAPLE, hq: "Austin, Texas, United States", band: [1001, 5000] as [number, number] };
  const jobs = [
    job("s1", "Founding Account Executive", "2026-10-28", BIG),
    job("s2", "Founding Account Executive", "2026-10-27", MID),
    job("s3", "Founding Account Executive", "2026-10-26", { ...NORTHWIND, band: [51, 200] }),
    job("s4", "Account Executive", "2026-10-25", { ...HARBOR, band: [11, 50] }),
  ];
  const harbor = companyRecord("harbor", { name: "Harbor Metrics", website: "https://harbor.example", hqCountry: "US", city: "Boston", band: [11, 50] });
  const calls: Call[] = [];
  const invoke: ActorInvoker = (actor, input, opts) => {
    calls.push({ actor, input, key: opts.idempotencyKey });
    if (actor === "apify_linkedin_job_search") return Promise.resolve({ items: jobs, runId: "rj", chargedUsd: 0.005 });
    return Promise.resolve({ items: (input.companies as string[]).map((u) => ({ ...RECORDS, harbor } as Record<string, unknown>)[/company\/([^/]+)/.exec(u)![1]]).filter(Boolean), runId: "rc", chargedUsd: 0.00805 });
  };
  const { r, lo } = await execute(spec, plan, { ap: { invoke, calls } });
  const read = (calls.find((c) => c.actor === "apify_linkedin_company_details")!.input.companies as string[]).map((u) => /company\/([^/]+)/.exec(u)![1]).sort();
  assertEquals(read, ["harbor", "northwind"], "the two reads go to the preferred-size employers, not BigCorp or the 1001–5000 company");
  const by = byDomain(r);
  assertEquals([by["bigcorp.example"].statuses.qualification, by["bigcorp.example"].canonicalRecord], ["pending", "skipped_budget"], "kept for review, not dropped");
  assertEquals((lo.calls[0].body as { domain: string[] }).domain.sort(), ["harbor.example", "northwind.example"], "people only at the two verified companies");
  // Matching: a person counts only through a company Apify discovered.
  const matched = all(r).filter((l) => l.person && l.provenance.providers.includes("apify") && l.provenance.providers.includes("leadocean"));
  assertEquals(matched.map((l) => [l.company.domain, l.person!.name]).sort(), [["harbor.example", "Hugo Hart"], ["northwind.example", "Nia North"]]);
  assert(matched.every((l) => l.statuses.qualification === "eligible" && l.person!.roleFamily !== "other"));
  // A row at a company Apify did not discover is never attached to one that it did.
  const stray = all(r).filter((l) => l.person && !l.provenance.providers.includes("apify"));
  assert(stray.every((l) => !["harbor.example", "northwind.example"].includes(l.company.domain ?? "")));
  // A large company is never disqualified by the preference: it would be eligible on its own record.
  assertEquals(by["bigcorp.example"].qualification?.disproven ?? [], []);
});

Deno.test("revised S2: when LeadOcean returns no one, the verified companies stand and nothing is invented", async () => {
  const spec = revisedS2();
  const plan = planStrategy(spec, CTX);
  const empty = mockFetch({ "POST /v1/search": [{ body: loPage([]) }] });
  const lo = { adapter: leadOceanAdapter({ apiKey: "offline-test-key", fetch: empty.fetch, sleep: noSleep, now: NOW }), calls: empty.calls };
  const { r } = await execute(spec, plan, { lo, ap: apifyMock({ jobs: [job("e1", "Founding Account Executive", "2026-10-28", { ...NORTHWIND, band: [51, 200] })] }) });
  const north = byDomain(r)["northwind.example"];
  assertEquals([north.statuses.qualification, north.person, north.statuses.outreachReadiness], ["eligible", null, "not_ready"]);
  assertEquals(r.spend.leadoceanRecords, 0, "LeadOcean bills per row returned: no rows, no records");
  assertEquals(r.status, "completed");
});

// ── S2 identity review: a technical company match is not verified employment ──

Deno.test("identity: an S2-shaped match keeps the company eligible and marks the person as requiring role verification", async () => {
  // As live S2 (2026-11-01): Apify finds a large, long-established employer; LeadOcean's row at the
  // same domain says "Principal Co-founder". The company match is real; the role is a title claim.
  const spec = revisedS2();
  const plan = planStrategy(spec, CTX);
  const GCE = { slug: "grand-canyon-education", name: "Grand Canyon Education", website: "https://grand-canyon-education.example", hq: "Phoenix, Arizona, United States", band: [5001, 10000] as [number, number] };
  const rec = companyRecord("grand-canyon-education", { name: "Grand Canyon Education", website: "https://grand-canyon-education.example", hqCountry: "US", city: "Phoenix", band: [5001, 10000] });
  const invoke: ActorInvoker = (actor, input) => actor === "apify_linkedin_job_search"
    ? Promise.resolve({ items: [job("g1", "Account Executive", "2026-10-28", GCE)], runId: "rj", chargedUsd: 0.002 })
    : Promise.resolve({ items: (input.companies as string[]).length ? [rec] : [], runId: "rc", chargedUsd: 0.00405 });
  const person: Synthetic = { id: "26195145", name: "Aaron Westover", title: "Principal Co-founder", company: "Grand Canyon Education", domain: "grand-canyon-education.example", industry: "Education", employees: 6000 };
  const lo = leadOcean([person]);
  // LeadOcean's row names the same domain AND LinkedIn page, as the live row did (a different
  // LinkedIn page would be an identity conflict and never merge).
  const { r } = await execute(spec, plan, { lo, ap: { invoke, calls: [] } });
  assertEquals(all(r).length, 1, "one company, no duplicate");
  const gce = byDomain(r)["grand-canyon-education.example"];
  assertEquals(gce.statuses.qualification, "eligible", "the company's verdict stands");
  assertEquals(gce.provenance.providers.sort(), ["apify", "leadocean"], "technical match: LeadOcean's employer merged into the Apify company");
  assertEquals(gce.person!.roleFamily, "founder", "the title classifies as a founder…");
  assertEquals(gce.person!.verification.role, "provider_title_claim", "…but only on LeadOcean's word");
  assertEquals(gce.person!.verification.status, "requires_role_verification");
  assertFalse(gce.person!.verification.status === "verified", "no provider claim ever verifies a role");
  const row = projectPipelineLead(gce, { workspaceId: WS, values: [] })!;
  assertEquals(row.lead_candidate.status, "qualified", "qualified = the company");
  assertEquals(row.lead_candidate.next_action, "verify_contact_role");
  assertEquals((row.contact!.raw.agentory_pipeline as { role_family_source: string }).role_family_source, "provider_title_claim");
  assertEquals((row.lead_candidate.raw.agentory_pipeline as { contact_verification: { status: string } }).contact_verification.status, "requires_role_verification");
});

Deno.test("identity: when the provider's own row says the person is not current, outreach is blocked and the company stays eligible", async () => {
  const spec = revisedS2();
  const plan = planStrategy(spec, CTX);
  const lo = leadOcean([FOUNDERS[0]]);
  // Mark LeadOcean's experience as not current.
  const realSearch = lo.adapter.search.bind(lo.adapter);
  lo.adapter.search = async (...a: Parameters<typeof realSearch>) => {
    const page = await realSearch(...a);
    return { ...page, people: page.people.map((p) => ({ ...p, employerIsCurrent: false })) };
  };
  const { r } = await execute(spec, plan, { lo, ap: apifyMock({ jobs: [job("n1", "Account Executive", "2026-10-28", { ...NORTHWIND, band: [51, 200] })] }) });
  const north = byDomain(r)["northwind.example"];
  assertEquals(north.statuses.qualification, "eligible");
  assertEquals([north.person!.verification.status, north.statuses.outreachReadiness], ["employment_mismatch", "blocked"]);
  assert(north.outreachBlockers.some((b) => b.includes("does not show this person currently")));
});

Deno.test("service: strategy_plan explains hard vs soft and how the Company Brain was used", async () => {
  const q = "Find 5 US B2B companies actively hiring salespeople. Prefer 20–500 employees, but include strong opportunities outside that range and explain why.";
  const proposalSoft = { ...HIRING_PROPOSAL, requested_opportunity_count: 5, required_signal_terms: ["salespeople"],
    soft_preferences: [{ field: "employee_range", value: { min: 20, max: 500 }, reason: "preferred" }] };
  const { d, lo, ap } = sdeps({
    interpret: fromProposal(proposalSoft),
  });
  const r = await handleStrategyRequest(sreq({ action: "strategy_plan", query: q, requested_count: 5 }), d);
  assertEquals(r.status, 200);
  const i = r.body.interpretation as { hard: { key: string }[]; preferences: { key: string; values: unknown }[]; signals: { kind: string; roleFamilies: string[] }[]; companyBrain: { status: string } };
  assertEquals(i.hard.map((h) => h.key).sort(), ["geography_hq", "signal"], "US HQ and hiring are the only requirements");
  assertEquals(i.preferences.find((p) => p.key === "employee_range")?.values, { min: 20, max: 500 }, "the size is a preference");
  assertEquals(i.signals[0].roleFamilies, ["gtm_sales"]);
  assertEquals(i.companyBrain.status, "absent");
  assertEquals((r.body.plan as StrategyPlan).strategy, "apify_only");
  assertEquals(lo.calls.length + ap.calls.length, 0, "planning calls no provider");

  // The TEST smoke suite judges this exact response shape (scripts/deploy/test-functions-smoke.ts).
  const smoke = planChecks(r.status, r.body as never);
  assertEquals(smoke.filter((c) => c.status !== "pass").map((c) => `${c.id} ${c.detail}`), [], "the deployed planner must pass the TEST planning smoke");
  assert(smoke.find((c) => c.id === "P3")!.detail.includes("Account Executive"), "salespeople → an Account Executive search");
});

// ── B2B: a description ranks, only the user's own "only/must" requires (TEST plan 116a1b45) ──
// On TEST, "Find 5 US B2B companies …" compiled "B2B" as a HARD industry, so every company
// waited on a label no provider can establish. These runs use the mocked Apify actors.
const b2bRun = async (query: string, companyTypes: string[], extra: Record<string, unknown> = {}) => {
  const o = sdeps({ interpret: fromProposal({ ...HIRING_PROPOSAL, company_types: companyTypes, ...extra }) });
  const planned = await handleStrategyRequest(sreq({ action: "strategy_plan", query }), o.d);
  const plan = planned.body.plan as StrategyPlan;
  const ran = await handleStrategyRequest(sreq({ action: "strategy_run", query, approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: planned.body.approval_token } }), o.d);
  const checks = (r: PipelineRow) => ((r.lead_candidate.raw.agentory_pipeline as { qualification: { checks: { dimension: string; result: string }[]; gaps: string[] } }).qualification);
  return { planned, plan, ran, o, checks, interpretation: planned.body.interpretation as { hard: { key: string }[]; preferences: { key: string; values: unknown }[] } };
};

Deno.test("B2B described ('US B2B companies'): a preference — a proven company qualifies without B2B evidence", async () => {
  const r = await b2bRun("Find 5 US B2B companies currently hiring Account Executives. Prefer 300–500 employees.", ["B2B"], { employee_range: { min: 300, max: 500 } });
  assertEquals(r.planned.status, 200);
  assertEquals(r.interpretation.hard.map((h) => h.key).sort(), ["geography_hq", "signal"], "B2B is not hard");
  assertEquals(r.interpretation.preferences.map((p) => p.key).sort(), ["business_model", "employee_range"]);
  assertEquals([r.plan.status, r.plan.strategy], ["ready", "apify_only"]);
  assertFalse(r.plan.limitations.some((l) => /industry|business_model/.test(l.detail)), "no unverifiable B2B requirement is disclosed: there is none");
  const q = r.o.written.filter((w) => w.lead_candidate.status === "qualified");
  assertEquals(q.map((w) => w.account.name), ["Northwind Ledger"], "the company with proven US HQ and hiring qualifies");
  // Northwind's LinkedIn record declares 51–200 employees: outside the preferred 300–500, still qualified.
  assert(sizePreferenceDistance({ min: 51, max: 200 }, { min: 300, max: 500 }) > 0, "outside the preferred range: ranked, never rejected");
  assertEquals(r.interpretation.preferences.find((p) => p.key === "employee_range")!.values, { min: 300, max: 500 });
  for (const w of r.o.written) {
    assertFalse(r.checks(w).checks.some((c) => c.dimension === "business_model"), "a preference is never reported as met or failed");
  }
});

Deno.test("B2B required ('Only include verified B2B'): missing evidence is needs_verification — never proof, never a rejection", async () => {
  const r = await b2bRun("Find 5 US companies currently hiring Account Executives. Only include verified B2B companies.", ["B2B"]);
  assertEquals(r.interpretation.hard.map((h) => h.key).sort(), ["business_model", "geography_hq", "signal"]);
  assertEquals(r.plan.status, "ready", "an unverifiable requirement is disclosed, not a blocked plan");
  assert(r.plan.limitations.some((l) => l.detail.includes("business_model")), "disclosed at planning");
  assertEquals(r.o.written.filter((w) => w.lead_candidate.status === "qualified").length, 0, "nothing qualifies on an unproven B2B");
  const nw = r.o.written.find((w) => w.account.name === "Northwind Ledger")!;
  assert(nw, "the proven company is kept for review, not dropped");
  assertEquals(nw.lead_candidate.status, "new");
  assertEquals(r.checks(nw).checks.find((c) => c.dimension === "business_model")!.result, "unknown");
  assert(r.checks(nw).gaps.includes("business_model"));
});

Deno.test("the model restating the hiring signal as a hard constraint (TEST plan 6999eff6) does not block qualification", async () => {
  const r = await b2bRun("Find 5 US B2B companies actively hiring Account Executives.", ["B2B"], {
    hard_constraints: [...US.hard_constraints, { field: "hiring_activity", operator: "equals", value: "actively hiring Account Executives", reason: "active hiring" }],
  });
  assertEquals(r.interpretation.hard.map((h) => h.key).sort(), ["geography_hq", "signal"], "no unmappable second requirement");
  assertFalse(r.plan.limitations.some((l) => l.detail.includes("unmappable")));
  assertEquals(r.o.written.filter((w) => w.lead_candidate.status === "qualified").map((w) => w.account.name), ["Northwind Ledger"]);
});

// ── Stage 3: strategy_run executes the signed plan; it never re-interprets ──────
Deno.test("strategy_run: no token, a forged token, changed ceilings or another workspace buy nothing", async () => {
  const m = sdeps({ userId: "u-member" });
  const planned = await handleStrategyRequest(sreq({ action: "strategy_plan" }), m.d);
  const plan = planned.body.plan as StrategyPlan;
  const token = planned.body.approval_token as string;
  const o = sdeps();
  const run = (b: Record<string, unknown>) => handleStrategyRequest(sreq({ action: "strategy_run", ...b }), o.d);
  assertEquals((await run({ approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd } })).status, 400, "no token: re-plan");
  const [body, sig] = token.split(".");
  const forged = btoa(JSON.stringify({ ...JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((body.length + 3) % 4))), requestedCount: 50 }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assertEquals((await run({ approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: `${forged}.${sig}` } })).status, 409, "forged");
  assertEquals((await run({ max_apify_usd: 1, approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token } })).status, 409, "a higher ceiling is a different plan");
  assertEquals((await handleStrategyRequest(sreq({ action: "strategy_run", workspace_id: "ws-other", approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token } }), o.d)).status, 403, "another workspace is refused before the token");
  assertEquals(o.lo.calls.length + o.ap.calls.length, 0, "no refused run reached a provider");
  assertEquals(o.interpretations(), 0, "and none asked the model");
});

Deno.test("strategy_run is immune to model variance: a different reading at run time cannot change what runs", async () => {
  const q = "Find 3 US companies actively hiring Account Executives.";
  const planner = sdeps({ userId: "u-member" });
  const planned = await handleStrategyRequest(sreq({ action: "strategy_plan", query: q }), planner.d);
  const plan = planned.body.plan as StrategyPlan;
  // At run time the model would read "presence" — but the run does not ask it.
  const o = sdeps({ interpret: fromProposal({ ...HIRING_PROPOSAL, geography_scope: "presence" }) });
  const ran = await handleStrategyRequest(sreq({ action: "strategy_run", query: q, approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: planned.body.approval_token } }), o.d);
  assertEquals(ran.status, 200, JSON.stringify(ran.body).slice(0, 200));
  assertEquals(ran.body.strategy, plan.strategy);
});

Deno.test("one approval buys each paid step at most once: a repeat replays from the ledger; another walk is refused", async () => {
  const m = sdeps({ userId: "u-member" });
  const planned = await handleStrategyRequest(sreq({ action: "strategy_plan" }), m.d);
  const plan = planned.body.plan as StrategyPlan;
  const approval = { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: planned.body.approval_token };
  const o = sdeps();
  const first = await handleStrategyRequest(sreq({ action: "strategy_run", approval }), o.d);
  assertEquals(first.status, 200);
  const bought = o.ap.calls.length;
  assert(bought > 0, "the first run bought its steps");
  const again = await handleStrategyRequest(sreq({ action: "strategy_run", approval }), o.d);
  assertEquals(again.status, 200, "the same approved walk can be resumed");
  assertEquals(o.ap.calls.length, bought, "and buys nothing twice: every step replays from the durable ledger");
  const otherWalk = await handleStrategyRequest(sreq({ action: "strategy_run", walk_id: "walk-other", approval }), o.d);
  assertEquals(otherWalk.status, 409, "the same approval cannot buy a second walk");
  assertEquals(o.ap.calls.length, bought);
});

// ── Duplicate purchase under concurrency and interruption (owner safeguard 3) ──
async function approvedRun() {
  const m = sdeps({ userId: "u-member" });
  const planned = await handleStrategyRequest(sreq({ action: "strategy_plan" }), m.d);
  const plan = planned.body.plan as StrategyPlan;
  return { action: "strategy_run", approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: planned.body.approval_token } };
}
const keysOf = (calls: Call[]) => calls.map((c) => c.key);
const unique = (xs: string[]) => [...new Set(xs)];

Deno.test("idempotency: two concurrent runs of one approval buy each paid step at most once", async () => {
  const body = await approvedRun();
  const o = sdeps();
  const inner = o.d.apify!;
  o.d.apify = async (a, i, opts) => { await new Promise((r) => setTimeout(r, 5)); return inner(a, i, opts); };
  const both = await Promise.all([handleStrategyRequest(sreq(body), o.d), handleStrategyRequest(sreq(body), o.d)]);
  assert(both.some((r) => r.status === 200), `one run completes: ${both.map((r) => r.status)}`);
  assertEquals(keysOf(o.ap.calls), unique(keysOf(o.ap.calls)), "no idempotency key reached Apify twice");
  const solo = sdeps();
  await handleStrategyRequest(sreq(body), solo.d);
  assert(o.ap.calls.length <= solo.ap.calls.length, "two concurrent runs bought no more than one run does");
});

Deno.test("idempotency: a run interrupted after a provider charged, before the ledger settled, never re-buys that step", async () => {
  const body = await approvedRun();
  const o = sdeps();
  // The isolate dies between Apify's charge and the ledger write: the reservation stays in flight.
  const ledger = o.d.ledger;
  let crash = true;
  o.d.ledger = { ...ledger, reserve: (e) => ledger.reserve(e), settle: (k, a, r) => crash ? Promise.reject(new Error("isolate terminated")) : ledger.settle(k, a, r),
    markUncertain: (k) => crash ? Promise.resolve() : ledger.markUncertain(k), release: (k) => ledger.release(k) } as typeof ledger;
  const first = await handleStrategyRequest(sreq(body), o.d);
  const bought = keysOf(o.ap.calls);
  assert(bought.length > 0, `the first attempt reached Apify (${first.status})`);
  crash = false;
  await handleStrategyRequest(sreq(body), o.d);
  assertEquals(keysOf(o.ap.calls).slice(bought.length).filter((k) => bought.includes(k)), [], "a charge the ledger never confirmed is not bought again");
});

Deno.test("idempotency: a provider failure is marked uncertain and a retry never re-buys it", async () => {
  const body = await approvedRun();
  const o = sdeps();
  const inner = o.d.apify!;
  let fail = true;
  o.d.apify = (a, i, opts) => fail && a === "apify_linkedin_company_details" ? (o.ap.calls.push({ actor: a, input: i, key: opts.idempotencyKey }), Promise.reject(new Error("socket hang up"))) : inner(a, i, opts);
  await handleStrategyRequest(sreq(body), o.d);
  const failed = o.ap.calls.filter((c) => c.actor === "apify_linkedin_company_details").map((c) => c.key);
  assert(failed.length > 0, "the company-record step was attempted");
  fail = false;
  const retry = await handleStrategyRequest(sreq(body), o.d);
  assertEquals(o.ap.calls.filter((c) => failed.includes(c.key)).length, failed.length, `an uncertain charge is never retried (${retry.status})`);
});

// ── TEST deploy 9fee47ba: the role filed only as a hard "hiring status" constraint ──
Deno.test("interpretation: a role the model filed only as a quoted hiring-status constraint still reaches the signal; the smoke plan passes", async () => {
  const { planChecks, SMOKE_QUERY } = await import("../../../../scripts/deploy/test-functions-smoke.ts");
  const proposal = { ...BLANK, ...US, requested_opportunity_count: 5, company_types: ["B2B"], employee_range: { min: 20, max: 500 },
    preferred_signals: ["hiring"], required_signal_terms: [], strategies: ["hiring"], output_intent: "companies",
    hard_constraints: [...US.hard_constraints, { field: "hiring_status", operator: "equals", value: "actively hiring salespeople", reason: "active hiring" }] };
  const m = sdeps({ userId: "u-member", interpret: fromProposal(proposal) });
  const r = await handleStrategyRequest(sreq({ action: "strategy_plan", query: SMOKE_QUERY, requested_count: 5, max_apify_usd: 0.25, max_leadocean_records: 50 }), m.d);
  const failed = planChecks(r.status, r.body as never).filter((c) => c.status === "fail");
  assertEquals(failed, [], JSON.stringify(failed));
  // And the guard is narrow: a count or an exclusion is never lifted into the role.
  const { quotedHiringRoleWords } = await import("../../../../supabase/functions/_shared/missionCriteria.ts");
  const q = "Find US companies actively hiring salespeople but not engineers, with at least 5 open roles.";
  assertEquals(quotedHiringRoleWords([{ field: "hiring_status", operator: "equals", value: "actively hiring salespeople" }], q), ["salespeople"]);
  assertEquals(quotedHiringRoleWords([{ field: "hiring", operator: "excludes", value: "engineers" }], q), [], "an exclusion is not a role");
  assertEquals(quotedHiringRoleWords([{ field: "open_roles", operator: "at_least", value: "5 open roles" }], q), [], "a count is not a role");
  assertEquals(quotedHiringRoleWords([{ field: "hiring_status", operator: "equals", value: "hiring account executives" }], q), [], "words the user did not write are never lifted");
});

// ── Stage 6: the closed requirement vocabulary, behind LEAD_STRICT_REQUIREMENTS_ENABLED ──
const INVENTED = { ...HIRING_PROPOSAL, hard_constraints: [...US.hard_constraints, { field: "culture_fit", operator: "equals", value: "remote-first engineering culture", reason: "model guess" }] };
const QUOTED = { ...HIRING_PROPOSAL, hard_constraints: [...US.hard_constraints, { field: "culture_fit", operator: "equals", value: "remote-first", reason: "stated" }] };
const STRICT = { ...SENV, LEAD_STRICT_REQUIREMENTS_ENABLED: "true" };

Deno.test("strict vocabulary OFF (default): an invented requirement is only reported; the plan is unchanged", async () => {
  const off = sdeps({ userId: "u-member", interpret: fromProposal(INVENTED) });
  const r = await handleStrategyRequest(sreq({ action: "strategy_plan" }), off.d);
  assertEquals(r.status, 200);
  const contract = (r.body.interpretation as { contract: { enforced: boolean; unsupported: string[] } }).contract;
  assertEquals([contract.enforced, contract.unsupported], [false, ["culture_fit"]]);
  const plain = await handleStrategyRequest(sreq({ action: "strategy_plan" }), sdeps({ userId: "u-member" }).d);
  assertEquals((plain.body.interpretation as { contract: { unsupported: string[] } }).contract.unsupported, [], "a canonical-only proposal has nothing to report");
});

Deno.test("strict vocabulary ON: an invented requirement is refused explicitly (422), never dropped; nothing is bought", async () => {
  const on = sdeps({ userId: "u-member", interpret: fromProposal(INVENTED) }, STRICT);
  const r = await handleStrategyRequest(sreq({ action: "strategy_plan" }), on.d);
  assertEquals(r.status, 422);
  assertEquals((r.body.contract as { unsupported: string[] }).unsupported, ["culture_fit"]);
  assertEquals(on.lo.calls.length + on.ap.calls.length, 0);
  // The user's own words are not refused: the same field, quoted from the request, plans.
  const quoted = await handleStrategyRequest(sreq({ action: "strategy_plan", query: "Find US companies hiring Account Executives, remote-first only." }), sdeps({ userId: "u-member", interpret: fromProposal(QUOTED) }, STRICT).d);
  assertEquals(quoted.status, 200);
  // Canonical requirements are unaffected.
  assertEquals((await handleStrategyRequest(sreq({ action: "strategy_plan" }), sdeps({ userId: "u-member" }, STRICT).d)).status, 200);
});

Deno.test("strict vocabulary ON at run time refuses a plan signed while it was off — from the SIGNED proposal, before any purchase", async () => {
  const planned = await handleStrategyRequest(sreq({ action: "strategy_plan" }), sdeps({ userId: "u-member", interpret: fromProposal(INVENTED) }).d);
  assertEquals(planned.status, 200);
  const plan = planned.body.plan as StrategyPlan;
  const o = sdeps({}, STRICT);
  const r = await handleStrategyRequest(sreq({ action: "strategy_run", approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd, token: planned.body.approval_token } }), o.d);
  assertEquals(r.status, 422);
  assertEquals(o.lo.calls.length + o.ap.calls.length + o.interpretations(), 0);
});
