// THE FUNDING SCREEN: A WIDER POOL, ONE ATOMUS READ, THEN ADMISSION.
//
// Four live canaries (1156c062, 5bfa76db, 4a0611b0, 021d4987) bought exactly
// `max_candidates` search rows and paid details + Atomus (+ Pvalyou) for the two
// companies at the head of LinkedIn's most-followed list — media brands, mostly.
// 0 of 21 funding checks passed. Under the screen, discovery buys a wider
// short-mode pool, the funding verifier (fallback off) reads the whole pool with
// ONE Atomus call, and only `max_candidates` companies — passes first, never a
// FAIL — go on to identity, details and the claim verifiers.
//
// The engine runs for real; the provider is scripted. No network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  fundingScreenPlan, recentlyCheckedPages, screenAdmissionOrder, SCREEN_MAX_POOL_ROWS,
  type FundingScreenPlan,
} from "../../../supabase/functions/_shared/fundingPoolScreen.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { parseRunBudget } from "../../../supabase/functions/_shared/runBudget.ts";
import { hiringEstimatePerTargetUsd } from "../../../supabase/functions/_shared/hiringClaimVerifier.ts";
import { businessModelEstimatePerTargetUsd } from "../../../supabase/functions/_shared/businessModelVerifier.ts";
import { fundingStageVerifier } from "../../../supabase/functions/_shared/fundingStageVerifier.ts";
import {
  missionCandidatesFrom, runCapabilityPlan, type EngineCompany,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { CLAIM_REGISTRY, evidenceGapsFor } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { attemptedRoutes, type VerificationTarget, type VerifierCallOutcome } from "../../../supabase/functions/_shared/claimVerifier.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubMissionEvaluator } from "./missionEvaluatorFixture.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

const FX = JSON.parse(Deno.readTextFileSync(new URL("../../fixtures/lead-v2/canary-5bfa76db/result.json", import.meta.url)));
const MISSION = FX.lead_mission;
const CRITERIA = deriveMissionCriteria(MISSION, PRODUCTION_READINESS);
const DOWNSTREAM = hiringEstimatePerTargetUsd({ titles: ["growth"], window_days: 30 })! + businessModelEstimatePerTargetUsd(0.005)!;
const ATOMUS = "apify_funding_atomus", PVALYOU = "apify_funding_pvalyou";
type Row = Record<string, unknown>;

// ═══════════════════════════════════════════════════════════════ the plan ══

Deno.test("PRICED FIRST: at $0.14 / 2 candidates the widest pool that fits is 5 rows, worst case $0.139", () => {
  const r = fundingScreenPlan({ criteria: CRITERIA, runBudget: parseRunBudget({ provider_usd: 0.14, max_candidates: 2 }),
    requestedCount: 1, downstream_verifiers_usd: DOWNSTREAM });
  assertEquals(r.reason, "screening");
  assertEquals([r.plan!.pool_rows, r.plan!.admit, r.plan!.scraper_mode], [5, 2, "short"]);
  assertEquals(r.plan!.worst_case_usd, 0.139);
  assert(r.plan!.worst_case_usd <= 0.14 && r.plan!.worst_case_usd <= 0.15);
  assertEquals(r.plan!.window_days, 365);
  // Every pool size tried is recorded, so "why five?" is answerable.
  assertEquals(r.priced.map((p) => [p.pool_rows, p.worst_case_usd]), [[3, 0.128], [4, 0.1335], [5, 0.139]]);
});

Deno.test("NEVER WEAKENS THE BUDGET: at $0.10 no wider pool fits, so the screen is OFF and discovery is unchanged", () => {
  const r = fundingScreenPlan({ criteria: CRITERIA, runBudget: parseRunBudget({ provider_usd: 0.10, max_candidates: 2 }),
    requestedCount: 1, downstream_verifiers_usd: DOWNSTREAM });
  assertEquals([r.plan, r.reason], [null, "pool_does_not_fit_provider_usd"]);
});

Deno.test("OFF unless every condition holds: hard windowed funding claim, a run budget, every part priced", () => {
  const budget = parseRunBudget({ provider_usd: 0.14, max_candidates: 2 });
  const soft = CRITERIA.map((c) => c.dimension === "funding" ? { ...c, kind: "target" as const } : c);
  assertEquals(fundingScreenPlan({ criteria: soft, runBudget: budget, requestedCount: 1, downstream_verifiers_usd: DOWNSTREAM }).reason,
    "no_hard_windowed_funding_claim");
  const noWindow = CRITERIA.map((c) => c.dimension === "funding" ? { ...c, time_window: undefined } : c);
  assertEquals(fundingScreenPlan({ criteria: noWindow, runBudget: budget, requestedCount: 1, downstream_verifiers_usd: DOWNSTREAM }).reason,
    "no_hard_windowed_funding_claim");
  assertEquals(fundingScreenPlan({ criteria: CRITERIA, runBudget: null, requestedCount: 1, downstream_verifiers_usd: DOWNSTREAM }).reason,
    "no_run_budget");
  assertEquals(fundingScreenPlan({ criteria: CRITERIA, runBudget: parseRunBudget({ provider_usd: 0.14 }), requestedCount: 1,
    downstream_verifiers_usd: DOWNSTREAM }).reason, "no_run_budget");
  assertEquals(fundingScreenPlan({ criteria: CRITERIA, runBudget: budget, requestedCount: 1, downstream_verifiers_usd: null }).reason,
    "unpriced", "Firecrawl unpriced under a USD cap → no screen");
});

Deno.test("ADMISSION ORDER: passes first, then pending, each in the free ranking's order; a FAIL is never admitted", () => {
  const order = screenAdmissionOrder([
    { key: "a", rank: 0, verdict: "pending" as const }, { key: "b", rank: 1, verdict: "fail" as const },
    { key: "c", rank: 2, verdict: "pass" as const }, { key: "d", rank: 3, verdict: "pending" as const },
    { key: "e", rank: 4, verdict: "pass" as const },
  ]).map((x) => x.key);
  assertEquals(order, ["c", "e", "a", "d"]);
});

Deno.test("RECENTLY CHECKED: earlier tasks' Atomus keys, canonicalised; this task's own are not counted", () => {
  const pages = recentlyCheckedPages([
    { task_id: "old", candidate_keys: ["https://www.linkedin.com/company/BigRio/", "https://www.linkedin.com/company/design-milk?x=1"] },
    { task_id: "now", candidate_keys: ["https://www.linkedin.com/company/mine"] },
    { task_id: "old2", candidate_keys: "not-a-list" },
  ], "now");
  assertEquals([...pages].sort(), ["https://www.linkedin.com/company/bigrio", "https://www.linkedin.com/company/design-milk"]);
});

// ═══════════════════════════════════════════════════ the engine, end to end ══

const NOW = new Date();
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 10);
const page = (slug: string) => `https://www.linkedin.com/company/${slug}`;
/** A SHORT-mode company-search row: no declared band, no member count. */
const searchRow = (slug: string) => ({
  name: slug, linkedinUrl: page(slug), website: `https://${slug}.com`, industry: "Software Development",
  description: `${slug} builds B2B SaaS.`, locations: [{ country: "US", city: "Austin" }],
});
const atomusEmpty = (slug: string): Row => ({ input: page(slug), status: "success",
  summary: { name: slug, linkedin_url: page(slug), domain: `${slug}.com` }, company: { financial: {} } });
