// A HARD MISSION CAP, ENFORCED BEFORE EVERY PAID CALL (canary 4, 382de52c).
//
// Canary 4's stop rules — provider spend > $0.80, credits > 40 — lived only in
// the operator's head. At slice 6 the lineage had committed $0.7527; the cancel
// write was blocked and it ran to slice 10. The spend ledger's mission ceiling
// was the $2.00 default, which it never approached.
//
// These replay the lineage's real purchases (task 382de52c, lead_execution_calls
// and the worker log) against the ledger, and the slice-6 position through the
// REAL engine, with and without an operator cap (`missionSpendCap.ts`).

import { assert, assertAlmostEquals, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applySpendFloor, type CallPurpose, markAdopted, markExecuted, missionBudgetState, missionCommitted, newSpendLedger,
  paidCallCount, reserve, resolveCeilings, settle, type SpendLedger,
} from "../../../supabase/functions/_shared/budgetPolicy.ts";
import {
  capCeilings, MISSION_CAP_WORKSPACES_ENV, MISSION_CREDIT_CAP_ENV, MISSION_PROVIDER_USD_CAP_ENV, type MissionSpendCap,
  readLineageSpendFloor, resolveMissionSpendCap, spendFloorFromRows, UNREADABLE_FLOOR,
} from "../../../supabase/functions/_shared/missionSpendCap.ts";
import { decideAutoContinuation, settleV2Terminal, type AutoContinuationInput } from "../../../supabase/functions/_shared/leadAutoContinuation.ts";
import { mapTaskOutcome, queueStatusFor } from "../../../supabase/functions/_shared/leadMissionV2Request.ts";
import { runCapabilityPlan } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { mergeCompanyBrainIntoMission, parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { readinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { candidatePool } from "../../../supabase/functions/_shared/runBudget.ts";
import { emptyDiscoverySelector } from "./discoverySelectorFixture.ts";

globalThis.fetch = () => { throw new Error("mission-cap tests must not reach the network"); };

// ── CANARY 4'S LEDGER, SLICES 1–6 ───────────────────────────────────────────
//
// Every paid call the lineage reserved, at its settled cost, in order. Adoptions
// (slices 2, 5, 6) commit nothing. lead_execution_calls summed to $0.7527 at
// slice 6; these per-call figures sum to $0.7528 (four-place rounding of the
// derived-floor Firecrawl rows).

type Buy = [CallPurpose, number];
const fc = (n: number): Buy[] => Array.from({ length: n }, () => ["web_evidence", 0.0063] as Buy);
const SLICES: Record<number, { buys: Buy[]; adopted: number }> = {
  1: { buys: [["discovery", 0.041], ["enrichment", 0.0401], ["funding_evidence", 0.0211], ["funding_evidence", 0.0401],
    ["funding_evidence", 0.0401], ["funding_evidence", 0.0201], ...fc(4), ["hiring_evidence", 0.019]], adopted: 0 },
  2: { buys: [], adopted: 1 },
  3: { buys: [["discovery", 0.041], ["enrichment", 0.0361], ["funding_evidence", 0.0211], ["funding_evidence", 0.0401],
    ["funding_evidence", 0.0201], ...fc(11)], adopted: 0 },
  4: { buys: [["discovery", 0.041], ["enrichment", 0.0401], ["funding_evidence", 0.0211], ["funding_evidence", 0.0401],
    ["funding_evidence", 0.0401], ...fc(3), ["hiring_evidence", 0.012]], adopted: 0 },
  5: { buys: [["funding_evidence", 0.0071], ["funding_evidence", 0.0201], ...fc(6)], adopted: 2 },
  6: { buys: [], adopted: 1 },
};
/** Slice 7 as the worker log shows it: page 4 search, details, Atomus, two Pvalyou batches. */
const SLICE_7: Buy[] = [["discovery", 0.041], ["enrichment", 0.0401], ["funding_evidence", 0.0211],
  ["funding_evidence", 0.0401], ["funding_evidence", 0.0201]];

let seq = 0;
/** Reserve, execute and settle one call. Returns false when the ledger refused it. */
function buy(l: SpendLedger, [purpose, usd]: Buy): boolean {
  const key = `k${++seq}`;
  const d = reserve(l, { idempotency_key: key, provider_call_id: `pc_${key}`, purpose, route_id: null, estimate_usd: usd });
  if (!d.ok) return false;
  markExecuted(l, key, usd);
  settle(l, key, usd);
  return true;
}
function adopt(l: SpendLedger): void {
  const key = `k${++seq}`;
  reserve(l, { idempotency_key: key, provider_call_id: `pc_${key}`, purpose: "funding_evidence", route_id: null, estimate_usd: 0.0401 });
  markAdopted(l, key);
}
/** Replay slices 1..n onto a ledger. Returns the slice in which the first refusal happened, or null. */
function replay(l: SpendLedger, upTo: number): number | null {
  for (let s = 1; s <= upTo; s++) {
    for (let i = 0; i < SLICES[s].adopted; i++) adopt(l);
    for (const b of SLICES[s].buys) if (!buy(l, b)) return s;
  }
  return null;
}
const CAP_080: MissionSpendCap = { provider_usd: 0.80, credits: null, invalid: [] };

/** The continuation input canary 4's slices actually produced, with the budget field. */
const decisionAfter = (l: SpendLedger, capped: boolean, pendingRuns = 0): ReturnType<typeof decideAutoContinuation> => {
  const b = missionBudgetState(l);
  const input: AutoContinuationInput = {
    qualified: 0, requestedCount: 1, frontierRemaining: 0, continuationsUsed: 6, maxContinuations: 10,
    costUnitsUsed: 6, maxCostUnits: 120, barrenSlices: 0, discoveryRoutesRemain: true, pendingRuns,
    missionBudgetExhausted: capped && b.exhausted ? b.detail : null,
  };
  return decideAutoContinuation(input);
};

// ── OLD vs FIXED REPLAY ─────────────────────────────────────────────────────

Deno.test("CANARY 4 OLD REPLAY: under the $2.00 default, slice 7 buys all five calls and passes $0.80; the lineage continues", () => {
  const l = newSpendLedger(resolveCeilings(null));
  assertEquals(replay(l, 6), null);
  assertAlmostEquals(missionCommitted(l).usd, 0.7528, 0.0001);
  assertEquals(paidCallCount(l), 44);
  for (const b of SLICE_7) assert(buy(l, b), "nothing in the default ledger refuses it");
  assert(missionCommitted(l).usd > 0.80, `overshoot: $${missionCommitted(l).usd}`);
  // And nothing tells the continuation decision to stop.
  assertFalse(missionBudgetState(l).exhausted);
  assertEquals(decisionAfter(l, false).reason, "replenishment_required");
});

Deno.test("CANARY 4 FIXED REPLAY: a $0.80 cap lets the $0.041 search fit ($0.7938), refuses the $0.0401 details read BEFORE reservation, and ends budget_exhausted", () => {
  // The ledger slices 1–6 built under the default — then the cap, as the
  // engine applies it at the start of slice 7.
  const l = newSpendLedger(resolveCeilings(null));
  replay(l, 6);
  l.ceilings = capCeilings(l.ceilings, CAP_080);
  assertEquals(l.ceilings.mission_provider_usd, 0.80);

  // $0.7528 + $0.041 = $0.7938 ≤ $0.80: the search fits under the cap.
  assert(buy(l, SLICE_7[0]));
  // $0.7938 + $0.0401 = $0.8339 > $0.80: refused, never reserved.
  const before = l.reservations.filter((r) => r.status !== "refused_budget").length;
  const d = reserve(l, { idempotency_key: "s7-details", provider_call_id: "pc_s7d", purpose: "enrichment", route_id: null, estimate_usd: 0.0401 });
  assertFalse(d.ok);
  assertEquals((d as { ceiling: string }).ceiling, "mission");
  assertEquals(l.reservations.filter((r) => r.status !== "refused_budget").length, before, "no reservation was committed");
  assert(missionCommitted(l).usd <= 0.80, `never above the cap: $${missionCommitted(l).usd}`);

  // The budget is spent: the lineage stops on the canonical budget reason.
  const b = missionBudgetState(l);
  assert(b.exhausted);
  const decision = decisionAfter(l, true);
  assertEquals([decision.continue, decision.reason], [false, "cost_ceiling"]);
  assertEquals(settleV2Terminal(decision.reason, "continuation_required"), "budget_exhausted");
  // budget_exhausted is a TERMINAL task outcome, and releases the queue row complete —
  // the same path canary 4's continuation_ceiling took (queue complete, plan partial).
  const outcome = mapTaskOutcome({ status: "ready", terminal_status: "budget_exhausted" });
  assertEquals(outcome, { status: "budget_exhausted", terminal: true });
  assertEquals(queueStatusFor(outcome), "complete");
});

Deno.test("the example as stated — a call that does not fit is refused: a $0.79 cap refuses the slice-7 search itself", () => {
  // ($0.7527 + $0.041 = $0.7937, which is UNDER $0.80; at $0.79 it is over.)
  const l = newSpendLedger(capCeilings(resolveCeilings(null), { provider_usd: 0.79, credits: null, invalid: [] }));
  assertEquals(replay(l, 6), null, "slices 1–6 fit under $0.79");
  assertFalse(buy(l, SLICE_7[0]));
  assertAlmostEquals(missionCommitted(l).usd, 0.7528, 0.0001);
  assertEquals(decisionAfter(l, true).reason, "cost_ceiling");
});

Deno.test("CANARY 4 WITH THE CREDIT CAP (40): the 41st paid call is refused in slice 5 — paid calls, not the 34 credits the workspace was charged", () => {
  // The ledger counts 44 paid calls through slice 6; the workspace was charged
  // 34 credits, because Firecrawl domain maps share logical_call_key
  // `…:web_evidence_verification:no-hash` and credits_reserve REPLAYED them.
  // The cap counts calls, the credit policy's own unit (1 per call), so it can
  // only stop sooner than the (under-)charged credits.
  const l = newSpendLedger(capCeilings(resolveCeilings(null), { provider_usd: 0.80, credits: 40, invalid: [] }));
  assertEquals(replay(l, 6), 5);
  assertEquals(paidCallCount(l), 40);
  const refused = l.reservations.filter((r) => r.status === "refused_budget");
  assertEquals(refused.map((r) => r.refused_ceiling), ["mission_credits"]);
  assert(missionBudgetState(l).exhausted);
  assertEquals(decisionAfter(l, true).reason, "cost_ceiling");
});

// ── THE RULES ───────────────────────────────────────────────────────────────

Deno.test("an exact-cap purchase is allowed; one ten-thousandth over is refused", () => {
  const l = newSpendLedger(capCeilings(resolveCeilings(null), CAP_080));
  assert(buy(l, ["discovery", 0.759]));
  assert(buy(l, ["discovery", 0.041]), "0.759 + 0.041 = 0.800 exactly");
  assertEquals(missionCommitted(l).usd, 0.8);
  assertFalse(buy(l, ["web_evidence", 0.0001]));
  // At the cap the mission is spent even before anything is refused.
  const m = newSpendLedger(capCeilings(resolveCeilings(null), CAP_080));
  buy(m, ["discovery", 0.80]);
  assert(missionBudgetState(m).exhausted);
});

Deno.test("an already-reserved (in-flight, unsettled) call counts toward the cap at its estimate", () => {
  const l = newSpendLedger(capCeilings(resolveCeilings(null), CAP_080));
  const a = reserve(l, { idempotency_key: "inflight", provider_call_id: "pc1", purpose: "discovery", route_id: null, estimate_usd: 0.78 });
  assert(a.ok);
  // Never executed, never settled — still committed.
  assertEquals(missionCommitted(l).usd, 0.78);
  assertFalse(reserve(l, { idempotency_key: "next", provider_call_id: "pc2", purpose: "enrichment", route_id: null, estimate_usd: 0.0401 }).ok);
});

Deno.test("an adopted / reused run does not charge twice: it commits nothing and does not count as a paid call", () => {
  const l = newSpendLedger(capCeilings(resolveCeilings(null), { provider_usd: 0.80, credits: 2, invalid: [] }));
  assert(buy(l, ["funding_evidence", 0.0401]));
  // The next slice adopts a timed-out run: free, uncounted.
  adopt(l); adopt(l); adopt(l);
  assertEquals(missionCommitted(l), { usd: 0.0401, paid_calls: 1 });
  assert(buy(l, ["funding_evidence", 0.0401]), "the second PAID call still fits the 2-call cap");
  assertFalse(buy(l, ["funding_evidence", 0.0001]), "the third is refused");
});

Deno.test("a retry under the same idempotency key commits once; a resumed slice's floor counts only what the ledger missed", () => {
  const l = newSpendLedger(capCeilings(resolveCeilings(null), CAP_080));
  const q = { idempotency_key: "same", provider_call_id: "pc", purpose: "discovery" as const, route_id: null, estimate_usd: 0.5 };
  assert(reserve(l, q).ok);
  assert(reserve(l, q).ok, "the replay returns the existing reservation");
  assertEquals(missionCommitted(l), { usd: 0.5, paid_calls: 1 });
  // The database saw the same call: no double count.
  applySpendFloor(l, { committed_usd: 0.5, paid_calls: 1, source: "lead_execution_calls" });
  assertEquals(missionCommitted(l), { usd: 0.5, paid_calls: 1 });
});

Deno.test("concurrent reservation attempts cannot overshoot: 20 parallel $0.041 calls against $0.10 of headroom — exactly 2 are reserved", async () => {
  const l = newSpendLedger(capCeilings(resolveCeilings(null), CAP_080));
  buy(l, ["discovery", 0.70]);
  const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3));
  const attempts = Array.from({ length: 20 }, async (_, i) => {
    await tick(); // interleave arrivals
    const d = reserve(l, { idempotency_key: `p${i}`, provider_call_id: `pc_p${i}`, purpose: "discovery", route_id: null, estimate_usd: 0.041 });
    await tick(); // the "network call"
    if (d.ok) markExecuted(l, `p${i}`, 0.041);
    return d.ok;
  });
  const ok = (await Promise.all(attempts)).filter(Boolean).length;
  assertEquals(ok, 2);
  assert(missionCommitted(l).usd <= 0.80, `$${missionCommitted(l).usd}`);
});

