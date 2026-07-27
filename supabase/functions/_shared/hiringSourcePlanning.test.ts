// DYNAMIC HIRING-SOURCE PLANNING — catalog, compilation, coexistence, flags.
//
// Every Actor input asserted here was checked against the Actor's VERIFIED input
// schema (read-only Apify metadata, builds recorded in the catalog). No Actor is
// executed. The point of these tests is that a compiler can never emit a field
// the provider does not have, or claim a filter it cannot apply.
//
// PURE. No provider, model, network or database access.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  HIRING_SOURCE_CATALOG, HIRING_SOURCE_CAPABILITY_IDS, plannerHiringSourceMenu,
  resolveHiringSourceActor, hiringSourceCatalogHash, isHiringSourceCapability,
} from "./hiringSourceCatalog.ts";
import {
  compileHiringSourceInput, indeedDatePostedBucket, linkedinTimePostedRange, ycRoleFilter,
} from "./actorInputPlanner.ts";
import {
  deterministicSourcePlan, validateSourcePlan, sourcePlanHash,
  isDynamicSourcePlanningEnabled, DYNAMIC_SOURCE_WORKSPACES_ENV,
  type SourcePlanMission,
} from "./hiringSourcePlan.ts";
import { ACTOR_REGISTRY, getActorByKey } from "./actorRegistry.ts";
import { SOURCE_TYPE_TO_ACTOR } from "./actorInputSchemas.ts";
import { readIntelligenceFlags } from "./intelligence/intelligenceFlags.ts";

/**
 * Enablement is `required_env`, re-read at call time, so flipping it here is
 * enough — no Actor is contacted either way. S4 asserts the default-OFF state,
 * which is why enabling is an explicit per-test toggle rather than blanket setup.
 */
const PROVIDER_ENV = [
  "APIFY_ENABLE_INDEED_JOBS_AUTOMATION_LAB", "APIFY_ENABLE_LINKEDIN_JOBS_CRAWLWORKS",
  "APIFY_ENABLE_GLASSDOOR_JOBS", "APIFY_ENABLE_YC_JOBS", "APIFY_ENABLE_ATS_VERIFICATION",
];
function enableProviders(): void { for (const k of PROVIDER_ENV) Deno.env.set(k, "true"); }
function disableProviders(): void { for (const k of PROVIDER_ENV) Deno.env.delete(k); }

// ================================================================== catalog ===

Deno.test("S1 all five approved capabilities are registered", () => {
  assertEquals(HIRING_SOURCE_CAPABILITY_IDS.sort(), [
    "ats_job_verification", "glassdoor_job_discovery", "indeed_job_discovery",
    "linkedin_job_discovery", "yc_job_discovery",
  ]);
});

Deno.test("S2 Actor IDs live ONLY in the actor registry, never in the catalog", () => {
  const blob = JSON.stringify(HIRING_SOURCE_CATALOG);
  for (const marker of [
    "automation-lab/", "crawlworks/", "valig/", "parsebird/", "bovi/", "curious_coder/",
  ]) {
    assert(!blob.includes(marker), `catalog leaked an actor id: ${marker}`);
  }
  // Each capability points at a registry KEY that exists.
  for (const id of HIRING_SOURCE_CAPABILITY_IDS) {
    const key = HIRING_SOURCE_CATALOG[id].providerAdapterKey;
    assert(getActorByKey(key), `${id} -> ${key} is not in ACTOR_REGISTRY`);
  }
});

Deno.test("S3 the planner projection exposes no provider internals", () => {
  const menu = plannerHiringSourceMenu();
  const blob = JSON.stringify(menu);
  for (const marker of ["providerAdapterKey", "verifiedBuild", "apify_", "actor", "api_key", "Bearer"]) {
    assert(!blob.toLowerCase().includes(marker.toLowerCase()), `projection leaked ${marker}`);
  }
});

Deno.test("S4 disabled providers are not selectable and not projected", () => {
  disableProviders();
  // With no APIFY_ENABLE_* set, every approved variant is disabled by default.
  for (const id of HIRING_SOURCE_CAPABILITY_IDS) {
    const r = resolveHiringSourceActor(id);
    assertEquals(r.ok, false, `${id} must default to disabled`);
  }
  assertEquals(plannerHiringSourceMenu().length, 0, "a disabled channel is never offered");
});

Deno.test("S5 an unknown capability is refused", () => {
  assertEquals(isHiringSourceCapability("totally_made_up"), false);
  const r = resolveHiringSourceActor("totally_made_up");
  assertEquals(r.ok, false);
});