const atomusRounds = (slug: string, dates: string[], complete: boolean): Row => ({ input: page(slug), status: "success",
  summary: { name: slug, linkedin_url: page(slug), domain: `${slug}.com` },
  company: { financial: { funding: { type: "SEED", num_funding_rounds: complete ? dates.length : dates.length + 3,
    rounds: dates.map((d) => ({ announced_at: d, raised_amount: 1_000_000, type: "SEED_ROUND" })), date: dates[0] } } } });

/** Five companies, in LinkedIn's order: two recently funded, one long-ago-and-complete, two unknown. */
const POOL = ["alpha", "bravo", "charlie", "delta", "echo"];
const ATOMUS_SAYS: Record<string, (s: string) => Row> = {
  alpha: atomusEmpty,
  bravo: (s) => atomusRounds(s, [daysAgo(800)], true),       // complete history, nothing recent → FAIL
  charlie: (s) => atomusRounds(s, [daysAgo(90)], false),     // a dated round inside 365 days → PASS
  delta: atomusEmpty,
  echo: (s) => atomusRounds(s, [daysAgo(200)], false),       // PASS
};

const PLAN: FundingScreenPlan = fundingScreenPlan({ criteria: CRITERIA, runBudget: parseRunBudget({ provider_usd: 0.14, max_candidates: 2 }),
  requestedCount: 1, downstream_verifiers_usd: DOWNSTREAM }).plan!;

