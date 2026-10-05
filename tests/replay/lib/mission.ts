// LEAD V2 REPLAY LAB — A WHOLE MISSION, SLICE BY SLICE, OFFLINE.
//
// One slice, in run-agent's order, every step a production function:
//
//   1. engine          `runCapabilityPlan` (P2 spec spine, ledger, resume,
//                      replenishment debt carried from the previous decision)
//   2. verification    `runClaimVerificationPhase` — funding pair, business
//                      model, open-role — bought through `ledgerBoundCall`,
//                      priced through `ledgerAffordability`, same spec + ledger
//   3. checkpoint      `toResumeRecord` over the companies the verifiers wrote
//   4. canonical view  `buildWorkbenchMissionView` → `decisionSummary`
//   5. continuation    `foldSlice` + `decideAutoContinuation` + `settleV2Outcome`,
//                      inputs assembled exactly as run-agent assembles them
//   6. queue           the REAL queue SQL (PGlite) via the production worker
//                      core and `releaseQueuedMission`
//
// Replaced: the provider network (FixtureProvider) and the model calls
// (recorded planner / selector / evaluator outputs). Not run: run-agent's
// funding pool screen, the model triage and reasoner, receipt settlement,
// and every Supabase write — see tests/replay/README.md "Gaps".

import { businessModelVerifier } from "../../../supabase/functions/_shared/businessModelVerifier.ts";
import { missionBudgetState, spendTotals, type SpendLedger } from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { buildClaimPlan } from "../../../supabase/functions/_shared/claimPlan.ts";
import {
  attemptedRoutes, ledgerBoundCall, type LedgerCallDeps, type PendingVerifierRun,
} from "../../../supabase/functions/_shared/claimVerifier.ts";
import { runClaimVerificationPhase, type VerificationPhaseReport } from "../../../supabase/functions/_shared/claimVerificationPhase.ts";
import { criteriaExecutionPolicy } from "../../../supabase/functions/_shared/criteriaExecutionPolicy.ts";
import { fundingStageVerifier } from "../../../supabase/functions/_shared/fundingStageVerifier.ts";
import { hashInput } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import {
  claimProgressCount, decideAutoContinuation, foldSlice, type LineageProgress, readLineageProgress,
  resolveMaxContinuations, resolveMaxLineageCostUnits, settleV2Outcome,
} from "../../../supabase/functions/_shared/leadAutoContinuation.ts";
import {
  applyVerifierFinding, canonicalQualifiedKeys, type EngineCompany, markRouteUnaffordable, runCapabilityPlan,
  toResumeRecord,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { wasInvestigated } from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";
import { missionHiringVerifier, phaseGate, unfinishedFrontierCount, verifiableCandidatesFrom } from "./prod.ts";
import {
  companyIsTheDeliverable, effectiveRequestedCount, type LeadMissionV1, missionHash,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { guardedInvoker } from "../../../supabase/functions/_shared/leadMissionRuntime.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import type { MissionSpendCap } from "../../../supabase/functions/_shared/missionSpendCap.ts";
import type { ReadinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { verifierSpecCompiler } from "../../../supabase/functions/_shared/verifierCallSpec.ts";
import { decisionSummary, type WorkbenchMissionView } from "../../../supabase/functions/_shared/workbenchMissionView.ts";
import { stubMissionEvaluator } from "../../edge-functions/_shared/missionEvaluatorFixture.ts";
import type { FixtureProviderResponse } from "./fixture.ts";
import { FixtureProvider, noNetwork } from "./provider.ts";
import { QueueLab, type QueueRow } from "./queue.ts";
import { canonicalView } from "./verification.ts";

export interface GoldenMission {
  name: string;
  mission: LeadMissionV1;
  readiness: ReadinessPolicy;
  /** An operator cap (LEAD_V2_MISSION_*), as the engine receives it. */
  missionCap?: MissionSpendCap | null;
  model: { plan_execution: { reasoning: string; steps: unknown[] }; plan_discovery: unknown[]; evaluate_mission?: "pass" | "fail" };
  responses: FixtureProviderResponse[];
  maxSlices: number;
  maxCandidates?: number;
}

export interface GoldenSlice {
  slice: number;
  decision: string;
  continue: boolean;
  terminal: string | null;
  qualified: number;
  pendingRuns: number;
  verificationRoutes: number;
  frontier: number;
  barren: number;
  providerCalls: string[];
  verification: VerificationPhaseReport;
  queue: { status: string; attempts: number; continuations?: number };
}

export interface GoldenRun {
  slices: GoldenSlice[];
  provider: FixtureProvider;
  ledger: SpendLedger;
  view: WorkbenchMissionView;
  companies: EngineCompany[];
  queue: QueueRow;
  releases: Array<{ finalStatus: string; reason: string | null; fallback: boolean }>;
  terminal: string | null;
  qualifiedKeys: string[];
}

export async function runGoldenMission(g: GoldenMission): Promise<GoldenRun> {
  noNetwork();
  const provider = new FixtureProvider(g.responses);
  const mission = g.mission;
  const readiness = g.readiness;
  const missionId = `golden-${g.name}`;
  const plan = buildCapabilityGraph(mission, { executability: "enforce", readiness });
  const criteria = deriveMissionCriteria(mission, readiness);
  const requested = effectiveRequestedCount(mission);

  let state: Record<string, unknown> | null = null;
  let records: unknown[] | null = null;
  let progress: LineageProgress = readLineageProgress({});
  let lastDecision: string | null = null;
  let companies: EngineCompany[] = [];
  let view: WorkbenchMissionView | null = null;
  let terminal: string | null = null;
  const slices: GoldenSlice[] = [];

  const lab = await QueueLab.open();
  const queueId = await lab.enqueue({ plan_id: missionId });
  const w = lab.worker(async (m) => {
    const callsBefore = provider.calls.length;
    // ── 1. engine: the replenishment debt is read from what the last slice recorded ──
    const dss = state?.discovery_source_state as { exhausted?: boolean; pages_taken?: Record<string, number>; sources_attempted?: string[] } | undefined;
    const replenish = lastDecision === "replenishment_required" && dss && !dss.exhausted
      ? { reason: "replenishment_required", pages_taken: dss.pages_taken ?? {}, sources_attempted: dss.sources_attempted ?? [] }
      : null;
    const run = await runCapabilityPlan({
      invoke: provider.invoke,
      verifyEmployer: () => ({ verified: true, outcome: "ok" }),
      evaluateMission: stubMissionEvaluator({ mission_fit: g.model.evaluate_mission ?? "pass" }),
      planExecution: () => Promise.resolve(structuredClone(g.model.plan_execution)),
      planDiscovery: () => Promise.resolve(structuredClone(g.model.plan_discovery)),
    } as never, {
      mission, plan, maxCandidates: g.maxCandidates ?? 10, remainingLeads: requested, readEnv: () => undefined,
      identity: { workspace_id: "<workspace>", task_id: missionId },
      specMode: "enforce", specScope: { workspace_id: "<workspace>", lineage_id: missionId }, readiness,
      ...(g.missionCap ? { missionCap: g.missionCap } : {}),
      ...(replenish ? { discoveryReplenishment: replenish } : {}),
      ...(state && records ? { state, resume: { workspace_id: "<workspace>", lineage_root_task_id: missionId, records } } : {}),
    } as never) as unknown as { companies: EngineCompany[]; state: Record<string, unknown> & { spend_ledger: SpendLedger; verifier_pending_runs?: PendingVerifierRun[]; pending_runs?: unknown[] } };
    companies = run.companies;
    const vState = run.state;

    // ── 2. verification: run-agent's `verifierDepsFor`, the provider swapped ──
    const deps: LedgerCallDeps = {
      ledger: vState.spend_ledger,
      spec: verifierSpecCompiler({
        scope: { workspace_id: "<workspace>", lineage_id: missionId }, mission_hash: await missionHash(mission),
        policy: criteriaExecutionPolicy(mission), ceilings: () => vState.spend_ledger.ceilings, readiness, plan: null,
      }),
      actorIdFor: (k) => hiringActorCard(k)?.actor_id ?? null,
      invoke: guardedInvoker(null, (call) => provider.invoke(call), undefined, readiness),
      hash: (input, k) => hashInput(input, k),
    };
    const byKey = (k: string) => companies.find((c) => c.key === k);
    const hiring = missionHiringVerifier(mission, criteria);
    const business = businessModelVerifier({
      collect: () => { throw new Error("golden missions carry no business-model claim"); },
      reground: () => { throw new Error("golden missions carry no business-model claim"); },
    });
    const phase = await runClaimVerificationPhase({
      mission_id: missionId, claim_plan: buildClaimPlan(criteria, plan.entry_capability ?? null, readiness),
      requested_count: requested,
      candidates: () => verifiableCandidatesFrom({ companies }, criteria, missionId),
      qualified: () => canonicalQualifiedKeys(companies, { mission, plan: { entry_capability: plan.entry_capability }, identity: { task_id: missionId } }).length,
      criteriaValue: (id) => criteria.find((c) => c.id === id)?.value ?? null,
      criteriaWindow: (id) => criteria.find((c) => c.id === id)?.time_window?.days ?? null,
      verifiers: [fundingStageVerifier(), business, ...(hiring ? [hiring] : [])],
      readiness, pending: vState.verifier_pending_runs ?? [],
      deps: { call: ledgerBoundCall(deps), now: () => new Date().toISOString(), log: () => {} },
      apply: (f, v) => { const c = byKey(f.company_key); return c ? applyVerifierFinding(c, f, v) : false; },
      ...phaseGate(deps),
      markUnaffordable: (k, v) => { const c = byKey(k); if (c) markRouteUnaffordable(c, v); },
    });
    vState.verifier_pending_runs = phase.pending;

    // ── 3. checkpoint ──
    state = vState;
    records = companies.map(toResumeRecord);

    // ── 4. canonical view ──
    view = canonicalView({ companies }, mission, missionId, plan.entry_capability ?? "general_company_discovery");
    const p5 = decisionSummary(view.counts);

    // ── 5. continuation, assembled as run-agent assembles it ──
    progress = foldSlice(progress, {
      qualifiedInPool: p5.qualified,
      uniqueCompaniesInvestigatedInPool: companies.filter((c) => wasInvestigated(c.investigation_state)).length,
      authorisationsInPool: Number(vState.investigation_selected ?? 0),
      costUnitsInLineage: Number(vState.accumulated_cost_units ?? 0),
      brainDecidedInPool: p5.qualified + p5.pending + p5.ineligible,
      claimProgressInPool: claimProgressCount({
        leads: view.leads, attemptedRoutesPerCompany: companies.map((c) => attemptedRoutes(c.completed_operations).length),
      }),
    });
    const frontier = unfinishedFrontierCount(companies);
    const pendingRuns = (vState.pending_runs?.length ?? 0) + (vState.verifier_pending_runs?.length ?? 0);
    const d = decideAutoContinuation({
      qualified: p5.qualified, verificationRoutesRemain: view.evidence_gaps.with_executable_route,
      requestedCount: requested, frontierRemaining: frontier,
      continuationsUsed: progress.continuations_used, maxContinuations: resolveMaxContinuations(),
      costUnitsUsed: progress.cost_units_used, maxCostUnits: resolveMaxLineageCostUnits(),
      barrenSlices: progress.barren_slices, providerFailed: false,
      missionBudgetExhausted: (() => {
        if (!g.missionCap) return null;
        const b = missionBudgetState(vState.spend_ledger);
        return b.exhausted ? b.detail : null;
      })(),
      pendingRuns,
      discoveryRoutesRemain: (() => {
        const ds = vState.discovery_source_state as { exhausted?: boolean } | undefined;
        return ds ? !ds.exhausted : false;
      })(),
    });
    lastDecision = String(d.reason);
    const outcome = settleV2Outcome({
      continuing: d.continue, stopReason: String(d.reason), legacyStatus: "partial",
      legacyQuota: { eligible_leads: p5.qualified, requested_leads: requested },
      canonicalQualified: p5.qualified, requestedCount: requested, companyIsDeliverable: companyIsTheDeliverable(mission),
    });
    terminal = d.continue ? null : outcome.terminal;
    slices.push({
      slice: slices.length + 1, decision: lastDecision, continue: d.continue, terminal,
      qualified: p5.qualified, pendingRuns, verificationRoutes: view.evidence_gaps.with_executable_route,
      frontier, barren: progress.barren_slices,
      providerCalls: provider.calls.slice(callsBefore).map((c) => c.actor), verification: phase,
      queue: { status: "", attempts: -1 },
    });
    return d.continue
      ? { status: "continuation_required", terminal: false, taskId: m.taskId ?? missionId, lineageSlices: progress.continuations_used }
      : { status: outcome.terminal, terminal: true, taskId: m.taskId ?? missionId, lineageSlices: progress.continuations_used };
  });

  for (let i = 0; i < g.maxSlices; i++) {
    const t = await w.tick();
    if (!t.claimed) break;
    const row = await lab.row(queueId);
    slices[slices.length - 1].queue = { status: row.status, attempts: row.attempts, continuations: row.continuations };
    if (slices.at(-1)!.terminal) break;
    await lab.backoffElapses();
  }
  const queue = await lab.row(queueId);
  await lab.close();
  const s = state as unknown as { spend_ledger: SpendLedger } | null;
  return {
    slices, provider, ledger: s!.spend_ledger, view: view!, companies, queue, releases: w.releases, terminal,
    qualifiedKeys: canonicalQualifiedKeys(companies, { mission, plan: { entry_capability: plan.entry_capability }, identity: { task_id: missionId } }),
  };
}

/** Total committed provider spend, and the paid reservations' keys (for the duplicate check). */
export function spendOf(l: SpendLedger) {
  const paid = l.reservations.filter((r) => r.status === "executed" || r.status === "settled");
  return { committed_usd: spendTotals(l).mission_committed_usd, paid_keys: paid.map((r) => r.idempotency_key), paid };
}
