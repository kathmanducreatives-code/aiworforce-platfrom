// STAGE 2 IS WIRED IN, AND IT IS OFF UNTIL SOMEBODY TURNS IT ON.
//
// The modules were built and proven in isolation while the live engine kept
// judging one company at a time. These tests drive the REAL `runCapabilityPlan`
// and prove the three things that matter about the wiring:
//
//   * with the flag OFF, every line of the previous path runs unchanged;
//   * with it ON, the set is collected, gated for free, and evaluated in
//     bounded batches — and a completed batch is restored on continuation
//     rather than re-bought, because a re-run model call can return a different
//     verdict for the same evidence;
//   * ranking cannot change what a company IS, only where it sits.
//
// ZERO network, ZERO Actor runs, ZERO real model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCapabilityPlan, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  INVESTIGATION_BUDGET_ENV,
} from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";
import {
  parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  evaluateBatchResponse, resolveBatchLimits,
  type BatchMember,
} from "../../../supabase/functions/_shared/groundedBatchEvaluation.ts";
import {
  buildPoolCheckpoint, readPoolCheckpoint, poolFingerprintOf,
  POOL_EVAL_RESULT_KEY,
} from "../../../supabase/functions/_shared/poolCheckpoint.ts";
import {
  validatePoolRanking, deterministicRanking, buildRankingShadowComparison,
} from "../../../supabase/functions/_shared/poolRanking.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

const N = 22;
const QUERY =
  "Find founders of US B2B SaaS startups hiring Sales Operations. Return 25 qualified leads.";
const mission = () => parseLeadMissionDeterministic(QUERY);
const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

/** N discovered YC companies, all plausibly in range. */
const YC_ROWS = Array.from({ length: N }, (_, i) => ({
  id: `co${i}`, name: `Co${i}`, website: `https://co${i}.com`,
  industry: "B2B", industries: ["B2B"], batch: "W22", teamSize: 42,
  oneLiner: `Co${i} sells electronic-design software to engineering teams.`,
  allLocations: "San Francisco, CA, USA",
  openJobs: [{ title: "Revenue Operations Manager", url: `https://x/${i}` }],
}));
const ROWS: Record<string, Record<string, unknown>[]> = {
  apify_yc_companies_memo23: YC_ROWS,
  apify_linkedin_company_search: YC_ROWS.map((r) => ({
    id: r.id, name: r.name, linkedinUrl: `https://www.linkedin.com/company/${r.id}`,
    website: r.website, description: r.oneLiner, location: "San Francisco, CA",
  })),
  apify_linkedin_company_details: YC_ROWS.map((r) => ({
    id: r.id, name: r.name, linkedinUrl: `https://www.linkedin.com/company/${r.id}`,
    website: r.website, employeeCount: 42, description: r.oneLiner,
    industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
    locations: [{ linkedinText: "United States" }],
  })),
};

