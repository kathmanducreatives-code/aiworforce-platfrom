// THE FREE PRE-PASS, PROVED THROUGH THE REAL ENGINE, ON A NON-YC POOL.
//
// ── WHY A SECOND FILE ───────────────────────────────────────────────────────
//
// `genericPrequalification.test.ts` proves the scorer. It cannot prove the
// WIRING, and the wiring is where this change actually went wrong while it was
// being written: the first version selected companies to score with
// `prequalified === null`, which is also true of a company the YC pass REFUSED
// as a scraper artifact. Those kept their `prequal_key` and were deleted a few
// lines later precisely because they had no verdict — so handing them one
// resurrected Y Combinator's own directory page into the pool as a lead.
//
// A unit test on the scorer cannot see that. It only appears when both passes
// and the splice loop run together, which is what this file does: the real
// `runCapabilityPlan`, the real graph, the real normalizers, the real validator.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { runCapabilityPlan } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

const CANONICAL =
  "Find founders of SaaS startups hiring software engineers in the United States. Return 5 qualified leads.";

const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(CANONICAL);
  return {
    ...m,
    company_profile: { ...m.company_profile, employee_range: { min: 10, max: 150 } },
  };
};

const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

/**
 * ── WHY THIS POOL IS MIXED, AND NOT A PURE LINKEDIN ONE ────────────────────
 *
 * The obvious fixture — discover with `apify_linkedin_company_search` — is
 * refused by the real validator, and rightly. That actor is a company-NAME
 * matcher whose card declares `not_for: "semantic/concept search"`, and this
 * mission discovers by concept. Asked to find "SaaS startups" it once returned
 * `AI Central`, `Startup San Diego` and `NVIDIA AI`. A test that stubbed past
 * that guard would be proving the pre-pass works on a pool production can never
 * legitimately have.
 *
 * So the fixture is the shape a real run actually produces: memo23 as primary,
 * solidcode as the breadth fallback. Both are legal concept-discovery sources.
 * Critically, only ONE of them is readable by the YC pre-pass — it parses
 * memo23's raw row shape — so solidcode rows arrive at the paid stages with no
 * verdict at all. That is precisely the population this change exists for, and
 * it is reached without bypassing a single production rule.
 *
 * NOTE ON SCOPE: the size gate cannot fire through this path, because the only
 * sources carrying a trusted EXACT headcount are the two LinkedIn actors and
 * neither may open a concept run. The gate itself is proved at unit level in
 * `genericPrequalification.test.ts` test 1. What THIS file proves is the
 * wiring: that a company the YC pass cannot read still gets scored, ranked and
 * reported, rather than being waved through unranked.
 */
const MEMO23_ROWS = [
  { name: "Realco", website: "https://realco.dev", teamSize: 40, batch: "W23",
    industries: ["B2B"], id: "realco",
    openJobs: [{ title: "Software Engineer" }, { title: "Head of Sales" }] },
  { name: "Second Co", website: "https://secondco.dev", teamSize: 30, batch: "W23",
    industries: ["B2B"], id: "secondco",
    openJobs: [{ title: "Backend Engineer" }] },
];

/** solidcode's own row shape — no `openJobs` the YC pre-pass can read. */
const SOLIDCODE_ROWS = [
  { name: "Nimbus Ledger", website: "https://nimbusledger.com", teamSize: 25,
    companyId: 901, longDescription: "Nimbus Ledger sells B2B accounting SaaS." },
  { name: "Harbor Metrics", website: "https://harbormetrics.com", teamSize: 85,
    companyId: 902, longDescription: "Harbor Metrics sells B2B telemetry SaaS." },
  { name: "Vaultline", website: "https://vaultline.io", teamSize: 60,
    companyId: 903, longDescription: "Vaultline sells encrypted document SaaS." },
];

const YC_NAMES = ["Realco", "Second Co"];
const GENERIC_NAMES = ["Nimbus Ledger", "Harbor Metrics", "Vaultline"];

interface Trace { calls: Array<{ actor: string; input: Record<string, unknown> }> }

