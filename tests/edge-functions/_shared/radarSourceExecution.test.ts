// Deterministic tests for the Brain-driven Radar execution module. NO live provider
// calls — the Firecrawl search function is injected and records every query.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileCompanyBrainContext } from "../../supabase/functions/_shared/companyBrainCompiler.ts";
import { buildRadarScanPlan, type RadarSource } from "../../supabase/functions/_shared/radarScanPlanner.ts";
import { buildFirecrawlQuery, runFirecrawlSource, type FirecrawlSearchFn } from "../../supabase/functions/_shared/radarSourceExecution.ts";
import type { FirecrawlHit } from "../../supabase/functions/_shared/radarCandidatePipeline.ts";

function saasBrain(extra: Record<string, unknown> = {}) {
  return compileCompanyBrainContext({
    workspace_id: "wsA",
    profile: {
      company: { category: "AI SaaS", description: "AI workforce OS for B2B SaaS founders" },
      icp: {
        buyer_roles: ["Founder", "RevOps", "SDR"], company_size: "10-150 employees",
        industries: ["B2B SaaS", "AI SaaS"], geography: "United States",
        disqualifiers: ["staffing", "recruiting agency"], pain_points: ["pipeline before hiring"],
      },
      competitors: { known: ["Clay", "Apollo"] },
      ...extra,
    },
    signal_preferences: { workflow_topics: ["outbound automation"], linkedin_topics: ["founder-led sales"] },
  });
}

function planSource(brain: ReturnType<typeof saasBrain>, source: RadarSource) {
  const plan = buildRadarScanPlan(brain, { firecrawlReady: true, apifyReady: false });
  return { plan, src: plan.source_plan.find((p) => p.source === source)! };
}

/** A search stub that records queries and returns a fixed number of hits per call. */
function stubSearch(hitsPerCall: number, record: string[]): FirecrawlSearchFn {
  return (query: string, _limit: number) => {
    record.push(query);
    const hits: FirecrawlHit[] = Array.from({ length: hitsPerCall }, (_v, i) => ({
      url: `https://acme${i}.com/jobs/1`, title: `Acme ${i} is hiring a RevOps lead`, description: "B2B SaaS company scaling revenue",
    }));
    return Promise.resolve(hits);
  };
}

Deno.test("exec-1. setup_required → ZERO provider calls (no generic search leak)", async () => {
  const emptyBrain = compileCompanyBrainContext({ workspace_id: "ws", profile: {} });
  assertEquals(emptyBrain.meta.setup_required, true);
  const { src } = planSource(saasBrain(), "hiring"); // borrow a valid plan shape
  const calls: string[] = [];
  const res = await runFirecrawlSource({
    plan: src, wanted: 5, search: stubSearch(5, calls), scanPlanReason: "r", setupRequired: true,
  });
  assertEquals(calls.length, 0, "no provider calls when setup_required");
  assertEquals(res.status, "setup_needed");
  assertEquals(res.items.length, 0);
});

Deno.test("exec-2. disqualifiers are appended to every executed query as -\"term\"", async () => {
  const { src } = planSource(saasBrain(), "hiring");
  const calls: string[] = [];
  await runFirecrawlSource({ plan: src, wanted: 5, search: stubSearch(2, calls), scanPlanReason: "r", setupRequired: false });
  assert(calls.length > 0);
  assert(calls.every((q) => /-"/.test(q)), "each query carries at least one negative exclusion");
  assert(calls.some((q) => /-"staffing"|-"recruiting agency"/i.test(q)), `expected staffing exclusion in ${calls[0]}`);
});

Deno.test("exec-3. explicit geography is retained in the executed queries", async () => {
  const { src } = planSource(saasBrain(), "hiring");
  const calls: string[] = [];
  await runFirecrawlSource({ plan: src, wanted: 5, search: stubSearch(2, calls), scanPlanReason: "r", setupRequired: false });
  assert(calls.some((q) => /United States/i.test(q)), `geography missing from ${JSON.stringify(calls)}`);
});

Deno.test("exec-4. staged widening — few results escalates past the exact tier", async () => {
  const { src } = planSource(saasBrain(), "hiring");
  const calls: string[] = [];
  // 0 hits per call → never satisfies `wanted`, so it must exhaust all non-empty stages.
  const res = await runFirecrawlSource({ plan: src, wanted: 5, search: stubSearch(0, calls), scanPlanReason: "r", setupRequired: false });
  assert(res.stages_used >= 2, `expected escalation, got stages_used=${res.stages_used}`);
});

Deno.test("exec-5. enough results in the exact tier → does NOT widen", async () => {
  const { src } = planSource(saasBrain(), "hiring");
  const calls: string[] = [];
  // Plenty of hits per call → satisfied within stage 1.
  const res = await runFirecrawlSource({ plan: src, wanted: 3, search: stubSearch(20, calls), scanPlanReason: "r", setupRequired: false });
  assertEquals(res.stages_used, 1, "should stop after the exact tier when it has enough");
});

Deno.test("exec-6. disabled source or wanted<=0 → skipped, no calls", async () => {
  const { src } = planSource(saasBrain(), "hiring");
  const calls: string[] = [];
  const res = await runFirecrawlSource({ plan: src, wanted: 0, search: stubSearch(5, calls), scanPlanReason: "r", setupRequired: false });
  assertEquals(res.status, "skipped");
  assertEquals(calls.length, 0);
});

Deno.test("exec-7. buildFirecrawlQuery caps and formats negatives", () => {
  const q = buildFirecrawlQuery("B2B SaaS hiring", ["staffing", "recruiting", "pharma", "lab", "chemical", "packaging"]);
  assert(q.startsWith("B2B SaaS hiring "));
  assertEquals((q.match(/-"/g) ?? []).length, 4, "negatives capped at 4");
  assertEquals(buildFirecrawlQuery("x", []), "x", "no negatives → base unchanged");
});
