// THE 84 PAID JOB ROWS THAT REACHED THE ENGINE AND ANSWERED NOBODY.
//
// ── THE RUN ──────────────────────────────────────────────────────────────────
//
// Task a76c7b4c-86b4-4171-b0cf-22991e59c267, 2026-08-29. "Find 5 recruiting or
// staffing companies that fit my ICP and are actively hiring sales roles."
// Fifty companies discovered, five identities resolved and enriched, two paid
// `harvestapi/linkedin-job-search` calls — both SUCCEEDED, in the same slice:
//
//   trO1fr5ug9QypaIeg   7 rows  sotalentjobs, storm4, atlas-search
//   4FMrYDNdMXzZ8ffYz  77 rows  storm3, pursuit-sales-solutions
//
// `capability_execution_state.provider_attempts` records `rows: 7` and
// `rows: 77`, outcome `ok`, for `hiring_verification`. The engine RECEIVED all
// eighty-four. It then reported:
//
//   hiring_verification            rows 0  "no company had a relevant commercial role"
//   company_brain_qualification    rows 0  "the eligible set was empty"
//
// and resolved all five companies to `hiring: "not_verified"`. Nothing
// qualified. Three of those five are hiring Account Executives and SDRs right
// now, in the dataset the run paid for.
//
// ── WHY EVERY EXISTING TEST PASSES ───────────────────────────────────────────
//
// The engine routes a job row to a company by the URL the row names:
//
//     normalizeLinkedInJob(raw).company_linkedin_url  →  byUrl.get(...)
//
// and `normalizeLinkedInJob` reads it from `raw.company.linkedinUrl` — the
// nested object `hiringActorCatalog` documents this Actor as emitting:
// `company{id,name,linkedinUrl,website}`.
//
// Every engine test in this suite hands the engine that nested shape.
// PRODUCTION DOES NOT. `runTool("source_with_apify")` maps every dataset row
// through `normalizeApifyItem` before the invoker ever sees it, and for a jobs
// source that calls `normalizeApifyJobRow` — a projection written, in its own
// opening comment, for `curious_coder/linkedin-jobs-scraper`. That Actor emits
// FLAT fields: `companyName`, `companyLinkedinUrl`, `link`. harvestapi nests
// the same facts under `company{...}`, so every company read misses:
//
//     firstStr(r.companyName, r.company, ...)  →  r.company is an object → null
//
// The row that reaches the engine keeps its `title` and its `id` and nothing
// else that matters: `company` is null, `company_linkedin_url` is null,
// `job_url` is null. The join then finds no owner for any row, and all
// eighty-four are dropped as belonging to no company in the batch.
//
// This file therefore refuses to mock the layer that broke. The rows below are
// the real datasets; the state is the real checkpoint; and the transport is
// `normalizeApifyItem` itself — the same function the live edge function runs.
//
// NO NETWORK, NO SPEND, NO MODEL CALL.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  RUN_A76C7B4C_BATCHES, RUN_A76C7B4C_ROWS, type FrozenJobRow,
} from "../../fixtures/runA76c7b4cJobRows.ts";
import {
  RUN_A76C7B4C_MISSION, RUN_A76C7B4C_RESUME_RECORDS,
} from "../../fixtures/runA76c7b4cResumeState.ts";
import { normalizeApifyItem } from "../../../supabase/functions/_shared/toolRegistry.ts";
import {
  jobRowsLookIntact, readProviderResultItems,
} from "../../../supabase/functions/_shared/providerResponseContract.ts";
import {
  normalizeLinkedInJob,
} from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import {
  normalizeCompanyLinkedInUrl,
} from "../../../supabase/functions/_shared/structuredCompanyEnrichment.ts";
import {
  assessHiring,
} from "../../../supabase/functions/_shared/commercialSignalPolicy.ts";
import {
  buildQualificationContext,
} from "../../../supabase/functions/_shared/missionQualificationContext.ts";
import {
  missionHash, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  newExecutionState, runCapabilityPlan,
  type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubMissionEvaluator } from "./missionEvaluatorFixture.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

const MISSION = RUN_A76C7B4C_MISSION as LeadMissionV1;