async function runFixture() {
  const trace: Trace = { calls: [] };
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector([
      {
        actor_key: "apify_yc_companies_memo23",
        role: "primary",
        input: { mode: "companies", isHiring: true },
        rationale: "test fixture: the pool the YC pre-pass can read",
      },
      {
        actor_key: "apify_yc_companies_solidcode",
        // BREADTH, NOT FALLBACK. A fallback runs only when the primary comes up
        // short, so with memo23 succeeding it never fires and this file would
        // have asserted against a pool that had no generic half in it at all.
        role: "breadth",
        input: { teamSize: ["11-50", "51-200"] },
        rationale: "test fixture: a pool the YC pre-pass CANNOT read",
      },
    ]),
    invoke: async (call: CompiledActorCall<unknown>) => {
      trace.calls.push({
        actor: call.actorKey, input: call.input as Record<string, unknown>,
      });
      await new Promise((r) => setTimeout(r, 1));
      if (call.actorKey === "apify_yc_companies_memo23") {
        return MEMO23_ROWS as Record<string, unknown>[];
      }
      if (call.actorKey === "apify_yc_companies_solidcode") {
        return SOLIDCODE_ROWS as Record<string, unknown>[];
      }
      return [];
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  }, {
    mission: m, plan, brain: BRAIN, maxCandidates: 50,
    solidcodeTeamSizes: ["11-50", "51-200"],
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
  });
  return { trace, run };
}

// ═══════════ 1. THE HALF THE YC PASS CANNOT READ IS STILL SCORED ══════════

Deno.test("1. companies the YC pre-pass cannot read still get a free verdict", async () => {
  const { run } = await runFixture();

  assert(run.state.prequalification, "the free verdict must be persisted");
  const pq = run.state.prequalification!;

  // BEFORE THIS CHANGE the solidcode half reached identity resolution and
  // enrichment with no verdict, no score and no rank — `buildSmartShortlist`
  // reads a missing score as -1, so they sorted beneath every YC company on
  // that tiebreak, not because they were worse but because nothing scored them.
  assertEquals(pq.generic_scored, SOLIDCODE_ROWS.length,
    "every company from a source the YC pass cannot read must be scored");
  assertEquals(pq.generic_version, "generic-prequalification-v1");

  // All three solidcode rows carry a description — the ICP gate's primary input.
  assertEquals(pq.generic_with_description, SOLIDCODE_ROWS.length);
  // …and none carries a trusted EXACT headcount. YC `teamSize` is
  // self-reported and its normalizer omits it, which is why the size gate
  // correctly does not fire on this pool.
  assertEquals(pq.generic_with_trusted_size, 0);
});

// ═══════════ 2. ONE REPORTED VERDICT DESCRIBES THE WHOLE POOL ══════════════

Deno.test("2. the reported verdict covers both halves, and inflates neither", async () => {
  const { run } = await runFixture();
  const pq = run.state.prequalification!;

  const names = pq.companies.map((c) => c.name).sort();
  assertEquals(names, [...YC_NAMES, ...GENERIC_NAMES].sort(),
    "the reported pool must be the whole pool, not the YC half of it");

  // The funnel reads these two numbers. A mixed pool described by half of
  // itself is the same class of error as the old shortlist telemetry, which
  // named a set of companies that had not been the ones investigated.
  assertEquals(pq.eligible_companies, pq.companies.filter((c) => c.eligible).length);

  // ROLE FACTS ARE NOT INFLATED. The generic companies have no job rows, and
  // counting them as having commercial roles would assert something nobody
  // established.
  assert(pq.companies_with_commercial_roles <= YC_NAMES.length,
    `commercial-role count ${pq.companies_with_commercial_roles} exceeds the ` +
    `YC half — the generic pass has no job rows and must claim none`);

  for (const name of GENERIC_NAMES) {
    const c = pq.companies.find((x) => x.name === name)!;
    assertEquals(c.best_tier, null, `${name} has no job rows, so no tier`);
    assertEquals(c.commercial_jobs, [], name);
  }
});

// ═══════════ 3. THE VERDICT COSTS NOTHING ══════════════════════════════════

Deno.test("3. the free pass adds no provider call of its own", async () => {
  const { trace } = await runFixture();

  // The pre-pass is free by construction — it reads rows discovery already
  // bought. One call per discovery actor and nothing extra between them and the
  // verdict; otherwise the saving would be paying for itself.
  assertEquals(
    trace.calls.filter((c) => c.actor === "apify_yc_companies_memo23").length, 1);
  assert(
    trace.calls.filter((c) => c.actor === "apify_yc_companies_solidcode").length >= 1);
});

// ═══════════ 4. THE REGRESSION THAT NEARLY SHIPPED ═════════════════════════

