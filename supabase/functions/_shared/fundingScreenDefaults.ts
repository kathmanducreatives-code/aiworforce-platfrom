// LEAD V2 — THE DEFAULT RUN BUDGET THAT TURNS THE FUNDING SCREEN ON.
//
// The architecture audit of 2026-09-25 found the funding screen reachable only
// from direct API callers: nothing in the product — the frontend, Pilot's
// Start Workflow, the worker API — sends `run_budget`, and without one the
// screen plans `no_run_budget` and stays off. Canaries 5–10 proved a path real
// users never took.
//
// ── WHO GETS A DEFAULT (decided 2026-09-25) ─────────────────────────────────
//
// SCREEN-ELIGIBLE MISSIONS ONLY. A run budget also lowers the mission's whole
// provider ceiling and its discovery rows, so it is applied only where the
// screen will actually run; every other mission executes exactly as before:
//
//   Lead V2 (the executability gate enforced)
//   entering through general company discovery
//   with a HARD recency funding claim that has a window
//   asking for 1–2 leads — past that, the admitted count reaches the screen's
//     5-row pool and no screen can be priced
//   and the screen plan fits the budget, priced with the SAME downstream
//     estimate run-agent uses (`screenDownstreamVerifiersUsd`) — an unpriced
//     Firecrawl rate means no screen, and so no default
//
// THE BUDGET: $0.14 and 2 candidates per requested lead — the canary-proven
// setting, scaled. 1 lead = $0.14 / 2, 2 leads = $0.28 / 4.
//
// A caller's own `run_budget` always wins; this is only the absent case.

import type { MissionCriterion } from "./missionCriteria.ts";
import type { LeadMissionV1 } from "./leadMission.ts";
import type { RunBudget } from "./runBudget.ts";
import { fundingScreenPlan, hardRecencyFundingCriterion, type FundingScreenPlan } from "./fundingPoolScreen.ts";
import { hiringEstimatePerTargetUsd } from "./hiringClaimVerifier.ts";
import { businessModelEstimatePerTargetUsd } from "./businessModelVerifier.ts";
import { webEvidenceCreditRate } from "./webEvidenceSpec.ts";
import { buildQualificationContext } from "./missionQualificationContext.ts";
import { hiringSearchTitles } from "./hiringSearchVocabulary.ts";

export const DEFAULT_SCREEN_USD_PER_LEAD = 0.14;
export const DEFAULT_SCREEN_CANDIDATES_PER_LEAD = 2;
/** The largest request the screen can serve: 3 leads admit 6, past its 5-row pool. */
export const DEFAULT_SCREEN_MAX_LEADS = 2;

/**
 * What the claim verifiers after the screen cost per admitted company (job
 * search + first-party pages), as the screen is priced. ONE computation, read
 * by orchestrate (the default) and run-agent (the plan), so both price the
 * screen identically. Null when a part is unpriced (Firecrawl under a USD cap
 * with no configured rate).
 */
export function screenDownstreamVerifiersUsd(
  mission: LeadMissionV1, criteria: readonly MissionCriterion[], readEnv: (k: string) => string | undefined,
): number | null {
  const hiring = criteria.find((c) => c.kind === "hard" && c.dimension === "hiring");
  const jobs = hiring
    ? hiringEstimatePerTargetUsd({
      titles: hiringSearchTitles(buildQualificationContext(mission, { criteriaAuthority: true }).role_vocabulary),
      window_days: hiring.time_window?.days ?? null,
    })
    : 0;
  // First-party pages, always priced in: conservative when no claim needs them.
  const pages = businessModelEstimatePerTargetUsd(webEvidenceCreditRate(readEnv, { usd_capped: true }).usd_per_credit);
  return jobs == null || pages == null ? null : Number((jobs + pages).toFixed(6));
}

export interface DefaultScreenBudget {
  budget: RunBudget | null;
  /** Why this mission does or does not get the default — for the audit log. */
  reason:
    | "default_screen_budget"
    | "not_lead_v2"
    | "not_general_discovery"
    | "no_hard_windowed_funding_claim"
    | "lead_count_outside_screen"
    | "unpriced"
    | "screen_does_not_fit";
  /** The screen plan the default was admitted under. */
  plan: FundingScreenPlan | null;
}

export function defaultScreenRunBudget(i: {
  leadV2: boolean;
  entryCapability: string | null | undefined;
  criteria: readonly MissionCriterion[];
  requestedCount: number;
  downstream_verifiers_usd: number | null;
}): DefaultScreenBudget {
  const no = (reason: DefaultScreenBudget["reason"]): DefaultScreenBudget => ({ budget: null, reason, plan: null });
  if (!i.leadV2) return no("not_lead_v2");
  if (i.entryCapability !== "general_company_discovery") return no("not_general_discovery");
  if (!hardRecencyFundingCriterion(i.criteria)) return no("no_hard_windowed_funding_claim");
  const leads = Math.floor(i.requestedCount);
  if (!(leads >= 1 && leads <= DEFAULT_SCREEN_MAX_LEADS)) return no("lead_count_outside_screen");
  if (i.downstream_verifiers_usd == null) return no("unpriced");
  const budget: RunBudget = {
    provider_usd: Number((DEFAULT_SCREEN_USD_PER_LEAD * leads).toFixed(4)),
    max_candidates: DEFAULT_SCREEN_CANDIDATES_PER_LEAD * leads,
  };
  const screen = fundingScreenPlan({
    criteria: i.criteria, runBudget: budget, requestedCount: leads, downstream_verifiers_usd: i.downstream_verifiers_usd,
  });
  if (!screen.plan) return no("screen_does_not_fit");
  return { budget, reason: "default_screen_budget", plan: screen.plan };
}

/** The kickoff's budget: the caller's own when it sent one, else the screen default, else none. */
export function kickoffRunBudget(caller: RunBudget | null, fallback: DefaultScreenBudget | null): {
  budget: RunBudget | null; source: "caller" | "default_screen" | "none";
} {
  if (caller) return { budget: caller, source: "caller" };
  if (fallback?.budget) return { budget: fallback.budget, source: "default_screen" };
  return { budget: null, source: "none" };
}
