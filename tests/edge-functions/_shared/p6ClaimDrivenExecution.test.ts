// LEAD V2 P6 — CLAIM-DRIVEN EXECUTION, PROVEN BY WHAT IS ACTUALLY CALLED.
//
// Planner-output tests say what a plan intends. These run the ENGINE (discovery,
// identity, enrichment, qualification) and then the VERIFICATION PHASE (the
// one authority that buys verification) against recording fakes, and assert on
// the provider calls that were made:
//
//   hiring only          job discovery runs; no funding, no pages, no team search
//   funding only         funding discovery runs; its rounds become funding
//                        evidence; no job search, no page verification
//   B2B SaaS only        company discovery → the canonical business-model
//                        verifier; no funding, no job calls
//   known companies      zero discovery; only the requested claim's verifier
//   combined             ONE entry; discovery evidence reused; only the needed
//                        verifiers; nothing more once the request is met;
//                        nothing re-bought next slice
//
// Carded discovery actors run here inside an explicit PROVIDER PROBE, exactly
// as a canary would open them; production refusal is pinned in
// `p6RouteSelection.test.ts` and `p0TruthfulFeasibility.test.ts`.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyVerifierFinding, canonicalQualifiedKeys, missionCandidatesFrom, runCapabilityPlan, type EngineCompany,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph, type CapabilityPlan } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic, type LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { readinessPolicy, type ReadinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { runClaimVerificationPhase, type VerificationPhaseReport } from "../../../supabase/functions/_shared/claimVerificationPhase.ts";
import { businessModelVerifier } from "../../../supabase/functions/_shared/businessModelVerifier.ts";
import { fundingStageVerifier } from "../../../supabase/functions/_shared/fundingStageVerifier.ts";
import { ledgerBoundCall, type PendingVerifierRun } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { fundingRecordsInGraph } from "../../../supabase/functions/_shared/fundingCorroboration.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import { verifierSpecCompiler } from "../../../supabase/functions/_shared/verifierCallSpec.ts";
import { criteriaExecutionPolicy } from "../../../supabase/functions/_shared/criteriaExecutionPolicy.ts";
import { guardedInvoker } from "../../../supabase/functions/_shared/leadMissionRuntime.ts";
import { hashInput } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { computeEvidenceDebts } from "../../../supabase/functions/_shared/webEvidenceDebt.ts";
import { buildClaimPlan } from "../../../supabase/functions/_shared/claimPlan.ts";

globalThis.fetch = () => { throw new Error("claim-driven execution tests must not reach the network"); };

type Row = Record<string, unknown>;
interface Call { actor: string; capability: string | null; input: Row }

const DISCOVERY = new Set([
  "job_discovery", "funding_signal_discovery", "general_company_discovery", "startup_company_discovery",
  "expansion_signal_discovery", "product_launch_discovery",
]);
const FUNDING_ACTORS = ["apify_funding_rounds_datahyena", "apify_funding_atomus", "apify_funding_pvalyou"];
const TEAM = "apify_linkedin_company_employees";

/** An explicit probe opening the carded routes these missions need — as a canary would. */
const PROBE: ReadinessPolicy = readinessPolicy({ mode: "provider_probe", probe_routes: [
  "apify_funding_rounds_datahyena|funding_signal_discovery",
  "apify_linkedin_company_search|general_company_discovery",
  "apify_funding_atomus|funding_verification",
  "apify_funding_pvalyou|funding_verification",
] });

// ── fixtures: companies as each provider returns them ──────────────────────

