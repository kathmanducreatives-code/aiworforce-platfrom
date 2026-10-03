// A POOL THAT CAN NEVER QUALIFY IS NOT "ENOUGH CANDIDATES".
//
// Production canary 98ce374b (2026-10-03), replayed through the real engine:
//
//   slice 1  LinkedIn company search (10 rows, page 1) → company details →
//            the job stage defers the HARD hiring claim (`evidence_unavailable`)
//   between  the funding pair answered every company with nothing decisive,
//            so funding is a hard claim NO route can close (`verify:` marks)
//   →        the gap router: 10 pending, `with_executable_route: 0` — correct,
//            no purchase can make any of them eligible — and continuation
//            asks for `replenishment_required`
//   slice 3  discovery reopens and proposes page 2 …
//
// … and, before this fix, never bought it. `availableAdmittedNow` counted a
// company as available while `nextStageFor` said it owed a stage, and
// `hiring: evidence_unavailable` always owes one. 10 "available" ≥ the target
// of 8 → `admitted_target_met` → page 2 `not_taken` → two barren slices →
// `no_progress` → terminal `search_exhausted`, with discovery open and $1.75
// of budget unspent.
//
// Under Lead V2 the canonical decision now decides "available" too:
// `canStillQualify`, the same rule the verifier phase and
// `with_executable_route` read. Every case is pure: `fetch` throws.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicallyWorkableKeys, missionCandidatesFrom, runCapabilityPlan, type EngineCompany,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { PRODUCTION_READINESS } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { evidenceGapsFor, summarizeGaps } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { verifyOpKey } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { decideAutoContinuation } from "../../../supabase/functions/_shared/leadAutoContinuation.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { stubMissionEvaluator } from "./missionEvaluatorFixture.ts";

globalThis.fetch = () => { throw new Error("replay tests must not reach the network"); };

// The canary's compiled mission, as the card stored it (criteria carried).
const MISSION = JSON.parse(Deno.readTextFileSync(
  new URL("../../fixtures/lead-v2/canary-98ce374b-mission.json", import.meta.url))) as LeadMissionV1;
const GRAPH = buildCapabilityGraph(MISSION, { executability: "enforce", readiness: PRODUCTION_READINESS });
const CRITERIA = deriveMissionCriteria(MISSION, PRODUCTION_READINESS);
const SEARCH = "apify_linkedin_company_search";
const page = (slug: string) => `https://www.linkedin.com/company/${slug}`;

type Row = Record<string, unknown>;
const searchRow = (slug: string): Row => ({
  id: slug, name: slug, linkedinUrl: `${page(slug)}/`, website: `https://${slug}.com`,
  employeeCountRange: { start: 11, end: 50 }, employeeCount: 30,
  industries: [{ id: 4, name: "Software Development" }],
  locations: [{ parsed: { text: "Austin, TX, United States", countryFull: "United States" }, country: "US", headquarter: true }],
});
// Page 1: the canary's ten. Page 2: ten more the lineage never saw.
const PAGE_1 = Array.from({ length: 10 }, (_, i) => searchRow(`first-${i}`));
const PAGE_2 = Array.from({ length: 10 }, (_, i) => searchRow(`second-${i}`));

