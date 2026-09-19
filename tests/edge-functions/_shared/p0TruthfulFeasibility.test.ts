// LEAD V2 P0 — AN ANCHOR THE ENGINE CANNOT EXECUTE FAILS TRUTHFULLY, BEFORE SPEND.
//
// Before P0 (legacy, pinned in p0-legacy-graph-snapshots.json):
//   product launch → entry product_launch_discovery (no executor), `satisfied`
//   technology     → technology_verification scheduled (no executor), `satisfied`
//   expansion      → entry expansion_signal_discovery (skipped by the engine)
// With the gate enforced (Lead V2), none of them may claim executable support,
// and the paid preflight blocks them — so no provider is called. The working
// routes — company profile, funding-first, hiring — stay feasible.
//
// Every case is pure: `fetch` throws for the whole file.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCapabilityGraph, type CapabilityPlan } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  assessRequestFeasibility, type FeasibilityReport,
} from "../../../supabase/functions/_shared/requestFeasibility.ts";
import { buildPaidExecutionPreflight } from "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts";
import { authorizePlaybookExecution } from "../../../supabase/functions/_shared/leadPlaybookExecution.ts";
import { selectResearchPlaybooks } from "../../../supabase/functions/_shared/leadResearchPlaybooks.ts";
import { compileFirstProviderCall } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { isCapabilityExecutable } from "../../../supabase/functions/_shared/capabilityExecutability.ts";
import { buildMissionPreview } from "../../../supabase/functions/_shared/missionPreview.ts";
import { parseLeadMissionDeterministic, type LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { readinessPolicy, type ReadinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";

/**
 * P0 asked "can the ENGINE execute this?". Since the readiness authority,
 * production also asks "has an actor for it run live?" — so the carded routes
 * these tests call "working" run only inside an explicit provider probe that
 * opens them. Production refusal of the same missions is pinned below.
 */
const PROBE: ReadinessPolicy = readinessPolicy({ mode: "provider_probe", probe_routes: [
  "apify_funding_rounds_datahyena|funding_signal_discovery",
  "apify_linkedin_company_search|general_company_discovery",
  "apify_google_news|expansion_signal_verification",
  "apify_google_news|product_launch_verification",
] });

// deno-lint-ignore no-explicit-any
type Json = any;
const SNAP = JSON.parse(Deno.readTextFileSync(
  new URL("../../fixtures/lead-v2/p0-legacy-graph-snapshots.json", import.meta.url)));
const mission = (id: string): LeadMissionV1 => {
  const c = (SNAP.cases as Json[]).find((x) => x.id === id || String(x.id).startsWith(`${id}:`));
  assert(c, `snapshot case ${id}`);
  return c.mission;
};
const legacyOf = (id: string) =>
  (SNAP.cases as Json[]).find((x) => x.id === id || String(x.id).startsWith(`${id}:`));

globalThis.fetch = () => { throw new Error("P0 feasibility must not reach the network"); };

function enforce(m: LeadMissionV1, readiness: ReadinessPolicy = PROBE): { plan: CapabilityPlan; f: FeasibilityReport; preflightBlocks: string[] } {
  const plan = buildCapabilityGraph(m, { executability: "enforce", readiness });
  const f = assessRequestFeasibility(m, plan, { executability: "enforce", readiness });
  const first = compileFirstProviderCall(plan);
  const preflight = buildPaidExecutionPreflight({
    mission: m, plan, executability: "enforce", readiness,
    firstProvider: first.provider,
    firstProviderInput: first.compiled?.ok ? first.compiled.input : null,
    firstProviderCompileOk: first.compiled ? first.compiled.ok : undefined,
    firstProviderErrors: first.compiled && !first.compiled.ok ? first.compiled.errors : [],
  });
  return { plan, f, preflightBlocks: preflight.blocked.map((b) => b.code) };
}
const statuses = (f: FeasibilityReport) => f.requirements.map((r) => r.status);
const codes = (f: FeasibilityReport) => f.refusals.map((r) => r.code);

// ── production: a route never proven live is refused, before any spend ───────

Deno.test("PRODUCTION: profile and funding-first missions are refused while their discovery actors are unproven", () => {
  const prod = readinessPolicy();
  for (const [m, entry] of [
    [parseLeadMissionDeterministic("Find US B2B SaaS companies."), "general_company_discovery"],
    [mission("q4"), "general_company_discovery"],
  ] as Array<[LeadMissionV1, string]>) {
    const { plan, f, preflightBlocks } = enforce(m, prod);
    assertFalse(plan.entry_selection!.runnable, "no READY entry");
    assertEquals(plan.entry_capability, entry);
    assertFalse(f.ok);
    const refusal = f.refusals.find((r) => r.code === "entry_not_executable")!;
    assert(refusal && /CARDED_BUT_NOT_LIVE/.test(refusal.message), refusal?.message);
    assert(preflightBlocks.includes("request_not_feasible"), "blocked before the first paid call");
    assertEquals(plan.steps.find((s) => s.capability === entry)!.providers, [], "no unproven actor is handed to the engine");
  }
  // The same missions under a probe that opens the routes run (below).
  assert(enforce(mission("q4"), PROBE).f.ok);
});

Deno.test("PRODUCTION: a hiring mission still runs — its whole route is READY", () => {
  const { plan, f } = enforce(mission("q1"), readinessPolicy());
  assert(f.ok);
  assertEquals(plan.entry_capability, "job_discovery");
  assertEquals(plan.entry_selection!.mode, "production");
});

// ── working routes stay feasible (under a probe that opens their carded actors) ──

Deno.test("company-profile mission stays feasible", () => {
  const { plan, f, preflightBlocks } = enforce(parseLeadMissionDeterministic("Find US B2B SaaS companies."));
  assert(f.ok);
  assert(isCapabilityExecutable(plan.entry_capability));
  assertFalse(preflightBlocks.includes("request_not_feasible"));
});

Deno.test("funding-first missions stay feasible, entered by funding discovery", () => {
  for (const id of ["q4", "inject:funding"]) {
    const { plan, f, preflightBlocks } = enforce(mission(id));
    assertEquals(plan.entry_capability, "funding_signal_discovery", id);
    assert(f.ok, id);
    assert(statuses(f).every((s) => s === "satisfied"), `${id}: ${statuses(f)}`);
    assertFalse(preflightBlocks.includes("request_not_feasible"), id);
  }
  const both = enforce(mission("q14"));
  assert(both.f.ok, "hiring + funding");
});

Deno.test("hiring missions stay feasible and satisfied by hiring verification", () => {
  for (const id of ["q1", "q2", "q3", "q11", "q12", "inject:hiring"]) {
    const { plan, f } = enforce(mission(id));
    assert(f.ok, id);
    assert(plan.steps.some((s) => s.capability === "hiring_verification"), id);
    assert(statuses(f).every((s) => s === "satisfied"), `${id}: ${statuses(f)}`);
  }
});

Deno.test("working routes build the same plan enforced as they did before P0", () => {
  // P3: hiring-led company missions (q1 q2 q3 q11 q12, inject:hiring) now enter
  // through job discovery under V2 — see the next test. Legacy plans for them
  // are unchanged, and every other working route is still identical.
  for (const id of ["q4", "q14", "inject:funding"]) {
    const { plan } = enforce(mission(id));
    const before = legacyOf(id).plan;
    assertEquals(plan.entry_capability, before.entry_capability, id);
    assertEquals(plan.steps.map((s) => s.capability), before.steps.map((s: Json) => s.capability), id);
    assertEquals(plan.executability?.unexecutable ?? [], [], `${id}: nothing gated`);
  }
});

Deno.test("P3: hiring-led missions enter through job discovery under V2 only, nothing gated", () => {
  const JOB_ROUTE = ["job_discovery", "job_deduplication", "company_identity_resolution", "company_enrichment",
    "hiring_verification", "company_brain_qualification", "persistence"];
  for (const id of ["q1", "q2", "q3", "q11", "q12", "inject:hiring"]) {
    const { plan, f } = enforce(mission(id));
    assertEquals(plan.entry_capability, "job_discovery", id);
    assertEquals(plan.steps.map((s) => s.capability), JOB_ROUTE, id);
    assertEquals(plan.executability?.unexecutable ?? [], [], `${id}: nothing gated`);
    assert(f.ok, `${id}: feasible`);
    // The live canary d298a03b was refused HERE, by the paid-execution preflight
    // and the hiring playbook, which still assumed company missions open at
    // company discovery. Both are part of the route, so both are asserted.
    const { preflightBlocks } = enforce(mission(id));
    assertEquals(preflightBlocks, [], `${id}: paid execution preflight`);
    const pb = authorizePlaybookExecution(selectResearchPlaybooks(mission(id)), plan, mission(id));
    assert(pb.authorized, `${id}: playbook ${JSON.stringify(pb.violations)}`);
    assertFalse(plan.allowed_providers.includes("apify_yc_companies_memo23"), `${id}: no YC-first default`);
    assertEquals(buildCapabilityGraph(mission(id)).entry_capability, legacyOf(id).plan.entry_capability, `${id}: V1 unchanged`);
  }
  // A funding requirement is proven only at discovery: q14 keeps its funding entry.
  assertEquals(enforce(mission("q14")).plan.entry_capability, "funding_signal_discovery");
});

// ── unsupported anchors fail truthfully ──────────────────────────────────────

Deno.test("product-launch-first does NOT claim executable support, and spends nothing", () => {
  for (const id of ["q5", "inject:product_launch"]) {
    assertEquals(legacyOf(id).plan.entry_capability, "product_launch_discovery", `${id}: the pre-P0 lie`);
    const { plan, f, preflightBlocks } = enforce(mission(id));
    assert(plan.entry_capability !== "product_launch_discovery", id);
    assertEquals(plan.executability?.unexecutable.map((u) => u.capability), ["product_launch_discovery"]);
    assert(plan.routing_advisories.some((a) => a.includes("product_launch_discovery is not executable yet")));
    assertFalse(f.ok, id);
    assertFalse(statuses(f).includes("satisfied"), `${id}: ${statuses(f)}`);
    assert(statuses(f).includes("partially_supported"), id);
    assert(codes(f).includes("no_requirement_provable"), id);
    assert(preflightBlocks.includes("request_not_feasible"), `${id}: blocked before the first paid call`);
  }
});

Deno.test("headcount / expansion-first does NOT claim executable support", () => {
  for (const id of ["q6", "q13", "inject:expansion", "inject:headcount_change"]) {
    const { plan, f, preflightBlocks } = enforce(mission(id));
    assert(plan.entry_capability !== "expansion_signal_discovery", id);
    assertFalse(f.ok, id);
    assertFalse(statuses(f).includes("satisfied"), `${id}: ${statuses(f)}`);
    assert(preflightBlocks.includes("request_not_feasible"), id);
  }
});

Deno.test("leadership-first does NOT claim executable support", () => {
  for (const id of ["q8", "inject:leadership_change"]) {
    const { f, preflightBlocks } = enforce(mission(id));
    assertFalse(f.ok, id);
    assertEquals(statuses(f), ["unsupported"], id);
    assert(codes(f).includes("no_requirement_provable"), id);
    assert(preflightBlocks.includes("request_not_feasible"), id);
  }
});

Deno.test("technology-first does NOT claim executable support", () => {
  for (const id of ["q7", "inject:technology"]) {
    assert(legacyOf(id).plan.steps.some((s: Json) => s.capability === "technology_verification"), `${id}: pre-P0`);
    const { plan, f, preflightBlocks } = enforce(mission(id));
    assertFalse(plan.steps.some((s) => s.capability === "technology_verification"), id);
    assertFalse(f.ok, id);
    assertEquals(statuses(f), ["needs_engine_work"], id);
    assert(preflightBlocks.includes("request_not_feasible"), id);
  }
});

Deno.test("company-post evidence does NOT claim executable support", () => {
  const { plan, f } = enforce(mission("inject:post_company"));
  assertFalse(plan.steps.some((s) => s.capability === "company_post_verification"));
  assertFalse(f.ok);
  assertEquals(statuses(f), ["needs_engine_work"]);
});

Deno.test("a mixed mission runs what it can and declares what it cannot", () => {
  const launch = enforce(mission("inject:hiring+product_launch"));
  assert(launch.f.ok, "hiring is provable, so the mission runs");
  // P3: hiring-led, so it enters through job discovery and never attempts the
  // unexecutable launch-DISCOVERY entry; the executable launch VERIFICATION is
  // scheduled on the job route, so the launch requirement is provable.
  assertEquals(launch.plan.entry_capability, "job_discovery");
  assert(launch.plan.steps.some((s) => s.capability === "product_launch_verification"));
  assertEquals(statuses(launch.f).sort(), ["satisfied", "satisfied"]);
  const tech = enforce(mission("inject:hiring+technology"));
  assert(tech.f.ok);
  assertEquals(statuses(tech.f).sort(), ["needs_engine_work", "satisfied"]);
  assertEquals(tech.f.executability?.unexecutable.map((u) => u.capability), ["technology_verification"]);
});

Deno.test("a job-listing mission is refused: its entry cannot execute", () => {
  const m = { ...parseLeadMissionDeterministic("Find US B2B SaaS companies hiring growth marketers."),
    requested_output: "job_listings" } as LeadMissionV1;
  const legacy = buildCapabilityGraph(m);
  assertEquals(legacy.entry_capability, "job_discovery");
  const { f, preflightBlocks } = enforce(m);
  assertFalse(f.ok);
  assert(codes(f).includes("entry_not_executable"), `${codes(f)}`);
  assert(preflightBlocks.includes("request_not_feasible"));
});

Deno.test("P3: a company mission whose job plan never resolves employers is still refused at preflight", () => {
  const m = mission("q3");
  const plan = buildCapabilityGraph(m, { executability: "enforce" });
  const truncated = { ...plan, steps: plan.steps.filter((s) => !["company_identity_resolution", "company_brain_qualification"].includes(s.capability)) };
  const pre = buildPaidExecutionPreflight({ mission: m, plan: truncated as CapabilityPlan, executability: "enforce", firstProvider: "apify_linkedin_job_search" });
  assert(pre.blocked.some((b) => b.code === "entry_capability_mismatch"), JSON.stringify(pre.blocked));
});

Deno.test("the Pilot refusal names the missing executable capability, not a placeholder", () => {
  const cases: Array<[string, string]> = [
    ["q5", "product_launch_discovery"], ["inject:technology", "technology_verification"],
    ["q6", "expansion_signal_discovery"], ["inject:post_company", "company_post_verification"],
  ];
  for (const [id, cap] of cases) {
    const { plan, f } = enforce(mission(id));
    const p = buildMissionPreview(mission(id), plan, f);
    assertFalse(p.feasible, id);
    const text = p.gaps.map((g) => g.detail).join("; ");
    assert(text.includes(cap) && /not executable yet|cannot execute yet/.test(text), `${id}: ${text}`);
    assertFalse(text.includes("part of this can't be run"), `${id}: placeholder`);
    assertFalse(p.gaps.some((g) => g.detail === "declared gap"), `${id}: placeholder`);
  }
  // Leadership has no capability at all: the reason says so, still in words.
  const { plan, f } = enforce(mission("q8"));
  const lead = buildMissionPreview(mission("q8"), plan, f).gaps.map((g) => g.detail).join("; ");
  assert(lead.length > 40 && !lead.includes("part of this can't be run"), lead);
});

Deno.test("no enforced plan in the battery schedules a step the engine cannot run", () => {
  for (const c of SNAP.cases as Json[]) {
    const { plan, f } = enforce(c.mission);
    for (const s of plan.steps) assert(isCapabilityExecutable(s.capability), `${c.id}: ${s.capability}`);
    assertEquals(f.executability?.scheduled_unexecutable, [], c.id);
    // Truth: `satisfied` only ever means an executable step proves it.
    for (const r of f.requirements) {
      if (r.status === "satisfied" && r.by_capability) assert(isCapabilityExecutable(r.by_capability), c.id);
    }
  }
});