/**
 * WHAT THE EDGE FUNCTION ACTUALLY HANDS THE ENGINE.
 *
 * The capability invoker sends no `source_type`, so `execSourceWithApify`
 * defaults it to `"jobs"`, `isJobs` is true, and every row is projected through
 * this before `readProviderResultItems` returns it. One function, called the
 * same way here as there.
 */
const asTransportRow = (r: FrozenJobRow) =>
  normalizeApifyItem(r, "jobs") as Record<string, unknown>;

/**
 * THE WHOLE SEAM, END TO END, WITH NOTHING STUBBED BETWEEN.
 *
 * `execSourceWithApify` builds this envelope: the legacy flat projection under
 * `items`, the dataset untouched under `job_items`. `buildInvoker` then reads
 * it through `readProviderResultItems` with `providerRows: true`, because the
 * capability engine owns a normalizer per Actor. Both halves are the real
 * functions, called the way production calls them.
 */
const deliverToEngine = (rows: readonly FrozenJobRow[]) =>
  readProviderResultItems({
    items: rows.map(asTransportRow),
    job_items: rows as unknown as Record<string, unknown>[],
  }, "jobs", { providerRows: true });

/** The same envelope a deployment WITHOUT `job_items` produces. */
const deliverLegacyOnly = (rows: readonly FrozenJobRow[]) =>
  readProviderResultItems({ items: rows.map(asTransportRow) }, "jobs", { providerRows: true });

/** The engine's own join, lifted verbatim from `hiring_verification`. */
function routeToCompanies(
  rows: readonly Record<string, unknown>[], companies: readonly string[],
): Map<string, number> {
  const byUrl = new Map<string, string>();
  for (const u of companies) {
    const k = normalizeCompanyLinkedInUrl(u);
    if (k) byUrl.set(k, u);
  }
  const out = new Map<string, number>();
  for (const raw of rows) {
    const j = normalizeLinkedInJob(raw);
    const owner = j.company_linkedin_url ? byUrl.get(j.company_linkedin_url) : undefined;
    if (!owner) continue;
    out.set(owner, (out.get(owner) ?? 0) + 1);
  }
  return out;
}

/** Both paid calls, routed the way the engine routes them. */
function routeWholeRun(project: (r: FrozenJobRow) => Record<string, unknown>) {
  const routed = new Map<string, FrozenJobRow[]>();
  let dropped = 0;
  for (const batch of RUN_A76C7B4C_BATCHES) {
    const rows = RUN_A76C7B4C_ROWS.filter(
      (r) => batch.companies.includes(r.company.linkedinUrl ?? ""));
    const byUrl = new Map<string, string>();
    for (const u of batch.companies) {
      const k = normalizeCompanyLinkedInUrl(u);
      if (k) byUrl.set(k, u);
    }
    for (const r of rows) {
      const j = normalizeLinkedInJob(project(r));
      const owner = j.company_linkedin_url ? byUrl.get(j.company_linkedin_url) : undefined;
      if (!owner) { dropped++; continue; }
      routed.set(owner, [...(routed.get(owner) ?? []), r]);
    }
  }
  return { routed, dropped };
}

// ═══════════════════════════════ 1. the shape the transport really produces ══

Deno.test("1. the legacy jobs projection must read the shape harvestapi sends", () => {
  const raw = RUN_A76C7B4C_ROWS[0];
  assertEquals(typeof raw.company, "object",
    "the Actor emits company as an object — hiringActorCatalog documents " +
    "company{id,name,linkedinUrl,website} as this Actor's output contract");
  assert(raw.company.linkedinUrl, "and it carries the URL the engine routes on");

  // `items` still exists and is still what the company-first path, the
  // Workbench, the CSV export and memory read. It was returning a row with no
  // company, no URL, no website and no location for EVERY harvestapi job —
  // a live defect on that path independent of the engine.
  const wire = asTransportRow(raw);
  assertEquals(wire.title, raw.title);
  assertEquals(wire.company, raw.company.name, "the company must be named");
  assertEquals(wire.company_linkedin_url, raw.company.linkedinUrl,
    "and its LinkedIn URL carried");
  assertEquals(wire.location, raw.location.linkedinText, "and the job's location");
  assertEquals(wire.job_url, raw.linkedinUrl,
    "and the posting's own URL — accepted only because the path says /jobs/");
});

