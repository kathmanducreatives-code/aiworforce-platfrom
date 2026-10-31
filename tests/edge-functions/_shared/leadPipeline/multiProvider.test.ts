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
function job(id: string, title: string, posted: string, co: { slug: string; name: string; website: string; industry?: string; hq?: string }, extra: Record<string, unknown> = {}) {
  return {
    id, title, linkedinUrl: `https://www.linkedin.com/jobs/view/${id}`, jobState: "LISTED", postedDate: posted,
    company: {
      id: `c-${co.slug}`, universalName: co.slug, name: co.name, linkedinUrl: `https://www.linkedin.com/company/${co.slug}`, website: co.website,
      employeeCount: 80, employeeCountRange: { start: 51, end: 200 }, industries: [{ name: co.industry ?? "Software Development" }],
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

async function execute(spec: DiscoverySpec, plan: StrategyPlan, o: { approval?: StrategyApproval | null; lo?: ReturnType<typeof leadOcean>; ap?: ReturnType<typeof apifyMock>; existing?: ExclusionIndex; ledger?: ReturnType<typeof memoryLedger> } = {}) {
  const lo = o.lo ?? leadOcean(FOUNDERS);
  const ap = o.ap ?? apifyMock();
  const ledger = o.ledger ?? memoryLedger();
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("no network in offline tests"); };
  try {
    const r = await runDiscoveryStrategy({
      workspaceId: WS, walkId: "walk-mp", spec, plan, approval: o.approval === undefined ? approve(plan) : o.approval,
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
  assert(apifyOnly.refusals.some((x) => x.includes("no approved people source")));
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
  assertStringIncludes(p.blockedReason!, "no approved people source");
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
  assert(d.limitations.some((l) => l.code === "signal_not_discoverable"), JSON.stringify(d.limitations));
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
    interpret: (query, _ws, n) => { interpretations++; return Promise.resolve({ mission: compileLeadMission({ originalUserQuery: query, proposal: HIRING_PROPOSAL, requestedCount: n }).final_mission }); },
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
  assertEquals((await handleStrategyRequest(sreq({ action: "strategy_run", approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd } }), m.d)).status, 403, "a member cannot approve spend");

  const o = sdeps();
  const stale = await handleStrategyRequest(sreq({ action: "strategy_run", approval: { plan_hash: "deadbeef", apify_usd: 1 } }), o.d);
  assertEquals(stale.status, 409);
  assertEquals(o.lo.calls.length + o.ap.calls.length, 0, "a stale approval buys nothing");
  const ran = await handleStrategyRequest(sreq({ action: "strategy_run", approval: { plan_hash: plan.planHash, apify_usd: plan.estimate.apifyUsd } }), o.d);
  assertEquals(ran.status, 200);
  assertEquals(ran.body.strategy, "apify_only");
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