interface Rec { calls: string[]; batches: number[]; groundedCalls: number }
function deps(rec: Rec, over: Partial<CapabilityEngineDeps> = {}): CapabilityEngineDeps {
  return {
    invoke: (call: CompiledActorCall<unknown>) => {
      rec.calls.push(call.actorKey);
      return Promise.resolve(ROWS[call.actorKey] ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    ...over,
  };
}

/** A batch responder that grounds every company from its own description. */
function respond(batch: readonly BatchMember[], opts: { invented?: string } = {}) {
  return {
    results: batch.map((m) => {
      const d = m.registry.items
        .find((x) => x.evidence_type === "company_description")?.evidence_id ?? "none";
      const invented = opts.invented === m.company_key;
      return {
        company_key: m.company_key,
        business_model: {
          value: "b2b_software", confidence: 0.9,
          claims: [{
            claim: invented ? `${m.company_key} sells API subscriptions.`
              : `${m.company_key} sells electronic-design software.`,
            claim_type: "business_model", evidence_ids: [d],
            evidence_excerpts: [{
              evidence_id: d,
              excerpt: invented ? "API subscriptions" : "electronic-design software",
            }],
          }],
        },
        company_fit: "pass", agentory_use_case: "strong",
        supporting_claims: [], confidence: 0.9, reason: "",
      };
    }),
  };
}

/**
 * THE INVESTIGATION BUDGET IS NOW EXPLICIT IN THIS FILE.
 *
 * Stage 2 batch-evaluates companies that have COLLECTED EVIDENCE, so its pool
 * is bounded by what was actually investigated. It used to be bounded by
 * `stage2Ceiling` instead — the engine adopted `batchLimits.max_evaluated` (100)
 * as the PAID investigation budget, so all 22 fixture companies were bought.
 *
 * That conflation is removed: a GPT batch-read limit is not a provider spend
 * authorisation (TEST run ea2d02f2 turned it into 97 LinkedIn searches and
 * finished none). This file's subject is the batching wiring, not the spend
 * decision, so it states the budget it wants rather than inheriting one.
 */
const BUDGET_ENV = { [INVESTIGATION_BUDGET_ENV]: String(N) };
const readBudget = (k: string) => (BUDGET_ENV as Record<string, string>)[k];

async function run(over: Partial<CapabilityEngineDeps>) {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const out = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, over) }, {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget,
  });
  return { out, rec };
}

const stage2Deps = (rec: Rec, over: Partial<CapabilityEngineDeps> = {}) => ({
  batchLimits: resolveBatchLimits({ batch_size: 8, max_evaluated: 100 }),
  evaluateBatch: (batch: readonly BatchMember[]) => {
    rec.batches.push(batch.length);
    return Promise.resolve(evaluateBatchResponse({ batch, raw: respond(batch) }));
  },
  ...over,
});

// ═══════════════════════════════════════════════════ 1-10. engine wiring ══

Deno.test("1-2. Stage 2 collects before evaluating; disabled keeps the old path", async () => {
  // OFF: no pool at all, and the per-company grounder is what runs.
  const off = await run({ groundCompany: () => Promise.resolve(null) });
  assertEquals(off.out.pool, null, "no Stage 2 output when the flag is off");
  assert(off.out.companies.some((c) => c.brain !== null), "the old path still decides");

  // ON: the pool exists and every eligible company was collected first.
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const on = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec)) }, {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget,
  });
  assert(on.pool, "Stage 2 produced a pool");
  assertEquals(on.pool!.eligible.discovered, N);
});

Deno.test("3-5. free gates run before any model call, and batches stay bounded", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const out = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec)) }, {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget,
  });
  const p = out.pool!;
  assertEquals(p.eligible.discovered, N);
  assertEquals(p.eligible.eligible + p.eligible.hard_gated, p.eligible.discovered);
  // MORE THAN TEN. The old ceiling is gone.
  assert(p.summaries.length > 10,
    `expected >10 evaluated, got ${p.summaries.length}`);
  // …in bounded batches.
  assert(rec.batches.length >= 2, "several batches ran");
  for (const size of rec.batches) assert(size <= 8, `batch of ${size} exceeds the bound`);
});

Deno.test("6-8. every evaluated company gets a grounded decision; evidence stays isolated", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const out = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec)) }, {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget,
  });
  for (const s of out.pool!.summaries) {
    assert(["qualified", "review", "reject"].includes(s.brain_decision));
    assert(s.grounding_score >= 0 && s.grounding_score <= 1);
  }
  // Each company's registry belongs to it alone.
  for (const c of out.companies) {
    if (!c.evidence_registry) continue;
    assertEquals(c.evidence_registry.company_key, c.key);
    for (const item of c.evidence_registry.items) assertEquals(item.company_key, c.key);
  }
});

