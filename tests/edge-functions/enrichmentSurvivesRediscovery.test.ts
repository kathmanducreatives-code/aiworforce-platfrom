// PHASE 3 — A COMPANY IS ENRICHED ONCE PER LINEAGE, NOT ONCE PER SLICE.
//
// ── THE RUNS THIS EXISTS FOR ───────────────────────────────────────────────
//
// Every duplicate paid Apify call in the four days to 2026-09-04 was
// `apify_linkedin_company_details`, and the count tracked how many times the
// lineage re-ran discovery:
//
//     b1348724   5 searches   7+4+4+3+2 duplicate runs
//     2f3d9c5c   4 searches   5+5+3+2   duplicate runs
//     8cfdfd10   3 searches   2         duplicate runs
//     610951da   1 search     none
//
// `company_enrichment` selects on `!c.enriched`. There are two restore paths:
// `restoreWorkingSet`, taken when discovery is SKIPPED, assigned `c.enriched`
// from the snapshot; `restoreFromResume`, taken when discovery RE-RUNS and
// rebuilds the working set from the provider, did not. So a rediscovered
// company arrived enriched-looking-unenriched and its batch was bought again,
// once per continuation.
//
// The internal ledger deduplicated on `logical_call_key` and escalated
// `attempt_number`, so no credit was double-charged and the ACCOUNTING looked
// clean. Apify billed every run. This test is about the DISPATCH.
//
// ZERO network, ZERO DB, ZERO model, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runCapabilityPlan } from "../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../../supabase/functions/_shared/leadMission.ts";
import { stubMissionEvaluator } from "./_shared/missionEvaluatorFixture.ts";
import type { LeadMissionV1 } from "../../supabase/functions/_shared/leadMission.ts";
import type { CompiledActorCall } from "../../supabase/functions/_shared/hiringActorInputs.ts";
import type { CompanyResumeRecord } from "../../supabase/functions/_shared/leadResumeState.ts";

const CANONICAL =
  "Find B2B SaaS companies in the United Kingdom hiring sales representatives. " +
  "Return 5 qualified leads.";

const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(CANONICAL);
  return {
    ...m, requested_count: 5,
    company_profile: { ...m.company_profile, employee_range: { min: 20, max: 200 } },
  };
};

const BRAIN = {
  employee_min: 20, employee_max: 200,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
} as never;

const NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
const urlFor = (n: string) => `https://www.linkedin.com/company/${n.toLowerCase()}`;

const row = (n: string) => ({
  companyName: n,
  linkedinUrl: urlFor(n),
  website: `https://${n.toLowerCase()}.com`,
  employeeCount: 60,
  description: `${n} is a B2B SaaS platform sold on subscription.`,
});

/**
 * A company a PREVIOUS generation already paid to enrich.
 *
 * The snapshot is the part that matters: it is what the checkpoint carries and
 * what `restoreFromResume` reads. `enrichment: "completed"` alone is a STAGE
 * label — the engine selects on the payload, not the label, which is why the
 * label being right the whole time never stopped the re-buy.
 */
const alreadyEnriched = (name: string): CompanyResumeRecord => ({
  // KEYED THE WAY THE ENGINE KEYS. `companyKey` is the lowercased
  // `linkedin_company_url`, not the name; a record filed under the name is a
  // record `restoreFromResume` never finds.
  company_key: urlFor(name),
  company_name: name,
  identity: "resolved",
  enrichment: "completed",
  hiring: "not_started",
  brain: "not_started",
  founder: "not_started",
  completed_operations: [],
  linkedin_company_url: urlFor(name),
  snapshot: {
    company: row(name),
    yc_open_jobs: [],
    prequalified: null,
    prequal_key: null,
    shortlisted: true,
    investigation_state: "investigated",
    investigation_rank: 1,
    triage: null,
    identity: {
      status: "verified_match",
      linkedin_company_url: urlFor(name),
      company_name: name,
    },
    // THE PAID ROW. This is what a second purchase would buy again.
    enriched: {
      companyName: name,
      linkedinUrl: urlFor(name),
      employeeCount: 60,
      description: `${name} is a B2B SaaS platform sold on subscription.`,
    },
    enrichment_outcome: "success",
    hiring_assessment: null,
    hiring_jobs: [],
    brain: null,
    mission_evaluation: null,
  },
} as unknown as CompanyResumeRecord);

