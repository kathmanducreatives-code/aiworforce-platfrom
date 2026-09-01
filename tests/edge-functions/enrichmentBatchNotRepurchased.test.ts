// A BATCH ALREADY BOUGHT MUST NOT BE BOUGHT AGAIN ON THE NEXT SLICE.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Task ecb9afe9, 2026-09-01. Four ten-company enrichment batches were issued
// 8, 7, 5 and 4 times across ten slices — 51 real Apify runs where 31 were
// owed, roughly $0.80 of external spend on one mission.
//
// Three guards should have stopped it and all three were inert for THIS call:
//
//   `shouldSkipProviderCall`   needs an operationKey, which needs a `company`;
//                              the enrichment call is batched and passes none
//   `completed_operations`     written under the same condition, so the
//                              purchase was never even recorded
//   `deps.callCompleted`       supplied by tests only, never in production
//
// So the only thing deciding whether to re-buy was the `actionable` filter,
// and it asked about identity alone. The internal ledger deduplicated on
// `idempotency_key`, so no credit was double-charged and the waste was
// invisible from inside — Apify billed every run.
//
// ZERO network, ZERO DB, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runCapabilityPlan } from "../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../../supabase/functions/_shared/leadMission.ts";
import { stubMissionEvaluator } from "./_shared/missionEvaluatorFixture.ts";
import type { LeadMissionV1 } from "../../supabase/functions/_shared/leadMission.ts";
import type { CompiledActorCall } from "../../supabase/functions/_shared/hiringActorInputs.ts";

const CANONICAL =
  "Find B2B SaaS companies in the United Kingdom hiring sales representatives. " +
  "Return 5 qualified leads.";

const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(CANONICAL);
  return {
    ...m, requested_count: 5, known_companies: ["Anthropic", "Figma"],
    company_profile: { ...m.company_profile, employee_range: { min: 20, max: 200 } },
  };
};
const BRAIN = {
  employee_min: 20, employee_max: 200,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
} as never;

const row = (page: number, i: number) => ({
  companyName: `Co${page}_${i}`,
  linkedinUrl: `https://www.linkedin.com/company/co-${page}-${i}`,
  website: `https://co-${page}-${i}.com`,
  employeeCount: 60,
  description: `Co${page}_${i} is a B2B SaaS platform sold on subscription.`,
});

interface Call { actorKey: string; input: Record<string, unknown> }

/** A stable identity for one enrichment purchase: the URL set it asked for. */
const batchKey = (c: Call): string =>
  JSON.stringify([...(c.input.companies as string[] ?? [])].sort());

const slice = async (o: {
  state?: Record<string, unknown>;
  resumeRecords?: unknown[];
  /** Answer only this many of the URLs a batch asks for. */
  answerLimit?: number;
  /**
   * Carry a replenishment debt.
   *
   * ── WHY EVERY MULTI-SLICE TEST HERE NEEDS ONE ──────────────────────────
   *
   * A plain second slice finds `company_enrichment` in
   * `completed_capabilities` and skips it as `skipped_resumed`, so it makes no
   * enrichment call at all and cannot reproduce anything. Production re-entered
   * the stage because replenishment brought NEW companies and
   * `capabilityStillOwed` reopened it for them — and it was in that re-entry
   * that the already-enriched ones were dragged back in.
   */
  replenish?: { page: number };
}) => {
  const calls: Call[] = [];
  const result = await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      const input = (call as unknown as { input: Record<string, unknown> }).input ?? {};
      calls.push({ actorKey: call.actorKey, input });
      if (call.actorKey === "apify_linkedin_company_details") {
        // Echo back a row per requested URL, so the mapping-by-url succeeds.
        const urls = (input.companies as string[] ?? []);
        const answered = o.answerLimit === undefined
          ? urls : urls.slice(0, o.answerLimit);
        return Promise.resolve(answered.map((u, i) => ({
          linkedinUrl: u, name: `Co${i}`, website: `https://co-${i}.com`,
          employeeCount: 60,
          description: "A B2B SaaS platform sold on subscription.",
        })) as Record<string, unknown>[]);
      }
      // PAGE-DISTINCT, so a replenishment slice genuinely adds new companies —
      // which is the only shape in which enrichment is re-entered at all.
      const page = Number(input.startPage ?? 1);
      return Promise.resolve(
        Array.from({ length: 6 }, (_, i) => row(page, i)) as Record<string, unknown>[],
      );
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    evaluateMission: stubMissionEvaluator({ mission_fit: "pass" }),
    planDiscovery: () => Promise.resolve([{
      actor_key: "apify_linkedin_company_search", role: "primary",
      input: { searchQuery: "B2B SaaS", locations: ["United Kingdom"] },
    }]),
  } as never, {
    mission: mission(), plan: buildCapabilityGraph(mission() as never),
    brain: BRAIN, maxCandidates: 50, remainingLeads: 5, readEnv: () => undefined,
    ...(o.state ? { state: o.state } : {}),
    ...(o.resumeRecords
      ? {
        resume: {
          workspace_id: "ws-test", lineage_root_task_id: "lineage-test",
          records: o.resumeRecords,
        },
      }
      : {}),
    ...(o.replenish
      ? {
        discoveryReplenishment: {
          reason: "replenishment_required",
          pages_taken: { apify_linkedin_company_search: o.replenish.page },
          sources_attempted: ["apify_linkedin_company_search"],
        },
      }
      : {}),
  } as never);
  return { calls, result: result as unknown as { state: Record<string, unknown> } };
};

