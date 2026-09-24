// THE FIRST EXECUTION PLAN MUST NOT BE TALKED INTO REFUSING.
//
// Canaries c6, c10 and c11 (local, 2026-09-24) each drew an EMPTY first plan
// from Luna (~250 output tokens against ~700 for a real one) and bought a
// ~$0.02 Terra repair to undo it — 91% of the run's model spend. Sampled
// against the canary payload, the refusal said why:
//
//   "funding verification is listed as verified after eligibility but is not
//    available as an authorized executable capability … no execution chain can
//    return a genuinely qualified company."
//
// It was answering its own payload. Beside `verified_after_eligibility` sat a
// P4-era advisory — "funding cannot be proven over the pool this plan
// produces" — written before a per-company funding verifier existed, and the
// prompt says an empty plan is the correct answer when a fact has no route.
//
// Pinned here: the advisory fires only when funding has NO post-eligibility
// owner; the payload says in words that a listed claim has one; and a refused
// first plan's own reasoning reaches the repair log.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { buildExecutionPlannerPayload } from "../../../supabase/functions/_shared/leadExecutionPlan.ts";
import { mergeCompanyBrainIntoMission, parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { readinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { runCapabilityPlan } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { candidatePool, parseRunBudget } from "../../../supabase/functions/_shared/runBudget.ts";
import { emptyDiscoverySelector } from "./discoverySelectorFixture.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

const PROBE = readinessPolicy({ mode: "provider_probe", probe_routes: ["apify_linkedin_company_search|general_company_discovery"] });
/** The canary mission: US, 11–50, a windowed (hard) funding signal, Brain industries. */
const CANARY = (() => {
  const m = parseLeadMissionDeterministic("Find 1 US company with 11-50 employees that raised funding in the last 6 months");
  const stated = {
    ...m, company_profile: { ...m.company_profile, employee_range: { min: 11, max: 50 } },
    field_provenance: { ...m.field_provenance, "company_profile.employee_range": "explicit_user_request" as const },
  };
  return mergeCompanyBrainIntoMission(stated, { industries: ["b2b saas", "fintech"] } as never).mission;
})();
const STALE = /DISCOVERY-ONLY/;

Deno.test("PAYLOAD: a funding claim the verification phase owns carries no 'cannot be proven' advisory", () => {
  const graph = buildCapabilityGraph(CANARY, { executability: "enforce", readiness: PROBE });
  assertFalse(graph.routing_advisories.some((a) => STALE.test(a)), graph.routing_advisories.join("\n"));
  const p = buildExecutionPlannerPayload(CANARY, graph, { readiness: PROBE }) as Record<string, unknown>;
  const owned = (p.verified_after_eligibility as Array<{ claim: string; verified_by: string[] }>);
  assert(owned.some((v) => v.claim === "recently_funded" && v.verified_by.includes("funding_verification")), JSON.stringify(owned));
  assertFalse(JSON.stringify(p.execution_advisories ?? []).includes("cannot be proven over the pool"));
});

Deno.test("PAYLOAD: the owned-claims list is explained — never a reason for an empty plan, enrichment still planned", () => {
  const graph = buildCapabilityGraph(CANARY, { executability: "enforce", readiness: PROBE });
  const note = String((buildExecutionPlannerPayload(CANARY, graph, { readiness: PROBE }) as Record<string, unknown>)
    .verified_after_eligibility_note ?? "");
  assert(note.includes("never a") && note.includes("empty plan"), note);
  assert(note.includes("plan that step as usual"), "a claim an authorised step proves (enrichment) must still be planned");
});

Deno.test("PAYLOAD: funding with NO post-eligibility owner still gets the advisory", () => {
  // Unwindowed funding on a hiring-shaped mission is not a hard verifiable claim.
  const m = parseLeadMissionDeterministic("Find B2B SaaS companies hiring SDRs that recently raised");
  const graph = buildCapabilityGraph({ ...m, strategies: ["hiring"] } as never);
  assert(graph.routing_advisories.some((a) => STALE.test(a)));
  const p = buildExecutionPlannerPayload({ ...m, strategies: ["hiring"] } as never, graph) as Record<string, unknown>;
  assertFalse(((p.verified_after_eligibility ?? []) as Array<{ claim: string }>)
    .some((v) => v.claim === "recently_funded" || v.claim === "funding_stage"), "funding has no owner here");
});

Deno.test("ENGINE: a refused first plan's own reasoning reaches the repair log", async () => {
  const logs: Array<[string, Record<string, unknown>]> = [];
  let asked = 0;
  const WHY = "funding cannot be established by any authorised capability";
  const VALID = { reasoning: "ok", steps: [
    { capability: "general_company_discovery", actor_key: "apify_linkedin_company_search", purpose: "d",
      input: { locations: ["United States"], companySize: ["11-50"], maxItems: 2, scraperMode: "full" }, depends_on: [] },
    { capability: "company_enrichment", actor_key: "apify_linkedin_company_details", purpose: "e", input: { companies: ["{{url}}"] }, depends_on: [1] },
    { capability: "company_brain_qualification", actor_key: null, purpose: "q", input: {}, depends_on: [2] },
    { capability: "persistence", actor_key: null, purpose: "p", input: {}, depends_on: [3] },
  ] };
  const budget = parseRunBudget({ provider_usd: 0.04, max_candidates: 2 })!;
  await runCapabilityPlan({
    log: (m: string, meta?: Record<string, unknown>) => logs.push([m, meta ?? {}]),
    planDiscovery: emptyDiscoverySelector(),
    planExecution: () => Promise.resolve(asked++ === 0 ? { reasoning: WHY, steps: [] } : VALID),
    controlRoutes: () => Promise.resolve({ action: "continue" }),
    invoke: () => Promise.resolve([]),
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  } as never, {
    mission: CANARY, plan: buildCapabilityGraph(CANARY, { executability: "enforce", readiness: PROBE }),
    maxCandidates: candidatePool(1, budget), runBudget: budget, readiness: PROBE,
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
    specMode: "enforce", specScope: { workspace_id: "ws", lineage_id: "ln" },
  } as never);
  const attempt = logs.find(([m]) => m === "execution_plan_repair_attempt");
  assert(attempt, "an empty first plan is repaired");
  assertEquals(attempt![1].first_reasoning, WHY);
  assertEquals(asked, 2, "exactly one repair round");
});
