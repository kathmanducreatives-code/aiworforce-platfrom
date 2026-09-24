// A REPORTED HEADCOUNT RANKS; ENRICHMENT DECIDES. A SPENT ALLOWANCE PLANS NOTHING.
//
// Canary 87ecf153 (local, 2026-09-24): company search returned ByteByteGo (86)
// and Psychology Today (2,135) for an 11–50 mission. The pre-pass excluded both
// on those search-row counts — PLAUSIBLE evidence — so enrichment never ran and
// size was never actually decided. Then a second slice spent model calls
// planning discovery the candidate allowance could no longer buy.
//
// Replayed here through the real engine with rows shaped like the canary's:
//
//   company search → plausible headcount → ranked down, NOT excluded
//   → enrichment (one batched company-details read) → PROVEN exact count
//   → size FAIL → ineligible → no Atomus
//
// and with the allowance spent, no discovery planning — this slice or the next.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { missionCandidatesFrom, runCapabilityPlan } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { mergeCompanyBrainIntoMission, parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { readinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { candidatePool, parseRunBudget } from "../../../supabase/functions/_shared/runBudget.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { verificationTargets } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { emptyDiscoverySelector } from "./discoverySelectorFixture.ts";

globalThis.fetch = () => { throw new Error("replay tests must not reach the network"); };

const PROBE = readinessPolicy({ mode: "provider_probe", probe_routes: ["apify_linkedin_company_search|general_company_discovery"] });
const QUERY = "Find 1 US company with 11-50 employees that raised funding in the last 6 months";
const MISSION = (() => {
  const m = parseLeadMissionDeterministic(QUERY);
  const stated = {
    ...m, company_profile: { ...m.company_profile, employee_range: { min: 11, max: 50 } },
    field_provenance: { ...m.field_provenance, "company_profile.employee_range": "explicit_user_request" as const },
  };
  return mergeCompanyBrainIntoMission(stated, { industries: ["b2b saas", "fintech"] } as never).mission;
})();

/** Rows shaped like the canary's harvestapi company records (full mode). */
const row = (slug: string, name: string, employeeCount: number) => ({
  id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}/`, website: `https://${slug}.com`,
  description: `${name} does something.`, employeeCount, employeeCountRange: { start: 11, end: 50 },
  industries: [{ id: 4, name: "Software Development" }],
  locations: [{ parsed: { text: "San Francisco, CA, United States", countryFull: "United States" }, country: "US", headquarter: true }],
});
const CANARY_ROWS = [row("bytebytego", "ByteByteGo", 86), row("psychology-today", "Psychology Today", 2135)];