const GRAPH = buildCapabilityGraph(MISSION as never, { executability: "enforce", readiness: PRODUCTION_READINESS } as never);

Deno.test("THE CANARY'S GRAPH: Lead V2 enters through general company discovery (the screen's precondition)", () => {
  assertEquals((GRAPH as unknown as { entry_capability: string }).entry_capability, "general_company_discovery");
});

async function run(o: { screen?: boolean; recentlyChecked?: string[]; atomus?: Record<string, (s: string) => Row> } = {}) {
  const calls: Array<{ actorKey: string; input: Record<string, unknown> }> = [];
  const screened: string[][] = [];
  const pvalyouBought: string[][] = [];
  const says = o.atomus ?? ATOMUS_SAYS;
  const result = await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      const input = (call as unknown as { input: Record<string, unknown> }).input ?? {};
      calls.push({ actorKey: call.actorKey, input });
      if (call.actorKey === "apify_linkedin_company_search") {
        return Promise.resolve(POOL.slice(0, Number(input.maxItems ?? POOL.length)).map(searchRow) as Row[]);
      }
      if (call.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve(((input.companies as string[]) ?? []).map((u) => ({
          linkedinUrl: u, name: u.split("/company/")[1], website: `https://${u.split("/company/")[1]}.com`,
          employeeCountRange: { start: 11, end: 50 }, employeeCount: 30,
          locations: [{ country: "US", city: "Austin", headquarter: true }],
          industries: [{ id: 4, name: "Software Development" }],
          description: "A B2B SaaS platform sold on subscription.",
        })) as Row[]);
      }
      return Promise.resolve([] as Row[]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    evaluateMission: stubMissionEvaluator({ mission_fit: "pass" }),
    planDiscovery: () => Promise.resolve([{
      actor_key: "apify_linkedin_company_search", role: "primary",
      input: { locations: ["United States"], industryIds: ["4"], companySize: ["11-50"] },
    }]),
  } as never, {
    // AS run-agent BUILDS IT for Lead V2: the executability gate enforced.
    mission: MISSION, plan: GRAPH,
    maxCandidates: o.screen === false ? 2 : PLAN.pool_rows, remainingLeads: 1, readEnv: () => undefined,
    identity: { workspace_id: "ws-test", task_id: "task-screen" },
    ...(o.screen === false ? {} : {
      fundingScreen: {
        plan: PLAN,
        recentlyChecked: new Set(o.recentlyChecked ?? []),
        screen: async (targets: VerificationTarget[], _state: unknown) => {
          screened.push(targets.map((t) => t.company_key));
          const r = await fundingStageVerifier({ fallback: false }).verify(targets, {
            now: () => NOW.toISOString(), log: () => {}, ready: () => true,
            call: (c) => {
              if (c.actor_key === PVALYOU) pvalyouBought.push(c.candidate_keys);
              if (c.actor_key !== ATOMUS) return Promise.resolve({ status: "refused", reason: "not in this test" } as VerifierCallOutcome);
              const rows = (c.input.companies as string[]).map((u) => {
                const slug = u.split("/company/")[1];
                return (says[slug] ?? atomusEmpty)(slug);
              });
              return Promise.resolve({ status: "ok", rows, provider_call_id: "pc_screen_atomus" } as VerifierCallOutcome);
            },
          }, { mission_id: "task-screen", pending: [] });
          return r.findings;
        },
      },
    }),
  } as never);
  const companies = (result as unknown as { companies: EngineCompany[] }).companies;
  return {
    calls, screened, pvalyouBought, companies,
    search: calls.filter((c) => c.actorKey === "apify_linkedin_company_search"),
    detailsFor: calls.filter((c) => c.actorKey === "apify_linkedin_company_details").flatMap((c) => c.input.companies as string[]),
    byKey: (slug: string) => companies.find((c) => c.key === page(slug))!,
  };
}