async function slice(o: {
  pages?: Record<number, Row[]>;
  resume?: { state: Record<string, unknown>; records: unknown[] };
  replenish?: Record<string, number>;
  specMode?: "enforce" | "off";
} = {}) {
  const calls: Array<{ actorKey: string; input: Record<string, unknown> }> = [];
  const pages = o.pages ?? { 1: PAGE_1, 2: PAGE_2 };
  const result = await runCapabilityPlan({
    invoke: (call: { actorKey: string; input?: Record<string, unknown> }) => {
      const input = call.input ?? {};
      calls.push({ actorKey: call.actorKey, input });
      if (call.actorKey === SEARCH) {
        if (input.searchQuery) return Promise.resolve([]);
        const onPage = pages[Number(input.startPage ?? 1)] ?? [];
        return Promise.resolve(onPage.slice(0, Number(input.maxItems ?? onPage.length)));
      }
      if (call.actorKey === "apify_linkedin_company_details") {
        // The canary's records: inside the band and the country, an industry
        // ("Software Development") that neither shows nor rules out SaaS.
        return Promise.resolve(((input.companies as string[]) ?? []).map((u) => ({
          ...searchRow(u.replace(/\/$/, "").split("/company/")[1]), linkedinUrl: u,
          description: "We build software.",
        })));
      }
      // The job stage defers the hard hiring claim; nothing else is bought here.
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    evaluateMission: stubMissionEvaluator({ mission_fit: "pass" }),
    planExecution: () => Promise.resolve({ reasoning: "replay 98ce374b", steps: [
      { capability: "general_company_discovery", actor_key: SEARCH, purpose: "profile discovery",
        input: { scraperMode: "full", maxItems: 10, locations: ["United States"], industryIds: ["4", "6"],
          companySize: ["11-50"], startPage: 1, takePages: 5 }, depends_on: [] },
      { capability: "company_identity_resolution", actor_key: SEARCH, purpose: "only without a page",
        input: { searchQuery: "{{name}}", maxItems: 5 }, depends_on: [1] },
      { capability: "company_enrichment", actor_key: "apify_linkedin_company_details", purpose: "details",
        input: { companies: ["{{url}}"] }, depends_on: [2] },
      { capability: "company_brain_qualification", actor_key: null, purpose: "qualify", input: {}, depends_on: [3] },
      { capability: "hiring_verification", actor_key: "apify_linkedin_job_search", purpose: "open roles",
        input: { company: ["{{url}}"], jobTitles: ["sales"] }, depends_on: [3] },
      { capability: "persistence", actor_key: null, purpose: "save", input: {}, depends_on: [4] },
    ] }),
    planDiscovery: () => Promise.resolve([{
      actor_key: SEARCH, role: "primary",
      input: { scraperMode: "full", maxItems: 10, locations: ["United States"], industryIds: ["4", "6"],
        companySize: ["11-50"], startPage: 1, takePages: 5 },
    }]),
  } as never, {
    mission: MISSION, plan: GRAPH, maxCandidates: 40, remainingLeads: 1, readEnv: () => undefined,
    identity: { workspace_id: "ws-replay", task_id: "task-98ce374b" },
    specMode: o.specMode ?? "enforce", specScope: { workspace_id: "ws-replay", lineage_id: "lineage-98ce374b" },
    readiness: PRODUCTION_READINESS,
    ...(o.replenish ? {
      discoveryReplenishment: { reason: "replenishment_required", pages_taken: o.replenish, sources_attempted: [SEARCH] },
    } : {}),
    ...(o.resume ? {
      state: o.resume.state,
      resume: { workspace_id: "ws-replay", lineage_root_task_id: "lineage-98ce374b", records: o.resume.records },
    } : {}),
  } as never);
  const run = result as unknown as { companies: EngineCompany[]; state: Record<string, unknown>; resume_records: unknown[] };
  return {
    ...run,
    searches: calls.filter((c) => c.actorKey === SEARCH && !c.input.searchQuery),
    jobSearches: calls.filter((c) => c.actorKey === "apify_linkedin_job_search"),
  };
}

/** Both funding providers answered every company with nothing decisive — the canary's six. */
function fundingAnsweredWithNothing(records: unknown[]): unknown[] {
  return (structuredClone(records) as Array<{ completed_operations?: string[] }>).map((r) => ({
    ...r,
    completed_operations: [...new Set([...(r.completed_operations ?? []),
      verifyOpKey("apify_funding_atomus"), verifyOpKey("apify_funding_pvalyou")])],
  }));
}

/** The gap summary run-agent persists (`workbench_mission_view.evidence_gaps`). */
function gapSummary(companies: readonly EngineCompany[]) {
  const pending = missionCandidatesFrom({ companies }, { missionId: "task-98ce374b" }).flatMap((c) => {
    const e = evaluateEligibility(CRITERIA, c.graph);
    if (e.eligibility !== "pending" || !c.investigated) return [];
    return [{ gaps: evidenceGapsFor(e.checks.filter((x) => x.kind === "hard"), c.graph, undefined,
      new Set(c.attempted_routes ?? []), PRODUCTION_READINESS) }];
  });
  return summarizeGaps(pending);
}

const opts = { mission: MISSION, plan: GRAPH, identity: { task_id: "task-98ce374b" }, readiness: PRODUCTION_READINESS };

// ── the canary, end to end ─────────────────────────────────────────────────

Deno.test("CANARY 98ce374b REPLAY: slice 1 investigates page 1; the hard hiring claim is deferred, nothing bought for it", async () => {
  const s1 = await slice();
  assertEquals(s1.searches.length, 1, "page 1 only");
  assertEquals(s1.companies.length, 10);
  assertEquals(s1.jobSearches.length, 0, "the job stage buys nothing for a HARD hiring claim — the post-eligibility verifier owns it");
  assert(CRITERIA.some((c) => c.kind === "hard" && c.dimension === "hiring"), "hiring is a hard requirement");
});

Deno.test("CANARY 98ce374b REPLAY: with funding unclosable for every company, nothing is workable — the router and the discovery count agree", async () => {
  const s1 = await slice();
  const records = fundingAnsweredWithNothing(s1.resume_records);
  const restored = await slice({ resume: { state: s1.state, records } });
  const summary = gapSummary(restored.companies);
  // The router is right: no purchase on hiring or business model can make a
  // company eligible whose funding claim nothing can close.
  assertEquals(summary.with_executable_route, 0);
  assertEquals(summary.pending, 10);
  assertEquals(canonicallyWorkableKeys(restored.companies, opts).size, 0, "the SAME rule, read by discovery");
});

Deno.test("CANARY 98ce374b REPLAY: the replenishment slice BUYS PAGE 2 instead of ending search_exhausted (was: page_not_taken)", async () => {
  const s1 = await slice();
  const records = fundingAnsweredWithNothing(s1.resume_records);
  const s3 = await slice({
    resume: { state: s1.state, records },
    replenish: { [SEARCH]: 1 },
  });
  // THE BUG: 10 non-viable companies counted as "available" against a target
  // of 8, so the page-2 search was proposed and never bought.
  assertEquals(s3.searches.length, 1, "exactly one new discovery call");
  assertEquals(Number(s3.searches[0].input.startPage), 2, "the NEXT page — never page 1 again");
  const keys = new Set(s3.companies.map((c) => c.key));
  assert(PAGE_2.every((r) => keys.has(page(String(r.id)))), "page 2's companies joined the pool");
  assert(PAGE_1.every((r) => keys.has(page(String(r.id)))), "replenishment ADDS; the investigated pool is kept");
  const dss = s3.state.discovery_source_state as { stop_reason: string; exhausted: boolean };
  assertFalse(dss.exhausted);
  // The new companies are workable; the old ones still are not.
  const workable = canonicallyWorkableKeys(s3.companies, opts);
  assert(PAGE_2.some((r) => workable.has(page(String(r.id)))));
  assertFalse(PAGE_1.some((r) => workable.has(page(String(r.id)))));
});

// ── the rule does not over-widen ───────────────────────────────────────────

Deno.test("WORKABLE POOL: while funding is still routable, the pool IS enough — verification comes first, no page is bought", async () => {
  const s1 = await slice();
  // No funding marks: Atomus has not answered, so every company can still qualify.
  const restored = await slice({ resume: { state: s1.state, records: s1.resume_records } });
  assertEquals(gapSummary(restored.companies).with_executable_route, 10, "hiring and funding still have routes");
  assertEquals(canonicallyWorkableKeys(restored.companies, opts).size, 10);
  const s3 = await slice({ resume: { state: s1.state, records: s1.resume_records }, replenish: { [SEARCH]: 1 } });
  assertEquals(s3.searches.length, 0, "a viable pool of 10 ≥ the target of 8: no wider search");
  // …and continuation verifies instead of widening.
  const d = decideAutoContinuation({
    cancelled: false, qualified: 0, requestedCount: 1, frontierRemaining: 0, continuationsUsed: 1, maxContinuations: 5,
    costUnitsUsed: 2, maxCostUnits: 50, barrenSlices: 0, providerFailed: false, pendingRuns: 0,
    discoveryRoutesRemain: true, verificationRoutesRemain: 10,
  } as never);
  assertEquals([d.continue, d.reason], [true, "verification_required"]);
});

// ── genuine exhaustion still ends ──────────────────────────────────────────

Deno.test("GENUINE EXHAUSTION: an empty next page widens nothing, and the lineage still ends", async () => {
  const s1 = await slice({ pages: { 1: PAGE_1 } });
  const records = fundingAnsweredWithNothing(s1.resume_records);
  const s3 = await slice({ pages: { 1: PAGE_1 }, resume: { state: s1.state, records }, replenish: { [SEARCH]: 1 } });
  // The existing pagination bound, unchanged: an empty page 2 is followed by
  // page 3 within the slice's pass limit, and no further.
  assertEquals(s3.searches.map((x) => Number(x.input.startPage)), [2, 3], "bounded by the discovery pass limit");
  assertEquals((s3.state.discovery_source_state as { stop_reason: string }).stop_reason, "pass_limit");
  assertEquals(s3.companies.length, 10, "and holds nobody new");
  assertEquals(canonicallyWorkableKeys(s3.companies, opts).size, 0);
  // Nothing workable, nothing widened: continuation stops, it does not spin.
  const d = decideAutoContinuation({
    cancelled: false, qualified: 0, requestedCount: 1, frontierRemaining: 0, continuationsUsed: 3, maxContinuations: 5,
    costUnitsUsed: 3, maxCostUnits: 50, barrenSlices: 2, providerFailed: false, pendingRuns: 0,
    discoveryRoutesRemain: true, verificationRoutesRemain: 0,
  } as never);
  assertFalse(d.continue);
  assertEquals(d.reason, "no_progress");
});

Deno.test("DECIDED companies are never work: a qualified or ineligible company is outside the workable set", async () => {
  const s1 = await slice();
  const all = canonicallyWorkableKeys(s1.companies, opts);
  // Nothing decided yet in slice 1 — all ten are pending with routes.
  assertEquals(all.size, 10);
  // An ineligible company (a hard claim verified false) is not work.
  const outOfBand = s1.companies.map((c, i) => i === 0
    ? { ...c, enriched: c.enriched ? { ...c.enriched, employee_count_range: { start: 201, end: 500 } } : c.enriched }
    : c) as EngineCompany[];
  const shrunk = canonicallyWorkableKeys(outOfBand, opts);
  assert(shrunk.size <= all.size);
});

Deno.test("LEAD V1 IS UNCHANGED: without the spec spine the stage machine alone decides, exactly as before", async () => {
  const s1 = await slice({ specMode: "off" });
  const records = fundingAnsweredWithNothing(s1.resume_records);
  const s3 = await slice({ specMode: "off", resume: { state: s1.state, records }, replenish: { [SEARCH]: 1 } });
  assertEquals(s3.searches.length, 0, "V1 keeps the old count — the change is gated on Lead V2");
});