Deno.test("7b/9. an unsupported claim cannot qualify, and does not spoil its batch", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const out = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, {
    batchLimits: resolveBatchLimits({ batch_size: 8 }),
    groundingMode: "enforce",
    evaluateBatch: (batch) => Promise.resolve(
      evaluateBatchResponse({ batch, raw: respond(batch, { invented: "co0.com" }) })),
  }) }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget });

  const badKey = out.companies[0].key;
  const bad = out.companies.find((c) => c.key === badKey)!;
  // The company whose claim was invented is grounded at zero and cannot pass.
  assertEquals(bad.grounded!.grounding_score, 0);
  assertEquals(bad.grounded!.final_grounded_decision, "review");
  assertFalse(bad.brain?.outcome === "QUALIFIED");
  assert(bad.grounded!.rejected_claims.length > 0, "and it went through the verifier");

  // ITS BATCH-MATES ARE UNAFFECTED. Their claims validated in full — which is
  // the property under test; what the Brain then does with other gates is a
  // separate question.
  const mates = out.companies.filter((c) => c.key !== badKey && c.grounded);
  assert(mates.length > 5, `expected neighbours, got ${mates.length}`);
  for (const mate of mates) {
    assertEquals(mate.grounded!.grounding_score, 1,
      `${mate.key} lost grounding because of a neighbour`);
    assertEquals(mate.grounded!.rejected_claims.length, 0);
  }
});

Deno.test("10. completed summaries are what reach the ranker", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  let sawSummaries = 0;
  const m = mission();
  const out = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec, {
    rankPool: ({ summaries, unevaluatedCount }) => {
      sawSummaries = summaries.length;
      // The ranker must see NO registries and NO rejected claims.
      const text = JSON.stringify(summaries);
      assertFalse(text.includes("source_text"));
      assertFalse(text.includes("rejected_claims"));
      assertFalse(text.includes("harvestapi"));
      assertEquals(typeof unevaluatedCount, "number");
      return Promise.resolve(null);
    },
  })) }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget });
  assertEquals(sawSummaries, out.pool!.summaries.length);
  assert(sawSummaries > 10);
});

// ══════════════════════════════════════════ 11-18. checkpoint and resume ══

Deno.test("11-14. completed batches checkpoint, and a continuation restores them", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const checkpoints: number[] = [];
  const m = mission();
  const first = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec, {
    onBatchComplete: ({ evaluated, next_offset }) => {
      checkpoints.push(evaluated.length);
      assertEquals(next_offset, evaluated.length);
    },
  })) }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget });
  assert(checkpoints.length >= 2, "a checkpoint per completed batch");
  assert(checkpoints[checkpoints.length - 1] > 10);

  // Continue: every completed company is RESTORED, not re-evaluated.
  const restored = new Map(
    first.pool!.summaries.map((s) => [
      s.company_key,
      first.companies.find((c) => c.key === s.company_key)!.grounded!,
    ]));
  const rec2: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const second = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec2, {
    batchLimits: resolveBatchLimits({ batch_size: 8 }),
    restoredGroundedResults: restored,
    evaluateBatch: (batch) => {
      rec2.batches.push(batch.length);
      return Promise.resolve(evaluateBatchResponse({ batch, raw: respond(batch) }));
    },
  }) }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget });

  assertEquals(rec2.batches.length, 0, "nothing was re-evaluated");
  assertEquals(second.pool!.restored, restored.size);
  // RESTORED, NOT SKIPPED — the verdicts are present, not blank.
  assertEquals(second.pool!.summaries.length, first.pool!.summaries.length);
  assert(second.pool!.summaries.every((s) => s.grounding_score > 0),
    "a restored company keeps its grounded result");
});

