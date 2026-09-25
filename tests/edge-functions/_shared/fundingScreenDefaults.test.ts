// THE PRODUCT SENDS A RUN BUDGET, SO THE FUNDING SCREEN RUNS BY DEFAULT.
//
// The 2026-09-25 architecture audit: nothing in the product sent `run_budget`,
// so the screen canaries 5–10 proved planned `no_run_budget` for every real
// submission. Orchestrate now gives a SCREEN-ELIGIBLE Lead V2 mission the
// default ($0.14 and 2 candidates per lead, 1–2 leads), and nothing else.
//
// Pure. No network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_SCREEN_MAX_LEADS, defaultScreenRunBudget, kickoffRunBudget, screenDownstreamVerifiersUsd,
} from "../../../supabase/functions/_shared/fundingScreenDefaults.ts";
import { fundingScreenPlan } from "../../../supabase/functions/_shared/fundingPoolScreen.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseRunBudget } from "../../../supabase/functions/_shared/runBudget.ts";

// The Pilot-compiled mission every canary ran: US, 11–50, B2B SaaS, funded in 365 days, hiring growth.
const FX = JSON.parse(Deno.readTextFileSync(new URL("../../fixtures/lead-v2/canary-5bfa76db/result.json", import.meta.url)));
const MISSION = FX.lead_mission;
const CRITERIA = deriveMissionCriteria(MISSION, PRODUCTION_READINESS);
/** The configured account rate, as the canaries ran (never printed; a fixture value here). */
const ENV = (k: string) => k === "FIRECRAWL_USD_PER_CREDIT" ? "0.005" : undefined;
const ENTRY = buildCapabilityGraph(MISSION as never, { executability: "enforce", readiness: PRODUCTION_READINESS } as never).entry_capability;

const decide = (over: Partial<Parameters<typeof defaultScreenRunBudget>[0]> = {}) => defaultScreenRunBudget({
  leadV2: true, entryCapability: ENTRY, criteria: CRITERIA, requestedCount: 1,
  downstream_verifiers_usd: screenDownstreamVerifiersUsd(MISSION, CRITERIA, ENV), ...over,
});

Deno.test("THE CANARY MISSION, AS A USER SUBMITS IT: 1 lead gets $0.14 / 2 candidates, and the screen plan the canaries proved", () => {
  assertEquals(ENTRY, "general_company_discovery");
  const d = decide();
  assertEquals(d.reason, "default_screen_budget");
  assertEquals(d.budget, { provider_usd: 0.14, max_candidates: 2 });
  assertEquals([d.plan!.first_rows, d.plan!.topup_rows, d.plan!.screen_max, d.plan!.admit, d.plan!.worst_case_usd], [4, 2, 4, 2, 0.1385]);
});

Deno.test("2 LEADS: $0.28 / 4 candidates, and a screen that fits it (4 admitted, one Atomus read of 5)", () => {
  const d = decide({ requestedCount: 2 });
  assertEquals(d.budget, { provider_usd: 0.28, max_candidates: 4 });
  assertEquals([d.plan!.admit, d.plan!.screen_max], [4, 5]);
  assert(d.plan!.worst_case_usd <= 0.28 - 0.001, String(d.plan!.worst_case_usd));
});

Deno.test("3+ LEADS: no default — 3 leads would admit 6, past the screen's 5-row pool; the mission runs as today", () => {
  for (const n of [3, 5, 10]) assertEquals([decide({ requestedCount: n }).budget, decide({ requestedCount: n }).reason], [null, "lead_count_outside_screen"]);
  assertEquals(DEFAULT_SCREEN_MAX_LEADS, 2);
});

Deno.test("SCREEN-ELIGIBLE ONLY: every other mission gets no budget and no new caps", () => {
  assertEquals(decide({ leadV2: false }).reason, "not_lead_v2");
  for (const entry of ["job_discovery", "known_company_resolution", "startup_company_discovery", null]) {
    assertEquals(decide({ entryCapability: entry }).reason, "not_general_discovery", String(entry));
  }
  const soft = CRITERIA.map((c) => c.dimension === "funding" ? { ...c, kind: "target" as const } : c);
  assertEquals(decide({ criteria: soft }).reason, "no_hard_windowed_funding_claim");
  const noFunding = CRITERIA.filter((c) => c.dimension !== "funding");
  assertEquals(decide({ criteria: noFunding }).reason, "no_hard_windowed_funding_claim");
  for (const d of [decide({ leadV2: false }), decide({ criteria: soft })]) assertEquals(d.budget, null);
});

Deno.test("UNPRICED: with no configured Firecrawl rate the screen cannot be priced, so no default (never a guessed budget)", () => {
  const down = screenDownstreamVerifiersUsd(MISSION, CRITERIA, () => undefined);
  assertEquals(down, null);
  assertEquals(decide({ downstream_verifiers_usd: down }).reason, "unpriced");
});

Deno.test("THE CALLER WINS: an explicit run_budget is used as sent; the default fills only the absent case", () => {
  const def = decide();
  assertEquals(kickoffRunBudget({ provider_usd: 0.5, max_candidates: 3 }, def), { budget: { provider_usd: 0.5, max_candidates: 3 }, source: "caller" });
  assertEquals(kickoffRunBudget(null, def), { budget: { provider_usd: 0.14, max_candidates: 2 }, source: "default_screen" });
  assertEquals(kickoffRunBudget(null, decide({ leadV2: false })), { budget: null, source: "none" });
  assertEquals(kickoffRunBudget(null, null), { budget: null, source: "none" });
});

Deno.test("ONE PRICING AUTHORITY: what orchestrate decided is exactly what run-agent will plan with the budget it receives", () => {
  const d = decide();
  // run-agent re-parses the kickoff's budget and prices the screen with the same downstream estimate.
  const received = parseRunBudget(JSON.parse(JSON.stringify(d.budget)));
  const runAgentPlan = fundingScreenPlan({ criteria: CRITERIA, runBudget: received, requestedCount: 1,
    downstream_verifiers_usd: screenDownstreamVerifiersUsd(MISSION, CRITERIA, ENV) });
  assertEquals(runAgentPlan.reason, "screening");
  assertEquals(runAgentPlan.plan, d.plan);
});

Deno.test("WIRED: orchestrate puts the decided budget on the ONE kickoff body the queue and the edge both run", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/orchestrate/index.ts", import.meta.url));
  assert(src.includes("const kickoffBudget = kickoffRunBudget(callerRunBudget, screenDefault);"));
  assert(src.includes("...(kickoffBudget.budget ? { run_budget: kickoffBudget.budget } : {}),"));
  assert(src.includes("buildCapabilityGraph(missionForRouting, { executability, readiness }).entry_capability"),
    "eligibility is decided on the same graph run-agent executes");
  assertEquals(src.match(/run_budget: parseRunBudget\(/g), null, "no second path forwards the raw body budget");
  const runAgent = Deno.readTextFileSync(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(runAgent.includes("downstream_verifiers_usd: screenDownstreamVerifiersUsd(persistedMission, criteria, readEnvSafe),"),
    "run-agent prices the screen with the same function");
});

Deno.test("PRICED, NOT ASSUMED: eligible but too dear for the per-lead budget → no default (a budget the screen cannot use is never sent)", () => {
  // Downstream checks costing $0.10 per admitted company: 2 × $0.10 alone exceeds $0.14.
  const d = decide({ downstream_verifiers_usd: 0.10 });
  assertEquals([d.budget, d.reason], [null, "screen_does_not_fit"]);
});
