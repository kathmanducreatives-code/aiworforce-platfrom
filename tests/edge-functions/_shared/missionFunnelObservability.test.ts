// "I ASKED FOR 5 LEADS AND GOT 1. WHAT HAPPENED TO THE OTHER 19?"
//
// Every number needed to answer that already existed, spread across eight
// structures — `state.prequalification`, `state.triage`,
// `state.shortlist_decision`, the capability ledger, `provider_attempts`,
// per-company `stage_block` and `enrichment_outcome`, `evaluation_paths`, and
// the Workbench rows. Some count companies, some count calls, some count rows,
// and answering the question meant joining them by hand and knowing which was
// which.
//
// `buildMissionFunnel` is that join, and these tests hold the one property that
// makes it worth trusting: EVERY COMPANY THAT LEAVES THE FUNNEL LEAVES FOR A
// STATED REASON, in one of three kinds that are never mixed —
//
//   decided    something judged it
//   withheld   the run stopped or failed; resumable, never a fact about it
//   excluded   nothing was ever spent on it
//
// `unaccounted` is what a silent loss looks like, so it is asserted to be zero
// rather than assumed to be.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMissionFunnel, funnelIsBalanced, unbalancedStages, formatFunnel,
  FUNNEL_STAGE_ORDER, MISSION_FUNNEL_VERSION,
  type FunnelCompany,
} from "../../../supabase/functions/_shared/leadMissionFunnel.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  runCapabilityPlan, missionFunnelFor,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

/** A company that sailed all the way through. */
const co = (over: Partial<FunnelCompany> = {}): FunnelCompany => ({
  key: "acme.com",
  prequalified: true,
  triage: "relevant",
  shortlisted: true,
  shortlist_exclusion: null,
  identity: "resolved",
  enrichment: "success",
  reached_brain: true,
  brain: "QUALIFIED",
  evaluated: true,
  decision_source: "gpt_evaluation",
  verdict: "pass",
  persisted: true,
  ...over,
});

// ═══════════════════════════════ 1. the funnel balances, by construction ══

Deno.test("1. a clean run balances at every stage", () => {
  const f = buildMissionFunnel([
    co({ key: "a" }), co({ key: "b" }), co({ key: "c" }),
  ]);
  assertEquals(f.version, MISSION_FUNNEL_VERSION);
  assert(funnelIsBalanced(f), JSON.stringify(unbalancedStages(f)));
  assertEquals(f.summary.qualified, 3);
  assertEquals(f.summary.discovered, 3);
  assertEquals(f.stages.map((s) => s.stage), [...FUNNEL_STAGE_ORDER]);
});

Deno.test("1b. a MIXED run accounts for every departure", () => {
  // One of each outcome the architecture distinguishes. If any of them is
  // dropped without attribution, `unaccounted` catches it.
  const f = buildMissionFunnel([
    co({ key: "qualified" }),
    co({ key: "rejected", brain: "REJECT", verdict: "reject" }),
    co({
      key: "held", brain: "REVIEW", verdict: "unknown",
      enrichment: "empty", decision_source: "insufficient_evidence",
    }),
    // A FAILED ENRICHMENT STILL REACHES THE BRAIN and is held there. It does
    // not leave the funnel — the architecture refuses to read a provider
    // failure as evidence against the company, so it becomes `unknown`.
    co({
      key: "enrich-failed", enrichment: "provider_error",
      reached_brain: true, brain: "REVIEW", evaluated: false,
      decision_source: "insufficient_evidence", verdict: "unknown",
      persisted: false,
    }),
    co({
      key: "identity-blocked", identity: "blocked", enrichment: "not_attempted",
      reached_brain: false, brain: null, evaluated: false,
      decision_source: "not_evaluated", verdict: null, persisted: false,
    }),
    co({
      key: "identity-unresolved", identity: "unresolved",
      enrichment: "not_attempted", reached_brain: false, brain: null,
      evaluated: false, decision_source: "identity_failure",
      verdict: null, persisted: false,
    }),
    co({
      key: "budget", shortlisted: false, shortlist_exclusion: "budget_exhausted",
      identity: "not_attempted", enrichment: "not_attempted",
      reached_brain: false, brain: null, evaluated: false,
      decision_source: "not_evaluated", verdict: null, persisted: false,
    }),
    co({
      key: "irrelevant", triage: "irrelevant", shortlisted: false,
      shortlist_exclusion: "triage_irrelevant", identity: "not_attempted",
      enrichment: "not_attempted", reached_brain: false, brain: null,
      evaluated: false, decision_source: "not_evaluated",
      verdict: null, persisted: false,
    }),
  ]);

  assert(funnelIsBalanced(f),
    `every stage must attribute its losses: ${JSON.stringify(unbalancedStages(f))}`);
  assertEquals(f.summary.discovered, 8);
  assertEquals(f.summary.qualified, 1);
  assertEquals(f.summary.rejected, 1);
  assertEquals(f.summary.unknown, 2, "the held one AND the enrichment failure");
  // THE TWO NUMBERS THAT ANSWER THE USER'S QUESTION.
  assertEquals(f.summary.never_investigated, 2, "budget + triage_irrelevant");
  assertEquals(f.summary.withheld, 2, "enrichment error + identity deferral");
});