Deno.test("15-18. the checkpoint is validated, and a changed pool invalidates it", () => {
  const fp = poolFingerprintOf(["a", "b", "c"]);
  assertEquals(fp, poolFingerprintOf(["c", "b", "a"]), "order does not matter");
  assert(fp !== poolFingerprintOf(["a", "b"]), "membership does");

  const verification = {
    version: "grounded-claims-v1",
    classifier_result: { confidence: 0.9 },
    validated_claims: [], rejected_claims: [],
    grounding_score: 1, final_grounded_decision: "pass",
    downgrade_reasons: [], unacknowledged_conflicts: [],
  } as never;
  const cp = buildPoolCheckpoint({
    missionHash: fp,
    evaluated: [{ company_key: "a", verification }],
    next_offset: 1, accounting: {},
  });
  const stored = { [POOL_EVAL_RESULT_KEY]: cp };

  assertEquals(readPoolCheckpoint(stored, fp).results.size, 1, "a matching pool restores");
  const stale = readPoolCheckpoint(stored, poolFingerprintOf(["a", "b"]));
  assertEquals(stale.results.size, 0);
  assert(stale.stale, "a changed pool is flagged, and nothing is restored from it");

  // Client-shaped junk restores NOTHING rather than being trusted into a decision.
  for (const junk of [
    null, {}, { [POOL_EVAL_RESULT_KEY]: { version: "other" } },
    { [POOL_EVAL_RESULT_KEY]: { ...cp, grounded_results: [{ company_key: "a", verification: { hacked: true } }] } },
    { [POOL_EVAL_RESULT_KEY]: { ...cp, grounded_results: [{ company_key: "a", verification: { validated_claims: [], final_grounded_decision: "QUALIFIED" } }] } },
  ]) {
    assertEquals(readPoolCheckpoint(junk, fp).results.size, 0,
      `${JSON.stringify(junk)?.slice(0, 60)} must restore nothing`);
  }
});

// ══════════════════════════════════════════════ 19-35. ranking & policy ══

Deno.test("27-28. a ranking outage falls back and never fails the workflow", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const out = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec, {
    rankPool: () => Promise.reject(new Error("ranker down")),
  })) }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget })
    .catch(() => null);
  // The engine must not propagate a ranking failure.
  assert(out, "a ranking outage must not fail the run");
  assertEquals(out!.pool!.ranking.ranking_source, "deterministic_fallback");
  assertEquals(out!.pool!.ranking.ranked.length, out!.pool!.summaries.length,
    "every evaluated company still has a place");
});

Deno.test("27b. an absent ranker uses the deterministic order and says so", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const out = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec)) }, {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget,
  });
  assertEquals(out.pool!.ranking.ranking_source, "deterministic_fallback");
  assert(out.pool!.ranking.fallback_reason);
  assertEquals(out.pool!.ranking.ranked.length, out.pool!.summaries.length);
});

Deno.test("29-35. code keeps decision-class authority and reports honestly", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const out = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec)) }, {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget,
  });
  const d = out.pool!.delivery;
  assertEquals(d.metrics.requested, m.requested_count);
  assert(d.metrics.delivered <= d.metrics.requested, "the cap is honoured");
  assertFalse(d.delivered.some((x) => x.summary.brain_decision === "reject"));
  assertEquals(d.metrics.contact_ready, 0);
  assertEquals(d.metrics.founder_unlocked, 0);
  assertEquals(
    d.metrics.shortfall, Math.max(0, d.metrics.requested - d.metrics.delivered));
  // DELIVERED IS NOT AUTOMATICALLY QUALIFIED.
  assert(typeof d.metrics.qualified === "number");
  assert(d.metrics.evaluated >= d.metrics.qualified);
});

Deno.test("23. a REJECT cannot outrank a QUALIFIED through the live path", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const out = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec, {
    // ENFORCE, deliberately: this asserts that code keeps decision-class
    // authority even when the ranking IS the delivered order. Under shadow the
    // deterministic order would satisfy it without the ranker being tested.
    rankingMode: "enforce",
    rankPool: ({ summaries }) => Promise.resolve(validatePoolRanking({
      // The model puts the worst candidate first.
      raw: {
        ranked_candidates: [...summaries].reverse().map((s, i) => ({
          company_key: s.company_key, rank: i + 1, relative_strength: "strong",
          ranking_reason: "reordered", comparison_basis: ["mission_fit"],
          recommended_action: "offer_founder_unlock",
        })),
      },
      summaries, requestedCount: 25,
    })),
  })) }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget });

  const byKey = new Map(out.pool!.summaries.map((s) => [s.company_key, s]));
  let lastClass = -1;
  for (const r of out.pool!.ranking.ranked) {
    const cls = { qualified: 0, review: 1, reject: 2 }[byKey.get(r.company_key)!.brain_decision];
    assert(cls >= lastClass, "decision classes never invert");
    lastClass = cls;
  }
});

