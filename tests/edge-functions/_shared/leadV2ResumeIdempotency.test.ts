// LEAD V2 RUN 4250f181 — A RESUMED MISSION CONTINUES FROM PROGRESS.
//
// Across five worker attempts the audited mission bought memo23 discovery seven
// times for 33 unique companies:
//
//   #10 dTKjqhRdrXbraA7Ur  ["SaaS","B2B SaaS"], industries B2B
//   #13 poa6rBspq8ChD8flC  the IDENTICAL compiled input, next slice — bought again
//   #1  ECCPnUcOMwc7EjDTR  ["B2B SaaS","business software"], min 5+
//   #20 eKQp7gjdoAuQSpjo2  ["B2B SaaS","business software"], min 1+ — attempt 1's
//                          question with a looser minimum; the same ten companies
//
// Pinned here: a finished run is re-read, not re-bought; the same discovery
// question is not asked twice in one lineage; a NEW question still runs.

import { assert, assertEquals, assertFalse, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { memo23QueryFamily, runCapabilityPlan, type CapabilityEngineDeps } from
  "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { recoverCompletedRuns } from "../../../supabase/functions/_shared/pendingRunRecovery.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

// The compiled inputs exactly as the ledger recorded them in run 4250f181.
const C1 = { mode: "companies", role: "marketing", batch: ["All Batches"], queries: ["B2B SaaS", "business software"],
  regions: ["United States of America"], isHiring: true, maxItems: 10, industries: ["All industries"], topCompany: false,
  enrichEmails: false, scrapeOpenJobs: true, maxEmployeeSize: "250", minEmployeeSize: "5+", scrapeFounderDetails: false };
const C10 = { mode: "companies", role: "marketing", queries: ["SaaS", "B2B SaaS"], regions: ["United States of America"],
  isHiring: true, maxItems: 10, industries: ["B2B"], enrichEmails: false, scrapeOpenJobs: true,
  maxEmployeeSize: "250", minEmployeeSize: "1+", scrapeFounderDetails: false };
const C14 = { mode: "companies", role: "marketing", batch: ["Winter 2025", "Spring 2025", "Winter 2026", "Spring 2026"],
  queries: ["B2B SaaS", "business software", "SaaS platform"], regions: ["United States of America"], isHiring: true,
  maxItems: 10, enrichEmails: false, scrapeOpenJobs: true, minEmployeeSize: "1+", scrapeFounderDetails: false };
const C17 = { mode: "companies", role: "marketing", batch: ["All Batches"], regions: ["United States of America"],
  isHiring: true, maxItems: 10, industries: ["B2B"], enrichEmails: false, scrapeOpenJobs: true,
  maxEmployeeSize: "250", minEmployeeSize: "1+", scrapeFounderDetails: false };
const C19 = { mode: "companies", role: "marketing", queries: ["B2B SaaS", "B2B software as a service"],
  regions: ["United States of America"], isHiring: true, maxItems: 10, enrichEmails: false, scrapeOpenJobs: true,
  maxEmployeeSize: "250", minEmployeeSize: "1+", scrapeFounderDetails: false };
const C20 = { mode: "companies", role: "marketing", queries: ["B2B SaaS", "business software"],
  regions: ["United States of America"], isHiring: true, maxItems: 10, enrichEmails: false, scrapeOpenJobs: true,
  maxEmployeeSize: "250", minEmployeeSize: "1+", scrapeFounderDetails: false };

Deno.test("the audited repeats are the same question; the audited adaptations are not", () => {
  assertEquals(memo23QueryFamily(C10), memo23QueryFamily({ ...C10 }), "#13 repeated #10 verbatim");
  assertEquals(memo23QueryFamily(C20), memo23QueryFamily(C1),
    "#20 is attempt 1's question — a looser minimum size and unstated defaults do not make it new");
  for (const [label, c] of [["#10", C10], ["#14", C14], ["#17", C17], ["#19", C19]] as const) {
    assertNotEquals(memo23QueryFamily(c), memo23QueryFamily(C1), `${label} asked something new and must still run`);
  }
});

Deno.test("finished ledger runs become adoption entries, one per question", () => {
  const rows = [
    { capability: "apify_yc_companies_memo23", provider_run_id: "dTKjqhRdrXbraA7Ur", dataset_id: "cjkiR8iFHNQbQqrb6",
      status: "succeeded", request_input: { input: C10 } },
    { capability: "apify_yc_companies_memo23", provider_run_id: "poa6rBspq8ChD8flC", dataset_id: "hcg3Mu1QtwDJHMGVv",
      status: "succeeded", request_input: { input: C10 } },
    { capability: "apify_linkedin_company_search", provider_run_id: "pending1", status: "started",
      request_input: { input: { searchQuery: "X" } } },
  ];
  const out = recoverCompletedRuns(rows as never);
  assertEquals(out.length, 1, "the duplicate purchase is one question; started runs are not completed");
  assertEquals(out[0].run_id, "dTKjqhRdrXbraA7Ur");
  assertEquals(out[0].provider, "apify_yc_companies_memo23");
});

// ── the engine, end to end ──────────────────────────────────────────────────

const YC_ROW = {
  name: "Lab0", website: "https://lab0.ai", teamSize: 5, batch: "Spring 2026",
  industries: ["B2B"], id: "lab0", regions: ["United States of America"],
  isHiring: true, openJobs: [{ title: "Founding Product Marketer (AI-native)" }],
} as unknown as Record<string, unknown>;

async function discover(state?: Record<string, unknown>) {
  const calls: Array<{ input: Record<string, unknown>; resumeRunId?: string }> = [];
  const m = parseLeadMissionDeterministic("Find 10 qualified AI startups in the US currently hiring");
  const run = await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector(),
    invoke: (call: CompiledActorCall<unknown> & { resumeRunId?: string }) => {
      if (call.actorKey === "apify_yc_companies_memo23") {
        calls.push({ input: call.input as Record<string, unknown>, resumeRunId: call.resumeRunId });
        return Promise.resolve([YC_ROW]);
      }
      return Promise.resolve([]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  } as unknown as CapabilityEngineDeps as never, {
    mission: m, plan: buildCapabilityGraph(m), maxCandidates: 20,
    readEnv: (k: string) => k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined,
    ...(state ? { state } : {}),
  } as never);
  return { run, calls };
}

Deno.test("a finished discovery run is re-read on resume, never bought again", async () => {
  const first = await discover();
  assert(first.calls.length > 0 && !first.calls[0].resumeRunId, "a fresh run buys");
  const completed = recoverCompletedRuns([{
    capability: "apify_yc_companies_memo23", provider_run_id: "RUN_ALREADY_PAID", dataset_id: "DS",
    status: "succeeded", request_input: { input: first.calls[0].input },
  }] as never);
  // A replenishment slice re-enters discovery: completed capabilities cleared.
  const again = await discover({
    ...first.run.state, completed_capabilities: [], discovery_source_state: undefined,
    completed_runs: completed, discovery_query_families: [],
  });
  const memo = again.calls.filter((c) => !!c.resumeRunId);
  assertEquals(memo.length >= 1, true, "the identical question adopts the paid run");
  assertEquals(memo[0].resumeRunId, "RUN_ALREADY_PAID");
  assert(again.run.state.provider_attempts.some((a) => a.outcome === "run_adopted"));
});

Deno.test("the same discovery question is not asked twice in one lineage", async () => {
  const first = await discover();
  const families = first.run.state.discovery_query_families ?? [];
  assert(families.length >= 1, "a question that ran is recorded");
  const again = await discover({
    ...first.run.state, completed_capabilities: [], discovery_source_state: undefined, completed_runs: [],
  });
  assertEquals(again.calls.length, 0, "no second purchase of the same question");
  assert(again.run.state.provider_attempts.some((a) => a.outcome === "skipped_repeat_query"));
  assertFalse(again.run.state.provider_attempts.some((a) =>
    a.provider === "apify_yc_companies_memo23" && a.outcome === "ok" && a.attempt > 1));
});