Deno.test("a lost checkpoint cannot hide spend: an EMPTY ledger with canary 4's database floor refuses at the same point", () => {
  // The previous slice's checkpoint write was lost; the ledger restarts empty.
  const l = newSpendLedger(capCeilings(resolveCeilings(null), CAP_080));
  applySpendFloor(l, { committed_usd: 0.7527, paid_calls: 34, source: "lead_execution_calls" });
  assert(buy(l, SLICE_7[0]), "$0.7527 + $0.041 fits");
  assertFalse(buy(l, SLICE_7[1]), "$0.7937 + $0.0401 does not");
  assertAlmostEquals(missionCommitted(l).usd, 0.7937, 0.00001);
  // Re-applying the SAME reading (a second engine round in one slice) keeps the
  // first baseline — it does not subtract this slice's own purchase.
  applySpendFloor(l, { committed_usd: 0.7527, paid_calls: 34, source: "lead_execution_calls" });
  assertAlmostEquals(missionCommitted(l).usd, 0.7937, 0.00001);
});

Deno.test("an unreadable floor under a cap refuses every paid call (fail closed)", () => {
  const l = newSpendLedger(capCeilings(resolveCeilings(null), CAP_080));
  applySpendFloor(l, UNREADABLE_FLOOR);
  assertFalse(buy(l, ["discovery", 0.001]));
  assert(missionBudgetState(l).exhausted);
});