Deno.test("1b. and a flat-dialect row still normalizes exactly as it did", () => {
  // `curious_coder/linkedin-jobs-scraper`, the dialect this module was written
  // for. Nothing above may change what it produces.
  const flat = {
    companyName: "Gumloop", title: "Account Executive",
    companyLinkedinUrl: "https://www.linkedin.com/company/gumloop",
    companyWebsite: "https://gumloop.com", link: "https://www.linkedin.com/jobs/view/1",
    location: "San Francisco, CA", companyEmployeeCount: 50, postedDate: "2026-08-20",
  };
  const w = normalizeApifyItem(flat, "jobs") as Record<string, unknown>;
  assertEquals(w.company, "Gumloop");
  assertEquals(w.company_linkedin_url, "https://www.linkedin.com/company/gumloop");
  assertEquals(w.company_website, "https://gumloop.com");
  assertEquals(w.job_url, "https://www.linkedin.com/jobs/view/1");
  assertEquals(w.location, "San Francisco, CA");
  assertEquals(w.employee_count, 50);
});

// ══════════════════════════════════════ 2. the data and the join are both fine ══

Deno.test("2. on the Actor's own row shape all 84 rows route to their company", () => {
  const { routed, dropped } = routeWholeRun((r) => r as unknown as Record<string, unknown>);
  assertEquals(dropped, 0, "no paid row belongs to nobody");
  assertEquals(
    [...routed.entries()].map(([k, v]) => [k, v.length]).sort(),
    [
      ["https://www.linkedin.com/company/atlas-search", 1],
      ["https://www.linkedin.com/company/pursuit-sales-solutions", 73],
      ["https://www.linkedin.com/company/sotalentjobs", 1],
      ["https://www.linkedin.com/company/storm3", 4],
      ["https://www.linkedin.com/company/storm4", 5],
    ].sort(),
  );
});

Deno.test("3. and the assessor verifies three of the five on those rows", () => {
  const ctx = buildQualificationContext(MISSION);
  const { routed } = routeWholeRun((r) => r as unknown as Record<string, unknown>);
  const verdicts = new Map<string, string>();
  for (const [url, rows] of routed) {
    const a = assessHiring(
      rows.map((r) => ({ title: r.title, url: r.linkedinUrl, location: r.location.linkedinText })),
      ["another_active_gtm_opening"],
      { source: "external_job_search", vocab: ctx.role_vocabulary },
    );
    verdicts.set(url, a.verdict);
  }
  assertEquals(verdicts.get("https://www.linkedin.com/company/pursuit-sales-solutions"),
    "hiring_verified", "73 rows including Sales Development Representative and Account Executive");
  assertEquals(verdicts.get("https://www.linkedin.com/company/storm3"), "hiring_verified",
    "Enterprise Account Executive, Sales Director, Chief Revenue Officer");
  assertEquals(verdicts.get("https://www.linkedin.com/company/storm4"), "hiring_verified",
    "Inside Sales Representative");
  // The other two are correctly NOT verified — a fix that verified everyone
  // would be worth nothing.
  assertEquals(verdicts.get("https://www.linkedin.com/company/atlas-search"), "watch");
  assertEquals(verdicts.get("https://www.linkedin.com/company/sotalentjobs"), "watch");
});

// ═════════════════════════════════ 4. the same rows, over the real transport ══

Deno.test("4. REPLAY: the same 84 rows, delivered the way production delivers them", () => {
  const rows = deliverToEngine(RUN_A76C7B4C_ROWS);
  assertEquals(jobRowsLookIntact(rows).intact, true,
    "the engine must not be handed rows that were already flattened");

  const { routed, dropped } = routeWholeRun(
    (r) => deliverToEngine([r])[0]);
  assertEquals(dropped, 0,
    "every paid row must reach its company — production dropped all 84");
  assertEquals([...routed.keys()].length, 5);
});

Deno.test("4b. and a response with no `job_items` is REPORTED, never silently empty", () => {
  const rows = deliverLegacyOnly(RUN_A76C7B4C_ROWS);
  const shape = jobRowsLookIntact(rows);
  assertEquals(shape.intact, false,
    "the fallback to `items` is silent; this is what makes it visible");
  assert(shape.reason?.includes("normalizeApifyJobRow"));
  // And it really would have been empty — this is the production failure.
  const { dropped } = routeWholeRun((r) => deliverLegacyOnly([r])[0]);
  assertEquals(dropped, 84, "which is exactly how task a76c7b4c lost its evidence");
});