interface Call { actorKey: string; input: Record<string, unknown> }

/**
 * One continuation slice in which DISCOVERY RE-RUNS.
 *
 * That is the whole point: passing resume records without a restorable
 * checkpoint working set is exactly the shape that sends the engine down
 * `restoreFromResume` rather than `restoreWorkingSet`.
 */
async function slice(records: CompanyResumeRecord[]) {
  const calls: Call[] = [];
  await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      calls.push({
        actorKey: call.actorKey,
        input: (call as unknown as { input: Record<string, unknown> }).input,
      });
      return Promise.resolve(NAMES.map(row) as Record<string, unknown>[]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    evaluateMission: stubMissionEvaluator({ mission_fit: "review" }),
    planDiscovery: () => Promise.resolve([{
      actor_key: "apify_linkedin_company_search", role: "primary",
      input: { searchQuery: "B2B SaaS", locations: ["United Kingdom"] },
    }]),
  } as never, {
    mission: mission(),
    plan: buildCapabilityGraph(mission() as never),
    brain: BRAIN, maxCandidates: 50, remainingLeads: 5,
    readEnv: () => undefined,
    resume: {
      workspace_id: "ws-test",
      lineage_root_task_id: "lineage-test",
      records,
    },
  } as never);
  return calls;
}

/** Every LinkedIn URL this slice actually sent to the details actor. */
const detailUrlsIn = (calls: Call[]): string[] => {
  const out: string[] = [];
  for (const c of calls) {
    if (c.actorKey !== "apify_linkedin_company_details") continue;
    for (const v of Object.values(c.input ?? {})) {
      if (Array.isArray(v)) {
        for (const u of v) if (typeof u === "string" && u.includes("linkedin.com")) out.push(u);
      }
    }
  }
  return out;
};

Deno.test("THE RE-BUY: a rediscovered company is not enriched twice", async () => {
  const enrichedAlready = NAMES.slice(0, 3);
  const calls = await slice(enrichedAlready.map(alreadyEnriched));

  const bought = detailUrlsIn(calls);
  const rebought = enrichedAlready.map(urlFor).filter((u) => bought.includes(u));

  assertEquals(
    rebought,
    [],
    "these companies were enriched and checkpointed by an earlier generation; " +
      "buying them again is the b1348724 leak — Apify bills every run while " +
      "the ledger escalates `attempt_number` and reports no duplicate",
  );
});

Deno.test("companies NOT yet enriched are still bought", async () => {
  // The guard must not become "never enrich after a resume". A lineage that
  // rediscovers new companies has to pay for them; only the already-bought
  // rows are spared.
  const calls = await slice(NAMES.slice(0, 3).map(alreadyEnriched));
  const bought = detailUrlsIn(calls);
  const fresh = NAMES.slice(3).map(urlFor);

  assert(
    fresh.some((u) => bought.includes(u)),
    "a company no generation has enriched must still be enriched; " +
      `bought = [${bought.join(", ")}]`,
  );
});

Deno.test("a record with a stage label but NO payload is still bought", async () => {
  // The engine selects on the PAYLOAD, not the stage label. A record claiming
  // `enrichment: "completed"` while carrying no enriched row describes a
  // company nothing was learned about; skipping it would strand it empty
  // forever — the "proven negative" the restore path was always careful about.
  const labelOnly = {
    ...alreadyEnriched("Alpha"),
    snapshot: {
      ...(alreadyEnriched("Alpha") as unknown as { snapshot: Record<string, unknown> })
        .snapshot,
      enriched: null,
    },
  } as unknown as CompanyResumeRecord;

  const bought = detailUrlsIn(await slice([labelOnly]));
  assert(
    bought.includes(urlFor("Alpha")),
    "a label without a payload must not skip the purchase",
  );
});