// ═══════════════════════════════ 51-60. shadow mode actually observes ══
//
// The first wiring passed `rankPool` to the engine ONLY under enforce, so
// shadow ran no ranker, produced no comparison and persisted nothing. Enabling
// enforce would then have been a decision taken with no evidence about what it
// reorders. These pin the corrected contract: shadow COMPUTES and RECORDS, and
// the deterministic order is what ships.

/** A ranker that reverses the pool — guaranteed disagreement. */
const reversingRanker = ({ summaries }: {
  summaries: readonly { company_key: string }[];
}) => Promise.resolve(validatePoolRanking({
  raw: {
    ranked_candidates: [...summaries].reverse().map((s, i) => ({
      company_key: s.company_key, rank: i + 1, relative_strength: "strong",
      ranking_reason: "reordered", comparison_basis: ["mission_fit"],
      recommended_action: "offer_founder_unlock",
    })),
  },
  summaries: summaries as never, requestedCount: 25,
}));

Deno.test("51-54. shadow runs the ranker, ships deterministic, records the diff", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  let ranked = 0;
  const out = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec, {
    rankingMode: "shadow",
    rankPool: (i) => { ranked++; return reversingRanker(i); },
  })) }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget });

  const p = out.pool!;
  // IT RAN. This is the whole defect: it used to be zero.
  assertEquals(ranked, 1, "shadow must call the ranker");
  assertEquals(p.ranking_mode, "shadow");
  // AND IT DID NOT GOVERN.
  assertEquals(p.ranking.ranking_source, "deterministic_fallback");
  assert(p.ranking.fallback_reason?.includes("shadow"),
    "the reason must say the ranking was withheld, not that it failed");
  // AND THE DISAGREEMENT WAS RECORDED.
  const s = p.ranking_shadow!;
  assert(s, "a shadow comparison exists");
  assert(s.computed, "the comparison is of a real ranking");
  assert(s.moved_count > 0, "a reversed ranking disagrees with the deterministic one");
  assertFalse(s.identical_order);
  assertEquals(s.rank_changes.length, s.moved_count);
});

Deno.test("55-56. enforce lets the ranking govern and records no shadow", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const out = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec, {
    rankingMode: "enforce", rankPool: reversingRanker,
  })) }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget });

  const p = out.pool!;
  assertEquals(p.ranking_mode, "enforce");
  assert(["gpt_validated", "gpt_repaired"].includes(p.ranking.ranking_source),
    `enforce must ship the ranking, got ${p.ranking.ranking_source}`);
  // Under enforce the ranking IS the order; a comparison against a hypothetical
  // deterministic one would describe nothing that happened.
  assertEquals(p.ranking_shadow, null);
});

Deno.test("57. an absent mode observes rather than reorders", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const out = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec, {
    rankPool: reversingRanker, // no rankingMode at all
  })) }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget });
  assertEquals(out.pool!.ranking_mode, "shadow",
    "a missing mode must never be able to reorder what somebody calls today");
  assertEquals(out.pool!.ranking.ranking_source, "deterministic_fallback");
});