Deno.test("a spent cap with a paid run still executing waits to adopt it (free), then stops", () => {
  const l = newSpendLedger(capCeilings(resolveCeilings(null), CAP_080));
  buy(l, ["discovery", 0.80]);
  assertEquals(decisionAfter(l, true, 1).reason, "awaiting_provider_run");
  assertEquals(decisionAfter(l, true, 0).reason, "cost_ceiling");
});

Deno.test("a call/route/candidate refusal does not spend the mission — other work may still fit", () => {
  const l = newSpendLedger(capCeilings(resolveCeilings(null), CAP_080));
  // web_evidence's per-call ceiling is $0.01.
  assertFalse(buy(l, ["web_evidence", 0.05]));
  assertEquals(l.reservations[0].refused_ceiling, "call");
  assertFalse(missionBudgetState(l).exhausted);
});

// ── THE CAP ITSELF ──────────────────────────────────────────────────────────

const env = (o: Record<string, string>) => (k: string) => o[k];

Deno.test("cap: unset is null — no ceiling touched, no floor read, no decision changed", () => {
  assertEquals(resolveMissionSpendCap(env({}), "ws"), null);
  assertEquals(capCeilings(resolveCeilings(null), null), resolveCeilings(null));
  // The decision with the field absent is the decision without it.
  const base: AutoContinuationInput = { qualified: 0, requestedCount: 1, frontierRemaining: 0, continuationsUsed: 6,
    maxContinuations: 10, costUnitsUsed: 6, maxCostUnits: 120, barrenSlices: 0, discoveryRoutesRemain: true };
  assertEquals(decideAutoContinuation({ ...base, missionBudgetExhausted: null }), decideAutoContinuation(base));
});