Deno.test("SCREEN: 5 short rows, ONE Atomus read over the pool, the two PASSES admitted — details bought for them alone", async () => {
  const r = await run();
  assertEquals(r.search.length, 1);
  assertEquals([r.search[0].input.maxItems, r.search[0].input.scraperMode], [5, "short"]);
  assertEquals(r.screened.length, 1, "one Atomus read");
  assertEquals(r.screened[0].length, 5, "over the whole pool");
  assertEquals(r.pvalyouBought, [], "the screen never asks Pvalyou");
  assertEquals([...r.detailsFor].sort(), [page("charlie"), page("echo")], "only the admitted two get details");
  assertEquals(r.byKey("bravo").investigation_state, "excluded_permanently");
  assertEquals(r.byKey("bravo").shortlist_exclusion, "funding_screen_fail");
  for (const s of ["alpha", "delta"]) assertEquals(r.byKey(s).investigation_state, "pending_investigation", `${s} waits`);
});

Deno.test("SCREEN: no pass in the pool → the top two still-open companies by rank are admitted; the FAIL never is", async () => {
  const r = await run({ atomus: { ...ATOMUS_SAYS, charlie: atomusEmpty, echo: atomusEmpty } });
  assertEquals([...r.detailsFor].sort(), [page("alpha"), page("charlie")]);
  assertFalse(r.detailsFor.includes(page("bravo")));
});

Deno.test("SCREEN: a company this workspace checked recently is not screened again and never admitted", async () => {
  const r = await run({ recentlyChecked: [page("charlie") + "/"] });
  assertFalse(r.screened[0].includes(page("charlie")), "no second Atomus read");
  assertEquals(r.byKey("charlie").shortlist_exclusion, "recently_funding_checked");
  assertEquals(r.screened[0].length, 4);
  assertEquals([...r.detailsFor].sort(), [page("alpha"), page("echo")], "echo passes; alpha is the best-ranked open one");
});

Deno.test("SCREEN → FALLBACK: an admitted company Atomus left open routes to Pvalyou next — not blocked, not re-read by Atomus", async () => {
  const r = await run({ atomus: { ...ATOMUS_SAYS, charlie: atomusEmpty, echo: atomusEmpty } });
  const cands = missionCandidatesFrom({ companies: r.companies }, { missionId: "task-screen" });
  const alpha = cands.find((c) => c.company_key === page("alpha"))!;
  const e = evaluateEligibility(CRITERIA, alpha.graph);
  const funding = evidenceGapsFor(e.checks.filter((c) => c.kind === "hard"), alpha.graph, CLAIM_REGISTRY,
    new Set(attemptedRoutes(r.byKey("alpha").completed_operations)), PRODUCTION_READINESS).find((g) => g.dimension === "funding")!;
  assertEquals([funding.next, funding.route?.actor], ["verify", PVALYOU]);
  assert(r.byKey("alpha").completed_operations.some((o) => o.endsWith(ATOMUS)), "the screen's Atomus answer is marked");
});

Deno.test("REGRESSION: without a screen, discovery is exactly what it was — full mode, the run's pool, no Atomus", async () => {
  const r = await run({ screen: false });
  assertEquals([r.search[0].input.maxItems, r.search[0].input.scraperMode], [2, "full"]);
  assertEquals(r.screened, []);
});

Deno.test("THE CAP HOLDS: the pool is at most SCREEN_MAX_POOL_ROWS, and admission never exceeds max_candidates", async () => {
  assert(PLAN.pool_rows <= SCREEN_MAX_POOL_ROWS);
  const r = await run();
  const investigated = r.companies.filter((c) => c.investigation_state === "in_flight" || c.investigation_state === "investigated");
  assertEquals(investigated.length, PLAN.admit);
});