// ══════════════════════════ 5. and through the real engine, on the real state ══

/**
 * The engine, resumed from task a76c7b4c's own checkpoint.
 *
 * `state` says discovery, identity resolution and enrichment are done — which
 * they were, and paid for — so `restoreWorkingSet` rebuilds the five companies
 * from their persisted snapshots and execution begins at `hiring_verification`.
 * The only thing mocked is the network: `invoke` returns the frozen dataset,
 * projected by whichever transport the caller passes in.
 */
async function replayHiringStage(
  project: (rows: readonly FrozenJobRow[]) => Record<string, unknown>[],
) {
  const plan = buildCapabilityGraph(MISSION);
  const state = newExecutionState(plan, await missionHash(MISSION));
  const done = ["general_company_discovery", "company_identity_resolution", "company_enrichment"];
  state.completed_capabilities = done.filter(
    (d) => plan.steps.some((s) => s.capability === d)) as typeof state.completed_capabilities;
  state.pending_capabilities = plan.steps
    .map((s) => s.capability)
    .filter((c) => !state.completed_capabilities.includes(c));
  state.company_keys = RUN_A76C7B4C_RESUME_RECORDS.map((r) => r.company_key);

  const asked: string[][] = [];
  const deps: CapabilityEngineDeps = {
    planDiscovery: stubDiscoverySelector(),
    evaluateMission: stubMissionEvaluator(),
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey !== "apify_linkedin_job_search") return Promise.resolve([]);
      const input = call.input as { company?: string[] };
      const companies = input.company ?? [];
      asked.push(companies);
      return Promise.resolve(
        project(RUN_A76C7B4C_ROWS.filter(
          (r) => companies.includes(r.company.linkedinUrl ?? ""))),
      );
    },
  };

  const run = await runCapabilityPlan(deps, {
    mission: MISSION, plan, state,
    resume: {
      workspace_id: "0f8ab6f8-1d3f-4e6a-9a5b-000000000000",
      lineage_root_task_id: "a76c7b4c-86b4-4171-b0cf-22991e59c267",
      records: RUN_A76C7B4C_RESUME_RECORDS,
    },
  });
  return { run, asked };
}

Deno.test("5. the engine asks about the right five companies either way", async () => {
  const { asked } = await replayHiringStage(deliverToEngine);
  const all = asked.flat().sort();
  assertEquals(all, [
    "https://www.linkedin.com/company/atlas-search",
    "https://www.linkedin.com/company/pursuit-sales-solutions",
    "https://www.linkedin.com/company/sotalentjobs",
    "https://www.linkedin.com/company/storm3",
    "https://www.linkedin.com/company/storm4",
  ], "the batches production issued, reproduced from the persisted state");
});

Deno.test("6. REPLAY: production's own transport must not empty the hiring stage", async () => {
  const { run } = await replayHiringStage(deliverToEngine);
  const hiring = run.capability_outcomes.find((o) => o.capability === "hiring_verification");
  assert(hiring, "the stage must have run");

  // THIS IS THE PRODUCTION FAILURE, STATED AS A REQUIREMENT.
  //
  // Live, this reported rows 0 and "no company had a relevant commercial role"
  // while holding 84 rows naming three companies hiring Account Executives.
  assertEquals(
    hiring!.reason, null,
    "a stage handed 84 paid rows must not report that nobody had a commercial role",
  );
  assert(hiring!.rows >= 3, `at least three companies must verify, got ${hiring!.rows}`);

  const verified = run.companies.filter(
    (c) => c.hiring_assessment?.verdict === "hiring_verified").map((c) => c.key).sort();
  assertEquals(verified, [
    "https://www.linkedin.com/company/pursuit-sales-solutions",
    "https://www.linkedin.com/company/storm3",
    "https://www.linkedin.com/company/storm4",
  ]);
});

Deno.test("7. the Actor's own shape through the same engine verifies three — " +
  "so the transport is the only difference", async () => {
  const { run } = await replayHiringStage(
    (rows) => rows as unknown as Record<string, unknown>[]);
  const hiring = run.capability_outcomes.find((o) => o.capability === "hiring_verification");
  assert(hiring, "the stage must have run");
  assert(hiring!.rows >= 3,
    `the nested shape the engine was written against must work: got ${hiring!.rows}`);
});