Deno.test("cap: parsed strictly, tighten-only, workspace-scoped, and fail-closed on a typo", () => {
  assertEquals(resolveMissionSpendCap(env({ [MISSION_PROVIDER_USD_CAP_ENV]: "0.80", [MISSION_CREDIT_CAP_ENV]: "40" }), "ws"),
    { provider_usd: 0.8, credits: 40, invalid: [] });
  // A typo is a cap of ZERO, never an absent cap.
  const typo = resolveMissionSpendCap(env({ [MISSION_PROVIDER_USD_CAP_ENV]: "0.8O" }), "ws")!;
  assertEquals([typo.provider_usd, typo.invalid], [0, [MISSION_PROVIDER_USD_CAP_ENV]]);
  assertEquals(resolveMissionSpendCap(env({ [MISSION_CREDIT_CAP_ENV]: "40.5" }), "ws")!.credits, 0);
  const zero = newSpendLedger(capCeilings(resolveCeilings(null), typo));
  assertFalse(buy(zero, ["discovery", 0.001]), "a zero cap buys nothing");
  // A cap can never RAISE a ceiling.
  assertEquals(capCeilings(resolveCeilings(null), { provider_usd: 5, credits: null, invalid: [] }).mission_provider_usd, 2);
  assertEquals(capCeilings({ ...resolveCeilings(null), mission_credits: 10 }, { provider_usd: null, credits: 40, invalid: [] }).mission_credits, 10);
  // Lowered caps also lower every route and call ceiling.
  const c = capCeilings(resolveCeilings(null), { provider_usd: 0.03, credits: null, invalid: [] });
  assertEquals([c.per_route_usd.funding, c.per_call_usd.people, c.per_candidate_evidence_usd], [0.03, 0.03, 0.03]);
  // Scoped: a workspace not named is uncapped here.
  const scoped = env({ [MISSION_PROVIDER_USD_CAP_ENV]: "0.80", [MISSION_CAP_WORKSPACES_ENV]: "ws-a, ws-b" });
  assertEquals(resolveMissionSpendCap(scoped, "ws-b")?.provider_usd, 0.8);
  assertEquals(resolveMissionSpendCap(scoped, "ws-c"), null);
  assertEquals(resolveMissionSpendCap(scoped, null), null);
  assertEquals(resolveMissionSpendCap(env({ [MISSION_PROVIDER_USD_CAP_ENV]: "1", [MISSION_CAP_WORKSPACES_ENV]: "*" }), "any")?.provider_usd, 1);
});

