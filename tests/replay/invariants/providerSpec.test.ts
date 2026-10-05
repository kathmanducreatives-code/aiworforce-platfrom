// PROVIDER-SPEC INVARIANTS.
//
//   1. For an identical call, the affordability estimate IS the reservation
//      estimate — one compiled ProviderCallSpec, one budget rule.
//   2. There is no independent raw-input pricing path in the affordability check.
//   3. A batch's per-company share never exceeds the single-company estimate,
//      so a company that fits alone fits in any batch (no batch poisoning).
//   4. The replay is wired to the same production functions run-agent is.
//   5. Replay cannot reach the network, and the fixture provider is strict.

import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ledgerBoundCall, type VerificationTarget } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { affordabilityGate, BINDING, missionHiringVerifier, RUN_AGENT_PINS, verifierCall } from "../lib/prod.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { newSpendLedger, DEFAULT_CEILINGS } from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { verifierSpecCompiler } from "../../../supabase/functions/_shared/verifierCallSpec.ts";
import { criteriaExecutionPolicy } from "../../../supabase/functions/_shared/criteriaExecutionPolicy.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import { hashInput } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { guardedInvoker } from "../../../supabase/functions/_shared/leadMissionRuntime.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { loadFixture } from "../lib/fixture.ts";
import { FixtureProvider, noNetwork, UnrecordedProviderCall } from "../lib/provider.ts";
import { replayReadiness } from "../lib/verification.ts";
import { goldenMission } from "../golden/scenarios.ts";

const read = (rel: string) => Deno.readTextFileSync(new URL(`../../../${rel}`, import.meta.url));
const target = (slug: string): VerificationTarget => ({
  company_key: `https://www.linkedin.com/company/${slug}`, name: slug, domain: `${slug}.com`,
  linkedin_url: `https://www.linkedin.com/company/${slug}`, criterion: { criterion_id: "h", dimension: "hiring", value: null }, graph: {} as never,
});

/** run-agent's verifier deps for a mission, the provider answering every job search with nothing. */
function depsFor(mission: LeadMissionV1) {
  const readiness = replayReadiness();
  const ledger = newSpendLedger({ ...DEFAULT_CEILINGS, per_candidate_evidence_usd: 10, mission_provider_usd: 100 });
  const provider = new FixtureProvider([{ actor: "apify_linkedin_job_search", rows: [], provenance: "empty" }]);
  return {
    ledger, provider,
    deps: {
      ledger,
      spec: verifierSpecCompiler({
        scope: { workspace_id: "<workspace>", lineage_id: "inv" }, mission_hash: "mh", policy: criteriaExecutionPolicy(mission),
        ceilings: () => ledger.ceilings, readiness, plan: null,
      }),
      actorIdFor: (k: string) => hiringActorCard(k)?.actor_id ?? null,
      invoke: guardedInvoker(null, provider.invoke, undefined, readiness),
      hash: (input: Record<string, unknown>, k: string) => hashInput(input, k),
    },
  };
}

const MISSIONS: Array<[string, LeadMissionV1]> = [
  ["canary 8 (12 sales titles)", loadFixture("canary8.hiring-affordability").mission as unknown as LeadMissionV1],
  ["golden (same card, no industry)", goldenMission()],
];

Deno.test("[provider-spec] for an identical call, affordability_estimate === budget_reservation_estimate (and the same key)", async () => {
  noNetwork();
  for (const [label, mission] of MISSIONS) {
    const hiring = missionHiringVerifier(mission, deriveMissionCriteria(mission, replayReadiness()))!;
    for (const n of [1, 2, 3, 5]) {
      const { ledger, deps } = depsFor(mission);
      const call = verifierCall(hiring, Array.from({ length: n }, (_, i) => target(`co-${n}-${i}`)))!;
      const pf = affordabilityGate(deps)(call)!;
      const out = await ledgerBoundCall(deps)(call);
      assertEquals(out.status, "ok", `${label} n=${n}`);
      const res = ledger.reservations.find((r) => r.idempotency_key === pf.idempotency_key);
      assert(res, `${label} n=${n}: the purchase reserved under the preflight's key`);
      assertEquals(res.estimate_usd, pf.estimate_usd, `${label} n=${n}`);
    }
  }
});

