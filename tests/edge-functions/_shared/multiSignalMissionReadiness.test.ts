// THE FIRST MULTI-SIGNAL MISSION, MADE SAFE TO RUN — OFFLINE.
//
// The pre-canary compile of "Find 1 US B2B SaaS company with 11–50 employees,
// recently funded, and currently hiring a growth role" (2026-09-24) found:
//
//   1. an explicit funding window compiled hard or soft on a rounding choice
//      ("12 months" = 360 vs 365), and "must currently be hiring" never elevated
//   2. hiring was bought in-slice for EVERY identity-resolved company, before
//      country, size, business model or funding were grounded
//   3. "a growth role" expanded to 20 sales titles — an AE opening satisfied it
//   4. the Firecrawl /map bypassed the provider_usd ledger, and pages were
//      priced at an unannounced fallback rate
//   5. verifiers were ordered by static hints
//   6. V2 planner advisories said things that stopped being true
//
// Each is pinned here without a provider, a model, or a network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { compileMissionSemantics, deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { canonicalWindowDays, explicitWindowDays, sameWindow } from "../../../supabase/functions/_shared/signalKinds.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { buildQualificationContext } from "../../../supabase/functions/_shared/missionQualificationContext.ts";
import { coveringTitles, hiringSearchTitles } from "../../../supabase/functions/_shared/hiringSearchVocabulary.ts";
import { classifyRoleFamily, roleMatchesFamily } from "../../../supabase/functions/_shared/roleFamilies.ts";
import {
  hiringClaimVerifier, hiringEstimatePerTargetUsd, hiringVerifierInput, HIRING_CLAIM_VERIFIER_KEY,
} from "../../../supabase/functions/_shared/hiringClaimVerifier.ts";
import {
  compileWebEvidenceSpec, specGovernedMapper, webEvidenceCreditRate, FIRECRAWL_BUDGET_USD_PER_CREDIT,
} from "../../../supabase/functions/_shared/webEvidenceSpec.ts";
import { businessModelEstimatePerTargetUsd } from "../../../supabase/functions/_shared/businessModelVerifier.ts";
import { resolveCeilings } from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { tightenCeilings, parseRunBudget } from "../../../supabase/functions/_shared/runBudget.ts";
import { newSpendLedger as createSpendLedger } from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { runClaimVerificationPhase } from "../../../supabase/functions/_shared/claimVerificationPhase.ts";
import { buildClaimPlan } from "../../../supabase/functions/_shared/claimPlan.ts";
import type { ClaimVerifier, VerifiableCandidate, VerifierFinding } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { observationFromCompany, type EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { normalizeLinkedInCompanyEnriched } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

const CANARY =
  "Find 1 company that must be based in the US, must have a LinkedIn-declared company size of 11–50, " +
  "must be B2B SaaS, must have raised funding within the last 12 months, and must currently be hiring a growth role.";
/** The mission as the live compiler builds it: the semantic pass runs, the stated range is carried. */
function compiled(query: string, range: { min: number; max: number } | null = null) {
  const m = compileMissionSemantics({ mission: parseLeadMissionDeterministic(query), query } as never).mission;
  return range
    ? { ...m, company_profile: { ...m.company_profile, employee_range: range },
      field_provenance: { ...m.field_provenance, "company_profile.employee_range": "explicit_user_request" as const } }
    : m;
}
const kindOf = (q: string, dim: string) => deriveMissionCriteria(compiled(q), PRODUCTION_READINESS)
  .filter((c) => c.dimension === dim).map((c) => `${c.kind}/${c.time_window?.days ?? "-"}`);

// ═══════════════════════════════════════════ 1. explicit requirement language ══

Deno.test("WINDOW: '12 months', 'a year' and '365 days' are ONE hard funding requirement", () => {
  for (const w of ["in the last 12 months", "in the last year", "within the last 365 days", "in the past one year"]) {
    assertEquals(kindOf(`Find 1 US SaaS company that raised funding ${w}.`, "funding"), ["hard/365"], w);
  }
  assertEquals(explicitWindowDays("funded in the last 12 months"), 365);
  // Two compilers' integers for the same span compare equal; different spans do not.
  assert(sameWindow(360, 365) && sameWindow(720, 730) && sameWindow(180, 183));
  assertFalse(sameWindow(180, 365));
  assertEquals(canonicalWindowDays(183), 180, "months keep the 30-day convention");
});

Deno.test("WINDOW: plain 'recently funded' keeps its soft default target", () => {
  assertEquals(kindOf("Find 1 US SaaS company that was recently funded.", "funding"), ["target/180"]);
});

Deno.test("ELEVATION: 'must currently be hiring a growth role' is a HARD hiring requirement", () => {
  assertEquals(kindOf("Find 1 US SaaS company that must currently be hiring a growth role.", "hiring"), ["hard/30"]);
  assertEquals(kindOf("Find 1 US SaaS company that is currently hiring a growth role.", "hiring"), ["target/30"],
    "generic hiring language stays soft");
});

Deno.test("ELEVATION is clause-local: a modal on geography does not harden funding", () => {
  assertEquals(kindOf("Find companies that must be in the US and recently raised.", "funding"), ["target/180"]);
});

Deno.test("A STATED WINDOW BELONGS TO ITS OWN CLAUSE: hiring keeps 30 days beside a 12-month funding window", () => {
  assertEquals(kindOf(CANARY, "funding"), ["hard/365"]);
  assertEquals(kindOf(CANARY, "hiring"), ["hard/30"]);
});

// ═══════════════════════════════════════════════════ 3. growth-role semantics ══

const vocabFor = (q: string) => buildQualificationContext(compiled(q) as never, { criteriaAuthority: true }).role_vocabulary;

Deno.test("GROWTH: 'a growth role' is the growth family — one search keyword, no sales ladder", () => {
  const v = vocabFor(CANARY);
  assertEquals(hiringSearchTitles(v), ["growth"]);
  for (const t of v.required_titles) assertFalse(/sdr|bdr|account executive|\bae\b|sales/.test(t), t);
  assertEquals(classifyRoleFamily("a growth role"), "growth");
});

Deno.test("GROWTH: an ordinary AE or SDR posting does not satisfy a growth role", () => {
  for (const t of ["Account Executive", "SDR", "Enterprise AE", "Sales Development Representative"]) {
    assertFalse(roleMatchesFamily(t, "growth"), t);
  }
  for (const t of ["Head of Growth", "Growth Manager", "VP of Growth", "Growth Product Manager"]) assert(roleMatchesFamily(t, "growth"), t);
});

Deno.test("GROWTH: an explicit sales role uses the sales family; a named marketing title keeps its family", () => {
  assert(hiringSearchTitles(vocabFor("Find US SaaS companies hiring a sales role.")).includes("account executive"));
  const marketer = hiringSearchTitles(vocabFor("Find US SaaS companies hiring a growth marketer."));
  assert(marketer.includes("growth marketer"));
  assertFalse(marketer.some((t) => /sdr|account executive/.test(t)), "a growth marketer is never widened into sales");
});

Deno.test("GROWTH: the job-search spec is bounded by the requested family — one title, ten rows a company", () => {
  const io = { titles: hiringSearchTitles(vocabFor(CANARY)), window_days: 30 };
  const input = hiringVerifierInput(io, ["https://www.linkedin.com/company/acme"])!;
  assertEquals([input.jobTitles, input.maxItems, input.postedLimit], [["growth"], 10, "month"]);
  assertEquals(hiringEstimatePerTargetUsd(io), 0.011, "start $0.001 + 10 rows × $0.001 — not 20 titles × 10 rows");
  assertEquals(coveringTitles(["growth", "vp of growth", "ae", "enterprise ae", "aerospace"]), ["growth", "ae", "aerospace"]);
});

// ═══════════════════════════════════════════════════════ 4. Firecrawl pricing ══

const noRate = () => undefined;
const withRate = (r: string) => (k: string) => (k === "FIRECRAWL_USD_PER_CREDIT" ? r : undefined);
function ledger(usd = 0.15) {
  return createSpendLedger(tightenCeilings(resolveCeilings(null, false), parseRunBudget({ provider_usd: usd, max_candidates: 3 })!));
}

Deno.test("FIRECRAWL: under a USD cap with no account rate the call is UNPRICED and not executable", () => {
  const rate = webEvidenceCreditRate(noRate, { usd_capped: true });
  assertEquals(rate, { usd_per_credit: null, basis: "unpriced" });
  for (const kind of ["page", "map"] as const) {
    const spec = compileWebEvidenceSpec({ url: "https://acme.com", company_key: "acme", request_id: "r", kind,
      scope: { workspace_id: "w", lineage_id: "l" }, mission_hash: "h", plan: { plan_id: null, version: null },
      ledger: ledger(), usd_per_credit: rate.usd_per_credit });
    assertEquals([spec.status, spec.refusal?.code], ["refused_budget", "unpriced_under_usd_cap"], kind);
  }
  assertEquals(businessModelEstimatePerTargetUsd(null), null);
  // Uncapped runs keep the labelled budget assumption, as before.
  assertEquals(webEvidenceCreditRate(noRate).basis, "budget_assumption");
  assertEquals(webEvidenceCreditRate(noRate).usd_per_credit, FIRECRAWL_BUDGET_USD_PER_CREDIT);
});

Deno.test("FIRECRAWL: a configured rate is the ONE price — estimate, reservation and settlement", async () => {
  const rate = webEvidenceCreditRate(withRate("0.002"), { usd_capped: true });
  assertEquals(rate, { usd_per_credit: 0.002, basis: "account_rate" });
  assertEquals(businessModelEstimatePerTargetUsd(rate.usd_per_credit), 0.008, "1 map + 3 pages, one credit each");
  // The MAP is now a reserved, settled purchase on the mission ledger.
  const state = { spend_ledger: ledger(), mission_trace: { version: 1, events: [] } as never, retrieval_plans: [] };
  let sent = 0;
  const map = specGovernedMapper({ state: state as never, scope: { workspace_id: "w", lineage_id: "l" },
    usd_per_credit: rate.usd_per_credit, max_urls: 50, send: () => { sent++; return Promise.resolve(["https://acme.com/pricing"]); } });
  assertEquals(await map({ domain: "acme.com", company_key: "acme" }), ["https://acme.com/pricing"]);
  const r = state.spend_ledger.reservations.find((x) => x.purpose === "web_evidence")!;
  // SETTLED, not left `executed`: Firecrawl gives no receipt to wait for, so the
  // published rule at the configured rate closes it (canary 3be88a89).
  assertEquals([sent, r.estimate_usd, r.status, r.settled_usd, r.settlement_source, r.settlement_stable],
    [1, 0.002, "settled", 0.002, "derived_floor", true]);
  // …and unpriced, it is never sent.
  const unpriced = specGovernedMapper({ state: { ...state, spend_ledger: ledger() } as never, scope: { workspace_id: "w", lineage_id: "l" },
    usd_per_credit: null, max_urls: 50, send: () => { sent++; return Promise.resolve([]); } });
  assertEquals(await unpriced({ domain: "acme.com", company_key: "acme" }), []);
  assertEquals(sent, 1, "no unpriced map reached the provider");
});

// ═══════════════════════════════ 2 + 5. the gap loop: viability and ordering ══

const MISSION = compiled(CANARY, { min: 11, max: 50 });
const CRITERIA = deriveMissionCriteria(MISSION as never, PRODUCTION_READINESS);
const CLAIM_PLAN = buildClaimPlan(CRITERIA, "general_company_discovery", PRODUCTION_READINESS);
const NOW = new Date();

/** A company record as company details returns it. */
const record = (slug: string, country: string, band: [number, number]) => ({
  id: slug, name: slug, linkedinUrl: `https://www.linkedin.com/company/${slug}/`, website: `https://${slug}.com`,
  employeeCount: 999, employeeCountRange: { start: band[0], end: band[1] },
  industries: [{ id: 4, name: "Software Development" }],
  locations: [{ country, headquarter: true, parsed: { text: `City, ${country}`, countryFull: country } }],
});
const COMPANIES = {
  viable: record("viable", "US", [11, 50]),
  german: record("german", "DE", [11, 50]),
  big: record("big", "US", [201, 500]),
  consumer: record("consumer", "US", [11, 50]),
};

function world() {
  const items = new Map<string, EvidenceItem[]>();
  const tried = new Map<string, string[]>();
  for (const [key, row] of Object.entries(COMPANIES)) {
    items.set(key, observationFromCompany(normalizeLinkedInCompanyEnriched(row), {
      capability: "company_enrichment", actor_key: "apify_linkedin_company_details", provider: "apify", route_id: null,
      plan_version: null, provider_call_id: "pc_details", mission_id: "m", observed_at: NOW.toISOString(),
    }).evidence.map((e) => ({ ...e, company_key: key })));
    tried.set(key, []);
  }
  const eligibilityLog: Array<Record<string, string>> = [];
  const candidates = (): VerifiableCandidate[] => {
    const snap: Record<string, string> = {};
    const out = Object.entries(COMPANIES).map(([key, row]) => {
      const graph = buildCompanyEvidenceGraph(key, items.get(key)!, { now: NOW });
      const e = evaluateEligibility(CRITERIA, graph);
      snap[key] = e.eligibility;
      return { company_key: key, name: key, domain: `${key}.com`, linkedin_url: row.linkedinUrl, graph,
        eligibility: e.eligibility, hard_checks: e.checks.filter((c) => c.kind === "hard"), attempted_routes: tried.get(key)! };
    });
    eligibilityLog.push(snap);
    return out;
  };
  const apply = (f: VerifierFinding, v: ClaimVerifier) => {
    tried.get(f.company_key)!.push(v.route_actor);
    if (f.item) items.get(f.company_key)!.push(f.item);
    return !!f.item;
  };
  return { items, candidates, apply, eligibilityLog };
}

const item = (key: string, dimension: string, value: unknown, status: EvidenceItem["status"], actor: string): EvidenceItem => ({
  evidence_id: `t_${key}_${dimension}`, company_key: key, dimension: dimension as never, value, status,
  source: { provider: "test", actor, provider_call_id: "pc", url: null, excerpt: null }, method: "provider_field",
  observed_at: NOW.toISOString(), valid_until: null, confidence: "high", derived_from: [], mission_id: "m", origin: "lead_mission",
} as EvidenceItem);

/** Stand-ins for the page and funding verifiers, same routes, same estimates shape, recording who they were asked about. */
function fakeVerifier(key: string, claim: string, route_actor: string, estimate: number,
  answer: (k: string) => EvidenceItem | null, asked: string[]): ClaimVerifier {
  return {
    key, claim, route_actor, max_targets: 5, estimate_per_target_usd: () => estimate,
    verify: (targets) => {
      asked.push(...targets.map((t) => t.company_key));
      return Promise.resolve({ pending: [], findings: targets.map((t) => ({ company_key: t.company_key, item: answer(t.company_key), answered: true, detail: {} })) });
    },
  };
}

async function runPhase(opts: { jobRows?: (companies: string[]) => Record<string, unknown>[]; hiringHard?: boolean } = {}) {
  const w = world();
  const asked = { firecrawl: [] as string[], atomus: [] as string[], jobs: [] as string[][] };
  const business = fakeVerifier("business_model_first_party_pages", "business_model", "firecrawl", 0.008,
    (k) => k === "consumer" ? item(k, "business_model", "consumer app", "disproven", "grounded_evidence_evaluation")
      : item(k, "business_model", "b2b saas", "proven", "grounded_evidence_evaluation"), asked.firecrawl);
  const funding = fakeVerifier("funding_stage_corroboration", "funding_stage", "apify_funding_atomus", 0.00355,
    (k) => item(k, "funding", true, "proven", "apify_funding_atomus"), asked.atomus);
  const vocab = buildQualificationContext(MISSION as never, { criteriaAuthority: true }).role_vocabulary;
  const hiring = hiringClaimVerifier({
    titles: hiringSearchTitles(vocab), role_families: ["growth"], window_days: 30,
    matchesRole: (t) => roleMatchesFamily(t, "growth"),
  });
  const plan = opts.hiringHard === false
    ? buildClaimPlan(CRITERIA.map((c) => c.dimension === "hiring" ? { ...c, kind: "target" as const } : c), "general_company_discovery", PRODUCTION_READINESS)
    : CLAIM_PLAN;
  const report = await runClaimVerificationPhase({
    mission_id: "m", requested_count: 1, claim_plan: plan,
    candidates: w.candidates,
    qualified: () => w.candidates().filter((c) => c.eligibility === "eligible").length,
    criteriaValue: (id) => CRITERIA.find((c) => c.id === id)?.value ?? null,
    verifiers: [hiring, funding, business], readiness: PRODUCTION_READINESS, pending: [], apply: w.apply,
    deps: {
      call: (c) => {
        const companies = (c.input.company as string[]) ?? [];
        asked.jobs.push(companies);
        return Promise.resolve({ status: "ok", provider_call_id: "pc_jobs", rows: (opts.jobRows ?? (() => []))(companies) });
      },
      now: () => NOW.toISOString(), log: () => {},
    },
  });
  return { report, asked, w };
}
const posting = (slug: string, title: string) => ({
  id: `${slug}-${title}`, title, linkedinUrl: `https://www.linkedin.com/jobs/view/${slug}`,
  postedDate: NOW.toISOString(), company: { name: slug, linkedinUrl: `https://www.linkedin.com/company/${slug}/` },
});

Deno.test("GAP LOOP: country and size failures are settled free — zero Firecrawl, Atomus or job-search calls", async () => {
  const { asked } = await runPhase({ jobRows: (cs) => cs.map((u) => posting(u.split("/company/")[1].replace(/\/$/, ""), "Head of Growth")) });
  for (const failed of ["german", "big"]) {
    assertFalse(asked.firecrawl.includes(failed), `firecrawl for ${failed}`);
    assertFalse(asked.atomus.includes(failed), `atomus for ${failed}`);
    assertFalse(asked.jobs.flat().some((u) => u.includes(`/${failed}`)), `job search for ${failed}`);
  }
});

Deno.test("GAP LOOP: a failure proven by an earlier verifier gets ZERO later verifier calls (re-grounded between stages)", async () => {
  const { asked, report, w } = await runPhase({ jobRows: (cs) => cs.map((u) => posting(u.split("/company/")[1].replace(/\/$/, ""), "Head of Growth")) });
  assertEquals(report.order, ["funding_stage_corroboration", "business_model_first_party_pages", HIRING_CLAIM_VERIFIER_KEY],
    "cheapest canonical estimate first: atomus $0.00355, pages $0.008, jobs $0.011");
  assert(asked.firecrawl.includes("consumer"), "the page verifier disproved B2B SaaS for 'consumer'");
  assertFalse(asked.jobs.flat().some((u) => u.includes("/consumer")), "…so the job search never asked about it");
  // Eligibility was recomputed between the stages, and 'consumer' turned ineligible mid-phase.
  const states = w.eligibilityLog.map((s) => s.consumer);
  assert(states.includes("pending") && states.includes("ineligible"), JSON.stringify(states));
});

Deno.test("GAP LOOP: hiring runs only for the viable candidate with the claim open — and qualifies it", async () => {
  const { asked, w } = await runPhase({ jobRows: () => [posting("viable", "Head of Growth")] });
  assertEquals(asked.jobs, [["https://www.linkedin.com/company/viable"]]);
  assertEquals(w.candidates().find((c) => c.company_key === "viable")!.eligibility, "eligible");
});

Deno.test("GAP LOOP: an AE posting leaves 'hiring a growth role' PENDING, never passed", async () => {
  const { w } = await runPhase({ jobRows: () => [posting("viable", "Account Executive")] });
  const viable = w.candidates().find((c) => c.company_key === "viable")!;
  assertEquals(viable.eligibility, "pending");
  assertEquals(viable.hard_checks.find((h) => h.dimension === "hiring")!.result, "unknown");
});

Deno.test("GAP LOOP: a soft (target) hiring signal buys no job search at all", async () => {
  const { asked, report } = await runPhase({ hiringHard: false, jobRows: () => [posting("viable", "Head of Growth")] });
  assertEquals(asked.jobs, []);
  assert(report.irrelevant.includes(HIRING_CLAIM_VERIFIER_KEY));
});

// ═════════════════════════════════════════════ 6. V2 advisories tell the truth ══

Deno.test("ADVISORIES: the V2 briefing states current capability in positive words", () => {
  const graph = buildCapabilityGraph(MISSION as never, { executability: "enforce", readiness: PRODUCTION_READINESS });
  const text = graph.routing_advisories.join("\n");
  assertFalse(/No registered Actor can DISCOVER/.test(text));
  assertFalse(/DISCOVERY-ONLY/.test(text), "funding is owned by the verifier here");
  assertFalse(/cannot prove any of them/.test(text));
  for (const a of graph.routing_advisories) {
    if (/hiring requirement|startup stage|funding signal/i.test(a)) assertFalse(/\bcannot\b/i.test(a), a);
  }
});

// ═══════════════════════ 2. the in-slice stage buys nothing under the spec spine ══

Deno.test("ENGINE: under the spec spine the in-slice hiring stage buys NO job search — even for a failed-country company", async () => {
  const { runCapabilityPlan } = await import("../../../supabase/functions/_shared/leadCapabilityEngine.ts");
  const { readinessPolicy } = await import("../../../supabase/functions/_shared/routeReadiness.ts");
  const { candidatePool } = await import("../../../supabase/functions/_shared/runBudget.ts");
  const { emptyDiscoverySelector } = await import("./discoverySelectorFixture.ts");
  const readiness = readinessPolicy({});
  const rows = [COMPANIES.german, COMPANIES.viable];
  const sent: Array<{ actor: string; input: Record<string, unknown> }> = [];
  const logs: string[] = [];
  const budget = parseRunBudget({ provider_usd: 0.15, max_candidates: 3 })!;
  await runCapabilityPlan({
    log: (m: string) => logs.push(m),
    planDiscovery: emptyDiscoverySelector(),
    planExecution: () => Promise.resolve({ reasoning: "t", steps: [
      { capability: "general_company_discovery", actor_key: "apify_linkedin_company_search", purpose: "d",
        input: { locations: ["United States"], companySize: ["11-50"], maxItems: 2, scraperMode: "full" }, depends_on: [] },
      { capability: "company_enrichment", actor_key: "apify_linkedin_company_details", purpose: "e", input: { companies: ["{{url}}"] }, depends_on: [1] },
      { capability: "hiring_verification", actor_key: "apify_linkedin_job_search", purpose: "h", input: {}, depends_on: [2] },
      { capability: "company_brain_qualification", actor_key: null, purpose: "q", input: {}, depends_on: [3] },
      { capability: "persistence", actor_key: null, purpose: "p", input: {}, depends_on: [4] },
    ] }),
    controlRoutes: () => Promise.resolve({ action: "continue" }),
    invoke: (call: { actorKey: string; input: Record<string, unknown>; onProviderRun?: (r: { run_id: string; dataset_id: null }) => void }) => {
      sent.push({ actor: call.actorKey, input: call.input });
      call.onProviderRun?.({ run_id: `run-${sent.length}`, dataset_id: null });
      if (call.actorKey === "apify_linkedin_company_search") return Promise.resolve(rows);
      if (call.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve(((call.input.companies as string[]) ?? []).map((u) =>
          rows.find((r) => r.linkedinUrl.replace(/\/$/, "") === u.replace(/\/$/, ""))).filter(Boolean));
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  } as never, {
    mission: MISSION, plan: buildCapabilityGraph(MISSION as never, { executability: "enforce", readiness }),
    maxCandidates: candidatePool(1, budget), runBudget: budget, readiness,
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
    specMode: "enforce", specScope: { workspace_id: "ws", lineage_id: "ln" },
  } as never);
  assertEquals(sent.filter((s) => s.actor === "apify_linkedin_job_search").length, 0,
    JSON.stringify(sent.map((s) => s.actor)));
  assert(sent.some((s) => s.actor === "apify_linkedin_company_details"), "enrichment still ran");
});