Deno.test("S6 the catalog hash is deterministic", async () => {
  assertEquals(await hiringSourceCatalogHash(), await hiringSourceCatalogHash());
});

// ==================================================== Indeed coexistence ===

Deno.test("S7 the legacy Curious Coder Indeed entry is UNCHANGED", () => {
  const legacy = ACTOR_REGISTRY["apify_indeed_jobs"];
  assert(legacy, "the legacy entry must still exist");
  assertEquals(legacy.source_type, "indeed_jobs");
  assertEquals(legacy.label, "Indeed Jobs Scraper");
  assert(String(legacy.actor_id).includes("curious_coder/indeed-scraper"),
    `legacy actor id was repointed: ${legacy.actor_id}`);
});

Deno.test("S8 the approved Automation Lab Indeed is a SEPARATE registry key", () => {
  const v2 = ACTOR_REGISTRY["apify_indeed_jobs_automation_lab"];
  assert(v2, "the approved variant must be registered");
  assert(String(v2.actor_id).includes("automation-lab/indeed-scraper"));
  assert(v2.key !== "apify_indeed_jobs", "it must not overwrite the legacy key");
});

Deno.test("S9 indeed_job_discovery selects Automation Lab, not the legacy actor", () => {
  assertEquals(HIRING_SOURCE_CATALOG.indeed_job_discovery.providerAdapterKey, "apify_indeed_jobs_automation_lab");
});

Deno.test("S10 SOURCE_TYPE_TO_ACTOR backward compatibility is preserved", () => {
  // The legacy one-actor-per-source-type map is untouched; the capability map is
  // the additive alternative.
  assertEquals(SOURCE_TYPE_TO_ACTOR.hiring_signal, "apify_jobs");
  assertEquals(SOURCE_TYPE_TO_ACTOR.company_search, "apify_jobs");
});

Deno.test("S11 only ONE semantic capability serves Indeed", () => {
  const indeedCaps = HIRING_SOURCE_CAPABILITY_IDS.filter((id) => /indeed/.test(id));
  assertEquals(indeedCaps, ["indeed_job_discovery"], "a planner must not see two Indeed channels");
});

// ================================================= posting-window repairs ===

Deno.test("S12 a 45-day Indeed window is repaired to 14 and diagnosed", () => {
  const r = indeedDatePostedBucket(45);
  assertEquals(r.value, "14");
  assert(r.repair?.includes("posting_window_clamped"), r.repair ?? "no repair recorded");
});

Deno.test("S13 Indeed datePosted is ALWAYS a supported bucket", () => {
  const allowed = new Set(["", "1", "3", "7", "14"]);
  for (const d of [null, 0, 1, 2, 3, 4, 7, 8, 14, 15, 30, 45, 365, 10000]) {
    const v = indeedDatePostedBucket(d as number).value;
    assert(allowed.has(v), `datePosted=${v} for ${d} is not in the verified enum`);
  }
});

Deno.test("S14 LinkedIn recency is always a supported seconds value", () => {
  const allowed = new Set(["", "86400", "259200", "604800", "2592000"]);
  for (const d of [null, 1, 3, 7, 30, 45, 400]) {
    const v = linkedinTimePostedRange(d as number).value;
    assert(allowed.has(v), `timePostedRange=${v} for ${d} is not in the verified enum`);
  }
  assert(linkedinTimePostedRange(400).repair?.includes("clamped"));
});

Deno.test("S15 YC roleFilter never leaves the verified enum", () => {
  const allowed = new Set(["", "software-engineer", "designer", "product-manager", "data-scientist",
    "sales", "marketing", "support", "operations", "recruiting", "science"]);
  for (const r of ["sales_operations", "revenue operations", "gtm ops", "quantum photonics", null, "designer"]) {
    const v = ycRoleFilter(r as string).value;
    assert(allowed.has(v), `roleFilter=${v} for ${r} is not in the verified enum`);
  }
  assertEquals(ycRoleFilter("sales_operations").value, "operations");
});

// ============================================================= compilation ===

const BASE = {
  titleAliases: ["Sales Operations", "Revenue Operations", "GTM Operations"],
  roleFamily: "sales_operations",
  geography: "United States",
  countryCode: "US",
  postingWindowDays: 45,
  candidateTarget: 60,
} as const;