type Triage = (i: { company_keys: string[] }) => Promise<unknown>;
function harness(rows: Record<string, unknown>[], triage?: Triage) {
  const sent: Array<{ actor: string; input: Record<string, unknown> }> = [];
  const calls = { planDiscovery: 0, controlRoutes: 0 };
  const byUrl = (u: string) => rows.find((r) => String(r.linkedinUrl).replace(/\/$/, "") === u.replace(/\/$/, ""));
  const deps = {
    ...(triage ? { triageCompanies: triage } : {}),
    planDiscovery: (x: unknown) => { calls.planDiscovery++; return (emptyDiscoverySelector() as (y: unknown) => unknown)(x); },
    planExecution: () => Promise.resolve({ reasoning: "replay", steps: [
      { capability: "general_company_discovery", actor_key: "apify_linkedin_company_search", purpose: "profile discovery",
        input: { industryIds: ["4", "6", "43"], locations: ["United States"], companySize: ["11-50"], maxItems: 20, scraperMode: "full" }, depends_on: [] },
      { capability: "company_identity_resolution", actor_key: "apify_linkedin_company_search", purpose: "only without a page", input: { searchQuery: "{{name}}", maxItems: 5 }, depends_on: [1] },
      { capability: "company_enrichment", actor_key: "apify_linkedin_company_details", purpose: "details", input: { companies: ["{{url}}"] }, depends_on: [2] },
      { capability: "company_brain_qualification", actor_key: null, purpose: "qualify", input: {}, depends_on: [3] },
      { capability: "persistence", actor_key: null, purpose: "save", input: {}, depends_on: [4] },
    ] }),
    controlRoutes: () => { calls.controlRoutes++; return Promise.resolve({ action: "continue" }); },
    invoke: (call: { actorKey: string; input: Record<string, unknown>; onProviderRun?: (r: { run_id: string; dataset_id: null }) => void }) => {
      sent.push({ actor: call.actorKey, input: call.input });
      call.onProviderRun?.({ run_id: `run-${sent.length}`, dataset_id: null });
      if (call.actorKey === "apify_linkedin_company_search") {
        return Promise.resolve(call.input.searchQuery ? [] : rows.slice(0, Number(call.input.maxItems ?? 2)));
      }
      if (call.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve(((call.input.companies as string[]) ?? []).map(byUrl).filter(Boolean));
      }
      throw new Error(`unexpected provider call: ${call.actorKey}`);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  };
  const budget = parseRunBudget({ provider_usd: 0.04, max_candidates: 2 })!;
  const opts = {
    mission: MISSION, plan: buildCapabilityGraph(MISSION, { executability: "enforce", readiness: PROBE }),
    maxCandidates: candidatePool(1, budget), runBudget: budget, readiness: PROBE,
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
    specMode: "enforce", specScope: { workspace_id: "ws-replay", lineage_id: "ln-replay" },
  };
  return { deps, opts, sent, calls };
}
const CRITERIA = deriveMissionCriteria(MISSION, PROBE);
// deno-lint-ignore no-explicit-any
type Grounded = Record<string, any>;
const grounded = (result: unknown): Grounded[] => (missionCandidatesFrom(result as never, { missionId: "t" }) as Grounded[])
  .map((c): Grounded => {
    const e = evaluateEligibility(CRITERIA, c.graph);
    return { ...c, eligibility: e.eligibility, hard_checks: (e.checks ?? []).filter((x) => x.kind === "hard"), attempted_routes: c.attempted_routes ?? [] };
  });

Deno.test("CANARY 87ecf153 REPLAY: out-of-range search rows reach enrichment, fail on the PROVEN count, and buy no Atomus", async () => {
  const h = harness(CANARY_ROWS);
  const result = await runCapabilityPlan(h.deps as never, h.opts as never) as unknown as { state: Record<string, any> };

  // Discovery ranked them down; it did not exclude them.
  for (const p of result.state.prequalification.companies) {
    assertEquals([p.size_status, p.exclusion, p.eligible], ["above_max", null, true], p.name);
    assert(p.reasons.some((r: string) => /ranked down, not excluded/.test(r)), p.reasons.join(" | "));
  }
  // Both reached enrichment, in one batched read.
  const details = h.sent.filter((s) => s.actor === "apify_linkedin_company_details");
  assertEquals(details.length, 1);
  assertEquals((details[0].input.companies as string[]).length, 2);

  // Size is decided on the enriched, PROVEN count — and fails.
  const cands = grounded(result);
  for (const c of cands) {
    const size = c.hard_checks.find((x: Grounded) => x.dimension === "company_size")!;
    assertEquals(size.result, "fail", c.name);
    const item = c.graph.claims.find((x: any) => x.dimension === "headcount").current;
    assertEquals([item.source.actor, item.status, item.authority?.rule],
      ["apify_linkedin_company_details", "proven", "li_record_exact_headcount"], c.name);
    assertEquals(c.eligibility, "ineligible", c.name);
  }
  // A failed candidate is never handed to the funding verifier.
  const atomus = verificationTargets({ route_actor: "apify_funding_atomus", max_targets: 6 }, cands as never,
    (id) => CRITERIA.find((c) => c.id === id)?.value, undefined, PROBE);
  assertEquals(atomus, []);
  assert(!h.sent.some((s) => s.actor === "apify_funding_atomus"));
});

Deno.test("CANARY 87ecf153 REPLAY: an in-range candidate from the same search is viable and reaches Atomus", async () => {
  const h = harness([row("inrange", "InRange Co", 30), ...CANARY_ROWS]);
  const result = await runCapabilityPlan(h.deps as never, h.opts as never);
  const cands = grounded(result);
  const viable = cands.find((c) => c.name === "InRange Co")!;
  assertEquals(viable.hard_checks.map((x: any) => [x.dimension, x.result]),
    [["geography", "pass"], ["company_size", "pass"], ["funding", "unknown"]]);
  const atomus = verificationTargets({ route_actor: "apify_funding_atomus", max_targets: 6 }, cands as never,
    (id) => CRITERIA.find((c) => c.id === id)?.value, undefined, PROBE);
  assertEquals(atomus.map((t) => t.name), ["InRange Co"]);
});

Deno.test("SPENT ALLOWANCE: no discovery planning in this slice, and a forced replenishment slice plans and buys nothing", async () => {
  const h = harness(CANARY_ROWS);
  const first = await runCapabilityPlan(h.deps as never, h.opts as never) as unknown as { state: Record<string, any> };
  assertEquals(first.state.discovery_rows_bought, 2);
  assertEquals(first.state.discovery_source_state.stop_reason, "candidate_budget_spent");
  assertEquals(first.state.discovery_source_state.exhausted, true, "run-agent reads this as: no discovery route remains");
  assertEquals([h.calls.planDiscovery, h.calls.controlRoutes], [0, 0], "no model call plans a wave that cannot be bought");

  // The canary's worker scheduled a replenishment slice anyway; it must plan nothing.
  const before = h.sent.length;
  h.calls.planDiscovery = 0; h.calls.controlRoutes = 0;
  await runCapabilityPlan(h.deps as never, {
    ...h.opts, state: first.state,
    discoveryReplenishment: { reason: "replenishment_required", sources_attempted: ["apify_linkedin_company_search"], pages_taken: { apify_linkedin_company_search: 1 } },
  } as never);
  assertEquals(h.sent.length - before, 0, "no provider call");
  assertEquals([h.calls.planDiscovery, h.calls.controlRoutes], [0, 0], "no discovery-planning model call");
});

// ═══════════════════════════════ MISSION TRIAGE RANKS; IT NEVER REJECTS ══
//
// Canary 2978a5ba (local, 2026-09-24): the model triaged both candidates
// `irrelevant` — on a PLAUSIBLE self-reported headcount, on evidence nobody had
// bought yet, and on a soft Company Brain industry preference — and that
// verdict removed them before enrichment. AI decides what to investigate; code
// decides what is true.

/** The canary's own triage answer, reason for reason. */
const irrelevantBecause = (reasons: (key: string) => string[]): Triage => ({ company_keys }) => Promise.resolve({
  verdicts: company_keys.map((k) => ({
    company_key: k, relevance: "irrelevant", confidence: 0.99, signal_strength: 5, matched_roles: [], reasons: reasons(k),
  })),
});
const CANARY_2978_ROWS = [row("deadline-com", "Deadline Hollywood", 190), row("how-to-ai-guide", "How to AI", 100)];
const CANARY_2978_TRIAGE = irrelevantBecause((k) => [
  `Self-reported employee count is ${k.includes("deadline") ? 190 : 100}, clearly outside the mission's required range of 11–50.`,
  "No explicit United States location or recent funding evidence is provided.",
  "Entertainment news media does not align with the mission's stated B2B SaaS or fintech preferences.",
]);

Deno.test("CANARY 2978a5ba REPLAY: both triaged `irrelevant` still reach enrichment; size is decided on the PROVEN count", async () => {
  const h = harness(CANARY_2978_ROWS, CANARY_2978_TRIAGE);
  const result = await runCapabilityPlan(h.deps as never, h.opts as never) as unknown as {
    state: Record<string, any>; companies: Array<Record<string, any>>;
  };
  for (const c of result.companies) {
    assertEquals(c.triage?.relevance, "irrelevant", "the verdict is kept, as a ranking signal");
    assertEquals([c.shortlisted, c.shortlist_exclusion], [true, null], c.company.company_name);
    assert(c.investigation_state !== "excluded_permanently", c.company.company_name);
  }
  const details = h.sent.filter((s) => s.actor === "apify_linkedin_company_details");
  assertEquals((details[0]?.input.companies as string[] | undefined)?.length, 2, "both enriched");
  for (const c of grounded(result)) {
    const headcount = c.graph.claims.find((x: Grounded) => x.dimension === "headcount").current;
    assertEquals([headcount.status, headcount.authority?.rule], ["proven", "li_record_exact_headcount"], c.name);
    assertEquals(c.hard_checks.find((x: Grounded) => x.dimension === "company_size")!.result, "fail", c.name);
    assertEquals(c.eligibility, "ineligible", c.name);
  }
  assertEquals(verificationTargets({ route_actor: "apify_funding_atomus", max_targets: 6 }, grounded(result) as never,
    (id) => CRITERIA.find((c) => c.id === id)?.value, undefined, PROBE), [], "failed candidates stop before Atomus");
});

Deno.test("TRIAGE: missing evidence and a soft Brain industry never reject — an in-range company still reaches Atomus", async () => {
  // Triage calls it irrelevant for exactly the two reasons that may only rank.
  const h = harness([row("inrange", "InRange Co", 30)], irrelevantBecause(() => [
    "No explicit United States location or recent funding evidence is provided.",
    "Does not align with the mission's stated B2B SaaS or fintech preferences.",
  ]));
  const result = await runCapabilityPlan(h.deps as never, h.opts as never) as unknown as { companies: Array<Record<string, any>> };
  assertEquals(result.companies[0].triage?.relevance, "irrelevant");
  assert(h.sent.some((s) => s.actor === "apify_linkedin_company_details"), "enriched");
  const [c] = grounded(result);
  assertEquals(c.hard_checks.map((x: Grounded) => [x.dimension, x.result]),
    [["geography", "pass"], ["company_size", "pass"], ["funding", "unknown"]]);
  assertEquals(verificationTargets({ route_actor: "apify_funding_atomus", max_targets: 6 }, [c] as never,
    (id) => CRITERIA.find((x) => x.id === id)?.value, undefined, PROBE).map((t) => t.name), ["InRange Co"],
    "viable on proven evidence, so it may reach Atomus whatever triage said");
});

Deno.test("TRIAGE: no model-backed relevance field can close a candidate — the shortlist excludes only on a deterministic disqualifier", async () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/_shared/leadInvestigationBudget.ts", import.meta.url));
  const body = src.slice(src.indexOf("export function buildSmartShortlist"), src.indexOf("// ─", src.indexOf("export function buildSmartShortlist")));
  assert(!/relevance === "irrelevant"[\s\S]{0,200}excluded\.push/.test(body), "an irrelevant verdict never pushes an exclusion");
  const pushes = [...body.matchAll(/excluded\.push\(\{[^}]*reason: ([^,}]+)/g)].map((m) => m[1].trim());
  assert(pushes.every((r) => !/triage/.test(r)), JSON.stringify(pushes));
});
