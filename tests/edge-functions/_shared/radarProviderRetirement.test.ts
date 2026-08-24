// PHASE 3H — THE DUPLICATE RADAR PROVIDER PATHS ARE GONE, AND STAY GONE.
//
// ── WHAT WAS RETIRED, AND WHY EACH ──────────────────────────────────────────
//
// A SECOND APIFY STACK FOR JOBS. `radarSources/apifyJobsHiringSource.ts` ran its
// own LinkedIn-Jobs actor, with its own normalizer and its own recruiter-proxy
// regex, to answer a question the shared capability engine already answers. The
// engine's version is better, not merely shared: `companyAggregatorEvidence`
// refuses a staffing proxy on EVIDENCE rather than on the company's name.
//
// A WEB SEARCH FOR HIRING AND FUNDING. Radar's Firecrawl fallback could resolve
// neither company identity nor role family, which is exactly why
// `mapRadarSignalToV2` refuses a `hiring` or `funding` row: it could not be
// given an honest subject, so it never reached `signal_events` — and since
// Phase 3G it never reaches the feed. It was spend on a question whose answer
// was thrown away.
//
// ── WHAT WAS DELIBERATELY KEPT ──────────────────────────────────────────────
//
// Everything Radar is still the only thing that does. There is no capability
// that searches the web for market discussion, so `linkedin_intent`,
// `competitor` and `workflow_trend` stay — and with them the ICP scorer, the
// staged query widening, the freshness reasoning, the dedupe and the Company
// Brain context that drive them.
//
// Radar's OTHER Apify adapters — posts, comments, people — are NOT touched.
// They feed the Signals surface, and no capability has been proven to replace
// them. Retiring a path before its replacement is proven is the mistake this
// phase exists to avoid, and doing it quietly would be worse.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildRadarScanPlan } from "../../../supabase/functions/_shared/radarScanPlanner.ts";
import { compileCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { mapRadarSignalToV2 } from "../../../supabase/functions/_shared/radarSignalToV2.ts";

const RADAR_SCAN = await Deno.readTextFile(
  new URL("../../../supabase/functions/run-radar-scan/index.ts", import.meta.url),
);

const brain = () =>
  compileCompanyBrainContext({
    workspace_id: "ws",
    profile: {
      company: { name: "Agentory", stage: "seed", location: "United States", category: "B2B SaaS" },
      gtm: { motion: "outbound" },
      icp: { industries: ["B2B SaaS"], geography: "United States", company_size: "10-200" },
      competitors: { known: ["Clay", "Apollo"] },
      signal_preferences: { workflow_topics: ["outbound automation"], linkedin_topics: ["founder-led sales"] },
    },
  });

const planFor = (source: string) =>
  buildRadarScanPlan(brain(), { firecrawlReady: true, apifyReady: true })
    .source_plan.find((p) => p.source === source)!;

Deno.test("1. the second Apify stack is deleted, not merely unreferenced", async () => {
  await Deno.stat(
    new URL("../../../supabase/functions/_shared/radarSources/apifyJobsHiringSource.ts", import.meta.url),
  ).then(
    () => { throw new Error("the duplicate Apify hiring adapter still exists"); },
    () => {/* absent, as intended */},
  );
  // And nothing imports it — a dangling import would fail the deploy bundle,
  // which is how this was found in the first place.
  assertFalse(RADAR_SCAN.includes("apifyJobsHiringSource"));
  assertFalse(RADAR_SCAN.includes("fetchApifyJobs"));
  assertFalse(RADAR_SCAN.includes("buildApifyJobsInput"));
  assertFalse(RADAR_SCAN.includes("apifyRowsToScoredItems"));
});

Deno.test("2. Radar runs no jobs actor, and the retired code cannot come back", () => {
  // NARROW ON PURPOSE. Radar still drives Apify for posts, comments and people
  // — surfaces no capability has been proven to replace — so "Radar starts no
  // Actor" would be false, and asserting it would be a claim this phase has not
  // earned. What IS true is that no path from a Radar scan reaches a JOBS
  // actor, which is the duplicate the capability engine replaces.
  const jobsActorMarkers = [
    "linkedin-job-search", "apify_linkedin_job_search", "RADAR_ENABLE_APIFY_JOBS",
  ];
  const code = RADAR_SCAN
    // Comments explain the retirement and may name what was retired.
    .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  for (const m of jobsActorMarkers) {
    assertFalse(
      code.includes(m),
      `run-radar-scan still reaches a jobs actor via ${m}`,
    );
  }
});

Deno.test("3. hiring and funding are off whatever the providers can do", () => {
  for (const retired of ["hiring", "funding"]) {
    const p = planFor(retired);
    assertEquals(p.enabled, false, `${retired} must stay retired`);
    assert(/retired in phase 3h/i.test(p.reason), p.reason);
    assert(/capability engine/i.test(p.reason), `${retired} must say what collects it now`);
  }
});

Deno.test("4. the sources Radar is still the only thing that does are untouched", () => {
  // No capability searches the web for market discussion. Retiring these would
  // delete a capability, not a duplicate.
  for (const kept of ["linkedin_posts", "competitor", "workflow_trends"]) {
    const p = planFor(kept);
    assertEquals(p.enabled, true, `${kept} must still run`);
    assert(p.queries.length > 0, `${kept} must still carry Brain-derived queries`);
    assertFalse(/retired/i.test(p.reason), `${kept} is not retired`);
  }
});

Deno.test("5. the retirement matches what the canonical store would accept anyway", () => {
  // The store refuses a Radar hiring or funding row because it cannot be given
  // an honest subject. Retiring the collection is the same decision, made one
  // step earlier and without the spend.
  for (const t of ["hiring", "funding"]) {
    const r = mapRadarSignalToV2(
      { id: "r1", workspace_id: "ws", signal_type: t, title: "x", raw: {} },
      "manual_scan", "2026-08-24T00:00:00Z",
    );
    assertEquals(r.ok, false);
    assertEquals(r.reason, "unsupported_signal_type");
  }
  // While a market row is accepted, which is why that path stays.
  const kept = mapRadarSignalToV2(
    { id: "r2", workspace_id: "ws", signal_type: "linkedin_intent", title: "x", raw: {} },
    "manual_scan", "2026-08-24T00:00:00Z",
  );
  assertEquals(kept.ok, true);
});

Deno.test("6. the Radar pieces worth keeping are still wired", async () => {
  // ICP scoring, staged widening, dedupe, Company Brain context, diagnostics.
  for (const kept of [
    // The scorer reaches the scan through the pipeline, which is where it
    // belongs — the scan does not score candidates itself.
    "radarCandidatePipeline", "radarScanPlanner",
    "companyBrainCompiler", "buildSourceDiagnostics",
  ]) {
    assert(RADAR_SCAN.includes(kept), `${kept} must survive the retirement`);
  }
  const pipeline = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/radarCandidatePipeline.ts", import.meta.url),
  );
  assert(pipeline.includes("icpSignalScorer"), "the ICP scorer must survive the retirement");
});