Deno.test("58. the shadow diff names who would have reached the user", () => {
  const sum = (key: string, score: number) => ({
    company_key: key, company_name: key,
    brain_decision: "qualified" as const, opportunity_tier: "A" as const,
    grounding_score: score, confidence_after_grounding: score,
    business_model: "b2b_software", agentory_use_case: "strong",
    strongest_signal: null, signal_strength: "none" as const,
    validated_claim_ids: [], validated_evidence_ids: [],
    missing_evidence: [], material_conflicts: [],
    mission_match_summary: "", reason_to_contact_now: null,
  });
  // Deterministic order is grounding-score descending: a, b, c, d.
  const summaries = [sum("a", 0.9), sum("b", 0.8), sum("c", 0.7), sum("d", 0.6)];
  const deterministic = deterministicRanking(summaries, "test");
  const proposed = validatePoolRanking({
    raw: {
      ranked_candidates: ["d", "c", "b", "a"].map((k, i) => ({
        company_key: k, rank: i + 1, relative_strength: "strong",
        ranking_reason: "reordered", comparison_basis: ["mission_fit"],
        recommended_action: "offer_founder_unlock",
      })),
    },
    summaries, requestedCount: 2,
  });

  const cmp = buildRankingShadowComparison({
    proposed, deterministic, summaries, requestedCount: 2,
  });
  // ONLY TWO ROWS SHIP, so the reordering is not cosmetic — it changes WHO the
  // user sees. That is the number the enforce decision turns on.
  assertEquals(cmp.delivered_window, 2);
  assertEquals(cmp.would_enter_delivery.sort(), ["c", "d"]);
  assertEquals(cmp.would_leave_delivery.sort(), ["a", "b"]);
  assertEquals(cmp.max_rank_delta, 3);

  // A ranker that returned nothing is stated as such, not as agreement.
  const none = buildRankingShadowComparison({
    proposed: null, deterministic, summaries, requestedCount: 2,
  });
  assertFalse(none.computed);
  assertEquals(none.would_enter_delivery, []);
  assertEquals(none.proposed_source, null);
});

// ══════════════════════ 59-62. the fingerprint is of the DISCOVERED set ══
//
// It used to be the mission hash, taken before discovery had run — so a
// continuation that discovered a different set under the same mission compared
// equal and the composition change was invisible.

Deno.test("59-60. the pool fingerprint is computed after discovery", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const seen: string[] = [];
  const out = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec, {
    onBatchComplete: ({ pool_fingerprint }) => { seen.push(pool_fingerprint); },
  })) }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget });

  const p = out.pool!;
  // It is the ELIGIBLE SET, not the mission.
  assertEquals(p.fingerprint, poolFingerprintOf(
    p.summaries.map((s) => s.company_key)));
  assert(p.fingerprint.startsWith("pool:"));
  assert(seen.length > 0, "the checkpoint callback is told which pool it evaluated");
  for (const f of seen) assertEquals(f, p.fingerprint, "one pool, one fingerprint");
  // Nothing was restored, so there is nothing to compare against — and that is
  // reported as unknown rather than as "unchanged".
  assertEquals(p.composition_changed, null);
});

Deno.test("61-62. a different discovered set under the same mission is flagged", async () => {
  const m = mission();
  const runWith = async (restoredPoolFingerprint: string | null) => {
    const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
    return (await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec, {
      restoredPoolFingerprint,
    })) }, { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget })).pool!;
  };

  // The same set the previous invocation evaluated ⇒ continuous.
  const baseline = await runWith(null);
  const same = await runWith(baseline.fingerprint);
  assertEquals(same.composition_changed, false);

  // A DIFFERENT set under the SAME mission — the case the mission hash cannot
  // see, because the mission did not change.
  const changed = await runWith(poolFingerprintOf(["someone", "else"]));
  assertEquals(changed.composition_changed, true,
    "the ranking describes a pool the restored verdicts did not come from");
});

