import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { buildRadarScanPlan, type RadarSource } from "../../../supabase/functions/_shared/radarScanPlanner.ts";

const agentory = compileCompanyBrainContext({
  workspace_id: "ws",
  profile: {
    company: { category: "AI SaaS", description: "AI workforce OS for founders building B2B pipeline" },
    icp: { buyer_roles: ["Founder", "RevOps"], company_size: "10-150 employees", industries: ["B2B SaaS", "AI SaaS"], pain_points: ["pipeline before hiring"], disqualifiers: ["manufacturing", "hospital"] },
    gtm: { motion: "founder-led sales" },
    competitors: { known: ["Clay", "Apollo"], adjacent: ["Instantly"] },
  },
  signal_preferences: { hiring_roles: ["Founding Account Executive", "RevOps"], linkedin_topics: ["founder-led sales", "hiring SDRs too early"], workflow_topics: ["outbound automation"] },
});
const empty = compileCompanyBrainContext({ workspace_id: "ws", profile: {} });

function plan(brain = agentory, opts = {}) { return buildRadarScanPlan(brain, opts); }
function src(p: ReturnType<typeof plan>, s: RadarSource) { return p.source_plan.find((x) => x.source === s)!; }

Deno.test("1. Agentory-style Brain creates SaaS/revenue hiring queries", () => {
  const h = src(plan(), "hiring");
  assert(h.queries.length > 0);
  assert(h.queries.some((q) => /saas/i.test(q)));
  assert(h.queries.some((q) => /Founding Account Executive|RevOps/i.test(q)));
});

Deno.test("2. disqualifiers appear in negative terms", () => {
  const h = src(plan(), "hiring");
  assert(h.negative_terms.some((n) => n.toLowerCase() === "manufacturing"));
  assert(h.negative_terms.some((n) => n.toLowerCase() === "hospital"));
});

Deno.test("3. weak Brain → warning + conservative (low-cap) query set", () => {
  const weakBrain = compileCompanyBrainContext({ workspace_id: "ws", profile: { company: { description: "B2B SaaS platform" } } });
  const p = plan(weakBrain);
  assertEquals(p.brain_confidence, "weak");
  assert(p.warnings.length > 0);
  const h = src(p, "hiring");
  assert(h.cap <= 5, `weak hiring cap ${h.cap}`);
});

Deno.test("3b. setup_required Brain → setup_required plan, warning, conservative caps", () => {
  const setupBrain = compileCompanyBrainContext({ workspace_id: "ws", profile: { company: { category: "B2B SaaS" }, icp: { industries: ["B2B SaaS"], company_size: "10-150" } } });
  assertEquals(setupBrain.meta.setup_required, true);
  const p = plan(setupBrain);
  assertEquals(p.setup_required, true);
  assert(p.warnings.some((w) => /company brain incomplete/i.test(w)));
  const h = src(p, "hiring");
  assert(h.cap <= 5, `setup hiring cap ${h.cap}`);
});

Deno.test("4. competitor watchlist becomes an enabled competitor source plan", () => {
  const c = src(plan(), "competitor");
  assert(c.enabled);
  assert(c.queries.some((q) => /Clay|Apollo/i.test(q)));
});

Deno.test("5. content topics become LinkedIn/workflow source plans", () => {
  const posts = src(plan(), "linkedin_posts");
  const wf = src(plan(), "workflow_trends");
  assert(posts.queries.some((q) => /founder-led sales|hiring SDRs too early/i.test(q)));
  assert(wf.queries.some((q) => /outbound automation|hiring SDRs too early|pipeline/i.test(q)));
});

Deno.test("6. caps are enforced per source", () => {
  const p = plan();
  for (const s of p.source_plan) {
    assert(s.cap <= 30, `${s.source} cap ${s.cap}`);
    assert(s.queries.length <= 6, `${s.source} query count ${s.queries.length}`);
  }
  assertEquals(src(p, "hiring").cap, 10);
  assertEquals(src(p, "linkedin_comments").cap, 30);
});

Deno.test("7. apify-only sources are disabled without Apify, and retired sources stay off", () => {
  const p = plan(agentory, { firecrawlReady: true, apifyReady: false });
  assertEquals(src(p, "linkedin_comments").enabled, false); // no fallback

  // ── PHASE 3H ────────────────────────────────────────────────────────────
  //
  // This asserted the opposite: hiring stayed runnable on a Firecrawl fallback.
  // That fallback searched the WEB for hiring and could resolve neither company
  // identity nor role family, which is why `mapRadarSignalToV2` refuses a
  // `hiring` row — it never reached the canonical store, and since Phase 3G it
  // never reaches the feed. The shared capability engine collects hiring by
  // resolving the company and reading real postings.
  //
  // A retired source is OFF whatever the providers can do, so this asserts it
  // under the configuration that used to enable it.
  for (const retired of ["hiring", "funding"] as const) {
    assertEquals(src(p, retired).enabled, false, `${retired} must stay retired`);
  }
  const withEverything = plan(agentory, { firecrawlReady: true, apifyReady: true });
  for (const retired of ["hiring", "funding"] as const) {
    assertEquals(
      src(withEverything, retired).enabled, false,
      `${retired} must stay retired even with every provider ready`,
    );
  }
});

Deno.test("7b. a retired source still explains itself", () => {
  // Deleting the plan entry would make the source vanish from the diagnostics.
  // "We stopped doing this, and here is why" is what a reader needs.
  const p = plan();
  for (const retired of ["hiring", "funding"] as const) {
    const entry = src(p, retired);
    assert(/retired in phase 3h/i.test(entry.reason), `${retired}: ${entry.reason}`);
    assert(
      /capability engine/i.test(entry.reason),
      `${retired} must name what collects it now`,
    );
  }
});

Deno.test("8. every source plan has a Brain-derived reason", () => {
  const p = plan();
  for (const s of p.source_plan) assert(s.reason.trim().length > 10, `${s.source} reason`);
  // enabled sources with queries reference the Brain. `hiring` was the example
  // and is retired; `competitor` is a live source whose reason is Brain-derived.
  assert(src(p, "competitor").reason.toLowerCase().includes("company brain"));
});

Deno.test("9. no provider run happens — plan is data only (no source_url/results)", () => {
  const p = plan();
  // sanity: plan carries queries + caps, not fetched results
  assert(!("results" in (p as unknown as Record<string, unknown>)));
  assertEquals(p.workspace_id, "ws");
});