Deno.test("S16 Indeed compiles to its verified schema only", async () => {
  enableProviders();
  const r = await compileHiringSourceInput({ ...BASE, capability: "indeed_job_discovery" } as never);
  assert(r.ok, JSON.stringify(r));
  assertEquals(Object.keys(r.input).sort(),
    ["country", "datePosted", "includeDescription", "jobType", "location", "maxItems", "query"]);
  assertEquals(r.input.datePosted, "14");
  assertEquals(r.input.country, "US");
  assertEquals(r.actorKey, "apify_indeed_jobs_automation_lab");
  assert(r.repairs.some((x) => x.includes("posting_window_clamped")));
});

Deno.test("S17 LinkedIn always receives the REQUIRED bounded jobsToFetch", async () => {
  enableProviders();
  const r = await compileHiringSourceInput({ ...BASE, capability: "linkedin_job_discovery", candidateTarget: 5000 } as never);
  assert(r.ok);
  const n = Number(r.input.jobsToFetch);
  assert(Number.isInteger(n) && n >= 1 && n <= 200, `jobsToFetch out of bounds: ${n}`);
  assert(r.repairs.some((x) => x.includes("result_target_capped")));
  assertEquals(r.input.timePostedRange, "2592000");
});

Deno.test("S18 Glassdoor refuses to compile without keywords or location", async () => {
  enableProviders();
  const noLoc = await compileHiringSourceInput({ ...BASE, capability: "glassdoor_job_discovery", geography: null } as never);
  assertEquals(noLoc.ok, false);
  if (!noLoc.ok) assertEquals(noLoc.reason, "glassdoor_requires_location");

  const noKw = await compileHiringSourceInput({ ...BASE, capability: "glassdoor_job_discovery", titleAliases: [] } as never);
  assertEquals(noKw.ok, false);
  if (!noKw.ok) assertEquals(noKw.reason, "glassdoor_requires_keywords");

  const ok = await compileHiringSourceInput({ ...BASE, capability: "glassdoor_job_discovery" } as never);
  assert(ok.ok);
  assert(ok.input.keywords && ok.input.location);
});

Deno.test("S19 YC never receives a stage, batch or team-size field", async () => {
  enableProviders();
  const r = await compileHiringSourceInput({ ...BASE, capability: "yc_job_discovery" } as never);
  assert(r.ok);
  assertEquals(Object.keys(r.input).sort(), ["locationFilter", "maxResults", "roleFilter", "searchQuery"]);
  const blob = JSON.stringify(r.input).toLowerCase();
  for (const forbidden of ["batch", "stage", "teamsize", "team_size", "employees", "funding"]) {
    assert(!blob.includes(forbidden), `YC input fabricated ${forbidden}`);
  }
});

Deno.test("S20 ATS verification without a company slug is DEFERRED, not invalid input", async () => {
  enableProviders();
  const r = await compileHiringSourceInput({ ...BASE, capability: "ats_job_verification", companies: [] } as never);
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.status, "deferred");
    assertEquals(r.reason, "ats_verification_requires_resolved_company_slug");
  }
});

Deno.test("S21 ATS compiles once a company identity is resolved", async () => {
  enableProviders();
  const r = await compileHiringSourceInput({
    ...BASE, capability: "ats_job_verification",
    companies: [{ ats: "greenhouse", slug: "stripe" }, { slug: "linear" }],
  } as never);
  assert(r.ok, JSON.stringify(r));
  const companies = r.input.companies as Array<Record<string, unknown>>;
  assertEquals(companies.length, 2);
  assertEquals(companies[0].company, "stripe");
  assertEquals(companies[0].ats, "greenhouse");
});

Deno.test("S22 compiled input hashes are deterministic", async () => {
  enableProviders();
  const a = await compileHiringSourceInput({ ...BASE, capability: "indeed_job_discovery" } as never);
  const b = await compileHiringSourceInput({ ...BASE, capability: "indeed_job_discovery" } as never);
  assert(a.ok && b.ok);
  assertEquals(a.inputHash, b.inputHash);

  const c = await compileHiringSourceInput({ ...BASE, capability: "indeed_job_discovery", candidateTarget: 30 } as never);
  assert(c.ok);
  assert(c.inputHash !== a.inputHash, "a different target must change the hash");
});

Deno.test("S23 a disabled provider cannot be compiled", async () => {
  disableProviders();
  const r = await compileHiringSourceInput({ ...BASE, capability: "indeed_job_discovery" } as never);
  assertEquals(r.ok, false, "a disabled provider must refuse to compile");
  if (!r.ok) assert(r.reason.startsWith("provider_disabled"), r.reason);
});