Deno.test("1c. an UNACCOUNTED loss is caught rather than hidden", () => {
  // A company that reached the Brain but appears nowhere in any outcome. This
  // is the shape of the bug the funnel exists to surface, so it must not
  // balance.
  const f = buildMissionFunnel([
    co({
      key: "vanished", reached_brain: true, brain: null,
      evaluated: false, verdict: null, persisted: false,
    }),
  ]);
  const bad = unbalancedStages(f);
  assertFalse(funnelIsBalanced(f), "a company with no outcome must not balance");
  assert(bad.some((s) => s.stage === "mission_evaluator"),
    `the evaluator stage must report the loss, got ${JSON.stringify(bad)}`);
});

// ═════════════════════ 2. the three kinds of departure are never conflated ══

Deno.test("2. excluded, withheld and decided are separate counts", () => {
  const f = buildMissionFunnel([
    co({
      key: "never-looked-at", shortlisted: false,
      shortlist_exclusion: "budget_exhausted", identity: "not_attempted",
      enrichment: "not_attempted", reached_brain: false, brain: null,
      evaluated: false, decision_source: "not_evaluated",
      verdict: null, persisted: false,
    }),
    co({ key: "judged", brain: "REJECT", verdict: "reject", persisted: false }),
  ]);
  const shortlist = f.stages.find((s) => s.stage === "smart_shortlist")!;
  const evaluator = f.stages.find((s) => s.stage === "mission_evaluator")!;

  assertEquals(shortlist.excluded, 1, "the budget is an exclusion, not a decision");
  assertEquals(shortlist.decided, 0, "and nothing at the shortlist decides anything");
  assertEquals(evaluator.decided, 1, "only the evaluator decided");
  // THE HEADLINE: a company nobody judged never lands in a `decided` count.
  assertEquals(f.summary.rejected, 1);
  assertEquals(f.summary.never_investigated, 1);
});

Deno.test("2b. an EMPTY enrichment still advances — absence is not a negative", () => {
  // The architecture's own rule, asserted at the funnel: an empty provider
  // result is an absence of evidence, so the company reaches the Brain and is
  // HELD. Only `provider_error` and `deferred` are withheld.
  const f = buildMissionFunnel([
    co({ key: "empty", enrichment: "empty", brain: "REVIEW", verdict: "unknown",
      decision_source: "insufficient_evidence", persisted: false }),
  ]);
  const enrichment = f.stages.find((s) => s.stage === "enrichment")!;
  assertEquals(enrichment.withheld, 0, "an answered-empty enrichment is not withheld");
  assertEquals(enrichment.advanced, 1);
  assertEquals(enrichment.detail.empty, 1);
  assert(funnelIsBalanced(f));
});

Deno.test("2c. a DEFERRED identity is withheld, never counted as unresolved", () => {
  const f = buildMissionFunnel([
    co({
      key: "blocked", identity: "blocked", enrichment: "not_attempted",
      reached_brain: false, brain: null, evaluated: false,
      decision_source: "not_evaluated", verdict: null, persisted: false,
    }),
  ]);
  const identity = f.stages.find((s) => s.stage === "identity_resolution")!;
  assertEquals(identity.withheld, 1);
  assertEquals(identity.decided, 0, "the clock decided nothing about this company");
  assertEquals(identity.detail.blocked, 1);
  assertEquals(identity.detail.unresolved, 0,
    "a lookup that never ran did not return 'not found'");
});

// ══════════════════════════ 3. through the REAL engine, end to end ══════════

const CANONICAL =
  "Find founders of SaaS startups hiring software engineers in the United States. " +
  "Return 5 qualified leads.";