Deno.test("63. the checkpoint carries both fingerprints and round-trips them", () => {
  const verification = {
    version: "grounded-claims-v1",
    classifier_result: { confidence: 0.9 },
    validated_claims: [], rejected_claims: [],
    grounding_score: 1, final_grounded_decision: "pass",
    downgrade_reasons: [], unacknowledged_conflicts: [],
  } as never;
  const discovered = poolFingerprintOf(["a", "b"]);
  const cp = buildPoolCheckpoint({
    missionHash: "mission-hash", discoveredPoolFingerprint: discovered,
    evaluated: [{ company_key: "a", verification }],
    next_offset: 1, accounting: {},
  });
  // The restore key is still the mission — it is all that can be checked before
  // discovery — and the discovered set rides alongside it.
  assertEquals(cp.pool_fingerprint, "mission-hash");
  assertEquals(cp.discovered_pool_fingerprint, discovered);

  const read = readPoolCheckpoint({ [POOL_EVAL_RESULT_KEY]: cp }, "mission-hash");
  assertEquals(read.results.size, 1);
  assertEquals(read.discoveredFingerprint, discovered);

  // A checkpoint written before this field existed is UNKNOWN, never "unchanged".
  const legacy = { ...cp } as Record<string, unknown>;
  delete legacy.discovered_pool_fingerprint;
  assertEquals(
    readPoolCheckpoint({ [POOL_EVAL_RESULT_KEY]: legacy }, "mission-hash")
      .discoveredFingerprint,
    null);
});

// ══════════════════════════════════════════ 42-50. safety & regression ══

Deno.test("42-46. routes still work and no people Actor becomes reachable", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rec, stage2Deps(rec)) }, {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN, readEnv: readBudget,
  });
  assert(rec.calls.includes("apify_yc_companies_memo23"), "the YC route still runs");
  for (const actor of [
    "apify_linkedin_company_employees", "apify_people_search",
    "apify_linkedin_profile_search",
  ]) {
    assertFalse(rec.calls.includes(actor), `${actor} must not run`);
  }
  assertFalse(buildCapabilityGraph(m).allowed_providers
    .includes("apify_linkedin_company_employees"));
});

Deno.test("47-50. run-agent wires Stage 2 server-side only", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(src.includes("buildPoolBinding"), "the binding is constructed");
  assert(src.includes("evaluateBatch: poolBinding.evaluateBatch"));
  assert(src.includes("batchLimits: poolBinding.limits"),
    "limits come from the server, never the body");
  // The restored verdicts now reach the engine through the round executor, so
  // rounds 2-3 restore them too. What matters is unchanged and asserted here:
  // they come from the server-side checkpoint, and round 1 is seeded with it.
  assert(src.includes("restoredGroundedResults: roundGrounded"),
    "the engine still receives restored verdicts");
  assert(src.includes("leadResumeRecords, restoredPoolResults)"),
    "round 1 is seeded from the verified server-side checkpoint");
  assert(src.includes("readPoolCheckpoint(resumeLoad.parentResult"),
    "the checkpoint is read from the VERIFIED parent row");
  assert(src.includes("workbench_pool"), "the ranked rows are persisted");
  // THE RANKER REACHES THE ENGINE IN BOTH MODES; the mode travels with it and
  // decides its authority there. Gating the function itself on enforce is what
  // made shadow compute nothing.
  assert(src.includes("rankingMode: poolBinding.rankingMode"),
    "the mode is passed, not used to withhold the ranker");
  assertFalse(src.includes('poolBinding.rankingMode === "enforce"'),
    "shadow must not be implemented by refusing to run the ranker");
  assert(src.includes("ranking_shadow_comparison"),
    "the shadow disagreement is persisted");
  assert(src.includes("restoredPoolFingerprint: poolRestore.discoveredFingerprint"),
    "the composition fingerprint is restored from the verified parent row");
  assert(src.includes("discoveredPoolFingerprint: pool_fingerprint"),
    "the checkpoint records the set that was actually discovered");
  // The client cannot supply any of it.
  assertFalse(src.includes("body.pool_summaries"));
  assertFalse(src.includes("body.ranked_candidates"));
  for (const line of src.split("\n")) {
    if (line.includes("ohsdatpvfdjdemstoiuj")) {
      assert(line.trim().startsWith("//"), "production ref only in a comment");
    }
  }
  assertFalse(/from\s+["'][^"']*\/mcp\//.test(src));
});