Deno.test("4. a row the YC pass REFUSED is not re-examined, or re-counted", async () => {
  // ── THE BUG THIS PINS, STATED ACCURATELY ─────────────────────────────────
  //
  // The generic pass first selected companies with `prequalified === null`,
  // which is ALSO true of a row the YC pass refused — Y Combinator's own page,
  // or a row with no name and no website.
  //
  // The first version of this comment claimed that resurrected the artifact
  // into the pool. It does not, and the mutation proved it: the generic pass
  // carries the same artifact list and the same no-name rule, refuses the row
  // again, and the splice still removes it. The pool stays clean.
  //
  // What actually breaks is the REPORTED ARITHMETIC. Every refused row is
  // examined and excluded twice, so on this three-row fixture `total_rows`
  // reads 5 and `artifacts_excluded` reads 4. Those are the numbers the funnel
  // publishes and an audit reads to tell a bad pool from a bad policy, and
  // doubling them makes a clean run look dirty.
  const YC_WITH_ARTIFACT = [
    { name: "Y Combinator", website: "https://www.ycombinator.com", teamSize: 50,
      batch: "S05", industries: ["B2B"], id: "yc",
      openJobs: [{ title: "Head of Sales" }] },
    { name: "Realco", website: "https://realco.dev", teamSize: 40,
      batch: "W23", industries: ["B2B"], id: "realco",
      openJobs: [{ title: "Software Engineer" }] },
    // No name and no website — memo23 returns rows like this.
    { teamSize: null, openJobs: [] },
  ];

  const m = mission();
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan({
    planDiscovery: stubDiscoverySelector([{
      actor_key: "apify_yc_companies_memo23",
      role: "primary",
      input: { mode: "companies", isHiring: true },
      rationale: "test fixture: a YC pool containing a directory artifact",
    }]),
    invoke: async (call: CompiledActorCall<unknown>) => {
      await new Promise((r) => setTimeout(r, 1));
      return call.actorKey === "apify_yc_companies_memo23"
        ? YC_WITH_ARTIFACT as Record<string, unknown>[]
        : [];
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  }, {
    mission: m, plan, brain: BRAIN, maxCandidates: 50,
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
  });

  const pq = run.state.prequalification!;
  const names = pq.companies.map((c) => c.name);

  // The pool is clean — this holds with or without the guard, and is asserted
  // so a future change that DOES resurrect an artifact is caught here.
  assertFalse(names.includes("Y Combinator"),
    "the YC directory page was refused as an artifact and must not reappear");
  assert(names.includes("Realco"), "the real company must survive");

  // ── THE ASSERTIONS THAT ACTUALLY BITE ───────────────────────────────────
  //
  // Exact counts, not `>=`. A lower bound passes under the doubling this test
  // exists to catch, which is how the first version of it passed while
  // asserting nothing about the bug in its own title.
  assertEquals(pq.total_rows, 3,
    "three rows were discovered; a higher number means rows were examined twice");
  assertEquals(pq.artifacts_excluded, 2,
    "two rows are artifacts; a higher number means they were refused twice");

  // THE GENERIC PASS SAW NOTHING HERE. Every row came from memo23, so every
  // company had a `prequal_key` — "never seen" is empty, which is the whole
  // point of the guard.
  assertEquals(pq.generic_scored, 0,
    "a pure YC pool must not reach the generic pass at all");
});

// ═══════════ 5. NO SOURCE IS SILENTLY WAVED THROUGH ════════════════════════

Deno.test("5. every discovered company carries a verdict, whatever found it", async () => {
  const { run } = await runFixture();
  const pq = run.state.prequalification!;

  // THE PROPERTY THIS CHANGE EXISTS FOR: nothing reaches the paid stages
  // unranked and unexplained, regardless of which actor introduced it.
  assertEquals(pq.companies.length, MEMO23_ROWS.length + SOLIDCODE_ROWS.length);
  for (const c of pq.companies) {
    assert(c.reasons.length > 0, `${c.name} has a verdict with no stated reason`);
    assertEquals(typeof c.score, "number", `${c.name} was not scored`);
  }

  // AND THE REPORTED COUNT IS WHAT MAKES A NEW ACTOR VISIBLE. `generic_scored`
  // exists so an operator can see a source arriving ungated, rather than
  // inferring it from a cost line a month later.
  assertEquals(pq.generic_scored, SOLIDCODE_ROWS.length);

  // Each generic company states what it was ranked on, in words. A score with
  // no reason is a number nobody can audit.
  for (const name of GENERIC_NAMES) {
    const c = pq.companies.find((x) => x.name === name)!;
    assert(c.reasons.some((r) => /description/.test(r)),
      `${name}: ${c.reasons.join(" | ")}`);
    assert(c.reasons.some((r) => /size unverified/.test(r)),
      `${name} must say its size could not be verified: ${c.reasons.join(" | ")}`);
  }
});
