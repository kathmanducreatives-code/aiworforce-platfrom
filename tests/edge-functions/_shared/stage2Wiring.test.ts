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
  validatePoolRanking,
} from "../../../supabase/functions/_shared/poolRanking.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

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

async function run(over: Partial<CapabilityEngineDeps>) {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const out = await runCapabilityPlan(deps(rec, over), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
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
  const on = await runCapabilityPlan(deps(rec, stage2Deps(rec)), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
  });
  assert(on.pool, "Stage 2 produced a pool");
  assertEquals(on.pool!.eligible.discovered, N);
});

Deno.test("3-5. free gates run before any model call, and batches stay bounded", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const out = await runCapabilityPlan(deps(rec, stage2Deps(rec)), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
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
  const out = await runCapabilityPlan(deps(rec, stage2Deps(rec)), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
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
  const out = await runCapabilityPlan(deps(rec, {
    batchLimits: resolveBatchLimits({ batch_size: 8 }),
    groundingMode: "enforce",
    evaluateBatch: (batch) => Promise.resolve(
      evaluateBatchResponse({ batch, raw: respond(batch, { invented: "co0.com" }) })),
  }), { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN });

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
  const out = await runCapabilityPlan(deps(rec, stage2Deps(rec, {
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
  })), { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN });
  assertEquals(sawSummaries, out.pool!.summaries.length);
  assert(sawSummaries > 10);
});

// ══════════════════════════════════════════ 11-18. checkpoint and resume ══

Deno.test("11-14. completed batches checkpoint, and a continuation restores them", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const checkpoints: number[] = [];
  const m = mission();
  const first = await runCapabilityPlan(deps(rec, stage2Deps(rec, {
    onBatchComplete: ({ evaluated, next_offset }) => {
      checkpoints.push(evaluated.length);
      assertEquals(next_offset, evaluated.length);
    },
  })), { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN });
  assert(checkpoints.length >= 2, "a checkpoint per completed batch");
  assert(checkpoints[checkpoints.length - 1] > 10);

  // Continue: every completed company is RESTORED, not re-evaluated.
  const restored = new Map(
    first.pool!.summaries.map((s) => [
      s.company_key,
      first.companies.find((c) => c.key === s.company_key)!.grounded!,
    ]));
  const rec2: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const second = await runCapabilityPlan(deps(rec2, {
    batchLimits: resolveBatchLimits({ batch_size: 8 }),
    restoredGroundedResults: restored,
    evaluateBatch: (batch) => {
      rec2.batches.push(batch.length);
      return Promise.resolve(evaluateBatchResponse({ batch, raw: respond(batch) }));
    },
  }), { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN });

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
  const out = await runCapabilityPlan(deps(rec, stage2Deps(rec, {
    rankPool: () => Promise.reject(new Error("ranker down")),
  })), { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN })
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
  const out = await runCapabilityPlan(deps(rec, stage2Deps(rec)), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
  });
  assertEquals(out.pool!.ranking.ranking_source, "deterministic_fallback");
  assert(out.pool!.ranking.fallback_reason);
  assertEquals(out.pool!.ranking.ranked.length, out.pool!.summaries.length);
});

Deno.test("29-35. code keeps decision-class authority and reports honestly", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  const out = await runCapabilityPlan(deps(rec, stage2Deps(rec)), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
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
  const out = await runCapabilityPlan(deps(rec, stage2Deps(rec, {
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
  })), { mission: m, plan: buildCapabilityGraph(m), brain: BRAIN });

  const byKey = new Map(out.pool!.summaries.map((s) => [s.company_key, s]));
  let lastClass = -1;
  for (const r of out.pool!.ranking.ranked) {
    const cls = { qualified: 0, review: 1, reject: 2 }[byKey.get(r.company_key)!.brain_decision];
    assert(cls >= lastClass, "decision classes never invert");
    lastClass = cls;
  }
});

// ══════════════════════════════════════════ 42-50. safety & regression ══

Deno.test("42-46. routes still work and no people Actor becomes reachable", async () => {
  const rec: Rec = { calls: [], batches: [], groundedCalls: 0 };
  const m = mission();
  await runCapabilityPlan(deps(rec, stage2Deps(rec)), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
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
  assert(src.includes("restoredGroundedResults: restoredPoolResults"));
  assert(src.includes("readPoolCheckpoint(resumeLoad.parentResult"),
    "the checkpoint is read from the VERIFIED parent row");
  assert(src.includes("workbench_pool"), "the ranked rows are persisted");
  // Ranking only reaches the engine in enforce.
  assert(src.includes('poolBinding.rankingMode === "enforce"'));
  // The client cannot supply any of it.
  assertFalse(src.includes("body.pool_summaries"));
  assertFalse(src.includes("body.ranked_candidates"));
  for (const line of src.split("\n")) {
    if (line.includes("wqnigjhcwjxtmordrwno")) {
      assert(line.trim().startsWith("//"), "production ref only in a comment");
    }
  }
  assertFalse(/from\s+["'][^"']*\/mcp\//.test(src));
});
