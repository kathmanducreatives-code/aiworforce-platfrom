// Deterministic tests for the Brain-driven Radar execution module. NO live provider
// calls — the Firecrawl search function is injected and records every query.

// NOTE (Phase 3H): these tests exercise the GENERIC execution behaviour —
// negative terms, geography retention, staged widening, provider refusals — and
// used `hiring` merely as a valid plan shape to carry it. `hiring` and `funding`
// are retired: the shared capability engine collects both, and Radar's
// web-search versions could not establish company identity, so their rows never
// reached the canonical store. The vehicle is now `linkedin_posts`, a source
// Radar still owns. Nothing about what these tests protect has changed.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { buildRadarScanPlan, type RadarSource } from "../../../supabase/functions/_shared/radarScanPlanner.ts";
import { buildFirecrawlQuery, runFirecrawlSource, type FirecrawlSearchFn } from "../../../supabase/functions/_shared/radarSourceExecution.ts";
import type { FirecrawlHit } from "../../../supabase/functions/_shared/radarCandidatePipeline.ts";

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
    // `{ hits, error }`, not a bare array.
    //
    // The search contract widened so a provider REFUSAL stops being
    // indistinguishable from an empty market — the shape that let ninety
    // Firecrawl 429s report as `raw_count: 0` with no error on 2026-08-23.
    // A stub that returns success now has to say so.
    return Promise.resolve({ hits, error: null });
  };
}

/** A provider that refuses every call, for the failure paths. */
function refusingSearch(error: string, record: string[]): FirecrawlSearchFn {
  return (query: string, _limit: number) => {
    record.push(query);
    return Promise.resolve({ hits: [], error });
  };
}

Deno.test("exec-1. setup_required → ZERO provider calls (no generic search leak)", async () => {
  const emptyBrain = compileCompanyBrainContext({ workspace_id: "ws", profile: {} });
  assertEquals(emptyBrain.meta.setup_required, true);
  const { src } = planSource(saasBrain(), "linkedin_posts"); // borrow a valid plan shape
  const calls: string[] = [];
  const res = await runFirecrawlSource({
    plan: src, wanted: 5, search: stubSearch(5, calls), scanPlanReason: "r", setupRequired: true,
  });
  assertEquals(calls.length, 0, "no provider calls when setup_required");
  assertEquals(res.status, "setup_needed");
  assertEquals(res.items.length, 0);
});

Deno.test("exec-2. disqualifiers are appended to every executed query as -\"term\"", async () => {
  const { src } = planSource(saasBrain(), "linkedin_posts");
  const calls: string[] = [];
  await runFirecrawlSource({ plan: src, wanted: 5, search: stubSearch(2, calls), scanPlanReason: "r", setupRequired: false });
  assert(calls.length > 0);
  assert(calls.every((q) => /-"/.test(q)), "each query carries at least one negative exclusion");
  assert(calls.some((q) => /-"staffing"|-"recruiting agency"/i.test(q)), `expected staffing exclusion in ${calls[0]}`);
});

// exec-3 IS GONE WITH THE PATH IT TESTED (Phase 3H).
//
// It asserted that an explicit geography survives into the executed query, and
// it could only assert that through the HIRING query builder — geography is a
// property of a query looking for companies, and `linkedin_posts` queries look
// for topics. Hiring is retired here.
//
// The property is not lost; it moved to where hiring now happens.
// `identitySearchLocations` puts the mission's declared geography into the
// identity search and `compileHarvestCompanySearchInput` validates it, which
// `companyLinkedIn.test.ts` asserts directly. Keeping a test here would keep a
// retired query builder alive to satisfy it.

Deno.test("exec-4. staged widening — few results escalates past the exact tier", async () => {
  const { src } = planSource(saasBrain(), "linkedin_posts");
  const calls: string[] = [];
  // 0 hits per call → never satisfies `wanted`, so it must exhaust all non-empty stages.
  const res = await runFirecrawlSource({ plan: src, wanted: 5, search: stubSearch(0, calls), scanPlanReason: "r", setupRequired: false });
  assert(res.stages_used >= 2, `expected escalation, got stages_used=${res.stages_used}`);
});

Deno.test("exec-5. enough results in the exact tier → does NOT widen", async () => {
  const { src } = planSource(saasBrain(), "linkedin_posts");
  const calls: string[] = [];
  // Plenty of hits per call → satisfied within stage 1.
  const res = await runFirecrawlSource({ plan: src, wanted: 3, search: stubSearch(20, calls), scanPlanReason: "r", setupRequired: false });
  assertEquals(res.stages_used, 1, "should stop after the exact tier when it has enough");
});

Deno.test("exec-6. disabled source or wanted<=0 → skipped, no calls", async () => {
  const { src } = planSource(saasBrain(), "linkedin_posts");
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

// ═══ PROVIDER REFUSAL IS NOT AN EMPTY MARKET ═══════════════════════════════

Deno.test("exec-9. a refused source reports the provider error and is not `ready`", async () => {
  const { src } = planSource(saasBrain(), "linkedin_posts");
  const calls: string[] = [];
  const res = await runFirecrawlSource({
    plan: src, wanted: 5, search: refusingSearch("http_429", calls),
    scanPlanReason: "r", setupRequired: false,
  });
  assertEquals(res.found, 0);
  assertEquals(res.provider_error, "http_429");
  assert(res.provider_failures > 0);
  assertEquals(res.status, "skipped",
    "`ready` with found:0 is what made 90 refusals look like a quiet market");
});

Deno.test("exec-10. an honestly empty search stays `ready` with no error", async () => {
  const { src } = planSource(saasBrain(), "linkedin_posts");
  const res = await runFirecrawlSource({
    plan: src, wanted: 5, search: stubSearch(0, []), scanPlanReason: "r", setupRequired: false,
  });
  assertEquals(res.found, 0);
  assertEquals(res.provider_error, null, "nothing refused us — the market is quiet");
  assertEquals(res.status, "ready");
});
