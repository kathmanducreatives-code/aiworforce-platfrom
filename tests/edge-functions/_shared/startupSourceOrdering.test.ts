// CHANGESET 3 PROOF — startup-aware source order and verified provider inputs.

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  orderDiscoverySources, scoreDiscoverySources, buildSourcePlan,
  deriveSourceOrderingSignals, type SourceOrderingSignals,
} from "../../../supabase/functions/_shared/leadSourceOrdering.ts";
import { deterministicLeadStrategy } from "../../../supabase/functions/_shared/leadStrategyValidator.ts";
import { REVENUE_OPS_FAMILY } from "../../../supabase/functions/_shared/leadRoleTaxonomy.ts";
import { compileHiringSourceInput } from "../../../supabase/functions/_shared/actorInputPlanner.ts";
import type { LeadStrategyMission, LeadStrategyRoundContext } from "../../../supabase/functions/_shared/leadStrategyContract.ts";

const BASE: SourceOrderingSignals = {
  startupIntent: false,
  businessModel: null,
  employeeMin: null,
  employeeMax: null,
  geography: "United States",
  roleFamilyKey: "revenue_operations",
  attemptedSources: [],
  unusedQueryPacks: [],
  sourceQuality: {},
};

// ------------------------------------------------------------ source order ---

Deno.test("startup fixture chooses YC first", () => {
  const order = orderDiscoverySources({
    ...BASE, startupIntent: true, businessModel: "saas", employeeMax: 200,
  });
  assertEquals(order, ["yc_jobs", "linkedin_jobs", "indeed_jobs", "glassdoor_jobs"]);
});

Deno.test("non-startup fixture is NOT forced to choose YC first", () => {
  const order = orderDiscoverySources({
    ...BASE, startupIntent: false, businessModel: "enterprise software", employeeMin: 1000,
  });
  assert(order[0] !== "yc_jobs", `expected a non-YC first source, got ${order[0]}`);
  assertEquals(order.length, 4, "no approved source is dropped");
});

Deno.test("the order is derived from the query, not hardcoded", () => {
  const startup = orderDiscoverySources({ ...BASE, startupIntent: true });
  const enterprise = orderDiscoverySources({ ...BASE, employeeMin: 5000 });
  assert(JSON.stringify(startup) !== JSON.stringify(enterprise), "ordering ignored the signals");
});

Deno.test("observed source quality outranks the static priors", () => {
  const order = orderDiscoverySources({
    ...BASE, startupIntent: true, sourceQuality: { yc_jobs: -1, indeed_jobs: 1 },
  });
  assert(order.indexOf("indeed_jobs") < order.indexOf("yc_jobs"), "bad prior quality was ignored");
});

Deno.test("already-attempted sources sink to the end but are never dropped", () => {
  const order = orderDiscoverySources({ ...BASE, startupIntent: true, attemptedSources: ["yc_jobs"] });
  assertEquals(order[order.length - 1], "yc_jobs");
  assertEquals(new Set(order).size, 4);
});

Deno.test("ATS is never schedulable as a discovery source", () => {
  for (const s of orderDiscoverySources({ ...BASE })) {
    assertFalse(/ats|greenhouse|lever|ashby/.test(s));
  }
});

Deno.test("every ordering decision is explainable", () => {
  for (const s of scoreDiscoverySources({ ...BASE, startupIntent: true })) {
    assert(s.reasons.length > 0, `${s.source} produced no reasons`);
  }
  assert(buildSourcePlan({ ...BASE }).every((p) => p.rationale.length > 0));
});

// ------------------------------------------------- deterministic fallback ---

function mission(over: Partial<LeadStrategyMission> = {}): LeadStrategyMission {
  return {
    original_query: "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.",
    requested_lead_count: 5,
    requested_titles: ["Sales Operations"],
    decision_maker_roles: ["Founder", "CEO"],
    geography: "United States",
    company_vertical: "saas",
    company_size: { min: 1, max: 200 },
    maturity_stages: ["seed", "series a"],
    ...over,
  };
}

const ctx = (over: Partial<LeadStrategyRoundContext> = {}): LeadStrategyRoundContext => ({
  round: 1,
  bottleneck: null,
  last_funnel: null,
  attempted_query_packs: [],
  attempted_sources: [],
  remaining_quota: 5,
  remaining_budget_usd: 5,
  adjacent_titles_allowed: false,
  ...over,
});

Deno.test("deterministic strategy puts YC first for the startup fixture", () => {
  const plan = deterministicLeadStrategy(mission(), ctx(), REVENUE_OPS_FAMILY);
  assertEquals(plan.source_plan[0].source_key, "yc_jobs");
  assertEquals(plan.source_plan.map((s) => s.priority), [1, 2, 3, 4]);
});

