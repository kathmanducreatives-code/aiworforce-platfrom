// A SUPPLIED COMPANY THAT QUALIFIES IS PLANNED WITHOUT A REPAIR AND REACHES THE LEAD LIBRARY.
//
// Canary 0b7baab9 (2026-09-25, local, HEAD b2a2d746): "Has Salvo Software
// (linkedin.com/company/salvosoftware) raised funding in the last 3 years?"
// Details → Atomus → Pvalyou ran exactly as preflighted ($0.0278), funding
// PASSED on Pvalyou's dated 2024-06-06 debt round, and the Workbench and
// run_outcome.canonical said 1 of 1 qualified. Two defects around it:
//
//   PLAN   the model planned identity → enrichment → qualification → persistence
//          and left out `known_company_resolution`, the graph's provider-free
//          entry. Every step was dropped as `consumer_without_producer`, and a
//          $0.0186 repair round on the larger model was bought to put back a
//          step nobody had a choice about.
//   WRITE  the Lead Library write was gated on the hiring playbook boundary,
//          which returns `applies: false` for a supplied-company / funding
//          mission — so 0 rows were written, and the run read
//          PARTIALLY_SATISFIED for a request it had met.
//
// Pure. ZERO network, provider, model or database calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateExecutionPlan } from "../../../supabase/functions/_shared/leadExecutionPlan.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { runCapabilityPlan, type EngineCompany } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { readinessPolicyFor } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { candidatePool, parseRunBudget } from "../../../supabase/functions/_shared/runBudget.ts";
import { selectResearchPlaybooks } from "../../../supabase/functions/_shared/leadResearchPlaybooks.ts";
import { authorizePlaybookExecution } from "../../../supabase/functions/_shared/leadPlaybookExecution.ts";
import {
  missionPersistenceGate, projectMissionCompanyRows,
} from "../../../supabase/functions/_shared/leadMissionPersistenceProjection.ts";
import type { CandidateDecision } from "../../../supabase/functions/_shared/workbenchMissionView.ts";
import { companyIsTheDeliverable, type LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { emptyDiscoverySelector } from "./discoverySelectorFixture.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

const WS = "00000000-0000-4000-a000-000000000001";
const FIX = new URL("../../fixtures/lead-v2/salvo-0b7baab9/", import.meta.url);
const SALVO = JSON.parse(Deno.readTextFileSync(new URL("mission.json", FIX))) as LeadMissionV1;
const OUTCOME = JSON.parse(Deno.readTextFileSync(new URL("outcome.json", FIX)));
const PRODUCTION = readinessPolicyFor(WS, () => undefined);
const graph = (m: LeadMissionV1 = SALVO) => buildCapabilityGraph(m, { executability: "enforce", readiness: PRODUCTION });
const step = (capability: string, actor_key: string | null, depends_on: number[] = []) =>
  ({ capability, actor_key, purpose: "t", input: {}, depends_on });
/** The live first proposal, exactly as the worker logged it. */
const LIVE_FIRST = [
  step("company_identity_resolution", "apify_linkedin_company_search"),
  step("company_enrichment", "apify_linkedin_company_details", [1]),
  step("company_brain_qualification", null, [2]),
  step("persistence", null, [3]),
];

// ══════════════════════════════ PLAN ══════════════════════════════

Deno.test("PLAN 1. the live omission is repaired in place — the entry is restored, nothing is dropped, nothing blocks", () => {
  const g = graph();
  assertEquals(g.entry_capability, "known_company_resolution");
  const v = validateExecutionPlan(LIVE_FIRST, SALVO, g);
  assertEquals(v.source, "model_repaired", JSON.stringify(v.violations));
  assertEquals(v.steps.map((s) => `${s.capability}:${s.actor_key ?? "-"}`), [
    "known_company_resolution:-", "company_identity_resolution:apify_linkedin_company_search",
    "company_enrichment:apify_linkedin_company_details", "company_brain_qualification:-", "persistence:-",
  ]);
  assertEquals(v.violations.map((x) => [x.code, x.severity]), [["entry_step_restored", "repair"]]);
  assertFalse(v.violations.some((x) => x.severity === "block"), "a repair-only plan buys no repair round");
});

Deno.test("PLAN 2. dependencies still point at the steps they named", () => {
  const v = validateExecutionPlan(LIVE_FIRST, SALVO, graph());
  assertEquals(v.steps.map((s) => s.depends_on), [[], [], [2], [3], [4]]);
});

Deno.test("PLAN 3. a plan that already has the entry is untouched", () => {
  const v = validateExecutionPlan([step("known_company_resolution", null), ...LIVE_FIRST.map((s) => ({ ...s,
    depends_on: s.depends_on.map((d) => d + 1) }))], SALVO, graph());
  assertEquals(v.source, "model_validated");
  assertEquals(v.violations, []);
});

Deno.test("PLAN 4. the repaired plan re-validates with ZERO violations, so a continuation reuses it", () => {
  const g = graph();
  const first = validateExecutionPlan(LIVE_FIRST, SALVO, g);
  const again = validateExecutionPlan(first.steps, SALVO, g);
  assertEquals(again.violations, []);
  assertEquals(again.steps.map((s) => s.capability), first.steps.map((s) => s.capability));
});

Deno.test("PLAN 5. an empty proposal is still refused — there is nothing to put the entry in front of", () => {
  const v = validateExecutionPlan([], SALVO, graph());
  assertEquals(v.source, "blocked");
  assertFalse(v.violations.some((x) => x.code === "entry_step_restored"));
});

Deno.test("PLAN 6. an entry that BUYS a provider is never invented — the consumers are still dropped", () => {
  const m = { ...SALVO, company_profile: { ...SALVO.company_profile, known_companies: [], locations: ["United States"] },
    required_capabilities: [], original_user_query: "Find 1 US company that raised funding in the last 3 years" } as LeadMissionV1;
  const g = graph(m);
  assert(g.entry_capability && g.entry_capability !== "known_company_resolution", String(g.entry_capability));
  const v = validateExecutionPlan(LIVE_FIRST.slice(1), m, g);
  assertFalse(v.violations.some((x) => x.code === "entry_step_restored"), "a paid discovery step is the model's to choose");
  assert(v.violations.some((x) => x.code === "consumer_without_producer"));
});

Deno.test("PLAN 7. ENGINE: the live first proposal is accepted — ONE planner call, no repair round", async () => {
  const logs: Array<[string, Record<string, unknown>]> = [];
  let asked = 0;
  const budget = parseRunBudget({ provider_usd: 0.04, max_candidates: 1 })!;
  await runCapabilityPlan({
    log: (m: string, meta?: Record<string, unknown>) => logs.push([m, meta ?? {}]),
    planDiscovery: emptyDiscoverySelector(),
    planExecution: () => { asked++; return Promise.resolve({ reasoning: "known-company signal check", steps: LIVE_FIRST }); },
    controlRoutes: () => Promise.resolve({ action: "continue" }),
    invoke: () => Promise.resolve([]),
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  } as never, {
    mission: SALVO, plan: graph(), maxCandidates: candidatePool(1, budget), runBudget: budget, readiness: PRODUCTION,
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
    specMode: "enforce", specScope: { workspace_id: "ws", lineage_id: "ln" },
  } as never);
  assertEquals(asked, 1, "the planner is asked once");
  assertFalse(logs.some(([m]) => m === "execution_plan_repair_attempt"), "no repair round is bought");
  assertFalse(logs.some(([m]) => m === "execution_plan_blocked"));
  const seeded = logs.find(([m]) => m === "known_companies_seeded");
  assertEquals(seeded?.[1].added, 1, "the supplied company entered the pool");
});

// ══════════════════════════════ WRITE ══════════════════════════════

const selection = (m: LeadMissionV1) => selectResearchPlaybooks(m);
const authorization = (m: LeadMissionV1) => authorizePlaybookExecution(selection(m), graph(m), m);

Deno.test("WRITE 1. the live Salvo mission: the hiring boundary does not govern it, every shape is runnable → the canonical decision gates the write", () => {
  const a = authorization(SALVO);
  assertEquals([a.applies, a.authorized], [false, true], "as the worker logged it");
  assertEquals(selection(SALVO).runnable, ["supplied_company", "funding"]);
  assertEquals(missionPersistenceGate({ authorization: a, selection: selection(SALVO), canonical: true }),
    { allowed: true, reason: "canonical_all_shapes_runnable" });
});

Deno.test("WRITE 2. unchanged: V1 (no canonical decision) with an ungoverned mission writes nothing", () => {
  assertEquals(missionPersistenceGate({ authorization: authorization(SALVO), selection: selection(SALVO), canonical: false }),
    { allowed: false, reason: "legacy_ungoverned" });
});

Deno.test("WRITE 3. unchanged: a hiring-governed run writes exactly when the playbook authorised it", () => {
  assertEquals(missionPersistenceGate({ authorization: { applies: true, authorized: true }, selection: null, canonical: true }).allowed, true);
  assertEquals(missionPersistenceGate({ authorization: { applies: true, authorized: false }, selection: null, canonical: true }),
    { allowed: false, reason: "hiring_playbook_refused" });
});

Deno.test("WRITE 4. a social or news ask this build cannot research writes nothing, even under V2", () => {
  for (const s of ["social", "news"] as const) {
    const m = { ...SALVO, strategies: [s] } as LeadMissionV1;
    const sel = selection(m);
    assert(sel.blocked.length > 0, s);
    assertEquals(missionPersistenceGate({ authorization: authorization(m), selection: sel, canonical: true }),
      { allowed: false, reason: "research_shape_blocked" }, s);
  }
});

Deno.test("WRITE 5. no mission, no write", () => {
  assertEquals(missionPersistenceGate({ authorization: null, selection: null, canonical: true }),
    { allowed: false, reason: "no_mission" });
});

/** Salvo as the engine holds it after enrichment. */
const salvo = (): EngineCompany => {
  const norm = { external_source_id: null, company_name: "Salvo Software", canonical_domain: "salvosoftware.com",
    linkedin_company_url: "https://www.linkedin.com/company/salvosoftware", website: "http://www.salvosoftware.com",
    description: "Custom software development.", provider_industry: "software development", industry_ids: [],
    employee_count: null, employee_range_advisory: null, geography: "Vancouver, WA, United States", company_type: null };
  return {
    key: "https://www.linkedin.com/company/salvosoftware", prequal_key: null, prequalified: null, shortlisted: true,
    company: norm as never, enriched: norm as never,
    identity: { company_key: "https://www.linkedin.com/company/salvosoftware", status: "verified_match",
      linkedin_company_url: "https://www.linkedin.com/company/salvosoftware", evidence: ["supplied_url"], ambiguous_candidates: [] } as never,
    yc_open_jobs: [], hiring_jobs: [], fit: null, hiring_assessment: null, brain: null, semantic_parse: null,
    completed_operations: [], evidence_registry: null, grounded: null, classification: null,
    // The engine's own Brain stage never reached it (`not_reached: 1`): the canonical decision is the authority.
    verdict: null, founders: [], verified_founders: [], contact_identities: [], record: {} as never,
  } as unknown as EngineCompany;
};
const decision = (label: CandidateDecision["label"], bucket: CandidateDecision["bucket"], funding: "pass" | "unknown") =>
  new Map<string, CandidateDecision>([[salvo().key, { company_key: salvo().key, bucket, label,
    hard_checks: { known_companies: "pass", funding } }]]);

Deno.test("WRITE 6. once the gate opens, the live canonical decision writes exactly one company row", () => {
  // The Workbench the live run produced: low_priority, both hard checks PASS, 0 written.
  const lead = OUTCOME.lead;
  assertEquals([lead.bucket, lead.label, lead.hard_checks], ["low_priority", "low_priority", { funding: "pass", known_companies: "pass" }]);
  assertEquals(OUTCOME.run_outcome.persistence.leads_written, 0, "the defect, as recorded");
  assert(companyIsTheDeliverable(SALVO), "run-agent passes \"company\" for this mission");
  const p = projectMissionCompanyRows([salvo()], WS, "company", decision("low_priority", "low_priority", "pass"));
  assertEquals(p.rows.length, 1, JSON.stringify(p.skipped));
  assertEquals(p.rows[0].company_key, "https://www.linkedin.com/company/salvosoftware");
  assertEquals(p.rows[0].plan.leadCandidate.lead_type, "account");
});

Deno.test("WRITE 7. a canonical PENDING (the 365-day window) is still never written", () => {
  const p = projectMissionCompanyRows([salvo()], WS, "company", decision(null, "pending", "unknown"));
  assertEquals(p.rows, []);
});