const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(CANONICAL);
  return {
    ...m,
    company_profile: { ...m.company_profile, employee_range: { min: 10, max: 500 } },
  };
};

const BRAIN = {
  employee_min: 10, employee_max: 500,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

const ycRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Acme${i}`, website: `https://acme${i}.com`, teamSize: 40 + i,
    batch: "W20", industries: ["B2B"], id: `acme${i}`,
    openJobs: [{ title: "Backend Engineer" }],
  })) as unknown as Record<string, unknown>[];

const identityRow = (i: number) => ({
  companyName: `Acme${i}`,
  linkedinUrl: `https://www.linkedin.com/company/acme${i}`,
  website: `https://acme${i}.com`,
  employeeCount: 40 + i,
});

const runEngine = async (o: {
  companies?: number;
  onEnrich?: () => Record<string, unknown>[];
} = {}) => {
  const n = o.companies ?? 4;
  const m = mission();
  const plan = buildCapabilityGraph(m);
  return await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey === "apify_yc_companies_memo23") {
        return Promise.resolve(ycRows(n));
      }
      if (call.actorKey === "apify_linkedin_company_details" && o.onEnrich) {
        return Promise.resolve(o.onEnrich() as Record<string, unknown>[]);
      }
      return Promise.resolve(
        Array.from({ length: n }, (_, i) => identityRow(i)) as Record<string, unknown>[],
      );
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
  } as never, {
    mission: m, plan, brain: BRAIN, maxCandidates: 60, readEnv: () => undefined,
  } as never);
};

Deno.test("3. a real engine run produces a balanced funnel", async () => {
  const run = await runEngine();
  const f = missionFunnelFor(run.companies);
  assert(funnelIsBalanced(f),
    `a real run must account for every company: ${JSON.stringify(unbalancedStages(f))}`);
  assertEquals(f.summary.discovered, run.companies.length);
  // The log form is stable and greppable.
  const lines = formatFunnel(f);
  assertEquals(lines.length, FUNNEL_STAGE_ORDER.length);
  assert(lines[0].startsWith("discovery:"));
  assertFalse(lines.some((l) => l.includes("UNACCOUNTED")));
});

Deno.test("3b. a provider failure shows up as WITHHELD, not as rejections", async () => {
  const run = await runEngine({ onEnrich: () => { throw new Error("actor down"); } });
  const f = missionFunnelFor(run.companies);

  assert(funnelIsBalanced(f), JSON.stringify(unbalancedStages(f)));
  assertEquals(f.summary.rejected, 0,
    "a provider that failed may not produce a single rejected company");
  assert(f.summary.withheld > 0,
    "the failure must be visible as work the run still owes");
  // ENRICHMENT REMOVES NOBODY — every one of these still reaches the Brain and
  // is held there. The lost evidence is reported as `without_evidence`, and the
  // consequence shows up at the evaluator as `unknown`.
  const enrichment = f.stages.find((s) => s.stage === "enrichment")!;
  assertEquals(enrichment.entered, enrichment.advanced,
    "a provider failure does not drop a company from the pipeline");
  assertEquals(enrichment.detail.provider_error, enrichment.detail.without_evidence);
  const evaluator = f.stages.find((s) => s.stage === "mission_evaluator")!;
  assertEquals(evaluator.decided, 0, "nothing was judged");
  assertEquals(evaluator.withheld, f.summary.unknown);
});

Deno.test("3c. the funnel and the engine agree about the same run", async () => {
  // THE POINT OF READING FROM THE COMPANIES. Two independent counters always
  // eventually disagree — the audited run reported 6 resolved / 4 unresolved on
  // one screen and 7 / 3 on another. The funnel is derived from the same
  // objects the Workbench projection reads, so it cannot drift.
  const run = await runEngine();
  const f = missionFunnelFor(run.companies);
  assertEquals(f.summary.qualified,
    run.companies.filter((c) => c.verdict === "pass").length);
  assertEquals(f.summary.investigated,
    run.companies.filter((c) => c.shortlisted).length);
  assertEquals(f.summary.discovered, run.companies.length);
});

Deno.test("3d. persistence reports what was WRITTEN, not what was eligible", async () => {
  const run = await runEngine();
  const none = missionFunnelFor(run.companies, { persistedKeys: [] });
  const persistence = none.stages.find((s) => s.stage === "persistence")!;
  assertEquals(persistence.detail.written, 0,
    "a qualified company that failed to persist must not be reported as written");
});