Deno.test("S24 no compiled input carries a credential or an actor id", async () => {
  enableProviders();
  for (const id of ["indeed_job_discovery", "linkedin_job_discovery", "glassdoor_job_discovery", "yc_job_discovery"]) {
    const r = await compileHiringSourceInput({ ...BASE, capability: id } as never);
    if (!r.ok) continue;
    const blob = JSON.stringify({ i: r.input, s: r.summary }).toLowerCase();
    for (const marker of ["api_key", "apikey", "token", "bearer", "authorization", "automation-lab/", "crawlworks/"]) {
      assert(!blob.includes(marker), `${id} leaked ${marker}`);
    }
  }
});

// ============================================== mission-aware deterministic ===

const mission = (o: Partial<SourcePlanMission> = {}): SourcePlanMission => ({
  hiringSignalRequired: true, industries: ["b2b saas"], companyStages: ["seed"],
  geography: "United States", requestedContactReady: 5, ...o,
});

Deno.test("S25 early-stage B2B SaaS selects YC, Indeed and LinkedIn", () => {
  const p = deterministicSourcePlan(mission());
  assertEquals(p.lanes.map((l) => l.capability),
    ["yc_job_discovery", "indeed_job_discovery", "linkedin_job_discovery"]);
  assertEquals(p.fallbackLanes.map((l) => l.capability), ["glassdoor_job_discovery"]);
  assertEquals(p.verification?.capability, "ats_job_verification");
});

Deno.test("S26 manufacturing EXCLUDES YC by default", () => {
  const p = deterministicSourcePlan(mission({ industries: ["manufacturing"], companyStages: [] }));
  const caps = p.lanes.map((l) => l.capability);
  assert(!caps.includes("yc_job_discovery"), `YC must not be selected: ${caps.join(", ")}`);
  assertEquals(caps, ["indeed_job_discovery", "linkedin_job_discovery"]);
});

Deno.test("S27 a local-business mission selects no YC lane", () => {
  const p = deterministicSourcePlan(mission({ industries: ["dental clinics"], companyStages: [] }));
  assert(!p.lanes.some((l) => l.capability === "yc_job_discovery"));
});

Deno.test("S28 a mission with NO hiring requirement selects no job scraper at all", () => {
  const p = deterministicSourcePlan(mission({ hiringSignalRequired: false }));
  assertEquals(p.lanes, []);
  assertEquals(p.fallbackLanes, []);
  assertEquals(p.verification, null);
});

Deno.test("S29 different verticals produce different plans; the same mission is stable", async () => {
  const saas = deterministicSourcePlan(mission());
  const mfg = deterministicSourcePlan(mission({ industries: ["manufacturing"], companyStages: [] }));
  assert(await sourcePlanHash(saas) !== await sourcePlanHash(mfg));
  assertEquals(await sourcePlanHash(saas), await sourcePlanHash(deterministicSourcePlan(mission())));
});

// ============================================================== validation ===

Deno.test("S30 an unknown or disabled capability lane is rejected", () => {
  enableProviders();
  const v = validateSourcePlan({
    version: "dynamic-hiring-source-plan-v1",
    lanes: [{ capability: "made_up_source" as never, priority: 1, purpose: "discovery", candidateTarget: 10, rationale: "x" }],
    fallbackLanes: [], verification: null,
    joinStrategy: "canonical_company_identity", stopCondition: "contact_ready_quota_or_valid_exhaustion",
  }, mission());
  assertEquals(v.approvedLanes.length, 0);
  assert(v.rejectedLanes[0].reason.startsWith("unknown_capability"));
  assertEquals(v.ok, false, "a hiring mission with no surviving lane must block");
});

Deno.test("S31 a job scraper on a non-hiring mission is rejected", () => {
  enableProviders();
  const v = validateSourcePlan(deterministicSourcePlan(mission()), mission({ hiringSignalRequired: false }));
  assertEquals(v.approvedLanes.length, 0);
  for (const r of v.rejectedLanes) assertEquals(r.reason, "mission_does_not_require_hiring_evidence");
});

Deno.test("S32 ATS cannot be used as a discovery lane", () => {
  enableProviders();
  const v = validateSourcePlan({
    version: "dynamic-hiring-source-plan-v1",
    lanes: [{ capability: "ats_job_verification", priority: 1, purpose: "discovery", candidateTarget: 50, rationale: "x" }],
    fallbackLanes: [], verification: null,
    joinStrategy: "canonical_company_identity", stopCondition: "contact_ready_quota_or_valid_exhaustion",
  }, mission());
  assertEquals(v.rejectedLanes[0]?.reason, "requires_known_company_not_a_discovery_lane");
});