interface Co { name: string; slug: string; domain: string; employees: number; description: string }
const CO: Record<string, Co> = {
  ledgerly: { name: "Ledgerly", slug: "ledgerly", domain: "ledgerly.io", employees: 14, description: "Ledgerly is a B2B SaaS fintech platform for finance teams." },
  paystack: { name: "Paystream", slug: "paystream", domain: "paystream.io", employees: 22, description: "Paystream builds payments infrastructure for businesses." },
  vaultline: { name: "Vaultline", slug: "vaultline", domain: "vaultline.io", employees: 60, description: "Vaultline is a B2B SaaS fintech security product." },
};
const li = (c: Co) => `https://www.linkedin.com/company/${c.slug}`;
const detailsRow = (c: Co): Row => ({
  id: c.slug, name: c.name, linkedinUrl: li(c), website: `https://${c.domain}`, employeeCount: c.employees,
  description: c.description, industries: ["Financial Services"], locations: [{ city: "New York", country: "US" }],
});
const searchRow = (c: Co): Row => ({
  id: c.slug, name: c.name, linkedinUrl: li(c), website: `https://${c.domain}`, description: c.description,
  location: "New York, NY", employeeCount: c.employees,
});
const roundRow = (c: Co, round: string, date: string): Row => ({
  id: `rnd-${c.slug}-${round}`, round, amountUsd: 3_000_000, announcedAt: date,
  company: { name: c.name, domain: c.domain, linkedinUrl: li(c), hqCity: "New York", hqCountry: { name: "United States" } },
  investors: [{ id: "i1", name: "Seedfund" }],
  sources: [{ url: `https://news.example/${c.slug}-${round}` }],
});
const atomusRow = (c: Co, rounds: Array<[string, string]>): Row => ({
  input: li(c), status: "success",
  summary: { linkedin_url: li(c), domain: c.domain, last_updated: "2026-09-01" },
  company: { financial: { funding: {
    num_funding_rounds: rounds.length,
    rounds: rounds.map(([type, at]) => ({ type, announced_at: at, raised_amount: 3_000_000, investors: ["Seedfund"] })),
  } } },
});
const jobRow = (c: Co, title: string): Row => ({
  id: `job-${c.slug}`, title, linkedinUrl: `https://www.linkedin.com/jobs/view/${c.slug}/`,
  descriptionText: `${c.name} is hiring a ${title}.`, postedDate: "2026-09-10", location: { linkedinText: "New York, NY" },
  company: { id: c.slug, universalName: c.slug, name: c.name, linkedinUrl: li(c), website: `https://${c.domain}`,
    employeeCount: c.employees, description: c.description, industries: ["Financial Services"],
    locations: [{ city: "New York", country: "US" }] },
});

// ── the harness ─────────────────────────────────────────────────────────────

interface Run {
  calls: Call[];
  plan: CapabilityPlan;
  result: { companies: EngineCompany[]; state: Record<string, any> };
  phase: VerificationPhaseReport;
  qualified: string[];
  mission: LeadMissionV1;
}