Deno.test("[provider-spec] a batch's per-company share never exceeds the single-company compiled estimate", () => {
  for (const [label, mission] of MISSIONS) {
    const hiring = missionHiringVerifier(mission, deriveMissionCriteria(mission, replayReadiness()))!;
    const { deps } = depsFor(mission);
    const single = affordabilityGate(deps)(verifierCall(hiring, [target("solo")])!)!.estimate_usd;
    for (const n of [2, 3, 4, 5]) {
      const batch = affordabilityGate(deps)(verifierCall(hiring, Array.from({ length: n }, (_, i) => target(`b${i}`)))!)!.estimate_usd;
      assert(batch / n <= single + 1e-9, `${label}: batch of ${n} = ${batch} vs single ${single}`);
    }
  }
});

Deno.test(`[provider-spec] the affordability check has no raw-input pricing path (${BINDING})`, () => {
  const phase = read("supabase/functions/_shared/claimVerificationPhase.ts");
  const start = phase.indexOf("const affordable = (v: ClaimVerifier, t: VerificationTarget): boolean => {");
  assert(start > 0, "the affordability check exists");
  const body = phase.slice(start, phase.indexOf("\n  };", start));
  assert(body.includes("i.affordability(call)"), "it asks the ledger's own question of the compiled call");
  for (const raw of ["costOf(", "estimate_per_target_usd", "estimateCallUsd", "spendTotals"]) {
    assert(!body.includes(raw), `the affordability check must not price independently (${raw})`);
  }
  const cv = read("supabase/functions/_shared/claimVerifier.ts");
  const gate = cv.slice(cv.indexOf("export function ledgerAffordability("));
  assert(gate.includes("const spec = d.spec(c);") && gate.includes("const estimate_usd = spec.cost.estimate_usd;"),
    "the gate prices the COMPILED spec");
  assert(gate.includes("candidateCeilingRefusal(d.ledger"), "the gate asks the ledger's candidate rule");
  const bp = read("supabase/functions/_shared/budgetPolicy.ts");
  const res = bp.slice(bp.indexOf("export function reserve("), bp.indexOf("export function missionBudgetState("));
  assert(res.includes("candidateCeilingRefusal(l,"), "reserve uses the SAME candidate rule");
  assert(!/by_candidate\[k\]/.test(res), "reserve has no second copy of the candidate arithmetic");
});

Deno.test(`[provider-spec] the replay is wired to the same production functions run-agent is (${BINDING})`, () => {
  const ra = read("supabase/functions/run-agent/index.ts");
  for (const wired of RUN_AGENT_PINS) assert(ra.includes(wired), `run-agent: ${wired}`);
  const lab = read("tests/replay/lib/verification.ts") + read("tests/replay/lib/mission.ts");
  for (const fn of [
    "ledgerBoundCall(deps)", "phaseGate(deps", "verifiableCandidatesFrom(", "missionHiringVerifier(", "verifierSpecCompiler({",
    "guardedInvoker(null,", "hashInput(input", "unfinishedFrontierCount(", "claimProgressCount({", "decideAutoContinuation({",
    "foldSlice(", "settleV2Outcome({", "runClaimVerificationPhase({", "runCapabilityPlan(", "buildWorkbenchMissionView(",
  ]) assert(lab.includes(fn), `replay lab: ${fn}`);
});

Deno.test("[provider-spec] replay cannot reach the network, and an unrecorded provider call fails loudly", async () => {
  noNetwork();
  assertThrows(() => fetch("https://api.apify.com/v2/acts"), Error, "must not reach the network");
  const p = new FixtureProvider([]);
  await assertRejects(() => p.invoke({ actorKey: "apify_funding_atomus", input: {} }), UnrecordedProviderCall);
});