Deno.test("S33 duplicate lanes are deduplicated and excessive targets capped", () => {
  enableProviders();
  const l = (t: number) => ({ capability: "indeed_job_discovery" as const, priority: 1, purpose: "discovery" as const, candidateTarget: t, rationale: "x" });
  const v = validateSourcePlan({
    version: "dynamic-hiring-source-plan-v1", lanes: [l(99999), l(20)],
    fallbackLanes: [], verification: null,
    joinStrategy: "canonical_company_identity", stopCondition: "contact_ready_quota_or_valid_exhaustion",
  }, mission());
  assert(v.repairs.some((r) => r.includes("deduplicated_lane")));
  assert(v.repairs.some((r) => r.includes("lane_target_capped")));
  assert(v.approvedLanes.every((a) => a.candidateTarget <= 200));
});

Deno.test("S34 the join strategy and stop condition are fixed by Agentory", () => {
  const v = validateSourcePlan({
    version: "dynamic-hiring-source-plan-v1", lanes: [],
    fallbackLanes: [], verification: null,
    joinStrategy: "fuzzy_name" as never, stopCondition: "whenever" as never,
  }, mission({ hiringSignalRequired: false }));
  assertEquals(v.plan.joinStrategy, "canonical_company_identity");
  assertEquals(v.plan.stopCondition, "contact_ready_quota_or_valid_exhaustion");
});

// ================================================================== flags ===

Deno.test("S35 dynamic source planning defaults OFF", () => {
  assertEquals(readIntelligenceFlags(() => undefined).dynamic_hiring_source_planning, false);
});

Deno.test("S36 both the flag AND an explicit workspace are required", () => {
  const mk = (flag?: string, ws?: string) => (k: string) =>
    k === "DYNAMIC_HIRING_SOURCE_PLANNING" ? flag : k === DYNAMIC_SOURCE_WORKSPACES_ENV ? ws : undefined;
  const cases: Array<[string, ReturnType<typeof mk>, boolean]> = [
    ["nothing", mk(undefined, undefined), false],
    ["flag only", mk("true", undefined), false],
    ["allow-list only", mk(undefined, "ws-1"), false],
    ["empty list", mk("true", "  ,  "), false],
    ["wildcard", mk("true", "*"), false],
    ["other workspace", mk("true", "ws-2"), false],
    ["typo flag", mk("yes", "ws-1"), false],
    ["correct", mk("true", " ws-2 , ws-1 "), true],
  ];
  for (const [name, read, expected] of cases) {
    assertEquals(isDynamicSourcePlanningEnabled("ws-1", read).enabled, expected, name);
  }
});

Deno.test("S37 a throwing env reader fails closed", () => {
  const d = isDynamicSourcePlanningEnabled("ws-1", () => { throw new Error("denied"); });
  assertEquals(d.enabled, false);
});

Deno.test("S38 no second flag parser was introduced", async () => {
  // The flag must resolve through the shared intelligence resolver, so a value
  // it rejects ("yes") must be rejected here too.
  const src = await Deno.readTextFile(new URL("./hiringSourcePlan.ts", import.meta.url));
  assert(src.includes("isIntelligenceFlagEnabled"), "must use the existing flag resolver");
  assert(!/INTELLIGENCE_FLAG_ENABLED_VALUES\s*=/.test(src), "must not redefine the allow-list");
});

// ================================================ downstream authority holds ===

Deno.test("S39 planning owns no qualification, quota or execution authority", async () => {
  for (const f of ["hiringSourcePlan.ts", "hiringSourceCatalog.ts"]) {
    const src = await Deno.readTextFile(new URL(`./${f}`, import.meta.url));
    for (const forbidden of [
      "evaluateCompanyBrainEvidence", "isQuotaEligibleCandidate",
      "runCompoundSourcing", "buildPeopleScope", "verifyCurrentEmployer",
    ]) {
      assert(!src.includes(forbidden), `${f} must not take over ${forbidden}`);
    }
  }
});

Deno.test("S40 the harness itself is honest about enablement", () => {
  // If enablement stopped being dynamic, the compile tests above would silently
  // become no-ops instead of failing. This pins that they can still flip.
  disableProviders();
  assertEquals(resolveHiringSourceActor("yc_job_discovery").ok, false);
  enableProviders();
  assertEquals(resolveHiringSourceActor("yc_job_discovery").ok, true);
  disableProviders();
});