async function execute(o: {
  mission: LeadMissionV1;
  readiness?: ReadinessPolicy;
  /** What the discovery selector proposes (actor + input). */
  selections: Row[];
  rows: Partial<Record<string, (input: Row) => Row[]>>;
  /** First-party pages the site serves, and the business model a re-reading of them states. */
  site?: Record<string, { pages: number; model: string | null }>;
  prior?: Run;
  /** Runs after the engine, before verification — to set what the legacy Brain believes. */
  beforeVerify?: (companies: EngineCompany[]) => void;
}): Promise<Run> {
  const readiness = o.readiness ?? PROBE;
  const calls: Call[] = [];
  const record = (actor: string, capability: string | null, input: Row) => calls.push({ actor, capability, input });
  const plan = o.prior?.plan ?? buildCapabilityGraph(o.mission, { executability: "enforce", readiness });
  const result = o.prior?.result ?? await runCapabilityPlan({
    planDiscovery: () => Promise.resolve(o.selections),
    invoke: (call: { actorKey: string; input: unknown; providerCallSpec?: { capability?: string };
      onProviderRun?: (r: { run_id: string; dataset_id: null }) => void }) => {
      record(call.actorKey, call.providerCallSpec?.capability ?? null, call.input as Row);
      call.onProviderRun?.({ run_id: `run-${calls.length}`, dataset_id: null });
      return Promise.resolve(o.rows[call.actorKey]?.(call.input as Row) ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  } as never, {
    mission: o.mission, plan, maxCandidates: 10, readiness,
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
    specMode: "enforce", specScope: { workspace_id: "ws-cd", lineage_id: "lineage-cd" },
  } as never) as never as Run["result"];

  o.beforeVerify?.(result.companies);
  const missionId = "task-cd";
  const criteria = deriveMissionCriteria(o.mission);
  const byKey = (k: string) => result.companies.find((c) => c.key === k)!;
  const candidates = () => missionCandidatesFrom(result, { missionId }).map((cand) => {
    const e = evaluateEligibility(criteria, cand.graph);
    return {
      company_key: cand.company_key, name: cand.name, domain: cand.domain, linkedin_url: cand.linkedin_url,
      graph: cand.graph, eligibility: e.eligibility, hard_checks: e.checks.filter((x) => x.kind === "hard"),
      attempted_routes: cand.attempted_routes ?? [],
    };
  });
  const qualified = () => canonicalQualifiedKeys(result.companies, {
    mission: o.mission, plan: { entry_capability: plan.entry_capability }, identity: { task_id: missionId },
  });
  const business = businessModelVerifier({
    collect: (targets) => {
      const out: Record<string, { pages_ok: number; outcome: string }> = {};
      for (const t of targets) {
        record("firecrawl", "web_evidence", { domain: t.domain });
        out[t.company_key] = { pages_ok: o.site?.[String(t.domain)]?.pages ?? 0, outcome: "collected" };
      }
      return Promise.resolve(out);
    },
    reground: (key) => {
      const c = byKey(key);
      const domain = c.enriched?.canonical_domain ?? c.company.canonical_domain ?? "";
      const model = o.site?.[domain]?.model ?? null;
      if (!model) return Promise.resolve({ status: "plausible", decision: "review", skipped: null });
      const item: EvidenceItem = {
        evidence_id: `grd_${key}_business_model`, company_key: key, dimension: "business_model", value: model,
        status: "proven", source: { provider: "engine", actor: "grounded_evidence_evaluation", provider_call_id: null,
          url: `https://${domain}/product`, excerpt: model },
        method: "model_extraction", observed_at: "2026-09-19T12:00:00.000Z", valid_until: null, confidence: "medium",
        derived_from: [], mission_id: missionId, origin: "web",
        assessment: { decision: "pass", grounding_score: 0.95, validated_claims: 2, business_model_decision: "accepted" },
      } as EvidenceItem;
      applyVerifierFinding(c, { company_key: key, item, answered: false, detail: {} }, { key: "reground", route_actor: "firecrawl" });
      return Promise.resolve({ status: "proven", decision: "pass", skipped: null });
    },
  });
  const phase = await runClaimVerificationPhase({
    mission_id: missionId,
    claim_plan: buildClaimPlan(criteria, plan.entry_capability, readiness),
    requested_count: Math.max(1, Number(o.mission.requested_count ?? 1)),
    candidates, qualified: () => qualified().length,
    criteriaValue: (id) => criteria.find((c) => c.id === id)?.value ?? null,
    verifiers: [fundingStageVerifier(), business],
    readiness,
    pending: (result.state.verifier_pending_runs ?? []) as PendingVerifierRun[],
    deps: {
      call: ledgerBoundCall({
        ledger: result.state.spend_ledger,
        // The production wiring: the spec compiler and the guarded invoker.
        spec: verifierSpecCompiler({
          scope: { workspace_id: "ws-cd", lineage_id: "lineage-cd" }, mission_hash: "mh-cd",
          policy: criteriaExecutionPolicy(o.mission), ceilings: () => result.state.spend_ledger.ceilings, readiness,
        }),
        actorIdFor: (actor) => hiringActorCard(actor)?.actor_id ?? null,
        invoke: guardedInvoker(null, (call) => {
          record(call.actorKey, call.providerCallSpec.capability, call.input);
          return Promise.resolve(o.rows[call.actorKey]?.(call.input) ?? []);
        }, undefined, readiness),
        hash: (input, actor) => hashInput(input, actor),
      }),
      now: () => "2026-09-19T12:00:00.000Z",
      log: () => {},
    },
    apply: (f, v) => applyVerifierFinding(byKey(f.company_key), f, v),
  });
  result.state.verifier_pending_runs = phase.pending;
  return { calls, plan, result, phase, qualified: qualified(), mission: o.mission };
}

const actors = (r: Run) => r.calls.map((c) => c.actor);
const discoveryCalls = (r: Run) => r.calls.filter((c) => c.capability && DISCOVERY.has(c.capability));
const count = (r: Run, actor: string) => r.calls.filter((c) => c.actor === actor).length;

// ── 1. hiring only ──────────────────────────────────────────────────────────

Deno.test("HIRING ONLY: job discovery executes; funding, page verification and team search do not", async () => {
  const mission = parseLeadMissionDeterministic("Find companies hiring growth marketers");
  const r = await execute({
    mission, readiness: readinessPolicy(), // production: the whole job route is READY
    selections: [{ actor_key: "apify_linkedin_job_search", role: "primary",
      input: { jobTitles: ["growth marketer"], locations: ["United States"], postedLimit: "month", maxItems: 10 } }],
    rows: {
      apify_linkedin_job_search: (i) => i.company ? [] : [jobRow(CO.ledgerly, "Growth Marketer"), jobRow(CO.vaultline, "Growth Marketing Manager")],
      apify_linkedin_company_details: (i) => ((i.companies as string[]) ?? []).map((u) => detailsRow(Object.values(CO).find((c) => li(c) === u)!)),
    },
    site: { "ledgerly.io": { pages: 3, model: "b2b saas" } },
  });
  assertEquals(r.plan.entry_capability, "job_discovery");
  assert(discoveryCalls(r).length > 0 && discoveryCalls(r).every((c) => c.actor === "apify_linkedin_job_search"),
    JSON.stringify(discoveryCalls(r)));
  for (const a of FUNDING_ACTORS) assertEquals(count(r, a), 0, `${a} never called`);
  assertEquals(count(r, "firecrawl"), 0, "no hard business-model claim, so no pages are bought");
  assertEquals(count(r, TEAM), 0, "no team search");
  assert(r.result.companies.length >= 2, "the employers entered the pool");
});

// ── 2. funding only ─────────────────────────────────────────────────────────

const FUNDING_ROWS = [
  roundRow(CO.ledgerly, "seed", "2026-08-20"),
  roundRow(CO.vaultline, "series-a", "2026-08-05"),
];
const fundingRows = (extra: Partial<Record<string, (i: Row) => Row[]>> = {}) => ({
  apify_funding_rounds_datahyena: () => FUNDING_ROWS,
  apify_linkedin_company_search: (i: Row) => {
    const q = String(i.searchQuery ?? "").toLowerCase();
    return Object.values(CO).filter((c) => q.includes(c.name.toLowerCase())).map(searchRow);
  },
  apify_linkedin_company_details: (i: Row) => ((i.companies as string[]) ?? [])
    .map((u) => Object.values(CO).find((c) => li(c) === u)).filter((c): c is Co => !!c).map(detailsRow),
  ...extra,
});
const fundingSelection = [{ actor_key: "apify_funding_rounds_datahyena", role: "primary",
  input: { rounds: ["seed"], maxItems: 10 } }];

Deno.test("FUNDING ONLY: funding discovery executes and its rounds become funding evidence; no job search, no page verification", async () => {
  const mission = parseLeadMissionDeterministic("Find recently Seed-funded companies");
  const r = await execute({ mission, selections: fundingSelection, rows: fundingRows(),
    site: { "ledgerly.io": { pages: 3, model: "b2b saas" } } });
  assertEquals(r.plan.entry_capability, "funding_signal_discovery");
  assert(discoveryCalls(r).length > 0 && discoveryCalls(r).every((c) => c.actor === "apify_funding_rounds_datahyena"));
  assertEquals(count(r, "apify_linkedin_job_search"), 0, "no job search of any kind");
  assertEquals(count(r, "firecrawl"), 0, "no B2B web verification");
  assertEquals(count(r, "apify_funding_atomus") + count(r, "apify_funding_pvalyou"), 0,
    "the stage is a TARGET here: a preference never triggers a paid verification");

  // THE ROUND IS PRESERVED AS FUNDING EVIDENCE — a FundingRecordFact, never complete.
  const cands = missionCandidatesFrom(r.result, { missionId: "task-cd" });
  const ledgerly = cands.find((c) => c.domain === "ledgerly.io")!;
  const [rec] = fundingRecordsInGraph(ledgerly.graph);
  assert(rec, "the discovered round is on the company's evidence graph");
  assertEquals([rec.actor, rec.rounds[0].round_type, rec.rounds[0].announced_date, rec.history_complete],
    ["apify_funding_rounds_datahyena", "seed", "2026-08-20", false]);
  assertEquals(rec.rounds[0].source_urls, ["https://news.example/ledgerly-seed"]);
  assertEquals(rec.company?.domain, "ledgerly.io");
  assert(rec.provider_call_id, "it cites the purchase that returned it");
  // DISCOVERED BY A SEED FEED IS NOT SEED PASS: no stage claim is written for it.
  assertFalse(ledgerly.graph.claims.some((c) => c.dimension === "company_stage" &&
    (c.current?.value as { verdict?: string } | null)?.verdict === "pass"));
  // A dated LATER round contradicts the asked stage at discovery.
  const vaultline = cands.find((c) => c.domain === "vaultline.io")!;
  const stage = vaultline.graph.claims.find((c) => c.dimension === "company_stage")!.current!;
  assertEquals([(stage.value as { verdict: string }).verdict, stage.status], ["fail", "disproven"]);
});

// ── 3. B2B SaaS only ────────────────────────────────────────────────────────

Deno.test("B2B SAAS ONLY: company discovery, then the canonical business-model verifier; no funding, no job calls", async () => {
  const mission = parseLeadMissionDeterministic("Find B2B SaaS companies");
  const r = await execute({
    mission, selections: [{ actor_key: "apify_linkedin_company_search", role: "primary",
      input: { searchQuery: "B2B SaaS", maxItems: 10 } }],
    rows: fundingRows({ apify_linkedin_company_search: () => [searchRow(CO.ledgerly), searchRow(CO.vaultline)] }),
    site: { "ledgerly.io": { pages: 3, model: "b2b saas" }, "vaultline.io": { pages: 0, model: null } },
  });
  assertEquals(r.plan.entry_capability, "general_company_discovery");
  assert(discoveryCalls(r).length > 0 && discoveryCalls(r).every((c) => c.actor === "apify_linkedin_company_search"));
  for (const a of FUNDING_ACTORS) assertEquals(count(r, a), 0, a);
  assertEquals(count(r, "apify_linkedin_job_search"), 0);
  // The hard business-model claim was pending, so the ONE authority chose pages.
  const firecrawl = r.calls.filter((c) => c.actor === "firecrawl").map((c) => c.input.domain);
  assert(firecrawl.includes("ledgerly.io"), JSON.stringify(firecrawl));
  assertEquals(r.phase.ran.map((x) => x.verifier), ["business_model_first_party_pages"]);
  assert(r.qualified.length >= 1, "the re-grounded claim qualified a company");
});

// ── 4. known companies + one requested claim ────────────────────────────────

Deno.test("KNOWN COMPANIES + ONE CLAIM: zero discovery; only that claim's verifier runs", async () => {
  const base = parseLeadMissionDeterministic("Find B2B SaaS companies");
  const mission = {
    ...base, mission_type: "known_company_enrichment", original_user_query: "Are ledgerly.io and vaultline.io B2B SaaS?",
    company_profile: { ...base.company_profile, known_companies: ["ledgerly.io", "vaultline.io"] },
  } as LeadMissionV1;
  const r = await execute({
    mission, readiness: readinessPolicy(), selections: [],
    rows: fundingRows({ apify_linkedin_company_search: (i: Row) => {
      const q = String(i.searchQuery ?? "").toLowerCase();
      return Object.values(CO).filter((c) => q.includes(c.slug) || q.includes(c.domain)).map(searchRow);
    } }),
    site: { "ledgerly.io": { pages: 3, model: "b2b saas" }, "vaultline.io": { pages: 3, model: "b2b saas" } },
  });
  assertEquals(r.plan.entry_capability, "known_company_resolution");
  assertEquals(discoveryCalls(r), [], "discovery = zero");
  for (const a of FUNDING_ACTORS) assertEquals(count(r, a), 0, a);
  assertEquals(count(r, TEAM), 0);
  assertEquals(r.phase.ran.map((x) => x.verifier), ["business_model_first_party_pages"], "only the requested claim's verifier");
});

// ── 5. combined ─────────────────────────────────────────────────────────────

const COMBINED = "Find 1 B2B SaaS fintech company that must be seed-stage, recently raised Seed and is hiring growth marketers.";

Deno.test("COMBINED: one entry, discovery evidence reused, only needed verifiers, stop at the request, nothing re-bought", async () => {
  const mission = parseLeadMissionDeterministic(COMBINED);
  const hard = deriveMissionCriteria(mission).filter((c) => c.kind === "hard" && c.status === "ok").map((c) => c.dimension);
  assertEquals([...new Set(hard)].sort(), ["company_stage", "industry"], "hard: business model + stage; funding/hiring are targets");
  const rows = fundingRows({
    apify_funding_rounds_datahyena: () => [...FUNDING_ROWS, roundRow(CO.paystack, "seed", "2026-08-25")],
    // atomus: Ledgerly's complete history is one Seed round — the same one the feed cited.
    apify_funding_atomus: (i: Row) => ((i.companies as string[]) ?? []).map((u) =>
      u.includes("ledgerly") ? atomusRow(CO.ledgerly, [["seed", "2026-08-20"]])
        : u.includes("paystream") ? atomusRow(CO.paystack, [["seed", "2026-08-25"]]) : { input: u, status: "not_found" }),
    apify_linkedin_job_search: () => [],
  });
  const site = { "ledgerly.io": { pages: 3, model: "b2b saas fintech" }, "paystream.io": { pages: 3, model: "b2b saas fintech" } };
  const r = await execute({ mission, selections: fundingSelection, rows, site });

  // ONE discovery entry.
  assertEquals(r.plan.entry_capability, "funding_signal_discovery");
  assertEquals([...new Set(discoveryCalls(r).map((c) => c.actor))], ["apify_funding_rounds_datahyena"]);
  // Cheapest verifier first — by the CANONICAL per-target estimate each
  // verifier publishes (atomus: its card, $0.00355 a company), not the static
  // registry hint the page verifier falls back to when no Firecrawl rate is
  // passed ($0.0192). The later-round company was never bought for: discovery
  // already FAILED Vaultline's stage.
  assertEquals(r.phase.order, ["funding_stage_corroboration", "business_model_first_party_pages"]);
  for (const c of r.calls.filter((x) => x.actor === "firecrawl" || x.actor === "apify_funding_atomus")) {
    assertFalse(JSON.stringify(c.input).includes("vaultline"), `no verification bought for a disproven company: ${JSON.stringify(c.input)}`);
  }
  // DISCOVERY EVIDENCE REUSED: atomus proved completeness, the feed's article
  // cited the Seed round, so pvalyou was never bought.
  assert(count(r, "apify_funding_atomus") >= 1, "completeness had to be proven");
  assertEquals(count(r, "apify_funding_pvalyou"), 0, "the discovered round supplied the citation");
  // One lead asked for: each verifier was given at most twice the shortfall,
  // so at most two companies were verified — and the request is met.
  for (const ran of r.phase.ran) assert(ran.targets.length <= 2, `${ran.verifier}: ${ran.targets.length}`);
  assert(r.qualified.length >= 1 && r.qualified.length <= 2, `qualified ${r.qualified.length}`);

  // SECOND SLICE: every claim that was answered stays answered — nothing re-bought.
  const again = await execute({ mission, selections: fundingSelection, rows, site, prior: r });
  assertEquals(again.calls, [], `nothing re-bought: ${JSON.stringify(again.calls.map((c) => c.actor))}`);
  assertEquals(again.phase.stopped, "quota_met");
});

Deno.test("COMBINED: once the request is met, no further verifier buys anything", async () => {
  const mission = parseLeadMissionDeterministic(COMBINED);
  const rows = fundingRows({
    apify_funding_rounds_datahyena: () => [roundRow(CO.ledgerly, "seed", "2026-08-20"), roundRow(CO.paystack, "seed", "2026-08-25")],
    apify_funding_atomus: (i: Row) => ((i.companies as string[]) ?? []).map((u) =>
      u.includes("ledgerly") ? atomusRow(CO.ledgerly, [["seed", "2026-08-20"]]) : atomusRow(CO.paystack, [["seed", "2026-08-25"]])),
  });
  // Both sites are B2B SaaS fintech: the cheap verifier alone cannot qualify
  // anyone (the stage is still unproven), so funding runs — for at most twice
  // the one missing lead, and then the phase stops.
  const r = await execute({ mission, selections: fundingSelection, rows,
    site: { "ledgerly.io": { pages: 3, model: "b2b saas fintech" }, "paystream.io": { pages: 3, model: "b2b saas fintech" } } });
  for (const ran of r.phase.ran) assert(ran.targets.length <= 2, `${ran.verifier}: ${ran.targets.length} targets for 1 missing lead`);
  assert(r.qualified.length >= 1);
});

// ── 6. the legacy web purchaser no longer decides ──────────────────────────

/** What the legacy Brain's evaluation says about a company. */
const legacyVerdict = (c: EngineCompany, decision: "qualified" | "insufficient_evidence") => {
  (c as unknown as Record<string, unknown>).mission_evaluation = {
    decision, match_score: 80, failed_requirements: [], hiring_fit: "verified",
    unknown_fields: decision === "insufficient_evidence" ? ["is it B2B SaaS?"] : [],
  };
  c.identity = { ...(c.identity ?? {}), status: "verified_match" } as never;
  c.enriched = { ...(c.enriched ?? {}), canonical_domain: c.company.canonical_domain } as never;
};
const legacyDebtFor = (c: EngineCompany) =>
  computeEvidenceDebts([c as never], { max_companies: 5 }).debts.some((d) => d.company_key === c.key);
const provenModel = (c: EngineCompany) => applyVerifierFinding(c, { company_key: c.key, answered: false, detail: {}, item: {
  evidence_id: `grd_${c.key}_business_model`, company_key: c.key, dimension: "business_model", value: "b2b saas",
  status: "proven", source: { provider: "engine", actor: "grounded_evidence_evaluation", provider_call_id: null, url: null, excerpt: "B2B SaaS" },
  method: "model_extraction", observed_at: "2026-09-19T12:00:00.000Z", valid_until: null, confidence: "medium",
  derived_from: [], mission_id: "task-cd", origin: "web",
  assessment: { decision: "pass", grounding_score: 0.9, validated_claims: 2, business_model_decision: "accepted" },
} as EvidenceItem }, { key: "prior", route_actor: "grounded_evidence_evaluation" });

Deno.test("LEGACY PURCHASER GONE (1): canonical gap + legacy Brain says NO debt → Firecrawl still runs", async () => {
  const mission = parseLeadMissionDeterministic("Find B2B SaaS companies");
  let legacySaid: boolean | null = null;
  const r = await execute({
    mission, selections: [{ actor_key: "apify_linkedin_company_search", role: "primary", input: { searchQuery: "B2B SaaS", maxItems: 10 } }],
    rows: fundingRows({ apify_linkedin_company_search: () => [searchRow(CO.ledgerly)] }),
    site: { "ledgerly.io": { pages: 3, model: "b2b saas" } },
    beforeVerify: (cs) => {
      const ledgerly = cs.find((c) => c.company.canonical_domain === "ledgerly.io")!;
      legacyVerdict(ledgerly, "qualified");
      legacySaid = legacyDebtFor(ledgerly);
    },
  });
  assertEquals(legacySaid, false, "the legacy Brain sees nothing to research");
  assertEquals(r.calls.filter((c) => c.actor === "firecrawl").map((c) => c.input.domain), ["ledgerly.io"],
    "the canonical business-model gap bought the pages anyway");
});

Deno.test("LEGACY PURCHASER GONE (2): legacy Brain says debt + canonical claim already resolved → Firecrawl does NOT run", async () => {
  const mission = parseLeadMissionDeterministic("Find B2B SaaS companies");
  let legacySaid: boolean | null = null;
  const r = await execute({
    mission, selections: [{ actor_key: "apify_linkedin_company_search", role: "primary", input: { searchQuery: "B2B SaaS", maxItems: 10 } }],
    rows: fundingRows({ apify_linkedin_company_search: () => [searchRow(CO.ledgerly)] }),
    site: { "ledgerly.io": { pages: 3, model: "b2b saas" } },
    beforeVerify: (cs) => {
      const ledgerly = cs.find((c) => c.company.canonical_domain === "ledgerly.io")!;
      provenModel(ledgerly);
      legacyVerdict(ledgerly, "insufficient_evidence");
      legacySaid = legacyDebtFor(ledgerly);
    },
  });
  assertEquals(legacySaid, true, "the legacy Brain would have researched it");
  assertEquals(count(r, "firecrawl"), 0, "the canonical claim is answered: nothing is bought");
  assertEquals(r.qualified.length, 1);
});

Deno.test("LEGACY PURCHASER GONE (source): under Lead V2 the evidence-debt route never runs; the phase is the only buyer", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  // The exclusion used to read `&& !p2Specs`, which tied it to the spec spine:
  // with `LEAD_V2_SPECS=off` a Lead V2 mission fell back to the legacy owner.
  // It now asks the property that actually matters.
  assert(src.includes("const legacyEvidenceDebtAllowed = !isLeadV2Mission;"),
    "the legacy debt route must be excluded for Lead V2 by mission mode, not by the spec flag");
  assert(src.includes('const isLeadV2Mission = intelligence.mode === "new_architecture" && !!capabilityRun;'),
    "and Lead V2 must be identified by the mission mode the rest of the run keys off");
  assert(src.includes('if ((evidenceMode === "plan_only" || evidenceMode === "execute") && legacyEvidenceDebtAllowed) {'),
    "the legacy debt/collection/re-evaluation block is V1-only");
  // And the canonical verifier no longer asks the V1 flag for permission.
  assert(src.includes("if (!webVerificationEnabled) return {};"),
    "canonical claim verification must own its own spend switch");
  const phase = src.indexOf("const phase = await runClaimVerificationPhase({");
  const debt = src.indexOf("computeEvidenceDebts(debtCandidates");
  assert(phase > 0 && debt > 0);
  // The V2 business-model verifier plans its pages from the claim, never from a debt.
  assert(src.includes("const debts = claimPageDebts(targets);"));
  assert(src.includes("plan: () => Promise.resolve(claimPagePlan(debts, intents)),"));
});

Deno.test("SECOND SLICE below the request: every answered claim stays answered — nothing re-bought", async () => {
  const mission = parseLeadMissionDeterministic(COMBINED.replace("Find 1 ", "Find 5 ").replace("company that", "companies that").replace("is hiring", "are hiring"));
  assertEquals(mission.requested_count, 5);
  const rows = fundingRows({
    apify_funding_rounds_datahyena: () => [roundRow(CO.ledgerly, "seed", "2026-08-20"), roundRow(CO.paystack, "seed", "2026-08-25")],
    apify_funding_atomus: (i: Row) => ((i.companies as string[]) ?? []).map((u) =>
      u.includes("ledgerly") ? atomusRow(CO.ledgerly, [["seed", "2026-08-20"]]) : { input: u, status: "not_found" }),
    apify_funding_pvalyou: () => [],
  });
  const site = { "ledgerly.io": { pages: 3, model: "b2b saas fintech" }, "paystream.io": { pages: 0, model: null } };
  const r = await execute({ mission, selections: fundingSelection, rows, site });
  assert(r.qualified.length < 5, "the request is not met");
  assert(r.calls.some((c) => c.actor === "firecrawl"), "slice 1 verified");
  const again = await execute({ mission, selections: fundingSelection, rows, site, prior: r });
  assertEquals(again.phase.stopped, null, "below the request, the phase still looks");
  assertEquals(again.calls.map((c) => c.actor), [], "but every answered claim is marked: nothing is bought twice");
});