Deno.test("deterministic strategy does not put YC first for a large-enterprise mission", () => {
  const plan = deterministicLeadStrategy(
    mission({
      original_query: "Find VPs of Revenue Operations at large enterprises in the United States",
      company_vertical: "enterprise",
      company_size: { min: 5000, max: 50000 },
      maturity_stages: ["public"],
    }),
    ctx(),
    REVENUE_OPS_FAMILY,
  );
  assert(plan.source_plan[0].source_key !== "yc_jobs");
});

Deno.test("query packs stay separate in the deterministic plan", () => {
  const plan = deterministicLeadStrategy(mission(), ctx({ round: 3, adjacent_titles_allowed: true }), REVENUE_OPS_FAMILY);
  const ids = plan.query_packs.map((p) => p.pack_id);
  assertEquals(new Set(ids).size, ids.length, "duplicate pack ids");
  const sigs = plan.query_packs.map((p) => p.queries.slice().sort().join("|"));
  assert(new Set(sigs).size >= 2, "packs collapsed into one intent");
});

// ------------------------------------------------------- provider payloads ---

Deno.test("Indeed emits a verified non-empty datePosted when recency is requested", async () => {
  const r = await compileHiringSourceInput({
    capability: "indeed_job_discovery",
    titleAliases: ["Sales Operations"],
    geography: "United States",
    postingWindowDays: 7,
    candidateTarget: 25,
  });
  if (!r.ok) throw new Error(`indeed compile refused: ${r.reason}`);
  assertEquals(r.input.datePosted, "7");
  assert(String(r.input.datePosted).length > 0);
});

Deno.test("Indeed never sends an empty-string datePosted", async () => {
  const r = await compileHiringSourceInput({
    capability: "indeed_job_discovery",
    titleAliases: ["Sales Operations"],
    geography: "United States",
    postingWindowDays: null,
    candidateTarget: 25,
  });
  if (!r.ok) throw new Error(`indeed compile refused: ${r.reason}`);
  assertFalse("datePosted" in r.input && r.input.datePosted === "", "empty datePosted was sent");
});

Deno.test("LinkedIn emits a verified non-empty timePostedRange and is NOT on-site-only", async () => {
  const r = await compileHiringSourceInput({
    capability: "linkedin_job_discovery",
    titleAliases: ["Sales Operations", "Revenue Operations"],
    geography: "United States",
    postingWindowDays: 30,
    candidateTarget: 40,
  });
  if (!r.ok) throw new Error(`linkedin compile refused: ${r.reason}`);
  assertEquals(r.input.timePostedRange, "2592000");
  assertEquals(r.input.onSite, true);
  assertEquals(r.input.remote, true, "remote postings were excluded");
  assertEquals(r.input.hybrid, true, "hybrid postings were excluded");
});

Deno.test("LinkedIn honours an explicit remote-only restriction", async () => {
  const r = await compileHiringSourceInput({
    capability: "linkedin_job_discovery",
    titleAliases: ["Sales Operations"],
    geography: "United States",
    remotePolicy: "remote",
    postingWindowDays: 7,
  });
  if (!r.ok) throw new Error("compile refused");
  assertEquals(r.input.remote, true);
  assertEquals(r.input.onSite, false);
  assertEquals(r.input.hybrid, false);
});

Deno.test("Glassdoor daysOld stays inside the semantic recency policy", async () => {
  const r = await compileHiringSourceInput({
    capability: "glassdoor_job_discovery",
    titleAliases: ["Sales Operations"],
    geography: "United States",
    postingWindowDays: 365,
  });
  if (!r.ok) throw new Error(`glassdoor compile refused: ${r.reason}`);
  assertEquals(r.input.daysOld, 60);
  assert(r.repairs.some((x) => x.includes("semantic recency policy")));
});

Deno.test("no unsupported SaaS / stage / employee-count fields are invented", async () => {
  for (const capability of ["indeed_job_discovery", "linkedin_job_discovery", "yc_job_discovery"] as const) {
    const r = await compileHiringSourceInput({
      capability,
      titleAliases: ["Sales Operations"],
      roleFamily: "revenue_operations",
      geography: "United States",
      postingWindowDays: 14,
    });
    if (!r.ok) continue;
    const keys = Object.keys(r.input).join(",").toLowerCase();
    assertFalse(/saas|stage|employeecount|companysize|headcount|funding/.test(keys), `${capability} invented a field`);
    assertEquals(r.postFetchQualification.includes("business_model_saas"), true);
    assertEquals(r.postFetchQualification.includes("startup_stage"), true);
    assertEquals(r.postFetchQualification.includes("employee_count_range"), true);
  }
});