Deno.test("floor: canary 4's lead_execution_calls rows at slice 6 read $0.7527 / 34 — adoptions and unspecced rows excluded", async () => {
  const rows = [
    { status: "succeeded", provider_call_id: "pc_a", settled_usd: "0.7126", actual_cost_usd: null, estimate_usd: null },
    { status: "started", provider_call_id: "pc_b", settled_usd: null, actual_cost_usd: null, estimate_usd: "0.0401" },
    { status: "reused", provider_call_id: "pc_c", settled_usd: null, actual_cost_usd: null, estimate_usd: "0.0401" },
    { status: "succeeded", provider_call_id: null, settled_usd: null, actual_cost_usd: null, estimate_usd: null },
    ...Array.from({ length: 32 }, () => ({ status: "succeeded", provider_call_id: "pc_x", settled_usd: 0, actual_cost_usd: null, estimate_usd: null })),
  ];
  assertEquals(spendFloorFromRows(rows), { committed_usd: 0.7527, paid_calls: 34, source: "lead_execution_calls" });
  // The reader queries by lineage prefix and fails closed.
  let pattern = "";
  const db = { from: () => ({ select: () => ({ like: (_c: string, p: string) => { pattern = p; return Promise.resolve({ data: rows, error: null }); } }) }) };
  assertEquals((await readLineageSpendFloor(db, "382de52c")).committed_usd, 0.7527);
  assertEquals(pattern, "382de52c:%");
  const broken = { from: () => ({ select: () => ({ like: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) };
  assertEquals(await readLineageSpendFloor(broken, "382de52c"), UNREADABLE_FLOOR);
});

// ── THROUGH THE REAL ENGINE ─────────────────────────────────────────────────

const PROBE = readinessPolicy({ mode: "provider_probe", probe_routes: ["apify_linkedin_company_search|general_company_discovery"] });
const MISSION = (() => {
  const m = parseLeadMissionDeterministic("Find 1 US company with 11-50 employees that raised funding in the last 6 months");
  return mergeCompanyBrainIntoMission({ ...m, company_profile: { ...m.company_profile, employee_range: { min: 11, max: 50 } },
    field_provenance: { ...m.field_provenance, "company_profile.employee_range": "explicit_user_request" as const } },
  { industries: ["b2b saas"] } as never).mission;
})();
const row = (i: number) => ({ id: `co${i}`, name: `Co ${i}`, linkedinUrl: `https://www.linkedin.com/company/co${i}/`,
  website: `https://co${i}.com`, description: "x", employeeCount: 20, employeeCountRange: { start: 11, end: 50 },
  industries: [{ id: 4, name: "Software Development" }],
  locations: [{ parsed: { text: "SF, CA, United States", countryFull: "United States" }, country: "US", headquarter: true }] });
const ROWS = Array.from({ length: 10 }, (_, i) => row(i));

/** Canary 4's slice 7 through `runCapabilityPlan`: page search ($0.041) then a 10-company details read ($0.0401). */
async function engineSlice(cap: MissionSpendCap | null, floor: Parameters<typeof applySpendFloor>[1]) {
  const sent: string[] = [];
  const logs: Array<[string, unknown]> = [];
  const deps = {
    log: (e: string, m?: unknown) => logs.push([e, m]),
    planDiscovery: emptyDiscoverySelector(),
    planExecution: () => Promise.resolve({ reasoning: "replay", steps: [
      { capability: "general_company_discovery", actor_key: "apify_linkedin_company_search", purpose: "d",
        input: { industryIds: ["4", "6"], locations: ["United States"], companySize: ["11-50"], maxItems: 10, scraperMode: "full" }, depends_on: [] },
      { capability: "company_identity_resolution", actor_key: "apify_linkedin_company_search", purpose: "i", input: { searchQuery: "{{name}}", maxItems: 5 }, depends_on: [1] },
      { capability: "company_enrichment", actor_key: "apify_linkedin_company_details", purpose: "e", input: { companies: ["{{url}}"] }, depends_on: [2] },
      { capability: "company_brain_qualification", actor_key: null, purpose: "q", input: {}, depends_on: [3] },
      { capability: "persistence", actor_key: null, purpose: "p", input: {}, depends_on: [4] },
    ] }),
    controlRoutes: () => Promise.resolve({ action: "continue" }),
    // deno-lint-ignore no-explicit-any
    invoke: (call: any) => {
      sent.push(call.actorKey);
      call.onProviderRun?.({ run_id: `run-${sent.length}`, dataset_id: null });
      if (call.actorKey === "apify_linkedin_company_search") return Promise.resolve(call.input.searchQuery ? [] : ROWS);
      if (call.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve((call.input.companies ?? []).map((u: string) =>
          ROWS.find((r) => r.linkedinUrl.replace(/\/$/, "") === u.replace(/\/$/, ""))).filter(Boolean));
      }
      throw new Error(`unexpected provider call: ${call.actorKey}`);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  };
  const opts = {
    mission: MISSION, plan: buildCapabilityGraph(MISSION, { executability: "enforce", readiness: PROBE }),
    maxCandidates: candidatePool(1, null), readiness: PROBE,
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
    specMode: "enforce", specScope: { workspace_id: "e8af257d", lineage_id: "382de52c" },
    missionCap: cap, spendFloor: floor,
  };
  // deno-lint-ignore no-explicit-any
  const r = await runCapabilityPlan(deps as never, opts as never) as unknown as { state: Record<string, any> };
  return { sent, ledger: r.state.spend_ledger as SpendLedger, trace: r.state.mission_trace, logs };
}
const SLICE6_FLOOR = { committed_usd: 0.7527, paid_calls: 34, source: "lead_execution_calls" as const };

Deno.test("ENGINE, OLD: no cap — the slice-6 floor is ignored and both paid calls go out", async () => {
  const e = await engineSlice(null, SLICE6_FLOOR);
  assertEquals(e.sent, ["apify_linkedin_company_search", "apify_linkedin_company_details"]);
  assertEquals(e.ledger.ceilings.mission_provider_usd, 2);
  assertEquals(e.ledger.floor ?? null, null, "no cap, no floor");
});

Deno.test("ENGINE, FIXED: $0.80 cap at canary 4's slice-6 spend — the search goes out, the details call is refused BEFORE reservation and never reaches the provider", async () => {
  const e = await engineSlice(CAP_080, SLICE6_FLOOR);
  assertEquals(e.sent, ["apify_linkedin_company_search"], "the provider saw exactly one call");
  assertEquals(e.ledger.ceilings.mission_provider_usd, 0.8);
  const live = e.ledger.reservations.filter((r) => r.status !== "refused_budget");
  assertEquals(live.map((r) => [r.purpose, r.estimate_usd]), [["discovery", 0.041]]);
  const refused = e.ledger.reservations.filter((r) => r.status === "refused_budget");
  assertEquals(refused.map((r) => [r.purpose, r.refused_ceiling]), [["enrichment", "mission"]]);
  assert(missionCommitted(e.ledger).usd <= 0.8);
  // The refusal is in the trace, and the mission is spent.
  // deno-lint-ignore no-explicit-any
  assert((e.trace.events as any[]).some((t) => t.type === "call_refused_budget" && t.detail?.ceiling === "mission"));
  assert(missionBudgetState(e.ledger).exhausted);
  assert(e.logs.some(([ev]) => ev === "mission_cap_applied"));
});

Deno.test("ENGINE, FIXED: at a $0.79 cap — or at the 34-call credit cap — no provider call is made at all", async () => {
  assertEquals((await engineSlice({ provider_usd: 0.79, credits: null, invalid: [] }, SLICE6_FLOOR)).sent, []);
  assertEquals((await engineSlice({ provider_usd: null, credits: 34, invalid: [] }, SLICE6_FLOOR)).sent, []);
  // Nothing reserved means no ledger row, no credits_reserve, nothing to settle.
  const e = await engineSlice({ provider_usd: 0.79, credits: null, invalid: [] }, SLICE6_FLOOR);
  assertEquals(e.ledger.reservations.filter((r) => r.status !== "refused_budget").length, 0);
});