const enrichCalls = (c: Call[]) =>
  c.filter((x) => x.actorKey === "apify_linkedin_company_details");

Deno.test("an enrichment batch is never purchased twice across slices", async () => {
  const first = await slice({});
  const firstBatches = enrichCalls(first.calls).map(batchKey);
  assert(firstBatches.length > 0, "the first slice must enrich somebody");

  const records = (first.result as unknown as { resume_records?: unknown[] })
    .resume_records ?? [];

  // Three further slices over the same restored lineage — the shape that
  // produced 8 purchases of one batch in production.
  const seen = new Set(firstBatches);
  let reEntered = false;
  let state = first.result.state;
  let resumeRecords = records;
  for (let i = 0; i < 3; i++) {
    const next = await slice({ state, resumeRecords, replenish: { page: i + 1 } });
    for (const c of enrichCalls(next.calls)) {
      const k = batchKey(c);
      assert(!seen.has(k),
        `slice ${i + 2} re-purchased an enrichment batch already bought: ${k}`);
      seen.add(k);
    }
    reEntered = reEntered || enrichCalls(next.calls).length > 0;
    state = next.result.state;
    resumeRecords = (next.result as unknown as { resume_records?: unknown[] })
      .resume_records ?? resumeRecords;
  }
  assert(reEntered,
    "the test is vacuous unless a later slice actually re-enters enrichment");
});

Deno.test("an already-enriched company is not re-batched", async () => {
  const first = await slice({});
  const records = (first.result as unknown as { resume_records?: unknown[] })
    .resume_records ?? [];
  const enrichedUrls = new Set(
    enrichCalls(first.calls).flatMap((c) => c.input.companies as string[] ?? []),
  );
  assert(enrichedUrls.size > 0, "the first slice must enrich somebody");

  const second = await slice({
    state: first.result.state, resumeRecords: records, replenish: { page: 1 },
  });
  assert(enrichCalls(second.calls).length > 0,
    "the test is vacuous unless the second slice re-enters enrichment");
  for (const c of enrichCalls(second.calls)) {
    for (const u of (c.input.companies as string[] ?? [])) {
      assert(!enrichedUrls.has(u),
        `${u} was already enriched and must not be sent again`);
    }
  }
});

Deno.test("the first slice still enriches normally", async () => {
  // The filter must not become a way to enrich nobody.
  const r = await slice({});
  assert(enrichCalls(r.calls).length > 0, "enrichment must still happen");
  const state = r.result.state.capability_execution_state ?? r.result.state;
  assert(state, "the run must still produce execution state");
});

Deno.test("a partially answered batch does not re-buy the answered part", async () => {
  // ── THE RESIDUAL CASE THIS PINS ─────────────────────────────────────────
  //
  // In the production run every batch came back complete — ten asked, ten
  // returned — so the fix above was sufficient there. It is not sufficient by
  // construction: a company the actor does not answer for stays unenriched and
  // is legitimately retried. What must NOT happen is the ANSWERED companies
  // being dragged back into that retry, which would re-buy them.
  const first = await slice({ answerLimit: 2 });
  const answered = new Set(
    enrichCalls(first.calls).flatMap((c) =>
      ((c.input.companies as string[]) ?? []).slice(0, 2)),
  );
  assert(answered.size > 0, "some companies must be answered");

  const records = (first.result as unknown as { resume_records?: unknown[] })
    .resume_records ?? [];
  const second = await slice({
    state: first.result.state, resumeRecords: records, answerLimit: 2,
    replenish: { page: 1 },
  });
  for (const c of enrichCalls(second.calls)) {
    for (const u of (c.input.companies as string[] ?? [])) {
      assert(!answered.has(u),
        `${u} was answered on the first slice and must not be re-purchased`);
    }
  }
});
